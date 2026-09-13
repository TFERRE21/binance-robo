<!DOCTYPE html>
<html lang="pt-BR">

<head>
  <meta charset="UTF-8">

  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  >

  <title>Binance-Robo | Painel</title>

  <style>

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      background: #050914;
      color: #f4f7fb;
      font-family: Arial, Helvetica, sans-serif;
    }

    button,
    select,
    input {
      font-family: inherit;
    }

    button {
      cursor: pointer;
    }

    .container {
      width: min(1180px, 94%);
      margin: 0 auto;
      padding: 22px 0 50px;
    }

    /* =====================================================
       CABEÇALHO
    ===================================================== */

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 20px;
      margin-bottom: 18px;
    }

    .brand h1 {
      margin: 0;
      font-size: 25px;
    }

    .brand p {
      margin: 5px 0 0;
      color: #8995aa;
      font-size: 12px;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .btn {
      border: 1px solid #263754;
      background: #0d1729;
      color: #fff;
      padding: 9px 14px;
      border-radius: 7px;
      font-size: 12px;
      font-weight: bold;
    }

    .btn:hover {
      background: #14233b;
    }

    .btn-primary {
      background: #172b4b;
      border-color: #31527d;
    }

    .btn-success {
      background: #075a43;
      border-color: #0d8060;
    }

    .btn-danger {
      background: #761d2a;
      border-color: #b52a3e;
    }

    .btn-warning {
      background: #765c09;
      border-color: #b58c12;
    }

    .btn-blue {
      background: #19395d;
      border-color: #2b5e94;
    }

    /* =====================================================
       IDIOMA
    ===================================================== */

    .language-box {
      display: flex;
      align-items: center;
      gap: 6px;
      background: #0c1525;
      border: 1px solid #263754;
      padding: 5px;
      border-radius: 8px;
    }

    .language-label {
      font-size: 11px;
      color: #9ba8bc;
      padding-left: 5px;
    }

    .language-btn {
      border: 1px solid transparent;
      background: transparent;
      color: #aab5c7;
      padding: 7px 10px;
      border-radius: 5px;
      font-size: 11px;
      font-weight: bold;
    }

    .language-btn.active {
      background: #1b2d4a;
      color: #fff;
      border-color: #38587f;
    }

    /* =====================================================
       CARD
    ===================================================== */

    .card {
      background: #0b1525;
      border: 1px solid #233652;
      border-radius: 9px;
      padding: 16px;
      margin-bottom: 14px;
    }

    .account-card {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 20px;
    }

    .account-name {
      font-size: 19px;
      font-weight: bold;
    }

    .connected {
      margin-top: 6px;
      color: #25d99a;
      font-size: 12px;
      font-weight: bold;
    }

    .updated {
      color: #75839a;
      font-size: 10px;
    }

    /* =====================================================
       SEGURANÇA
    ===================================================== */

    .security {
      border: 1px solid #947600;
      background: #211b05;
      color: #ffd84d;
    }

    .security strong {
      display: block;
      margin-bottom: 9px;
      font-size: 13px;
    }

    .security p {
      margin: 6px 0;
      font-size: 11px;
      line-height: 1.5;
    }

    /* =====================================================
       NAVEGAÇÃO
    ===================================================== */

    .nav-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 7px;
      margin-bottom: 15px;
    }

    .nav-btn {
      min-height: 35px;
      border: 1px solid #273a59;
      background: #0b1525;
      color: #e8edf5;
      border-radius: 6px;
      font-size: 11px;
      font-weight: bold;
    }

    .nav-btn:hover,
    .nav-btn.active {
      background: #172a46;
      border-color: #3c6594;
    }

    /* =====================================================
       RESUMO
    ===================================================== */

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
      margin-bottom: 15px;
    }

    .summary-card {
      min-height: 90px;
    }

    .summary-label {
      color: #7e8da4;
      font-size: 10px;
      text-transform: uppercase;
      margin-bottom: 7px;
    }

    .summary-value {
      font-size: 19px;
      font-weight: bold;
    }

    .summary-small {
      color: #8290a7;
      font-size: 10px;
      margin-top: 6px;
    }

    /* =====================================================
       SEÇÕES
    ===================================================== */

    .section {
      display: none;
    }

    .section.active {
      display: block;
    }

    .section-title {
      font-size: 17px;
      margin: 0 0 5px;
    }

    .section-subtitle {
      color: #8290a7;
      font-size: 11px;
      margin-bottom: 15px;
    }

    /* =====================================================
       OPERAÇÃO
    ===================================================== */

    .operation-top {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    .operation-symbol {
      font-size: 25px;
      font-weight: bold;
    }

    .positive {
      color: #20d897;
    }

    .negative {
      color: #ff5366;
    }

    .neutral {
      color: #aeb8c8;
    }

    .operation-grid {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 8px;
      margin-top: 12px;
    }

    .metric {
      background: #08111f;
      border: 1px solid #233652;
      border-radius: 7px;
      padding: 11px;
      min-height: 70px;
    }

    .metric-label {
      color: #74839a;
      font-size: 9px;
      text-transform: uppercase;
    }

    .metric-value {
      margin-top: 7px;
      font-size: 13px;
      font-weight: bold;
    }

    .manual-box {
      margin-top: 14px;
      background: #08111f;
      border: 1px solid #2c405f;
      border-radius: 8px;
      padding: 14px;
    }

    .manual-title {
      font-size: 13px;
      font-weight: bold;
      margin-bottom: 10px;
    }

    .manual-controls {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    .quantity-input {
      width: 100%;
      background: #050b15;
      color: white;
      border: 1px solid #30425e;
      border-radius: 6px;
      padding: 10px;
      outline: none;
    }

    .manual-buttons {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin-top: 10px;
    }

    .order-box {
      margin-top: 12px;
      padding: 10px;
      background: #07101c;
      border: 1px solid #233652;
      border-radius: 7px;
    }

    .order-item {
      padding: 8px 0;
      border-bottom: 1px solid #1d2a40;
      font-size: 11px;
    }

    .order-item:last-child {
      border-bottom: 0;
    }

    /* =====================================================
       MOEDAS
    ===================================================== */

    .coins-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }

    .coins-table th,
    .coins-table td {
      padding: 10px 8px;
      border-bottom: 1px solid #1c2a40;
      text-align: right;
    }

    .coins-table th:first-child,
    .coins-table td:first-child {
      text-align: left;
    }

    .coins-table th {
      color: #75849b;
      font-size: 9px;
      text-transform: uppercase;
    }

    .coin-name {
      font-weight: bold;
      color: #fff;
    }

    /* =====================================================
       GRÁFICO
    ===================================================== */

    .chart-controls {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 10px;
    }

    .chart-symbol {
      background: #050b15;
      color: white;
      border: 1px solid #30425e;
      padding: 8px;
      border-radius: 6px;
    }

    canvas {
      width: 100%;
      height: 360px;
      background: #050b15;
      border: 1px solid #233652;
      border-radius: 8px;
    }

    /* =====================================================
       VÍDEOS
    ===================================================== */

    .videos-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }

    .video-card h3 {
      margin-top: 0;
      font-size: 14px;
    }

    .video-card iframe {
      width: 100%;
      aspect-ratio: 16 / 9;
      border: 0;
      border-radius: 7px;
    }

    /* =====================================================
       TABELAS / PLACEHOLDER
    ===================================================== */

    .empty {
      text-align: center;
      padding: 30px 10px;
      color: #7d8ba2;
      font-size: 12px;
    }

    .info-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
    }

    /* =====================================================
       ALERTAS
    ===================================================== */

    .alert {
      border: 1px solid #30405c;
      background: #08111f;
      padding: 11px;
      border-radius: 7px;
      margin-bottom: 8px;
      font-size: 11px;
    }

    .alert-warning {
      border-color: #856d0b;
      background: #211b05;
      color: #ffd84d;
    }

    /* =====================================================
       RESPONSIVO
    ===================================================== */

    @media (max-width: 800px) {

      .nav-grid {
        grid-template-columns: repeat(2, 1fr);
      }

      .summary-grid {
        grid-template-columns: 1fr;
      }

      .operation-top {
        grid-template-columns: 1fr;
      }

      .operation-grid {
        grid-template-columns: repeat(2, 1fr);
      }

      .manual-buttons {
        grid-template-columns: 1fr;
      }

      .videos-grid {
        grid-template-columns: 1fr;
      }

      .info-grid {
        grid-template-columns: 1fr 1fr;
      }

      .header {
        align-items: flex-start;
        flex-direction: column;
      }

    }

  </style>
