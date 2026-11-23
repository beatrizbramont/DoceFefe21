/**
 * Verifica se os módulos do frontend carregam e se as funções puras
 * produzem os resultados esperados. Roda no Node, sem navegador.
 */
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const RAIZ = process.argv[2];
const url = (p) => pathToFileURL(join(RAIZ, p)).href;

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

// ---------------------------------------------------------------------------
// Stub mínimo do navegador: só o necessário para os módulos carregarem.
// ---------------------------------------------------------------------------
const armazenamentoFalso = {
  getItem: () => null,
  setItem() {},
  removeItem() {},
};

globalThis.window = {
  location: { pathname: '/index.html', search: '' },
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  addEventListener() {},
  localStorage: armazenamentoFalso,
  scrollTo() {},
  history: { replaceState() {}, pushState() {} },
};
globalThis.localStorage = armazenamentoFalso;
globalThis.CustomEvent = class {
  constructor(nome, opcoes) {
    this.type = nome;
    Object.assign(this, opcoes);
  }
};
globalThis.document = {
  readyState: 'complete',
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  dispatchEvent() {},
  createElement: () => ({
    style: {},
    dataset: {},
    files: [],
    setAttribute() {},
    removeAttribute() {},
    append() {},
    replaceChildren() {},
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    content: { firstElementChild: null },
  }),
  head: { append() {} },
  body: { append() {} },
};

console.log('\n── Carregamento dos módulos ──');

/**
 * TODO módulo de página precisa estar nesta lista.
 *
 * POR QUE ISSO IMPORTA
 *   Um `export default` citando uma função que não existe mais derruba o
 *   módulo inteiro — e, junto, tudo que o importa. Foi o que aconteceu com
 *   `etapasDoPedido` em status-pedido.js: o erro silencioso quebrou os
 *   formulários de login da conta E do painel, que passaram a ser enviados
 *   pelo navegador, expondo a senha na URL.
 *
 *   Um simples `import` que executa já teria pegado isso.
 */
const modulos = [
  // --- Base ---
  'js/config.js',
  'js/lib/format.js',
  'js/lib/ui.js',
  'js/lib/api.js',
  'js/lib/status-pedido.js',
  'js/components/icons.js',
  'js/components/accordion.js',
  'js/components/product-card.js',
  'js/components/site-header.js',
  'js/components/site-footer.js',
  'js/whatsapp.js',
  'js/navigation.js',
  'js/auth.js',
  'js/cart.js',

  // --- Módulos de página ---
  'js/products.js',
  'js/produto.js',
  'js/cart-page.js',
  'js/checkout.js',
  'js/pagamento.js',
  'js/conta.js',
  'js/contato.js',
  'js/admin/painel.js',
];

const carregados = {};

for (const m of modulos) {
  try {
    carregados[m] = await import(url(m));
    verificar(`carrega ${m}`, true);
  } catch (e) {
    verificar(`carrega ${m}`, false, e.message);
  }
}

// ---------------------------------------------------------------------------
console.log('\n── Formatação de valores ──');

const fmt = carregados['js/lib/format.js'];
if (fmt) {
  const moeda = fmt.moeda(1250).replace(/ /g, ' ');
  verificar('moeda(1250) = "R$ 12,50"', moeda === 'R$ 12,50', `obtido: "${moeda}"`);

  const moedaZero = fmt.moeda(0).replace(/ /g, ' ');
  verificar('moeda(0) = "R$ 0,00"', moedaZero === 'R$ 0,00', `obtido: "${moedaZero}"`);

  verificar('paraCentavos("12,50") = 1250', fmt.paraCentavos('12,50') === 1250, `obtido: ${fmt.paraCentavos('12,50')}`);
  verificar('paraCentavos("R$ 1.250,90") = 125090', fmt.paraCentavos('R$ 1.250,90') === 125090, `obtido: ${fmt.paraCentavos('R$ 1.250,90')}`);

  // O ponto crítico: somar centavos nunca gera erro de ponto flutuante.
  const total = fmt.paraCentavos('0,10') + fmt.paraCentavos('0,20');
  verificar('0,10 + 0,20 = 30 centavos exatos', total === 30, `obtido: ${total}`);

  verificar('telefone() formata celular', fmt.telefone('11979788231') === '(11) 97978-8231', `obtido: ${fmt.telefone('11979788231')}`);
  verificar('cep() formata', fmt.cep('01310100') === '01310-100', `obtido: ${fmt.cep('01310100')}`);
  verificar('cnpj() formata', fmt.cnpj('12345678000190') === '12.345.678/0001-90', `obtido: ${fmt.cnpj('12345678000190')}`);
  verificar('peso(90) = "90 g"', fmt.peso(90) === '90 g', `obtido: ${fmt.peso(90)}`);
  verificar('peso(1200) = "1,2 kg"', fmt.peso(1200) === '1,2 kg', `obtido: ${fmt.peso(1200)}`);
  verificar('slug remove acentos', fmt.slug('Pão de Mel') === 'pao-de-mel', `obtido: ${fmt.slug('Pão de Mel')}`);
  verificar('plural(1)', fmt.plural(1, 'item', 'itens') === '1 item');
  verificar('plural(3)', fmt.plural(3, 'item', 'itens') === '3 itens');
}

