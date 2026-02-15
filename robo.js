require('dotenv').config()

// 🔎 TESTE SE A API ESTÁ SENDO LIDA
console.log("API KEY:", process.env.BINANCE_API_KEY ? "OK" : "NÃO LIDA")
console.log("API SECRET:", process.env.BINANCE_API_SECRET ? "OK" : "NÃO LIDA")

const Binance = require('binance-api-node').default

const client = Binance({
    apiKey: process.env.BINANCE_API_KEY,
    apiSecret: process.env.BINANCE_API_SECRET,
    recvWindow: 60000
})

/* ================= CONFIG ================= */

const USAR_PERCENTUAL_SALDO = true      // usar % do saldo
const PERCENTUAL_ENTRADA = 0.90         // 90% do saldo
const INVESTIMENTO_FIXO = 19            // só usado se USAR_PERCENTUAL_SALDO = false

const TAKE_PROFIT = 0.05                // 5% lucro
const STOP_LOSS = 0.03                  // 3% stop

const SCORE_MINIMO = 80
const INTERVALO_ANALISE = 120000        // 2 minutos
const TIMEFRAME = '5m'
const VOLUME_MINIMO = 500000

/* ================= AUXILIARES ================= */

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function calcularEMA(values, period) {
    const k = 2 / (period + 1)
    let ema = [values[0]]

    for (let i = 1; i < values.length; i++) {
        ema.push(values[i] * k + ema[i - 1] * (1 - k))
    }

    return ema
}

function calcularRSI(values, period = 14) {
    let gains = []
    let losses = []

    for (let i = 1; i < values.length; i++) {
        const diff = values[i] - values[i - 1]
        gains.push(diff > 0 ? diff : 0)
        losses.push(diff < 0 ? Math.abs(diff) : 0)
    }

    const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period
    const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period

    if (avgLoss === 0) return 100

    const rs = avgGain / avgLoss
    return 100 - (100 / (1 + rs))
}

/* ================= SALDO ================= */

async function obterValorEntrada() {
    if (!USAR_PERCENTUAL_SALDO) {
        return INVESTIMENTO_FIXO
    }

    const account = await client.accountInfo()
    const usdt = account.balances.find(b => b.asset === 'USDT')

    const saldo = parseFloat(usdt.free)

    const valor = saldo * PERCENTUAL_ENTRADA

    console.log("💰 Saldo USDT:", saldo.toFixed(2))
    console.log("💰 Valor entrada (90%):", valor.toFixed(2))

    return valor
}