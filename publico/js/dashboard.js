const token = localStorage.getItem("token");

const userInfo =
  document.getElementById("userInfo");

const accountsContainer =
  document.getElementById("accounts");

const logoutButton =
  document.getElementById("logoutButton");

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

  if (!totalBalance ||
      !availableBalance ||
      !lockedBalance) {

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

      accountsContainer.innerHTML = `

        <div class="account-card">

          <h3>
            Nenhuma conta Binance cadastrada
          </h3>

          <p>
            Adicione sua conta Binance para começar.
          </p>

        </div>

      `;

      return;
    }


    accountsContainer.innerHTML = "";


    data.accounts.forEach(
      (account) => {

        const div =
          document.createElement("div");


        div.className =
          "account-card";


        div.innerHTML = `

          <h3>
            ${account.name}
          </h3>

          <p>
            Status:
            <strong>
              ${
                account.active
                  ? "🟢 Ativa"
                  : "🔴 Inativa"
              }
            </strong>
          </p>

          <div
            id="connection-message-${account.id}"
            class="message"
            style="display:none;"
          ></div>

          <div
            style="
              display:flex;
              gap:10px;
              flex-wrap:wrap;
              margin-top:16px;
            "
          >

            <button
              type="button"
              class="btn-logout test-binance-button"
              data-account-id="${account.id}"
            >
              Testar conexão
            </button>

            <button
              type="button"
              class="btn-login open-account-panel-button"
              data-account-id="${account.id}"
            >
              ABRIR PAINEL
            </button>

          </div>

        `;


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
    // ABRIR PAINEL
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


    messageElement.innerHTML = `

      Conexão OK.
      Negociação:
      ${trading}.
      Saques:
      ${withdrawals}.

    `;


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

  window.location.href =
    `/painel?account=${encodeURIComponent(accountId)}`;
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

showAddAccountButton.addEventListener(
  "click",
  () => {

    addAccountSection.style.display =
      "block";

    showAddAccountButton.style.display =
      "none";
  }
);


// =========================================================
// CANCELAR CADASTRO
// =========================================================

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


// =========================================================
// CADASTRAR CONTA
// =========================================================

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


// =========================================================
// LOGOUT
// =========================================================

logoutButton.addEventListener(
  "click",
  () => {

    localStorage.removeItem("token");

    window.location.href =
      "login.html";
  }
);


// =========================================================
// INICIAR
// =========================================================

loadUser();

loadAccounts();