// ---------------------------------------------------------------------------
console.log('\n── Dados da marca ──');

const cfg = carregados['js/config.js'];
if (cfg) {
  verificar('WhatsApp no formato internacional', cfg.CONTATO.whatsapp === '5511979788231', `obtido: ${cfg.CONTATO.whatsapp}`);
  verificar('Instagram correto', cfg.CONTATO.instagram === 'docefefe.21');
  verificar('5 categorias (sem a linha de kits)', cfg.CATEGORIAS.length === 5, `obtido: ${cfg.CATEGORIAS.length}`);
  verificar('nenhuma rota de kit', !JSON.stringify(cfg.ROTAS).toLowerCase().includes('kit'));
  verificar('rota() na raiz usa "./"', cfg.rota('produtos.html') === './produtos.html', `obtido: ${cfg.rota('produtos.html')}`);
  verificar('ATIVOS.logo() aponta para o arquivo original', cfg.ATIVOS.logo() === './assets/images/logo.jpeg', `obtido: ${cfg.ATIVOS.logo()}`);

  // Garantia de segurança: nenhum segredo embutido no arquivo público.
  const texto = JSON.stringify({ ...cfg.SUPABASE, ...cfg.API });
  verificar('config.js não contém chave service_role', !texto.includes('service_role'));
}

// ---------------------------------------------------------------------------
console.log('\n── Caminhos no painel administrativo ──');

// Simula estar em /admin/ — os links precisam subir um nível.
globalThis.window.location.pathname = '/admin/dashboard.html';
if (cfg) {
  verificar('rota() no admin usa "../"', cfg.rota('produtos.html') === '../produtos.html', `obtido: ${cfg.rota('produtos.html')}`);
  verificar('logo no admin sobe um nível', cfg.ATIVOS.logo() === '../assets/images/logo.jpeg', `obtido: ${cfg.ATIVOS.logo()}`);
}
globalThis.window.location.pathname = '/index.html';

// ---------------------------------------------------------------------------
console.log('\n── Links do WhatsApp ──');

const wa = carregados['js/whatsapp.js'];
if (wa) {
  const link = wa.montarLinkWhatsApp('encomenda');
  verificar('usa o domínio oficial wa.me', link.startsWith('https://wa.me/5511979788231?text='), `obtido: ${link.slice(0, 60)}`);
  verificar('mensagem codificada para URL', link.includes('%20'));

  const linkProduto = wa.montarLinkWhatsApp('duvidaProduto', 'Brownie de Nutella');
  verificar('mensagem com nome do produto', decodeURIComponent(linkProduto).includes('Brownie de Nutella'));
}

// ---------------------------------------------------------------------------
console.log('\n── Ícones ──');

const ic = carregados['js/components/icons.js'];
if (ic) {
  verificar('ícone do WhatsApp existe', typeof ic.ICONES.whatsapp === 'string' && ic.ICONES.whatsapp.includes('<svg'));
  verificar('ícones usam currentColor', ic.ICONES.carrinho.includes('currentColor'));
  verificar('ícones escondidos de leitores de tela', ic.ICONES.menu.includes('aria-hidden="true"'));
}

// ---------------------------------------------------------------------------
console.log(`\n${'─'.repeat(46)}`);
console.log(`  ${ok} verificações passaram · ${falhas} falharam`);
console.log(`${'─'.repeat(46)}\n`);

process.exit(falhas > 0 ? 1 : 0);
