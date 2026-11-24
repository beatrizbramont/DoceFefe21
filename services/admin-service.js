/**
 * services/admin-service.js
 * -----------------------------------------------------------------------------
 * O que o painel administrativo precisa além do catálogo: números do
 * dashboard, estoque e lista de clientes.
 *
 * O catálogo em si fica em services/product-admin-service.js — este arquivo
 * cuida do que gira em torno dele.
 *
 * ⚠️ TUDO AQUI LÊ DADO SENSÍVEL
 *   Faturamento, e-mail e telefone de cliente, quanto cada pessoa já gastou.
 *   Nenhuma função deste arquivo pode ser chamada sem `exigirAdmin` antes —
 *   a checagem fica nos controladores, e os testes em tests/admin.test.mjs
 *   provam que ela está lá.
 */

import {
  selecionar,
  selecionarUm,
  atualizar,
  chamarFuncao,
  ErroBanco,
} from './database.js';

/** Erro do painel com status HTTP e campo associado. */
export class ErroAdmin extends Error {
  constructor(mensagem, status = 422, campo = null) {
    super(mensagem);
    this.name = 'ErroAdmin';
    this.status = status;
    this.campo = campo;
  }
}

/* =============================================================================
 * DASHBOARD
 * ========================================================================== */

/** Períodos que o dashboard oferece. Lista fechada, não texto livre. */
export const PERIODOS = [7, 30, 90, 365];

/**
 * Números do dashboard.
 *
 * A conta inteira acontece no banco (`resumo_admin`). Trazer os pedidos para
 * somar aqui significaria baixar o histórico inteiro a cada abertura da tela.
 *
 * @param {number} [dias]
 */
export async function obterResumo(dias = 30) {
  const periodo = PERIODOS.includes(Number(dias)) ? Number(dias) : 30;

  const resumo = await chamarFuncao('resumo_admin', { p_dias: periodo });

  // `chamarFuncao` devolve o jsonb direto; só normalizamos os nomes para o
  // vocabulário do frontend.
  return {
    periodoDias: resumo.periodo_dias,
    faturamento: Number(resumo.faturamento) || 0,
    pedidosPagos: resumo.pedidos_pagos || 0,
    ticketMedio: Number(resumo.ticket_medio) || 0,
    clientesNovos: resumo.clientes_novos || 0,

    fila: {
      aguardandoPagamento: resumo.fila?.aguardando_pagamento || 0,
      aConferir: resumo.fila?.a_conferir || 0,
      emPreparacao: resumo.fila?.em_preparacao || 0,
      aEntregar: resumo.fila?.a_entregar || 0,
    },

    catalogo: {
      total: resumo.catalogo?.total || 0,
      publicados: resumo.catalogo?.publicados || 0,
      rascunhos: resumo.catalogo?.rascunhos || 0,
    },

    maisVendidos: (resumo.mais_vendidos || []).map((p) => ({
      nome: p.nome,
      slug: p.slug,
      quantidade: p.quantidade,
      total: p.total,
    })),

    estoqueBaixo: (resumo.estoque_baixo || []).map((p) => ({
      nome: p.nome,
      slug: p.slug,
      disponivel: p.disponivel,
      minimo: p.minimo,
    })),
  };
}

/* =============================================================================
 * ESTOQUE
 * ========================================================================== */

/** Movimentos que o painel pode emitir. `venda` vem da venda, não da mão. */
export const TIPOS_MOVIMENTO = {
  entrada: 'Entrada',
  saida: 'Saída',
  perda: 'Perda',
  ajuste: 'Contagem',
};

const ERROS_ESTOQUE = {
  TIPO_INVALIDO: [422, 'tipo'],
  QUANTIDADE_INVALIDA: [422, 'quantidade'],
  PRODUTO_NAO_ENCONTRADO: [404, null],
  SEM_ALTERACAO: [422, 'quantidade'],
  SALDO_NEGATIVO: [409, 'quantidade'],
  ABAIXO_DO_RESERVADO: [409, 'quantidade'],
};

/**
 * Traduz o erro da função do banco.
 *
 * A função levanta um código curto (`SALDO_NEGATIVO`) e explica no `hint`.
 * O código decide o status HTTP; o hint é o que a pessoa lê.
 */
