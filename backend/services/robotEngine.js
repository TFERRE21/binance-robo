const Binance = require('binance-api-node').default;
const db = require('../services/db');
const cryptoService = require('../services/cryptoService');

const runners = new Map();
let schemaReady = false;

const STABLECOINS = new Set(['USDT','USDC','FDUSD','TUSD','DAI','BUSD','USD','USD1','RLUSD','EUR','TRY','BRL','GBP','AUD']);
const BLOCKED = new Set(['TRX']);
const LEVERAGED_SUFFIXES = ['UP','DOWN','BULL','BEAR'];
const STRATEGIES = {
  basico: {
    name:'Básico',
    description:'Mais oportunidades; filtros técnicos essenciais.',
    mode:'volume',
    scoreMin:5,
    rsiMin:40,
    rsiMax:65,
    requirePullback:false,
    marketMinScore:0
  },
  medio: {
    name:'Médio',
    description:'Equilíbrio entre seletividade e frequência.',
    mode:'volume',
    scoreMin:6,
    rsiMin:45,
    rsiMax:60,
    requirePullback:false,
    marketMinScore:0
  },
  premium: {
    name:'Premium',
    description:'Filtros de tendência e mercado; maior seletividade.',
    mode:'marketcap',
    scoreMin:7,
    rsiMin:40,
    rsiMax:65,
    requirePullback:false,
    marketMinScore:2
  },
  avancado: {
    name:'Avançado',
    description:'Mais seletivo; exige confirmação adicional do mercado.',
    mode:'marketcap',
    scoreMin:8,
    rsiMin:45,
    rsiMax:62,
    requirePullback:false,
    marketMinScore:3
  },
  elite: {
    name:'Elite',
    description:'Máxima seletividade; foco em setups mais filtrados.',
    mode:'marketcap',
    scoreMin:9,
    rsiMin:48,
    rsiMax:58,
    requirePullback:true,
    marketMinScore:4
  }
};
function strategyInfo(version){
  return STRATEGIES[String(version||'premium')] || STRATEGIES.premium;
}


function num(v){ const n=Number(v); return Number.isFinite(n)?n:0; }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function isStable(a){ return STABLECOINS.has(String(a||'').toUpperCase()); }
function isLeveraged(a){ const s=String(a||'').toUpperCase(); return LEVERAGED_SUFFIXES.some(x=>s.endsWith(x)); }
function roundDown(v, step){ if(!(v>0)||!(step>0)) return 0; const p=Math.max(0,(String(step).split('.')[1]||'').length); return Number((Math.floor(v/step)*step).toFixed(p)); }
function roundPrice(v,tick){ return roundDown(v,tick); }
function ema(values,period){ if(values.length<period)return null; let x=values.slice(0,period).reduce((a,b)=>a+num(b),0)/period; const k=2/(period+1); for(let i=period;i<values.length;i++) x=(num(values[i])-x)*k+x; return x; }
function rsi(values,period=14){ if(values.length<period+1)return null; let g=0,l=0; for(let i=values.length-period;i<values.length;i++){const d=num(values[i])-num(values[i-1]); if(d>0)g+=d; else l-=d;} if(l===0)return 100; return 100-100/(1+g/l); }
function errText(e){ return e?.body ? (typeof e.body==='string'?e.body:JSON.stringify(e.body)) : (e?.message||String(e)); }
function robotLog(userId,accountId,message,level='INFO'){
  const line=`[ROBO] usuário=${userId} | conta=${accountId} | ${message}`;
  if(level==='ERROR')console.error(line);else console.log(line);
  db.query(`INSERT INTO robot_logs(user_id,account_id,level,message) VALUES($1,$2,$3,$4)`,
    [userId,accountId,level,String(message)]
  ).catch(e=>console.error('[ROBO LOG DB]:',errText(e)));
}
function fmtNum(v){
  const n=Number(v);
  return Number.isFinite(n)?n.toFixed(4):String(v??'-');
}


