// ============================================================
// CRIPTOPRO - SISTEMA DE IDIOMA
// Português / English
// ============================================================

(function () {
  "use strict";

  const translations = {
    // Navegação
    "← Voltar / Back": "← Back",
    "↪ Sair / Logout": "↪ Logout",
    "🇧🇷 Português": "🇧🇷 Portuguese",
    "🇺🇸 English": "🇺🇸 English",

    // Header
    "Acessar painel": "Access dashboard",
    "Painel bloqueado": "Dashboard locked",
    "Painel liberado": "Dashboard unlocked",

    // Hero
    "PLANOS CRIPTOPRO": "CRYPTOPRO PLANS",
    "Escolha o plano ideal para seu": "Choose the ideal plan for your",
    "robô": "bot",
    "Escolha seu plano e realize o pagamento. Após a confirmação, o painel CriptoPro será liberado para você configurar o robô, conectar suas contas Binance e acompanhar suas operações, relatórios e resultados, tudo em um único painel.":
      "Choose your plan and complete the payment. After confirmation, your CriptoPro dashboard will be unlocked so you can configure the bot, connect your Binance accounts, and monitor your operations, reports, and results, all in one dashboard.",

    // Planos
    "CriptoPro Básico": "CriptoPro Basic",
    "CriptoPro Profissional": "CriptoPro Professional",
    "CriptoPro Premium": "CriptoPro Premium",

    "Para começar a operar com uma configuração essencial.":
      "For starting with an essential configuration.",
    "Mais capacidade para quem precisa de maior flexibilidade.":
      "More capacity for those who need greater flexibility.",
    "Maior capacidade para uma operação mais completa.":
      "Greater capacity for a more complete operation.",

    "por mês": "per month",
    "ESCOLHER BÁSICO": "CHOOSE BASIC",
    "ESCOLHER PROFISSIONAL": "CHOOSE PROFESSIONAL",
    "ESCOLHER PREMIUM": "CHOOSE PREMIUM",
    "Incluído no plano": "Included in the plan",
    "MAIS ESCOLHIDO": "MOST POPULAR",

    "1 operação simultânea": "1 simultaneous operation",
    "2 operações simultâneas": "2 simultaneous operations",
    "3 operações simultâneas": "3 simultaneous operations",
    "1 conta Binance": "1 Binance account",
    "2 contas Binance": "2 Binance accounts",
    "3 contas Binance": "3 Binance accounts",
    "Painel de acompanhamento": "Dashboard monitoring",
    "Monitoramento das operações": "Operation monitoring",
    "Indicadores e histórico": "Indicators and history",
    "Configuração conforme o plano contratado": "Configuration according to the subscribed plan",
    "Os recursos liberados serão definidos automaticamente pelo plano confirmado.":
      "Available features will be defined automatically by the confirmed plan.",
    "O painel permanece bloqueado até a confirmação do pagamento.":
      "The dashboard remains locked until payment confirmation.",
    "O acesso e os limites do painel serão vinculados à assinatura ativa.":
      "Dashboard access and limits will be linked to the active subscription.",

    // Acesso
    "Painel bloqueado": "Dashboard locked",
    "🔒 O painel fica protegido até a confirmação do pagamento.":
      "🔒 The dashboard remains protected until payment confirmation.",
    "⚙️ Configuração do robô": "⚙️ Bot configuration",
    "🔑 Conexão das contas Binance": "🔑 Binance account connection",
    "📊 Relatórios e histórico": "📊 Reports and history",
    "📈 Acompanhamento das operações": "📈 Operation monitoring",
    "Acesso protegido": "Protected access",
    "Escolha um plano e conclua o pagamento para liberar o painel.":
      "Choose a plan and complete payment to unlock the dashboard.",
    "🔒 ACESSAR PAINEL": "🔒 ACCESS DASHBOARD",
    "🔓 ACESSAR PAINEL": "🔓 ACCESS DASHBOARD",

    // Fluxo
    "Depois do pagamento, tudo acontece dentro do painel":
      "After payment, everything happens inside the dashboard",
    "Não haverá uma etapa separada de “dashboard”. Após a confirmação da assinatura, você entra diretamente no painel CriptoPro e realiza ali a configuração do robô, cadastro das APIs da Binance, definição dos recursos do seu plano, acompanhamento das operações, indicadores, histórico e relatórios.":
      "There is no separate “dashboard” step. After subscription confirmation, you enter the CriptoPro dashboard directly and configure the bot, register your Binance APIs, define your plan features, and monitor operations, indicators, history, and reports.",

    // Comparação
    "Compare os planos": "Compare plans",
    "Os limites do painel acompanham a assinatura ativa.":
      "Dashboard limits follow the active subscription.",
    "Recurso": "Feature",
    "Básico": "Basic",
    "Profissional": "Professional",
    "Premium": "Premium",
    "Operações simultâneas": "Simultaneous operations",
    "Contas Binance": "Binance accounts",
    "Acesso condicionado ao pagamento": "Access requires payment confirmation",
    "Monitoramento": "Monitoring",

    // Como funciona
    "Como funciona": "How it works",
    "Do cadastro ao painel liberado.": "From registration to dashboard access.",
    "Escolha o plano": "Choose a plan",
    "Selecione Básico, Profissional ou Premium conforme os recursos desejados.":
      "Select Basic, Professional, or Premium according to the features you want.",
    "Informe seus dados": "Enter your information",
    "Preencha os dados necessários para iniciar a assinatura.":
      "Enter the information required to start the subscription.",
    "Efetue o pagamento": "Complete payment",
    "O pagamento é processado pelo fluxo seguro de cobrança da CriptoPro.":
      "Payment is processed through CriptoPro's secure billing flow.",
    "Painel liberado": "Dashboard unlocked",
    "Após a confirmação do pagamento, o painel CriptoPro é liberado diretamente para configurar o robô, as APIs da Binance e acessar relatórios e acompanhamento conforme o plano.":
      "After payment confirmation, the CriptoPro dashboard is unlocked directly so you can configure the bot and Binance APIs and access reports and monitoring according to your plan.",

    // Robô
    "Configuração do robô": "Bot configuration",
    "O painel será configurado de acordo com a assinatura ativa.":
      "The dashboard will be configured according to the active subscription.",
    "Após o pagamento, o cliente não precisa passar por uma página de dashboard separada. O próprio painel CriptoPro concentra a configuração do robô, conexão das APIs da Binance, acompanhamento das operações, indicadores, histórico e relatórios. A assinatura define automaticamente os recursos disponíveis.":
      "After payment, the customer does not need to go through a separate dashboard page. The CriptoPro dashboard itself contains bot configuration, Binance API connection, operation monitoring, indicators, history, and reports. The subscription automatically defines the available features.",
    "Plano Básico": "Basic Plan",
    "Plano Profissional": "Professional Plan",
    "Plano Premium": "Premium Plan",
    "Até 1 operação simultânea e 1 conta Binance.":
      "Up to 1 simultaneous operation and 1 Binance account.",
    "Até 2 operações simultâneas e 2 contas Binance.":
      "Up to 2 simultaneous operations and 2 Binance accounts.",
    "Até 3 operações simultâneas e 3 contas Binance.":
      "Up to 3 simultaneous operations and 3 Binance accounts.",

    // Segurança
    "🔐 Segurança e controle de acesso": "🔐 Security and access control",
    "🔒 O painel permanece bloqueado enquanto não existir uma assinatura ativa. Após a confirmação financeira pelo webhook, o acesso é liberado e o painel identifica o plano contratado para disponibilizar somente os recursos correspondentes.":
      "🔒 The dashboard remains locked while there is no active subscription. After financial confirmation through the webhook, access is unlocked and the dashboard identifies the subscribed plan to provide only the corresponding features.",

    // Modal
    "Plano selecionado": "Selected plan",
    "Voltar": "Back",
    "CONTINUAR": "CONTINUE",
    "Nenhum plano foi selecionado.": "No plan has been selected.",
    "Login necessário": "Login required",
    "Entre na sua conta para verificar se existe uma assinatura ativa.":
      "Log in to your account to check whether you have an active subscription.",
    "Faça login para acessar o painel.": "Log in to access the dashboard.",
    "VERIFICANDO...": "CHECKING...",
    "Verificando sua assinatura...": "Checking your subscription...",
    "Assinatura não ativa": "Subscription not active",
    "Conclua o pagamento e aguarde a confirmação para liberar o painel.":
      "Complete the payment and wait for confirmation to unlock the dashboard.",
    "🔒 PAINEL BLOQUEADO": "🔒 DASHBOARD LOCKED",
    "Assinatura ativa": "Active subscription",
    "Não foi possível verificar": "Could not verify",
    "Tente novamente em alguns segundos.": "Try again in a few seconds.",
    "🔒 TENTAR NOVAMENTE": "🔒 TRY AGAIN",

    // Footer
    "© CriptoPro — Plataforma de operações e monitoramento.":
      "© CriptoPro — Operations and monitoring platform."
  };

  function normalize(text) {
    return String(text || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function translateTextNodes() {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;

          const tag = parent.tagName;
          if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(tag)) {
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    nodes.forEach(node => {
      if (node.dataset.criptoproOriginal === undefined) {
        node.dataset.criptoproOriginal = node.nodeValue;
      }

      const original = normalize(node.dataset.criptoproOriginal);
      if (!original) return;

      const translated = translations[original];
      if (!translated) return;

      const leading = (node.dataset.criptoproOriginal.match(/^\s*/) || [""])[0];
      const trailing = (node.dataset.criptoproOriginal.match(/\s*$/) || [""])[0];

      node.nodeValue = leading + translated + trailing;
    });
  }

  function updateButtons(language) {
    const pt = document.getElementById("languagePT");
    const en = document.getElementById("languageEN");

    if (pt) pt.classList.toggle("active", language === "pt");
    if (en) en.classList.toggle("active", language === "en");
  }

  window.setCriptoProLanguage = function (language) {
    language = language === "en" ? "en" : "pt";

    localStorage.setItem("criptopro_language", language);

    // Portuguese is the original HTML. Reloading guarantees that all
    // original strings return without accumulating translations.
    if (language === "pt") {
      location.reload();
      return;
    }

    document.documentElement.lang = "en";
    translateTextNodes();
    updateButtons("en");
  };

  document.addEventListener("DOMContentLoaded", function () {
    const language =
      localStorage.getItem("criptopro_language") || "pt";

    updateButtons(language);

    if (language === "en") {
      document.documentElement.lang = "en";
      translateTextNodes();
    } else {
      document.documentElement.lang = "pt-BR";
    }
  });

})();
