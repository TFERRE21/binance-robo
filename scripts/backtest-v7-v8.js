#!/usr/bin/env node
/**
 * Binance-Robo — Backtest comparativo V7 x V8 (técnico)
 *
 * IMPORTANTE:
 * - Reproduz a lógica de entrada técnica V7/V8 com candles históricos.
 * - V8 usa pullback/recuperação, filtro de vela esticada e tendência.
 * - Notícias, OI, Long/Short, Taker e Funding não são historicamente
 *   reconstruídos aqui; portanto este é um backtest técnico, não uma
 *   reprodução 100% fiel do motor V8 de produção.
 *
 * Uso:
 *   node scripts/backtest-v7-v8.js
 *   DAYS=180 SYMBOLS=BTCUSDT,ETHUSDT,SOLUSDT node scripts/backtest-v7-v8.js
 */
const DAYS=Number(process.env.DAYS||90);
const INTERVAL='1h';
const TP=Number(process.env.TP||5);
const SL=Number(process.env.SL||2.5);
const SLIPPAGE=Number(process.env.SLIPPAGE||0.0005);
const SYMBOLS=(process.env.SYMBOLS||'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,DOGEUSDT,ADAUSDT,LINKUSDT,AVAXUSDT,SUIUSDT')
  .split(',').map(s=>s.trim().toUpperCase()).filter(Boolean);
const API='https://api.binance.com/api/v3/klines';
const HOUR=60*60*1000;

function ema(a,p){if(a.length<p)return null;let x=a.slice(0,p).reduce((s,v)=>s+v,0)/p;const k=2/(p+1);for(let i=p;i<a.length;i++)x=(a[i]-x)*k+x;return x;}
function rsi(a,p=14){if(a.length<p+1)return null;let g=0,l=0;for(let i=a.length-p;i<a.length;i++){const d=a[i]-a[i-1];if(d>0)g+=d;else l-=d;}return l===0?100:100-100/(1+g/l);}
function atr(rows,p=14){if(rows.length<p+1)return null;let s=0;for(let i=rows.length-p;i<rows.length;i++){const c=rows[i],q=rows[i-1];s+=Math.max(c.h-c.l,Math.abs(c.h-q.c),Math.abs(c.l-q.c));}return s/p;}
function parse(rows){return rows.map(x=>({t:+x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5]}));}

async function fetchKlines(symbol,start,end){
  const out=[];
  let cursor=start;
  while(cursor<end){
    const url=`${API}?symbol=${symbol}&interval=${INTERVAL}&startTime=${cursor}&endTime=${end}&limit=1000`;
    const r=await fetch(url);
    if(!r.ok)throw new Error(`${symbol}: Binance HTTP ${r.status}`);
    const rows=await r.json();
    if(!rows.length)break;
    out.push(...rows);
    const last=Number(rows.at(-1)[0]);
    if(last<=cursor)break;
    cursor=last+HOUR;
    if(rows.length<1000)break;
  }
  const seen=new Map(out.map(x=>[x[0],x]));
  return parse([...seen.values()].sort((a,b)=>a.t-b.t));
}

function signal(rows,i,v8){
  const w=rows.slice(0,i);
  if(w.length<70)return false;
  const closes=w.map(x=>x.c);
  const e9=ema(closes,9),e21=ema(closes,21),rr=rsi(closes),a=atr(w);
  const x=w.at(-1),prev=w.at(-2);
  if(!(e9>e21)||!rr)return false;
  const dist=(x.c-e21)/e21;
  const avgVol=w.slice(-21,-1).reduce((s,z)=>s+z.v,0)/20;
  const vr=avgVol?x.v/avgVol:0;
  const minRsi=v8?47:45,maxRsi=v8?61:68,minVol=v8?1.15:0.85,maxDist=v8?0.022:0.03;
  if(dist>maxDist||rr>maxRsi||rr<minRsi||vr<minVol||x.c<=x.o)return false;
  if(!v8)return true;

  const lows=w.slice(-6,-1).map(z=>z.l);
  const minLow=Math.min(...lows);
  const pull=(minLow<=e21*1.015||minLow<=e9*1.018)
    &&w.slice(-6,-1).some(z=>z.c<=e9*1.015||z.c<=e21*1.012)
    &&x.c>=e9*0.998&&x.c>=e21;

  const body=Math.abs(x.c-x.o);
  const range=Math.max(1e-12,x.h-x.l);
  const bodyRatio=body/range;
  const atrRatio=a?range/a:0;
  const explosive=atrRatio>=2.20;
  const recovery=prev.c<=e9*1.008&&x.c>e9&&bodyRatio>=0.28&&!explosive;
  return (pull||recovery)&&bodyRatio>=0.30&&!explosive;
}

