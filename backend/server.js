const express = require("express");
const Binance = require("binance-api-node").default;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

/* =========================================================
   CONTAS
   ========================================================= */

const CONTAS = [
  {
    id: "1",
    nome: process.env.NOME_CONTA_1 || "SUA CONTA",
    apiKey: process.env.API_KEY_1,
    apiSecret: process.env.API_SECRET_1,
  },
  {
    id: "2",
    nome: process.env.NOME_CONTA_2 || "CONTA DO AMIGO",
    apiKey: process.env.API_KEY_2,
    apiSecret: process.env.API_SECRET_2,
  },
];

const clientes = CONTAS.map((conta) => ({
  ...conta,
  client:
    conta.apiKey && conta.apiSecret
      ? Binance({
          apiKey: conta.apiKey,
          apiSecret: conta.apiSecret,
        })
      : null,
}));

const CACHE_MS = 12000;
const cache = new Map();

/* =========================================================
   FUNÇÕES AUXILIARES
   ========================================================= */

function numero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function arred(v, casas = 2) {
  return Number(numero(v).toFixed(casas));
}

function normalizarAtivo(asset) {
  return String(asset || "").replace(/^LD/, "");
}

function escapeHtml(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* =========================================================
   COTAÇÃO USDT / BRL
   ========================================================= */

async function cotacaoUSDTBRL(client) {
  try {
    const p = await client.prices({
      symbol: "USDTBRL",
    });

    return (
      numero(p.USDTBRL) ||
      numero(process.env.USDTBRL_RATE) ||
      5.5
    );
  } catch {
    return numero(process.env.USDTBRL_RATE) || 5.5;
  }
}

/* =========================================================
   DADOS DA CONTA
   ========================================================= */

async function obterConta(conta) {
  if (!conta.client) {
    throw new Error(
      `Credenciais ausentes na conta ${conta.id}`
    );
  }

  const [info, prices, usdtBrl] = await Promise.all([
    conta.client.accountInfo(),
    conta.client.prices(),
    cotacaoUSDTBRL(conta.client),
  ]);

  const ativos = [];
  let patrimonioUSDT = 0;

  for (const b of info.balances || []) {
    const free = numero(b.free);
    const locked = numero(b.locked);
    const total = free + locked;

    if (total <= 0) continue;

    const asset = normalizarAtivo(b.asset);

    let valorUSDT = 0;

    if (asset === "USDT") {
      valorUSDT = total;
    } else if (prices[`${asset}USDT`]) {
      valorUSDT =
        total * numero(prices[`${asset}USDT`]);
    } else if (prices[`LD${asset}USDT`]) {
      valorUSDT =
        total * numero(prices[`LD${asset}USDT`]);
    }

    if (valorUSDT > 0.01) {
      patrimonioUSDT += valorUSDT;
    }

    ativos.push({
      asset,
      free,
      locked,
      total,
      valorUSDT,
      valorBRL: valorUSDT * usdtBrl,
      precoUSDT:
        asset === "USDT"
          ? 1
          : numero(
              prices[`${asset}USDT`] ||
              prices[`LD${asset}USDT`]
            ),
    });
  }

  ativos.sort(
    (a, b) => b.valorUSDT - a.valorUSDT
  );

  return {
    id: conta.id,
    nome: conta.nome,

    patrimonioUSDT,

    patrimonioUSD: patrimonioUSDT,

    patrimonioBRL:
      patrimonioUSDT * usdtBrl,

    usdtBrl,

    totalAtivos: ativos.filter(
      (a) => a.valorUSDT > 0.01
    ).length,

    ativos,

    atualizadoEm: Date.now(),
  };
}

/* =========================================================
   TRADES
   ========================================================= */

async function obterTradesDoSimbolo(
  conta,
  symbol,
  limit = 1000
) {
  try {
    return await conta.client.myTrades({
      symbol,
      limit,
    });
  } catch {
    return [];
  }
}

/* =========================================================
   PNL REALIZADO
   ========================================================= */

function calcularPnLTrades(trades) {
  const fila = [];
  let realizado = 0;

  const ordenados = [...trades].sort(
    (a, b) =>
      numero(a.time) -
      numero(b.time)
  );

  for (const t of ordenados) {
    const qty = numero(t.qty);
    const price = numero(t.price);
    const quote =
      numero(t.quoteQty) ||
      qty * price;

    const fee = numero(t.commission);

    const sideBuy = Boolean(t.isBuyer);

    if (sideBuy) {
      fila.push({
        qty,
        price,
        fee,
      });

      continue;
    }

    let restante = qty;

    while (
      restante > 1e-12 &&
      fila.length
    ) {
      const lote = fila[0];

      const usado = Math.min(
        restante,
        lote.qty
      );

      realizado +=
        usado *
        (price - lote.price);

      lote.qty -= usado;
      restante -= usado;

      if (lote.qty <= 1e-12) {
        fila.shift();
      }
    }

    if (
      fee > 0 &&
      String(
        t.commissionAsset || ""
      ).toUpperCase() === "USDT"
    ) {
      realizado -= fee;
    }

    void quote;
  }

  return realizado;
}

/* =========================================================
   POSIÇÕES ATIVAS
   ========================================================= */

async function obterPosicoes(
  conta,
  dadosConta
) {
  const posicoes = [];

  const ativos = (
    dadosConta.ativos || []
  ).filter(
    (a) =>
      a.asset !== "USDT" &&
      a.valorUSDT >= 3
  );

  for (const ativo of ativos) {
    const symbol =
      `${ativo.asset}USDT`;

    const trades =
      await obterTradesDoSimbolo(
        conta,
        symbol,
        1000
      );

    let comprado = 0;
    let custo = 0;

    let vendido = 0;
    let valorVendido = 0;

    let ultimoTrade = null;

    for (const t of trades) {
      const qty = numero(t.qty);
      const price = numero(t.price);

      const quote =
        numero(t.quoteQty) ||
        qty * price;

      if (t.isBuyer) {
        comprado += qty;
        custo += quote;
      } else {
        vendido += qty;
        valorVendido += quote;
      }

      if (
        !ultimoTrade ||
        numero(t.time) >
          numero(ultimoTrade.time)
      ) {
        ultimoTrade = t;
      }
    }

    const quantidadeLiquida =
      Math.max(
        0,
        comprado - vendido
      );

    const precoMedio =
      comprado > 0
        ? custo / comprado
        : 0;

    const precoAtual =
      ativo.precoUSDT || 0;

    const valorAtual =
      ativo.total * precoAtual;

    const pnlNaoRealizado =
      precoMedio > 0
        ? (precoAtual - precoMedio) *
          ativo.total
        : 0;

    const realizado =
      calcularPnLTrades(trades);

    let ordensAbertas = [];

    try {
      ordensAbertas =
        await conta.client.openOrders({
          symbol,
        });
    } catch {}

    const tp =
      ordensAbertas
        .filter(
          (o) =>
            String(o.side)
              .toUpperCase() ===
            "SELL"
        )
        .sort(
          (a, b) =>
            numero(a.price) -
            numero(b.price)
        )[0];

    const sl =
      ordensAbertas
        .filter(
          (o) =>
            String(o.side)
              .toUpperCase() ===
              "SELL" &&
            [
              "STOP_LOSS",
              "STOP_LOSS_LIMIT",
              "STOP",
            ].includes(
              String(o.type)
                .toUpperCase()
            )
        )
        .sort(
          (a, b) =>
            numero(a.stopPrice) -
            numero(b.stopPrice)
        )[0];

    posicoes.push({
      symbol,

      asset: ativo.asset,

      quantidade: ativo.total,

      quantidadeLiquida,

      precoAtual,

      precoMedio,

      valorAtual,

      pnlNaoRealizado,

      pnlNaoRealizadoPct:
        precoMedio > 0
          ? (
              (precoAtual /
                precoMedio) -
              1
            ) * 100
          : 0,

      pnlRealizado:
        realizado,

      ultimaOperacao:
        ultimoTrade
          ? {
              id: ultimoTrade.id,

              lado:
                ultimoTrade.isBuyer
                  ? "COMPRA"
                  : "VENDA",

              quantidade:
                numero(
                  ultimoTrade.qty
                ),

              preco:
                numero(
                  ultimoTrade.price
                ),

              valor:
                numero(
                  ultimoTrade.quoteQty
                ),

              time:
                numero(
                  ultimoTrade.time
                ),
            }
          : null,

      tp: tp
        ? {
            price:
              numero(tp.price),

            origQty:
              numero(tp.origQty),

            status:
              tp.status,

            type:
              tp.type,
          }
        : null,

      sl: sl
        ? {
            stopPrice:
              numero(
                sl.stopPrice
              ),

            price:
              numero(sl.price),

            status:
              sl.status,

            type:
              sl.type,
          }
        : null,

      ordensAbertas:
        ordensAbertas.length,
    });
  }

  return posicoes.sort(
    (a, b) =>
      b.valorAtual -
      a.valorAtual
  );
}

/* =========================================================
   HISTÓRICO
   ========================================================= */

async function obterHistoricoConta(
  conta,
  dadosConta,
  limite = 20
) {
  const ativos = (
    dadosConta.ativos || []
  )
    .filter(
      (a) =>
        a.asset !== "USDT" &&
        a.valorUSDT > 0.01
    )
    .slice(0, 12);

  const resultados = [];

  for (const ativo of ativos) {
    const symbol =
      `${ativo.asset}USDT`;

    const trades =
      await obterTradesDoSimbolo(
        conta,
        symbol,
        100
      );

    for (
      const t of trades.slice(-20)
    ) {
      resultados.push({
        symbol,

        lado:
          t.isBuyer
            ? "COMPRA"
            : "VENDA",

        qty:
          numero(t.qty),

        price:
          numero(t.price),

        quoteQty:
          numero(t.quoteQty),

        commission:
          numero(t.commission),

        commissionAsset:
          t.commissionAsset,

        time:
          numero(t.time),
      });
    }
  }

  resultados.sort(
    (a, b) =>
      b.time - a.time
  );

  return resultados.slice(
    0,
    limite
  );
}

/* =========================================================
   DASHBOARD DE CADA CONTA
   ========================================================= */

async function obterDashboardConta(
  conta
) {
  const dados =
    await obterConta(conta);

  const posicoes =
    await obterPosicoes(
      conta,
      dados
    );

  const historico =
    await obterHistoricoConta(
      conta,
      dados,
      30
    );

  const pnlNaoRealizado =
    posicoes.reduce(
      (s, p) =>
        s +
        numero(
          p.pnlNaoRealizado
        ),
      0
    );

  const pnlRealizado =
    posicoes.reduce(
      (s, p) =>
        s +
        numero(
          p.pnlRealizado
        ),
      0
    );

  const ultimaCompra =
    historico.find(
      (h) =>
        h.lado === "COMPRA"
    ) || null;

  const ultimaVenda =
    historico.find(
      (h) =>
        h.lado === "VENDA"
    ) || null;

  return {
    ...dados,

    posicoes,

    historico,

    pnlNaoRealizado,

    pnlRealizado,

    pnlTotalEstimado:
      pnlRealizado +
      pnlNaoRealizado,

    ultimaCompra,

    ultimaVenda,
  };
}

/* =========================================================
   CACHE
   ========================================================= */

async function comCache(
  chave,
  fn
) {
  const atual =
    cache.get(chave);

  if (
    atual &&
    Date.now() -
      atual.time <
      CACHE_MS
  ) {
    return atual.data;
  }

  const data =
    await fn();

  cache.set(
    chave,
    {
      time: Date.now(),
      data,
    }
  );

  return data;
}

/* =========================================================
   DASHBOARD COMPLETO
   ========================================================= */

async function dashboardCompleto() {
  const contas =
    await Promise.all(
      clientes.map(
        (c) =>
          comCache(
            `dashboard-${c.id}`,
            () =>
              obterDashboardConta(
                c
              )
          ).catch(
            (err) => ({
              id: c.id,

              nome: c.nome,

              erro:
                err.message ||
                "Erro ao consultar Binance",

              patrimonioUSDT: 0,

              patrimonioBRL: 0,

              totalAtivos: 0,

              ativos: [],

              posicoes: [],

              historico: [],

              pnlNaoRealizado: 0,

              pnlRealizado: 0,

              pnlTotalEstimado: 0,
            })
          )
      )
    );

  const totalUSDT =
    contas.reduce(
      (s, c) =>
        s +
        numero(
          c.patrimonioUSDT
        ),
      0
    );

  const totalBRL =
    contas.reduce(
      (s, c) =>
        s +
        numero(
          c.patrimonioBRL
        ),
      0
    );

  return {
    atualizadoEm:
      Date.now(),

    totalUSDT,

    totalBRL,

    contas,
  };
}

/* =========================================================
   API DASHBOARD
   ========================================================= */

app.get(
  "/api/dashboard",
  async (req, res) => {
    try {
      res.json(
        await dashboardCompleto()
      );
    } catch (err) {
      res.status(500).json({
        erro: err.message,
      });
    }
  }
);

/* =========================================================
   API DE CADA CONTA
   ========================================================= */

app.get(
  "/api/account/:id",
  async (req, res) => {
    try {
      const conta =
        clientes.find(
          (c) =>
            c.id ===
            req.params.id
        );

      if (!conta) {
        return res
          .status(404)
          .json({
            erro:
              "Conta não encontrada",
          });
      }

      res.json(
        await comCache(
          `dashboard-${conta.id}`,
          () =>
            obterDashboardConta(
              conta
            )
        )
      );
    } catch (err) {
      res.status(500).json({
        erro: err.message,
      });
    }
  }
);

/* =========================================================
   API DO GRÁFICO
   ========================================================= */

app.get(
  "/api/chart",
  async (req, res) => {
    try {
      const accountId =
        String(
          req.query.account ||
            "1"
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

      const conta =
        clientes.find(
          (c) =>
            c.id === accountId
        );

      if (!conta) {
        return res
          .status(404)
          .json({
            erro:
              "Conta não encontrada",
          });
      }

      const candles =
        await conta.client.candles({
          symbol,
          interval,
          limit: 300,
        });

      let entry = null;
      let entryTime = null;

      let tp = null;
      let sl = null;

      try {
        const trades =
          await obterTradesDoSimbolo(
            conta,
            symbol,
            1000
          );

        const buys =
          trades
            .filter(
              (t) =>
                t.isBuyer
            )
            .sort(
              (a, b) =>
                numero(a.time) -
                numero(b.time)
            );

        if (buys.length) {
          const qty =
            buys.reduce(
              (s, t) =>
                s +
                numero(t.qty),
              0
            );

          const cost =
            buys.reduce(
              (s, t) =>
                s +
                (
                  numero(
                    t.quoteQty
                  ) ||
                  numero(
                    t.qty
                  ) *
                    numero(
                      t.price
                    )
                ),
              0
            );

          if (qty > 0) {
            entry =
              cost / qty;
          }

          entryTime =
            Math.floor(
              numero(
                buys[
                  buys.length - 1
                ].time
              ) / 1000
            );
        }

        const orders =
          await conta.client.openOrders({
            symbol,
          });

        const sell =
          orders
            .filter(
              (o) =>
                String(
                  o.side
                ).toUpperCase() ===
                "SELL"
            )
            .sort(
              (a, b) =>
                numero(a.price) -
                numero(b.price)
            )[0];

        if (sell) {
          tp =
            numero(
              sell.price
            );
        }

        const stop =
          orders.find(
            (o) =>
              [
                "STOP",
                "STOP_LOSS",
                "STOP_LOSS_LIMIT",
              ].includes(
                String(
                  o.type
                ).toUpperCase()
              )
          );

        if (stop) {
          sl = numero(
            stop.stopPrice ||
              stop.price
          );
        }
      } catch {}

      res.json({
        symbol,

        interval,

        candles:
          candles.map(
            (c) => ({
              time:
                Math.floor(
                  numero(
                    c.openTime
                  ) / 1000
                ),

              open:
                numero(c.open),

              high:
                numero(c.high),

              low:
                numero(c.low),

              close:
                numero(c.close),
            })
          ),

        entry,

        entryTime,

        tp,

        sl,
      });
    } catch (err) {
      res.status(500).json({
        erro: err.message,
      });
    }
  }
);

/* =========================================================
   STATUS
   ========================================================= */

app.get(
  "/api/status",
  (req, res) => {
    res.json({
      status: "online",

      sistema:
        "Binance-Robo",

      painel:
        "premium",

      contas:
        clientes.length,
    });
  }
);

/* =========================================================
   PAINEL
   ========================================================= */

app.get(
  "/",
  (req, res) => {
    res.send(`
<!doctype html>

<html lang="pt-BR">

<head>

<meta charset="utf-8">

<meta
  name="viewport"
  content="width=device-width,initial-scale=1"
>

<title>
Binance-Robo • Painel Premium
</title>

<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>

<script src="https://unpkg.com/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js"></script>

<style>

:root{
  --bg:#070b14;
  --panel:#101827;
  --panel2:#0d1421;
  --line:#243044;
  --text:#f7f8fb;
  --muted:#8c98ad;
  --green:#20d890;
  --red:#ff5d73;
  --blue:#48a7ff;
  --gold:#f7b955;
  --purple:#8b6cff;
}

*{
  box-sizing:border-box;
}

body{
  margin:0;
  background:
    radial-gradient(
      circle at 20% 0,
      #17244a 0,
      #070b14 45%
    );
  color:var(--text);
  font-family:
    Inter,
    Arial,
    sans-serif;
}

header{
  height:82px;
  border-bottom:
    1px solid #1b2537;
  background:#050812ef;
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:0 5%;
  position:sticky;
  top:0;
  z-index:5;
  backdrop-filter:blur(12px);
}

.brand{
  display:flex;
  align-items:center;
  gap:14px;
}

.logo{
  width:44px;
  height:44px;
  border-radius:13px;
  background:
    linear-gradient(
      135deg,
      #ffb000,
      #ffcf55
    );
  display:grid;
  place-items:center;
  font-size:24px;
}

.brand h1{
  margin:0;
  font-size:19px;
}

.brand span{
  display:block;
  color:var(--muted);
  font-size:12px;
  margin-top:3px;
}

.online{
  border:
    1px solid #145c43;
  background:#08261c;
  color:#25dc91;
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

.title{
  display:flex;
  justify-content:space-between;
  align-items:end;
  margin-bottom:22px;
}

.title h2{
  font-size:34px;
  margin:0;
}

.title p{
  color:var(--muted);
  margin:8px 0 0;
}

.grid{
  display:grid;
  grid-template-columns:
    repeat(4,1fr);
  gap:16px;
}

.card{
  background:
    linear-gradient(
      145deg,
      #121e34,
      #0c1422
    );
  border:
    1px solid var(--line);
  border-radius:18px;
  padding:20px;
  box-shadow:
    0 14px 40px #0005;
}

.label{
  font-size:12px;
  color:var(--muted);
  margin-bottom:10px;
}

.value{
  font-size:25px;
  font-weight:900;
}

.sub{
  font-size:11px;
  color:var(--muted);
  margin-top:8px;
}

.green{
  color:var(--green);
}

.red{
  color:var(--red);
}

.blue{
  color:var(--blue);
}

.gold{
  color:var(--gold);
}

.section{
  margin-top:22px;
}

.section h3{
  margin:
    0 0 12px;
  font-size:17px;
}

.accounts{
  display:grid;
  grid-template-columns:
    1fr 1fr;
  gap:18px;
}

.account{
  background:
    linear-gradient(
      145deg,
      #111b2d,
      #0b121f
    );
  border:
    1px solid var(--line);
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
  font-size:11px;
  padding:6px 10px;
  border-radius:20px;
  background:#15243a;
  color:#8ebdff;
}

.metrics{
  display:grid;
  grid-template-columns:
    repeat(3,1fr);
  gap:10px;
}

.metric{
  background:#0a111d;
  border:
    1px solid #1d293b;
  border-radius:13px;
  padding:13px;
}

.metric .label{
  margin:
    0 0 5px;
}

.metric strong{
  font-size:17px;
}

.operation{
  margin-top:15px;
  background:#0a111d;
  border:
    1px solid #1d293b;
  border-radius:14px;
  padding:15px;
}

.opTop{
  display:flex;
  justify-content:space-between;
  gap:12px;
  align-items:center;
}

.coin{
  font-size:21px;
  font-weight:900;
}

.pill{
  font-size:11px;
  padding:6px 9px;
  border-radius:20px;
}

.pill.buy{
  background:#063d2a;
  color:#31e59d;
}

.pill.sell{
  background:#421923;
  color:#ff7386;
}

.kv{
  display:grid;
  grid-template-columns:
    repeat(4,1fr);
  gap:10px;
  margin-top:14px;
}

.kv div{
  color:var(--muted);
  font-size:11px;
}

.kv b{
  display:block;
  color:var(--text);
  font-size:13px;
  margin-top:4px;
}

.layout{
  display:grid;
  grid-template-columns:
    1.6fr 1fr;
  gap:18px;
}

.chartBox{
  height:460px;
}

.chart{
  height:390px;
  width:100%;
}

.controls{
  display:flex;
  gap:8px;
  flex-wrap:wrap;
  margin-bottom:10px;
}

.controls button,
.controls select,
.btn{
  background:#111d31;
  border:
    1px solid #29364d;
  color:#dce5f4;
  border-radius:9px;
  padding:8px 12px;
  cursor:pointer;
}

.controls button.active{
  background:
    linear-gradient(
      135deg,
      #6f55ff,
      #8b6cff
    );
  border-color:#8b6cff;
}

.tableWrap{
  overflow:auto;
}

.table{
  width:100%;
  border-collapse:
    collapse;
  font-size:12px;
}

.table th,
.table td{
  padding:11px 8px;
  border-bottom:
    1px solid #1c2738;
  text-align:left;
}

.table th{
  color:var(--muted);
  font-weight:600;
}

.compare{
  display:grid;
  grid-template-columns:
    1fr 1fr;
  gap:18px;
}

.mini{
  background:
    linear-gradient(
      145deg,
      #101a2b,
      #0b121e
    );
  border:
    1px solid var(--line);
  border-radius:18px;
  padding:18px;
}

.mini h4{
  margin:
    0 0 14px;
  font-size:17px;
}

.bar{
  height:8px;
  border-radius:20px;
  background:#172235;
  overflow:hidden;
}

.bar i{
  display:block;
  height:100%;
  background:
    linear-gradient(
      90deg,
      #48a7ff,
      #8b6cff
    );
}

footer{
  text-align:center;
  color:var(--muted);
  font-size:11px;
  padding:
    20px 5% 35px;
}

@media(max-width:1000px){

  .grid{
    grid-template-columns:
      repeat(2,1fr);
  }

  .accounts{
    grid-template-columns:1fr;
  }

  .layout{
    grid-template-columns:1fr;
  }

}

@media(max-width:650px){

  .grid{
    grid-template-columns:1fr;
  }

  .metrics{
    grid-template-columns:1fr;
  }

  .kv{
    grid-template-columns:
      repeat(2,1fr);
  }

  .compare{
    grid-template-columns:1fr;
  }

  .title{
    display:block;
  }

  .title h2{
    font-size:27px;
  }

}

</style>

</head>

<body>

<header>

<div class="brand">

<div class="logo">
🤖
</div>

<div>

<h1>
Binance-Robo
</h1>

<span>
Painel de Controle Premium
</span>

</div>

</div>

<div class="online">
● ONLINE
</div>

</header>

<main>

<div class="title">

<div>

<h2>
Dashboard
</h2>

<p>
Visão separada das duas contas e das operações do robô.
</p>

</div>

<div
  id="atualizado"
  class="sub"
></div>

</div>


<!-- =====================================================
     CARDS PRINCIPAIS
     ===================================================== -->

<div class="grid">

<div class="card">

<div class="label">
💰 Patrimônio total
</div>

<div
  class="value"
  id="totalUSDT"
>
--
</div>

<div
  class="sub"
  id="totalBRL"
>
--
</div>

</div>


<div class="card">

<div class="label">
📈 Lucro/Perda estimado
</div>

<div
  class="value"
  id="totalPnL"
>
--
</div>

<div class="sub">
Realizado + não realizado*
</div>

</div>


<div class="card">

<div class="label">
🟢 Operações ativas
</div>

<div
  class="value"
  id="totalOps"
>
--
</div>

<div class="sub">
Posições detectadas
</div>

</div>


<div class="card">

<div class="label">
🪙 Ativos
</div>

<div
  class="value"
  id="totalAssets"
>
--
</div>

<div class="sub">
Somando as duas contas
</div>

</div>

</div>


<!-- =====================================================
     CONTAS
     ===================================================== -->

<section class="section">

<h3>
👥 Contas separadas
</h3>

<div class="accounts">

<div
  class="account"
  id="conta1"
></div>

<div
  class="account"
  id="conta2"
></div>

</div>

</section>


<!-- =====================================================
     COMPARATIVO
     ===================================================== -->

<section class="section">

<h3>
📊 Comparativo
</h3>

<div
  class="compare"
  id="comparativo"
></div>

</section>


<!-- =====================================================
     GRÁFICO + HISTÓRICO
     ===================================================== -->

<section class="section layout">


<div class="card chartBox">

<h3>
📉 Gráfico da operação
</h3>

<div class="controls">

<select id="accountSelect">

<option value="1">
SUA CONTA
</option>

<option value="2">
CONTA DO AMIGO
</option>

</select>


<select id="symbolSelect">
</select>


<button
  data-i="15m"
  class="active"
>
15m
</button>


<button data-i="1h">
1h
</button>


<button data-i="4h">
4h
</button>

</div>


<div
  id="chart"
  class="chart"
></div>


<div class="sub">
🟢 compra/entrada • linha de TP/SL quando detectada • preço atual
</div>

</div>


<div class="card">

<h3>
🧾 Últimas operações
</h3>

<div class="tableWrap">

<table class="table">

<thead>

<tr>

<th>
Conta
</th>

<th>
Par
</th>

<th>
Lado
</th>

<th>
Preço
</th>

<th>
Data
</th>

</tr>

</thead>

<tbody
  id="historico"
></tbody>

</table>

</div>

</div>

</section>


<div
  class="sub"
  style="margin-top:16px"
>
* O P/L histórico é uma estimativa baseada nos fills disponíveis na API da Binance; não substitui uma contabilidade completa de depósitos, saques e operações antigas.
</div>

</main>


<footer>

Binance-Robo • Painel somente leitura • As chaves não são exibidas no navegador.

</footer>


<script>

let dados = null;

let chart = null;

let candleSeries = null;


/* =====================================================
   FUNÇÕES
   ===================================================== */

const money = (v) =>
  Number(v || 0)
    .toLocaleString(
      "pt-BR",
      {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }
    );


const pct = (v) =>
  \`\${Number(v || 0).toFixed(2)}%\`;


const cls = (v) =>
  Number(v) >= 0
    ? "green"
    : "red";


const dataHora = (t) =>
  t
    ? new Date(t)
        .toLocaleString(
          "pt-BR"
        )
    : "--";


/* =====================================================
   HTML DE CADA CONTA
   ===================================================== */

function contaHtml(c) {

  if (c.erro) {

    return \`
      <div class="accountHead">

        <h3>
          \${esc(c.nome)}
        </h3>

        <span class="badge">
          ERRO
        </span>

      </div>

      <div class="red">
        \${esc(c.erro)}
      </div>
    \`;

  }


  const pos =
    c.posicoes?.[0];


  const pnl =
    c.pnlTotalEstimado || 0;


  return \`

    <div class="accountHead">

      <h3>
        \${esc(c.nome)}
      </h3>

      <span class="badge">
        CONTA \${c.id}
      </span>

    </div>


    <div class="metrics">


      <div class="metric">

        <div class="label">
          Patrimônio
        </div>

        <strong>
          \${money(c.patrimonioUSDT)}
          USDT
        </strong>

        <div class="sub">
          R$ \${money(c.patrimonioBRL)}
        </div>

      </div>


      <div class="metric">

        <div class="label">
          Lucro/Perda
        </div>

        <strong
          class="\${cls(pnl)}"
        >

          \${pnl >= 0 ? "+" : ""}
          \${money(pnl)}
          USDT

        </strong>

        <div class="sub">

          Real.:
          \${money(c.pnlRealizado)}

          •

          Aberto:
          \${money(c.pnlNaoRealizado)}

        </div>

      </div>


      <div class="metric">

        <div class="label">
          Ativos
        </div>

        <strong>
          \${c.totalAtivos}
        </strong>

        <div class="sub">
          USDT/cripto
        </div>

      </div>


    </div>


    \${pos ? \`

      <div class="operation">


        <div class="opTop">


          <div>

            <div class="label">
              OPERAÇÃO ATIVA DETECTADA
            </div>

            <div class="coin">
              \${esc(pos.symbol)}
            </div>

          </div>


          <span class="pill buy">
            🟢 POSIÇÃO
          </span>


        </div>


        <div class="kv">


          <div>

            Entrada

            <b>
              \${money(pos.precoMedio)}
              USDT
            </b>

          </div>


          <div>

            Atual

            <b>
              \${money(pos.precoAtual)}
              USDT
            </b>

          </div>


          <div>

            P/L

            <b
              class="\${cls(pos.pnlNaoRealizado)}"
            >

              \${pos.pnlNaoRealizado >= 0 ? "+" : ""}

              \${money(pos.pnlNaoRealizado)}

              (
              \${pct(pos.pnlNaoRealizadoPct)}
              )

            </b>

          </div>


          <div>

            Qtd.

            <b>
              \${Number(pos.quantidade || 0).toFixed(6)}
            </b>

          </div>


        </div>


        <div class="kv">


          <div>

            Take Profit

            <b>
              \${pos.tp ? money(pos.tp.price) : "--"}
            </b>

          </div>


          <div>

            Stop Loss

            <b>
              \${pos.sl ? money(pos.sl.stopPrice) : "--"}
            </b>

          </div>


          <div>

            Ordens abertas

            <b>
              \${pos.ordensAbertas}
            </b>

          </div>


          <div>

            Último trade

            <b>
              \${pos.ultimaOperacao ? dataHora(pos.ultimaOperacao.time) : "--"}
            </b>

          </div>


        </div>


      </div>

    \` : \`

      <div class="operation">

        <div class="label">
          OPERAÇÃO ATIVA
        </div>

        <strong>
          Nenhuma posição ≥ 3 USDT detectada.
        </strong>

      </div>

    \`}

  \`;

}


/* =====================================================
   ESCAPE
   ===================================================== */

function esc(s) {

  return String(s ?? "")
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
    );

}


/* =====================================================
   RENDER
   ===================================================== */

function render() {

  const c1 =
    dados.contas[0];

  const c2 =
    dados.contas[1];


  document.getElementById(
    "totalUSDT"
  ).textContent =
    money(
      dados.totalUSDT
    ) +
    " USDT";


  document.getElementById(
    "totalBRL"
  ).textContent =
    "R$ " +
    money(
      dados.totalBRL
    );


  const pnl =
    (c1.pnlTotalEstimado || 0) +
    (c2.pnlTotalEstimado || 0);


  const ops =
    (c1.posicoes?.length || 0) +
    (c2.posicoes?.length || 0);


  const assets =
    (c1.totalAtivos || 0) +
    (c2.totalAtivos || 0);


  document.getElementById(
    "totalPnL"
  ).textContent =
    (pnl >= 0 ? "+" : "") +
    money(pnl) +
    " USDT";


  document.getElementById(
    "totalPnL"
  ).className =
    "value " +
    cls(pnl);


  document.getElementById(
    "totalOps"
  ).textContent =
    ops;


  document.getElementById(
    "totalAssets"
  ).textContent =
    assets;


  document.getElementById(
    "conta1"
  ).innerHTML =
    contaHtml(c1);


  document.getElementById(
    "conta2"
  ).innerHTML =
    contaHtml(c2);


  document.getElementById(
    "atualizado"
  ).textContent =
    "Atualizado às " +
    new Date(
      dados.atualizadoEm
    ).toLocaleTimeString(
      "pt-BR"
    );


  /* =====================================================
     COMPARATIVO
     ===================================================== */

  const max =
    Math.max(
      c1.patrimonioUSDT || 0,
      c2.patrimonioUSDT || 0,
      1
    );


  document.getElementById(
    "comparativo"
  ).innerHTML =
    [c1, c2]
      .map(
        (c) => \`

          <div class="mini">

            <h4>
              \${esc(c.nome)}
            </h4>

            <div class="sub">
              Patrimônio
            </div>

            <strong>
              \${money(c.patrimonioUSDT)}
              USDT
            </strong>

            <div
              class="bar"
              style="margin-top:10px"
            >

              <i
                style="width:\${Math.min(
                  100,
                  (c.patrimonioUSDT / max) * 100
                )}%"
              ></i>

            </div>

            <div class="sub">

              P/L:

              <span
                class="\${cls(c.pnlTotalEstimado)}"
              >

                \${c.pnlTotalEstimado >= 0 ? "+" : ""}

                \${money(c.pnlTotalEstimado)}

                USDT

              </span>

            </div>

          </div>

        \`
      )
      .join("");


  /* =====================================================
     MOEDAS PARA O GRÁFICO
     ===================================================== */

  const symbols =
    [
      ...new Set(
        dados.contas.flatMap(
          (c) =>
            (c.posicoes || [])
              .map(
                (p) =>
                  p.symbol
              )
        )
      ),
    ];


  const select =
    document.getElementById(
      "symbolSelect"
    );


  const atual =
    select.value;


  select.innerHTML =
    symbols.length
      ? symbols
          .map(
            (s) =>
              \`
                <option
                  value="\${esc(s)}"
                >
                  \${esc(s)}
                </option>
              \`
          )
          .join("")
      : `
        <option value="BTCUSDT">
          BTCUSDT
        </option>
      `;


  if (
    symbols.includes(atual)
  ) {
    select.value =
      atual;
  }


  /* =====================================================
     HISTÓRICO
     ===================================================== */

  const rows =
    dados.contas
      .flatMap(
        (c) =>
          (c.historico || [])
            .map(
              (h) => ({
                ...h,
                conta:
                  c.nome,
              })
            )
      )
      .sort(
        (a, b) =>
          b.time - a.time
      )
      .slice(0, 25);


  document.getElementById(
    "historico"
  ).innerHTML =
    rows.length
      ? rows
          .map(
            (h) =>
              \`

                <tr>

                  <td>
                    \${esc(h.conta)}
                  </td>

                  <td>
                    <b>
                      \${esc(h.symbol)}
                    </b>
                  </td>

                  <td
                    class="\${h.lado === "COMPRA" ? "green" : "red"}"
                  >
                    \${h.lado}
                  </td>

                  <td>
                    \${money(h.price)}
                  </td>

                  <td>
                    \${dataHora(h.time)}
                  </td>

                </tr>

              \`
          )
          .join("")
      : \`

          <tr>

            <td
              colspan="5"
            >
              Nenhuma operação recente encontrada.
            </td>

          </tr>

        \`;

}


/* =====================================================
   CARREGAR DASHBOARD
   ===================================================== */

async function carregar() {

  try {

    const r =
      await fetch(
        "/api/dashboard",
        {
          cache:
            "no-store",
        }
      );


    dados =
      await r.json();


    render();


    carregarGrafico();


  } catch (e) {

    document.getElementById(
      "atualizado"
    ).textContent =
      "Erro ao atualizar";

  }

}


/* =====================================================
   CARREGAR GRÁFICO
   ===================================================== */

async function carregarGrafico() {

  const account =
    document.getElementById(
      "accountSelect"
    ).value;


  const symbol =
    document.getElementById(
      "symbolSelect"
    ).value ||
    "BTCUSDT";


  const interval =
    document.querySelector(
      ".controls button.active"
    )?.dataset.i ||
    "15m";


  try {

    const r =
      await fetch(
        \`/api/chart?account=\${encodeURIComponent(account)}&symbol=\${encodeURIComponent(symbol)}&interval=\${encodeURIComponent(interval)}\`
      );


    const d =
      await r.json();


    desenharGrafico(d);


  } catch (e) {}

}


/* =====================================================
   DESENHAR GRÁFICO
   ===================================================== */

function desenharGrafico(d) {

  const el =
    document.getElementById(
      "chart"
    );


  el.innerHTML = "";


  chart =
    LightweightCharts.createChart(
      el,
      {
        width:
          el.clientWidth,

        height:390,

        layout:{
          background:{
            color:"#0d1421",
          },

          textColor:
            "#8794aa",
        },

        grid:{
          vertLines:{
            color:"#172235",
          },

          horzLines:{
            color:"#172235",
          },
        },

        rightPriceScale:{
          borderColor:
            "#26344a",
        },

        timeScale:{
          borderColor:
            "#26344a",

          timeVisible:true,
        },
      }
    );


  candleSeries =
    chart.addCandlestickSeries(
      {
        upColor:
          "#20d890",

        downColor:
          "#ff5d73",

        borderVisible:
          false,

        wickUpColor:
          "#20d890",

        wickDownColor:
          "#ff5d73",
      }
    );


  candleSeries.setData(
    d.candles || []
  );


  const lines = [];


  if (d.entry) {

    lines.push({
      price:
        d.entry,

      color:
        "#20d890",

      title:
        "COMPRA",
    });

  }


  if (d.tp) {

    lines.push({
      price:
        d.tp,

      color:
        "#f7b955",

      title:
        "TP",
    });

  }


  if (d.sl) {

    lines.push({
      price:
        d.sl,

      color:
        "#ff5d73",

      title:
        "SL",
    });

  }


  for (
    const l of lines
  ) {

    candleSeries.createPriceLine(
      {
        price:
          l.price,

        color:
          l.color,

        lineWidth:
          2,

        lineStyle:
          2,

        axisLabelVisible:
          true,

        title:
          l.title,
      }
    );

  }


  /* =====================================================
     MARCADOR DE ENTRADA
     ===================================================== */

  if (
    d.entry &&
    d.candles?.length
  ) {

    const alvo =
      Number(
        d.entryTime ||
        d.candles[
          d.candles.length - 1
        ].time
      );


    const candle =
      d.candles.reduce(
        (prev, cur) =>
          Math.abs(
            cur.time -
              alvo
          ) <
          Math.abs(
            prev.time -
              alvo
          )
            ? cur
            : prev
      );


    candleSeries.setMarkers(
      [
        {
          time:
            candle.time,

          position:
            "belowBar",

          color:
            "#20d890",

          shape:
            "arrowUp",

          text:
            "ENTRADA " +
            money(d.entry),
        },
      ]
    );

  }


  chart
    .timeScale()
    .fitContent();

}


/* =====================================================
   EVENTOS
   ===================================================== */

document
  .getElementById(
    "accountSelect"
  )
  .addEventListener(
    "change",
    carregarGrafico
  );


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
    ".controls button"
  )
  .forEach(
    (b) =>
      b.addEventListener(
        "click",
        () => {

          document
            .querySelectorAll(
              ".controls button"
            )
            .forEach(
              (x) =>
                x.classList.remove(
                  "active"
                )
            );


          b.classList.add(
            "active"
          );


          carregarGrafico();

        }
      )
  );


window.addEventListener(
  "resize",
  () => {

    if (chart) {

      chart.applyOptions({
        width:
          document.getElementById(
            "chart"
          ).clientWidth,
      });

    }

  }
);


/* =====================================================
   INICIALIZAÇÃO
   ===================================================== */

carregar();


/* Atualiza a cada 15 segundos */

setInterval(
  carregar,
  15000
);

</script>

</body>

</html>
`);
});


/* =========================================================
   SERVIDOR
   ========================================================= */

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Painel premium rodando na porta ${PORT}`
    );
  }
);
