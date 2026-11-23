/**
 * backend/controllers/admin-controller.js
 * -----------------------------------------------------------------------------
 * Painel administrativo — escopo mínimo: pedidos e conferência de comprovantes.
 *
 * ⚠️ TODAS as rotas aqui exigem perfil de administrador, verificado no
 *   SERVIDOR por `exigirAdmin`. Esconder botões na interface não protege
 *   nada: qualquer pessoa pode chamar a API direto.
 *
 * O QUE ESTE ARQUIVO RESOLVE
 *   O cliente envia o comprovante do Pix e o pedido fica em
 *   `comprovante_enviado`. Alguém precisa abrir o arquivo, comparar com o
 *   extrato e decidir. É isso que acontece aqui.
 */

import { exigirAdmin } from '../../services/auth-service.js';
import { selecionar, selecionarUm, atualizar } from '../../services/database.js';
import { atualizarStatus, ROTULOS_STATUS, ErroPedido } from '../../services/order-service.js';
import { lerVariaveisDeAmbiente } from '../../services/env.js';

const env = lerVariaveisDeAmbiente();
const SUPABASE_URL = (env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || '';

/** Resposta padrão quando falta permissão. */
const negar = (auth) => ({
  status: auth.status,
  corpo: { erro: true, mensagem: auth.mensagem },
});

/* =============================================================================
 * LISTA DE PEDIDOS
 * ========================================================================== */

/**
 * GET /api/admin/pedidos
 *
 * Filtros: ?status=comprovante_enviado&limite=50
 */
export async function getPedidosAdmin({ req, query = {} } = {}) {
  const auth = await exigirAdmin(req);
  if (!auth.ok) return negar(auth);

  const limite = Math.min(Math.max(1, Number.parseInt(query.limite, 10) || 50), 200);

  const filtros = {};

  // Lista fechada: impede filtrar por um valor que não existe no enum.
  if (query.status && ROTULOS_STATUS[query.status]) {
    filtros.status = `eq.${query.status}`;
  }

  const pedidos = await selecionar('orders', {
    colunas:
      'id,codigo,cliente_nome,cliente_whatsapp,cliente_email,status,tipo_entrega,' +
      'endereco_entrega,data_desejada,observacoes,subtotal_centavos,' +
      'desconto_centavos,frete_centavos,total_centavos,criado_em',
    filtros,
    ordenar: 'criado_em.desc',
    limite,
  });

  if (pedidos.length === 0) {
    return { status: 200, corpo: { pedidos: [], resumo: await montarResumo() } };
  }

  // Busca itens e pagamentos de todos os pedidos de uma vez, em vez de uma
  // consulta por pedido.
  const ids = pedidos.map((p) => p.id);

  const [itens, pagamentos] = await Promise.all([
    selecionar('order_items', {
      colunas: 'pedido_id,produto_nome,quantidade,preco_unitario_centavos,subtotal_centavos',
      filtros: { pedido_id: `in.(${ids.join(',')})` },
      limite: 1000,
    }),
    selecionar('payments', {
      colunas:
        'pedido_id,metodo,status,comprovante_caminho,comprovante_nome_original,' +
        'comprovante_enviado_em,conferido_em,observacao_conferencia',
      filtros: { pedido_id: `in.(${ids.join(',')})` },
      limite: 500,
    }),
  ]);

  const itensPorPedido = itens.reduce((acc, i) => {
    (acc[i.pedido_id] ||= []).push({
      nome: i.produto_nome,
      quantidade: i.quantidade,
      precoUnitario: i.preco_unitario_centavos,
      subtotal: i.subtotal_centavos,
    });
    return acc;
  }, {});

  const pagamentoPorPedido = pagamentos.reduce((acc, p) => {
    acc[p.pedido_id] = p;
    return acc;
  }, {});

  return {
    status: 200,
    corpo: {
      pedidos: pedidos.map((p) => {
        const pagamento = pagamentoPorPedido[p.id];

        return {
          codigo: p.codigo,
          status: p.status,
          statusRotulo: ROTULOS_STATUS[p.status] || p.status,
          cliente: {
            nome: p.cliente_nome,
            whatsapp: p.cliente_whatsapp,
            email: p.cliente_email,
          },
          tipoEntrega: p.tipo_entrega,
          endereco: p.endereco_entrega,
          dataDesejada: p.data_desejada,
          observacoes: p.observacoes,
          subtotal: p.subtotal_centavos,
          desconto: p.desconto_centavos,
          frete: p.frete_centavos,
          total: p.total_centavos,
          criadoEm: p.criado_em,
          itens: itensPorPedido[p.id] || [],
          pagamento: pagamento
            ? {
                metodo: pagamento.metodo,
                status: pagamento.status,
                // `temComprovante` em vez do caminho: o arquivo é buscado por
                // uma rota própria, que gera um link temporário.
                temComprovante: Boolean(pagamento.comprovante_caminho),
                nomeArquivo: pagamento.comprovante_nome_original,
                enviadoEm: pagamento.comprovante_enviado_em,
                conferidoEm: pagamento.conferido_em,
                observacao: pagamento.observacao_conferencia,
              }
            : null,
        };
      }),
      resumo: await montarResumo(),
    },
  };
}

/** Contadores para o topo da tela. */
async function montarResumo() {
  try {
    const [aguardando, conferir, preparando] = await Promise.all([
      selecionar('orders', {
        colunas: 'id',
        filtros: { status: 'eq.aguardando_pagamento' },
        limite: 500,
      }),
      selecionar('orders', {
        colunas: 'id',
        filtros: { status: 'eq.comprovante_enviado' },
        limite: 500,
      }),
      selecionar('orders', {
        colunas: 'id',
        filtros: { status: 'eq.em_preparacao' },
        limite: 500,
      }),
    ]);

    return {
      aguardandoPagamento: aguardando.length,
      aguardandoConferencia: conferir.length,
      emPreparacao: preparando.length,
    };
  } catch {
    return null;
  }
}

/* =============================================================================
 * COMPROVANTE
 * ========================================================================== */

/**
 * GET /api/admin/pedidos/:codigo/comprovante
 *
 * Devolve um link TEMPORÁRIO para o arquivo.
 *
 * Por que link assinado em vez de repassar os bytes? O navegador consegue
 * exibir a imagem direto, sem o arquivo passar pela nossa memória. E o link
 * expira em 5 minutos — mesmo que vaze, não serve para muita coisa.
 */
export async function getComprovante({ req, params = {} } = {}) {
  const auth = await exigirAdmin(req);
  if (!auth.ok) return negar(auth);

  const codigo = String(params.codigo || '').trim().toUpperCase();

  if (!/^DF[0-9A-Z]{8}$/.test(codigo)) {
    return { status: 400, corpo: { erro: true, mensagem: 'Código inválido.' } };
  }

  const pedido = await selecionarUm('orders', {
    colunas: 'id',
    filtros: { codigo: `eq.${codigo}` },
  });

  if (!pedido) {
    return { status: 404, corpo: { erro: true, mensagem: 'Pedido não encontrado.' } };
  }

  const pagamento = await selecionarUm('payments', {
    colunas: 'comprovante_caminho,comprovante_nome_original',
    filtros: { pedido_id: `eq.${pedido.id}` },
    ordenar: 'criado_em.desc',
  });

  if (!pagamento?.comprovante_caminho) {
    return {
      status: 404,
      corpo: { erro: true, mensagem: 'Este pedido não tem comprovante enviado.' },
    };
  }

  try {
    const resposta = await fetch(
      `${SUPABASE_URL}/storage/v1/object/sign/comprovantes/${pagamento.comprovante_caminho}`,
      {
        method: 'POST',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expiresIn: 300 }),
      }
    );

    if (!resposta.ok) {
      const texto = await resposta.text().catch(() => '');
      console.error('[admin] Falha ao assinar URL:', resposta.status, texto);

      return {
        status: 503,
        corpo: { erro: true, mensagem: 'Não conseguimos abrir o comprovante.' },
      };
    }

    const { signedURL } = await resposta.json();

    return {
      status: 200,
      corpo: {
        url: `${SUPABASE_URL}/storage/v1${signedURL}`,
        nomeArquivo: pagamento.comprovante_nome_original,
        expiraEmSegundos: 300,
      },
    };
  } catch (erro) {
    console.error('[admin] Erro ao gerar link:', erro.message);
    return {
      status: 503,
      corpo: { erro: true, mensagem: 'Não conseguimos abrir o comprovante.' },
    };
  }
}

