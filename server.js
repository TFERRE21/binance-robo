const Binance = require("node-binance-api")

const client = new Binance().options({
    APIKEY: process.env.API_KEY,
    APISECRET: process.env.API_SECRET,
    useServerTime: true,
    recvWindow: 60000
})

const INTERVAL = "5m"
const TAKE_PROFIT = 0.05
const STOP_LOSS = 0.02

let operando = false

// ================= INDICADORES =================

function calcularEMA(periodo, valores) {
    if (valores.length < periodo) return NaN

    const k = 2 / (periodo + 1)
    let ema = valores[0]

    for (let i = 1; i < valores.length; i++) {
        ema = valores[i] * k + ema * (1 - k)
    }

    return ema
}

function calcularRSI(periodo, valores) {
    if (valores.length < periodo + 1) return NaN

    let ganhos = 0
    let perdas = 0

    for (let i = 1; i <= periodo; i++) {
        const diff = valores[i] - valores[i - 1]
        if (diff >= 0) ganhos += diff
        else perdas -= diff
    }

    if (perdas === 0) return 100

    const rs = ganhos / perdas
    return 100 - (100 / (1 + rs))
}

// ================= SALDO =================

async function getSaldo() {
    const conta = await client.balance()
    return parseFloat(conta.USDT.available)
}

// ================= COMPRA =================

async function comprar(symbol) {

    try {

        operando = true

        const saldo = await getSaldo()
        const valorCompra = saldo * 0.9

        const ticker = await client.prices(symbol)
        const preco = parseFloat(ticker[symbol])

        const quantidade = (valorCompra / preco)

        const filtros = (await client.exchangeInfo()).symbols.find(s => s.symbol === symbol)
        const stepSize = parseFloat(filtros.filters.find(f => f.filterType === "LOT_SIZE").stepSize)

        const precision = Math.floor(Math.log10(1 / stepSize))
        const quantidadeFinal = parseFloat(quantidade.toFixed(precision))

        console.log(`🛒 Comprando ${symbol}`)

        const ordem = await client.marketBuy(symbol, quantidadeFinal)

        const precoCompra = parseFloat(ordem.fills[0].price)

        const precoTake = (precoCompra * (1 + TAKE_PROFIT)).toFixed(precision)
        const precoStop = (precoCompra * (1 - STOP_LOSS)).toFixed(precision)
        const precoStopLimit = (precoCompra * (1 - STOP_LOSS - 0.002)).toFixed(precision)

        await client.orderOco({
            symbol: symbol,
            side: "SELL",
            quantity: quantidadeFinal,
            price: precoTake,
            stopPrice: precoStop,
            stopLimitPrice: precoStopLimit,
            stopLimitTimeInForce: "GTC"
        })

        console.log("🎯 OCO criado com sucesso")

    } catch (err) {
        console.log("❌ Erro na compra:", err.body || err.message)
    }

    operando = false
}

// ================= ANALISAR =================

async function analisar(symbol) {

    if (operando) return

    try {

        const candles = await client.candlesticks(symbol, INTERVAL, { limit: 50 })
        if (!candles || candles.length < 30) return

        const closes = candles.map(c => parseFloat(c[4]))
        if (closes.some(v => isNaN(v))) return

        const ema9 = calcularEMA(9, closes)
        const ema21 = calcularEMA(21, closes)
        const rsi = calcularRSI(14, closes.slice(-15))

        if (isNaN(ema9) || isNaN(ema21) || isNaN(rsi)) return

        console.log(`${symbol} | EMA9:${ema9.toFixed(4)} EMA21:${ema21.toFixed(4)} RSI:${rsi.toFixed(2)}`)

        if (ema9 > ema21 && rsi < 45) {
            console.log(`🚀 Sinal detectado em ${symbol}`)
            await comprar(symbol)
        }

    } catch (err) {
        console.log(`Erro ao analisar ${symbol}`)
    }
}

// ================= INICIAR =================

async function iniciar() {

    const info = await client.exchangeInfo()

    const symbols = info.symbols
        .filter(s =>
            s.symbol.endsWith("USDT") &&
            s.status === "TRADING" &&
            !s.symbol.includes("UP") &&
            !s.symbol.includes("DOWN") &&
            !s.symbol.includes("BULL") &&
            !s.symbol.includes("BEAR")
        )
        .map(s => s.symbol)

    console.log("📊 Total de moedas:", symbols.length)

    setInterval(async () => {

        const saldo = await getSaldo()
        console.log("💰 Saldo atual:", saldo)

        for (let symbol of symbols.slice(0, 30)) {
            await analisar(symbol)
        }

    }, 120000)
}

iniciar()