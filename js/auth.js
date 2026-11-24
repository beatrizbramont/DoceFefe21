/**
 * auth.js
 * -----------------------------------------------------------------------------
 * Autenticação de clientes, pelo Supabase Auth.
 *
 * POR QUE O NAVEGADOR FALA DIRETO COM O SUPABASE
 *
 *   O cadastro e o login vão do navegador para o Supabase, sem passar pelo
 *   nosso backend. Isso é deliberado e mais seguro:
 *
 *     • A SENHA NUNCA TOCA NO NOSSO SERVIDOR. Não temos como registrá-la em
 *       log por acidente, nem vazá-la se a nossa API for comprometida.
 *     • Hash de senha, confirmação de e-mail, recuperação e bloqueio por
 *       tentativas são trabalho do Supabase, que faz isso melhor do que
 *       qualquer implementação nossa faria.
 *     • A chave `anon` é pública POR DESIGN. Com ela só é possível o que as
 *       políticas RLS permitirem.
 *
 *   O nosso backend entra depois: recebe o token da sessão e PERGUNTA ao
 *   Supabase de quem ele é (ver services/auth-service.js). Ele nunca confia
 *   no que o navegador diz sobre a própria identidade.
 *
 * ⚠️ ONDE A SESSÃO FICA GUARDADA
 *
 *   Os tokens ficam no `localStorage`. Isso os expõe a um ataque de XSS:
 *   script malicioso injetado na página conseguiria lê-los.
 *
 *   A defesa escolhida foi eliminar o XSS na origem, e não esconder o token:
 *   nenhum dado de usuário ou de banco é inserido via `innerHTML` em lugar
 *   nenhum deste projeto — tudo passa por `textContent` (ver lib/ui.js).
 *
 *   A alternativa seria cookie `httpOnly`, imune a XSS, mas exigiria que
 *   todo o login passasse pelo nosso backend — justamente o que evitamos
 *   acima, e que traria o risco de a senha trafegar por aqui.
 */

import { SUPABASE } from './config.js';
import { definirTokenAcesso, definirRenovadorDeToken } from './lib/api.js';

/* =============================================================================
 * CONFIGURAÇÃO
 * ========================================================================== */

const BASE = `${(SUPABASE.url || '').replace(/\/+$/, '')}/auth/v1`;
const ANON = SUPABASE.anonKey || '';

export const autenticacaoDisponivel = Boolean(SUPABASE.url && ANON);

const CHAVE_SESSAO = 'docefefe21:sessao:v1';

/** Erro de autenticação com mensagem já traduzida para o usuário. */
export class ErroAuth extends Error {
  constructor(mensagem, codigo = '', status = 0) {
    super(mensagem);
    this.name = 'ErroAuth';
    this.codigo = codigo;
    this.status = status;
  }
}

/* =============================================================================
 * MENSAGENS
 *
 * O Supabase responde em inglês. Traduzimos para algo que o cliente entenda,
 * sem revelar mais do que o necessário.
 * ========================================================================== */

const MENSAGENS = {
  invalid_credentials: 'E-mail ou senha incorretos.',
  invalid_grant: 'E-mail ou senha incorretos.',
  email_not_confirmed: 'Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.',
  user_already_exists: 'Já existe uma conta com este e-mail.',
  email_exists: 'Já existe uma conta com este e-mail.',
  weak_password: 'A senha precisa ter pelo menos 8 caracteres.',
  over_email_send_rate_limit: 'Muitas tentativas. Aguarde alguns minutos.',
  over_request_rate_limit: 'Muitas tentativas. Aguarde alguns minutos.',
  same_password: 'A nova senha precisa ser diferente da atual.',
  validation_failed: 'Confira os dados informados.',
};

