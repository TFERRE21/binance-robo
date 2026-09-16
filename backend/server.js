const express = require("express");
const path = require("path");

const authRoutes = require("./routes/auth");
const binanceRoutes = require("./routes/binance");
const panelRoutes = require("./routes/panel");
const subscriptionRoutes = require("./routes/subscription");

const robotRiskRoutes = require("./routes/robotRisk");

const authMiddleware = require("./middleware/auth");

// ============================================================
// ROTAS PRINCIPAIS
// ============================================================

app.use("/api/auth", authRoutes);
app.use("/api/binance", binanceRoutes);
app.use("/api/panel", panelRoutes);
app.use("/api/subscription", subscriptionRoutes);

// ============================================================
// TERMO DE RESPONSABILIDADE DO ROBÔ
// ============================================================

app.use("/api/robot/risk", robotRiskRoutes.router);

// =========================================================
// CRIPTOPRO V7 - NOVAS ROTAS
// =========================================================
const reportRoutes = require("./routes/reports");
const newsRoutes = require("./routes/news");
const robotRoutes = require("./routes/robot");
const robotEngine = require("./services/robotEngine");

const Binance = require("binance-api-node").default;

const app = express();

app.use(express.json());

app.use(express.static(path.join(__dirname, "../publico")));

app.use("/api/auth", authRoutes);

app.use("/api/binance", binanceRoutes);

app.use("/api/panel", panelRoutes);

app.use("/api/subscription", subscriptionRoutes);

// =========================================================
// CRIPTOPRO V7 - NOVAS ROTAS
// =========================================================
app.use("/api/panel/report", reportRoutes);
app.use("/api/news", newsRoutes);
app.use("/api/robot", robotRoutes);

/*
 * CRIPTOPRO V7 - RECUPERAR ROBOS ATIVOS
 *
 * Ao iniciar o servidor, recupera somente os robos que estavam
 * marcados como ativos no banco de dados.
 *
 * O robo antigo global nao foi alterado neste passo.
 */
robotEngine.resumeRunning().catch(err => {
  console.error("ERRO AO RECUPERAR ROBOS:", err);
});

const PORT = process.env.PORT || 3000;

app.use(express.json());

/*
=========================================================
BINANCE-ROBO - PAINEL PREMIUM V2
=========================================================
DUAS CONTAS TOTALMENTE SEPARADAS:

CONTA 1 = THIAGO
API_KEY_1
API_SECRET_1

CONTA 2 = SERGIO
API_KEY_2
API_SECRET_2

O painel mantém a leitura das duas contas e possui controle manual de venda/cancelamento, sem alterar o robô.
=========================================================
*/

const CONTAS = [
  {
    id: "1",
    nome: "THIAGO",
    descricao: "Minha conta",
    apiKey: process.env.API_KEY_1,
    apiSecret: process.env.API_SECRET_1
  },
  {
    id: "2",
    nome: "SERGIO",
    descricao: "Conta do amigo",
    apiKey: process.env.API_KEY_2,
    apiSecret: process.env.API_SECRET_2
  }
];

const clientes = CONTAS.map(function (conta) {
  return {
    id: conta.id,
    nome: conta.nome,
    descricao: conta.descricao,
    apiKey: conta.apiKey,
    apiSecret: conta.apiSecret,
    client:
      conta.apiKey && conta.apiSecret
        ? Binance({
            apiKey: conta.apiKey,
            apiSecret: conta.apiSecret
          })
        : null
  };
});

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function assetNormalizado(asset) {
  return String(asset || "").replace(/^LD/, "");
}

async function obterUSDTBRL(client) {
  try {
    const prices = await client.prices({ symbol: "USDTBRL" });
    if (prices && prices.USDTBRL) {
      return num(prices.USDTBRL);
    }
  } catch (e) {}

  return num(process.env.USDTBRL_RATE) || 5.50;
}

/*
=========================================================
CONTA
=========================================================
*/

async function obterConta(conta) {
  if (!conta.client) {
    throw new Error("Credenciais não configuradas.");
  }

  const resultado = await Promise.all([
    conta.client.accountInfo(),
    conta.client.prices(),
    obterUSDTBRL(conta.client)
  ]);

  const info = resultado[0];
  const prices = resultado[1];
  const usdtBrl = resultado[2];

  const ativos = [];
  let patrimonioUSDT = 0;

  for (const b of info.balances || []) {
    const free = num(b.free);
    const locked = num(b.locked);
    const total = free + locked;

    if (total <= 0) continue;

    const asset = assetNormalizado(b.asset);

    let precoUSDT = 0;
    let valorUSDT = 0;

    if (asset === "USDT") {
      precoUSDT = 1;
      valorUSDT = total;
    } else {
      precoUSDT = num(
        prices[asset + "USDT"] ||
        prices["LD" + asset + "USDT"]
      );

      if (precoUSDT > 0) {
        valorUSDT = total * precoUSDT;
      }
    }

    if (valorUSDT > 0.01) {
      patrimonioUSDT += valorUSDT;

      ativos.push({
        asset,
        free,
        locked,
        total,
        precoUSDT,
        valorUSDT,
        valorBRL: valorUSDT * usdtBrl
      });
    }
  }

  ativos.sort(function (a, b) {
    return b.valorUSDT - a.valorUSDT;
  });

  return {
    id: conta.id,
    nome: conta.nome,
    descricao: conta.descricao,
    patrimonioUSDT,
    patrimonioUSD: patrimonioUSDT,
    patrimonioBRL: patrimonioUSDT * usdtBrl,
    usdtBrl,
    totalAtivos: ativos.length,
    ativos,
    atualizadoEm: Date.now()
  };
}

/*
=========================================================
TRADES / PNL
=========================================================
*/

async function obterTrades(conta, symbol, limit = 1000) {
  try {
    return await conta.client.myTrades({
      symbol,
      limit
    });
  } catch (e) {
    return [];
  }
}

function calcularPnL(trades) {
  const fila = [];
  let realizado = 0;

  const ordenados = (trades || [])
    .slice()
    .sort(function (a, b) {
      return num(a.time) - num(b.time);
    });

  for (const t of ordenados) {
    const qty = num(t.qty);
    const price = num(t.price);

    if (qty <= 0 || price <= 0) continue;

    if (t.isBuyer) {
      fila.push({
        qty,
        price
      });
    } else {
      let restante = qty;

      while (restante > 0.0000000001 && fila.length) {
        const lote = fila[0];
        const usado = Math.min(restante, lote.qty);

        realizado += usado * (price - lote.price);

        lote.qty -= usado;
        restante -= usado;

        if (lote.qty <= 0.0000000001) {
          fila.shift();
        }
      }

      const commission = num(t.commission);

      if (
        commission > 0 &&
        String(t.commissionAsset || "").toUpperCase() === "USDT"
      ) {
        realizado -= commission;
      }
    }
  }

  return realizado;
}

/*
=========================================================
OPERAÇÃO ATUAL
=========================================================
Identifica somente os trades após a última VENDA do ativo.
Assim, a comparação THIAGO x SERGIO não mistura operações
antigas com a operação que está aberta agora.
*/
function calcularOperacaoAtual(trades) {
  const lista = (trades || []).slice().sort(function(a,b){
    return num(a.time) - num(b.time);
  });

  let ultimoSellIndex = -1;
  for (let i = 0; i < lista.length; i++) {
    if (!lista[i].isBuyer) ultimoSellIndex = i;
  }

  const atual = lista.slice(ultimoSellIndex + 1);
  const compras = atual.filter(function(t){ return !!t.isBuyer; });
  const vendas = atual.filter(function(t){ return !t.isBuyer; });

  let qtdComprada = 0;
  let custo = 0;
  let qtdVendida = 0;

  compras.forEach(function(t){
    const qty = num(t.qty);
    const quote = num(t.quoteQty) || qty * num(t.price);
    qtdComprada += qty;
    custo += quote;
  });

  vendas.forEach(function(t){
    qtdVendida += num(t.qty);
  });

  const quantidade = Math.max(0, qtdComprada - qtdVendida);
  const entrada = qtdComprada > 0 ? custo / qtdComprada : 0;
  const primeiraCompra = compras[0] || null;

  return {
    ativa: quantidade > 0 && entrada > 0,
    quantidade,
    entrada,
    entradaTime: primeiraCompra ? num(primeiraCompra.time) : 0,
    compras: compras.length,
    vendas: vendas.length,
    qtdComprada,
    qtdVendida
  };
}

/*
=========================================================
POSIÇÕES
=========================================================
*/

async function obterPosicoes(conta, dadosConta) {
  const posicoes = [];

  const ativos = (dadosConta.ativos || []).filter(function (a) {
    return a.asset !== "USDT" && a.valorUSDT >= 3;
  });

  for (const ativo of ativos) {
    const symbol = ativo.asset + "USDT";
    const trades = await obterTrades(conta, symbol, 1000);

    let ultimoTrade = null;

    for (const t of trades) {
      if (
        !ultimoTrade ||
        num(t.time) > num(ultimoTrade.time)
      ) {
        ultimoTrade = t;
      }
    }

    const operacao = calcularOperacaoAtual(trades);
    const quantidade = ativo.total;
    const quantidadeOperacao = operacao.ativa
      ? Math.min(quantidade, operacao.quantidade)
      : 0;

    const quantidadeLiquida = operacao.quantidade;
    const precoMedio = operacao.entrada;
    const precoAtual = ativo.precoUSDT;

    const valorAtual =
      quantidade * precoAtual;

    const pnlNaoRealizado =
      precoMedio > 0 && quantidadeOperacao > 0
        ? (precoAtual - precoMedio) * quantidadeOperacao
        : 0;

    const pnlPct =
      precoMedio > 0
        ? ((precoAtual / precoMedio) - 1) * 100
        : 0;

    let ordensAbertas = [];

    try {
      ordensAbertas =
        await conta.client.openOrders({
          symbol
        });
    } catch (e) {}

    const vendas = ordensAbertas
      .filter(function (o) {
        return (
          String(o.side).toUpperCase() === "SELL" &&
          num(o.price) > 0
        );
      })
      .sort(function (a, b) {
        return num(a.price) - num(b.price);
      });

    const tpOrder = vendas[0] || null;

    const slOrder =
      ordensAbertas.find(function (o) {
        return [
          "STOP",
          "STOP_LOSS",
          "STOP_LOSS_LIMIT"
        ].includes(
          String(o.type || "").toUpperCase()
        );
      }) || null;

    posicoes.push({
      symbol,
      asset: ativo.asset,
      quantidade,
      quantidadeLiquida,
      precoMedio,
      precoAtual,
      valorAtual,
      pnlNaoRealizado,
      pnlNaoRealizadoPct: pnlPct,
      pnlRealizado: calcularPnL(trades),
      operacaoAtual: {
        ativa: operacao.ativa,
        quantidade: quantidadeOperacao,
        entrada: precoMedio,
        entradaTime: operacao.entradaTime,
        compras: operacao.compras,
        vendas: operacao.vendas,
        pnlUSDT: pnlNaoRealizado,
        pnlBRL: pnlNaoRealizado * num(dadosConta.usdtBrl),
        pnlPct
      },
      tp: tpOrder
        ? {
            price: num(tpOrder.price),
            qty: num(tpOrder.origQty),
            type: tpOrder.type,
            status: tpOrder.status
          }
        : null,
      sl: slOrder
        ? {
            stopPrice: num(
              slOrder.stopPrice || slOrder.price
            ),
            price: num(slOrder.price),
            type: slOrder.type,
            status: slOrder.status
          }
        : null,
      ordensAbertas: ordensAbertas.length,
      ultimaOperacao: ultimoTrade
        ? {
            lado: ultimoTrade.isBuyer
              ? "COMPRA"
              : "VENDA",
            qty: num(ultimoTrade.qty),
            price: num(ultimoTrade.price),
            time: num(ultimoTrade.time)
          }
        : null
    });
  }

  posicoes.sort(function (a, b) {
    return b.valorAtual - a.valorAtual;
  });

  return posicoes;
}

/*
=========================================================
HISTÓRICO
=========================================================
*/

async function obterHistorico(conta, dadosConta) {
  const ativos = (dadosConta.ativos || [])
    .filter(function (a) {
      return (
        a.asset !== "USDT" &&
        a.valorUSDT > 0.01
      );
    })
    .slice(0, 20);

  const resultado = [];

  for (const ativo of ativos) {
    const symbol = ativo.asset + "USDT";
    const trades = await obterTrades(
      conta,
      symbol,
      100
    );

    for (const t of trades) {
      resultado.push({
        symbol,
        lado: t.isBuyer
          ? "COMPRA"
          : "VENDA",
        qty: num(t.qty),
        price: num(t.price),
        quoteQty: num(t.quoteQty),
        commission: num(t.commission),
        commissionAsset: t.commissionAsset,
        time: num(t.time)
      });
    }
  }

  resultado.sort(function (a, b) {
    return b.time - a.time;
  });

  return resultado.slice(0, 50);
}

/*
=========================================================
DASHBOARD INDIVIDUAL
=========================================================
*/

async function obterDashboardConta(conta) {
  const dados = await obterConta(conta);

  const [posicoes, historico] =
    await Promise.all([
      obterPosicoes(conta, dados),
      obterHistorico(conta, dados)
    ]);

  const pnlAberto = posicoes.reduce(
    function (s, p) {
      return s + num(p.pnlNaoRealizado);
    },
    0
  );

  const pnlRealizado = posicoes.reduce(
    function (s, p) {
      return s + num(p.pnlRealizado);
    },
    0
  );

  return {
    ...dados,
    posicoes,
    historico,
    pnlNaoRealizado: pnlAberto,
    pnlRealizado,
    pnlTotalEstimado:
      pnlAberto + pnlRealizado,
    ultimaCompra:
      historico.find(function (h) {
        return h.lado === "COMPRA";
      }) || null,
    ultimaVenda:
      historico.find(function (h) {
        return h.lado === "VENDA";
      }) || null,
    operacaoAtual:
      posicoes.length && posicoes[0].operacaoAtual && posicoes[0].operacaoAtual.ativa
        ? { ...posicoes[0].operacaoAtual, symbol: posicoes[0].symbol, precoAtual: posicoes[0].precoAtual, tp: posicoes[0].tp, sl: posicoes[0].sl }
        : null
  };
}

/*
=========================================================
API DASHBOARD
=========================================================
*/

app.get("/api/dashboard", async function (req, res) {
  try {
    const contas = await Promise.all(
      clientes.map(async function (conta) {
        try {
          return await obterDashboardConta(conta);
        } catch (e) {
          return {
            id: conta.id,
            nome: conta.nome,
            descricao: conta.descricao,
            erro: e.message,
            patrimonioUSDT: 0,
            patrimonioUSD: 0,
            patrimonioBRL: 0,
            usdtBrl: 0,
            totalAtivos: 0,
            ativos: [],
            posicoes: [],
            historico: [],
            pnlNaoRealizado: 0,
            pnlRealizado: 0,
            pnlTotalEstimado: 0
          };
        }
      })
    );

    res.json({
      atualizadoEm: Date.now(),
      contas
    });
  } catch (e) {
    res.status(500).json({
      erro: e.message
    });
  }
});

/*
=========================================================
API DE CONTA
=========================================================
*/

app.get("/api/account/:id", async function (req, res) {
  try {
    const conta = clientes.find(function (c) {
      return c.id === String(req.params.id);
    });

    if (!conta) {
      return res.status(404).json({
        erro: "Conta não encontrada"
      });
    }

    res.json(
      await obterDashboardConta(conta)
    );
  } catch (e) {
    res.status(500).json({
      erro: e.message
    });
  }
});

/*
=========================================================
API DO GRÁFICO
=========================================================
*/

app.get("/api/chart", async function (req, res) {
  try {
    const account =
      String(req.query.account || "1");

    const symbol =
      String(
        req.query.symbol || "BTCUSDT"
      ).toUpperCase();

    const interval =
      String(
        req.query.interval || "15m"
      );

    const conta = clientes.find(function (c) {
      return c.id === account;
    });

    if (!conta) {
      return res.status(404).json({
        erro: "Conta não encontrada"
      });
    }

    const candles =
      await conta.client.candles({
        symbol,
        interval,
        limit: 300
      });

    const trades =
      await obterTrades(
        conta,
        symbol,
        1000
      );

    const operacao = calcularOperacaoAtual(trades);

    const entry = operacao.ativa
      ? operacao.entrada
      : null;

    const entryTime = operacao.ativa
      ? Math.floor(num(operacao.entradaTime) / 1000)
      : null;

    let orders = [];

    try {
      orders =
        await conta.client.openOrders({
          symbol
        });
    } catch (e) {}

    const sell =
      orders
        .filter(function (o) {
          return (
            String(o.side).toUpperCase() ===
              "SELL" &&
            num(o.price) > 0
          );
        })
        .sort(function (a, b) {
          return num(a.price) - num(b.price);
        })[0] || null;

    const stop =
      orders.find(function (o) {
        return [
          "STOP",
          "STOP_LOSS",
          "STOP_LOSS_LIMIT"
        ].includes(
          String(o.type || "").toUpperCase()
        );
      }) || null;

    res.json({
      symbol,
      interval,
      candles: candles.map(function (c) {
        return {
          time:
            Math.floor(
              num(c.openTime) / 1000
            ),
          open: num(c.open),
          high: num(c.high),
          low: num(c.low),
          close: num(c.close)
        };
      }),
      entry,
      entryTime,
      tp: sell
        ? num(sell.price)
        : null,
      sl: stop
        ? num(
            stop.stopPrice ||
            stop.price
          )
        : null
    });
  } catch (e) {
    res.status(500).json({
      erro: e.message
    });
  }
});

app.get("/api/market", async function(req,res){
  try{
    const cliente = clientes[0].client;
    const candles = await cliente.candles({symbol:"BTCUSDT", interval:"15m", limit:100});
    const closes = candles.map(function(c){ return num(c.close); });
    const price = closes[closes.length-1] || 0;
    const period=21;
    const slice=closes.slice(-period);
    const ema = slice.length ? slice.reduce(function(a,b){return a+b;},0)/slice.length : price;
    let gains=0,losses=0;
    for(let i=Math.max(1,closes.length-15);i<closes.length;i++){
      const diff=closes[i]-closes[i-1];
      if(diff>=0) gains+=diff; else losses+=Math.abs(diff);
    }
    const avgGain=gains/14, avgLoss=losses/14;
    const rsi=avgLoss===0?100:100-(100/(1+(avgGain/avgLoss)));
    const state = price>ema && rsi<70 ? "ALTA" : (price<ema && rsi>30 ? "BAIXA" : "NEUTRO");
    res.json({price,ema,rsi,state});
  }catch(e){ res.status(500).json({erro:e.message}); }
});



/* =========================================================
   V7 - RAIO-X TÉCNICO / OPORTUNIDADES
   Informativo. Não envia ordens e não altera o robô.
========================================================= */
function calcularEMAvalores(valores, periodo){
  if(!valores.length) return 0;
  const p = Math.max(1, periodo || 21);
  const k = 2 / (p + 1);
  let ema = valores[0];
  for(let i=1;i<valores.length;i++) ema = valores[i] * k + ema * (1-k);
  return ema;
}

