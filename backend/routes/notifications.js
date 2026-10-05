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
    const result = await notifications.notifyUser(req.user.id,"market","🔔 Teste de alerta","Seu CriptoPro está configurado para enviar alertas de mercado.",{url:"/dashboard.html",tag:"criptopro-test"});
    const push = result?.push || {};
    const whatsapp = result?.whatsapp || {};
    if (!push.sent && !whatsapp.sent) {
      let message = "Nenhum canal de alerta está ativo.";
      if (push.reason === "no_active_push_subscription") {
        message = "❌ Este celular ainda não está cadastrado para Push. Clique em 📲 ATIVAR NO CELULAR e permita as notificações.";
      } else if (push.reason === "push_delivery_failed") {
        message = "❌ O celular está cadastrado, mas o servidor não conseguiu entregar o Push. Veja os detalhes abaixo.";
      } else if (push.reason === "push_disabled") {
        message = "❌ As notificações Push estão desativadas nas preferências. Marque 'Notificações no celular' e clique em SALVAR NOTIFICAÇÕES.";
      } else if (push.reason === "push_not_configured") {
        message = "❌ O Push não está configurado no servidor (VAPID).";
      }
      return res.status(400).json({
        success:false,
        message,
        diagnostics:{
          push:{
            sent:!!push.sent,
            reason:push.reason || null,
            subscriptions:Number(push.subscriptions || 0),
            errors:Array.isArray(push.errors) ? push.errors.slice(0,3) : []
          }
        }
      });
    }
    return res.json({
      success:true,
      message: push.sent
        ? "✅ Teste Push enviado para este dispositivo."
        : "✅ Teste enviado pelo canal configurado.",
      diagnostics:{
        push:{
          sent:!!push.sent,
          subscriptions:Number(push.subscriptions || 0),
          reason:push.reason || null
        }
      }
    });
  } catch (error) {
    console.error("NOTIFICATION TEST:",error);
    return res.status(500).json({success:false,message:"Não foi possível enviar o teste."});
  }
});

module.exports = router;
