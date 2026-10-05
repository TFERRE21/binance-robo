const db = require("./db");

let webpush = null;
try {
  webpush = require("web-push");
} catch (e) {
  console.warn("[NOTIFICATIONS] web-push ainda não disponível.");
}

function cleanPhone(value) {
  let n = String(value || "").replace(/\D/g, "");
  if (!n) return "";
  if (n.startsWith("00")) n = n.slice(2);
  if (!n.startsWith("55") && (n.length === 10 || n.length === 11)) n = "55" + n;
  return n;
}

function pushConfigured() {
  return !!(
    webpush &&
    process.env.VAPID_SUBJECT &&
    process.env.VAPID_PUBLIC_KEY &&
    process.env.VAPID_PRIVATE_KEY
  );
}

function configurePush() {
  if (pushConfigured()) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT,
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
  }
}

async function ensureSchema() {
  await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp VARCHAR(30)");
  await db.query(
    "CREATE TABLE IF NOT EXISTS notification_preferences (user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, whatsapp_enabled BOOLEAN NOT NULL DEFAULT TRUE, push_enabled BOOLEAN NOT NULL DEFAULT TRUE, buy_alert BOOLEAN NOT NULL DEFAULT TRUE, sell_alert BOOLEAN NOT NULL DEFAULT TRUE, market_alert BOOLEAN NOT NULL DEFAULT TRUE, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())"
  );
  await db.query(
    "CREATE TABLE IF NOT EXISTS push_subscriptions (id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, endpoint TEXT NOT NULL UNIQUE, subscription_json JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())"
  );
  configurePush();
}

async function getPreferences(userId) {
  const r = await db.query(
    "SELECT u.whatsapp, COALESCE(p.whatsapp_enabled, TRUE) AS whatsapp_enabled, COALESCE(p.push_enabled, TRUE) AS push_enabled, COALESCE(p.buy_alert, TRUE) AS buy_alert, COALESCE(p.sell_alert, TRUE) AS sell_alert, COALESCE(p.market_alert, TRUE) AS market_alert FROM users u LEFT JOIN notification_preferences p ON p.user_id=u.id WHERE u.id=$1",
    [userId]
  );
  return r.rows[0] || null;
}

async function updatePreferences(userId, data) {
  const hasWhatsapp = Object.prototype.hasOwnProperty.call(data || {}, "whatsapp");
  const whatsapp = hasWhatsapp ? cleanPhone(data.whatsapp) : null;
  if (hasWhatsapp) {
    await db.query(
      "UPDATE users SET whatsapp=$1, updated_at=NOW() WHERE id=$2",
      [whatsapp || null, userId]
    );
  }

  const r = await db.query(
    "INSERT INTO notification_preferences (user_id,whatsapp_enabled,push_enabled,buy_alert,sell_alert,market_alert,updated_at) VALUES($1,$2,$3,$4,$5,$6,NOW()) ON CONFLICT(user_id) DO UPDATE SET whatsapp_enabled=EXCLUDED.whatsapp_enabled,push_enabled=EXCLUDED.push_enabled,buy_alert=EXCLUDED.buy_alert,sell_alert=EXCLUDED.sell_alert,market_alert=EXCLUDED.market_alert,updated_at=NOW() RETURNING *",
    [
      userId,
      data.whatsappEnabled !== false,
      data.pushEnabled !== false,
      data.buyAlert !== false,
      data.sellAlert !== false,
      data.marketAlert !== false
    ]
  );

  return { ...r.rows[0], whatsapp: hasWhatsapp ? whatsapp : null };
}

async function savePushSubscription(userId, subscription) {
  if (!subscription || !subscription.endpoint) {
    throw new Error("Assinatura push inválida.");
  }

  await db.query(
    "INSERT INTO push_subscriptions(user_id,endpoint,subscription_json,updated_at) VALUES($1,$2,$3,NOW()) ON CONFLICT(endpoint) DO UPDATE SET user_id=EXCLUDED.user_id,subscription_json=EXCLUDED.subscription_json,updated_at=NOW()",
    [userId, subscription.endpoint, JSON.stringify(subscription)]
  );

  return { success: true };
}

async function removePushSubscription(userId, endpoint) {
  await db.query(
    "DELETE FROM push_subscriptions WHERE user_id=$1 AND endpoint=$2",
    [userId, endpoint]
  );
}

