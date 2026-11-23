/**
 * services/database.js
 * -----------------------------------------------------------------------------
 * Acesso ao banco de dados (PostgreSQL via Supabase).
 *
 * POR QUE NÃO USAR A BIBLIOTECA @supabase/supabase-js?
 *   O Supabase expõe o banco por uma API REST (PostgREST). O Node 18+ já tem
 *   `fetch` nativo, então falar com essa API não exige nenhuma dependência.
 *   Menos pacotes significa menos superfície de ataque, instalação instantânea
 *   e nada para atualizar por questões de segurança.
 *
 *   Se no futuro a biblioteca oficial for necessária (ex.: realtime), ela pode
 *   ser adotada sem alterar quem consome este módulo: a interface pública
 *   daqui (`selecionar`, `inserir`, `atualizar`…) continua a mesma.
 *
 * ⚠️ SEGURANÇA — ESTE ARQUIVO NUNCA PODE IR PARA O NAVEGADOR
 *   Ele usa a chave secreta (service_role), que ignora todas as políticas RLS
 *   e tem poder total sobre o banco. É exclusivo do backend.
 */

import { lerVariaveisDeAmbiente } from './env.js';

const env = lerVariaveisDeAmbiente();

const SUPABASE_URL = (env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || '';

/** true quando as credenciais estão presentes. */
export const bancoConfigurado = Boolean(SUPABASE_URL && SERVICE_KEY);

/** Erro de banco com o código HTTP e os detalhes do PostgREST preservados. */
export class ErroBanco extends Error {
  constructor(mensagem, status, detalhes = null) {
    super(mensagem);
    this.name = 'ErroBanco';
    this.status = status;
    this.detalhes = detalhes;
  }
}

/** Cabeçalhos de autenticação usados em toda chamada. */
function cabecalhosPadrao(extras = {}) {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    Accept: 'application/json',
    ...extras,
  };
}

/* -----------------------------------------------------------------------------
 * Requisição base
 * -------------------------------------------------------------------------- */

/**
 * Chama a API REST do Supabase.
 *
 * @param {string} caminho - ex.: '/catalogo_publico?select=*'
 * @param {object} [opcoes]
 * @returns {Promise<any>}
 */
async function requisitar(caminho, opcoes = {}) {
  if (!bancoConfigurado) {
    throw new ErroBanco(
      'Banco de dados não configurado. Preencha SUPABASE_URL e ' +
        'SUPABASE_SERVICE_ROLE_KEY no arquivo .env',
      503
    );
  }

  const { metodo = 'GET', corpo = null, cabecalhos = {}, timeout = 12000 } = opcoes;

  // AbortController evita que uma requisição travada prenda a resposta ao
  // cliente para sempre.
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), timeout);

  try {
    const resposta = await fetch(`${SUPABASE_URL}/rest/v1${caminho}`, {
      method: metodo,
      headers: cabecalhosPadrao({
        ...(corpo ? { 'Content-Type': 'application/json' } : {}),
        ...cabecalhos,
      }),
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: controlador.signal,
    });

    const tipo = resposta.headers.get('content-type') || '';
    const dados = tipo.includes('application/json')
      ? await resposta.json().catch(() => null)
      : await resposta.text();

    if (!resposta.ok) {
      // O PostgREST devolve { message, details, hint, code }.
      const mensagem =
        (dados && (dados.message || dados.msg)) ||
        `Falha na consulta ao banco (HTTP ${resposta.status})`;
      throw new ErroBanco(mensagem, resposta.status, dados);
    }

    return dados;
  } catch (erro) {
    if (erro instanceof ErroBanco) throw erro;

    if (erro.name === 'AbortError') {
      throw new ErroBanco('O banco de dados demorou demais para responder.', 504);
    }

    throw new ErroBanco(
      `Não foi possível conectar ao banco de dados: ${erro.message}`,
      503
    );
  } finally {
    clearTimeout(temporizador);
  }
}

/* -----------------------------------------------------------------------------
 * Montagem de filtros
 *
 * O PostgREST usa uma sintaxe própria de string de consulta:
 *   ?nome=eq.Brownie&preco_varejo=lte.2000&order=nome.asc&limit=10
 * -------------------------------------------------------------------------- */

function montarParametros(filtros = {}) {
  const params = new URLSearchParams();

  for (const [chave, valor] of Object.entries(filtros)) {
    if (valor === null || valor === undefined || valor === '') continue;

    // Se já vier com operador ("eq.", "ilike.", "gte."), usa como está.
    // Caso contrário, assume igualdade.
    const temOperador = typeof valor === 'string' && /^[a-z]+\./.test(valor);
    params.append(chave, temOperador ? valor : `eq.${valor}`);
  }

  return params;
}

/* -----------------------------------------------------------------------------
 * Operações
 * -------------------------------------------------------------------------- */

/**
 * SELECT.
 *
 * @param {string} tabela - tabela ou visão
 * @param {object} [opcoes]
 * @param {string} [opcoes.colunas] - padrão '*'
 * @param {object} [opcoes.filtros]
 * @param {string} [opcoes.ordenar] - ex.: 'nome.asc'
 * @param {number} [opcoes.limite]
 * @param {number} [opcoes.deslocamento]
 * @param {boolean} [opcoes.contarTotal] - devolve { dados, total }
 */
