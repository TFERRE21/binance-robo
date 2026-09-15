<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Planos | CriptoPro</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#070b13;--panel:#101827;--panel2:#0c1320;--line:#273244;
  --text:#fff;--muted:#9ca3af;--gold:#d4af37;--gold2:#f1d76b;
  --green:#22c55e;--blue:#4aa8ff;--red:#ff6177;
}
body{
  min-height:100vh;font-family:Arial,Helvetica,sans-serif;color:var(--text);
  background:
    radial-gradient(circle at 10% 5%,rgba(212,175,55,.12),transparent 28%),
    radial-gradient(circle at 90% 10%,rgba(74,168,255,.08),transparent 25%),
    linear-gradient(180deg,#080c14,#0b1020);
}
header{
  position:sticky;top:0;z-index:50;background:rgba(8,12,20,.96);
  backdrop-filter:blur(15px);border-bottom:1px solid #202a3b;
}
.header-inner{
  width:94%;max-width:1400px;min-height:76px;margin:auto;
  display:flex;align-items:center;justify-content:space-between;gap:20px;
}
.logo{font-size:28px;font-weight:900;letter-spacing:-1px}
.logo span{color:var(--gold)}
.header-actions{display:flex;align-items:center;gap:12px}
.panel-btn{
  display:inline-flex;align-items:center;gap:9px;text-decoration:none;
  min-height:44px;padding:0 18px;border-radius:10px;font-weight:900;
  border:1px solid rgba(212,175,55,.55);color:#111827;
  background:linear-gradient(135deg,var(--gold),var(--gold2));
  cursor:pointer;box-shadow:0 8px 30px rgba(212,175,55,.12);
}
.panel-btn:hover{transform:translateY(-1px);filter:brightness(1.05)}
.panel-btn.locked{color:#d1d5db;background:#151b27;border-color:#3a465a}
main{width:94%;max-width:1400px;margin:auto}
.hero{
  padding:55px 0 35px;display:flex;align-items:flex-end;
  justify-content:space-between;gap:35px;
}
.hero-copy{max-width:820px}
.badge{
  display:inline-block;padding:8px 14px;border-radius:50px;
  background:rgba(212,175,55,.1);border:1px solid rgba(212,175,55,.3);
  color:var(--gold);font-size:12px;font-weight:900;letter-spacing:1px;margin-bottom:16px;
}
.hero h1{font-size:clamp(32px,5vw,52px);line-height:1.05;margin-bottom:16px}
.hero h1 span{color:var(--gold)}
.hero p{color:var(--muted);font-size:16px;line-height:1.7}
.layout{
  display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:24px;align-items:start;
}
.plans{
  display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;align-items:stretch;
}
.plan{
  position:relative;display:flex;flex-direction:column;min-height:670px;
  padding:26px;background:linear-gradient(145deg,#111827,#0d1320);
  border:1px solid var(--line);border-radius:18px;
  transition:.25s;overflow:hidden;
}
.plan:hover{transform:translateY(-4px);border-color:#4b5563}
.plan.professional{border:2px solid var(--gold);box-shadow:0 18px 55px rgba(212,175,55,.1)}
.popular{
  position:absolute;top:0;right:0;padding:7px 13px;border-radius:0 0 0 12px;
  background:var(--gold);color:#111827;font-size:10px;font-weight:900;
}
.plan-top{text-align:left;margin-bottom:18px}
.plan-icon{font-size:28px;margin-bottom:10px}
.plan-name{font-size:22px;font-weight:900;margin-bottom:7px}
.plan-description{min-height:40px;color:var(--muted);font-size:13px;line-height:1.5}
.price{margin:18px 0 20px}
.price strong{font-size:38px}.price small{color:var(--muted);font-size:13px}
.plan-button{
  width:100%;min-height:48px;border:0;border-radius:9px;background:linear-gradient(135deg,var(--gold),var(--gold2));
  color:#111827;font-weight:900;cursor:pointer;margin-bottom:22px
}
.plan-button:hover{filter:brightness(1.06)}
.features-title{font-size:13px;font-weight:900;margin-bottom:12px}
.features{list-style:none;display:flex;flex-direction:column;gap:10px;flex:1}
.features li{position:relative;padding-left:23px;color:#cbd5e1;font-size:13px;line-height:1.4}
.features li:before{content:"✓";position:absolute;left:0;color:var(--green);font-weight:900}
.features li.limit{color:#fff;font-weight:700}
.features li.limit:before{content:"◆";color:var(--gold);font-size:9px;top:2px}
.plan-note{margin-top:18px;padding:11px;border-radius:9px;background:rgba(255,255,255,.03);border:1px solid var(--line);color:var(--muted);font-size:11px;line-height:1.5}
.access-card{
  position:sticky;top:100px;padding:24px;border:1px solid var(--line);border-radius:18px;
  background:linear-gradient(145deg,#111827,#0d1320);box-shadow:0 18px 50px rgba(0,0,0,.2)
}
.lock-icon{
  width:64px;height:64px;border-radius:18px;display:flex;align-items:center;justify-content:center;
  margin-bottom:18px;background:rgba(212,175,55,.1);border:1px solid rgba(212,175,55,.28);font-size:30px
}
.access-card h2{font-size:22px;margin-bottom:9px}
.access-card p{color:var(--muted);font-size:13px;line-height:1.6;margin-bottom:18px}
.access-status{
  padding:12px;border-radius:10px;background:#0a0f18;border:1px solid #273244;
  color:#cbd5e1;font-size:12px;line-height:1.5;margin-bottom:14px
}
.access-status strong{display:block;color:var(--gold);margin-bottom:4px}
.access-btn{
  width:100%;min-height:48px;border-radius:10px;border:1px solid #3a465a;
  background:#151b27;color:#9ca3af;font-weight:900;cursor:pointer
}
.access-btn.ready{background:linear-gradient(135deg,var(--gold),var(--gold2));color:#111827;border-color:transparent}
.section{margin:80px auto 0}
.section-title{text-align:center;margin-bottom:30px}
.section-title h2{font-size:30px;margin-bottom:9px}.section-title p{color:var(--muted);font-size:14px}
.comparison-wrapper{overflow-x:auto;border:1px solid var(--line);border-radius:16px;background:#0d1320}
.comparison{width:100%;min-width:760px;border-collapse:collapse}
.comparison th,.comparison td{padding:16px 18px;text-align:center;border-bottom:1px solid #202a3b;font-size:13px}
.comparison th:first-child,.comparison td:first-child{text-align:left}
.comparison th{color:var(--gold);font-size:14px}.comparison td{color:#cbd5e1}
.comparison tr:last-child td{border-bottom:0}.yes{color:var(--green)!important;font-weight:900}.highlight{background:rgba(212,175,55,.045)}
.how-it-works{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.step{padding:23px;border:1px solid var(--line);border-radius:14px;background:rgba(17,24,39,.65)}
.step-number{width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;
background:rgba(212,175,55,.12);border:1px solid rgba(212,175,55,.3);color:var(--gold);font-weight:900;margin-bottom:14px}
.step h3{font-size:16px;margin-bottom:8px}.step p{color:var(--muted);font-size:13px;line-height:1.6}
.robot-box{padding:30px;border-radius:18px;border:1px solid var(--line);background:linear-gradient(145deg,#111827,#0d1320)}
.robot-intro{color:var(--muted);line-height:1.7;font-size:14px;margin-bottom:25px}
.robot-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.robot-item{padding:18px;border-radius:12px;background:rgba(255,255,255,.025);border:1px solid var(--line)}
.robot-item strong{display:block;margin-bottom:6px;font-size:14px}.robot-item span{color:var(--muted);font-size:12px;line-height:1.5}
.security{margin:55px 0 35px;padding:24px;border-radius:14px;border:1px solid rgba(212,175,55,.25);background:rgba(212,175,55,.05);text-align:center}
.security strong{display:block;color:var(--gold);margin-bottom:7px}.security p{color:var(--muted);font-size:13px;line-height:1.6}
footer{padding:35px 0 45px;text-align:center;color:#6b7280;font-size:12px}
.modal-overlay{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.75);backdrop-filter:blur(8px);z-index:100;padding:20px}
.modal{width:min(460px,100%);padding:28px;border-radius:18px;border:1px solid var(--line);background:#0f1725;box-shadow:0 30px 100px rgba(0,0,0,.5)}
.modal h3{font-size:22px;margin-bottom:10px}.modal p{color:var(--muted);line-height:1.6;font-size:14px;margin-bottom:20px}
.modal-actions{display:flex;gap:10px}.modal-actions button{flex:1;min-height:46px;border-radius:9px;border:1px solid #3a465a;font-weight:900;cursor:pointer}
.primary{background:linear-gradient(135deg,var(--gold),var(--gold2));color:#111827!important;border:0!important}
.secondary{background:#151b27;color:#fff}
@media(max-width:1050px){
  .layout{grid-template-columns:1fr}.access-card{position:relative;top:auto}.plans{grid-template-columns:repeat(3,minmax(260px,1fr));overflow-x:auto;padding-bottom:10px}
  .how-it-works{grid-template-columns:repeat(2,1fr)}.robot-grid{grid-template-columns:repeat(2,1fr)}
}
@media(max-width:700px){
  .header-inner{min-height:68px}.logo{font-size:24px}.hero{padding-top:35px}.hero h1{font-size:35px}
  .header-actions .panel-btn{padding:0 12px;font-size:12px}.plans{grid-template-columns:1fr}.plan{min-height:auto}
  .how-it-works,.robot-grid{grid-template-columns:1fr}
}

.panel-inside-list{
  display:grid;
  grid-template-columns:1fr;
  gap:8px;
  margin:-5px 0 18px;
}
.panel-inside-list div{
  padding:9px 10px;
  border-radius:8px;
  background:rgba(255,255,255,.025);
  border:1px solid var(--line);
  color:#cbd5e1;
  font-size:12px;
}
.panel-flow-box{
  display:flex;
  align-items:flex-start;
  gap:18px;
  padding:24px 26px;
  border-radius:16px;
  border:1px solid rgba(212,175,55,.30);
  background:linear-gradient(135deg,rgba(212,175,55,.09),rgba(17,24,39,.75));
}
.panel-flow-icon{
  width:52px;
  height:52px;
  min-width:52px;
  border-radius:14px;
  display:flex;
  align-items:center;
  justify-content:center;
  background:rgba(212,175,55,.12);
  border:1px solid rgba(212,175,55,.30);
  font-size:25px;
}
.panel-flow-box strong{
  display:block;
  color:var(--gold2);
  font-size:17px;
  margin-bottom:7px;
}
.panel-flow-box p{
  color:var(--muted);
  font-size:13px;
  line-height:1.7;
}
@media(max-width:700px){
  .panel-flow-box{padding:20px;gap:12px}
  .panel-flow-icon{width:44px;height:44px;min-width:44px;font-size:20px}
}


.language-btn{
  border:1px solid #374151;
  background:#111827;
  color:#e5e7eb;
  padding:9px 13px;
  border-radius:9px;
  cursor:pointer;
  font-size:13px;
  font-weight:800;
  transition:all .2s ease;
}

.language-btn:hover,
.language-btn.active{
  border-color:#d4af37;
  color:#d4af37;
  background:rgba(212,175,55,.12);
  transform:translateY(-1px);
}

.criptopro-language{
  display:flex;
  align-items:center;
  justify-content:center;
  gap:7px;
  flex-wrap:wrap;
}

</style>
</head>
<body>

<style id="criptopro-top-nav-style">
.criptopro-top-nav{
  width:100%;
  max-width:1400px;
  margin:0 auto 20px auto;
  padding:12px 18px;
  box-sizing:border-box;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:14px;
  border:1px solid rgba(255,215,0,.25);
  border-radius:14px;
  background:rgba(0,0,0,.28);
  backdrop-filter:blur(10px);
  -webkit-backdrop-filter:blur(10px);
}

.criptopro-nav-btn{
  border:0;
  border-radius:10px;
  padding:10px 16px;
  font-size:14px;
  font-weight:700;
  cursor:pointer;
  transition:all .2s ease;
  white-space:nowrap;
}

.criptopro-nav-btn:hover{
  transform:translateY(-1px);
  filter:brightness(1.08);
}

.criptopro-back-btn{
  background:#0030B9;
  color:#fff;
}

.criptopro-logout-btn{
  background:#8b0000;
  color:#fff;
}

.criptopro-language{
  color:#e8e8e8;
  font-size:13px;
  font-weight:600;
  text-align:center;
}

@media(max-width:700px){
  .criptopro-top-nav{
    flex-wrap:wrap;
    justify-content:center;
  }

  .criptopro-language{
    width:100%;
    order:-1;
  }

  .criptopro-nav-btn{
    flex:1;
    min-width:130px;
  }
}
</style>


<!-- CRIPTOPRO - NAVEGAÇÃO SUPERIOR -->
<div class="criptopro-top-nav">
  <button type="button" class="criptopro-nav-btn criptopro-back-btn" onclick="voltarLogin()">
    ← Voltar / Back
  </button>

  <div class="criptopro-language" aria-label="Seleção de idioma / Language selection">
    <button type="button" id="languagePT" class="language-btn" onclick="setCriptoProLanguage('pt')">
      🇧🇷 Português
    </button>
    <button type="button" id="languageEN" class="language-btn" onclick="setCriptoProLanguage('en')">
      🇺🇸 English
    </button>
  </div>

  

    <button type="button" class="criptopro-nav-btn criptopro-logout-btn" onclick="sairSistema()">
    ↪ Sair / Logout
  </button>
</div>



<header>
  <div class="header-inner">
    <div class="logo">Cripto<span>Pro</span></div>
    <div class="header-actions">
      <button class="panel-btn locked" id="topPanelBtn" onclick="acessarPainel()">
        🔒 <span id="topPanelText">Acessar painel</span>
      </button>
    </div>
  </div>
</header>

<main>
  <section class="hero">
    <div class="hero-copy">
      <div class="badge">PLANOS CRIPTOPRO</div>
      <h1>Escolha o plano ideal para seu <span>robô</span></h1>
      <p>Escolha seu plano e realize o pagamento. Após a confirmação, o painel CriptoPro será liberado para você configurar o robô, conectar suas contas Binance e acompanhar suas operações, relatórios e resultados, tudo em um único painel.</p>
    </div>
  </section>

  <section class="layout">
    <div class="plans">

      <article class="plan">
        <div class="plan-top">
          <div class="plan-icon">🚀</div>
          <div class="plan-name">CriptoPro Básico</div>
          <div class="plan-description">Para começar a operar com uma configuração essencial.</div>
        </div>
        <div class="price"><strong>R$ 49,90</strong><br><small>por mês</small></div>
        <button class="plan-button" onclick="selecionarPlano('basico','Básico','R$ 49,90/mês')">ESCOLHER BÁSICO</button>
        <div class="features-title">Incluído no plano</div>
        <ul class="features">
          <li class="limit">1 operação simultânea</li>
          <li class="limit">1 conta Binance</li>
          <li>Painel de acompanhamento</li>
          <li>Monitoramento das operações</li>
          <li>Indicadores e histórico</li>
          <li>Configuração conforme o plano contratado</li>
        </ul>
        <div class="plan-note">O painel permanece bloqueado até a confirmação do pagamento.</div>
      </article>

      <article class="plan professional">
        <div class="popular">MAIS ESCOLHIDO</div>
        <div class="plan-top">
          <div class="plan-icon">⚡</div>
          <div class="plan-name">CriptoPro Profissional</div>
          <div class="plan-description">Mais capacidade para quem precisa de maior flexibilidade.</div>
        </div>
        <div class="price"><strong>R$ 99,90</strong><br><small>por mês</small></div>
        <button class="plan-button" onclick="selecionarPlano('profissional','Profissional','R$ 99,90/mês')">ESCOLHER PROFISSIONAL</button>
        <div class="features-title">Incluído no plano</div>
        <ul class="features">
          <li class="limit">2 operações simultâneas</li>
          <li class="limit">2 contas Binance</li>
          <li>Painel de acompanhamento</li>
          <li>Monitoramento das operações</li>
          <li>Indicadores e histórico</li>
          <li>Configuração conforme o plano contratado</li>
        </ul>
        <div class="plan-note">Os recursos liberados serão definidos automaticamente pelo plano confirmado.</div>
      </article>

      <article class="plan">
        <div class="plan-top">
          <div class="plan-icon">👑</div>
          <div class="plan-name">CriptoPro Premium</div>
          <div class="plan-description">Maior capacidade para uma operação mais completa.</div>
        </div>
        <div class="price"><strong>R$ 199,90</strong><br><small>por mês</small></div>
        <button class="plan-button" onclick="selecionarPlano('premium','Premium','R$ 199,90/mês')">ESCOLHER PREMIUM</button>
        <div class="features-title">Incluído no plano</div>
        <ul class="features">
          <li class="limit">3 operações simultâneas</li>
          <li class="limit">3 contas Binance</li>
          <li>Painel de acompanhamento</li>
          <li>Monitoramento das operações</li>
          <li>Indicadores e histórico</li>
          <li>Configuração conforme o plano contratado</li>
        </ul>
        <div class="plan-note">O acesso e os limites do painel serão vinculados à assinatura ativa.</div>
      </article>

    </div>

    <aside class="access-card">
      <div class="lock-icon" id="accessIcon">🔒</div>
      <h2 id="accessTitle">Painel bloqueado</h2>
      <p id="accessDescription">🔒 O painel fica protegido até a confirmação do pagamento.</p>
      <div class="panel-inside-list">
        <div>⚙️ Configuração do robô</div>
        <div>🔑 Conexão das contas Binance</div>
        <div>📊 Relatórios e histórico</div>
        <div>📈 Acompanhamento das operações</div>
      </div>
      <div class="access-status">
        <strong id="accessStatusTitle">Acesso protegido</strong>
        <span id="accessStatusText">Escolha um plano e conclua o pagamento para liberar o painel.</span>
      </div>
      <button class="access-btn" id="accessBtn" onclick="acessarPainel()">🔒 ACESSAR PAINEL</button>
    </aside>
  </section>

  <section class="section panel-flow">
    <div class="panel-flow-box">
      <div class="panel-flow-icon">🔐</div>
      <div>
        <strong>Depois do pagamento, tudo acontece dentro do painel</strong>
        <p>Não haverá uma etapa separada de “dashboard”. Após a confirmação da assinatura, você entra diretamente no painel CriptoPro e realiza ali a configuração do robô, cadastro das APIs da Binance, definição dos recursos do seu plano, acompanhamento das operações, indicadores, histórico e relatórios.</p>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="section-title">
      <h2>Compare os planos</h2>
      <p>Os limites do painel acompanham a assinatura ativa.</p>
    </div>
    <div class="comparison-wrapper">
      <table class="comparison">
        <thead>
          <tr>
            <th>Recurso</th>
            <th>Básico</th>
            <th class="highlight">Profissional</th>
            <th>Premium</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Operações simultâneas</td><td>1</td><td class="highlight">2</td><td>3</td></tr>
          <tr><td>Contas Binance</td><td>1</td><td class="highlight">2</td><td>3</td></tr>
          <tr><td>Painel de acompanhamento</td><td class="yes">✓</td><td class="yes highlight">✓</td><td class="yes">✓</td></tr>
          <tr><td>Monitoramento</td><td class="yes">✓</td><td class="yes highlight">✓</td><td class="yes">✓</td></tr>
          <tr><td>Indicadores e histórico</td><td class="yes">✓</td><td class="yes highlight">✓</td><td class="yes">✓</td></tr>
          <tr><td>Acesso condicionado ao pagamento</td><td class="yes">✓</td><td class="yes highlight">✓</td><td class="yes">✓</td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <section class="section">
    <div class="section-title">
      <h2>Como funciona</h2>
      <p>Do cadastro ao painel liberado.</p>
    </div>
    <div class="how-it-works">
      <div class="step"><div class="step-number">1</div><h3>Escolha o plano</h3><p>Selecione Básico, Profissional ou Premium conforme os recursos desejados.</p></div>
      <div class="step"><div class="step-number">2</div><h3>Informe seus dados</h3><p>Preencha os dados necessários para iniciar a assinatura.</p></div>
      <div class="step"><div class="step-number">3</div><h3>Efetue o pagamento</h3><p>O pagamento é processado pelo fluxo seguro de cobrança da CriptoPro.</p></div>
      <div class="step"><div class="step-number">4</div><h3>Painel liberado</h3><p>Após a confirmação do pagamento, o painel CriptoPro é liberado diretamente para configurar o robô, as APIs da Binance e acessar relatórios e acompanhamento conforme o plano.</p></div>
    </div>
  </section>

  <section class="section">
    <div class="section-title">
      <h2>Configuração do robô</h2>
      <p>O painel será configurado de acordo com a assinatura ativa.</p>
    </div>
    <div class="robot-box">
      <p class="robot-intro">Após o pagamento, o cliente não precisa passar por uma página de dashboard separada. O próprio painel CriptoPro concentra a configuração do robô, conexão das APIs da Binance, acompanhamento das operações, indicadores, histórico e relatórios. A assinatura define automaticamente os recursos disponíveis.</p>
      <div class="robot-grid">
        <div class="robot-item"><strong>Plano Básico</strong><span>Até 1 operação simultânea e 1 conta Binance.</span></div>
        <div class="robot-item"><strong>Plano Profissional</strong><span>Até 2 operações simultâneas e 2 contas Binance.</span></div>
        <div class="robot-item"><strong>Plano Premium</strong><span>Até 3 operações simultâneas e 3 contas Binance.</span></div>
      </div>
    </div>
  </section>

  <div class="security">
    <strong>🔐 Segurança e controle de acesso</strong>
    <p>🔒 O painel permanece bloqueado enquanto não existir uma assinatura ativa. Após a confirmação financeira pelo webhook, o acesso é liberado e o painel identifica o plano contratado para disponibilizar somente os recursos correspondentes.</p>
  </div>
</main>

<footer>© CriptoPro — Plataforma de operações e monitoramento.</footer>

<div class="modal-overlay" id="modalOverlay">
  <div class="modal">
    <h3 id="modalTitle">Plano selecionado</h3>
    <p id="modalText"></p>
    <div class="modal-actions">
      <button class="secondary" onclick="fecharModal()">Voltar</button>
      <button class="primary" onclick="iniciarPagamento()">CONTINUAR</button>
    </div>
  </div>
</div>

<script>
function selecionarPlano(codigo,nome,preco){
  localStorage.setItem("criptopro_selected_plan",codigo);
  localStorage.setItem("criptopro_selected_plan_name",nome);
  localStorage.setItem("criptopro_selected_plan_price",preco);
  document.getElementById("modalTitle").textContent="Plano CriptoPro "+nome;
  document.getElementById("modalText").textContent="Você selecionou o plano "+nome+" — "+preco+". Continue para preencher seus dados e efetuar o pagamento.";
  document.getElementById("modalOverlay").style.display="flex";
}
function fecharModal(){document.getElementById("modalOverlay").style.display="none"}
function iniciarPagamento(){
  const plano=localStorage.getItem("criptopro_selected_plan");
  if(!plano){alert("Nenhum plano foi selecionado.");return}
  window.location.href="/pagamento.html?plan="+encodeURIComponent(plano);
}
async function acessarPainel(){
  const btn=document.getElementById("accessBtn");
  const statusText=document.getElementById("accessStatusText");
  const statusTitle=document.getElementById("accessStatusTitle");
  const icon=document.getElementById("accessIcon");
  const title=document.getElementById("accessTitle");
  const topBtn=document.getElementById("topPanelBtn");
  const topText=document.getElementById("topPanelText");
  const token=localStorage.getItem("token");

  if(!token){
    statusTitle.textContent="Login necessário";
    statusText.textContent="Entre na sua conta para verificar se existe uma assinatura ativa.";
    alert("Faça login para acessar o painel.");
    window.location.href="/login.html?redirect=/";
    return;
  }

  btn.disabled=true;
  btn.textContent="VERIFICANDO...";
  statusText.textContent="Verificando sua assinatura...";

  try{
    const response=await fetch("/api/subscription/status",{
      headers:{Authorization:"Bearer "+token}
    });
    const data=await response.json();

    if(!response.ok || !data.active){
      icon.textContent="🔒";
      title.textContent="Painel bloqueado";
      statusTitle.textContent="Assinatura não ativa";
      statusText.textContent="Conclua o pagamento e aguarde a confirmação para liberar o painel.";
      btn.textContent="🔒 PAINEL BLOQUEADO";
      topBtn.classList.add("locked");
      topText.textContent="Painel bloqueado";
      return;
    }

    icon.textContent="🔓";
    title.textContent="Painel liberado";
    statusTitle.textContent="Assinatura ativa";
    statusText.textContent="Plano "+(data.planName||data.plan)+" ativo. Seus recursos serão configurados conforme o plano.";
    btn.classList.add("ready");
    btn.textContent="🔓 ACESSAR PAINEL";
    topBtn.classList.remove("locked");
    topText.textContent="Acessar painel";

    setTimeout(()=>window.location.href="/",150);
  }catch(error){
    statusTitle.textContent="Não foi possível verificar";
    statusText.textContent="Tente novamente em alguns segundos.";
    btn.textContent="🔒 TENTAR NOVAMENTE";
  }finally{
    btn.disabled=false;
  }
}

document.addEventListener("DOMContentLoaded",async()=>{
  const token=localStorage.getItem("token");
  if(!token)return;
  try{
    const r=await fetch("/api/subscription/status",{headers:{Authorization:"Bearer "+token}});
    const d=await r.json();
    if(r.ok&&d.active){
      document.getElementById("accessIcon").textContent="🔓";
      document.getElementById("accessTitle").textContent="Painel liberado";
      document.getElementById("accessStatusTitle").textContent="Assinatura ativa";
      document.getElementById("accessStatusText").textContent="Plano "+(d.planName||d.plan)+" ativo.";
      document.getElementById("accessBtn").classList.add("ready");
      document.getElementById("accessBtn").textContent="🔓 ACESSAR PAINEL";
      document.getElementById("topPanelBtn").classList.remove("locked");
      document.getElementById("topPanelText").textContent="Acessar painel";
    }
  }catch(e){}
});
</script>



<script src="/js/idioma.js"></script>

<script>
function voltarLogin(){
  window.location.href = "https://site--painel-binance--clbfrw28wczh.code.run/login.html";
}

function sairSistema(){
  localStorage.removeItem("token");
  localStorage.removeItem("criptopro_selected_plan");
  localStorage.removeItem("criptopro_selected_plan_name");
  localStorage.removeItem("criptopro_selected_plan_price");
  localStorage.removeItem("criptopro_user");

  window.location.href = "https://site--painel-binance--clbfrw28wczh.code.run/login.html";
}
</script>

</body>
</html>
