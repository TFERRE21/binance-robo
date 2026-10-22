const token = localStorage.getItem("token");

const userInfo =
  document.getElementById("userInfo");

const accountsContainer =
  document.getElementById("accounts");

const logoutButton =
  document.getElementById("logoutButton");


// Acesso rápido às notificações no cabeçalho.
// Criado via JS também para funcionar mesmo quando o navegador estiver usando
// uma versão antiga do HTML em cache.
function ensureNotificationsTopButton() {
  if (document.getElementById("notificationsTopButton")) return;
  const support = document.getElementById("supportTicketsButton");
  if (!support || !support.parentElement) return;

  const button = document.createElement("button");
  button.id = "notificationsTopButton";
  button.type = "button";
  button.className = "btn-login";
  button.style.marginRight = "10px";
  button.textContent = "🔔 Notificações";
  button.addEventListener("click", () => {
    const card = document.getElementById("notificationsCard");
    if (card) {
      card.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      alert("O painel de notificações ainda não foi carregado. Atualize a página.");
    }
  });
  support.insertAdjacentElement("afterend", button);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", ensureNotificationsTopButton);
} else {
  ensureNotificationsTopButton();
}

const showAddAccountButton =
  document.getElementById("showAddAccountButton");

const addAccountSection =
  document.getElementById("addAccountSection");

const addAccountForm =
  document.getElementById("addAccountForm");

const cancelAddAccountButton =
  document.getElementById("cancelAddAccountButton");

const accountMessage =
  document.getElementById("accountMessage");

const openPanelButton =
  document.getElementById("openPanelButton");

const totalBalance =
  document.getElementById("totalBalance");

const availableBalance =
  document.getElementById("availableBalance");

const lockedBalance =
  document.getElementById("lockedBalance");


// =========================================================
// VERIFICAR LOGIN
// =========================================================

if (!token) {
  window.location.href = "login.html";
}


// =========================================================
// CARREGAR USUÁRIO
// =========================================================

async function loadUser() {

  try {

    const response = await fetch(
      "/api/auth/me",
      {
        headers: {
          "Authorization": `Bearer ${token}`
        }
      }
    );

    const data = await response.json();

    if (!response.ok || !data.success) {

      localStorage.removeItem("token");

      window.location.href = "login.html";

      return;
    }

    userInfo.textContent =
      `Olá, ${data.user.name}! (${data.user.email})`;

  } catch (error) {

    console.error(error);

    userInfo.textContent =
      "Erro ao carregar usuário.";
  }
}


// =========================================================
// FORMATAR USDT
// =========================================================

function formatUSDT(value) {

  return Number(value).toLocaleString(
    "pt-BR",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 8
    }
  ) + " USDT";
}


// =========================================================
// CARREGAR SALDO
// =========================================================

async function loadBalance(accountId) {

  if (
    !totalBalance ||
    !availableBalance ||
    !lockedBalance
  ) {

    return;
  }

  totalBalance.textContent =
    "Carregando...";

  availableBalance.textContent =
    "Carregando...";

  lockedBalance.textContent =
    "Carregando...";


  try {

    const response = await fetch(
      `/api/binance/accounts/${accountId}/balance`,
      {
        headers: {
          "Authorization":
            `Bearer ${token}`
        }
      }
    );


    const data =
      await response.json();


    if (!response.ok || !data.success) {

      totalBalance.textContent =
        "Indisponível";

      availableBalance.textContent =
        "Indisponível";

      lockedBalance.textContent =
        "Indisponível";

      console.error(
        "ERRO AO CARREGAR SALDO:",
        data.message
      );

      return;
    }


    totalBalance.textContent =
      formatUSDT(
        data.balance.total
      );


    availableBalance.textContent =
      formatUSDT(
        data.balance.available
      );


    lockedBalance.textContent =
      formatUSDT(
        data.balance.locked
      );


  } catch (error) {

    console.error(
      "ERRO AO CONSULTAR SALDO:",
      error
    );


    totalBalance.textContent =
      "Indisponível";

    availableBalance.textContent =
      "Indisponível";

    lockedBalance.textContent =
      "Indisponível";
  }
}


// =========================================================
// CARREGAR CONTAS
// =========================================================