async function ensureSchema(){
  if(schemaReady)return;

  // IMPORTANTE:
  // Estas tabelas podem ter sido criadas por versões anteriores do robô.
  // CREATE TABLE IF NOT EXISTS NÃO atualiza tabelas existentes.
  // Por isso fazemos uma migração compatível, adicionando somente as colunas
  // que estiverem faltando.

  await db.query(`
    CREATE TABLE IF NOT EXISTS robot_configs (
      user_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      strategy_version VARCHAR(40) NOT NULL DEFAULT 'v7.1',
      entry_percent NUMERIC(8,3) NOT NULL DEFAULT 98,
      take_profit NUMERIC(8,3) NOT NULL DEFAULT 5,
      stop_loss NUMERIC(8,3) NOT NULL DEFAULT 2.5,
      stop_loss_active BOOLEAN NOT NULL DEFAULT true,
      max_operations INTEGER NOT NULL DEFAULT 3,
      interval VARCHAR(8) NOT NULL DEFAULT '15m',
      max_coins INTEGER NOT NULL DEFAULT 20,
      running BOOLEAN NOT NULL DEFAULT false,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(user_id,account_id)
    );

    CREATE TABLE IF NOT EXISTS robot_operations (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      symbol VARCHAR(30) NOT NULL,
      buy_order_id VARCHAR(80),
      tp_order_id VARCHAR(80),
      buy_price NUMERIC(30,12),
      quantity NUMERIC(30,12),
      tp_price NUMERIC(30,12),
      stop_price NUMERIC(30,12),
      status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
      opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMPTZ,
      close_reason VARCHAR(30),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS robot_logs (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      level VARCHAR(12) NOT NULL DEFAULT 'INFO',
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Migração de robot_configs de versões antigas.
    ALTER TABLE robot_configs
      ADD COLUMN IF NOT EXISTS id BIGINT GENERATED BY DEFAULT AS IDENTITY,
      ADD COLUMN IF NOT EXISTS strategy_version VARCHAR(40) NOT NULL DEFAULT 'v7.1',
      ADD COLUMN IF NOT EXISTS entry_percent NUMERIC(8,3) NOT NULL DEFAULT 98,
      ADD COLUMN IF NOT EXISTS take_profit NUMERIC(8,3) NOT NULL DEFAULT 5,
      ADD COLUMN IF NOT EXISTS stop_loss NUMERIC(8,3) NOT NULL DEFAULT 2.5,
      ADD COLUMN IF NOT EXISTS stop_loss_active BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS max_operations INTEGER NOT NULL DEFAULT 3,
      ADD COLUMN IF NOT EXISTS interval VARCHAR(8) NOT NULL DEFAULT '15m',
      ADD COLUMN IF NOT EXISTS max_coins INTEGER NOT NULL DEFAULT 20,
      ADD COLUMN IF NOT EXISTS running BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

    -- Migração de robot_operations de versões antigas.
    ALTER TABLE robot_operations
      ADD COLUMN IF NOT EXISTS buy_order_id VARCHAR(80),
      ADD COLUMN IF NOT EXISTS tp_order_id VARCHAR(80),
      ADD COLUMN IF NOT EXISTS buy_price NUMERIC(30,12),
      ADD COLUMN IF NOT EXISTS quantity NUMERIC(30,12),
      ADD COLUMN IF NOT EXISTS tp_price NUMERIC(30,12),
      ADD COLUMN IF NOT EXISTS stop_price NUMERIC(30,12),
      ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
      ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS close_reason VARCHAR(30),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

    CREATE INDEX IF NOT EXISTS idx_robot_ops_user_account_status
      ON robot_operations(user_id,account_id,status);

    CREATE INDEX IF NOT EXISTS idx_robot_logs_user_account_created
      ON robot_logs(user_id,account_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_robot_configs_user_account
      ON robot_configs(user_id,account_id);
  `);

  // Garante valores padrão em registros antigos que eventualmente tenham
  // ficado NULL durante migrações anteriores.
  await db.query(`
    UPDATE robot_configs
    SET
      strategy_version=COALESCE(strategy_version,'v7.1'),
      entry_percent=COALESCE(entry_percent,98),
      take_profit=COALESCE(take_profit,5),
      stop_loss=COALESCE(stop_loss,2.5),
      stop_loss_active=COALESCE(stop_loss_active,true),
      max_operations=COALESCE(max_operations,3),
      interval=COALESCE(interval,'15m'),
      max_coins=COALESCE(max_coins,20),
      running=COALESCE(running,false),
      updated_at=COALESCE(updated_at,NOW())
  `);

  schemaReady=true;
}
async function getAccount(userId,accountId){
  const r=await db.query(`SELECT id,user_id,name,api_key_encrypted,api_secret_encrypted,active FROM binance_accounts WHERE id=$1 AND user_id=$2`,[accountId,userId]);
  return r.rows[0]||null;
}
function clientFor(account){ return Binance({apiKey:cryptoService.decrypt(account.api_key_encrypted),apiSecret:cryptoService.decrypt(account.api_secret_encrypted),recvWindow:60000}); }

