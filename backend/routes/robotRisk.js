const express = require("express");
const crypto = require("crypto");
const db = require("../services/db");
const authMiddleware = require("../middleware/auth");
const robotEngine = require("../services/robotEngine");

const router = express.Router();
const TERM_VERSION = "1.1";

function robotIdFrom(req) {
  const raw = req.body?.robotId ?? req.query?.robotId ?? 1;
  const id = Number(raw);
  return Number.isInteger(id) && id >= 1 && id <= 5 ? id : 1;
}

function accountIdFrom(req) {
  return String(req.body?.accountId ?? req.query?.account ?? "").trim();
}

function getClientIp(req) {
  return String(
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    ""
  ).slice(0,120);
}

function buildConfigSignature(config) {
  const payload = {
    id: config?.id || null,
    robot_id: Number(config?.robot_id || 1),
    strategy_version: String(config?.strategy_version || ""),
    entry_percent: Number(config?.entry_percent || 0),
    take_profit: Number(config?.take_profit || 0),
    stop_loss: Number(config?.stop_loss || 0),
    stop_loss_active: Boolean(config?.stop_loss_active),
    max_operations: Number(config?.max_operations || 0),
    interval: String(config?.interval || ""),
    max_coins: Number(config?.max_coins || 0)
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function ensureRiskTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS robot_risk_acceptances (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      robot_id INTEGER NOT NULL DEFAULT 1,
      robot_config_id BIGINT,
      term_version VARCHAR(20) NOT NULL,
      config_signature VARCHAR(128) NOT NULL,
      accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ip_address VARCHAR(120),
      user_agent TEXT
    );
    ALTER TABLE robot_risk_acceptances
      ADD COLUMN IF NOT EXISTS robot_id INTEGER NOT NULL DEFAULT 1;
    CREATE INDEX IF NOT EXISTS idx_robot_risk_user_account_robot
      ON robot_risk_acceptances(user_id,account_id,robot_id,accepted_at DESC);
  `);
}

async function getAccount(userId,accountId) {
  const r=await db.query(
    `SELECT id,user_id,active FROM binance_accounts WHERE id=$1 AND user_id=$2`,
    [accountId,userId]
  );
  return r.rows[0]||null;
}

async function currentConfig(userId,accountId,robotId) {
  return robotEngine.getConfig(userId,accountId,robotId);
}

async function hasAcceptance(userId,accountId,robotId,config) {
  if(!config) return false;
  const signature=buildConfigSignature(config);
  const r=await db.query(
    `SELECT id,accepted_at,term_version
       FROM robot_risk_acceptances
      WHERE user_id=$1 AND account_id=$2 AND robot_id=$3
        AND robot_config_id=$4 AND term_version=$5 AND config_signature=$6
      ORDER BY accepted_at DESC LIMIT 1`,
    [userId,accountId,robotId,config.id,TERM_VERSION,signature]
  );
  return r.rows[0]||null;
}

router.post("/accept", authMiddleware, async (req,res)=>{
  try{
    await ensureRiskTable();
    const accountId=accountIdFrom(req);
    const robotId=robotIdFrom(req);
    if(!accountId) return res.status(400).json({success:false,message:"Conta Binance não informada."});

    const account=await getAccount(req.user.id,accountId);
    if(!account) return res.status(404).json({success:false,message:"Conta Binance não encontrada."});

    const config=await currentConfig(req.user.id,accountId,robotId);
    if(!config) return res.status(400).json({success:false,message:"Salve a configuração deste robô antes de aceitar o termo."});

    const signature=buildConfigSignature(config);
    const result=await db.query(
      `INSERT INTO robot_risk_acceptances
       (user_id,account_id,robot_id,robot_config_id,term_version,config_signature,accepted_at,ip_address,user_agent)
       VALUES($1,$2,$3,$4,$5,$6,NOW(),$7,$8)
       RETURNING id,accepted_at`,
      [
        req.user.id,accountId,robotId,config.id,TERM_VERSION,signature,
        getClientIp(req),String(req.headers["user-agent"]||"").slice(0,1000)
      ]
    );

    return res.json({
      success:true,
      robotId,
      configId:config.id,
      termVersion:TERM_VERSION,
      acceptanceId:result.rows[0].id,
      acceptedAt:result.rows[0].accepted_at
    });
  }catch(error){
    console.error("ROBOT RISK ACCEPT:",error);
    return res.status(500).json({success:false,message:error.message||"Não foi possível registrar o termo."});
  }
});

router.get("/status", authMiddleware, async (req,res)=>{
  try{
    await ensureRiskTable();
    const accountId=accountIdFrom(req);
    const robotId=robotIdFrom(req);
    if(!accountId) return res.status(400).json({success:false,message:"Conta Binance não informada."});
    const config=await currentConfig(req.user.id,accountId,robotId);
    const acceptance=await hasAcceptance(req.user.id,accountId,robotId,config);
    return res.json({
      success:true,
      robotId,
      configId:config?.id||null,
      accepted:!!acceptance,
      acceptance:acceptance||null,
      termVersion:TERM_VERSION
    });
  }catch(error){
    console.error("ROBOT RISK STATUS:",error);
    return res.status(500).json({success:false,message:error.message||"Não foi possível consultar o termo."});
  }
});

async function riskMiddleware(req,res,next){
  try{
    await ensureRiskTable();
    const accountId=accountIdFrom(req);
    const robotId=robotIdFrom(req);
    if(!accountId) return res.status(400).json({success:false,message:"Conta Binance não informada."});

    const config=await currentConfig(req.user.id,accountId,robotId);
    if(!config) return res.status(400).json({success:false,message:"Salve a configuração deste robô antes de iniciar."});

    const acceptance=await hasAcceptance(req.user.id,accountId,robotId,config);
    if(!acceptance) return res.status(403).json({success:false,message:"É necessário aceitar o Termo de Responsabilidade deste robô antes de iniciar.",robotId,configId:config.id});

    req.robotId=robotId;
    req.robotConfig=config;
    return next();
  }catch(error){
    console.error("ROBOT RISK MIDDLEWARE:",error);
    return res.status(500).json({success:false,message:error.message||"Não foi possível validar o termo."});
  }
}

module.exports={router,riskMiddleware};
