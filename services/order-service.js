/**
 * services/order-service.js
 * -----------------------------------------------------------------------------
 * Criação e consulta de pedidos.
 *
 * A criação em si acontece na função SQL `criar_pedido` (ver
 * database/05-criar-pedido.sql), que roda tudo em UMA transação. Esta camada
 * apenas valida o formato da entrada, chama a função e traduz os erros do
 * banco em mensagens que o cliente entenda.
 *
 * ⚠️ O QUE ESTA CAMADA NÃO ENVIA AO BANCO
 *   Preço, nome de produto e condição de atacado. A função SQL busca tudo
 *   sozinha. Daqui vão apenas: qual produto, quantas unidades, e os dados de
 *   contato e entrega.
 */

import { chamarFuncao, selecionar, selecionarUm, atualizar, ErroBanco } from './database.js';

/* =============================================================================
 * STATUS DO PEDIDO
 * ========================================================================== */

/**
 * Transições permitidas entre status.
 *
 * Declarar o fluxo como dados, e não como uma sequência de `if`, evita que um
 * pedido pule etapas — por exemplo, sair de "aguardando pagamento" direto para
 * "entregue" sem nunca ter sido pago.
 */
export const TRANSICOES_STATUS = {
  // O cliente envia o comprovante → comprovante_enviado.
  // A LOJA confere no extrato    → pagamento_aprovado.
  // Pagamento em dinheiro pula a etapa do comprovante.
  aguardando_pagamento: ['comprovante_enviado', 'pagamento_aprovado', 'cancelado'],

  // Comprovante pode ser recusado: volta para aguardando_pagamento, e o
  // cliente envia outro.
  comprovante_enviado: ['pagamento_aprovado', 'aguardando_pagamento', 'cancelado'],

  pagamento_aprovado: ['em_preparacao', 'cancelado'],
  em_preparacao: ['pronto_para_retirada', 'saiu_para_entrega', 'cancelado'],
  pronto_para_retirada: ['entregue', 'cancelado'],
  saiu_para_entrega: ['entregue', 'cancelado'],
  // Estados finais: não saem mais de lá.
  entregue: [],
  cancelado: [],
};

export const ROTULOS_STATUS = {
  aguardando_pagamento: 'Aguardando pagamento',
  comprovante_enviado: 'Comprovante em análise',
  pagamento_aprovado: 'Pagamento aprovado',
  em_preparacao: 'Em preparação',
  pronto_para_retirada: 'Pronto para retirada',
  saiu_para_entrega: 'Saiu para entrega',
  entregue: 'Entregue',
  cancelado: 'Cancelado',
};

/** Verifica se uma mudança de status é permitida. */
export function transicaoPermitida(de, para) {
  return (TRANSICOES_STATUS[de] || []).includes(para);
}

/* =============================================================================
 * TRADUÇÃO DOS ERROS DO BANCO
 * ========================================================================== */

/**
 * A função SQL lança exceções com um código no `message` e a explicação
 * amigável no `hint`. Aqui montamos a resposta para o cliente.
 */
const ERROS_PEDIDO = {
  NOME_INVALIDO: { status: 422, campo: 'nome' },
  WHATSAPP_INVALIDO: { status: 422, campo: 'whatsapp' },
  ENTREGA_INVALIDA: { status: 422, campo: 'tipoEntrega' },
  ENDERECO_OBRIGATORIO: { status: 422, campo: 'endereco' },
  DATA_PASSADA: { status: 422, campo: 'dataDesejada' },
  FRETE_INVALIDO: { status: 422, campo: 'frete' },
  CARRINHO_VAZIO: { status: 422, campo: 'itens' },
  ITENS_DEMAIS: { status: 422, campo: 'itens' },
  QUANTIDADE_INVALIDA: { status: 422, campo: 'itens' },
  PRODUTO_INDISPONIVEL: { status: 409, campo: 'itens' },
  ESTOQUE_INSUFICIENTE: { status: 409, campo: 'itens' },
  SEM_ESTOQUE_CADASTRADO: { status: 409, campo: 'itens' },

  // Mínimo de UNIDADES de um produto, para valer o preço de atacado.
  MINIMO_ATACADO: { status: 422, campo: 'itens' },

  // Mínimo de VALOR do pedido inteiro, definido por parceiro (Fase 10).
  // Sem esta linha o erro cai no caso genérico e o parceiro lê "tente
  // novamente em instantes" — conselho errado, porque repetir o mesmo
  // pedido nunca vai funcionar. Ele precisa ler quanto falta.
  MINIMO_PEDIDO_ATACADO: { status: 422, campo: 'itens' },

  PRECO_INVALIDO: { status: 500, campo: null },
};

