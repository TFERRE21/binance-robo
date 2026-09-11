const express = require("express");
const Binance = require("binance-api-node").default;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

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

O painel é SOMENTE LEITURA.
NÃO compra, NÃO vende e NÃO altera ordens.
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

    let comprado = 0;
    let custoCompra = 0;
    let vendido = 0;
    let ultimoTrade = null;

    for (const t of trades) {
      const qty = num(t.qty);
      const price = num(t.price);
      const quote =
        num(t.quoteQty) ||
        qty * price;

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

    const quantidade = ativo.total;
    const quantidadeLiquida = Math.max(
      0,
      comprado - vendido
    );

    const precoMedio =
      comprado > 0
        ? custoCompra / comprado
        : 0;

    const precoAtual = ativo.precoUSDT;

    const valorAtual =
      quantidade * precoAtual;

    const pnlNaoRealizado =
      precoMedio > 0
        ? (precoAtual - precoMedio) * quantidade
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
      }) || null
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

    const buys =
      trades
        .filter(function (t) {
          return Boolean(t.isBuyer);
        })
        .sort(function (a, b) {
          return num(a.time) - num(b.time);
        });

    let entry = null;
    let entryTime = null;

    if (buys.length) {
      const qty = buys.reduce(
        function (s, t) {
          return s + num(t.qty);
        },
        0
      );

      const cost = buys.reduce(
        function (s, t) {
          return (
            s +
            (
              num(t.quoteQty) ||
              num(t.qty) * num(t.price)
            )
          );
        },
        0
      );

      if (qty > 0) {
        entry = cost / qty;
      }

      entryTime =
        Math.floor(
          num(
            buys[buys.length - 1].time
          ) / 1000
        );
    }

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

app.get("/api/status", function (req, res) {
  res.json({
    status: "online",
    sistema: "Binance-Robo",
    painel: "premium-v2",
    contas: 2
  });
});

/*
=========================================================
INTERFACE PREMIUM
=========================================================
*/

