const loginForm = document.getElementById("loginForm");
const message = document.getElementById("message");

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

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

    localStorage.setItem("token", data.token);

    window.location.href = "dashboard.html";

  } catch (error) {
    console.error(error);
    message.textContent =
      "Erro de conexão com o servidor.";
  }
});
