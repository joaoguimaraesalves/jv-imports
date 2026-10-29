/**
 * Banco de dados em planilha do Google.
 *
 * Cada tabela do antigo Postgres vira uma aba; a primeira linha tem o nome das colunas.
 * Toda chamada do sistema roda dentro de transacao_(): as abas usadas são lidas para a
 * memória, as alterações são feitas na memória e só são gravadas no fim. Se algo der
 * erro no meio, nada é gravado (o equivalente ao ROLLBACK). Uma trava (LockService)
 * garante que duas operações não se misturem.
 */

const FUSO = 'America/Sao_Paulo';
const PROP_BANCO = 'BANCO_ID';
const NOME_PLANILHA = 'JV Imports - Banco de Dados';

/** Colunas e tipos de cada tabela (int, num, text, bool, json). */
const ESQUEMA = {
  // descricao..foto_em: loja online (site). Colunas novas entram sozinhas no fim da aba.
  produtos: {
    id: 'int', nome: 'text', custo: 'num', preco: 'num', quantidade: 'int',
    descricao: 'text', categoria: 'text', na_loja: 'bool', destaque: 'bool', preco_antigo: 'num',
    foto_id: 'text', foto_em: 'text',
  },
  vendas: {
    id: 'int', produto_id: 'int', produto_nome: 'text', quantidade: 'int', valor: 'num', custo: 'num',
    forma_pagamento: 'text', data: 'text', recebido: 'bool', cliente: 'text', receber_ate: 'text',
    data_recebimento: 'text', historico: 'bool',
    // canal: onde vendeu (OLX, Instagram...). taxa: o que a maquininha cobrou (R$).
    // gastos_extras: motoboy, embalagem etc. (R$). Os dois saem do lucro e do caixa.
    canal: 'text', taxa: 'num', gastos_extras: 'num',
  },
  compras: {
    id: 'int', descricao: 'text', valor_total: 'num', forma_pagamento: 'text', parcelas: 'int',
    data: 'text', historico: 'bool',
  },
  compra_itens: {
    id: 'int', compra_id: 'int', produto_id: 'int', produto_nome: 'text', quantidade: 'int', custo_unitario: 'num',
  },
  contas_pagar: {
    id: 'int', descricao: 'text', valor: 'num', vencimento: 'text', status: 'text', data_pagamento: 'text',
    compra_id: 'int', parcela_num: 'int', parcela_total: 'int',
  },
  estoque_movimentos: {
    id: 'int', produto_id: 'int', tipo: 'text', quantidade: 'int', custo_unitario: 'num', origem_tipo: 'text',
    origem_id: 'int', observacao: 'text', data: 'text',
  },
  configuracoes: { chave: 'text', valor: 'text', atualizado_em: 'text' },
  historico_calculos: { id: 'int', data: 'text', dados: 'json' },
};

/** Valores padrão (os DEFAULT do Postgres). */
const PADROES = {
  produtos: { custo: 0, preco: 0, quantidade: 0, na_loja: true, destaque: false },
  vendas: { recebido: true, historico: false },
  compras: { parcelas: 1, historico: false },
  contas_pagar: { status: 'pendente' },
};

/* ============================== Planilha ============================== */

/** Abre a planilha do banco; na primeira vez cria no Drive de quem publicou o sistema. */
function planilha_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(PROP_BANCO);
  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (e) {
      throw new Error('Não consegui abrir a planilha do banco (' + id + '). Ela foi apagada ou movida para a lixeira?');
    }
  }
  const ss = SpreadsheetApp.create(NOME_PLANILHA);
  const inicial = ss.getSheets()[0];
  Object.keys(ESQUEMA).forEach(function (nome) { prepararAba_(ss, nome); });
  ss.deleteSheet(inicial);
  props.setProperty(PROP_BANCO, ss.getId());
  return ss;
}

/** Cria a aba da tabela (ou acrescenta colunas novas do esquema) e deixa as colunas de texto como texto puro. */
function prepararAba_(ss, nome) {
  const colunas = Object.keys(ESQUEMA[nome]);
  let aba = ss.getSheetByName(nome);
  if (!aba) aba = ss.insertSheet(nome);
  const ultima = aba.getLastColumn();
  const atuais = ultima ? aba.getRange(1, 1, 1, ultima).getValues()[0].map(String) : [];
  const faltando = colunas.filter(function (c) { return atuais.indexOf(c) === -1; });
  if (faltando.length) {
    aba.getRange(1, atuais.length + 1, 1, faltando.length).setValues([faltando]);
  }
  const cabecalho = atuais.concat(faltando);
  // Texto puro: impede o Google de transformar "2026-10-21" em data ou "001" em número.
  cabecalho.forEach(function (c, i) {
    const tipo = ESQUEMA[nome][c];
    if (tipo === 'text' || tipo === 'json') aba.getRange(1, i + 1, aba.getMaxRows(), 1).setNumberFormat('@');
  });
  aba.getRange(1, 1, 1, cabecalho.length).setFontWeight('bold').setBackground('#1e293b').setFontColor('#ffffff');
  aba.setFrozenRows(1);
  return aba;
}

