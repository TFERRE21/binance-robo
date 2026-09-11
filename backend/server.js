const express = require("express");
const Binance = require("binance-api-node").default;

const app = express();
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

O painel consulta as duas contas.
CONTROLE MANUAL SOMENTE DA CONTA SERGIO, protegido por token.
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
POSIÇÕES
=========================================================
*/

function calcularOperacaoAtual(trades) {
  const lista = (trades || []).slice().sort(function(a,b){
    return num(a.time) - num(b.time);
  });

  let ultimoSell = -1;
  for (let i = 0; i < lista.length; i++) {
    if (!lista[i].isBuyer) ultimoSell = i;
  }

  const atual = lista.slice(ultimoSell + 1);
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
    qtdComprada,
    qtdVendida,
    compras: compras.length,
    vendas: vendas.length
  };
}

async function obterPosicoes(conta, dadosConta) {
  const ativos = (dadosConta.ativos || []).filter(function(a){
    return a.asset !== "USDT" && a.valorUSDT >= 3 && a.precoUSDT > 0;
  });

  const resultados = await Promise.all(ativos.map(async function(ativo){
    const symbol = ativo.asset + "USDT";
    const trades = await obterTrades(conta, symbol, 1000);

    const operacao = calcularOperacaoAtual(trades);
    const quantidade = ativo.total;
    const precoAtual = ativo.precoUSDT;
    const precoMedio = operacao.entrada;
    const valorAtual = quantidade * precoAtual;
    const pnlNaoRealizado = precoMedio > 0
      ? (precoAtual - precoMedio) * quantidade
      : 0;
    const pnlPct = precoMedio > 0
      ? ((precoAtual / precoMedio) - 1) * 100
      : 0;

    let ordensAbertas = [];
    try {
      ordensAbertas = await conta.client.openOrders({symbol});
    } catch(e) {}

    const vendas = ordensAbertas.filter(function(o){
      return String(o.side).toUpperCase() === "SELL" && num(o.price) > 0;
    }).sort(function(a,b){ return num(a.price) - num(b.price); });

    const tpOrder = vendas[0] || null;
    const slOrder = ordensAbertas.find(function(o){
      return ["STOP","STOP_LOSS","STOP_LOSS_LIMIT","TAKE_PROFIT","TAKE_PROFIT_LIMIT"].includes(String(o.type || "").toUpperCase());
    }) || null;

    const ordenados = trades.slice().sort(function(a,b){ return num(a.time)-num(b.time); });
    const ultimoTrade = ordenados[ordenados.length-1] || null;

    return {
      symbol,
      asset: ativo.asset,
      quantidade,
      quantidadeLivre: ativo.free,
      quantidadeBloqueada: ativo.locked,
      quantidadeLiquida: operacao.quantidade,
      operacaoAtual: operacao,
      precoMedio,
      precoAtual,
      valorAtual,
      pnlNaoRealizado,
      pnlNaoRealizadoPct: pnlPct,
      pnlRealizado: calcularPnL(trades),
      tp: tpOrder ? {price:num(tpOrder.price),qty:num(tpOrder.origQty),type:tpOrder.type,status:tpOrder.status,orderId:tpOrder.orderId} : null,
      sl: slOrder ? {stopPrice:num(slOrder.stopPrice || slOrder.price),price:num(slOrder.price),type:slOrder.type,status:slOrder.status,orderId:slOrder.orderId} : null,
      ordensAbertas: ordensAbertas.length,
      ultimaOperacao: ultimoTrade ? {lado:ultimoTrade.isBuyer ? "COMPRA" : "VENDA",qty:num(ultimoTrade.qty),price:num(ultimoTrade.price),time:num(ultimoTrade.time)} : null
    };
  }));

  return resultados.sort(function(a,b){ return b.valorAtual-a.valorAtual; });
}

/*
=========================================================
HISTÓRICO
=========================================================
*/

