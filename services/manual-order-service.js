// services/manual-order-service.js
// -----------------------------------------------------------------------------
// Pedidos lançados pela loja, e o que fazer com um pedido que não vai mais
// acontecer.
//
// POR QUE ISTO EXISTE
//
//   A maior parte da venda da Doce Fefê.21 fecha no WhatsApp. Até a Fase 13,
//   esse pedido não existia para o sistema: não baixava estoque, não entrava
//   no faturamento e não aparecia na separação do dia. O painel mostrava uma
//   loja menor do que ela é.
//
// O QUE ESTE ARQUIVO NÃO FAZ
//
//   Não calcula preço, não confere estoque, não decide se o pedido cabe.
//   Tudo isso vive em `criar_pedido`, no banco — ver database/20-pedido-manual.sql.
//   Aqui só validamos o que é barato validar antes de ir ao banco, e
//   traduzimos o erro técnico em frase que a loja entende.
// -----------------------------------------------------------------------------

import { chamarFuncao, selecionarUm } from './database.js';

/** Erro de negócio, com status HTTP e campo culpado. */
export class ErroPedidoManual extends Error {
  constructor(mensagem, status = 400, campo = null) {
    super(mensagem);
    this.name = 'ErroPedidoManual';
    this.status = status;
    this.campo = campo;
  }
}

/** De onde a venda pode ter vindo quando é a loja que lança. */
export const ORIGENS = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  presencial: 'Presencial',
};

export const METODOS = {
  pix: 'Pix',
  dinheiro: 'Dinheiro',
  cartao_credito: 'Cartão de crédito',
  cartao_debito: 'Cartão de débito',
};

/**
 * Traduz o erro vindo do PostgREST.
 *
 * O banco levanta exceções com nome curto (`CARRINHO_VAZIO`) e um `hint` em
 * português. O hint é a mensagem boa — foi escrito pensando em quem lê. Só
 * caímos no texto genérico quando ele não veio.
 */
function traduzir(erro) {
  const codigo = String(erro.detalhes?.message || erro.message || '').trim();
  const explicacao = erro.detalhes?.hint || '';

  const MAPA = {
    NOME_INVALIDO: [422, 'clienteNome'],
    WHATSAPP_INVALIDO: [422, 'clienteWhatsapp'],
    CARRINHO_VAZIO: [422, 'itens'],
    ITENS_DEMAIS: [422, 'itens'],
    ENTREGA_INVALIDA: [422, 'tipoEntrega'],
    ENDERECO_OBRIGATORIO: [422, 'endereco'],
    DATA_PASSADA: [422, 'dataDesejada'],
    FRETE_INVALIDO: [422, 'frete'],
    ORIGEM_INVALIDA: [422, 'origem'],
    METODO_INVALIDO: [422, 'metodo'],
    PRODUTO_NAO_ENCONTRADO: [422, 'itens'],
    ESTOQUE_INSUFICIENTE: [409, 'itens'],
    PEDIDO_NAO_ENCONTRADO: [404, null],
    JA_CANCELADO: [409, null],
    PEDIDO_ENTREGUE: [409, null],
    PRECISA_CANCELAR_ANTES: [409, null],
  };

  for (const [chave, [status, campo]] of Object.entries(MAPA)) {
    if (codigo.includes(chave)) {
      return new ErroPedidoManual(explicacao || 'Não foi possível.', status, campo);
    }
  }

  console.error('[pedido-manual] Erro não mapeado:', codigo, erro.detalhes);
  return new ErroPedidoManual('Não conseguimos concluir agora.', 503);
}

/**
 * Normaliza e confere os itens antes de gastar uma ida ao banco.
 *
 * Repare que NÃO há preço aqui. O preço é buscado no banco, dentro de
 * `criar_pedido`. Se a loja pudesse digitar quanto custa, a promoção valeria
 * no site e outra coisa no WhatsApp — e nenhum relatório saberia qual está
 * certo.
 */
function prepararItens(itens) {
  if (!Array.isArray(itens) || itens.length === 0) {
    throw new ErroPedidoManual('Adicione ao menos um produto.', 422, 'itens');
  }

  return itens.map((item, indice) => {
    const produtoId = String(item?.produtoId || item?.produto_id || '');

    if (!/^[0-9a-f-]{36}$/i.test(produtoId)) {
      throw new ErroPedidoManual(
        `O produto da linha ${indice + 1} não foi reconhecido.`, 422, 'itens'
      );
    }

    const quantidade = Number(item?.quantidade);

    if (!Number.isInteger(quantidade) || quantidade < 1) {
      throw new ErroPedidoManual(
        `Informe a quantidade da linha ${indice + 1}.`, 422, 'itens'
      );
    }

    if (quantidade > 1000) {
      throw new ErroPedidoManual(
        'Quantidade acima do que faz sentido num pedido.', 422, 'itens'
      );
    }

    return { produto_id: produtoId, quantidade };
  });
}

