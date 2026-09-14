const loginForm = document.getElementById("loginForm");
const message = document.getElementById("message");

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  if (!email || !password) {
    message.textContent = "Informe seu e-mail e sua senha.";
    return;
  }

  message.textContent = "Entrando...";

  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email,
        password
      })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      message.textContent =
        data.message || "Não foi possível realizar o login.";
      return;
    }

    // ======================================================
    // SALVAR AUTENTICAÇÃO
    // ======================================================

    localStorage.setItem("token", data.token);

    // Salvar também os dados básicos do usuário
    if (data.user) {
      localStorage.setItem(
        "criptopro_user",
        JSON.stringify(data.user)
      );
    }

    // ======================================================
    // APÓS O LOGIN
    // ======================================================
    //
    // O usuário NÃO vai mais diretamente para o dashboard.
    //
    // Primeiro ele deverá escolher um plano.
    //
    // Depois vamos conectar:
    //
    // PLANO
    //   ↓
    // PAGAMENTO
    //   ↓
    // CONFIRMAÇÃO
    //   ↓
    // LIBERAÇÃO DO DASHBOARD
    //
    // ======================================================

    window.location.href = "/planos.html";

  } catch (error) {

    console.error("ERRO NO LOGIN:", error);

    message.textContent =
      "Erro de conexão com o servidor.";

  }
});
