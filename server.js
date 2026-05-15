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
// =============================================
app.get('/api/cotacao', async (req, res) => {
  try {
    const response = await fetch(
      'https://economia.awesomeapi.com.br/json/last/USD-BRL,EUR-BRL'
    );

    if (!response.ok) {
      return res
        .status(502)
        .json({ erro: 'Falha ao consultar API externa', status: response.status });
    }

    const data = await response.json();

    // Normaliza a resposta para o frontend consumir mais fácil
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

    res.json(cotacao);
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno ao buscar cotação', detalhe: err.message });
  }
});


if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
}
module.exports = app;