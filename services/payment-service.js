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
import { lerVariaveisDeAmbiente } from './env.js';

const env = lerVariaveisDeAmbiente();

const SUPABASE_URL = (env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || '';

const BUCKET = 'comprovantes';

/* =============================================================================
 * LIMITES E TIPOS ACEITOS
 * ========================================================================== */

/** 5 MB. Foto de comprovante de celular raramente passa de 2 MB. */
export const TAMANHO_MAXIMO_BYTES = 5 * 1024 * 1024;

/**
 * Tipos aceitos, com a assinatura binária de cada um.
 *
 * Validar pela assinatura, e não só pelo `Content-Type` informado, é o que
 * impede alguém de renomear um `.exe` para `.jpg` e enviar. O navegador
 * informa o tipo, mas quem controla o navegador é o cliente.
 */
const TIPOS_ACEITOS = {
  'image/jpeg': { extensao: 'jpg', assinatura: [0xff, 0xd8, 0xff] },
  'image/png': { extensao: 'png', assinatura: [0x89, 0x50, 0x4e, 0x47] },
  'image/webp': { extensao: 'webp', assinatura: [0x52, 0x49, 0x46, 0x46] },
  'application/pdf': { extensao: 'pdf', assinatura: [0x25, 0x50, 0x44, 0x46] },
};

export const TIPOS_PERMITIDOS = Object.keys(TIPOS_ACEITOS);

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
 * Confere se o conteúdo é mesmo do tipo declarado.
 *
 * @param {Buffer} conteudo
 * @param {string} tipoDeclarado
 * @returns {boolean}
 */
function assinaturaConfere(conteudo, tipoDeclarado) {
  const esperada = TIPOS_ACEITOS[tipoDeclarado]?.assinatura;
  if (!esperada) return false;

  if (conteudo.length < esperada.length) return false;

  return esperada.every((byte, i) => conteudo[i] === byte);
}

/**
 * Valida o arquivo recebido em base64.
 *
 * @param {string} base64
 * @param {string} tipo
 * @param {string} nomeOriginal
 * @returns {{conteudo: Buffer, extensao: string, nome: string}}
 */
export function validarArquivo(base64, tipo, nomeOriginal) {
  if (!base64 || typeof base64 !== 'string') {
    throw new ErroPagamento('Selecione o arquivo do comprovante.', 422, 'arquivo');
  }

  if (!TIPOS_PERMITIDOS.includes(tipo)) {
    throw new ErroPagamento(
      'Envie uma imagem (JPG, PNG ou WEBP) ou um PDF.',
      422,
      'arquivo'
    );
  }

  // Remove o prefixo "data:image/jpeg;base64," se o navegador o incluiu.
  const limpo = base64.replace(/^data:[^;]+;base64,/, '');

  let conteudo;
  try {
    conteudo = Buffer.from(limpo, 'base64');
  } catch {
    throw new ErroPagamento('Arquivo inválido.', 422, 'arquivo');
  }

  if (conteudo.length === 0) {
    throw new ErroPagamento('O arquivo está vazio.', 422, 'arquivo');
  }

  if (conteudo.length > TAMANHO_MAXIMO_BYTES) {
    const mb = (TAMANHO_MAXIMO_BYTES / 1024 / 1024).toFixed(0);
    throw new ErroPagamento(
      `O arquivo passa de ${mb} MB. Tente uma foto menor.`,
      413,
      'arquivo'
    );
  }

  // A checagem que importa: o conteúdo precisa ser mesmo do tipo declarado.
  if (!assinaturaConfere(conteudo, tipo)) {
    throw new ErroPagamento(
      'O arquivo não parece ser uma imagem ou PDF válido.',
      422,
      'arquivo'
    );
  }

  return {
    conteudo,
    extensao: TIPOS_ACEITOS[tipo].extensao,
    nome: limparNomeArquivo(nomeOriginal),
  };
}

/**
 * Limpa o nome do arquivo enviado.
 *
 * O nome é guardado apenas para a loja reconhecer o comprovante — o caminho
 * real no Storage é montado por nós, com o código do pedido e um carimbo de
 * tempo. Mesmo assim, o nome é limpo com rigor.
 *
 * POR QUE REMOVER OS PONTOS CONSECUTIVOS
 *   A primeira versão trocava barras por `_` mas preservava os pontos. Um
 *   nome como `../../../etc/passwd` virava `.._.._.._etc_passwd` — sem risco
 *   hoje, porque esse campo não entra em caminho nenhum. Mas basta alguém,
 *   um dia, usá-lo para montar um nome de download, e a sequência `..` volta
 *   a ter significado.
 *
 *   Limpar na origem custa duas linhas e elimina a classe inteira de problema.
 */
function limparNomeArquivo(nomeOriginal) {
  const limpo = String(nomeOriginal || 'comprovante')
    // Só letras, números, ponto, hífen e sublinhado sobrevivem.
    .replace(/[^\p{L}\p{N}._-]/gu, '_')
    // Pontos consecutivos viram um só: mata o "..".
    .replace(/\.{2,}/g, '.')
    // Ponto no começo esconderia o arquivo em sistemas Unix.
    .replace(/^\.+/, '')
    .slice(0, 120);

  // Se não sobrou nada reconhecível, usa um nome padrão.
  return limpo || 'comprovante';
}

/* =============================================================================
 * ENVIO AO STORAGE
 * ========================================================================== */

/**
 * Sobe o arquivo para o bucket privado.
 *
 * O caminho inclui o código do pedido e um carimbo de tempo — assim, reenviar
 * o comprovante não sobrescreve o anterior, e a loja consegue ver o histórico.
 *
 * @returns {Promise<string>} caminho do arquivo no bucket
 */
async function enviarParaStorage(codigo, conteudo, extensao, tipo) {
  const carimbo = new Date().toISOString().replace(/[:.]/g, '-');
  const caminho = `${codigo}/${carimbo}.${extensao}`;

  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), 30000);

  try {
    const resposta = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${caminho}`,
      {
        method: 'POST',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': tipo,
          // `upsert: false` garante erro em vez de sobrescrita silenciosa.
          'x-upsert': 'false',
        },
        body: conteudo,
        signal: controlador.signal,
      }
    );

    if (!resposta.ok) {
      const texto = await resposta.text().catch(() => '');
      console.error('[payment-service] Falha no Storage:', resposta.status, texto);

      throw new ErroPagamento(
        'Não conseguimos guardar o comprovante. Tente novamente.',
        503,
        'arquivo'
      );
    }

    return caminho;
  } catch (erro) {
    if (erro instanceof ErroPagamento) throw erro;

    if (erro.name === 'AbortError') {
      throw new ErroPagamento(
        'O envio demorou demais. Tente uma foto menor.',
        408,
        'arquivo'
      );
    }

    console.error('[payment-service] Erro ao enviar:', erro.message);
    throw new ErroPagamento('Falha ao enviar o comprovante.', 503, 'arquivo');
  } finally {
    clearTimeout(temporizador);
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

  const caminho = await enviarParaStorage(codigoLimpo, conteudo, extensao, arquivo.tipo);

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
