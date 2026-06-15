// server.js
const express = require('express');
const path = require('path');
const pool = require('./db/pool');
const { initDb } = require('./db/schema');

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/dashboard',    require('./routes/dashboard')(pool));
app.use('/api/produtos',     require('./routes/produtos')(pool));
app.use('/api/vendas',       require('./routes/vendas')(pool));
app.use('/api/saidas',       require('./routes/saidas')(pool));
app.use('/api/compras',      require('./routes/compras')(pool));
app.use('/api/contas-pagar', require('./routes/contas-pagar')(pool));
app.use('/api/estoque',      require('./routes/estoque')(pool));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// =============================================
// Integração com API pública - AwesomeAPI
// Issue #1 - Cotação de moedas USD/EUR → BRL
// (inalterado da Etapa 2)
// =============================================
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos
let cacheCotacao = null;
let cacheTimestamp = 0;

function resetarCacheCotacao() {
  cacheCotacao = null;
  cacheTimestamp = 0;
}

app.get('/api/cotacao', async (req, res) => {
  const agora = Date.now();

  if (cacheCotacao && (agora - cacheTimestamp) < CACHE_TTL_MS) {
    return res.json({ ...cacheCotacao, cache: true });
  }

  try {
    const response = await fetch(
      'https://economia.awesomeapi.com.br/json/last/USD-BRL,EUR-BRL'
    );

    if (response.status === 429) {
      if (cacheCotacao) {
        return res.json({ ...cacheCotacao, cache: true, stale: true });
      }
      return res.status(429).json({
        erro: 'Limite de requisições atingido. Tente novamente em alguns minutos.',
        status: 429,
      });
    }

    if (!response.ok) {
      if (cacheCotacao) {
        return res.json({ ...cacheCotacao, cache: true, stale: true });
      }
      return res.status(502).json({
        erro: 'Falha ao consultar API externa',
        status: response.status,
      });
    }

    const data = await response.json();

    const cotacao = {
      usd: {
        valor: parseFloat(data.USDBRL.bid),
        variacao: parseFloat(data.USDBRL.pctChange),
        atualizadoEm: data.USDBRL.create_date,
      },
      eur: {
        valor: parseFloat(data.EURBRL.bid),
        variacao: parseFloat(data.EURBRL.pctChange),
        atualizadoEm: data.EURBRL.create_date,
      },
      fonte: 'AwesomeAPI',
    };

    cacheCotacao = cotacao;
    cacheTimestamp = agora;

    res.json(cotacao);
  } catch (err) {
    if (cacheCotacao) {
      return res.json({ ...cacheCotacao, cache: true, stale: true });
    }
    res.status(500).json({ erro: 'Erro interno ao buscar cotação', detalhe: err.message });
  }
});

// Expõe a função de reset do cache (usada nos testes)
app.resetarCacheCotacao = resetarCacheCotacao;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  initDb(pool)
    .then(() => app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`)))
    .catch((err) => {
      console.error('Falha ao iniciar o banco de dados:', err);
      process.exit(1);
    });
}

module.exports = app;
