(function () {
  "use strict";

  let historico = [];
  let enviando = false;

  function criarChat() {
    if (document.getElementById("supportChatBox")) return;

    const button = document.createElement("button");

    button.id = "supportChatButton";
    button.type = "button";
    button.innerHTML = "💬";
    button.title = "Suporte CRIPTOPRO";

    Object.assign(button.style, {
      position: "fixed",
      right: "24px",
      bottom: "24px",
      width: "58px",
      height: "58px",
      borderRadius: "50%",
      border: "0",
      background: "#1677ff",
      color: "#fff",
      fontSize: "25px",
      cursor: "pointer",
      zIndex: "99999",
      boxShadow: "0 8px 25px rgba(0,0,0,.30)"
    });

    const box = document.createElement("div");

    box.id = "supportChatBox";

    Object.assign(box.style, {
      position: "fixed",
      right: "24px",
      bottom: "94px",
      width: "360px",
      maxWidth: "calc(100vw - 30px)",
      height: "500px",
      background: "#fff",
      borderRadius: "18px",
      overflow: "hidden",
      boxShadow: "0 15px 45px rgba(0,0,0,.25)",
      border: "1px solid #e5e7eb",
      zIndex: "99998",
      display: "none",
      fontFamily: "Arial, sans-serif"
    });

    box.innerHTML = `
      <div style="
        height:58px;
        background:linear-gradient(135deg,#1677ff,#0b5ed7);
        color:#fff;
        display:flex;
        align-items:center;
        justify-content:space-between;
        padding:0 16px;
        box-sizing:border-box;
      ">
        <div>
          <div style="font-size:16px;font-weight:700;">
            🤖 CRIPTOPRO
          </div>

          <div style="font-size:11px;opacity:.85;">
            Assistente de suporte
          </div>
        </div>

        <button
          id="supportCloseButton"
          type="button"
          style="
            background:transparent;
            border:0;
            color:#fff;
            font-size:22px;
            cursor:pointer;
          "
        >×</button>
      </div>

      <div
        id="supportMessages"
        style="
          height:315px;
          overflow-y:auto;
          padding:14px;
          box-sizing:border-box;
          background:#f7f9fc;
        "
      >

        <div style="
          background:#fff;
          border:1px solid #e5e7eb;
          border-radius:12px;
          padding:11px;
          margin-bottom:10px;
          color:#263244;
          font-size:13px;
          line-height:1.45;
        ">
          Olá! 👋<br><br>

          Sou o assistente da <b>CRIPTOPRO</b>.
          Como posso ajudar?
        </div>

        <button
          type="button"
          class="supportQuickButton"
          data-question="Como funciona o robô?"
        >
          🤖 Como funciona o robô?
        </button>

        <button
          type="button"
          class="supportQuickButton"
          data-question="Como conectar a Binance?"
        >
          🔗 Como conectar a Binance?
        </button>

        <button
          type="button"
          class="supportQuickButton"
          data-question="Qual a diferença dos robôs?"
        >
          📊 Diferença dos robôs
        </button>

        <button
          type="button"
          class="supportQuickButton"
          data-question="Como funciona o pagamento?"
        >
          💳 Como funciona o pagamento?
        </button>

        <button
          type="button"
          id="supportTicketButton"
          style="
            width:100%;
            margin-top:10px;
            padding:11px 12px;
            border:1px solid #f0b90b;
            border-radius:10px;
            background:linear-gradient(135deg,#fff7d1,#fff1a8);
            color:#7a5800;
            font-size:12px;
            font-weight:900;
            cursor:pointer;
            text-align:left;
          "
        >
          📩 Abrir chamado de suporte
        </button>

      </div>

      <form
        id="supportForm"
        style="
          height:67px;
          display:flex;
          gap:8px;
          padding:10px;
          box-sizing:border-box;
          background:#fff;
          border-top:1px solid #e5e7eb;
        "
      >

        <input
          id="supportInput"
          type="text"
          autocomplete="off"
          placeholder="Digite sua dúvida..."
          style="
            flex:1;
            min-width:0;
            border:1px solid #d9dee7;
            border-radius:10px;
            padding:0 12px;
            outline:none;
            font-size:13px;
          "
        >

        <button
          id="supportSendButton"
          type="submit"
          style="
            width:48px;
            border:0;
            border-radius:10px;
            background:#1677ff;
            color:#fff;
            cursor:pointer;
            font-size:18px;
          "
        >
          ➤
        </button>

      </form>
    `;

    document.body.appendChild(button);
    document.body.appendChild(box);

    button.addEventListener("click", function () {

      const aberto =
        box.style.display === "flex";

      box.style.display =
        aberto ? "none" : "flex";

      box.style.flexDirection =
        "column";

      if (!aberto) {

        setTimeout(function () {

          const input =
            document.getElementById(
              "supportInput"
            );

          if (input) {
            input.focus();
          }

        }, 100);
      }
    });

    document
      .getElementById("supportCloseButton")
      .addEventListener("click", function () {

        box.style.display = "none";

      });

    document
      .getElementById("supportForm")
      .addEventListener(
        "submit",
        enviarMensagem
      );

    document
      .querySelectorAll(".supportQuickButton")
      .forEach(function (botao) {

        Object.assign(botao.style, {

          width: "100%",
          marginBottom: "7px",
          padding: "8px 10px",
          border: "1px solid #d9b52b",
          borderRadius: "9px",
          background: "#fff",
          color: "#263244",
          fontSize: "11px",
          fontWeight: "700",
          cursor: "pointer",
          textAlign: "left"

        });

        botao.addEventListener(
          "click",
          function () {

            const pergunta =
              botao.getAttribute(
                "data-question"
              );

            const input =
              document.getElementById(
                "supportInput"
              );

            if (!input || !pergunta)
              return;

            input.value = pergunta;

            document
              .getElementById("supportForm")
              .dispatchEvent(
                new Event("submit", {
                  bubbles: true,
                  cancelable: true
                })
              );
          }
        );
      });

    document
      .getElementById("supportTicketButton")
      .addEventListener(
        "click",
        function () {

          const paginaAtual =
            window.location.pathname +
            window.location.search;

          const destino =
            "/suporte.html?origem=" +
            encodeURIComponent(
              paginaAtual
            );

          window.location.href =
            destino;
        }
      );
  }

  function adicionarMensagem(
    texto,
    tipo
  ) {

    const area =
      document.getElementById(
        "supportMessages"
      );

    if (!area) return;

    const mensagem =
      document.createElement("div");

    const usuario =
      tipo === "user";

    Object.assign(mensagem.style, {

      maxWidth: "85%",
      marginBottom: "10px",
      padding: "10px 12px",
      borderRadius: "12px",
      fontSize: "13px",
      lineHeight: "1.45",
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
      marginLeft:
        usuario ? "auto" : "0",
      background:
        usuario ? "#1677ff" : "#fff",
      color:
        usuario ? "#fff" : "#263244",
      border:
        usuario
          ? "0"
          : "1px solid #e5e7eb"

    });

    mensagem.textContent = texto;

    area.appendChild(mensagem);

    area.scrollTop =
      area.scrollHeight;
  }

  function adicionarCarregando() {

    const area =
      document.getElementById(
        "supportMessages"
      );

    if (!area) return;

    const loading =
      document.createElement("div");

    loading.id =
      "supportLoading";

    loading.style.cssText = `
      display:inline-block;
      background:#fff;
      border:1px solid #e5e7eb;
      border-radius:12px;
      padding:10px 12px;
      margin-bottom:10px;
      color:#71809a;
      font-size:13px;
    `;

    loading.textContent =
      "Digitando...";

    area.appendChild(loading);

    area.scrollTop =
      area.scrollHeight;
  }

  function removerCarregando() {

    const loading =
      document.getElementById(
        "supportLoading"
      );

    if (loading) {
      loading.remove();
    }
  }

  async function enviarMensagem(event) {

    event.preventDefault();

    if (enviando) return;

    const input =
      document.getElementById(
        "supportInput"
      );

    const send =
      document.getElementById(
        "supportSendButton"
      );

    if (!input) return;

    const mensagem =
      input.value.trim();

    if (!mensagem) return;

    enviando = true;

    if (send) {

      send.disabled = true;
      send.style.opacity = "0.6";

    }

    adicionarMensagem(
      mensagem,
      "user"
    );

    input.value = "";

    historico.push({

      role: "user",
      content: mensagem

    });

    adicionarCarregando();

    try {

      const resposta =
        await fetch(
          "/api/support/chat",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            credentials:
              "same-origin",

            body:
              JSON.stringify({
                message: mensagem,
                messages: historico
              })
          }
        );

      let dados = {};

      try {

        dados =
          await resposta.json();

      } catch (e) {

        dados = {};

      }

      if (!resposta.ok) {

        throw new Error(
          dados.erro ||
          dados.error ||
          "Não foi possível conectar ao suporte."
        );

      }

      const texto =
        dados.resposta ||
        dados.message ||
        dados.content ||
        "Não consegui gerar uma resposta agora.";

      removerCarregando();

      adicionarMensagem(
        texto,
        "assistant"
      );

      historico.push({

        role: "assistant",
        content: texto

      });

      if (
        historico.length > 20
      ) {

        historico =
          historico.slice(-20);

      }

    } catch (erro) {

      removerCarregando();

      adicionarMensagem(
        "Não foi possível conectar ao suporte no momento. Tente novamente.",
        "assistant"
      );

      console.error(
        "CRIPTOPRO suporte:",
        erro
      );

    } finally {

      enviando = false;

      if (send) {

        send.disabled = false;
        send.style.opacity = "1";

      }

      if (input) {
        input.focus();
      }
    }
  }

  function iniciar() {

    if (!document.body) return;

    criarChat();
  }

  if (
    document.readyState ===
    "loading"
  ) {

    document.addEventListener(
      "DOMContentLoaded",
      iniciar
    );

  } else {

    iniciar();

  }

})();
