/**
 * tests/painel-sessao.test.mjs
 * -----------------------------------------------------------------------------
 * A tela de login não pode aparecer para quem já está logada.
 *
 * O BUG QUE ESTE ARQUIVO IMPEDE DE VOLTAR
 *   Cada tela do painel é uma página separada, então trocar de aba recarrega
 *   todo o JavaScript. A primeira versão mostrava o formulário de login e só
 *   depois ia ao servidor confirmar o perfil — o que fazia o login PISCAR a
 *   cada navegação. Pior: o painel não carrega js/main.js, então a sessão
 *   guardada nem era restaurada, e a primeira requisição saía sem token,
 *   levava 401 e esperava uma renovação. Duas idas à rede antes de a tela
 *   aparecer.
 *
 *   A correção foi abrir o painel direto quando há sessão válida, deixando a
 *   permissão ser confirmada pela própria requisição de dados da tela.
 *
 * Roda no Node, sem navegador: o DOM é um boneco que só sabe guardar o
 * `hidden` de cada área — que é exatamente o que precisa ser observado.
 */

import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const RAIZ = process.argv[2];

let ok = 0;
let falhas = 0;

const verificar = (nome, condicao, detalhe = '') => {
  if (condicao) {
    console.log(`  ✓ ${nome}`);
    ok += 1;
  } else {
    console.log(`  ✗ ${nome}  ${detalhe}`);
    falhas += 1;
  }
};

/* -----------------------------------------------------------------------------
 * Credenciais de mentira — `autenticacaoDisponivel` precisa ser verdadeiro,
 * e nenhuma delas chega a ser usada: não há rede neste teste.
 *
 * `__ENV__` é o mesmo canal que o dev-server usa para injetar as variáveis
 * públicas quando o site roda sem o Vite (ver js/config.js).
 * -------------------------------------------------------------------------- */

globalThis.__ENV__ = {
  VITE_SUPABASE_URL: 'https://exemplo.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'chave-publica-de-mentira',
};

/* -----------------------------------------------------------------------------
 * DOM de mentira
 * -------------------------------------------------------------------------- */

const CHAVE_SESSAO = 'docefefe21:sessao:v1';

/** Elemento que sabe o suficiente para `criar()` e para guardar `hidden`. */
function elemento() {
  return {
    hidden: false,
    style: {},
    dataset: {},
    files: [],
    className: '',
    textContent: '',
    setAttribute(nome) {
      if (nome === 'hidden') this.hidden = true;
    },
    removeAttribute(nome) {
      if (nome === 'hidden') this.hidden = false;
    },
    append() {},
    replaceChildren() {},
    addEventListener() {},
    focus() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    content: { firstElementChild: null },
  };
}

const areas = {
  '[data-admin-login]': elemento(),
  '[data-admin-painel]': elemento(),
  '[data-admin-topo]': elemento(),
};

// Estado inicial das páginas: as DUAS áreas começam escondidas.
areas['[data-admin-login]'].hidden = true;
areas['[data-admin-painel]'].hidden = true;

/** Fica true se o login aparecer em QUALQUER momento. */
let loginApareceu = false;

const observar = () => {
  if (!areas['[data-admin-login]'].hidden) loginApareceu = true;
};

for (const area of Object.values(areas)) {
  const remover = area.removeAttribute.bind(area);
  area.removeAttribute = (nome) => {
    remover(nome);
    observar();
  };
}

let sessaoGuardada = null;

const armazenamento = {
  getItem: (chave) => (chave === CHAVE_SESSAO ? sessaoGuardada : null),
  setItem() {},
  removeItem() {
    sessaoGuardada = null;
  },
};

globalThis.window = {
  location: { pathname: '/admin/produtos.html', search: '' },
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  addEventListener() {},
  localStorage: armazenamento,
  scrollTo() {},
  history: { replaceState() {}, pushState() {} },
};
globalThis.localStorage = armazenamento;
globalThis.Node = class {};
globalThis.CustomEvent = class {
  constructor(nome, opcoes) {
    this.type = nome;
    Object.assign(this, opcoes);
  }
};
globalThis.document = {
  readyState: 'complete',
  querySelector: (seletor) => areas[seletor] || null,
  querySelectorAll: () => [],
  createElement: elemento,
  createTextNode: () => ({}),
  addEventListener() {},
  dispatchEvent() {},
  head: { append() {} },
  body: { append() {} },
};