/** Erro de pedido com status HTTP e campo associado. */
export class ErroPedido extends Error {
  constructor(mensagem, status = 400, campo = null, codigo = '') {
    super(mensagem);
    this.name = 'ErroPedido';
    this.status = status;
    this.campo = campo;
    this.codigo = codigo;
  }
}

function traduzirErroDoBanco(erro) {
  const detalhes = erro.detalhes || {};

  // O PostgREST devolve { message, hint, details, code } vindos do RAISE.
  const codigo = String(detalhes.message || erro.message || '').trim();
  const explicacao = detalhes.hint || '';

  const conhecido = ERROS_PEDIDO[codigo];

  if (conhecido) {
    return new ErroPedido(
      explicacao || 'Não foi possível criar o pedido.',
      conhecido.status,
      conhecido.campo,
      codigo
    );
  }

  console.error('[order-service] Erro não mapeado do banco:', codigo, detalhes);

  return new ErroPedido(
    'Não foi possível criar o pedido. Tente novamente em instantes.',
    503,
    null,
    codigo
  );
}

/* =============================================================================
 * VALIDAÇÃO DO FORMATO
 *
 * Checagem de FORMATO apenas. As regras de negócio (estoque, preço, mínimo de
 * atacado) são verificadas dentro da transação, onde não há janela para
 * alteração entre a checagem e a gravação.
 * ========================================================================== */

const ESTADOS_BR = new Set([
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB',
  'PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
]);

function validarEndereco(endereco) {
  const erros = {};

  if (!endereco || typeof endereco !== 'object') {
    return { ok: false, erros: { endereco: 'Informe o endereço de entrega.' } };
  }

  const cep = String(endereco.cep || '').replace(/\D/g, '');
  if (cep.length !== 8) erros['endereco.cep'] = 'CEP inválido.';

  const logradouro = String(endereco.logradouro || '').trim();
  if (logradouro.length < 3) erros['endereco.logradouro'] = 'Informe a rua.';

  const numero = String(endereco.numero || '').trim();
  if (!numero) erros['endereco.numero'] = 'Informe o número.';

  const bairro = String(endereco.bairro || '').trim();
  if (bairro.length < 2) erros['endereco.bairro'] = 'Informe o bairro.';

  const cidade = String(endereco.cidade || '').trim();
  if (cidade.length < 2) erros['endereco.cidade'] = 'Informe a cidade.';

  const estado = String(endereco.estado || '').trim().toUpperCase();
  if (!ESTADOS_BR.has(estado)) erros['endereco.estado'] = 'UF inválida.';

  if (Object.keys(erros).length > 0) return { ok: false, erros };

  return {
    ok: true,
    endereco: {
      cep,
      logradouro: logradouro.slice(0, 200),
      numero: numero.slice(0, 20),
      complemento: String(endereco.complemento || '').trim().slice(0, 100) || null,
      bairro: bairro.slice(0, 100),
      cidade: cidade.slice(0, 100),
      estado,
      referencia: String(endereco.referencia || '').trim().slice(0, 200) || null,
    },
  };
}

/**
 * Valida o corpo do pedido.
 * @returns {{ok: boolean, erros?: object, dados?: object}}
 */
