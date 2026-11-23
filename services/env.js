/**
 * services/env.js
 * -----------------------------------------------------------------------------
 * Leitura do arquivo .env sem depender do pacote `dotenv`.
 *
 * O Node 20.6+ tem a flag `--env-file`, mas ela exige lembrar de passá-la em
 * todo comando. Esta função lê o arquivo diretamente, funciona em qualquer
 * forma de execução e não acrescenta dependências.
 *
 * ⚠️ Somente para o backend. O navegador nunca executa este arquivo.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

let cache = null;

/**
 * Converte o conteúdo de um .env em objeto.
 * Aceita comentários (#), aspas e valores com sinal de igual.
 */
function interpretar(texto) {
  const resultado = {};

  for (const linhaBruta of texto.split(/\r?\n/)) {
    const linha = linhaBruta.trim();

    // Ignora linhas vazias e comentários.
    if (!linha || linha.startsWith('#')) continue;

    const separador = linha.indexOf('=');
    if (separador === -1) continue;

    const chave = linha.slice(0, separador).trim();
    let valor = linha.slice(separador + 1).trim();

    // Remove aspas externas, se houver.
    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1);
    }

    if (chave) resultado[chave] = valor;
  }

  return resultado;
}

/**
 * Lê as variáveis de ambiente.
 *
 * Precedência: variáveis reais do sistema vencem o arquivo .env — assim, em
 * produção (Vercel, Railway, etc.) as configurações da plataforma prevalecem
 * sem precisar remover o arquivo.
 *
 * @returns {Record<string,string>}
 */
export function lerVariaveisDeAmbiente() {
  if (cache) return cache;

  const caminho = join(RAIZ, '.env');
  const doArquivo = existsSync(caminho)
    ? interpretar(readFileSync(caminho, 'utf8'))
    : {};

  cache = { ...doArquivo, ...process.env };

  // Disponibiliza também em process.env, para código que espere encontrá-las lá.
  for (const [chave, valor] of Object.entries(doArquivo)) {
    if (process.env[chave] === undefined) process.env[chave] = valor;
  }

  return cache;
}

/**
 * Lê uma variável, falhando cedo se for obrigatória e estiver ausente.
 * Erro na inicialização é muito melhor que erro no meio de um pedido.
 */
export function exigir(chave, { obrigatoria = true, padrao = '' } = {}) {
  const env = lerVariaveisDeAmbiente();
  const valor = env[chave];

  if (!valor) {
    if (obrigatoria) {
      throw new Error(
        `Variável de ambiente obrigatória ausente: ${chave}. ` +
          'Confira o arquivo .env (use .env.example como modelo).'
      );
    }
    return padrao;
  }

  return valor;
}

export default lerVariaveisDeAmbiente;
