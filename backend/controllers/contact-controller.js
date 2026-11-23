/**
 * backend/controllers/contact-controller.js
 * -----------------------------------------------------------------------------
 * Recebimento de mensagens do formulário de contato.
 *
 * ⚠️ ROTA PÚBLICA SEM LOGIN
 *   Qualquer visitante pode enviar — e é assim que tem de ser, senão o
 *   formulário não serviria para nada. Em compensação, é a rota mais exposta
 *   do sistema, então a validação aqui é rigorosa:
 *
 *     • cada campo tem tipo, tamanho mínimo e máximo
 *     • o consentimento LGPD é obrigatório e verificado no servidor
 *     • o limitador de requisições corta envios em massa (ver routes/index.js)
 *     • nada é interpolado em SQL — o PostgREST recebe os valores como dados
 */

import { inserir } from '../../services/database.js';

/* =============================================================================
 * VALIDAÇÃO
 * ========================================================================== */

const ASSUNTOS_VALIDOS = [
  'encomenda',
  'duvida-produto',
  'pedido',
  'revenda',
  'elogio',
  'outro',
];

const LIMITES = {
  nome: { minimo: 2, maximo: 100 },
  mensagem: { minimo: 10, maximo: 1000 },
  email: { maximo: 160 },
};

/**
 * Valida o corpo da mensagem.
 *
 * Devolve TODOS os erros de uma vez, por campo, para o frontend conseguir
 * marcar cada um. Parar no primeiro erro obrigaria o cliente a corrigir e
 * reenviar várias vezes.
 *
 * @returns {{ok: boolean, erros?: Record<string,string>, dados?: object}}
 */
function validar(corpo) {
  const erros = {};

  if (!corpo || typeof corpo !== 'object') {
    return { ok: false, erros: { geral: 'Envie os dados do formulário.' } };
  }

  // --- Nome ---
  const nome = String(corpo.nome || '').trim();
  if (!nome) {
    erros.nome = 'Informe seu nome.';
  } else if (nome.length < LIMITES.nome.minimo) {
    erros.nome = 'O nome parece curto demais.';
  } else if (nome.length > LIMITES.nome.maximo) {
    erros.nome = 'O nome é longo demais.';
  }

  // --- WhatsApp ---
  const whatsapp = String(corpo.whatsapp || '').replace(/\D/g, '');
  if (!whatsapp) {
    erros.whatsapp = 'Informe seu WhatsApp.';
  } else if (whatsapp.length < 10 || whatsapp.length > 11) {
    // A restrição do banco exige exatamente 10 ou 11 dígitos. Validar aqui
    // devolve uma mensagem clara em vez de um erro bruto do PostgreSQL.
    erros.whatsapp = 'Informe o número completo, com DDD.';
  }

  // --- E-mail (opcional) ---
  const email = String(corpo.email || '').trim();
  if (email) {
    if (email.length > LIMITES.email.maximo) {
      erros.email = 'O e-mail é longo demais.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      erros.email = 'Esse e-mail parece incompleto.';
    }
  }

  // --- Assunto ---
  const assunto = String(corpo.assunto || '').trim();
  if (!assunto) {
    erros.assunto = 'Escolha um assunto.';
  } else if (!ASSUNTOS_VALIDOS.includes(assunto)) {
    // Lista fechada: impede gravar qualquer texto no campo.
    erros.assunto = 'Assunto inválido.';
  }

  // --- Mensagem ---
  const mensagem = String(corpo.mensagem || '').trim();
  if (!mensagem) {
    erros.mensagem = 'Escreva sua mensagem.';
  } else if (mensagem.length < LIMITES.mensagem.minimo) {
    erros.mensagem = 'Conte um pouquinho mais, por favor.';
  } else if (mensagem.length > LIMITES.mensagem.maximo) {
    erros.mensagem = `A mensagem passou de ${LIMITES.mensagem.maximo} caracteres.`;
  }

  // --- Consentimento LGPD ---
  // Revalidado no servidor: a marcação da caixa no navegador é só a
  // interface, não a prova. Sem consentimento, não gravamos nada.
  if (corpo.consentimento !== true && corpo.consentimento !== 'true') {
    erros.consentimento = 'Precisamos da sua autorização para responder.';
  }

  if (Object.keys(erros).length > 0) {
    return { ok: false, erros };
  }

  return {
    ok: true,
    dados: { nome, whatsapp, email: email || null, assunto, mensagem },
  };
}

/* =============================================================================
 * CONTROLADOR
 * ========================================================================== */

/**
 * POST /api/contato
 */
export async function postContato({ corpo = {} } = {}) {
  const validacao = validar(corpo);

  if (!validacao.ok) {
    return {
      status: 422,
      corpo: {
        erro: true,
        mensagem: 'Confira os campos destacados.',
        erros: validacao.erros,
      },
    };
  }

  try {
    const [registro] = await inserir('contact_messages', validacao.dados);

    return {
      status: 201,
      corpo: {
        sucesso: true,
        mensagem: 'Mensagem recebida! Responderemos em breve.',
        id: registro?.id,
      },
    };
  } catch (erro) {
    console.error('[contato] Falha ao gravar mensagem:', erro.message);

    // O WhatsApp continua disponível como alternativa — então a falha aqui
    // não deixa o cliente sem caminho. A mensagem avisa isso.
    return {
      status: 503,
      corpo: {
        erro: true,
        mensagem:
          'Não conseguimos registrar sua mensagem agora. ' +
          'Use o WhatsApp para falar com a gente.',
      },
    };
  }
}

export default { postContato };
