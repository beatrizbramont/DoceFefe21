/**
 * services/auth-service.js
 * -----------------------------------------------------------------------------
 * Identificação e autorização de usuários no backend.
 *
 * ⚠️ POR QUE ESTE ARQUIVO É CRÍTICO
 *
 *   É aqui que o servidor decide QUEM está falando com ele. Toda regra de
 *   permissão do sistema — preço de atacado, acesso ao painel administrativo,
 *   ver os próprios pedidos — depende desta resposta estar correta.
 *
 *   Um erro aqui não causa tela quebrada: causa cliente comum vendo preço de
 *   revendedor, ou pior, acessando dados de outra pessoa.
 *
 * COMO A SESSÃO FUNCIONA
 *
 *   1. O navegador faz login pelo Supabase Auth e recebe um token (JWT).
 *   2. A cada chamada à API, envia esse token no cabeçalho:
 *          Authorization: Bearer eyJhbGci...
 *   3. Este módulo PERGUNTA AO SUPABASE se o token é válido e de quem é.
 *
 * POR QUE PERGUNTAR AO SUPABASE EM VEZ DE SÓ LER O TOKEN
 *
 *   Um JWT é apenas texto assinado — qualquer pessoa consegue ler o conteúdo
 *   e qualquer pessoa consegue FORJAR um parecido. O que prova que ele é
 *   autêntico é a assinatura.
 *
 *   Validar a assinatura localmente é possível (via JWKS), mas exige acertar
 *   algoritmo, rotação de chaves, expiração e revogação. Errar qualquer um
 *   desses detalhes abre uma brecha silenciosa.
 *
 *   Perguntar ao endpoint `/auth/v1/user` do Supabase é a opção que não tem
 *   como estar sutilmente errada: ou o Supabase reconhece o token, ou não.
 *   Também respeita logout e revogação imediatamente, o que a validação
 *   local não faz.
 *
 *   O custo é uma chamada de rede por requisição — resolvido com um cache
 *   curto, abaixo.
 */

import { lerVariaveisDeAmbiente } from './env.js';
import { selecionarUm } from './database.js';

const env = lerVariaveisDeAmbiente();

const SUPABASE_URL = (env.SUPABASE_URL || '').replace(/\/+$/, '');
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY || '';

export const autenticacaoConfigurada = Boolean(SUPABASE_URL && ANON_KEY);

/* =============================================================================
 * CACHE DE SESSÕES
 *
 * Guarda a resposta do Supabase por pouco tempo, para não fazer uma chamada
 * de rede a cada requisição do mesmo usuário.
 *
 * O prazo é CURTO de propósito (60 s): se alguém sair da conta ou tiver o
 * acesso revogado, o efeito aparece em no máximo um minuto. Um cache longo
 * deixaria um token revogado funcionando — exatamente o que queremos evitar.
 * ========================================================================== */

const CACHE_MS = 60_000;
const CACHE_MAXIMO = 500;

const cacheSessoes = new Map();

function lerCache(token) {
  const registro = cacheSessoes.get(token);
  if (!registro) return null;

  if (registro.expiraEm <= Date.now()) {
    cacheSessoes.delete(token);
    return null;
  }

  return registro.usuario;
}

function gravarCache(token, usuario) {
  // Teto simples: ao encher, descarta a entrada mais antiga. Evita que um
  // ataque com milhares de tokens diferentes consuma toda a memória.
  if (cacheSessoes.size >= CACHE_MAXIMO) {
    const maisAntiga = cacheSessoes.keys().next().value;
    cacheSessoes.delete(maisAntiga);
  }

  cacheSessoes.set(token, { usuario, expiraEm: Date.now() + CACHE_MS });
}

/** Remove uma sessão do cache (usado ao sair da conta). */
export function invalidarCache(token) {
  if (token) cacheSessoes.delete(token);
}

/* =============================================================================
 * EXTRAÇÃO DO TOKEN
 * ========================================================================== */

/**
 * Lê o token do cabeçalho Authorization.
 *
 * @param {object} req
 * @returns {string|null}
 */
export function extrairToken(req) {
  const cabecalho = req?.headers?.authorization || '';

  // Formato exigido: "Bearer <token>"
  const partes = cabecalho.split(' ');
  if (partes.length !== 2 || partes[0].toLowerCase() !== 'bearer') return null;

  const token = partes[1].trim();
  if (!token) return null;

  // Checagem de formato ANTES de gastar uma chamada de rede: um JWT tem
  // exatamente três partes separadas por ponto. Qualquer outra coisa é
  // descartada de imediato.
  if (token.split('.').length !== 3) return null;

  // Limite de tamanho: um JWT legítimo não passa disso. Protege contra
  // alguém enviar megabytes no cabeçalho.
  if (token.length > 4096) return null;

  return token;
}