async function getConfig(userId,accountId){
  await ensureSchema();
  const r=await db.query(`SELECT * FROM robot_configs WHERE user_id=$1 AND account_id=$2`,[userId,accountId]);
  return r.rows[0]||null;
}
async function saveConfig(userId,accountId,c){
  await ensureSchema();
  const r=await db.query(`INSERT INTO robot_configs(user_id,account_id,strategy_version,entry_percent,take_profit,stop_loss,stop_loss_active,max_operations,interval,max_coins,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()) ON CONFLICT(user_id,account_id) DO UPDATE SET strategy_version=EXCLUDED.strategy_version,entry_percent=EXCLUDED.entry_percent,take_profit=EXCLUDED.take_profit,stop_loss=EXCLUDED.stop_loss,stop_loss_active=EXCLUDED.stop_loss_active,max_operations=EXCLUDED.max_operations,interval=EXCLUDED.interval,max_coins=EXCLUDED.max_coins,updated_at=NOW() RETURNING *`,[userId,accountId,c.strategyVersion,c.entryPercent,c.takeProfit,c.stopLoss,c.stopLossActive,c.maxOperations,c.interval,c.maxCoins]);
  return r.rows[0];
}

async function top20(client,exchangeInfo,maxCoins){
  const response=await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1&sparkline=false',{headers:{'User-Agent':'CriptoPro/1.0'}});
  if(!response.ok) throw new Error(`CoinGecko HTTP ${response.status}`);
  const coins=await response.json(); const out=[];
  console.log(`[ROBO] SCANNER V7.1 | CoinGecko retornou ${Array.isArray(coins)?coins.length:0} moedas.`);
  for(const coin of coins){
    if(out.length>=maxCoins)break;
    const base=String(coin.symbol||'').toUpperCase();
    if(!base||isStable(base)||isLeveraged(base)||BLOCKED.has(base))continue;
    const pair=exchangeInfo.symbols.find(s=>s.status==='TRADING'&&s.quoteAsset==='USDT'&&String(s.baseAsset).toUpperCase()===base);
    if(!pair)continue;
    if(pair.onboardDate && Date.now()-Number(pair.onboardDate)<365*86400000)continue;
    out.push({symbol:pair.symbol,baseAsset:base,rank:num(coin.market_cap_rank),name:coin.name});
  }
  return out;
}

async function marketFilter(client){
  try{
    const d=await client.candles({symbol:'BTCUSDT',interval:'1d',limit:250}); const c1=d.slice(0,-1).map(x=>num(x.close));
    if(c1.length<200)return {favoravel:false,quente:false,score:0};
    const e50=ema(c1,50),e200=ema(c1,200),p=c1.at(-1); let score=0;
    if(p>e50)score++; if(e50>e200)score++;
    const d4=await client.candles({symbol:'BTCUSDT',interval:'4h',limit:150}); const c4=d4.slice(0,-1).map(x=>num(x.close));
    const e21=ema(c4,21),e50_4=ema(c4,50),r=rsi(c4,14),p4=c4.at(-1); if(p4>e50_4)score++; if(e21>e50_4)score++;
    const hot=((p4-e21)/e21)>0.04 || r>70;
    return {favoravel:score>=2,quente:hot,score};
  }catch(e){ return {favoravel:false,quente:false,score:0,error:errText(e)}; }
}

