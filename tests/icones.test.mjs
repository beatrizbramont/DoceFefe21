/**
 * tests/icones.test.mjs
 * -----------------------------------------------------------------------------
 * Nenhum emoji pode voltar para a interface.
 *
 * POR QUE ISTO É UM TESTE, E NÃO UMA COMBINAÇÃO
 *   Emoji é tentador: resolve em um caractere o que o SVG resolve em quinze
 *   linhas. A cada tela nova a tentação volta — e o primeiro que escapar
 *   passa despercebido, porque na máquina de quem escreveu ele aparece
 *   bonitinho.
 *
 *   O problema só se manifesta no aparelho dos outros: cada sistema desenha
 *   o seu emoji. O 🤝 do Windows não é o do iPhone, que não é o do Android.
 *   Um painel montado com emoji muda de cara conforme quem abre, e não há
 *   CSS que conserte — o desenho vem da fonte do sistema.
 *
 * O QUE ESTE ARQUIVO VARRE
 *   Só o que vai PARA A TELA: textos de elementos criados em JavaScript,
 *   nomes de ícone e conteúdo visível no HTML. Comentários de código e
 *   mensagens de terminal ficam de fora — ali o emoji é prosa para quem
 *   programa, não interface para quem compra.
 *
 * Roda sem banco e sem navegador.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

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
 * O que conta como emoji — e o que NÃO conta
 *
 * A primeira versão desta regra reprovava `←`, `→`, `−` e `∞`. Estava errada,
 * e o erro é instrutivo: esses caracteres são TIPOGRAFIA. Quem os desenha é a
 * mesma fonte do texto ao redor (Nunito Sans), então saem iguais em qualquer
 * aparelho — exatamente o oposto do problema que esta suíte existe para
 * impedir. Seta em botão é seta, não ícone.
 *
 * Emoji é figura: vem da fonte de emoji do SISTEMA, e cada sistema desenha a
 * sua. O que entra na regra, portanto:
 *
 *   • U+1F000–U+1FAFF   os emojis propriamente ditos
 *   • U+2600–U+26FF     símbolos diversos (⚠ ☀ ⌛ ⛔) — quase todos figura
 *   • ✅ ❌ ❎ ❗ ❓      dingbats que o Unicode marca como emoji por padrão
 *   • U+FE0F            o seletor que pede "desenhe como figura" ao sistema
 * -------------------------------------------------------------------------- */

const EMOJI =
  /[\u{1F000}-\u{1FAFF}]|[\u{2600}-\u{26FF}]|[\u{2705}\u{274C}\u{274E}\u{2753}-\u{2757}]|\u{FE0F}/u;

/** Pastas que não são interface. */
const IGNORADAS = new Set(['node_modules', '.git', 'dist', 'tests', 'database']);

function listarArquivos(pasta, extensoes) {
  const encontrados = [];

  for (const nome of readdirSync(pasta)) {
    if (IGNORADAS.has(nome)) continue;

    const caminho = join(pasta, nome);

    if (statSync(caminho).isDirectory()) {
      encontrados.push(...listarArquivos(caminho, extensoes));
    } else if (extensoes.includes(extname(nome))) {
      encontrados.push(caminho);
    }
  }

  return encontrados;
}

/* -----------------------------------------------------------------------------
 * JavaScript: só as linhas que criam conteúdo visível
 * -------------------------------------------------------------------------- */

/**
 * Uma linha interessa quando atribui texto ou nome de ícone.
 *
 * Comentário de bloco (` * ⚠️ ...`) e comentário de linha ficam de fora de
 * propósito: ali o emoji marca um aviso para quem lê o código.
 */
function linhaDeInterface(linha) {
  const semEspaco = linha.trim();

  if (semEspaco.startsWith('*') || semEspaco.startsWith('//') || semEspaco.startsWith('/*')) {
    return false;
  }

  return /texto:|icone:|textContent\s*=|placeholder:|'aria-label'|title:/.test(linha);
}

console.log('\n── JavaScript da interface ──\n');

const arquivosJs = listarArquivos(join(RAIZ, 'js'), ['.js']);

const achadosJs = [];

for (const caminho of arquivosJs) {
  const linhas = readFileSync(caminho, 'utf8').split('\n');

  linhas.forEach((linha, indice) => {
    if (linhaDeInterface(linha) && EMOJI.test(linha)) {
      achadosJs.push(`${relative(RAIZ, caminho)}:${indice + 1}  ${linha.trim()}`);
    }
  });
}

verificar(
  `${arquivosJs.length} arquivos de js/ sem emoji em texto de tela`,
  achadosJs.length === 0,
  achadosJs.length ? `\n      ${achadosJs.join('\n      ')}` : ''
);