async function sendPush(userId, payload) {
  if (!pushConfigured()) {
    return { sent: false, reason: "push_not_configured" };
  }

  const pref = await getPreferences(userId);
  if (!pref || !pref.push_enabled) {
    return { sent: false, reason: "push_disabled" };
  }

  const r = await db.query(
    "SELECT id,endpoint,subscription_json FROM push_subscriptions WHERE user_id=$1",
    [userId]
  );

  let sent = 0;
  const errors = [];

  for (const row of r.rows) {
    try {
      await webpush.sendNotification(
        row.subscription_json,
        JSON.stringify({
          title: payload.title,
          body: payload.body,
          icon: "/favicon.ico",
          badge: "/favicon.ico",
          url: payload.url || "/dashboard.html",
          tag: payload.tag || "criptopro-alert"
        }),
        {
          TTL: 300,
          urgency: payload.urgency || "high"
        }
      );
      sent++;
    } catch (e) {
      const status = Number(e.statusCode || 0);
      const message = String(e.message || e);
      if (status === 404 || status === 410) {
        await db.query("DELETE FROM push_subscriptions WHERE id=$1", [row.id]);
        errors.push({status, reason:"subscription_expired"});
      } else {
        console.error("[PUSH] erro:", message);
        errors.push({status, reason:"provider_error", message});
      }
    }
  }

  return {
    sent: sent > 0,
    count: sent,
    subscriptions: r.rows.length,
    reason: sent > 0 ? null : (r.rows.length ? "push_delivery_failed" : "no_active_push_subscription"),
    errors
  };
}

async function sendWhatsApp(userId, payload) {
  const pref = await getPreferences(userId);

  if (!pref || !pref.whatsapp_enabled || !pref.whatsapp) {
    return { sent: false, reason: "whatsapp_disabled_or_missing" };
  }

  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneId) {
    return { sent: false, reason: "whatsapp_not_configured" };
  }

  const to = cleanPhone(pref.whatsapp);
  if (!to) {
    return { sent: false, reason: "invalid_whatsapp" };
  }

  const templateName = process.env.WHATSAPP_TEMPLATE_NAME;
  const templateLanguage =
    process.env.WHATSAPP_TEMPLATE_LANGUAGE || "pt_BR";
  const bodyText = String(payload.body || "").slice(0, 3500);

  const message = templateName
    ? {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: templateLanguage },
          components: [
            {
              type: "body",
              parameters: [
                {
                  type: "text",
                  text: String(payload.title || "CriptoPro")
                },
                {
                  type: "text",
                  text: bodyText
                }
              ]
            }
          ]
        }
      }
    : {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: {
          preview_url: false,
          body: String(payload.title || "CriptoPro") + "\n\n" + bodyText
        }
      };

  try {
    const response = await fetch(
      "https://graph.facebook.com/" +
        (process.env.WHATSAPP_GRAPH_VERSION || "v23.0") +
        "/" +
        phoneId +
        "/messages",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(message)
      }
    );

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("[WHATSAPP] erro:", result);
      return {
        sent: false,
        reason: "provider_error",
        details: result
      };
    }

    return { sent: true };
  } catch (e) {
    console.error("[WHATSAPP] erro:", e.message || e);
    return { sent: false, reason: "request_error" };
  }
}

async function notifyUser(userId, type, title, body, extra = {}) {
  const pref = await getPreferences(userId);
  if (!pref) return;

  const allowed =
    type === "buy"
      ? pref.buy_alert
      : type === "sell"
        ? pref.sell_alert
        : type === "market"
          ? pref.market_alert
          : true;

  if (!allowed) return;

  const payload = {
    title,
    body,
    url: extra.url || "/dashboard.html",
    tag: extra.tag || "criptopro-" + type,
    urgency: extra.urgency || "high"
  };

  const results = await Promise.allSettled([
    sendPush(userId, payload),
    sendWhatsApp(userId, payload)
  ]);

  const push = results[0]?.status === "fulfilled" ? (results[0].value || {}) : { sent:false, reason:"push_error" };
  const whatsapp = results[1]?.status === "fulfilled" ? (results[1].value || {}) : { sent:false, reason:"whatsapp_error" };

  return { push, whatsapp };
}

module.exports = {
  ensureSchema,
  getPreferences,
  updatePreferences,
  savePushSubscription,
  removePushSubscription,
  sendPush,
  sendWhatsApp,
  notifyUser,
  cleanPhone
};
