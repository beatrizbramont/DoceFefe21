/**
 * products.js
 * -----------------------------------------------------------------------------
 * Catálogo: busca, filtros, ordenação e paginação.
 *
 * Usado por produtos.html e pelas vitrines de index.html.
 *
 * O ESTADO FICA NA URL
 *   Filtros, busca e página são guardados na barra de endereço:
 *     produtos.html?categoria=brownies&ordenar=menor-preco&pagina=2
 *
 *   Isso dá três coisas de graça:
 *     1. O cliente pode compartilhar o link de uma busca.
 *     2. Voltar e avançar no navegador funcionam de verdade.
 *     3. Recarregar a página não perde os filtros.
 */

import { api, ErroApi } from './lib/api.js';
import {
  $,
  $$,
  criar,
  debounce,
  toastErro,
  mostrarEsqueletos,
  renderizarEstadoVazio,
} from './lib/ui.js';
import { plural, dataCurta } from './lib/format.js';
import { renderizarProdutos } from './components/product-card.js';
import { montarLinkWhatsApp } from './whatsapp.js';
import { CATEGORIAS, ROTAS, rota } from './config.js';

/* =============================================================================
 * ESTADO
 * ========================================================================== */

const ORDENACOES = [
  { valor: 'relevancia', rotulo: 'Mais relevantes' },
  { valor: 'mais-vendidos', rotulo: 'Mais vendidos' },
  { valor: 'novidades', rotulo: 'Novidades' },
  { valor: 'menor-preco', rotulo: 'Menor preço' },
  { valor: 'maior-preco', rotulo: 'Maior preço' },
  { valor: 'a-z', rotulo: 'Nome (A-Z)' },
  { valor: 'z-a', rotulo: 'Nome (Z-A)' },
];

/** Lê o estado atual da URL. A URL é a única fonte de verdade. */
function lerEstadoDaUrl() {
  const params = new URLSearchParams(window.location.search);

  return {
    busca: params.get('busca') || '',
    categoria: params.get('categoria') || '',
    ordenar: params.get('ordenar') || 'relevancia',
    promocao: params.get('promocao') === '1',
    pagina: Math.max(1, Number.parseInt(params.get('pagina'), 10) || 1),
  };
}

/**
 * Grava o estado na URL sem recarregar a página.
 * @param {object} estado
 * @param {boolean} [substituir] - true troca a entrada atual do histórico
 *        em vez de criar uma nova (usado ao digitar na busca, para não
 *        encher o histórico de uma entrada por tecla).
 */
function gravarEstadoNaUrl(estado, substituir = false) {
  const params = new URLSearchParams();

  if (estado.busca) params.set('busca', estado.busca);
  if (estado.categoria) params.set('categoria', estado.categoria);
  if (estado.ordenar && estado.ordenar !== 'relevancia') {
    params.set('ordenar', estado.ordenar);
  }
  if (estado.promocao) params.set('promocao', '1');
  if (estado.pagina > 1) params.set('pagina', String(estado.pagina));

  const consulta = params.toString();
  const url = consulta
    ? `${window.location.pathname}?${consulta}`
    : window.location.pathname;

  if (substituir) {
    window.history.replaceState(estado, '', url);
  } else {
    window.history.pushState(estado, '', url);
  }
}

/* =============================================================================
 * RENDERIZAÇÃO DOS FILTROS
 * ========================================================================== */

