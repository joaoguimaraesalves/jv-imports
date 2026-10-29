# JV Imports — Gestão Inteligente para Revendedores

> 🛍️ **Loja online (pública):** servida pela **Cloudflare Pages** — abre na hora, sem "acordar" servidor.
>
> 📊 **Painel de gestão (oficial):** Google Apps Script + planilha do Google (pasta `apps-script/`).
>
> *A versão Node/Express (Render + Neon) continua no repositório como versão original do projeto.*

Sistema web de gestão de vendas, estoque, compras e contas a pagar voltado para
microempreendedores e revendedores que trabalham com produtos importados.
Permite cadastrar produtos, registrar vendas e compras (à vista ou parceladas),
controlar contas a pagar, acompanhar a movimentação de estoque e visualizar
indicadores financeiros em um dashboard com gráficos e filtros por período.

## 👥 Integrantes

| Nome | Matrícula | GitHub |
|------|-----------|--------|
| João Victor Guimarães Alves | 22503751 | [@joaoguimaraesalves](https://github.com/joaoguimaraesalves) |
| Pedro Henrique de Mello Sabino | 22503715 | [@peagaTheGOat](https://github.com/peagaTheGOat) |

## 🧰 Tecnologias

- **Back-end:** Node.js + Express
- **Banco de dados:** PostgreSQL hospedado no **Neon** (DBaaS), acessado via driver `pg`
- **Front-end:** HTML, CSS e JavaScript (vanilla) + Chart.js para os gráficos
- **Testes:** Jest + Supertest
- **CI:** GitHub Actions
- **Deploy:** Render

## 🗄️ Banco de dados em nuvem (Neon / PostgreSQL)

A persistência foi migrada de SQLite local para **PostgreSQL hospedado no Neon**.
A conexão é feita por um pool (`db/pool.js`) lendo a variável de ambiente
`DATABASE_URL`, e as tabelas são criadas automaticamente no primeiro boot
(`db/schema.js`).

Tabelas: `produtos`, `vendas`, `compras`, `compra_itens`,
`contas_pagar`, `estoque_movimentos`.

Operações de venda e compra rodam dentro de transações
(`BEGIN/COMMIT/ROLLBACK`), garantindo que estoque, movimentos e contas a pagar
fiquem sempre consistentes.

## 📊 Painel no Google Apps Script (oficial)

O painel usado no dia a dia roda no **Google Apps Script**, com a **planilha do
Google** como banco (pasta `apps-script/`). As telas são as mesmas deste
repositório (`views/painel.html` + `public/`): o build junta tudo num
`Index.html` e troca o `fetch` por `google.script.run` (`apps-script/utils-gas.js`).

```bash
node apps-script/montar.js          # gera apps-script/dist (Index.html + .js do servidor)
cd apps-script && clasp -u pessoal push   # envia para o projeto (conta pessoal)
```

- `apps-script/src/`: servidor (Banco.js = planilha como banco, Rotas.js =
  as mesmas rotas `/api`, Loja.js = loja online, Financeiro.js, Backup.js).
- **Não edite o `Index.html` à mão**: altere `views/` e `public/` e rode o build.
- Testes: `tests/apps-script.test.js` roda o código real do Apps Script num
  ambiente imitado (`tests/gas-falso.js`: planilha, Drive, cache e Cloudflare em memória).

## 🛍️ Loja Online (site público)

A loja fica na **Cloudflare** (pasta `cloudflare/`) e lê só o **Cloudflare KV**:

```
Painel (Apps Script + planilha) ──a cada gravação──▶ Loja.js ──▶ Cloudflare KV ◀── Loja (Cloudflare Pages)
```

- Toda venda, compra, ajuste, foto ou configuração feita no painel dispara, em
  segundo plano, o envio das fotos novas e da vitrine (JSON sem custo) para o KV.
  O site mostra em até 1 minuto, e a página aberta se atualiza sozinha.
- Um gatilho a cada 10 min republica se algo foi alterado direto na planilha.
- O cliente **nunca** espera o Apps Script nem a planilha: a loja só lê o KV.
- Fotos ficam na pasta **"JV Imports - Fotos da Loja"** do Google Drive
  (reduzidas no navegador para ~1000 px antes do envio).
- A versão Node tem o mesmo publicador (`lib/publicador.js`, variáveis
  `CF_*` no Render); sem elas, serve a loja em `/` como antes.

- **O que aparece:** produtos com preço e marcados "Mostrar no site". Custo e
  quantidade exata nunca saem do servidor; acima de 3 unidades o site mostra
  só "Pronta entrega", e com 3 ou menos mostra "Últimas X unidades".
- **Vitrine:** foto, categoria, descrição, preço "de/por" (promoção),
  destaque e selo automático de **Mais vendido** (top 3 dos últimos 90 dias).
- **Compra:** sacola → mensagem pronta no **WhatsApp** da loja. Esgotados
  aparecem com botão **Encomendar** (dá para esconder).
- **Compartilhar:** cada produto tem link próprio (`/p/:id`) com prévia de
  foto, nome e preço no WhatsApp/Instagram.
- **No painel:** menu **Loja Online** (link para copiar, WhatsApp, Instagram,
  faixa de aviso, pagamento/entrega e checklist do que falta) e, no cadastro do
  produto, o bloco **Na loja online** (foto, categoria, descrição, promoção).
- **Versão Node:** fotos no banco (`produto_fotos`); o workflow
  `manter-acordado.yml` visita o Render a cada 10 min para ele não dormir.

### ☁️ Ligar a loja na Cloudflare (uma vez só)

1. Crie uma conta grátis em https://dash.cloudflare.com/sign-up.
2. **Workers & Pages → KV → Create namespace**: nome `jv-imports-vitrine`.
   Anote o **Namespace ID**.
3. **Workers & Pages → Create → Pages → Connect to Git** → repositório
   `jv-imports`, branch `main`, e:
   - Framework preset: **None**
   - Build command: `node montar.js`
   - Build output directory: `dist`
   - Root directory: `cloudflare`
4. No projeto Pages: **Settings → Bindings → Add → KV namespace**:
   nome da variável `VITRINE`, namespace `jv-imports-vitrine`. Depois,
   **Deployments → Retry deployment** para valer.
5. **My Profile → API Tokens → Create Token → Custom token**: permissão
   *Account · Workers KV Storage · Edit*, só na sua conta. Copie o token.
6. Copie o **Account ID** (Workers & Pages → coluna da direita).
7. No painel (Apps Script) → **Loja Online → Conexão com a Cloudflare**: cole
   Account ID, Namespace ID, token e o endereço da loja
   (ex.: `https://jv-imports.pages.dev`) e toque em **Salvar e publicar**.
   Deve aparecer "✅ Loja em dia". O token fica nas propriedades do script e
   nunca volta para a tela.
8. Na mesma tela, preencha o **WhatsApp** que recebe os pedidos.

Domínio próprio: compre no Registro.br, mude os servidores DNS para os da
Cloudflare (Add a site, plano Free) e adicione o domínio em **Pages → Custom
domains**. Depois troque o endereço da loja no painel.

## 🔒 Acesso ao painel (versão Node)

O painel do Apps Script só abre para a conta Google dona do projeto. Na versão
Node, o painel fica em `/painel` e pede a senha da variável de ambiente
**`PAINEL_SENHA`** (mínimo 6 caracteres). A sessão dura 30 dias (cookie
assinado). Trocar a senha no Render desconecta todo mundo. Sem a variável,
ninguém entra. Toda a API do painel exige login; só `GET /api/loja/*` é pública.

## 📜 Histórico da Loja

Tela para registrar tudo o que já foi comprado e vendido antes de usar o
sistema e ver os números da loja desde o início.

1. **Compras antigas**: em *Compras → Nova Compra*, tipo **"Compra antiga
   (histórico)"** com a data real do pedido. Entram no estoque, mas não geram
   conta a pagar nem mexem no saldo.
2. **Acertar estoque**: informa-se o estoque real de hoje; a diferença para o
   sistema vira **venda antiga** (com data de corte), que baixa o estoque e entra
   no lucro total, sem mexer no saldo atual.
3. **Saldo atual da conta**: o valor que está no banco hoje.
4. **Calcular histórico**: grava um retrato dos totais (lucro total, faturamento,
   investido, estoque parado, saldo e o retirado/usado fora da loja estimado)
   na tabela `historico_calculos`. Cada cálculo fica salvo para auditoria.

## ▶️ Como rodar localmente

Pré-requisitos: Node.js 18+ e uma string de conexão de um banco PostgreSQL
(ex.: um projeto gratuito no [Neon](https://neon.tech)).

```bash
# 1. Clonar
git clone https://github.com/joaoguimaraesalves/jv-imports.git
cd jv-imports

# 2. Instalar dependências
npm install

# 3. Definir a variável de ambiente com a string do banco
#    Windows (PowerShell):
$env:DATABASE_URL="postgresql://usuario:senha@host-pooler.neon.tech/neondb?sslmode=require"
#    Linux/macOS:
#    export DATABASE_URL="postgresql://usuario:senha@host-pooler.neon.tech/neondb?sslmode=require"

# 4. Senha do painel
$env:PAINEL_SENHA="uma-senha-forte"

# 5. Iniciar
npm start
```

A loja sobe em `http://localhost:3000` e o painel em `http://localhost:3000/painel`. As tabelas são criadas
automaticamente no primeiro acesso.

## 🧪 Testes

```bash
npm test
```

- Testes do cálculo da Meta de Caixa (`planejamento.test.js`).
- Regras da vitrine: nunca expor custo, promoção, mais vendido, fotos (`loja.test.js`).
- O que é público e o que pede senha no painel (`acesso.test.js`).
- Envio para a Cloudflare: fotos antes da vitrine, sem reenvio, limpeza de fotos antigas, erros (`publicador.test.js`).
- Teste de integração com o banco real (`produtos.db.test.js`), que roda quando
  `DATABASE_URL` está definida (no CI vem de um *secret*).

## 📚 Principais endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/loja/produtos` | **Público.** Vitrine (sem custo) + dados da loja |
| GET | `/api/loja/foto/:id` | **Público.** Foto do produto |
| GET / PUT | `/api/loja/config` | Configuração da loja (salvar exige login) |
| POST | `/api/sessao/entrar`, `/api/sessao/sair` | Login e logout do painel |
| GET/POST/PUT/DELETE | `/api/produtos` | CRUD de produtos (+ campos da loja) |
| PUT/DELETE | `/api/produtos/:id/foto` | Envia/remove a foto do produto |
| GET/POST/DELETE | `/api/vendas` | Vendas (baixa estoque em transação) |
| PATCH | `/api/vendas/:id/receber` | Marca venda fiado como recebida |
| GET / POST | `/api/historico`, `/api/historico/calcular` | Histórico da Loja: totais de longo prazo e cálculos salvos |
| POST | `/api/historico/vendas-antigas` | Registra vendas feitas antes do sistema (acerto de estoque) |
| GET/POST/DELETE | `/api/compras` | Compras com itens e parcelamento |
| GET/POST/PATCH/DELETE | `/api/contas-pagar` | Contas a pagar |
| GET | `/api/estoque/movimentos` | Histórico de movimentação |
| GET | `/api/dashboard` | Indicadores e gráficos |
| GET / PUT | `/api/caixa`, `/api/caixa/saldo` | Saldo da conta e Meta de Caixa (quanto falta para pagar as contas) |

---

Projeto desenvolvido para o **Bootcamp** — UniCEUB, sob orientação do
Prof. Dr. Romes Heriberto Pires de Araújo.