async function analyze(client,symbol,market,interval,version='premium'){
  const strategy=strategyInfo(version);
  const rows=await client.candles({symbol,interval,limit:120});
  const closed=rows.slice(0,-1);
  if(closed.length<50)return {valid:false,reason:'Poucos candles'};

  const closes=closed.map(x=>num(x.close));
  const opens=closed.map(x=>num(x.open));
  const highs=closed.map(x=>num(x.high));
  const lows=closed.map(x=>num(x.low));
  const volumes=closed.map(x=>num(x.volume));

  const e9=ema(closes,9),e21=ema(closes,21),r=rsi(closes,14);
  const last=closes.length-1,p=closes[last],o=opens[last];
  let score=0;

  if(e9>e21)score+=2;
  if(r>=strategy.rsiMin&&r<=strategy.rsiMax)score++;
  if(r>strategy.rsiMax+5)return {valid:false,reason:`RSI muito alto: ${r.toFixed(2)}`};

  const dist=(p-e21)/e21;
  if(dist>0.04)return {valid:false,reason:'Preço esticado'};
  if(Math.abs(dist)<=0.025)score++;

  const avgVol=volumes.slice(-21,-1).reduce((a,b)=>a+b,0)/Math.max(1,volumes.slice(-21,-1).length);
  const vr=avgVol?volumes[last]/avgVol:0;
  if(vr>=0.8)score++;
  if(p>o)score++;

  const minLow=Math.min(...lows.slice(-6));
  const pull=Math.abs((minLow-e21)/e21)<=0.025&&p>=e21*0.995&&p<=e21*1.04;
  const maxHigh=Math.max(...highs.slice(-11,-1));
  const breakout=p>maxHigh&&vr>=1.3&&dist<=0.04;

  let entry=null;
  if(pull) { score++; entry='PULLBACK'; }
  else if(breakout && !market.quente) { score++; entry='BREAKOUT'; }

  if(strategy.requirePullback && entry!=='PULLBACK')
    return {valid:false,reason:'Estratégia exige PULLBACK'};

  if(market.quente && entry!=='PULLBACK')
    return {valid:false,reason:'Mercado aquecido'};

  if(market.score < strategy.marketMinScore)
    return {valid:false,reason:`Mercado abaixo do filtro da estratégia (${market.score})`};

  if(score<strategy.scoreMin || !entry)
    return {valid:false,reason:`Score ${score} abaixo de ${strategy.scoreMin}`};

  const price=num((await client.prices({symbol}))[symbol]);
  return {
    valid:price>0,price,score,rsi:r,e9,e21,entry,
    strategy:version,
    volumeRatio:vr,
    pullback:pull,
    breakout,

    reason:price>0?'':'Preço inválido'
  };
}
async function openCount(userId,accountId){ await ensureSchema(); const r=await db.query(`SELECT COUNT(*)::int AS count FROM robot_operations WHERE user_id=$1 AND account_id=$2 AND status='OPEN'`,[userId,accountId]); return num(r.rows[0]?.count); }
async function existingSymbol(userId,accountId,symbol){ await ensureSchema(); const r=await db.query(`SELECT id FROM robot_operations WHERE user_id=$1 AND account_id=$2 AND symbol=$3 AND status='OPEN' LIMIT 1`,[userId,accountId,symbol]); return !!r.rows.length; }