async function montarFiltroCategorias(estado, aoMudar) {
  const container = $('[data-filtro-categorias]');
  if (!container) return;

  // Começa com as categorias conhecidas do config, para a interface não
  // "piscar" vazia, e depois atualiza com os dados reais do banco.
  let categorias = CATEGORIAS.map((c) => ({ ...c, quantidade: null }));

  try {
    const resposta = await api.get('/categorias');
    if (resposta?.categorias?.length) categorias = resposta.categorias;
  } catch {
    // Mantém a lista local; não vale travar o catálogo por causa disto.
  }

  const criarBotao = ({ slug, nome, icone, quantidade, emBreve = false }) => {
    const ativo = estado.categoria === slug;

    const filhos = [];
    if (icone) {
      filhos.push(criar('span', { texto: icone, 'aria-hidden': 'true' }));
    }
    filhos.push(criar('span', { texto: nome }));

    if (emBreve) {
      filhos.push(criar('span', { class: 'filtro-chip__em-breve', texto: 'Em breve' }));
    } else if (quantidade !== null && quantidade !== undefined) {
      filhos.push(
        criar('span', { class: 'filtro-chip__contagem', texto: String(quantidade) })
      );
    }

    // Categoria "em breve" não filtra nada — clicar levaria a uma lista
    // vazia, o que pareceria erro. Fica desabilitada e explicada no title.
    return criar(
      'button',
      {
        class:
          `filtro-chip${ativo ? ' filtro-chip--ativo' : ''}` +
          `${emBreve ? ' filtro-chip--em-breve' : ''}`,
        type: 'button',
        // O slug fica no próprio botão: `atualizarChipsCategoria` compara por
        // ele, e não pelo texto visível.
        dataset: { slug },
        'aria-pressed': String(ativo),
        disabled: emBreve,
        title: emBreve ? 'Esta linha chega em breve!' : null,
        on: emBreve
          ? {}
          : {
              click: () => {
                // Clicar na categoria já ativa remove o filtro.
                aoMudar({ categoria: ativo ? '' : slug, pagina: 1 });
              },
            },
      },
      filhos
    );
  };

  const total = categorias.reduce((s, c) => s + (c.quantidade || 0), 0);

  container.replaceChildren(
    criarBotao({ slug: '', nome: 'Todos', icone: '🍬', quantidade: total || null }),
    ...categorias.map(criarBotao)
  );
}

/* =============================================================================
 * CATEGORIAS DA PÁGINA INICIAL
 * ========================================================================== */

/**
 * Renderiza os cartões de categoria da home a partir do banco.
 *
 * Ficavam fixos no HTML, mas aí o selo "Em breve" precisaria ser marcado em
 * dois lugares (aqui e no catálogo) — e um deles acabaria desatualizado.
 */
async function montarCategoriasHome() {
  const container = $('[data-categorias-home]');
  if (!container) return;

  let categorias = CATEGORIAS.map((c) => ({ ...c, emBreve: false }));

  try {
    const resposta = await api.get('/categorias');
    if (resposta?.categorias?.length) categorias = resposta.categorias;
  } catch {
    // Sem a API, usa a lista local do config — a home não fica vazia.
  }

  container.replaceChildren(
    ...categorias.map((categoria, indice) => {
      const filhos = [
        criar('span', {
          class: 'categoria__icone',
          texto: categoria.icone || '🍬',
          'aria-hidden': 'true',
        }),
        criar('span', { class: 'categoria__nome', texto: categoria.nome }),
      ];

      if (categoria.emBreve) {
        filhos.push(criar('span', { class: 'categoria__em-breve', texto: 'Em breve' }));

        // Um <div>, e não um <a>: link que não leva a lugar nenhum frustra,
        // e um href para uma lista vazia pareceria erro do site.
        return criar(
          'div',
          {
            class: 'categoria categoria--em-breve',
            dataset: { revelar: '', revelarAtraso: String(indice % 5) },
          },
          filhos
        );
      }

      return criar(
        'a',
        {
          class: 'categoria',
          href: `${rota(ROTAS.produtos)}?categoria=${encodeURIComponent(categoria.slug)}`,
          dataset: { revelar: '', revelarAtraso: String(indice % 5) },
        },
        filhos
      );
    })
  );

  // Os cartões nasceram depois que main.js ligou a revelação ao rolar, então
  // mostramos direto — senão ficariam invisíveis para sempre.
  container.querySelectorAll('[data-revelar]').forEach((el) => {
    el.classList.add('revelado');
  });
}

function montarSelectOrdenacao(estado, aoMudar) {
  const select = $('[data-ordenar]');
  if (!select) return;

  select.replaceChildren(
    ...ORDENACOES.map((o) =>
      criar('option', {
        value: o.valor,
        texto: o.rotulo,
        ...(estado.ordenar === o.valor ? { selected: true } : {}),
      })
    )
  );

  select.addEventListener('change', () => {
    aoMudar({ ordenar: select.value, pagina: 1 });
  });
}

