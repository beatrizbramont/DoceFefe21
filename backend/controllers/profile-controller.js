/**
 * backend/controllers/profile-controller.js
 * -----------------------------------------------------------------------------
 * Perfil do cliente: leitura e edição dos próprios dados.
 *
 * ⚠️ ROTAS PROTEGIDAS
 *   Todas exigem sessão válida. A verificação acontece em
 *   services/auth-service.js, que pergunta ao Supabase de quem é o token —
 *   nunca confiando no que o navegador afirma.
 *
 * ⚠️ O QUE O CLIENTE **NÃO** PODE MUDAR
 *   O campo `perfil` ('cliente', 'revendedor', 'admin') é removido de
 *   qualquer atualização que chegue aqui. Se um cliente enviar
 *   `{"perfil": "admin"}`, o campo simplesmente não é repassado ao banco.
 *
 *   Essa é a segunda de três barreiras:
 *     1. aqui, no controlador, o campo é descartado;
 *     2. a política RLS em 02-rls.sql exige que `perfil` continue igual;
 *     3. o backend usa a chave de serviço, então é esta camada que precisa
 *        se policiar — motivo pelo qual a lista de campos permitidos abaixo
 *        é explícita, e não uma exclusão de campos proibidos.
 */

import { selecionarUm, atualizar, selecionar } from '../../services/database.js';
import { exigirAutenticacao } from '../../services/auth-service.js';

/* =============================================================================
 * CAMPOS EDITÁVEIS
 *
 * LISTA DE PERMITIDOS, nunca de proibidos. Se amanhã a tabela ganhar uma
 * coluna sensível, ela já nasce bloqueada — não depende de alguém lembrar
 * de acrescentá-la a uma lista negra.
 * ========================================================================== */

const CAMPOS_EDITAVEIS = ['nome', 'telefone', 'data_nascimento', 'aceita_marketing'];

/* =============================================================================
 * VALIDAÇÃO
 * ========================================================================== */

function validarAtualizacao(corpo) {
  const erros = {};
  const dados = {};

  if (!corpo || typeof corpo !== 'object') {
    return { ok: false, erros: { geral: 'Envie os dados a atualizar.' } };
  }

  // --- Nome ---
  if (corpo.nome !== undefined) {
    const nome = String(corpo.nome).trim();
    if (nome.length < 2) {
      erros.nome = 'O nome parece curto demais.';
    } else if (nome.length > 120) {
      erros.nome = 'O nome é longo demais.';
    } else {
      dados.nome = nome;
    }
  }

  // --- Telefone ---
  if (corpo.telefone !== undefined) {
    const telefone = String(corpo.telefone).replace(/\D/g, '');

    if (telefone === '') {
      // Campo opcional: string vazia limpa o valor.
      dados.telefone = null;
    } else if (telefone.length < 10 || telefone.length > 11) {
      // A restrição do banco aceita só 10 ou 11 dígitos; validar aqui
      // devolve mensagem clara em vez de erro bruto do PostgreSQL.
      erros.telefone = 'Informe o número completo, com DDD.';
    } else {
      dados.telefone = telefone;
    }
  }

  // --- Data de nascimento ---
  if (corpo.data_nascimento !== undefined) {
    const valor = String(corpo.data_nascimento).trim();

    if (valor === '') {
      dados.data_nascimento = null;
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
      erros.data_nascimento = 'Use o formato AAAA-MM-DD.';
    } else {
      const data = new Date(`${valor}T00:00:00`);
      const hoje = new Date();

      if (Number.isNaN(data.getTime())) {
        erros.data_nascimento = 'Data inválida.';
      } else if (data > hoje) {
        erros.data_nascimento = 'A data não pode ser no futuro.';
      } else if (hoje.getFullYear() - data.getFullYear() > 120) {
        erros.data_nascimento = 'Data inválida.';
      } else {
        dados.data_nascimento = valor;
      }
    }
  }

  // --- Marketing ---
  if (corpo.aceita_marketing !== undefined) {
    dados.aceita_marketing = corpo.aceita_marketing === true;
  }

  if (Object.keys(erros).length > 0) {
    return { ok: false, erros };
  }

  if (Object.keys(dados).length === 0) {
    return { ok: false, erros: { geral: 'Nenhum campo válido para atualizar.' } };
  }

  return { ok: true, dados };
}

/* =============================================================================
 * CONTROLADORES
 * ========================================================================== */

/**
 * GET /api/perfil
 * Dados do usuário logado.
 */
