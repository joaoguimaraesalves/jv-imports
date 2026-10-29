// tests/gas-falso.js — imitação do Google Apps Script para testar apps-script/src em Node.
// Planilha, Drive, Cache, Properties, Lock, Utilities, ScriptApp e UrlFetchApp em memória.
// O UrlFetchApp responde como a API do Cloudflare KV (guardando num Map).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const PASTA_SRC = path.join(__dirname, '..', 'apps-script', 'src');

function criarPlanilha(id) {
  const abas = [];
  const criarAba = (nome) => {
    const dados = []; // linhas de valores
    const aba = {
      nome,
      dados,
      getName: () => nome,
      getLastRow() {
        for (let i = dados.length - 1; i >= 0; i--) if (dados[i].some((c) => c !== '' && c !== null)) return i + 1;
        return 0;
      },
      getLastColumn() {
        let max = 0;
        dados.forEach((l) => { for (let j = l.length - 1; j >= 0; j--) if (l[j] !== '' && l[j] !== null) { max = Math.max(max, j + 1); break; } });
        return max;
      },
      getMaxRows: () => Math.max(1000, dados.length),
      getRange(r, c, nr = 1, nc = 1) {
        const intervalo = {
          getValues() {
            const out = [];
            for (let i = 0; i < nr; i++) {
              const l = dados[r - 1 + i] || [];
              const linha = [];
              for (let j = 0; j < nc; j++) linha.push(l[c - 1 + j] === undefined ? '' : l[c - 1 + j]);
              out.push(linha);
            }
            return out;
          },
          setValues(vals) {
            vals.forEach((linha, i) => {
              const idx = r - 1 + i;
              while (dados.length <= idx) dados.push([]);
              linha.forEach((v, j) => { dados[idx][c - 1 + j] = v; });
            });
            return intervalo;
          },
          clearContent() {
            for (let i = 0; i < nr; i++) {
              const l = dados[r - 1 + i];
              if (l) for (let j = 0; j < nc; j++) l[c - 1 + j] = '';
            }
            return intervalo;
          },
          setNumberFormat: () => intervalo,
          setFontWeight: () => intervalo,
          setBackground: () => intervalo,
          setFontColor: () => intervalo,
        };
        return intervalo;
      },
      getDataRange() { return aba.getRange(1, 1, Math.max(1, aba.getLastRow()), Math.max(1, aba.getLastColumn())); },
      setFrozenRows: () => {},
    };
    abas.push(aba);
    return aba;
  };
  criarAba('Página1');
  return {
    abas,
    getId: () => id,
    getUrl: () => 'https://docs.google.com/spreadsheets/d/' + id,
    getSheets: () => abas.slice(),
    getSheetByName: (n) => abas.find((a) => a.nome === n) || null,
    insertSheet: (n) => criarAba(n),
    deleteSheet: (a) => { abas.splice(abas.indexOf(a), 1); },
  };
}

const assinado = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));
const semSinal = (arr) => Buffer.from(Array.from(arr, (b) => b & 0xff));

