const express = require("express");
const path = require("path");

const authRoutes = require("./routes/auth");
const binanceRoutes = require("./routes/binance");
const panelRoutes = require("./routes/panel");
const subscriptionRoutes = require("./routes/subscription");
const reportRoutes = require("./routes/reports");
const newsRoutes = require("./routes/news");
const robotRoutes = require("./routes/robot");
const robotRiskRoutes = require("./routes/robotRisk");
const adminRoutes = require("./routes/admin");
const robotEngine = require("./services/robotEngine");

const authMiddleware = require("./middleware/auth");
const Binance = require("binance-api-node").default;

const app = express();

// =========================================================
// WEBHOOK STRIPE — RAW BODY
// =========================================================
// A Stripe precisa do corpo bruto para validar a assinatura.
// Este middleware fica antes do express.json() e somente no
// endpoint do webhook, sem interferir nas demais rotas.
app.use(
  "/api/subscription/webhook/stripe",
  express.raw({ type: "application/json" })
);

// =========================================================
// MIDDLEWARES
// =========================================================
app.use(express.json());
app.use(express.static(path.join(__dirname, "../publico")));

app.post("/api/support/chat", async function (req, res) {
  try {
    const mensagem = String(req.body?.message || "").trim();

    if (!mensagem) {
      return res.status(400).json({
        ok: false,
        erro: "Mensagem vazia."
      });
    }

    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        ok: false,
        erro: "OPENAI_API_KEY não configurada no servidor."
      });
    }

    const respostaOpenAI = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + apiKey
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                "Você é o assistente oficial de suporte do CRIPTOPRO. " +
                "Responda em português do Brasil, de forma clara, objetiva " +
                "e amigável. Ajude o usuário com dúvidas sobre o painel, " +
                "Binance, robôs, planos e funcionalidades do CRIPTOPRO."
            },
            {
              role: "user",
              content: mensagem
            }
          ],
          temperature: 0.3,
          max_tokens: 500
        })
      }
    );

    const dados = await respostaOpenAI.json();

    if (!respostaOpenAI.ok) {
      console.error("CRIPTOPRO SUPORTE - ERRO OPENAI:", dados);

      return res.status(500).json({
        ok: false,
        erro:
          dados?.error?.message ||
          "Erro ao consultar a OpenAI."
      });
    }

    const texto =
      dados?.choices?.[0]?.message?.content?.trim();

    if (!texto) {
      return res.status(500).json({
        ok: false,
        erro: "A OpenAI não retornou uma resposta."
      });
    }

    return res.json({
      ok: true,
      resposta: texto
    });

  } catch (erro) {
    console.error("CRIPTOPRO SUPORTE - ERRO:", erro);

    return res.status(500).json({
      ok: false,
      erro: "Não foi possível processar o atendimento."
    });
  }
});

// =========================================================
// CRIPTOPRO — CHAMADOS DE SUPORTE
// Envia os chamados por e-mail usando Resend
// A chave RESEND_API_KEY fica somente no servidor.
// =========================================================

