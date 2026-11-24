/**
 * services/reseller-service.js
 * -----------------------------------------------------------------------------
 * Revendedores: candidatura, aprovação e condições comerciais.
 *
 * ⚠️ ESTE É O PONTO MAIS SENSÍVEL DO SISTEMA
 *   É o `status = 'aprovado'` desta tabela que libera preço de atacado. Quem
 *   conseguisse gravar esse valor por conta própria compraria pela metade do
 *   preço para sempre.
 *
 *   Três camadas guardam isso, e nenhuma delas é a interface:
 *
 *     1. A política RLS só deixa o próprio usuário inserir candidatura com
 *        `status = 'pendente'` e desconto zero (database/02-rls.sql).
 *     2. Aprovar passa por `exigirAdmin` no controlador.
 *     3. O preço é resolvido no banco, por `preco_para_usuario`, que relê o
 *        status na tabela a cada item de cada pedido.
 *
 *   Este arquivo nunca aceita `status`, `desconto` ou `pedido mínimo` vindos
 *   do formulário público — eles simplesmente não são lidos de lá.
 */

import { selecionar, selecionarUm, inserir, atualizar } from './database.js';

/** Erro de revenda com status HTTP e campo associado. */
export class ErroRevenda extends Error {
  constructor(mensagem, status = 422, campo = null) {
    super(mensagem);
    this.name = 'ErroRevenda';
    this.status = status;
    this.campo = campo;
  }
}

/* =============================================================================
 * VALIDAÇÃO DA CANDIDATURA
 * ========================================================================== */

const LIMITES = {
  nomeResponsavel: { minimo: 2, maximo: 120 },
  nomeEstabelecimento: { minimo: 2, maximo: 120 },
  cidade: { minimo: 2, maximo: 80 },
  mensagem: { maximo: 1000 },
  endereco: { maximo: 300 },
};

/**
 * As listas de escolha são a AUTORIDADE: o formulário em js/revendedor.js
 * repete as mesmas opções, mas quem recusa um valor inventado é daqui.
 */
export const TIPOS_ESTABELECIMENTO = [
  'cafeteria',
  'padaria',
  'mercado',
  'restaurante',
  'loja',
  'eventos',
  'revenda-pessoal',
  'outro',
];

export const VOLUMES = ['ate-50', '50-100', '100-300', 'mais-de-300', 'nao-sei'];

const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS',
  'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC',
  'SP', 'SE', 'TO',
];

const digitos = (valor) => String(valor || '').replace(/\D/g, '');

/**
 * Confere os dois dígitos verificadores do CNPJ.
 *
 * POR QUE NÃO BASTA CONTAR 14 DÍGITOS
 *   A restrição do banco só exige o tamanho. Um CNPJ digitado errado passaria
 *   e só seria descoberto na hora de emitir nota — quando o pedido já está
 *   produzido. O cálculo do dígito pega a troca de dois números, que é o erro
 *   de digitação mais comum.
 *
 *   Isto NÃO prova que a empresa existe; prova que o número é bem formado.
 *   A conferência real continua sendo humana, na hora de aprovar.
 */