async function obterHistorico(conta, dadosConta) {
  const ativos = (dadosConta.ativos || []).filter(function(a){
    return a.asset !== "USDT" && a.valorUSDT > 0.01;
  }).slice(0, 30);

  const blocos = await Promise.all(ativos.map(async function(ativo){
    const symbol = ativo.asset + "USDT";
    const trades = await obterTrades(conta, symbol, 100);
    return trades.map(function(t){
      return {
        symbol,
        lado:t.isBuyer ? "COMPRA" : "VENDA",
        qty:num(t.qty),
        price:num(t.price),
        quoteQty:num(t.quoteQty),
        commission:num(t.commission),
        commissionAsset:t.commissionAsset,
        time:num(t.time)
      };
    });
  }));

  return blocos.flat().sort(function(a,b){ return b.time-a.time; }).slice(0,100);
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
      }) || null
  };
}

/*
=========================================================
CONTROLE MANUAL SERGIO
=========================================================
*/
const MANUAL_TOKEN = String(process.env.PAINEL_MANUAL_TOKEN || "").trim();
const MANUAL_FEE_RATE = num(process.env.MANUAL_SELL_FEE_RATE) || 0.001;

function manualAutorizado(req){
  if(!MANUAL_TOKEN) return false;
  const recebido = String(req.headers["x-manual-token"] || req.body?.token || "").trim();
  return recebido && recebido === MANUAL_TOKEN;
}

function clienteSergio(){
  return clientes.find(function(c){ return c.id === "2"; }) || null;
}

async function obterFiltrosSymbol(client, symbol){
  const info = await client.exchangeInfo();
  const item = (info.symbols || []).find(function(s){ return s.symbol === symbol; });
  if(!item) throw new Error("Par " + symbol + " não encontrado na Binance.");
  const filters = {};
  (item.filters || []).forEach(function(f){ filters[f.filterType] = f; });
  return {item, filters};
}

function casasDoPasso(step){
  const s=String(step || "0.00000001");
  if(s.indexOf("e-") >= 0) return Number(s.split("e-")[1]);
  const p=s.indexOf(".");
  return p>=0 ? s.length-p-1 : 0;
}

function ajustarStep(qty, step){
  const n=num(qty), st=num(step);
  if(n<=0 || st<=0) return 0;
  const out=Math.floor((n + 1e-12)/st)*st;
  return Number(out.toFixed(casasDoPasso(step)));
}

async function manualPreviewSergio(symbol){
  const conta=clienteSergio();
  if(!conta || !conta.client) throw new Error("Credenciais da conta SERGIO não configuradas.");
  symbol=String(symbol || "").toUpperCase().trim();
  if(!/^[A-Z0-9]{5,20}$/.test(symbol)) throw new Error("Símbolo inválido.");

  const info=await conta.client.accountInfo();
  const asset=symbol.endsWith("USDT") ? symbol.slice(0,-4) : "";
  if(!asset) throw new Error("Use um par terminado em USDT, por exemplo BTCUSDT.");
  const bal=(info.balances || []).find(function(b){ return String(b.asset).toUpperCase()===asset; });
  const free=num(bal && bal.free);
  const locked=num(bal && bal.locked);
  const prices=await conta.client.prices({symbol});
  const price=num(prices && prices[symbol]);
  if(price<=0) throw new Error("Não consegui obter o preço de " + symbol + ".");
  const spec=await obterFiltrosSymbol(conta.client,symbol);
  const lot=spec.filters.LOT_SIZE || spec.filters.MARKET_LOT_SIZE || {};
  const minNotional=num((spec.filters.NOTIONAL||{}).minNotional) || num((spec.filters.MIN_NOTIONAL||{}).minNotional) || 0;
  const minQty=num(lot.minQty);
  const maxQty=num(lot.maxQty);
  const step=num(lot.stepSize);
  let ordens=[];
  try{ ordens=await conta.client.openOrders({symbol}); }catch(e){}
  const sellOrders=ordens.filter(function(o){ return String(o.side).toUpperCase()==="SELL"; });
  const opTrade=await obterTrades(conta,symbol,1000);
  const op=calcularOperacaoAtual(opTrade);
  const pnl=op.entrada>0 ? (price-op.entrada)*Math.max(0,op.quantidade) : 0;
  return {account:"2",accountName:"SERGIO",symbol,asset,price,free,locked,minQty,maxQty,stepSize:step,minNotional,openSellOrders:sellOrders.map(function(o){return {orderId:o.orderId,price:num(o.price),origQty:num(o.origQty),type:o.type,status:o.status};}),entry:op.entrada,currentOperationQty:op.quantidade,pnl,pnlPct:op.entrada>0?((price/op.entrada)-1)*100:0,feeEstimate:Math.max(0,op.quantidade*price)*MANUAL_FEE_RATE};
}