function traduzirErro(dados, status) {
  const codigo = dados?.error_code || dados?.code || '';
  const original = dados?.msg || dados?.message || dados?.error_description || '';

  if (MENSAGENS[codigo]) {
    return new ErroAuth(MENSAGENS[codigo], codigo, status);
  }

  // Algumas respostas trazem só o texto, sem código.
  const texto = String(original).toLowerCase();

  if (texto.includes('invalid login credentials')) {
    return new ErroAuth(MENSAGENS.invalid_credentials, 'invalid_credentials', status);
  }
  if (texto.includes('email not confirmed')) {
    return new ErroAuth(MENSAGENS.email_not_confirmed, 'email_not_confirmed', status);
  }
  if (texto.includes('already registered') || texto.includes('already been registered')) {
    return new ErroAuth(MENSAGENS.user_already_exists, 'user_already_exists', status);
  }
  if (texto.includes('password should be')) {
    return new ErroAuth(MENSAGENS.weak_password, 'weak_password', status);
  }

  if (status === 429) {
    return new ErroAuth(MENSAGENS.over_request_rate_limit, 'rate_limit', status);
  }

  return new ErroAuth(
    'Não foi possível concluir. Tente novamente em instantes.',
    codigo,
    status
  );
}

/* =============================================================================
 * SESSÃO
 * ========================================================================== */

/** @returns {{access_token: string, refresh_token: string, expires_at: number, user: object}|null} */
export function obterSessao() {
  try {
    const bruto = localStorage.getItem(CHAVE_SESSAO);
    if (!bruto) return null;

    const sessao = JSON.parse(bruto);
    if (!sessao?.access_token || !sessao?.refresh_token) return null;

    return sessao;
  } catch {
    return null;
  }
}

function gravarSessao(dados) {
  if (!dados?.access_token) {
    limparSessao();
    return null;
  }

  // O Supabase devolve `expires_in` (segundos). Convertemos para um instante
  // absoluto, que é o que precisamos para saber se já venceu.
  const sessao = {
    access_token: dados.access_token,
    refresh_token: dados.refresh_token,
    expires_at: Date.now() + (Number(dados.expires_in) || 3600) * 1000,
    user: dados.user
      ? { id: dados.user.id, email: dados.user.email, metadata: dados.user.user_metadata || {} }
      : null,
  };

  try {
    localStorage.setItem(CHAVE_SESSAO, JSON.stringify(sessao));
  } catch (erro) {
    console.warn('[auth] Não foi possível salvar a sessão:', erro);
  }

  definirTokenAcesso(sessao.access_token);
  avisarMudanca(sessao);

  return sessao;
}

export function limparSessao() {
  try {
    localStorage.removeItem(CHAVE_SESSAO);
  } catch {
    /* ignora */
  }

  definirTokenAcesso(null);
  avisarMudanca(null);
}

/** true se há sessão e ela ainda não venceu. */
export function estaLogado() {
  const sessao = obterSessao();
  if (!sessao) return false;

  // Margem de 60 s: evita enviar um token que vence no meio da requisição.
  return sessao.expires_at > Date.now() + 60_000;
}

/** Dados básicos do usuário da sessão atual. */
export function usuarioAtual() {
  return obterSessao()?.user || null;
}

/* =============================================================================
 * EVENTOS
 * ========================================================================== */

const EVENTO = 'auth:mudou';

function avisarMudanca(sessao) {
  document.dispatchEvent(new CustomEvent(EVENTO, { detail: { sessao } }));
}

export function aoMudarAutenticacao(callback) {
  document.addEventListener(EVENTO, (evento) => callback(evento.detail.sessao));
}

/* =============================================================================
 * CHAMADAS AO SUPABASE AUTH
 * ========================================================================== */

async function requisitar(caminho, { metodo = 'POST', corpo = null, token = null } = {}) {
  if (!autenticacaoDisponivel) {
    throw new ErroAuth(
      'Autenticação não configurada. Preencha VITE_SUPABASE_URL e ' +
        'VITE_SUPABASE_ANON_KEY no arquivo .env',
      'nao_configurado'
    );
  }

  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), 15000);

  try {
    const resposta = await fetch(`${BASE}${caminho}`, {
      method: metodo,
      headers: {
        apikey: ANON,
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: controlador.signal,
    });

    const dados = await resposta.json().catch(() => null);

    if (!resposta.ok) throw traduzirErro(dados, resposta.status);

    return dados;
  } catch (erro) {
    if (erro instanceof ErroAuth) throw erro;

    if (erro.name === 'AbortError') {
      throw new ErroAuth('A conexão demorou demais. Tente novamente.', 'timeout');
    }

    throw new ErroAuth(
      'Não foi possível conectar. Verifique sua internet.',
      'rede'
    );
  } finally {
    clearTimeout(temporizador);
  }
}

/* =============================================================================
 * CADASTRO
 * ========================================================================== */