function escaparHTML(valor) {
  return String(valor || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

app.post("/api/support/ticket", authMiddleware, async function (req, res) {
  const client = await require("./services/db").connect();

  try {
    const usuarioId = Number(req.user?.id || req.user?.userId);

    if (!usuarioId) {
      return res.status(401).json({
        ok: false,
        erro: "Usuário não autenticado."
      });
    }

    const nome = String(req.body.nome || "").trim();
    const email = String(req.body.email || "").trim();
    const categoria = String(req.body.categoria || "").trim();
    const prioridadeRecebida = String(
      req.body.prioridade || "NORMAL"
    ).trim().toUpperCase();

    const origem = String(
      req.body.pagina ||
      req.body.origem ||
      ""
    ).trim();

    const assunto = String(req.body.assunto || "").trim();
    const descricao = String(req.body.descricao || "").trim();

    if (!assunto) {
      return res.status(400).json({
        ok: false,
        erro: "Informe o assunto."
      });
    }

    if (!descricao) {
      return res.status(400).json({
        ok: false,
        erro: "Descreva o problema ou solicitação."
      });
    }

    if (assunto.length > 200) {
      return res.status(400).json({
        ok: false,
        erro: "Assunto muito longo."
      });
    }

    if (descricao.length > 10000) {
      return res.status(400).json({
        ok: false,
        erro: "Descrição muito longa."
      });
    }

    const prioridadesPermitidas = [
      "NORMAL",
      "IMPORTANTE",
      "URGENTE"
    ];

    const prioridade = prioridadesPermitidas.includes(
      prioridadeRecebida
    )
      ? prioridadeRecebida
      : "NORMAL";

    await client.query("BEGIN");

    const chamadoResult = await client.query(
      `
      INSERT INTO support_tickets
        (
          user_id,
          subject,
          category,
          priority,
          status
        )
      VALUES
        ($1, $2, $3, $4, 'ABERTO')
      RETURNING
        id,
        user_id,
        subject,
        category,
        priority,
        status,
        created_at,
        updated_at
      `,
      [
        usuarioId,
        assunto,
        categoria || null,
        prioridade
      ]
    );

    const chamado = chamadoResult.rows[0];

    const mensagemInicial =
      descricao +
      (origem
        ? "\n\nPágina de origem: " + origem
        : "");

    await client.query(
      `
      INSERT INTO support_messages
        (
          ticket_id,
          sender_type,
          sender_user_id,
          message
        )
      VALUES
        ($1, 'USER', $2, $3)
      `,
      [
        chamado.id,
        usuarioId,
        mensagemInicial
      ]
    );

    await client.query("COMMIT");

    console.log(
      "CRIPTOPRO SUPORTE — CHAMADO CRIADO:",
      chamado.id
    );

    return res.json({
      ok: true,
      ticketId: chamado.id,
      mensagem:
        "Chamado criado com sucesso.",
      chamado
    });

  } catch (erro) {
    try {
      await client.query("ROLLBACK");
    } catch (e) {}

    console.error(
      "CRIPTOPRO SUPORTE — ERRO AO CRIAR CHAMADO:",
      erro
    );

    return res.status(500).json({
      ok: false,
      erro: "Não foi possível criar o chamado."
    });

  } finally {
    client.release();
  }
});


// =========================================================
// CRIPTOPRO — LEITURA E RESPOSTA DOS CHAMADOS DO USUÁRIO
// O usuário só pode acessar chamados pertencentes ao próprio ID.
// =========================================================

app.get("/api/support/tickets", authMiddleware, async function (req, res) {
  try {
    const usuarioId = Number(req.user?.id || req.user?.userId);

    if (!usuarioId) {
      return res.status(401).json({
        ok: false,
        erro: "Usuário não autenticado."
      });
    }

    const result = await require("./services/db").query(
      `
      SELECT
        t.id,
        t.user_id,
        t.subject,
        t.category,
        t.priority,
        t.status,
        t.created_at,
        t.updated_at,
        t.closed_at,
        (
          SELECT sm.message
          FROM support_messages sm
          WHERE sm.ticket_id = t.id
          ORDER BY sm.id DESC
          LIMIT 1
        ) AS last_message
      FROM support_tickets t
      WHERE t.user_id = $1
      ORDER BY t.updated_at DESC, t.id DESC
      `,
      [usuarioId]
    );

    return res.json({
      ok: true,
      tickets: result.rows
    });

  } catch (erro) {
    console.error(
      "CRIPTOPRO SUPORTE — ERRO AO LISTAR CHAMADOS DO USUÁRIO:",
      erro
    );

    return res.status(500).json({
      ok: false,
      erro: "Não foi possível carregar seus chamados."
    });
  }
});

app.get("/api/support/tickets/:id", authMiddleware, async function (req, res) {
  try {
    const usuarioId = Number(req.user?.id || req.user?.userId);
    const ticketId = Number(req.params.id);

    if (!usuarioId) {
      return res.status(401).json({
        ok: false,
        erro: "Usuário não autenticado."
      });
    }

    if (!Number.isInteger(ticketId) || ticketId <= 0) {
      return res.status(400).json({
        ok: false,
        erro: "Chamado inválido."
      });
    }

    const ticketResult = await require("./services/db").query(
      `
      SELECT
        t.id,
        t.user_id,
        t.subject,
        t.category,
        t.priority,
        t.status,
        t.created_at,
        t.updated_at,
        t.closed_at
      FROM support_tickets t
      WHERE t.id = $1
        AND t.user_id = $2
      LIMIT 1
      `,
      [ticketId, usuarioId]
    );

    if (!ticketResult.rows.length) {
      return res.status(404).json({
        ok: false,
        erro: "Chamado não encontrado."
      });
    }

    const messagesResult = await require("./services/db").query(
      `
      SELECT
        id,
        sender_type,
        sender_user_id,
        message,
        created_at
      FROM support_messages
      WHERE ticket_id = $1
      ORDER BY id ASC
      `,
      [ticketId]
    );

    return res.json({
      ok: true,
      chamado: ticketResult.rows[0],
      mensagens: messagesResult.rows
    });

  } catch (erro) {
    console.error(
      "CRIPTOPRO SUPORTE — ERRO AO ABRIR CHAMADO DO USUÁRIO:",
      erro
    );

    return res.status(500).json({
      ok: false,
      erro: "Não foi possível carregar o chamado."
    });
  }
});

app.post("/api/support/tickets/:id/messages", authMiddleware, async function (req, res) {
  const client = await require("./services/db").connect();

  try {
    const usuarioId = Number(req.user?.id || req.user?.userId);
    const ticketId = Number(req.params.id);
    const message = String(
      req.body?.message ||
      req.body?.mensagem ||
      ""
    ).trim();

    if (!usuarioId) {
      return res.status(401).json({
        ok: false,
        erro: "Usuário não autenticado."
      });
    }

    if (!Number.isInteger(ticketId) || ticketId <= 0) {
      return res.status(400).json({
        ok: false,
        erro: "Chamado inválido."
      });
    }

    if (!message) {
      return res.status(400).json({
        ok: false,
        erro: "Digite uma mensagem."
      });
    }

    if (message.length > 10000) {
      return res.status(400).json({
        ok: false,
        erro: "Mensagem muito longa."
      });
    }

    await client.query("BEGIN");

    const ticketResult = await client.query(
      `
      SELECT
        id,
        user_id,
        status
      FROM support_tickets
      WHERE id = $1
        AND user_id = $2
      FOR UPDATE
      `,
      [ticketId, usuarioId]
    );

    if (!ticketResult.rows.length) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        ok: false,
        erro: "Chamado não encontrado."
      });
    }

    const ticket = ticketResult.rows[0];

    if (ticket.status === "FECHADO") {
      await client.query("ROLLBACK");

      return res.status(400).json({
        ok: false,
        erro: "Este chamado está fechado."
      });
    }

    const messageResult = await client.query(
      `
      INSERT INTO support_messages
        (
          ticket_id,
          sender_type,
          sender_user_id,
          message
        )
      VALUES
        ($1, 'USER', $2, $3)
      RETURNING
        id,
        sender_type,
        sender_user_id,
        message,
        created_at
      `,
      [
        ticketId,
        usuarioId,
        message
      ]
    );

    await client.query(
      `
      UPDATE support_tickets
      SET
        status = 'EM_ATENDIMENTO',
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      `,
      [ticketId]
    );

    await client.query("COMMIT");

    return res.json({
      ok: true,
      mensagem: "Mensagem enviada.",
      mensagemChamado: messageResult.rows[0]
    });

  } catch (erro) {
    try {
      await client.query("ROLLBACK");
    } catch (e) {}

    console.error(
      "CRIPTOPRO SUPORTE — ERRO AO RESPONDER CHAMADO:",
      erro
    );

    return res.status(500).json({
      ok: false,
      erro: "Não foi possível enviar sua mensagem."
    });

  } finally {
    client.release();
  }
});

// =========================================================
// ROTAS PRINCIPAIS
// =========================================================
app.use("/api/auth", authRoutes);
app.use("/api/binance", binanceRoutes);
app.use("/api/panel", panelRoutes);
app.use("/api/subscription", subscriptionRoutes);
app.use("/api/admin", adminRoutes);

// =========================================================
// CRIPTOPRO V7 - NOVAS ROTAS
// =========================================================
app.use("/api/panel/report", reportRoutes);
app.use("/api/news", newsRoutes);

// =========================================================
// TERMO DE RESPONSABILIDADE DO ROBÔ
// =========================================================
app.use("/api/robot/risk", robotRiskRoutes.router);

