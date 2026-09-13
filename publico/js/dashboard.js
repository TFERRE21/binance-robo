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
        <hr>
      `;

      accountsContainer.appendChild(div);
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
    }, 1500);

  } catch (error) {
    console.error(error);

    accountMessage.textContent =
      "Erro de conexão com o servidor.";

    accountMessage.className = "message error";
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
