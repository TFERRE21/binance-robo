const express = require("express");

const db = require("../services/db");
const authMiddleware = require("../middleware/auth");
const cryptoService = require("../services/cryptoService");

const Binance = require("binance-api-node").default;

const router = express.Router();


// =========================================================
// OBTER CONTA DO USUÁRIO
// =========================================================

async function obterContaUsuario(userId, accountId) {

  const result = await db.query(
    `
      SELECT
        id,
        user_id,
        name,
        api_key_encrypted,
        api_secret_encrypted,
        active,
        created_at,
        updated_at
      FROM binance_accounts
      WHERE id = $1
      AND user_id = $2
    `,
    [
      accountId,
      userId
    ]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
}


// =========================================================
// CRIAR CLIENT BINANCE
// =========================================================

function criarCliente(account) {

  const apiKey =
    cryptoService.decrypt(
      account.api_key_encrypted
    );

  const apiSecret =
    cryptoService.decrypt(
      account.api_secret_encrypted
    );

  return Binance({
    apiKey,
    apiSecret
  });
}


// =========================================================
// CONVERTER NÚMERO
// =========================================================

function numero(value) {

  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : 0;
}


// =========================================================
// ARREDONDAR QUANTIDADE
// =========================================================

function ajustarQuantidade(
  quantidade,
  stepSize
) {

  quantidade = numero(quantidade);
  stepSize = numero(stepSize);

  if (
    quantidade <= 0 ||
    stepSize <= 0
  ) {
    return quantidade;
  }

  const casas =
    Math.max(
      0,
      (
        String(stepSize)
          .split(".")[1] || ""
      ).length
    );

  const ajustada =
    Math.floor(
      quantidade / stepSize
    ) * stepSize;

  return Number(
    ajustada.toFixed(casas)
  );
}


// =========================================================
// OBTER FILTROS DO SÍMBOLO
// =========================================================

async function obterFiltros(
  client,
  symbol
) {

  const info =
    await client.exchangeInfo();

  const mercado =
    info.symbols.find(
      (item) =>
        item.symbol === symbol
    );

  if (!mercado) {
    return null;
  }

  const lotSize =
    mercado.filters.find(
      (filter) =>
        filter.filterType === "LOT_SIZE"
    );

  const minNotionalFilter =
    mercado.filters.find(
      (filter) =>
        filter.filterType === "MIN_NOTIONAL"
    );

  const notionalFilter =
    mercado.filters.find(
      (filter) =>
        filter.filterType === "NOTIONAL"
    );

  const minNotional =
    minNotionalFilter?.minNotional ||
    notionalFilter?.minNotional ||
    0;

  return {

    symbol:
      mercado.symbol,

    status:
      mercado.status,

    baseAsset:
      mercado.baseAsset,

    quoteAsset:
      mercado.quoteAsset,

    stepSize:
      numero(
        lotSize?.stepSize
      ),

    minQty:
      numero(
        lotSize?.minQty
      ),

    minNotional:
      numero(
        minNotional
      )

  };
}


// =========================================================
// CALCULAR PREÇO MÉDIO
// =========================================================

async function calcularPrecoMedio(
  client,
  symbol,
  quantidadeAtual,
  filtrosInformados = null
) {

  try {

    const filtros =
      filtrosInformados ||
      await obterFiltros(client, symbol);

    const baseAsset =
      String(filtros?.baseAsset || "").toUpperCase();

    const quoteAsset =
      String(filtros?.quoteAsset || "").toUpperCase();

    if (!baseAsset || !quoteAsset) {
      return null;
    }

    /*
     * Reconstrói o custo da posição atual.
     *
     * BUY  -> aumenta quantidade e custo.
     * SELL -> reduz a posição pelo custo médio vigente.
     * Quando a posição chega a zero, uma nova posição começa.
     *
     * Isso evita o cálculo incorreto:
     * (compras - vendas) / saldo atual
     */

    const trades =
      await client.myTrades({
        symbol,
        limit: 1000
      });

    if (
      !Array.isArray(trades) ||
      trades.length === 0
    ) {
      return null;
    }

    const ordenados =
      [...trades].sort(
        (a, b) => {

          const tempoA =
            numero(a.time);

          const tempoB =
            numero(b.time);

          if (
            tempoA !== tempoB
          ) {
            return tempoA - tempoB;
          }

          return (
            numero(a.id) -
            numero(b.id)
          );
        }
      );

    let quantidadePosicao = 0;
    let custoPosicao = 0;

    const EPSILON = 1e-12;

    for (
      const trade
      of ordenados
    ) {

      const qty =
        numero(
          trade.qty
        );

      const quoteQty =
        numero(
          trade.quoteQty
        );

      const commission =
        numero(
          trade.commission
        );

      const commissionAsset =
        String(
          trade.commissionAsset || ""
        ).toUpperCase();


      if (
        qty <= 0 ||
        quoteQty < 0
      ) {
        continue;
      }


      // ===================================================
      // COMPRA
      // ===================================================

      if (
        trade.isBuyer
      ) {

        let quantidadeRecebida =
          qty;

        let custoCompra =
          quoteQty;


        /*
         * Taxa cobrada no ativo comprado:
         * a quantidade efetivamente recebida é menor.
         */

        if (
          commission > 0 &&
          commissionAsset === baseAsset
        ) {

          quantidadeRecebida =
            Math.max(
              0,
              qty - commission
            );
        }


        /*
         * Taxa cobrada no ativo de cotação:
         * entra no custo da posição.
         */

        if (
          commission > 0 &&
          commissionAsset === quoteAsset
        ) {

          custoCompra +=
            commission;
        }


        if (
          quantidadeRecebida > 0
        ) {

          quantidadePosicao +=
            quantidadeRecebida;

          custoPosicao +=
            custoCompra;
        }


      // ===================================================
      // VENDA
      // ===================================================

      } else {

        let quantidadeVendida =
          qty;


        /*
         * Se a comissão da venda foi cobrada no
         * ativo base, ela também sai da posição.
         */

        if (
          commission > 0 &&
          commissionAsset === baseAsset
        ) {

          quantidadeVendida +=
            commission;
        }


        if (
          quantidadeVendida <= 0 ||
          quantidadePosicao <= EPSILON
        ) {
          continue;
        }


        /*
         * Na venda parcial removemos o custo médio
         * correspondente à quantidade vendida.
         *
         * NÃO subtraímos quoteQty do custo restante.
         */

        const quantidadeRemovida =
          Math.min(
            quantidadeVendida,
            quantidadePosicao
          );

        const custoMedioAtual =
          custoPosicao /
          quantidadePosicao;

        custoPosicao -=
          custoMedioAtual *
          quantidadeRemovida;

        quantidadePosicao -=
          quantidadeRemovida;


        if (
          quantidadePosicao <= EPSILON
        ) {

          quantidadePosicao = 0;
          custoPosicao = 0;
        }
      }
    }


    if (
      quantidadeAtual <= 0 ||
      quantidadePosicao <= 0 ||
      custoPosicao <= 0
    ) {

      return null;
    }


    /*
     * Se o histórico da Binance não consegue reconstruir
     * o saldo atual, não inventamos um preço médio.
     *
     * Isso pode ocorrer, por exemplo, se parte do ativo
     * veio de depósito externo ou se o histórico retornado
     * não contém trades antigos suficientes.
     */

    const tolerancia =
      Math.max(
        1e-8,
        Number(
          quantidadeAtual || 0
        ) * 0.01
      );


    if (
      Math.abs(
        quantidadePosicao -
        Number(quantidadeAtual)
      ) > tolerancia
    ) {

      console.warn(
        `PREÇO MÉDIO | ${symbol} | histórico não reconstrói exatamente o saldo atual | histórico=${quantidadePosicao} | saldo=${quantidadeAtual} | diferença=${Math.abs(quantidadePosicao - Number(quantidadeAtual))}`
      );

      return null;
    }


    return (
      custoPosicao /
      quantidadePosicao
    );


  } catch (error) {

    console.error(
      "ERRO AO CALCULAR PREÇO MÉDIO:",
      error
    );

    return null;
  }
}


// =========================================================
// CONTA — DADOS PRINCIPAIS
// =========================================================

router.get(
  "/account/:id",
  authMiddleware,
  async (req, res) => {

    try {

      const account =
        await obterContaUsuario(
          req.user.id,
          req.params.id
        );

      if (!account) {

        return res.status(404).json({

          success: false,

          message:
            "Conta Binance não encontrada para este usuário."

        });
      }

      if (!account.active) {

        return res.status(400).json({

          success: false,

          message:
            "Esta conta Binance está inativa."

        });
      }

      const client =
        criarCliente(account);

      const info =
        await client.accountInfo();

      const prices =
        await client.prices();

      let patrimonioUSDT = 0;
      let disponivelUSDT = 0;
      let bloqueadoUSDT = 0;

      const ativos = [];


      for (
        const balance
        of info.balances || []
      ) {

        const free =
          numero(balance.free);

        const locked =
          numero(balance.locked);

        const total =
          free + locked;

        if (
          total <= 0
        ) {
          continue;
        }


        const asset =
          String(
            balance.asset || ""
          ).replace(
            /^LD/,
            ""
          );


        let precoUSDT = 0;


        if (
          asset === "USDT"
        ) {

          precoUSDT = 1;

        } else {

          precoUSDT =
            numero(
              prices[
                `${asset}USDT`
              ]
            );

        }


        // =================================================
        // TENTAR VIA BTC
        // =================================================

        if (
          precoUSDT <= 0
        ) {

          const btcPrice =
            numero(
              prices[
                `${asset}BTC`
              ]
            );

          const btcUSDT =
            numero(
              prices.BTCUSDT
            );

          if (
            btcPrice > 0 &&
            btcUSDT > 0
          ) {

            precoUSDT =
              btcPrice *
              btcUSDT;

          }
        }


        // =================================================
        // SEM PREÇO
        // =================================================

        if (
          precoUSDT <= 0
        ) {

          ativos.push({

            asset,

            free,

            locked,

            total,

            precoUSDT: 0,

            valorUSDT: 0,

            priceUnavailable: true

          });

          continue;
        }


        const valorTotal =
          total *
          precoUSDT;

        const valorFree =
          free *
          precoUSDT;

        const valorLocked =
          locked *
          precoUSDT;


        patrimonioUSDT +=
          valorTotal;

        disponivelUSDT +=
          valorFree;

        bloqueadoUSDT +=
          valorLocked;


        ativos.push({

          asset,

          free,

          locked,

          total,

          precoUSDT,

          valorUSDT:
            valorTotal,

          priceUnavailable:
            false

        });

      }


      ativos.sort(
        (a, b) =>
          b.valorUSDT -
          a.valorUSDT
      );


      return res.json({

        success: true,

        account: {

          id:
            account.id,

          name:
            account.name,

          active:
            account.active

        },

        summary: {

          patrimonioUSDT,

          disponivelUSDT,

          bloqueadoUSDT,

          totalAtivos:
            ativos.length

        },

        ativos

      });


    } catch (error) {

      console.error(
        "ERRO AO CARREGAR PAINEL:",
        error
      );

      return res.status(500).json({

        success: false,

        message:
          "Não foi possível carregar os dados do painel."

      });

    }

  }
);


// =========================================================
// OPERAÇÃO DA CONTA
// =========================================================

router.get(
  "/operation/:id",
  authMiddleware,
  async (req, res) => {

    try {

      const account =
        await obterContaUsuario(
          req.user.id,
          req.params.id
        );

      if (!account) {

        return res.status(404).json({

          success: false,

          message:
            "Conta Binance não encontrada."

        });
      }


      const symbol =
        String(
          req.query.symbol || ""
        ).toUpperCase();


      if (!symbol) {

        return res.status(400).json({

          success: false,

          message:
            "Informe o símbolo da operação."

        });
      }


      const client =
        criarCliente(account);


      const info =
        await client.accountInfo();


      const prices =
        await client.prices();


      const ticker =
        numero(
          prices[symbol]
        );


      const filtros =
        await obterFiltros(
          client,
          symbol
        );


      if (!filtros) {

        return res.status(404).json({

          success: false,

          message:
            `Símbolo ${symbol} não encontrado na Binance.`

        });
      }


      const baseAsset =
        filtros.baseAsset;


      const balance =
        (
          info.balances || []
        ).find(
          (item) =>
            String(
              item.asset
            ).replace(
              /^LD/,
              ""
            ) === baseAsset
        );


      const quantidade =
        numero(
          balance?.free
        );


      const bloqueada =
        numero(
          balance?.locked
        );


      const quantidadeTotal =
        quantidade +
        bloqueada;


      const precoMedio =
        await calcularPrecoMedio(
          client,
          symbol,
          quantidadeTotal,
          filtros
        );


      let pnlUSDT = null;
      let pnlPercentual = null;


      if (
        precoMedio &&
        quantidadeTotal > 0 &&
        ticker > 0
      ) {

        const custo =
          precoMedio *
          quantidadeTotal;

        const valorAtual =
          ticker *
          quantidadeTotal;


        pnlUSDT =
          valorAtual -
          custo;


        if (
          custo > 0
        ) {

          pnlPercentual =
            (
              pnlUSDT /
              custo
            ) * 100;

        }

      }


      const ordens =
        await client.openOrders({
          symbol
        });


      const sellOrders =
        (
          ordens || []
        )
        .filter(
          (order) =>
            order.side === "SELL"
        )
        .map(
          (order) => ({

            orderId:
              order.orderId,

            symbol:
              order.symbol,

            price:
              numero(order.price),

            origQty:
              numero(order.origQty),

            executedQty:
              numero(order.executedQty),

            status:
              order.status,

            type:
              order.type,

            time:
              order.time

          })
        );


      const currentValue =
        ticker *
        quantidadeTotal;


      return res.json({

        success: true,

        operation: {

          symbol,

          baseAsset,

          quoteAsset:
            filtros.quoteAsset,

          currentPrice:
            ticker,

          quantity:
            quantidade,

          lockedQuantity:
            bloqueada,

          totalQuantity:
            quantidadeTotal,

          averageEntry:
            precoMedio,

          currentValue,

          pnlUSDT,

          pnlPercentual,

          minQty:
            filtros.minQty,

          stepSize:
            filtros.stepSize,

          minNotional:
            filtros.minNotional,

          sellOrders

        }

      });


    } catch (error) {

      console.error(
        "ERRO AO CARREGAR OPERAÇÃO:",
        error
      );

      return res.status(500).json({

        success: false,

        message:
          "Não foi possível carregar a operação."

      });

    }

  }
);


// =========================================================
// PRÉVIA DE VENDA
// =========================================================

router.get(
  "/manual/preview",
  authMiddleware,
  async (req, res) => {

    try {

      const account =
        await obterContaUsuario(
          req.user.id,
          req.query.account
        );


      if (!account) {

        return res.status(404).json({

          success: false,

          message:
            "Conta Binance não encontrada."

        });
      }


      const symbol =
        String(
          req.query.symbol || ""
        ).toUpperCase();


      if (!symbol) {

        return res.status(400).json({

          success: false,

          message:
            "Informe o símbolo."

        });
      }


      const client =
        criarCliente(account);


      const info =
        await client.accountInfo();


      const prices =
        await client.prices();


      const filtros =
        await obterFiltros(
          client,
          symbol
        );


      if (!filtros) {

        return res.status(404).json({

          success: false,

          message:
            "Símbolo não encontrado."

        });
      }


      const balance =
        (
          info.balances || []
        ).find(
          (item) =>
            String(
              item.asset
            ).replace(
              /^LD/,
              ""
            ) === filtros.baseAsset
        );


      const quantidade =
        ajustarQuantidade(
          balance?.free,
          filtros.stepSize
        );


      const precoAtual =
        numero(
          prices[symbol]
        );


      const valorEstimado =
        quantidade *
        precoAtual;


      return res.json({

        success: true,

        preview: {

          symbol,

          asset:
            filtros.baseAsset,

          quantity:
            quantidade,

          price:
            precoAtual,

          estimatedValue:
            valorEstimado,

          minQty:
            filtros.minQty,

          minNotional:
            filtros.minNotional,

          stepSize:
            filtros.stepSize,

          valid:
            quantidade >= filtros.minQty &&
            valorEstimado >= filtros.minNotional

        }

      });


    } catch (error) {

      console.error(
        "ERRO NA PRÉVIA DE VENDA:",
        error
      );

      return res.status(500).json({

        success: false,

        message:
          "Não foi possível preparar a prévia da venda."

      });

    }

  }
);


// =========================================================
// CANCELAR VENDA ATIVA
// =========================================================

router.post(
  "/manual/cancel-sell",
  authMiddleware,
  async (req, res) => {

    try {

      const {
        accountId,
        symbol
      } = req.body;


      const account =
        await obterContaUsuario(
          req.user.id,
          accountId
        );


      if (!account) {

        return res.status(404).json({

          success: false,

          message:
            "Conta Binance não encontrada."

        });
      }


      const symbolUpper =
        String(
          symbol || ""
        ).toUpperCase();


      if (!symbolUpper) {

        return res.status(400).json({

          success: false,

          message:
            "Informe o símbolo."

        });
      }


      const client =
        criarCliente(account);


      const abertas =
        await client.openOrders({
          symbol:
            symbolUpper
        });


      const sells =
        (
          abertas || []
        ).filter(
          (order) =>
            order.side === "SELL"
        );


      if (
        sells.length === 0
      ) {

        return res.json({

          success: true,

          cancelled: 0,

          message:
            "Não existem ordens SELL abertas."

        });
      }


      const resultados = [];


      for (
        const order
        of sells
      ) {

        const resultado =
          await client.cancelOrder({

            symbol:
              order.symbol,

            orderId:
              order.orderId

          });


        resultados.push(
          resultado
        );

      }


      return res.json({

        success: true,

        cancelled:
          resultados.length,

        orders:
          resultados,

        message:
          `${resultados.length} ordem(ns) SELL cancelada(s).`

      });


    } catch (error) {

      console.error(
        "ERRO AO CANCELAR VENDA:",
        error
      );

      return res.status(500).json({

        success: false,

        message:
          "Não foi possível cancelar as ordens SELL."

      });

    }

  }
);


// =========================================================
// VENDA MANUAL REAL
// =========================================================

router.post(
  "/manual/sell",
  authMiddleware,
  async (req, res) => {

    try {

      const {
        accountId,
        symbol,
        quantity,
        confirmation
      } = req.body;


      // ===================================================
      // CONFIRMAÇÃO
      // ===================================================

      if (
        confirmation !==
        "CONFIRMAR VENDA"
      ) {

        return res.status(400).json({

          success: false,

          message:
            "Confirmação de venda inválida."

        });
      }


      const account =
        await obterContaUsuario(
          req.user.id,
          accountId
        );


      if (!account) {

        return res.status(404).json({

          success: false,

          message:
            "Conta Binance não encontrada."

        });
      }


      const symbolUpper =
        String(
          symbol || ""
        ).toUpperCase();


      if (!symbolUpper) {

        return res.status(400).json({

          success: false,

          message:
            "Informe o símbolo."

        });
      }


      const client =
        criarCliente(account);


      const filtros =
        await obterFiltros(
          client,
          symbolUpper
        );


      if (!filtros) {

        return res.status(404).json({

          success: false,

          message:
            "Símbolo não encontrado."

        });
      }


      const info =
        await client.accountInfo();


      const balance =
        (
          info.balances || []
        ).find(
          (item) =>
            String(
              item.asset
            ).replace(
              /^LD/,
              ""
            ) === filtros.baseAsset
        );


      const saldoDisponivel =
        numero(
          balance?.free
        );


      const requestedQuantity =
        numero(
          quantity
        );


      const quantidade =
        ajustarQuantidade(
          Math.min(
            requestedQuantity,
            saldoDisponivel
          ),
          filtros.stepSize
        );


      if (
        quantidade <= 0
      ) {

        return res.status(400).json({

          success: false,

          message:
            "Quantidade disponível insuficiente."

        });
      }


      if (
        quantidade <
        filtros.minQty
      ) {

        return res.status(400).json({

          success: false,

          message:
            `Quantidade abaixo do mínimo permitido: ${filtros.minQty}.`

        });
      }


      const prices =
        await client.prices();


      const preco =
        numero(
          prices[symbolUpper]
        );


      if (
        preco <= 0
      ) {

        return res.status(400).json({

          success: false,

          message:
            "Não foi possível obter o preço atual."

        });
      }


      const valor =
        quantidade *
        preco;


      if (
        valor <
        filtros.minNotional
      ) {

        return res.status(400).json({

          success: false,

          message:
            `Valor da ordem abaixo do mínimo permitido: ${filtros.minNotional}.`

        });
      }


      // ===================================================
      // VENDA REAL
      // ===================================================

      const order =
        await client.order({

          symbol:
            symbolUpper,

          side:
            "SELL",

          type:
            "MARKET",

          quantity:
            quantidade

        });


      return res.json({

        success: true,

        message:
          "Venda enviada para a Binance.",

        order

      });


    } catch (error) {

      console.error(
        "ERRO NA VENDA MANUAL:",
        error
      );

      return res.status(500).json({

        success: false,

        message:
          error?.message ||
          "Não foi possível executar a venda."

      });

    }

  }
);


// =========================================================
// GRÁFICO
// =========================================================

router.get(
  "/chart",
  authMiddleware,
  async (req, res) => {

    try {

      const accountId =
        String(
          req.query.account || ""
        );


      const symbol =
        String(
          req.query.symbol ||
          "BTCUSDT"
        ).toUpperCase();


      const interval =
        String(
          req.query.interval ||
          "15m"
        );


      const account =
        await obterContaUsuario(
          req.user.id,
          accountId
        );


      if (!account) {

        return res.status(404).json({

          success: false,

          message:
            "Conta Binance não encontrada."

        });
      }


      const client =
        criarCliente(account);


      const candles =
        await client.candles({

          symbol,

          interval,

          limit: 300

        });


      return res.json({

        success: true,

        symbol,

        interval,

        candles:
          candles.map(
            (candle) => ({

              time:
                Math.floor(
                  Number(
                    candle.openTime
                  ) / 1000
                ),

              open:
                numero(
                  candle.open
                ),

              high:
                numero(
                  candle.high
                ),

              low:
                numero(
                  candle.low
                ),

              close:
                numero(
                  candle.close
                )

            })
          )

      });


    } catch (error) {

      console.error(
        "ERRO AO CARREGAR GRÁFICO:",
        error
      );

      return res.status(500).json({

        success: false,

        message:
          "Não foi possível carregar o gráfico."

      });

    }

  }
);


// =========================================================
// STATUS
// =========================================================

router.get(
  "/status/:id",
  authMiddleware,
  async (req, res) => {

    try {

      const account =
        await obterContaUsuario(
          req.user.id,
          req.params.id
        );


      if (!account) {

        return res.status(404).json({

          success: false,

          message:
            "Conta Binance não encontrada."

        });
      }


      return res.json({

        success: true,

        connected:
          account.active === true,

        account: {

          id:
            account.id,

          name:
            account.name,

          active:
            account.active

        }

      });


    } catch (error) {

      console.error(
        "ERRO AO CONSULTAR STATUS:",
        error
      );

      return res.status(500).json({

        success: false,

        message:
          "Erro ao consultar status."

      });

    }

  }
);


// =========================================================
// EXPORTAR
// =========================================================

module.exports = router;
