const express = require('express');
const db = require('../services/db');
const auth = require('../middleware/auth');
const crypto = require('../services/cryptoService');
const Binance = require('binance-api-node').default;

const router = express.Router();
const ALLOWED = new Set(['profissional', 'premium']);
const STABLE = new Set(['USDT','USDC','FDUSD','TUSD','DAI','BUSD','USD','USD1','RLUSD','EUR','TRY','BRL','GBP','AUD']);
let ready = false;
let busy = false;
const runtimeLogs = [];
function logEvent(level, message, meta = {}) {
  runtimeLogs.unshift({
    time: new Date().toISOString(),
    level,
    message,
    ...meta
  });
  if (runtimeLogs.length > 100) runtimeLogs.length = 100;
  console.log('[COPY TRADING]', level, message, meta);
}
logEvent('INFO', 'Motor Copy Trading iniciado. Aguardando sinais do TradingView.');

const n = v => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

function down(v, s) {
  if (!(v > 0) || !(s > 0)) return 0;
  const d = Math.max(0, (String(s).split('.')[1] || '').length);
  return Number((Math.floor(v / s) * s).toFixed(d));
}

async function schema() {
  if (ready) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS tv_copy_configs (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      strategy_key VARCHAR(100) NOT NULL DEFAULT 'CRIPTOPRO',
      capital_usdt NUMERIC(30,8) NOT NULL,
      allocation_pct NUMERIC(8,4) NOT NULL DEFAULT 100,
      active BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, account_id)
    );
    CREATE TABLE IF NOT EXISTS tv_copy_positions (
      id BIGSERIAL PRIMARY KEY,
      copy_config_id BIGINT NOT NULL REFERENCES tv_copy_configs(id) ON DELETE CASCADE,
      symbol VARCHAR(30) NOT NULL,
      quantity NUMERIC(30,12) NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      avg_price NUMERIC(30,12) NOT NULL DEFAULT 0,
      invested_usdt NUMERIC(30,12) NOT NULL DEFAULT 0,
      UNIQUE(copy_config_id, symbol)
    );
    CREATE TABLE IF NOT EXISTS tv_copy_events (
      id BIGSERIAL PRIMARY KEY,
      copy_config_id BIGINT NOT NULL REFERENCES tv_copy_configs(id) ON DELETE CASCADE,
      signal_id VARCHAR(150) NOT NULL,
      strategy_key VARCHAR(100),
      symbol VARCHAR(30) NOT NULL,
      side VARCHAR(10) NOT NULL,
      quantity_pct NUMERIC(8,4) NOT NULL DEFAULT 100,
      order_id VARCHAR(100),
      status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(copy_config_id, signal_id)
    );
    CREATE INDEX IF NOT EXISTS idx_tv_copy_active ON tv_copy_configs(active);
    ALTER TABLE tv_copy_events ADD COLUMN IF NOT EXISTS entry_price NUMERIC(30,12) DEFAULT 0;
    ALTER TABLE tv_copy_events ADD COLUMN IF NOT EXISTS exit_price NUMERIC(30,12) DEFAULT 0;
    ALTER TABLE tv_copy_events ADD COLUMN IF NOT EXISTS pnl_usdt NUMERIC(30,12) DEFAULT 0;
    ALTER TABLE tv_copy_events ADD COLUMN IF NOT EXISTS pnl_pct NUMERIC(12,6) DEFAULT 0;
  `);
  ready = true;
}

async function plan(uid) {
  const r = await db.query(
    "SELECT plan FROM subscriptions WHERE user_id=$1 AND status='ACTIVE' AND (expires_at IS NULL OR expires_at>NOW()) ORDER BY created_at DESC LIMIT 1",
    [uid]
  );
  return String(r.rows[0]?.plan || '').toLowerCase();
}

async function gate(req, res, next) {
  try {
    await schema();
    const p = await plan(req.user.id);
    if (!ALLOWED.has(p)) {
      return res.status(403).json({
        success: false,
        allowed: false,
        message: 'Copy Trading está disponível somente nos planos Profissional e Premium.'
      });
    }
    req.copyPlan = p;
    next();
  } catch (e) {
    res.status(500).json({ success: false, message: 'Erro ao validar o plano.' });
  }
}

function client(a) {
  return Binance({
    apiKey: crypto.decrypt(a.api_key_encrypted),
    apiSecret: crypto.decrypt(a.api_secret_encrypted),
    recvWindow: 60000
  });
}

async function account(uid, id) {
  const r = await db.query(
    'SELECT id,user_id,name,api_key_encrypted,api_secret_encrypted,active FROM binance_accounts WHERE id=$1 AND user_id=$2 AND active=true LIMIT 1',
    [id, uid]
  );
  return r.rows[0] || null;
}

async function rules(c, symbol) {
  const x = await c.exchangeInfo();
  const z = x.symbols.find(y => y.symbol === symbol);
  if (!z) throw Error('Par não disponível na Binance: ' + symbol);
  const f = (z.filters || []).find(y => y.filterType === 'LOT_SIZE');
  return { step: n(f?.stepSize), min: n(f?.minQty) };
}

async function free(c, asset) {
  const x = await c.accountInfo();
  const b = (x.balances || []).find(y => String(y.asset || '').toUpperCase() === asset);
  return n(b?.free);
}

async function executeSignal(cfg, signal) {
  const ar = await db.query(
    'SELECT id,user_id,name,api_key_encrypted,api_secret_encrypted FROM binance_accounts WHERE id=$1 AND user_id=$2 AND active=true LIMIT 1',
    [cfg.account_id, cfg.user_id]
  );
  const a = ar.rows[0];
  if (!a) throw Error('Conta Binance não encontrada ou inativa.');

  const symbol = String(signal.symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const side = String(signal.side || '').toUpperCase();
  const pct = Math.min(100, Math.max(0.01, n(signal.quantityPercent ?? signal.quantity_pct ?? 100)));

  if (!symbol || !/^[A-Z0-9]{5,30}$/.test(symbol)) throw Error('Símbolo inválido.');
  if (!['BUY', 'SELL'].includes(side)) throw Error('Sinal deve ser BUY ou SELL.');

  const c = client(a);
  const r = await rules(c, symbol);

  if (side === 'BUY') {
    const amount = n(cfg.capital_usdt) * Math.min(100, Math.max(0.01, n(cfg.allocation_pct))) / 100;
    const quote = amount;
    if (!(quote > 0)) throw Error('Capital de Copy Trading inválido.');

    const o = await c.order({
      symbol,
      side: 'BUY',
      type: 'MARKET',
      quoteOrderQty: quote,
      newClientOrderId: 'TVB' + cfg.id + Date.now()
    });

    const qty = n(o?.executedQty);
    const quoteSpent = n(o?.cummulativeQuoteQty) || n(o?.quoteOrderQty) || n(cfg.capital_usdt);
    const entryPrice = qty > 0 ? quoteSpent / qty : 0;
    if (qty > 0) {
      await db.query(
        `INSERT INTO tv_copy_positions(copy_config_id,symbol,quantity,avg_price,invested_usdt,updated_at)
         VALUES($1,$2,$3,$4,$5,NOW())
         ON CONFLICT(copy_config_id,symbol)
         DO UPDATE SET
           avg_price=CASE WHEN tv_copy_positions.quantity+EXCLUDED.quantity>0
             THEN ((tv_copy_positions.avg_price*tv_copy_positions.quantity)+EXCLUDED.avg_price*EXCLUDED.quantity)/(tv_copy_positions.quantity+EXCLUDED.quantity)
             ELSE 0 END,
           quantity=tv_copy_positions.quantity+EXCLUDED.quantity,
           invested_usdt=tv_copy_positions.invested_usdt+EXCLUDED.invested_usdt,
           updated_at=NOW()`,
        [cfg.id, symbol, qty, entryPrice, quoteSpent]
      );
      await db.query(
        "UPDATE tv_copy_events SET entry_price=$1 WHERE copy_config_id=$2 AND symbol=$3 AND side='BUY' AND status='PENDING' ORDER BY id DESC LIMIT 1",
        [entryPrice, cfg.id, symbol]
      ).catch(()=>{});
    }
    return o;
  }

  const base = symbol.endsWith('USDT') ? symbol.slice(0, -4) : null;
  if (!base) throw Error('Por segurança, o Copy Trading externo opera somente pares USDT.');

  const pr = await db.query(
    'SELECT quantity,avg_price,invested_usdt FROM tv_copy_positions WHERE copy_config_id=$1 AND symbol=$2 LIMIT 1',
    [cfg.id, symbol]
  );
  const pos = pr.rows[0];
  const tracked = n(pos?.quantity);
  if (!(tracked > 0)) throw Error('Não há posição do Copy Trading para vender.');

  const available = await free(c, base);
  const quantity = down(Math.min(tracked, available) * pct / 100, r.step);
  if (!(quantity > 0) || quantity < r.min) throw Error('Quantidade abaixo do mínimo da Binance.');

  const o = await c.order({
    symbol,
    side: 'SELL',
    type: 'MARKET',
    quantity,
    newClientOrderId: 'TVS' + cfg.id + Date.now()
  });

  const sold = n(o?.executedQty) || quantity;
  const quoteReceived = n(o?.cummulativeQuoteQty);
  const exitPrice = quoteReceived > 0 && sold > 0 ? quoteReceived / sold : 0;
  const investedPart = n(pos.invested_usdt) * Math.min(1, sold / tracked);
  const pnl = exitPrice > 0 ? quoteReceived - investedPart : 0;
  const pnlPct = investedPart > 0 ? (pnl / investedPart) * 100 : 0;
  await db.query(
    'UPDATE tv_copy_positions SET quantity=GREATEST(quantity-$1,0),invested_usdt=GREATEST(invested_usdt-$2,0),updated_at=NOW() WHERE copy_config_id=$3 AND symbol=$4',
    [sold, investedPart, cfg.id, symbol]
  );
  signal._result = { entryPrice:n(pos.avg_price), exitPrice, pnl, pnlPct };
  return o;
}

async function dispatchSignal(signal) {
  await schema();
  logEvent('SIGNAL', 'Sinal recebido do TradingView', {
    symbol: String(signal.symbol || '').toUpperCase(),
    side: String(signal.side || '').toUpperCase(),
    strategy: String(signal.strategy || 'CRIPTOPRO')
  });
  const strategy = String(signal.strategy || signal.strategyKey || 'CRIPTOPRO').trim() || 'CRIPTOPRO';
  const r = await db.query(
    "SELECT * FROM tv_copy_configs WHERE active=true AND (strategy_key=$1 OR strategy_key='*')",
    [strategy]
  );

  logEvent('INFO', 'Configurações ativas encontradas', { count: r.rows.length, strategy });
  for (const cfg of r.rows) {
    const signalId = String(signal.id || signal.signalId || (strategy + ':' + signal.symbol + ':' + signal.side + ':' + Date.now()));
    const ins = await db.query(
      `INSERT INTO tv_copy_events(copy_config_id,signal_id,strategy_key,symbol,side,quantity_pct)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(copy_config_id,signal_id) DO NOTHING
       RETURNING id`,
      [cfg.id, signalId, strategy, String(signal.symbol || '').toUpperCase(), String(signal.side || '').toUpperCase(), n(signal.quantityPercent ?? 100)]
    );
    if (!ins.rows.length) {
      logEvent('INFO', 'Sinal já processado anteriormente', { configId: cfg.id, signalId });
      continue;
    }

    logEvent('EXEC', 'Enviando sinal para a Binance', {
      configId: cfg.id,
      accountId: cfg.account_id,
      symbol: signal.symbol,
      side: signal.side,
      capitalUSDT: n(cfg.capital_usdt),
      allocationPct: n(cfg.allocation_pct)
    });

    try {
      const order = await executeSignal(cfg, signal);
      await db.query(
        "UPDATE tv_copy_events SET status='DONE',order_id=$1,entry_price=$2,exit_price=$3,pnl_usdt=$4,pnl_pct=$5 WHERE id=$6",
        [String(order?.orderId || ''), n(signal._result?.entryPrice), n(signal._result?.exitPrice), n(signal._result?.pnl), n(signal._result?.pnlPct), ins.rows[0].id]
      );
      logEvent('SUCCESS', 'Ordem executada na Binance', {
        configId: cfg.id,
        accountId: cfg.account_id,
        symbol: signal.symbol,
        side: signal.side,
        orderId: String(order?.orderId || '')
      });
    } catch (e) {
      await db.query(
        "UPDATE tv_copy_events SET status='ERROR',error_message=$1 WHERE id=$2",
        [String(e.message || e), ins.rows[0].id]
      );
      logEvent('ERROR', 'Falha ao executar ordem na Binance', {
        configId: cfg.id,
        accountId: cfg.account_id,
        symbol: signal.symbol,
        side: signal.side,
        error: String(e.message || e)
      });
    }
  }
}

router.get('/access', auth, async (req, res) => {
  try {
    const p = await plan(req.user.id);
    res.json({
      success: true,
      allowed: ALLOWED.has(p),
      plan: p || null,
      allowedPlans: ['profissional', 'premium']
    });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Erro ao verificar acesso.' });
  }
});

router.get('/status', auth, gate, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT c.*,a.name account_name
       FROM tv_copy_configs c
       LEFT JOIN binance_accounts a ON a.id=c.account_id
       WHERE c.user_id=$1 AND c.account_id=$2 LIMIT 1`,
      [req.user.id, Number(req.query.accountId)]
    );
    const x = r.rows[0];
    res.json({
      success: true,
      config: x ? {
        id: x.id,
        strategyKey: x.strategy_key,
        strategyName: 'TradingView',
        accountId: x.account_id,
        accountName: x.account_name,
        capitalUSDT: n(x.capital_usdt),
        allocationPct: n(x.allocation_pct),
        active: x.active
      } : null
    });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Não foi possível carregar a configuração.' });
  }
});

