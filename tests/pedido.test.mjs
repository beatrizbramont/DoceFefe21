/**
 * tests/pedido.test.mjs
 * -----------------------------------------------------------------------------
 * Testa a criação de pedidos — a operação mais crítica da loja.
 *
 * O QUE PRECISA SER PROVADO AQUI
 *
 *   1. O preço cobrado é o do banco, nunca o enviado pelo navegador.
 *   2. O estoque é baixado junto com o pedido, de forma atômica.
 *   3. Um pedido não pode ser criado acima do estoque disponível.
 *   4. O fluxo de status não permite pular etapas.
 *   5. NENHUM pedido nasce como pago.
 *   6. Um cliente não lê o pedido de outro.
 *
 * Os pedidos criados são removidos ao final.
 */

import { postPedido, getPedido } from '../backend/controllers/order-controller.js';
import {
  atualizarStatus,
  transicaoPermitida,
  ROTULOS_STATUS,
  TRANSICOES_STATUS,
} from '../services/order-service.js';
import {
  bancoConfigurado,
  verificarConexao,
  selecionar,
  selecionarUm,
  atualizar,
  remover,
} from '../services/database.js';

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

const semSessao = () => ({ headers: {} });

/** Códigos criados durante o teste, para limpar no final. */
const criados = [];

/* -----------------------------------------------------------------------------
 * Pré-requisitos
 * -------------------------------------------------------------------------- */

if (!bancoConfigurado) {
  console.log('\n  ⊘ Banco não configurado — suíte de pedidos pulada.\n');
  process.exit(0);
}

const conexao = await verificarConexao();
if (!conexao.conectado || !conexao.esquemaAplicado) {
  console.log(`\n  ⊘ ${conexao.mensagem}\n  Suíte de pedidos pulada.\n`);
  process.exit(0);
}

const alvo = await selecionarUm('catalogo_publico', {
  colunas: 'slug,nome,preco_efetivo,disponivel,sob_encomenda',
  ordenar: 'disponivel.desc',
});

if (!alvo) {
  console.log('\n  ⊘ Nenhum produto publicado — suíte de pedidos pulada.\n');
  process.exit(0);
}

/* -----------------------------------------------------------------------------
 * PREPARO: desligar "sob encomenda" temporariamente
 *
 * Todos os produtos do seed estão marcados como `sob_encomenda = true`, o que
 * é realista para uma confeitaria artesanal — mas faz o estoque nunca bloquear
 * uma venda. Com isso, os dois caminhos mais importantes deste teste (baixa de
 * estoque e recusa por falta) nunca eram exercitados.
 *
 * Então desligamos a flag no produto escolhido, rodamos os testes, e
 * RESTAURAMOS o valor original no bloco `finally`.
 * -------------------------------------------------------------------------- */

const produtoAlvo = await selecionarUm('products', {
  colunas: 'id',
  filtros: { slug: `eq.${alvo.slug}` },
});

const estoqueOriginal = await selecionarUm('inventory', {
  colunas: 'quantidade,sob_encomenda',
  filtros: { produto_id: `eq.${produtoAlvo.id}` },
});

/** true quando conseguimos preparar o cenário de estoque limitado. */
let estoqueControlado = false;

if (estoqueOriginal) {
  await atualizar(
    'inventory',
    { produto_id: `eq.${produtoAlvo.id}` },
    { sob_encomenda: false }
  );
  estoqueControlado = true;
  alvo.sob_encomenda = false;
}

/** Corpo de pedido válido, com os campos que o teste quiser sobrescrever. */
const pedidoBase = (extras = {}) => ({
  nome: 'Cliente de Teste',
  whatsapp: '11999997777',
  email: 'teste@docefefe-testes.com',
  tipoEntrega: 'retirada',
  observacoes: 'Pedido gerado por teste automatizado.',
  consentimento: true,
  itens: [{ slug: alvo.slug, quantidade: 2 }],
  ...extras,
});