/**
 * Cria uma conta.
 *
 * O nome vai em `data`, que o Supabase guarda em `raw_user_meta_data`. O
 * gatilho `ao_criar_usuario` (ver database/01-schema.sql) lê esse campo e
 * cria a linha em `profiles` automaticamente.
 *
 * @param {{nome: string, email: string, senha: string, telefone?: string}} dados
 * @returns {Promise<{sessao: object|null, precisaConfirmarEmail: boolean}>}
 */
export async function cadastrar({ nome, email, senha, telefone = '' }) {
  const resposta = await requisitar('/signup', {
    corpo: {
      email: email.trim().toLowerCase(),
      password: senha,
      data: {
        nome: nome.trim(),
        telefone: telefone.replace(/\D/g, ''),
      },
    },
  });

  // Quando a confirmação de e-mail está ativa no Supabase, o cadastro NÃO
  // devolve sessão — o usuário precisa clicar no link do e-mail primeiro.
  if (!resposta?.access_token) {
    return { sessao: null, precisaConfirmarEmail: true };
  }

  return { sessao: gravarSessao(resposta), precisaConfirmarEmail: false };
}

/* =============================================================================
 * CONFIRMAÇÃO POR CÓDIGO
 *
 * POR QUE CÓDIGO E NÃO LINK
 *
 *   O link de confirmação carrega dentro dele o endereço do site. Isso cria
 *   dois problemas que o código não tem:
 *
 *     1. O e-mail chega no celular, mas o link aponta para onde o site
 *        estava quando o e-mail foi gerado. Enquanto o projeto roda em
 *        `localhost`, "localhost" no celular é o próprio celular — e a
 *        página não existe lá.
 *
 *     2. O link é de uso único. A pré-visualização de alguns aplicativos
 *        "toca" nele antes da pessoa, e ele queima sem ninguém ter clicado.
 *
 *   O código não aponta para lugar nenhum: a pessoa lê no celular e digita
 *   onde estiver. Funciona hoje em localhost e continuará funcionando
 *   depois que o site for publicado, sem reconfigurar nada.
 * ========================================================================== */

/**
 * Confirma o cadastro com o código de 6 dígitos recebido por e-mail.
 *
 * Diferente do fluxo por link, aqui o Supabase devolve a sessão direto —
 * quem digitou o código provou que tem acesso à caixa de e-mail, então já
 * entra logada, sem precisar digitar a senha de novo.
 *
 * @param {{email: string, codigo: string}} dados
 * @returns {Promise<object>} a sessão criada
 */
export async function confirmarCodigo({ email, codigo }) {
  const limpo = String(codigo || '').replace(/\D/g, '');

  /*
    FAIXA, E NÃO UM TAMANHO FIXO

    A primeira versão exigia exatamente 6 números, porque 6 é o padrão do
    Supabase. Só que o tamanho é CONFIGURÁVEL no painel (Authentication →
    Providers → Email → OTP Length), e este projeto está em 8 — então a
    tela recusava o código certo antes mesmo de perguntar ao servidor.

    A faixa larga existe só para barrar engano óbvio: campo vazio, ou alguém
    colando um texto inteiro. Quem decide se o código vale é o Supabase, que
    é o único que sabe qual foi enviado.
  */
  if (limpo.length < 4 || limpo.length > 10) {
    throw new ErroAuth(
      'Digite o código que chegou no seu e-mail.',
      'codigo_invalido',
      400
    );
  }

  const resposta = await requisitar('/verify', {
    corpo: {
      type: 'signup',
      email: email.trim().toLowerCase(),
      token: limpo,
    },
  });

  return gravarSessao(resposta);
}

/**
 * Pede um código novo.
 *
 * Usado quando o primeiro não chega, cai no spam, ou vence — o código do
 * Supabase dura uma hora.
 */
export async function reenviarCodigo(email) {
  await requisitar('/resend', {
    corpo: { type: 'signup', email: email.trim().toLowerCase() },
  });

  return true;
}

/* =============================================================================
 * LOGIN
 * ========================================================================== */

/**
 * Entra na conta.
 * @returns {Promise<object>} a sessão criada
 */
export async function entrar({ email, senha }) {
  const resposta = await requisitar('/token?grant_type=password', {
    corpo: { email: email.trim().toLowerCase(), password: senha },
  });

  return gravarSessao(resposta);
}