function montarCampoBusca(estado, aoMudar) {
  const input = $('[data-busca]');
  if (!input) return;

  input.value = estado.busca;

  // `debounce` espera a pessoa parar de digitar: sem isso, cada tecla
  // dispararia uma consulta à API.
  const buscar = debounce((valor) => {
    aoMudar({ busca: valor, pagina: 1 }, true);
  }, 420);

  input.addEventListener('input', () => buscar(input.value));

  // Enter dispara a busca imediatamente, sem esperar o debounce.
  input.closest('form')?.addEventListener('submit', (evento) => {
    evento.preventDefault();
    aoMudar({ busca: input.value, pagina: 1 });
  });
}

/* =============================================================================
 * PAGINAÇÃO
 * ========================================================================== */

function montarPaginacao(resultado, aoMudar) {
  const container = $('[data-paginacao]');
  if (!container) return;

  const { pagina, totalPaginas } = resultado;

  if (totalPaginas <= 1) {
    container.replaceChildren();
    return;
  }

  const botao = (rotulo, destino, { desabilitado = false, atual = false } = {}) =>
    criar('button', {
      class: `paginacao__botao${atual ? ' paginacao__botao--atual' : ''}`,
      type: 'button',
      texto: rotulo,
      disabled: desabilitado,
      'aria-current': atual ? 'page' : null,
      'aria-label': atual ? `Página ${rotulo}, atual` : `Ir para a página ${rotulo}`,
      on: { click: () => aoMudar({ pagina: destino }) },
    });

  const filhos = [
    botao('‹', pagina - 1, { desabilitado: pagina === 1 }),
  ];

  // Mostra no máximo 5 números, centrados na página atual.
  const inicio = Math.max(1, Math.min(pagina - 2, totalPaginas - 4));
  const fim = Math.min(totalPaginas, inicio + 4);

  for (let i = inicio; i <= fim; i += 1) {
    filhos.push(botao(String(i), i, { atual: i === pagina }));
  }

  filhos.push(botao('›', pagina + 1, { desabilitado: pagina === totalPaginas }));

  container.replaceChildren(
    criar('nav', { class: 'paginacao', 'aria-label': 'Navegação de páginas' }, filhos)
  );
}

/* =============================================================================
 * CARREGAMENTO
 * ========================================================================== */

/** Guarda a requisição em andamento para poder cancelá-la. */
let requisicaoAtual = 0;

