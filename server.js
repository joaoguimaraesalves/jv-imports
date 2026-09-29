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
app.use('/api/compras',      require('./routes/compras')(pool));
app.use('/api/contas-pagar', require('./routes/contas-pagar')(pool));
app.use('/api/estoque',      require('./routes/estoque')(pool));
app.use('/api/caixa',        require('./routes/caixa')(pool));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

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