export async function getPerfil({ req } = {}) {
  const auth = await exigirAutenticacao(req);

  if (!auth.ok) {
    return { status: auth.status, corpo: { erro: true, mensagem: auth.mensagem } };
  }

  const perfil = await selecionarUm('profiles', {
    colunas: 'id,nome,telefone,data_nascimento,aceita_marketing,perfil,criado_em',
    filtros: { id: `eq.${auth.usuario.id}` },
  });

  if (!perfil) {
    // A linha em `profiles` é criada por gatilho ao cadastrar. Se não existe,
    // algo saiu do lugar — melhor avisar do que fingir normalidade.
    return {
      status: 404,
      corpo: {
        erro: true,
        mensagem: 'Perfil não encontrado. Entre em contato com o suporte.',
      },
    };
  }

  // Verifica se a pessoa é revendedora e qual o status do cadastro.
  let revenda = null;
  try {
    const reseller = await selecionarUm('resellers', {
      colunas: 'status,nome_estabelecimento,desconto_percentual',
      filtros: { usuario_id: `eq.${auth.usuario.id}` },
    });

    if (reseller) {
      revenda = {
        status: reseller.status,
        estabelecimento: reseller.nome_estabelecimento,
        // O desconto só é informado a quem já foi aprovado.
        desconto:
          reseller.status === 'aprovado' ? Number(reseller.desconto_percentual) : null,
      };
    }
  } catch (erro) {
    console.error('[perfil] Falha ao buscar revendedor:', erro.message);
  }

  return {
    status: 200,
    corpo: {
      perfil: {
        id: perfil.id,
        nome: perfil.nome,
        email: auth.usuario.email,
        telefone: perfil.telefone,
        dataNascimento: perfil.data_nascimento,
        aceitaMarketing: perfil.aceita_marketing,
        tipo: perfil.perfil,
        membroDesde: perfil.criado_em,
      },
      revenda,
    },
  };
}

/**
 * PATCH /api/perfil
 * Atualiza os próprios dados.
 */
export async function patchPerfil({ req, corpo = {} } = {}) {
  const auth = await exigirAutenticacao(req);

  if (!auth.ok) {
    return { status: auth.status, corpo: { erro: true, mensagem: auth.mensagem } };
  }

  const validacao = validarAtualizacao(corpo);

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

  // Reforço da lista de permitidos: mesmo que a validação mude no futuro,
  // nada fora de CAMPOS_EDITAVEIS chega ao banco.
  const mudancas = {};
  for (const campo of CAMPOS_EDITAVEIS) {
    if (validacao.dados[campo] !== undefined) {
      mudancas[campo] = validacao.dados[campo];
    }
  }

  try {
    await atualizar('profiles', { id: `eq.${auth.usuario.id}` }, mudancas);

    return {
      status: 200,
      corpo: { sucesso: true, mensagem: 'Dados atualizados!' },
    };
  } catch (erro) {
    console.error('[perfil] Falha ao atualizar:', erro.message);

    return {
      status: 503,
      corpo: {
        erro: true,
        mensagem: 'Não conseguimos salvar agora. Tente novamente em instantes.',
      },
    };
  }
}

/**
 * GET /api/perfil/pedidos
 * Histórico de compras do usuário logado.
 *
 * ⚠️ O filtro `usuario_id` vem da SESSÃO VALIDADA, nunca da URL. Se viesse
 *   de um parâmetro, bastaria trocar o número para ler os pedidos de outra
 *   pessoa — a falha mais comum em lojas virtuais.
 */
export async function getMeusPedidos({ req, query = {} } = {}) {
  const auth = await exigirAutenticacao(req);

  if (!auth.ok) {
    return { status: auth.status, corpo: { erro: true, mensagem: auth.mensagem } };
  }

  const limite = Math.min(
    Math.max(1, Number.parseInt(query.limite, 10) || 20),
    50
  );

  try {
    const pedidos = await selecionar('orders', {
      colunas:
        'id,codigo,status,tipo_entrega,data_desejada,subtotal_centavos,' +
        'desconto_centavos,frete_centavos,total_centavos,criado_em',
      filtros: { usuario_id: `eq.${auth.usuario.id}` },
      ordenar: 'criado_em.desc',
      limite,
    });

    return {
      status: 200,
      corpo: {
        pedidos: pedidos.map((p) => ({
          codigo: p.codigo,
          status: p.status,
          tipoEntrega: p.tipo_entrega,
          dataDesejada: p.data_desejada,
          subtotal: p.subtotal_centavos,
          desconto: p.desconto_centavos,
          frete: p.frete_centavos,
          total: p.total_centavos,
          criadoEm: p.criado_em,
        })),
      },
    };
  } catch (erro) {
    console.error('[perfil] Falha ao buscar pedidos:', erro.message);

    return {
      status: 503,
      corpo: { erro: true, mensagem: 'Não conseguimos carregar seus pedidos.' },
    };
  }
}

export default { getPerfil, patchPerfil, getMeusPedidos };
