/**
 * tests/links.test.mjs
 * -----------------------------------------------------------------------------
 * Confere que todo link interno, folha de estilo, script e imagem referenciados
 * pelas páginas realmente existem no disco.
 *
 * Link quebrado é o tipo de erro que passa despercebido em revisão manual e
 * só aparece quando um cliente clica.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';

const RAIZ = process.argv[2];

/** Lista todos os .html do projeto (raiz + admin). */
function listarPaginas() {
  const paginas = readdirSync(RAIZ)
    .filter((f) => f.endsWith('.html'))
    .map((f) => f);

  const admin = readdirSync(join(RAIZ, 'admin'))
    .filter((f) => f.endsWith('.html'))
    .map((f) => join('admin', f));

  return [...paginas, ...admin];
}

/** Extrai os caminhos referenciados por href/src de uma página. */
function extrairReferencias(html) {
  const referencias = [];
  const padrao = /(?:href|src)\s*=\s*["']([^"']+)["']/gi;

  let achado;
  while ((achado = padrao.exec(html)) !== null) {
    const valor = achado[1].trim();

    // Ignora o que não é arquivo local.
    if (
      valor.startsWith('http://') ||
      valor.startsWith('https://') ||
      valor.startsWith('//') ||
      valor.startsWith('#') ||
      valor.startsWith('mailto:') ||
      valor.startsWith('tel:') ||
      valor.startsWith('data:') ||
      valor === ''
    ) {
      continue;
    }

    referencias.push(valor);
  }

  return referencias;
}

let ok = 0;
let falhas = 0;

console.log('\n── Links internos, estilos, scripts e imagens ──\n');

const paginas = listarPaginas();

for (const pagina of paginas) {
  const caminhoPagina = join(RAIZ, pagina);
  const html = readFileSync(caminhoPagina, 'utf8');
  const referencias = extrairReferencias(html);

  const quebrados = [];

  for (const ref of referencias) {
    // Remove âncora e string de consulta: "produtos.html?categoria=x#topo"
    const limpo = ref.split('#')[0].split('?')[0];
    if (!limpo) continue;

    const alvo = resolve(dirname(caminhoPagina), limpo);

    if (!existsSync(alvo)) {
      quebrados.push(ref);
    }
  }

  if (quebrados.length === 0) {
    console.log(`  ✓ ${pagina.padEnd(28)} ${referencias.length} referências válidas`);
    ok += 1;
  } else {
    console.log(`  ✗ ${pagina}`);
    quebrados.forEach((q) => console.log(`      quebrado: ${q}`));
    falhas += quebrados.length;
  }
}

// ---------------------------------------------------------------------------
console.log('\n── Escopo combinado com a cliente ──\n');

/**
 * Funcionalidades deliberadamente FORA do escopo atual.
 *
 * Estas checagens existem para que ninguém — nem eu, numa fase futura —
 * reintroduza por engano algo que a cliente pediu para deixar de fora.
 * Se um dia o escopo mudar, basta remover a entrada desta lista.
 */