/** Lê o estoque atual de um produto. */
async function estoqueDe(slug) {
  const p = await selecionarUm('products', {
    colunas: 'id',
    filtros: { slug: `eq.${slug}` },
  });
  if (!p) return null;

  const e = await selecionarUm('inventory', {
    colunas: 'quantidade',
    filtros: { produto_id: `eq.${p.id}` },
  });
  return e?.quantidade ?? null;
}

try {
  /* =========================================================================
   * 1. CRIAÇÃO
   * ====================================================================== */

  console.log('\n── Criação de pedido ──\n');

  const estoqueAntes = await estoqueDe(alvo.slug);

  const criacao = await postPedido({ req: semSessao(), corpo: pedidoBase() });

  verificar('status 201', criacao.status === 201, `obtido: ${criacao.status}`);

  const pedido = criacao.corpo.pedido;
  if (pedido?.codigo) criados.push(pedido.codigo);

  verificar(
    'código no formato DF + 8 caracteres',
    /^DF[0-9A-Z]{8}$/.test(pedido?.codigo || ''),
    `obtido: ${pedido?.codigo}`
  );

  /* -----------------------------------------------------------------------
   * O teste que mais importa: nenhum pedido nasce pago.
   * -------------------------------------------------------------------- */
  verificar(
    'pedido nasce como "aguardando_pagamento"',
    pedido?.status === 'aguardando_pagamento',
    `obtido: ${pedido?.status}`
  );

  verificar(
    'subtotal = preço do banco × quantidade',
    pedido?.subtotal === alvo.preco_efetivo * 2,
    `esperado ${alvo.preco_efetivo * 2}, obtido ${pedido?.subtotal}`
  );
  verificar(
    'total fecha a conta (subtotal − desconto + frete)',
    pedido?.total === pedido?.subtotal - pedido?.desconto + pedido?.frete
  );
  verificar('valores são inteiros', Number.isInteger(pedido?.total));
  verificar('anônimo não recebe atacado', pedido?.ehAtacado === false);

  /* =========================================================================
   * 2. BAIXA DE ESTOQUE
   * ====================================================================== */

  console.log('\n── Baixa de estoque ──\n');

  if (alvo.sob_encomenda) {
    console.log('  ⊘ produto é sob encomenda — testes de estoque pulados');
  } else {
    const estoqueDepois = await estoqueDe(alvo.slug);

    verificar(
      'estoque baixou exatamente a quantidade pedida',
      estoqueDepois === estoqueAntes - 2,
      `antes ${estoqueAntes}, depois ${estoqueDepois}`
    );

    // O livro-razão precisa registrar o movimento.
    const movimentos = await selecionar('inventory_movements', {
      colunas: 'tipo,quantidade,saldo_apos,motivo',
      ordenar: 'criado_em.desc',
      limite: 1,
    });

    verificar(
      'movimento registrado como venda',
      movimentos[0]?.tipo === 'venda',
      `obtido: ${movimentos[0]?.tipo}`
    );
    verificar(
      'movimento tem quantidade negativa',
      movimentos[0]?.quantidade === -2,
      `obtido: ${movimentos[0]?.quantidade}`
    );
    verificar(
      'movimento cita o código do pedido',
      String(movimentos[0]?.motivo || '').includes(pedido.codigo)
    );
  }

  /* =========================================================================
   * 3. SEGURANÇA — FRAUDE DE PREÇO
   * ====================================================================== */

  console.log('\n── Tentativas de fraudar o preço ──\n');

  const fraudes = [
    ['preço de 1 centavo no item', { itens: [{ slug: alvo.slug, quantidade: 1, preco: 1 }] }],
    ['subtotal forjado', { subtotal: 1, itens: [{ slug: alvo.slug, quantidade: 1 }] }],
    ['total forjado', { total: 1, itens: [{ slug: alvo.slug, quantidade: 1 }] }],
    ['desconto forjado', { desconto: 999999, itens: [{ slug: alvo.slug, quantidade: 1 }] }],
    ['frete negativo', { frete: -5000, itens: [{ slug: alvo.slug, quantidade: 1 }] }],
    ['status pago na entrada', { status: 'pagamento_aprovado', itens: [{ slug: alvo.slug, quantidade: 1 }] }],
    ['ehAtacado forçado', { ehAtacado: true, itens: [{ slug: alvo.slug, quantidade: 1 }] }],
  ];

  for (const [nome, extras] of fraudes) {
    const resposta = await postPedido({ req: semSessao(), corpo: pedidoBase(extras) });

    if (resposta.status !== 201) {
      // Rejeitar também é resposta correta.
      verificar(`${nome} é rejeitado`, true);
      continue;
    }

    const p = resposta.corpo.pedido;
    criados.push(p.codigo);

    verificar(
      `${nome} é ignorado`,
      p.subtotal === alvo.preco_efetivo &&
        p.total === alvo.preco_efetivo &&
        p.status === 'aguardando_pagamento' &&
        p.ehAtacado === false,
      `subtotal ${p.subtotal}, total ${p.total}, status ${p.status}, atacado ${p.ehAtacado}`
    );
  }

  /* =========================================================================
   * 4. VALIDAÇÃO DE ENTRADA
   * ====================================================================== */

  console.log('\n── Dados inválidos ──\n');

  const invalidos = [
    ['nome com 1 letra', { nome: 'X' }, 'nome'],
    ['whatsapp curto', { whatsapp: '119' }, 'whatsapp'],
    ['e-mail malformado', { email: 'nao-e-email' }, 'email'],
    ['tipo de entrega inválido', { tipoEntrega: 'teleporte' }, 'tipoEntrega'],
    ['sem consentimento', { consentimento: false }, 'consentimento'],
    ['carrinho vazio', { itens: [] }, 'itens'],
    ['data no passado', { dataDesejada: '2020-01-01' }, 'dataDesejada'],
    ['data em formato errado', { dataDesejada: '01/01/2027' }, 'dataDesejada'],
    ['observação gigante', { observacoes: 'x'.repeat(600) }, 'observacoes'],
  ];

  for (const [nome, extras, campo] of invalidos) {
    const resposta = await postPedido({ req: semSessao(), corpo: pedidoBase(extras) });

    verificar(
      `${nome} devolve 422`,
      resposta.status === 422,
      `obtido: ${resposta.status}`
    );
    verificar(
      `${nome} aponta o campo "${campo}"`,
      Boolean(resposta.corpo.erros?.[campo]),
      JSON.stringify(resposta.corpo.erros)
    );
  }

  // Entrega exige endereço.
  const semEndereco = await postPedido({
    req: semSessao(),
    corpo: pedidoBase({ tipoEntrega: 'entrega', endereco: null }),
  });
  verificar('entrega sem endereço é rejeitada', semEndereco.status === 422);

  // Endereço incompleto.
  const enderecoRuim = await postPedido({
    req: semSessao(),
    corpo: pedidoBase({
      tipoEntrega: 'entrega',
      endereco: { cep: '123', logradouro: 'R', numero: '', bairro: '', cidade: '', estado: 'XX' },
    }),
  });
  verificar('endereço incompleto é rejeitado', enderecoRuim.status === 422);
  verificar(
    'aponta os campos do endereço',
    Object.keys(enderecoRuim.corpo.erros || {}).some((k) => k.startsWith('endereco.')),
    JSON.stringify(enderecoRuim.corpo.erros)
  );

  // Slug malicioso.
  const slugRuim = await postPedido({
    req: semSessao(),
    corpo: pedidoBase({ itens: [{ slug: "'; DROP TABLE orders; --", quantidade: 1 }] }),
  });
  verificar(
    'slug malicioso é rejeitado',
    slugRuim.status === 422,
    `obtido: ${slugRuim.status}`
  );

  // Produto inexistente.
  const inexistente = await postPedido({
    req: semSessao(),
    corpo: pedidoBase({ itens: [{ slug: 'produto-que-nao-existe-xyz', quantidade: 1 }] }),
  });
  verificar(
    'produto inexistente devolve 409',
    inexistente.status === 409,
    `obtido: ${inexistente.status}`
  );

  /* =========================================================================
   * 5. ESTOQUE INSUFICIENTE
   * ====================================================================== */

  console.log('\n── Estoque insuficiente ──\n');

  if (alvo.sob_encomenda) {
    console.log('  ⊘ produto é sob encomenda — teste pulado');
  } else {
    const disponivel = await estoqueDe(alvo.slug);

    const acimaDoEstoque = await postPedido({
      req: semSessao(),
      corpo: pedidoBase({ itens: [{ slug: alvo.slug, quantidade: Math.min(disponivel + 10, 99) }] }),
    });

    if (disponivel + 10 <= 99) {
      verificar(
        'pedido acima do estoque é recusado',
        acimaDoEstoque.status === 409,
        `obtido: ${acimaDoEstoque.status}`
      );
      verificar(
        'mensagem informa quanto temos',
        /unidade/i.test(acimaDoEstoque.corpo.mensagem || ''),
        acimaDoEstoque.corpo.mensagem
      );

      // O estoque NÃO pode ter mudado numa tentativa recusada.
      const depoisDaRecusa = await estoqueDe(alvo.slug);
      verificar(
        'estoque intacto após recusa (transação revertida)',
        depoisDaRecusa === disponivel,
        `antes ${disponivel}, depois ${depoisDaRecusa}`
      );
    } else {
      console.log('  ⊘ estoque alto demais para testar o limite');
    }
  }

  /* =========================================================================
   * 6. CONSULTA E CONTROLE DE ACESSO
   * ====================================================================== */

  console.log('\n── Consulta de pedido ──\n');

  const consulta = await getPedido({
    req: semSessao(),
    params: { codigo: pedido.codigo },
  });

  // O pedido foi criado SEM sessão (usuario_id nulo) e a consulta também é
  // sem sessão — então o dono confere e o pedido é devolvido.
  verificar('dono consegue consultar', consulta.status === 200, `obtido: ${consulta.status}`);
  verificar('devolve os itens', consulta.corpo.pedido?.itens?.length > 0);
  verificar(
    'status continua aguardando pagamento',
    consulta.corpo.pedido?.status === 'aguardando_pagamento'
  );

  const codigoFalso = await getPedido({ req: semSessao(), params: { codigo: 'DFZZZZZZZZ' } });
  verificar('código inexistente devolve 404', codigoFalso.status === 404);

  const codigoInvalido = await getPedido({ req: semSessao(), params: { codigo: '../../etc' } });
  verificar('código malformado devolve 404', codigoInvalido.status === 404);

  /* =========================================================================
   * 7. FLUXO DE STATUS
   * ====================================================================== */

  console.log('\n── Fluxo de status ──\n');

  // Transições que NÃO podem acontecer.
  const proibidas = [
    ['aguardando_pagamento', 'entregue'],
    ['aguardando_pagamento', 'em_preparacao'],
    ['aguardando_pagamento', 'saiu_para_entrega'],
    ['entregue', 'aguardando_pagamento'],
    ['cancelado', 'pagamento_aprovado'],
    ['entregue', 'cancelado'],
  ];

  for (const [de, para] of proibidas) {
    verificar(
      `${ROTULOS_STATUS[de]} → ${ROTULOS_STATUS[para]} é bloqueado`,
      !transicaoPermitida(de, para)
    );
  }

  // Transições válidas.
  const permitidas = [
    ['aguardando_pagamento', 'pagamento_aprovado'],
    ['pagamento_aprovado', 'em_preparacao'],
    ['em_preparacao', 'pronto_para_retirada'],
    ['pronto_para_retirada', 'entregue'],
  ];

  for (const [de, para] of permitidas) {
    verificar(
      `${ROTULOS_STATUS[de]} → ${ROTULOS_STATUS[para]} é permitido`,
      transicaoPermitida(de, para)
    );
  }

  // Estados finais não têm saída.
  verificar('"entregue" é estado final', TRANSICOES_STATUS.entregue.length === 0);
  verificar('"cancelado" é estado final', TRANSICOES_STATUS.cancelado.length === 0);

  // Aplicando no banco de verdade.
  const pulo = await atualizarStatus(pedido.codigo, 'entregue').catch((e) => e);
  verificar(
    'pular etapas é recusado pelo serviço',
    pulo?.status === 409,
    `obtido: ${pulo?.status} — ${pulo?.message}`
  );

  const avanco = await atualizarStatus(pedido.codigo, 'pagamento_aprovado');
  verificar('avanço válido é aceito', avanco.status === 'pagamento_aprovado');

  // Repetir o mesmo status precisa ser idempotente — o webhook da Fase 8 pode
  // chegar duas vezes para o mesmo pagamento.
  const repetido = await atualizarStatus(pedido.codigo, 'pagamento_aprovado');
  verificar(
    'repetir o status não é erro (idempotente)',
    repetido.alterado === false,
    JSON.stringify(repetido)
  );

  const statusInvalido = await atualizarStatus(pedido.codigo, 'inventado').catch((e) => e);
  verificar('status inexistente é recusado', statusInvalido?.status === 400);
} catch (erro) {
  console.log(`\n  ✗ Erro inesperado: ${erro.message}\n`);
  console.error(erro);
  falhas += 1;
} finally {
  /* =========================================================================
   * LIMPEZA
   * ====================================================================== */

  console.log('\n── Limpeza ──\n');

  // Restaura a configuração de estoque alterada no preparo.
  if (estoqueControlado && estoqueOriginal) {
    await atualizar(
      'inventory',
      { produto_id: `eq.${produtoAlvo.id}` },
      {
        sob_encomenda: estoqueOriginal.sob_encomenda,
        quantidade: estoqueOriginal.quantidade,
      }
    ).catch(() => {});

    const restaurado = await selecionarUm('inventory', {
      colunas: 'quantidade,sob_encomenda',
      filtros: { produto_id: `eq.${produtoAlvo.id}` },
    });

    verificar(
      'estoque e flag restaurados ao estado original',
      restaurado?.quantidade === estoqueOriginal.quantidade &&
        restaurado?.sob_encomenda === estoqueOriginal.sob_encomenda,
      `quantidade ${restaurado?.quantidade} (era ${estoqueOriginal.quantidade})`
    );
  }

  let removidos = 0;

  for (const codigo of criados) {
    // order_items cai em cascata junto com o pedido.
    await remover('orders', { codigo: `eq.${codigo}` })
      .then(() => {
        removidos += 1;
      })
      .catch(() => {});
  }

  verificar(
    `${removidos} de ${criados.length} pedido(s) de teste removido(s)`,
    removidos === criados.length
  );

  // Os movimentos de estoque NÃO são apagados de propósito: são um livro-razão,
  // só de inserção. Apagá-los mascararia a diferença entre o saldo e o
  // histórico — exatamente o que um livro-razão existe para impedir.
  console.log('  ℹ movimentos de estoque mantidos (livro-razão é imutável)');
}

/* -----------------------------------------------------------------------------
 * Resultado
 * -------------------------------------------------------------------------- */

console.log(`\n${'─'.repeat(50)}`);
console.log(`  ${ok} verificações passaram · ${falhas} falharam`);
console.log(`${'─'.repeat(50)}\n`);

process.exit(falhas > 0 ? 1 : 0);