/* =============================================================================
 * CONFERÊNCIA DO PAGAMENTO
 * ========================================================================== */

/**
 * POST /api/admin/pedidos/:codigo/conferir
 * Corpo: { aprovado: boolean, observacao?: string }
 *
 * ⚠️ É AQUI — e só aqui — que um pagamento vira aprovado.
 *   Nenhuma rota pública consegue chegar neste estado.
 */
export async function postConferirPagamento({ req, params = {}, corpo = {} } = {}) {
  const auth = await exigirAdmin(req);
  if (!auth.ok) return negar(auth);

  const codigo = String(params.codigo || '').trim().toUpperCase();

  if (!/^DF[0-9A-Z]{8}$/.test(codigo)) {
    return { status: 400, corpo: { erro: true, mensagem: 'Código inválido.' } };
  }

  if (typeof corpo.aprovado !== 'boolean') {
    return {
      status: 422,
      corpo: { erro: true, mensagem: 'Informe se o pagamento foi aprovado.' },
    };
  }

  const observacao = String(corpo.observacao || '').trim().slice(0, 500);

  // Recusar sem explicar deixa o cliente sem saber o que corrigir.
  if (!corpo.aprovado && observacao.length < 3) {
    return {
      status: 422,
      corpo: {
        erro: true,
        mensagem: 'Explique o motivo da recusa — o cliente precisa saber.',
        erros: { observacao: 'Informe o motivo.' },
      },
    };
  }

  const pedido = await selecionarUm('orders', {
    colunas: 'id,status',
    filtros: { codigo: `eq.${codigo}` },
  });

  if (!pedido) {
    return { status: 404, corpo: { erro: true, mensagem: 'Pedido não encontrado.' } };
  }

  try {
    const novoStatus = corpo.aprovado ? 'pagamento_aprovado' : 'aguardando_pagamento';

    await atualizarStatus(codigo, novoStatus, {
      motivo: corpo.aprovado ? null : observacao,
    });

    // Registra quem conferiu e quando. Aprovação some do "a conferir";
    // recusa volta o comprovante para pendente, para o cliente reenviar.
    await atualizar(
      'payments',
      { pedido_id: `eq.${pedido.id}` },
      corpo.aprovado
        ? {
            status: 'aprovado',
            conferido_em: new Date().toISOString(),
            conferido_por: auth.usuario.id,
            observacao_conferencia: observacao || null,
            pago_em: new Date().toISOString(),
          }
        : {
            status: 'pendente',
            conferido_em: null,
            conferido_por: auth.usuario.id,
            observacao_conferencia: observacao,
          }
    );

    return {
      status: 200,
      corpo: {
        sucesso: true,
        mensagem: corpo.aprovado
          ? 'Pagamento aprovado!'
          : 'Comprovante recusado. O cliente pode enviar outro.',
        status: novoStatus,
      },
    };
  } catch (erro) {
    if (erro instanceof ErroPedido) {
      return { status: erro.status, corpo: { erro: true, mensagem: erro.message } };
    }

    console.error('[admin] Falha ao conferir:', erro);
    return {
      status: 503,
      corpo: { erro: true, mensagem: 'Não conseguimos registrar a conferência.' },
    };
  }
}

