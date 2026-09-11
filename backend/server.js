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
   CONTA BINANCE
========================================================= */

app.get("/api/account", async (req, res) => {

  try {

    const account = await client.accountInfo();
    const balances = account.balances || [];

    const ativos = balances
      .filter(balance =>
        Number(balance.free) > 0 ||
        Number(balance.locked) > 0
      )
      .map(balance => ({
        asset: balance.asset,
        free: Number(balance.free),
        locked: Number(balance.locked)
      }));

    let prices = {};

    try {
      prices = await client.prices();
    } catch (priceError) {
      console.log(
        "Aviso: preços indisponíveis:",
        priceError.message
      );
    }

    let patrimonioUSDT = 0;

    const saldos = ativos.map(asset => {

      const quantidade =
        asset.free + asset.locked;

      let precoUSDT = 0;
      let valorUSDT = 0;

      if (asset.asset === "USDT") {

        precoUSDT = 1;
        valorUSDT = quantidade;

      } else {

        const par = asset.asset + "USDT";

        if (prices[par]) {
          precoUSDT = Number(prices[par]);
          valorUSDT = quantidade * precoUSDT;
        }
      }

      patrimonioUSDT += valorUSDT;

      return {
        asset: asset.asset,
        free: asset.free,
        locked: asset.locked,
        quantidade,
        precoUSDT,
        valorUSDT
      };

    });

    const usdt =
      saldos.find(item => item.asset === "USDT") || {
        asset: "USDT",
        free: 0,
        locked: 0,
        quantidade: 0,
        precoUSDT: 1,
        valorUSDT: 0
      };

    res.json({

      status: "ok",

      conta: {
        canTrade: account.canTrade,
        canWithdraw: account.canWithdraw,
        canDeposit: account.canDeposit
      },

      usdt,

      patrimonioUSDT,

      totalAtivos: saldos.length,

      saldos

    });

  } catch (error) {

    console.error(
      "Erro ao consultar Binance:",
      error.message
    );

    res.status(500).json({
      status: "error",
      mensagem: "Não foi possível consultar a conta Binance."
    });

  }

});

/* =========================================================
   DASHBOARD
========================================================= */

