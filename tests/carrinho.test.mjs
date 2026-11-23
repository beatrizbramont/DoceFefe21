/**
 * tests/carrinho.test.mjs
 * -----------------------------------------------------------------------------
 * Testa a validação do carrinho e dos cupons.
 *
 * O foco aqui é UM ponto: provar que nada vindo do navegador influencia o
 * preço cobrado. Esta é a classe de falha mais cara numa loja virtual —
 * alguém compra um brownie de R$ 12,00 por R$ 0,01 e só se descobre no
 * fechamento do mês.
 */

import {
  postValidarCarrinho,
  postAplicarCupom,
} from '../backend/controllers/cart-controller.js';
import { bancoConfigurado, verificarConexao, selecionarUm } from '../services/database.js';

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
 * Pré-requisito
 * -------------------------------------------------------------------------- */

if (!bancoConfigurado) {
  console.log('\n  ⊘ Banco não configurado — suíte do carrinho pulada.\n');
  process.exit(0);
}

const conexao = await verificarConexao();
if (!conexao.conectado || !conexao.esquemaAplicado) {
  console.log(`\n  ⊘ ${conexao.mensagem}\n  Suíte do carrinho pulada.\n`);
  process.exit(0);
}

/** Pega um produto real do catálogo para usar nos testes. */
const produto = await selecionarUm('catalogo_publico', {
  colunas: 'slug,nome,preco_varejo,preco_efetivo,disponivel,sob_encomenda',
  ordenar: 'nome.asc',
});

if (!produto) {
  console.log('\n  ⊘ Nenhum produto publicado — suíte do carrinho pulada.\n');
  process.exit(0);
}

const chamar = (itens, extras = {}) =>
  postValidarCarrinho({ corpo: { itens, ...extras } });

/* =============================================================================
 * 1. CÁLCULO BÁSICO
 * ========================================================================== */

console.log('\n── Cálculo do carrinho ──\n');

const simples = await chamar([{ slug: produto.slug, quantidade: 2 }]);

verificar('status 200', simples.status === 200, `obtido: ${simples.status}`);
verificar('devolve 1 item', simples.corpo.itens.length === 1);
verificar(
  'quantidade preservada',
  simples.corpo.itens[0]?.quantidade === 2,
  `obtido: ${simples.corpo.itens[0]?.quantidade}`
);
verificar(
  'preço unitário veio do banco',
  simples.corpo.itens[0]?.precoUnitario === produto.preco_efetivo,
  `esperado ${produto.preco_efetivo}, obtido ${simples.corpo.itens[0]?.precoUnitario}`
);
verificar(
  'subtotal do item = preço × quantidade',
  simples.corpo.itens[0]?.subtotal === produto.preco_efetivo * 2
);
verificar(
  'subtotal do carrinho confere',
  simples.corpo.subtotal === produto.preco_efetivo * 2
);
verificar(
  'total = subtotal quando não há desconto',
  simples.corpo.total === simples.corpo.subtotal
);
verificar(
  'contagem de itens correta',
  simples.corpo.quantidadeItens === 2,
  `obtido: ${simples.corpo.quantidadeItens}`
);

/* =============================================================================
 * 2. SEGURANÇA — TENTATIVAS DE FRAUDE
 *
 * Cada caso abaixo simula alguém editando o localStorage pelo console do
 * navegador. Em TODOS, o preço cobrado precisa continuar sendo o do banco.
 * ========================================================================== */

console.log('\n── Segurança: tentativas de fraudar o preço ──\n');

const fraudes = [
  ['preço de 1 centavo', { preco: 1 }],
  ['preço zero', { preco: 0 }],
  ['preço negativo', { preco: -5000 }],
  ['preço como texto', { preco: '0.01' }],
  ['campo precoUnitario', { precoUnitario: 1 }],
  ['campo subtotal forjado', { subtotal: 1 }],
  ['desconto embutido no item', { desconto: 99999 }],
  ['nome trocado', { nome: 'Produto Falso Grátis' }],
  ['tipoPreco forçado para atacado', { tipoPreco: 'atacado' }],
];

for (const [nome, extra] of fraudes) {
  const resposta = await chamar([
    { slug: produto.slug, quantidade: 1, ...extra },
  ]);

  const item = resposta.corpo.itens[0];

  verificar(
    `${nome} é ignorado`,
    item?.precoUnitario === produto.preco_efetivo &&
      resposta.corpo.total === produto.preco_efetivo,
    `preço aplicado: ${item?.precoUnitario}, total: ${resposta.corpo.total}`
  );
}

// Nome vindo do navegador nunca é usado na resposta.
const nomeFalso = await chamar([
  { slug: produto.slug, quantidade: 1, nome: 'Produto Falso Grátis' },
]);
verificar(
  'nome vem do banco, não do navegador',
  nomeFalso.corpo.itens[0]?.nome === produto.nome,
  `obtido: ${nomeFalso.corpo.itens[0]?.nome}`
);

