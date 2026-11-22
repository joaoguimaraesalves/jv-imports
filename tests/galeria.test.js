// tests/galeria.test.js — fotos extras (galeria do site) no painel do Apps Script.
const { criarAmbiente } = require('./gas-falso');

const JPEG = (n) => 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, n, n, n]).toString('base64');
const CONTA = 'a'.repeat(32);
const NS = 'b'.repeat(32);

function ambiente() {
  const g = criarAmbiente();
  g.api('POST', '/api/produtos', { nome: 'QCY C30 Crossky', custo: 120, preco: 229, quantidade: 3 });
  g.api('PUT', '/api/produtos/1/foto', { foto: JPEG(1) });
  g.api('PUT', '/api/loja/config', { whatsapp: '(61) 99999-0000' });
  g.api('PUT', '/api/publicacao/config', { conta: CONTA, namespace: NS, token: 'tok', site: 'jv-imports.pages.dev' });
  return g;
}

const vitrine = (g) => JSON.parse(g.estado.kv.get('vitrine').toString('utf8'));
const produto = (g) => g.api('GET', '/api/produtos').find((p) => p.id === 1);
const versao = (u) => u.match(/v=(\d+)/)[1];

describe('fotos extras', () => {
  test('adicionar: vão para o Drive, aparecem no painel e na vitrine depois da principal', () => {
    const g = ambiente();
    g.api('POST', '/api/produtos/1/fotos', { foto: JPEG(2) });
    g.api('POST', '/api/produtos/1/fotos', { foto: JPEG(3) });
    const p = produto(g);
    expect(p.fotos_extras).toHaveLength(2);
    expect(p.fotos_extras[0].url).toMatch(/drive\.google\.com\/thumbnail\?id=/);

    JSON.parse(g.ctx.publicarLojaAgora());
    const v = vitrine(g).produtos[0];
    expect(v.fotos).toHaveLength(3);
    expect(v.foto).toBe(v.fotos[0]);
    // versões diferentes = chaves diferentes no KV, e todas subiram
    expect(new Set(v.fotos.map(versao)).size).toBe(3);
    v.fotos.forEach((u) => expect(g.estado.kv.has(`foto-1-${versao(u)}`)).toBe(true));
    expect(g.estado.kv.get(`foto-1-${versao(v.fotos[2])}`)[4]).toBe(3);
  });

  test('remover: some do painel, do Drive e (depois) da nuvem', () => {
    const g = ambiente();
    g.api('POST', '/api/produtos/1/fotos', { foto: JPEG(2) });
    const [extra] = produto(g).fotos_extras;
    g.ctx.publicarLojaAgora();
    g.api('DELETE', `/api/produtos/1/fotos/${extra.id}`);
    expect(produto(g).fotos_extras).toEqual([]);
    expect(g.estado.drive.get(extra.id).lixeira).toBe(true);
    g.ctx.publicarLojaAgora();
    expect(vitrine(g).produtos[0].fotos).toHaveLength(1);
    expect(() => g.api('DELETE', '/api/produtos/1/fotos/nao-existe')).toThrow(/não encontrada/);
  });

  test('limite de 8 fotos extras', () => {
    const g = ambiente();
    for (let i = 0; i < 8; i++) g.api('POST', '/api/produtos/1/fotos', { foto: JPEG(10 + i) });
    expect(() => g.api('POST', '/api/produtos/1/fotos', { foto: JPEG(30) })).toThrow(/até 8/);
  });

  test('foto extra apagada do Drive à mão: só ela sai do site, a principal fica', () => {
    const g = ambiente();
    g.api('POST', '/api/produtos/1/fotos', { foto: JPEG(2) });
    const [extra] = produto(g).fotos_extras;
    g.estado.drive.get(extra.id).lixeira = true;
    g.ctx.publicarLojaAgora();
    const v = vitrine(g).produtos[0];
    expect(v.fotos).toHaveLength(1);
    expect(v.foto).toBeTruthy();
  });

  test('excluir o produto apaga também as fotos extras do Drive', () => {
    const g = ambiente();
    g.api('POST', '/api/produtos/1/fotos', { foto: JPEG(2) });
    const [extra] = produto(g).fotos_extras;
    g.api('DELETE', '/api/produtos/1');
    expect(g.estado.drive.get(extra.id).lixeira).toBe(true);
  });
});