/* -----------------------------------------------------------------------------
 * HTML: o que está fora de tag e fora de comentário
 * -------------------------------------------------------------------------- */

console.log('\n── HTML ──\n');

const arquivosHtml = listarArquivos(RAIZ, ['.html']);

const achadosHtml = [];

for (const caminho of arquivosHtml) {
  const conteudo = readFileSync(caminho, 'utf8')
    // Comentário de HTML é instrução para quem mantém a página.
    .replace(/<!--[\s\S]*?-->/g, '');

  conteudo.split('\n').forEach((linha, indice) => {
    if (EMOJI.test(linha)) {
      achadosHtml.push(`${relative(RAIZ, caminho)}:${indice + 1}  ${linha.trim()}`);
    }
  });
}

verificar(
  `${arquivosHtml.length} páginas sem emoji no conteúdo`,
  achadosHtml.length === 0,
  achadosHtml.length ? `\n      ${achadosHtml.join('\n      ')}` : ''
);

/* -----------------------------------------------------------------------------
 * O catálogo de ícones precisa cobrir o que as telas pedem
 * -------------------------------------------------------------------------- */

console.log('\n── Catálogo de ícones ──\n');

const { NOMES_DE_ICONE, marcacaoDoIcone, iconeDaCategoria, ICONES } = await import(
  pathToFileURL(join(RAIZ, 'js/components/icons.js')).href
);

verificar('o catálogo tem ícones', NOMES_DE_ICONE.length > 20, `${NOMES_DE_ICONE.length}`);

verificar(
  'todo ícone usa currentColor (herda a cor do texto)',
  NOMES_DE_ICONE.every((nome) => marcacaoDoIcone(nome).includes('currentColor'))
);

verificar(
  'todo ícone é escondido de leitores de tela',
  NOMES_DE_ICONE.every((nome) => marcacaoDoIcone(nome).includes('aria-hidden="true"')),
  'ícone decorativo anunciado em voz alta vira ruído'
);

verificar(
  'todo ícone fica fora da ordem de tabulação',
  NOMES_DE_ICONE.every((nome) => marcacaoDoIcone(nome).includes('focusable="false"')),
  'o Internet Explorer e o Edge antigo focavam SVG sem isto'
);

verificar(
  'o tamanho pode sair em em, para herdar o font-size',
  marcacaoDoIcone('doce', '1em').includes('width="1em"')
);

verificar('nome desconhecido devolve null, não quebra', marcacaoDoIcone('inexistente') === null);

/* -----------------------------------------------------------------------------
 * Nomes usados nas telas precisam existir no catálogo
 * -------------------------------------------------------------------------- */

const nomesUsados = new Set();

for (const caminho of arquivosJs) {
  const conteudo = readFileSync(caminho, 'utf8');

  for (const casamento of conteudo.matchAll(/\bicone\(\s*'([a-z-]+)'/g)) {
    nomesUsados.add(casamento[1]);
  }

  for (const casamento of conteudo.matchAll(/icone:\s*'([a-z-]+)'/g)) {
    nomesUsados.add(casamento[1]);
  }
}

for (const caminho of arquivosHtml) {
  const conteudo = readFileSync(caminho, 'utf8');

  for (const casamento of conteudo.matchAll(/data-icone="([a-z-]+)"/g)) {
    nomesUsados.add(casamento[1]);
  }
}

const desconhecidos = [...nomesUsados].filter((nome) => !NOMES_DE_ICONE.includes(nome));

verificar(
  `os ${nomesUsados.size} nomes de ícone usados nas telas existem`,
  desconhecidos.length === 0,
  desconhecidos.join(', ')
);

/* -----------------------------------------------------------------------------
 * Categorias
 * -------------------------------------------------------------------------- */

const CATEGORIAS_DA_LOJA = ['brownies', 'paes-de-mel', 'alfajores', 'fit', 'sazonais'];

verificar(
  'toda categoria da loja tem ícone próprio',
  new Set(CATEGORIAS_DA_LOJA.map(iconeDaCategoria)).size === CATEGORIAS_DA_LOJA.length,
  CATEGORIAS_DA_LOJA.map((c) => `${c}=${iconeDaCategoria(c)}`).join(' ')
);

verificar(
  'categoria nova cai no ícone genérico, não em branco',
  Boolean(ICONES[iconeDaCategoria('categoria-que-nao-existe')])
);

/* -----------------------------------------------------------------------------
 * Resultado
 * -------------------------------------------------------------------------- */

console.log(`\n${'─'.repeat(50)}`);
console.log(`  ${ok} verificações passaram · ${falhas} falharam`);
console.log(`${'─'.repeat(50)}\n`);

process.exit(falhas > 0 ? 1 : 0);