async function loadAccounts() {

  try {

    const response = await fetch(
      "/api/binance/accounts",
      {
        headers: {
          "Authorization":
            `Bearer ${token}`
        }
      }
    );


    const data =
      await response.json();


    if (!response.ok || !data.success) {

      accountsContainer.textContent =
        data.message ||
        "Erro ao carregar contas.";

      return;
    }


    if (
      !data.accounts ||
      data.accounts.length === 0
    ) {

      const emptyCard = document.createElement("div");
      emptyCard.className = "account-card";
      const emptyTitle = document.createElement("h3");
      emptyTitle.textContent = "Nenhuma conta Binance cadastrada";
      const emptyText = document.createElement("p");
      emptyText.textContent = "Adicione sua conta Binance para começar.";
      emptyCard.append(emptyTitle, emptyText);
      accountsContainer.replaceChildren(emptyCard);

      return;
    }


    accountsContainer.replaceChildren();


    data.accounts.forEach(
      (account) => {

        const div =
          document.createElement("div");


        div.className =
          "account-card";


        const title = document.createElement("h3");
        title.textContent = String(account.name || "Conta Binance");

        const status = document.createElement("p");
        status.append(document.createTextNode("Status: "));
        const statusValue = document.createElement("strong");
        statusValue.textContent = account.active ? "🟢 Ativa" : "🔴 Inativa";
        status.appendChild(statusValue);

        const message = document.createElement("div");
        message.id = "connection-message-" + String(account.id);
        message.className = "message";
        message.style.display = "none";

        const actions = document.createElement("div");
        actions.style.cssText = "display:flex;gap:10px;flex-wrap:wrap;margin-top:16px;";

        const openButton = document.createElement("button");
        openButton.type = "button";
        openButton.className = "btn-login open-account-panel-button";
        openButton.dataset.accountId = String(account.id);
        openButton.textContent = "ABRIR PAINEL";

        const testButton = document.createElement("button");
        testButton.type = "button";
        testButton.className = "btn-logout test-binance-button";
        testButton.dataset.accountId = String(account.id);
        testButton.textContent = "Testar conexão";

        actions.append(openButton, testButton);
        div.append(title, status, message, actions);


        accountsContainer.appendChild(div);

      }
    );


    // =====================================================
    // TESTAR CONEXÃO
    // =====================================================

    document
      .querySelectorAll(
        ".test-binance-button"
      )
      .forEach(
        (button) => {

          button.addEventListener(
            "click",
            () => {

              const accountId =
                button.getAttribute(
                  "data-account-id"
                );


              const messageElement =
                document.getElementById(
                  `connection-message-${accountId}`
                );


              testBinanceConnection(
                accountId,
                messageElement
              );

            }
          );

        }
      );


    // =====================================================
    // ABRIR PAINEL INDIVIDUAL
    // =====================================================

    document
      .querySelectorAll(
        ".open-account-panel-button"
      )
      .forEach(
        (button) => {

          button.addEventListener(
            "click",
            () => {

              const accountId =
                button.getAttribute(
                  "data-account-id"
                );


              openAccountPanel(
                accountId
              );

            }
          );

        }
      );


    // =====================================================
    // USAR A PRIMEIRA CONTA PARA O SALDO
    // =====================================================

    const primeiraConta =
      data.accounts[0];


    await loadBalance(
      primeiraConta.id
    );

    await loadQuickResults(
      primeiraConta.id
    );

  } catch (error) {

    console.error(error);

    accountsContainer.textContent =
      "Erro de conexão com o servidor.";
  }
}


// =========================================================
// TESTAR CONEXÃO E PERMISSÕES
// =========================================================

async function testBinanceConnection(
  accountId,
  messageElement
) {

  messageElement.textContent =
    "Verificando conexão e permissões...";

  messageElement.className =
    "message success";

  messageElement.style.display =
    "block";


  try {

    const response = await fetch(
      `/api/binance/accounts/${accountId}/test`,
      {
        headers: {
          "Authorization":
            `Bearer ${token}`
        }
      }
    );


    const data =
      await response.json();


    if (!response.ok || !data.success) {

      messageElement.textContent =
        data.message ||
        "Não foi possível conectar à Binance.";

      messageElement.className =
        "message error";

      return;
    }


    const permissions =
      data.permissions;


    const withdrawals =
      permissions.withdrawals
        ? "ATIVADOS ⚠️"
        : "desativados ✅";


    const trading =
      permissions.spotAndMarginTrading
        ? "permitida"
        : "desativada";


    messageElement.textContent =
      "Conexão OK. Negociação: " + trading + ". Saques: " + withdrawals + ".";


    if (
      permissions.withdrawals
    ) {

      messageElement.className =
        "message error";

    } else {

      messageElement.className =
        "message success";
    }


  } catch (error) {

    console.error(error);

    messageElement.textContent =
      "Erro de conexão com o servidor.";

    messageElement.className =
      "message error";
  }
}


