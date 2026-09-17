const express = require("express");
const db = require("../services/db");
const authMiddleware = require("../middleware/auth");
const robotEngine = require("../services/robotEngine");

const router = express.Router();

function robotIdFrom(req) {
  const raw = req.body?.robotId ?? req.query?.robotId ?? 1;
  const id = Number(raw);
  return Number.isInteger(id) && id >= 1 && id <= 5 ? id : 1;
}

function accountIdFrom(req) {
  return String(req.body?.accountId ?? req.query?.account ?? "").trim();
}

router.get("/instances", authMiddleware, async (req,res) => {
  try {
    const accountId = accountIdFrom(req);
    if (!accountId) return res.status(400).json({success:false,message:"Conta Binance não informada."});

    const account = await db.query(
      `SELECT id FROM binance_accounts WHERE id=$1 AND user_id=$2 AND active=true`,
      [accountId, req.user.id]
    );
    if (!account.rows.length) return res.status(404).json({success:false,message:"Conta Binance não encontrada."});

    return res.json(await robotEngine.listRobots(req.user.id, accountId));
  } catch (error) {
    console.error("ROBOT INSTANCES:", error);
    return res.status(500).json({success:false,message:error.message||"Não foi possível carregar os robôs."});
  }
});

router.get("/status", authMiddleware, async (req,res) => {
  try {
    const accountId = accountIdFrom(req);
    if (!accountId) return res.status(400).json({success:false,message:"Conta Binance não informada."});
    const robotId = robotIdFrom(req);
    return res.json(await robotEngine.getStatus(req.user.id, accountId, robotId));
  } catch (error) {
    console.error("ROBOT STATUS:", error);
    return res.status(500).json({success:false,message:error.message||"Não foi possível consultar o robô."});
  }
});

router.post("/config", authMiddleware, async (req,res) => {
  try {
    const accountId = accountIdFrom(req);
    if (!accountId) return res.status(400).json({success:false,message:"Conta Binance não informada."});
    const robotId = robotIdFrom(req);

    const c = {
      entryPercent: Number(req.body?.entryPercent),
      takeProfit: Number(req.body?.takeProfit),
      stopLoss: Number(req.body?.stopLoss),
      stopLossActive: req.body?.stopLossActive === true || req.body?.stopLossActive === "true",
      maxOperations: Number(req.body?.maxOperations),
      interval: String(req.body?.interval || "15m"),
      maxCoins: Number(req.body?.maxCoins),
      strategyVersion: String(req.body?.strategyVersion || "premium").toLowerCase()
    };

    const config = await robotEngine.saveConfig(req.user.id, accountId, c, robotId);

    return res.json({
      success:true,
      message:`Configuração salva para o Robô ${robotId}.`,
      configId:config.id,
      robotId,
      config
    });
  } catch (error) {
    console.error("ROBOT CONFIG:", error);
    return res.status(400).json({success:false,message:error.message||"Não foi possível salvar a configuração."});
  }
});

router.post("/start", authMiddleware, async (req,res) => {
  try {
    const accountId = accountIdFrom(req);
    if (!accountId) return res.status(400).json({success:false,message:"Conta Binance não informada."});
    const robotId = Number(req.robotId || robotIdFrom(req));
    const status = await robotEngine.start(req.user.id, accountId, robotId);
    return res.json({success:true,message:`Robô ${robotId} iniciado.`,robotId,...status});
  } catch (error) {
    console.error("ROBOT START:", error);
    return res.status(400).json({success:false,message:error.message||"Não foi possível iniciar o robô."});
  }
});

router.post("/stop", authMiddleware, async (req,res) => {
  try {
    const accountId = accountIdFrom(req);
    if (!accountId) return res.status(400).json({success:false,message:"Conta Binance não informada."});
    const robotId = robotIdFrom(req);
    const status = await robotEngine.stop(req.user.id, accountId, robotId);
    return res.json({success:true,message:`Robô ${robotId} parado.`,robotId,...status});
  } catch (error) {
    console.error("ROBOT STOP:", error);
    return res.status(400).json({success:false,message:error.message||"Não foi possível parar o robô."});
  }
});

module.exports = router;