/* ============================== Transação ============================== */

/**
 * Leituras (somenteLeitura) não usam a trava e leem do cache, então várias chamadas
 * da mesma tela rodam ao mesmo tempo. Gravações usam a trava, leem a planilha (fonte
 * da verdade) e, no fim, atualizam o cache com o estado novo.
 */
function transacao_(fn, somenteLeitura) {
  if (somenteLeitura) {
    // Só pega a trava se alguma aba não estiver no cache (ver carregar_).
    const leitura = new Tx_(null, true);
    try {
      return fn(leitura);
    } finally {
      if (leitura.lock) leitura.lock.releaseLock();
    }
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const tx = new Tx_(planilha_(), false);
    const resultado = fn(tx);
    tx.gravar_();
    return resultado;
  } finally {
    lock.releaseLock();
  }
}

/* ---------- cache das abas ---------- */

const CACHE_PREFIXO = 'jv:tabela:';
const CACHE_SEGUNDOS = 600;   // edições feitas direto na planilha aparecem em até 10 min
const CACHE_MAX = 90000;      // limite do CacheService é 100 KB por item

function cacheLer_() {
  const nomes = Object.keys(ESQUEMA).map(function (n) { return CACHE_PREFIXO + n; });
  const brutos = CacheService.getScriptCache().getAll(nomes);
  const tabelas = {};
  Object.keys(ESQUEMA).forEach(function (n) {
    const v = brutos[CACHE_PREFIXO + n];
    if (v) { try { tabelas[n] = JSON.parse(v); } catch (e) { /* ignora item corrompido */ } }
  });
  return tabelas;
}

function cacheGravar_(tabelas) {
  const itens = {};
  const remover = [];
  Object.keys(tabelas).forEach(function (n) {
    const json = JSON.stringify(tabelas[n]);
    if (json.length <= CACHE_MAX) itens[CACHE_PREFIXO + n] = json;
    else remover.push(CACHE_PREFIXO + n); // tabela grande demais: sempre lê da planilha
  });
  const cache = CacheService.getScriptCache();
  if (Object.keys(itens).length) cache.putAll(itens, CACHE_SEGUNDOS);
  if (remover.length) cache.removeAll(remover);
}

/** Rode pelo editor se editar a planilha à mão e quiser ver a mudança na hora. */
function limparCache() {
  CacheService.getScriptCache().removeAll(Object.keys(ESQUEMA).map(function (n) { return CACHE_PREFIXO + n; }));
}

function Tx_(ss, somenteLeitura) {
  this.ss = ss;
  this.somenteLeitura = somenteLeitura;
  this.tabelas = {};   // nome -> { aba, cabecalho, linhas }
  this.alteradas = {};
  this.doCache = somenteLeitura ? cacheLer_() : {};
  this.paraCache = {};
}

/** Linhas da tabela (objetos). Alterar o objeto devolvido altera a tabela na memória. */
Tx_.prototype.linhas = function (nome) {
  return this.carregar_(nome).linhas;
};

Tx_.prototype.carregar_ = function (nome) {
  if (this.tabelas[nome]) return this.tabelas[nome];
  if (!ESQUEMA[nome]) throw new Error('Tabela desconhecida: ' + nome);
  if (this.doCache[nome]) {
    this.tabelas[nome] = { linhas: this.doCache[nome] };
    return this.tabelas[nome];
  }
  if (this.somenteLeitura && !this.lock) {
    // Leitura que precisa ir à planilha: espera gravações em andamento terminarem,
    // para não guardar no cache um estado pela metade.
    this.lock = LockService.getScriptLock();
    this.lock.waitLock(30000);
  }
  if (!this.ss) this.ss = planilha_();
  let aba = this.ss.getSheetByName(nome);
  if (!aba || aba.getLastColumn() < Object.keys(ESQUEMA[nome]).length) aba = prepararAba_(this.ss, nome);
  const valores = aba.getDataRange().getValues();
  const cabecalho = valores[0].map(String);
  const tipos = ESQUEMA[nome];
  const linhas = [];
  for (let i = 1; i < valores.length; i++) {
    const v = valores[i];
    if (v.every(function (c) { return c === '' || c === null; })) continue;
    const obj = {};
    cabecalho.forEach(function (c, j) { if (tipos[c]) obj[c] = lerCelula_(v[j], tipos[c]); });
    linhas.push(obj);
  }
  const t = { aba: aba, cabecalho: cabecalho, linhas: linhas };
  this.tabelas[nome] = t;
  // Leitura: guarda já. Gravação: guarda no fim, com o estado novo (ver gravar_).
  if (this.somenteLeitura) cacheGravar_({ [nome]: linhas });
  return t;
};

