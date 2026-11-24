/**
 * backend/controllers/order-controller.js
 * -----------------------------------------------------------------------------
 * Criação e consulta de pedidos.
 *
 * ⚠️ O PAGAMENTO NUNCA É CONFIRMADO AQUI
 *   Todo pedido nasce com status 'aguardando_pagamento'. A mudança para
 *   'pagamento_aprovado' só acontece pelo webhook validado do Mercado Pago
 *   (Fase 8) ou por confirmação manual no painel administrativo.
 *
 *   Confirmar porque o cliente voltou a uma página de sucesso seria aceitar
 *   que qualquer pessoa marcasse o próprio pedido como pago só abrindo a URL.
 */

import {
  validarPedido,
  criarPedido,
  obterPedido,
  ErroPedido,
} from '../../services/order-service.js';
import { identificarUsuarioId } from '../../services/auth-service.js';

/* =============================================================================
 * FRETE
 * ========================================================================== */

/**
 * Calcula o frete.
 *
 * ⚠️ VALOR PROVISÓRIO — PRECISA SER DEFINIDO PELA CLIENTE
 *
 *   A Doce Fefê.21 ainda não informou área de cobertura nem tabela de frete
 *   (ver CONTEUDO-PENDENTE.md). Até lá, retiradas são gratuitas e entregas
 *   ficam com frete ZERO, a combinar no atendimento.
 *
 *   Essa escolha é deliberada: cobrar um valor inventado seria pior do que
 *   não cobrar. O cliente veria "Frete: R$ 15,00" e descobriria depois que
 *   era outro preço.
 *
 *   O cálculo fica no SERVIDOR desde já — quando a tabela existir, basta
 *   preencher esta função, sem mexer no frontend.
 */
function calcularFrete({ tipoEntrega }) {
  if (tipoEntrega === 'retirada') return 0;

  // TODO (quando a cliente informar): calcular por CEP ou bairro.
  return 0;
}

/** Indica ao cliente que o frete ainda será combinado. */
const FRETE_A_COMBINAR = true;

/* =============================================================================
 * CONTROLADORES
 * ========================================================================== */

/**
 * POST /api/pedidos
 * Cria um pedido.
 */
export async function postPedido({ req, corpo = {} } = {}) {
  /* ---------------------------------------------------------------------
   * PEDIDO EXIGE CONTA
   *
   * Era permitido comprar sem cadastro, para não perder venda. A loja
   * decidiu o contrário, e com razão: o pagamento é por Pix com
   * comprovante, e o acompanhamento acontece na área do cliente. Sem
   * conta, a pessoa pagaria e não teria onde ver o que aconteceu — e a
   * loja não teria a quem responder.
   *
   * A checagem vem ANTES da validação do formulário de propósito: não
   * adianta apontar erro de CEP a quem nem vai conseguir concluir.
   *
   * ⚠️ É ESTA linha que barra, não a tela. Esconder o botão no navegador
   *   não impede ninguém de chamar a API direto.
   * ------------------------------------------------------------------ */
  const usuarioId = await identificarUsuarioId(req);

  if (!usuarioId) {
    return {
      status: 401,
      corpo: {
        erro: true,
        mensagem:
          'Entre na sua conta para finalizar o pedido. É por ela que você ' +
          'acompanha o pagamento e o andamento da entrega.',
      },
    };
  }

  // --- Validação de formato ---
  const validacao = validarPedido(corpo);

  if (!validacao.ok) {
    return {
      status: 422,
      corpo: {
        erro: true,
        mensagem: 'Confira os campos destacados.',
        erros: validacao.erros,
      },
    };
  }

  const freteCentavos = calcularFrete(validacao.dados);

  try {
    const pedido = await criarPedido(validacao.dados, { usuarioId, freteCentavos });

    return {
      status: 201,
      corpo: {
        sucesso: true,
        mensagem: 'Pedido registrado!',
        pedido: {
          ...pedido,
          freteACombinar: FRETE_A_COMBINAR && validacao.dados.tipoEntrega === 'entrega',
        },
      },
    };
  } catch (erro) {
    if (erro instanceof ErroPedido) {
      const resposta = { erro: true, mensagem: erro.message };

      // Devolver o campo permite ao frontend destacar exatamente onde está
      // o problema, em vez de só mostrar um aviso genérico.
      if (erro.campo) resposta.erros = { [erro.campo]: erro.message };

      return { status: erro.status, corpo: resposta };
    }

    console.error('[pedidos] Falha inesperada:', erro);

    return {
      status: 503,
      corpo: {
        erro: true,
        mensagem:
          'Não conseguimos registrar seu pedido agora. ' +
          'Fale com a gente pelo WhatsApp para não perder sua encomenda.',
      },
    };
  }
}

/**
 * GET /api/pedidos/:codigo
 *
 * ⚠️ Só devolve o pedido ao DONO dele. Um visitante que adivinhe um código
 *   recebe 404, igual a um código inexistente — distinguir os dois casos
 *   permitiria descobrir quais códigos existem.
 */
export async function getPedido({ req, params = {} } = {}) {
  const usuarioId = await identificarUsuarioId(req);

  const pedido = await obterPedido(params.codigo, { usuarioId });

  if (!pedido) {
    return {
      status: 404,
      corpo: { erro: true, mensagem: 'Pedido não encontrado.' },
    };
  }

  return { status: 200, corpo: { pedido } };
}

export default { postPedido, getPedido };