export function cnpjValido(valor) {
  const numero = digitos(valor);

  if (numero.length !== 14) return false;

  // Todos os dígitos iguais passam no cálculo, mas não existem na prática.
  if (/^(\d)\1{13}$/.test(numero)) return false;

  const calcular = (ate) => {
    // Os pesos vão de 2 a 9, ciclicamente, da direita para a esquerda.
    let soma = 0;
    let peso = 2;

    for (let i = ate - 1; i >= 0; i -= 1) {
      soma += Number(numero[i]) * peso;
      peso = peso === 9 ? 2 : peso + 1;
    }

    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  return calcular(12) === Number(numero[12]) && calcular(13) === Number(numero[13]);
}

const texto = (valor, limite) => {
  const limpo = String(valor ?? '').trim();
  return limpo ? limpo.slice(0, limite) : null;
};

/**
 * Valida o formulário público.
 *
 * Devolve TODOS os erros de uma vez, por campo — parar no primeiro obrigaria
 * a pessoa a corrigir e reenviar várias vezes.
 *
 * @returns {{ok: boolean, erros?: Record<string,string>, dados?: object}}
 */
export function validarCandidatura(corpo = {}) {
  const erros = {};

  /* --- Responsável --- */
  const responsavel = texto(corpo.nomeResponsavel, LIMITES.nomeResponsavel.maximo);

  if (!responsavel) {
    erros.nomeResponsavel = 'Informe seu nome.';
  } else if (responsavel.length < LIMITES.nomeResponsavel.minimo) {
    erros.nomeResponsavel = 'O nome parece curto demais.';
  }

  /* --- Estabelecimento --- */
  const estabelecimento = texto(
    corpo.nomeEstabelecimento,
    LIMITES.nomeEstabelecimento.maximo
  );

  if (!estabelecimento) {
    erros.nomeEstabelecimento = 'Informe o nome do seu negócio.';
  } else if (estabelecimento.length < LIMITES.nomeEstabelecimento.minimo) {
    erros.nomeEstabelecimento = 'O nome parece curto demais.';
  }

  /* --- WhatsApp --- */
  const whatsapp = digitos(corpo.whatsapp);

  if (!whatsapp) {
    erros.whatsapp = 'Informe seu WhatsApp.';
  } else if (!/^[0-9]{10,11}$/.test(whatsapp)) {
    erros.whatsapp = 'Informe o WhatsApp com DDD, somente números.';
  }

  /* --- Cidade e estado --- */
  const cidade = texto(corpo.cidade, LIMITES.cidade.maximo);

  if (!cidade) {
    erros.cidade = 'Informe sua cidade.';
  } else if (cidade.length < LIMITES.cidade.minimo) {
    erros.cidade = 'O nome da cidade parece curto demais.';
  }

  const estado = String(corpo.estado || '').trim().toUpperCase();

  if (estado && !UFS.includes(estado)) {
    erros.estado = 'Escolha um estado válido.';
  }

  /* --- CNPJ (opcional: revenda pessoal não tem) --- */
  const cnpj = digitos(corpo.cnpj);

  if (cnpj && !cnpjValido(cnpj)) {
    erros.cnpj = 'Esse CNPJ não confere. Revise os números.';
  }

  /* --- Campos de escolha --- */
  const tipo = texto(corpo.tipoEstabelecimento, 40);

  if (tipo && !TIPOS_ESTABELECIMENTO.includes(tipo)) {
    erros.tipoEstabelecimento = 'Escolha uma das opções.';
  }

  const volume = texto(corpo.quantidadeEstimada, 40);

  if (volume && !VOLUMES.includes(volume)) {
    erros.quantidadeEstimada = 'Escolha uma das opções.';
  }

  /* --- Consentimento LGPD --- */
  // Os dados vão para uma base comercial. O aceite é explícito e conferido
  // aqui, não só no navegador.
  if (corpo.consentimento !== true) {
    erros.consentimento = 'É preciso aceitar o uso dos dados para continuar.';
  }

  if (Object.keys(erros).length > 0) return { ok: false, erros };

  return {
    ok: true,
    dados: {
      nome_responsavel: responsavel,
      nome_estabelecimento: estabelecimento,
      cnpj: cnpj || null,
      tipo_estabelecimento: tipo,
      cidade,
      estado: estado || null,
      endereco: texto(corpo.endereco, LIMITES.endereco.maximo),
      whatsapp,
      email: texto(corpo.email, 160),
      quantidade_estimada: volume,
      mensagem: texto(corpo.mensagem, LIMITES.mensagem.maximo),
    },
  };
}

/* =============================================================================
 * CANDIDATURA
 * ========================================================================== */

/**
 * Registra a candidatura de quem está logado.
 *
 * ⚠️ EXIGE CONTA, E NÃO É BUROCRACIA
 *   O preço de atacado é resolvido por `usuario_id`: o banco pergunta "esta
 *   pessoa é revendedora aprovada?" a cada item de cada pedido. Uma
 *   candidatura sem conta vinculada nunca conseguiria baixar preço nenhum —
 *   seria um formulário que não leva a lugar algum.
 */
export async function criarCandidatura(usuarioId, corpo = {}) {
  if (!usuarioId) {
    throw new ErroRevenda(
      'Entre na sua conta para se candidatar — é ela que recebe as condições de atacado.',
      401
    );
  }

  const { ok, erros, dados } = validarCandidatura(corpo);

  if (!ok) {
    const primeiro = Object.keys(erros)[0];
    const erro = new ErroRevenda(erros[primeiro], 422, primeiro);
    erro.erros = erros;
    throw erro;
  }

  const existente = await selecionarUm('resellers', {
    colunas: 'id,status',
    filtros: { usuario_id: `eq.${usuarioId}` },
  });

  if (existente) {
    // Recusada antes não é sentença perpétua: a pessoa pode ter aberto CNPJ,
    // mudado de cidade, crescido. Reenviar reabre a análise.
    if (existente.status === 'recusado') {
      const [atualizada] = await atualizar(
        'resellers',
        { id: `eq.${existente.id}` },
        { ...dados, status: 'pendente', motivo_recusa: null }
      );

      return { candidatura: formatar(atualizada), reenviada: true };
    }

    throw new ErroRevenda(
      existente.status === 'aprovado'
        ? 'Seu cadastro de revendedor já está aprovado.'
        : 'Você já tem uma candidatura em análise.',
      409
    );
  }

  // `status` NÃO está em `dados`: a coluna fica no padrão do banco, que é
  // 'pendente'. Mesmo que o formulário mandasse um status, ele não seria lido.
  const [criada] = await inserir('resellers', { ...dados, usuario_id: usuarioId });

  return { candidatura: formatar(criada), reenviada: false };
}

/**
 * A própria pessoa consultando a situação dela.
 *
 * Devolve as condições comerciais SOMENTE quando aprovada — enquanto está
 * pendente não há desconto nenhum para mostrar.
 */
export async function obterMinhaCandidatura(usuarioId) {
  if (!usuarioId) return null;

  const linha = await selecionarUm('resellers', {
    colunas:
      'id,nome_responsavel,nome_estabelecimento,cnpj,tipo_estabelecimento,' +
      'cidade,estado,whatsapp,email,quantidade_estimada,mensagem,status,' +
      'desconto_percentual,pedido_minimo_centavos,motivo_recusa,aprovado_em,criado_em',
    filtros: { usuario_id: `eq.${usuarioId}` },
  });

  return formatar(linha);
}

function formatar(linha) {
  if (!linha) return null;

  const aprovado = linha.status === 'aprovado';

  return {
    nomeResponsavel: linha.nome_responsavel,
    nomeEstabelecimento: linha.nome_estabelecimento,
    cnpj: linha.cnpj,
    tipoEstabelecimento: linha.tipo_estabelecimento,
    cidade: linha.cidade,
    estado: linha.estado,
    whatsapp: linha.whatsapp,
    email: linha.email,
    quantidadeEstimada: linha.quantidade_estimada,
    mensagem: linha.mensagem,
    status: linha.status,
    motivoRecusa: linha.motivo_recusa,
    aprovadoEm: linha.aprovado_em,
    criadoEm: linha.criado_em,

    // Condições só existem para quem está aprovado. Mostrar "10% de desconto"
    // a quem ainda está em análise seria uma promessa que ninguém fez.
    desconto: aprovado ? Number(linha.desconto_percentual) || 0 : null,
    pedidoMinimo: aprovado ? Number(linha.pedido_minimo_centavos) || 0 : null,
  };
}

/* =============================================================================
 * PAINEL: LISTAGEM E DECISÃO
 * ========================================================================== */

/** Situações que o painel sabe aplicar. 'pendente' é só o estado inicial. */
export const DECISOES = ['aprovado', 'recusado', 'suspenso'];

export async function listarRevendedores(opcoes = {}) {
  const { status = '', busca = '', limite = 100 } = opcoes;

  const filtros = {};

  if (['pendente', 'aprovado', 'recusado', 'suspenso'].includes(status)) {
    filtros.status = `eq.${status}`;
  }

  const termo = String(busca).trim().replace(/[*,()]/g, '');

  if (termo) {
    filtros.or =
      `(nome_responsavel.ilike.*${termo}*,` +
      `nome_estabelecimento.ilike.*${termo}*,` +
      `cidade.ilike.*${termo}*)`;
  }

  const linhas = await selecionar('revendedores_admin', {
    colunas: '*',
    filtros,
    // Pendentes primeiro: é a fila que exige decisão.
    ordenar: 'criado_em.desc',
    limite: Math.min(Math.max(1, Number(limite) || 100), 200),
  });

  return linhas.map((r) => ({
    id: r.id,
    usuarioId: r.usuario_id,
    nomeResponsavel: r.nome_responsavel,
    nomeEstabelecimento: r.nome_estabelecimento,
    cnpj: r.cnpj,
    tipoEstabelecimento: r.tipo_estabelecimento,
    cidade: r.cidade,
    estado: r.estado,
    whatsapp: r.whatsapp,
    email: r.email,
    quantidadeEstimada: r.quantidade_estimada,
    mensagem: r.mensagem,
    status: r.status,
    desconto: Number(r.desconto_percentual) || 0,
    pedidoMinimo: Number(r.pedido_minimo_centavos) || 0,
    observacoes: r.observacoes_internas,
    motivoRecusa: r.motivo_recusa,
    aprovadoEm: r.aprovado_em,
    criadoEm: r.criado_em,
    pedidos: r.pedidos,
    gasto: Number(r.gasto_centavos) || 0,
    ultimoPedidoEm: r.ultimo_pedido_em,
  }));
}

/**
 * Aprova, recusa ou suspende uma candidatura.
 *
 * ⚠️ É AQUI — e só aqui — que alguém passa a ter preço de atacado.
 *   Nenhuma rota pública alcança este caminho.
 *
 * @param {string} id
 * @param {object} decisao
 * @param {string} adminId - quem decidiu, para o registro
 */
export async function decidirCandidatura(id, decisao = {}, adminId = null) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) {
    throw new ErroRevenda('Candidatura inválida.', 400);
  }

  const { status } = decisao;

  if (!DECISOES.includes(status)) {
    throw new ErroRevenda('Escolha aprovar, recusar ou suspender.', 422, 'status');
  }

  const atual = await selecionarUm('resellers', {
    colunas: 'id,status,usuario_id',
    filtros: { id: `eq.${id}` },
  });

  if (!atual) {
    throw new ErroRevenda('Candidatura não encontrada.', 404);
  }

  const mudancas = { status };

  /* --- Recusa precisa de motivo --- */
  // O mesmo princípio da recusa de comprovante: quem é recusado precisa saber
  // o porquê, nem que seja para corrigir e tentar de novo.
  if (status === 'recusado') {
    const motivo = String(decisao.motivo || '').trim().slice(0, 500);

    if (motivo.length < 3) {
      throw new ErroRevenda(
        'Explique o motivo da recusa — a pessoa precisa saber.',
        422,
        'motivo'
      );
    }

    mudancas.motivo_recusa = motivo;
    // Recusado não compra no atacado: as condições voltam a zero para não
    // ficarem valendo caso alguém reaprove sem revisar os números.
    mudancas.desconto_percentual = 0;
    mudancas.pedido_minimo_centavos = 0;
  }

  /* --- Aprovação define as condições comerciais --- */
  if (status === 'aprovado') {
    const desconto = Number(decisao.desconto);

    if (!Number.isFinite(desconto) || desconto < 0 || desconto > 100) {
      throw new ErroRevenda('O desconto vai de 0 a 100%.', 422, 'desconto');
    }

    // 100% de desconto é doação, não revenda. O banco aceitaria; o negócio não.
    if (desconto > 90) {
      throw new ErroRevenda(
        'Desconto acima de 90% — confira se é isso mesmo.',
        422,
        'desconto'
      );
    }

    const minimo = Number(decisao.pedidoMinimo);

    if (!Number.isInteger(minimo) || minimo < 0) {
      throw new ErroRevenda(
        'O pedido mínimo precisa ser um valor em centavos, de zero para cima.',
        422,
        'pedidoMinimo'
      );
    }

    mudancas.desconto_percentual = desconto;
    mudancas.pedido_minimo_centavos = minimo;
    mudancas.motivo_recusa = null;
    mudancas.aprovado_em = new Date().toISOString();
    mudancas.aprovado_por = adminId;

    if (!atual.usuario_id) {
      throw new ErroRevenda(
        'Esta candidatura não está vinculada a uma conta, então não há a quem dar o desconto.',
        409
      );
    }
  }

  if (decisao.observacoes !== undefined) {
    mudancas.observacoes_internas =
      String(decisao.observacoes || '').trim().slice(0, 1000) || null;
  }

  const [atualizada] = await atualizar('resellers', { id: `eq.${id}` }, mudancas);

  return {
    id: atualizada.id,
    status: atualizada.status,
    desconto: Number(atualizada.desconto_percentual) || 0,
    pedidoMinimo: Number(atualizada.pedido_minimo_centavos) || 0,
    anterior: atual.status,
  };
}

export default {
  validarCandidatura,
  criarCandidatura,
  obterMinhaCandidatura,
  listarRevendedores,
  decidirCandidatura,
  cnpjValido,
  DECISOES,
  ErroRevenda,
};