// O START passa primeiro pela autenticação e pela validação
// do termo de responsabilidade vinculado à configuração atual.
app.use(
  "/api/robot/start",
  authMiddleware,
  robotRiskRoutes.riskMiddleware
);

app.use("/api/robot", robotRoutes);

/*
 * CRIPTOPRO V7 - RECUPERAR ROBOS ATIVOS
 *
 * Ao iniciar o servidor, recupera somente os robos que estavam
 * marcados como ativos no banco de dados.
 *
 * O robo antigo global nao foi alterado neste passo.
 */
robotEngine.resumeRunning().catch(err => {
  console.error("ERRO AO RECUPERAR ROBOS:", err);
});

const PORT = process.env.PORT || 3000;

/*
=========================================================
BINANCE-ROBO - PAINEL PREMIUM V2
=========================================================
DUAS CONTAS TOTALMENTE SEPARADAS:

CONTA 1 = THIAGO
API_KEY_1
API_SECRET_1

CONTA 2 = SERGIO
API_KEY_2
API_SECRET_2

O painel mantém a leitura das duas contas e possui controle manual de venda/cancelamento, sem alterar o robô.
=========================================================
*/

const CONTAS = [
  {
    id: "1",
    nome: "THIAGO",
    descricao: "Minha conta",
    apiKey: process.env.API_KEY_1,
    apiSecret: process.env.API_SECRET_1
  },
  {
    id: "2",
    nome: "SERGIO",
    descricao: "Conta do amigo",
    apiKey: process.env.API_KEY_2,
    apiSecret: process.env.API_SECRET_2
  }
];

const clientes = CONTAS.map(function (conta) {
  return {
    id: conta.id,
    nome: conta.nome,
    descricao: conta.descricao,
    apiKey: conta.apiKey,
    apiSecret: conta.apiSecret,
    client:
      conta.apiKey && conta.apiSecret
        ? Binance({
            apiKey: conta.apiKey,
            apiSecret: conta.apiSecret
          })
        : null
  };
});

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function assetNormalizado(asset) {
  return String(asset || "").replace(/^LD/, "");
}

async function obterUSDTBRL(client) {
  try {
    const prices = await client.prices({ symbol: "USDTBRL" });
    if (prices && prices.USDTBRL) {
      return num(prices.USDTBRL);
    }
  } catch (e) {}

  return num(process.env.USDTBRL_RATE) || 5.50;
}

/*
=========================================================
CONTA
=========================================================
*/

async function obterConta(conta) {
  if (!conta.client) {
    throw new Error("Credenciais não configuradas.");
  }

  const resultado = await Promise.all([
    conta.client.accountInfo(),
    conta.client.prices(),
    obterUSDTBRL(conta.client)
  ]);

  const info = resultado[0];
  const prices = resultado[1];
  const usdtBrl = resultado[2];

  const ativos = [];
  let patrimonioUSDT = 0;

  for (const b of info.balances || []) {
    const free = num(b.free);
    const locked = num(b.locked);
    const total = free + locked;

    if (total <= 0) continue;

    const asset = assetNormalizado(b.asset);

    let precoUSDT = 0;
    let valorUSDT = 0;

    if (asset === "USDT") {
      precoUSDT = 1;
      valorUSDT = total;
    } else {
      precoUSDT = num(
        prices[asset + "USDT"] ||
        prices["LD" + asset + "USDT"]
      );

      if (precoUSDT > 0) {
        valorUSDT = total * precoUSDT;
      }
    }

    if (valorUSDT > 0.01) {
      patrimonioUSDT += valorUSDT;

      ativos.push({
        asset,
        free,
        locked,
        total,
        precoUSDT,
        valorUSDT,
        valorBRL: valorUSDT * usdtBrl
      });
    }
  }

  ativos.sort(function (a, b) {
    return b.valorUSDT - a.valorUSDT;
  });

  return {
    id: conta.id,
    nome: conta.nome,
    descricao: conta.descricao,
    patrimonioUSDT,
    patrimonioUSD: patrimonioUSDT,
    patrimonioBRL: patrimonioUSDT * usdtBrl,
    usdtBrl,
    totalAtivos: ativos.length,
    ativos,
    atualizadoEm: Date.now()
  };
}

/*
=========================================================
TRADES / PNL
=========================================================
*/

async function obterTrades(conta, symbol, limit = 1000) {
  try {
    return await conta.client.myTrades({
      symbol,
      limit
    });
  } catch (e) {
    return [];
  }
}

function calcularPnL(trades) {
  const fila = [];
  let realizado = 0;

  const ordenados = (trades || [])
    .slice()
    .sort(function (a, b) {
      return num(a.time) - num(b.time);
    });

  for (const t of ordenados) {
    const qty = num(t.qty);
    const price = num(t.price);

    if (qty <= 0 || price <= 0) continue;

    if (t.isBuyer) {
      fila.push({
        qty,
        price
      });
    } else {
      let restante = qty;

      while (restante > 0.0000000001 && fila.length) {
        const lote = fila[0];
        const usado = Math.min(restante, lote.qty);

        realizado += usado * (price - lote.price);

        lote.qty -= usado;
        restante -= usado;

        if (lote.qty <= 0.0000000001) {
          fila.shift();
        }
      }

      const commission = num(t.commission);

      if (
        commission > 0 &&
        String(t.commissionAsset || "").toUpperCase() === "USDT"
      ) {
        realizado -= commission;
      }
    }
  }

  return realizado;
}

/*
=========================================================
OPERAÇÃO ATUAL
=========================================================
Identifica somente os trades após a última VENDA do ativo.
Assim, a comparação THIAGO x SERGIO não mistura operações
antigas com a operação que está aberta agora.
*/
function calcularOperacaoAtual(trades) {
  const lista = (trades || []).slice().sort(function(a,b){
    return num(a.time) - num(b.time);
  });

  let ultimoSellIndex = -1;
  for (let i = 0; i < lista.length; i++) {
    if (!lista[i].isBuyer) ultimoSellIndex = i;
  }

  const atual = lista.slice(ultimoSellIndex + 1);
  const compras = atual.filter(function(t){ return !!t.isBuyer; });
  const vendas = atual.filter(function(t){ return !t.isBuyer; });

  let qtdComprada = 0;
  let custo = 0;
  let qtdVendida = 0;

  compras.forEach(function(t){
    const qty = num(t.qty);
    const quote = num(t.quoteQty) || qty * num(t.price);
    qtdComprada += qty;
    custo += quote;
  });

  vendas.forEach(function(t){
    qtdVendida += num(t.qty);
  });

  const quantidade = Math.max(0, qtdComprada - qtdVendida);
  const entrada = qtdComprada > 0 ? custo / qtdComprada : 0;
  const primeiraCompra = compras[0] || null;

  return {
    ativa: quantidade > 0 && entrada > 0,
    quantidade,
    entrada,
    entradaTime: primeiraCompra ? num(primeiraCompra.time) : 0,
    compras: compras.length,
    vendas: vendas.length,
    qtdComprada,
    qtdVendida
  };
}