function backtest(rows,v8){
  let equity=100,peak=100,maxDD=0,trades=0,wins=0,losses=0,pnlSum=0;
  for(let i=70;i<rows.length-1;i++){
    if(!signal(rows,i,v8))continue;
    const entry=rows[i].c*(1+SLIPPAGE);
    const tp=entry*(1+TP/100);
    const sl=entry*(1-SL/100);
    let exit=null,win=false;
    for(let j=i+1;j<rows.length;j++){
      // Conservador: se TP e SL ocorrerem na mesma vela, assume SL primeiro.
      if(rows[j].l<=sl){exit=sl*(1-SLIPPAGE);win=false;break;}
      if(rows[j].h>=tp){exit=tp*(1-SLIPPAGE);win=true;break;}
    }
    if(exit===null){exit=rows.at(-1).c;win=exit>entry;}
    const r=(exit/entry-1)*100;
    equity*=1+r/100;
    peak=Math.max(peak,equity);
    maxDD=Math.max(maxDD,(peak-equity)/peak*100);
    pnlSum+=r;trades++;if(win)wins++;else losses++;
    i=Math.max(i,i+1); // uma posição por vez no ativo
  }
  return {trades,wins,losses,winRate:trades?wins/trades*100:0,tradePnlSumPct:pnlSum,equityReturnPct:equity-100,maxDDPct:maxDD};
}

function aggregate(results){
  const a={trades:0,wins:0,losses:0,tradePnlSumPct:0,equityReturns:[],maxDDPct:0};
  for(const r of Object.values(results)){a.trades+=r.trades;a.wins+=r.wins;a.losses+=r.losses;a.tradePnlSumPct+=r.tradePnlSumPct;a.equityReturns.push(r.equityReturnPct);a.maxDDPct=Math.max(a.maxDDPct,r.maxDDPct);}
  a.winRate=a.trades?a.wins/a.trades*100:0;
  a.equalWeightReturnPct=a.equityReturns.reduce((s,v)=>s+v,0);
  return a;
}

(async()=>{
  const end=Date.now();
  const start=end-DAYS*24*HOUR;
  const data={};
  for(const symbol of SYMBOLS){
    process.stdout.write(`Baixando ${symbol}...\\n`);
    data[symbol]=await fetchKlines(symbol,start,end);
  }
  const v7={},v8={};
  for(const [symbol,rows] of Object.entries(data)){v7[symbol]=backtest(rows,false);v8[symbol]=backtest(rows,true);}
  const a=aggregate(v7),b=aggregate(v8);
  console.log('\\n=== BINANCE-ROBO BACKTEST V7 x V8 ===');
  console.log(JSON.stringify({periodDays:DAYS,interval:INTERVAL,tp:TP,sl:SL,slippagePerSide:SLIPPAGE,symbols:SYMBOLS,v7:a,v8:b,delta:{
    trades:b.trades-a.trades,
    winRatePp:b.winRate-a.winRate,
    equityReturnPp:b.equalWeightReturnPct-a.equalWeightReturnPct,
    maxDDPp:b.maxDDPct-a.maxDDPct
  },perSymbol:{v7,v8}},null,2));
})();