const express = require("express");
const db = require("../services/db");
const authMiddleware = require("../middleware/auth");

const router = express.Router();

function isAdmin(req) {
  const adminId = String(process.env.ADMIN_USER_ID || "").trim();
  const userId = String(req.user?.id || req.user?.userId || "").trim();
  return !!adminId && !!userId && adminId === userId;
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) {
    return res.status(403).json({
      success: false,
      message: "Acesso administrativo não autorizado."
    });
  }
  next();
}

const money = v => Number(v || 0);

router.get("/dashboard", authMiddleware, requireAdmin, async (req, res) => {
  try {
    const [usersQ, subsQ, robotsQ, accountsQ, plansQ, usersListQ] =
      await Promise.all([
        db.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE active = true)::int AS active, COUNT(*) FILTER (WHERE active = false)::int AS inactive FROM users`),
        db.query(`SELECT COUNT(*) FILTER (WHERE status = 'ACTIVE' AND (expires_at IS NULL OR expires_at > NOW()))::int AS active, COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending, COUNT(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled, COUNT(*) FILTER (WHERE status = 'EXPIRED')::int AS expired, COALESCE(SUM(CASE WHEN status = 'ACTIVE' AND (expires_at IS NULL OR expires_at > NOW()) THEN amount ELSE 0 END),0)::numeric AS monthly_active_value FROM subscriptions`),
        db.query(`SELECT COUNT(*)::int AS configured, COUNT(*) FILTER (WHERE running = true)::int AS running FROM robot_configs`),
        db.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE active = true)::int AS active FROM binance_accounts`),
        db.query(`SELECT plan, COUNT(*) FILTER (WHERE status = 'ACTIVE' AND (expires_at IS NULL OR expires_at > NOW()))::int AS active, COALESCE(SUM(CASE WHEN status = 'ACTIVE' AND (expires_at IS NULL OR expires_at > NOW()) THEN amount ELSE 0 END),0)::numeric AS monthly_value FROM subscriptions GROUP BY plan ORDER BY CASE plan WHEN 'premium' THEN 1 WHEN 'profissional' THEN 2 WHEN 'basico' THEN 3 ELSE 4 END`),
        db.query(`SELECT u.id,u.name,u.email,u.active,s.id AS subscription_id,s.plan,s.status,s.amount,s.payment_provider,s.payment_method,s.started_at,s.expires_at,s.created_at AS subscription_created_at FROM users u LEFT JOIN LATERAL (SELECT * FROM subscriptions WHERE user_id=u.id ORDER BY id DESC LIMIT 1) s ON true ORDER BY u.id DESC`)
      ]);

    const users = usersQ.rows[0] || {};
    const subs = subsQ.rows[0] || {};
    const robots = robotsQ.rows[0] || {};
    const accounts = accountsQ.rows[0] || {};
    const planNames = { basico:"Básico", profissional:"Profissional", premium:"Premium" };

    res.json({
      success:true,
      generatedAt:new Date().toISOString(),
      resumo:{
        usuariosTotal:Number(users.total||0),
        usuariosAtivos:Number(users.active||0),
        usuariosInativos:Number(users.inactive||0),
        assinaturasAtivas:Number(subs.active||0),
        pagamentosPendentes:Number(subs.pending||0),
        assinaturasCanceladas:Number(subs.cancelled||0),
        assinaturasExpiradas:Number(subs.expired||0),
        receitaMensalAtiva:money(subs.monthly_active_value),
        robosConfigurados:Number(robots.configured||0),
        robosRodando:Number(robots.running||0),
        apisBinanceTotal:Number(accounts.total||0),
        apisBinanceAtivas:Number(accounts.active||0)
      },
      planos:plansQ.rows.map(p=>({
        codigo:p.plan,
        nome:planNames[p.plan]||p.plan||"—",
        usuariosAtivos:Number(p.active||0),
        receitaMensal:money(p.monthly_value)
      })),
      usuarios:usersListQ.rows.map(u=>({
        id:u.id,
        nome:u.name||"—",
        email:u.email||"—",
        contaAtiva:u.active!==false,
        assinaturaId:u.subscription_id||null,
        plano:planNames[u.plan]||u.plan||"Sem plano",
        status:u.status||"SEM ASSINATURA",
        valor:money(u.amount),
        provedor:u.payment_provider||"—",
        metodo:u.payment_method||"—",
        inicio:u.started_at||null,
        vencimento:u.expires_at||null,
        assinaturaCriadaEm:u.subscription_created_at||null
      }))
    });
  } catch(error) {
    console.error("ERRO PAINEL ADMIN:",error);
    res.status(500).json({success:false,message:"Erro interno ao carregar o painel administrativo."});
  }
});

router.get("/teste", authMiddleware, requireAdmin, (req,res)=>{
  res.json({success:true,admin:true,userId:String(req.user?.id||req.user?.userId||"")});
});

module.exports=router;