/* =============================================================================
 * MUDANÇA DE STATUS
 * ========================================================================== */

/**
 * PATCH /api/admin/pedidos/:codigo/status
 * Corpo: { status: 'em_preparacao' | ... , motivo?: string }
 *
 * O fluxo permitido é definido em services/order-service.js. Pular etapas é
 * recusado ali, não aqui.
 */
export async function patchStatusPedido({ req, params = {}, corpo = {} } = {}) {
  const auth = await exigirAdmin(req);
  if (!auth.ok) return negar(auth);

  try {
    const resultado = await atualizarStatus(params.codigo, corpo.status, {
      motivo: corpo.motivo,
    });

    return {
      status: 200,
      corpo: {
        sucesso: true,
        mensagem: resultado.alterado
          ? `Status alterado para "${ROTULOS_STATUS[resultado.status]}".`
          : 'O pedido já estava nesse status.',
        ...resultado,
      },
    };
  } catch (erro) {
    if (erro instanceof ErroPedido) {
      return { status: erro.status, corpo: { erro: true, mensagem: erro.message } };
    }

    console.error('[admin] Falha ao mudar status:', erro);
    return {
      status: 503,
      corpo: { erro: true, mensagem: 'Não conseguimos alterar o status.' },
    };
  }
}

/* =============================================================================
 * VERIFICAÇÃO DE ACESSO
 * ========================================================================== */

/**
 * GET /api/admin/sessao
 * A tela de login usa para confirmar que o usuário é mesmo administrador.
 */
export async function getSessaoAdmin({ req } = {}) {
  const auth = await exigirAdmin(req);
  if (!auth.ok) return negar(auth);

  return {
    status: 200,
    corpo: {
      admin: { email: auth.usuario.email, perfil: auth.usuario.perfil },
    },
  };
}

export default {
  getPedidosAdmin,
  getComprovante,
  postConferirPagamento,
  patchStatusPedido,
  getSessaoAdmin,
};
