require("dotenv").config();
const Binance = require("binance-api-node").default;
const express = require("express");

const app = express();

const client = Binance({
  apiKey: process.env.BINANCE_API_KEY,
  apiSecret: process.env.BINANCE_API_SECRET,
  recvWindow: 60000
});

const PORT = process.env.PORT || 3000;

/* ================= CONFIG ================= */

const USAR_PERCENTUAL_SALDO = true;
const PERCENTUAL_ENTRADA = 0.90;
const INVESTIMENTO_FIXO = 19;

const TAKE_PROFIT = 0.05;
const STOP_LOSS = 0.03;

const INTERVALO_ANALISE = 120000;
const TIMEFRAME = "5m";

let operando = false;
let simboloAtual = null;
let precoEntradaGlobal = 0;

/* ================= AUX ================= */

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* ================= STATUS CONTA ================= */

async function obterStatusConta() {
  const conta = await client.accountInfo();

  const usdt = conta.balances.find(b => b.asset === "USDT");
  const saldoUSDT = parseFloat(usdt.free);

  let totalEstimado = saldoUSDT;
  let lucroUSDT = 0;
  let lucroPercent = 0;

  for (let ativo of conta.balances) {
    if (parseFloat(ativo.free) > 0 && ativo.asset !== "USDT") {
      const symbol = ativo.asset + "USDT";

      try {
        const price = await client.prices({ symbol });
        const valor = parseFloat(ativo.free) * parseFloat(price[symbol]);
        totalEstimado += valor;

        if (symbol === simboloAtual && precoEntradaGlobal > 0) {
          const valorEntrada = parseFloat(ativo.free) * precoEntradaGlobal;
          lucroUSDT = valor - valorEntrada;
          lucroPercent = ((valor / valorEntrada - 1) * 100);
        }

      } catch {}
    }
  }

  return {
    usdt_livre: saldoUSDT.toFixed(2),
    total_estimado_usdt: totalEstimado.toFixed(2),
    posicao_aberta: simboloAtual,
    lucro_prejuizo_percentual: lucroPercent.toFixed(2),
    lucro_prejuizo_usdt: lucroUSDT.toFixed(2)
  };
}

/* ================= EXECUTAR COMPRA ================= */

async function executarCompra(symbol) {
  try {
    operando = true;

    const ticker = await client.prices({ symbol });
    const precoEntrada = parseFloat(ticker[symbol]);

    const saldo = await client.accountInfo();
    const usdt = saldo.balances.find(b => b.asset === "USDT");
    const saldoDisponivel = parseFloat(usdt.free);

    const valorCompra = USAR_PERCENTUAL_SALDO
      ? saldoDisponivel * PERCENTUAL_ENTRADA
      : INVESTIMENTO_FIXO;

    let quantidade = valorCompra / precoEntrada;
    quantidade = parseFloat(quantidade.toFixed(6));

    await client.order({
      symbol,
      side: "BUY",
      type: "MARKET",
      quantity: quantidade
    });

    console.log("✅ Compra executada");

    simboloAtual = symbol;
    precoEntradaGlobal = precoEntrada;

    const precoTP = (precoEntrada * (1 + TAKE_PROFIT)).toFixed(5);
    const precoSL = (precoEntrada * (1 - STOP_LOSS)).toFixed(5);
    const precoSLTrigger = (precoEntrada * (1 - STOP_LOSS * 0.9)).toFixed(5);

    await client.orderOco({
      symbol,
      side: "SELL",
      quantity: quantidade,
      price: precoTP,
      stopPrice: precoSLTrigger,
      stopLimitPrice: precoSL,
      stopLimitTimeInForce: "GTC"
    });

    console.log("📌 OCO enviado (TP + SL)");

  } catch (err) {
    console.log("Erro na compra:", err.message);
  } finally {
    operando = false;
  }
}

/* ================= LOOP ================= */

async function iniciarRobo() {
  while (true) {
    try {
      if (!operando) {
        // sua lógica de entrada permanece aqui
      }
    } catch (err) {
      console.log("Erro geral:", err.message);
    }

    await sleep(INTERVALO_ANALISE);
  }
}

/* ================= ROTAS ================= */

app.get("/", (req, res) => {
  res.send("🚀 ROBO BINANCE ONLINE");
});

app.get("/status", async (req, res) => {
  const status = await obterStatusConta();
  res.json(status);
});

app.listen(PORT, () => {
  console.log("🔥 ROBÔ EMA 9/21 + RSI + OCO INICIADO");
  console.log("🌐 Rodando na porta:", PORT);
  iniciarRobo();
});