function traduzirErroEstoque(erro) {
  if (!(erro instanceof ErroBanco)) return erro;

  const codigo = String(erro.detalhes?.message || erro.message || '').trim();
  const explicacao = erro.detalhes?.hint || '';

  if (ERROS_ESTOQUE[codigo]) {
    const [status, campo] = ERROS_ESTOQUE[codigo];
    return new ErroAdmin(explicacao || 'Não foi possível ajustar.', status, campo);
  }

  console.error('[admin] Erro de estoque não mapeado:', codigo, erro.detalhes);

  return new ErroAdmin('Não conseguimos ajustar o estoque agora.', 503);
}

/**
 * Registra um movimento de estoque.
 *
 * A mudança do saldo e o registro no histórico acontecem juntos, dentro da
 * função `ajustar_estoque` do banco — ver database/14-painel-admin.sql.
 *
 * @param {string} produtoId
 * @param {{tipo: string, quantidade: number, motivo?: string}} movimento
 * @param {string|null} usuarioId - quem está mexendo, para o histórico
 */
export async function ajustarEstoque(produtoId, movimento = {}, usuarioId = null) {
  if (!/^[0-9a-f-]{36}$/i.test(String(produtoId || ''))) {
    throw new ErroAdmin('Produto inválido.', 400);
  }

  if (!TIPOS_MOVIMENTO[movimento.tipo]) {
    throw new ErroAdmin('Escolha o tipo de movimento.', 422, 'tipo');
  }

  const quantidade = Number(movimento.quantidade);

  if (!Number.isInteger(quantidade) || quantidade < 0) {
    throw new ErroAdmin('Informe uma quantidade inteira.', 422, 'quantidade');
  }

  if (quantidade > 100_000) {
    throw new ErroAdmin('Quantidade acima do que faz sentido.', 422, 'quantidade');
  }

  try {
    const resultado = await chamarFuncao('ajustar_estoque', {
      p_produto_id: produtoId,
      p_tipo: movimento.tipo,
      p_quantidade: quantidade,
      p_motivo: String(movimento.motivo || '').trim().slice(0, 300) || null,
      p_usuario_id: usuarioId,
    });

    return {
      produto: resultado.produto,
      saldoAntes: resultado.saldo_antes,
      saldoApos: resultado.saldo_apos,
      movimento: resultado.movimento,
    };
  } catch (erro) {
    throw traduzirErroEstoque(erro);
  }
}

/**
 * Ajusta os parâmetros da ficha de estoque.
 *
 * Não é movimento: mudar o alerta mínimo ou marcar "sob encomenda" não altera
 * saldo nenhum, então não entra no histórico.
 */
export async function configurarEstoque(produtoId, config = {}) {
  const mudancas = {};

  if (config.alertaMinimo !== undefined) {
    const minimo = Number(config.alertaMinimo);

    if (!Number.isInteger(minimo) || minimo < 0 || minimo > 10_000) {
      throw new ErroAdmin('O alerta mínimo precisa ser um número de 0 a 10.000.', 422, 'alertaMinimo');
    }

    mudancas.alerta_minimo = minimo;
  }

  if (config.sobEncomenda !== undefined) {
    mudancas.sob_encomenda = Boolean(config.sobEncomenda);
  }

  if (Object.keys(mudancas).length === 0) {
    throw new ErroAdmin('Nada para alterar.', 422);
  }

  const ficha = await selecionarUm('inventory', {
    colunas: 'produto_id',
    filtros: { produto_id: `eq.${produtoId}` },
  });

  if (!ficha) throw new ErroAdmin('Produto não encontrado.', 404);

  const [atualizada] = await atualizar(
    'inventory',
    { produto_id: `eq.${produtoId}` },
    mudancas
  );

  return {
    produtoId,
    alertaMinimo: atualizada.alerta_minimo,
    sobEncomenda: atualizada.sob_encomenda,
  };
}

/**
 * Histórico de movimentos de um produto.
 *
 * É o que responde "por que o saldo está nisso?" — a pergunta que o editor de
 * tabelas do Supabase não responde sem alguém montar a consulta na mão.
 */