/* =============================================================================
 * SAIR
 * ========================================================================== */

export async function sair() {
  const sessao = obterSessao();

  // Avisa o Supabase para revogar o token do lado dele também. Se falhar,
  // limpamos localmente de qualquer forma — o importante é o usuário sair.
  if (sessao?.access_token) {
    try {
      await requisitar('/logout', { token: sessao.access_token });
    } catch (erro) {
      console.warn('[auth] Falha ao encerrar a sessão no servidor:', erro.message);
    }
  }

  limparSessao();
}

/* =============================================================================
 * RENOVAÇÃO DO TOKEN
 * ========================================================================== */

/** Impede que várias requisições disparem renovações simultâneas. */
let renovacaoEmAndamento = null;

/**
 * Troca o refresh_token por um access_token novo.
 * @returns {Promise<object|null>} a nova sessão, ou null se não foi possível
 */
export async function renovarSessao() {
  if (renovacaoEmAndamento) return renovacaoEmAndamento;

  const sessao = obterSessao();
  if (!sessao?.refresh_token) return null;

  renovacaoEmAndamento = (async () => {
    try {
      const resposta = await requisitar('/token?grant_type=refresh_token', {
        corpo: { refresh_token: sessao.refresh_token },
      });

      return gravarSessao(resposta);
    } catch (erro) {
      // Refresh token inválido significa sessão encerrada de vez.
      console.warn('[auth] Não foi possível renovar a sessão:', erro.message);
      limparSessao();
      return null;
    } finally {
      renovacaoEmAndamento = null;
    }
  })();

  return renovacaoEmAndamento;
}

/**
 * Garante um token válido, renovando se estiver perto de vencer.
 * @returns {Promise<string|null>}
 */
export async function obterTokenValido() {
  const sessao = obterSessao();
  if (!sessao) return null;

  if (sessao.expires_at > Date.now() + 60_000) {
    return sessao.access_token;
  }

  const renovada = await renovarSessao();
  return renovada?.access_token || null;
}

/* =============================================================================
 * RECUPERAÇÃO DE SENHA
 * ========================================================================== */

/**
 * Envia o e-mail de redefinição de senha.
 *
 * A resposta é a mesma existindo ou não a conta — de propósito. Dizer
 * "e-mail não cadastrado" permitiria descobrir quem é cliente da loja.
 */
export async function recuperarSenha(email) {
  await requisitar('/recover', {
    corpo: { email: email.trim().toLowerCase() },
  }).catch((erro) => {
    // 429 precisa chegar ao usuário; os demais são silenciados.
    if (erro.status === 429) throw erro;
  });

  return {
    mensagem:
      'Se existir uma conta com este e-mail, enviamos as instruções para redefinir a senha.',
  };
}

/** Define uma senha nova (usado após o link do e-mail). */
export async function definirNovaSenha(novaSenha) {
  const token = await obterTokenValido();
  if (!token) {
    throw new ErroAuth('Sua sessão expirou. Peça um novo link.', 'sem_sessao');
  }

  const resposta = await requisitar('/user', {
    metodo: 'PUT',
    corpo: { password: novaSenha },
    token,
  });

  return resposta;
}

/* =============================================================================
 * INICIALIZAÇÃO
 * ========================================================================== */

// Registra a renovação no cliente HTTP: quando a API devolver 401, ela
// chama esta função, pega um token novo e repete a requisição sozinha.
definirRenovadorDeToken(async () => {
  const sessao = await renovarSessao();
  return sessao?.access_token || null;
});

/**
 * Restaura a sessão guardada e deixa o token pronto para a API.
 * Chamada por js/main.js em toda página.
 */
export async function iniciarAutenticacao() {
  const sessao = obterSessao();
  if (!sessao) return null;

  // Sessão vencida: tenta renovar antes de desistir.
  if (sessao.expires_at <= Date.now() + 60_000) {
    return renovarSessao();
  }

  definirTokenAcesso(sessao.access_token);
  return sessao;
}

export default {
  cadastrar,
  entrar,
  sair,
  recuperarSenha,
  definirNovaSenha,
  obterSessao,
  obterTokenValido,
  renovarSessao,
  estaLogado,
  usuarioAtual,
  aoMudarAutenticacao,
  iniciarAutenticacao,
  autenticacaoDisponivel,
};
