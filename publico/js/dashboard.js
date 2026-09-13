const token = localStorage.getItem("token");

const userInfo = document.getElementById("userInfo");
const accountsContainer = document.getElementById("accounts");
const logoutButton = document.getElementById("logoutButton");

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
