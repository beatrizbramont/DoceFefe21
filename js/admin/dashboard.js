/**
 * admin/dashboard.js
 * -----------------------------------------------------------------------------
 * Painel administrativo — visão geral.
 *
 * O QUE ESTA TELA RESPONDE
 *   "Como foi o mês?" e "o que precisa de mim agora?". São duas perguntas
 *   diferentes, e por isso dois blocos separados: os números do período, que
 *   servem para decidir; e a fila de trabalho, que serve para agir.
 *
 * ⚠️ FATURAMENTO AQUI É DINHEIRO CONFERIDO
 *   Só entram pedidos cujo pagamento a loja já conferiu no extrato. Somar
 *   pedido criado daria um número maior e falso — parte deles nunca é paga.
 *   Quem aplica essa regra é a função `resumo_admin`, no banco.
 */

import { iniciarPainel, tratarErroDeSessao } from './sessao.js';
import { api } from '../lib/api.js';
import { $, criar, renderizarEstadoVazio } from '../lib/ui.js';
import { moeda, plural } from '../lib/format.js';

let periodoAtual = 30;

const ROTULOS_PERIODO = {
  7: 'Últimos 7 dias',
  30: 'Últimos 30 dias',
  90: 'Últimos 3 meses',
  365: 'Último ano',
};

/* =============================================================================
 * BLOCOS
 * ========================================================================== */

function metrica({ rotulo, valor, apoio, destaque = false, alerta = false }) {
  return criar(
    'div',
    {
      class:
        'admin-metrica' +
        (destaque ? ' admin-metrica--destaque' : '') +
        (alerta ? ' admin-metrica--alerta' : ''),
    },
    [
      criar('span', { class: 'admin-metrica__valor', texto: valor }),
      criar('span', { class: 'admin-metrica__rotulo', texto: rotulo }),
      apoio ? criar('span', { class: 'admin-metrica__apoio', texto: apoio }) : null,
    ]
  );
}

function renderizarPeriodos(periodos) {
  const container = $('[data-periodos]');
  if (!container) return;

  container.replaceChildren(
    ...periodos.map((dias) =>
      criar('button', {
        class: `filtro-chip${periodoAtual === dias ? ' filtro-chip--ativo' : ''}`,
        type: 'button',
        texto: ROTULOS_PERIODO[dias] || `${dias} dias`,
        on: {
          click: () => {
            periodoAtual = dias;
            carregar();
          },
        },
      })
    )
  );
}

function renderizarMetricas(resumo) {
  const container = $('[data-metricas]');
  if (!container) return;

  container.replaceChildren(
    metrica({
      rotulo: 'Faturamento',
      valor: moeda(resumo.faturamento),
      apoio: plural(resumo.pedidosPagos, 'pedido pago', 'pedidos pagos'),
      destaque: true,
    }),
    metrica({
      rotulo: 'Ticket médio',
      valor: moeda(resumo.ticketMedio),
      apoio: 'por pedido pago',
    }),
    metrica({
      rotulo: 'Clientes novos',
      valor: String(resumo.clientesNovos),
      apoio: 'cadastros no período',
    }),
    metrica({
      rotulo: 'No catálogo',
      valor: String(resumo.catalogo.publicados),
      apoio: `${resumo.catalogo.rascunhos} em rascunho`,
    })
  );
}

function renderizarFila(fila) {
  const container = $('[data-fila]');
  if (!container) return;

  // A fila NÃO respeita o período escolhido, de propósito: um comprovante de
  // dois meses atrás esperando conferência continua esperando hoje.
  const itens = [
    { rotulo: 'A conferir', valor: fila.aConferir, alerta: fila.aConferir > 0 },
    { rotulo: 'Aguardando pagamento', valor: fila.aguardandoPagamento },
    { rotulo: 'Em preparação', valor: fila.emPreparacao },
    { rotulo: 'A entregar', valor: fila.aEntregar },
  ];

  container.replaceChildren(
    ...itens.map((item) =>
      metrica({
        rotulo: item.rotulo,
        valor: String(item.valor),
        alerta: Boolean(item.alerta),
      })
    ),
    criar('a', {
      class: 'btn btn--secundario btn--pequeno admin-metricas__acao',
      href: './pedidos.html',
      texto: 'Ver pedidos',
    })
  );
}