async function carregarProdutos(estado) {
  const grade = $('[data-grade-produtos]');
  const resumo = $('[data-resumo-resultados]');
  const paginacao = $('[data-paginacao]');
  if (!grade) return;

  const idRequisicao = ++requisicaoAtual;

  mostrarEsqueletos(grade, 8);
  grade.setAttribute('aria-busy', 'true');
  if (resumo) resumo.textContent = 'Carregando…';
  paginacao?.replaceChildren();

  try {
    const resultado = await api.get('/produtos', {
      busca: estado.busca,
      categoria: estado.categoria,
      ordenar: estado.ordenar,
      promocao: estado.promocao ? '1' : '',
      pagina: estado.pagina,
      porPagina: 12,
    });

    // Se outra busca começou enquanto esta respondia, descartamos o
    // resultado antigo — senão a tela poderia mostrar dados fora de ordem.
    if (idRequisicao !== requisicaoAtual) return;

    if (resultado.produtos.length === 0) {
      grade.style.gridTemplateColumns = '1fr';
      renderizarEstadoVazio(grade, {
        icone: '🔍',
        titulo: 'Nenhum doce encontrado',
        texto: estado.busca
          ? `Não achamos nada para "${estado.busca}". Tente outra palavra ou veja todas as categorias.`
          : 'Não há produtos nesta categoria no momento. Fale com a gente para saber o que tem hoje.',
        acao: {
          texto: 'Perguntar no WhatsApp',
          href: montarLinkWhatsApp('encomenda'),
        },
      });
      if (resumo) resumo.textContent = 'Nenhum resultado';
      paginacao?.replaceChildren();
      return;
    }

    grade.style.gridTemplateColumns = '';
    renderizarProdutos(grade, resultado.produtos);

    if (resumo) {
      const inicio = (resultado.pagina - 1) * resultado.porPagina + 1;
      const fim = Math.min(inicio + resultado.produtos.length - 1, resultado.total);
      resumo.textContent =
        resultado.total <= resultado.porPagina
          ? plural(resultado.total, 'produto', 'produtos')
          : `${inicio}–${fim} de ${plural(resultado.total, 'produto', 'produtos')}`;
    }

    montarPaginacao(resultado, aplicarMudanca);

    // Mostra o aviso de atacado quando o usuário é revendedor aprovado.
    const avisoAtacado = $('[data-aviso-atacado]');
    if (avisoAtacado) avisoAtacado.hidden = !resultado.atacado;

    // O aviso de preço de referência só aparece se algum produto EXIBIDO
    // ainda estiver com valor provisório. Com kits de preço real no mesmo
    // catálogo, um aviso fixo seria enganoso.
    const avisoDemo = $('[data-aviso-demonstracao]');
    if (avisoDemo) {
      avisoDemo.hidden = !resultado.produtos.some((p) => p.demonstracao);
    }
  } catch (erro) {
    if (idRequisicao !== requisicaoAtual) return;

    console.error('[products] Falha ao carregar:', erro);

    grade.style.gridTemplateColumns = '1fr';
    renderizarEstadoVazio(grade, {
      icone: '⚠️',
      titulo: 'Não conseguimos carregar o catálogo',
      texto:
        erro instanceof ErroApi && erro.status === 0
          ? 'Parece que a API não está no ar. Se você está desenvolvendo, rode: npm run server'
          : 'Tivemos um problema ao buscar os produtos. Tente novamente em instantes.',
      acao: { texto: 'Tentar novamente', onClick: () => carregarProdutos(estado) },
    });

    if (resumo) resumo.textContent = '';
    toastErro(erro.message || 'Falha ao carregar o catálogo.');
  }
}

/* =============================================================================
 * ORQUESTRAÇÃO
 * ========================================================================== */

let estadoAtual = lerEstadoDaUrl();