export function validarPedido(corpo) {
  const erros = {};

  if (!corpo || typeof corpo !== 'object') {
    return { ok: false, erros: { geral: 'Envie os dados do pedido.' } };
  }

  // --- Contato ---
  const nome = String(corpo.nome || '').trim();
  if (nome.length < 2) erros.nome = 'Informe seu nome completo.';
  else if (nome.length > 120) erros.nome = 'O nome é longo demais.';

  const whatsapp = String(corpo.whatsapp || '').replace(/\D/g, '');
  if (whatsapp.length < 10 || whatsapp.length > 11) {
    erros.whatsapp = 'Informe o WhatsApp com DDD.';
  }

  const email = String(corpo.email || '').trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    erros.email = 'Esse e-mail parece incompleto.';
  }

  // --- Entrega ---
  const tipoEntrega = String(corpo.tipoEntrega || '').trim();
  if (!['entrega', 'retirada'].includes(tipoEntrega)) {
    erros.tipoEntrega = 'Escolha entre entrega e retirada.';
  }

  let endereco = null;
  if (tipoEntrega === 'entrega') {
    const resultado = validarEndereco(corpo.endereco);
    if (!resultado.ok) {
      Object.assign(erros, resultado.erros);
    } else {
      endereco = resultado.endereco;
    }
  }

  // --- Data desejada ---
  let dataDesejada = null;
  const dataBruta = String(corpo.dataDesejada || '').trim();

  if (dataBruta) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataBruta)) {
      erros.dataDesejada = 'Use o formato AAAA-MM-DD.';
    } else {
      const escolhida = new Date(`${dataBruta}T00:00:00`);
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);

      if (Number.isNaN(escolhida.getTime())) {
        erros.dataDesejada = 'Data inválida.';
      } else if (escolhida < hoje) {
        erros.dataDesejada = 'A data não pode ser no passado.';
      } else {
        // Limite de 1 ano: evita pedido para 2099 por erro de digitação.
        const limite = new Date(hoje);
        limite.setFullYear(limite.getFullYear() + 1);

        if (escolhida > limite) {
          erros.dataDesejada = 'Escolha uma data dentro de um ano.';
        } else {
          dataDesejada = dataBruta;
        }
      }
    }
  }

  // --- Itens ---
  const itens = [];

  if (!Array.isArray(corpo.itens) || corpo.itens.length === 0) {
    erros.itens = 'Seu carrinho está vazio.';
  } else if (corpo.itens.length > 50) {
    erros.itens = 'Máximo de 50 produtos diferentes por pedido.';
  } else {
    for (const item of corpo.itens) {
      if (!item || typeof item.slug !== 'string') continue;
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(item.slug)) continue;

      const quantidade = Number(item.quantidade);
      if (!Number.isInteger(quantidade) || quantidade < 1) continue;

      itens.push({ slug: item.slug, quantidade: Math.min(quantidade, 99) });
    }

    if (itens.length === 0) {
      erros.itens = 'Nenhum item válido no pedido.';
    }
  }

  // --- Observações ---
  const observacoes = String(corpo.observacoes || '').trim();
  if (observacoes.length > 500) {
    erros.observacoes = 'As observações passaram de 500 caracteres.';
  }

  // --- Consentimento LGPD ---
  if (corpo.consentimento !== true && corpo.consentimento !== 'true') {
    erros.consentimento = 'Precisamos da sua autorização para processar o pedido.';
  }

  if (Object.keys(erros).length > 0) return { ok: false, erros };

  return {
    ok: true,
    dados: {
      nome,
      email: email || null,
      whatsapp,
      tipoEntrega,
      endereco,
      dataDesejada,
      observacoes: observacoes || null,
      itens,
      cupom: String(corpo.cupom || '').trim().toUpperCase() || null,
    },
  };
}

/* =============================================================================
 * CRIAÇÃO
 * ========================================================================== */

/**
 * Cria um pedido.
 *
 * @param {object} dados - já validados por validarPedido
 * @param {object} [opcoes]
 * @param {string|null} [opcoes.usuarioId]
 * @param {number} [opcoes.freteCentavos]
 * @returns {Promise<object>} o pedido criado
 * @throws {ErroPedido}
 */
export async function criarPedido(dados, { usuarioId = null, freteCentavos = 0 } = {}) {
  try {
    const resultado = await chamarFuncao('criar_pedido', {
      p_usuario_id: usuarioId,
      p_cliente_nome: dados.nome,
      p_cliente_email: dados.email,
      p_cliente_whatsapp: dados.whatsapp,
      p_tipo_entrega: dados.tipoEntrega,
      p_endereco: dados.endereco,
      p_data_desejada: dados.dataDesejada,
      p_observacoes: dados.observacoes,
      p_itens: dados.itens,
      p_cupom_codigo: dados.cupom,
      p_frete_centavos: freteCentavos,
    });

    return resultado;
  } catch (erro) {
    if (erro instanceof ErroBanco) throw traduzirErroDoBanco(erro);
    throw erro;
  }
}

/* =============================================================================
 * CONSULTA
 * ========================================================================== */

/**
 * Busca um pedido pelo código.
 *
 * ⚠️ CONTROLE DE ACESSO
 *   Quem chama precisa informar o usuário logado. O pedido só é devolvido se
 *   pertencer a ele — ou se for uma consulta administrativa explícita.
 *
 *   Sem isso, bastaria adivinhar um código para ler nome, telefone e endereço
 *   de outra pessoa.
 *
 * @param {string} codigo
 * @param {object} opcoes
 * @param {string|null} opcoes.usuarioId
 * @param {boolean} [opcoes.comoAdmin]
 */
