/**
 * admin/separacao.js
 * -----------------------------------------------------------------------------
 * Painel administrativo — o que precisa sair da cozinha num dia.
 *
 * A TELA RESPONDE UMA PERGUNTA SÓ
 *   "O que eu produzo e separo para este dia?" Por isso ela abre com o
 *   somatório por produto — 18 brownies — e não com a lista de pedidos. Não
 *   interessa que o brownie está em seis pedidos diferentes na hora de
 *   assar; interessa na hora de embalar, e aí vêm as duas listas de baixo.
 *
 * ⚠️ A DATA É A DESEJADA PELO CLIENTE
 *   Não é a data em que a venda entrou. Um pedido feito hoje para sexta não
 *   entra na produção de hoje — e confundir as duas faria a loja produzir no
 *   dia errado.
 *
 * A FOLHA IMPRESSA É A ENTREGA DESTA TELA
 *   O botão de imprimir não gera arquivo nenhum: chama a janela de impressão
 *   do navegador, que também sabe salvar em PDF. Os estilos @media print em
 *   admin.css escondem menu, filtros e botões — no papel só fica o que vai
 *   para a bancada.
 */

import { iniciarPainel, tratarErroDeSessao } from './sessao.js';
import { api } from '../lib/api.js';
import { icone } from '../components/icons.js';
import { $, criar, renderizarEstadoVazio, toastErro } from '../lib/ui.js';
import { moeda, data as formatarData, telefone as formatarTelefone } from '../lib/format.js';
import { descreverStatus } from '../lib/status-pedido.js';

/* =============================================================================
 * ESTADO
 * ========================================================================== */

/** 'AAAA-MM-DD'. Vazio significa "pedidos sem dia combinado". */
let dataAtual = hoje();
let filtroAtual = 'a-produzir';
let separacao = null;

const FILTROS = [
  { valor: 'a-produzir', rotulo: 'A produzir' },
  { valor: 'a-entregar', rotulo: 'Prontos e a caminho' },
  { valor: 'abertos', rotulo: 'Todos em aberto' },
  { valor: 'todos', rotulo: 'Tudo, inclusive entregues' },
];

/**
 * A data de HOJE no fuso de quem está olhando.
 *
 * `toISOString()` converteria para UTC e, depois das 21h no horário de
 * Brasília, devolveria o dia seguinte — a loja abriria a tela já no dia
 * errado. Montar a string a partir dos componentes locais evita isso.
 */
function hoje(deslocamentoDias = 0) {
  const d = new Date();
  d.setDate(d.getDate() + deslocamentoDias);

  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');

  return `${d.getFullYear()}-${mes}-${dia}`;
}

/* =============================================================================
 * CABEÇALHO DA FOLHA
 * ========================================================================== */

function renderizarCabecalhoFolha() {
  const container = $('[data-cabecalho-folha]');
  if (!container) return;

  const titulo = dataAtual
    ? `Separação de ${formatarData(`${dataAtual}T12:00:00`)}`
    : 'Pedidos sem dia combinado';

  container.replaceChildren(
    criar('div', {}, [
      criar('strong', { texto: 'Doce Fefê.21' }),
      criar('span', { class: 'folha__titulo', texto: titulo }),
    ]),
    criar('span', {
      class: 'texto-mini',
      texto: `Impresso em ${formatarData(new Date())}`,
    })
  );
}

/* =============================================================================
 * BLOCOS
 * ========================================================================== */

function renderizarTotais(totais) {
  const container = $('[data-totais]');
  if (!container) return;

  const metrica = (rotulo, valor) =>
    criar('div', { class: 'admin-metrica' }, [
      criar('span', { class: 'admin-metrica__valor', texto: String(valor) }),
      criar('span', { class: 'admin-metrica__rotulo', texto: rotulo }),
    ]);

  container.replaceChildren(
    metrica('Pedidos', totais.pedidos),
    metrica('Unidades', totais.itens),
    metrica('Valor', moeda(totais.valor))
  );
}

/**
 * A lista de produção.
 *
 * Cada linha começa com uma caixa vazia: no papel, é onde se risca o que já
 * saiu do forno. É o detalhe que transforma a folha em ferramenta de bancada
 * em vez de relatório para arquivar.
 */