// =========================================================
// ABRIR PAINEL INDIVIDUAL
// =========================================================

function openAccountPanel(accountId) {

  if (!accountId) {

    alert(
      "Conta Binance não identificada."
    );

    return;
  }


  window.location.href =
    `/painel.html?account=${encodeURIComponent(accountId)}`;
}


// =========================================================
// BOTÃO PRINCIPAL ABRIR PAINEL
// =========================================================

if (openPanelButton) {

  openPanelButton.addEventListener(
    "click",
    async () => {

      try {

        const response =
          await fetch(
            "/api/binance/accounts",
            {
              headers: {
                "Authorization":
                  `Bearer ${token}`
              }
            }
          );


        const data =
          await response.json();


        if (
          !response.ok ||
          !data.success
        ) {

          alert(
            data.message ||
            "Não foi possível carregar sua conta Binance."
          );

          return;
        }


        if (
          !data.accounts ||
          data.accounts.length === 0
        ) {

          alert(
            "Cadastre uma conta Binance antes de abrir o painel."
          );

          return;
        }


        openAccountPanel(
          data.accounts[0].id
        );


      } catch (error) {

        console.error(error);

        alert(
          "Erro de conexão com o servidor."
        );
      }

    }
  );

}


// =========================================================
// MOSTRAR FORMULÁRIO
// =========================================================

if (showAddAccountButton) {

  showAddAccountButton.addEventListener(
    "click",
    () => {

      addAccountSection.style.display =
        "block";

      showAddAccountButton.style.display =
        "none";
    }
  );

}


// =========================================================
// CANCELAR CADASTRO
// =========================================================

if (cancelAddAccountButton) {

  cancelAddAccountButton.addEventListener(
    "click",
    () => {

      addAccountForm.reset();

      accountMessage.textContent =
        "";

      accountMessage.className =
        "message";

      addAccountSection.style.display =
        "none";

      showAddAccountButton.style.display =
        "block";
    }
  );

}


// =========================================================
// CADASTRAR CONTA
// =========================================================

if (addAccountForm) {

  addAccountForm.addEventListener(
    "submit",
    async (event) => {

      event.preventDefault();


      const name =
        document
          .getElementById("accountName")
          .value
          .trim();


      const apiKey =
        document
          .getElementById("apiKey")
          .value
          .trim();


      const apiSecret =
        document
          .getElementById("apiSecret")
          .value
          .trim();


      accountMessage.textContent =
        "Salvando conta...";

      accountMessage.className =
        "message success";

      accountMessage.style.display =
        "block";


      try {

        const response =
          await fetch(
            "/api/binance/accounts",
            {
              method: "POST",

              headers: {
                "Content-Type":
                  "application/json",

                "Authorization":
                  `Bearer ${token}`
              },

              body: JSON.stringify({
                name,
                apiKey,
                apiSecret
              })
            }
          );


        const data =
          await response.json();


        if (
          !response.ok ||
          !data.success
        ) {

          accountMessage.textContent =
            data.message ||
            "Não foi possível cadastrar a conta.";

          accountMessage.className =
            "message error";

          return;
        }


        accountMessage.textContent =
          "Conta Binance cadastrada com sucesso.";

        accountMessage.className =
          "message success";


        addAccountForm.reset();


        await loadAccounts();


        setTimeout(
          () => {

            addAccountSection.style.display =
              "none";

            showAddAccountButton.style.display =
              "block";

            accountMessage.textContent =
              "";

            accountMessage.className =
              "message";

            accountMessage.style.display =
              "none";

          },
          1500
        );


      } catch (error) {

        console.error(error);

        accountMessage.textContent =
          "Erro de conexão com o servidor.";

        accountMessage.className =
          "message error";

        accountMessage.style.display =
          "block";
      }

    }
  );

}