router.post('/start', auth, gate, async (req, res) => {
  try {
    const uid = req.user.id;
    const aid = Number(req.body?.accountId);
    const capital = n(req.body?.capitalUSDT);
    const allocation = n(req.body?.allocationPct || 100);
    const strategy = String(req.body?.strategyKey || 'CRIPTOPRO').trim() || 'CRIPTOPRO';

    if (!Number.isInteger(aid) || !(capital > 0)) {
      return res.status(400).json({ success: false, message: 'Conta Binance e capital são obrigatórios.' });
    }
    if (!(allocation > 0 && allocation <= 100)) {
      return res.status(400).json({ success: false, message: 'A alocação deve estar entre 0,01% e 100%.' });
    }
    if (!await account(uid, aid)) {
      return res.status(404).json({ success: false, message: 'Conta Binance não encontrada.' });
    }

    const r = await db.query(
      `INSERT INTO tv_copy_configs(user_id,account_id,strategy_key,capital_usdt,allocation_pct,active,updated_at)
       VALUES($1,$2,$3,$4,$5,true,NOW())
       ON CONFLICT(user_id,account_id)
       DO UPDATE SET strategy_key=EXCLUDED.strategy_key,capital_usdt=EXCLUDED.capital_usdt,
                     allocation_pct=EXCLUDED.allocation_pct,active=true,updated_at=NOW()
       RETURNING id`,
      [uid, aid, strategy, capital, allocation]
    );
    res.json({ success: true, message: 'Copy Trading do TradingView ativado.', copyConfigId: r.rows[0].id });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message || 'Não foi possível ativar o Copy Trading.' });
  }
});

