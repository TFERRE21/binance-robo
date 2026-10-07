const CACHE_MS = 60 * 1000;
let cache = { at: 0, value: null };

const NEWS_SOURCES = [
  "https://news.google.com/rss/search?q=bitcoin%20OR%20btc%20OR%20crypto%20OR%20federal%20reserve%20OR%20fed%20OR%20inflation%20OR%20treasury%20OR%20oil%20OR%20geopolitics&hl=en-US&gl=US&ceid=US:en",
  "https://news.google.com/rss/search?q=bitcoin%20OR%20btc%20OR%20crypto%20OR%20fed%20OR%20inflation%20OR%20oil%20OR%20geopolitics&hl=pt-BR&gl=BR&ceid=BR:pt-419"
];

const NEGATIVE = [
  "war","attack","iran","israel","conflict","geopolitical","tariff","sanction",
  "inflation","hawkish","rate hike","higher rates","yield","treasury yields",
  "dollar rises","strong dollar","oil surge","oil jumps","liquidation","liquidations",
  "selloff","risk-off","outflow","hack","exploit","ban","lawsuit","recession",
  "guerra","ataque","conflito","geopolítica","tarifa","sanção","inflação",
  "juros altos","juros","yield","petróleo","liquidação","liquidações","venda",
  "saída","hack","proibição","recessão"
];

const VERY_NEGATIVE = [
  "emergency rate hike","surprise rate hike","fed shock","market crash","flash crash",
  "mass liquidation","record liquidation","exchange hack","bitcoin crash",
  "banking crisis","crise bancária","crash","queda forte","liquidação recorde"
];

const POSITIVE = [
  "rate cut","dovish","lower rates","cooling inflation","inflation falls",
  "etf inflow","etf inflows","institutional buying","adoption","approval",
  "stimulus","liquidity","risk-on","bitcoin reserve","crypto friendly",
  "corte de juros","inflação cai","entrada etf","adoção","aprovação",
  "estímulo","liquidez","reserva de bitcoin"
];

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function ema(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  let e = values.slice(0, period).reduce((a,b) => a+n(b),0) / period;
  const k = 2/(period+1);
  for (let i=period;i<values.length;i++) e=(n(values[i])-e)*k+e;
  return e;
}

