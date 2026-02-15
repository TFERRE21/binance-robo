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

const SCORE_MINIMO = 80;
const INTERVALO_ANALISE = 120000; // 2 minutos
const TIMEFRAME = "5m";
const MAX_MOEDAS = 35;

/* =========================================== */

let operando = false;

/* ================= AUX ================= */

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function calcularEMA(values, period) {
    const k = 2 / (period + 1);
    let ema = [values[0]];

    for (let i = 1; i < values.length; i++) {
        ema.push(values[i] * k + ema[i - 1] * (1 - k));
    }

    return ema;
}

function calcularRSI(closes, period = 14) {
    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff >= 0) gains += diff;
        else losses -= diff;
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

/* ================= COMPRA + OCO ================= */

async function executarCompra(symbol) {
    try {
        operando = true;

        console.log(`🚀 Comprando ${symbol}...`);

        const precoAtual = (await client.prices({ symbol }))[symbol];

        let valorEntrada;

        if (USAR_PERCENTUAL_SALDO) {
            const account = await client.accountInfo();
            const usdtBalance = account.balances.find(b => b.asset === "USDT");
            const saldoUSDT = parseFloat(usdtBalance.free);
            valorEntrada = saldoUSDT * PERCENTUAL_ENTRADA;
        } else {
            valorEntrada = INVESTIMENTO_FIXO;
        }

        valorEntrada = parseFloat(valorEntrada.toFixed(2));

        if (valorEntrada < 10) {
            console.log("❌ Valor menor que mínimo da Binance");
            operando = false;
            return;
        }

        await client.order({
            symbol,
            side: "BUY",
            type: "MARKET",
            quoteOrderQty: valorEntrada
        });

        console.log("✅ Compra executada");

        await sleep(2000);

        const asset = symbol.replace("USDT", "");
        const accountInfo = await client.accountInfo();
        const balanceObj = accountInfo.balances.find(b => b.asset === asset);

        let quantidadeReal = parseFloat(balanceObj.free);

        if (!quantidadeReal || quantidadeReal <= 0) {
            console.log("❌ Nenhum saldo encontrado para OCO");
            operando = false;
            return;
        }

        quantidadeReal = parseFloat(quantidadeReal.toFixed(6));

        const precoEntrada = parseFloat(precoAtual);

        const precoTP = (precoEntrada * (1 + TAKE_PROFIT)).toFixed(5);
        const precoSL = (precoEntrada * (1 - STOP_LOSS)).toFixed(5);
        const precoSLTrigger = (precoEntrada * (1 - STOP_LOSS * 0.9)).toFixed(5);

        console.log(`🎯 TP: ${precoTP}`);
        console.log(`🛑 SL: ${precoSL}`);

        await client.orderOco({
            symbol,
            side: "SELL",
            quantity: quantidadeReal,
            price: precoTP,
            stopPrice: precoSLTrigger,
            stopLimitPrice: precoSL,
            stopLimitTimeInForce: "GTC"
        });

        console.log("📤 OCO enviado (TP + SL)");

    } catch (err) {
        console.log("❌ Erro na compra:", err.message);
    } finally {
        operando = false;
    }
}

/* ================= ANALISE ================= */

async function analisarMoeda(symbol) {
    try {
        const candles = await client.candles({
            symbol,
            interval: TIMEFRAME,
            limit: 30
        });

        const closes = candles.map(c => parseFloat(c.close));

        const ema9 = calcularEMA(closes, 9);
        const ema21 = calcularEMA(closes, 21);

        const rsi = calcularRSI(closes);

        const ema9Atual = ema9[ema9.length - 1];
        const ema21Atual = ema21[ema21.length - 1];

        console.log(`${symbol} | EMA9:${ema9Atual.toFixed(4)} EMA21:${ema21Atual.toFixed(4)} RSI:${rsi.toFixed(2)}`);

        if (ema9Atual > ema21Atual && rsi < 35) {
            return true;
        }

        return false;

    } catch (err) {
        console.log("Erro análise:", err.message);
        return false;
    }
}

/* ================= LOOP ================= */

async function iniciarRobo() {
    while (true) {
        if (!operando) {
            try {
                const prices = await client.prices();
                const pares = Object.keys(prices)
                    .filter(p => p.endsWith("USDT"))
                    .slice(0, MAX_MOEDAS);

                for (let par of pares) {
                    const entrada = await analisarMoeda(par);
                    if (entrada) {
                        await executarCompra(par);
                        break;
                    }
                }

            } catch (err) {
                console.log("Erro geral:", err.message);
            }
        }

        await sleep(INTERVALO_ANALISE);
    }
}

/* ================= SERVER ================= */

app.get("/", (req, res) => {
    res.send("🚀 ROBO BINANCE ONLINE");
});

app.listen(PORT, () => {
    console.log("🔥 ROBÔ EMA 9/21 + RSI + OCO INICIADO");
    console.log("🌍 Rodando na porta:", PORT);
    iniciarRobo();
});