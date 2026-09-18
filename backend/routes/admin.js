CRIPTOPRO — ETAPA 2
LIGAR A API DO PAINEL ADMINISTRATIVO

FAZER SOMENTE ESTAS 2 ALTERAÇÕES.

============================================================
1) ARQUIVO: backend/server.js
============================================================

A) Encontre esta linha no topo:

const subscriptionRoutes = require("./routes/subscription");

Logo ABAIXO dela, adicione:

const adminRoutes = require("./routes/admin");


B) Encontre:

app.use("/api/subscription", subscriptionRoutes);

Logo ABAIXO, adicione:

// =========================================================
// PAINEL ADMINISTRATIVO CRIPTOPRO
// =========================================================
app.use("/api/admin", adminRoutes);


IMPORTANTE:
Não remova nem altere as outras rotas.
O webhook Stripe RAW continua exatamente como está, antes do
express.json().

============================================================
2) CRIAR A VARIÁVEL NO NORTHFLANK
============================================================

Em Environment Variables, crie:

Nome:
ADMIN_USER_ID

Valor:
3

O valor 3 corresponde ao usuário administrador que aparece nos
logs atuais do CriptoPro.

Não coloque essa variável no HTML.

============================================================
3) ARQUIVO DA ETAPA ANTERIOR
============================================================

O arquivo:

admin_Etapa1_API_DASHBOARD.txt

deve ser colocado no projeto como:

backend/routes/admin.js

Se ainda não fez isso, faça agora.

============================================================
4) TESTE
============================================================

Depois de salvar e fazer o deploy, abra primeiro:

/api/admin/teste

Como essa rota exige JWT, não é para abrir simplesmente em uma
aba anônima. O teste será feito pelo navegador autenticado ou
pela futura página admin.

Resposta esperada para o administrador:

{
  "success": true,
  "admin": true,
  "userId": "3"
}

Se aparecer:

403
Acesso administrativo não autorizado.

então NÃO mexa no código. Verifique primeiro se
ADMIN_USER_ID está exatamente como:

3

============================================================
PRÓXIMA ETAPA
============================================================

Depois que o deploy ficar Running, NÃO criaremos ainda uma página
visual.

Primeiro vamos confirmar que:

/api/admin/dashboard

retorna os números corretamente.

Depois criaremos o admin.html com:

- Usuários
- Assinaturas ativas
- Receita mensal
- Robôs rodando
- APIs Binance
- Distribuição dos planos
- Últimas assinaturas
- Atualização automática
- Layout profissional CriptoPro