/*
  Não há servidor neste teste. O contador existe porque, com sessão válida,
  abrir o painel não pode depender de ida à rede — era justamente a espera
  pela resposta que deixava o login à mostra.

  Com a sessão vencida a história é outra: aí a tentativa de renovar é
  esperada, e falha, que é o cenário que queremos observar.
*/
let chamadasDeRede = 0;
globalThis.fetch = async () => {
  chamadasDeRede += 1;
  return { ok: false, status: 500, json: async () => ({}), headers: new Map() };
};

/* -----------------------------------------------------------------------------
 * Carga do módulo
 * -------------------------------------------------------------------------- */

const { iniciarPainel } = await import(
  pathToFileURL(join(RAIZ, 'js/admin/sessao.js')).href
);

/* =============================================================================
 * 1. COM SESSÃO VÁLIDA — trocar de aba não pode piscar o login
 * ========================================================================== */

console.log('\n── Com sessão válida ──\n');

sessaoGuardada = JSON.stringify({
  access_token: 'token-de-mentira',
  refresh_token: 'refresh-de-mentira',
  // Bem longe de vencer: não há motivo para renovar.
  expires_at: Date.now() + 3_600_000,
  user: { id: 'u1', email: 'fefe@exemplo.com' },
});

let entrou = false;

await iniciarPainel({
  titulo: 'Catálogo',
  aoEntrar: () => {
    entrou = true;
  },
});

verificar('o painel abre', areas['[data-admin-painel]'].hidden === false);

verificar('a tela carrega seus dados', entrou);

verificar(
  'o login NUNCA aparece — nem por um instante',
  loginApareceu === false,
  'era isso que piscava a cada troca de aba'
);

verificar(
  'abrir o painel não depende de ida à rede',
  chamadasDeRede === 0,
  `${chamadasDeRede} chamada(s) — a sessão guardada basta`
);

/* =============================================================================
 * 2. SEM SESSÃO — aí sim, o login
 * ========================================================================== */

console.log('\n── Sem sessão ──\n');

sessaoGuardada = null;
loginApareceu = false;
entrou = false;
areas['[data-admin-login]'].hidden = true;
areas['[data-admin-painel]'].hidden = true;

await iniciarPainel({
  titulo: 'Catálogo',
  aoEntrar: () => {
    entrou = true;
  },
});

verificar('o login aparece', areas['[data-admin-login]'].hidden === false);

verificar('o painel continua escondido', areas['[data-admin-painel]'].hidden === true);

verificar(
  'nenhum dado é pedido antes de entrar',
  !entrou,
  'carregar a tela sem sessão só geraria um 401'
);

/* =============================================================================
 * 3. SESSÃO VENCIDA — vale o mesmo que não ter sessão
 * ========================================================================== */

console.log('\n── Sessão vencida ──\n');

sessaoGuardada = JSON.stringify({
  access_token: 'token-velho',
  refresh_token: 'refresh-velho',
  expires_at: Date.now() - 1000,
  user: { id: 'u1', email: 'fefe@exemplo.com' },
});

loginApareceu = false;
entrou = false;
areas['[data-admin-login]'].hidden = true;
areas['[data-admin-painel]'].hidden = true;

await iniciarPainel({
  titulo: 'Catálogo',
  aoEntrar: () => {
    entrou = true;
  },
});

verificar(
  'token vencido não abre o painel',
  areas['[data-admin-painel]'].hidden === true && !entrou,
  'a renovação falhou neste teste, então o certo é cair no login'
);

verificar('o login aparece', areas['[data-admin-login]'].hidden === false);

/* -----------------------------------------------------------------------------
 * Resultado
 * -------------------------------------------------------------------------- */

console.log(`\n${'─'.repeat(50)}`);
console.log(`  ${ok} verificações passaram · ${falhas} falharam`);
console.log(`${'─'.repeat(50)}\n`);

process.exit(falhas > 0 ? 1 : 0);