export async function selecionar(tabela, opcoes = {}) {
  const {
    colunas = '*',
    filtros = {},
    ordenar = null,
    limite = null,
    deslocamento = 0,
    contarTotal = false,
  } = opcoes;

  const params = montarParametros(filtros);
  params.set('select', colunas);

  if (ordenar) params.set('order', ordenar);
  if (limite !== null) params.set('limit', String(limite));
  if (deslocamento) params.set('offset', String(deslocamento));

  if (!contarTotal) {
    return requisitar(`/${tabela}?${params}`);
  }

  // Para paginação precisamos do cabeçalho Content-Range, que `requisitar`
  // não expõe — então aqui fazemos a chamada diretamente.
  if (!bancoConfigurado) {
    throw new ErroBanco('Banco de dados não configurado.', 503);
  }

  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), 12000);

  try {
    const resposta = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}?${params}`, {
      // `count=exact` faz o PostgREST informar o total de registros.
      headers: cabecalhosPadrao({ Prefer: 'count=exact' }),
      signal: controlador.signal,
    });

    const dados = await resposta.json().catch(() => []);

    if (!resposta.ok) {
      throw new ErroBanco(
        dados?.message || `Falha na consulta (HTTP ${resposta.status})`,
        resposta.status,
        dados
      );
    }

    // Content-Range vem como "0-9/137" — o total é o que vem após a barra.
    const faixa = resposta.headers.get('content-range') || '';
    const total = Number.parseInt(faixa.split('/')[1], 10);

    return { dados, total: Number.isFinite(total) ? total : dados.length };
  } catch (erro) {
    if (erro instanceof ErroBanco) throw erro;
    if (erro.name === 'AbortError') {
      throw new ErroBanco('O banco demorou demais para responder.', 504);
    }
    throw new ErroBanco(`Falha ao consultar o banco: ${erro.message}`, 503);
  } finally {
    clearTimeout(temporizador);
  }
}

/** SELECT que devolve no máximo um registro (ou null). */
export async function selecionarUm(tabela, opcoes = {}) {
  const resultado = await selecionar(tabela, { ...opcoes, limite: 1 });
  const lista = Array.isArray(resultado) ? resultado : resultado.dados;
  return lista.length > 0 ? lista[0] : null;
}

/** INSERT. Devolve os registros criados, já com os ids gerados. */
export async function inserir(tabela, registros) {
  return requisitar(`/${tabela}`, {
    metodo: 'POST',
    corpo: registros,
    cabecalhos: { Prefer: 'return=representation' },
  });
}

/**
 * UPDATE.
 * @param {object} filtros - OBRIGATÓRIO. Sem filtro, o PostgREST atualizaria
 *                           a tabela inteira.
 */
export async function atualizar(tabela, filtros, mudancas) {
  if (!filtros || Object.keys(filtros).length === 0) {
    throw new ErroBanco(
      'Atualização sem filtro é bloqueada: afetaria todos os registros.',
      400
    );
  }

  return requisitar(`/${tabela}?${montarParametros(filtros)}`, {
    metodo: 'PATCH',
    corpo: mudancas,
    cabecalhos: { Prefer: 'return=representation' },
  });
}

/** DELETE. O filtro é obrigatório pelo mesmo motivo do update. */
export async function remover(tabela, filtros) {
  if (!filtros || Object.keys(filtros).length === 0) {
    throw new ErroBanco(
      'Exclusão sem filtro é bloqueada: apagaria todos os registros.',
      400
    );
  }

  return requisitar(`/${tabela}?${montarParametros(filtros)}`, {
    metodo: 'DELETE',
    cabecalhos: { Prefer: 'return=representation' },
  });
}

/** Executa uma função SQL criada no banco (RPC). */
export async function chamarFuncao(nome, argumentos = {}) {
  return requisitar(`/rpc/${nome}`, { metodo: 'POST', corpo: argumentos });
}

/* -----------------------------------------------------------------------------
 * Diagnóstico
 * -------------------------------------------------------------------------- */

/**
 * Verifica se o banco está acessível e se o esquema foi aplicado.
 * @returns {Promise<{conectado: boolean, esquemaAplicado: boolean, mensagem: string, detalhes?: object}>}
 */
export async function verificarConexao() {
  if (!bancoConfigurado) {
    return {
      conectado: false,
      esquemaAplicado: false,
      mensagem:
        'Credenciais ausentes. Preencha SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env',
    };
  }

  try {
    const categorias = await selecionar('categories', {
      colunas: 'slug,nome',
      limite: 50,
    });

    let produtos = 0;
    try {
      const lista = await selecionar('catalogo_publico', { colunas: 'id', limite: 200 });
      produtos = lista.length;
    } catch {
      // A visão pode não existir ainda; não é motivo para falhar o diagnóstico.
    }

    return {
      conectado: true,
      esquemaAplicado: true,
      mensagem: 'Banco acessível e esquema aplicado.',
      detalhes: { categorias: categorias.length, produtosPublicados: produtos },
    };
  } catch (erro) {
    // 404 na tabela significa: conectou, mas o SQL ainda não foi executado.
    const esquemaFaltando =
      erro.status === 404 ||
      /relation .* does not exist|could not find the table/i.test(erro.message);

    if (esquemaFaltando) {
      return {
        conectado: true,
        esquemaAplicado: false,
        mensagem:
          'Conectado ao Supabase, mas o esquema ainda não foi criado. ' +
          'Execute os arquivos de database/ no SQL Editor.',
      };
    }

    return { conectado: false, esquemaAplicado: false, mensagem: erro.message };
  }
}

export default {
  bancoConfigurado,
  selecionar,
  selecionarUm,
  inserir,
  atualizar,
  remover,
  chamarFuncao,
  verificarConexao,
  ErroBanco,
};