// =========================================================
// LOGOUT
// =========================================================

if (logoutButton) {

  logoutButton.addEventListener(
    "click",
    () => {

      localStorage.removeItem("token");

      window.location.href =
        "login.html";
    }
  );

}


// =========================================================
// RESULTADOS — OPERAÇÕES RÁPIDAS
// =========================================================
async function loadQuickResults(accountId) {
  const table=document.getElementById("quick20Table");
  if(!table || !accountId) return;

  try {
    const response=await fetch("/api/robot/instances?account="+encodeURIComponent(accountId),{
      headers:{"Authorization":`Bearer ${token}`},
      cache:"no-store"
    });
    const data=await response.json();
    if(!response.ok || !data.success) throw new Error(data.message||"Não foi possível carregar os resultados.");

    const ops=[];
    for(const robot of (data.robots||[])){
      if(String(robot.config?.strategy_version||"").toLowerCase()!=="rapido") continue;
      for(const op of (robot.operations||[])){
        if(String(op.status||"").toUpperCase()==="CLOSED") ops.push(op);
      }
    }

    ops.sort((a,b)=>new Date(b.closed_at||0)-new Date(a.closed_at||0));
    const last=ops.slice(0,20);
    const wins=last.filter(o=>Number(o.result_percent)>0).length;
    const pnl=last.reduce((sum,o)=>sum+Number(o.result_usdt||0),0);
    const avg=last.length?pnl/last.length:0;

    const c=document.getElementById("quick20Count");
    const w=document.getElementById("quick20Wins");
    const wr=document.getElementById("quick20WinRate");
    const p=document.getElementById("quick20Pnl");
    if(c)c.textContent=`${last.length} / 20`;
    if(w)w.textContent=String(wins);
    if(wr)wr.textContent=last.length?`${((wins/last.length)*100).toFixed(1)}%`:"—";
    if(p)p.textContent=last.length?`${pnl>=0?"+":""}${pnl.toFixed(4)} USDT (média ${avg.toFixed(4)})`:"—";

    if(!last.length){
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 5;
      cell.style.padding = "12px";
      cell.textContent = "Ainda não há 20 operações rápidas encerradas.";
      row.appendChild(cell);
      table.replaceChildren(row);
      return;
    }

    const rows = last.map(o => {
      const row = document.createElement("tr");
      row.style.borderTop = "1px solid rgba(255,255,255,.08)";
      const pct = Number(o.result_percent);
      const sign = pct >= 0 ? "+" : "";
      const values = [
        { value: String(o.symbol || "—"), style: "padding:10px;font-weight:700;" },
        { value: Number(o.buy_price || 0).toFixed(6), style: "padding:10px;text-align:right;" },
        { value: Number(o.close_price || 0).toFixed(6), style: "padding:10px;text-align:right;" },
        { value: Number.isFinite(pct) ? sign + pct.toFixed(2) + "%" : "—", style: "padding:10px;text-align:right;" },
        { value: o.close_reason === "TAKE_PROFIT" ? "TAKE PROFIT" : String(o.close_reason || "—"), style: "padding:10px;" }
      ];
      values.forEach((item, index) => {
        const cell = document.createElement("td");
        cell.style.cssText = item.style;
        cell.textContent = item.value;
        if (index === 3) cell.style.color = pct >= 0 ? "#2ee68a" : "#ff6b6b";
        row.appendChild(cell);
      });
      return row;
    });
    table.replaceChildren(...rows);
  } catch(e) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.style.padding = "12px";
    cell.textContent = e.message || "Erro ao carregar os resultados.";
    row.appendChild(cell);
    table.replaceChildren(row);
  }
}

// =========================================================
// INICIAR
// =========================================================

loadUser();

loadAccounts();


/* =========================================================
   CENTRAL DE NOTIFICAÇÕES
========================================================= */
function uint8FromBase64Url(base64) {
  const padding = "=".repeat((4 - base64.length % 4) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i=0;i<raw.length;i++) out[i]=raw.charCodeAt(i);
  return out;
}

async function notificationApi(url, options={}) {
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json"
    },
    cache:"no-store"
  });
}