// Desconto só existe via cupom validado.
verificar(
  'desconto começa em zero',
  simples.corpo.desconto === 0
);

// Visitante anônimo nunca recebe atacado.
const tentaAtacado = await chamar([{ slug: produto.slug, quantidade: 1 }]);
verificar(
  'anônimo não recebe preço de atacado',
  tentaAtacado.corpo.atacado === false &&
    tentaAtacado.corpo.itens[0]?.tipoPreco !== 'atacado'
);

/* =============================================================================
 * 3. SANEAMENTO DA ENTRADA
 * ========================================================================== */

console.log('\n── Entradas inválidas ──\n');

const vazio = await chamar([]);
verificar('carrinho vazio responde 200', vazio.status === 200);
verificar('carrinho vazio tem total zero', vazio.corpo.total === 0);

const naoLista = await postValidarCarrinho({ corpo: { itens: 'nao-e-lista' } });
verificar('itens que não são lista: 400', naoLista.status === 400);

const semCorpo = await postValidarCarrinho({ corpo: {} });
verificar('corpo sem itens: 400', semCorpo.status === 400);

const slugInvalido = await chamar([
  { slug: '../../etc/passwd', quantidade: 1 },
  { slug: "'; DROP TABLE products; --", quantidade: 1 },
  { slug: '<script>alert(1)</script>', quantidade: 1 },
]);
verificar(
  'slugs maliciosos são descartados',
  slugInvalido.corpo.itens.length === 0,
  `sobrou: ${slugInvalido.corpo.itens.length}`
);

const quantidadeAbsurda = await chamar([
  { slug: produto.slug, quantidade: 999999 },
]);
verificar(
  'quantidade absurda é limitada',
  (quantidadeAbsurda.corpo.itens[0]?.quantidade ?? 0) <= 99,
  `obtido: ${quantidadeAbsurda.corpo.itens[0]?.quantidade}`
);

const quantidadeNegativa = await chamar([
  { slug: produto.slug, quantidade: -10 },
]);
verificar(
  'quantidade negativa é descartada',
  quantidadeNegativa.corpo.itens.length === 0 ||
    quantidadeNegativa.corpo.itens[0].quantidade >= 1
);

const quantidadeTexto = await chamar([
  { slug: produto.slug, quantidade: 'muitos' },
]);
verificar(
  'quantidade não numérica é descartada',
  quantidadeTexto.corpo.itens.length === 0
);

// Slug repetido deve virar uma linha só.
const repetido = await chamar([
  { slug: produto.slug, quantidade: 2 },
  { slug: produto.slug, quantidade: 3 },
]);
verificar(
  'slug repetido vira uma linha só',
  repetido.corpo.itens.length === 1,
  `obtido: ${repetido.corpo.itens.length} linhas`
);
verificar(
  'quantidades do slug repetido são somadas',
  repetido.corpo.itens[0]?.quantidade === 5,
  `obtido: ${repetido.corpo.itens[0]?.quantidade}`
);

// Teto de itens distintos.
const muitosItens = await postValidarCarrinho({
  corpo: {
    itens: Array.from({ length: 200 }, (_, i) => ({
      slug: `produto-${i}`,
      quantidade: 1,
    })),
  },
});
verificar(
  'mais de 50 itens distintos é rejeitado',
  muitosItens.status === 400,
  `obtido: ${muitosItens.status}`
);

// Produto que não existe.
const inexistente = await chamar([
  { slug: 'produto-que-nao-existe-abc', quantidade: 1 },
]);
verificar(
  'produto inexistente é removido',
  inexistente.corpo.itens.length === 0
);
verificar(
  'remoção gera aviso para o cliente',
  inexistente.corpo.avisos.some((a) => a.tipo === 'removido')
);

/* =============================================================================
 * 4. AVISO DE MUDANÇA DE PREÇO
 * ========================================================================== */

console.log('\n── Aviso de preço alterado ──\n');

const precoAntigo = await chamar([
  { slug: produto.slug, quantidade: 1, preco: produto.preco_efetivo + 500 },
]);

verificar(
  'preço diferente gera aviso',
  precoAntigo.corpo.avisos.some((a) => a.tipo === 'preco_alterado'),
  JSON.stringify(precoAntigo.corpo.avisos)
);
verificar(
  'mesmo com aviso, cobra o preço do banco',
  precoAntigo.corpo.itens[0]?.precoUnitario === produto.preco_efetivo
);

const precoIgual = await chamar([
  { slug: produto.slug, quantidade: 1, preco: produto.preco_efetivo },
]);
verificar(
  'preço igual não gera aviso',
  !precoIgual.corpo.avisos.some((a) => a.tipo === 'preco_alterado')
);

/* =============================================================================
 * 5. CUPONS
 * ========================================================================== */

console.log('\n── Cupons ──\n');