/* =============================================================================
 * VALIDAÇÃO
 * ========================================================================== */

/**
 * Pergunta ao Supabase de quem é o token.
 *
 * @param {string} token
 * @returns {Promise<{id: string, email: string}|null>} null se inválido
 */
async function consultarSupabase(token) {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), 8000);

  try {
    const resposta = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
      signal: controlador.signal,
    });

    // 401 é o caso normal de token inválido, expirado ou revogado.
    if (!resposta.ok) return null;

    const dados = await resposta.json().catch(() => null);
    if (!dados?.id) return null;

    return { id: dados.id, email: dados.email || '' };
  } catch (erro) {
    // Falha de rede NÃO pode ser confundida com "token válido".
    // Na dúvida, tratamos como não autenticado — o usuário vê preço de
    // varejo ou é pedido para entrar de novo, nunca ganha acesso indevido.
    console.error('[auth] Falha ao validar token:', erro.message);
    return null;
  } finally {
    clearTimeout(temporizador);
  }
}

/**
 * Identifica o usuário de uma requisição.
 *
 * @param {object} req
 * @returns {Promise<{id: string, email: string, perfil: string}|null>}
 */
export async function identificarUsuario(req) {
  if (!autenticacaoConfigurada) return null;

  const token = extrairToken(req);
  if (!token) return null;

  // Cache primeiro.
  const emCache = lerCache(token);
  if (emCache) return emCache;

  const basico = await consultarSupabase(token);
  if (!basico) return null;

  // Busca o perfil na nossa tabela. O perfil ('cliente', 'revendedor',
  // 'admin') NUNCA vem do token: ele vem do banco, onde só o backend
  // consegue alterá-lo.
  let perfil = 'cliente';

  try {
    const linha = await selecionarUm('profiles', {
      colunas: 'perfil,nome',
      filtros: { id: `eq.${basico.id}` },
    });
    if (linha?.perfil) perfil = linha.perfil;
  } catch (erro) {
    // Sem perfil carregado, fica no mais restritivo.
    console.error('[auth] Falha ao buscar perfil:', erro.message);
  }

  const usuario = { id: basico.id, email: basico.email, perfil };

  gravarCache(token, usuario);
  return usuario;
}

/**
 * Atalho para as rotas que só precisam do identificador.
 * @returns {Promise<string|null>}
 */
export async function identificarUsuarioId(req) {
  const usuario = await identificarUsuario(req);
  return usuario?.id || null;
}

/* =============================================================================
 * AUTORIZAÇÃO
 * ========================================================================== */

/**
 * Exige um usuário autenticado.
 *
 * @returns {Promise<{ok: true, usuario: object} | {ok: false, status: number, mensagem: string}>}
 */
export async function exigirAutenticacao(req) {
  const usuario = await identificarUsuario(req);

  if (!usuario) {
    return {
      ok: false,
      status: 401,
      mensagem: 'Você precisa entrar na sua conta para continuar.',
    };
  }

  return { ok: true, usuario };
}

/**
 * Exige perfil de administrador.
 *
 * ⚠️ É ESTA função que protege o painel administrativo — não o HTML.
 *   Esconder botões na interface não protege nada: qualquer pessoa pode
 *   chamar a API diretamente. A barreira real está aqui e nas políticas RLS.
 */
export async function exigirAdmin(req) {
  const resultado = await exigirAutenticacao(req);
  if (!resultado.ok) return resultado;

  if (resultado.usuario.perfil !== 'admin') {
    // 403, e não 404: o usuário está identificado, apenas não tem permissão.
    return {
      ok: false,
      status: 403,
      mensagem: 'Você não tem permissão para acessar esta área.',
    };
  }

  return resultado;
}

/**
 * Verifica se o usuário é revendedor aprovado.
 *
 * Observação: a decisão sobre PREÇO de atacado continua em
 * services/product-service.js (`obterCondicoesRevendedor`), que consulta a
 * tabela `resellers` diretamente. Esta função serve para proteger ROTAS.
 */
export async function exigirRevendedorAprovado(req) {
  const resultado = await exigirAutenticacao(req);
  if (!resultado.ok) return resultado;

  const revendedor = await selecionarUm('resellers', {
    colunas: 'status',
    filtros: { usuario_id: `eq.${resultado.usuario.id}`, status: 'eq.aprovado' },
  });

  if (!revendedor) {
    return {
      ok: false,
      status: 403,
      mensagem: 'Seu cadastro de revendedor ainda não foi aprovado.',
    };
  }

  return resultado;
}

export default {
  identificarUsuario,
  identificarUsuarioId,
  exigirAutenticacao,
  exigirAdmin,
  exigirRevendedorAprovado,
  extrairToken,
  invalidarCache,
  autenticacaoConfigurada,
};
