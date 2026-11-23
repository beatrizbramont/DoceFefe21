/**
 * backend/middleware/seguranca.js
 * -----------------------------------------------------------------------------
 * Cabeçalhos de segurança, CORS e limitação de requisições.
 *
 * Implementado sem `helmet` e `express-rate-limit` porque são poucas dezenas
 * de linhas e assim o projeto roda tanto no Express quanto no servidor nativo
 * (ver backend/server-nativo.mjs). Menos dependências, menos atualizações de
 * segurança para acompanhar.
 */

import { lerVariaveisDeAmbiente } from '../../services/env.js';

const env = lerVariaveisDeAmbiente();
const EM_PRODUCAO = env.NODE_ENV === 'production';

/* =============================================================================
 * 1. CABEÇALHOS DE SEGURANÇA
 * ========================================================================== */

/**
 * Cabeçalhos aplicados a toda resposta.
 * Cada um fecha uma porta específica de ataque.
 */
export function cabecalhosSeguranca() {
  const cabecalhos = {
    // Impede o navegador de "adivinhar" o tipo do arquivo. Sem isso, um
    // upload .txt com conteúdo HTML poderia ser executado como página.
    'X-Content-Type-Options': 'nosniff',

    // Bloqueia a exibição do site dentro de <iframe> em outro domínio,
    // o que impede clickjacking.
    'X-Frame-Options': 'DENY',

    // Não envia a URL completa como referência para outros sites — uma URL
    // de pedido poderia vazar o código em links externos.
    'Referrer-Policy': 'strict-origin-when-cross-origin',

    // Desliga recursos do navegador que a loja não usa.
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=()',

    // Respostas da API nunca devem ser guardadas em cache de proxy.
    'Cache-Control': 'no-store',
  };

  if (EM_PRODUCAO) {
    // Obriga HTTPS por 1 ano. Só em produção: em desenvolvimento quebraria
    // o acesso por http://localhost.
    cabecalhos['Strict-Transport-Security'] =
      'max-age=31536000; includeSubDomains';
  }

  return cabecalhos;
}

/** Middleware do Express. */
export function middlewareSeguranca(req, res, next) {
  for (const [nome, valor] of Object.entries(cabecalhosSeguranca())) {
    res.setHeader(nome, valor);
  }
  // Não anuncia que o servidor é Express — informação a menos para quem
  // procura falhas conhecidas.
  res.removeHeader('X-Powered-By');
  next();
}

/* =============================================================================
 * 2. CORS
 * ========================================================================== */

const ORIGENS_PERMITIDAS = (env.CORS_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

/**
 * Decide se a origem pode chamar a API.
 *
 * Lista explícita, nunca `*`. Com `credentials: include` no frontend, o
 * curinga seria rejeitado pelo navegador — e, pior, permitiria que qualquer
 * site fizesse requisições autenticadas em nome do usuário.
 */
export function avaliarCors(origem) {
  if (!origem) {
    // Requisição sem Origin (curl, app nativo, mesma origem). Não é um
    // pedido de navegador entre sites, então não há risco de CSRF aqui.
    return { permitida: true, cabecalhos: {} };
  }

  if (!ORIGENS_PERMITIDAS.includes(origem)) {
    return { permitida: false, cabecalhos: {} };
  }

  return {
    permitida: true,
    cabecalhos: {
      'Access-Control-Allow-Origin': origem,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Access-Control-Max-Age': '86400',
      // `Vary: Origin` evita que um proxy entregue a resposta de uma origem
      // para outra.
      Vary: 'Origin',
    },
  };
}

export function middlewareCors(req, res, next) {
  const { permitida, cabecalhos } = avaliarCors(req.headers.origin);

  for (const [nome, valor] of Object.entries(cabecalhos)) {
    res.setHeader(nome, valor);
  }

  if (!permitida) {
    res.status(403).json({ erro: true, mensagem: 'Origem não autorizada.' });
    return;
  }

  // Requisição de sondagem do navegador antes do pedido real.
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
}

/* =============================================================================
 * 3. LIMITAÇÃO DE REQUISIÇÕES
 *
 * Guarda as contagens em memória. Para uma loja deste porte é suficiente.
 * Se um dia a API rodar em várias instâncias, isto precisa migrar para um
 * armazenamento compartilhado (Redis) — está anotado como dívida técnica.
 * ========================================================================== */

const contadores = new Map();

/** Remove registros expirados para a memória não crescer sem limite. */
function limparExpirados(agora) {
  for (const [chave, registro] of contadores) {
    if (registro.reiniciaEm <= agora) contadores.delete(chave);
  }
}

// Limpeza periódica. `unref` impede que este temporizador sozinho mantenha
// o processo vivo na hora de encerrar.
const limpeza = setInterval(() => limparExpirados(Date.now()), 60_000);
limpeza.unref?.();

/**
 * Cria um limitador.
 *
 * @param {object} [opcoes]
 * @param {number} [opcoes.janelaMs]
 * @param {number} [opcoes.maximo]
 * @param {string} [opcoes.nome] - separa as contagens por grupo de rotas
 */
export function criarLimitador({ janelaMs = 60_000, maximo = 120, nome = 'geral' } = {}) {
  return function verificar(identificador) {
    const agora = Date.now();
    const chave = `${nome}:${identificador}`;

    let registro = contadores.get(chave);

    if (!registro || registro.reiniciaEm <= agora) {
      registro = { contagem: 0, reiniciaEm: agora + janelaMs };
      contadores.set(chave, registro);
    }

    registro.contagem += 1;

    const restantes = Math.max(0, maximo - registro.contagem);
    const segundosAteReiniciar = Math.ceil((registro.reiniciaEm - agora) / 1000);

    return {
      permitido: registro.contagem <= maximo,
      restantes,
      limite: maximo,
      reiniciaEm: segundosAteReiniciar,
    };
  };
}

/**
 * Identifica quem está chamando.
 *
 * Em produção atrás de proxy (Vercel, Railway, Nginx), o IP real vem em
 * `x-forwarded-for`. Pegamos o PRIMEIRO da lista — os seguintes podem ter
 * sido forjados pelo cliente.
 */
export function identificarCliente(req) {
  const encaminhado = req.headers['x-forwarded-for'];
  if (encaminhado) return String(encaminhado).split(',')[0].trim();

  return (
    req.ip ||
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
    'desconhecido'
  );
}

/** Limitador padrão das rotas públicas de leitura. */
export const limitadorLeitura = criarLimitador({
  janelaMs: 60_000,
  maximo: 180,
  nome: 'leitura',
});

/** Limitador mais rígido para rotas que gravam dados. */
export const limitadorEscrita = criarLimitador({
  janelaMs: 60_000,
  maximo: 20,
  nome: 'escrita',
});

export function middlewareLimite(limitador) {
  return function (req, res, next) {
    const resultado = limitador(identificarCliente(req));

    res.setHeader('X-RateLimit-Limit', resultado.limite);
    res.setHeader('X-RateLimit-Remaining', resultado.restantes);

    if (!resultado.permitido) {
      res.setHeader('Retry-After', resultado.reiniciaEm);
      res.status(429).json({
        erro: true,
        mensagem: 'Muitas requisições em pouco tempo. Aguarde um instante.',
      });
      return;
    }

    next();
  };
}

export default {
  middlewareSeguranca,
  middlewareCors,
  middlewareLimite,
  limitadorLeitura,
  limitadorEscrita,
  cabecalhosSeguranca,
  avaliarCors,
  identificarCliente,
  criarLimitador,
};