const cupomInexistente = await postAplicarCupom({
  corpo: { codigo: 'NAOEXISTE999', subtotal: 100000 },
});
verificar(
  'cupom inexistente é recusado',
  cupomInexistente.status === 422,
  `obtido: ${cupomInexistente.status}`
);
verificar(
  'mensagem não revela se o código existe',
  /inválido ou expirado/i.test(cupomInexistente.corpo.mensagem),
  cupomInexistente.corpo.mensagem
);

const cupomVazio = await postAplicarCupom({ corpo: { codigo: '' } });
verificar('cupom vazio é recusado', cupomVazio.status === 422);

const cupomSemCodigo = await postAplicarCupom({ corpo: {} });
verificar('cupom sem código: 400', cupomSemCodigo.status === 400);

// O cupom de demonstração do seed: BEMVINDO10, 10%, mínimo R$ 50,00.
const cupomDemo = await selecionarUm('coupons', {
  colunas: 'codigo,tipo,valor,valor_minimo_pedido,ativo',
  filtros: { codigo: 'eq.BEMVINDO10' },
});

if (cupomDemo && cupomDemo.ativo) {
  // Abaixo do mínimo.
  const abaixo = await postAplicarCupom({
    corpo: { codigo: 'BEMVINDO10', subtotal: cupomDemo.valor_minimo_pedido - 100 },
  });
  verificar(
    'cupom abaixo do pedido mínimo é recusado',
    abaixo.status === 422,
    `obtido: ${abaixo.status}`
  );
  verificar(
    'mensagem informa quanto falta',
    /falta/i.test(abaixo.corpo.mensagem || ''),
    abaixo.corpo.mensagem
  );

  // Acima do mínimo.
  const subtotalValido = cupomDemo.valor_minimo_pedido + 10000;
  const aceito = await postAplicarCupom({
    corpo: { codigo: 'BEMVINDO10', subtotal: subtotalValido },
  });

  verificar('cupom válido é aceito', aceito.status === 200, `obtido: ${aceito.status}`);

  const esperado = Math.floor((subtotalValido * cupomDemo.valor) / 100);
  verificar(
    'desconto percentual calculado corretamente',
    aceito.corpo.desconto === esperado,
    `esperado ${esperado}, obtido ${aceito.corpo.desconto}`
  );
  verificar(
    'desconto é inteiro (centavos)',
    Number.isInteger(aceito.corpo.desconto)
  );

  // Código em minúsculas deve funcionar igual.
  const minusculo = await postAplicarCupom({
    corpo: { codigo: 'bemvindo10', subtotal: subtotalValido },
  });
  verificar(
    'código em minúsculas é aceito',
    minusculo.status === 200,
    `obtido: ${minusculo.status}`
  );

  // Cupom aplicado ao carrinho inteiro.
  const comCupom = await chamar(
    [{ slug: produto.slug, quantidade: 20 }],
    { cupom: 'BEMVINDO10' }
  );

  if (comCupom.corpo.subtotal >= cupomDemo.valor_minimo_pedido) {
    verificar('cupom aplicado ao carrinho', comCupom.corpo.cupom !== null);
    verificar('desconto maior que zero', comCupom.corpo.desconto > 0);
    verificar(
      'total = subtotal − desconto',
      comCupom.corpo.total === comCupom.corpo.subtotal - comCupom.corpo.desconto,
      `${comCupom.corpo.total} ≠ ${comCupom.corpo.subtotal} − ${comCupom.corpo.desconto}`
    );
    verificar('total nunca é negativo', comCupom.corpo.total >= 0);
  }
} else {
  console.log('  ⊘ cupom BEMVINDO10 não encontrado — testes de cupom pulados');
}

/* =============================================================================
 * 6. CONSISTÊNCIA ARITMÉTICA
 *
 * Valores em centavos precisam ser sempre inteiros. Um float aqui vira
 * diferença de centavo no fechamento do caixa.
 * ========================================================================== */

console.log('\n── Consistência dos valores ──\n');

const multiplos = await chamar([{ slug: produto.slug, quantidade: 7 }]);

verificar(
  'todos os valores são inteiros',
  Number.isInteger(multiplos.corpo.subtotal) &&
    Number.isInteger(multiplos.corpo.desconto) &&
    Number.isInteger(multiplos.corpo.total) &&
    multiplos.corpo.itens.every(
      (i) => Number.isInteger(i.precoUnitario) && Number.isInteger(i.subtotal)
    )
);

verificar(
  'soma dos itens = subtotal',
  multiplos.corpo.itens.reduce((s, i) => s + i.subtotal, 0) ===
    multiplos.corpo.subtotal
);

verificar(
  'desconto nunca passa do subtotal',
  multiplos.corpo.desconto <= multiplos.corpo.subtotal
);

/* -----------------------------------------------------------------------------
 * Resultado
 * -------------------------------------------------------------------------- */

console.log(`\n${'─'.repeat(50)}`);
console.log(`  ${ok} verificações passaram · ${falhas} falharam`);
console.log(`${'─'.repeat(50)}\n`);

process.exit(falhas > 0 ? 1 : 0);
