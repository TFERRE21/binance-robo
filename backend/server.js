const express = require("express");
const Binance = require("binance-api-node").default;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

/*
=========================================================
BINANCE-ROBO - PAINEL PREMIUM
DUAS CONTAS SEPARADAS
- Conta 1 = API_KEY_1 / API_SECRET_1
- Conta 2 = API_KEY_2 / API_SECRET_2

IMPORTANTE:
Este painel é SOMENTE LEITURA.
Ele não compra nem vende.
=========================================================
*/

const CONTAS = [
  {
    id: "1",
    nome: process.env.NOME_CONTA_1 || "SUA CONTA",
    apiKey: process.env.API_KEY_1,
    apiSecret: process.env.API_SECRET_1
  },
  {
    id: "2",
    nome: process.env.NOME_CONTA_2 || "CONTA DO AMIGO",
    apiKey: process.env.API_KEY_2,
    apiSecret: process.env.API_SECRET_2
  }
];

const clientes = CONTAS.map(function (conta) {
  return {
    id: conta.id,
    nome: conta.nome,
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
  var n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function assetNormalizado(asset) {
  return String(asset || "").replace(/^LD/, "");
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/*
=========================================================
USDT / BRL
=========================================================
*/

async function obterUSDTBRL(client) {
  try {
    var prices = await client.prices({
      symbol: "USDTBRL"
    });

    if (prices && prices.USDTBRL) {
      return num(prices.USDTBRL);
    }
  } catch (e) {}

  return num(process.env.USDTBRL_RATE) || 5.50;
}

/*
=========================================================
DADOS DA CONTA
=========================================================
*/

async function obterConta(conta) {
  if (!conta.client) {
    throw new Error(
      "Credenciais não encontradas para " + conta.nome
    );
  }

  var resultado = await Promise.all([
    conta.client.accountInfo(),
    conta.client.prices(),
    obterUSDTBRL(conta.client)
  ]);

  var info = resultado[0];
  var prices = resultado[1];
  var usdtBrl = resultado[2];

  var ativos = [];
  var patrimonioUSDT = 0;

  for (var i = 0; i < (info.balances || []).length; i++) {
    var b = info.balances[i];

    var free = num(b.free);
    var locked = num(b.locked);
    var total = free + locked;

    if (total <= 0) continue;

    var asset = assetNormalizado(b.asset);
    var precoUSDT = 0;
    var valorUSDT = 0;

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
        asset: asset,
        free: free,
        locked: locked,
        total: total,
        precoUSDT: precoUSDT,
        valorUSDT: valorUSDT,
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
    patrimonioUSDT: patrimonioUSDT,
    patrimonioUSD: patrimonioUSDT,
    patrimonioBRL: patrimonioUSDT * usdtBrl,
    usdtBrl: usdtBrl,
    totalAtivos: ativos.length,
    ativos: ativos,
    atualizadoEm: Date.now()
  };
}

/*
=========================================================
TRADES
=========================================================
*/

async function obterTrades(conta, symbol, limit) {
  try {
    return await conta.client.myTrades({
      symbol: symbol,
      limit: limit || 1000
    });
  } catch (e) {
    return [];
  }
}

/*
=========================================================
PNL REALIZADO - ESTIMATIVA POR FIFO
=========================================================
*/

function calcularPnL(trades) {
  var fila = [];
  var realizado = 0;

  var ordenados = (trades || []).slice().sort(function (a, b) {
    return num(a.time) - num(b.time);
  });

  for (var i = 0; i < ordenados.length; i++) {
    var t = ordenados[i];

    var qty = num(t.qty);
    var price = num(t.price);
    var fee = num(t.commission);
    var isBuy = Boolean(t.isBuyer);

    if (qty <= 0 || price <= 0) continue;

    if (isBuy) {
      fila.push({
        qty: qty,
        price: price
      });
    } else {
      var restante = qty;

      while (restante > 0.0000000001 && fila.length > 0) {
        var lote = fila[0];
        var usado = Math.min(restante, lote.qty);

        realizado += usado * (price - lote.price);

        lote.qty -= usado;
        restante -= usado;

        if (lote.qty <= 0.0000000001) {
          fila.shift();
        }
      }

      if (
        fee > 0 &&
        String(t.commissionAsset || "").toUpperCase() === "USDT"
      ) {
        realizado -= fee;
      }
    }
  }

  return realizado;
}

/*
=========================================================
POSIÇÕES ATIVAS
=========================================================
*/

async function obterPosicoes(conta, dadosConta) {
  var posicoes = [];

  var ativos = (dadosConta.ativos || []).filter(function (a) {
    return a.asset !== "USDT" && a.valorUSDT >= 3;
  });

  for (var i = 0; i < ativos.length; i++) {
    var ativo = ativos[i];
    var symbol = ativo.asset + "USDT";

    var trades = await obterTrades(conta, symbol, 1000);

    var comprado = 0;
    var custoCompra = 0;
    var vendido = 0;
    var ultimoTrade = null;

    for (var j = 0; j < trades.length; j++) {
      var t = trades[j];
      var qty = num(t.qty);
      var price = num(t.price);
      var quote = num(t.quoteQty) || qty * price;

      if (t.isBuyer) {
        comprado += qty;
        custoCompra += quote;
      } else {
        vendido += qty;
      }

      if (
        !ultimoTrade ||
        num(t.time) > num(ultimoTrade.time)
      ) {
        ultimoTrade = t;
      }
    }

    var quantidade = ativo.total;
    var quantidadeLiquida = Math.max(0, comprado - vendido);
    var precoMedio = comprado > 0 ? custoCompra / comprado : 0;
    var precoAtual = ativo.precoUSDT;
    var valorAtual = quantidade * precoAtual;

    var pnlAberto =
      precoMedio > 0
        ? (precoAtual - precoMedio) * quantidade
        : 0;

    var pnlPercentual =
      precoMedio > 0
        ? ((precoAtual / precoMedio) - 1) * 100
        : 0;

    var pnlRealizado = calcularPnL(trades);

    var ordensAbertas = [];

    try {
      ordensAbertas = await conta.client.openOrders({
        symbol: symbol
      });
    } catch (e) {}

    var vendas = ordensAbertas.filter(function (o) {
      return String(o.side || "").toUpperCase() === "SELL";
    });

    var tpOrder = vendas
      .filter(function (o) {
        return num(o.price) > 0;
      })
      .sort(function (a, b) {
        return num(a.price) - num(b.price);
      })[0];

    var slOrder = ordensAbertas
      .filter(function (o) {
        return [
          "STOP",
          "STOP_LOSS",
          "STOP_LOSS_LIMIT"
        ].indexOf(
          String(o.type || "").toUpperCase()
        ) >= 0;
      })[0];

    posicoes.push({
      symbol: symbol,
      asset: ativo.asset,
      quantidade: quantidade,
      quantidadeLiquida: quantidadeLiquida,
      precoMedio: precoMedio,
      precoAtual: precoAtual,
      valorAtual: valorAtual,
      pnlNaoRealizado: pnlAberto,
      pnlNaoRealizadoPct: pnlPercentual,
      pnlRealizado: pnlRealizado,
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
  var ativos = (dadosConta.ativos || [])
    .filter(function (a) {
      return a.asset !== "USDT" && a.valorUSDT > 0.01;
    })
    .slice(0, 15);

  var resultado = [];

  for (var i = 0; i < ativos.length; i++) {
    var symbol = ativos[i].asset + "USDT";
    var trades = await obterTrades(conta, symbol, 100);

    for (var j = 0; j < trades.length; j++) {
      var t = trades[j];

      resultado.push({
        symbol: symbol,
        lado: t.isBuyer ? "COMPRA" : "VENDA",
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

  return resultado.slice(0, 40);
}

/*
=========================================================
DASHBOARD DE UMA CONTA
=========================================================
*/

async function obterDashboardConta(conta) {
  var dados = await obterConta(conta);
  var posicoes = await obterPosicoes(conta, dados);
  var historico = await obterHistorico(conta, dados);

  var pnlAberto = posicoes.reduce(function (s, p) {
    return s + num(p.pnlNaoRealizado);
  }, 0);

  var pnlRealizado = posicoes.reduce(function (s, p) {
    return s + num(p.pnlRealizado);
  }, 0);

  var ultimaCompra =
    historico.find(function (h) {
      return h.lado === "COMPRA";
    }) || null;

  var ultimaVenda =
    historico.find(function (h) {
      return h.lado === "VENDA";
    }) || null;

  return {
    id: dados.id,
    nome: dados.nome,
    patrimonioUSDT: dados.patrimonioUSDT,
    patrimonioUSD: dados.patrimonioUSD,
    patrimonioBRL: dados.patrimonioBRL,
    usdtBrl: dados.usdtBrl,
    totalAtivos: dados.totalAtivos,
    ativos: dados.ativos,
    posicoes: posicoes,
    historico: historico,
    pnlNaoRealizado: pnlAberto,
    pnlRealizado: pnlRealizado,
    pnlTotalEstimado: pnlAberto + pnlRealizado,
    ultimaCompra: ultimaCompra,
    ultimaVenda: ultimaVenda,
    atualizadoEm: dados.atualizadoEm
  };
}

/*
=========================================================
API PRINCIPAL
=========================================================
*/

app.get("/api/dashboard", async function (req, res) {
  try {
    var contas = await Promise.all(
      clientes.map(async function (conta) {
        try {
          return await obterDashboardConta(conta);
        } catch (e) {
          return {
            id: conta.id,
            nome: conta.nome,
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

    var totalUSDT = contas.reduce(function (s, c) {
      return s + num(c.patrimonioUSDT);
    }, 0);

    var totalBRL = contas.reduce(function (s, c) {
      return s + num(c.patrimonioBRL);
    }, 0);

    res.json({
      atualizadoEm: Date.now(),
      totalUSDT: totalUSDT,
      totalBRL: totalBRL,
      contas: contas
    });
  } catch (e) {
    res.status(500).json({
      erro: e.message
    });
  }
});

/*
=========================================================
API DE UMA CONTA
=========================================================
*/

app.get("/api/account/:id", async function (req, res) {
  try {
    var conta = clientes.find(function (c) {
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
    var accountId = String(req.query.account || "1");
    var symbol = String(
      req.query.symbol || "BTCUSDT"
    ).toUpperCase();

    var interval = String(
      req.query.interval || "15m"
    );

    var conta = clientes.find(function (c) {
      return c.id === accountId;
    });

    if (!conta) {
      return res.status(404).json({
        erro: "Conta não encontrada"
      });
    }

    var candles = await conta.client.candles({
      symbol: symbol,
      interval: interval,
      limit: 300
    });

    var trades = await obterTrades(
      conta,
      symbol,
      1000
    );

    var buys = trades
      .filter(function (t) {
        return Boolean(t.isBuyer);
      })
      .sort(function (a, b) {
        return num(a.time) - num(b.time);
      });

    var entry = null;
    var entryTime = null;

    if (buys.length > 0) {
      var buyQty = buys.reduce(function (s, t) {
        return s + num(t.qty);
      }, 0);

      var buyCost = buys.reduce(function (s, t) {
        return (
          s +
          (num(t.quoteQty) ||
            num(t.qty) * num(t.price))
        );
      }, 0);

      if (buyQty > 0) {
        entry = buyCost / buyQty;
      }

      entryTime = Math.floor(
        num(buys[buys.length - 1].time) / 1000
      );
    }

    var orders = [];

    try {
      orders = await conta.client.openOrders({
        symbol: symbol
      });
    } catch (e) {}

    var sell = orders
      .filter(function (o) {
        return (
          String(o.side || "").toUpperCase() ===
            "SELL" &&
          num(o.price) > 0
        );
      })
      .sort(function (a, b) {
        return num(a.price) - num(b.price);
      })[0];

    var stop = orders.find(function (o) {
      return [
        "STOP",
        "STOP_LOSS",
        "STOP_LOSS_LIMIT"
      ].indexOf(
        String(o.type || "").toUpperCase()
      ) >= 0;
    });

    res.json({
      symbol: symbol,
      interval: interval,
      candles: candles.map(function (c) {
        return {
          time: Math.floor(num(c.openTime) / 1000),
          open: num(c.open),
          high: num(c.high),
          low: num(c.low),
          close: num(c.close)
        };
      }),
      entry: entry,
      entryTime: entryTime,
      tp: sell ? num(sell.price) : null,
      sl: stop
        ? num(stop.stopPrice || stop.price)
        : null
    });
  } catch (e) {
    res.status(500).json({
      erro: e.message
    });
  }
});

/*
=========================================================
STATUS
=========================================================
*/

app.get("/api/status", function (req, res) {
  res.json({
    status: "online",
    sistema: "Binance-Robo",
    painel: "premium",
    contas: clientes.length
  });
});

/*
=========================================================
INTERFACE
=========================================================
*/

app.get("/", function (req, res) {
  res.send(`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">

<title>Binance-Robo | Painel Premium</title>

<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>

<script src="https://unpkg.com/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js"></script>

<style>

:root{
  --bg:#070b14;
  --panel:#101827;
  --panel2:#0b1321;
  --line:#253249;
  --text:#f6f8fc;
  --muted:#8c99ae;
  --green:#20d890;
  --red:#ff5d73;
  --blue:#49a7ff;
  --gold:#f6bb55;
  --purple:#856bff;
}

*{
  box-sizing:border-box;
}

body{
  margin:0;
  background:
    radial-gradient(
      circle at 15% 0%,
      #18264d 0%,
      #070b14 42%
    );
  color:var(--text);
  font-family:Arial,Helvetica,sans-serif;
}

header{
  height:82px;
  padding:0 5%;
  display:flex;
  align-items:center;
  justify-content:space-between;
  background:#050811ee;
  border-bottom:1px solid #1b2536;
  position:sticky;
  top:0;
  z-index:10;
  backdrop-filter:blur(12px);
}

.brand{
  display:flex;
  align-items:center;
  gap:14px;
}

.logo{
  width:46px;
  height:46px;
  border-radius:14px;
  display:grid;
  place-items:center;
  background:linear-gradient(135deg,#ffad00,#ffd25c);
  font-size:25px;
}

.brand h1{
  margin:0;
  font-size:19px;
}

.brand small{
  color:var(--muted);
  font-size:12px;
}

.online{
  color:#26df94;
  background:#08271d;
  border:1px solid #145c43;
  border-radius:30px;
  padding:9px 15px;
  font-size:12px;
  font-weight:800;
}

main{
  max-width:1500px;
  margin:auto;
  padding:30px 5% 60px;
}

.topTitle{
  display:flex;
  justify-content:space-between;
  align-items:flex-end;
  margin-bottom:22px;
}

.topTitle h2{
  margin:0;
  font-size:34px;
}

.topTitle p{
  margin:8px 0 0;
  color:var(--muted);
}

.muted{
  color:var(--muted);
  font-size:11px;
}

.cards{
  display:grid;
  grid-template-columns:repeat(4,1fr);
  gap:16px;
}

.card{
  background:linear-gradient(145deg,#121e34,#0c1422);
  border:1px solid var(--line);
  border-radius:18px;
  padding:20px;
  box-shadow:0 14px 40px #0005;
}

.label{
  color:var(--muted);
  font-size:12px;
  margin-bottom:9px;
}

.value{
  font-size:26px;
  font-weight:900;
}

.green{
  color:var(--green)!important;
}

.red{
  color:var(--red)!important;
}

.blue{
  color:var(--blue)!important;
}

.gold{
  color:var(--gold)!important;
}

.section{
  margin-top:22px;
}

.sectionTitle{
  margin:0 0 12px;
  font-size:18px;
}

.accounts{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:18px;
}

.account{
  background:linear-gradient(145deg,#111b2d,#0b121f);
  border:1px solid var(--line);
  border-radius:20px;
  padding:22px;
}

.accountHead{
  display:flex;
  justify-content:space-between;
  align-items:center;
  margin-bottom:18px;
}

.accountHead h3{
  margin:0;
  font-size:20px;
}

.badge{
  color:#9cc6ff;
  background:#15243a;
  border-radius:20px;
  padding:6px 10px;
  font-size:11px;
}

.metrics{
  display:grid;
  grid-template-columns:repeat(3,1fr);
  gap:10px;
}

.metric{
  background:#0a111d;
  border:1px solid #1d293b;
  border-radius:13px;
  padding:13px;
}

.metric strong{
  font-size:17px;
}

.sub{
  margin-top:6px;
  color:var(--muted);
  font-size:11px;
}

.operation{
  margin-top:15px;
  padding:15px;
  border-radius:14px;
  background:#0a111d;
  border:1px solid #1d293b;
}

.opTop{
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:10px;
}

.coin{
  font-size:22px;
  font-weight:900;
}

.pill{
  padding:6px 10px;
  border-radius:20px;
  font-size:11px;
  font-weight:800;
}

.pillBuy{
  color:#31e59d;
  background:#063d2a;
}

.kv{
  display:grid;
  grid-template-columns:repeat(4,1fr);
  gap:10px;
  margin-top:14px;
}

.kvItem{
  color:var(--muted);
  font-size:11px;
}

.kvItem b{
  display:block;
  color:var(--text);
  margin-top:4px;
  font-size:13px;
}

.compare{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:18px;
}

.mini{
  background:linear-gradient(145deg,#101a2b,#0b121e);
  border:1px solid var(--line);
  border-radius:18px;
  padding:18px;
}

.mini h4{
  margin:0 0 14px;
  font-size:17px;
}

.bar{
  height:8px;
  margin-top:10px;
  border-radius:20px;
  background:#172235;
  overflow:hidden;
}

.bar i{
  display:block;
  height:100%;
  background:linear-gradient(90deg,#49a7ff,#856bff);
}

.layout{
  display:grid;
  grid-template-columns:1.6fr 1fr;
  gap:18px;
}

.chartBox{
  min-height:470px;
}

.controls{
  display:flex;
  flex-wrap:wrap;
  gap:8px;
  margin-bottom:10px;
}

.controls select,
.controls button{
  background:#111d31;
  color:#e0e8f6;
  border:1px solid #29364d;
  border-radius:9px;
  padding:8px 12px;
  cursor:pointer;
}

.controls button.active{
  background:linear-gradient(135deg,#6f55ff,#856bff);
  border-color:#856bff;
}

#chart{
  width:100%;
  height:390px;
}

.tableWrap{
  overflow:auto;
}

table{
  width:100%;
  border-collapse:collapse;
  font-size:12px;
}

th,
td{
  padding:11px 8px;
  text-align:left;
  border-bottom:1px solid #1c2738;
}

th{
  color:var(--muted);
  font-weight:600;
}

footer{
  text-align:center;
  color:var(--muted);
  font-size:11px;
  padding:20px 5% 35px;
}

@media(max-width:1050px){

  .cards{
    grid-template-columns:repeat(2,1fr);
  }

  .accounts,
  .layout{
    grid-template-columns:1fr;
  }

}

@media(max-width:650px){

  .cards{
    grid-template-columns:1fr;
  }

  .metrics{
    grid-template-columns:1fr;
  }

  .kv{
    grid-template-columns:repeat(2,1fr);
  }

  .compare{
    grid-template-columns:1fr;
  }

  .topTitle{
    display:block;
  }

  .topTitle h2{
    font-size:28px;
  }

}

</style>
</head>

<body>

<header>

  <div class="brand">

    <div class="logo">🤖</div>

    <div>
      <h1>Binance-Robo</h1>
      <small>Painel de Controle Premium</small>
    </div>

  </div>

  <div class="online">● ONLINE</div>

</header>

<main>

  <div class="topTitle">

    <div>
      <h2>Dashboard</h2>
      <p>Controle separado das duas contas Binance.</p>
    </div>

    <div id="atualizado" class="muted"></div>

  </div>


  <div class="cards">

    <div class="card">
      <div class="label">💰 Patrimônio total</div>
      <div id="totalUSDT" class="value">--</div>
      <div id="totalBRL" class="sub">--</div>
    </div>

    <div class="card">
      <div class="label">📈 Lucro / Perda estimado</div>
      <div id="totalPnL" class="value">--</div>
      <div class="sub">Realizado + posição aberta</div>
    </div>

    <div class="card">
      <div class="label">🟢 Operações ativas</div>
      <div id="totalOps" class="value">--</div>
      <div class="sub">Posições detectadas</div>
    </div>

    <div class="card">
      <div class="label">🪙 Ativos</div>
      <div id="totalAssets" class="value">--</div>
      <div class="sub">Somando as duas contas</div>
    </div>

  </div>


  <section class="section">

    <h3 class="sectionTitle">👥 Contas separadas</h3>

    <div class="accounts">

      <div id="conta1" class="account"></div>

      <div id="conta2" class="account"></div>

    </div>

  </section>


  <section class="section">

    <h3 class="sectionTitle">📊 Comparativo</h3>

    <div id="comparativo" class="compare"></div>

  </section>


  <section class="section layout">

    <div class="card chartBox">

      <h3 class="sectionTitle">📉 Gráfico da operação</h3>

      <div class="controls">

        <select id="accountSelect">
          <option value="1">SUA CONTA</option>
          <option value="2">CONTA DO AMIGO</option>
        </select>

        <select id="symbolSelect">
          <option value="BTCUSDT">BTCUSDT</option>
        </select>

        <button data-interval="15m" class="active">15m</button>
        <button data-interval="1h">1h</button>
        <button data-interval="4h">4h</button>

      </div>

      <div id="chart"></div>

      <div class="sub">
        🟢 entrada/compra
        • 🟡 Take Profit
        • 🔴 Stop Loss
      </div>

    </div>


    <div class="card">

      <h3 class="sectionTitle">🧾 Últimas operações</h3>

      <div class="tableWrap">

        <table>

          <thead>

            <tr>
              <th>Conta</th>
              <th>Par</th>
              <th>Lado</th>
              <th>Preço</th>
              <th>Data</th>
            </tr>

          </thead>

          <tbody id="historico"></tbody>

        </table>

      </div>

    </div>

  </section>


  <div class="muted" style="margin-top:16px">
    * O P/L histórico é uma estimativa baseada nos trades disponíveis na API da Binance.
    Para contabilidade completa desde o primeiro dia, seria necessário registrar as operações
    em banco de dados.
  </div>

</main>


<footer>
  Binance-Robo • Painel somente leitura • As chaves nunca são exibidas no navegador.
</footer>


<script>

var dados = null;
var chart = null;
var candleSeries = null;


function dinheiro(v){
  return Number(v || 0).toLocaleString(
    "pt-BR",
    {
      minimumFractionDigits:2,
      maximumFractionDigits:2
    }
  );
}


function percentual(v){
  return Number(v || 0).toFixed(2) + "%";
}


function classeValor(v){
  return Number(v || 0) >= 0 ? "green" : "red";
}


function dataHora(t){
  if(!t) return "--";

  return new Date(t).toLocaleString(
    "pt-BR"
  );
}


function esc(v){
  return String(v == null ? "" : v)
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#039;");
}


/*
=========================================================
HTML DE CADA CONTA
=========================================================
*/

function htmlConta(c){

  if(c.erro){

    return (
      '<div class="accountHead">' +
        '<h3>' + esc(c.nome) + '</h3>' +
        '<span class="badge">ERRO</span>' +
      '</div>' +

      '<div class="red">' +
        esc(c.erro) +
      '</div>'
    );
  }


  var pos =
    c.posicoes &&
    c.posicoes.length
      ? c.posicoes[0]
      : null;


  var pnl =
    Number(c.pnlTotalEstimado || 0);


  var html =
    '<div class="accountHead">' +

      '<h3>' +
        esc(c.nome) +
      '</h3>' +

      '<span class="badge">' +
        'CONTA ' + esc(c.id) +
      '</span>' +

    '</div>' +


    '<div class="metrics">' +

      '<div class="metric">' +

        '<div class="label">Patrimônio</div>' +

        '<strong>' +
          dinheiro(c.patrimonioUSDT) +
          ' USDT' +
        '</strong>' +

        '<div class="sub">' +
          'R$ ' +
          dinheiro(c.patrimonioBRL) +
        '</div>' +

      '</div>' +


      '<div class="metric">' +

        '<div class="label">Lucro / Perda</div>' +

        '<strong class="' +
          classeValor(pnl) +
        '">' +

          (pnl >= 0 ? "+" : "") +
          dinheiro(pnl) +
          ' USDT' +

        '</strong>' +

        '<div class="sub">' +

          'Real.: ' +
          dinheiro(c.pnlRealizado) +

          ' • Aberto: ' +
          dinheiro(c.pnlNaoRealizado) +

        '</div>' +

      '</div>' +


      '<div class="metric">' +

        '<div class="label">Ativos</div>' +

        '<strong>' +
          esc(c.totalAtivos) +
        '</strong>' +

        '<div class="sub">USDT / Cripto</div>' +

      '</div>' +

    '</div>';


  if(pos){

    html +=

      '<div class="operation">' +

        '<div class="opTop">' +

          '<div>' +

            '<div class="label">' +
              'OPERAÇÃO ATIVA DETECTADA' +
            '</div>' +

            '<div class="coin">' +
              esc(pos.symbol) +
            '</div>' +

          '</div>' +

          '<span class="pill pillBuy">' +
            '🟢 POSIÇÃO' +
          '</span>' +

        '</div>' +


        '<div class="kv">' +

          '<div class="kvItem">' +
            'Entrada' +
            '<b>' +
              dinheiro(pos.precoMedio) +
              ' USDT' +
            '</b>' +
          '</div>' +

          '<div class="kvItem">' +
            'Atual' +
            '<b>' +
              dinheiro(pos.precoAtual) +
              ' USDT' +
            '</b>' +
          '</div>' +

          '<div class="kvItem">' +
            'P/L' +
            '<b class="' +
              classeValor(pos.pnlNaoRealizado) +
            '">' +

              (pos.pnlNaoRealizado >= 0 ? "+" : "") +
              dinheiro(pos.pnlNaoRealizado) +
              ' (' +
              percentual(pos.pnlNaoRealizadoPct) +
              ')' +

            '</b>' +
          '</div>' +

          '<div class="kvItem">' +
            'Quantidade' +
            '<b>' +
              Number(pos.quantidade || 0).toFixed(8) +
            '</b>' +
          '</div>' +

        '</div>' +


        '<div class="kv">' +

          '<div class="kvItem">' +
            'Take Profit' +
            '<b>' +
              (
                pos.tp
                  ? dinheiro(pos.tp.price)
                  : "--"
              ) +
            '</b>' +
          '</div>' +

          '<div class="kvItem">' +
            'Stop Loss' +
            '<b>' +
              (
                pos.sl
                  ? dinheiro(pos.sl.stopPrice)
                  : "--"
              ) +
            '</b>' +
          '</div>' +

          '<div class="kvItem">' +
            'Ordens abertas' +
            '<b>' +
              esc(pos.ordensAbertas) +
            '</b>' +
          '</div>' +

          '<div class="kvItem">' +
            'Último trade' +
            '<b>' +
              (
                pos.ultimaOperacao
                  ? dataHora(pos.ultimaOperacao.time)
                  : "--"
              ) +
            '</b>' +
          '</div>' +

        '</div>' +

      '</div>';

  }else{

    html +=

      '<div class="operation">' +

        '<div class="label">OPERAÇÃO ATIVA</div>' +

        '<strong>' +
          'Nenhuma posição ≥ 3 USDT detectada.' +
        '</strong>' +

      '</div>';
  }


  return html;
}


/*
=========================================================
RENDER
=========================================================
*/

function render(){

  if(!dados || !dados.contas) return;


  var c1 = dados.contas[0];
  var c2 = dados.contas[1];


  document.getElementById(
    "totalUSDT"
  ).textContent =
    dinheiro(dados.totalUSDT) +
    " USDT";


  document.getElementById(
    "totalBRL"
  ).textContent =
    "R$ " +
    dinheiro(dados.totalBRL);


  var pnl =
    Number(c1.pnlTotalEstimado || 0) +
    Number(c2.pnlTotalEstimado || 0);


  var ops =
    (c1.posicoes || []).length +
    (c2.posicoes || []).length;


  var assets =
    Number(c1.totalAtivos || 0) +
    Number(c2.totalAtivos || 0);


  var pnlEl =
    document.getElementById(
      "totalPnL"
    );


  pnlEl.textContent =
    (pnl >= 0 ? "+" : "") +
    dinheiro(pnl) +
    " USDT";


  pnlEl.className =
    "value " +
    classeValor(pnl);


  document.getElementById(
    "totalOps"
  ).textContent = ops;


  document.getElementById(
    "totalAssets"
  ).textContent = assets;


  document.getElementById(
    "conta1"
  ).innerHTML =
    htmlConta(c1);


  document.getElementById(
    "conta2"
  ).innerHTML =
    htmlConta(c2);


  document.getElementById(
    "atualizado"
  ).textContent =
    "Atualizado às " +
    new Date(
      dados.atualizadoEm
    ).toLocaleTimeString(
      "pt-BR"
    );


  /*
  =======================================================
  COMPARATIVO
  =======================================================
  */

  var max =
    Math.max(
      Number(c1.patrimonioUSDT || 0),
      Number(c2.patrimonioUSDT || 0),
      1
    );


  document.getElementById(
    "comparativo"
  ).innerHTML =

    htmlComparativo(c1,max) +
    htmlComparativo(c2,max);


  /*
  =======================================================
  SÍMBOLOS
  =======================================================
  */

  var simbolos = [];

  [c1,c2].forEach(function(c){

    (c.posicoes || []).forEach(function(p){

      if(
        simbolos.indexOf(p.symbol) === -1
      ){
        simbolos.push(p.symbol);
      }

    });

  });


  var select =
    document.getElementById(
      "symbolSelect"
    );


  var atual =
    select.value;


  if(simbolos.length){

    select.innerHTML =
      simbolos.map(function(s){

        return (
          '<option value="' +
          esc(s) +
          '">' +
          esc(s) +
          '</option>'
        );

      }).join("");

    if(
      simbolos.indexOf(atual) >= 0
    ){
      select.value = atual;
    }

  }else{

    select.innerHTML =
      '<option value="BTCUSDT">BTCUSDT</option>';

  }


  /*
  =======================================================
  HISTÓRICO
  =======================================================
  */

  var historico = [];

  [c1,c2].forEach(function(c){

    (c.historico || []).forEach(function(h){

      historico.push({
        conta:c.nome,
        symbol:h.symbol,
        lado:h.lado,
        price:h.price,
        time:h.time
      });

    });

  });


  historico.sort(function(a,b){
    return b.time - a.time;
  });


  historico =
    historico.slice(0,25);


  var tbody =
    document.getElementById(
      "historico"
    );


  if(!historico.length){

    tbody.innerHTML =
      '<tr>' +
        '<td colspan="5">' +
          'Nenhuma operação recente encontrada.' +
        '</td>' +
      '</tr>';

  }else{

    tbody.innerHTML =
      historico.map(function(h){

        var ladoClass =
          h.lado === "COMPRA"
            ? "green"
            : "red";

        return (
          '<tr>' +

            '<td>' +
              esc(h.conta) +
            '</td>' +

            '<td>' +
              '<b>' +
                esc(h.symbol) +
              '</b>' +
            '</td>' +

            '<td class="' +
              ladoClass +
            '">' +
              esc(h.lado) +
            '</td>' +

            '<td>' +
              dinheiro(h.price) +
            '</td>' +

            '<td>' +
              dataHora(h.time) +
            '</td>' +

          '</tr>'
        );

      }).join("");

  }

}


function htmlComparativo(c,max){

  var patrimonio =
    Number(c.patrimonioUSDT || 0);

  var largura =
    Math.min(
      100,
      (patrimonio / max) * 100
    );


  return (

    '<div class="mini">' +

      '<h4>' +
        esc(c.nome) +
      '</h4>' +

      '<div class="muted">' +
        'Patrimônio' +
      '</div>' +

      '<strong>' +
        dinheiro(patrimonio) +
        ' USDT' +
      '</strong>' +

      '<div class="bar">' +

        '<i style="width:' +
          largura +
        '%"></i>' +

      '</div>' +

      '<div class="sub">' +

        'P/L: ' +

        '<span class="' +
          classeValor(c.pnlTotalEstimado) +
        '">' +

          (c.pnlTotalEstimado >= 0 ? "+" : "") +
          dinheiro(c.pnlTotalEstimado) +
          ' USDT' +

        '</span>' +

      '</div>' +

    '</div>'

  );
}


/*
=========================================================
CARREGAR
=========================================================
*/

async function carregar(){

  try{

    var resposta =
      await fetch(
        "/api/dashboard",
        {
          cache:"no-store"
        }
      );


    if(!resposta.ok){
      throw new Error(
        "HTTP " + resposta.status
      );
    }


    dados =
      await resposta.json();


    render();


    carregarGrafico();

  }catch(e){

    document.getElementById(
      "atualizado"
    ).textContent =
      "Erro ao atualizar painel";

    console.error(e);

  }

}


/*
=========================================================
GRÁFICO
=========================================================
*/

async function carregarGrafico(){

  var account =
    document.getElementById(
      "accountSelect"
    ).value;


  var symbol =
    document.getElementById(
      "symbolSelect"
    ).value ||
    "BTCUSDT";


  var botao =
    document.querySelector(
      ".controls button.active"
    );


  var interval =
    botao
      ? botao.getAttribute("data-interval")
      : "15m";


  try{

    var url =
      "/api/chart?account=" +
      encodeURIComponent(account) +
      "&symbol=" +
      encodeURIComponent(symbol) +
      "&interval=" +
      encodeURIComponent(interval);


    var resposta =
      await fetch(url);


    var d =
      await resposta.json();


    desenharGrafico(d);

  }catch(e){

    console.error(e);

  }

}


function desenharGrafico(d){

  var el =
    document.getElementById(
      "chart"
    );


  el.innerHTML = "";


  if(
    typeof LightweightCharts ===
    "undefined"
  ){

    el.innerHTML =
      '<div class="red">' +
      'Biblioteca do gráfico não carregou.' +
      '</div>';

    return;
  }


  chart =
    LightweightCharts.createChart(
      el,
      {
        width:el.clientWidth,
        height:390,

        layout:{
          background:{
            color:"#0d1421"
          },
          textColor:"#8794aa"
        },

        grid:{
          vertLines:{
            color:"#172235"
          },

          horzLines:{
            color:"#172235"
          }
        },

        rightPriceScale:{
          borderColor:"#26344a"
        },

        timeScale:{
          borderColor:"#26344a",
          timeVisible:true
        }
      }
    );


  candleSeries =
    chart.addCandlestickSeries(
      {
        upColor:"#20d890",
        downColor:"#ff5d73",
        borderVisible:false,
        wickUpColor:"#20d890",
        wickDownColor:"#ff5d73"
      }
    );


  candleSeries.setData(
    d.candles || []
  );


  if(d.entry){

    candleSeries.createPriceLine({
      price:d.entry,
      color:"#20d890",
      lineWidth:2,
      lineStyle:2,
      axisLabelVisible:true,
      title:"COMPRA"
    });

  }


  if(d.tp){

    candleSeries.createPriceLine({
      price:d.tp,
      color:"#f6bb55",
      lineWidth:2,
      lineStyle:2,
      axisLabelVisible:true,
      title:"TP"
    });

  }


  if(d.sl){

    candleSeries.createPriceLine({
      price:d.sl,
      color:"#ff5d73",
      lineWidth:2,
      lineStyle:2,
      axisLabelVisible:true,
      title:"SL"
    });

  }


  if(
    d.entry &&
    d.entryTime &&
    d.candles &&
    d.candles.length
  ){

    var alvo =
      Number(d.entryTime);


    var candle =
      d.candles.reduce(
        function(prev,cur){

          return Math.abs(
            cur.time - alvo
          ) <
          Math.abs(
            prev.time - alvo
          )
            ? cur
            : prev;

        }
      );


    candleSeries.setMarkers([
      {
        time:candle.time,
        position:"belowBar",
        color:"#20d890",
        shape:"arrowUp",
        text:"ENTRADA"
      }
    ]);

  }


  chart
    .timeScale()
    .fitContent();

}


/*
=========================================================
EVENTOS
=========================================================
*/

document
  .getElementById("accountSelect")
  .addEventListener(
    "change",
    carregarGrafico
  );


document
  .getElementById("symbolSelect")
  .addEventListener(
    "change",
    carregarGrafico
  );


document
  .querySelectorAll(
    ".controls button"
  )
  .forEach(function(button){

    button.addEventListener(
      "click",
      function(){

        document
          .querySelectorAll(
            ".controls button"
          )
          .forEach(function(b){
            b.classList.remove(
              "active"
            );
          });


        button.classList.add(
          "active"
        );


        carregarGrafico();

      }
    );

  });


window.addEventListener(
  "resize",
  function(){

    if(chart){

      chart.applyOptions({
        width:
          document.getElementById(
            "chart"
          ).clientWidth
      });

    }

  }
);


/*
=========================================================
INÍCIO
=========================================================
*/

carregar();


/*
Atualização automática:
15 segundos
*/

setInterval(
  carregar,
  15000
);

</script>

</body>
</html>
  `);
});


/*
=========================================================
SERVIDOR
=========================================================
*/

app.listen(
  PORT,
  "0.0.0.0",
  function(){
    console.log(
      "Painel premium rodando na porta " +
      PORT
    );
  }
);