function calcularRSIvalores(valores, periodo){
  const p = Math.max(2, periodo || 14);
  if(valores.length <= p) return 50;
  let gain=0, loss=0;
  for(let i=valores.length-p;i<valores.length;i++){
    const d = valores[i]-valores[i-1];
    if(d>=0) gain += d; else loss += Math.abs(d);
  }
  const ag=gain/p, al=loss/p;
  return al===0 ? 100 : 100-(100/(1+(ag/al)));
}

async function obterRaioX(conta, symbol){
  const candles = await conta.client.candles({symbol, interval:"15m", limit:80});
  if(!candles || candles.length<22) throw new Error("Poucos candles para análise.");
  const closes=candles.map(function(c){return num(c.close);});
  const volumes=candles.map(function(c){return num(c.volume);});
  const price=closes[closes.length-1];
  const ema=calcularEMAvalores(closes,21);
  const rsi=calcularRSIvalores(closes,14);
  const volAtual=volumes[volumes.length-1] || 0;
  const base=volumes.slice(Math.max(0,volumes.length-21),volumes.length-1);
  const volMedia=base.length ? base.reduce(function(a,b){return a+b;},0)/base.length : volAtual;
  const volumeRatio=volMedia>0 ? volAtual/volMedia : 0;
  const distancia=ema>0 ? (price/ema-1)*100 : 0;
  const checks=[
    {nome:"RSI entre 40 e 65",ok:rsi>=40 && rsi<=65,valor:rsi.toFixed(2)},
    {nome:"Preço até 4% acima da EMA21",ok:distancia<=4,valor:(distancia>=0?"+":"")+distancia.toFixed(2)+"%"},
    {nome:"Volume mínimo 0,80x",ok:volumeRatio>=0.80,valor:volumeRatio.toFixed(2)+"x"},
    {nome:"Volume de breakout 1,30x",ok:volumeRatio>=1.30,valor:volumeRatio.toFixed(2)+"x"}
  ];
  return {symbol,price,ema,rsi,volumeRatio,distancia,checks,compatibilidade:checks.filter(function(x){return x.ok;}).length,atualizadoEm:Date.now()};
}

let v7OpportunityCache={time:0,data:[]};
async function obterOportunidades(conta){
  if(Date.now()-v7OpportunityCache.time<60000 && v7OpportunityCache.data.length) return v7OpportunityCache.data;
  let candidates=["BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","XRPUSDT","ADAUSDT","DOGEUSDT","TRXUSDT","LINKUSDT","AVAXUSDT","SUIUSDT","LTCUSDT"];
  try{
    const stats=await conta.client.dailyStats();
    const usdt=(stats||[]).filter(function(x){return /USDT$/.test(String(x.symbol||"")) && !String(x.symbol||"").includes("UP") && !String(x.symbol||"").includes("DOWN") && num(x.quoteVolume)>0;});
    usdt.sort(function(a,b){return num(b.quoteVolume)-num(a.quoteVolume);});
    const top=usdt.slice(0,12).map(function(x){return x.symbol;});
    candidates=Array.from(new Set(top.concat(candidates))).slice(0,12);
  }catch(e){}
  const result=[];
  for(const symbol of candidates){
    try{
      const x=await obterRaioX(conta,symbol);
      result.push(x);
    }catch(e){}
  }
  result.sort(function(a,b){return b.compatibilidade-a.compatibilidade || b.volumeRatio-a.volumeRatio;});
  v7OpportunityCache={time:Date.now(),data:result.slice(0,10)};
  return v7OpportunityCache.data;
}

app.get("/api/xray", async function(req,res){
  try{
    const id=String(req.query.account||"1");
    const symbol=String(req.query.symbol||"BTCUSDT").toUpperCase();
    const conta=clientes.find(function(c){return c.id===id;});
    if(!conta || !conta.client) return res.status(404).json({erro:"Conta não encontrada."});
    res.json(await obterRaioX(conta,symbol));
  }catch(e){res.status(500).json({erro:e.message});}
});

app.get("/api/opportunities", async function(req,res){
  try{
    const conta=clientes[0];
    if(!conta || !conta.client) return res.status(500).json({erro:"Conta principal indisponível."});
    res.json({atualizadoEm:Date.now(),itens:await obterOportunidades(conta)});
  }catch(e){res.status(500).json({erro:e.message});}
});


/* =========================================================
   CONTROLE MANUAL — THIAGO E SERGIO
   Sem senha por enquanto, conforme solicitado.
   Não altera o robô nem a lógica de leitura do painel.
========================================================= */

const MANUAL_SELL_FEE_RATE = Number(process.env.MANUAL_SELL_FEE_RATE || 0.001);

function contaManual(id){
  return clientes.find(function(c){ return c.id === String(id); }) || null;
}

function validarSymbolManual(symbol){
  const s = String(symbol || "").trim().toUpperCase();
  if(!/^[A-Z0-9]+USDT$/.test(s)) throw new Error("Ativo inválido. Use, por exemplo, TRXUSDT.");
  return s;
}

function decimalPlacesFromStep(step){
  const s = String(step || "");
  if(!s.includes(".")) return 0;
  return Math.max(0, s.split(".")[1].replace(/0+$/,'').length);
}

/*
  Ajuste decimal seguro para quantidades Binance.
  Evita erros de ponto flutuante como 169.83 virar
  internamente 169.82999999999998.
*/
function floorToStep(value, step){
  const v = Number(value || 0);
  const st = Number(step || 0);
  if(!Number.isFinite(v) || v <= 0) return 0;
  if(!Number.isFinite(st) || st <= 0) return v;

  const decimals = Math.max(
    decimalPlacesFromStep(step),
    8
  );

  const fator = Math.pow(10, decimals);
  const vi = Math.floor((v * fator) + 1e-8);
  const si = Math.max(1, Math.round(st * fator));
  const qi = Math.floor(vi / si) * si;

  return Number((qi / fator).toFixed(decimals));
}

function quantidadeValidaFiltro(qty, filtro){
  if(!filtro) return true;
  const q = Number(qty || 0);
  const min = Number(filtro.minQty || 0);
  const max = Number(filtro.maxQty || 0);
  const step = Number(filtro.stepSize || 0);

  if(!Number.isFinite(q) || q <= 0) return false;
  if(min > 0 && q < min - 1e-12) return false;
  if(max > 0 && q > max + 1e-12) return false;
  if(step > 0){
    const base = min > 0 ? min : 0;
    const casas = Math.max(
      decimalPlacesFromStep(filtro.stepSize),
      decimalPlacesFromStep(filtro.minQty || 0),
      8
    );
    const fator = Math.pow(10, casas);
    const qi = Math.round(q * fator);
    const bi = Math.round(base * fator);
    const si = Math.round(step * fator);
    if(si > 0 && ((qi - bi) % si) !== 0) return false;
  }
  return true;
}

function ajustarQuantidadeVenda(filtros, saldoLivre){
  const lot = filtros && filtros.LOT_SIZE ? filtros.LOT_SIZE : null;
  const marketLot = filtros && filtros.MARKET_LOT_SIZE ? filtros.MARKET_LOT_SIZE : null;

  let qty = Number(saldoLivre || 0);
  if(!Number.isFinite(qty) || qty <= 0) return 0;

  /*
    A ordem é MARKET, mas a Binance pode exigir simultaneamente
    LOT_SIZE e MARKET_LOT_SIZE. Primeiro reduzimos pelo LOT_SIZE,
    depois validamos/reduzimos pelo MARKET_LOT_SIZE.
  */
  if(lot && Number(lot.stepSize) > 0){
    qty = floorToStep(qty, lot.stepSize);
  }

  if(marketLot && Number(marketLot.stepSize) > 0){
    qty = floorToStep(qty, marketLot.stepSize);
  }

  /*
    Proteção final: se ainda não passar por algum filtro,
    recua pelo menor passo disponível até encontrar uma quantidade
    que satisfaça os filtros.
  */
  const filtrosQuantidade = [lot, marketLot].filter(Boolean);
  const passos = filtrosQuantidade
    .map(function(f){ return Number(f.stepSize || 0); })
    .filter(function(x){ return x > 0; });
  const passo = passos.length ? Math.max.apply(null, passos) : 0.00000001;

  let tentativas = 0;
  while(filtrosQuantidade.some(function(f){ return !quantidadeValidaFiltro(qty, f); }) && tentativas < 20){
    qty = floorToStep(Math.max(0, qty - passo), passo);
    tentativas++;
  }

  return qty > 0 ? qty : 0;
}

async function obterFiltroSymbolManual(id, symbol){
  const conta = contaManual(id);
  if(!conta || !conta.client) throw new Error("Conta indisponível.");
  const info = await conta.client.exchangeInfo();
  const item = (info.symbols || []).find(function(x){ return String(x.symbol).toUpperCase() === symbol; });
  if(!item) throw new Error("Ativo " + symbol + " não encontrado na Binance.");
  const filtros = {};
  (item.filters || []).forEach(function(f){ filtros[f.filterType] = f; });
  return {conta, item, filtros};
}

/*
  Calcula uma estimativa mais realista para uma venda MARKET:
  percorre os BIDs (compradores) disponíveis no livro da Binance
  até absorver toda a quantidade. Assim o painel não usa apenas
  o último preço negociado.
*/
function estimarVendaLivro(depth, quantidade){
  let restante = Number(quantidade || 0);
  let bruto = 0;
  let executada = 0;
  const bids = Array.isArray(depth && depth.bids) ? depth.bids : [];

  for(const bid of bids){
    const price = num(bid && bid[0]);
    const qty = num(bid && bid[1]);
    if(price <= 0 || qty <= 0 || restante <= 0) continue;
    const usar = Math.min(restante, qty);
    bruto += usar * price;
    executada += usar;
    restante -= usar;
  }

  const precoMedio = executada > 0 ? bruto / executada : 0;
  return {bruto, executada, restante, precoMedio};
}

app.get("/api/manual/preview", async function(req,res){
  try{
    const id = String(req.query.account || "1");
    const symbol = validarSymbolManual(req.query.symbol || "");
    const conta = contaManual(id);
    if(!conta || !conta.client) return res.status(500).json({erro:"Conta indisponível."});

    const account = await conta.client.accountInfo();
    const asset = symbol.replace(/USDT$/i, "");
    const bal = (account.balances || []).find(function(b){ return assetNormalizado(b.asset) === asset; });
    const free = bal ? num(bal.free) : 0;

    let depth = {bids:[]};
    try{ depth = await conta.client.depth({symbol, limit:100}); }catch(e){
      const prices = await conta.client.prices({symbol});
      depth = {bids:[[num(prices[symbol]), free]]};
    }

    let orders=[];
    try{ orders = await conta.client.openOrders({symbol}); }catch(e){}
    const sells = orders.filter(function(o){ return String(o.side).toUpperCase()==="SELL"; });

    const filtroData = await obterFiltroSymbolManual(id, symbol);
    const f = filtroData.filtros || {};
    const lot = f.LOT_SIZE || {};
    const marketLot = f.MARKET_LOT_SIZE || {};
    const minNotional = num((f.NOTIONAL||f.MIN_NOTIONAL||{}).minNotional);
    const qtyStep = num(lot.stepSize) || num(marketLot.stepSize) || 0;
    const qtyMin = num(lot.minQty) || num(marketLot.minQty) || 0;
    const qtyAjustada = ajustarQuantidadeVenda(f, free);
    const est = estimarVendaLivro(depth, qtyAjustada);
    const brl = await obterUSDTBRL(conta.client);
    const taxa = est.bruto * MANUAL_SELL_FEE_RATE;
    const liquido = est.bruto - taxa;

    let operacao = null;
    try{
      const trades = await obterTrades(conta, symbol, 1000);
      operacao = calcularOperacaoAtual(trades);
    }catch(e){}

    const custo = operacao && operacao.ativa ? operacao.quantidade * operacao.entrada : 0;
    const pnl = custo > 0 ? liquido - custo : 0;
    const pnlPct = custo > 0 ? pnl / custo * 100 : 0;

    res.json({
      conta:conta.nome, account:id, symbol, free, quantidadeVenda:qtyAjustada,
      precoAtual:est.precoMedio || 0, melhorBid:num(depth.bids && depth.bids[0] && depth.bids[0][0]),
      quantidadeCobertaLivro:est.executada, quantidadeSemLiquidez:est.restante,
      valorBruto:est.bruto, taxaEstimada:taxa, valorLiquido:liquido,
      custo, pnl, pnlPct,
      brutoBRL:est.bruto*brl, liquidoBRL:liquido*brl, pnlBRL:pnl*brl,
      ordensVenda:sells.map(function(o){return {orderId:o.orderId,type:o.type,status:o.status,price:num(o.price),origQty:num(o.origQty),stopPrice:num(o.stopPrice)};}),
      temVendaAtiva:sells.length>0, minNotional, qtyMin, qtyStep,
      lotSize:{minQty:num(lot.minQty),maxQty:num(lot.maxQty),stepSize:num(lot.stepSize)},
      marketLotSize:{minQty:num(marketLot.minQty),maxQty:num(marketLot.maxQty),stepSize:num(marketLot.stepSize)},
      taxaPercentualEstimada:MANUAL_SELL_FEE_RATE*100,
      usdtBrl:brl,
      atualizadoEm:Date.now()
    });
  }catch(e){ res.status(400).json({erro:e.message}); }
});

app.post("/api/manual/cancel-sell", async function(req,res){
  try{
    const id = String(req.body && req.body.account || "1");
    const symbol = validarSymbolManual(req.body && req.body.symbol);
    const conta = contaManual(id);
    if(!conta || !conta.client) return res.status(500).json({erro:"Conta indisponível."});
    const orders = await conta.client.openOrders({symbol});
    const sells = orders.filter(function(o){ return String(o.side).toUpperCase()==="SELL"; });
    if(!sells.length) return res.json({ok:true,account:id,symbol,canceladas:0,mensagem:"Nenhuma ordem de venda ativa encontrada."});
    const canceladas=[];
    for(const o of sells){
      const r=await conta.client.cancelOrder({symbol,orderId:o.orderId});
      canceladas.push({orderId:o.orderId,status:r.status||"CANCELED"});
    }
    res.json({ok:true,account:id,symbol,canceladas:canceladas.length,ordens:canceladas,mensagem:canceladas.length+" ordem(ns) de venda cancelada(s)."});
  }catch(e){ res.status(400).json({erro:e.message}); }
});

app.post("/api/manual/sell", async function(req,res){
  try{
    const id = String(req.body && req.body.account || "1");
    const symbol = validarSymbolManual(req.body && req.body.symbol);
    const conta = contaManual(id);
    if(!conta || !conta.client) return res.status(500).json({erro:"Conta indisponível."});

    /* Cancela SELLs abertas para liberar o saldo antes da venda manual. */
    try{
      const abertas=await conta.client.openOrders({symbol});
      const sells=abertas.filter(function(o){return String(o.side).toUpperCase()==="SELL";});
      for(const o of sells){ try{await conta.client.cancelOrder({symbol,orderId:o.orderId});}catch(e){} }
    }catch(e){}

    await new Promise(function(resolve){setTimeout(resolve,700);});

    const tradesAntes = await obterTrades(conta,symbol,1000);
    const operacaoAntes = calcularOperacaoAtual(tradesAntes);

    const account = await conta.client.accountInfo();
    const asset = symbol.replace(/USDT$/i, "");
    const bal = (account.balances || []).find(function(b){ return assetNormalizado(b.asset) === asset; });
    const free = bal ? num(bal.free) : 0;
    if(free <= 0) throw new Error("Não há saldo livre de " + asset + " para vender.");

    const filtroData=await obterFiltroSymbolManual(id,symbol);
    const f=filtroData.filtros||{};
    const lot=f.LOT_SIZE || {};
    const marketLot=f.MARKET_LOT_SIZE || {};
    const qty=ajustarQuantidadeVenda(f, free);
    if(qty<=0) throw new Error("Não foi possível encontrar uma quantidade válida para venda de " + symbol + " respeitando LOT_SIZE/MARKET_LOT_SIZE.");

    if(!quantidadeValidaFiltro(qty, lot)){
      throw new Error("Quantidade " + qty + " não atende ao LOT_SIZE da Binance para " + symbol + ".");
    }
    if(marketLot && Number(marketLot.stepSize)>0 && !quantidadeValidaFiltro(qty, marketLot)){
      throw new Error("Quantidade " + qty + " não atende ao MARKET_LOT_SIZE da Binance para " + symbol + ".");
    }

    const prices=await conta.client.prices({symbol});
    const refPrice=num(prices[symbol]);
    const minNotional=num((f.NOTIONAL||f.MIN_NOTIONAL||{}).minNotional);
    if(minNotional>0 && qty*refPrice<minNotional) throw new Error("Valor da venda abaixo do mínimo da Binance para " + symbol + ".");

    /*
      Envia a quantidade já normalizada. Nunca tenta vender uma fração
      maior do que o saldo livre nem uma quantidade fora dos filtros.
    */
    const ordem=await conta.client.order({symbol,side:"SELL",type:"MARKET",quantity:String(qty),newOrderRespType:"FULL"});
    const fills=ordem.fills||[];
    let execQty=num(ordem.executedQty)||qty;
    let bruto=num(ordem.cummulativeQuoteQty);
    if(!bruto && fills.length) bruto=fills.reduce(function(s,f){return s+num(f.qty)*num(f.price);},0);
    if(!bruto) bruto=execQty*refPrice;

    let taxaUSDT=0;
    fills.forEach(function(f){
      const comm=num(f.commission);
      const assetComm=String(f.commissionAsset||"").toUpperCase();
      if(assetComm==="USDT") taxaUSDT+=comm;
      else if(assetComm===asset) taxaUSDT+=comm*num(f.price);
    });
    /*
      A comissão real vem dos fills quando a Binance a informa.
      Se não vier no retorno, usamos apenas como estimativa o
      percentual configurado (padrão 0,10%).
    */
    const taxaFoiInformada = fills.some(function(f){ return num(f.commission) > 0; });
    if(taxaUSDT<=0) taxaUSDT=bruto*MANUAL_SELL_FEE_RATE;
    const liquido=bruto-taxaUSDT;
    const custoBase=operacaoAntes && operacaoAntes.ativa ? operacaoAntes.quantidade * operacaoAntes.entrada : 0;
    const pnl=custoBase>0 ? liquido-custoBase : 0;
    const pnlPct=custoBase>0 ? pnl/custoBase*100 : 0;
    const usdtBrl=await obterUSDTBRL(conta.client);

    res.json({ok:true,account:id,conta:conta.nome,symbol,orderId:ordem.orderId,status:ordem.status,quantidade:execQty,precoMedio:execQty>0?bruto/execQty:refPrice,bruto,taxaUSDT,
      taxaFoiInformadaPelaBinance:taxaFoiInformada,liquido,custo:custoBase,pnl,pnlPct,
      brutoBRL:bruto*usdtBrl,taxaBRL:taxaUSDT*usdtBrl,liquidoBRL:liquido*usdtBrl,custoBRL:custoBase*usdtBrl,pnlBRL:pnl*usdtBrl,
      mensagem:"Venda executada na conta "+conta.nome+"."});
  }catch(e){ res.status(400).json({erro:e.message}); }
});

