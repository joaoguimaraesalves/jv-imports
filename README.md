# JV Imports — Gestão Inteligente para Revendedores

> 🚀 **Aplicação publicada:** https://jv-imports-1.onrender.com
>
> *Hospedado no plano gratuito do Render — o primeiro acesso após um período de inatividade pode levar ~50 segundos enquanto o servidor "acorda".*

Sistema web de gestão de vendas, estoque, compras e despesas voltado para
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
- **API externa:** AwesomeAPI (cotação de moedas)
- **Testes:** Jest + Supertest
- **CI:** GitHub Actions
- **Deploy:** Render

## 🗄️ Banco de dados em nuvem (Neon / PostgreSQL)

A persistência foi migrada de SQLite local para **PostgreSQL hospedado no Neon**.
A conexão é feita por um pool (`db/pool.js`) lendo a variável de ambiente
`DATABASE_URL`, e as tabelas são criadas automaticamente no primeiro boot
(`db/schema.js`).

Tabelas: `produtos`, `vendas`, `saidas`, `compras`, `compra_itens`,
`contas_pagar`, `estoque_movimentos`.

Operações de venda e compra rodam dentro de transações
(`BEGIN/COMMIT/ROLLBACK`), garantindo que estoque, movimentos e contas a pagar
fiquem sempre consistentes.

## 🌐 Integração com API externa

A aplicação consome a [AwesomeAPI](https://docs.awesomeapi.com.br/api-de-moedas)
para exibir as cotações de **USD→BRL** e **EUR→BRL** em tempo real no Dashboard,
ajudando o revendedor a precificar produtos importados sem sair do sistema.

- **Endpoint interno:** `GET /api/cotacao`
- **Fonte:** `https://economia.awesomeapi.com.br/json/last/USD-BRL,EUR-BRL`
- **Resiliência:** cache em memória de 10 minutos, fallback para o último valor
  válido (`stale`) e tratamento explícito de limite de requisições (HTTP 429).

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

# 4. Iniciar
npm start
```

A aplicação sobe em `http://localhost:3000`. As tabelas são criadas
automaticamente no primeiro acesso.

## 🧪 Testes

```bash
npm test
```

- Testes de integração da cotação (`/api/cotacao`) com mock da API externa.
- Teste de integração com o banco real (`produtos.db.test.js`), que roda quando
  `DATABASE_URL` está definida (no CI vem de um *secret*).

## 📚 Principais endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| GET/POST/PUT/DELETE | `/api/produtos` | CRUD de produtos |
| GET/POST/DELETE | `/api/vendas` | Vendas (baixa estoque em transação) |
| GET/POST/DELETE | `/api/compras` | Compras com itens e parcelamento |
| GET/POST/PATCH/DELETE | `/api/contas-pagar` | Contas a pagar |
| GET/POST/DELETE | `/api/saidas` | Despesas avulsas |
| GET | `/api/estoque/movimentos` | Histórico de movimentação |
| GET | `/api/dashboard` | Indicadores e gráficos |
| GET | `/api/cotacao` | Cotação de moedas (AwesomeAPI) |

---

Projeto desenvolvido para o **Bootcamp** — UniCEUB, sob orientação do
Prof. Dr. Romes Heriberto Pires de Araújo.