app.get("/", function (req, res) {
  res.send(`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Binance-Robo | Central de Operações</title>

<script src="https://unpkg.com/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js"></script>

<style>
:root{
  --bg:#050812;
  --bg2:#09101d;
  --panel:#0d1626;
  --panel2:#111c2e;
  --line:#21304a;
  --text:#f7f9fd;
  --muted:#8290a8;
  --blue:#4aa8ff;
  --green:#20df96;
  --red:#ff6177;
  --yellow:#ffc85a;
  --purple:#8368ff;
}

*{
  box-sizing:border-box;
}

body{
  margin:0;
  color:var(--text);
  background:
    radial-gradient(circle at 20% 0%,#17284c 0%,transparent 34%),
    radial-gradient(circle at 100% 20%,#111b37 0%,transparent 28%),
    var(--bg);
  font-family:Inter,Arial,sans-serif;
}

button,
select{
  font:inherit;
}

.header{
  height:78px;
  border-bottom:1px solid #1a2639;
  background:#04070eee;
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:0 42px;
  position:sticky;
  top:0;
  z-index:20;
  backdrop-filter:blur(15px);
}

.brand{
  display:flex;
  align-items:center;
  gap:13px;
}

.logo{
  width:43px;
  height:43px;
  display:grid;
  place-items:center;
  border-radius:13px;
  background:linear-gradient(135deg,#ffae00,#ffd55b);
  font-size:23px;
  box-shadow:0 8px 25px #0007;
}

.brandTitle{
  font-size:17px;
  font-weight:900;
}

.brandSub{
  color:var(--muted);
  font-size:10px;
  margin-top:2px;
}

.status{
  display:flex;
  align-items:center;
  gap:7px;
  padding:9px 13px;
  border:1px solid #17573f;
  background:#082319;
  border-radius:999px;
  color:var(--green);
  font-size:11px;
  font-weight:800;
}

.statusDot{
  width:7px;
  height:7px;
  border-radius:50%;
  background:var(--green);
  box-shadow:0 0 12px var(--green);
}

.container{
  max-width:1450px;
  margin:auto;
  padding:30px 38px 55px;
}

.hero{
  display:flex;
  justify-content:space-between;
  align-items:end;
  gap:20px;
  margin-bottom:22px;
}

.hero h1{
  margin:0;
  font-size:34px;
}

.hero p{
  margin:7px 0 0;
  color:var(--muted);
  font-size:13px;
}

.update{
  color:var(--muted);
  font-size:10px;
}

.accountTabs{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:14px;
  margin-bottom:22px;
}

.accountTab{
  position:relative;
  cursor:pointer;
  text-align:left;
  border:1px solid var(--line);
  border-radius:17px;
  padding:17px 20px;
  background:linear-gradient(145deg,#0f192a,#0a111e);
  color:var(--text);
  transition:.2s;
}

.accountTab:hover{
  transform:translateY(-1px);
  border-color:#405577;
}

.accountTab.active{
  border-color:#5d73ff;
  background:
    linear-gradient(145deg,#152347,#0b1425);
  box-shadow:0 0 0 1px #5d73ff33,0 12px 35px #0007;
}

.accountTab.active:after{
  content:"";
  position:absolute;
  left:20px;
  right:20px;
  bottom:-1px;
  height:3px;
  background:linear-gradient(90deg,var(--blue),var(--purple));
  border-radius:10px 10px 0 0;
}

.tabTop{
  display:flex;
  justify-content:space-between;
  align-items:center;
}

.tabName{
  font-size:20px;
  font-weight:900;
}

.tabBadge{
  padding:5px 9px;
  border-radius:8px;
  background:#15253d;
  color:#9bc7ff;
  font-size:9px;
  font-weight:800;
}

.tabValues{
  display:grid;
  grid-template-columns:1fr 1fr 1fr;
  gap:12px;
  margin-top:12px;
}

.tabMetric span{
  display:block;
  color:var(--muted);
  font-size:9px;
  margin-bottom:4px;
}

.tabMetric b{
  font-size:13px;
}

.cards{
  display:grid;
  grid-template-columns:repeat(4,1fr);
  gap:14px;
}

.card{
  border:1px solid var(--line);
  border-radius:17px;
  background:
    linear-gradient(145deg,#101b2d,#0a111e);
  box-shadow:0 14px 35px #0005;
}

.metricCard{
  padding:18px;
}

.metricLabel{
  color:var(--muted);
  font-size:10px;
  margin-bottom:8px;
}

.metricValue{
  font-size:24px;
  font-weight:900;
}

.metricSub{
  margin-top:6px;
  color:var(--muted);
  font-size:9px;
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

.yellow{
  color:var(--yellow)!important;
}

.section{
  margin-top:20px;
}

.sectionHead{
  display:flex;
  justify-content:space-between;
  align-items:center;
  margin-bottom:11px;
}

.sectionTitle{
  margin:0;
  font-size:16px;
}

.sectionDesc{
  color:var(--muted);
  font-size:9px;
}

.mainGrid{
  display:grid;
  grid-template-columns:1.55fr .75fr;
  gap:17px;
}

.positionCard{
  padding:20px;
}

.positionHeader{
  display:flex;
  justify-content:space-between;
  align-items:flex-start;
}

.positionLabel{
  color:var(--muted);
  font-size:9px;
  margin-bottom:5px;
}

.coin{
  font-size:27px;
  font-weight:900;
}

.positionStatus{
  padding:7px 11px;
  border-radius:999px;
  background:#063a29;
  color:var(--green);
  font-size:9px;
  font-weight:900;
}

.positionGrid{
  display:grid;
  grid-template-columns:repeat(5,1fr);
  gap:9px;
  margin-top:17px;
}

.info{
  padding:12px;
  border:1px solid #1c2940;
  border-radius:11px;
  background:#09111e;
}

.info span{
  color:var(--muted);
  display:block;
  font-size:9px;
  margin-bottom:5px;
}

.info b{
  font-size:12px;
}

.empty{
  min-height:150px;
  display:grid;
  place-items:center;
  color:var(--muted);
  font-size:12px;
  text-align:center;
}

.assetsCard{
  padding:20px;
}

.assetRow{
  display:grid;
  grid-template-columns:1fr auto;
  gap:10px;
  padding:11px 0;
  border-bottom:1px solid #192438;
}

.assetRow:last-child{
  border-bottom:0;
}

.assetName{
  font-weight:800;
  font-size:12px;
}

.assetAmount{
  color:var(--muted);
  font-size:9px;
  margin-top:3px;
}

.assetValue{
  text-align:right;
  font-weight:800;
  font-size:11px;
}

.chartCard{
  padding:0;
  overflow:hidden;
}

.chartHeader{
  padding:16px 18px;
  border-bottom:1px solid #1b273a;
}

.chartControls{
  display:flex;
  gap:7px;
  flex-wrap:wrap;
  margin-top:11px;
}

.chartControls select,
.chartControls button{
  border:1px solid #293951;
  background:#0b1524;
  color:#dce7f8;
  padding:7px 10px;
  border-radius:8px;
  font-size:10px;
  cursor:pointer;
}

.chartControls button.active{
  background:linear-gradient(135deg,#654eff,#806aff);
  border-color:#8368ff;
}

#chart{
  height:410px;
  width:100%;
}

.chartLegend{
  padding:9px 18px 13px;
  color:var(--muted);
  font-size:9px;
}

.historyCard{
  padding:0;
  overflow:hidden;
}

.historyHead{
  padding:16px 18px;
  border-bottom:1px solid #1b273a;
}

.history{
  max-height:460px;
  overflow:auto;
}

.historyRow{
  display:grid;
  grid-template-columns:1fr .8fr .7fr 1fr;
  gap:7px;
  padding:11px 18px;
  border-bottom:1px solid #182337;
  font-size:10px;
}

.historyRow span:nth-child(2){
  color:#9eabc0;
}

.buy{
  color:var(--green);
  font-weight:800;
}

.sell{
  color:var(--red);
  font-weight:800;
}

.pnlBox{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:14px;
}

.pnlPanel{
  padding:19px;
}

.pnlNumber{
  font-size:25px;
  font-weight:900;
  margin-top:6px;
}

.note{
  margin-top:14px;
  color:#64728a;
  font-size:9px;
  line-height:1.5;
}

.footer{
  text-align:center;
  color:#59677d;
  font-size:9px;
  padding-top:28px;
}

@media(max-width:1000px){
  .cards{
    grid-template-columns:repeat(2,1fr);
  }

  .mainGrid{
    grid-template-columns:1fr;
  }

  .positionGrid{
    grid-template-columns:repeat(3,1fr);
  }
}

@media(max-width:650px){
  .header{
    padding:0 15px;
  }

  .container{
    padding:20px 14px 40px;
  }

  .hero{
    display:block;
  }

  .update{
    margin-top:10px;
  }

  .accountTabs{
    grid-template-columns:1fr;
  }

  .cards{
    grid-template-columns:1fr;
  }

  .tabValues{
    grid-template-columns:1fr 1fr;
  }

  .positionGrid{
    grid-template-columns:1fr 1fr;
  }

  .pnlBox{
    grid-template-columns:1fr;
  }
}
</style>
</head>

<body>

<header class="header">
  <div class="brand">
    <div class="logo">🤖</div>
    <div>
      <div class="brandTitle">Binance-Robo</div>
      <div class="brandSub">Central de Controle Premium</div>
    </div>
  </div>

  <div class="status">
    <span class="statusDot"></span>
    ONLINE
  </div>
</header>

<div class="container">

  <div class="hero">
    <div>
      <h1 id="pageTitle">THIAGO</h1>
      <p id="pageSubtitle">Painel individual da sua conta Binance.</p>
    </div>

    <div id="updated" class="update">
      Atualizando...
    </div>
  </div>

  <!-- BOTÕES DAS DUAS CONTAS -->
  <div class="accountTabs">

    <button id="tab1" class="accountTab active" onclick="selecionarConta('1')">
      <div class="tabTop">
        <div class="tabName">👤 THIAGO</div>
        <div class="tabBadge">CONTA 1</div>
      </div>

      <div class="tabValues">
        <div class="tabMetric">
          <span>PATRIMÔNIO</span>
          <b id="tabPat1">--</b>
        </div>

        <div class="tabMetric">
          <span>P/L</span>
          <b id="tabPnl1">--</b>
        </div>

        <div class="tabMetric">
          <span>OPERAÇÕES</span>
          <b id="tabOps1">--</b>
        </div>
      </div>
    </button>


    <button id="tab2" class="accountTab" onclick="selecionarConta('2')">
      <div class="tabTop">
        <div class="tabName">👤 SERGIO</div>
        <div class="tabBadge">CONTA 2</div>
      </div>

      <div class="tabValues">
        <div class="tabMetric">
          <span>PATRIMÔNIO</span>
          <b id="tabPat2">--</b>
        </div>

        <div class="tabMetric">
          <span>P/L</span>
          <b id="tabPnl2">--</b>
        </div>

        <div class="tabMetric">
          <span>OPERAÇÕES</span>
          <b id="tabOps2">--</b>
        </div>
      </div>
    </button>

  </div>


  <!-- CARDS DA CONTA SELECIONADA -->
  <div class="cards">

    <div class="card metricCard">
      <div class="metricLabel">💰 PATRIMÔNIO</div>
      <div id="patrimonio" class="metricValue">--</div>
      <div id="patrimonioBRL" class="metricSub">--</div>
    </div>

    <div class="card metricCard">
      <div class="metricLabel">📈 LUCRO / PERDA</div>
      <div id="pnl" class="metricValue">--</div>
      <div id="pnlDetalhe" class="metricSub">--</div>
    </div>

    <div class="card metricCard">
      <div class="metricLabel">🟢 OPERAÇÕES ATIVAS</div>
      <div id="operacoes" class="metricValue">--</div>
      <div class="metricSub">Posições detectadas</div>
    </div>

    <div class="card metricCard">
      <div class="metricLabel">🪙 ATIVOS</div>
      <div id="ativos" class="metricValue">--</div>
      <div class="metricSub">Ativos com valor</div>
    </div>

  </div>


  <!-- POSIÇÃO + ATIVOS -->
  <section class="section">

    <div class="sectionHead">
      <div>
        <h2 class="sectionTitle">🎯 Operação da conta</h2>
        <div class="sectionDesc">
          Informações da conta selecionada
        </div>
      </div>
    </div>

    <div class="mainGrid">

      <div id="position" class="card positionCard"></div>

      <div class="card assetsCard">
        <h3 class="sectionTitle">🪙 Carteira</h3>
        <div class="sectionDesc" style="margin-top:4px">
          Maiores ativos por valor
        </div>
        <div id="assets" style="margin-top:10px"></div>
      </div>

    </div>

  </section>


  <!-- GRÁFICO + HISTÓRICO -->
  <section class="section">

    <div class="sectionHead">
      <div>
        <h2 class="sectionTitle">📊 Mercado e histórico</h2>
        <div class="sectionDesc">
          Gráfico individual da conta selecionada
        </div>
      </div>
    </div>

    <div class="mainGrid">

      <div class="card chartCard">

        <div class="chartHeader">

          <div style="font-weight:900;font-size:14px">
            Gráfico da operação
          </div>

          <div class="chartControls">

            <select id="symbolSelect">
              <option value="BTCUSDT">BTCUSDT</option>
            </select>

            <button class="interval active" data-i="15m">
              15m
            </button>

            <button class="interval" data-i="1h">
              1h
            </button>

            <button class="interval" data-i="4h">
              4h
            </button>

          </div>

        </div>

        <div id="chart"></div>

        <div class="chartLegend">
          🟢 Entrada/compra &nbsp;&nbsp;
          🟡 Take Profit &nbsp;&nbsp;
          🔴 Stop Loss
        </div>

      </div>


      <div class="card historyCard">

        <div class="historyHead">
          <div style="font-weight:900;font-size:14px">
            🧾 Últimas operações
          </div>

          <div class="sectionDesc" style="margin-top:4px">
            Somente da conta selecionada
          </div>
        </div>

        <div id="history" class="history"></div>

      </div>

    </div>

  </section>


  <!-- PNL DETALHADO -->
  <section class="section">

    <div class="pnlBox">

      <div class="card pnlPanel">
        <div class="metricLabel">
          💵 P/L REALIZADO
        </div>

        <div id="pnlRealizado" class="pnlNumber">
          --
        </div>

        <div class="metricSub">
          Resultado estimado de operações já encerradas.
        </div>
      </div>


      <div class="card pnlPanel">
        <div class="metricLabel">
          📊 P/L EM ABERTO
        </div>

        <div id="pnlAberto" class="pnlNumber">
          --
        </div>

        <div class="metricSub">
          Resultado estimado das posições atuais.
        </div>
      </div>

    </div>

  </section>


  <div class="note">
    O P/L histórico é uma estimativa baseada nos trades disponíveis na API da Binance.
    O painel é somente leitura e não envia ordens para a Binance.
  </div>

  <div class="footer">
    Binance-Robo • THIAGO / SERGIO • Painel individual • Atualização automática
  </div>

</div>


<script>

let dados = null;
let contaSelecionada = "1";
let chart = null;
let candleSeries = null;
let intervaloSelecionado = "15m";


function dinheiro(v){
  return Number(v || 0).toLocaleString(
    "pt-BR",
    {
      minimumFractionDigits:2,
      maximumFractionDigits:2
    }
  );
}


function numero(v){
  return Number(v || 0).toLocaleString(
    "pt-BR",
    {
      minimumFractionDigits:2,
      maximumFractionDigits:8
    }
  );
}


function classe(v){
  return Number(v || 0) >= 0
    ? "green"
    : "red";
}


function dataHora(t){
  if(!t) return "--";

  return new Date(t).toLocaleString(
    "pt-BR"
  );
}


function selecionarConta(id){

  contaSelecionada = String(id);

  document
    .getElementById("tab1")
    .classList.toggle(
      "active",
      contaSelecionada === "1"
    );

  document
    .getElementById("tab2")
    .classList.toggle(
      "active",
      contaSelecionada === "2"
    );

  renderConta();

  carregarGrafico();
}


function preencherTabs(){

  if(!dados || !dados.contas) return;

  dados.contas.forEach(function(c){

    const pat =
      document.getElementById(
        "tabPat" + c.id
      );

    const pnl =
      document.getElementById(
        "tabPnl" + c.id
      );

    const ops =
      document.getElementById(
        "tabOps" + c.id
      );

    if(!pat) return;

    pat.textContent =
      dinheiro(c.patrimonioUSDT) +
      " USDT";

    pnl.textContent =
      (Number(c.pnlTotalEstimado || 0) >= 0
        ? "+"
        : "") +
      dinheiro(c.pnlTotalEstimado) +
      " USDT";

    pnl.className =
      classe(c.pnlTotalEstimado);

    ops.textContent =
      (c.posicoes || []).length;
  });
}


function renderConta(){

  if(!dados) return;

  const c =
    dados.contas.find(function(x){
      return x.id === contaSelecionada;
    });

  if(!c) return;


  document.getElementById(
    "pageTitle"
  ).textContent =
    c.nome;


  document.getElementById(
    "pageSubtitle"
  ).textContent =
    c.nome === "THIAGO"
      ? "Painel individual da sua conta Binance."
      : "Painel individual da conta de Sergio.";


  document.getElementById(
    "patrimonio"
  ).textContent =
    dinheiro(c.patrimonioUSDT) +
    " USDT";


  document.getElementById(
    "patrimonioBRL"
  ).textContent =
    "R$ " +
    dinheiro(c.patrimonioBRL) +
    " • USDT/BRL " +
    dinheiro(c.usdtBrl);


  const pnl =
    Number(c.pnlTotalEstimado || 0);


  const pnlEl =
    document.getElementById("pnl");


  pnlEl.textContent =
    (pnl >= 0 ? "+" : "") +
    dinheiro(pnl) +
    " USDT";


  pnlEl.className =
    "metricValue " +
    classe(pnl);


  document.getElementById(
    "pnlDetalhe"
  ).textContent =
    "Realizado: " +
    dinheiro(c.pnlRealizado) +
    " • Aberto: " +
    dinheiro(c.pnlNaoRealizado);


  document.getElementById(
    "operacoes"
  ).textContent =
    (c.posicoes || []).length;


  document.getElementById(
    "ativos"
  ).textContent =
    c.totalAtivos;


  renderPosicao(c);

  renderAtivos(c);

  renderHistorico(c);
}


function renderPosicao(c){

  const el =
    document.getElementById(
      "position"
    );

  const pos =
    (c.posicoes || [])[0];


  if(!pos){

    el.innerHTML =
      '<div class="empty">' +
        '<div>' +
          '<div style="font-size:25px">💤</div>' +
          '<div style="margin-top:8px">' +
            'Nenhuma posição ativa detectada.' +
          '</div>' +
        '</div>' +
      '</div>';

    return;
  }


  const pnl =
    Number(pos.pnlNaoRealizado || 0);


  el.innerHTML =

    '<div class="positionHeader">' +

      '<div>' +

        '<div class="positionLabel">' +
          'OPERAÇÃO ATIVA DETECTADA' +
        '</div>' +

        '<div class="coin">' +
          pos.symbol +
        '</div>' +

      '</div>' +

      '<div class="positionStatus">' +
        '● POSIÇÃO ATIVA' +
      '</div>' +

    '</div>' +


    '<div class="positionGrid">' +

      info("Entrada",
        dinheiro(pos.precoMedio) + " USDT") +

      info("Preço atual",
        dinheiro(pos.precoAtual) + " USDT") +

      info("P/L",
        '<span class="' +
        classe(pnl) +
        '">' +
        (pnl >= 0 ? "+" : "") +
        dinheiro(pnl) +
        ' (' +
        Number(
          pos.pnlNaoRealizadoPct || 0
        ).toFixed(2) +
        '%)' +
        '</span>') +

      info("Quantidade",
        numero(pos.quantidade)) +

      info("Valor",
        dinheiro(pos.valorAtual) + " USDT") +

    '</div>' +


    '<div class="positionGrid">' +

      info("Take Profit",
        pos.tp
          ? dinheiro(pos.tp.price)
          : "--") +

      info("Stop Loss",
        pos.sl
          ? dinheiro(pos.sl.stopPrice)
          : "--") +

      info("Ordens abertas",
        String(pos.ordensAbertas)) +

      info("Último trade",
        pos.ultimaOperacao
          ? (
              pos.ultimaOperacao.lado +
              " • " +
              dataHora(
                pos.ultimaOperacao.time
              )
            )
          : "--") +

      info("Realizado",
        dinheiro(pos.pnlRealizado) +
        " USDT") +

    '</div>';
}


function info(titulo, valor){

  return (
    '<div class="info">' +
      '<span>' +
        titulo +
      '</span>' +
      '<b>' +
        valor +
      '</b>' +
    '</div>'
  );
}


function renderAtivos(c){

  const el =
    document.getElementById(
      "assets"
    );

  const ativos =
    (c.ativos || []).slice(0,8);


  if(!ativos.length){

    el.innerHTML =
      '<div class="empty">' +
        'Nenhum ativo com valor encontrado.' +
      '</div>';

    return;
  }


  el.innerHTML =
    ativos.map(function(a){

      return (
        '<div class="assetRow">' +

          '<div>' +
            '<div class="assetName">' +
              a.asset +
            '</div>' +

            '<div class="assetAmount">' +
              numero(a.total) +
            '</div>' +
          '</div>' +

          '<div class="assetValue">' +
            dinheiro(a.valorUSDT) +
            ' USDT' +
            '<div class="assetAmount">' +
              'R$ ' +
              dinheiro(a.valorBRL) +
            '</div>' +
          '</div>' +

        '</div>'
      );

    }).join("");
}


function renderHistorico(c){

  const el =
    document.getElementById(
      "history"
    );

  const lista =
    (c.historico || [])
      .slice(0,35);


  if(!lista.length){

    el.innerHTML =
      '<div class="empty">' +
        'Nenhuma operação encontrada.' +
      '</div>';

    return;
  }


  el.innerHTML =
    lista.map(function(h){

      return (
        '<div class="historyRow">' +

          '<span>' +
            h.symbol +
          '</span>' +

          '<span>' +
            numero(h.qty) +
          '</span>' +

          '<span class="' +
            (
              h.lado === "COMPRA"
                ? "buy"
                : "sell"
            ) +
          '">' +
            h.lado +
          '</span>' +

          '<span>' +
            dinheiro(h.price) +
            '<br>' +
            '<small style="color:#627089">' +
              dataHora(h.time) +
            '</small>' +
          '</span>' +

        '</div>'
      );

    }).join("");
}


function renderPnl(c){

  const realizado =
    Number(c.pnlRealizado || 0);

  const aberto =
    Number(c.pnlNaoRealizado || 0);


  const a =
    document.getElementById(
      "pnlRealizado"
    );

  const b =
    document.getElementById(
      "pnlAberto"
    );


  a.textContent =
    (realizado >= 0 ? "+" : "") +
    dinheiro(realizado) +
    " USDT";

  b.textContent =
    (aberto >= 0 ? "+" : "") +
    dinheiro(aberto) +
    " USDT";


  a.className =
    "pnlNumber " +
    classe(realizado);

  b.className =
    "pnlNumber " +
    classe(aberto);
}


/*
=========================================================
GRÁFICO
=========================================================
*/

async function carregarGrafico(){

  const symbol =
    document.getElementById(
      "symbolSelect"
    ).value ||
    "BTCUSDT";


  try{

    const response =
      await fetch(
        "/api/chart?account=" +
        encodeURIComponent(
          contaSelecionada
        ) +
        "&symbol=" +
        encodeURIComponent(symbol) +
        "&interval=" +
        encodeURIComponent(
          intervaloSelecionado
        ),
        {
          cache:"no-store"
        }
      );


    const data =
      await response.json();


    desenharGrafico(data);

  }catch(e){

    console.error(
      "Erro gráfico:",
      e
    );

  }
}


function desenharGrafico(d){

  const el =
    document.getElementById(
      "chart"
    );

  el.innerHTML = "";


  if(
    typeof LightweightCharts ===
    "undefined"
  ){

    el.innerHTML =
      '<div class="empty">' +
      'Biblioteca do gráfico não carregou.' +
      '</div>';

    return;
  }


  chart =
    LightweightCharts.createChart(
      el,
      {
        width:el.clientWidth,
        height:410,

        layout:{
          background:{
            color:"#0b1320"
          },
          textColor:"#8795ab"
        },

        grid:{
          vertLines:{
            color:"#172337"
          },
          horzLines:{
            color:"#172337"
          }
        },

        rightPriceScale:{
          borderColor:"#26364f"
        },

        timeScale:{
          borderColor:"#26364f",
          timeVisible:true
        }
      }
    );


  candleSeries =
    chart.addCandlestickSeries({
      upColor:"#20df96",
      downColor:"#ff6177",
      borderVisible:false,
      wickUpColor:"#20df96",
      wickDownColor:"#ff6177"
    });


  candleSeries.setData(
    d.candles || []
  );


  if(d.entry){

    candleSeries.createPriceLine({
      price:d.entry,
      color:"#20df96",
      lineWidth:2,
      lineStyle:2,
      axisLabelVisible:true,
      title:"ENTRADA"
    });

  }


  if(d.tp){

    candleSeries.createPriceLine({
      price:d.tp,
      color:"#ffc85a",
      lineWidth:2,
      lineStyle:2,
      axisLabelVisible:true,
      title:"TP"
    });

  }


  if(d.sl){

    candleSeries.createPriceLine({
      price:d.sl,
      color:"#ff6177",
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

    const candle =
      d.candles.reduce(
        function(prev, cur){

          return Math.abs(
            cur.time - d.entryTime
          ) <
          Math.abs(
            prev.time - d.entryTime
          )
            ? cur
            : prev;

        }
      );


    candleSeries.setMarkers([
      {
        time:candle.time,
        position:"belowBar",
        color:"#20df96",
        shape:"arrowUp",
        text:"COMPRA"
      }
    ]);

  }


  chart
    .timeScale()
    .fitContent();
}


/*
=========================================================
CARREGAMENTO
=========================================================
*/

async function carregar(){

  try{

    const response =
      await fetch(
        "/api/dashboard",
        {
          cache:"no-store"
        }
      );


    if(!response.ok){
      throw new Error(
        "HTTP " +
        response.status
      );
    }


    dados =
      await response.json();


    preencherTabs();

    renderConta();

    renderPnl(
      dados.contas.find(
        function(c){
          return c.id === contaSelecionada;
        }
      ) || {}
    );


    document.getElementById(
      "updated"
    ).textContent =
      "Atualizado às " +
      new Date(
        dados.atualizadoEm
      ).toLocaleTimeString(
        "pt-BR"
      );


    carregarGrafico();

  }catch(e){

    console.error(e);

    document.getElementById(
      "updated"
    ).textContent =
      "Erro ao atualizar";

  }
}


/*
=========================================================
EVENTOS
=========================================================
*/

document
  .getElementById(
    "symbolSelect"
  )
  .addEventListener(
    "change",
    carregarGrafico
  );


document
  .querySelectorAll(
    ".interval"
  )
  .forEach(function(button){

    button.addEventListener(
      "click",
      function(){

        document
          .querySelectorAll(
            ".interval"
          )
          .forEach(function(b){
            b.classList.remove(
              "active"
            );
          });


        button.classList.add(
          "active"
        );


        intervaloSelecionado =
          button.getAttribute(
            "data-i"
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

setInterval(
  carregar,
  15000
);

</script>

</body>
</html>
  `);
});


app.listen(
  PORT,
  "0.0.0.0",
  function(){
    console.log(
      "Binance-Robo Painel Premium V2 rodando na porta " +
      PORT
    );
  }
);
