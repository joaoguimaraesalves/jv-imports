// db/schema.js
// Cria as tabelas no Postgres (Neon) caso ainda não existam.
// É chamado uma vez no boot do servidor.
async function initDb(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS produtos (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      custo NUMERIC NOT NULL DEFAULT 0,
      preco NUMERIC NOT NULL DEFAULT 0,
      quantidade INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS vendas (
      id SERIAL PRIMARY KEY,
      produto_id INTEGER,
      produto_nome TEXT,
      quantidade INTEGER,
      valor NUMERIC,
      custo NUMERIC,
      forma_pagamento TEXT,
      data TEXT
    );

    CREATE TABLE IF NOT EXISTS saidas (
      id SERIAL PRIMARY KEY,
      descricao TEXT,
      valor NUMERIC,
      data TEXT
    );

    CREATE TABLE IF NOT EXISTS compras (
      id SERIAL PRIMARY KEY,
      descricao TEXT,
      valor_total NUMERIC,
      forma_pagamento TEXT,
      parcelas INTEGER DEFAULT 1,
      data TEXT
    );

    CREATE TABLE IF NOT EXISTS compra_itens (
      id SERIAL PRIMARY KEY,
      compra_id INTEGER REFERENCES compras(id),
      produto_id INTEGER REFERENCES produtos(id),
      produto_nome TEXT,
      quantidade INTEGER,
      custo_unitario NUMERIC
    );

    CREATE TABLE IF NOT EXISTS contas_pagar (
      id SERIAL PRIMARY KEY,
      descricao TEXT,
      valor NUMERIC,
      vencimento TEXT,
      status TEXT DEFAULT 'pendente',
      data_pagamento TEXT,
      compra_id INTEGER REFERENCES compras(id),
      parcela_num INTEGER,
      parcela_total INTEGER
    );

    CREATE TABLE IF NOT EXISTS estoque_movimentos (
      id SERIAL PRIMARY KEY,
      produto_id INTEGER REFERENCES produtos(id),
      tipo TEXT,
      quantidade INTEGER,
      custo_unitario NUMERIC,
      origem_tipo TEXT,
      origem_id INTEGER,
      observacao TEXT,
      data TEXT
    );
  `);

  console.log('Banco de dados da JV Imports (Postgres/Neon) conectado!');
}

module.exports = { initDb };
