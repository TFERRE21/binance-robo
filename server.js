require("dotenv").config()
const Binance = require("binance-api-node").default
const express = require("express")

const app = express()

const client = Binance({
    apiKey: process.env.BINANCE_API_KEY,
    apiSecret: process.env.BINANCE_API_SECRET,
})

const PORT = process.env.PORT || 3000

// ================= CONFIG =================

const TIMEFRAME = "5m"
const TAKE_PROFIT = 0.05
const STOP_LOSS = 0.03
const INTERVALO_ANALISE = 120000
const MAX_MOEDAS = 40
const PERCENTUAL_ENTRADA = 0.90

let operando = false

// ================= AUX =================

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function calcularEMA(periodo, valores) {
    const k = 2 / (periodo + 1)
    let ema = [valores[0]]
    for (let i = 1; i < valores.length; i++) {
        ema.push(valores[i] * k + ema[i - 1] * (1 - k))
    }
    return ema
}

function calcularRSI(periodo, closes) {
    let ganhos = 0
    let perdas = 0

    for (let i = 1; i <= periodo; i++) {
        const diferenca = closes[i] - closes[i - 1]
        if (diferenca >= 0) ganhos += diferenca
        else perdas -= diferenca
    }

    const mediaGanhos = ganhos / periodo
    const mediaPerdas = perdas / periodo

    if (mediaPerdas === 0) return 100

    const rs = mediaGanhos / mediaPerdas
    return 100 - (100 / (1 + rs))
}

async function mostrarSaldo() {
    const conta = await client.accountInfo()
    const usdt = conta.balances.find(b => b.asset === "USDT")
    console.log(`💰 Saldo USDT: ${parseFloat(usdt.free).toFixed(2)}`)
}

// ================= COMPRA + OCO =================

async function executarCompra(symbol) {

    try {
        operando = true

        const conta = await client.accountInfo()
        const usdt = conta.balances.find(b => b.asset === "USDT")

        const saldoUSDT = parseFloat(usdt.free)
        const valorEntrada = saldoUSDT * PERCENTUAL_ENTRADA

        if (valorEntrada < 10) {
            console.log("❌ Saldo insuficiente")
            operando = false
            return
        }

        const precoAtual = await client.prices({ symbol })
        const preco = parseFloat(precoAtual[symbol])

        const quantidade = (valorEntrada / preco).toFixed(5)

        console.log(`🚀 Comprando ${symbol}`)
        console.log(`💵 Entrada: ${valorEntrada.toFixed(2)} USDT`)

        await client.order({
            symbol,
            side: "BUY",
            type: "MARKET",
            quantity: quantidade
        })

        await sleep(2000)

        const contaAtualizada = await client.accountInfo()
        const asset = symbol.replace("USDT", "")
        const moeda = contaAtualizada.balances.find(b => b.asset === asset)

        const saldoMoeda = parseFloat(moeda.free)

        const precoTP = (preco * (1 + TAKE_PROFIT)).toFixed(5)
        const precoSL = (preco * (1 - STOP_LOSS)).toFixed(5)
        const precoSLTrigger = (preco * (1 - STOP_LOSS * 0.9)).toFixed(5)

        console.log(`🎯 TP: ${precoTP}`)
        console.log(`🛑 SL: ${precoSL}`)

        await client.orderOco({
            symbol,
            side: "SELL",
            quantity: saldoMoeda.toFixed(5),
            price: precoTP,
            stopPrice: precoSLTrigger,
            stopLimitPrice: precoSL,
            stopLimitTimeInForce: "GTC"
        })

        console.log("✅ OCO criado com sucesso")

    } catch (err) {
        console.log("❌ Erro na compra:", err.message)
    }

    operando = false
}

// ================= ROBÔ =================

async function iniciarRobo() {

    while (true) {

        try {

            await mostrarSaldo()

            const tickers = await client.dailyStats()
            const pares = tickers
                .filter(p => p.symbol.endsWith("USDT"))
                .slice(0, MAX_MOEDAS)

            for (let par of pares) {

                if (operando) break

                try {

                    const candles = await client.candles({
                        symbol: par.symbol,
                        interval: TIMEFRAME,
                        limit: 30
                    })

                    const closes = candles.map(c => parseFloat(c.close))

                    const ema9 = calcularEMA(9, closes)
                    const ema21 = calcularEMA(21, closes)
                    const rsi = calcularRSI(14, closes.slice(-15))

                    const ema9Atual = ema9[ema9.length - 1]
                    const ema21Atual = ema21[ema21.length - 1]

                    console.log(`${par.symbol} | EMA9: ${ema9Atual.toFixed(4)} EMA21: ${ema21Atual.toFixed(4)} RSI: ${rsi.toFixed(2)}`)

                    if (ema9Atual > ema21Atual && rsi < 35) {
                        await executarCompra(par.symbol)
                        break
                    }

                } catch (err) {
                    console.log(`Erro analisando ${par.symbol}:`, err.message)
                    continue
                }
            }

        } catch (err) {
            console.log("Erro geral:", err.message)
        }

        await sleep(INTERVALO_ANALISE)
    }
}

// ================= SERVIDOR =================

app.get("/", (req, res) => {
    res.send("🤖 ROBÔ BINANCE ONLINE")
})

app.listen(PORT, () => {
    console.log("🔥 ROBÔ EMA 9/21 + RSI + OCO INICIADO")
    console.log("🌐 Rodando na porta:", PORT)
    iniciarRobo()
})