app.get("/api/manual/preview", async function(req,res){
  try{
    if(!MANUAL_TOKEN) return res.status(503).json({ok:false,erro:"PAINEL_MANUAL_TOKEN não configurado no Northflank."});
    const symbol=String(req.query.symbol || "").toUpperCase();
    const data=await manualPreviewSergio(symbol);
    res.json({ok:true,...data});
  }catch(e){ res.status(400).json({ok:false,erro:e.message}); }
});

app.post("/api/manual/cancel-sell", async function(req,res){
  try{
    if(!manualAutorizado(req)) return res.status(403).json({ok:false,erro:"Token manual inválido ou não configurado."});
    const conta=clienteSergio();
    if(!conta || !conta.client) throw new Error("Conta SERGIO indisponível.");
    const symbol=String(req.body?.symbol || "").toUpperCase();
    if(!symbol.endsWith("USDT")) throw new Error("Símbolo inválido.");
    const orders=await conta.client.openOrders({symbol});
    const sells=orders.filter(function(o){return String(o.side).toUpperCase()==="SELL";});
    const resultados=[];
    for(const o of sells){
      try{
        const r=await conta.client.cancelOrder({symbol,orderId:o.orderId});
        resultados.push({orderId:o.orderId,ok:true,status:r.status});
      }catch(e){ resultados.push({orderId:o.orderId,ok:false,erro:e.message}); }
    }
    res.json({ok:true,symbol,canceladas:resultados.length,resultados});
  }catch(e){res.status(400).json({ok:false,erro:e.message});}
});

app.post("/api/manual/buy", async function(req,res){
  try{
    if(!manualAutorizado(req)) return res.status(403).json({ok:false,erro:"Token manual inválido ou não configurado."});
    const conta=clienteSergio();
    if(!conta || !conta.client) throw new Error("Conta SERGIO indisponível.");
    const symbol=String(req.body?.symbol || "").toUpperCase();
    const usdt=num(req.body?.usdt);
    if(!symbol.endsWith("USDT")) throw new Error("Use um par USDT, por exemplo BTCUSDT.");
    if(usdt<=0) throw new Error("Informe um valor de compra em USDT maior que zero.");
    const spec=await obterFiltrosSymbol(conta.client,symbol);
    const prices=await conta.client.prices({symbol});
    const price=num(prices && prices[symbol]);
    if(price<=0) throw new Error("Preço indisponível.");
    const minNotional=num((spec.filters.NOTIONAL||{}).minNotional) || num((spec.filters.MIN_NOTIONAL||{}).minNotional) || 0;
    if(minNotional && usdt < minNotional) throw new Error("Compra abaixo do mínimo da Binance: " + minNotional + " USDT.");
    // MARKET BUY com quoteOrderQty: o valor informado é exatamente o orçamento em USDT.
    const ordem=await conta.client.order({symbol,side:"BUY",type:"MARKET",quoteOrderQty:usdt.toFixed(2),newOrderRespType:"FULL"});
    res.json({ok:true,conta:"SERGIO",acao:"COMPRA",symbol,usdt,price,orderId:ordem.orderId,status:ordem.status,executedQty:num(ordem.executedQty),cummulativeQuoteQty:num(ordem.cummulativeQuoteQty)});
  }catch(e){res.status(400).json({ok:false,erro:e.message});}
});