</head>


<body>

<div class="container">

  <!-- ===================================================
       CABEÇALHO
  ==================================================== -->

  <header class="header">

    <div class="brand">

      <h1>Binance-Robo</h1>

      <p data-i18n="subtitle">
        Painel individual da conta Binance
      </p>

    </div>


    <div class="header-actions">

      <div class="language-box">

        <span
          class="language-label"
          data-i18n="language"
        >
          🌎 Idioma
        </span>

        <button
          class="language-btn active"
          id="ptBtn"
          type="button"
        >
          🇧🇷 PT
        </button>

        <button
          class="language-btn"
          id="enBtn"
          type="button"
        >
          🇺🇸 EN
        </button>

      </div>


      <button
        class="btn"
        id="backBtn"
        type="button"
        data-i18n="back"
      >
        ← Voltar
      </button>


      <button
        class="btn"
        id="logoutBtn"
        type="button"
        data-i18n="logout"
      >
        Sair
      </button>

    </div>

  </header>


  <!-- ===================================================
       CONTA
  ==================================================== -->

  <section class="card account-card">

    <div>

      <div
        class="account-name"
        id="accountName"
      >
        Carregando...
      </div>

      <div
        class="connected"
        id="connectionStatus"
      >
        ● Conectando...
      </div>

    </div>


    <div
      class="updated"
      id="lastUpdate"
    >
      --
    </div>

  </section>


  <!-- ===================================================
       SEGURANÇA
  ==================================================== -->

  <section class="card security">

    <strong data-i18n="securityTitle">
      ⚠ SEGURANÇA DA API BINANCE
    </strong>

    <p data-i18n="security1">
      Mantenha a permissão de saques/withdrawal DESATIVADA.
    </p>

    <p data-i18n="security2">
      O painel deve utilizar somente as permissões necessárias
      para leitura e negociação.
    </p>

    <p data-i18n="security3">
      Nunca compartilhe sua API Key ou API Secret.
    </p>

  </section>


  <!-- ===================================================
       NAVEGAÇÃO
  ==================================================== -->

  <nav class="nav-grid">

    <button
      class="nav-btn active"
      data-section="operation"
      data-i18n="operation"
    >
      🎯 Operação
    </button>

    <button
      class="nav-btn"
      data-section="chart"
      data-i18n="chart"
    >
      📊 Gráfico
    </button>

    <button
      class="nav-btn"
      data-section="bot"
      data-i18n="bot"
    >
      🤖 Robô
    </button>

    <button
      class="nav-btn"
      data-section="comparison"
      data-i18n="comparison"
    >
      🏆 Comparação
    </button>

    <button
      class="nav-btn"
      data-section="performance"
      data-i18n="performance"
    >
      📚 Performance
    </button>

    <button
      class="nav-btn"
      data-section="coins"
      data-i18n="coins"
    >
      🪙 Moedas
    </button>

    <button
      class="nav-btn"
      data-section="activity"
      data-i18n="activity"
    >
      📜 Atividade
    </button>

    <button
      class="nav-btn"
      data-section="alerts"
      data-i18n="alerts"
    >
      🚨 Alertas
    </button>

    <button
      class="nav-btn"
      data-section="equity"
      data-i18n="equity"
    >
      📈 Patrimônio
    </button>

    <button
      class="nav-btn"
      data-section="xray"
      data-i18n="xray"
    >
      🧪 Raio-X
    </button>

    <button
      class="nav-btn"
      data-section="audit"
      data-i18n="audit"
    >
      🕵️ Auditoria
    </button>

    <button
      class="nav-btn"
      data-section="pnl"
      data-i18n="pnl"
    >
      💰 P/L
    </button>

  </nav>


  <!-- ===================================================
       RESUMO
  ==================================================== -->

  <section class="summary-grid">

    <div class="card summary-card">

      <div
        class="summary-label"
        data-i18n="currentOperation"
      >
        Operação atual
      </div>

      <div
        class="summary-value"
        id="summaryOperation"
      >
        --
      </div>

      <div
        class="summary-small"
        id="summaryOperationStatus"
      >
        Aguardando dados...
      </div>

    </div>


    <div class="card summary-card">

      <div
        class="summary-label"
        data-i18n="equity"
      >
        Patrimônio
      </div>

      <div
        class="summary-value"
        id="summaryEquity"
      >
        0.00 USDT
      </div>

      <div
        class="summary-small"
        data-i18n="estimatedValue"
      >
        Valor estimado da conta
      </div>

    </div>


    <div class="card summary-card">

      <div
        class="summary-label"
        data-i18n="availableBalance"
      >
        Saldo disponível
      </div>

      <div
        class="summary-value"
        id="summaryAvailable"
      >
        0.00 USDT
      </div>

      <div
        class="summary-small"
        data-i18n="availableForTrading"
      >
        Disponível para negociação
      </div>

    </div>

  </section>


  <!-- ===================================================
       OPERAÇÃO
  ==================================================== -->

  <section
    id="section-operation"
    class="section active"
  >

    <div class="card">

      <h2
        class="section-title"
        data-i18n="operationTitle"
      >
        🎯 Operação da conta
      </h2>

      <div
        class="section-subtitle"
        data-i18n="operationSubtitle"
      >
        Acompanhamento da posição e controle manual.
      </div>


      <div class="operation-top">

        <div>

          <div
            class="summary-label"
            data-i18n="symbol"
          >
            Ativo
          </div>

          <div
            class="operation-symbol"
            id="operationSymbol"
          >
            --
          </div>

          <div
            id="operationStatus"
            class="summary-small"
          >
            Aguardando operação...
          </div>

        </div>


        <div>

          <div
            class="summary-label"
            data-i18n="selectAsset"
          >
            Selecionar ativo
          </div>

          <select
            id="symbolSelect"
            class="chart-symbol"
            style="width:100%;"
          >
            <option value="">
              Carregando ativos...
            </option>
          </select>

        </div>

      </div>


      <div class="operation-grid">

        <div class="metric">

          <div
            class="metric-label"
            data-i18n="entry"
          >
            Entrada
          </div>

          <div
            class="metric-value"
            id="entryPrice"
          >
            --
          </div>

        </div>


        <div class="metric">

          <div
            class="metric-label"
            data-i18n="currentPrice"
          >
            Preço atual
          </div>

          <div
            class="metric-value"
            id="currentPrice"
          >
            --
          </div>

        </div>


        <div class="metric">

          <div
            class="metric-label"
            data-i18n="pnl"
          >
            P/L
          </div>

          <div
            class="metric-value"
            id="operationPnl"
          >
            --
          </div>

        </div>


        <div class="metric">

          <div
            class="metric-label"
            data-i18n="quantity"
          >
            Quantidade
          </div>

          <div
            class="metric-value"
            id="operationQuantity"
          >
            --
          </div>

        </div>


        <div class="metric">

          <div
            class="metric-label"
            data-i18n="currentValue"
          >
            Valor atual
          </div>

          <div
            class="metric-value"
            id="operationValue"
          >
            --
          </div>

        </div>

      </div>


      <!-- CONTROLE MANUAL -->

      <div class="manual-box">

        <div
          class="manual-title"
          data-i18n="manualControl"
        >
          🎛 CONTROLE MANUAL
        </div>


        <div class="manual-controls">

          <div>

            <div
              class="summary-small"
              data-i18n="quantityToSell"
            >
              Quantidade para venda
            </div>

            <input
              id="sellQuantity"
              class="quantity-input"
              type="number"
              step="any"
              placeholder="0.000000"
            >

          </div>


          <div>

            <div
              class="summary-small"
              data-i18n="estimatedValue"
            >
              Valor estimado
            </div>

            <div
              class="metric-value"
              id="sellEstimatedValue"
              style="padding:10px;"
            >
              0.00 USDT
            </div>

          </div>

        </div>


        <div class="manual-buttons">

          <button
            id="sellButton"
            class="btn btn-danger"
            type="button"
            data-i18n="sellPosition"
          >
            🔴 VENDER POSIÇÃO
          </button>

          <button
            id="cancelSellButton"
            class="btn btn-warning"
            type="button"
            data-i18n="cancelSell"
          >
            🟠 CANCELAR VENDA ATIVA
          </button>

          <button
            id="refreshOperationButton"
            class="btn btn-blue"
            type="button"
            data-i18n="refresh"
          >
            🔄 ATUALIZAR VALOR
          </button>

        </div>


        <div
          id="manualMessage"
          class="summary-small"
          style="margin-top:10px;"
        ></div>

      </div>


      <!-- ORDENS SELL -->

      <div
        id="sellOrdersBox"
        class="order-box"
      >

        <strong
          data-i18n="activeSellOrders"
        >
          Ordens SELL ativas
        </strong>

        <div
          id="sellOrders"
          class="summary-small"
          style="margin-top:8px;"
        >
          Nenhuma ordem encontrada.
        </div>

      </div>

    </div>

  </section>


  <!-- ===================================================
       GRÁFICO
  ==================================================== -->

  <section
    id="section-chart"
    class="section"
  >

    <div class="card">

      <h2
        class="section-title"
        data-i18n="chartTitle"
      >
        📊 Gráfico
      </h2>

      <div
        class="section-subtitle"
        data-i18n="chartSubtitle"
      >
        Histórico de preço do ativo selecionado.
      </div>


      <div class="chart-controls">

        <select
          id="chartSymbol"
          class="chart-symbol"
        ></select>


        <select
          id="chartInterval"
          class="chart-symbol"
        >

          <option value="5m">
            5m
          </option>

          <option value="15m" selected>
            15m
          </option>

          <option value="1h">
            1h
          </option>

          <option value="4h">
            4h
          </option>

          <option value="1d">
            1d
          </option>

        </select>


        <button
          id="loadChartButton"
          class="btn btn-blue"
          type="button"
          data-i18n="loadChart"
        >
          Atualizar gráfico
        </button>

      </div>


      <canvas
        id="chartCanvas"
        width="1100"
        height="360"
      ></canvas>

    </div>

  </section>


  <!-- ===================================================
       MOEDAS
  ==================================================== -->

  <section
    id="section-coins"
    class="section"
  >

    <div class="card">

      <h2
        class="section-title"
        data-i18n="coinsTitle"
      >
        🪙 Moedas
      </h2>

      <div
        class="section-subtitle"
        data-i18n="coinsSubtitle"
      >
        Ativos encontrados na conta Binance.
      </div>


      <div style="overflow-x:auto;">

        <table class="coins-table">

          <thead>

            <tr>

              <th data-i18n="asset">
                Moeda
              </th>

              <th data-i18n="free">
                Disponível
              </th>

              <th data-i18n="locked">
                Bloqueado
              </th>

              <th data-i18n="price">
                Preço
              </th>

              <th data-i18n="value">
                Valor
              </th>

            </tr>

          </thead>

          <tbody id="coinsTableBody">

            <tr>

              <td colspan="5" class="empty">
                Carregando moedas...
              </td>

            </tr>

          </tbody>

        </table>

      </div>

    </div>

  </section>


  <!-- ===================================================
       PATRIMÔNIO
  ==================================================== -->

  <section
    id="section-equity"
    class="section"
  >

    <div class="card">

      <h2
        class="section-title"
        data-i18n="equityTitle"
      >
        📈 Patrimônio
      </h2>


      <div class="info-grid">

        <div class="metric">

          <div
            class="metric-label"
            data-i18n="totalEquity"
          >
            Patrimônio total
          </div>

          <div
            class="metric-value"
            id="equityTotal"
          >
            0.00 USDT
          </div>

        </div>


        <div class="metric">

          <div
            class="metric-label"
            data-i18n="available"
          >
            Disponível
          </div>

          <div
            class="metric-value"
            id="equityAvailable"
          >
            0.00 USDT
          </div>

        </div>


        <div class="metric">

          <div
            class="metric-label"
            data-i18n="locked"
          >
            Bloqueado
          </div>

          <div
            class="metric-value"
            id="equityLocked"
          >
            0.00 USDT
          </div>

        </div>


        <div class="metric">

          <div
            class="metric-label"
            data-i18n="assets"
          >
            Ativos
          </div>

          <div
            class="metric-value"
            id="equityAssets"
          >
            0
          </div>

        </div>

      </div>

    </div>

  </section>


  <!-- ===================================================
       ALERTAS
  ==================================================== -->

  <section
    id="section-alerts"
    class="section"
  >

    <div class="card">

      <h2
        class="section-title"
        data-i18n="alertsTitle"
      >
        🚨 Alertas
      </h2>


      <div class="alert alert-warning">

        ⚠

        <span data-i18n="withdrawalWarning">
          Mantenha os saques/withdrawal da API Binance
          desativados.
        </span>

      </div>


      <div
        id="dynamicAlerts"
        class="alert"
      >
        Nenhum alerta adicional.
      </div>

    </div>

  </section>


  <!-- ===================================================
       ROBÔ
  ==================================================== -->

  <section
    id="section-bot"
    class="section"
  >

    <div class="card">

      <h2
        class="section-title"
        data-i18n="botTitle"
      >
        🤖 Robô
      </h2>

      <div class="empty">

        <div data-i18n="botComing">
          Configurações do robô serão disponibilizadas
          nesta área.
        </div>

      </div>

    </div>

  </section>


  <!-- ===================================================
       COMPARAÇÃO
  ==================================================== -->

  <section
    id="section-comparison"
    class="section"
  >

    <div class="card">

      <h2
        class="section-title"
        data-i18n="comparisonTitle"
      >
        🏆 Comparação
      </h2>

      <div class="empty">
        Dados de comparação serão apresentados aqui.
      </div>

    </div>

  </section>


  <!-- ===================================================
       PERFORMANCE
  ==================================================== -->

  <section
    id="section-performance"
    class="section"
  >

    <div class="card">

      <h2
        class="section-title"
        data-i18n="performanceTitle"
      >
        📚 Performance
      </h2>

      <div class="empty">
        Histórico de performance em preparação.
      </div>

    </div>

  </section>


  <!-- ===================================================
       ATIVIDADE
  ==================================================== -->

  <section
    id="section-activity"
    class="section"
  >

    <div class="card">

      <h2
        class="section-title"
        data-i18n="activityTitle"
      >
        📜 Atividade
      </h2>

      <div class="empty">
        Histórico de atividades em preparação.
      </div>

    </div>

  </section>


  <!-- ===================================================
       RAIO-X
  ==================================================== -->

  <section
    id="section-xray"
    class="section"
  >

    <div class="card">

      <h2
        class="section-title"
        data-i18n="xrayTitle"
      >
        🧪 Raio-X
      </h2>

      <div class="empty">
        Análise detalhada da conta em preparação.
      </div>

    </div>

  </section>


  <!-- ===================================================
       AUDITORIA
  ==================================================== -->

  <section
    id="section-audit"
    class="section"
  >

    <div class="card">

      <h2
        class="section-title"
        data-i18n="auditTitle"
      >
        🕵️ Auditoria
      </h2>

      <div class="empty">
        Auditoria da conta em preparação.
      </div>

    </div>

  </section>


  <!-- ===================================================
       P/L
  ==================================================== -->

  <section
    id="section-pnl"
    class="section"
  >

    <div class="card">

      <h2
        class="section-title"
        data-i18n="pnlTitle"
      >
        💰 P/L
      </h2>

      <div class="info-grid">

        <div class="metric">

          <div
            class="metric-label"
            data-i18n="unrealizedPnl"
          >
            P/L atual
          </div>

          <div
            class="metric-value"
            id="pnlTotal"
          >
            --
          </div>

        </div>

      </div>

    </div>

  </section>


  <!-- ===================================================
       VÍDEOS
  ==================================================== -->

  <section class="card">

    <h2
      class="section-title"
      data-i18n="tutorialTitle"
    >
      🎬 Como criar sua API Binance
    </h2>

    <div
      class="section-subtitle"
      data-i18n="tutorialSubtitle"
    >
      Aprenda a criar sua API com segurança.
    </div>


    <div class="videos-grid">

      <!-- PORTUGUÊS -->

      <div class="video-card">

        <h3>
          🇧🇷
          <span data-i18n="portuguese">
            Português
          </span>
        </h3>

        <iframe
          src="https://www.youtube.com/embed/BlKB44v_dE0"
          title="Como Criar e Gerar suas Chaves API na Binance"
          allowfullscreen
        ></iframe>

      </div>


      <!-- INGLÊS -->

      <div class="video-card">

        <h3>
          🇺🇸
          <span data-i18n="english">
            English
          </span>
        </h3>

        <iframe
          src="https://www.youtube.com/embed/zP3PgzGdA9M"
          title="How to SET UP API KEY on Binance"
          allowfullscreen
        ></iframe>

      </div>

    </div>

  </section>


  <div
    style="
      text-align:center;
      color:#52627a;
      font-size:10px;
      margin-top:20px;
    "
  >
    Binance-Robo • Painel Individual
  </div>

