/**
 * backend/controllers/reseller-controller.js
 * -----------------------------------------------------------------------------
 * Candidatura a revendedor — o lado público.
 *
 * ⚠️ NENHUMA ROTA AQUI APROVA NINGUÉM
 *   O máximo que acontece é a candidatura nascer `pendente`. Quem aprova é a
 *   loja, pelo painel, em backend/controllers/admin-revendedores-controller.js
 *   — atrás de `exigirAdmin`.
 *
 *   É a mesma separação do pagamento: o cliente afirma, a loja confirma.
 */

import {
  criarCandidatura,
  obterMinhaCandidatura,
  ErroRevenda,
} from '../../services/reseller-service.js';
import { exigirAutenticacao } from '../../services/auth-service.js';

function responderErro(erro, contexto) {
  if (erro instanceof ErroRevenda) {
    const corpo = { erro: true, mensagem: erro.message };

    if (erro.erros) corpo.erros = erro.erros;
    else if (erro.campo) corpo.erros = { [erro.campo]: erro.message };

    return { status: erro.status, corpo };
  }

  console.error(`[revenda/${contexto}] Falha inesperada:`, erro);

  return {
    status: 503,
    corpo: {
      erro: true,
      mensagem:
        'Não conseguimos registrar agora. Tente de novo, ou chame no WhatsApp.',
    },
  };
}

/**
 * POST /api/revendedores
 *
 * Exige conta: o preço de atacado é resolvido por `usuario_id`. Candidatura
 * solta, sem conta vinculada, nunca conseguiria baixar preço nenhum.
 */
export async function postCandidatura({ req, corpo = {} } = {}) {
  const auth = await exigirAutenticacao(req);

  if (!auth.ok) {
    return {
      status: auth.status,
      corpo: {
        erro: true,
        mensagem:
          'Entre na sua conta para se candidatar — é ela que vai receber as ' +
          'condições de atacado.',
      },
    };
  }

  try {
    const { candidatura, reenviada } = await criarCandidatura(auth.usuario.id, corpo);

    return {
      status: 201,
      corpo: {
        sucesso: true,
        mensagem: reenviada
          ? 'Candidatura reenviada! Vamos analisar de novo.'
          : 'Candidatura enviada! Entramos em contato pelo WhatsApp.',
        candidatura,
      },
    };
  } catch (erro) {
    return responderErro(erro, 'candidatura');
  }
}

/**
 * GET /api/revendedores/eu
 *
 * A pessoa consultando a própria situação. Devolve 200 com `candidatura:
 * null` quando não há cadastro — ausência de candidatura não é erro.
 */
export async function getMinhaCandidatura({ req } = {}) {
  const auth = await exigirAutenticacao(req);

  if (!auth.ok) {
    return { status: auth.status, corpo: { erro: true, mensagem: auth.mensagem } };
  }

  try {
    const candidatura = await obterMinhaCandidatura(auth.usuario.id);

    return { status: 200, corpo: { candidatura } };
  } catch (erro) {
    return responderErro(erro, 'minha-candidatura');
  }
}

export default { postCandidatura, getMinhaCandidatura };