function renderizarProducao(producao) {
  const container = $('[data-producao]');
  if (!container) return;

  if (producao.length === 0) {
    container.replaceChildren(
      criar('p', {
        class: 'texto-pequeno texto-suave sem-margem',
        texto: 'Nada a produzir com este filtro.',
      })
    );
    return;
  }

  container.replaceChildren(
    criar(
      'ul',
      { class: 'lista-separacao' },
      producao.map((item) =>
        criar('li', {}, [
          criar('span', { class: 'marcador', 'aria-hidden': 'true' }),
          criar('span', { class: 'lista-separacao__qtd', texto: `${item.quantidade}×` }),
          criar('span', { class: 'lista-separacao__nome', texto: item.nome }),
        ])
      )
    )
  );
}

function criarPedido(pedido) {
  const status = descreverStatus(pedido.status);

  const filhos = [
    criar('div', { class: 'pedido-separacao__topo' }, [
      criar('span', { class: 'marcador', 'aria-hidden': 'true' }),
      criar('span', { class: 'admin-pedido__codigo', texto: pedido.codigo }),
      criar('span', { class: 'pedido-separacao__cliente', texto: pedido.cliente }),
      criar('span', { class: `selo ${status.classe} sem-impressao`, texto: status.rotulo }),
    ]),

    criar(
      'ul',
      { class: 'admin-pedido__itens' },
      pedido.itens.map((item) =>
        criar('li', {}, [
          criar('span', { class: 'admin-pedido__qtd', texto: `${item.quantidade}×` }),
          criar('span', { texto: item.nome }),
        ])
      )
    ),
  ];

  // O endereço só importa para entrega — e aí importa muito, porque é o que
  // o entregador lê.
  if (pedido.tipoEntrega === 'entrega' && pedido.endereco) {
    const e = pedido.endereco;

    filhos.push(
      criar('p', { class: 'pedido-separacao__endereco' }, [
        criar('span', {
          texto:
            `${e.logradouro}, ${e.numero}` +
            `${e.complemento ? ` — ${e.complemento}` : ''}` +
            ` · ${e.bairro}, ${e.cidade}/${e.estado}` +
            ` · CEP ${e.cep}` +
            `${e.referencia ? ` · Ref: ${e.referencia}` : ''}`,
        }),
      ])
    );
  }

  filhos.push(
    criar('p', { class: 'texto-mini texto-suave sem-margem' }, [
      criar('span', { texto: `WhatsApp ${formatarTelefone(pedido.whatsapp)}` }),
    ])
  );

  // Observação do cliente é o que mais gera erro quando passa despercebido:
  // "sem nozes", "escrever Parabéns na caixa". Ganha destaque na folha.
  if (pedido.observacoes) {
    filhos.push(
      criar('p', { class: 'pedido-separacao__observacao' }, [
        criar('strong', { texto: 'Atenção: ' }),
        criar('span', { texto: pedido.observacoes }),
      ])
    );
  }

  return criar('article', { class: 'pedido-separacao' }, filhos);
}

function renderizarLista(seletor, pedidos, vazio) {
  const container = $(seletor);
  if (!container) return;

  if (pedidos.length === 0) {
    container.replaceChildren(
      criar('p', { class: 'texto-pequeno texto-suave sem-margem', texto: vazio })
    );
    return;
  }

  container.replaceChildren(...pedidos.map(criarPedido));
}

/** Pedidos sem dia combinado: trabalho pendente que não pode ficar invisível. */
function renderizarAvisoSemData(totais) {
  const container = $('[data-aviso-sem-data]');
  if (!container) return;

  if (!dataAtual || !totais.semData) {
    container.replaceChildren();
    return;
  }

  container.replaceChildren(
    criar('div', { class: 'alerta alerta--aviso' }, [
      criar('span', { texto: '!', 'aria-hidden': 'true' }),
      criar('div', {}, [
        criar('p', {
          class: 'sem-margem',
          texto: `${totais.semData} pedido(s) sem dia combinado com o cliente.`,
        }),
        criar('button', {
          class: 'btn btn--secundario btn--pequeno mt-2',
          type: 'button',
          texto: 'Ver esses pedidos',
          on: {
            click: () => {
              dataAtual = '';
              const campo = $('[data-data]');
              if (campo) campo.value = '';
              carregar();
            },
          },
        }),
      ]),
    ])
  );
}

