require('dotenv').config()
const Binance = require('binance-api-node').default

const client = Binance({
    apiKey: process.env.BINANCE_API_KEY,
    apiSecret: process.env.BINANCE_API_SECRET,
    recvWindow: 60000
})

/* ================= CONFIG ================= */

const INVESTIMENTO = 19
const TAKE_PROFIT = 0.05
const STOP_LOSS = 0.03
const SCORE_MINIMO = 80
const INTERVALO_ANALISE = 120000
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
    let ganhos = []
    let perdas = []

    for (let i = 1; i < values.length; i++) {
        const diff = values[i] - values[i - 1]
        ganhos.push(diff > 0 ? diff : 0)
        perdas.push(diff < 0 ? Math.abs(diff) : 0)
    }

    let rsiArray = []

    for (let i = period; i < ganhos.length; i++) {
        const avgGain = ganhos.slice(i - period, i).reduce((a, b) => a + b, 0) / period
        const avgLoss = perdas.slice(i - period, i).reduce((a, b) => a + b, 0) / period

        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
        rsiArray.push(100 - (100 / (1 + rs)))
    }

    return rsiArray
}

/* ================= DETECTAR POSIÇÃO ================= */

async function verificarPosicaoAberta() {
    const conta = await client.accountInfo()
    const precos = await client.prices()

    for (let bal of conta.balances) {

        if (bal.asset === "USDT") continue
        if (bal.asset === "BNB") continue

        const quantidade = parseFloat(bal.free)
        if (quantidade <= 0) continue

        const symbol = bal.asset + "USDT"
        if (!precos[symbol]) continue

        const valor = quantidade * parseFloat(precos[symbol])

        if (valor > 10) {
            console.log("🔴 Posição relevante aberta:", symbol)
            return true
        }
    }

    return false
}

/* ================= CRIAR OCO ================= */

async function criarOCO(symbol, precoCompra) {

    const exchangeInfo = await client.exchangeInfo()
    const info = exchangeInfo.symbols.find(s => s.symbol === symbol)

    const lot = info.filters.find(f => f.filterType === 'LOT_SIZE')
    const priceFilter = info.filters.find(f => f.filterType === 'PRICE_FILTER')

    const stepSize = parseFloat(lot.stepSize)
    const tickSize = parseFloat(priceFilter.tickSize)

    const conta = await client.accountInfo()
    const asset = symbol.replace("USDT", "")
    const saldo = conta.balances.find(b => b.asset === asset)

    const quantidadeReal = parseFloat(saldo.free)
    if (quantidadeReal <= 0) return

    const precisionQty = Math.round(Math.log10(1 / stepSize))
    const qtdFinal = parseFloat((Math.floor(quantidadeReal / stepSize) * stepSize).toFixed(precisionQty))

    const precisionPrice = Math.round(Math.log10(1 / tickSize))
    const precoTP = parseFloat((precoCompra * (1 + TAKE_PROFIT)).toFixed(precisionPrice))
    const precoSL = parseFloat((precoCompra * (1 - STOP_LOSS)).toFixed(precisionPrice))
    const precoStopLimit = parseFloat((precoSL * 0.999).toFixed(precisionPrice))

    await client.orderOco({
        symbol: symbol,
        side: 'SELL',
        quantity: qtdFinal,
        price: precoTP,
        stopPrice: precoSL,
        stopLimitPrice: precoStopLimit,
        stopLimitTimeInForce: 'GTC'
    })

    console.log("✅ OCO criado")
    console.log("🎯 TP:", precoTP)
    console.log("🛑 SL:", precoSL)
}

/* ================= ESTRATÉGIA ================= */

async function analisarEntrada(symbol) {

    const klines = await client.candles({
        symbol: symbol,
        interval: TIMEFRAME,
        limit: 50
    })

    const closes = klines.map(k => parseFloat(k.close))

    const ema9 = calcularEMA(closes, 9)
    const ema21 = calcularEMA(closes, 21)
    const rsi = calcularRSI(closes)

    const ultima = klines[klines.length - 2]

    const preco = parseFloat(ultima.close)
    const ema9Atual = ema9[ema9.length - 2]
    const ema21Atual = ema21[ema21.length - 2]
    const rsiAtual = rsi[rsi.length - 1]
    const rsiAnterior = rsi[rsi.length - 2]

    let score = 0

    if (ema9Atual > ema21Atual) score += 30

    const distancia = Math.abs(preco - ema21Atual) / ema21Atual
    if (distancia < 0.005) score += 25

    if (rsiAtual < 40 && rsiAtual > rsiAnterior) score += 25

    const corpo = Math.abs(parseFloat(ultima.close) - parseFloat(ultima.open))
    const total = parseFloat(ultima.high) - parseFloat(ultima.low)

    if (
        parseFloat(ultima.close) > parseFloat(ultima.open) &&
        corpo / total > 0.6
    ) score += 20

    return score
}

/* ================= OPERAR ================= */

async function operar() {

    try {

        if (await verificarPosicaoAberta()) {
            console.log("⏳ Aguardando 2 minutos...")
            return
        }

        console.log("🔎 Buscando moedas ALPHA...")

        const tickers = await client.dailyStats()

        const moedas = tickers
            .filter(t =>
                t.symbol.endsWith('USDT') &&
                parseFloat(t.quoteVolume) > VOLUME_MINIMO &&
                !t.symbol.includes('UP') &&
                !t.symbol.includes('DOWN')
            )
            .slice(0, 35)   // 🔥 ALTERADO PARA 35

        for (let moeda of moedas) {

            const score = await analisarEntrada(moeda.symbol)

            console.log(moeda.symbol, "Score:", score)

            if (score >= SCORE_MINIMO) {

                console.log("🚀 ENTRANDO EM:", moeda.symbol)

                const precoAtual = parseFloat((await client.prices({ symbol: moeda.symbol }))[moeda.symbol])

                const exchangeInfo = await client.exchangeInfo()
                const info = exchangeInfo.symbols.find(s => s.symbol === moeda.symbol)
                const lot = info.filters.find(f => f.filterType === 'LOT_SIZE')

                const stepSize = parseFloat(lot.stepSize)
                const precision = Math.round(Math.log10(1 / stepSize))

                const quantidade = parseFloat(
                    (INVESTIMENTO / precoAtual).toFixed(precision)
                )

                const compra = await client.order({
                    symbol: moeda.symbol,
                    side: 'BUY',
                    type: 'MARKET',
                    quantity: quantidade
                })

                console.log("✅ COMPRA EXECUTADA")

                const precoReal = parseFloat(compra.fills[0].price)

                await sleep(2000)

                await criarOCO(moeda.symbol, precoReal)

                return
            }
        }

        console.log("❌ Nenhuma moeda atingiu score mínimo.")

    } catch (err) {
        console.log("❌ ERRO:", err.message)
    }
}

/* ================= LOOP ================= */

console.log("🔥 ROBÔ EMA 9/21 + RSI INICIADO")

setInterval(() => {
    operar()
}, INTERVALO_ANALISE)