async function buy(userId,account,config,symbol){
  const client=clientFor(account);
  const info=await client.exchangeInfo();
  const si=info.symbols.find(s=>s.symbol===symbol);
  if(!si)throw new Error('Par não encontrado');

  const lot=si.filters.find(f=>f.filterType==='LOT_SIZE');
  const pf=si.filters.find(f=>f.filterType==='PRICE_FILTER');
  const nf=si.filters.find(f=>f.filterType==='NOTIONAL'||f.filterType==='MIN_NOTIONAL');
  const step=num(lot?.stepSize),tick=num(pf?.tickSize),minNot=num(nf?.minNotional);

  const ac=await client.accountInfo();
  const usdt=num(ac.balances.find(b=>b.asset==='USDT')?.free);
  const price=num((await client.prices({symbol}))[symbol]);

  if(!(usdt>0))throw new Error('Saldo USDT disponível é zero');
  if(!(price>0))throw new Error('Preço atual inválido');

  const value=usdt*(num(config.entry_percent)/100);
  let qty=roundDown(value/price,step);

  if(qty<=0)throw new Error(`Quantidade calculada inválida | saldo USDT=${usdt.toFixed(4)} | entrada=${num(config.entry_percent)}%`);
  if(qty*price<minNot)throw new Error(`Valor da ordem abaixo do mínimo Binance | valor=${(qty*price).toFixed(4)} USDT | mínimo=${minNot}`);

  robotLog(userId,account.id,`ORDEM DE COMPRA | ${symbol} | estratégia=${strategyInfo(config.strategy_version).name} | entrada=${num(config.entry_percent)}% | valor≈${(qty*price).toFixed(4)} USDT`);

  const order=await client.order({symbol,side:'BUY',type:'MARKET',quantity:qty});
  await sleep(1200);

  let executedQty=num(order.executedQty)||qty;
  let buyValue=num(order.cummulativeQuoteQty)||0;
  let buyPrice=buyValue>0?buyValue/executedQty:price;

  if(Array.isArray(order.fills)&&order.fills.length){
    let q=0,v=0;
    for(const f of order.fills){q+=num(f.qty);v+=num(f.qty)*num(f.price);}
    if(q>0){executedQty=q;buyPrice=v/q;}
  }

  const ac2=await client.accountInfo();
  const asset=symbol.replace(/USDT$/,'');
  const free=num(ac2.balances.find(b=>b.asset===asset)?.free);
  qty=roundDown(Math.min(executedQty,free||executedQty),step);
  if(qty<=0)throw new Error('Saldo do ativo não encontrado após compra');

  const tp=roundPrice(buyPrice*(1+num(config.take_profit)/100),tick);
  const stop=roundPrice(buyPrice*(1-num(config.stop_loss)/100),tick);

  let tpOrder=null;
  try{
    tpOrder=await client.order({symbol,side:'SELL',type:'LIMIT',quantity:qty,price:tp,timeInForce:'GTC'});
    robotLog(userId,account.id,
      `ORDEM DE VENDA CRIADA | ${symbol} | tipo=TAKE PROFIT | ordem=${tpOrder.orderId} | quantidade=${qty} | preço=${tp} | alvo=+${num(config.take_profit)}%`
    );
  }catch(e){
    // Se o TP não puder ser criado, não deixamos a posição sem registro.
    // O monitor poderá atuar pelo stop, mas o evento fica explícito no log.
    robotLog(userId,account.id,`COMPRA EXECUTADA | ${symbol} | mas TAKE PROFIT não foi criado | ${errText(e)}`,'ERROR');
    throw e;
  }

  await db.query(
    `INSERT INTO robot_operations(user_id,account_id,symbol,buy_order_id,tp_order_id,buy_price,quantity,tp_price,stop_price,status,opened_at,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'OPEN',NOW(),NOW())`,
    [userId,account.id,symbol,String(order.orderId),String(tpOrder.orderId),buyPrice,qty,tp,stop]
  );

  robotLog(userId,account.id,
    `COMPRA REALIZADA | ${symbol} | ordem=${order.orderId} | preço=${buyPrice} | quantidade=${qty} | valor≈${(buyPrice*qty).toFixed(4)} USDT`
  );
  robotLog(userId,account.id,
    `PROTEÇÃO DA POSIÇÃO | ${symbol} | TAKE PROFIT=${tp} (+${num(config.take_profit)}%) | ordem SELL=${tpOrder.orderId} | STOP LOSS=${config.stop_loss_active?'ATIVO '+stop:'DESATIVADO'}`
  );

  return {symbol,buyOrderId:order.orderId,tpOrderId:tpOrder.orderId,buyPrice,quantity:qty,tpPrice:tp,stopPrice:stop};
}

async function executeApprovedSetups(userId,account,config,setups){
  const limit=Math.max(1,Number(config.max_operations)||1);
  let open=await openCount(userId,account.id);

  if(open>=limit){
    robotLog(userId,account.id,`ENTRADAS BLOQUEADAS | ${open}/${limit} operações simultâneas já abertas.`);
    return;
  }

  for(const setup of setups){
    if(open>=limit)break;

    if(await existingSymbol(userId,account.id,setup.symbol)){
      robotLog(userId,account.id,`${setup.symbol} | NÃO COMPRAR | já existe operação aberta nesse ativo.`);
      continue;
    }

    try{
      const result=await buy(userId,account,config,setup.symbol);
      open++;
      robotLog(userId,account.id,
        `${setup.symbol} | POSIÇÃO ABERTA | ordem BUY=${result.buyOrderId} | ordem SELL/TP=${result.tpOrderId} | próxima saída automática no TP${config.stop_loss_active?' ou SL':''}.`
      );
    }catch(e){
      robotLog(userId,account.id,`${setup.symbol} | COMPRA NÃO EXECUTADA | motivo=${errText(e)}`,'ERROR');
    }
  }
}

