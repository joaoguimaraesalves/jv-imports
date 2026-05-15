# JV Imports

> 🚀 **Aplicação publicada:** https://jv-imports-1.onrender.com/
>
> *No plano free do Render, o primeiro acesso pode levar ~30s enquanto o servidor "acorda".*

Sistema de gestão de vendas para negócio de produtos importados.

## 📌 Sobre o Projeto

O JV Imports é uma aplicação web voltada para microempreendedores e
revendedores autônomos que trabalham com produtos importados. O sistema
unifica controle de estoque, registro de vendas e gestão de gastos em um
dashboard centralizado, eliminando a desorganização típica de planilhas
manuais e cadernos.

## ✨ Funcionalidades

- **Controle de estoque** (cadastro, alertas)
- **Registro de vendas** com baixa automática no estoque
- **Controle de gastos e despesas**
- **Dashboard** com lucro, margem e gráficos
- **Filtros, top produtos e próximas contas a pagar**
- **Cotação de moedas em tempo real** (USD/EUR → BRL) via AwesomeAPI

## 🌐 Integração com API Externa

A aplicação consome a [AwesomeAPI](https://docs.awesomeapi.com.br/api-de-moedas)
para exibir cotações de **USD→BRL** e **EUR→BRL** em tempo real no Dashboard,
auxiliando o microempreendedor a precificar produtos importados sem
precisar consultar fontes externas.

- **Endpoint interno:** `GET /api/cotacao`
- **Fonte:** AwesomeAPI (pública, gratuita e sem necessidade de chave)
- **Atualização:** automática a cada 5 minutos no frontend
- **Tratamento de erros:** retorna 502 quando a API externa falha e 500 em erro de rede

## 🚀 Como rodar localmente

```bash
npm install
npm start
```

Acesse: [http://localhost:3000](http://localhost:3000)

## 🧪 Testes

O projeto possui testes de integração que validam o consumo da API externa
utilizando mock do `fetch` (não depende da API estar online para passar).

```bash
npm test
```

## 🛠️ Stack

- **Backend:** Node.js + Express
- **Banco de dados:** SQLite (better-sqlite3)
- **Frontend:** HTML / CSS / JavaScript puro (sem framework)
- **Testes:** Jest + Supertest
- **Deploy:** Render

## 📦 Estrutura de Pastas

jv-imports/
├── db/           # Conexão e schema do banco
├── public/       # Frontend (HTML, CSS, JS)
├── routes/       # Rotas da API
├── tests/        # Testes de integração
├── server.js     # Entry point da aplicação
└── package.json

## 👤 Autor

João Victor Guimarães — [@joaoguimaraesalves](https://github.com/joaoguimaraesalves)