</div>


<script>

  // =====================================================
  // CONFIGURAÇÃO
  // =====================================================

  const token =
    localStorage.getItem("token");

  const params =
    new URLSearchParams(
      window.location.search
    );

  const accountId =
    params.get("account");


  if (!token) {

    window.location.href =
      "login.html";

  }


  if (!accountId) {

    alert(
      "Conta Binance não informada."
    );

  }


  // =====================================================
  // ESTADO
  // =====================================================

  let accountData = null;

  let currentOperation = null;

  let currentLanguage =
    localStorage.getItem(
      "painelLanguage"
    ) || "pt";


  // =====================================================
  // TRADUÇÕES
  // =====================================================

  const translations = {

    pt: {

      subtitle:
        "Painel individual da conta Binance",

      language:
        "🌎 Idioma",

      back:
        "← Voltar",

      logout:
        "Sair",

      securityTitle:
        "⚠ SEGURANÇA DA API BINANCE",

      security1:
        "Mantenha a permissão de saques/withdrawal DESATIVADA.",

      security2:
        "O painel deve utilizar somente as permissões necessárias para leitura e negociação.",

      security3:
        "Nunca compartilhe sua API Key ou API Secret.",

      operation:
        "🎯 Operação",

      chart:
        "📊 Gráfico",

      bot:
        "🤖 Robô",

      comparison:
        "🏆 Comparação",

      performance:
        "📚 Performance",

      coins:
        "🪙 Moedas",

      activity:
        "📜 Atividade",

      alerts:
        "🚨 Alertas",

      equity:
        "📈 Patrimônio",

      xray:
        "🧪 Raio-X",

      audit:
        "🕵️ Auditoria",

      pnl:
        "💰 P/L",

      currentOperation:
        "Operação atual",

      estimatedValue:
        "Valor estimado da conta",

      availableBalance:
        "Saldo disponível",

      availableForTrading:
        "Disponível para negociação",

      operationTitle:
        "🎯 Operação da conta",

      operationSubtitle:
        "Acompanhamento da posição e controle manual.",

      symbol:
        "Ativo",

      selectAsset:
        "Selecionar ativo",

      entry:
        "Entrada",

      currentPrice:
        "Preço atual",

      quantity:
        "Quantidade",

      currentValue:
        "Valor atual",

      manualControl:
        "🎛 CONTROLE MANUAL",

      quantityToSell:
        "Quantidade para venda",

      sellPosition:
        "🔴 VENDER POSIÇÃO",

      cancelSell:
        "🟠 CANCELAR VENDA ATIVA",

      refresh:
        "🔄 ATUALIZAR VALOR",

      activeSellOrders:
        "Ordens SELL ativas",

      chartTitle:
        "📊 Gráfico",

      chartSubtitle:
        "Histórico de preço do ativo selecionado.",

      loadChart:
        "Atualizar gráfico",

      coinsTitle:
        "🪙 Moedas",

      coinsSubtitle:
        "Ativos encontrados na conta Binance.",

      asset:
        "Moeda",

      free:
        "Disponível",

      locked:
        "Bloqueado",

      price:
        "Preço",

      value:
        "Valor",

      equityTitle:
        "📈 Patrimônio",

      totalEquity:
        "Patrimônio total",

      available:
        "Disponível",

      assets:
        "Ativos",

      alertsTitle:
        "🚨 Alertas",

      withdrawalWarning:
        "Mantenha os saques/withdrawal da API Binance desativados.",

      botTitle:
        "🤖 Robô",

      botComing:
        "Configurações do robô serão disponibilizadas nesta área.",

      comparisonTitle:
        "🏆 Comparação",

      performanceTitle:
        "📚 Performance",

      activityTitle:
        "📜 Atividade",

      xrayTitle:
        "🧪 Raio-X",

      auditTitle:
        "🕵️ Auditoria",

      pnlTitle:
        "💰 P/L",

      unrealizedPnl:
        "P/L atual",

      tutorialTitle:
        "🎬 Como criar sua API Binance",

      tutorialSubtitle:
        "Aprenda a criar sua API com segurança.",

      portuguese:
        "Português",

      english:
        "English"

    },


    en: {

      subtitle:
        "Individual Binance account dashboard",

      language:
        "🌎 Language",

      back:
        "← Back",

      logout:
        "Logout",

      securityTitle:
        "⚠ BINANCE API SECURITY",

      security1:
        "Keep API withdrawals disabled.",

      security2:
        "The dashboard should use only the permissions required for reading and trading.",

      security3:
        "Never share your API Key or API Secret.",

      operation:
        "🎯 Operation",

      chart:
        "📊 Chart",

      bot:
        "🤖 Bot",

      comparison:
        "🏆 Comparison",

      performance:
        "📚 Performance",

      coins:
        "🪙 Assets",

      activity:
        "📜 Activity",

      alerts:
        "🚨 Alerts",

      equity:
        "📈 Equity",

      xray:
        "🧪 X-Ray",

      audit:
        "🕵️ Audit",

      pnl:
        "💰 P/L",

      currentOperation:
        "Current operation",

      estimatedValue:
        "Estimated account value",

      availableBalance:
        "Available balance",

      availableForTrading:
        "Available for trading",

      operationTitle:
        "🎯 Account operation",

      operationSubtitle:
        "Position monitoring and manual control.",

      symbol:
        "Asset",

      selectAsset:
        "Select asset",

      entry:
        "Entry",

      currentPrice:
        "Current price",

      quantity:
        "Quantity",

      currentValue:
        "Current value",

      manualControl:
        "🎛 MANUAL CONTROL",

      quantityToSell:
        "Quantity to sell",

      sellPosition:
        "🔴 SELL POSITION",

      cancelSell:
        "🟠 CANCEL ACTIVE SELL",

      refresh:
        "🔄 REFRESH VALUE",

      activeSellOrders:
        "Active SELL orders",

      chartTitle:
        "📊 Chart",

      chartSubtitle:
        "Price history for the selected asset.",

      loadChart:
        "Refresh chart",

      coinsTitle:
        "🪙 Assets",

      coinsSubtitle:
        "Assets found in the Binance account.",

      asset:
        "Asset",

      free:
        "Available",

      locked:
        "Locked",

      price:
        "Price",

      value:
        "Value",

      equityTitle:
        "📈 Equity",

      totalEquity:
        "Total equity",

      available:
        "Available",

      assets:
        "Assets",

      alertsTitle:
        "🚨 Alerts",

      withdrawalWarning:
        "Keep Binance API withdrawals disabled.",

      botTitle:
        "🤖 Bot",

      botComing:
        "Bot settings will be available here.",

      comparisonTitle:
        "🏆 Comparison",

      performanceTitle:
        "📚 Performance",

      activityTitle:
        "📜 Activity",

      xrayTitle:
        "🧪 X-Ray",

      auditTitle:
        "🕵️ Audit",

      pnlTitle:
        "💰 P/L",

      unrealizedPnl:
        "Current P/L",

      tutorialTitle:
        "🎬 How to create your Binance API",

      tutorialSubtitle:
        "Learn how to create your API securely.",

      portuguese:
        "Português",

      english:
        "English"

    }

  };


  // =====================================================
  // APLICA IDIOMA
  // =====================================================

  function aplicarIdioma() {

    const dictionary =
      translations[
        currentLanguage
      ];


    document
      .querySelectorAll(
        "[data-i18n]"
      )
      .forEach(
        (element) => {

          const key =
            element.getAttribute(
              "data-i18n"
            );

          if (
            dictionary[key]
          ) {

            element.textContent =
              dictionary[key];

          }

        }
      );


    document.documentElement.lang =
      currentLanguage === "pt"
        ? "pt-BR"
        : "en";


    document
      .getElementById("ptBtn")
      .classList.toggle(
        "active",
        currentLanguage === "pt"
      );


    document
      .getElementById("enBtn")
      .classList.toggle(
        "active",
        currentLanguage === "en"
      );

  }


  // =====================================================
  // IDIOMA
  // =====================================================

  document
    .getElementById("ptBtn")
    .addEventListener(
      "click",
      () => {

        currentLanguage = "pt";

        localStorage.setItem(
          "painelLanguage",
          "pt"
        );

        aplicarIdioma();

      }
    );


  document
    .getElementById("enBtn")
    .addEventListener(
      "click",
      () => {

        currentLanguage = "en";

        localStorage.setItem(
          "painelLanguage",
          "en"
        );

        aplicarIdioma();

      }
    );


  // =====================================================
  // FETCH AUTENTICADO
  // =====================================================

  async function api(
    url,
    options = {}
  ) {

    const response =
      await fetch(
        url,
        {

          ...options,

          headers: {

            ...(options.headers || {}),

            Authorization:
              `Bearer ${token}`,

            "Content-Type":
              "application/json"

          }

        }
      );


    if (
      response.status === 401
    ) {

      localStorage.removeItem(
        "token"
      );

      window.location.href =
        "login.html";

      return null;

    }


    const data =
      await response.json();


    if (
      !response.ok
    ) {

      throw new Error(
        data.message ||
        "Erro na requisição."
      );

    }


    return data;

  }


  // =====================================================
  // FORMATADORES
  // =====================================================

  function money(
    value,
    decimals = 2
  ) {

    const number =
      Number(value || 0);


    return number.toLocaleString(
      currentLanguage === "pt"
        ? "pt-BR"
        : "en-US",
      {
        minimumFractionDigits:
          decimals,

        maximumFractionDigits:
          decimals
      }
    );

  }


  function number(
    value,
    decimals = 8
  ) {

    const number =
      Number(value || 0);


    return number.toLocaleString(
      currentLanguage === "pt"
        ? "pt-BR"
        : "en-US",
      {
        minimumFractionDigits: 0,

        maximumFractionDigits:
          decimals
      }
    );

  }


  // =====================================================
  // CARREGAR CONTA
  // =====================================================

  async function loadAccount() {

    try {

      const data =
        await api(
          `/api/panel/account/${accountId}`
        );


      if (!data) return;


      accountData =
        data;


      document
        .getElementById(
          "accountName"
        )
        .textContent =
        data.account.name;


      document
        .getElementById(
          "connectionStatus"
        )
        .textContent =
        "● " +
        (
          currentLanguage === "pt"
            ? "Conta conectada"
            : "Account connected"
        );


      const summary =
        data.summary;


      document
        .getElementById(
          "summaryEquity"
        )
        .textContent =
        `${money(summary.patrimonioUSDT)} USDT`;


      document
        .getElementById(
          "summaryAvailable"
        )
        .textContent =
        `${money(summary.disponivelUSDT)} USDT`;


      document
        .getElementById(
          "equityTotal"
        )
        .textContent =
        `${money(summary.patrimonioUSDT)} USDT`;


      document
        .getElementById(
          "equityAvailable"
        )
        .textContent =
        `${money(summary.disponivelUSDT)} USDT`;


      document
        .getElementById(
          "equityLocked"
        )
        .textContent =
        `${money(summary.bloqueadoUSDT)} USDT`;


      document
        .getElementById(
          "equityAssets"
        )
        .textContent =
        summary.totalAtivos;


      preencherMoedas(
        data.ativos
      );


      preencherSeletores(
        data.ativos
      );


      atualizarHora();

    } catch (error) {

      console.error(error);

      document
        .getElementById(
          "connectionStatus"
        )
        .textContent =
        "● Erro ao carregar conta";

    }

  }


  // =====================================================
  // MOEDAS
  // =====================================================

  function preencherMoedas(
    ativos
  ) {

    const tbody =
      document.getElementById(
        "coinsTableBody"
      );


    tbody.innerHTML = "";


    if (
      !ativos ||
      ativos.length === 0
    ) {

      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="empty">
            Nenhum ativo encontrado.
          </td>
        </tr>
      `;

      return;

    }


    ativos.forEach(
      (asset) => {

        const row =
          document.createElement(
            "tr"
          );


        row.innerHTML = `

          <td>
            <span class="coin-name">
              ${asset.asset}
            </span>
          </td>

          <td>
            ${number(asset.free)}
          </td>

          <td>
            ${number(asset.locked)}
          </td>

          <td>
            ${
              asset.priceUnavailable
                ? "--"
                : money(
                    asset.precoUSDT,
                    6
                  )
            }
          </td>

          <td>
            ${
              asset.priceUnavailable
                ? "--"
                : money(
                    asset.valorUSDT
                  )
            }
            USDT
          </td>

        `;


        tbody.appendChild(
          row
        );

      }
    );

  }


  // =====================================================
  // SELETORES DE ATIVOS
  // =====================================================

  function preencherSeletores(
    ativos
  ) {

    const symbolSelect =
      document.getElementById(
        "symbolSelect"
      );


    const chartSymbol =
      document.getElementById(
        "chartSymbol"
      );


    symbolSelect.innerHTML = "";

    chartSymbol.innerHTML = "";


    const ativosUsaveis =
      (
        ativos || []
      ).filter(
        (asset) =>
          asset.asset !== "USDT" &&
          Number(asset.total) > 0
      );


    if (
      ativosUsaveis.length === 0
    ) {

      symbolSelect.innerHTML = `
        <option value="">
          Nenhuma posição encontrada
        </option>
      `;

      chartSymbol.innerHTML = `
        <option value="BTCUSDT">
          BTCUSDT
        </option>
      `;

      return;

    }


    ativosUsaveis.forEach(
      (asset) => {

        const symbol =
          `${asset.asset}USDT`;


        const option =
          document.createElement(
            "option"
          );

        option.value =
          symbol;

        option.textContent =
          symbol;


        symbolSelect.appendChild(
          option
        );


        const chartOption =
          option.cloneNode(true);


        chartSymbol.appendChild(
          chartOption
        );

      }
    );


    /*
     * Tenta automaticamente o primeiro
     * ativo com saldo.
     */

    const first =
      ativosUsaveis[0];


    if (first) {

      const symbol =
        `${first.asset}USDT`;

      symbolSelect.value =
        symbol;

      chartSymbol.value =
        symbol;

      loadOperation(
        symbol
      );

    }

  }


  // =====================================================
  // OPERAÇÃO
  // =====================================================

  async function loadOperation(
    symbol
  ) {

    if (!symbol) return;


    try {

      document
        .getElementById(
          "operationStatus"
        )
        .textContent =
        currentLanguage === "pt"
          ? "Carregando operação..."
          : "Loading operation...";


      const data =
        await api(
          `/api/panel/operation/${accountId}?symbol=${encodeURIComponent(symbol)}`
        );


      if (!data) return;


      currentOperation =
        data.operation;


      const op =
        data.operation;


      document
        .getElementById(
          "operationSymbol"
        )
        .textContent =
        op.symbol;


      document
        .getElementById(
          "summaryOperation"
        )
        .textContent =
        op.symbol;


      document
        .getElementById(
          "entryPrice"
        )
        .textContent =
        op.averageEntry
          ? money(
              op.averageEntry,
              6
            )
          : "--";


      document
        .getElementById(
          "currentPrice"
        )
        .textContent =
        op.currentPrice
          ? money(
              op.currentPrice,
              6
            )
          : "--";


      document
        .getElementById(
          "operationQuantity"
        )
        .textContent =
        number(
          op.quantity
        );


      document
        .getElementById(
          "operationValue"
        )
        .textContent =
        `${money(op.currentValue)} USDT`;


      const pnl =
        Number(
          op.pnlUSDT
        );


      const pnlPercent =
        Number(
          op.pnlPercentual
        );


      const pnlElement =
        document.getElementById(
          "operationPnl"
        );


      if (
        Number.isFinite(pnl)
      ) {

        pnlElement.textContent =
          `${pnl >= 0 ? "+" : ""}${money(pnl)} USDT (${pnl >= 0 ? "+" : ""}${money(pnlPercent, 2)}%)`;

        pnlElement.className =
          "metric-value " +
          (
            pnl >= 0
              ? "positive"
              : "negative"
          );

      } else {

        pnlElement.textContent =
          "--";

      }


      document
        .getElementById(
          "pnlTotal"
        )
        .textContent =
        Number.isFinite(pnl)
          ? `${pnl >= 0 ? "+" : ""}${money(pnl)} USDT`
          : "--";


      const hasPosition =
        Number(op.totalQuantity) > 0;


      document
        .getElementById(
          "operationStatus"
        )
        .textContent =
        hasPosition
          ? (
              currentLanguage === "pt"
                ? "🟢 POSIÇÃO ATIVA"
                : "🟢 ACTIVE POSITION"
            )
          : (
              currentLanguage === "pt"
                ? "⚪ SEM POSIÇÃO"
                : "⚪ NO POSITION"
            );


      document
        .getElementById(
          "summaryOperationStatus"
        )
        .textContent =
        hasPosition
          ? (
              currentLanguage === "pt"
                ? "Posição ativa"
                : "Active position"
            )
          : (
              currentLanguage === "pt"
                ? "Sem posição ativa"
                : "No active position"
            );


      const quantityInput =
        document.getElementById(
          "sellQuantity"
        );


      quantityInput.value =
        hasPosition
          ? op.quantity
          : "";


      atualizarValorVenda();


      renderSellOrders(
        op.sellOrders
      );


    } catch (error) {

      console.error(error);


      document
        .getElementById(
          "operationStatus"
        )
        .textContent =
        error.message ||
        "Erro ao carregar operação.";

    }

  }


  // =====================================================
  // ORDENS SELL
  // =====================================================

  function renderSellOrders(
    orders
  ) {

    const container =
      document.getElementById(
        "sellOrders"
      );


    if (
      !orders ||
      orders.length === 0
    ) {

      container.textContent =
        currentLanguage === "pt"
          ? "Nenhuma ordem SELL ativa."
          : "No active SELL orders.";

      return;

    }


    container.innerHTML = "";


    orders.forEach(
      (order) => {

        const div =
          document.createElement(
            "div"
          );


        div.className =
          "order-item";


        div.innerHTML = `

          <strong>
            #${order.orderId}
          </strong>

          • ${order.symbol}

          • ${number(order.origQty)}

          • ${money(order.price, 6)}

          USDT

        `;


        container.appendChild(
          div
        );

      }
    );

  }


  // =====================================================
  // VALOR DA VENDA
  // =====================================================

  function atualizarValorVenda() {

    const quantity =
      Number(
        document.getElementById(
          "sellQuantity"
        ).value || 0
      );


    const price =
      Number(
        currentOperation?.currentPrice || 0
      );


    const value =
      quantity *
      price;


    document
      .getElementById(
        "sellEstimatedValue"
      )
      .textContent =
      `${money(value)} USDT`;

  }


  document
    .getElementById(
      "sellQuantity"
    )
    .addEventListener(
      "input",
      atualizarValorVenda
    );


  // =====================================================
  // VENDA MANUAL
  // =====================================================

  document
    .getElementById(
      "sellButton"
    )
    .addEventListener(
      "click",
      async () => {

        if (
          !currentOperation
        ) {

          alert(
            currentLanguage === "pt"
              ? "Nenhuma operação carregada."
              : "No operation loaded."
          );

          return;

        }


        const quantity =
          Number(
            document
              .getElementById(
                "sellQuantity"
              )
              .value
          );


        if (
          !quantity ||
          quantity <= 0
        ) {

          alert(
            currentLanguage === "pt"
              ? "Informe uma quantidade válida."
              : "Enter a valid quantity."
          );

          return;

        }


        const text =
          currentLanguage === "pt"
            ? "CONFIRMAR VENDA"
            : "CONFIRM SALE";


        const confirmation =
          prompt(
            currentLanguage === "pt"
              ? "Digite CONFIRMAR VENDA para confirmar a venda real:"
              : "Type CONFIRM SALE to confirm the real sale:"
          );


        if (
          confirmation !== text
        ) {

          return;

        }


        try {

          const data =
            await api(
              "/api/panel/manual/sell",
              {

                method:
                  "POST",

                body:
                  JSON.stringify({

                    accountId,

                    symbol:
                      currentOperation.symbol,

                    quantity,

                    confirmation:
                      "CONFIRMAR VENDA"

                  })

              }
            );


          document
            .getElementById(
              "manualMessage"
            )
            .textContent =
            data.message;


          await loadAccount();

          await loadOperation(
            currentOperation.symbol
          );


        } catch (error) {

          document
            .getElementById(
              "manualMessage"
            )
            .textContent =
            error.message;

        }

      }
    );


  // =====================================================
  // CANCELAR SELL
  // =====================================================

  document
    .getElementById(
      "cancelSellButton"
    )
    .addEventListener(
      "click",
      async () => {

        if (
          !currentOperation
        ) {

          return;

        }


        const confirmacao =
          confirm(
            currentLanguage === "pt"
              ? "Cancelar todas as ordens SELL ativas deste ativo?"
              : "Cancel all active SELL orders for this asset?"
          );


        if (!confirmacao) {

          return;

        }


        try {

          const data =
            await api(
              "/api/panel/manual/cancel-sell",
              {

                method:
                  "POST",

                body:
                  JSON.stringify({

                    accountId,

                    symbol:
                      currentOperation.symbol

                  })

              }
            );


          document
            .getElementById(
              "manualMessage"
            )
            .textContent =
            data.message;


          await loadOperation(
            currentOperation.symbol
          );


        } catch (error) {

          document
            .getElementById(
              "manualMessage"
            )
            .textContent =
            error.message;

        }

      }
    );


  // =====================================================
  // ATUALIZAR OPERAÇÃO
  // =====================================================

  document
    .getElementById(
      "refreshOperationButton"
    )
    .addEventListener(
      "click",
      async () => {

        if (
          currentOperation?.symbol
        ) {

          await loadAccount();

          await loadOperation(
            currentOperation.symbol
          );

        } else {

          await loadAccount();

        }

      }
    );


  // =====================================================
  // GRÁFICO
  // =====================================================

  document
    .getElementById(
      "loadChartButton"
    )
    .addEventListener(
      "click",
      loadChart
    );


  async function loadChart() {

    const symbol =
      document
        .getElementById(
          "chartSymbol"
        )
        .value;


    const interval =
      document
        .getElementById(
          "chartInterval"
        )
        .value;


    if (!symbol) {

      return;

    }


    try {

      const data =
        await api(
          `/api/panel/chart?account=${accountId}&symbol=${encodeURIComponent(symbol)}&interval=${interval}`
        );


      drawChart(
        data.candles
      );


    } catch (error) {

      console.error(error);

    }

  }


  // =====================================================
  // DESENHAR GRÁFICO
  // =====================================================

  function drawChart(
    candles
  ) {

    const canvas =
      document.getElementById(
        "chartCanvas"
      );


    const ctx =
      canvas.getContext(
        "2d"
      );


    ctx.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );


    if (
      !candles ||
      candles.length === 0
    ) {

      return;

    }


    const prices =
      candles.map(
        (c) =>
          Number(c.close)
      );


    const min =
      Math.min(
        ...prices
      );


    const max =
      Math.max(
        ...prices
      );


    const padding =
      35;


    const width =
      canvas.width -
      padding * 2;


    const height =
      canvas.height -
      padding * 2;


    ctx.strokeStyle =
      "#263754";


    ctx.lineWidth =
      1;


    for (
      let i = 0;
      i < 5;
      i++
    ) {

      const y =
        padding +
        (
          height *
          i /
          4
        );


      ctx.beginPath();

      ctx.moveTo(
        padding,
        y
      );

      ctx.lineTo(
        canvas.width -
          padding,
        y
      );

      ctx.stroke();

    }


    ctx.beginPath();


    prices.forEach(
      (price, index) => {

        const x =
          padding +
          (
            width *
            index /
            (
              prices.length - 1
            )
          );


        const y =
          padding +
          height -
          (
            (
              price - min
            ) /
            (
              max - min || 1
            )
          ) *
          height;


        if (
          index === 0
        ) {

          ctx.moveTo(
            x,
            y
          );

        } else {

          ctx.lineTo(
            x,
            y
          );

        }

      }
    );


    ctx.strokeStyle =
      "#22d3a0";

    ctx.lineWidth =
      2;

    ctx.stroke();


    ctx.fillStyle =
      "#8795ab";

    ctx.font =
      "11px Arial";


    ctx.fillText(
      max.toFixed(6),
      5,
      padding
    );


    ctx.fillText(
      min.toFixed(6),
      5,
      canvas.height -
        10
    );

  }


  // =====================================================
  // NAVEGAÇÃO
  // =====================================================

  document
    .querySelectorAll(
      ".nav-btn"
    )
    .forEach(
      (button) => {

        button.addEventListener(
          "click",
          () => {

            const section =
              button.dataset.section;


            document
              .querySelectorAll(
                ".nav-btn"
              )
              .forEach(
                (btn) =>
                  btn.classList.remove(
                    "active"
                  )
              );


            button.classList.add(
              "active"
            );


            document
              .querySelectorAll(
                ".section"
              )
              .forEach(
                (element) =>
                  element.classList.remove(
                    "active"
                  )
              );


            document
              .getElementById(
                `section-${section}`
              )
              .classList.add(
                "active"
              );


            if (
              section === "chart"
            ) {

              loadChart();

            }

          }
        );

      }
    );


  // =====================================================
  // SELEÇÃO DE ATIVO
  // =====================================================

  document
    .getElementById(
      "symbolSelect"
    )
    .addEventListener(
      "change",
      (event) => {

        const symbol =
          event.target.value;


        loadOperation(
          symbol
        );


        document
          .getElementById(
            "chartSymbol"
          )
          .value =
          symbol;

      }
    );


  document
    .getElementById(
      "chartSymbol"
    )
    .addEventListener(
      "change",
      (event) => {

        const symbol =
          event.target.value;


        document
          .getElementById(
            "symbolSelect"
          )
          .value =
          symbol;


        loadOperation(
          symbol
        );

      }
    );


  // =====================================================
  // BOTÃO VOLTAR
  // =====================================================

  document
    .getElementById(
      "backBtn"
    )
    .addEventListener(
      "click",
      () => {

        window.location.href =
          "dashboard.html";

      }
    );


  // =====================================================
  // LOGOUT
  // =====================================================

  document
    .getElementById(
      "logoutBtn"
    )
    .addEventListener(
      "click",
      () => {

        localStorage.removeItem(
          "token"
        );

        window.location.href =
          "login.html";

      }
    );


  // =====================================================
  // HORA
  // =====================================================

  function atualizarHora() {

    const agora =
      new Date();


    document
      .getElementById(
        "lastUpdate"
      )
      .textContent =
      (
        currentLanguage === "pt"
          ? "Atualizado às "
          : "Updated at "
      ) +
      agora.toLocaleTimeString();

  }


  // =====================================================
  // INICIALIZAÇÃO
  // =====================================================

  aplicarIdioma();

  loadAccount();

</script>

</body>
</html>