/** Aplica uma mudança parcial de estado, atualiza a URL e recarrega. */
function aplicarMudanca(mudancas, substituirHistorico = false) {
  estadoAtual = { ...estadoAtual, ...mudancas };
  gravarEstadoNaUrl(estadoAtual, substituirHistorico);

  atualizarChipsCategoria();
  carregarProdutos(estadoAtual);

  // Ao trocar de página, leva o usuário de volta ao topo da lista.
  if (mudancas.pagina && mudancas.pagina !== 1) {
    $('[data-grade-produtos]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

/** Reflete a categoria ativa nos botões, sem remontar a lista toda. */
function atualizarChipsCategoria() {
  $$('[data-filtro-categorias] .filtro-chip').forEach((botao) => {
    // O botão "Todos" tem slug vazio, que corresponde a "sem filtro".
    const ativo = (botao.dataset.slug || '') === estadoAtual.categoria;

    botao.classList.toggle('filtro-chip--ativo', ativo);
    botao.setAttribute('aria-pressed', String(ativo));
  });
}

async function iniciarCatalogo() {
  const grade = $('[data-grade-produtos]');
  if (!grade) return;

  await montarFiltroCategorias(estadoAtual, aplicarMudanca);
  montarSelectOrdenacao(estadoAtual, aplicarMudanca);
  montarCampoBusca(estadoAtual, aplicarMudanca);

  carregarProdutos(estadoAtual);

  // Botões voltar/avançar do navegador.
  window.addEventListener('popstate', () => {
    estadoAtual = lerEstadoDaUrl();
    montarFiltroCategorias(estadoAtual, aplicarMudanca);

    const select = $('[data-ordenar]');
    if (select) select.value = estadoAtual.ordenar;

    const input = $('[data-busca]');
    if (input) input.value = estadoAtual.busca;

    carregarProdutos(estadoAtual);
  });
}

/* =============================================================================
 * VITRINES DA PÁGINA INICIAL
 * ========================================================================== */

async function carregarVitrines() {
  const vitrines = $$('[data-vitrine]');
  if (vitrines.length === 0) return;

  vitrines.forEach((v) => mostrarEsqueletos(v, 4));

  try {
    const dados = await api.get('/vitrines', { limite: 4 });

    const mapa = {
      destaques: dados.destaques,
      'mais-vendidos': dados.maisVendidos,
      novidades: dados.novidades,
    };

    vitrines.forEach((container) => {
      const produtos = mapa[container.dataset.vitrine] || [];

      if (produtos.length === 0) {
        container.style.gridTemplateColumns = '1fr';
        renderizarEstadoVazio(container, {
          icone: '🍫',
          titulo: 'Em breve por aqui',
          texto: 'Estamos preparando esta seleção. Fale com a gente para saber o que tem hoje.',
          acao: { texto: 'Ver no WhatsApp', href: montarLinkWhatsApp('encomenda') },
        });
        return;
      }

      container.style.gridTemplateColumns = '';
      renderizarProdutos(container, produtos);
    });
  } catch (erro) {
    console.error('[products] Falha nas vitrines:', erro);

    vitrines.forEach((container) => {
      container.style.gridTemplateColumns = '1fr';
      renderizarEstadoVazio(container, {
        icone: '🍫',
        titulo: 'Nossos doces chegam em breve',
        texto:
          'Não conseguimos carregar o catálogo agora. Fale com a gente pelo WhatsApp para conhecer os sabores disponíveis.',
        acao: { texto: 'Ver sabores no WhatsApp', href: montarLinkWhatsApp('encomenda') },
      });
    });
  }
}

/* =============================================================================
 * VITRINE DE PROMOÇÕES
 *
 * A validade é controlada pelo BANCO: a coluna `promocao_ate` faz a visão
 * parar de aplicar o desconto quando a data passa (ver
 * database/09-promocoes-com-validade.sql).
 *
 * Então esta função não precisa saber de data nenhuma — ela pede os produtos
 * em promoção e, quando não houver, mostra o quadro vazio. No dia 11/12 a
 * seção se esvazia sozinha, sem ninguém mexer em nada.
 * ========================================================================== */

async function carregarPromocao() {
  const grade = $('[data-vitrine-promocao]');
  if (!grade) return;

  mostrarEsqueletos(grade, 1);

  try {
    const resultado = await api.get('/produtos', { promocao: '1', porPagina: 4 });

    if (resultado.produtos.length === 0) {
      grade.style.gridTemplateColumns = '1fr';
      renderizarEstadoVazio(grade, {
        icone: '🏷️',
        titulo: 'Nenhuma promoção no momento',
        texto:
          'Assim que tivermos uma oferta especial, ela aparece aqui. ' +
          'Acompanhe nosso Instagram para não perder.',
        acao: { texto: 'Ver todos os doces', href: rota(ROTAS.produtos) },
      });
      return;
    }

    grade.style.gridTemplateColumns = '';
    renderizarProdutos(grade, resultado.produtos);

    // Mostra até quando vale, usando a data que veio do servidor.
    const prazo = $('[data-prazo-promocao]');
    const comPrazo = resultado.produtos.find((p) => p.promocaoAte);

    if (prazo && comPrazo) {
      prazo.textContent = `Válido até ${dataCurta(comPrazo.promocaoAte)}`;
      prazo.hidden = false;
    } else if (prazo) {
      prazo.hidden = true;
    }
  } catch (erro) {
    console.error('[products] Falha nas promoções:', erro);

    grade.style.gridTemplateColumns = '1fr';
    renderizarEstadoVazio(grade, {
      icone: '🏷️',
      titulo: 'Nenhuma promoção no momento',
      texto: 'Acompanhe nosso Instagram para ficar por dentro das ofertas.',
      acao: { texto: 'Ver todos os doces', href: rota(ROTAS.produtos) },
    });
  }
}

/* =============================================================================
 * INÍCIO
 * ========================================================================== */

function iniciar() {
  iniciarCatalogo();
  carregarVitrines();
  montarCategoriasHome();
  carregarPromocao();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', iniciar);
} else {
  iniciar();
}

export { carregarVitrines, iniciarCatalogo };
