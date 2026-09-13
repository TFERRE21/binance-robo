const token = localStorage.getItem("token");

const userInfo = document.getElementById("userInfo");
const accountsContainer = document.getElementById("accounts");
const logoutButton = document.getElementById("logoutButton");

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

// Se não estiver logado, volta para o login
if (!token) {
  window.location.href = "login.html";
}

// =========================================================
// CARREGAR USUÁRIO LOGADO
// =========================================================

async function loadUser() {
  try {
    const response = await fetch("/api/auth/me", {
      headers: {
        "Authorization": `Bearer ${token}`
      }
    });

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
    userInfo.textContent = "Erro ao carregar usuário.";
  }
}

// =========================================================
// TESTAR CONEXÃO COM BINANCE
// =========================================================

async function testBinanceConnection(accountId, messageElement) {
  messageElement.textContent = "Testando conexão...";
  messageElement.className = "message success";
  messageElement.style.display = "block";

  try {
    const response = await fetch(
      `/api/binance/accounts/${accountId}/test`,
      {
        headers: {
          "Authorization": `Bearer ${token}`
        }
      }
    );

    const data = await response.json();

    if (!response.ok || !data.success) {
      messageElement.textContent =
        data.message || "Não foi possível conectar à Binance.";

      messageElement.className = "message error";
      return;
    }

    messageElement.textContent =
      `Conexão OK. Negociação: ${
        data.permissions.canTrade ? "permitida" : "desativada"
      }. Saques: ${
        data.permissions.canWithdraw ? "ATIVADOS" : "desativados"
      }.`;

    messageElement.className = "message success";

  } catch (error) {
    console.error(error);

    messageElement.textContent =
      "Erro de conexão com o servidor.";

    messageElement.className = "message error";
  }
}

// =========================================================
// CARREGAR CONTAS BINANCE
// =========================================================

async function loadAccounts() {
  try {
    const response = await fetch("/api/binance/accounts", {
      headers: {
        "Authorization": `Bearer ${token}`
      }
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      accountsContainer.textContent =
        data.message || "Erro ao carregar contas.";
      return;
    }

    if (data.accounts.length === 0) {
      accountsContainer.textContent =
        "Nenhuma conta Binance cadastrada.";
      return;
    }

    accountsContainer.innerHTML = "";

    data.accounts.forEach((account) => {
      const div = document.createElement("div");

      div.innerHTML = `
        <strong>${account.name}</strong>
        <br>
        Status: ${account.active ? "Ativa" : "Inativa"}

        <div style="margin-top: 14px;">
          <button
            type="button"
            class="btn-logout test-binance-button"
            data-account-id="${account.id}"
          >
            Testar conexão
          </button>
        </div>

        <div
          id="connection-message-${account.id}"
          class="message"
          style="display: none;"
        ></div>

        <hr>
      `;

      accountsContainer.appendChild(div);
    });

    document
      .querySelectorAll(".test-binance-button")
      .forEach((button) => {

        button.addEventListener("click", () => {

          const accountId =
            button.getAttribute("data-account-id");

          const messageElement =
            document.getElementById(
              `connection-message-${accountId}`
            );

          testBinanceConnection(
            accountId,
            messageElement
          );
        });

      });

  } catch (error) {
    console.error(error);

    accountsContainer.textContent =
      "Erro de conexão com o servidor.";
  }
}

// =========================================================
// MOSTRAR FORMULÁRIO
// =========================================================

showAddAccountButton.addEventListener("click", () => {
  addAccountSection.style.display = "block";
  showAddAccountButton.style.display = "none";
});

// =========================================================
// CANCELAR CADASTRO
// =========================================================

cancelAddAccountButton.addEventListener("click", () => {
  addAccountForm.reset();
  accountMessage.textContent = "";
  accountMessage.className = "message";

  addAccountSection.style.display = "none";
  showAddAccountButton.style.display = "block";
});

// =========================================================
// CADASTRAR CONTA BINANCE
// =========================================================

addAccountForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const name =
    document.getElementById("accountName").value.trim();

  const apiKey =
    document.getElementById("apiKey").value.trim();

  const apiSecret =
    document.getElementById("apiSecret").value.trim();

  accountMessage.textContent = "Salvando conta...";
  accountMessage.className = "message success";
  accountMessage.style.display = "block";

  try {
    const response = await fetch("/api/binance/accounts", {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },

      body: JSON.stringify({
        name,
        apiKey,
        apiSecret
      })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      accountMessage.textContent =
        data.message || "Não foi possível cadastrar a conta.";

      accountMessage.className = "message error";
      return;
    }

    accountMessage.textContent =
      "Conta Binance cadastrada com sucesso.";

    accountMessage.className = "message success";

    addAccountForm.reset();

    await loadAccounts();

    setTimeout(() => {
      addAccountSection.style.display = "none";
      showAddAccountButton.style.display = "block";
      accountMessage.textContent = "";
      accountMessage.className = "message";
      accountMessage.style.display = "none";
    }, 1500);

  } catch (error) {
    console.error(error);

    accountMessage.textContent =
      "Erro de conexão com o servidor.";

    accountMessage.className = "message error";
    accountMessage.style.display = "block";
  }
});

// =========================================================
// LOGOUT
// =========================================================

logoutButton.addEventListener("click", () => {
  localStorage.removeItem("token");
  window.location.href = "login.html";
});

// =========================================================
// INICIAR
// =========================================================

loadUser();
loadAccounts();