app.get("/", async (req, res) => {

  res.send(`
<!DOCTYPE html>

<html lang="pt-BR">

<head>

<meta charset="UTF-8">

<meta name="viewport"
      content="width=device-width, initial-scale=1.0">

<title>Binance-Robo | Dashboard</title>

<style>

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
      circle at top left,
      #172554 0,
      #070b17 40%,
      #03050a 100%
    );

  color: #f8fafc;

  min-height: 100vh;

}

.header {

  display: flex;

  justify-content: space-between;

  align-items: center;

  padding: 22px 5%;

  border-bottom:
    1px solid rgba(255,255,255,0.08);

  background:
    rgba(3,5,10,0.75);

  backdrop-filter: blur(20px);

}

.brand {

  display: flex;

  align-items: center;

  gap: 14px;

}

.logo {

  width: 50px;

  height: 50px;

  border-radius: 15px;

  display: flex;

  align-items: center;

  justify-content: center;

  font-size: 25px;

  background:
    linear-gradient(
      135deg,
      #f59e0b,
      #facc15
    );

  box-shadow:
    0 0 30px rgba(250,204,21,0.25);

}

.brand h1 {

  margin: 0;

  font-size: 21px;

}

.brand span {

  display: block;

  margin-top: 3px;

  color: #94a3b8;

  font-size: 12px;

}

.status {

  display: flex;

  align-items: center;

  gap: 8px;

  padding: 9px 15px;

  border-radius: 999px;

  background:
    rgba(34,197,94,0.10);

  border:
    1px solid rgba(34,197,94,0.25);

  color: #4ade80;

  font-size: 13px;

  font-weight: 700;

}

.dot {

  width: 8px;

  height: 8px;

  border-radius: 50%;

  background: #22c55e;

  box-shadow:
    0 0 12px #22c55e;

}

.container {

  width: 90%;

  max-width: 1400px;

  margin: auto;

  padding: 35px 0 60px;

}

.hero {

  margin-bottom: 28px;

}

.hero h2 {

  margin: 0;

  font-size: 32px;

  letter-spacing: -1px;

}

.hero p {

  color: #94a3b8;

  margin-top: 8px;

}

.cards {

  display: grid;

  grid-template-columns:
    repeat(3, 1fr);

  gap: 18px;

  margin-bottom: 30px;

}

.card {

  padding: 25px;

  border-radius: 20px;

  background:
    linear-gradient(
      145deg,
      rgba(255,255,255,0.08),
      rgba(255,255,255,0.025)
    );

  border:
    1px solid rgba(255,255,255,0.08);

  box-shadow:
    0 20px 60px rgba(0,0,0,0.25);

}

.card-label {

  color: #94a3b8;

  font-size: 13px;

  margin-bottom: 10px;

}

.card-value {

  font-size: 30px;

  font-weight: 700;

}

.card-small {

  margin-top: 8px;

  color: #64748b;

  font-size: 12px;

}

.section {

  border:
    1px solid rgba(255,255,255,0.08);

  border-radius: 22px;

  overflow: hidden;

  background:
    rgba(15,23,42,0.55);

  backdrop-filter: blur(20px);

}

.section-header {

  padding: 22px 25px;

  display: flex;

  align-items: center;

  justify-content: space-between;

  border-bottom:
    1px solid rgba(255,255,255,0.07);

}

.section-title {

  font-size: 17px;

  font-weight: 700;

}

.update {

  margin-top: 4px;

  color: #64748b;

  font-size: 12px;

}

button {

  border: 0;

  cursor: pointer;

  padding: 11px 18px;

  border-radius: 11px;

  color: white;

  font-weight: 700;

  background:
    linear-gradient(
      135deg,
      #2563eb,
      #7c3aed
    );

  box-shadow:
    0 8px 25px rgba(37,99,235,0.25);

}

button:hover {

  transform: translateY(-1px);

}

.table-wrapper {

  overflow-x: auto;

}

table {

  width: 100%;

  border-collapse: collapse;

}

th {

  text-align: left;

  padding: 16px 25px;

  color: #64748b;

  font-size: 11px;

  text-transform: uppercase;

}

td {

  padding: 17px 25px;

  border-top:
    1px solid rgba(255,255,255,0.05);

  font-size: 14px;

}

tr:hover {

  background:
    rgba(255,255,255,0.025);

}

.coin {

  display: flex;

  align-items: center;

  gap: 10px;

  font-weight: 700;

}

.coin-icon {

  width: 32px;

  height: 32px;

  border-radius: 50%;

  display: flex;

  align-items: center;

  justify-content: center;

  background:
    rgba(255,255,255,0.08);

  font-size: 11px;

}

.value {

  font-weight: 700;

}

.muted {

  color: #64748b;

}

.loading {

  padding: 45px;

  text-align: center;

  color: #64748b;

}

.footer {

  text-align: center;

  padding: 30px;

  color: #475569;

  font-size: 11px;

}

@media (max-width: 800px) {

  .cards {
    grid-template-columns: 1fr;
  }

  .header {
    padding: 18px;
  }

  .container {
    width: 94%;
  }

  .hero h2 {
    font-size: 25px;
  }

}

</style>

</head>

<body>

<header class="header">

  <div class="brand">

    <div class="logo">🤖</div>

    <div>

      <h1>Binance-Robo</h1>

      <span>Painel de Controle</span>

    </div>

  </div>

  <div class="status">

    <span class="dot"></span>

    ONLINE

  </div>

</header>

<main class="container">

<section class="hero">

  <h2>Dashboard</h2>

  <p>
    Visão geral da conta Binance em tempo real.
  </p>

</section>

<section class="cards">

  <div class="card">

    <div class="card-label">
      💰 Saldo disponível
    </div>

    <div class="card-value" id="saldoUSDT">
      Carregando...
    </div>

    <div class="card-small">
      USDT disponível
    </div>

  </div>

  <div class="card">

    <div class="card-label">
      📊 Patrimônio estimado
    </div>

    <div class="card-value" id="patrimonio">
      Carregando...
    </div>

    <div class="card-small">
      Valor estimado em USDT
    </div>

  </div>

  <div class="card">

    <div class="card-label">
      💼 Ativos
    </div>

    <div class="card-value" id="totalAtivos">
      --
    </div>

    <div class="card-small">
      Ativos com saldo
    </div>

  </div>

</section>

<section class="section">

  <div class="section-header">

    <div>

      <div class="section-title">
        Carteira
      </div>

      <div class="update" id="ultimaAtualizacao">
        Aguardando atualização...
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

          <th>Valor estimado</th>

        </tr>

      </thead>

      <tbody id="tabela">

        <tr>

          <td colspan="6" class="loading">

            Carregando dados da Binance...

          </td>

        </tr>

      </tbody>

    </table>

  </div>

</section>

</main>

<footer class="footer">

  Binance-Robo Panel • Consulta segura somente leitura

</footer>

<script>

function numero(valor, casas) {

  if (casas === undefined) {
    casas = 8;
  }

  return Number(valor || 0).toLocaleString(
    "pt-BR",
    {
      minimumFractionDigits: 0,
      maximumFractionDigits: casas
    }
  );

}

function dinheiro(valor) {

  return Number(valor || 0).toLocaleString(
    "pt-BR",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }
  );

}

async function carregarConta() {

  const tabela =
    document.getElementById("tabela");

  try {

    tabela.innerHTML =
      '<tr><td colspan="6" class="loading">Atualizando dados...</td></tr>';

    const resposta =
      await fetch("/api/account");

    const dados =
      await resposta.json();

    if (dados.status !== "ok") {

      throw new Error(
        dados.mensagem ||
        "Erro ao consultar conta."
      );

    }

    document.getElementById(
      "saldoUSDT"
    ).textContent =
      "$ " + dinheiro(dados.usdt.free);

    document.getElementById(
      "patrimonio"
    ).textContent =
      "$ " + dinheiro(dados.patrimonioUSDT);

    document.getElementById(
      "totalAtivos"
    ).textContent =
      dados.totalAtivos;

    document.getElementById(
      "ultimaAtualizacao"
    ).textContent =
      "Última atualização: " +
      new Date().toLocaleTimeString("pt-BR");

    if (
      !dados.saldos ||
      dados.saldos.length === 0
    ) {

      tabela.innerHTML =
        '<tr><td colspan="6" class="loading">Nenhum ativo com saldo encontrado.</td></tr>';

      return;

    }

    tabela.innerHTML =
      dados.saldos.map(function(asset) {

        const valor =
          asset.valorUSDT > 0
            ? "$ " + dinheiro(asset.valorUSDT)
            : '<span class="muted">--</span>';

        const preco =
          asset.precoUSDT > 0
            ? "$ " + numero(asset.precoUSDT, 8)
            : '<span class="muted">--</span>';

        const icone =
          asset.asset.substring(0, 2);

        return (
          '<tr>' +

          '<td>' +
            '<div class="coin">' +
              '<div class="coin-icon">' +
                icone +
              '</div>' +
              asset.asset +
            '</div>' +
          '</td>' +

          '<td>' +
            numero(asset.quantidade) +
          '</td>' +

          '<td>' +
            numero(asset.free) +
          '</td>' +

          '<td>' +
            numero(asset.locked) +
          '</td>' +

          '<td>' +
            preco +
          '</td>' +

          '<td class="value">' +
            valor +
          '</td>' +

          '</tr>'
        );

      }).join("");

  } catch (erro) {

    console.error(erro);

    tabela.innerHTML =
      '<tr>' +
        '<td colspan="6" class="loading">' +
          '❌ Erro ao carregar dados da Binance.<br><br>' +
          erro.message +
        '</td>' +
      '</tr>';

  }

}

carregarConta();

setInterval(
  carregarConta,
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

app.listen(PORT, () => {

  console.log(
    `Painel backend rodando na porta ${PORT}`
  );

});
