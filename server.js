// server.js
const express = require('express');
const path = require('path');
const { initDb } = require('./db/schema');

const app = express();
const port = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = initDb();

app.use('/api/dashboard',    require('./routes/dashboard')(db));
app.use('/api/produtos',     require('./routes/produtos')(db));
app.use('/api/vendas',       require('./routes/vendas')(db));
app.use('/api/saidas',       require('./routes/saidas')(db));
app.use('/api/compras',      require('./routes/compras')(db));
app.use('/api/contas-pagar', require('./routes/contas-pagar')(db));
app.use('/api/estoque',      require('./routes/estoque')(db));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

module.exports = app;

// =============================================
// Integração com API pública - AwesomeAPI
// Issue #1 - Cotação de moedas USD/EUR → BRL
// Cache em memória para evitar rate limit (HTTP 429)
// =============================================
let cacheCotacao = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos

app.get('/api/cotacao', async (req, res) => {
  // Se há cache válido, devolve sem chamar API externa
  const agora = Date.now();
  if (cacheCotacao && (agora - cacheTimestamp) < CACHE_TTL_MS) {
    return res.json({ ...cacheCotacao, cache: true });
  }

  try {
    const response = await fetch(
      'https://economia.awesomeapi.com.br/json/last/USD-BRL,EUR-BRL'
    );

    // Rate limit da AwesomeAPI: devolve cache antigo se houver
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
      // Se a API externa falhar mas tivermos cache antigo, devolve ele
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

    // Atualiza o cache
    cacheCotacao = cotacao;
    cacheTimestamp = agora;

    res.json(cotacao);
  } catch (err) {
    // Em caso de erro de rede, devolve cache antigo se houver
    if (cacheCotacao) {
      return res.json({ ...cacheCotacao, cache: true, stale: true });
    }
    res.status(500).json({ erro: 'Erro interno ao buscar cotação', detalhe: err.message });
  }
});