function renderizarMaisVendidos(lista) {
  const container = $('[data-mais-vendidos]');
  if (!container) return;

  if (lista.length === 0) {
    container.replaceChildren(
      criar('p', {
        class: 'texto-pequeno texto-suave sem-margem',
        texto: 'Nenhuma venda confirmada neste período.',
      })
    );
    return;
  }

  container.replaceChildren(
    criar(
      'ol',
      { class: 'admin-ranking' },
      lista.map((produto, indice) =>
        criar('li', {}, [
          criar('span', { class: 'admin-ranking__posicao', texto: `${indice + 1}º` }),
          criar('span', { class: 'admin-ranking__nome', texto: produto.nome }),
          criar('span', {
            class: 'texto-mini texto-suave',
            texto: plural(produto.quantidade, 'unidade', 'unidades'),
          }),
          criar('strong', { class: 'preco', texto: moeda(produto.total) }),
        ])
      )
    )
  );
}

function renderizarEstoqueBaixo(lista) {
  const container = $('[data-estoque-baixo]');
  if (!container) return;

  if (lista.length === 0) {
    container.replaceChildren(
      criar('p', {
        class: 'texto-pequeno texto-suave sem-margem',
        texto: 'Nenhum produto abaixo do mínimo. Estoque em dia.',
      })
    );
    return;
  }

  container.replaceChildren(
    criar(
      'ul',
      { class: 'admin-ranking' },
      lista.map((produto) =>
        criar('li', {}, [
          criar('span', { class: 'admin-ranking__nome', texto: produto.nome }),
          criar('span', {
            class: `selo ${produto.disponivel <= 0 ? 'selo--erro' : 'selo--aviso'}`,
            texto:
              produto.disponivel <= 0
                ? 'Esgotado'
                : plural(produto.disponivel, 'restante', 'restantes'),
          }),
          criar('span', {
            class: 'texto-mini texto-suave',
            texto: `mínimo ${produto.minimo}`,
          }),
        ])
      )
    ),
    criar('a', {
      class: 'btn btn--secundario btn--pequeno mt-4',
      href: './estoque.html',
      texto: 'Ajustar estoque',
    })
  );
}

/* =============================================================================
 * CARGA
 * ========================================================================== */

async function carregar() {
  const metricas = $('[data-metricas]');

  metricas?.replaceChildren(
    criar('p', { class: 'texto-suave texto-centro', texto: 'Carregando…' })
  );

  try {
    const { resumo, periodos } = await api.get('/admin/resumo', { dias: periodoAtual });

    renderizarPeriodos(periodos);
    renderizarMetricas(resumo);
    renderizarFila(resumo.fila);
    renderizarMaisVendidos(resumo.maisVendidos);
    renderizarEstoqueBaixo(resumo.estoqueBaixo);
  } catch (erro) {
    console.error('[admin] Falha ao carregar o resumo:', erro);

    if (await tratarErroDeSessao(erro)) return;

    renderizarEstadoVazio(metricas, {
      icone: '⚠️',
      titulo: 'Não conseguimos carregar os números',
      texto: erro.message || 'Tente novamente em instantes.',
      acao: { texto: 'Tentar de novo', onClick: carregar },
    });
  }
}

/* =============================================================================
 * INÍCIO
 * ========================================================================== */

function iniciar() {
  iniciarPainel({ titulo: 'Visão geral', aoEntrar: carregar });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', iniciar);
} else {
  iniciar();
}
