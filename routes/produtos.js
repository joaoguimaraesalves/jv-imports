// routes/produtos.js
const express = require('express');

module.exports = (pool) => {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM produtos ORDER BY nome');
    res.json(rows);
  });

  router.post('/', async (req, res) => {
    const { nome, custo, preco, quantidade } = req.body;
    const { rows } = await pool.query(
      'INSERT INTO produtos (nome, custo, preco, quantidade) VALUES ($1, $2, $3, $4) RETURNING id',
      [nome, custo, preco, quantidade]
    );
    res.json({ ok: true, id: rows[0].id });
  });

  // Excluir produto: o histórico (movimentos e itens de compra) é mantido e
  // passa a aparecer como "(produto excluído)". Sem isso, as chaves
  // estrangeiras impediam excluir qualquer produto que já teve movimento.
  router.delete('/:id', async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE estoque_movimentos SET produto_id = NULL WHERE produto_id = $1', [req.params.id]);
      await client.query('UPDATE compra_itens SET produto_id = NULL WHERE produto_id = $1', [req.params.id]);
      await client.query('DELETE FROM produtos WHERE id = $1', [req.params.id]);
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (e) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: e.message });
    } finally {
      client.release();
    }
  });
  // Editar cadastro. Se a quantidade mudar, registra um movimento de "ajuste"
  // (auditoria: fica claro em Movimentos que o estoque foi corrigido à mão).
  router.put('/:id', async (req, res) => {
    const { nome, custo, preco, quantidade } = req.body;
    if (!nome || !String(nome).trim()) return res.status(400).json({ error: 'Informe o nome do produto' });
    if ([custo, preco, quantidade].some(v => !Number.isFinite(Number(v)) || Number(v) < 0)) {
      return res.status(400).json({ error: 'Custo, preço e quantidade devem ser números maiores ou iguais a zero' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const antes = (await client.query('SELECT * FROM produtos WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
      if (!antes) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Produto não encontrado' });
      }
      const { rows } = await client.query(
        `UPDATE produtos SET nome = $1, custo = $2, preco = $3, quantidade = $4
         WHERE id = $5 RETURNING *`,
        [String(nome).trim(), custo, preco, parseInt(quantidade), req.params.id]
      );
      const diferenca = parseInt(quantidade) - antes.quantidade;
      if (diferenca !== 0) {
        await client.query(
          `INSERT INTO estoque_movimentos
           (produto_id, tipo, quantidade, custo_unitario, origem_tipo, origem_id, observacao, data)
           VALUES ($1, 'ajuste', $2, $3, 'ajuste', NULL, $4, $5)`,
          [antes.id, diferenca, custo, `Ajuste manual: ${antes.quantidade} → ${parseInt(quantidade)}`,
           new Date().toISOString()]
        );
      }
      await client.query('COMMIT');
      res.json({ ok: true, produto: rows[0] });
    } catch (e) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: e.message });
    } finally {
      client.release();
    }
  });

  return router;
};
