/**
 * lib/status-pedido.js
 * -----------------------------------------------------------------------------
 * Nomes e aparência dos status de pedido, para o frontend.
 *
 * Os valores precisam bater exatamente com o tipo `status_pedido` do banco
 * (ver database/01-schema.sql) e com ROTULOS_STATUS em
 * services/order-service.js. Centralizar aqui evita que a mesma tradução
 * apareça escrita de três formas diferentes em telas diferentes.
 */

/** Rótulo de cada status, como o cliente lê na tela. */
export const ROTULOS_ETAPAS = {
  aguardando_pagamento: 'Aguardando pagamento',
  comprovante_enviado: 'Comprovante em análise',
  pagamento_aprovado: 'Pagamento aprovado',
  em_preparacao: 'Em preparação',
  pronto_para_retirada: 'Pronto para retirada',
  saiu_para_entrega: 'Saiu para entrega',
  entregue: 'Entregue',
  cancelado: 'Cancelado',
};

/** Classe do selo, para a cor combinar com o significado. */
export const CLASSES_STATUS = {
  aguardando_pagamento: 'selo--aviso',
  comprovante_enviado: 'selo--novo',
  pagamento_aprovado: 'selo--sucesso',
  em_preparacao: 'selo--novo',
  pronto_para_retirada: 'selo--sucesso',
  saiu_para_entrega: 'selo--novo',
  entregue: 'selo--sucesso',
  cancelado: 'selo--erro',
};

/**
 * Descreve um status para exibição.
 * @param {string} status
 */
export function descreverStatus(status) {
  return {
    rotulo: ROTULOS_ETAPAS[status] || status,
    classe: CLASSES_STATUS[status] || 'selo--neutro',
  };
}

export default { ROTULOS_ETAPAS, CLASSES_STATUS, descreverStatus };
