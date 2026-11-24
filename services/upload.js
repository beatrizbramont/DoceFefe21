/**
 * services/upload.js
 * -----------------------------------------------------------------------------
 * Recebimento de arquivos: validação e gravação no Supabase Storage.
 *
 * POR QUE ESTE MÓDULO EXISTE SEPARADO
 *   Dois lugares do sistema recebem arquivo de fora: o comprovante de Pix
 *   (cliente) e a foto do produto (painel). As regras que impedem um arquivo
 *   malicioso de entrar são as mesmas nos dois casos — e são exatamente o tipo
 *   de regra que não pode divergir entre cópias. Se um dia a checagem de
 *   assinatura binária for corrigida aqui, os dois caminhos são corrigidos
 *   juntos.
 *
 * ⚠️ A REGRA CENTRAL: NÃO ACREDITE NO QUE O NAVEGADOR DIZ
 *   O `Content-Type` e a extensão do arquivo são escolhidos por quem envia.
 *   O que prova o que um arquivo é de fato são os primeiros bytes dele.
 */

import { lerVariaveisDeAmbiente } from './env.js';

const env = lerVariaveisDeAmbiente();

const SUPABASE_URL = (env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || '';

/* =============================================================================
 * TIPOS CONHECIDOS
 *
 * A assinatura é a sequência de bytes que abre o arquivo. Renomear um `.exe`
 * para `.jpg` muda o nome, nunca esses bytes.
 * ========================================================================== */

export const TIPOS_CONHECIDOS = {
  'image/jpeg': { extensao: 'jpg', assinatura: [0xff, 0xd8, 0xff] },
  'image/png': { extensao: 'png', assinatura: [0x89, 0x50, 0x4e, 0x47] },
  'image/webp': { extensao: 'webp', assinatura: [0x52, 0x49, 0x46, 0x46] },
  'application/pdf': { extensao: 'pdf', assinatura: [0x25, 0x50, 0x44, 0x46] },
};

/** Imagens aceitas em qualquer lugar do sistema. */
export const TIPOS_IMAGEM = ['image/jpeg', 'image/png', 'image/webp'];

/** 5 MB. Foto de celular raramente passa de 2 MB. */
export const TAMANHO_MAXIMO_PADRAO = 5 * 1024 * 1024;

/** Erro de upload. Quem chama traduz para o erro do seu domínio. */
export class ErroUpload extends Error {
  constructor(mensagem, status = 422, campo = 'arquivo') {
    super(mensagem);
    this.name = 'ErroUpload';
    this.status = status;
    this.campo = campo;
  }
}

/* =============================================================================
 * VALIDAÇÃO
 * ========================================================================== */

function assinaturaConfere(conteudo, tipoDeclarado) {
  const esperada = TIPOS_CONHECIDOS[tipoDeclarado]?.assinatura;
  if (!esperada) return false;
  if (conteudo.length < esperada.length) return false;

  return esperada.every((byte, i) => conteudo[i] === byte);
}

/**
 * Limpa o nome do arquivo enviado.
 *
 * O nome é guardado apenas para a loja reconhecer o arquivo — o caminho real
 * no Storage é montado por nós. Mesmo assim é limpo com rigor.
 *
 * POR QUE REMOVER OS PONTOS CONSECUTIVOS
 *   Um nome como `../../../etc/passwd` vira `.._.._.._etc_passwd` se só as
 *   barras forem trocadas. Sem risco hoje, porque esse campo não entra em
 *   caminho nenhum. Mas basta alguém, um dia, usá-lo para montar um nome de
 *   download, e a sequência `..` volta a ter significado. Limpar na origem
 *   custa duas linhas e elimina a classe inteira de problema.
 */
export function limparNomeArquivo(nomeOriginal, padrao = 'arquivo') {
  const limpo = String(nomeOriginal || padrao)
    // Só letras, números, ponto, hífen e sublinhado sobrevivem.
    .replace(/[^\p{L}\p{N}._-]/gu, '_')
    // Pontos consecutivos viram um só: mata o "..".
    .replace(/\.{2,}/g, '.')
    // Ponto no começo esconderia o arquivo em sistemas Unix.
    .replace(/^\.+/, '')
    .slice(0, 120);

  return limpo || padrao;
}

/**
 * Valida um arquivo recebido em base64.
 *
 * @param {object} arquivo
 * @param {string} arquivo.base64
 * @param {string} arquivo.tipo - Content-Type informado pelo navegador
 * @param {string} [arquivo.nome]
 * @param {object} [opcoes]
 * @param {string[]} [opcoes.permitidos] - tipos aceitos nesta rota
 * @param {number} [opcoes.maximoBytes]
 * @param {string} [opcoes.mensagemTipo] - texto do erro de tipo recusado
 * @returns {{conteudo: Buffer, extensao: string, tipo: string, nome: string}}
 * @throws {ErroUpload}
 */
export function validarUpload(arquivo = {}, opcoes = {}) {
  const {
    permitidos = Object.keys(TIPOS_CONHECIDOS),
    maximoBytes = TAMANHO_MAXIMO_PADRAO,
    mensagemTipo = 'Formato de arquivo não aceito.',
    nomePadrao = 'arquivo',
  } = opcoes;

  const { base64, tipo, nome } = arquivo;

  if (!base64 || typeof base64 !== 'string') {
    throw new ErroUpload('Selecione o arquivo.');
  }

  if (!permitidos.includes(tipo)) {
    throw new ErroUpload(mensagemTipo);
  }

  // Remove o prefixo "data:image/jpeg;base64," se o navegador o incluiu.
  const limpo = base64.replace(/^data:[^;]+;base64,/, '');

  let conteudo;
  try {
    conteudo = Buffer.from(limpo, 'base64');
  } catch {
    throw new ErroUpload('Arquivo inválido.');
  }

  if (conteudo.length === 0) {
    throw new ErroUpload('O arquivo está vazio.');
  }

  if (conteudo.length > maximoBytes) {
    const mb = (maximoBytes / 1024 / 1024).toFixed(0);
    throw new ErroUpload(`O arquivo passa de ${mb} MB. Tente uma foto menor.`, 413);
  }

  // A checagem que importa: o conteúdo precisa ser mesmo do tipo declarado.
  if (!assinaturaConfere(conteudo, tipo)) {
    throw new ErroUpload('O arquivo não parece ser do formato que diz ser.');
  }

  return {
    conteudo,
    tipo,
    extensao: TIPOS_CONHECIDOS[tipo].extensao,
    nome: limparNomeArquivo(nome, nomePadrao),
  };
}

/* =============================================================================
 * GRAVAÇÃO NO STORAGE
 * ========================================================================== */

/**
 * Sobe o arquivo para um bucket do Supabase Storage.
 *
 * Usa a chave de serviço — é por isso que este módulo nunca pode ir para o
 * navegador.
 *
 * @param {string} bucket
 * @param {string} caminho - caminho dentro do bucket, montado por nós
 * @param {Buffer} conteudo
 * @param {string} tipo
 * @returns {Promise<string>} o caminho gravado
 */
export async function enviarParaStorage(bucket, caminho, conteudo, tipo) {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), 30000);

  try {
    const resposta = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${bucket}/${caminho}`,
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
      console.error(`[upload] Falha no bucket ${bucket}:`, resposta.status, texto);

      throw new ErroUpload('Não conseguimos guardar o arquivo. Tente de novo.', 503);
    }

    return caminho;
  } catch (erro) {
    if (erro instanceof ErroUpload) throw erro;

    if (erro.name === 'AbortError') {
      throw new ErroUpload('O envio demorou demais. Tente um arquivo menor.', 408);
    }

    console.error('[upload] Erro ao enviar:', erro.message);
    throw new ErroUpload('Falha ao enviar o arquivo.', 503);
  } finally {
    clearTimeout(temporizador);
  }
}

/**
 * Apaga um arquivo do Storage.
 *
 * Nunca lança: a falha ao apagar um arquivo órfão não pode derrubar a operação
 * que o usuário pediu. Fica registrada no log para ser limpa depois.
 */
export async function apagarDoStorage(bucket, caminho) {
  try {
    const resposta = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${bucket}/${caminho}`,
      {
        method: 'DELETE',
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      }
    );

    if (!resposta.ok) {
      console.error(`[upload] Arquivo órfão em ${bucket}/${caminho}`);
    }

    return resposta.ok;
  } catch (erro) {
    console.error('[upload] Falha ao apagar:', erro.message);
    return false;
  }
}

/** URL pública de um arquivo em bucket público. */
export function urlPublica(bucket, caminho) {
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${caminho}`;
}

export default {
  validarUpload,
  enviarParaStorage,
  apagarDoStorage,
  urlPublica,
  limparNomeArquivo,
  TIPOS_IMAGEM,
  TIPOS_CONHECIDOS,
  TAMANHO_MAXIMO_PADRAO,
  ErroUpload,
};