async function loadNotificationPreferences() {
  const msg=document.getElementById("notificationMessage");
  try {
    const r=await notificationApi("/api/notifications/preferences");
    const d=await r.json();
    if(!r.ok || !d.success) throw new Error(d.message || "Não foi possível carregar as preferências.");
    const p=d.preferences || {};
    document.getElementById("notificationWhatsapp").value=p.whatsapp || "";
    document.getElementById("notifyPush").checked=p.push_enabled !== false;
    document.getElementById("notifyWhatsApp").checked=p.whatsapp_enabled !== false;
    document.getElementById("notifyBuy").checked=p.buy_alert !== false;
    document.getElementById("notifySell").checked=p.sell_alert !== false;
    document.getElementById("notifyMarket").checked=p.market_alert !== false;
    if (msg) msg.textContent="";
  } catch(e) {
    if(msg){msg.textContent=e.message;msg.className="message error";}
  }
}

async function saveNotificationPreferences() {
  const msg=document.getElementById("notificationMessage");
  const r=await notificationApi("/api/notifications/preferences",{
    method:"PUT",
    body:JSON.stringify({
      whatsapp:document.getElementById("notificationWhatsapp").value.trim(),
      pushEnabled:document.getElementById("notifyPush").checked,
      whatsappEnabled:document.getElementById("notifyWhatsApp").checked,
      buyAlert:document.getElementById("notifyBuy").checked,
      sellAlert:document.getElementById("notifySell").checked,
      marketAlert:document.getElementById("notifyMarket").checked
    })
  });
  const d=await r.json();
  if(!r.ok || !d.success) throw new Error(d.message || "Não foi possível salvar.");
  if(msg){msg.textContent="Preferências salvas.";msg.className="message success";}
}

async function enablePushNotifications() {
  const msg=document.getElementById("notificationMessage");
  if(!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    throw new Error("Seu navegador não suporta notificações push.");
  }
  const keyResponse=await notificationApi("/api/notifications/vapid-public-key");
  const keyData=await keyResponse.json();
  if(!keyResponse.ok || !keyData.success) throw new Error(keyData.message || "Push ainda não configurado no servidor.");
  const permission=await Notification.requestPermission();
  if(permission!=="granted") throw new Error("Permissão de notificações não concedida.");
  const registration=await navigator.serviceWorker.register("/sw.js");
  let subscription=await registration.pushManager.getSubscription();
  if(!subscription) {
    subscription=await registration.pushManager.subscribe({
      userVisibleOnly:true,
      applicationServerKey:uint8FromBase64Url(keyData.publicKey)
    });
  }
  const r=await notificationApi("/api/notifications/push/subscribe",{
    method:"POST",
    body:JSON.stringify({subscription})
  });
  const d=await r.json();
  if(!r.ok || !d.success) throw new Error(d.message || "Não foi possível ativar o push.");
  document.getElementById("notifyPush").checked=true;
  if(msg){msg.textContent="Notificações do celular ativadas.";msg.className="message success";}
}

async function testNotification() {
  const msg=document.getElementById("notificationMessage");
  const r=await notificationApi("/api/notifications/test",{method:"POST",body:"{}"});
  const d=await r.json();
  if(!r.ok || !d.success) throw new Error(d.message || "Não foi possível enviar o teste.");
  if(msg){msg.textContent=d.message || "Teste enviado.";msg.className="message success";}
}

function setupNotifications() {
  const save=document.getElementById("saveNotificationButton");
  const enable=document.getElementById("enablePushButton");
  const test=document.getElementById("testNotificationButton");
  if(save) save.addEventListener("click",async()=>{try{await saveNotificationPreferences();}catch(e){const m=document.getElementById("notificationMessage");m.textContent=e.message;m.className="message error";}});
  if(enable) enable.addEventListener("click",async()=>{try{await enablePushNotifications();}catch(e){const m=document.getElementById("notificationMessage");m.textContent=e.message;m.className="message error";}});
  if(test) test.addEventListener("click",async()=>{try{await testNotification();}catch(e){const m=document.getElementById("notificationMessage");m.textContent=e.message;m.className="message error";}});
  loadNotificationPreferences();
}

if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",setupNotifications);
else setupNotifications();
