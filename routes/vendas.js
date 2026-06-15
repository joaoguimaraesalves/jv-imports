// routes/vendas.js
const express = require('express');

module.exports = (pool) => {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM vendas ORDER BY id DESC');
    res.json(rows);
  });

  // Criar venda: insere a venda, baixa o estoque e registra o movimento,
  // tudo dentro de uma transação (BEGIN/COMMIT). Se algo falhar, ROLLBACK
  // e nada fica salvo pela metade.
  router.post('/', async (req, res) => {
    const venda = {
      ...req.body,
      forma_pagamento: req.body.forma_pagamento || null,
      data: new Date().toISOString(),
    };

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const insVenda = await client.query(
        `INSERT INTO vendas (produto_id, produto_nome, quantidade, valor, custo, forma_pagamento, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [venda.produto_id, venda.produto_nome, venda.quantidade, venda.valor,
         venda.custo, venda.forma_pagamento, venda.data]
      );
      const vendaId = insVenda.rows[0].id;

      await client.query(
        'UPDATE produtos SET quantidade = quantidade - $1 WHERE id = $2',
        [venda.quantidade, venda.produto_id]
      );

      // Custo unitário médio — "custo" é o total, então dividimos pela qtd
      const custoUnit = venda.custo / venda.quantidade;
      await client.query(
        `INSERT INTO estoque_movimentos
         (produto_id, tipo, quantidade, custo_unitario, origem_tipo, origem_id, observacao, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [venda.produto_id, 'saida', venda.quantidade, custoUnit, 'venda',
         vendaId, `Venda #${vendaId}`, venda.data]
      );

      await client.query('COMMIT');
      res.json({ ok: true, id: vendaId });
    } catch (e) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: e.message });
    } finally {
      client.release();
    }
  });

  // Excluir venda: devolve o estoque e remove o movimento, em transação.
  router.delete('/:id', async (req, res) => {
    const id = req.params.id;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query('SELECT * FROM vendas WHERE id = $1', [id]);
      const venda = rows[0];
      if (venda && venda.produto_id) {
        await client.query(
          'UPDATE produtos SET quantidade = quantidade + $1 WHERE id = $2',
          [venda.quantidade, venda.produto_id]
        );
      }

      await client.query(
        `DELETE FROM estoque_movimentos WHERE origem_tipo = 'venda' AND origem_id = $1`,
        [id]
      );
      await client.query('DELETE FROM vendas WHERE id = $1', [id]);

      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (e) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: e.message });
    } finally {
      client.release();
    }
  });

  return router;
};