export async function listarMovimentos(produtoId, limite = 30) {
  if (!/^[0-9a-f-]{36}$/i.test(String(produtoId || ''))) return [];

  const linhas = await selecionar('inventory_movements', {
    colunas: 'id,tipo,quantidade,saldo_apos,motivo,pedido_id,criado_em',
    filtros: { produto_id: `eq.${produtoId}` },
    ordenar: 'criado_em.desc',
    limite: Math.min(Math.max(1, Number(limite) || 30), 100),
  });

  return linhas.map((m) => ({
    id: m.id,
    tipo: m.tipo,
    tipoRotulo: TIPOS_MOVIMENTO[m.tipo] || rotuloMovimentoAutomatico(m.tipo),
    quantidade: m.quantidade,
    saldoApos: m.saldo_apos,
    motivo: m.motivo,
    pedidoId: m.pedido_id,
    criadoEm: m.criado_em,
  }));
}

/** Os movimentos que o sistema gera sozinho, ao criar ou cancelar pedido. */
function rotuloMovimentoAutomatico(tipo) {
  return { venda: 'Venda', cancelamento: 'Cancelamento' }[tipo] || tipo;
}

/* =============================================================================
 * CLIENTES
 * ========================================================================== */

/**
 * Lista os clientes cadastrados.
 *
 * Lê a visão `clientes_admin`, que junta o perfil, o e-mail (que mora em
 * `auth.users`) e o quanto a pessoa já comprou. A visão é fechada para anon e
 * authenticated — só a chave de serviço lê.
 *
 * @param {object} [opcoes]
 * @param {string} [opcoes.busca] - nome ou e-mail
 * @param {string} [opcoes.perfil] - cliente | revendedor | admin
 * @param {string} [opcoes.ordem] - recentes | compras | nome
 */
export async function listarClientes(opcoes = {}) {
  const { busca = '', perfil = '', ordem = 'recentes', limite = 100 } = opcoes;

  const filtros = {};

  if (['cliente', 'revendedor', 'admin'].includes(perfil)) {
    filtros.perfil = `eq.${perfil}`;
  }

  const termo = String(busca).trim().replace(/[*,()]/g, '');

  if (termo) {
    // Quem procura "ana" pode estar lembrando do nome ou do e-mail.
    filtros.or = `(nome.ilike.*${termo}*,email.ilike.*${termo}*)`;
  }

  const ORDENS = {
    recentes: 'criado_em.desc',
    compras: 'gasto_centavos.desc',
    nome: 'nome.asc',
  };

  const linhas = await selecionar('clientes_admin', {
    colunas:
      'id,nome,perfil,telefone,email,aceita_marketing,criado_em,ultimo_acesso,' +
      'pedidos,gasto_centavos,ultimo_pedido_em',
    filtros,
    ordenar: ORDENS[ordem] || ORDENS.recentes,
    limite: Math.min(Math.max(1, Number(limite) || 100), 200),
  });

  return linhas.map((c) => ({
    id: c.id,
    nome: c.nome,
    email: c.email,
    telefone: c.telefone,
    perfil: c.perfil,
    aceitaMarketing: c.aceita_marketing,
    criadoEm: c.criado_em,
    ultimoAcesso: c.ultimo_acesso,
    pedidos: c.pedidos,
    gasto: Number(c.gasto_centavos) || 0,
    ultimoPedidoEm: c.ultimo_pedido_em,
  }));
}

/* =============================================================================
 * SEPARAÇÃO DO DIA
 *
 * A pergunta desta tela é uma só: "o que precisa sair da cozinha neste dia?".
 *
 * ⚠️ A DATA QUE MANDA É A DESEJADA, NÃO A DO PEDIDO
 *   Um pedido feito hoje para entregar sexta não entra na produção de hoje.
 *   Por isso o filtro é `data_desejada`, e não `criado_em` — são perguntas
 *   diferentes, e usar a data errada faria a loja produzir no dia errado.
 *
 *   Pedido sem data desejada não some: vai para um grupo à parte, porque é
 *   justamente o que a loja precisa combinar com o cliente.
 * ========================================================================== */

/**
 * Status que entram na separação por padrão.
 *
 * Pagamento aprovado e em preparação são os pedidos que a loja deve a
 * alguém. Aguardando pagamento fica de fora: produzir antes de receber é
 * decisão da dona, não padrão do sistema.
 */
export const STATUS_A_PRODUZIR = ['pagamento_aprovado', 'em_preparacao'];

const STATUS_SEPARACAO = {
  'a-produzir': STATUS_A_PRODUZIR,
  'a-entregar': ['pronto_para_retirada', 'saiu_para_entrega'],
  abertos: [
    'aguardando_pagamento',
    'comprovante_enviado',
    'pagamento_aprovado',
    'em_preparacao',
    'pronto_para_retirada',
    'saiu_para_entrega',
  ],
  todos: null,
};