describe('trazer fotos da Nuvemshop', () => {
  function conectado() {
    const g = ambiente();
    g.estado.agora = Date.parse('2026-11-21T03:00:00Z');
    const base = 'https://dcdn-us.mitiendanube.com/stores/001/products/';
    g.estado.ns.produtos = [{
      id: 501, name: { pt: 'QCY C30 Crossky' }, variants: [{ id: 9001, stock: 3, sku: '', values: [] }],
      images: [
        { id: 71, position: 1, src: base + 'principal.jpg' },
        { id: 73, position: 3, src: base + 'verso.jpg' },
        { id: 72, position: 2, src: '//dcdn-us.mitiendanube.com/stores/001/products/caixas-480-0.webp' },
      ],
    }];
    // só existem as versões reduzidas (…-1024-1024) e a original do verso
    g.estado.ns.imagens = {
      [base + 'principal-1024-1024.jpg']: Buffer.from([0xff, 0xd8, 0xff, 1]),
      [base + 'caixas-1024-1024.webp']: Buffer.from([0xff, 0xd8, 0xff, 2]),
      [base + 'verso.jpg']: Buffer.from([0xff, 0xd8, 0xff, 3]),
    };
    const s = g.api('PUT', '/api/nuvemshop/config', { app_id: '12345', client_secret: 'segredo' });
    g.ctx.doGet({ parameter: { code: 'codigo-ok', state: new URL(s.link_autorizar).searchParams.get('state') } });
    return g;
  }

  test('traz as fotos 2 em diante como extras (principal já existe), na ordem; a publicação seguinte leva ao site', () => {
    const g = conectado();
    const r = g.api('POST', '/api/nuvemshop/fotos');
    expect(r.fotos_importadas).toBe(2);
    const extras = produto(g).fotos_extras;
    expect(extras).toHaveLength(2);
    const bytes = extras.map((e) => g.estado.drive.get(e.id).bytes[3]);
    expect(bytes).toEqual([2, 3]); // posição 2 (caixas) e depois 3 (verso)
    g.ctx.publicarLojaAgora(); // a tela chama em segundo plano
    expect(vitrine(g).produtos[0].fotos).toHaveLength(3);

    // de novo: não duplica
    expect(g.api('POST', '/api/nuvemshop/fotos').fotos_importadas).toBe(0);
    expect(produto(g).fotos_extras).toHaveLength(2);
  });

  test('produto sem foto no painel: a 1ª da Nuvemshop vira a principal', () => {
    const g = conectado();
    g.api('DELETE', '/api/produtos/1/foto');
    const r = g.api('POST', '/api/nuvemshop/fotos');
    expect(r.fotos_importadas).toBe(3);
    const p = produto(g);
    expect(p.foto_id).toBeTruthy();
    expect(g.estado.drive.get(p.foto_id).bytes[3]).toBe(1);
  });

  test('foto que não baixa vira aviso e não trava as outras', () => {
    const g = conectado();
    g.estado.ns.produtos[0].images.push({ id: 74, position: 4, src: 'https://dcdn-us.mitiendanube.com/stores/001/products/sumiu.jpg' });
    const r = g.api('POST', '/api/nuvemshop/fotos');
    expect(r.fotos_importadas).toBe(2);
    expect(r.avisos_fotos.join(' ')).toMatch(/não consegui baixar/);
  });

  test('igualar capas: a 1ª da Nuvemshop vira a capa do site e sai a cópia repetida da capa antiga', () => {
    const g = conectado();
    g.api('POST', '/api/nuvemshop/fotos'); // extras: caixas (72) e verso (73)
    // na Nuvemshop a capa passou a ser uma foto oficial nova e a antiga (71) foi para a 2ª posição
    const base = '//dcdn-us.mitiendanube.com/stores/001/products/';
    g.estado.ns.produtos[0].images = [
      { id: 80, position: 1, src: base + 'oficial.jpg' },
      { id: 71, position: 2, src: base + 'principal.jpg' },
      { id: 73, position: 3, src: base + 'verso.jpg' },
    ];
    g.estado.ns.imagens['https:' + base + 'oficial-1024-1024.jpg'] = Buffer.from([0xff, 0xd8, 0xff, 9]);
    // o "Trazer fotos" de agora pularia a 1ª e traria a 71 (cópia da capa antiga do painel)
    g.api('POST', '/api/nuvemshop/fotos');
    expect(produto(g).fotos_extras).toHaveLength(3);
    const capaAntiga = produto(g).foto_id;

    const r = g.api('POST', '/api/nuvemshop/capas');
    expect(r.capas_trocadas).toBe(1);
    expect(r.fotos_removidas).toBe(1);
    const p = produto(g);
    expect(g.estado.drive.get(p.foto_id).bytes[3]).toBe(9); // capa = oficial
    expect(p.fotos_extras.map((e) => e.id)[0]).toBe(capaAntiga); // capa antiga vira a 1ª extra
    expect(p.fotos_extras).toHaveLength(3); // antiga + caixas + verso (a cópia 71 saiu)

    // de novo: nada muda e o "Trazer fotos" não traz a oficial de volta
    expect(g.api('POST', '/api/nuvemshop/capas').capas_trocadas).toBe(0);
    expect(g.api('POST', '/api/nuvemshop/fotos').fotos_importadas).toBe(0); // nem a cópia da capa antiga
    expect(produto(g).fotos_extras).toHaveLength(3);
  });

  test('sem conexão com a Nuvemshop, avisa', () => {
    const g = ambiente();
    expect(() => g.api('POST', '/api/nuvemshop/fotos')).toThrow(/Conecte a Nuvemshop/);
  });
});

describe('usar foto extra como capa', () => {
  test('troca a capa: a extra vira a 1ª foto e a capa antiga vira a 1ª extra (nada é apagado)', () => {
    const g = ambiente();
    g.api('POST', '/api/produtos/1/fotos', { foto: JPEG(2) });
    g.api('POST', '/api/produtos/1/fotos', { foto: JPEG(3) });
    g.ctx.publicarLojaAgora();
    const antes = vitrine(g).produtos[0].fotos;
    const [, segunda] = produto(g).fotos_extras;
    g.api('POST', `/api/produtos/1/fotos/${segunda.id}/capa`);
    const p = produto(g);
    expect(p.fotos_extras).toHaveLength(2);
    g.ctx.publicarLojaAgora();
    const depois = vitrine(g).produtos[0].fotos;
    // mesmas fotos (mesmas versões/chaves no KV), só muda a ordem
    expect(depois.map(versao).sort()).toEqual(antes.map(versao).sort());
    expect(versao(depois[0])).toBe(versao(antes[2]));
    expect(versao(depois[1])).toBe(versao(antes[0]));
    expect(vitrine(g).produtos[0].foto).toBe(depois[0]);
    expect(g.estado.drive.get(segunda.id).lixeira).toBeFalsy();
    expect(() => g.api('POST', '/api/produtos/1/fotos/nao-existe/capa')).toThrow(/não encontrada/);
  });
});