function decode(value) {
  return String(value||"")
    .replace(/<!\[CDATA\[|\]\]>/g,"")
    .replace(/<[^>]+>/g," ")
    .replace(/&amp;/gi,"&")
    .replace(/&quot;/gi,'"')
    .replace(/&#39;/g,"'")
    .replace(/&lt;/gi,"<")
    .replace(/&gt;/gi,">")
    .replace(/\s+/g," ")
    .trim();
}

function parseNews(xml) {
  return (xml.match(/<item[\s\S]*?<\/item>/gi)||[]).map(item => {
    const get = tag => {
      const m=item.match(new RegExp("<"+tag+"(?:\\s[^>]*)?>([\\s\\S]*?)</"+tag+">","i"));
      return decode(m ? m[1] : "");
    };
    return {title:get("title"),description:get("description"),publishedAt:Date.parse(get("pubDate"))||0};
  }).filter(x=>x.title);
}

function classifyNews(items) {
  let score=0, severe=0, positives=0, negatives=0;
  const relevant=[];
  for (const item of items) {
    const text=(item.title+" "+item.description).toLowerCase();
    let s=0;
    for (const k of VERY_NEGATIVE) if(text.includes(k)) s-=2;
    for (const k of NEGATIVE) if(text.includes(k)) s-=1;
    for (const k of POSITIVE) if(text.includes(k)) s+=1;
    s=Math.max(-3,Math.min(3,s));
    if(s!==0) {
      score += s;
      if(s<0) negatives++;
      if(s>0) positives++;
      if(s<=-2) severe++;
      relevant.push({title:item.title,score:s,publishedAt:item.publishedAt});
    }
  }
  score=Math.max(-6,Math.min(6,score/Math.max(1,Math.min(5,relevant.length))));
  return {
    score:Number(score.toFixed(2)),
    severe,
    positives,
    negatives,
    articles:relevant.sort((a,b)=>b.publishedAt-a.publishedAt).slice(0,8)
  };
}

async function json(url) {
  const r=await fetch(url,{headers:{"User-Agent":"CriptoPro-MarketIntelligence/1.0"}});
  if(!r.ok) throw new Error("HTTP "+r.status+" "+url);
  return r.json();
}

async function text(url) {
  const r=await fetch(url,{headers:{"User-Agent":"CriptoPro-MarketIntelligence/1.0"}});
  if(!r.ok) throw new Error("HTTP "+r.status+" "+url);
  return r.text();
}

async function marketData() {
  const rows=await json("https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=15m&limit=100");
  const closed=rows.slice(0,-1);
  const closes=closed.map(x=>n(x[4]));
  const vols=closed.map(x=>n(x[5]));
  const last=closes.at(-1), prev15=closes.at(-2), prev1h=closes.at(-5);
  const avgVol=vols.slice(-21,-1).reduce((a,b)=>a+b,0)/Math.max(1,vols.slice(-21,-1).length);
  const volumeRatio=avgVol?vols.at(-1)/avgVol:0;
  const e9=ema(closes,9), e21=ema(closes,21);
  const ret5m=(last/closes.at(-1)-1)*100;
  const ret15m=(last/prev15-1)*100;
  const ret1h=(last/prev1h-1)*100;
  const [oiHist,oiNow,ls,taker,funding] = await Promise.all([
    json("https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=15m&limit=8"),
    json("https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT"),
    json("https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=15m&limit=1"),
    json("https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=BTCUSDT&period=15m&limit=1"),
    json("https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=1")
  ]);
  const oldOi=n(oiHist?.[0]?.sumOpenInterest), currentOi=n(oiNow?.openInterest);
  const oiChange=oldOi?((currentOi/oldOi)-1)*100:0;
  const longShort=n(ls?.[0]?.longShortRatio);
  const takerRatio=n(taker?.[0]?.buySellRatio);
  const lastFunding=n(funding?.[0]?.fundingRate);
  return {
    price:last, ret15m, ret1h, volumeRatio, ema9:e9, ema21:e21,
    oi:currentOi, oiChange, longShort, takerRatio, funding:lastFunding,
    liquidationRisk:
      ret15m<=-1.2 && (volumeRatio>=1.5 || oiChange>=0.5 || takerRatio<0.8)
        ? "HIGH"
        : ret15m<=-0.7 || volumeRatio>=2.0
          ? "MEDIUM" : "LOW"
  };
}

async function loadNews() {
  const results=await Promise.allSettled(NEWS_SOURCES.map(text));
  let articles=[];
  for(const r of results) if(r.status==="fulfilled") articles.push(...parseNews(r.value));
  const cutoff=Date.now()-6*60*60*1000;
  articles=articles.filter(x=>x.publishedAt>=cutoff)
    .sort((a,b)=>b.publishedAt-a.publishedAt)
    .filter((x,i,a)=>i===a.findIndex(y=>y.title.toLowerCase()===x.title.toLowerCase()))
    .slice(0,40);
  return classifyNews(articles);
}

function deriveRegime(m, news) {
  const crash =
    m.liquidationRisk==="HIGH" ||
    (m.ret15m<=-1.5 && m.volumeRatio>=1.7) ||
    (m.ret1h<=-2.5 && m.oiChange>0.5);

  const recovery =
    m.ret15m>=0.35 &&
    m.price>=m.ema9 &&
    m.takerRatio>=0.95 &&
    m.volumeRatio>=0.8 &&
    m.liquidationRisk!=="HIGH";

  if(crash) return "CRASH";
  if(recovery && (m.ret1h<0 || news.score<0)) return "RECOVERY";
  if(m.ret15m<=-0.7 || m.ret1h<=-1.5 || news.score<=-1.5 || m.liquidationRisk==="MEDIUM") return "STRESS";
  if(news.score<0 || m.ret15m<0 || m.price<m.ema21) return "ATTENTION";
  return "NORMAL";
}

async function getMarketIntelligence() {
  if(cache.value && Date.now()-cache.at<CACHE_MS) return cache.value;
  const [m,nw]=await Promise.allSettled([marketData(),loadNews()]);
  const market=m.status==="fulfilled"?m.value:{
    price:0,ret15m:0,ret1h:0,volumeRatio:0,ema9:0,ema21:0,
    oi:0,oiChange:0,longShort:0,takerRatio:0,funding:0,liquidationRisk:"UNKNOWN"
  };
  const news=nw.status==="fulfilled"?nw.value:{score:0,severe:0,positives:0,negatives:0,articles:[]};
  const regime=deriveRegime(market,news);
  const riskScore=Math.max(-10,Math.min(10,
    news.score
    + (market.ret15m<=-1? -2 : market.ret15m<0 ? -1 : market.ret15m>=0.5 ? 1 : 0)
    + (market.oiChange>1 && market.ret15m<0 ? -2 : 0)
    + (market.takerRatio<0.75 ? -2 : market.takerRatio>1.15 ? 1 : 0)
    + (market.longShort>1.5 ? -1 : 0)
    + (market.liquidationRisk==="HIGH" ? -3 : market.liquidationRisk==="MEDIUM" ? -1 : 0)
  ));
  cache={at:Date.now(),value:{
    regime,riskScore:Number(riskScore.toFixed(2)),market,news,
    allowNewEntries:regime!=="CRASH",
    updatedAt:Date.now()
  }};
  return cache.value;
}

module.exports={getMarketIntelligence};