const FORA_DE_ESCOPO = [
  {
    nome: 'montagem de kits',
    arquivos: ['kits.html', 'monte-seu-kit.html', 'js/kits.js'],
    // Procura por links e por itens de menu que levem a essas páginas.
    padraoLink: /href\s*=\s*["'][^"']*(?:kits?\.html|monte-seu-kit)/i,
    padraoRota: /(?:kits?|monteSeuKit)\s*:\s*['"]/,
  },
  {
    nome: 'acompanhar pedido',
    arquivos: ['acompanhar-pedido.html'],
    padraoLink: /href\s*=\s*["'][^"']*acompanhar-pedido/i,
    padraoRota: /acompanharPedido\s*:\s*['"]/,
  },
];

// Arquivos que também não podem conter rotas para o que está fora de escopo.
const ARQUIVOS_DE_ROTA = ['js/config.js', 'vite.config.js'];

for (const item of FORA_DE_ESCOPO) {
  let problema = false;

  // 1. Os arquivos não devem existir.
  for (const arquivo of item.arquivos) {
    if (existsSync(join(RAIZ, arquivo))) {
      console.log(`  ✗ ${item.nome}: o arquivo ${arquivo} existe`);
      problema = true;
      falhas += 1;
    }
  }

  // 2. Nenhuma página pode linkar para lá.
  for (const pagina of paginas) {
    const html = readFileSync(join(RAIZ, pagina), 'utf8');
    if (item.padraoLink.test(html)) {
      console.log(`  ✗ ${item.nome}: ${pagina} tem link`);
      problema = true;
      falhas += 1;
    }
  }

  // 3. Nenhuma rota declarada na configuração.
  for (const arquivo of ARQUIVOS_DE_ROTA) {
    const caminho = join(RAIZ, arquivo);
    if (!existsSync(caminho)) continue;

    if (item.padraoRota.test(readFileSync(caminho, 'utf8'))) {
      console.log(`  ✗ ${item.nome}: rota declarada em ${arquivo}`);
      problema = true;
      falhas += 1;
    }
  }

  if (!problema) {
    console.log(`  ✓ ${item.nome} — fora do projeto, sem resíduos`);
    ok += 1;
  }
}

// O sitemap também não pode anunciar páginas inexistentes ao Google.
const sitemap = readFileSync(join(RAIZ, 'sitemap.xml'), 'utf8');
const urlsSitemap = [...sitemap.matchAll(/<loc>[^<]*\/([^/<]*)<\/loc>/g)].map(
  (m) => m[1]
);

const sitemapQuebrado = urlsSitemap.filter(
  (u) => u && u.endsWith('.html') && !existsSync(join(RAIZ, u))
);

if (sitemapQuebrado.length === 0) {
  console.log('  ✓ sitemap só lista páginas que existem');
  ok += 1;
} else {
  sitemapQuebrado.forEach((u) =>
    console.log(`  ✗ sitemap aponta para ${u}, que não existe`)
  );
  falhas += sitemapQuebrado.length;
}

// ---------------------------------------------------------------------------
console.log('\n── Boas práticas ──\n');

let semAlt = 0;
let semRel = 0;

for (const pagina of paginas) {
  const html = readFileSync(join(RAIZ, pagina), 'utf8');

  // Toda imagem precisa de texto alternativo (acessibilidade e SEO).
  const imagens = html.match(/<img\b[^>]*>/gi) || [];
  imagens.forEach((img) => {
    if (!/\balt\s*=/.test(img)) {
      console.log(`  ✗ ${pagina}: <img> sem atributo alt`);
      semAlt += 1;
    }
  });

  // Todo link que abre nova aba precisa de rel="noopener".
  const links = html.match(/<a\b[^>]*target\s*=\s*["']_blank["'][^>]*>/gi) || [];
  links.forEach((link) => {
    if (!/noopener/.test(link)) {
      console.log(`  ✗ ${pagina}: target="_blank" sem rel="noopener"`);
      semRel += 1;
    }
  });
}

if (semAlt === 0) {
  console.log('  ✓ todas as imagens têm texto alternativo');
  ok += 1;
} else {
  falhas += semAlt;
}

if (semRel === 0) {
  console.log('  ✓ todo link de nova aba usa rel="noopener"');
  ok += 1;
} else {
  falhas += semRel;
}

// Painel administrativo não pode ser indexado.
let adminDesprotegido = 0;
readdirSync(join(RAIZ, 'admin'))
  .filter((f) => f.endsWith('.html'))
  .forEach((f) => {
    const html = readFileSync(join(RAIZ, 'admin', f), 'utf8');
    if (!/name\s*=\s*["']robots["'][^>]*noindex/i.test(html)) {
      console.log(`  ✗ admin/${f} sem noindex`);
      adminDesprotegido += 1;
    }
  });

if (adminDesprotegido === 0) {
  console.log('  ✓ todas as páginas do admin têm noindex');
  ok += 1;
} else {
  falhas += adminDesprotegido;
}

// ---------------------------------------------------------------------------
console.log('\n── Segredos fora do frontend ──\n');

// O dev-server injeta variáveis de ambiente nas páginas HTML. Esta checagem
// garante que SÓ as públicas (prefixo VITE_) possam ir junto — um descuido
// aqui exporia a chave de serviço do banco a qualquer visitante.
const devServer = readFileSync(join(RAIZ, 'dev-server.mjs'), 'utf8');

if (/startsWith\(['"]VITE_['"]\)/.test(devServer)) {
  console.log('  ✓ dev-server só injeta variáveis com prefixo VITE_');
  ok += 1;
} else {
  console.log('  ✗ dev-server pode injetar variáveis sem prefixo VITE_');
  falhas += 1;
}

// Nenhum arquivo do frontend pode conter valores secretos literais.
const PADROES_SECRETOS = [
  [/sb_secret_[A-Za-z0-9_-]+/, 'chave secreta do Supabase'],
  [/SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*['"][^'"]+['"]/, 'service_role com valor'],
  [/MERCADOPAGO_ACCESS_TOKEN\s*[:=]\s*['"][^'"]+['"]/, 'token do Mercado Pago'],
];

const arquivosFrontend = [
  ...paginas,
  'js/config.js',
  'js/auth.js',
  'js/lib/api.js',
  'dev-server.mjs',
];

let vazamentoSegredo = false;

for (const arquivo of arquivosFrontend) {
  const caminho = join(RAIZ, arquivo);
  if (!existsSync(caminho)) continue;

  const conteudo = readFileSync(caminho, 'utf8');

  for (const [padrao, descricao] of PADROES_SECRETOS) {
    if (padrao.test(conteudo)) {
      console.log(`  ✗ ${arquivo} contém ${descricao}`);
      vazamentoSegredo = true;
      falhas += 1;
    }
  }
}

if (!vazamentoSegredo) {
  console.log('  ✓ nenhum segredo literal em arquivo do frontend');
  ok += 1;
}

// O .env não pode estar versionado.
if (/^\.env$/m.test(readFileSync(join(RAIZ, '.gitignore'), 'utf8'))) {
  console.log('  ✓ .env está no .gitignore');
  ok += 1;
} else {
  console.log('  ✗ .env NÃO está no .gitignore');
  falhas += 1;
}

// ---------------------------------------------------------------------------
console.log(`\n${'─'.repeat(50)}`);
console.log(`  ${ok} verificações passaram · ${falhas} falharam`);
console.log(`${'─'.repeat(50)}\n`);

process.exit(falhas > 0 ? 1 : 0);
