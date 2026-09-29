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

    -- Configurações simples chave/valor (ex.: saldo informado da conta)
    CREATE TABLE IF NOT EXISTS configuracoes (
      chave TEXT PRIMARY KEY,
      valor TEXT,
      atualizado_em TEXT
    );

    -- Vendas fiado: o cliente leva agora e paga depois.
    -- Vendas antigas ficam como recebidas (DEFAULT true).
    ALTER TABLE vendas ADD COLUMN IF NOT EXISTS recebido BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE vendas ADD COLUMN IF NOT EXISTS cliente TEXT;
    ALTER TABLE vendas ADD COLUMN IF NOT EXISTS receber_ate TEXT;
    ALTER TABLE vendas ADD COLUMN IF NOT EXISTS data_recebimento TEXT;

    -- Histórico da loja: compras/vendas antigas (antes de usar o sistema).
    -- Não mexem no saldo atual: esse dinheiro já entrou/saiu há tempo.
    ALTER TABLE compras ADD COLUMN IF NOT EXISTS historico BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE vendas  ADD COLUMN IF NOT EXISTS historico BOOLEAN NOT NULL DEFAULT false;

    -- Cada clique em "Calcular histórico" grava um retrato dos totais (auditoria)
    CREATE TABLE IF NOT EXISTS historico_calculos (
      id SERIAL PRIMARY KEY,
      data TEXT NOT NULL,
      dados JSONB NOT NULL
    );
  `);

  console.log('Banco de dados da JV Imports (Postgres/Neon) conectado!');
}

module.exports = { initDb };
