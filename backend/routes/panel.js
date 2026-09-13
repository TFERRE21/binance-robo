const express = require("express");

const db = require("../services/db");
const authMiddleware = require("../middleware/auth");
const cryptoService = require("../services/cryptoService");

const Binance = require("binance-api-node").default;

const router = express.Router();


// =========================================================
// FUNÇÕES GERAIS
// =========================================================

function numero(value) {

  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : 0;
}


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
// BUSCAR CONTA DO USUÁRIO
// =========================================================

async function obterContaUsuario(
  userId,
  accountId
) {

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

  if (
    result.rows.length === 0
  ) {

    return null;

  }

  return result.rows[0];
}


// =========================================================
// AJUSTAR QUANTIDADE
// =========================================================

function ajustarQuantidade(
  quantidade,
  stepSize
) {

  quantidade =
    numero(quantidade);

  stepSize =
    numero(stepSize);

  if (
    quantidade <= 0
  ) {

    return 0;

  }

  if (
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


  const resultado =
    Math.floor(
      quantidade / stepSize
    ) * stepSize;


  return Number(
    resultado.toFixed(casas)
  );

}


// =========================================================
// FILTROS DO SÍMBOLO
// =========================================================

async function obterFiltros(
  client,
  symbol
) {

  const info =
    await client.exchangeInfo();


  const mercado =
    (
      info.symbols || []
    ).find(
      (item) =>
        item.symbol === symbol
    );


  if (
    !mercado
  ) {

    return null;

  }


  const lotSize =
    (
      mercado.filters || []
    ).find(
      (filter) =>
        filter.filterType === "LOT_SIZE"
    );


  const minNotionalFilter =
    (
      mercado.filters || []
    ).find(
      (filter) =>
        filter.filterType === "MIN_NOTIONAL"
    );


  const notionalFilter =
    (
      mercado.filters || []
    ).find(
      (filter) =>
        filter.filterType === "NOTIONAL"
    );


  return {

    symbol:
      mercado.symbol,

    baseAsset:
      mercado.baseAsset,

    quoteAsset:
      mercado.quoteAsset,

    status:
      mercado.status,

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
        minNotionalFilter?.minNotional
      ) ||
      numero(
        notionalFilter?.minNotional
      )

  };

}


// =========================================================
// SALDO DO ATIVO
// =========================================================

function encontrarSaldo(
  balances,
  asset
) {

  return (
    balances || []
  ).find(
    (item) =>
      String(
        item.asset || ""
      ).replace(
        /^LD/,
        ""
      ) === asset
  );

}


// =========================================================
// PREÇO USDT
// =========================================================

function obterPrecoUSDT(
  prices,
  asset
) {

  if (
    asset === "USDT"
  ) {

    return 1;

  }


  const direto =
    numero(
      prices[
        `${asset}USDT`
      ]
    );


  if (
    direto > 0
  ) {

    return direto;

  }


  const btc =
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
    btc > 0 &&
    btcUSDT > 0
  ) {

    return btc * btcUSDT;

  }


  return 0;

}


// =========================================================
// IDENTIFICAR OPERAÇÃO PELOS TRADES
//
// Regra:
// - compra aumenta posição
// - venda diminui posição
// - calculamos a posição líquida
// - calculamos custo líquido
//
// Isso permite reconstruir a operação da conta
// sem alterar o robo.js antigo.
// =========================================================

async function obterPosicaoPorTrades(
  client,
  symbol,
  quantidadeSaldo
) {

  try {

    const trades =
      await client.myTrades({
        symbol,
        limit: 1000
      });


    if (
      !Array.isArray(trades) ||
      trades.length === 0
    ) {

      return {

        quantidade:
          quantidadeSaldo,

        precoMedio:
          null,

        custo:
          null,

        pnlRealizado:
          0,

        encontrouTrades:
          false

      };

    }


    /*
     * Ordenar do mais antigo para
     * o mais recente.
     */

    trades.sort(
      (a, b) =>
        Number(a.time || 0) -
        Number(b.time || 0)
    );


    let quantidade =
      0;

    let custo =
      0;

    let pnlRealizado =
      0;


    for (
      const trade
      of trades
    ) {

      const qty =
        numero(
          trade.qty
        );


      const quoteQty =
        numero(
          trade.quoteQty
        );


      const price =
        numero(
          trade.price
        );


      if (
        qty <= 0
      ) {

        continue;

      }


      /*
       * COMPRA
       */

      if (
        trade.isBuyer
      ) {

        quantidade +=
          qty;

        custo +=
          quoteQty;

        continue;

      }


      /*
       * VENDA
       *
       * Calculamos o custo médio
       * da posição antes da venda.
       */

      if (
        quantidade > 0
      ) {

        const custoMedio =
          custo /
          quantidade;


        const custoVenda =
          custoMedio *
          qty;


        pnlRealizado +=
          quoteQty -
          custoVenda;


        custo -=
          custoVenda;

      }


      quantidade -=
        qty;


      if (
        quantidade < 0
      ) {

        quantidade = 0;

      }


      if (
        custo < 0
      ) {

        custo = 0;

      }

    }


    /*
     * O saldo atual da Binance é a
     * fonte final da quantidade real.
     *
     * Ajustamos o custo usando a
     * quantidade efetivamente existente.
     */

    const quantidadeFinal =
      numero(
        quantidadeSaldo
      );


    let precoMedio =
      null;


    if (
      quantidadeFinal > 0 &&
      custo > 0
    ) {

      precoMedio =
        custo /
        quantidadeFinal;

    }


    return {

      quantidade:
        quantidadeFinal,

      precoMedio,

      custo:

        precoMedio !== null
          ? precoMedio *
            quantidadeFinal
          : null,

      pnlRealizado,

      encontrouTrades:
        true

    };


  } catch (error) {

    console.error(
      "ERRO AO RECONSTRUIR POSIÇÃO:",
      error
    );


    return {

      quantidade:
        quantidadeSaldo,

      precoMedio:
        null,

      custo:
        null,

      pnlRealizado:
        0,

      encontrouTrades:
        false

    };

  }

}


