const Binance = require('node-binance-api')
require('dotenv').config()

const client = new Binance().options({
    APIKEY: process.env.API_KEY,
    APISECRET: process.env.API_SECRET,
    useServerTime: true,
    recvWindow: 60000
})

const INTERVAL = '5m'
const TAKE_PROFIT = 0.05
const STOP_LOSS = 0.03

let operando = false

// ================= FUNÇÕES =================

function calcularEMA(periodo, valores) {
    const k = 2 / (periodo + 1)
    let ema = valores[0]

    for (let i = 1; i < valores.length; i++) {
        ema = valores[i] * k + ema * (1 - k)
    }

    return ema
}

function calcularRSI(periodo, valores) {
    let ganhos = 0
    let perdas = 0

    for (let i = 1; i <= periodo; i++) {
        const diferenca = valores[valores.length - i] - valores[valores.length - i - 1]
        if (diferenca >= 0) ganhos += diferenca
        else perdas += Math.abs(diferenca)
    }

    if (perdas === 0) return 100

    const rs = ganhos / perdas
    return 100 - (100 / (1 + rs))
}

async function getSaldo() {
    const bal = await client.balance()
    return parseFloat(bal.USDT.available)
}

// ================= ANALISAR =================

async function analisar(symbol) {

    if (operando) return

    try {

        const candles = await client.candlesticks(symbol, INTERVAL, { limit: 50 })

        if (!candles || candles.length < 30) return

        const closes = candles
            .map(c => parseFloat(c[4]))
            .filter(v => !isNaN(v))

        if (closes.length < 30) return

        // 🔥 CORREÇÃO AQUI — NÃO USAR SLICE CURTO
        const ema9 = calcularEMA(9, closes)
        const ema21 = calcularEMA(21, closes)
        const rsi = calcularRSI(14, closes)

        if (!ema9 || !ema21 || !rsi) return

        console.log(`${symbol} | EMA9:${ema9.toFixed(4)} EMA21:${ema21.toFixed(4)} RSI:${rsi.toFixed(2)}`)

        if (ema9 > ema21 && rsi < 45) {
            console.log(`🚀 Sinal detectado em ${symbol}`)
            await comprar(symbol)
        }

    } catch (err) {
        console.log(`Erro ao analisar ${symbol}`, err.message)
    }
}

// ================= COMPRA =================

async function comprar(symbol) {

    try {

        operando = true

        const saldo = await getSaldo()
        const valorCompra = saldo * 0.90

        const preco = (await client.prices(symbol))[symbol]

        const quantidade = (valorCompra / preco).toFixed(4)

        const ordem = await client.marketBuy(symbol, quantidade)

        const precoCompra = parseFloat(ordem.fills[0].price)

        const take = (precoCompra * (1 + TAKE_PROFIT)).toFixed(4)
        const stop = (precoCompra * (1 - STOP_LOSS)).toFixed(4)

        await client.sell(symbol, quantidade, null, {
            type: 'OCO',
            price: take,
            stopPrice: stop,
            stopLimitPrice: stop,
            stopLimitTimeInForce: 'GTC'
        })

        console.log(`✅ Compra realizada em ${symbol}`)

    } catch (err) {
        console.log("Erro na compra:", err.message)
    }

    operando = false
}

// ================= LOOP =================

async function iniciar() {

    const info = await client.exchangeInfo()

    const symbols = info.symbols
        .filter(s => s.quoteAsset === "USDT" && s.status === "TRADING")
        .map(s => s.symbol)

    setInterval(async () => {

        const saldo = await getSaldo()
        console.log("💰 Saldo atual:", saldo)

        for (let symbol of symbols.slice(0, 35)) {
            await analisar(symbol)
        }

    }, 120000)
}

iniciar()

console.log("🚀 ROBÔ EMA 9/21 + RSI + OCO INICIADO")