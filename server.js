require("dotenv").config()
const Binance = require("node-binance-api")

const client = new Binance().options({
    APIKEY: process.env.API_KEY,
    APISECRET: process.env.API_SECRET,
    useServerTime: true,
    recvWindow: 60000
})

const INTERVAL = "5m"
const EXCLUIR_TOP = [
    "BTCUSDT",
    "ETHUSDT",
    "BNBUSDT",
    "SOLUSDT",
    "XRPUSDT",
    "ADAUSDT",
    "DOGEUSDT",
    "TRXUSDT",
    "TONUSDT",
    "LINKUSDT"
]

let operando = false
let symbols = []

// =======================
// PEGAR MOEDAS
// =======================

async function carregarMoedas() {

    const info = await client.exchangeInfo()

    symbols = info.symbols
        .filter(s =>
            s.status === "TRADING" &&
            s.quoteAsset === "USDT" &&
            !EXCLUIR_TOP.includes(s.symbol)
        )
        .map(s => s.symbol)

    console.log("📊 Total de moedas válidas:", symbols.length)
}

// =======================
// EMA CORRETA
// =======================

function calcularEMA(periodo, valores) {

    if (!valores || valores.length < periodo) return NaN

    const k = 2 / (periodo + 1)
    let ema = valores[0]

    for (let i = 1; i < valores.length; i++) {
        ema = valores[i] * k + ema * (1 - k)
    }

    return ema
}

// =======================
// RSI CORRETO
// =======================

function calcularRSI(periodo, valores) {

    if (!valores || valores.length <= periodo) return NaN

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

// =======================
// SALDO
// =======================

async function getSaldo() {
    const saldo = await client.balance()
    return parseFloat(saldo.USDT.available)
}

// =======================
// ANALISAR MOEDA
// =======================

async function analisar(symbol) {

    if (operando) return

    try {

        const candles = await client.candlesticks(symbol, INTERVAL)

        if (!candles || candles.length < 50) return

        const closes = candles.map(c => parseFloat(c[4]))

        if (closes.some(isNaN)) return

        const ema9 = calcularEMA(9, closes.slice(-30))
        const ema21 = calcularEMA(21, closes.slice(-30))
        const rsi = calcularRSI(14, closes.slice(-15))

        if (isNaN(ema9) || isNaN(ema21) || isNaN(rsi)) return

        console.log(`${symbol} | EMA9:${ema9.toFixed(4)} EMA21:${ema21.toFixed(4)} RSI:${rsi.toFixed(2)}`)

        // ENTRADA MAIS SEGURA
        if (ema9 > ema21 && rsi > 40 && rsi < 60) {

            console.log(`🚀 Sinal detectado em ${symbol}`)
            await comprar(symbol)
        }

    } catch (err) {
        console.log("Erro ao analisar", symbol)
    }
}

// =======================
// COMPRA (SEM ERRO DE PARAMETROS)
// =======================

async function comprar(symbol) {

    try {

        operando = true

        const saldo = await getSaldo()

        const usar = saldo * 0.9

        const ticker = await client.prices(symbol)
        const preco = parseFloat(ticker[symbol])

        const quantidade = (usar / preco).toFixed(3)

        if (quantidade <= 0) {
            operando = false
            return
        }

        await client.marketBuy(symbol, quantidade)

        console.log("✅ Compra executada:", symbol)

        operando = false

    } catch (err) {

        console.log("❌ Erro na compra:", err.body || err.message)
        operando = false
    }
}

// =======================
// LOOP PRINCIPAL
// =======================

async function iniciar() {

    await carregarMoedas()

    setInterval(async () => {

        const saldo = await getSaldo()
        console.log("💰 Saldo atual:", saldo)

        const lista = symbols.slice(0, 30)

        console.log("🔎 Analisando", lista.length, "moedas")

        for (let symbol of lista) {
            await analisar(symbol)
        }

    }, 120000)
}

iniciar()

console.log("🤖 ROBÔ EMA 9/21 + RSI INICIADO")