// =========================================================
// CONTA / MOEDAS / PATRIMÔNIO
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


      if (
        !account.active
      ) {

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


      let patrimonioUSDT =
        0;

      let disponivelUSDT =
        0;

      let bloqueadoUSDT =
        0;


      const ativos = [];


      for (
        const balance
        of info.balances || []
      ) {

        const free =
          numero(
            balance.free
          );


        const locked =
          numero(
            balance.locked
          );


        const total =
          free +
          locked;


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


        const precoUSDT =
          obterPrecoUSDT(
            prices,
            asset
          );


        const valorUSDT =
          total *
          precoUSDT;


        const valorFree =
          free *
          precoUSDT;


        const valorLocked =
          locked *
          precoUSDT;


        patrimonioUSDT +=
          valorUSDT;


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

          valorUSDT,

          priceUnavailable:
            precoUSDT <= 0

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
        "ERRO AO CARREGAR CONTA:",
        error
      );


      return res.status(500).json({

        success: false,

        message:
          "Não foi possível carregar os dados da conta."

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


      const ticker =
        numero(
          prices[symbol]
        );


      const saldo =
        encontrarSaldo(
          info.balances,
          filtros.baseAsset
        );


      const quantidadeLivre =
        numero(
          saldo?.free
        );


      const quantidadeBloqueada =
        numero(
          saldo?.locked
        );


      const quantidadeTotal =
        quantidadeLivre +
        quantidadeBloqueada;


      /*
       * Reconstruir posição através
       * do histórico de trades.
       */

      const posicao =
        await obterPosicaoPorTrades(
          client,
          symbol,
          quantidadeTotal
        );


      const precoMedio =
        posicao.precoMedio;


      let pnlUSDT =
        null;


      let pnlPercentual =
        null;


      if (
        precoMedio !== null &&
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
            ) *
            100;

        }

      }


      /*
       * Ordens abertas.
       */

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
              numero(
                order.price
              ),

            origQty:
              numero(
                order.origQty
              ),

            executedQty:
              numero(
                order.executedQty
              ),

            status:
              order.status,

            type:
              order.type,

            time:
              order.time

          })
        );


      const valorAtual =
        quantidadeTotal *
        ticker;


      return res.json({

        success: true,


        operation: {

          symbol,

          baseAsset:
            filtros.baseAsset,

          quoteAsset:
            filtros.quoteAsset,

          currentPrice:
            ticker,

          quantity:
            quantidadeLivre,

          lockedQuantity:
            quantidadeBloqueada,

          totalQuantity:
            quantidadeTotal,

          averageEntry:
            precoMedio,

          currentValue:
            valorAtual,

          pnlUSDT,

          pnlPercentual,

          pnlRealized:
            posicao.pnlRealizado,

          foundTrades:
            posicao.encontrouTrades,

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


      const saldo =
        encontrarSaldo(
          info.balances,
          filtros.baseAsset
        );


      const saldoDisponivel =
        numero(
          saldo?.free
        );


      const quantidade =
        ajustarQuantidade(
          saldoDisponivel,
          filtros.stepSize
        );


      const precoAtual =
        numero(
          prices[symbol]
        );


      const valorEstimado =
        quantidade *
        precoAtual;


      const valido =
        quantidade >=
          filtros.minQty &&
        valorEstimado >=
          filtros.minNotional;


      return res.json({

        success: true,

        preview: {

          symbol,

          asset:
            filtros.baseAsset,

          quantity,

          price:
            precoAtual,

          estimatedValue:
            valorEstimado,

          availableBalance:
            saldoDisponivel,

          minQty:
            filtros.minQty,

          stepSize:
            filtros.stepSize,

          minNotional:
            filtros.minNotional,

          valid:
            valido

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
          error?.message ||
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


      /*
       * CONFIRMAÇÃO OBRIGATÓRIA
       */

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


      const saldo =
        encontrarSaldo(
          info.balances,
          filtros.baseAsset
        );


      const saldoDisponivel =
        numero(
          saldo?.free
        );


      const quantidadeSolicitada =
        numero(
          quantity
        );


      const quantidade =
        ajustarQuantidade(

          Math.min(
            quantidadeSolicitada,
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


      /*
       * IMPORTANTE:
       *
       * ESTA É UMA ORDEM REAL.
       *
       * Não executar sem confirmação
       * explícita do usuário.
       */

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


      const intervalosPermitidos = [
        "1m",
        "3m",
        "5m",
        "15m",
        "30m",
        "1h",
        "2h",
        "4h",
        "6h",
        "8h",
        "12h",
        "1d"
      ];


      if (
        !intervalosPermitidos.includes(
          interval
        )
      ) {

        return res.status(400).json({

          success: false,

          message:
            "Intervalo de gráfico inválido."

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
          (
            candles || []
          ).map(
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