/*
=========================================================
POSIÇÕES
=========================================================
*/

async function obterPosicoes(conta, dadosConta) {
  const posicoes = [];

  const ativos = (dadosConta.ativos || []).filter(function (a) {
    return a.asset !== "USDT" && a.valorUSDT >= 3;
  });

  for (const ativo of ativos) {
    const symbol = ativo.asset + "USDT";
    const trades = await obterTrades(conta, symbol, 1000);

    let ultimoTrade = null;

    for (const t of trades) {
      if (
        !ultimoTrade ||
        num(t.time) > num(ultimoTrade.time)
      ) {
        ultimoTrade = t;
      }
    }

    const operacao = calcularOperacaoAtual(trades);
    const quantidade = ativo.total;
    const quantidadeOperacao = operacao.ativa
      ? Math.min(quantidade, operacao.quantidade)
      : 0;

    const quantidadeLiquida = operacao.quantidade;
    const precoMedio = operacao.entrada;
    const precoAtual = ativo.precoUSDT;

    const valorAtual =
      quantidade * precoAtual;

    const pnlNaoRealizado =
      precoMedio > 0 && quantidadeOperacao > 0
        ? (precoAtual - precoMedio) * quantidadeOperacao
        : 0;

    const pnlPct =
      precoMedio > 0
        ? ((precoAtual / precoMedio) - 1) * 100
        : 0;

    let ordensAbertas = [];

    try {
      ordensAbertas =
        await conta.client.openOrders({
          symbol
        });
    } catch (e) {}

    const vendas = ordensAbertas
      .filter(function (o) {
        return (
          String(o.side).toUpperCase() === "SELL" &&
          num(o.price) > 0
        );
      })
      .sort(function (a, b) {
        return num(a.price) - num(b.price);
      });

    const tpOrder = vendas[0] || null;

    const slOrder =
      ordensAbertas.find(function (o) {
        return [
          "STOP",
          "STOP_LOSS",
          "STOP_LOSS_LIMIT"
        ].includes(
          String(o.type || "").toUpperCase()
        );
      }) || null;

    posicoes.push({
      symbol,
      asset: ativo.asset,
      quantidade,
      quantidadeLiquida,
      precoMedio,
      precoAtual,
      valorAtual,
      pnlNaoRealizado,
      pnlNaoRealizadoPct: pnlPct,
      pnlRealizado: calcularPnL(trades),
      operacaoAtual: {
        ativa: operacao.ativa,
        quantidade: quantidadeOperacao,
        entrada: precoMedio,
        entradaTime: operacao.entradaTime,
        compras: operacao.compras,
        vendas: operacao.vendas,
        pnlUSDT: pnlNaoRealizado,
        pnlBRL: pnlNaoRealizado * num(dadosConta.usdtBrl),
        pnlPct
      },
      tp: tpOrder
        ? {
            price: num(tpOrder.price),
            qty: num(tpOrder.origQty),
            type: tpOrder.type,
            status: tpOrder.status
          }
        : null,
      sl: slOrder
        ? {
            stopPrice: num(
              slOrder.stopPrice || slOrder.price
            ),
            price: num(slOrder.price),
            type: slOrder.type,
            status: slOrder.status
          }
        : null,
      ordensAbertas: ordensAbertas.length,
      ultimaOperacao: ultimoTrade
        ? {
            lado: ultimoTrade.isBuyer
              ? "COMPRA"
              : "VENDA",
            qty: num(ultimoTrade.qty),
            price: num(ultimoTrade.price),
            time: num(ultimoTrade.time)
          }
        : null
    });
  }

  posicoes.sort(function (a, b) {
    return b.valorAtual - a.valorAtual;
  });

  return posicoes;
}

/*
=========================================================
HISTÓRICO
=========================================================
*/

async function obterHistorico(conta, dadosConta) {
  const ativos = (dadosConta.ativos || [])
    .filter(function (a) {
      return (
        a.asset !== "USDT" &&
        a.valorUSDT > 0.01
      );
    })
    .slice(0, 20);

  const resultado = [];

  for (const ativo of ativos) {
    const symbol = ativo.asset + "USDT";
    const trades = await obterTrades(
      conta,
      symbol,
      100
    );

    for (const t of trades) {
      resultado.push({
        symbol,
        lado: t.isBuyer
          ? "COMPRA"
          : "VENDA",
        qty: num(t.qty),
        price: num(t.price),
        quoteQty: num(t.quoteQty),
        commission: num(t.commission),
        commissionAsset: t.commissionAsset,
        time: num(t.time)
      });
    }
  }

  resultado.sort(function (a, b) {
    return b.time - a.time;
  });

  return resultado.slice(0, 50);
}

/*
=========================================================
DASHBOARD INDIVIDUAL
=========================================================
*/

async function obterDashboardConta(conta) {
  const dados = await obterConta(conta);

  const [posicoes, historico] =
    await Promise.all([
      obterPosicoes(conta, dados),
      obterHistorico(conta, dados)
    ]);

  const pnlAberto = posicoes.reduce(
    function (s, p) {
      return s + num(p.pnlNaoRealizado);
    },
    0
  );

  const pnlRealizado = posicoes.reduce(
    function (s, p) {
      return s + num(p.pnlRealizado);
    },
    0
  );

  return {
    ...dados,
    posicoes,
    historico,
    pnlNaoRealizado: pnlAberto,
    pnlRealizado,
    pnlTotalEstimado:
      pnlAberto + pnlRealizado,
    ultimaCompra:
      historico.find(function (h) {
        return h.lado === "COMPRA";
      }) || null,
    ultimaVenda:
      historico.find(function (h) {
        return h.lado === "VENDA";
      }) || null,
    operacaoAtual:
      posicoes.length && posicoes[0].operacaoAtual && posicoes[0].operacaoAtual.ativa
        ? { ...posicoes[0].operacaoAtual, symbol: posicoes[0].symbol, precoAtual: posicoes[0].precoAtual, tp: posicoes[0].tp, sl: posicoes[0].sl }
        : null
  };
}

