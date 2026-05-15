const request = require('supertest');
const app = require('../server');
const { resetarCacheCotacao } = require('../server');

describe('GET /api/cotacao - Integração com AwesomeAPI', () => {
  const fetchOriginal = global.fetch;

  beforeEach(() => {
    // Limpa cache antes de cada teste para garantir isolamento
    resetarCacheCotacao();
  });

  afterEach(() => {
    global.fetch = fetchOriginal;
    jest.clearAllMocks();
  });

  test('deve retornar cotações de USD e EUR formatadas', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        USDBRL: {
          code: 'USD',
          codein: 'BRL',
          bid: '5.1234',
          pctChange: '0.45',
          create_date: '2026-05-15 10:00:00',
        },
        EURBRL: {
          code: 'EUR',
          codein: 'BRL',
          bid: '5.5678',
          pctChange: '-0.12',
          create_date: '2026-05-15 10:00:00',
        },
      }),
    });

    const res = await request(app).get('/api/cotacao');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('usd');
    expect(res.body).toHaveProperty('eur');
    expect(res.body.usd.valor).toBeCloseTo(5.1234);
    expect(res.body.eur.valor).toBeCloseTo(5.5678);
    expect(res.body.fonte).toBe('AwesomeAPI');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('economia.awesomeapi.com.br')
    );
  });

  test('deve retornar 502 quando a API externa falha', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    });

    const res = await request(app).get('/api/cotacao');

    expect(res.status).toBe(502);
    expect(res.body).toHaveProperty('erro');
  });

  test('deve retornar 500 quando ocorre erro de rede', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network down'));

    const res = await request(app).get('/api/cotacao');

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('erro');
  });

  test('deve retornar 429 quando a API externa atinge rate limit', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({}),
    });

    const res = await request(app).get('/api/cotacao');

    expect(res.status).toBe(429);
    expect(res.body).toHaveProperty('erro');
  });

  test('deve servir do cache quando disponível e API externa falha', async () => {
    // Primeira chamada: sucesso, popula o cache
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        USDBRL: { bid: '5.0000', pctChange: '0.00', create_date: '2026-05-15 10:00:00' },
        EURBRL: { bid: '5.5000', pctChange: '0.00', create_date: '2026-05-15 10:00:00' },
      }),
    });
    await request(app).get('/api/cotacao');

    // Segunda chamada: API falha, mas cache deve responder
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    });

    const res = await request(app).get('/api/cotacao');
    expect(res.status).toBe(200);
    expect(res.body.usd.valor).toBeCloseTo(5.0);
  });
});