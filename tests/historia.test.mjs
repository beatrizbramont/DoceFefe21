/**
 * Verifica que o texto da história publicado em nossa-historia.html é
 * EXATAMENTE o que a família escreveu — sem palavras acrescentadas,
 * removidas ou trocadas.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = process.argv[2];

// Texto original, como foi enviado pela família. NÃO ALTERAR.
const ORIGINAL = [
  'Fernando, nosso Fefê, nasceu em 15 de janeiro de 2023, prematuro, com Síndrome de Down e cardiopatia congênita.',
  'Desde os primeiros meses, sua vida foi marcada por grandes desafios. Aos três meses, enfrentou uma cirurgia no coração e, mesmo tendo ficado em estado grave, superou essa batalha. Também venceu a catarata congênita e, em julho, enfrentou um novo desafio: o diagnóstico de leucemia. Graças a Deus, alcançou a remissão e segue seu tratamento com muita coragem e esperança.',
  'Foi justamente dois dias antes da descoberta da leucemia que nasceu a ideia da Doce Fefê: uma pequena produção de pães de mel que, em meio a tantas mudanças, se transformou em um projeto de amor.',
  'Com a criação do Super Fefê, nosso pequeno herói ganhou um lugar especial na identidade da marca. O carinho das pessoas nos ajudou a começar, mas foi o sabor, a qualidade e o cuidado de cada doce que fizeram a Doce Fefê conquistar seus clientes.',
  'Hoje, sonhamos com uma loja, um site e uma marca que cresça cada vez mais. Mas nosso maior sonho vai além de uma confeitaria.',
  'Nosso grande sonho é que a Doce Fefê cresça junto com o Fefê e se torne a garantia de um futuro para ele.',
  'Que, quando adulto e pronto, ele possa assumir esse negócio e cuidar dele com o mesmo amor e carinho com que cuidamos dele hoje.',
  'Queremos construir uma oportunidade de autonomia, trabalho e inclusão, para que Fernando e outros jovens possam realizar seus próprios sonhos.',
];

const ENCERRAMENTO =
  'Doce Fefê.21 — um sonho que nasceu do amor e cresce com esperança.';

const html = readFileSync(join(RAIZ, 'nossa-historia.html'), 'utf8');

/**
 * Remove marcação HTML e normaliza espaços, para comparar só as palavras.
 * O HTML quebra linhas por legibilidade; isso não pode contar como diferença.
 */
function textoPuro(entrada) {
  return entrada
    .replace(/<!--[\s\S]*?-->/g, ' ') // comentários
    .replace(/<[^>]+>/g, ' ') // tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

const conteudo = textoPuro(html);

let ok = 0;
let falhas = 0;

console.log('\n── Integridade do texto da história ──\n');

ORIGINAL.forEach((paragrafo, i) => {
  const normalizado = paragrafo.replace(/\s+/g, ' ').trim();
  const presente = conteudo.includes(normalizado);

  if (presente) {
    console.log(`  ✓ Parágrafo ${i + 1} publicado na íntegra`);
    ok += 1;
  } else {
    console.log(`  ✗ Parágrafo ${i + 1} NÃO confere`);
    console.log(`     esperado: "${normalizado.slice(0, 90)}..."`);
    falhas += 1;
  }
});

if (conteudo.includes(ENCERRAMENTO)) {
  console.log('  ✓ Frase de encerramento publicada');
  ok += 1;
} else {
  console.log('  ✗ Frase de encerramento NÃO confere');
  falhas += 1;
}

// ---------------------------------------------------------------------------
console.log('\n── Fatos da linha do tempo ──\n');

// Cada marco da linha do tempo precisa existir no texto original.
const FATOS = [
  ['data de nascimento', '15 de janeiro de 2023'],
  ['prematuro', 'prematuro'],
  ['Síndrome de Down', 'Síndrome de Down'],
  ['cardiopatia congênita', 'cardiopatia congênita'],
  ['cirurgia aos três meses', 'Aos três meses'],
  ['catarata congênita', 'catarata congênita'],
  ['leucemia', 'leucemia'],
  ['remissão', 'remissão'],
  ['pães de mel', 'pães de mel'],
  ['Super Fefê', 'Super Fefê'],
  ['autonomia, trabalho e inclusão', 'autonomia, trabalho e inclusão'],
];

const textoOriginalCompleto = ORIGINAL.join(' ');

FATOS.forEach(([rotulo, termo]) => {
  const noSite = conteudo.includes(termo);
  const noOriginal = textoOriginalCompleto.includes(termo);

  if (noSite && noOriginal) {
    console.log(`  ✓ ${rotulo} — presente e fiel ao original`);
    ok += 1;
  } else if (noSite && !noOriginal) {
    console.log(`  ✗ ${rotulo} — APARECE NO SITE MAS NÃO NO TEXTO ORIGINAL`);
    falhas += 1;
  } else {
    console.log(`  ✗ ${rotulo} — ausente do site`);
    falhas += 1;
  }
});

// ---------------------------------------------------------------------------
console.log('\n── Nada foi inventado ──\n');

// Termos que seriam invenção biográfica se aparecessem.
const PROIBIDOS = [
  'hospital',
  'quimioterapia',
  'médico',
  'internado',
  'trissomia',
  'anos de idade',
  'desde pequena sempre',
];

PROIBIDOS.forEach((termo) => {
  const minusculo = conteudo.toLowerCase();
  if (minusculo.includes(termo.toLowerCase())) {
    console.log(`  ✗ termo não autorizado encontrado: "${termo}"`);
    falhas += 1;
  } else {
    console.log(`  ✓ não inventamos: "${termo}"`);
    ok += 1;
  }
});

// ---------------------------------------------------------------------------
console.log('\n── Dados sensíveis fora do site ──\n');

const paginas = [
  'index.html',
  'nossa-historia.html',
  'contato.html',
  'produtos.html',
  'carrinho.html',
];

let vazamento = false;
for (const p of paginas) {
  const conteudoPagina = readFileSync(join(RAIZ, p), 'utf8');
  if (conteudoPagina.includes('PRIVADO-arte-pix')) {
    console.log(`  ✗ ${p} referencia a arte do Pix`);
    vazamento = true;
    falhas += 1;
  }
  if (/Priscilla|AIOLFI/i.test(conteudoPagina)) {
    console.log(`  ✗ ${p} expõe o nome da titular da conta`);
    vazamento = true;
    falhas += 1;
  }
}
if (!vazamento) {
  console.log('  ✓ nenhuma página referencia o QR Code do Pix');
  console.log('  ✓ nenhuma página expõe dados bancários');
  ok += 2;
}

// ---------------------------------------------------------------------------
console.log(`\n${'─'.repeat(50)}`);
console.log(`  ${ok} verificações passaram · ${falhas} falharam`);
console.log(`${'─'.repeat(50)}\n`);

process.exit(falhas > 0 ? 1 : 0);
