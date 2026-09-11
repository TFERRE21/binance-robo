const express = require("express");
const Binance = require("binance-api-node").default;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

/* =========================================================
   CONEXÃO BINANCE
   SOMENTE LEITURA
========================================================= */

const client = Binance({
  apiKey: process.env.API_KEY,
  apiSecret: process.env.API_SECRET
});

/* =========================================================
   STATUS
========================================================= */

app.get("/api/status", (req, res) => {

  res.json({
    status: "online",
    sistema: "Binance-Robo",
    painel: "backend funcionando"
  });

});

/* =========================================================
   FUNÇÃO:
   DESCOBRIR O ATIVO REAL
========================================================= */

function ativoBase(asset) {

  if (asset.startsWith("LD") && asset.length > 2) {
    return asset.substring(2);
  }

  return asset;

}

/* =========================================================
   CONSULTAR CONTA
========================================================= */

app.get("/api/account", async (req, res) => {

  try {

    const account = await client.accountInfo();

    const balances = account.balances || [];

    /* =====================================================
       PREÇOS BINANCE
    ===================================================== */

    let prices = {};

    try {

      prices = await client.prices();

    } catch (error) {

      console.log(
        "Erro ao carregar preços:",
        error.message
      );

    }

    /* =====================================================
       COTAÇÃO USDT/BRL
    ===================================================== */

    let usdtBRL = 0;

    if (prices.USDTBRL) {

      usdtBRL = Number(
        prices.USDTBRL
      );

    }

    /*
      Caso a Binance não disponibilize USDTBRL,
      usamos uma aproximação temporária.

      O painel continuará funcionando,
      mas a cotação será marcada como estimada.
    */

    let cotacaoEstimativa = false;

    if (!usdtBRL || usdtBRL <= 0) {

      usdtBRL = 5.50;

      cotacaoEstimativa = true;

    }

    /* =====================================================
       FILTRAR ATIVOS
    ===================================================== */

    const ativos = balances

      .filter(balance => {

        return (
          Number(balance.free) > 0 ||
          Number(balance.locked) > 0
        );

      })

      .map(balance => {

        const asset =
          balance.asset;

        const base =
          ativoBase(asset);

        const free =
          Number(balance.free);

        const locked =
          Number(balance.locked);

        const quantidade =
          free + locked;

        return {

          asset,
          base,
          free,
          locked,
          quantidade

        };

      });

    /* =====================================================
       CALCULAR VALORES
    ===================================================== */

    let patrimonioUSDT = 0;

    const saldos = ativos.map(asset => {

      let precoUSDT = 0;

      let valorUSDT = 0;

      /* ===================================================
         USDT
      =================================================== */

      if (asset.base === "USDT") {

        precoUSDT = 1;

        valorUSDT =
          asset.quantidade;

      }

      /* ===================================================
         OUTROS ATIVOS
      =================================================== */

      else {

        const par =
          asset.base + "USDT";

        if (prices[par]) {

          precoUSDT =
            Number(prices[par]);

          valorUSDT =
            asset.quantidade *
            precoUSDT;

        }

      }

      patrimonioUSDT +=
        valorUSDT;

      return {

        asset: asset.asset,

        base: asset.base,

        free: asset.free,

        locked: asset.locked,

        quantidade:
          asset.quantidade,

        precoUSDT,

        valorUSDT,

        valorUSD:
          valorUSDT,

        valorBRL:
          valorUSDT * usdtBRL

      };

    });

    /* =====================================================
       SALDO USDT
    ===================================================== */

    const usdt =
      saldos.find(
        item => item.base === "USDT"
      ) || {

        asset: "USDT",

        base: "USDT",

        free: 0,

        locked: 0,

        quantidade: 0,

        precoUSDT: 1,

        valorUSDT: 0,

        valorUSD: 0,

        valorBRL: 0

      };

    /* =====================================================
       TOTAL EM DÓLAR
    ===================================================== */

    const patrimonioUSD =
      patrimonioUSDT;

    /* =====================================================
       TOTAL EM REAL
    ===================================================== */

    const patrimonioBRL =
      patrimonioUSDT *
      usdtBRL;

    /* =====================================================
       RESPOSTA
    ===================================================== */

    res.json({

      status: "ok",

      moedaBase: "USDT",

      cambio: {

        usdtBRL,

        estimada:
          cotacaoEstimativa

      },

      patrimonio: {

        usdt:
          patrimonioUSDT,

        usd:
          patrimonioUSD,

        brl:
          patrimonioBRL

      },

      usdt,

      totalAtivos:
        saldos.length,

      saldos

    });

  } catch (error) {

    console.error(
      "Erro ao consultar Binance:",
      error.message
    );

    res.status(500).json({

      status: "error",

      mensagem:
        "Não foi possível consultar a conta Binance."

    });

  }

});

