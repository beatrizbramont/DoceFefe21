/**
 * services/payment-service.js
 * -----------------------------------------------------------------------------
 * Pagamento: escolha da forma e envio do comprovante.
 *
 * COMO A DOCE FEFÊ.21 RECEBE
 *
 *   • Dinheiro → combinado pelo WhatsApp, pago na entrega ou retirada
 *   • Pix      → cliente paga pelo QR Code e envia o comprovante
 *
 * ⚠️ ENVIAR COMPROVANTE **NÃO** É PAGAR
 *
 *   O comprovante é um arquivo que o cliente escolhe do próprio celular.
 *   Nada impede que alguém envie uma foto qualquer, ou o comprovante de outra
 *   compra. Por isso o fluxo tem dois passos separados:
 *
 *       comprovante_enviado  → "o cliente afirma que pagou"
 *       pagamento_aprovado   → "a loja conferiu no extrato"
 *
 *   É o mesmo princípio do webhook de um intermediador de pagamento: a
 *   confirmação precisa vir de uma fonte que o cliente não controla. Aqui
 *   essa fonte é a pessoa que olha a conta bancária.
 *
 * ⚠️ O ARQUIVO VAI PARA UM BUCKET PRIVADO
 *
 *   Um comprovante de Pix traz nome, banco, valor e horário — dado pessoal.
 *   O bucket `comprovantes` não tem política de acesso, o que faz o RLS do
 *   Storage negar tudo para as chaves pública e autenticada. Só o backend
 *   consegue gravar e ler.
 */

import { chamarFuncao, selecionarUm, ErroBanco } from './database.js';
import {
  validarUpload,
  enviarParaStorage,
  TIPOS_IMAGEM,
  TAMANHO_MAXIMO_PADRAO,
  ErroUpload,
} from './upload.js';

const BUCKET = 'comprovantes';

/* =============================================================================
 * LIMITES E TIPOS ACEITOS
 *
 * A validação em si (tamanho, assinatura binária, limpeza do nome) mora em
 * services/upload.js, compartilhada com o envio de fotos do painel. Aqui fica
 * apenas o que é específico do comprovante.
 * ========================================================================== */

/** 5 MB. Foto de comprovante de celular raramente passa de 2 MB. */
export const TAMANHO_MAXIMO_BYTES = TAMANHO_MAXIMO_PADRAO;

/** Imagem ou PDF — o banco do cliente pode entregar qualquer um dos dois. */
export const TIPOS_PERMITIDOS = [...TIPOS_IMAGEM, 'application/pdf'];

/** Erro de pagamento com status HTTP e campo associado. */
export class ErroPagamento extends Error {
  constructor(mensagem, status = 400, campo = null) {
    super(mensagem);
    this.name = 'ErroPagamento';
    this.status = status;
    this.campo = campo;
  }
}

/* =============================================================================
 * TRADUÇÃO DOS ERROS DO BANCO
 * ========================================================================== */

const ERROS = {
  METODO_INVALIDO: 422,
  PEDIDO_NAO_ENCONTRADO: 404,
  PEDIDO_NAO_ACEITA_PAGAMENTO: 409,
  PEDIDO_NAO_ACEITA_COMPROVANTE: 409,
  CAMINHO_INVALIDO: 400,
};

function traduzirErro(erro) {
  const detalhes = erro.detalhes || {};
  const codigo = String(detalhes.message || erro.message || '').trim();
  const explicacao = detalhes.hint || '';

  if (ERROS[codigo]) {
    return new ErroPagamento(
      explicacao || 'Não foi possível processar o pagamento.',
      ERROS[codigo]
    );
  }

  console.error('[payment-service] Erro não mapeado:', codigo, detalhes);

  return new ErroPagamento(
    'Não conseguimos registrar agora. Tente novamente em instantes.',
    503
  );
}

/* =============================================================================
 * FORMA DE PAGAMENTO
 * ========================================================================== */

/**
 * Registra a forma escolhida pelo cliente.
 *
 * @param {string} codigo - código do pedido
 * @param {'pix'|'dinheiro'} metodo
 */
export async function registrarFormaPagamento(codigo, metodo) {
  if (!['pix', 'dinheiro'].includes(metodo)) {
    throw new ErroPagamento('Escolha entre Pix e dinheiro.', 422, 'metodo');
  }

  if (!/^DF[0-9A-Z]{8}$/.test(String(codigo || '').trim().toUpperCase())) {
    throw new ErroPagamento('Código de pedido inválido.', 400, 'codigo');
  }

  try {
    return await chamarFuncao('registrar_forma_pagamento', {
      p_codigo: codigo,
      p_metodo: metodo,
    });
  } catch (erro) {
    if (erro instanceof ErroBanco) throw traduzirErro(erro);
    throw erro;
  }
}

/* =============================================================================
 * VALIDAÇÃO DO ARQUIVO
 * ========================================================================== */

/**
 * Valida o comprovante recebido em base64.
 *
 * Delega a services/upload.js e traduz o erro para o vocabulário do
 * pagamento — quem chama esta função trata `ErroPagamento`, não `ErroUpload`.
 *
 * @param {string} base64
 * @param {string} tipo
 * @param {string} nomeOriginal
 * @returns {{conteudo: Buffer, extensao: string, nome: string}}
 */
