const express = require("express");
const authMiddleware = require("../middleware/auth");
const notifications = require("../services/notificationService");
const robotEngine = require("../services/robotEngine");

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

    const resumo = await robotEngine.getNotificationSummary(req.user.id);

    const moedas = resumo.open.length
      ? resumo.open.slice(0,6).map(o=>{
          const s=o.pnlUsdt>=0?"+":"-";
          return o.symbol+" "+s+"US$ "+Math.abs(o.pnlUsdt).toFixed(2);
        }).join(" | ")
      : "Nenhuma moeda em operação";

    const body =
      "🤖 Robô: "+(resumo.openCount>0?"OPERANDO":"ATIVO")+
      "\n💰 Saldo: R$ "+resumo.totalBrl.toFixed(2)+" | US$ "+resumo.totalUsdt.toFixed(2)+
      "\n📊 Resultado 24h: "+(resumo.combined24h>=0?"+":"-")+"US$ "+Math.abs(resumo.combined24h).toFixed(2)+
      " | Operações abertas: "+resumo.openCount+
      "\n🪙 Compradas: "+moedas+
      "\n💵 Realizado 24h: "+(resumo.realized24h>=0?"+":"-")+"US$ "+Math.abs(resumo.realized24h).toFixed(2)+
      " | P/L aberto: "+(resumo.unrealized>=0?"+":"-")+"US$ "+Math.abs(resumo.unrealized).toFixed(2);

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
      message:"✅ Resumo completo de teste enviado para o celular.",
      diagnostics:{push}
    });
  } catch (error) {
    console.error("NOTIFICATION TEST:",error);
    return res.status(500).json({success:false,message:"Não foi possível gerar o resumo de teste: "+(error.message||"erro")});
  }
});

module.exports = router;
