// db/pool.js
const { Pool, types } = require('pg');

// O pg devolve NUMERIC (oid 1700) e BIGINT (oid 20) como string por padrão,
// pra não perder precisão. Como o sistema lida com valores comuns de varejo,
// convertemos pra number — assim o frontend continua fazendo conta igual era
// no SQLite (REAL), sem precisar mexer em nenhuma tela.
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));

// Neon exige SSL; um Postgres na própria máquina (teste local) não usa.
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL || '');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: local ? false : { rejectUnauthorized: false },
});

module.exports = pool;
