require('dotenv').config()
const Binance = require('node-binance-api')

const client = new Binance().options({
    APIKEY: process.env.BINANCE_API_KEY,
    APISECRET: process.env.BINANCE_SECRET_KEY,
    useServerTime: true,
    recvWindow: 60000
})

const PORT = process.env.PORT || 3000

console.log("🚀 ROBÔ EMA 9/21 + RSI + OCO INICIADO")

// ================= CONFIG =================

const blacklist = [
    "BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT",
    "XRPUSDT","ADAUSDT","DOGEUSDT",
    "AVAXUSDT","DOTUSDT","TRXUSDT"
]

const MAX_MOEDAS = 35
const RSI_ENTRADA = 45

// ===========================================

async function pegarSaldo() {
    const saldo = await client.balance()
    return parseFloat(saldo.USDT.available)
}

function calcularEMA(periodo, dados) {
    const k = 2 / (periodo + 1)
    let ema = dados[0]

    for (let i = 1; i < dados.length; i++) {
        ema = dados[i] * k + ema * (1 - k)
    }
    return ema
}

function calcularRSI(periodo, closes) {
    let gains = 0
    let losses = 0

    for (let i = 1; i <= periodo; i++) {
        const diff = closes[i] - closes[i - 1]
        if (diff >= 0) gains += diff
        else losses -= diff
    }

    const rs = gains / losses
    return 100 - (100 / (1 + rs))
}

async function ajustarQuantidade(symbol, quantidade) {
    const info = await client.exchangeInfo()
    const symbolInfo = info.symbols.find(s => s.symbol === symbol)

    const lotFilter = symbolInfo.filters.find(f => f.filterType === "LOT_SIZE")
    const stepSize = parseFloat(lotFilter.stepSize)
    const minQty = parseFloat(lotFilter.minQty)

    let precision = Math.floor(Math.log10(1 / stepSize))
    let ajustado = quantidade.toFixed(precision)

    if (parseFloat(ajustado) < minQty) return null

    return ajustado
}

async function criarOCO(symbol, quantity, precoCompra) {
    try {

        const takeProfit = (precoCompra * 1.05).toFixed(6)
        const stopPrice = (precoCompra * 0.97).toFixed(6)
        const stopLimitPrice = (precoCompra * 0.969).toFixed(6)

        await client.orderOco({
            symbol: symbol,
            side: "SELL",
            quantity: quantity,
            price: takeProfit,
            stopPrice: stopPrice,
            stopLimitPrice: stopLimitPrice,
            stopLimitTimeInForce: "GTC"
        })

        console.log("✅ OCO criada")

    } catch (error) {
        console.log("❌ Erro OCO:", error.body || error.message)
    }
}

async function analisarMoeda(symbol) {

    if (blacklist.includes(symbol)) return

    const candles = await client.candlesticks(symbol, "5m", { limit: 50 })

    const closes = candles.map(c => parseFloat(c[4]))

    const ema9 = calcularEMA(9, closes.slice(-9))
    const ema21 = calcularEMA(21, closes.slice(-21))
    const rsi = calcularRSI(14, closes.slice(-15))

    console.log(`${symbol} | EMA9:${ema9.toFixed(4)} EMA21:${ema21.toFixed(4)} RSI:${rsi.toFixed(2)}`)

    if (ema9 > ema21 && rsi <= RSI_ENTRADA) {

        const saldo = await pegarSaldo()

        if (saldo < 10) return

        const entradaUSDT = saldo * 0.90

        const precoAtual = closes[closes.length - 1]
        let quantidade = entradaUSDT / precoAtual

        quantidade = await ajustarQuantidade(symbol, quantidade)
        if (!quantidade) return

        console.log(`💰 Saldo USDT: ${saldo}`)
        console.log(`🟢 Comprando ${symbol}`)

        const ordem = await client.marketBuy(symbol, quantidade)

        const precoCompra = parseFloat(ordem.fills[0].price)

        await criarOCO(symbol, quantidade, precoCompra)
    }
}

async function rodar() {
    try {

        const tickers = await client.prices()

        const pares = Object.keys(tickers)
            .filter(s => s.endsWith("USDT"))
            .slice(0, MAX_MOEDAS)

        for (let symbol of pares) {
            await analisarMoeda(symbol)
        }

    } catch (error) {
        console.log("❌ Erro geral:", error.message)
    }
}

setInterval(rodar, 30000)

require('http')
    .createServer((req, res) => res.end("ROBO ONLINE"))
    .listen(PORT)

console.log(`Rodando na porta ${PORT}`)