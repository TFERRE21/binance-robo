// ============================================================
// SERVIÇO DE E-MAIL - CRIPTOPRO
// ============================================================

const https = require('https');


// ============================================================
// CONFIGURAÇÕES
// ============================================================

const RESEND_API_KEY = process.env.RESEND_API_KEY;

// Por enquanto utilizamos o remetente de teste do Resend.
// Quando tivermos um domínio próprio, vamos trocar para algo
// como: CriptoPro <suporte@seudominio.com>
const MAIL_FROM =
  process.env.MAIL_FROM || 'CriptoPro <onboarding@resend.dev>';


// ============================================================
// FUNÇÃO PRINCIPAL DE ENVIO
// ============================================================

function enviarEmail({ to, subject, html, text }) {

  return new Promise((resolve, reject) => {

    // --------------------------------------------------------
    // VERIFICAR API KEY
    // --------------------------------------------------------

    if (!RESEND_API_KEY) {

      return reject(
        new Error('RESEND_API_KEY não configurada.')
      );

    }


    // --------------------------------------------------------
    // VALIDAR DESTINATÁRIO
    // --------------------------------------------------------

    if (!to) {

      return reject(
        new Error('Destinatário do e-mail não informado.')
      );

    }


    // --------------------------------------------------------
    // MONTAR DADOS
    // --------------------------------------------------------

    const payload = {
      from: MAIL_FROM,
      to: Array.isArray(to) ? to : [to],
      subject: subject || '',
      html: html || '',
      text: text || ''
    };


    const data = JSON.stringify(payload);


    // --------------------------------------------------------
    // REQUISIÇÃO PARA O RESEND
    // --------------------------------------------------------

    const options = {

      hostname: 'api.resend.com',

      path: '/emails',

      method: 'POST',

      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }

    };


    const request = https.request(
      options,
      (response) => {

        let body = '';


        response.on('data', (chunk) => {
          body += chunk;
        });


        response.on('end', () => {

          let resultado = null;

          try {
            resultado = JSON.parse(body);
          } catch (error) {
            resultado = {
              raw: body
            };
          }


          // --------------------------------------------------
          // SUCESSO
          // --------------------------------------------------

          if (
            response.statusCode >= 200 &&
            response.statusCode < 300
          ) {

            console.log(
              'E-MAIL ENVIADO PELO RESEND:',
              resultado.id || 'ID não informado'
            );

            return resolve(resultado);

          }


          // --------------------------------------------------
          // ERRO
          // --------------------------------------------------

          console.error(
            'ERRO RESEND:',
            response.statusCode,
            resultado
          );


          const mensagem =
            resultado.message ||
            'Erro ao enviar e-mail pelo Resend.';


          return reject(
            new Error(
              `Resend ${response.statusCode}: ${mensagem}`
            )
          );

        });

      }
    );


    // --------------------------------------------------------
    // ERRO DE CONEXÃO
    // --------------------------------------------------------

    request.on('error', (error) => {

      console.error(
        'ERRO DE CONEXÃO COM RESEND:',
        error
      );

      reject(error);

    });


    // --------------------------------------------------------
    // ENVIAR
    // --------------------------------------------------------

    request.write(data);

    request.end();

  });

}


// ============================================================
// E-MAIL DE RECUPERAÇÃO DE SENHA
// ============================================================

async function enviarEmailRecuperacaoSenha({
  email,
  nome,
  link
}) {

  const nomeUsuario =
    nome || 'Olá';


  const assunto =
    'Redefinição de senha - CriptoPro';


  const html = `

<!DOCTYPE html>

<html lang="pt-BR">

<head>

  <meta charset="UTF-8">

  <meta name="viewport"
        content="width=device-width, initial-scale=1.0">

  <title>Redefinição de senha - CriptoPro</title>

</head>


<body style="
  margin:0;
  padding:0;
  background:#0b0f19;
  font-family:Arial,Helvetica,sans-serif;
">

  <div style="
    max-width:600px;
    margin:40px auto;
    background:#111827;
    border-radius:16px;
    overflow:hidden;
    border:1px solid #273244;
  ">


    <!-- CABEÇALHO -->

    <div style="
      padding:30px;
      text-align:center;
      background:#0d1320;
      border-bottom:1px solid #273244;
    ">

      <div style="
        font-size:30px;
        font-weight:bold;
        color:#ffffff;
      ">

        CRIPTO<span style="color:#d4af37;">PRO</span>

      </div>

      <div style="
        margin-top:8px;
        color:#9ca3af;
        font-size:14px;
      ">

        Automação inteligente para seus investimentos

      </div>

    </div>


    <!-- CONTEÚDO -->

    <div style="
      padding:35px;
      color:#ffffff;
    ">

      <h2 style="
        margin-top:0;
        font-size:24px;
      ">

        Redefinição de senha

      </h2>


      <p style="
        color:#d1d5db;
        font-size:16px;
        line-height:1.6;
      ">

        Olá, ${nomeUsuario}!

      </p>


      <p style="
        color:#d1d5db;
        font-size:16px;
        line-height:1.6;
      ">

        Recebemos uma solicitação para redefinir a senha
        da sua conta CriptoPro.

      </p>


      <p style="
        color:#d1d5db;
        font-size:16px;
        line-height:1.6;
      ">

        Clique no botão abaixo para criar uma nova senha:

      </p>


      <!-- BOTÃO -->

      <div style="
        text-align:center;
        margin:35px 0;
      ">

        <a
          href="${link}"
          style="
            display:inline-block;
            padding:15px 28px;
            background:#d4af37;
            color:#111827;
            text-decoration:none;
            font-weight:bold;
            border-radius:8px;
            font-size:16px;
          "
        >

          REDEFINIR MINHA SENHA

        </a>

      </div>


      <p style="
        color:#9ca3af;
        font-size:14px;
        line-height:1.6;
      ">

        Este link é válido por <strong>30 minutos</strong>.

      </p>


      <p style="
        color:#9ca3af;
        font-size:14px;
        line-height:1.6;
      ">

        Se você não solicitou a redefinição de senha,
        ignore este e-mail. Sua senha permanecerá a mesma.

      </p>


      <hr style="
        border:0;
        border-top:1px solid #273244;
        margin:30px 0;
      ">


      <p style="
        color:#6b7280;
        font-size:12px;
        line-height:1.5;
      ">

        Por segurança, nunca compartilhe este link
        com outras pessoas.

      </p>

    </div>


    <!-- RODAPÉ -->

    <div style="
      padding:20px;
      text-align:center;
      background:#0d1320;
      color:#6b7280;
      font-size:12px;
    ">

      © CriptoPro - Todos os direitos reservados.

    </div>


  </div>

</body>

</html>

`;


  const text = `

CriptoPro - Redefinição de senha

Olá, ${nomeUsuario}!

Recebemos uma solicitação para redefinir a senha
da sua conta CriptoPro.

Acesse o link abaixo para criar uma nova senha:

${link}

Este link é válido por 30 minutos.

Se você não solicitou essa alteração, ignore este e-mail.

`;


  return enviarEmail({

    to: email,

    subject: assunto,

    html,

    text

  });

}


// ============================================================
// EXPORTAR
// ============================================================

module.exports = {

  enviarEmail,

  enviarEmailRecuperacaoSenha

};