const COLUNAS_SEPARACAO =
  'codigo,cliente_nome,cliente_whatsapp,status,tipo_entrega,endereco_entrega,' +
  'data_desejada,observacoes,total_centavos,criado_em,' +
  'itens:order_items(produto_nome,produto_slug,quantidade)';

function formatarPedidoSeparacao(p) {
  return {
    codigo: p.codigo,
    cliente: p.cliente_nome,
    whatsapp: p.cliente_whatsapp,
    status: p.status,
    tipoEntrega: p.tipo_entrega,
    endereco: p.endereco_entrega,
    dataDesejada: p.data_desejada,
    observacoes: p.observacoes,
    total: p.total_centavos,
    criadoEm: p.criado_em,
    itens: (Array.isArray(p.itens) ? p.itens : []).map((i) => ({
      nome: i.produto_nome,
      slug: i.produto_slug,
      quantidade: i.quantidade,
    })),
  };
}

/**
 * Soma quantos de cada produto precisam ser feitos.
 *
 * É o número que a loja leva para a bancada: não interessa que o brownie
 * está em seis pedidos diferentes, interessa que são 18 brownies.
 */
function somarProducao(pedidos) {
  const porProduto = new Map();

  for (const pedido of pedidos) {
    for (const item of pedido.itens) {
      const atual = porProduto.get(item.nome) || { nome: item.nome, slug: item.slug, quantidade: 0 };
      atual.quantidade += item.quantidade;
      porProduto.set(item.nome, atual);
    }
  }

  // Maior quantidade primeiro: o que ocupa mais forno aparece no topo.
  return [...porProduto.values()].sort(
    (a, b) => b.quantidade - a.quantidade || a.nome.localeCompare(b.nome, 'pt-BR')
  );
}

/**
 * Pedidos de um dia, prontos para separar.
 *
 * @param {object} opcoes
 * @param {string} opcoes.data - 'AAAA-MM-DD'; vazio traz os sem data marcada
 * @param {string} [opcoes.filtro] - a-produzir | a-entregar | abertos | todos
 */
export async function obterSeparacao(opcoes = {}) {
  const { data = '', filtro = 'a-produzir' } = opcoes;

  const statusAceitos =
    filtro in STATUS_SEPARACAO ? STATUS_SEPARACAO[filtro] : STATUS_A_PRODUZIR;

  const filtros = {};

  if (statusAceitos) filtros.status = `in.(${statusAceitos.join(',')})`;

  // Data vazia significa "os que ainda não têm dia combinado" — uma consulta
  // legítima, não um filtro ausente.
  if (data) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      throw new ErroAdmin('Data inválida.', 422, 'data');
    }
    filtros.data_desejada = `eq.${data}`;
  } else {
    filtros.data_desejada = 'is.null';
  }

  const linhas = await selecionar('orders', {
    colunas: COLUNAS_SEPARACAO,
    filtros,
    ordenar: 'criado_em.asc',
    limite: 200,
  });

  const pedidos = linhas.map(formatarPedidoSeparacao);

  // Quantos pedidos ficaram sem dia combinado. Some da lista do dia, mas não
  // pode sumir da tela: é trabalho pendente de alguém.
  let semData = 0;

  if (data) {
    const soltos = await selecionar('orders', {
      colunas: 'codigo',
      filtros: {
        ...(statusAceitos ? { status: `in.(${statusAceitos.join(',')})` } : {}),
        data_desejada: 'is.null',
      },
      limite: 200,
    });

    semData = soltos.length;
  }

  return {
    data: data || null,
    filtro,
    producao: somarProducao(pedidos),
    entregas: pedidos.filter((p) => p.tipoEntrega === 'entrega'),
    retiradas: pedidos.filter((p) => p.tipoEntrega === 'retirada'),
    totais: {
      pedidos: pedidos.length,
      itens: pedidos.reduce(
        (soma, p) => soma + p.itens.reduce((s, i) => s + i.quantidade, 0),
        0
      ),
      valor: pedidos.reduce((soma, p) => soma + p.total, 0),
      semData,
    },
  };
}

export default {
  obterResumo,
  obterSeparacao,
  ajustarEstoque,
  configurarEstoque,
  listarMovimentos,
  listarClientes,
  PERIODOS,
  TIPOS_MOVIMENTO,
  STATUS_A_PRODUZIR,
  ErroAdmin,
};