/*
=========================================================
API DASHBOARD
=========================================================
*/

app.get("/api/dashboard", async function (req, res) {
  try {
    const contas = await Promise.all(
      clientes.map(async function (conta) {
        try {
          return await obterDashboardConta(conta);
        } catch (e) {
          return {
            id: conta.id,
            nome: conta.nome,
            descricao: conta.descricao,
            erro: e.message,
            patrimonioUSDT: 0,
            patrimonioUSD: 0,
            patrimonioBRL: 0,
            usdtBrl: 0,
            totalAtivos: 0,
            ativos: [],
            posicoes: [],
            historico: [],
            pnlNaoRealizado: 0,
            pnlRealizado: 0,
            pnlTotalEstimado: 0
          };
        }
      })
    );

    res.json({
      atualizadoEm: Date.now(),
      contas
    });
  } catch (e) {
    res.status(500).json({
      erro: e.message
    });
  }
});

/*
=========================================================
API DE CONTA
=========================================================
*/

app.get("/api/account/:id", async function (req, res) {
  try {
    const conta = clientes.find(function (c) {
      return c.id === String(req.params.id);
    });

    if (!conta) {
      return res.status(404).json({
        erro: "Conta não encontrada"
      });
    }

    res.json(
      await obterDashboardConta(conta)
    );
  } catch (e) {
    res.status(500).json({
      erro: e.message
    });
  }
});

/*
=========================================================
API DO GRÁFICO
=========================================================
*/

app.get("/api/chart", async function (req, res) {
  try {
    const account =
      String(req.query.account || "1");

    const symbol =
      String(
        req.query.symbol || "BTCUSDT"
      ).toUpperCase();

    const interval =
      String(
        req.query.interval || "15m"
      );

    const conta = clientes.find(function (c) {
      return c.id === account;
    });

    if (!conta) {
      return res.status(404).json({
        erro: "Conta não encontrada"
      });
    }

    const candles =
      await conta.client.candles({
        symbol,
        interval,
        limit: 300
      });

    const trades =
      await obterTrades(
        conta,
        symbol,
        1000
      );

    const operacao = calcularOperacaoAtual(trades);

    const entry = operacao.ativa
      ? operacao.entrada
      : null;

    const entryTime = operacao.ativa
      ? Math.floor(num(operacao.entradaTime) / 1000)
      : null;

    let orders = [];

    try {
      orders =
        await conta.client.openOrders({
          symbol
        });
    } catch (e) {}

    const sell =
      orders
        .filter(function (o) {
          return (
            String(o.side).toUpperCase() ===
              "SELL" &&
            num(o.price) > 0
          );
        })
        .sort(function (a, b) {
          return num(a.price) - num(b.price);
        })[0] || null;

    const stop =
      orders.find(function (o) {
        return [
          "STOP",
          "STOP_LOSS",
          "STOP_LOSS_LIMIT"
        ].includes(
          String(o.type || "").toUpperCase()
        );
      }) || null;

    res.json({
      symbol,
      interval,
      candles: candles.map(function (c) {
        return {
          time:
            Math.floor(
              num(c.openTime) / 1000
            ),
          open: num(c.open),
          high: num(c.high),
          low: num(c.low),
          close: num(c.close)
        };
      }),
      entry,
      entryTime,
      tp: sell
        ? num(sell.price)
        : null,
      sl: stop
        ? num(
            stop.stopPrice ||
            stop.price
          )
        : null
    });
  } catch (e) {
    res.status(500).json({
      erro: e.message
    });
  }
});

app.get("/api/market", async function(req,res){
  try{
    const cliente = clientes[0].client;
    const candles = await cliente.candles({symbol:"BTCUSDT", interval:"15m", limit:100});
    const closes = candles.map(function(c){ return num(c.close); });
    const price = closes[closes.length-1] || 0;
    const period=21;
    const slice=closes.slice(-period);
    const ema = slice.length ? slice.reduce(function(a,b){return a+b;},0)/slice.length : price;
    let gains=0,losses=0;
    for(let i=Math.max(1,closes.length-15);i<closes.length;i++){
      const diff=closes[i]-closes[i-1];
      if(diff>=0) gains+=diff; else losses+=Math.abs(diff);
    }
    const avgGain=gains/14, avgLoss=losses/14;
    const rsi=avgLoss===0?100:100-(100/(1+(avgGain/avgLoss)));
    const state = price>ema && rsi<70 ? "ALTA" : (price<ema && rsi>30 ? "BAIXA" : "NEUTRO");
    res.json({price,ema,rsi,state});
  }catch(e){ res.status(500).json({erro:e.message}); }
});



/* =========================================================
   V7 - RAIO-X TÉCNICO / OPORTUNIDADES
   Informativo. Não envia ordens e não altera o robô.
========================================================= */
function calcularEMAvalores(valores, periodo){
  if(!valores.length) return 0;
  const p = Math.max(1, periodo || 21);
  const k = 2 / (p + 1);
  let ema = valores[0];
  for(let i=1;i<valores.length;i++) ema = valores[i] * k + ema * (1-k);
  return ema;
}

function calcularRSIvalores(valores, periodo){
  const p = Math.max(2, periodo || 14);
  if(valores.length <= p) return 50;
  let gain=0, loss=0;
  for(let i=valores.length-p;i<valores.length;i++){
    const d = valores[i]-valores[i-1];
    if(d>=0) gain += d; else loss += Math.abs(d);
  }
  const ag=gain/p, al=loss/p;
  return al===0 ? 100 : 100-(100/(1+(ag/al)));
}