/** Insere uma linha; gera o id (como o SERIAL) quando a tabela tem id. Devolve a linha inserida. */
Tx_.prototype.inserir = function (nome, dados) {
  const t = this.carregar_(nome);
  const linha = {};
  Object.keys(ESQUEMA[nome]).forEach(function (c) { linha[c] = null; });
  Object.assign(linha, PADROES[nome] || {});
  Object.keys(dados).forEach(function (c) {
    if (c in ESQUEMA[nome] && dados[c] !== undefined) linha[c] = dados[c];
  });
  if ('id' in ESQUEMA[nome] && !linha.id) {
    linha.id = t.linhas.reduce(function (m, l) { return Math.max(m, l.id || 0); }, 0) + 1;
  }
  t.linhas.push(linha);
  this.alteradas[nome] = true;
  return linha;
};

Tx_.prototype.porId = function (nome, id) {
  id = Number(id);
  return this.linhas(nome).find(function (l) { return l.id === id; }) || null;
};

/** Marca a tabela para gravação depois de alterar objetos devolvidos por linhas()/porId(). */
Tx_.prototype.alterou = function (nome) {
  this.carregar_(nome);
  this.alteradas[nome] = true;
};

/** Remove as linhas em que filtro(linha) é verdadeiro. Devolve quantas saíram. */
Tx_.prototype.excluir = function (nome, filtro) {
  const t = this.carregar_(nome);
  const antes = t.linhas.length;
  t.linhas = t.linhas.filter(function (l) { return !filtro(l); });
  if (t.linhas.length !== antes) this.alteradas[nome] = true;
  return antes - t.linhas.length;
};

Tx_.prototype.gravar_ = function () {
  if (this.somenteLeitura) {
    if (Object.keys(this.alteradas).length) throw new Error('Operação de leitura tentou gravar dados');
    return;
  }
  const self = this;
  Object.keys(this.alteradas).forEach(function (nome) {
    const t = self.tabelas[nome];
    const tipos = ESQUEMA[nome];
    const n = t.cabecalho.length;
    const ultima = t.aba.getLastRow();
    const valores = t.linhas.map(function (l) {
      return t.cabecalho.map(function (c) { return tipos[c] ? escreverCelula_(l[c], tipos[c]) : ''; });
    });
    // Escreve primeiro e só depois limpa as linhas que sobraram (nunca deixa a aba vazia no meio).
    if (valores.length) t.aba.getRange(2, 1, valores.length, n).setValues(valores);
    const sobra = ultima - 1 - valores.length;
    if (sobra > 0) t.aba.getRange(2 + valores.length, 1, sobra, n).clearContent();
  });
  // Cache com o estado atual de todas as abas lidas (já com as alterações gravadas).
  // Passa pelo JSON para guardar exatamente o que a planilha devolveria.
  const estado = {};
  Object.keys(this.tabelas).forEach(function (nome) { estado[nome] = self.tabelas[nome].linhas; });
  cacheGravar_(JSON.parse(JSON.stringify(estado)));
  this.alteradas = {};
};

/* ============================== Conversão ============================== */

function lerCelula_(v, tipo) {
  if (v === '' || v === null || v === undefined) {
    return tipo === 'bool' ? null : null;
  }
  switch (tipo) {
    case 'int': return Math.round(Number(v));
    case 'num': return Number(v);
    case 'bool': return v === true || String(v).toLowerCase() === 'true';
    case 'json':
      try { return JSON.parse(String(v)); } catch (e) { return null; }
    default:
      // Se alguém editou a planilha à mão e o Google virou data, volta para texto ISO.
      if (v instanceof Date) return v.toISOString();
      return String(v);
  }
}

function escreverCelula_(v, tipo) {
  if (v === null || v === undefined) return '';
  switch (tipo) {
    case 'int':
    case 'num': return Number(v);
    case 'bool': return v ? true : false;
    case 'json': return JSON.stringify(v);
    default: return String(v);
  }
}

/* ============================== Utilidades ============================== */

const soma_ = function (linhas, campo) {
  return linhas.reduce(function (s, l) { return s + (Number(l[campo]) || 0); }, 0);
};

/** Taxa da maquininha + gastos extras de uma venda (vendas antigas não têm: contam 0). */
function despesasVenda_(v) {
  return (Number(v.taxa) || 0) + (Number(v.gastos_extras) || 0);
}

/** Lucro de verdade da venda: valor − custo do produto − taxa − gastos extras. */
function lucroVenda_(v) {
  return (Number(v.valor) || 0) - (Number(v.custo) || 0) - despesasVenda_(v);
}

/** Soma do que de fato entrou na conta (valor − taxa − gastos extras). */
function somaLiquida_(vendas) {
  return vendas.reduce(function (s, v) { return s + (Number(v.valor) || 0) - despesasVenda_(v); }, 0);
}

function agoraIso_() {
  return new Date().toISOString();
}

function hojeIso_() {
  return new Date().toISOString().slice(0, 10);
}

/** Erro com mensagem para mostrar na tela (o equivalente às respostas 400/404 do Express). */
function erro_(mensagem) {
  return new Error(mensagem);
}