async function monitorOpenOps(userId,account,config){
  const client=clientFor(account); await ensureSchema(); const r=await db.query(`SELECT * FROM robot_operations WHERE user_id=$1 AND account_id=$2 AND status='OPEN' ORDER BY id`,[userId,account.id]);
  for(const op of r.rows){
    try{
      const price=num((await client.prices({symbol:op.symbol}))[op.symbol]);
      if(config.stop_loss_active && price<=num(op.stop_price)){
        try{await client.cancelOrder({symbol:op.symbol,orderId:op.tp_order_id});}catch(_){ }
        const ex=await client.exchangeInfo(); const si=ex.symbols.find(s=>s.symbol===op.symbol); const lot=si?.filters?.find(f=>f.filterType==='LOT_SIZE'); const qty=roundDown(num(op.quantity),num(lot?.stepSize));
        if(qty>0) await client.order({symbol:op.symbol,side:'SELL',type:'MARKET',quantity:qty});
        await db.query(`UPDATE robot_operations SET status='CLOSED',closed_at=NOW(),close_reason='STOP',updated_at=NOW() WHERE id=$1`,[op.id]);
        robotLog(userId,account.id,`SAÍDA AUTOMÁTICA | ${op.symbol} | STOP LOSS acionado | preço=${price} | stop=${op.stop_price}`);
        continue;
      }
      let ord=null; try{ord=await client.getOrder({symbol:op.symbol,orderId:op.tp_order_id});}catch(_){ }
      if(ord && String(ord.status).toUpperCase()==='FILLED'){
        await db.query(`UPDATE robot_operations SET status='CLOSED',closed_at=NOW(),close_reason='TAKE_PROFIT',updated_at=NOW() WHERE id=$1`,[op.id]);
        robotLog(userId,account.id,`SAÍDA AUTOMÁTICA | ${op.symbol} | TAKE PROFIT executado | preço≈${price} | alvo=${op.tp_price}`);
      }
    }catch(e){ console.error(`ROBOT OP ${op.symbol}:`,errText(e)); }
  }
}

async function topVolumePairs(client,maxCoins){
  const tickers=await client.dailyStats();
  console.log(`[ROBO] SCANNER V6 | Binance retornou ${Array.isArray(tickers)?tickers.length:0} pares.`);
  return tickers
    .filter(t=>{
      const symbol=String(t.symbol||'').toUpperCase();
      const base=symbol.endsWith('USDT')?symbol.slice(0,-4):'';
      return symbol.endsWith('USDT') && base && !isStable(base) && !isLeveraged(base) && !BLOCKED.has(base);
    })
    .sort((a,b)=>num(b.quoteVolume)-num(a.quoteVolume))
    .slice(0,num(maxCoins));
}

