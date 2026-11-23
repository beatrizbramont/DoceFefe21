/**
 * lib/api.js
 * -----------------------------------------------------------------------------
 * Cliente HTTP único para falar com o backend da Doce Fefê.21.
 *
 * Por que centralizar em vez de chamar `fetch` espalhado pelo código?
 *   - Tratamento de erro consistente (o usuário nunca vê "undefined").
 *   - Cabeçalho de autenticação aplicado em um lugar só.
 *   - Timeout: uma requisição travada não deixa a tela carregando para sempre.
 *   - Troca de endereço da API sem caçar chamadas pelo projeto inteiro.
 */

import { API } from '../config.js';

/** Erro de API com o código HTTP e os detalhes de validação preservados. */
export class ErroApi extends Error {
  constructor(mensagem, status, dados = {}) {
    super(mensagem);
    this.name = 'ErroApi';
    this.status = status;
    /** Erros por campo, quando o servidor os devolve: { email: 'inválido' } */
    this.erros = dados.erros || null;
    this.dados = dados;
  }

  /** true quando o problema é do usuário (dados inválidos, sem permissão). */
  get ehErroDoCliente() {
    return this.status >= 400 && this.status < 500;
  }
}

/** Token de sessão em memória. Definido por js/auth.js após o login. */
let tokenAcesso = null;

export function definirTokenAcesso(token) {
  tokenAcesso = token || null;
}

export function obterTokenAcesso() {
  return tokenAcesso;
}

/* -----------------------------------------------------------------------------
 * RENOVAÇÃO AUTOMÁTICA DO TOKEN
 *
 * Quando o servidor responde 401, pode ser só o token tendo vencido. Em vez
 * de jogar o usuário para a tela de login no meio de uma ação, tentamos
 * renovar e repetir a requisição uma única vez.
 *
 * O gancho existe para evitar dependência circular: api.js não pode importar
 * auth.js, porque auth.js já importa api.js. Então auth.js se REGISTRA aqui.
 * -------------------------------------------------------------------------- */

let renovarToken = null;

/**
 * Registra a função que sabe renovar a sessão.
 * @param {() => Promise<string|null>} fn
 */
export function definirRenovadorDeToken(fn) {
  renovarToken = typeof fn === 'function' ? fn : null;
}

/**
 * Executa uma requisição à API.
 *
 * @param {string} caminho - ex.: '/produtos'
 * @param {object} [opcoes]
 * @param {string} [opcoes.metodo]
 * @param {object} [opcoes.corpo] - serializado como JSON automaticamente
 * @param {object} [opcoes.query] - vira string de consulta
 * @param {number} [opcoes.timeout] - milissegundos (padrão 15s)
 * @returns {Promise<any>}
 * @throws {ErroApi}
 */
export async function requisitar(caminho, opcoes = {}) {
  const {
    metodo = 'GET',
    corpo = null,
    query = null,
    timeout = 15000,
    cabecalhos = {},
    // Interno: evita laço infinito de renovação. Não passar manualmente.
    _jaRenovou = false,
  } = opcoes;

  let url = `${API.base}${caminho}`;

  if (query) {
    // Remove chaves vazias para não poluir a URL com "?categoria=&busca="
    const params = new URLSearchParams();
    for (const [chave, valor] of Object.entries(query)) {
      if (valor !== null && valor !== undefined && valor !== '') {
        params.set(chave, valor);
      }
    }
    const texto = params.toString();
    if (texto) url += `?${texto}`;
  }

  // AbortController cancela a requisição se o servidor não responder a tempo.
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), timeout);

  try {
    const resposta = await fetch(url, {
      method: metodo,
      headers: {
        Accept: 'application/json',
        ...(corpo ? { 'Content-Type': 'application/json' } : {}),
        ...(tokenAcesso ? { Authorization: `Bearer ${tokenAcesso}` } : {}),
        ...cabecalhos,
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: controlador.signal,
      // Envia cookies de sessão para o backend quando houver.
      credentials: 'include',
    });

    // 204 = sucesso sem conteúdo (ex.: exclusão).
    if (resposta.status === 204) return null;

    const tipoConteudo = resposta.headers.get('content-type') || '';
    const dados = tipoConteudo.includes('application/json')
      ? await resposta.json().catch(() => ({}))
      : await resposta.text();

    // 401 pode ser apenas token vencido. Tenta renovar e repetir UMA vez.
    if (resposta.status === 401 && !_jaRenovou && renovarToken) {
      clearTimeout(temporizador);

      const novoToken = await renovarToken();

      if (novoToken) {
        return requisitar(caminho, { ...opcoes, _jaRenovou: true });
      }
      // Sem token novo, segue para o tratamento de erro abaixo.
    }

    if (!resposta.ok) {
      const mensagem =
        (dados && dados.mensagem) ||
        (dados && dados.message) ||
        mensagemPadraoPorStatus(resposta.status);
      throw new ErroApi(mensagem, resposta.status, dados);
    }

    return dados;
  } catch (erro) {
    if (erro instanceof ErroApi) throw erro;

    if (erro.name === 'AbortError') {
      throw new ErroApi(
        'A conexão demorou demais para responder. Tente novamente.',
        408
      );
    }

    // TypeError no fetch = rede indisponível / servidor fora do ar.
    throw new ErroApi(
      'Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.',
      0
    );
  } finally {
    clearTimeout(temporizador);
  }
}

/** Mensagens amigáveis — o usuário não deve ler jargão técnico. */
function mensagemPadraoPorStatus(status) {
  const mapa = {
    400: 'Alguns dados enviados são inválidos. Confira e tente novamente.',
    401: 'Você precisa entrar na sua conta para continuar.',
    403: 'Você não tem permissão para realizar esta ação.',
    404: 'Não encontramos o que você procura.',
    409: 'Esta operação conflita com o estado atual. Atualize a página.',
    422: 'Alguns dados enviados são inválidos. Confira e tente novamente.',
    429: 'Muitas tentativas em pouco tempo. Aguarde um instante.',
    500: 'Tivemos um problema no servidor. Já estamos verificando.',
    503: 'O serviço está temporariamente indisponível. Tente em instantes.',
  };
  return mapa[status] || 'Ocorreu um erro inesperado. Tente novamente.';
}

/* -----------------------------------------------------------------------------
 * Atalhos por verbo HTTP
 * -------------------------------------------------------------------------- */
export const api = {
  get: (caminho, query, opcoes) => requisitar(caminho, { ...opcoes, query }),
  post: (caminho, corpo, opcoes) =>
    requisitar(caminho, { ...opcoes, metodo: 'POST', corpo }),
  put: (caminho, corpo, opcoes) =>
    requisitar(caminho, { ...opcoes, metodo: 'PUT', corpo }),
  patch: (caminho, corpo, opcoes) =>
    requisitar(caminho, { ...opcoes, metodo: 'PATCH', corpo }),
  delete: (caminho, opcoes) => requisitar(caminho, { ...opcoes, metodo: 'DELETE' }),
};

export default api;
