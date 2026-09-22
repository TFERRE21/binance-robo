/* =========================================================
   CRIPTOPRO — CHAT DE SUPORTE
   Arquivo: support.js

   A chave da OpenAI NÃO fica neste arquivo.
   O navegador chama somente /api/support/chat.

   CORREÇÃO:
   O botão "ABRIR CHAMADO DE SUPORTE" fica FORA da área
   de rolagem e permanece sempre visível.
========================================================= */

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
      background: "#f0b90b",
      color: "#111",
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
      flexDirection: "column",
      fontFamily: "Arial, sans-serif"
    });

    box.innerHTML = `
      <div style="
        height:58px;
        min-height:58px;
        background:linear-gradient(135deg,#1677ff,#0b5ed7);
        color:#fff;
        display:flex;
        align-items:center;
        justify-content:space-between;
        padding:0 16px;
        box-sizing:border-box;
        flex-shrink:0;
      ">
        <div>
          <div style="font-size:16px;font-weight:700;">
            🤖 CRIPTOPRO
          </div>
          <div style="
            font-size:11px;
            opacity:.9;
            color:#22c55e;
            font-weight:700;
          ">
            ● Assistente online
          </div>
        </div>

        <button
          id="supportCloseButton"
          type="button"
          style="
            width:34px;
            height:34px;
            background:rgba(255,255,255,.08);
            border:0;
            border-radius:9px;
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
          min-height:315px;
          overflow-y:auto;
          overflow-x:hidden;
          padding:14px;
          box-sizing:border-box;
          background:#f7f9fc;
          flex-shrink:0;
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
      </div>

      <!-- BOTÃO FIXO: FORA DO SCROLL -->
      <div
        id="supportTicketArea"
        style="
          height:58px;
          min-height:58px;
          padding:7px 10px;
          box-sizing:border-box;
          background:#fff;
          border-top:1px solid #e5e7eb;
          border-bottom:1px solid #e5e7eb;
          flex-shrink:0;
        "
      >
        <button
          type="button"
          id="supportTicketButton"
          style="
            display:block;
            width:100%;
            height:44px;
            margin:0;
            padding:0 12px;
            border:1px solid #f0b90b;
            border-radius:10px;
            background:linear-gradient(135deg,#ffd83e,#efa900);
            color:#111;
            font-size:12px;
            font-weight:900;
            cursor:pointer;
            text-align:center;
            box-sizing:border-box;
            box-shadow:0 4px 10px rgba(240,185,11,.18);
          "
        >
          📩 ABRIR CHAMADO DE SUPORTE
        </button>
      </div>

      <form
        id="supportForm"
        style="
          height:67px;
          min-height:67px;
          display:flex;
          gap:8px;
          padding:10px;
          box-sizing:border-box;
          background:#fff;
          flex-shrink:0;
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
            box-sizing:border-box;
          "
        >

        <button
          id="supportSendButton"
          type="submit"
          style="
            width:48px;
            min-width:48px;
            border:0;
            border-radius:10px;
            background:#1677ff;
            color:#fff;
            cursor:pointer;
            font-size:18px;
          "
        >➤</button>
      </form>
    `;

    document.body.appendChild(button);
    document.body.appendChild(box);

    button.addEventListener("click", function () {
      const aberto = box.style.display === "flex";

      box.style.display = aberto ? "none" : "flex";

      if (!aberto) {
        setTimeout(function () {
          const input = document.getElementById("supportInput");
          if (input) input.focus();
        }, 100);
      }
    });

    const closeButton =
      document.getElementById("supportCloseButton");

    if (closeButton) {
      closeButton.addEventListener("click", function () {
        box.style.display = "none";
      });
    }

    const supportForm =
      document.getElementById("supportForm");

    if (supportForm) {
      supportForm.addEventListener(
        "submit",
        enviarMensagem
      );
    }

    document
      .querySelectorAll(
        "#supportChatBox .supportQuickButton"
      )
      .forEach(function (botao) {

        Object.assign(botao.style, {
          display: "block",
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
          textAlign: "left",
          boxSizing: "border-box"
        });

        botao.addEventListener("click", function () {
          const pergunta =
            botao.getAttribute("data-question");

          const input =
            document.getElementById("supportInput");

          if (!input || !pergunta || enviando) return;

          input.value = pergunta;

          supportForm.dispatchEvent(
            new Event("submit", {
              bubbles: true,
              cancelable: true
            })
          );
        });
      });

    const ticketButton =
      document.getElementById("supportTicketButton");

    if (ticketButton) {
      ticketButton.addEventListener("click", function () {
        const paginaAtual =
          window.location.pathname +
          window.location.search;

        const destino =
          "/suporte.html?origem=" +
          encodeURIComponent(paginaAtual);

        window.location.href = destino;
      });
    }
  }

  function adicionarMensagem(texto, tipo) {
    const area =
      document.getElementById("supportMessages");

    if (!area) return;

    const mensagem =
      document.createElement("div");

    const usuario = tipo === "user";

    Object.assign(mensagem.style, {
      maxWidth: "85%",
      marginBottom: "10px",
      padding: "10px 12px",
      borderRadius: "12px",
      fontSize: "13px",
      lineHeight: "1.45",
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
      marginLeft: usuario ? "auto" : "0",
      background: usuario ? "#1677ff" : "#fff",
      color: usuario ? "#fff" : "#263244",
      border: usuario ? "0" : "1px solid #e5e7eb",
      boxSizing: "border-box"
    });

    mensagem.textContent = texto;

    area.appendChild(mensagem);
    area.scrollTop = area.scrollHeight;
  }

  function adicionarCarregando() {
    const area =
      document.getElementById("supportMessages");

    if (!area) return;

    const loading =
      document.createElement("div");

    loading.id = "supportLoading";

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

    loading.textContent = "Digitando...";

    area.appendChild(loading);
    area.scrollTop = area.scrollHeight;
  }

  function removerCarregando() {
    const loading =
      document.getElementById("supportLoading");

    if (loading) loading.remove();
  }

  async function enviarMensagem(event) {
    event.preventDefault();

    if (enviando) return;

    const input =
      document.getElementById("supportInput");

    const send =
      document.getElementById("supportSendButton");

    if (!input) return;

    const mensagem = input.value.trim();

    if (!mensagem) return;

    enviando = true;

    if (send) {
      send.disabled = true;
      send.style.opacity = "0.6";
    }

    adicionarMensagem(mensagem, "user");

    input.value = "";

    historico.push({
      role: "user",
      content: mensagem
    });

    adicionarCarregando();

    try {
      const resposta = await fetch(
        "/api/support/chat",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          credentials: "same-origin",
          body: JSON.stringify({
            message: mensagem,
            messages: historico
          })
        }
      );

      let dados = {};

      try {
        dados = await resposta.json();
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

      adicionarMensagem(texto, "assistant");

      historico.push({
        role: "assistant",
        content: texto
      });

      if (historico.length > 20) {
        historico = historico.slice(-20);
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

      if (input) input.focus();
    }
  }

  function iniciar() {
    if (!document.body) return;
    criarChat();
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      iniciar
    );
  } else {
    iniciar();
  }

})();