app.get("/api/status", function (req, res) {
  res.json({
    status: "online",
    sistema: "Binance-Robo",
    painel: "premium-v7",
    contas: 2
  });
});

/*
=========================================================
INTERFACE PREMIUM
=========================================================
*/

app.get("/", function (req, res) {
  res.send(`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Binance-Robo | Central de Operações</title>

<script src="https://unpkg.com/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js"></script>

<style>
:root{
  --bg:#050812;
  --bg2:#09101d;
  --panel:#0d1626;
  --panel2:#111c2e;
  --line:#21304a;
  --text:#f7f9fd;
  --muted:#8290a8;
  --blue:#4aa8ff;
  --green:#20df96;
  --red:#ff6177;
  --yellow:#ffc85a;
  --purple:#8368ff;
}

*{
  box-sizing:border-box;
}

body{
  margin:0;
  color:var(--text);
  background:
    radial-gradient(circle at 20% 0%,#17284c 0%,transparent 34%),
    radial-gradient(circle at 100% 20%,#111b37 0%,transparent 28%),
    var(--bg);
  font-family:Inter,Arial,sans-serif;
}

button,
select{
  font:inherit;
}

.header{
  height:78px;
  border-bottom:1px solid #1a2639;
  background:#04070eee;
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:0 42px;
  position:sticky;
  top:0;
  z-index:20;
  backdrop-filter:blur(15px);
}

.brand{
  display:flex;
  align-items:center;
  gap:13px;
}

.logo{
  width:43px;
  height:43px;
  display:grid;
  place-items:center;
  border-radius:13px;
  background:linear-gradient(135deg,#ffae00,#ffd55b);
  font-size:23px;
  box-shadow:0 8px 25px #0007;
}

.brandTitle{
  font-size:17px;
  font-weight:900;
}

.brandSub{
  color:var(--muted);
  font-size:10px;
  margin-top:2px;
}

.status{
  display:flex;
  align-items:center;
  gap:7px;
  padding:9px 13px;
  border:1px solid #17573f;
  background:#082319;
  border-radius:999px;
  color:var(--green);
  font-size:11px;
  font-weight:800;
}

.statusDot{
  width:7px;
  height:7px;
  border-radius:50%;
  background:var(--green);
  box-shadow:0 0 12px var(--green);
}

.container{
  max-width:1450px;
  margin:auto;
  padding:30px 38px 55px;
}

.hero{
  display:flex;
  justify-content:space-between;
  align-items:end;
  gap:20px;
  margin-bottom:22px;
}

.hero h1{
  margin:0;
  font-size:34px;
}

.hero p{
  margin:7px 0 0;
  color:var(--muted);
  font-size:13px;
}

.update{
  color:var(--muted);
  font-size:10px;
}

.accountTabs{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:14px;
  margin-bottom:22px;
}

.accountTab{
  position:relative;
  cursor:pointer;
  text-align:left;
  border:1px solid var(--line);
  border-radius:17px;
  padding:17px 20px;
  background:linear-gradient(145deg,#0f192a,#0a111e);
  color:var(--text);
  transition:.2s;
}

.accountTab:hover{
  transform:translateY(-1px);
  border-color:#405577;
}

.accountTab.active{
  border-color:#5d73ff;
  background:
    linear-gradient(145deg,#152347,#0b1425);
  box-shadow:0 0 0 1px #5d73ff33,0 12px 35px #0007;
}

.accountTab.active:after{
  content:"";
  position:absolute;
  left:20px;
  right:20px;
  bottom:-1px;
  height:3px;
  background:linear-gradient(90deg,var(--blue),var(--purple));
  border-radius:10px 10px 0 0;
}

.tabTop{
  display:flex;
  justify-content:space-between;
  align-items:center;
}

.tabName{
  font-size:20px;
  font-weight:900;
}

.tabBadge{
  padding:5px 9px;
  border-radius:8px;
  background:#15253d;
  color:#9bc7ff;
  font-size:9px;
  font-weight:800;
}

.tabValues{
  display:grid;
  grid-template-columns:1fr 1fr 1fr;
  gap:12px;
  margin-top:12px;
}

.tabMetric span{
  display:block;
  color:var(--muted);
  font-size:9px;
  margin-bottom:4px;
}

.tabMetric b{
  font-size:13px;
}

.tabMetric small{
  display:block;
  color:#73839b;
  font-size:8px;
  margin-top:3px;
}

.cards{
  display:grid;
  grid-template-columns:repeat(4,1fr);
  gap:14px;
}

.card{
  border:1px solid var(--line);
  border-radius:17px;
  background:
    linear-gradient(145deg,#101b2d,#0a111e);
  box-shadow:0 14px 35px #0005;
}

.metricCard{
  padding:18px;
}

.metricLabel{
  color:var(--muted);
  font-size:10px;
  margin-bottom:8px;
}

.metricValue{
  font-size:24px;
  font-weight:900;
}

.metricSub{
  margin-top:6px;
  color:var(--muted);
  font-size:9px;
}

.green{
  color:var(--green)!important;
}

.red{
  color:var(--red)!important;
}

.blue{
  color:var(--blue)!important;
}

.yellow{
  color:var(--yellow)!important;
}

.section{
  margin-top:20px;
}

.sectionHead{
  display:flex;
  justify-content:space-between;
  align-items:center;
  margin-bottom:11px;
}

.sectionTitle{
  margin:0;
  font-size:16px;
}

.sectionDesc{
  color:var(--muted);
  font-size:9px;
}

.mainGrid{
  display:grid;
  grid-template-columns:1.55fr .75fr;
  gap:17px;
}

.positionCard{
  padding:20px;
}

.positionHeader{
  display:flex;
  justify-content:space-between;
  align-items:flex-start;
}

.positionLabel{
  color:var(--muted);
  font-size:9px;
  margin-bottom:5px;
}

.coin{
  font-size:27px;
  font-weight:900;
}

.positionStatus{
  padding:7px 11px;
  border-radius:999px;
  background:#063a29;
  color:var(--green);
  font-size:9px;
  font-weight:900;
}

.positionGrid{
  display:grid;
  grid-template-columns:repeat(5,1fr);
  gap:9px;
  margin-top:17px;
}

.info{
  padding:12px;
  border:1px solid #1c2940;
  border-radius:11px;
  background:#09111e;
}

.info span{
  color:var(--muted);
  display:block;
  font-size:9px;
  margin-bottom:5px;
}

.info b{
  font-size:12px;
}

.brlLine{
  display:block;
  color:#71809a;
  font-size:9px;
  margin-top:3px;
  font-weight:500;
}

.empty{
  min-height:150px;
  display:grid;
  place-items:center;
  color:var(--muted);
  font-size:12px;
  text-align:center;
}

.assetsCard{
  padding:20px;
}

.assetRow{
  display:grid;
  grid-template-columns:1fr auto;
  gap:10px;
  padding:11px 0;
  border-bottom:1px solid #192438;
}

.assetRow:last-child{
  border-bottom:0;
}

.assetName{
  font-weight:800;
  font-size:12px;
}

.assetAmount{
  color:var(--muted);
  font-size:9px;
  margin-top:3px;
}

.assetValue{
  text-align:right;
  font-weight:800;
  font-size:11px;
}

.chartCard{
  padding:0;
  overflow:hidden;
}

.chartHeader{
  padding:16px 18px;
  border-bottom:1px solid #1b273a;
}

.chartControls{
  display:flex;
  gap:7px;
  flex-wrap:wrap;
  margin-top:11px;
}

.chartControls select,
.chartControls button{
  border:1px solid #293951;
  background:#0b1524;
  color:#dce7f8;
  padding:7px 10px;
  border-radius:8px;
  font-size:10px;
  cursor:pointer;
}

.chartControls button.active{
  background:linear-gradient(135deg,#654eff,#806aff);
  border-color:#8368ff;
}

#chart{
  height:410px;
  width:100%;
}

.liveStrip{
  display:grid;
  grid-template-columns:repeat(4,1fr);
  gap:8px;
  padding:12px 18px;
  border-bottom:1px solid #1b273a;
  background:#08111e;
}

.liveStrip div{
  padding:9px 10px;
  border:1px solid #1a2940;
  border-radius:9px;
  background:#0a1524;
}

.liveStrip span{
  display:block;
  color:var(--muted);
  font-size:8px;
  margin-bottom:4px;
}

.liveStrip b{
  font-size:11px;
}

.chartLegend{
  padding:9px 18px 13px;
  color:var(--muted);
  font-size:9px;
}

.historyCard{
  padding:0;
  overflow:hidden;
}

.historyHead{
  padding:16px 18px;
  border-bottom:1px solid #1b273a;
}

.history{
  max-height:460px;
  overflow:auto;
}

.historyRow{
  display:grid;
  grid-template-columns:1fr .8fr .7fr 1fr;
  gap:7px;
  padding:11px 18px;
  border-bottom:1px solid #182337;
  font-size:10px;
}

.historyRow span:nth-child(2){
  color:#9eabc0;
}

.buy{
  color:var(--green);
  font-weight:800;
}

.sell{
  color:var(--red);
  font-weight:800;
}

.pnlBox{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:14px;
}

.pnlPanel{
  padding:19px;
}

.pnlNumber{
  font-size:25px;
  font-weight:900;
  margin-top:6px;
}

.note{
  margin-top:14px;
  color:#64728a;
  font-size:9px;
  line-height:1.5;
}


/* =====================================================
   V5 - ANALYTICS / STATUS / PERFORMANCE
===================================================== */
.statusGrid{
  display:grid;
  grid-template-columns:repeat(4,1fr);
  gap:14px;
}
.statusCard{padding:16px 18px;}
.statusTop{display:flex;justify-content:space-between;align-items:center;gap:10px;}
.statusName{font-size:11px;font-weight:900;}
.statusBadge{font-size:8px;font-weight:900;padding:5px 8px;border-radius:999px;background:#08291e;color:var(--green);border:1px solid #155b42;}
.statusBadge.warn{background:#302508;color:var(--yellow);border-color:#68521a;}
.statusBadge.err{background:#320d16;color:var(--red);border-color:#6d2030;}
.statusBig{font-size:18px;font-weight:900;margin-top:10px;}
.statusSub{font-size:9px;color:var(--muted);margin-top:5px;line-height:1.5;}
.analyticsGrid{display:grid;grid-template-columns:1.15fr .85fr;gap:17px;}
.analyticsCard{padding:18px;}
.analyticsTitle{font-size:14px;font-weight:900;margin:0;}
.analyticsSub{font-size:9px;color:var(--muted);margin-top:4px;}
.perfTable{width:100%;border-collapse:collapse;margin-top:14px;font-size:10px;}
.perfTable th{color:var(--muted);font-size:8px;text-align:left;padding:8px;border-bottom:1px solid #1d2a40;}
.perfTable td{padding:9px 8px;border-bottom:1px solid #172338;}
.perfTable tr:last-child td{border-bottom:0;}
.rate{font-weight:900;}
.barWrap{display:flex;align-items:center;gap:8px;}
.bar{height:7px;border-radius:99px;background:linear-gradient(90deg,#4aa8ff,#8368ff);min-width:2px;}
.dailyChart{height:220px;display:flex;align-items:flex-end;gap:8px;padding:20px 4px 6px;border-top:1px solid #172338;margin-top:14px;overflow:hidden;}
.dayCol{height:100%;min-width:28px;flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:5px;}
.dayBar{width:100%;max-width:34px;border-radius:6px 6px 2px 2px;background:linear-gradient(180deg,#20df96,#176d52);min-height:2px;}
.dayBar.neg{background:linear-gradient(180deg,#ff6177,#7b2030);}
.dayLabel{font-size:7px;color:#64728a;white-space:nowrap;}
.dayValue{font-size:7px;color:#aab6c8;white-space:nowrap;}
.activity{max-height:280px;overflow:auto;margin-top:12px;}
.activityRow{display:grid;grid-template-columns:72px 78px 1fr auto;gap:8px;align-items:center;padding:9px 0;border-bottom:1px solid #172338;font-size:9px;}
.activityRow:last-child{border-bottom:0;}
.activityTime{color:#66758d;}
.activityCoin{font-weight:900;}
.activityType{font-weight:900;}
.activityPrice{color:#aeb9ca;text-align:right;}
.marketGrid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px;}
.marketMini{padding:12px;border:1px solid #1b2940;border-radius:11px;background:#09111e;}
.marketMini span{display:block;color:var(--muted);font-size:8px;margin-bottom:5px;}
.marketMini b{font-size:13px;}
.signalUnavailable{margin-top:12px;padding:12px;border:1px dashed #33445f;border-radius:10px;color:#8997ac;font-size:9px;line-height:1.5;}
.metricSub .metricSub{margin-top:2px;}

/* =====================================================
   V6 - LAYOUT PREMIUM / OPERAÇÃO ATUAL
===================================================== */
.operationSection{
  position:relative;
}
.operationSection .sectionHead{
  margin-bottom:13px;
}
.operationCompare{
  display:grid;
  grid-template-columns:minmax(0,1fr) 90px minmax(0,1fr);
  gap:12px;
  align-items:stretch;
}
.operationCard{
  padding:20px;
  position:relative;
  overflow:hidden;
  transition:.25s ease;
}
.operationCard:before{
  content:"";
  position:absolute;
  inset:0 0 auto 0;
  height:3px;
  background:linear-gradient(90deg,var(--blue),var(--purple));
}
.operationCard:hover{
  transform:translateY(-2px);
  border-color:#3d5273;
  box-shadow:0 20px 45px #0007;
}
.operationTop{
  display:flex;
  justify-content:space-between;
  gap:12px;
  align-items:flex-start;
}
.operationTop h3{
  margin:8px 0 0;
  font-size:22px;
}
.accountPill{
  display:inline-block;
  padding:4px 7px;
  border-radius:6px;
  background:#17243a;
  color:#9bb7dd;
  font-size:8px;
  font-weight:900;
}
.operationState{
  padding:6px 9px;
  border-radius:999px;
  background:#101c2e;
  color:var(--muted);
  border:1px solid #26364f;
  font-size:8px;
  font-weight:900;
  white-space:nowrap;
}
.operationState.live{
  color:var(--green);
  background:#08291e;
  border-color:#155b42;
}
.operationState.win{
  color:var(--green);
}
.operationState.loss{
  color:var(--red);
  background:#320d16;
  border-color:#6d2030;
}
.operationCoin{
  margin-top:20px;
  font-size:26px;
  font-weight:950;
  letter-spacing:.3px;
}
.operationMain{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:10px;
  margin-top:14px;
  padding:14px;
  border:1px solid #1b2940;
  border-radius:12px;
  background:linear-gradient(145deg,#0a1422,#08101c);
}
.operationMain span,
.operationDetails span{
  display:block;
  color:var(--muted);
  font-size:8px;
  margin-bottom:5px;
}
.operationMain strong{
  display:block;
  font-size:21px;
}
.operationMain small{
  display:block;
  color:#74829a;
  font-size:8px;
  margin-top:3px;
}
.operationDetails{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:9px;
  margin-top:10px;
}
.operationDetails>div{
  padding:10px;
  border:1px solid #1a2940;
  border-radius:10px;
  background:#09111e;
}
.operationDetails b{
  font-size:10px;
}
.versusCard{
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  color:var(--muted);
  font-size:8px;
  font-weight:800;
  text-align:center;
}
.versusCircle{
  width:54px;
  height:54px;
  border-radius:50%;
  display:grid;
  place-items:center;
  color:#fff;
  font-size:13px;
  font-weight:950;
  background:radial-gradient(circle at 30% 25%,#7e6aff,#372a9a 70%);
  box-shadow:0 0 30px #6957ff44;
  border:1px solid #8679ff66;
  margin-bottom:8px;
}
.leaderBadge{
  padding:7px 11px;
  border-radius:999px;
  background:#151d2c;
  border:1px solid #2b3a54;
  color:#aebbd0;
  font-size:8px;
  font-weight:900;
}
.leaderBadge.good{
  background:#08291e;
  color:var(--green);
  border-color:#155b42;
}
.leaderBadge.neutral{
  background:#2b2308;
  color:var(--yellow);
  border-color:#68521a;
}

/* Mais profundidade e hierarquia visual */
.header{
  box-shadow:0 8px 35px #0008;
}
.hero{
  padding:20px 22px;
  border:1px solid #1b2940;
  border-radius:20px;
  background:linear-gradient(135deg,#0f1a2d99,#09111f88);
  box-shadow:0 18px 45px #0005;
}
.cards .card{
  min-height:108px;
}
.cards .card:first-child{
  background:linear-gradient(145deg,#12233a,#0b1422);
}
.accountTab{
  overflow:hidden;
}
.accountTab:before{
  content:"";
  position:absolute;
  width:120px;
  height:120px;
  right:-35px;
  top:-60px;
  border-radius:50%;
  background:#4aa8ff14;
  pointer-events:none;
}
@media(max-width:1000px){
  .statusGrid{grid-template-columns:repeat(2,1fr);}
  .analyticsGrid{grid-template-columns:1fr;}
}
@media(max-width:650px){
  .statusGrid{grid-template-columns:1fr;}
  .marketGrid{grid-template-columns:1fr;}
  .activityRow{grid-template-columns:62px 65px 1fr;}
  .activityPrice{grid-column:3;text-align:left;}
}


/* =========================================================
   CONTROLE MANUAL THIAGO/SERGIO + PROJEÇÃO DE VENDA
========================================================= */
.manualSergio{
  margin-top:16px;
  padding:16px;
  border:1px solid #2b3b55;
  border-radius:14px;
  background:linear-gradient(145deg,#0d1829,#09121f);
}
.manualHead{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px;}
.manualTitle{font-size:12px;font-weight:950;}
.manualBadge{font-size:8px;font-weight:900;padding:5px 8px;border-radius:999px;background:#342808;color:#ffc85a;border:1px solid #6a5215;}
.manualInputs{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:10px;}
.manualInput{width:100%;border:1px solid #293951;background:#08111e;color:#f7f9fd;padding:10px 11px;border-radius:9px;font-size:11px;outline:none;}
.manualInput:focus{border-color:#5d73ff;box-shadow:0 0 0 2px #5d73ff22;}
.manualButtons{display:grid;grid-template-columns:1fr 1fr 1fr;gap:9px;}
.manualBtn{border:0;padding:11px 10px;border-radius:9px;color:#fff;font-size:10px;font-weight:950;cursor:pointer;transition:.18s;}
.manualBtn:hover{filter:brightness(1.12);transform:translateY(-1px);}
.manualSell{background:#b5223c;}
.manualCancel{background:#74570f;}
.manualRefresh{background:#243753;}
.manualProjection{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:10px;}
.manualMetric{padding:9px;border:1px solid #1c2b41;border-radius:9px;background:#08111e;}
.manualMetric span{display:block;color:#71809a;font-size:8px;margin-bottom:4px;}
.manualMetric b{font-size:11px;}
.manualResult{margin-top:10px;padding:10px;border-radius:9px;border:1px solid #263750;background:#08111e;color:#aebbd0;font-size:9px;line-height:1.55;}
.manualResult.good{border-color:#155b42;background:#08291e;color:#baf3da;}
.manualResult.bad{border-color:#6d2030;background:#320d16;color:#ffc0c9;}
.manualNote{margin-top:8px;color:#60718b;font-size:8px;line-height:1.45;}
@media(max-width:700px){.manualInputs,.manualButtons,.manualProjection{grid-template-columns:1fr 1fr}.manualRefresh{grid-column:1/-1}}

.footer{
  text-align:center;
  color:#59677d;
  font-size:9px;
  padding-top:28px;
}

@media(max-width:1000px){
  .cards{
    grid-template-columns:repeat(2,1fr);
  }

  .mainGrid{
    grid-template-columns:1fr;
  }

  .positionGrid{
    grid-template-columns:repeat(3,1fr);
  }
}

@media(max-width:650px){
  .header{
    padding:0 15px;
  }

  .container{
    padding:20px 14px 40px;
  }

  .hero{
    display:block;
  }

  .update{
    margin-top:10px;
  }

  .accountTabs{
    grid-template-columns:1fr;
  }

  .cards{
    grid-template-columns:1fr;
  }

  .tabValues{
    grid-template-columns:1fr 1fr;
  }

  .positionGrid{
    grid-template-columns:1fr 1fr;
  }

  .pnlBox{
    grid-template-columns:1fr;
  }

  .liveStrip{
    grid-template-columns:1fr 1fr;
  }
}


/* ================= V7 ================= */
.v7Grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;}
.v7Grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;}
.v7Card{background:linear-gradient(145deg,#101c30,#0b1422);border:1px solid #1d2c44;border-radius:18px;padding:20px;box-shadow:0 12px 35px rgba(0,0,0,.14);}
.v7Title{font-size:18px;font-weight:900;margin:0 0 5px;}
.v7Sub{font-size:11px;color:#73829a;margin-bottom:16px;line-height:1.5;}
.v7HeroGrid{display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:12px;}
.v7BigMetric{padding:15px;border:1px solid #1d2c44;border-radius:14px;background:#0c1728;}
.v7BigMetric span{display:block;color:#71809a;font-size:10px;text-transform:uppercase;font-weight:800;}
.v7BigMetric b{display:block;font-size:22px;margin-top:7px;}
.v7MiniGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;}
.v7Mini{padding:11px;border-radius:12px;background:#0b1524;border:1px solid #1a2a41;}
.v7Mini span{display:block;color:#697891;font-size:9px;text-transform:uppercase;font-weight:800;}
.v7Mini b{display:block;margin-top:5px;font-size:14px;}
.v7Good{color:#20df96!important}.v7Bad{color:#ff6177!important}.v7Warn{color:#ffc85a!important}.v7Blue{color:#59a8ff!important}
.v7StatusRow{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 0;border-bottom:1px solid #17263b;}
.v7StatusRow:last-child{border-bottom:0}.v7Dot{width:9px;height:9px;border-radius:50%;display:inline-block;margin-right:7px;background:#64748b;}
.v7Dot.ok{background:#20df96;box-shadow:0 0 12px rgba(32,223,150,.45)}.v7Dot.bad{background:#ff6177}.v7Dot.warn{background:#ffc85a}
.v7Badge{font-size:9px;font-weight:900;padding:5px 8px;border-radius:999px;background:#14243a;color:#9ebbe3;}
.v7Alert{display:flex;gap:10px;align-items:flex-start;padding:12px;border-radius:13px;margin-top:10px;border:1px solid #20324b;background:#0b1626;}
.v7Alert:first-child{margin-top:0}.v7AlertIcon{font-size:18px}.v7AlertText{font-size:11px;line-height:1.45;color:#b7c3d5}.v7AlertText b{color:#fff}
.v7Table{width:100%;border-collapse:collapse;font-size:11px}.v7Table th{font-size:9px;color:#667792;text-align:left;padding:9px 6px;border-bottom:1px solid #1c2c43;text-transform:uppercase}.v7Table td{padding:10px 6px;border-bottom:1px solid #142238}.v7Table tr:last-child td{border-bottom:0}
.v7BarWrap{height:11px;border-radius:999px;background:#111e31;overflow:hidden}.v7Bar{height:100%;border-radius:999px;background:#27b9ff;}
.v7Progress{margin-top:8px}.v7ProgressTop{display:flex;justify-content:space-between;font-size:9px;color:#71809a}.v7Canvas{width:100%;height:220px;display:block;border:1px solid #17273d;border-radius:14px;background:#091321;}
.v7Legend{display:flex;gap:16px;flex-wrap:wrap;font-size:9px;color:#71809a;margin-top:10px}.v7Legend span{display:inline-flex;align-items:center;gap:5px}.v7Legend i{width:8px;height:8px;border-radius:50%;display:inline-block;background:#27b9ff}
.v7Opportunity{display:grid;grid-template-columns:90px 1fr auto;gap:12px;align-items:center;padding:12px 0;border-bottom:1px solid #16263c}.v7Opportunity:last-child{border-bottom:0}.v7Coin{font-weight:900;font-size:13px}.v7ScoreBox{width:82px;text-align:center;padding:9px;border-radius:12px;background:#0b1829;border:1px solid #1e3550}.v7ScoreBox b{display:block;font-size:18px}.v7ScoreBox small{font-size:8px;color:#71809a;text-transform:uppercase}
.v7Check{display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #142238;font-size:10px}.v7Check:last-child{border-bottom:0}.v7Check b{font-size:10px}.v7Note{font-size:9px;color:#60718b;line-height:1.5;margin-top:10px}.v7Time{font-variant-numeric:tabular-nums;color:#8fa1bb;font-size:10px}.v7Rank{font-size:18px;font-weight:900}.v7Rank.gold{color:#ffc85a}.v7Rank.silver{color:#b9c6d6}.v7Rank.bronze{color:#d79a63}
@media(max-width:1000px){.v7Grid,.v7Grid3{grid-template-columns:1fr}.v7HeroGrid{grid-template-columns:1fr 1fr}.v7Opportunity{grid-template-columns:82px 1fr auto}}
@media(max-width:650px){.v7HeroGrid{grid-template-columns:1fr}.v7MiniGrid{grid-template-columns:1fr 1fr}.v7Opportunity{grid-template-columns:72px 1fr}.v7ScoreBox{grid-column:1/-1;width:auto}}


/* =========================================================
   V7 COMPACTA — PAINEL PRINCIPAL + SUBMENUS
   ========================================================= */

.accountTab{
  cursor:pointer;
}

.accountTab:focus-visible,
.menuBtn:focus-visible,
.quickCurrent button:focus-visible,
.sectionClose:focus-visible{
  outline:2px solid #7aa2ff;
  outline-offset:2px;
}

.tabMetric .tabPnlExtra{
  display:block;
  margin-top:4px;
  font-size:11px;
  font-weight:800;
  color:#71809a;
}

.tabMetric .tabPnlExtra.green{color:#00e89a;}
.tabMetric .tabPnlExtra.red{color:#ff5274;}

.compactControl{
  margin:18px 0 8px;
}

.quickCurrent{
  display:grid;
  grid-template-columns:1.4fr 1fr auto;
  align-items:center;
  gap:16px;
  padding:14px 18px;
  border:1px solid rgba(102,130,255,.22);
  border-radius:18px;
  background:linear-gradient(135deg,rgba(22,35,67,.92),rgba(9,18,35,.96));
  box-shadow:0 12px 35px rgba(0,0,0,.16);
}

.quickCurrentLabel{
  display:block;
  color:#74829a;
  font-size:10px;
  font-weight:800;
  letter-spacing:.08em;
  margin-bottom:4px;
}

.quickCurrentMain{
  display:flex;
  align-items:center;
  gap:10px;
  flex-wrap:wrap;
}

.quickCurrentCoin{
  font-size:18px;
  font-weight:950;
  color:#f5f7ff;
}

.quickCurrentStatus{
  padding:4px 8px;
  border-radius:999px;
  background:rgba(38,211,143,.10);
  color:#00e89a;
  font-size:9px;
  font-weight:900;
}

.quickCurrentPnl{
  font-size:17px;
  font-weight:950;
}

.quickCurrentPct{
  font-size:13px;
  font-weight:900;
  margin-left:5px;
}

.quickCurrent button{
  border:1px solid rgba(122,162,255,.35);
  background:rgba(77,111,255,.12);
  color:#9fc2ff;
  border-radius:11px;
  padding:10px 14px;
  font-weight:900;
  cursor:pointer;
}

.dashboardMenu{
  display:grid;
  grid-template-columns:repeat(4,1fr);
  gap:9px;
  margin:10px 0 4px;
}

.menuBtn{
  border:1px solid rgba(116,135,174,.18);
  background:rgba(14,25,46,.72);
  color:#aab7ce;
  border-radius:13px;
  padding:11px 10px;
  cursor:pointer;
  font-size:11px;
  font-weight:900;
  transition:.18s ease;
}

.menuBtn:hover,
.menuBtn.active{
  border-color:rgba(112,143,255,.65);
  background:rgba(59,86,163,.20);
  color:#f3f6ff;
  transform:translateY(-1px);
}

section.section.compactHidden{
  display:none !important;
}

section.section.compactOpen{
  display:block !important;
  animation:compactOpen .22s ease;
}

@keyframes compactOpen{
  from{opacity:0;transform:translateY(-5px)}
  to{opacity:1;transform:translateY(0)}
}

.sectionClose{
  float:right;
  border:1px solid rgba(116,135,174,.25);
  background:rgba(255,255,255,.035);
  color:#8e9bb1;
  border-radius:9px;
  padding:6px 9px;
  font-size:10px;
  font-weight:900;
  cursor:pointer;
  margin-top:-2px;
}

.sectionClose:hover{
  color:#fff;
  border-color:rgba(122,162,255,.55);
}

.cards.compactHidden{
  display:none !important;
}

.compactHint{
  text-align:center;
  color:#59677d;
  font-size:10px;
  margin:8px 0 0;
}

@media(max-width:800px){
  .quickCurrent{
    grid-template-columns:1fr 1fr;
  }
  .quickCurrent button{
    grid-column:1/-1;
    width:100%;
  }
  .dashboardMenu{
    grid-template-columns:repeat(2,1fr);
  }
}

@media(max-width:500px){
  .quickCurrent{
    grid-template-columns:1fr;
  }
  .dashboardMenu{
    grid-template-columns:1fr 1fr;
  }
}


/* =========================================================
   CRIPTOPRO - NAVEGAÇÃO DO PAINEL / DASHBOARD NAVIGATION
========================================================= */

.panelNavigation{
  width:100%;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  margin-bottom:18px;
  padding:12px 14px;
  background:rgba(4,7,14,.92);
  border:1px solid var(--line);
  border-radius:14px;
  box-shadow:0 10px 30px rgba(0,0,0,.20);
}

.panelNavigationLeft,
.panelNavigationRight{
  display:flex;
  align-items:center;
  gap:10px;
}

.panelLanguage{
  color:var(--muted);
  font-size:11px;
  font-weight:800;
  text-align:center;
  letter-spacing:.2px;
}

.panelNavBtn{
  border:1px solid var(--line);
  border-radius:10px;
  padding:9px 14px;
  color:#fff;
  font-size:12px;
  font-weight:900;
  cursor:pointer;
  transition:transform .18s ease,filter .18s ease;
}

.panelNavBtn:hover{
  transform:translateY(-1px);
  filter:brightness(1.12);
}

.panelBackBtn{
  background:#0030B9;
  border-color:#2458e8;
}

.panelLogoutBtn{
  background:#8b1e2d;
  border-color:#b52a3b;
}

.panelLanguageLegend{
  display:inline-flex;
  align-items:center;
  gap:5px;
  padding:8px 11px;
  border-radius:9px;
  background:#0b1220;
  border:1px solid #1b2940;
}

@media(max-width:700px){
  .panelNavigation{
    flex-wrap:wrap;
    justify-content:center;
  }

  .panelNavigationLeft,
  .panelNavigationRight{
    width:100%;
    justify-content:center;
  }

  .panelLanguage{
    width:100%;
    order:2;
  }

  .panelNavBtn{
    min-width:140px;
  }
}


.panelNavigationWrap{
  max-width:1400px;
  margin:0 auto;
  padding:18px 28px 0;
}
@media(max-width:700px){
  .panelNavigationWrap{
    padding:14px 14px 0;
  }
}

</style>
</head>

<body>

<header class="header">
  <div class="brand">
    <div class="logo">🤖</div>
    <div>
      <div class="brandTitle">Binance-Robo</div>
      <div class="brandSub">Central de Controle Premium • THIAGO / SERGIO</div>
    </div>
  </div>

  <div class="status">
    <span class="statusDot"></span>
    ONLINE
  </div>
</header>


<!-- ======================================================
     CRIPTOPRO - NAVEGAÇÃO DO PAINEL
     ====================================================== -->

<div class="panelNavigationWrap">
  <div class="panelNavigation">

    <div class="panelNavigationLeft">

      <button
        type="button"
        class="panelNavBtn panelBackBtn"
        onclick="voltarPlanos()"
      >
        ← Voltar / Back
      </button>

    </div>

    <div class="panelLanguage">
      <span class="panelLanguageLegend">
        🇧🇷 Português / 🇺🇸 English
      </span>
    </div>

    <div class="panelNavigationRight">

      <button
        type="button"
        class="panelNavBtn panelLogoutBtn"
        onclick="sairSistema()"
      >
        ↪ Sair / Logout
      </button>

    </div>

  </div>
</div>

<div class="container">

  <div class="hero">
    <div>
      <h1 id="pageTitle">THIAGO</h1>
      <p id="pageSubtitle">Painel individual da sua conta Binance.</p>
    </div>

    <div id="updated" class="update">
      Atualizando...
    </div>
  </div>

  <!-- BOTÕES DAS DUAS CONTAS -->
  <div class="accountTabs">

    <button id="tab1" class="accountTab active" onclick="selecionarConta('1')">
      <div class="tabTop">
        <div class="tabName">👤 THIAGO</div>
        <div class="tabBadge">CONTA 1</div>
      </div>

      <div class="tabValues">
        <div class="tabMetric">
          <span>PATRIMÔNIO</span>
          <b id="tabPat1">--</b>
          <small id="tabPatBrl1">--</small>
        </div>

        <div class="tabMetric">
          <span>P/L ATUAL</span>
          <b id="tabPnl1">--</b>
          <small id="tabPnlExtra1" class="tabPnlExtra">--</small>
        </div>

        <div class="tabMetric">
          <span>OPERAÇÕES</span>
          <b id="tabOps1">--</b>
        </div>
      </div>
    </button>


    <button id="tab2" class="accountTab" onclick="selecionarConta('2')">
      <div class="tabTop">
        <div class="tabName">👤 SERGIO</div>
        <div class="tabBadge">CONTA 2</div>
      </div>

      <div class="tabValues">
        <div class="tabMetric">
          <span>PATRIMÔNIO</span>
          <b id="tabPat2">--</b>
          <small id="tabPatBrl2">--</small>
        </div>

        <div class="tabMetric">
          <span>P/L ATUAL</span>
          <b id="tabPnl2">--</b>
          <small id="tabPnlExtra2" class="tabPnlExtra">--</small>
        </div>

        <div class="tabMetric">
          <span>OPERAÇÕES</span>
          <b id="tabOps2">--</b>
        </div>
      </div>
    </button>

  </div>

  <!-- =====================================================
       V7 COMPACTA — RESUMO PRINCIPAL
       ===================================================== -->
  <div class="compactControl">

    <div class="quickCurrent">
      <div>
        <span class="quickCurrentLabel">OPERAÇÃO ATUAL</span>
        <div class="quickCurrentMain">
          <span id="quickCoin" class="quickCurrentCoin">--</span>
          <span id="quickStatus" class="quickCurrentStatus">AGUARDANDO</span>
        </div>
      </div>

      <div>
        <span class="quickCurrentLabel">RESULTADO DESDE A COMPRA</span>
        <div>
          <span id="quickPnl" class="quickCurrentPnl">--</span>
          <span id="quickPct" class="quickCurrentPct">--</span>
        </div>
      </div>

      <button type="button" onclick="abrirSecaoPainel(3)">
        VER DETALHES
      </button>
    </div>

    <div class="dashboardMenu" id="dashboardMenu">

      <button type="button" class="menuBtn" data-panel="0" onclick="abrirSecaoPainel(0)">
        🎯 Operação
      </button>

      <button type="button" class="menuBtn" data-panel="1" onclick="abrirSecaoPainel(1)">
        📊 Gráfico
      </button>

      <button type="button" class="menuBtn" data-panel="2" onclick="abrirSecaoPainel(2)">
        🤖 Robô
      </button>

      <button type="button" class="menuBtn" data-panel="3" onclick="abrirSecaoPainel(3)">
        🏆 Comparação
      </button>

      <button type="button" class="menuBtn" data-panel="4" onclick="abrirSecaoPainel(4)">
        📚 Performance
      </button>

      <button type="button" class="menuBtn" data-panel="5" onclick="abrirSecaoPainel(5)">
        🪙 Moedas
      </button>

      <button type="button" class="menuBtn" data-panel="6" onclick="abrirSecaoPainel(6)">
        📜 Atividade
      </button>

      <button type="button" class="menuBtn" data-panel="7" onclick="abrirSecaoPainel(7)">
        🚨 Alertas
      </button>

      <button type="button" class="menuBtn" data-panel="8" onclick="abrirSecaoPainel(8)">
        📈 Patrimônio
      </button>

      <button type="button" class="menuBtn" data-panel="9" onclick="abrirSecaoPainel(9)">
        🧪 Raio-X
      </button>

      <button type="button" class="menuBtn" data-panel="10" onclick="abrirSecaoPainel(10)">
        🕵️ Auditoria
      </button>

      <button type="button" class="menuBtn" data-panel="11" onclick="abrirSecaoPainel(11)">
        💰 P/L
      </button>

    </div>

    <div class="compactHint">
      Toque/clique em uma categoria para abrir os detalhes. A tela principal fica limpa e objetiva.
    </div>

  </div>


  <!-- CARDS DA CONTA SELECIONADA -->
  <div class="cards compactHidden">

    <div class="card metricCard">
      <div class="metricLabel">💰 PATRIMÔNIO</div>
      <div id="patrimonio" class="metricValue">--</div>
      <div id="patrimonioBRL" class="metricSub">--</div>
    </div>

    <div class="card metricCard">
      <div class="metricLabel">📈 LUCRO / PERDA</div>
      <div id="pnl" class="metricValue">--</div>
      <div id="pnlDetalhe" class="metricSub">--</div>
    </div>

    <div class="card metricCard">
      <div class="metricLabel">🟢 OPERAÇÕES ATIVAS</div>
      <div id="operacoes" class="metricValue">--</div>
      <div class="metricSub">Posições detectadas</div>
    </div>

    <div class="card metricCard">
      <div class="metricLabel">🪙 ATIVOS</div>
      <div id="ativos" class="metricValue">--</div>
      <div class="metricSub">Ativos com valor</div>
    </div>

  </div>


  <!-- POSIÇÃO + ATIVOS -->
  <section class="section">

    <div class="sectionHead">
      <div>
        <h2 class="sectionTitle">🎯 Operação da conta</h2>
        <div class="sectionDesc">
          Informações da conta selecionada
        </div>
      </div>
    </div>

    <div class="mainGrid">

      <div id="position" class="card positionCard"></div>

      <div class="card assetsCard">
        <h3 class="sectionTitle">🪙 Carteira</h3>
        <div class="sectionDesc" style="margin-top:4px">
          Maiores ativos por valor
        </div>
        <div id="assets" style="margin-top:10px"></div>
      </div>

    </div>

  </section>


  <!-- GRÁFICO + HISTÓRICO -->
  <section class="section">

    <div class="sectionHead">
      <div>
        <h2 class="sectionTitle">📊 Mercado e histórico</h2>
        <div class="sectionDesc">
          Gráfico individual da conta selecionada
        </div>
      </div>
    </div>

    <div class="mainGrid">

      <div class="card chartCard">

        <div class="chartHeader">

          <div style="font-weight:900;font-size:14px">
            Gráfico da operação
          </div>

          <div class="chartControls">

            <select id="symbolSelect">
              <option value="">MOEDA DA OPERAÇÃO</option>
            </select>

            <button class="interval active" data-i="15m">
              15m
            </button>

            <button class="interval" data-i="1h">
              1h
            </button>

            <button class="interval" data-i="4h">
              4h
            </button>

          </div>

        </div>

        <div class="liveStrip">
          <div>
            <span>MOEDA</span>
            <b id="chartCoin">--</b>
          </div>
          <div>
            <span>PREÇO ATUAL</span>
            <b id="chartPrice">--</b>
          </div>
          <div>
            <span>VARIAÇÃO DESDE A ENTRADA</span>
            <b id="chartVariation">--</b>
          </div>
          <div>
            <span>ALVO DE VENDA</span>
            <b id="chartTarget">--</b>
          </div>
        </div>

        <div id="chart"></div>

        <div class="chartLegend">
          🟢 Entrada/compra &nbsp;&nbsp;
          🟡 Take Profit &nbsp;&nbsp;
          🔴 Stop Loss &nbsp;&nbsp;
          📈 % desde a entrada
        </div>

      </div>


      <div class="card historyCard">

        <div class="historyHead">
          <div style="font-weight:900;font-size:14px">
            🧾 Últimas operações
          </div>

          <div class="sectionDesc" style="margin-top:4px">
            Somente da conta selecionada
          </div>
        </div>

        <div id="history" class="history"></div>

      </div>

    </div>

  </section>


  <!-- STATUS DO ROBÔ / CONEXÕES -->
  <section class="section">
    <div class="sectionHead">
      <div>
        <h2 class="sectionTitle">🤖 Status e inteligência</h2>
        <div class="sectionDesc">Conexão das duas contas e leitura operacional sem enviar ordens.</div>
      </div>
    </div>

    <div class="statusGrid">
      <div class="card statusCard">
        <div class="statusTop"><div class="statusName">THIAGO • BINANCE</div><div id="statusBadge1" class="statusBadge">VERIFICANDO</div></div>
        <div id="statusBig1" class="statusBig">--</div>
        <div id="statusSub1" class="statusSub">Aguardando leitura da API.</div>
      </div>
      <div class="card statusCard">
        <div class="statusTop"><div class="statusName">SERGIO • BINANCE</div><div id="statusBadge2" class="statusBadge">VERIFICANDO</div></div>
        <div id="statusBig2" class="statusBig">--</div>
        <div id="statusSub2" class="statusSub">Aguardando leitura da API.</div>
      </div>
      <div class="card statusCard">
        <div class="statusTop"><div class="statusName">ÚLTIMA COMPRA</div><div class="statusBadge">HISTÓRICO</div></div>
        <div id="statusLastBuy" class="statusBig">--</div>
        <div id="statusLastBuySub" class="statusSub">--</div>
      </div>
      <div class="card statusCard">
        <div class="statusTop"><div class="statusName">ÚLTIMA VENDA</div><div class="statusBadge">HISTÓRICO</div></div>
        <div id="statusLastSell" class="statusBig">--</div>
        <div id="statusLastSellSub" class="statusSub">--</div>
      </div>
    </div>
  </section>

  <!-- COMPARAÇÃO DA OPERAÇÃO ATUAL -->
  <section class="section operationSection">
    <div class="sectionHead">
      <div>
        <h2 class="sectionTitle">🏆 Operação atual • THIAGO × SERGIO</h2>
        <div class="sectionDesc">Comparação feita somente a partir da compra que iniciou a posição atual — operações antigas ficam fora deste indicador.</div>
      </div>
      <div id="operationLeader" class="leaderBadge">AGUARDANDO DADOS</div>
    </div>

    <div class="operationCompare">
      <div id="opCard1" class="card operationCard">
        <div class="operationTop">
          <div><span class="accountPill">CONTA 1</span><h3>THIAGO</h3></div>
          <div id="opStatus1" class="operationState">SEM OPERAÇÃO</div>
        </div>
        <div class="operationCoin" id="opCoin1">--</div>
        <div class="operationMain">
          <div><span>RESULTADO</span><strong id="opPnl1">--</strong><small id="opPnlBrl1">--</small></div>
          <div><span>VARIAÇÃO</span><strong id="opPct1">--</strong></div>
        </div>
        <div class="operationDetails">
          <div><span>Entrada</span><b id="opEntry1">--</b></div>
          <div><span>Atual</span><b id="opCurrent1">--</b></div>
          <div><span>Quantidade</span><b id="opQty1">--</b></div>
          <div><span>Início</span><b id="opTime1">--</b></div>
        </div>
      </div>

      <div class="versusCard">
        <div class="versusCircle">VS</div>
        <div id="versusText">Comparando</div>
      </div>

      <div id="opCard2" class="card operationCard">
        <div class="operationTop">
          <div><span class="accountPill">CONTA 2</span><h3>SERGIO</h3></div>
          <div id="opStatus2" class="operationState">SEM OPERAÇÃO</div>
        </div>
        <div class="operationCoin" id="opCoin2">--</div>
        <div class="operationMain">
          <div><span>RESULTADO</span><strong id="opPnl2">--</strong><small id="opPnlBrl2">--</small></div>
          <div><span>VARIAÇÃO</span><strong id="opPct2">--</strong></div>
        </div>
        <div class="operationDetails">
          <div><span>Entrada</span><b id="opEntry2">--</b></div>
          <div><span>Atual</span><b id="opCurrent2">--</b></div>
          <div><span>Quantidade</span><b id="opQty2">--</b></div>
          <div><span>Início</span><b id="opTime2">--</b></div>
        </div>
      </div>
    </div>
  </section>

  <!-- PERFORMANCE HISTÓRICA -->
  <section class="section">

    <div class="analyticsGrid">
      <div class="card analyticsCard">
        <h3 class="analyticsTitle">📚 Performance histórica</h3>
        <div class="analyticsSub">Histórico separado da operação atual. Pode incluir operações anteriores retornadas pela Binance.</div>
        <table class="perfTable">
          <thead><tr><th>INDICADOR</th><th>THIAGO</th><th>SERGIO</th><th>TOTAL</th></tr></thead>
          <tbody id="performanceTable"></tbody>
        </table>
      </div>

      <div class="card analyticsCard">
        <h3 class="analyticsTitle">📈 Lucro / perda por dia</h3>
        <div class="analyticsSub">Últimos dias com trades disponíveis nas contas.</div>
        <div id="dailyChart" class="dailyChart"></div>
      </div>
    </div>
  </section>

  <!-- MOEDAS + MERCADO + ATIVIDADE -->
  <section class="section">
    <div class="analyticsGrid">
      <div class="card analyticsCard">
        <h3 class="analyticsTitle">🪙 Ranking das moedas</h3>
        <div class="analyticsSub">Resultado estimado por ativo nas operações disponíveis.</div>
        <table class="perfTable">
          <thead><tr><th>MOEDA</th><th>OP.</th><th>COMPRAS</th><th>VENDAS</th><th>RESULTADO</th></tr></thead>
          <tbody id="coinRanking"></tbody>
        </table>
      </div>

      <div class="card analyticsCard">
        <h3 class="analyticsTitle">🔥 Temperatura do mercado</h3>
        <div class="analyticsSub">Leitura técnica simples do BTC, apenas informativa.</div>
        <div class="marketGrid">
          <div class="marketMini"><span>BTC</span><b id="marketPrice">--</b></div>
          <div class="marketMini"><span>RSI 14</span><b id="marketRsi">--</b></div>
          <div class="marketMini"><span>EMA 21</span><b id="marketEma">--</b></div>
          <div class="marketMini"><span>LEITURA</span><b id="marketState">--</b></div>
        </div>
        <div class="signalUnavailable"><strong>🧠 SCORE DA ENTRADA:</strong> o score interno do robô não é fornecido pela API da Binance. Para mostrar exatamente o score, filtros RSI/EMA/volume e motivo da entrada, o robô precisaria registrar esses dados em uma fonte compartilhada. O painel não altera o robô nesta versão.</div>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="card analyticsCard">
      <h3 class="analyticsTitle">📜 Atividade recente do robô</h3>
      <div class="analyticsSub">Eventos de compra/venda identificados no histórico das duas contas.</div>
      <div id="activity" class="activity"></div>
    </div>
  </section>



  <!-- V7: PLACAR / ALERTAS / SAÚDE -->
  <section class="section">
    <div class="v7Grid">
      <div class="v7Card">
        <h3 class="v7Title">🏆 Placar da operação em tempo real</h3>
        <div class="v7Sub">Comparação somente da operação atual detectada, desde a compra.</div>
        <div class="v7HeroGrid">
          <div class="v7BigMetric"><span>Líder</span><b id="v7Leader">--</b></div>
          <div class="v7BigMetric"><span>Diferença</span><b id="v7Diff">--</b></div>
          <div class="v7BigMetric"><span>Tempo da operação</span><b id="v7Elapsed">--</b></div>
        </div>
        <div class="v7MiniGrid" style="margin-top:12px">
          <div class="v7Mini"><span>THIAGO</span><b id="v7ThiagoPnl">--</b></div>
          <div class="v7Mini"><span>SERGIO</span><b id="v7SergioPnl">--</b></div>
          <div class="v7Mini"><span>THIAGO R$</span><b id="v7ThiagoBrl">--</b></div>
          <div class="v7Mini"><span>SERGIO R$</span><b id="v7SergioBrl">--</b></div>
        </div>
      </div>

      <div class="v7Card">
        <h3 class="v7Title">🚨 Alertas inteligentes</h3>
        <div class="v7Sub">Avisos operacionais calculados pelo painel. Não enviam ordens.</div>
        <div id="v7Alerts"><div class="v7Alert"><div class="v7AlertIcon">⏳</div><div class="v7AlertText">Aguardando dados...</div></div></div>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="v7Grid">
      <div class="v7Card">
        <h3 class="v7Title">🤖 Saúde do robô</h3>
        <div class="v7Sub">Diagnóstico da conexão e da atividade observada pelo painel.</div>
        <div id="v7Health"></div>
      </div>
      <div class="v7Card">
        <h3 class="v7Title">📈 Curva de patrimônio — sessão</h3>
        <div class="v7Sub">Evolução observada enquanto esta página permanece aberta. Reiniciar a página reinicia a amostra.</div>
        <canvas id="v7EquityCanvas" class="v7Canvas"></canvas>
        <div class="v7Legend"><span><i></i>Patrimônio total das duas contas</span><span id="v7EquityInfo">--</span></div>
      </div>
    </div>
  </section>

  <!-- V7: RAIO-X -->
  <section class="section">
    <div class="v7Grid">
      <div class="v7Card">
        <h3 class="v7Title">🧪 Raio-X da moeda atual</h3>
        <div class="v7Sub">Leitura técnica do painel usando os mesmos limites principais configurados no robô. O score interno original não é inventado.</div>
        <div id="v7Xray"></div>
      </div>
      <div class="v7Card">
        <h3 class="v7Title">🎯 Ranking de oportunidades</h3>
        <div class="v7Sub">Pré-seleção técnica informativa baseada em mercado USDT com maior volume. Não representa o score interno do robô.</div>
        <div id="v7Opportunities"><div class="empty">Calculando oportunidades...</div></div>
      </div>
    </div>
  </section>

  <!-- V7: AUDITORIA / LINHA DO TEMPO -->
  <section class="section">
    <div class="v7Card">
      <h3 class="v7Title">🕵️ Auditoria das operações</h3>
      <div class="v7Sub">Linha do tempo das compras e vendas que a Binance disponibiliza ao painel.</div>
      <div id="v7Timeline"></div>
    </div>
  </section>

  <!-- PNL DETALHADO -->
  <section class="section">

    <div class="pnlBox">

      <div class="card pnlPanel">
        <div class="metricLabel">
          💵 P/L REALIZADO
        </div>

        <div id="pnlRealizado" class="pnlNumber">
          --
        </div>

        <div class="metricSub">
          Resultado estimado de operações já encerradas.
        </div>
      </div>


      <div class="card pnlPanel">
        <div class="metricLabel">
          📊 P/L EM ABERTO
        </div>

        <div id="pnlAberto" class="pnlNumber">
          --
        </div>

        <div class="metricSub">
          Resultado estimado das posições atuais.
        </div>
      </div>

    </div>

  </section>


  <div class="note">
    A seção “Operação atual” considera somente a posição aberta após a última venda do ativo.
    O histórico continua separado para não contaminar a comparação THIAGO × SERGIO. O painel é de leitura, com controle manual exclusivo da conta SERGIO para venda/cancelamento de SELL.
  </div>

  <div class="footer">
    Binance-Robo • THIAGO / SERGIO • Central Premium • Atualização automática a cada 15 segundos
  </div>

</div>


<script>

let dados = null;
let contaSelecionada = "1";
let chart = null;
let candleSeries = null;
let intervaloSelecionado = "15m";


function dinheiro(v){
  return Number(v || 0).toLocaleString(
    "pt-BR",
    {
      minimumFractionDigits:2,
      maximumFractionDigits:2
    }
  );
}


function numero(v){
  return Number(v || 0).toLocaleString(
    "pt-BR",
    {
      minimumFractionDigits:2,
      maximumFractionDigits:8
    }
  );
}


function classe(v){
  return Number(v || 0) >= 0
    ? "green"
    : "red";
}


function dataHora(t){
  if(!t) return "--";

  return new Date(t).toLocaleString(
    "pt-BR"
  );
}


function selecionarConta(id){

  contaSelecionada = String(id);

  document
    .getElementById("tab1")
    .classList.toggle(
      "active",
      contaSelecionada === "1"
    );

  document
    .getElementById("tab2")
    .classList.toggle(
      "active",
      contaSelecionada === "2"
    );

  renderConta();

  carregarGrafico();
}


function preencherTabs(){

  if(!dados || !dados.contas) return;

  dados.contas.forEach(function(c){

    const pat =
      document.getElementById(
        "tabPat" + c.id
      );

    const pnl =
      document.getElementById(
        "tabPnl" + c.id
      );

    const ops =
      document.getElementById(
        "tabOps" + c.id
      );

    if(!pat) return;

    pat.textContent =
      dinheiro(c.patrimonioUSDT) +
      " USDT";

    const opAtual =
      c.operacaoAtual &&
      c.operacaoAtual.ativa
        ? c.operacaoAtual
        : null;

    const pnlAtual =
      Number(opAtual ? opAtual.pnlUSDT : 0);

    const pctAtual =
      Number(opAtual ? opAtual.pnlPct : 0);

    if(opAtual){

      pnl.textContent =
        (pnlAtual >= 0 ? "+" : "") +
        dinheiro(pnlAtual) +
        " USDT";

      pnl.className =
        classe(pnlAtual);

    }else{

      pnl.textContent =
        "SEM OPERAÇÃO";

      pnl.className =
        "muted";

    }

    const extra =
      document.getElementById(
        "tabPnlExtra" + c.id
      );

    if(extra){

      if(opAtual){

        const pnlBrl =
          pnlAtual *
          Number(c.usdtBrl || 0);

        extra.textContent =
          "≈ R$ " +
          dinheiro(pnlBrl) +
          " • " +
          (pctAtual >= 0 ? "+" : "") +
          pctAtual.toFixed(2) +
          "%";

        extra.className =
          "tabPnlExtra " +
          classe(pctAtual);

      }else{

        extra.textContent =
          "Sem operação atual";

        extra.className =
          "tabPnlExtra";

      }
    }

    const brl =
      document.getElementById(
        "tabPatBrl" + c.id
      );

    if(brl){
      brl.textContent =
        "≈ R$ " +
        dinheiro(c.patrimonioBRL);
    }

    ops.textContent =
      (c.posicoes || []).length;
  });
}


function renderConta(){

  if(!dados) return;

  const c =
    dados.contas.find(function(x){
      return x.id === contaSelecionada;
    });

  if(!c) return;


  document.getElementById(
    "pageTitle"
  ).textContent =
    c.nome;


  document.getElementById(
    "pageSubtitle"
  ).textContent =
    c.nome === "THIAGO"
      ? "Painel individual da sua conta Binance."
      : "Painel individual da conta de Sergio.";


  document.getElementById(
    "patrimonio"
  ).textContent =
    dinheiro(c.patrimonioUSDT) +
    " USDT";


  document.getElementById(
    "patrimonioBRL"
  ).textContent =
    "R$ " +
    dinheiro(c.patrimonioBRL) +
    " • USDT/BRL " +
    dinheiro(c.usdtBrl);


  const pnl =
    Number(c.pnlTotalEstimado || 0);


  const pnlEl =
    document.getElementById("pnl");


  pnlEl.textContent =
    (pnl >= 0 ? "+" : "") +
    dinheiro(pnl) +
    " USDT";


  pnlEl.className =
    "metricValue " +
    classe(pnl);


  document.getElementById(
    "pnlDetalhe"
  ).innerHTML =
    "Realizado: " +
    dinheiro(c.pnlRealizado) +
    " USDT • Aberto: " +
    dinheiro(c.pnlNaoRealizado) +
    " USDT" +
    '<br><span style="color:#71809a">' +
    "≈ R$ " +
    dinheiro(
      Number(c.pnlTotalEstimado || 0) *
      Number(c.usdtBrl || 0)
    ) +
    "</span>";


  document.getElementById(
    "operacoes"
  ).textContent =
    (c.posicoes || []).length;


  document.getElementById(
    "ativos"
  ).textContent =
    c.totalAtivos;


  renderPosicao(c);

  renderAtivos(c);

  renderHistorico(c);

  atualizarResumoCompacto();

  // Mantém o gráfico na moeda da operação atual.
  const select =
    document.getElementById(
      "symbolSelect"
    );

  const pos =
    (c.posicoes || [])[0];

  if(pos && pos.symbol){

    if(
      !Array.from(select.options).some(
        function(o){
          return o.value === pos.symbol;
        }
      )
    ){

      const opt =
        document.createElement(
          "option"
        );

      opt.value = pos.symbol;
      opt.textContent = pos.symbol;

      select.appendChild(opt);
    }

    select.value = pos.symbol;
  }
}


function renderPosicao(c){

  const el =
    document.getElementById(
      "position"
    );

  const pos =
    (c.posicoes || [])[0];


  if(!pos){

    el.innerHTML =
      '<div class="empty">' +
        '<div>' +
          '<div style="font-size:25px">💤</div>' +
          '<div style="margin-top:8px">' +
            'Nenhuma posição ativa detectada.' +
          '</div>' +
        '</div>' +
      '</div>' +
      (renderManual(c, null));

    return;
  }


  const pnl =
    Number(pos.pnlNaoRealizado || 0);


  el.innerHTML =

    '<div class="positionHeader">' +

      '<div>' +

        '<div class="positionLabel">' +
          'OPERAÇÃO ATIVA DETECTADA' +
        '</div>' +

        '<div class="coin">' +
          pos.symbol +
        '</div>' +

      '</div>' +

      '<div class="positionStatus">' +
        '● POSIÇÃO ATIVA' +
      '</div>' +

    '</div>' +


    '<div class="positionGrid">' +

      info("Entrada",
        dinheiro(pos.precoMedio) + " USDT" +
        '<small class="brlLine">≈ R$ ' +
        dinheiro(pos.precoMedio * c.usdtBrl) +
        '</small>') +

      info("Preço atual",
        dinheiro(pos.precoAtual) + " USDT" +
        '<small class="brlLine">≈ R$ ' +
        dinheiro(pos.precoAtual * c.usdtBrl) +
        '</small>') +

      info("P/L",
        '<span class="' +
        classe(pnl) +
        '">' +
        (pnl >= 0 ? "+" : "") +
        dinheiro(pnl) +
        ' (' +
        Number(
          pos.pnlNaoRealizadoPct || 0
        ).toFixed(2) +
        '%)' +
        '</span>') +

      info("Quantidade",
        numero(pos.quantidade)) +

      info("Valor",
        dinheiro(pos.valorAtual) + " USDT") +

    '</div>' +


    '<div class="positionGrid">' +

      info("Take Profit",
        pos.tp
          ? dinheiro(pos.tp.price) +
            " USDT" +
            '<small class="brlLine">≈ R$ ' +
            dinheiro(pos.tp.price * c.usdtBrl) +
            '</small>'
          : "--") +

      info("Stop Loss",
        pos.sl
          ? dinheiro(pos.sl.stopPrice) +
            " USDT" +
            '<small class="brlLine">≈ R$ ' +
            dinheiro(pos.sl.stopPrice * c.usdtBrl) +
            '</small>'
          : "--") +

      info("Ordens abertas",
        String(pos.ordensAbertas)) +

      info("Último trade",
        pos.ultimaOperacao
          ? (
              pos.ultimaOperacao.lado +
              " • " +
              dataHora(
                pos.ultimaOperacao.time
              )
            )
          : "--") +

      info("Realizado",
        dinheiro(pos.pnlRealizado) +
        " USDT") +

    '</div>' +

    (renderManual(c, pos));
}

function renderManual(c, pos){
  const account = String(c && c.id || contaSelecionada || "1");
  const nome = String(c && c.nome || (account === "2" ? "SERGIO" : "THIAGO"));
  const symbol = pos && pos.symbol ? pos.symbol : "TRXUSDT";
  const qty = Number(pos && pos.quantidade || 0);
  const entry = Number(pos && pos.precoMedio || 0);
  const current = Number(pos && pos.precoAtual || 0);
  const brl = Number(c && c.usdtBrl || 0);
  const bruto = qty * current;
  const taxa = bruto * 0.001;
  const liquido = bruto - taxa;
  const custo = qty * entry;
  const pnl = custo > 0 ? liquido - custo : 0;
  const pct = custo > 0 ? pnl / custo * 100 : 0;
  const ativoLabel = pos ? symbol : "Informe o ativo";
  return '<div class="manualSergio">' +
    '<div class="manualHead"><div class="manualTitle">🎛️ CONTROLE MANUAL — '+nome+'</div><div class="manualBadge">CONTA '+account+' • SEM SENHA</div></div>' +
    '<div class="manualInputs">' +
      '<input id="manualSymbol" class="manualInput" value="'+ativoLabel+'" placeholder="Ex.: TRXUSDT" oninput="manualAtualizarProjecao()">' +
      '<input id="manualQtyInfo" class="manualInput" value="'+(pos?numero(qty):"Saldo será lido automaticamente")+'" readonly>' +
    '</div>' +
    '<div class="manualProjection">' +
      '<div class="manualMetric"><span>VALOR BRUTO DA VENDA</span><b id="manualBruto">'+dinheiro(bruto)+' USDT</b><small class="brlLine">≈ R$ '+dinheiro(bruto*brl)+'</small></div>' +
      '<div class="manualMetric"><span>VALOR LÍQUIDO ESTIMADO</span><b id="manualLiquido">'+dinheiro(liquido)+' USDT</b><small class="brlLine">≈ R$ '+dinheiro(liquido*brl)+'</small></div>' +
      '<div class="manualMetric"><span>LUCRO / PERDA NA VENDA</span><b id="manualPnl" class="'+classe(pnl)+'">'+(pnl>=0?'+':'')+dinheiro(pnl)+' USDT</b><small id="manualPnlPct" class="brlLine">'+(pnl>=0?'+':'')+pct.toFixed(2)+'% • R$ '+(pnl>=0?'+':'')+dinheiro(pnl*brl)+'</small></div>' +
      '<div class="manualMetric"><span>PREÇO DE VENDA ESTIMADO</span><b id="manualPrice">'+dinheiro(current)+' USDT</b><small class="brlLine">≈ R$ '+dinheiro(current*brl)+'</small></div>' +
    '</div>' +
    '<div class="manualButtons">' +
      '<button class="manualBtn manualSell" onclick="manualVender()">🔴 VENDER POSIÇÃO</button>' +
      '<button class="manualBtn manualCancel" onclick="manualCancelarVenda()">🟡 CANCELAR VENDA ATIVA</button>' +
      '<button class="manualBtn manualRefresh" onclick="manualAtualizarProjecao()">🔄 ATUALIZAR VALOR</button>' +
    '</div>' +
    '<div id="manualResult" class="manualResult">A quantidade e o preço de venda são consultados automaticamente na Binance.</div>' +
    '<div class="manualNote">A estimativa usa o livro de ofertas da Binance (BIDs) para aproximar o valor de uma venda MARKET. O resultado final usa a execução efetiva retornada pela Binance.</div>' +
  '</div>';
}

function manualMsg(text, cls){
  const el=document.getElementById("manualResult");
  if(!el)return;
  el.className="manualResult"+(cls?" "+cls:"");
  el.innerHTML=text;
}

async function manualAtualizarProjecao(){
  const input=document.getElementById("manualSymbol");
  if(!input)return;
  const symbol=String(input.value||"").trim().toUpperCase();
  if(!/^[A-Z0-9]+USDT$/.test(symbol)){ manualMsg("Informe um ativo no formato <b>TRXUSDT</b>."); return; }
  manualMsg("Consultando saldo, livro de ofertas e ordens da Binance...");
  try{
    const r=await fetch("/api/manual/preview?account="+encodeURIComponent(contaSelecionada)+"&symbol="+encodeURIComponent(symbol),{cache:"no-store"});
    const d=await r.json(); if(!r.ok)throw new Error(d.erro||"Falha ao consultar");
    const brl=Number(d.usdtBrl||0), bruto=Number(d.valorBruto||0), taxa=Number(d.taxaEstimada||0), liquido=Number(d.valorLiquido||0);
    const elQty=document.getElementById("manualQtyInfo"); if(elQty)elQty.value=numero(d.quantidadeVenda||0);
    const e1=document.getElementById("manualBruto"); if(e1)e1.innerHTML=dinheiro(bruto)+" USDT<small class='brlLine'>≈ R$ "+dinheiro(bruto*brl)+"</small>";
    const e2=document.getElementById("manualLiquido"); if(e2)e2.innerHTML=dinheiro(liquido)+" USDT<small class='brlLine'>≈ R$ "+dinheiro(liquido*brl)+"</small>";
    const e4=document.getElementById("manualPrice"); if(e4)e4.innerHTML=dinheiro(d.precoAtual||0)+" USDT<small class='brlLine'>≈ R$ "+dinheiro(Number(d.precoAtual||0)*brl)+"</small>";
    const ep=document.getElementById("manualPnl"); if(ep){ep.className=classe(Number(d.pnl||0));ep.textContent=(d.pnl>=0?"+":"")+dinheiro(d.pnl||0)+" USDT";}
    const epp=document.getElementById("manualPnlPct"); if(epp)epp.textContent=(d.pnl>=0?"+":"")+Number(d.pnlPct||0).toFixed(2)+"% • R$ "+(d.pnlBRL>=0?"+":"")+dinheiro(d.pnlBRL||0);
    manualMsg((d.temVendaAtiva?"🟡 Existe(m) "+d.ordensVenda.length+" ordem(ns) SELL ativa(s).":"🟢 Nenhuma SELL ativa encontrada.")+"<br>Quantidade segura para venda: <b>"+numero(d.quantidadeVenda||0)+" "+symbol.replace(/USDT$/,'')+"</b> • Preço médio estimado pelo livro: <b>"+dinheiro(d.precoAtual||0)+" USDT</b> • Taxa estimada: "+dinheiro(taxa)+" USDT ("+Number(d.taxaPercentualEstimada||0).toFixed(3)+"%).");
  }catch(e){manualMsg("❌ "+(e.message||"Não foi possível consultar"),"bad");}
}

async function manualCancelarVenda(){
  const input=document.getElementById("manualSymbol"); const symbol=String(input&&input.value||"").trim().toUpperCase();
  if(!/^[A-Z0-9]+USDT$/.test(symbol)){manualMsg("Informe um ativo válido.","bad");return;}
  const nome = contaSelecionada === "2" ? "SERGIO" : "THIAGO";
  if(!confirm("Cancelar todas as ordens SELL ativas de "+symbol+" na conta "+nome+"?"))return;
  manualMsg("Cancelando ordem(ns) SELL...");
  try{
    const r=await fetch("/api/manual/cancel-sell",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({account:contaSelecionada,symbol})});
    const d=await r.json();if(!r.ok)throw new Error(d.erro||"Falha");
    manualMsg("🟡 "+d.mensagem,"");
    setTimeout(manualAtualizarProjecao,700);
  }catch(e){manualMsg("❌ "+(e.message||"Falha ao cancelar"),"bad");}
}

async function manualVender(){
  const input=document.getElementById("manualSymbol"); const symbol=String(input&&input.value||"").trim().toUpperCase();
  if(!/^[A-Z0-9]+USDT$/.test(symbol)){manualMsg("Informe um ativo válido.","bad");return;}
  const nome = contaSelecionada === "2" ? "SERGIO" : "THIAGO";
  if(!confirm("CONFIRMA A VENDA REAL de toda a quantidade livre de "+symbol+" na conta "+nome+"?"))return;
  manualMsg("🔴 Enviando venda MARKET para a Binance...");
  try{
    const r=await fetch("/api/manual/sell",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({account:contaSelecionada,symbol})});
    const d=await r.json();if(!r.ok)throw new Error(d.erro||"Falha na venda");
    const classeP=Number(d.pnl||0)>=0?"good":"bad";
    const palavra=Number(d.pnl||0)>=0?"LUCRO":"PERDA";
    manualMsg("<b>✅ VENDA EXECUTADA</b><br>"+symbol+" • Quantidade: "+numero(d.quantidade)+"<br>Preço médio executado: <b>"+dinheiro(d.precoMedio)+" USDT</b><br>Valor bruto: "+dinheiro(d.bruto)+" USDT • Taxa: <b>"+dinheiro(d.taxaUSDT)+" USDT</b> • Líquido: <b>"+dinheiro(d.liquido)+" USDT</b><br>Resultado: <b>"+palavra+" "+(d.pnl>=0?"+":"")+dinheiro(d.pnl)+" USDT • "+(d.pnlPct>=0?"+":"")+Number(d.pnlPct||0).toFixed(2)+"% • R$ "+(d.pnlBRL>=0?"+":"")+dinheiro(d.pnlBRL)+"</b><br><small>"+(d.taxaFoiInformadaPelaBinance?"Taxa retornada pela Binance na execução.":"Taxa estimada por fallback, pois a Binance não retornou a comissão no retorno da ordem.")+"</small>",classeP);
    setTimeout(carregar,1200);
  }catch(e){manualMsg("❌ "+(e.message||"Falha na venda"),"bad");}
}


function info(titulo, valor){

  return (
    '<div class="info">' +
      '<span>' +
        titulo +
      '</span>' +
      '<b>' +
        valor +
      '</b>' +
    '</div>'
  );
}


function renderAtivos(c){

  const el =
    document.getElementById(
      "assets"
    );

  const ativos =
    (c.ativos || []).slice(0,8);


  if(!ativos.length){

    el.innerHTML =
      '<div class="empty">' +
        'Nenhum ativo com valor encontrado.' +
      '</div>';

    return;
  }


  el.innerHTML =
    ativos.map(function(a){

      return (
        '<div class="assetRow">' +

          '<div>' +
            '<div class="assetName">' +
              a.asset +
            '</div>' +

            '<div class="assetAmount">' +
              numero(a.total) +
            '</div>' +
          '</div>' +

          '<div class="assetValue">' +
            dinheiro(a.valorUSDT) +
            ' USDT' +
            '<div class="assetAmount">' +
              'R$ ' +
              dinheiro(a.valorBRL) +
            '</div>' +
          '</div>' +

        '</div>'
      );

    }).join("");
}


function renderHistorico(c){

  const el =
    document.getElementById(
      "history"
    );

  const lista =
    (c.historico || [])
      .slice(0,35);


  if(!lista.length){

    el.innerHTML =
      '<div class="empty">' +
        'Nenhuma operação encontrada.' +
      '</div>';

    return;
  }


  el.innerHTML =
    lista.map(function(h){

      return (
        '<div class="historyRow">' +

          '<span>' +
            h.symbol +
          '</span>' +

          '<span>' +
            numero(h.qty) +
          '</span>' +

          '<span class="' +
            (
              h.lado === "COMPRA"
                ? "buy"
                : "sell"
            ) +
          '">' +
            h.lado +
          '</span>' +

          '<span>' +
            dinheiro(h.price) +
            '<br>' +
            '<small style="color:#627089">' +
              dataHora(h.time) +
            '</small>' +
          '</span>' +

        '</div>'
      );

    }).join("");
}


function renderPnl(c){

  const realizado =
    Number(c.pnlRealizado || 0);

  const aberto =
    Number(c.pnlNaoRealizado || 0);


  const a =
    document.getElementById(
      "pnlRealizado"
    );

  const b =
    document.getElementById(
      "pnlAberto"
    );


  const taxa =
    c
      ? Number(c.usdtBrl || 0)
      : 0;

  a.innerHTML =
    (realizado >= 0 ? "+" : "") +
    dinheiro(realizado) +
    " USDT" +
    '<div class="metricSub">≈ R$ ' +
    dinheiro(realizado * taxa) +
    '</div>';

  b.innerHTML =
    (aberto >= 0 ? "+" : "") +
    dinheiro(aberto) +
    " USDT" +
    '<div class="metricSub">≈ R$ ' +
    dinheiro(aberto * taxa) +
    '</div>';


  a.className =
    "pnlNumber " +
    classe(realizado);

  b.className =
    "pnlNumber " +
    classe(aberto);
}


/*
=========================================================
ANALYTICS V5
=========================================================
*/

function getConta(id){
  if(!dados || !dados.contas) return null;
  return dados.contas.find(function(c){ return c.id === String(id); }) || null;
}

function estatisticasConta(c){
  const h = (c && c.historico) ? c.historico.slice().sort(function(a,b){ return Number(a.time)-Number(b.time); }) : [];
  let buys=0, sells=0, capitalBuy=0, capitalSell=0;
  const filas={};
  let realized=0;
  const coins={};

  h.forEach(function(t){
    const symbol=t.symbol;
    const qty=Number(t.qty||0);
    const price=Number(t.price||0);
    if(!symbol || qty<=0 || price<=0) return;
    if(!coins[symbol]) coins[symbol]={op:0,buy:0,sell:0,result:0};
    coins[symbol].op++;
    if(t.lado === "COMPRA"){
      buys++;
      capitalBuy += qty*price;
      coins[symbol].buy++;
      if(!filas[symbol]) filas[symbol]=[];
      filas[symbol].push({qty:qty,price:price});
    }else{
      sells++;
      capitalSell += qty*price;
      coins[symbol].sell++;
      let rest=qty;
      if(!filas[symbol]) filas[symbol]=[];
      while(rest>0.0000000001 && filas[symbol].length){
        const lote=filas[symbol][0];
        const used=Math.min(rest,lote.qty);
        const r=used*(price-lote.price);
        realized += r;
        coins[symbol].result += r;
        lote.qty -= used;
        rest -= used;
        if(lote.qty<=0.0000000001) filas[symbol].shift();
      }
    }
  });

  const wins = Object.values(coins).filter(function(x){ return x.sell>0 && x.result>0; }).length;
  const losses = Object.values(coins).filter(function(x){ return x.sell>0 && x.result<0; }).length;
  const closed = wins+losses;

  return {
    buys,sells,total:buys+sells,realized,
    wins,losses,closed,
    winRate:closed ? (wins/closed)*100 : 0,
    coins,
    roi: capitalBuy>0 ? (realized/capitalBuy)*100 : 0
  };
}

function renderCurrentOperation(){
  const c1=getConta("1");
  const c2=getConta("2");
  const contas=[c1,c2];
  const ops=contas.map(function(c){ return c && c.operacaoAtual ? c.operacaoAtual : null; });

  contas.forEach(function(c,idx){
    const n=idx+1;
    const op=ops[idx];
    const card=document.getElementById("opCard"+n);
    const state=document.getElementById("opStatus"+n);
    if(!op || !op.ativa){
      state.textContent="SEM OPERAÇÃO";
      state.className="operationState";
      document.getElementById("opCoin"+n).textContent="--";
      document.getElementById("opPnl"+n).textContent="--";
      document.getElementById("opPnl"+n).className="";
      document.getElementById("opPnlBrl"+n).textContent="--";
      document.getElementById("opPct"+n).textContent="--";
      document.getElementById("opPct"+n).className="";
      document.getElementById("opEntry"+n).textContent="--";
      document.getElementById("opCurrent"+n).textContent="--";
      document.getElementById("opQty"+n).textContent="--";
      document.getElementById("opTime"+n).textContent="--";
      return;
    }

    const pct=Number(op.pnlPct||0);
    const pnl=Number(op.pnlUSDT||0);
    const conta=c;
    state.textContent="OPERAÇÃO ATIVA";
    state.className="operationState live "+(pct>=0?"win":"loss");
    document.getElementById("opCoin"+n).textContent=op.symbol || "--";
    document.getElementById("opPnl"+n).textContent=(pnl>=0?"+":"")+dinheiro(pnl)+" USDT";
    document.getElementById("opPnl"+n).className=classe(pnl);
    document.getElementById("opPnlBrl"+n).textContent="≈ R$ "+dinheiro(pnl*Number(conta.usdtBrl||0));
    document.getElementById("opPct"+n).textContent=(pct>=0?"+":"")+pct.toFixed(2)+"%";
    document.getElementById("opPct"+n).className=classe(pct);
    document.getElementById("opEntry"+n).textContent=dinheiro(op.entrada)+" USDT";
    document.getElementById("opCurrent"+n).textContent=dinheiro(op.precoAtual)+" USDT";
    document.getElementById("opQty"+n).textContent=numero(op.quantidade);
    document.getElementById("opTime"+n).textContent=dataHora(op.entradaTime);
  });

  const a=ops[0], b=ops[1];
  const leader=document.getElementById("operationLeader");
  const versus=document.getElementById("versusText");
  if(a && b && a.ativa && b.ativa){
    if(a.pnlPct>b.pnlPct){
      leader.textContent="🥇 THIAGO NA FRENTE";
      leader.className="leaderBadge good";
      versus.textContent="THIAGO +"+(Number(a.pnlPct)-Number(b.pnlPct)).toFixed(2)+" p.p.";
    }else if(b.pnlPct>a.pnlPct){
      leader.textContent="🥇 SERGIO NA FRENTE";
      leader.className="leaderBadge good";
      versus.textContent="SERGIO +"+(Number(b.pnlPct)-Number(a.pnlPct)).toFixed(2)+" p.p.";
    }else{
      leader.textContent="⚖️ EMPATE";
      leader.className="leaderBadge neutral";
      versus.textContent="Mesma variação";
    }
  }else if(a && a.ativa){
    leader.textContent="THIAGO • ÚNICA OPERAÇÃO";
    leader.className="leaderBadge neutral";
    versus.textContent="SERGIO sem posição";
  }else if(b && b.ativa){
    leader.textContent="SERGIO • ÚNICA OPERAÇÃO";
    leader.className="leaderBadge neutral";
    versus.textContent="THIAGO sem posição";
  }else{
    leader.textContent="AGUARDANDO OPERAÇÕES";
    leader.className="leaderBadge";
    versus.textContent="Sem posições ativas";
  }
}

function renderAnalytics(){
  if(!dados || !dados.contas) return;
  const c1=getConta("1"), c2=getConta("2");
  renderCurrentOperation();
  const s1=estatisticasConta(c1), s2=estatisticasConta(c2);

  const total={
    buys:s1.buys+s2.buys,
    sells:s1.sells+s2.sells,
    total:s1.total+s2.total,
    realized:s1.realized+s2.realized,
    wins:s1.wins+s2.wins,
    losses:s1.losses+s2.losses,
    closed:s1.closed+s2.closed
  };
  total.winRate=total.closed ? total.wins/total.closed*100 : 0;

  const rows=[
    ["Operações",s1.total,s2.total,total.total],
    ["Compras",s1.buys,s2.buys,total.buys],
    ["Vendas",s1.sells,s2.sells,total.sells],
    ["Operações positivas",s1.wins,s2.wins,total.wins],
    ["Operações negativas",s1.losses,s2.losses,total.losses],
    ["Taxa de acerto",s1.winRate.toFixed(1)+"%",s2.winRate.toFixed(1)+"%",total.winRate.toFixed(1)+"%"],
    ["Resultado realizado",(s1.realized>=0?"+":"")+dinheiro(s1.realized)+" USDT",(s2.realized>=0?"+":"")+dinheiro(s2.realized)+" USDT",(total.realized>=0?"+":"")+dinheiro(total.realized)+" USDT"],
    ["ROI estimado",s1.roi.toFixed(2)+"%",s2.roi.toFixed(2)+"%",(s1.roi+s2.roi).toFixed(2)+"%"]
  ];
  document.getElementById("performanceTable").innerHTML=rows.map(function(r){
    return "<tr><td>"+r[0]+"</td><td>"+r[1]+"</td><td>"+r[2]+"</td><td>"+r[3]+"</td></tr>";
  }).join("");

  renderDaily(c1,c2);
  renderRanking(c1,c2);
  renderActivity(c1,c2);
  renderStatuses(c1,c2);
  carregarMercado();
}

function renderDaily(c1,c2){
  // Calcula o resultado realizado por dia usando FIFO por moeda,
  // somente com os trades que a Binance devolveu para o painel.
  const all=[];
  [c1,c2].forEach(function(c){
    (c && c.historico || []).forEach(function(t){
      all.push({...t, conta:c.nome});
    });
  });
  all.sort(function(a,b){return Number(a.time)-Number(b.time);});

  const filas={};
  const map={};
  all.forEach(function(t){
    const symbol=t.symbol, qty=Number(t.qty||0), price=Number(t.price||0);
    if(!symbol || qty<=0 || price<=0) return;
    if(!filas[symbol]) filas[symbol]=[];
    if(t.lado === "COMPRA"){
      filas[symbol].push({qty:qty,price:price});
    }else{
      let rest=qty;
      let result=0;
      while(rest>0.0000000001 && filas[symbol].length){
        const lote=filas[symbol][0];
        const used=Math.min(rest,lote.qty);
        result += used*(price-lote.price);
        lote.qty -= used;
        rest -= used;
        if(lote.qty<=0.0000000001) filas[symbol].shift();
      }
      const d=new Date(t.time).toLocaleDateString("pt-BR");
      if(!map[d]) map[d]=0;
      map[d]+=result;
    }
  });

  const keys=Object.keys(map).slice(-14);
  if(!keys.length){
    document.getElementById("dailyChart").innerHTML='<div class="empty">Ainda não há vendas suficientes para calcular lucro por dia.</div>';
    return;
  }

  const vals=keys.map(function(k){return map[k];});
  const max=Math.max.apply(null,vals.map(function(v){return Math.abs(v);}).concat([0.01]));
  const min=Math.min.apply(null,vals);
  const maxVal=Math.max.apply(null,vals);
  const scale=Math.max(Math.abs(min),Math.abs(maxVal),0.01);

  document.getElementById("dailyChart").innerHTML=keys.map(function(k){
    const v=map[k];
    const h=Math.max(4,Math.round(Math.abs(v)/scale*145));
    const cls=v<0?' neg':'';
    return '<div class="dayCol"><div class="dayValue '+classe(v)+'">'+(v>=0?'+':'')+dinheiro(v)+'</div><div class="dayBar'+cls+'" style="height:'+h+'px"></div><div class="dayLabel">'+k.slice(0,5)+'</div></div>';
  }).join("");
}

function renderRanking(c1,c2){
  const map={};
  [c1,c2].forEach(function(c){
    const e=estatisticasConta(c);
    Object.keys(e.coins).forEach(function(symbol){
      if(!map[symbol]) map[symbol]={op:0,buy:0,sell:0,result:0};
      map[symbol].op+=e.coins[symbol].op;
      map[symbol].buy+=e.coins[symbol].buy;
      map[symbol].sell+=e.coins[symbol].sell;
      map[symbol].result+=e.coins[symbol].result;
    });
  });
  const arr=Object.keys(map).map(function(symbol){ return {symbol:symbol,...map[symbol]}; }).sort(function(a,b){ return b.op-a.op; }).slice(0,12);
  document.getElementById("coinRanking").innerHTML=arr.length ? arr.map(function(x){
    return '<tr><td><b>'+x.symbol+'</b></td><td>'+x.op+'</td><td>'+x.buy+'</td><td>'+x.sell+'</td><td class="'+classe(x.result)+'">'+(x.result>=0?'+':'')+dinheiro(x.result)+' USDT</td></tr>';
  }).join("") : '<tr><td colspan="5">Sem trades suficientes.</td></tr>';
}

function renderActivity(c1,c2){
  const list=[];
  [c1,c2].forEach(function(c){
    (c && c.historico || []).slice(0,35).forEach(function(t){ list.push({...t,conta:c.nome}); });
  });
  list.sort(function(a,b){ return Number(b.time)-Number(a.time); });
  document.getElementById("activity").innerHTML=list.slice(0,30).map(function(t){
    return '<div class="activityRow"><span class="activityTime">'+dataHora(t.time).split(',')[1]+'</span><span class="activityCoin">'+t.conta+'</span><span class="activityType '+(t.lado==="COMPRA"?'buy':'sell')+'">'+t.lado+' • '+t.symbol+'</span><span class="activityPrice">'+dinheiro(t.price)+' • '+numero(t.qty)+'</span></div>';
  }).join("") || '<div class="empty">Nenhuma atividade encontrada.</div>';
}

function renderStatuses(c1,c2){
  [c1,c2].forEach(function(c){
    if(!c) return;
    const badge=document.getElementById("statusBadge"+c.id);
    const big=document.getElementById("statusBig"+c.id);
    const sub=document.getElementById("statusSub"+c.id);
    if(c.erro){
      badge.textContent="ERRO"; badge.className="statusBadge err";
      big.textContent="API indisponível";
      sub.textContent=c.erro;
    }else{
      badge.textContent="API ONLINE"; badge.className="statusBadge";
      big.textContent="Conectada";
      const last=(c.historico||[])[0];
      sub.textContent=last ? "Último trade: "+last.symbol+" • "+dataHora(last.time) : "Conta consultada com sucesso.";
    }
  });

  const all=[];
  [c1,c2].forEach(function(c){ (c&&c.historico||[]).forEach(function(t){ all.push({...t,conta:c.nome}); }); });
  all.sort(function(a,b){return Number(b.time)-Number(a.time);});
  const buy=all.find(function(t){return t.lado==="COMPRA";});
  const sell=all.find(function(t){return t.lado==="VENDA";});
  document.getElementById("statusLastBuy").textContent=buy ? buy.conta+" • "+buy.symbol : "--";
  document.getElementById("statusLastBuySub").textContent=buy ? dinheiro(buy.price)+" USDT • "+dataHora(buy.time) : "--";
  document.getElementById("statusLastSell").textContent=sell ? sell.conta+" • "+sell.symbol : "--";
  document.getElementById("statusLastSellSub").textContent=sell ? dinheiro(sell.price)+" USDT • "+dataHora(sell.time) : "--";
}

async function carregarMercado(){
  try{
    const r=await fetch("/api/market",{cache:"no-store"});
    if(!r.ok) throw new Error("HTTP "+r.status);
    const m=await r.json();
    document.getElementById("marketPrice").textContent=dinheiro(m.price)+" USDT";
    document.getElementById("marketRsi").textContent=m.rsi.toFixed(2);
    document.getElementById("marketEma").textContent=dinheiro(m.ema)+" USDT";
    const state=document.getElementById("marketState");
    state.textContent=m.state;
    state.className=m.state==="ALTA"?"green":(m.state==="BAIXA"?"red":"yellow");
  }catch(e){
    document.getElementById("marketState").textContent="INDISPONÍVEL";
  }
}

/*
=========================================================
GRÁFICO
=========================================================
*/

async function carregarGrafico(){

  const c =
    dados &&
    dados.contas
      ? dados.contas.find(function(x){
          return x.id === contaSelecionada;
        })
      : null;

  /*
   * PRIORIDADE:
   * 1. moeda da posição ativa da conta selecionada
   * 2. moeda escolhida manualmente
   * 3. BTCUSDT como último fallback
   */
  const pos =
    c &&
    c.posicoes &&
    c.posicoes.length
      ? c.posicoes[0]
      : null;

  const select =
    document.getElementById(
      "symbolSelect"
    );

  const symbolAtual =
    pos && pos.symbol
      ? pos.symbol
      : (
          select.value ||
          "BTCUSDT"
        );

  // Mostra a moeda atual e mantém a opção selecionada.
  if(
    symbolAtual &&
    !Array.from(select.options).some(
      function(o){
        return o.value === symbolAtual;
      }
    )
  ){
    const opt =
      document.createElement("option");

    opt.value = symbolAtual;
    opt.textContent = symbolAtual;

    select.appendChild(opt);
  }

  select.value = symbolAtual;

  try{

    const response =
      await fetch(
        "/api/chart?account=" +
        encodeURIComponent(
          contaSelecionada
        ) +
        "&symbol=" +
        encodeURIComponent(symbolAtual) +
        "&interval=" +
        encodeURIComponent(
          intervaloSelecionado
        ),
        {
          cache:"no-store"
        }
      );

    if(!response.ok){
      throw new Error(
        "HTTP " + response.status
      );
    }

    const data =
      await response.json();

    // Dados da posição são usados para a leitura
    // percentual em tempo real.
    if(pos){
      data.currentPrice =
        Number(pos.precoAtual || 0);

      data.entry =
        Number(
          pos.precoMedio ||
          data.entry ||
          0
        );

      data.tp =
        pos.tp
          ? Number(pos.tp.price || 0)
          : data.tp;

      data.sl =
        pos.sl
          ? Number(pos.sl.stopPrice || 0)
          : data.sl;

      data.symbol =
        pos.symbol;
    }

    desenharGrafico(data);

  }catch(e){

    console.error(
      "Erro gráfico:",
      e
    );

  }
}

function desenharGrafico(d){

  const el =
    document.getElementById(
      "chart"
    );

  el.innerHTML = "";

  const symbol =
    d.symbol ||
    document.getElementById(
      "symbolSelect"
    ).value ||
    "BTCUSDT";

  const candles =
    d.candles || [];

  if(
    typeof LightweightCharts ===
    "undefined"
  ){

    el.innerHTML =
      '<div class="empty">' +
      'Biblioteca do gráfico não carregou.' +
      '</div>';

    return;
  }

  if(!candles.length){

    el.innerHTML =
      '<div class="empty">' +
      'Não foi possível carregar o gráfico de ' +
      symbol +
      '.' +
      '</div>';

    return;
  }

  chart =
    LightweightCharts.createChart(
      el,
      {
        width:el.clientWidth,
        height:410,

        layout:{
          background:{
            color:"#0b1320"
          },
          textColor:"#8795ab"
        },

        grid:{
          vertLines:{
            color:"#172337"
          },
          horzLines:{
            color:"#172337"
          }
        },

        rightPriceScale:{
          borderColor:"#26364f"
        },

        timeScale:{
          borderColor:"#26364f",
          timeVisible:true
        },

        crosshair:{
          mode:0
        }
      }
    );

  candleSeries =
    chart.addCandlestickSeries({
      upColor:"#20df96",
      downColor:"#ff6177",
      borderVisible:false,
      wickUpColor:"#20df96",
      wickDownColor:"#ff6177"
    });

  candleSeries.setData(
    candles
  );

  const entry =
    Number(d.entry || 0);

  const current =
    Number(
      d.currentPrice ||
      (
        candles[candles.length - 1]
          ? candles[candles.length - 1].close
          : 0
      )
    );

  /*
   * Percentual real da moeda desde a entrada:
   *
   * ((preço atual / preço entrada) - 1) * 100
   */
  const variation =
    entry > 0 && current > 0
      ? ((current / entry) - 1) * 100
      : 0;

  /*
   * Se existe ordem de venda na Binance,
   * usamos a ordem real.
   *
   * Caso não exista, mostramos um alvo projetado
   * de +5%, compatível com o TP de 5% do robô.
   */
  const realTp =
    Number(d.tp || 0);

  const projectedTp =
    entry > 0
      ? entry * 1.05
      : 0;

  const target =
    realTp > 0
      ? realTp
      : projectedTp;

  const sl =
    Number(d.sl || 0);

  // Cabeçalho do gráfico.
  document.getElementById(
    "chartCoin"
  ).textContent =
    symbol;

  document.getElementById(
    "chartPrice"
  ).textContent =
    current > 0
      ? dinheiro(current) + " USDT"
      : "--";

  const variationEl =
    document.getElementById(
      "chartVariation"
    );

  variationEl.textContent =
    (
      variation >= 0
        ? "+"
        : ""
    ) +
    variation.toFixed(2) +
    "%";

  variationEl.className =
    variation >= 0
      ? "green"
      : "red";

  document.getElementById(
    "chartTarget"
  ).textContent =
    target > 0
      ? dinheiro(target) +
        " USDT (" +
        (
          entry > 0
            ? (((target / entry) - 1) * 100)
                .toFixed(2)
            : "0.00"
        ) +
        "%)"
      : "--";

  if(entry > 0){

    candleSeries.createPriceLine({
      price:entry,
      color:"#27b9ff",
      lineWidth:2,
      lineStyle:2,
      axisLabelVisible:true,
      title:"ENTRADA"
    });

  }

  if(target > 0){

    candleSeries.createPriceLine({
      price:target,
      color:"#ffc85a",
      lineWidth:2,
      lineStyle:2,
      axisLabelVisible:true,
      title:
        realTp > 0
          ? "VENDA / TP"
          : "VENDA +5%"
    });

  }

  if(sl > 0){

    candleSeries.createPriceLine({
      price:sl,
      color:"#ff6177",
      lineWidth:2,
      lineStyle:2,
      axisLabelVisible:true,
      title:"STOP LOSS"
    });

  }

  /*
   * Encontrar o candle mais próximo da entrada
   * para colocar o marcador de COMPRA.
   */
  let entryCandle = null;

  if(entry > 0){

    const tradesTime =
      Number(d.entryTime || 0);

    if(tradesTime > 0){

      entryCandle =
        candles.reduce(
          function(prev, cur){

            return Math.abs(
              cur.time - tradesTime
            ) <
            Math.abs(
              prev.time - tradesTime
            )
              ? cur
              : prev;

          }
        );

    }else{

      entryCandle =
        candles.reduce(
          function(prev, cur){

            return Math.abs(
              cur.close - entry
            ) <
            Math.abs(
              prev.close - entry
            )
              ? cur
              : prev;

          }
        );

    }

  }

  /*
   * Marcador de compra.
   */
  if(entryCandle){

    candleSeries.setMarkers([
      {
        time:entryCandle.time,
        position:"belowBar",
        color:"#27b9ff",
        shape:"arrowUp",
        text:
          "ENTRADA " +
          dinheiro(entry)
      }
    ]);

  }

  /*
   * Linha visual da evolução percentual:
   * marca o preço atual e exibe o ganho/perda.
   */
  if(current > 0){

    candleSeries.createPriceLine({
      price:current,
      color:
        variation >= 0
          ? "#20df96"
          : "#ff6177",
      lineWidth:2,
      lineStyle:0,
      axisLabelVisible:true,
      title:
        (
          variation >= 0
            ? "+"
            : ""
        ) +
        variation.toFixed(2) +
        "%"
    });

  }

  chart
    .timeScale()
    .fitContent();
}



/* =========================================================
   V7 - FUNÇÕES VISUAIS
========================================================= */
let v7EquityHistory=[];
let v7LastXrayKey="";
let v7OpportunityBusy=false;

function v7FmtPct(v){v=Number(v||0);return (v>=0?"+":"")+v.toFixed(2)+"%";}
function v7ClassePct(v){return Number(v||0)>=0?"v7Good":"v7Bad";}
function v7Elapsed(t){
  if(!t) return "--";
  let s=Math.max(0,Math.floor((Date.now()-Number(t))/1000));
  const d=Math.floor(s/86400); s%=86400; const h=Math.floor(s/3600); s%=3600; const m=Math.floor(s/60); const sec=s%60;
  if(d>0) return d+"d "+h+"h";
  if(h>0) return h+"h "+m+"m";
  return m+"m "+sec+"s";
}

function renderV7Score(){
  const c1=getConta("1"),c2=getConta("2");
  const a=c1&&c1.operacaoAtual&&c1.operacaoAtual.ativa?c1.operacaoAtual:null;
  const b=c2&&c2.operacaoAtual&&c2.operacaoAtual.ativa?c2.operacaoAtual:null;
  const leader=document.getElementById("v7Leader"),diff=document.getElementById("v7Diff"),elapsed=document.getElementById("v7Elapsed");
  const tp=document.getElementById("v7ThiagoPnl"),sp=document.getElementById("v7SergioPnl"),tb=document.getElementById("v7ThiagoBrl"),sb=document.getElementById("v7SergioBrl");
  if(a){tp.textContent=v7FmtPct(a.pnlPct);tp.className=v7ClassePct(a.pnlPct);tb.textContent="R$ "+dinheiro(Number(a.pnlBRL||0));}
  else{tp.textContent="SEM OPERAÇÃO";tp.className="";tb.textContent="--";}
  if(b){sp.textContent=v7FmtPct(b.pnlPct);sp.className=v7ClassePct(b.pnlPct);sb.textContent="R$ "+dinheiro(Number(b.pnlBRL||0));}
  else{sp.textContent="SEM OPERAÇÃO";sp.className="";sb.textContent="--";}
  const nowOp=a||b;
  elapsed.textContent=nowOp?v7Elapsed(nowOp.entradaTime):"--";
  if(a&&b){
    const d=Number(a.pnlPct)-Number(b.pnlPct);
    if(d>0){leader.textContent="🥇 THIAGO";leader.className="v7Good";diff.textContent="THIAGO +"+d.toFixed(2)+" p.p.";diff.className="v7Good";}
    else if(d<0){leader.textContent="🥇 SERGIO";leader.className="v7Good";diff.textContent="SERGIO +"+Math.abs(d).toFixed(2)+" p.p.";diff.className="v7Good";}
    else{leader.textContent="⚖️ EMPATE";leader.className="v7Warn";diff.textContent="0,00 p.p.";diff.className="v7Warn";}
  }else if(a){leader.textContent="THIAGO";leader.className="v7Blue";diff.textContent="SERGIO sem operação";diff.className="";}
  else if(b){leader.textContent="SERGIO";leader.className="v7Blue";diff.textContent="THIAGO sem operação";diff.className="";}
  else{leader.textContent="AGUARDANDO";leader.className="";diff.textContent="--";diff.className="";}
}

function renderV7Alerts(){
  const el=document.getElementById("v7Alerts"); const alerts=[];
  (dados&&dados.contas||[]).forEach(function(c){
    if(c.erro) alerts.push({i:"🔴",t:"<b>"+c.nome+":</b> API indisponível. "+c.erro});
    const op=c.operacaoAtual;
    if(op&&op.ativa){
      const p=Number(op.pnlPct||0);
      if(p>=4.5) alerts.push({i:"🎯",t:"<b>"+c.nome+" • "+op.symbol+":</b> operação próxima do alvo de +5%. Variação atual "+v7FmtPct(p)+"."});
      else if(p<0) alerts.push({i:"🔻",t:"<b>"+c.nome+" • "+op.symbol+":</b> operação atualmente negativa em "+v7FmtPct(p)+"."});
      else alerts.push({i:"🟢",t:"<b>"+c.nome+" • "+op.symbol+":</b> operação positiva em "+v7FmtPct(p)+"."});
    }else if(!c.erro){alerts.push({i:"⚪",t:"<b>"+c.nome+":</b> nenhuma operação atual detectada."});}
  });
  el.innerHTML=alerts.map(function(a){return '<div class="v7Alert"><div class="v7AlertIcon">'+a.i+'</div><div class="v7AlertText">'+a.t+'</div></div>';}).join("")||'<div class="v7Alert"><div class="v7AlertIcon">ℹ️</div><div class="v7AlertText">Sem alertas.</div></div>';
}

function renderV7Health(){
  const el=document.getElementById("v7Health");
  const now=Date.now();
  const rows=[];
  (dados&&dados.contas||[]).forEach(function(c){
    const ok=!c.erro;
    const last=(c.historico||[])[0];
    rows.push('<div class="v7StatusRow"><span><i class="v7Dot '+(ok?'ok':'bad')+'"></i>'+c.nome+' • Binance</span><b class="v7Badge">'+(ok?'ONLINE':'ERRO')+'</b></div>');
    rows.push('<div class="v7StatusRow"><span>Último trade</span><b class="v7Time">'+(last?dataHora(last.time):"sem dados")+'</b></div>');
    rows.push('<div class="v7StatusRow"><span>Posições ativas</span><b>'+((c.posicoes||[]).length)+'</b></div>');
  });
  const age=dados&&dados.atualizadoEm?Math.max(0,now-Number(dados.atualizadoEm)):999999;
  rows.push('<div class="v7StatusRow"><span><i class="v7Dot '+(age<30000?'ok':'warn')+'"></i>Atualização do painel</span><b class="v7Badge">'+(age<30000?'ATUALIZADO':'ATENÇÃO')+'</b></div>');
  rows.push('<div class="v7Note">O painel mantém a leitura das contas; o controle manual é exclusivo da conta SERGIO e envia ordens reais somente quando acionado pelo usuário.</div>');
  el.innerHTML=rows.join("");
}

function renderV7Equity(){
  if(!dados||!dados.contas)return;
  const total=dados.contas.reduce(function(s,c){return s+Number(c.patrimonioUSDT||0);},0);
  v7EquityHistory.push({t:Date.now(),v:total});
  if(v7EquityHistory.length>60)v7EquityHistory.shift();
  const canvas=document.getElementById("v7EquityCanvas"); if(!canvas)return;
  const rect=canvas.getBoundingClientRect(); const dpr=window.devicePixelRatio||1; const w=Math.max(300,Math.floor(rect.width)); const h=220;
  canvas.width=w*dpr; canvas.height=h*dpr; const ctx=canvas.getContext("2d"); ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,w,h);
  if(v7EquityHistory.length<2){ctx.fillStyle="#71809a";ctx.font="12px sans-serif";ctx.fillText("Coletando pontos...",18,30);document.getElementById("v7EquityInfo").textContent=dinheiro(total)+" USDT agora";return;}
  const vals=v7EquityHistory.map(function(x){return x.v;}); const min=Math.min.apply(null,vals),max=Math.max.apply(null,vals); const span=Math.max(max-min,0.01); const left=12,top=15,right=w-12,bottom=h-22;
  ctx.strokeStyle="#17273d";ctx.lineWidth=1;for(let i=0;i<4;i++){const y=top+(bottom-top)*i/3;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();}
  ctx.strokeStyle="#27b9ff";ctx.lineWidth=2;ctx.beginPath();v7EquityHistory.forEach(function(p,i){const x=left+(right-left)*i/(v7EquityHistory.length-1);const y=bottom-(p.v-min)/span*(bottom-top);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.stroke();
  const last=vals[vals.length-1],first=vals[0],delta=last-first;document.getElementById("v7EquityInfo").textContent=dinheiro(last)+" USDT • sessão "+(delta>=0?"+":"")+dinheiro(delta)+" USDT";
}

async function renderV7Xray(){
  const c=getConta(contaSelecionada); if(!c)return;
  const pos=(c.posicoes||[])[0]; const symbol=pos&&pos.symbol?pos.symbol:"BTCUSDT"; const key=contaSelecionada+"|"+symbol;
  if(v7LastXrayKey===key && Date.now()-Number(window.v7LastXrayTime||0)<45000)return;
  v7LastXrayKey=key;window.v7LastXrayTime=Date.now();
  const el=document.getElementById("v7Xray");el.innerHTML='<div class="empty">Analisando '+symbol+'...</div>';
  try{
    const r=await fetch('/api/xray?account='+encodeURIComponent(contaSelecionada)+'&symbol='+encodeURIComponent(symbol),{cache:'no-store'});const x=await r.json();if(!r.ok)throw new Error(x.erro||'Falha');
    const rows=x.checks.map(function(q){return '<div class="v7Check"><span>'+(q.ok?'🟢':'🔴')+' '+q.nome+'</span><b class="'+(q.ok?'v7Good':'v7Bad')+'">'+q.valor+'</b></div>';}).join('');
    el.innerHTML='<div class="v7MiniGrid"><div class="v7Mini"><span>MOEDA</span><b>'+x.symbol+'</b></div><div class="v7Mini"><span>COMPATIBILIDADE</span><b>'+x.compatibilidade+'/4</b></div><div class="v7Mini"><span>RSI 14</span><b>'+x.rsi.toFixed(2)+'</b></div><div class="v7Mini"><span>EMA 21</span><b>'+dinheiro(x.ema)+'</b></div></div><div style="margin-top:12px">'+rows+'</div><div class="v7Note">Score interno do robô: <b>não disponível na API do painel</b>. Os 4 testes acima são uma leitura técnica independente, usando os limites conhecidos da configuração do robô.</div>';
  }catch(e){el.innerHTML='<div class="empty">Raio-X indisponível: '+(e.message||'erro')+'</div>';}
}

async function renderV7Opportunities(){
  if(v7OpportunityBusy)return;v7OpportunityBusy=true;const el=document.getElementById("v7Opportunities");
  try{
    const r=await fetch('/api/opportunities',{cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error(d.erro||'Falha');
    el.innerHTML=(d.itens||[]).map(function(x,i){const cls=i===0?'gold':(i===1?'silver':(i===2?'bronze':''));return '<div class="v7Opportunity"><div><div class="v7Rank '+cls+'">#'+(i+1)+'</div><div class="v7Coin">'+x.symbol+'</div></div><div><div class="v7Check"><span>RSI</span><b class="'+(x.checks[0].ok?'v7Good':'v7Bad')+'">'+x.rsi.toFixed(1)+'</b></div><div class="v7Check"><span>EMA</span><b class="'+(x.checks[1].ok?'v7Good':'v7Bad')+'">'+(x.distancia>=0?'+':'')+x.distancia.toFixed(2)+'%</b></div><div class="v7Check"><span>Volume</span><b class="'+(x.volumeRatio>=.8?'v7Good':'v7Bad')+'">'+x.volumeRatio.toFixed(2)+'x</b></div></div><div class="v7ScoreBox"><b>'+x.compatibilidade+'/4</b><small>filtros</small></div></div>';}).join('')||'<div class="empty">Sem oportunidades disponíveis.</div>';
  }catch(e){el.innerHTML='<div class="empty">Ranking indisponível no momento.</div>';}finally{v7OpportunityBusy=false;}
}

function renderV7Timeline(){
  const all=[];(dados&&dados.contas||[]).forEach(function(c){(c.historico||[]).slice(0,20).forEach(function(t){all.push({...t,conta:c.nome});});});
  all.sort(function(a,b){return Number(b.time)-Number(a.time);});
  const el=document.getElementById('v7Timeline');
  el.innerHTML=all.slice(0,16).map(function(t,i){const buy=t.lado==='COMPRA';return '<div class="v7StatusRow"><span><i class="v7Dot '+(buy?'ok':'bad')+'"></i><b>'+t.conta+'</b> • '+t.symbol+' • '+t.lado+'</span><span class="v7Time">'+numero(t.qty)+' @ '+dinheiro(t.price)+' USDT • '+dataHora(t.time)+'</span></div>';}).join('')||'<div class="empty">Nenhum evento encontrado.</div>';
}

function renderV7(){renderV7Score();renderV7Alerts();renderV7Health();renderV7Equity();renderV7Timeline();renderV7Xray();renderV7Opportunities();}


/*
=========================================================
CARREGAMENTO
=========================================================
*/

async function carregar(){

  try{

    const controller =
      new AbortController();

    const timeout =
      setTimeout(function(){
        controller.abort();
      }, 25000);

    const response =
      await fetch(
        "/api/dashboard",
        {
          cache:"no-store",
          signal:controller.signal
        }
      );

    clearTimeout(timeout);


    if(!response.ok){
      throw new Error(
        "HTTP " +
        response.status
      );
    }


    dados =
      await response.json();


    preencherTabs();

    renderConta();

    const contaAtual = dados.contas.find(function(c){ return c.id === contaSelecionada; }) || {};

    renderPnl(contaAtual);
    renderAnalytics();
    renderV7();


    document.getElementById(
      "updated"
    ).textContent =
      "Atualizado às " +
      new Date(
        dados.atualizadoEm
      ).toLocaleTimeString(
        "pt-BR"
      );


    carregarGrafico();

  }catch(e){

    console.error(e);

    document.getElementById(
      "updated"
    ).textContent =
      "Erro ao atualizar: " +
      (e.message || "falha de conexão");

  }
}


/*
=========================================================
EVENTOS
=========================================================
*/

document
  .getElementById(
    "symbolSelect"
  )
  .addEventListener(
    "change",
    carregarGrafico
  );


document
  .querySelectorAll(
    ".interval"
  )
  .forEach(function(button){

    button.addEventListener(
      "click",
      function(){

        document
          .querySelectorAll(
            ".interval"
          )
          .forEach(function(b){
            b.classList.remove(
              "active"
            );
          });


        button.classList.add(
          "active"
        );


        intervaloSelecionado =
          button.getAttribute(
            "data-i"
          );


        carregarGrafico();

      }
    );

  });


window.addEventListener(
  "resize",
  function(){

    if(chart){

      chart.applyOptions({
        width:
          document.getElementById(
            "chart"
          ).clientWidth
      });

    }

  }
);


/* =========================================================
   V7 COMPACTA — NAVEGAÇÃO POR SUBMENUS
   ========================================================= */

function obterSecoesPainel(){
  return Array.from(
    document.querySelectorAll("section.section")
  );
}

function fecharTodasSecoesPainel(){
  const secoes = obterSecoesPainel();

  secoes.forEach(function(secao){
    secao.classList.remove("compactOpen");
    secao.classList.add("compactHidden");
  });

  document.querySelectorAll(".menuBtn").forEach(function(btn){
    btn.classList.remove("active");
  });
}

function abrirSecaoPainel(indice){
  const secoes = obterSecoesPainel();
  const secao = secoes[indice];

  if(!secao) return;

  const jaAberta =
    secao.classList.contains("compactOpen");

  fecharTodasSecoesPainel();

  if(jaAberta){
    return;
  }

  secao.classList.remove("compactHidden");
  secao.classList.add("compactOpen");

  const btn =
    document.querySelector(
      '.menuBtn[data-panel="' + indice + '"]'
    );

  if(btn){
    btn.classList.add("active");
  }

  setTimeout(function(){
    secao.scrollIntoView({
      behavior:"smooth",
      block:"start"
    });
  },30);
}

function fecharSecaoPainel(botao){
  const secao = botao.closest("section.section");

  if(!secao) return;

  const secoes = obterSecoesPainel();
  const indice = secoes.indexOf(secao);

  secao.classList.remove("compactOpen");
  secao.classList.add("compactHidden");

  const btn =
    document.querySelector(
      '.menuBtn[data-panel="' + indice + '"]'
    );

  if(btn){
    btn.classList.remove("active");
  }

  window.scrollTo({
    top:0,
    behavior:"smooth"
  });
}

function inicializarNavegacaoCompacta(){

  const secoes = obterSecoesPainel();

  secoes.forEach(function(secao){

    secao.classList.add("compactHidden");

    if(
      secao.querySelector(".sectionClose")
    ){
      return;
    }

    const close =
      document.createElement("button");

    close.type = "button";
    close.className = "sectionClose";
    close.textContent = "FECHAR";
    close.setAttribute(
      "onclick",
      "fecharSecaoPainel(this)"
    );

    secao.insertBefore(
      close,
      secao.firstChild
    );
  });

  fecharTodasSecoesPainel();
}

function atualizarResumoCompacto(){

  if(!dados || !dados.contas) return;

  const c =
    dados.contas.find(function(x){
      return x.id === contaSelecionada;
    });

  if(!c) return;

  const op =
    c.operacaoAtual &&
    c.operacaoAtual.ativa
      ? c.operacaoAtual
      : null;

  const coin =
    document.getElementById("quickCoin");

  const status =
    document.getElementById("quickStatus");

  const pnl =
    document.getElementById("quickPnl");

  const pct =
    document.getElementById("quickPct");

  if(!op){

    if(coin) coin.textContent="--";

    if(status){
      status.textContent="SEM OPERAÇÃO";
      status.className="quickCurrentStatus";
    }

    if(pnl){
      pnl.textContent="--";
      pnl.className="quickCurrentPnl";
    }

    if(pct){
      pct.textContent="--";
      pct.className="quickCurrentPct";
    }

    return;
  }

  const p =
    Number(op.pnlUSDT || 0);

  const v =
    Number(op.pnlPct || 0);

  if(coin){
    coin.textContent =
      op.symbol || "--";
  }

  if(status){
    status.textContent =
      "OPERAÇÃO ATIVA";

    status.className =
      "quickCurrentStatus";
  }

  if(pnl){
    pnl.textContent =
      (p>=0 ? "+" : "") +
      dinheiro(p) +
      " USDT";

    pnl.className =
      "quickCurrentPnl " +
      classe(p);
  }

  if(pct){
    pct.textContent =
      (v>=0 ? "+" : "") +
      v.toFixed(2) +
      "%";

    pct.className =
      "quickCurrentPct " +
      classe(v);
  }
}




/*
=========================================================
CRIPTOPRO - NAVEGAÇÃO
=========================================================
*/

function voltarPlanos(){

  window.location.href = "/planos.html";

}


function sairSistema(){

  const idioma =
    localStorage.getItem("criptopro_language") || "pt";

  const mensagem =
    idioma === "en"
      ? "Do you really want to leave the dashboard?"
      : "Deseja realmente sair do painel?";

  if(!window.confirm(mensagem)){
    return;
  }

  localStorage.removeItem("token");

  localStorage.removeItem(
    "criptopro_selected_plan"
  );

  localStorage.removeItem(
    "criptopro_selected_plan_name"
  );

  localStorage.removeItem(
    "criptopro_selected_plan_price"
  );

  localStorage.removeItem(
    "criptopro_user"
  );

  window.location.href = "/login.html";

}


/*
=========================================================
INÍCIO
=========================================================
*/

inicializarNavegacaoCompacta();

carregar();

setInterval(
  carregar,
  15000
);

</script>

</body>
</html>
  `);
});


app.listen(
  PORT,
  "0.0.0.0",
  function(){
    console.log(
      "Binance-Robo Painel Premium V7.1 — Compacto rodando na porta " +
      PORT
    );
  }
);