app.post("/api/manual/sell", async function(req,res){
  try{
    if(!manualAutorizado(req)) return res.status(403).json({ok:false,erro:"Token manual inválido ou não configurado."});
    const conta=clienteSergio();
    if(!conta || !conta.client) throw new Error("Conta SERGIO indisponível.");
    const symbol=String(req.body?.symbol || "").toUpperCase();
    if(!symbol.endsWith("USDT")) throw new Error("Use um par USDT, por exemplo BTCUSDT.");

    // Primeiro cancela qualquer SELL aberto para liberar saldo.
    try{
      const orders=await conta.client.openOrders({symbol});
      for(const o of orders){
        if(String(o.side).toUpperCase()==="SELL"){
          try{ await conta.client.cancelOrder({symbol,orderId:o.orderId}); }catch(e){}
        }
      }
    }catch(e){}

    await new Promise(function(resolve){setTimeout(resolve,900);});
    const info=await conta.client.accountInfo();
    const asset=symbol.slice(0,-4);
    const bal=(info.balances || []).find(function(b){return String(b.asset).toUpperCase()===asset;});
    const free=num(bal && bal.free);
    if(free<=0) throw new Error("Saldo livre de " + asset + " é zero.");

    const spec=await obterFiltrosSymbol(conta.client,symbol);
    const lot=spec.filters.MARKET_LOT_SIZE || spec.filters.LOT_SIZE || {};
    let qty=ajustarStep(free,lot.stepSize);
    const minQty=num(lot.minQty);
    if(qty<=0 || (minQty && qty<minQty)) throw new Error("Quantidade abaixo do mínimo permitido pela Binance.");
    const prices=await conta.client.prices({symbol});
    const price=num(prices && prices[symbol]);
    const minNotional=num((spec.filters.NOTIONAL||{}).minNotional) || num((spec.filters.MIN_NOTIONAL||{}).minNotional) || 0;
    if(minNotional && qty*price < minNotional) throw new Error("Valor da venda abaixo do mínimo da Binance: " + minNotional + " USDT.");

    const ordem=await conta.client.order({symbol,side:"SELL",type:"MARKET",quantity:String(qty),newOrderRespType:"FULL"});
    res.json({ok:true,conta:"SERGIO",acao:"VENDA",symbol,price,quantity:qty,orderId:ordem.orderId,status:ordem.status,executedQty:num(ordem.executedQty),cummulativeQuoteQty:num(ordem.cummulativeQuoteQty)});
  }catch(e){res.status(400).json({ok:false,erro:e.message});}
});

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

    const buys =
      trades
        .filter(function (t) {
          return Boolean(t.isBuyer);
        })
        .sort(function (a, b) {
          return num(a.time) - num(b.time);
        });

    let entry = null;
    let entryTime = null;

    if (buys.length) {
      const qty = buys.reduce(
        function (s, t) {
          return s + num(t.qty);
        },
        0
      );

      const cost = buys.reduce(
        function (s, t) {
          return (
            s +
            (
              num(t.quoteQty) ||
              num(t.qty) * num(t.price)
            )
          );
        },
        0
      );

      if (qty > 0) {
        entry = cost / qty;
      }

      entryTime =
        Math.floor(
          num(
            buys[buys.length - 1].time
          ) / 1000
        );
    }

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