/* =============================================================================
 * FILTROS E ATALHOS
 * ========================================================================== */

function renderizarFiltros() {
  const container = $('[data-filtros-separacao]');
  if (!container) return;

  container.replaceChildren(
    ...FILTROS.map((f) =>
      criar('button', {
        class: `filtro-chip${filtroAtual === f.valor ? ' filtro-chip--ativo' : ''}`,
        type: 'button',
        texto: f.rotulo,
        on: {
          click: () => {
            filtroAtual = f.valor;
            carregar();
          },
        },
      })
    )
  );
}

function renderizarAtalhos() {
  const container = $('[data-atalhos-data]');
  if (!container) return;

  const atalhos = [
    { rotulo: 'Hoje', valor: hoje() },
    { rotulo: 'Amanhã', valor: hoje(1) },
    { rotulo: 'Sem data', valor: '' },
  ];

  container.replaceChildren(
    ...atalhos.map((a) =>
      criar('button', {
        class: `btn btn--pequeno ${dataAtual === a.valor ? 'btn--primario' : 'btn--secundario'}`,
        type: 'button',
        texto: a.rotulo,
        on: {
          click: () => {
            dataAtual = a.valor;
            const campo = $('[data-data]');
            if (campo) campo.value = a.valor;
            carregar();
          },
        },
      })
    )
  );
}

/* =============================================================================
 * CARGA
 * ========================================================================== */

async function carregar() {
  const producao = $('[data-producao]');

  producao?.replaceChildren(
    criar('p', { class: 'texto-suave texto-centro', texto: 'Carregando…' })
  );

  try {
    // `data` vazia é intencional — o servidor entende como "sem dia
    // combinado". Por isso vai pela URL montada à mão, e não pelo atalho
    // `query`, que descarta valores vazios.
    separacao = await api.get(
      `/admin/separacao?filtro=${encodeURIComponent(filtroAtual)}` +
        `&data=${encodeURIComponent(dataAtual)}`
    );

    renderizarFiltros();
    renderizarAtalhos();
    renderizarCabecalhoFolha();
    renderizarTotais(separacao.totais);
    renderizarAvisoSemData(separacao.totais);
    renderizarProducao(separacao.producao);

    renderizarLista(
      '[data-entregas]',
      separacao.entregas,
      'Nenhuma entrega para este dia.'
    );

    renderizarLista(
      '[data-retiradas]',
      separacao.retiradas,
      'Nenhuma retirada para este dia.'
    );
  } catch (erro) {
    console.error('[admin] Falha ao carregar a separação:', erro);

    if (await tratarErroDeSessao(erro)) return;

    renderizarEstadoVazio(producao, {
      icone: 'alerta',
      titulo: 'Não conseguimos carregar os pedidos do dia',
      texto: erro.message || 'Tente novamente em instantes.',
      acao: { texto: 'Tentar de novo', onClick: carregar },
    });
  }
}

/* =============================================================================
 * IMPRESSÃO
 * ========================================================================== */

function imprimir() {
  if (!separacao || separacao.totais.pedidos === 0) {
    toastErro('Não há pedidos para imprimir neste dia.');
    return;
  }

  window.print();
}

/* =============================================================================
 * INÍCIO
 * ========================================================================== */

function iniciar() {
  iniciarPainel({
    titulo: 'Separação do dia',
    aoEntrar: () => {
      const campo = $('[data-data]');

      if (campo) {
        campo.value = dataAtual;

        campo.addEventListener('change', () => {
          dataAtual = campo.value;
          carregar();
        });
      }

      const botaoImprimir = $('[data-imprimir]');

      if (botaoImprimir) {
        botaoImprimir.prepend(icone('imprimir'));
        botaoImprimir.addEventListener('click', imprimir);
      }

      carregar();
    },
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', iniciar);
} else {
  iniciar();
}
