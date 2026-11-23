/**
 * backend/controllers/cart-controller.js
 * -----------------------------------------------------------------------------
 * Controladores do carrinho.
 *
 * Seguem o mesmo contrato dos demais: recebem `{ query, params, corpo,
 * usuarioId }` e devolvem `{ status, corpo }`, sem conhecer o framework HTTP.
 */

import {
  validarCarrinhoCompleto,
  validarCupom,
  ITENS_MAXIMOS,
} from '../../services/cart-service.js';

/* =============================================================================
 * VALIDAÇÃO DA ENTRADA
 * ========================================================================== */

/**
 * Confere o formato do corpo enviado.
 *
 * Checagem só de FORMATO. O conteúdo (preço, disponibilidade) é verificado
 * contra o banco em services/cart-service.js.
 */
function validarCorpo(corpo) {
  if (!corpo || typeof corpo !== 'object') {
    return { ok: false, mensagem: 'Envie os itens do carrinho.' };
  }

  if (!Array.isArray(corpo.itens)) {
    return { ok: false, mensagem: 'O campo "itens" precisa ser uma lista.' };
  }

  if (corpo.itens.length > ITENS_MAXIMOS) {
    return {
      ok: false,
      mensagem: `O carrinho aceita no máximo ${ITENS_MAXIMOS} produtos diferentes.`,
    };
  }

  return { ok: true };
}

/* =============================================================================
 * CONTROLADORES
 * ========================================================================== */

/**
 * POST /api/carrinho/validar
 *
 * Recebe o carrinho do navegador e devolve a versão autoritativa, com os
 * preços e as quantidades conferidos no banco.
 *
 * O frontend deve SUBSTITUIR o carrinho local pelo que vier daqui.
 */
export async function postValidarCarrinho({ corpo = {}, usuarioId = null } = {}) {
  const formato = validarCorpo(corpo);

  if (!formato.ok) {
    return { status: 400, corpo: { erro: true, mensagem: formato.mensagem } };
  }

  const carrinho = await validarCarrinhoCompleto(corpo.itens, {
    cupom: typeof corpo.cupom === 'string' ? corpo.cupom : '',
    usuarioId,
  });

  return { status: 200, corpo: carrinho };
}

/**
 * POST /api/carrinho/cupom
 *
 * Valida um cupom para um subtotal informado.
 *
 * ⚠️ O subtotal enviado NÃO é usado para gravar nada — apenas para informar
 *   ao cliente se o cupom vale e quanto desconta. No momento de fechar o
 *   pedido (Fase 7), o subtotal é recalculado do zero a partir do banco.
 */
export async function postAplicarCupom({ corpo = {}, usuarioId = null } = {}) {
  if (!corpo || typeof corpo.codigo !== 'string') {
    return {
      status: 400,
      corpo: { erro: true, mensagem: 'Informe o código do cupom.' },
    };
  }

  // Se os itens vierem junto, recalculamos o subtotal pelo banco em vez de
  // confiar no número enviado — é a checagem mais correta disponível aqui.
  if (Array.isArray(corpo.itens) && corpo.itens.length > 0) {
    const carrinho = await validarCarrinhoCompleto(corpo.itens, {
      cupom: corpo.codigo,
      usuarioId,
    });

    const aviso = carrinho.avisos.find((a) => a.tipo === 'cupom_invalido');

    if (aviso) {
      return {
        status: 422,
        corpo: { erro: true, valido: false, mensagem: aviso.mensagem },
      };
    }

    return {
      status: 200,
      corpo: {
        valido: true,
        mensagem: 'Cupom aplicado!',
        cupom: carrinho.cupom,
        desconto: carrinho.desconto,
        subtotal: carrinho.subtotal,
        total: carrinho.total,
      },
    };
  }

  // Sem itens: valida o cupom contra o subtotal informado, só para dar
  // retorno rápido ao usuário.
  const subtotal = Number.parseInt(corpo.subtotal, 10) || 0;
  const resultado = await validarCupom(corpo.codigo, subtotal);

  return {
    status: resultado.valido ? 200 : 422,
    corpo: resultado.valido
      ? resultado
      : { erro: true, valido: false, mensagem: resultado.mensagem },
  };
}

export default { postValidarCarrinho, postAplicarCupom };
