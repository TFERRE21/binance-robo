require("dotenv").config()
const Binance = require("node-binance-api")

const client = new Binance().options({
    APIKEY: process.env.API_KEY,
    APISECRET: process.env.API_SECRET,
    useServerTime: true,
    recvWindow: 60000
})

const PORT = process.env.PORT || 3000

// ================= CONFIG =================
const INTERVAL = "5m"
const USAR_SALDO_PERCENTUAL = 0.90
const TAKE_PROFIT = 1.05
const STOP_LOSS = 0.97
const LIMITE_MOEDAS = 35

// Excluir TOP 10
const EXCLUIR = [
    "BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT",
    "XRPUSDT","ADAUSDT","DOGEUSDT","TRXUSDT",
    "TONUSDT","DOTUSDT"
]

let operando = false

// ================= INDICADORES =================

function calcularEMA(periodo, valores) {
    const k = 2 / (periodo + 1)
    let ema = valores[0]

    for (let i = 1; i < valores.length; i++) {
        ema = valores[i] * k + ema * (1 - k)
    }
    return ema
}

function calcularRSI(periodo, closes) {
    let ganhos = 0
    let perdas = 0

    for (let i = 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1]
        if (diff >= 0) ganhos += diff
        else perdas -= diff
    }

    if (perdas === 0) return 100

    const rs = ganhos / perdas
    return 100 - (100 / (1 + rs))
}

// ================= SALDO =================

async function pegarSaldo() {
    const saldo = await client.balance()
    return parseFloat(saldo.USDT.available)
}

// ================= FILTRO MOEDAS =================

async function pegarMoedas() {
    const tickers = await client.prices()

    return Object.keys(tickers)
        .filter(s => s.endsWith("USDT"))
        .filter(s => !EXCLUIR.includes(s))
        .slice(0, LIMITE_MOEDAS)
}

// ================= ANALISAR =================

async function analisar(symbol) {

    if (operando) return

    const candles = await client.candlesticks(symbol, INTERVAL, { limit: 50 })
    if (!candles || candles.length < 21) return

    const closes = candles.map(c => parseFloat(c[4]))
    if (closes.includes(NaN)) return

    const ema9 = calcularEMA(9, closes.slice(-9))
    const ema21 = calcularEMA(21, closes.slice(-21))
    const rsi = calcularRSI(14, closes.slice(-15))

    console.log(`${symbol} | EMA9:${ema9.toFixed(4)} EMA21:${ema21.toFixed(4)} RSI:${rsi.toFixed(2)}`)

    // ===== CONDIÇÃO DE ENTRADA =====
    if (ema9 > ema21 && rsi < 45) {
        console.log(`🚀 Sinal detectado em ${symbol}`)
        await comprar(symbol)
    }
}

// ================= COMPRA =================

async function comprar(symbol) {

    try {

        operando = true

        const saldo = await pegarSaldo()
        console.log("💰 Saldo USDT:", saldo)

        const usar = saldo * USAR_SALDO_PERCENTUAL
        if (usar < 10) {
            console.log("Saldo insuficiente")
            operando = false
            return
        }

        const preco = parseFloat(await client.prices(symbol)[symbol])
        const quantidade = (usar / preco).toFixed(3)

        const ordem = await client.marketBuy(symbol, quantidade)

        const precoCompra = parseFloat(ordem.fills[0].price)

        console.log("✅ Comprado:", symbol)

        await criarOCO(symbol, quantidade, precoCompra)

    } catch (error) {
        console.log("❌ Erro compra:", error.body || error.message)
        operando = false
    }
}

// ================= OCO =================

async function criarOCO(symbol, quantidade, precoCompra) {

    try {

        const takeProfit = (precoCompra * TAKE_PROFIT).toFixed(6)
        const stopPrice = (precoCompra * STOP_LOSS).toFixed(6)
        const stopLimit = (precoCompra * (STOP_LOSS - 0.001)).toFixed(6)

        await client.sell(symbol, quantidade, takeProfit, {
            type: "OCO",
            stopPrice: stopPrice,
            stopLimitPrice: stopLimit,
            stopLimitTimeInForce: "GTC"
        })

        console.log("🎯 OCO criada com sucesso")

    } catch (error) {
        console.log("❌ Erro OCO:", error.body || error.message)
    }

    operando = false
}

// ================= LOOP =================

async function rodar() {

    const moedas = await pegarMoedas()

    for (let m of moedas) {
        await analisar(m)
    }

    const saldo = await pegarSaldo()
    console.log("💰 Saldo atual:", saldo)
}

setInterval(rodar, 120000)

console.log("🤖 ROBÔ EMA 9/21 + RSI + OCO INICIADO")