export function validarArquivo(base64, tipo, nomeOriginal) {
  try {
    return validarUpload(
      { base64, tipo, nome: nomeOriginal },
      {
        permitidos: TIPOS_PERMITIDOS,
        maximoBytes: TAMANHO_MAXIMO_BYTES,
        mensagemTipo: 'Envie uma imagem (JPG, PNG ou WEBP) ou um PDF.',
        nomePadrao: 'comprovante',
      }
    );
  } catch (erro) {
    if (erro instanceof ErroUpload) {
      throw new ErroPagamento(erro.message, erro.status, 'arquivo');
    }
    throw erro;
  }
}

/* =============================================================================
 * ENVIO AO STORAGE
 * ========================================================================== */

/**
 * Sobe o comprovante para o bucket privado.
 *
 * O caminho inclui o código do pedido e um carimbo de tempo — assim, reenviar
 * o comprovante não sobrescreve o anterior, e a loja consegue ver o histórico.
 *
 * @returns {Promise<string>} caminho do arquivo no bucket
 */
async function guardarComprovante(codigo, conteudo, extensao, tipo) {
  const carimbo = new Date().toISOString().replace(/[:.]/g, '-');

  try {
    return await enviarParaStorage(
      BUCKET,
      `${codigo}/${carimbo}.${extensao}`,
      conteudo,
      tipo
    );
  } catch (erro) {
    if (erro instanceof ErroUpload) {
      throw new ErroPagamento(
        erro.status === 503
          ? 'Não conseguimos guardar o comprovante. Tente novamente.'
          : erro.message,
        erro.status,
        'arquivo'
      );
    }
    throw erro;
  }
}

/* =============================================================================
 * COMPROVANTE
 * ========================================================================== */

/**
 * Recebe o comprovante: valida, guarda e registra no pedido.
 *
 * @param {string} codigo
 * @param {{base64: string, tipo: string, nome: string}} arquivo
 */
export async function registrarComprovante(codigo, arquivo) {
  const codigoLimpo = String(codigo || '').trim().toUpperCase();

  if (!/^DF[0-9A-Z]{8}$/.test(codigoLimpo)) {
    throw new ErroPagamento('Código de pedido inválido.', 400, 'codigo');
  }

  // Confere que o pedido existe e ainda aceita comprovante ANTES de gastar
  // tempo subindo arquivo.
  const pedido = await selecionarUm('orders', {
    colunas: 'id,status',
    filtros: { codigo: `eq.${codigoLimpo}` },
  });

  if (!pedido) {
    throw new ErroPagamento('Pedido não encontrado.', 404, 'codigo');
  }

  if (!['aguardando_pagamento', 'comprovante_enviado'].includes(pedido.status)) {
    throw new ErroPagamento(
      'Este pedido não está mais aguardando pagamento.',
      409,
      'codigo'
    );
  }

  const { conteudo, extensao, nome } = validarArquivo(
    arquivo?.base64,
    arquivo?.tipo,
    arquivo?.nome
  );

  const caminho = await guardarComprovante(
    codigoLimpo,
    conteudo,
    extensao,
    arquivo.tipo
  );

  try {
    return await chamarFuncao('registrar_comprovante', {
      p_codigo: codigoLimpo,
      p_caminho: caminho,
      p_nome_original: nome,
      p_tamanho_bytes: conteudo.length,
    });
  } catch (erro) {
    if (erro instanceof ErroBanco) throw traduzirErro(erro);
    throw erro;
  }
}

/* =============================================================================
 * SITUAÇÃO DO PAGAMENTO
 * ========================================================================== */

/**
 * Consulta como está o pagamento de um pedido.
 *
 * ⚠️ Não devolve o caminho do comprovante: isso é uso interno da loja. O
 *   cliente só precisa saber SE enviou, não onde o arquivo está guardado.
 */
export async function obterSituacaoPagamento(codigo) {
  const codigoLimpo = String(codigo || '').trim().toUpperCase();

  if (!/^DF[0-9A-Z]{8}$/.test(codigoLimpo)) return null;

  const pedido = await selecionarUm('orders', {
    colunas: 'id,codigo,status,total_centavos',
    filtros: { codigo: `eq.${codigoLimpo}` },
  });

  if (!pedido) return null;

  const pagamento = await selecionarUm('payments', {
    colunas:
      'metodo,status,valor_centavos,comprovante_enviado_em,conferido_em,' +
      'observacao_conferencia',
    filtros: { pedido_id: `eq.${pedido.id}` },
    ordenar: 'criado_em.desc',
  });

  return {
    codigo: pedido.codigo,
    statusPedido: pedido.status,
    total: pedido.total_centavos,
    metodo: pagamento?.metodo || null,
    comprovanteEnviado: Boolean(pagamento?.comprovante_enviado_em),
    enviadoEm: pagamento?.comprovante_enviado_em || null,
    conferido: Boolean(pagamento?.conferido_em),
    observacao: pagamento?.observacao_conferencia || null,
  };
}

export default {
  registrarFormaPagamento,
  registrarComprovante,
  obterSituacaoPagamento,
  validarArquivo,
  TAMANHO_MAXIMO_BYTES,
  TIPOS_PERMITIDOS,
  ErroPagamento,
};
