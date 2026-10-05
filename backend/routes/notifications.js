const express = require("express");
const authMiddleware = require("../middleware/auth");
const notifications = require("../services/notificationService");

const router = express.Router();

router.get("/vapid-public-key", authMiddleware, async (req,res) => {
  if (!process.env.VAPID_PUBLIC_KEY) return res.status(503).json({success:false,message:"Push ainda não configurado no servidor."});
  return res.json({success:true,publicKey:process.env.VAPID_PUBLIC_KEY});
});

router.get("/preferences", authMiddleware, async (req,res) => {
  try {
    await notifications.ensureSchema();
    const preferences = await notifications.getPreferences(req.user.id);
    return res.json({success:true,preferences});
  } catch (error) {
    console.error("NOTIFICATIONS PREF GET:",error);
    return res.status(500).json({success:false,message:"Não foi possível carregar as notificações."});
  }
});

router.put("/preferences", authMiddleware, async (req,res) => {
  try {
    await notifications.ensureSchema();
    const preferences = await notifications.updatePreferences(req.user.id, req.body || {});
    return res.json({success:true,message:"Preferências de notificações salvas.",preferences});
  } catch (error) {
    console.error("NOTIFICATIONS PREF PUT:",error);
    return res.status(500).json({success:false,message:"Não foi possível salvar as notificações."});
  }
});

router.post("/push/subscribe", authMiddleware, async (req,res) => {
  try {
    await notifications.ensureSchema();
    await notifications.savePushSubscription(req.user.id, req.body?.subscription);
    return res.json({success:true,message:"Notificações do celular ativadas."});
  } catch (error) {
    console.error("PUSH SUBSCRIBE:",error);
    return res.status(400).json({success:false,message:error.message || "Não foi possível ativar as notificações."});
  }
});

router.post("/push/unsubscribe", authMiddleware, async (req,res) => {
  try {
    await notifications.ensureSchema();
    await notifications.removePushSubscription(req.user.id, req.body?.endpoint);
    return res.json({success:true});
  } catch (error) {
    console.error("PUSH UNSUBSCRIBE:",error);
    return res.status(500).json({success:false,message:"Não foi possível desativar as notificações."});
  }
});

router.post("/test", authMiddleware, async (req,res) => {
  try {
    await notifications.ensureSchema();

    let body = "🤖 Robô: ativo | 📊 Mercado: monitorando | 📈 BTC: consulte o painel para detalhes.";
    try {
      const db = require("../services/db");
      const result = await db.query("SELECT DISTINCT user_id FROM push_subscriptions WHERE user_id=$1", [req.user.id]);
      if (!result.rows.length) {
        return res.status(400).json({
          success:false,
          message:"❌ Este celular ainda não está cadastrado para Push. Clique em 📲 ATIVAR NO CELULAR."
        });
      }
    } catch(e) {}

    const result = await notifications.notifyUser(
      req.user.id,
      "market",
      "🔔 Resumo CriptoPro — TESTE",
      body,
      {url:"/index.html",tag:"criptopro-resumo-teste",urgency:"normal"}
    );

    const push = result?.push || {};
    if (!push.sent) {
      return res.status(400).json({
        success:false,
        message:"❌ Não foi possível enviar o resumo de teste.",
        diagnostics:{push}
      });
    }

    return res.json({
      success:true,
      message:"✅ Resumo de teste enviado para o celular.",
      diagnostics:{push}
    });
  } catch (error) {
    console.error("NOTIFICATION TEST:",error);
    return res.status(500).json({success:false,message:"Não foi possível enviar o teste."});
  }
});

module.exports = router;