/* =========================================================
   DASHBOARD
========================================================= */

app.get("/", (req, res) => {

  res.send(`

<!DOCTYPE html>

<html lang="pt-BR">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
>

<title>Binance-Robo | Dashboard Premium</title>

<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>

<style>

/* =========================================================
   RESET
========================================================= */

* {

  box-sizing: border-box;

}

body {

  margin: 0;

  font-family:
    Inter,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;

  background:
    radial-gradient(
      circle at 10% 0%,
      #172554 0,
      #080d1c 35%,
      #02040a 100%
    );

  color: #f8fafc;

  min-height: 100vh;

}

/* =========================================================
   HEADER
========================================================= */

.header {

  height: 78px;

  padding:
    0 5%;

  display: flex;

  align-items: center;

  justify-content: space-between;

  border-bottom:
    1px solid rgba(255,255,255,0.07);

  background:
    rgba(2,4,10,0.80);

  backdrop-filter:
    blur(25px);

  position: sticky;

  top: 0;

  z-index: 100;

}

.brand {

  display: flex;

  align-items: center;

  gap: 13px;

}

.logo {

  width: 45px;

  height: 45px;

  border-radius: 14px;

  display: flex;

  align-items: center;

  justify-content: center;

  font-size: 23px;

  background:
    linear-gradient(
      135deg,
      #f59e0b,
      #facc15
    );

  box-shadow:
    0 0 30px
    rgba(250,204,21,0.22);

}

.brand h1 {

  margin: 0;

  font-size: 19px;

}

.brand span {

  color: #64748b;

  font-size: 11px;

}

.status {

  display: flex;

  align-items: center;

  gap: 8px;

  padding:
    8px 14px;

  border-radius: 999px;

  color: #4ade80;

  background:
    rgba(34,197,94,0.09);

  border:
    1px solid rgba(34,197,94,0.20);

  font-size: 12px;

  font-weight: 700;

}

.dot {

  width: 7px;

  height: 7px;

  border-radius: 50%;

  background: #22c55e;

  box-shadow:
    0 0 10px #22c55e;

}

/* =========================================================
   CONTAINER
========================================================= */

.container {

  width: 90%;

  max-width: 1450px;

  margin: auto;

  padding:
    35px 0 60px;

}

/* =========================================================
   HERO
========================================================= */

.hero {

  display: flex;

  align-items: center;

  justify-content: space-between;

  margin-bottom: 28px;

}

.hero h2 {

  margin: 0;

  font-size: 32px;

  letter-spacing: -1.2px;

}

.hero p {

  margin:
    7px 0 0;

  color: #64748b;

  font-size: 13px;

}

.last-update {

  color: #64748b;

  font-size: 11px;

}

/* =========================================================
   CARDS
========================================================= */

.cards {

  display: grid;

  grid-template-columns:
    repeat(4, 1fr);

  gap: 17px;

  margin-bottom: 25px;

}

.card {

  min-height: 145px;

  padding: 23px;

  border-radius: 20px;

  background:
    linear-gradient(
      145deg,
      rgba(255,255,255,0.075),
      rgba(255,255,255,0.025)
    );

  border:
    1px solid rgba(255,255,255,0.08);

  box-shadow:
    0 20px 60px
    rgba(0,0,0,0.22);

  position: relative;

  overflow: hidden;

}

.card::after {

  content: "";

  position: absolute;

  width: 120px;

  height: 120px;

  right: -55px;

  top: -55px;

  border-radius: 50%;

  background:
    rgba(59,130,246,0.12);

  filter: blur(10px);

}

.card-label {

  color: #94a3b8;

  font-size: 12px;

  margin-bottom: 13px;

}

.card-value {

  font-size: 26px;

  font-weight: 800;

  letter-spacing: -0.7px;

}

.card-sub {

  margin-top: 9px;

  color: #64748b;

  font-size: 11px;

}

/* =========================================================
   GRID
========================================================= */

.grid {

  display: grid;

  grid-template-columns:
    1.25fr
    0.75fr;

  gap: 20px;

  margin-bottom: 22px;

}

/* =========================================================
   SECTION
========================================================= */

.section {

  border-radius: 21px;

  overflow: hidden;

  background:
    rgba(15,23,42,0.55);

  border:
    1px solid rgba(255,255,255,0.08);

  backdrop-filter:
    blur(20px);

}

.section-header {

  min-height: 70px;

  padding:
    17px 22px;

  display: flex;

  align-items: center;

  justify-content: space-between;

  border-bottom:
    1px solid rgba(255,255,255,0.06);

}

.section-title {

  font-weight: 750;

  font-size: 15px;

}

.section-subtitle {

  color: #64748b;

  font-size: 10px;

  margin-top: 4px;

}

/* =========================================================
   CHART
========================================================= */

.chart-area {

  height: 330px;

  padding:
    20px;

}

canvas {

  width: 100% !important;

  height: 100% !important;

}

/* =========================================================
   CAMBIO
========================================================= */

.exchange {

  padding: 24px;

}

.exchange-row {

  display: flex;

  justify-content: space-between;

  align-items: center;

  padding:
    13px 0;

  border-bottom:
    1px solid rgba(255,255,255,0.05);

}

.exchange-row:last-child {

  border-bottom: 0;

}

.exchange-label {

  color: #64748b;

  font-size: 12px;

}

.exchange-value {

  font-size: 16px;

  font-weight: 750;

}

.warning {

  margin-top: 15px;

  padding: 10px;

  border-radius: 10px;

  background:
    rgba(245,158,11,0.08);

  border:
    1px solid rgba(245,158,11,0.15);

  color: #fbbf24;

  font-size: 10px;

}

/* =========================================================
   TABLE
========================================================= */

.table-wrapper {

  overflow-x: auto;

}

table {

  width: 100%;

  border-collapse: collapse;

}

th {

  padding:
    15px 20px;

  text-align: left;

  color: #64748b;

  font-size: 10px;

  text-transform: uppercase;

  letter-spacing: .7px;

}

td {

  padding:
    16px 20px;

  border-top:
    1px solid rgba(255,255,255,0.045);

  font-size: 13px;

}

tr:hover {

  background:
    rgba(255,255,255,0.025);

}

.coin {

  display: flex;

  align-items: center;

  gap: 10px;

  font-weight: 750;

}

.coin-icon {

  width: 31px;

  height: 31px;

  border-radius: 50%;

  display: flex;

  align-items: center;

  justify-content: center;

  background:
    rgba(255,255,255,0.07);

  color: #cbd5e1;

  font-size: 9px;

  font-weight: 800;

}

.value {

  font-weight: 700;

}

.muted {

  color: #475569;

}

/* =========================================================
   BUTTON
========================================================= */

button {

  border: 0;

  cursor: pointer;

  padding:
    9px 15px;

  border-radius: 10px;

  color: white;

  font-size: 11px;

  font-weight: 700;

  background:
    linear-gradient(
      135deg,
      #2563eb,
      #7c3aed
    );

  box-shadow:
    0 8px 25px
    rgba(37,99,235,0.22);

}

button:hover {

  transform:
    translateY(-1px);

}

/* =========================================================
   FOOTER
========================================================= */

.footer {

  text-align: center;

  padding:
    30px;

  color: #334155;

  font-size: 10px;

}

/* =========================================================
   RESPONSIVO
========================================================= */

@media(max-width: 1100px) {

  .cards {

    grid-template-columns:
      repeat(2, 1fr);

  }

  .grid {

    grid-template-columns:
      1fr;

  }

}

@media(max-width: 650px) {

  .cards {

    grid-template-columns:
      1fr;

  }

  .hero {

    display: block;

  }

  .last-update {

    margin-top: 10px;

  }

  .container {

    width: 94%;

  }

  .header {

    padding:
      0 3%;

  }

}

/* =========================================================
   LOADING
========================================================= */

.loading {

  padding: 40px;

  text-align: center;

  color: #64748b;

}

</style>

</head>

<body>

<header class="header">

  <div class="brand">

    <div class="logo">
      🤖
    </div>

    <div>

      <h1>Binance-Robo</h1>

      <span>
        Painel de Controle Premium
      </span>

    </div>

  </div>

  <div class="status">

    <span class="dot"></span>

    ONLINE

  </div>

</header>

<main class="container">

<!-- =====================================================
     HERO
===================================================== -->

<section class="hero">

  <div>

    <h2>
      Dashboard
    </h2>

    <p>
      Visão geral da conta Binance.
    </p>

  </div>

  <div
    class="last-update"
    id="ultimaAtualizacao"
  >
    Aguardando atualização...
  </div>

</section>

<!-- =====================================================
     CARDS
===================================================== -->

<section class="cards">

  <div class="card">

    <div class="card-label">
      💰 Patrimônio em USDT
    </div>

    <div
      class="card-value"
      id="patrimonioUSDT"
    >
      --
    </div>

    <div class="card-sub">
      Valor total estimado
    </div>

  </div>

  <div class="card">

    <div class="card-label">
      🇺🇸 Valor em Dólar
    </div>

    <div
      class="card-value"
      id="patrimonioUSD"
    >
      --
    </div>

    <div class="card-sub">
      Aproximado em USD
    </div>

  </div>

  <div class="card">

    <div class="card-label">
      🇧🇷 Valor em Reais
    </div>

    <div
      class="card-value"
      id="patrimonioBRL"
    >
      --
    </div>

    <div class="card-sub">
      Conversão USDT/BRL
    </div>

  </div>

  <div class="card">

    <div class="card-label">
      💼 Ativos
    </div>

    <div
      class="card-value"
      id="totalAtivos"
    >
      --
    </div>

    <div class="card-sub">
      Ativos com saldo
    </div>

  </div>

</section>

<!-- =====================================================
     GRÁFICO + COTAÇÃO
===================================================== -->

<section class="grid">

  <div class="section">

    <div class="section-header">

      <div>

        <div class="section-title">
          📈 Evolução do Patrimônio
        </div>

        <div class="section-subtitle">
          Histórico registrado neste navegador
        </div>

      </div>

      <button onclick="limparHistorico()">
        Limpar
      </button>

    </div>

    <div class="chart-area">

      <canvas id="grafico"></canvas>

    </div>

  </div>

  <div class="section">

    <div class="section-header">

      <div>

        <div class="section-title">
          💱 Conversão
        </div>

        <div class="section-subtitle">
          Cotação utilizada pelo painel
        </div>

      </div>

    </div>

    <div class="exchange">

      <div class="exchange-row">

        <div class="exchange-label">
          1 USDT
        </div>

        <div
          class="exchange-value"
          id="cotacaoBRL"
        >
          --
        </div>

      </div>

      <div class="exchange-row">

        <div class="exchange-label">
          Patrimônio USD
        </div>

        <div
          class="exchange-value"
          id="cambioUSD"
        >
          --
        </div>

      </div>

      <div class="exchange-row">

        <div class="exchange-label">
          Patrimônio BRL
        </div>

        <div
          class="exchange-value"
          id="cambioBRL"
        >
          --
        </div>

      </div>

      <div
        class="warning"
        id="avisoCambio"
        style="display:none"
      >
        ⚠ A cotação BRL está usando uma estimativa.
      </div>

    </div>

  </div>

</section>

<!-- =====================================================
     CARTEIRA
===================================================== -->

<section class="section">

  <div class="section-header">

    <div>

      <div class="section-title">
        💼 Carteira
      </div>

      <div class="section-subtitle">
        Ativos encontrados na conta Binance
      </div>

    </div>

    <button onclick="carregarConta()">
      🔄 Atualizar
    </button>

  </div>

  <div class="table-wrapper">

    <table>

      <thead>

        <tr>

          <th>Ativo</th>

          <th>Quantidade</th>

          <th>Disponível</th>

          <th>Bloqueado</th>

          <th>Preço USDT</th>

          <th>Valor USD</th>

          <th>Valor BRL</th>

        </tr>

      </thead>

      <tbody id="tabela">

        <tr>

          <td
            colspan="7"
            class="loading"
          >
            Carregando dados da Binance...
          </td>

        </tr>

      </tbody>

    </table>

  </div>

</section>

</main>

<footer class="footer">

  Binance-Robo Panel Premium
  • Consulta somente leitura
  • Dados atualizados automaticamente

</footer>

<script>

/* =========================================================
   FORMATADORES
========================================================= */

function numero(valor, casas) {

  if (casas === undefined) {
    casas = 8;
  }

  return Number(valor || 0)
    .toLocaleString(
      "pt-BR",
      {
        minimumFractionDigits: 0,
        maximumFractionDigits: casas
      }
    );

}

function dolar(valor) {

  return Number(valor || 0)
    .toLocaleString(
      "en-US",
      {
        style: "currency",
        currency: "USD"
      }
    );

}

function real(valor) {

  return Number(valor || 0)
    .toLocaleString(
      "pt-BR",
      {
        style: "currency",
        currency: "BRL"
      }
    );

}

/* =========================================================
   HISTÓRICO
========================================================= */

function obterHistorico() {

  try {

    return JSON.parse(
      localStorage.getItem(
        "binanceRoboHistorico"
      ) || "[]"
    );

  } catch {

    return [];

  }

}

function salvarHistorico(valor) {

  const historico =
    obterHistorico();

  historico.push({

    hora:
      new Date().toLocaleTimeString(
        "pt-BR",
        {
          hour: "2-digit",
          minute: "2-digit"
        }
      ),

    valor:
      Number(valor || 0)

  });

  /*
    Mantemos no máximo 30 pontos.
  */

  const limite =
    historico.slice(-30);

  localStorage.setItem(
    "binanceRoboHistorico",
    JSON.stringify(limite)
  );

  return limite;

}

/* =========================================================
   GRÁFICO
========================================================= */

let grafico = null;

function atualizarGrafico(historico) {

  const canvas =
    document.getElementById(
      "grafico"
    );

  const labels =
    historico.map(
      item => item.hora
    );

  const valores =
    historico.map(
      item => item.valor
    );

  if (grafico) {

    grafico.destroy();

  }

  grafico =
    new Chart(
      canvas,
      {

        type: "line",

        data: {

          labels,

          datasets: [

            {

              label:
                "Patrimônio (USDT)",

              data:
                valores,

              tension: 0.35,

              fill: true,

              borderWidth: 2,

              pointRadius: 3

            }

          ]

        },

        options: {

          responsive: true,

          maintainAspectRatio: false,

          plugins: {

            legend: {

              display: false

            },

            tooltip: {

              callbacks: {

                label:
                  function(context) {

                    return (
                      " " +
                      dolar(
                        context.raw
                      )
                    );

                  }

              }

            }

          },

          scales: {

            x: {

              grid: {

                display: false

              },

              ticks: {

                color: "#64748b",

                maxTicksLimit: 6

              }

            },

            y: {

              grid: {

                color:
                  "rgba(255,255,255,0.05)"

              },

              ticks: {

                color: "#64748b",

                callback:
                  function(value) {

                    return "$ " +
                      Number(value)
                        .toLocaleString(
                          "en-US",
                          {
                            maximumFractionDigits: 2
                          }
                        );

                  }

              }

            }

          }

        }

      }

    );

}

/* =========================================================
   LIMPAR HISTÓRICO
========================================================= */

function limparHistorico() {

  localStorage.removeItem(
    "binanceRoboHistorico"
  );

  atualizarGrafico([]);

}

/* =========================================================
   CARREGAR CONTA
========================================================= */

async function carregarConta() {

  const tabela =
    document.getElementById(
      "tabela"
    );

  try {

    tabela.innerHTML =
      '<tr><td colspan="7" class="loading">Atualizando dados...</td></tr>';

    const resposta =
      await fetch(
        "/api/account"
      );

    const dados =
      await resposta.json();

    if (
      dados.status !== "ok"
    ) {

      throw new Error(
        dados.mensagem ||
        "Erro ao consultar conta."
      );

    }

    /* =====================================================
       PATRIMÔNIO
    ===================================================== */

    document.getElementById(
      "patrimonioUSDT"
    ).textContent =
      numero(
        dados.patrimonio.usdt,
        2
      ) +
      " USDT";

    document.getElementById(
      "patrimonioUSD"
    ).textContent =
      dolar(
        dados.patrimonio.usd
      );

    document.getElementById(
      "patrimonioBRL"
    ).textContent =
      real(
        dados.patrimonio.brl
      );

    document.getElementById(
      "totalAtivos"
    ).textContent =
      dados.totalAtivos;

    /* =====================================================
       COTAÇÃO
    ===================================================== */

    document.getElementById(
      "cotacaoBRL"
    ).textContent =
      real(
        dados.cambio.usdtBRL
      );

    document.getElementById(
      "cambioUSD"
    ).textContent =
      dolar(
        dados.patrimonio.usd
      );

    document.getElementById(
      "cambioBRL"
    ).textContent =
      real(
        dados.patrimonio.brl
      );

    const aviso =
      document.getElementById(
        "avisoCambio"
      );

    if (
      dados.cambio.estimada
    ) {

      aviso.style.display =
        "block";

    } else {

      aviso.style.display =
        "none";

    }

    /* =====================================================
       DATA
    ===================================================== */

    document.getElementById(
      "ultimaAtualizacao"
    ).textContent =
      "Atualizado às " +
      new Date()
        .toLocaleTimeString(
          "pt-BR"
        );

    /* =====================================================
       HISTÓRICO
    ===================================================== */

    const historico =
      salvarHistorico(
        dados.patrimonio.usdt
      );

    atualizarGrafico(
      historico
    );

    /* =====================================================
       TABELA
    ===================================================== */

    if (
      !dados.saldos ||
      dados.saldos.length === 0
    ) {

      tabela.innerHTML =
        '<tr><td colspan="7" class="loading">Nenhum ativo encontrado.</td></tr>';

      return;

    }

    tabela.innerHTML =
      dados.saldos
        .map(
          function(asset) {

            const preco =
              asset.precoUSDT > 0

                ? dolar(
                    asset.precoUSDT
                  )

                : '<span class="muted">--</span>';

            const valorUSD =
              asset.valorUSD > 0

                ? dolar(
                    asset.valorUSD
                  )

                : '<span class="muted">--</span>';

            const valorBRL =
              asset.valorBRL > 0

                ? real(
                    asset.valorBRL
                  )

                : '<span class="muted">--</span>';

            const icone =
              asset.base
                .substring(0, 2)
                .toUpperCase();

            return (

              "<tr>" +

                "<td>" +

                  '<div class="coin">' +

                    '<div class="coin-icon">' +

                      icone +

                    "</div>" +

                    asset.base +

                  "</div>" +

                "</td>" +

                "<td>" +

                  numero(
                    asset.quantidade
                  ) +

                "</td>" +

                "<td>" +

                  numero(
                    asset.free
                  ) +

                "</td>" +

                "<td>" +

                  numero(
                    asset.locked
                  ) +

                "</td>" +

                "<td>" +

                  preco +

                "</td>" +

                "<td class='value'>" +

                  valorUSD +

                "</td>" +

                "<td class='value'>" +

                  valorBRL +

                "</td>" +

              "</tr>"

            );

          }
        )
        .join("");

  } catch (erro) {

    console.error(
      erro
    );

    tabela.innerHTML =

      "<tr>" +

        '<td colspan="7" class="loading">' +

          "❌ Erro ao carregar dados da Binance." +

          "<br><br>" +

          erro.message +

        "</td>" +

      "</tr>";

  }

}

/* =========================================================
   INICIAR
========================================================= */

const historicoInicial =
  obterHistorico();

atualizarGrafico(
  historicoInicial
);

carregarConta();

/* =========================================================
   ATUALIZAÇÃO AUTOMÁTICA
========================================================= */

setInterval(
  carregarConta,
  60000
);

</script>

</body>

</html>

  `);

});

/* =========================================================
   SERVIDOR
========================================================= */

app.listen(PORT, () => {

  console.log(
    "Painel Binance-Robo rodando na porta " +
    PORT
  );

});
