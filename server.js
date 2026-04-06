const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const app = express();
const port = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 1. NOVO BANCO DE DADOS (Estrutura Atualizada)
const db = new sqlite3.Database('./sistema.sqlite', (err) => {
    if (err) console.error(err.message);
    else {
        console.log('Banco de dados da JV Imports conectado!');
        // Tabela Vendas agora tem ID do produto, nome e quantidade
        db.run(`CREATE TABLE IF NOT EXISTS vendas (id INTEGER PRIMARY KEY AUTOINCREMENT, produto_id INTEGER, produto_nome TEXT, quantidade INTEGER, valor REAL, custo REAL, data TEXT)`);
        // Tabela Produtos agora tem Custo de fábrica
        db.run(`CREATE TABLE IF NOT EXISTS produtos (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT, custo REAL, preco REAL, quantidade INTEGER)`);
        db.run(`CREATE TABLE IF NOT EXISTS saidas (id INTEGER PRIMARY KEY AUTOINCREMENT, descricao TEXT, valor REAL, data TEXT)`);
    }
});

// 2. DASHBOARD E GRÁFICOS
app.get('/api/dashboard', (req, res) => {
    db.get(`SELECT SUM(valor) as vendas, SUM(custo) as custos, SUM(quantidade) as qtd FROM vendas`, [], (err, rowVendas) => {
        db.get(`SELECT SUM(valor) as total_saidas FROM saidas`, [], (err, rowSaidas) => {
            const vendas = rowVendas.vendas || 0;
            const custos = rowVendas.custos || 0;
            const saidas = rowSaidas.total_saidas || 0;
            const lucroLiquido = vendas - custos - saidas;

            res.json({
                total_vendas: vendas, custos: custos, saidas: saidas,
                lucro_liquido: lucroLiquido, qtd_vendida: rowVendas.qtd || 0,
                ticket_medio: rowVendas.qtd > 0 ? (vendas / rowVendas.qtd) : 0,
                margem: vendas > 0 ? ((lucroLiquido / vendas) * 100).toFixed(2) : 0
            });
        });
    });
});

app.get('/api/grafico', (req, res) => {
    db.all(`SELECT valor, custo, date(data) as dia FROM vendas`, [], (err, vendas) => {
        db.all(`SELECT valor, date(data) as dia FROM saidas`, [], (err, saidas) => res.json({ vendas, saidas }));
    });
});

// 3. VENDAS (Com baixa automática no estoque)
app.get('/api/vendas', (req, res) => db.all(`SELECT * FROM vendas ORDER BY id DESC`, [], (err, rows) => res.json(rows)));

app.post('/api/vendas', (req, res) => {
    const { produto_id, produto_nome, quantidade, valor, custo } = req.body;
    
    // Registra a Venda
    db.run(`INSERT INTO vendas (produto_id, produto_nome, quantidade, valor, custo, data) VALUES (?, ?, ?, ?, ?, ?)`, 
    [produto_id, produto_nome, quantidade, valor, custo, new Date().toISOString()], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        
        // Desconta do Estoque
        db.run(`UPDATE produtos SET quantidade = quantidade - ? WHERE id = ?`, [quantidade, produto_id], () => {
            res.json({ ok: true });
        });
    });
});

// Excluir venda e DEVOLVER o produto pro estoque
app.delete('/api/vendas/:id', (req, res) => {
    db.get(`SELECT produto_id, quantidade FROM vendas WHERE id = ?`, [req.params.id], (err, row) => {
        if (row && row.produto_id) {
            // Devolve pro estoque
            db.run(`UPDATE produtos SET quantidade = quantidade + ? WHERE id = ?`, [row.quantidade, row.produto_id]);
        }
        db.run(`DELETE FROM vendas WHERE id = ?`, [req.params.id], () => res.json({ ok: true }));
    });
});

// 4. PRODUTOS (ESTOQUE)
app.get('/api/produtos', (req, res) => db.all(`SELECT * FROM produtos`, [], (err, rows) => res.json(rows)));
app.post('/api/produtos', (req, res) => db.run(`INSERT INTO produtos (nome, custo, preco, quantidade) VALUES (?, ?, ?, ?)`, [req.body.nome, req.body.custo, req.body.preco, req.body.quantidade], () => res.json({ ok: true })));
app.delete('/api/produtos/:id', (req, res) => db.run(`DELETE FROM produtos WHERE id = ?`, [req.params.id], () => res.json({ ok: true })));

// 5. SAÍDAS (GASTOS)
app.get('/api/saidas', (req, res) => db.all(`SELECT * FROM saidas ORDER BY id DESC`, [], (err, rows) => res.json(rows)));
app.post('/api/saidas', (req, res) => db.run(`INSERT INTO saidas (descricao, valor, data) VALUES (?, ?, ?)`, [req.body.descricao, req.body.valor, new Date().toISOString()], () => res.json({ ok: true })));
app.delete('/api/saidas/:id', (req, res) => db.run(`DELETE FROM saidas WHERE id = ?`, [req.params.id], () => res.json({ ok: true })));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
// Exporta o app para os testes automatizados
module.exports = app;

// Só inicia o servidor se NÃO estiver rodando testes
if (require.main === module) {
    app.listen(port, () => console.log(`🚀 JV Imports rodando! Acesse: http://localhost:${port}`));
}