router.post('/stop', auth, gate, async (req, res) => {
  try {
    await db.query(
      'UPDATE tv_copy_configs SET active=false,updated_at=NOW() WHERE user_id=$1 AND account_id=$2',
      [req.user.id, Number(req.body?.accountId)]
    );
    res.json({ success: true, message: 'Copy Trading parado.' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Não foi possível parar o Copy Trading.' });
  }
});

router.get('/events', auth, gate, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT e.id,e.strategy_key,e.symbol,e.side,e.quantity_pct,e.order_id,e.status,e.error_message,e.created_at
       FROM tv_copy_events e
       JOIN tv_copy_configs c ON c.id=e.copy_config_id
       WHERE c.user_id=$1 AND c.account_id=$2
       ORDER BY e.id DESC LIMIT 50`,
      [req.user.id, Number(req.query.accountId)]
    );
    res.json({ success: true, events: r.rows });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Não foi possível carregar o histórico.' });
  }
});

router.get('/summary', auth, gate, async (req, res) => {
  try {
    const accountId = Number(req.query.accountId);
    const cfg = await db.query('SELECT * FROM tv_copy_configs WHERE user_id=$1 AND account_id=$2 LIMIT 1',[req.user.id,accountId]);
    if (!cfg.rows.length) return res.json({success:true,active:false,summary:null,signals:[]});
    const c = cfg.rows[0];
    const ev = await db.query(`SELECT id,strategy_key,symbol,side,quantity_pct,order_id,status,error_message,created_at,entry_price,exit_price,pnl_usdt,pnl_pct
      FROM tv_copy_events WHERE copy_config_id=$1 ORDER BY id DESC LIMIT 30`,[c.id]);
    const positions = await db.query('SELECT symbol,quantity,avg_price,invested_usdt FROM tv_copy_positions WHERE copy_config_id=$1 AND quantity>0',[c.id]);
    let realized=0, wins=0, losses=0;
    for(const x of ev.rows){ const p=n(x.pnl_usdt); realized+=p; if(p>0)wins++; if(p<0)losses++; }
    const account = await account(req.user.id,accountId);
    let market='Indisponível', marketChange=0;
    if(account){
      try {
        const bc=client(account);
        const prices=await bc.prices();
        const btc=n(prices.BTCUSDT);
        if(btc>0){ market='Ativo'; marketChange=0; }
      } catch(e){}
    }
    res.json({success:true,active:Boolean(c.active),summary:{
      strategy:c.strategy_key,capitalUSDT:n(c.capital_usdt),allocationPct:n(c.allocation_pct),
      realizedPnl:realized,winCount:wins,lossCount:losses,openPositions:positions.rows.length,
      market,marketChange
    },signals:ev.rows,positions:positions.rows});
  } catch(e){ res.status(500).json({success:false,message:'Não foi possível carregar o resumo do Copy Trading.'}); }
});

/*
 * WEBHOOK TRADINGVIEW
 * Configure TRADINGVIEW_WEBHOOK_SECRET no ambiente do servidor.
 * O alerta do TradingView deve enviar JSON com:
 * {"secret":"...","id":"...","strategy":"CRIPTOPRO","symbol":"BTCUSDT","side":"BUY","quantityPercent":100}
 */
router.post('/webhook/tradingview', async (req, res) => {
  try {
    const configured = String(process.env.TRADINGVIEW_WEBHOOK_SECRET || '').trim();
    if (!configured) return res.status(503).json({ success: false, message: 'Webhook TradingView não configurado.' });

    const secret = String(req.body?.secret || req.headers['x-tradingview-secret'] || '').trim();
    if (!secret || secret !== configured) {
      return res.status(401).json({ success: false, message: 'Webhook não autorizado.' });
    }

    const side = String(req.body?.side || '').toUpperCase();
    const symbol = String(req.body?.symbol || '').toUpperCase();
    if (!symbol || !['BUY', 'SELL'].includes(side)) {
      return res.status(400).json({ success: false, message: 'Sinal inválido. Use symbol e side BUY/SELL.' });
    }

    logEvent('INFO', 'Webhook TradingView autenticado.');
    await dispatchSignal({
      id: req.body?.id,
      strategy: req.body?.strategy || 'CRIPTOPRO',
      symbol,
      side,
      quantityPercent: req.body?.quantityPercent ?? req.body?.quantity_pct ?? 100
    });

    res.json({ success: true, message: 'Sinal TradingView recebido.', logged: true });
  } catch (e) {
    console.error('[TRADINGVIEW WEBHOOK]', e);
    res.status(500).json({ success: false, message: 'Erro ao processar sinal TradingView.' });
  }
});

router.get('/logs', auth, gate, async (req, res) => {
  res.json({
    success: true,
    serverTime: new Date().toISOString(),
    provider: 'TradingView',
    webhook: '/api/copy-trading/webhook/tradingview',
    configured: Boolean(String(process.env.TRADINGVIEW_WEBHOOK_SECRET || '').trim()),
    logs: runtimeLogs.slice(0, 60)
  });
});

router.get('/webhook/status', async (req, res) => {
  res.json({
    success: true,
    provider: 'TradingView',
    configured: Boolean(String(process.env.TRADINGVIEW_WEBHOOK_SECRET || '').trim()),
    endpoint: '/api/copy-trading/webhook/tradingview'
  });
});

async function run() {
  // O Copy Trading agora é dirigido por webhooks do TradingView.
  logEvent('HEARTBEAT', 'Motor ativo. Aguardando próximo sinal do TradingView.');
  // Não há polling nem cópia de contas de usuários.
}

setInterval(() => run().catch(e => console.error('[COPY GLOBAL]', e)), 30000);
run().catch(e => console.error('[COPY START]', e));

module.exports = router;
