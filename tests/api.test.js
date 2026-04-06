const request = require('supertest');
const app = require('../server');

describe('Testes Automatizados - API JV Imports', () => {
    
    // 1. Caminho Feliz (Uso Correto)
    it('Deve listar os produtos do estoque com sucesso (Status 200)', async () => {
        const response = await request(app).get('/api/produtos');
        expect(response.statusCode).toBe(200);
        expect(Array.isArray(response.body)).toBeTruthy();
    });

    // 2. Entrada Inválida (Erro provocado)
    it('Deve falhar ao tentar acessar uma rota que não existe (Status 404)', async () => {
        const response = await request(app).get('/api/rota-inexistente');
        expect(response.statusCode).toBe(404);
    });

    // 3. Caso Limite / Regra de Negócio (Criar e validar um produto)
    it('Deve cadastrar um produto corretamente', async () => {
        const novoProduto = { nome: "Produto Teste", custo: 10, preco: 20, quantidade: 5 };
        const response = await request(app)
            .post('/api/produtos')
            .send(novoProduto);
        
        expect(response.statusCode).toBe(200);
        expect(response.body.ok).toBe(true);
    });
});