/**
 * backend/controllers/payment-controller.js
 * -----------------------------------------------------------------------------
 * Pagamento: forma escolhida e envio do comprovante.
 *
 * ⚠️ NENHUMA ROTA AQUI APROVA PAGAMENTO
 *   O máximo que acontece é o pedido ir para `comprovante_enviado`, que
 *   significa "o cliente afirma que pagou". A aprovação é feita pela loja,
 *   no painel administrativo, depois de conferir o extrato.
 */

import {
  registrarFormaPagamento,
  registrarComprovante,
  obterSituacaoPagamento,
  ErroPagamento,
  TAMANHO_MAXIMO_BYTES,
  TIPOS_PERMITIDOS,
} from '../../services/payment-service.js';
import { obterPedido } from '../../services/order-service.js';
import { identificarUsuarioId } from '../../services/auth-service.js';

/* =============================================================================
 * CONTROLE DE ACESSO
 *
 * Quem pode mexer no pagamento de um pedido?
 *
 *   • o dono do pedido (usuario_id bate com a sessão)
 *   • quem fez o pedido SEM login (usuario_id nulo) — aqui o código do pedido
 *     é a credencial, igual a um número de protocolo
 *
 * Pedir login para pagar excluiria quem comprou como visitante — e a loja
 * aceita pedido sem cadastro de propósito.
 *
 * O código tem 32^8 combinações (~1 trilhão) e a rota tem limitador de
 * requisições, então adivinhar um é inviável na prática.
 * ========================================================================== */

async function podeMexerNoPedido(req, codigo) {
  const usuarioId = await identificarUsuarioId(req);

  // `obterPedido` já devolve null quando o pedido pertence a outra pessoa.
  const pedido = await obterPedido(codigo, { usuarioId });

  return pedido;
}

/* =============================================================================
 * CONTROLADORES
 * ========================================================================== */

/**
 * POST /api/pedidos/:codigo/pagamento
 * Registra a forma de pagamento escolhida.
 */
export async function postFormaPagamento({ req, params = {}, corpo = {} } = {}) {
  const pedido = await podeMexerNoPedido(req, params.codigo);

  if (!pedido) {
    return { status: 404, corpo: { erro: true, mensagem: 'Pedido não encontrado.' } };
  }

  try {
    const resultado = await registrarFormaPagamento(params.codigo, corpo.metodo);

    return {
      status: 200,
      corpo: {
        sucesso: true,
        mensagem:
          corpo.metodo === 'pix'
            ? 'Agora é só pagar e enviar o comprovante.'
            : 'Combine o pagamento pelo WhatsApp.',
        pagamento: resultado,
      },
    };
  } catch (erro) {
    if (erro instanceof ErroPagamento) {
      const resposta = { erro: true, mensagem: erro.message };
      if (erro.campo) resposta.erros = { [erro.campo]: erro.message };
      return { status: erro.status, corpo: resposta };
    }

    console.error('[pagamento] Falha inesperada:', erro);
    return {
      status: 503,
      corpo: { erro: true, mensagem: 'Não conseguimos registrar agora.' },
    };
  }
}

/**
 * POST /api/pedidos/:codigo/comprovante
 *
 * Recebe o arquivo em base64 no corpo JSON.
 *
 * Por que base64 e não multipart? Comprovantes são pequenos (até 5 MB) e
 * base64 dispensa a análise de multipart no servidor — menos código para
 * manter e menos superfície para erro. O custo é ~33% a mais de tráfego,
 * irrelevante nesse tamanho.
 */
export async function postComprovante({ req, params = {}, corpo = {} } = {}) {
  const pedido = await podeMexerNoPedido(req, params.codigo);

  if (!pedido) {
    return { status: 404, corpo: { erro: true, mensagem: 'Pedido não encontrado.' } };
  }

  try {
    const resultado = await registrarComprovante(params.codigo, {
      base64: corpo.arquivo,
      tipo: corpo.tipo,
      nome: corpo.nome,
    });

    return {
      status: 201,
      corpo: {
        sucesso: true,
        mensagem:
          'Comprovante recebido! Vamos conferir e confirmar seu pedido em breve.',
        pagamento: resultado,
      },
    };
  } catch (erro) {
    if (erro instanceof ErroPagamento) {
      const resposta = { erro: true, mensagem: erro.message };
      if (erro.campo) resposta.erros = { [erro.campo]: erro.message };
      return { status: erro.status, corpo: resposta };
    }

    console.error('[comprovante] Falha inesperada:', erro);
    return {
      status: 503,
      corpo: {
        erro: true,
        mensagem:
          'Não conseguimos receber o comprovante. ' +
          'Envie pelo WhatsApp para não atrasar seu pedido.',
      },
    };
  }
}

/**
 * GET /api/pedidos/:codigo/pagamento
 * Situação do pagamento, para a tela acompanhar.
 */
export async function getSituacaoPagamento({ req, params = {} } = {}) {
  const pedido = await podeMexerNoPedido(req, params.codigo);

  if (!pedido) {
    return { status: 404, corpo: { erro: true, mensagem: 'Pedido não encontrado.' } };
  }

  const situacao = await obterSituacaoPagamento(params.codigo);

  if (!situacao) {
    return { status: 404, corpo: { erro: true, mensagem: 'Pedido não encontrado.' } };
  }

  return {
    status: 200,
    corpo: {
      pagamento: situacao,
      limites: {
        tamanhoMaximoBytes: TAMANHO_MAXIMO_BYTES,
        tiposPermitidos: TIPOS_PERMITIDOS,
      },
    },
  };
}

export default { postFormaPagamento, postComprovante, getSituacaoPagamento };