function criarAmbiente(opcoes = {}) {
  const estado = {
    planilhas: new Map(),
    props: new Map(),
    cache: new Map(),
    drive: new Map(),      // id → { bytes(Buffer), tipo, nome, pasta, lixeira }
    pastas: new Map(),     // nome → id
    gatilhos: [],
    kv: new Map(),         // chave → Buffer
    chamadasKv: [],
    falharKv: null,        // { status, mensagem } para simular erro
    agora: null,           // número fixo para Date.now (opcional)
  };
  let seq = 0;

  const ss = criarPlanilha('planilha-1');
  estado.planilhas.set(ss.getId(), ss);

  const arquivo = (id) => {
    const f = estado.drive.get(id);
    return {
      getId: () => id,
      getBlob: () => ({ getBytes: () => assinado(f.bytes) }),
      setTrashed: (v) => { f.lixeira = v; },
      getDateCreated: () => new Date(),
      makeCopy: () => {},
    };
  };
  const pasta = (nome) => ({
    getName: () => nome,
    createFile(blob) {
      const id = 'arq-' + (++seq);
      estado.drive.set(id, { bytes: semSinal(blob.bytes), tipo: blob.tipo, nome: blob.nome, pasta: nome, lixeira: false });
      return arquivo(id);
    },
    getFiles: () => ({ hasNext: () => false }),
  });

  function respostaKv(url, opts) {
    const metodo = (opts.method || 'get').toLowerCase();
    estado.chamadasKv.push({ metodo, url, auth: opts.headers && opts.headers.Authorization });
    const json = (codigo, obj) => ({ getResponseCode: () => codigo, getContentText: () => JSON.stringify(obj) });
    if (estado.falharKv) return json(estado.falharKv.status, { success: false, errors: [{ message: estado.falharKv.mensagem }] });
    const m = url.match(/\/storage\/kv\/namespaces\/[^/]+(\/.*)$/);
    if (!m) return json(404, { errors: [{ message: 'rota' }] });
    const caminho = m[1];
    if (metodo === 'get' && caminho.startsWith('/keys')) {
      const prefixo = new URL('http://x' + caminho).searchParams.get('prefix') || '';
      return json(200, { result: [...estado.kv.keys()].filter((k) => k.startsWith(prefixo)).map((name) => ({ name })), result_info: { cursor: '' } });
    }
    const chave = decodeURIComponent(caminho.replace('/values/', ''));
    if (metodo === 'put') {
      const p = opts.payload;
      estado.kv.set(chave, typeof p === 'string' ? Buffer.from(p, 'utf8') : semSinal(p));
    }
    if (metodo === 'delete') estado.kv.delete(chave);
    return json(200, { success: true });
  }

  const RealDate = Date;
  class DataFalsa extends RealDate {
    constructor(...a) { if (a.length === 0 && estado.agora !== null) super(estado.agora); else super(...a); }
    static now() { return estado.agora !== null ? estado.agora : RealDate.now(); }
  }

  const ctx = {
    console: { log() {}, error() {}, warn() {} },
    Date: DataFalsa,
    Logger: { log() {} },
    SpreadsheetApp: {
      openById: (id) => { const p = estado.planilhas.get(id); if (!p) throw new Error('não existe'); return p; },
      create: () => ss,
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (estado.props.has(k) ? estado.props.get(k) : null),
        setProperty: (k, v) => { estado.props.set(k, String(v)); },
        deleteProperty: (k) => { estado.props.delete(k); },
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (estado.cache.has(k) ? estado.cache.get(k) : null),
        put: (k, v) => { estado.cache.set(k, v); },
        remove: (k) => { estado.cache.delete(k); },
        getAll: (ks) => Object.fromEntries(ks.filter((k) => estado.cache.has(k)).map((k) => [k, estado.cache.get(k)])),
        putAll: (o) => { Object.entries(o).forEach(([k, v]) => estado.cache.set(k, v)); },
        removeAll: (ks) => { ks.forEach((k) => estado.cache.delete(k)); },
      }),
    },
    LockService: {
      getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }),
      getUserLock: () => ({ waitLock() {}, tryLock: () => !estado.travaOcupada, releaseLock() {} }),
    },
    Utilities: {
      formatDate(d, _tz, fmt) {
        const z = (n) => String(n).padStart(2, '0');
        return fmt.replace('yyyy', d.getFullYear()).replace('MM', z(d.getMonth() + 1)).replace('dd', z(d.getDate()))
          .replace('HH', z(d.getHours())).replace('mm', z(d.getMinutes()));
      },
      base64Decode: (s) => assinado(Buffer.from(s, 'base64')),
      base64Encode: (b) => (typeof b === 'string' ? Buffer.from(b, 'utf8') : semSinal(b)).toString('base64'),
      computeDigest: (_alg, texto) => assinado(crypto.createHash('sha256').update(String(texto), 'utf8').digest()),
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      newBlob: (bytes, tipo, nome) => ({ bytes, tipo, nome }),
    },
    DriveApp: {
      getFoldersByName(nome) {
        const existe = estado.pastas.has(nome);
        let usado = false;
        return { hasNext: () => existe && !usado, next: () => { usado = true; return pasta(nome); } };
      },
      createFolder(nome) { estado.pastas.set(nome, 'pasta-' + (++seq)); return pasta(nome); },
      getFileById(id) {
        const f = estado.drive.get(id);
        if (!f || f.lixeira) throw new Error('Arquivo não encontrado: ' + id);
        return arquivo(id);
      },
    },
    UrlFetchApp: { fetch: respostaKv },
    ScriptApp: {
      getProjectTriggers: () => estado.gatilhos.map((g) => ({ getHandlerFunction: () => g.funcao })),
      newTrigger: (funcao) => {
        const g = { funcao };
        const b = {
          timeBased: () => b, everyMinutes: (n) => { g.minutos = n; return b; },
          onWeekDay: () => b, atHour: () => b,
          create: () => { estado.gatilhos.push(g); return g; },
        };
        return b;
      },
      deleteTrigger() {},
      WeekDay: { MONDAY: 'MONDAY' },
    },
    HtmlService: {},
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);

  // Ordem dos arquivos: padrão alfabética; o teste pode inverter para garantir que não depende dela
  const arquivos = opcoes.ordem || fs.readdirSync(PASTA_SRC).filter((f) => f.endsWith('.js')).sort();
  for (const arq of arquivos) {
    vm.runInContext(fs.readFileSync(path.join(PASTA_SRC, arq), 'utf8'), ctx, { filename: arq });
  }

  // Liga a planilha ao "banco" e prepara as abas, como configurar() faz no editor
  estado.props.set('BANCO_ID', ss.getId());
  ctx.configurar();

  // Atalho: chama api() como a tela faz e devolve o objeto
  const api = (metodo, url, corpo) => JSON.parse(ctx.api(metodo, url, corpo || null));
  const aba = (nome) => ss.getSheetByName(nome);
  return { ctx, estado, api, aba, ss };
}

module.exports = { criarAmbiente };