async function obterRaioX(conta, symbol){
  const candles = await conta.client.candles({symbol, interval:"15m", limit:80});
  if(!candles || candles.length<22) throw new Error("Poucos candles para análise.");
  const closes=candles.map(function(c){return num(c.close);});
  const volumes=candles.map(function(c){return num(c.volume);});
  const price=closes[closes.length-1];
  const ema=calcularEMAvalores(closes,21);
  const rsi=calcularRSIvalores(closes,14);
  const volAtual=volumes[volumes.length-1] || 0;
  const base=volumes.slice(Math.max(0,volumes.length-21),volumes.length-1);
  const volMedia=base.length ? base.reduce(function(a,b){return a+b;},0)/base.length : volAtual;
  const volumeRatio=volMedia>0 ? volAtual/volMedia : 0;
  const distancia=ema>0 ? (price/ema-1)*100 : 0;
  const checks=[
    {nome:"RSI entre 40 e 65",ok:rsi>=40 && rsi<=65,valor:rsi.toFixed(2)},
    {nome:"Preço até 4% acima da EMA21",ok:distancia<=4,valor:(distancia>=0?"+":"")+distancia.toFixed(2)+"%"},
    {nome:"Volume mínimo 0,80x",ok:volumeRatio>=0.80,valor:volumeRatio.toFixed(2)+"x"},
    {nome:"Volume de breakout 1,30x",ok:volumeRatio>=1.30,valor:volumeRatio.toFixed(2)+"x"}
  ];
  return {symbol,price,ema,rsi,volumeRatio,distancia,checks,compatibilidade:checks.filter(function(x){return x.ok;}).length,atualizadoEm:Date.now()};
}

let v7OpportunityCache={time:0,data:[]};
async function obterOportunidades(conta){
  if(Date.now()-v7OpportunityCache.time<60000 && v7OpportunityCache.data.length) return v7OpportunityCache.data;
  let candidates=["BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","XRPUSDT","ADAUSDT","DOGEUSDT","TRXUSDT","LINKUSDT","AVAXUSDT","SUIUSDT","LTCUSDT"];
  try{
    const stats=await conta.client.dailyStats();
    const usdt=(stats||[]).filter(function(x){return /USDT$/.test(String(x.symbol||"")) && !String(x.symbol||"").includes("UP") && !String(x.symbol||"").includes("DOWN") && num(x.quoteVolume)>0;});
    usdt.sort(function(a,b){return num(b.quoteVolume)-num(a.quoteVolume);});
    const top=usdt.slice(0,12).map(function(x){return x.symbol;});
    candidates=Array.from(new Set(top.concat(candidates))).slice(0,12);
  }catch(e){}
  const result=[];
  for(const symbol of candidates){
    try{
      const x=await obterRaioX(conta,symbol);
      result.push(x);
    }catch(e){}
  }
  result.sort(function(a,b){return b.compatibilidade-a.compatibilidade || b.volumeRatio-a.volumeRatio;});
  v7OpportunityCache={time:Date.now(),data:result.slice(0,10)};
  return v7OpportunityCache.data;
}

app.get("/api/xray", async function(req,res){
  try{
    const id=String(req.query.account||"1");
    const symbol=String(req.query.symbol||"BTCUSDT").toUpperCase();
    const conta=clientes.find(function(c){return c.id===id;});
    if(!conta || !conta.client) return res.status(404).json({erro:"Conta não encontrada."});
    res.json(await obterRaioX(conta,symbol));
  }catch(e){res.status(500).json({erro:e.message});}
});

app.get("/api/opportunities", async function(req,res){
  try{
    const conta=clientes[0];
    if(!conta || !conta.client) return res.status(500).json({erro:"Conta principal indisponível."});
    res.json({atualizadoEm:Date.now(),itens:await obterOportunidades(conta)});
  }catch(e){res.status(500).json({erro:e.message});}
});


/* =========================================================
   CONTROLE MANUAL — THIAGO E SERGIO
   Sem senha por enquanto, conforme solicitado.
   Não altera o robô nem a lógica de leitura do painel.
========================================================= */

const MANUAL_SELL_FEE_RATE = Number(process.env.MANUAL_SELL_FEE_RATE || 0.001);

function contaManual(id){
  return clientes.find(function(c){ return c.id === String(id); }) || null;
}

function validarSymbolManual(symbol){
  const s = String(symbol || "").trim().toUpperCase();
  if(!/^[A-Z0-9]+USDT$/.test(s)) throw new Error("Ativo inválido. Use, por exemplo, TRXUSDT.");
  return s;
}

function decimalPlacesFromStep(step){
  const s = String(step || "");
  if(!s.includes(".")) return 0;
  return Math.max(0, s.split(".")[1].replace(/0+$/,'').length);
}

/*
  Ajuste decimal seguro para quantidades Binance.
  Evita erros de ponto flutuante como 169.83 virar
  internamente 169.82999999999998.
*/
function floorToStep(value, step){
  const v = Number(value || 0);
  const st = Number(step || 0);
  if(!Number.isFinite(v) || v <= 0) return 0;
  if(!Number.isFinite(st) || st <= 0) return v;

  const decimals = Math.max(
    decimalPlacesFromStep(step),
    8
  );

  const fator = Math.pow(10, decimals);
  const vi = Math.floor((v * fator) + 1e-8);
  const si = Math.max(1, Math.round(st * fator));
  const qi = Math.floor(vi / si) * si;

  return Number((qi / fator).toFixed(decimals));
}

function quantidadeValidaFiltro(qty, filtro){
  if(!filtro) return true;
  const q = Number(qty || 0);
  const min = Number(filtro.minQty || 0);
  const max = Number(filtro.maxQty || 0);
  const step = Number(filtro.stepSize || 0);

  if(!Number.isFinite(q) || q <= 0) return false;
  if(min > 0 && q < min - 1e-12) return false;
  if(max > 0 && q > max + 1e-12) return false;
  if(step > 0){
    const base = min > 0 ? min : 0;
    const casas = Math.max(
      decimalPlacesFromStep(filtro.stepSize),
      decimalPlacesFromStep(filtro.minQty || 0),
      8
    );
    const fator = Math.pow(10, casas);
    const qi = Math.round(q * fator);
    const bi = Math.round(base * fator);
    const si = Math.round(step * fator);
    if(si > 0 && ((qi - bi) % si) !== 0) return false;
  }
  return true;
}