/** Deixa só os dígitos: a loja digita "(11) 98765-4321" e o banco quer o cru. */
function soDigitos(valor) {
  return String(valor || '').replace(/\D/g, '');
}

/**
 * Lança um pedido fechado por fora do site.
 *
 * @param {object} dados
 * @param {string|null} usuarioId - a ADMINISTRADORA que está lançando.
 *   Vai para o histórico de estoque, não para o dono do pedido: a venda é da
 *   cliente, não de quem digitou.
 */
export async function criarPedidoManual(dados = {}, usuarioId = null) {
  const nome = String(dados.clienteNome || '').trim();

  if (nome.length < 2) {
    throw new ErroPedidoManual('Informe o nome da cliente.', 422, 'clienteNome');
  }

  const whatsapp = soDigitos(dados.clienteWhatsapp);

  if (!/^[0-9]{10,11}$/.test(whatsapp)) {
    throw new ErroPedidoManual(
      'Informe o WhatsApp com DDD.', 422, 'clienteWhatsapp'
    );
  }

  const origem = String(dados.origem || 'whatsapp');

  if (!ORIGENS[origem]) {
    throw new ErroPedidoManual('Escolha de onde veio o pedido.', 422, 'origem');
  }

  const metodo = String(dados.metodo || 'pix');

  if (!METODOS[metodo]) {
    throw new ErroPedidoManual('Escolha a forma de pagamento.', 422, 'metodo');
  }

  const itens = prepararItens(dados.itens);

  try {
    const pedido = await chamarFuncao('criar_pedido_manual', {
      p_cliente_nome: nome.slice(0, 120),
      p_cliente_whatsapp: whatsapp,
      p_itens: itens,
      p_origem: origem,
      p_ja_pago: dados.jaPago === true,
      p_metodo: metodo,
      p_cliente_email: String(dados.clienteEmail || '').trim() || null,
      p_tipo_entrega: dados.tipoEntrega === 'entrega' ? 'entrega' : 'retirada',
      p_endereco: dados.endereco || null,
      p_data_desejada: dados.dataDesejada || null,
      p_observacoes: String(dados.observacoes || '').trim().slice(0, 500) || null,
      p_frete_centavos: Number(dados.freteCentavos) || 0,
      p_usuario_id: usuarioId,
    });

    return {
      id: pedido.id,
      codigo: pedido.codigo,
      status: pedido.status,
      origem: pedido.origem,
      jaPago: pedido.ja_pago,
      total: pedido.total,
      itens: pedido.itens,
    };
  } catch (erro) {
    throw traduzir(erro);
  }
}

/**
 * Encontra o pedido pelo código curto que a loja enxerga na tela.
 *
 * As funções do banco trabalham com o id interno. Fazer a tela carregar um
 * uuid só para poder cancelar seria expor detalhe de banco sem necessidade.
 */
async function idDoCodigo(codigo) {
  const limpo = String(codigo || '').trim().toUpperCase();

  if (!/^DF[0-9A-Z]{8}$/.test(limpo)) {
    throw new ErroPedidoManual('Código de pedido inválido.', 400);
  }

  const pedido = await selecionarUm('orders', {
    filtros: { codigo: `eq.${limpo}` },
    campos: 'id,codigo,status',
  });

  if (!pedido) {
    throw new ErroPedidoManual('Pedido não encontrado.', 404);
  }

  return pedido.id;
}

/**
 * Cancela o pedido e devolve as unidades ao estoque.
 *
 * O pedido continua no histórico de propósito. Desistência é informação:
 * mostra qual produto some do carrinho e qual cliente desmarca.
 */
export async function cancelarPedido(codigo, motivo = null, usuarioId = null) {
  const pedidoId = await idDoCodigo(codigo);

  try {
    const resultado = await chamarFuncao('cancelar_pedido', {
      p_pedido_id: pedidoId,
      p_motivo: String(motivo || '').trim().slice(0, 300) || null,
      p_usuario_id: usuarioId,
    });

    return {
      codigo: resultado.codigo,
      status: resultado.status,
      statusAnterior: resultado.status_anterior,
      unidadesDevolvidas: resultado.unidades_devolvidas,
    };
  } catch (erro) {
    throw traduzir(erro);
  }
}

/**
 * Apaga o pedido em definitivo.
 *
 * Serve para limpar teste, não para o dia a dia. O banco recusa se o pedido
 * ainda não estiver cancelado — porque é o cancelamento que devolve o
 * estoque. Apagar direto deixaria um buraco invisível na prateleira.
 */
export async function excluirPedido(codigo) {
  const pedidoId = await idDoCodigo(codigo);

  try {
    const resultado = await chamarFuncao('excluir_pedido', {
      p_pedido_id: pedidoId,
    });

    return { apagado: true, codigo: resultado.codigo };
  } catch (erro) {
    throw traduzir(erro);
  }
}

export default {
  criarPedidoManual,
  cancelarPedido,
  excluirPedido,
  ORIGENS,
  METODOS,
  ErroPedidoManual,
};
