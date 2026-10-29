// tests/loja.test.js — regras da vitrine pública (sem banco)
const { montarVitrine, normalizarConfig, configDeLinhas, lerFoto, limparWhatsapp, escaparHtml } = require('../lib/loja');

const base = { custo: 50, quantidade: 5, na_loja: true, destaque: false, preco_antigo: null, descricao: null, categoria: 'Fones', foto_em: null };
const prod = (id, extra) => ({ ...base, id, nome: 'Produto ' + id, preco: 100, ...extra });

describe('montarVitrine', () => {
  test('nunca expõe custo nem a quantidade exata', () => {
    const [p] = montarVitrine([prod(1, { quantidade: 37 })]);
    expect(p).not.toHaveProperty('custo');
    expect(p).not.toHaveProperty('quantidade');
    expect(JSON.stringify(p)).not.toContain('37');
    expect(p.max_compra).toBe(10);
  });

  test('esconde produto oculto e produto sem preço', () => {
    const lista = montarVitrine([prod(1), prod(2, { na_loja: false }), prod(3, { preco: 0 })]);
    expect(lista.map(p => p.id)).toEqual([1]);
  });

  test('últimas unidades só aparecem com 3 ou menos', () => {
    const lista = montarVitrine([prod(1, { quantidade: 3 }), prod(2, { quantidade: 4 }), prod(3, { quantidade: 0 })]);
    const porId = Object.fromEntries(lista.map(p => [p.id, p]));
    expect(porId[1].ultimas).toBe(3);
    expect(porId[2].ultimas).toBeNull();
    expect(porId[3].disponivel).toBe(false);
    expect(porId[3].ultimas).toBeNull();
  });

  test('esgotados vão para o fim e somem se a loja escolher esconder', () => {
    const produtos = [prod(1, { nome: 'A', quantidade: 0 }), prod(2, { nome: 'B' })];
    expect(montarVitrine(produtos).map(p => p.id)).toEqual([2, 1]);
    expect(montarVitrine(produtos, [], { mostrar_esgotados: 'nao' }).map(p => p.id)).toEqual([2]);
  });

  test('promoção só vale se o preço "de" for maior', () => {
    const lista = montarVitrine([prod(1, { preco: 80, preco_antigo: 100 }), prod(2, { preco: 80, preco_antigo: 70 })]);
    const porId = Object.fromEntries(lista.map(p => [p.id, p]));
    expect(porId[1].desconto).toBe(20);
    expect(porId[1].preco_antigo).toBe(100);
    expect(porId[2].preco_antigo).toBeNull();
    expect(porId[2].desconto).toBe(0);
  });

  test('mais vendido: top 3 com pelo menos 2 unidades', () => {
    const produtos = [1, 2, 3, 4, 5].map(id => prod(id));
    const vendidos = [
      { produto_id: 1, total: '9' }, { produto_id: 2, total: '7' }, { produto_id: 3, total: '5' },
      { produto_id: 4, total: '4' }, { produto_id: 5, total: '1' },
    ];
    const top = montarVitrine(produtos, vendidos).filter(p => p.mais_vendido).map(p => p.id).sort();
    expect(top).toEqual([1, 2, 3]);
  });

  test('foto vira URL versionada', () => {
    const [p] = montarVitrine([prod(7, { foto_em: '2026-10-29T10:00:00.000Z' })]);
    expect(p.foto).toBe('/api/loja/foto/7?v=' + Date.parse('2026-10-29T10:00:00.000Z'));
  });
});

describe('configuração da loja', () => {
  test('WhatsApp ganha o 55 quando vem só com DDD', () => {
    expect(limparWhatsapp('(61) 99999-8888')).toBe('5561999998888');
    expect(limparWhatsapp('+55 61 99999-8888')).toBe('5561999998888');
    expect(limparWhatsapp('')).toBe('');
  });

  test('normaliza Instagram e ignora campos desconhecidos', () => {
    const c = normalizarConfig({ instagram: 'https://instagram.com/jvimports/', hack: 'x', mostrar_esgotados: 'talvez' });
    expect(c).toEqual({ instagram: 'jvimports', mostrar_esgotados: 'sim' });
  });

  test('linhas do banco sobrepõem o padrão', () => {
    const c = configDeLinhas([{ chave: 'loja_whatsapp', valor: '5561999998888' }]);
    expect(c.whatsapp).toBe('5561999998888');
    expect(c.mostrar_esgotados).toBe('sim');
  });
});

describe('fotos', () => {
  const jpeg = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64');

  test('aceita JPEG válido', () => {
    const f = lerFoto(jpeg);
    expect(f.erro).toBeUndefined();
    expect(f.tipo).toBe('image/jpeg');
  });

  test('recusa arquivo que diz ser imagem mas não é', () => {
    const falso = 'data:image/png;base64,' + Buffer.from('<script>').toString('base64');
    expect(lerFoto(falso).erro).toBeTruthy();
    expect(lerFoto('data:text/html;base64,AAAA').erro).toBeTruthy();
  });

  test('recusa acima de 2 MB', () => {
    const grande = Buffer.alloc(2 * 1024 * 1024 + 10, 0);
    grande[0] = 0xff; grande[1] = 0xd8; grande[2] = 0xff;
    expect(lerFoto('data:image/jpeg;base64,' + grande.toString('base64')).erro).toMatch(/2 MB/);
  });
});

test('escaparHtml neutraliza tags', () => {
  expect(escaparHtml('<b>"x"</b>')).toBe('&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
});