function ajustarQuantidadeVenda(filtros, saldoLivre){
  const lot = filtros && filtros.LOT_SIZE ? filtros.LOT_SIZE : null;
  const marketLot = filtros && filtros.MARKET_LOT_SIZE ? filtros.MARKET_LOT_SIZE : null;

  let qty = Number(saldoLivre || 0);
  if(!Number.isFinite(qty) || qty <= 0) return 0;

  /*
    A ordem é MARKET, mas a Binance pode exigir simultaneamente
    LOT_SIZE e MARKET_LOT_SIZE. Primeiro reduzimos pelo LOT_SIZE,
    depois validamos/reduzimos pelo MARKET_LOT_SIZE.
  */
  if(lot && Number(lot.stepSize) > 0){
    qty = floorToStep(qty, lot.stepSize);
  }

  if(marketLot && Number(marketLot.stepSize) > 0){
    qty = floorToStep(qty, marketLot.stepSize);
  }

  /*
    Proteção final: se ainda não passar por algum filtro,
    recua pelo menor passo disponível até encontrar uma quantidade
    que satisfaça os filtros.
  */
  const filtrosQuantidade = [lot, marketLot].filter(Boolean);
  const passos = filtrosQuantidade
    .map(function(f){ return Number(f.stepSize || 0); })
    .filter(function(x){ return x > 0; });
  const passo = passos.length ? Math.max.apply(null, passos) : 0.00000001;

  let tentativas = 0;
  while(filtrosQuantidade.some(function(f){ return !quantidadeValidaFiltro(qty, f); }) && tentativas < 20){
    qty = floorToStep(Math.max(0, qty - passo), passo);
    tentativas++;
  }

  return qty > 0 ? qty : 0;
}

async function obterFiltroSymbolManual(id, symbol){
  const conta = contaManual(id);
  if(!conta || !conta.client) throw new Error("Conta indisponível.");
  const info = await conta.client.exchangeInfo();
  const item = (info.symbols || []).find(function(x){ return String(x.symbol).toUpperCase() === symbol; });
  if(!item) throw new Error("Ativo " + symbol + " não encontrado na Binance.");
  const filtros = {};
  (item.filters || []).forEach(function(f){ filtros[f.filterType] = f; });
  return {conta, item, filtros};
}

/*
  Calcula uma estimativa mais realista para uma venda MARKET:
  percorre os BIDs (compradores) disponíveis no livro da Binance
  até absorver toda a quantidade. Assim o painel não usa apenas
  o último preço negociado.
*/
function estimarVendaLivro(depth, quantidade){
  let restante = Number(quantidade || 0);
  let bruto = 0;
  let executada = 0;
  const bids = Array.isArray(depth && depth.bids) ? depth.bids : [];

  for(const bid of bids){
    const price = num(bid && bid[0]);
    const qty = num(bid && bid[1]);
    if(price <= 0 || qty <= 0 || restante <= 0) continue;
    const usar = Math.min(restante, qty);
    bruto += usar * price;
    executada += usar;
    restante -= usar;
  }

  const precoMedio = executada > 0 ? bruto / executada : 0;
  return {bruto, executada, restante, precoMedio};
}

app.get("/api/manual/preview", async function(req,res){
  try{
    const id = String(req.query.account || "1");
    const symbol = validarSymbolManual(req.query.symbol || "");
    const conta = contaManual(id);
    if(!conta || !conta.client) return res.status(500).json({erro:"Conta indisponível."});

    const account = await conta.client.accountInfo();
    const asset = symbol.replace(/USDT$/i, "");
    const bal = (account.balances || []).find(function(b){ return assetNormalizado(b.asset) === asset; });
    const free = bal ? num(bal.free) : 0;

    let depth = {bids:[]};
    try{ depth = await conta.client.depth({symbol, limit:100}); }catch(e){
      const prices = await conta.client.prices({symbol});
      depth = {bids:[[num(prices[symbol]), free]]};
    }

    let orders=[];
    try{ orders = await conta.client.openOrders({symbol}); }catch(e){}
    const sells = orders.filter(function(o){ return String(o.side).toUpperCase()==="SELL"; });

    const filtroData = await obterFiltroSymbolManual(id, symbol);
    const f = filtroData.filtros || {};
    const lot = f.LOT_SIZE || {};
    const marketLot = f.MARKET_LOT_SIZE || {};
    const minNotional = num((f.NOTIONAL||f.MIN_NOTIONAL||{}).minNotional);
    const qtyStep = num(lot.stepSize) || num(marketLot.stepSize) || 0;
    const qtyMin = num(lot.minQty) || num(marketLot.minQty) || 0;
    const qtyAjustada = ajustarQuantidadeVenda(f, free);
    const est = estimarVendaLivro(depth, qtyAjustada);
    const brl = await obterUSDTBRL(conta.client);
    const taxa = est.bruto * MANUAL_SELL_FEE_RATE;
    const liquido = est.bruto - taxa;

    let operacao = null;
    try{
      const trades = await obterTrades(conta, symbol, 1000);
      operacao = calcularOperacaoAtual(trades);
    }catch(e){}

    const custo = operacao && operacao.ativa ? operacao.quantidade * operacao.entrada : 0;
    const pnl = custo > 0 ? liquido - custo : 0;
    const pnlPct = custo > 0 ? pnl / custo * 100 : 0;

    res.json({
      conta:conta.nome, account:id, symbol, free, quantidadeVenda:qtyAjustada,
      precoAtual:est.precoMedio || 0, melhorBid:num(depth.bids && depth.bids[0] && depth.bids[0][0]),
      quantidadeCobertaLivro:est.executada, quantidadeSemLiquidez:est.restante,
      valorBruto:est.bruto, taxaEstimada:taxa, valorLiquido:liquido,
      custo, pnl, pnlPct,
      brutoBRL:est.bruto*brl, liquidoBRL:liquido*brl, pnlBRL:pnl*brl,
      ordensVenda:sells.map(function(o){return {orderId:o.orderId,type:o.type,status:o.status,price:num(o.price),origQty:num(o.origQty),stopPrice:num(o.stopPrice)};}),
      temVendaAtiva:sells.length>0, minNotional, qtyMin, qtyStep,
      lotSize:{minQty:num(lot.minQty),maxQty:num(lot.maxQty),stepSize:num(lot.stepSize)},
      marketLotSize:{minQty:num(marketLot.minQty),maxQty:num(marketLot.maxQty),stepSize:num(marketLot.stepSize)},
      taxaPercentualEstimada:MANUAL_SELL_FEE_RATE*100,
      usdtBrl:brl,
      atualizadoEm:Date.now()
    });
  }catch(e){ res.status(400).json({erro:e.message}); }
});