async function scanByProfile(userId,account,config){
  const client=clientFor(account);
  const info=await client.exchangeInfo();
  const version=String(config.strategy_version||'premium').toLowerCase();
  const strategy=strategyInfo(version);

  robotLog(userId,account.id,`ANÁLISE INICIADA | estratégia=${strategy.name} | versão=${version} | intervalo=${config.interval} | máximo moedas=${config.max_coins}`);
  robotLog(userId,account.id,`INDICADORES | EMA9 + EMA21 + RSI14 + volume relativo + PULLBACK/BREAKOUT | filtro BTC 1D/4H quando aplicável`);

  let pairs=[];
  let market={favoravel:true,quente:false,score:0};

  if(strategy.mode==='volume'){
    const raw=await topVolumePairs(client,Number(config.max_coins));
    pairs=raw.map(x=>({symbol:x.symbol,baseAsset:String(x.symbol).replace(/USDT$/,'')}));
    robotLog(userId,account.id,`${strategy.name} | TOP ${pairs.length} por volume USDT selecionadas.`);
  }else{
    pairs=await top20(client,info,Number(config.max_coins));
    robotLog(userId,account.id,`${strategy.name} | TOP ${pairs.length} por market cap selecionadas.`);
    market=await marketFilter(client);
    robotLog(userId,account.id,`FILTRO BTC | score=${fmtNum(market.score)} | mínimo=${strategy.marketMinScore} | favorável=${market.favoravel?'SIM':'NÃO'} | aquecido=${market.quente?'SIM':'NÃO'}`);
  }

  if(!market.favoravel || market.score<strategy.marketMinScore){
    robotLog(userId,account.id,`SEM COMPRA | mercado não passou no filtro da estratégia ${strategy.name}.`);
    return [];
  }

  const setups=[];
  for(const p of pairs){
    try{
      const setup=await analyze(client,p.symbol,market,config.interval,version);
      if(setup.valid){
        robotLog(userId,account.id,`${p.symbol} | APROVADA | score=${fmtNum(setup.score)} | RSI14=${fmtNum(setup.rsi)} | EMA9=${fmtNum(setup.e9)} | EMA21=${fmtNum(setup.e21)} | volume=${fmtNum(setup.volumeRatio)}x | sinal=${setup.entry}`);
        setups.push({...p,...setup});
      }else{
        robotLog(userId,account.id,`${p.symbol} | REJEITADA | motivo=${setup.reason||'filtros não atendidos'} | score=${fmtNum(setup.score)} | RSI14=${fmtNum(setup.rsi)} | EMA9=${fmtNum(setup.e9)} | EMA21=${fmtNum(setup.e21)} | volume=${fmtNum(setup.volumeRatio)}x | sinal=${setup.entry||'-'}`);
      }
    }catch(e){
      robotLog(userId,account.id,`${p.symbol} | ERRO NA ANÁLISE | ${errText(e)}`,'ERROR');
    }
  }
  setups.sort((a,b)=>Number(b.score||0)-Number(a.score||0));
  robotLog(userId,account.id,`RESULTADO DA BUSCA | estratégia=${strategy.name} | analisadas=${pairs.length} | aprovadas=${setups.length} | rejeitadas=${pairs.length-setups.length}`);
  return setups;
}
async function scanV6(userId,account,config){
  return scanByProfile(userId,account,{...config,strategy_version:'medio'});
}
async function scan(userId,account,config){
  const version=String(config.strategy_version||'premium').toLowerCase();
  if(version==='v7.1')return scanByProfile(userId,account,{...config,strategy_version:'premium'});
  if(version==='v6')return scanByProfile(userId,account,{...config,strategy_version:'medio'});
  return scanByProfile(userId,account,STRATEGIES[version]?config:{...config,strategy_version:'premium'});
}

async function loop(userId,accountId){
  const key=`${userId}:${accountId}`;
  if(runners.has(key))return;

  const runner={stop:false};
  runners.set(key,runner);

  try{
    while(!runner.stop){
      const account=await getAccount(userId,accountId);
      const config=await getConfig(userId,accountId);

      if(!account||!config||!config.running)break;

      try{
        const strategy=strategyInfo(String(config.strategy_version||'premium'));

        robotLog(userId,account.id,
          `CICLO DE BUSCA | estratégia=${strategy.name} | entrada=${config.entry_percent}% | TP=${config.take_profit}% | SL=${config.stop_loss_active?'ATIVO '+config.stop_loss+'%':'DESATIVADO'} | simultâneas=${config.max_operations}`
        );

        // 1) Primeiro administra posições que já existem.
        await monitorOpenOps(userId,account,config);

        // 2) Depois procura novos setups conforme a estratégia escolhida.
        const setups=await scan(userId,account,config);

        // 3) Executa as entradas aprovadas respeitando o limite configurado.
        if(setups.length){
          await executeApprovedSetups(userId,account,config,setups);
        }else{
          robotLog(userId,account.id,`NENHUMA ENTRADA | nenhuma moeda passou por todos os filtros da estratégia ${strategy.name}.`);
        }
      }catch(e){
        robotLog(userId,account.id,`ERRO NO CICLO | ${errText(e)}`,'ERROR');
      }

      await sleep(15000);
    }
  }finally{
    runners.delete(key);
  }
}