export async function obterPedido(codigo, { usuarioId = null, comoAdmin = false } = {}) {
  const limpo = String(codigo || '').trim().toUpperCase();

  if (!/^DF[0-9A-Z]{8}$/.test(limpo)) return null;

  const pedido = await selecionarUm('orders', {
    colunas:
      'id,codigo,usuario_id,cliente_nome,cliente_email,cliente_whatsapp,status,' +
      'tipo_entrega,endereco_entrega,data_desejada,observacoes,' +
      'subtotal_centavos,desconto_centavos,frete_centavos,total_centavos,' +
      'cupom_codigo,eh_atacado,criado_em,cancelado_em,motivo_cancelamento',
    filtros: { codigo: `eq.${limpo}` },
  });

  if (!pedido) return null;

  // A checagem de dono acontece DEPOIS de buscar, mas antes de devolver.
  if (!comoAdmin && pedido.usuario_id !== usuarioId) return null;

  const itens = await selecionar('order_items', {
    colunas: 'produto_nome,produto_slug,preco_unitario_centavos,quantidade,subtotal_centavos',
    filtros: { pedido_id: `eq.${pedido.id}` },
    ordenar: 'criado_em.asc',
  });

  return {
    codigo: pedido.codigo,
    status: pedido.status,
    statusRotulo: ROTULOS_STATUS[pedido.status] || pedido.status,
    cliente: {
      nome: pedido.cliente_nome,
      email: pedido.cliente_email,
      whatsapp: pedido.cliente_whatsapp,
    },
    tipoEntrega: pedido.tipo_entrega,
    endereco: pedido.endereco_entrega,
    dataDesejada: pedido.data_desejada,
    observacoes: pedido.observacoes,
    subtotal: pedido.subtotal_centavos,
    desconto: pedido.desconto_centavos,
    frete: pedido.frete_centavos,
    total: pedido.total_centavos,
    cupom: pedido.cupom_codigo,
    ehAtacado: pedido.eh_atacado,
    criadoEm: pedido.criado_em,
    canceladoEm: pedido.cancelado_em,
    motivoCancelamento: pedido.motivo_cancelamento,
    itens: itens.map((i) => ({
      nome: i.produto_nome,
      slug: i.produto_slug,
      precoUnitario: i.preco_unitario_centavos,
      quantidade: i.quantidade,
      subtotal: i.subtotal_centavos,
    })),
  };
}

/* =============================================================================
 * MUDANÇA DE STATUS
 * ========================================================================== */

/**
 * Atualiza o status de um pedido, respeitando o fluxo permitido.
 *
 * ⚠️ NÃO É AQUI QUE O PAGAMENTO É CONFIRMADO.
 *   A transição para 'pagamento_aprovado' só pode vir do webhook validado do
 *   Mercado Pago (Fase 8) ou de uma confirmação manual no painel
 *   administrativo. Nunca porque o cliente voltou à página de sucesso.
 *
 * @param {string} codigo
 * @param {string} novoStatus
 * @param {object} [opcoes]
 */
export async function atualizarStatus(codigo, novoStatus, { motivo = null } = {}) {
  const limpo = String(codigo || '').trim().toUpperCase();

  if (!/^DF[0-9A-Z]{8}$/.test(limpo)) {
    throw new ErroPedido('Código de pedido inválido.', 400, 'codigo');
  }

  if (!ROTULOS_STATUS[novoStatus]) {
    throw new ErroPedido('Status inválido.', 400, 'status');
  }

  const pedido = await selecionarUm('orders', {
    colunas: 'id,status',
    filtros: { codigo: `eq.${limpo}` },
  });

  if (!pedido) {
    throw new ErroPedido('Pedido não encontrado.', 404, 'codigo');
  }

  if (pedido.status === novoStatus) {
    // Repetir o mesmo status não é erro — é operação idempotente. Importa
    // para o webhook, que pode chegar duas vezes.
    return { codigo: limpo, status: novoStatus, alterado: false };
  }

  if (!transicaoPermitida(pedido.status, novoStatus)) {
    throw new ErroPedido(
      `Não é possível mudar de "${ROTULOS_STATUS[pedido.status]}" para ` +
        `"${ROTULOS_STATUS[novoStatus]}".`,
      409,
      'status'
    );
  }

  const mudancas = { status: novoStatus };

  if (novoStatus === 'cancelado') {
    mudancas.cancelado_em = new Date().toISOString();
    if (motivo) mudancas.motivo_cancelamento = String(motivo).slice(0, 500);
  }

  await atualizar('orders', { codigo: `eq.${limpo}` }, mudancas);

  return { codigo: limpo, status: novoStatus, alterado: true };
}

export default {
  validarPedido,
  criarPedido,
  obterPedido,
  atualizarStatus,
  transicaoPermitida,
  TRANSICOES_STATUS,
  ROTULOS_STATUS,
  ErroPedido,
};