app.post("/api/manual/cancel-sell", async function(req,res){
  try{
    const id = String(req.body && req.body.account || "1");
    const symbol = validarSymbolManual(req.body && req.body.symbol);
    const conta = contaManual(id);
    if(!conta || !conta.client) return res.status(500).json({erro:"Conta indisponível."});
    const orders = await conta.client.openOrders({symbol});
    const sells = orders.filter(function(o){ return String(o.side).toUpperCase()==="SELL"; });
    if(!sells.length) return res.json({ok:true,account:id,symbol,canceladas:0,mensagem:"Nenhuma ordem de venda ativa encontrada."});
    const canceladas=[];
    for(const o of sells){
      const r=await conta.client.cancelOrder({symbol,orderId:o.orderId});
      canceladas.push({orderId:o.orderId,status:r.status||"CANCELED"});
    }
    res.json({ok:true,account:id,symbol,canceladas:canceladas.length,ordens:canceladas,mensagem:canceladas.length+" ordem(ns) de venda cancelada(s)."});
  }catch(e){ res.status(400).json({erro:e.message}); }
});

app.post("/api/manual/sell", async function(req,res){
  try{
    const id = String(req.body && req.body.account || "1");
    const symbol = validarSymbolManual(req.body && req.body.symbol);
    const conta = contaManual(id);
    if(!conta || !conta.client) return res.status(500).json({erro:"Conta indisponível."});

    /* Cancela SELLs abertas para liberar o saldo antes da venda manual. */
    try{
      const abertas=await conta.client.openOrders({symbol});
      const sells=abertas.filter(function(o){return String(o.side).toUpperCase()==="SELL";});
      for(const o of sells){ try{await conta.client.cancelOrder({symbol,orderId:o.orderId});}catch(e){} }
    }catch(e){}

    await new Promise(function(resolve){setTimeout(resolve,700);});

    const tradesAntes = await obterTrades(conta,symbol,1000);
    const operacaoAntes = calcularOperacaoAtual(tradesAntes);

    const account = await conta.client.accountInfo();
    const asset = symbol.replace(/USDT$/i, "");
    const bal = (account.balances || []).find(function(b){ return assetNormalizado(b.asset) === asset; });
    const free = bal ? num(bal.free) : 0;
    if(free <= 0) throw new Error("Não há saldo livre de " + asset + " para vender.");

    const filtroData=await obterFiltroSymbolManual(id,symbol);
    const f=filtroData.filtros||{};
    const lot=f.LOT_SIZE || {};
    const marketLot=f.MARKET_LOT_SIZE || {};
    const qty=ajustarQuantidadeVenda(f, free);
    if(qty<=0) throw new Error("Não foi possível encontrar uma quantidade válida para venda de " + symbol + " respeitando LOT_SIZE/MARKET_LOT_SIZE.");

    if(!quantidadeValidaFiltro(qty, lot)){
      throw new Error("Quantidade " + qty + " não atende ao LOT_SIZE da Binance para " + symbol + ".");
    }
    if(marketLot && Number(marketLot.stepSize)>0 && !quantidadeValidaFiltro(qty, marketLot)){
      throw new Error("Quantidade " + qty + " não atende ao MARKET_LOT_SIZE da Binance para " + symbol + ".");
    }

    const prices=await conta.client.prices({symbol});
    const refPrice=num(prices[symbol]);
    const minNotional=num((f.NOTIONAL||f.MIN_NOTIONAL||{}).minNotional);
    if(minNotional>0 && qty*refPrice<minNotional) throw new Error("Valor da venda abaixo do mínimo da Binance para " + symbol + ".");

    /*
      Envia a quantidade já normalizada. Nunca tenta vender uma fração
      maior do que o saldo livre nem uma quantidade fora dos filtros.
    */
    const ordem=await conta.client.order({symbol,side:"SELL",type:"MARKET",quantity:String(qty),newOrderRespType:"FULL"});
    const fills=ordem.fills||[];
    let execQty=num(ordem.executedQty)||qty;
    let bruto=num(ordem.cummulativeQuoteQty);
    if(!bruto && fills.length) bruto=fills.reduce(function(s,f){return s+num(f.qty)*num(f.price);},0);
    if(!bruto) bruto=execQty*refPrice;

    let taxaUSDT=0;
    fills.forEach(function(f){
      const comm=num(f.commission);
      const assetComm=String(f.commissionAsset||"").toUpperCase();
      if(assetComm==="USDT") taxaUSDT+=comm;
      else if(assetComm===asset) taxaUSDT+=comm*num(f.price);
    });
    /*
      A comissão real vem dos fills quando a Binance a informa.
      Se não vier no retorno, usamos apenas como estimativa o
      percentual configurado (padrão 0,10%).
    */
    const taxaFoiInformada = fills.some(function(f){ return num(f.commission) > 0; });
    if(taxaUSDT<=0) taxaUSDT=bruto*MANUAL_SELL_FEE_RATE;
    const liquido=bruto-taxaUSDT;
    const custoBase=operacaoAntes && operacaoAntes.ativa ? operacaoAntes.quantidade * operacaoAntes.entrada : 0;
    const pnl=custoBase>0 ? liquido-custoBase : 0;
    const pnlPct=custoBase>0 ? pnl/custoBase*100 : 0;
    const usdtBrl=await obterUSDTBRL(conta.client);

    res.json({ok:true,account:id,conta:conta.nome,symbol,orderId:ordem.orderId,status:ordem.status,quantidade:execQty,precoMedio:execQty>0?bruto/execQty:refPrice,bruto,taxaUSDT,
      taxaFoiInformadaPelaBinance:taxaFoiInformada,liquido,custo:custoBase,pnl,pnlPct,
      brutoBRL:bruto*usdtBrl,taxaBRL:taxaUSDT*usdtBrl,liquidoBRL:liquido*usdtBrl,custoBRL:custoBase*usdtBrl,pnlBRL:pnl*usdtBrl,
      mensagem:"Venda executada na conta "+conta.nome+"."});
  }catch(e){ res.status(400).json({erro:e.message}); }
});

app.get("/api/status", function (req, res) {
  res.json({
    status: "online",
    sistema: "Binance-Robo",
    painel: "premium-v7",
    contas: 2
  });
});

/*
=========================================================
INTERFACE PREMIUM
=========================================================
*/

// A página principal é servida por express.static a partir de ../publico/index.html.
// Não manter HTML embutido aqui para preservar o layout V7.

app.listen(
  PORT,
  "0.0.0.0",
  function(){
    console.log(
      "Binance-Robo Painel Premium V7.1 — Compacto rodando na porta " +
      PORT
    );
  }
);