async function start(userId,accountId){
  await ensureSchema();

  const account=await getAccount(userId,accountId);
  if(!account)throw new Error('Conta Binance não encontrada');
  if(!account.active)throw new Error('Conta Binance inativa');

  const c=await getConfig(userId,accountId);
  if(!c)throw new Error('Configure o robô antes de iniciar');

  const key=`${userId}:${accountId}`;
  const oldRunner=runners.get(key);

  if(oldRunner){
    oldRunner.stop=true;
    const deadline=Date.now()+20000;
    while(runners.has(key)&&Date.now()<deadline)await sleep(250);
    if(runners.has(key))
      throw new Error('O robô anterior ainda está encerrando. Aguarde alguns segundos e tente novamente.');
  }

  await db.query(
    `UPDATE robot_configs SET running=true,updated_at=NOW()
     WHERE user_id=$1 AND account_id=$2`,
    [userId,accountId]
  );

  await db.query(
    `INSERT INTO robot_logs(user_id,account_id,level,message) VALUES($1,$2,'INFO',$3)`,
    [userId,accountId,`ROBO VERSÃO ${String(c.strategy_version).toUpperCase()} LIGADO | configuração ativa | entrada=${num(c.entry_percent)}% | TP=${num(c.take_profit)}% | SL=${c.stop_loss_active?'ATIVO':'DESATIVADO'} | intervalo=${c.interval}`]
  );
  console.log(`[ROBO] VERSÃO ${String(c.strategy_version).toUpperCase()} LIGADO | usuário=${userId} | conta=${accountId}`);

  loop(userId,String(accountId));
  await sleep(150);

  const status=await getStatus(userId,accountId);
  if(!status.engineRunning){
    await db.query(`UPDATE robot_configs SET running=false,updated_at=NOW() WHERE user_id=$1 AND account_id=$2`,[userId,accountId]);
    throw new Error('A configuração foi ativada, mas o motor do robô não iniciou.');
  }

  return status;
}
async function stop(userId,accountId){
  await ensureSchema();

  const key=`${userId}:${accountId}`;
  const runner=runners.get(key);
  if(runner)runner.stop=true;

  await db.query(
    `UPDATE robot_configs SET running=false,updated_at=NOW()
     WHERE user_id=$1 AND account_id=$2`,
    [userId,accountId]
  );

  const deadline=Date.now()+20000;
  while(runners.has(key)&&Date.now()<deadline)await sleep(250);

  const cfg=await getConfig(userId,accountId);
  await db.query(
    `INSERT INTO robot_logs(user_id,account_id,level,message) VALUES($1,$2,'INFO',$3)`,
    [userId,accountId,`ROBO DESLIGADO | estratégia=${strategyInfo(String(cfg?.strategy_version||'premium')).name} | comando PARAR ROBÔ confirmado`]
  );
  console.log(`[ROBO] DESLIGADO | usuário=${userId} | conta=${accountId}`);

  return getStatus(userId,accountId);
}
async function resumeRunning(){ await ensureSchema(); const r=await db.query(`SELECT user_id,account_id FROM robot_configs WHERE running=true`); for(const x of r.rows){ console.log(`[ROBO] RETOMADO | usuário=${x.user_id} | conta=${x.account_id}`); loop(x.user_id,String(x.account_id)); } }

async function getStatus(userId,accountId){
  await ensureSchema();
  const c=await getConfig(userId,accountId);
  const r=await db.query(`SELECT id,symbol,buy_price,quantity,tp_price,stop_price,status,opened_at,closed_at,close_reason FROM robot_operations WHERE user_id=$1 AND account_id=$2 ORDER BY id DESC LIMIT 20`,[userId,accountId]);
  const logs=await db.query(`SELECT id,level,message,created_at FROM robot_logs WHERE user_id=$1 AND account_id=$2 ORDER BY id DESC LIMIT 80`,[userId,accountId]);
  const engineRunning=runners.has(`${userId}:${accountId}`);
  return {success:true,config:c,running:!!c?.running||engineRunning,engineRunning,operations:r.rows,robotLogs:logs.rows.reverse()};
}

module.exports={ensureSchema,getConfig,saveConfig,start,stop,getStatus,resumeRunning};