app.get("/api/status", function (req, res) {
  res.json({
    status: "online",
    sistema: "Binance-Robo",
    painel: "premium-v5",
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

.manualBox{margin-top:16px;padding:16px;border:1px solid #2b3c58;border-radius:14px;background:linear-gradient(145deg,#0a1423,#08101b);}
.manualHead{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px;}
.manualTitle{font-size:13px;font-weight:900;}
.manualBadge{font-size:8px;font-weight:900;padding:5px 8px;border-radius:999px;background:#302508;color:var(--yellow);border:1px solid #68521a;}
.manualGrid{display:grid;grid-template-columns:1.2fr .8fr .8fr auto auto;gap:8px;align-items:end;}
.manualField label{display:block;color:var(--muted);font-size:8px;margin-bottom:5px;}
.manualField input,.manualField select{width:100%;border:1px solid #293951;background:#0b1524;color:#dce7f8;padding:9px 10px;border-radius:8px;font-size:10px;}
.manualBtn{border:1px solid #334866;background:#132238;color:#fff;padding:10px 12px;border-radius:8px;font-size:10px;font-weight:900;cursor:pointer;white-space:nowrap;}
.manualBtn.buyBtn{border-color:#176b4d;background:#0b3a2a;color:#55efad;}
.manualBtn.sellBtn{border-color:#713044;background:#421522;color:#ff8ca0;}
.manualBtn.cancelBtn{border-color:#66531e;background:#302708;color:#ffd875;}
.manualPreview{margin-top:11px;padding:11px;border:1px dashed #30425d;border-radius:10px;color:#93a2b8;font-size:9px;line-height:1.6;min-height:36px;}
.manualWarn{margin-top:8px;color:#ffca64;font-size:8px;line-height:1.5;}
@media(max-width:900px){.manualGrid{grid-template-columns:1fr 1fr;}.manualBtn{width:100%;}.manualField:first-child{grid-column:1/-1;}}

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
          <span>P/L</span>
          <b id="tabPnl1">--</b>
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
          <span>P/L</span>
          <b id="tabPnl2">--</b>
        </div>

        <div class="tabMetric">
          <span>OPERAÇÕES</span>
          <b id="tabOps2">--</b>
        </div>
      </div>
    </button>

  </div>


  <!-- CARDS DA CONTA SELECIONADA -->
  <div class="cards">

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

    <div id="manualSergio" class="manualBox" style="display:none">
      <div class="manualHead">
        <div class="manualTitle">🎛️ CONTROLE MANUAL • SERGIO</div>
        <div class="manualBadge">CONTA 2 • AÇÃO REAL NA BINANCE</div>
      </div>
      <div class="manualGrid">
        <div class="manualField">
          <label>PAR PARA OPERAR</label>
          <input id="manualSymbol" list="manualSymbols" value="" placeholder="BTCUSDT">
          <datalist id="manualSymbols"></datalist>
        </div>
        <div class="manualField">
          <label>COMPRA • USDT</label>
          <input id="manualBuyUsdt" type="number" min="0" step="0.01" placeholder="100">
        </div>
        <div class="manualField">
          <label>TOKEN DO PAINEL</label>
          <input id="manualToken" type="password" placeholder="PAINEL_MANUAL_TOKEN">
        </div>
        <button class="manualBtn buyBtn" onclick="manualComprarSergio()">🟢 COMPRAR</button>
        <button class="manualBtn sellBtn" onclick="manualVenderSergio()">🔴 VENDER</button>
        <button class="manualBtn cancelBtn" onclick="manualCancelarSergio()">🟡 CANCELAR SELL</button>
        <button class="manualBtn" onclick="manualPreviaSergio()">🔎 ATUALIZAR</button>
      </div>
      <div id="manualPreview" class="manualPreview">Selecione um par e clique em ATUALIZAR.</div>
      <div class="manualWarn">⚠️ COMPRAR e VENDER enviam ordens reais para a conta SERGIO. O botão VENDER cancela primeiro as ordens SELL abertas, relê o saldo livre e vende o máximo permitido pela Binance.</div>
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
        <div class="sectionDesc">Conexão das duas contas e leitura operacional. THIAGO somente leitura; SERGIO com controle manual protegido.</div>
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

  <!-- PERFORMANCE -->
  <section class="section">
    <div class="analyticsGrid">
      <div class="card analyticsCard">
        <h3 class="analyticsTitle">🏆 Performance THIAGO × SERGIO</h3>
        <div class="analyticsSub">Estimativa calculada a partir dos trades retornados pela Binance.</div>
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
    O P/L histórico é uma estimativa baseada nos trades disponíveis na API da Binance.
    A conta THIAGO permanece somente leitura. A conta SERGIO possui controle manual protegido por token.
  </div>

  <div class="footer">
    Binance-Robo • THIAGO / SERGIO • Painel individual • Atualização automática a cada 15 segundos • Controle manual SERGIO protegido
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

    pnl.textContent =
      (Number(c.pnlTotalEstimado || 0) >= 0
        ? "+"
        : "") +
      dinheiro(c.pnlTotalEstimado) +
      " USDT";

    pnl.className =
      classe(c.pnlTotalEstimado);

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



function manualSetPreview(html, good){
  const el=document.getElementById("manualPreview");
  if(!el) return;
  el.innerHTML=html;
  el.style.borderColor=good ? "#176b4d" : "#713044";
}

function manualToken(){
  return String(document.getElementById("manualToken")?.value || "").trim();
}

function manualSymbolAtual(c,pos){
  const input=document.getElementById("manualSymbol");
  if(input && input.value.trim()) return input.value.trim().toUpperCase();
  if(pos && pos.symbol) return pos.symbol;
  const a=(c && c.ativos || []).find(function(x){return x.asset!=="USDT" && x.valorUSDT>=3;});
  return a ? a.asset+"USDT" : "BTCUSDT";
}

function renderManualSergio(c,pos){
  const box=document.getElementById("manualSergio");
  if(!box) return;
  const ativo=(c && String(c.id)==="2");
  box.style.display=ativo ? "block" : "none";
  if(!ativo) return;
  const input=document.getElementById("manualSymbol");
  if(input && !input.value && pos && pos.symbol) input.value=pos.symbol;
  const list=document.getElementById("manualSymbols");
  if(list){
    list.innerHTML=(c.ativos || []).filter(function(a){return a.asset!=="USDT";}).slice(0,30).map(function(a){return '<option value="'+a.asset+'USDT"></option>';}).join("");
  }
}

async function manualPreviaSergio(){
  const c=getConta("2");
  const symbol=manualSymbolAtual(c,c && c.posicoes && c.posicoes[0]);
  const token=manualToken();
  if(!token){ manualSetPreview("Informe o TOKEN DO PAINEL para consultar o controle manual.",false); return; }
  try{
    const r=await fetch("/api/manual/preview?symbol="+encodeURIComponent(symbol),{headers:{"x-manual-token":token},cache:"no-store"});
    const d=await r.json();
    if(!r.ok || !d.ok) throw new Error(d.erro || "Falha na consulta");
    document.getElementById("manualSymbol").value=d.symbol;
    manualSetPreview("<b>"+d.symbol+" • SERGIO</b> — preço: <b>"+dinheiro(d.price)+" USDT</b> • saldo livre: <b>"+numero(d.free)+"</b> • SELL abertas: <b>"+d.openSellOrders.length+"</b><br>Entrada da operação atual: <b>"+(d.entry>0?dinheiro(d.entry)+" USDT":"--")+"</b> • P/L aberto: <b class=\""+(d.pnl>=0?"green":"red")+"\">"+(d.pnl>=0?"+":"")+dinheiro(d.pnl)+" USDT ("+d.pnlPct.toFixed(2)+"%)</b> • mínimo: <b>"+(d.minNotional||0)+" USDT</b>",true);
  }catch(e){ manualSetPreview("❌ "+(e.message || e),false); }
}

async function manualCancelarSergio(){
  const c=getConta("2");
  const symbol=manualSymbolAtual(c,c && c.posicoes && c.posicoes[0]);
  const token=manualToken();
  if(!token){manualSetPreview("Informe o token.",false);return;}
  if(!confirm("Cancelar todas as ordens SELL abertas de "+symbol+" na conta SERGIO?")) return;
  try{
    const r=await fetch("/api/manual/cancel-sell",{method:"POST",headers:{"Content-Type":"application/json","x-manual-token":token},body:JSON.stringify({symbol})});
    const d=await r.json();
    if(!r.ok || !d.ok) throw new Error(d.erro || "Falha ao cancelar");
    manualSetPreview("🟡 "+d.canceladas+" ordem(ns) SELL cancelada(s) em "+symbol+". Atualizando dados...",true);
    carregar();
  }catch(e){manualSetPreview("❌ "+(e.message||e),false);}
}

async function manualComprarSergio(){
  const c=getConta("2");
  const symbol=manualSymbolAtual(c,c && c.posicoes && c.posicoes[0]);
  const usdt=Number(document.getElementById("manualBuyUsdt")?.value || 0);
  const token=manualToken();
  if(!token){manualSetPreview("Informe o token.",false);return;}
  if(usdt<=0){manualSetPreview("Informe o valor da compra em USDT.",false);return;}
  if(!confirm("CONFIRMA COMPRA REAL?\n\nSERGIO\n"+symbol+"\nValor: "+usdt.toFixed(2)+" USDT")) return;
  try{
    const r=await fetch("/api/manual/buy",{method:"POST",headers:{"Content-Type":"application/json","x-manual-token":token},body:JSON.stringify({symbol,usdt})});
    const d=await r.json();
    if(!r.ok || !d.ok) throw new Error(d.erro || "Falha na compra");
    manualSetPreview("🟢 COMPRA EXECUTADA • "+d.symbol+" • "+d.executedQty+" unidades • "+dinheiro(d.cummulativeQuoteQty)+" USDT • Order #"+d.orderId,true);
    carregar();
  }catch(e){manualSetPreview("❌ "+(e.message||e),false);}
}

async function manualVenderSergio(){
  const c=getConta("2");
  const pos=(c && c.posicoes || [])[0];
  const symbol=manualSymbolAtual(c,pos);
  const token=manualToken();
  if(!token){manualSetPreview("Informe o token.",false);return;}
  try{
    const r=await fetch("/api/manual/preview?symbol="+encodeURIComponent(symbol),{headers:{"x-manual-token":token},cache:"no-store"});
    const d=await r.json();
    if(!r.ok || !d.ok) throw new Error(d.erro || "Falha na prévia");
    const estimativa=d.free*d.price;
    if(!confirm("CONFIRMA VENDA REAL?\n\nSERGIO\n"+symbol+"\nSaldo livre: "+numero(d.free)+"\nValor estimado: "+dinheiro(estimativa)+" USDT\n\nAs ordens SELL abertas serão canceladas antes da venda.")) return;
    const r2=await fetch("/api/manual/sell",{method:"POST",headers:{"Content-Type":"application/json","x-manual-token":token},body:JSON.stringify({symbol})});
    const d2=await r2.json();
    if(!r2.ok || !d2.ok) throw new Error(d2.erro || "Falha na venda");
    manualSetPreview("🔴 VENDA EXECUTADA • "+d2.symbol+" • "+d2.executedQty+" unidades • "+dinheiro(d2.cummulativeQuoteQty)+" USDT • Order #"+d2.orderId,true);
    carregar();
  }catch(e){manualSetPreview("❌ "+(e.message||e),false);}
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
      '</div>';

    renderManualSergio(c, null);
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

    '</div>';

  renderManualSergio(c, pos);
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

function renderAnalytics(){
  if(!dados || !dados.contas) return;
  const c1=getConta("1"), c2=getConta("2");
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

    const erros=(dados.contas || []).filter(function(c){return c.erro;});
    if(erros.length){
      document.getElementById("updated").textContent = "⚠️ " + erros.map(function(c){return c.nome+": "+c.erro;}).join(" | ");
    }

    preencherTabs();

    renderConta();

    const contaAtual = dados.contas.find(function(c){ return c.id === contaSelecionada; }) || {};

    renderPnl(contaAtual);
    renderAnalytics();


    if(!erros.length){
      document.getElementById(
        "updated"
      ).textContent =
        "Atualizado às " +
        new Date(
          dados.atualizadoEm
        ).toLocaleTimeString(
          "pt-BR"
        );
    }


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


/*
=========================================================
INÍCIO
=========================================================
*/

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
      "Binance-Robo Painel Premium V2 rodando na porta " +
      PORT
    );
  }
);
