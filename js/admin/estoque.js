/**
 * admin/estoque.js
 * -----------------------------------------------------------------------------
 * Painel administrativo — estoque: saldo, movimentos e alertas.
 *
 * DISPONÍVEL ≠ QUANTIDADE
 *   `quantidade` é o que existe fisicamente. `reservado` é o que já pertence
 *   a pedidos em andamento. O número que decide se a loja aceita mais um
 *   pedido é a diferença entre os dois — e é ele que aparece em destaque.
 *
 * POR QUE TODO AJUSTE PEDE UM TIPO
 *   "Sumiram 3 brownies" pode ser venda fora do site, perda por quebra ou
 *   erro de contagem anterior. São histórias diferentes, e daqui a um mês
 *   ninguém lembra qual foi. O tipo e o motivo ficam gravados em
 *   `inventory_movements` junto com quem fez o ajuste.
 *
 * ⚠️ O SALDO E O HISTÓRICO MUDAM JUNTOS
 *   Quem grava os dois é a função `ajustar_estoque`, no banco, numa transação
 *   só. Não existe caminho que altere o saldo sem deixar registro.
 */

import { iniciarPainel, tratarErroDeSessao } from './sessao.js';
import { api } from '../lib/api.js';
import {
  $,
  criar,
  toastSucesso,
  toastErro,
  botaoCarregando,
  renderizarEstadoVazio,
  debounce,
} from '../lib/ui.js';
import { dataHora } from '../lib/format.js';

let produtos = [];
let tiposMovimento = {};
let busca = '';

/* =============================================================================
 * CARTÃO DO PRODUTO
 * ========================================================================== */

function saldo(produto) {
  const estoque = produto.estoque;

  if (!estoque) {
    return criar('span', { class: 'admin-saldo', texto: '—' });
  }

  if (estoque.sobEncomenda) {
    return criar('div', { class: 'admin-saldo' }, [
      criar('span', { class: 'admin-saldo__numero', texto: '∞' }),
      criar('span', { class: 'admin-saldo__rotulo', texto: 'Sob encomenda' }),
    ]);
  }

  const critico = estoque.disponivel <= estoque.alertaMinimo;

  return criar(
    'div',
    { class: `admin-saldo${critico ? ' admin-saldo--critico' : ''}` },
    [
      criar('span', {
        class: 'admin-saldo__numero',
        texto: String(estoque.disponivel),
      }),
      criar('span', { class: 'admin-saldo__rotulo', texto: 'disponíveis' }),
      estoque.reservado > 0
        ? criar('span', {
            class: 'texto-mini texto-suave',
            texto: `${estoque.quantidade} em estoque · ${estoque.reservado} reservado(s)`,
          })
        : null,
    ]
  );
}

/** Formulário de movimento: tipo, quantidade e motivo. */
function formularioMovimento(produto) {
  const tipo = criar('select', {
    class: 'campo__controle',
    'aria-label': `Tipo de movimento para ${produto.nome}`,
  });

  tipo.append(
    ...Object.entries(tiposMovimento).map(([valor, rotulo]) =>
      criar('option', { value: valor, texto: rotulo })
    )
  );

  const quantidade = criar('input', {
    class: 'campo__controle',
    type: 'number',
    min: '0',
    value: '1',
    'aria-label': `Quantidade para ${produto.nome}`,
  });

  const motivo = criar('input', {
    class: 'campo__controle',
    type: 'text',
    maxlength: '300',
    placeholder: 'Motivo (opcional)',
    'aria-label': `Motivo do movimento em ${produto.nome}`,
  });

  // "Contagem" não soma nem subtrai: informa o total encontrado na prateleira.
  // Trocar o texto de apoio evita o erro de digitar 3 querendo dizer "tirar 3"
  // e acabar zerando o estoque para 3.
  const apoio = criar('span', { class: 'campo__ajuda' });

  const atualizarApoio = () => {
    apoio.textContent =
      tipo.value === 'ajuste'
        ? 'Informe o total contado na prateleira — vira o novo saldo.'
        : 'Informe quantas unidades entraram ou saíram.';
  };

  tipo.addEventListener('change', atualizarApoio);
  atualizarApoio();

  const registrar = criar('button', {
    class: 'btn btn--primario btn--pequeno',
    type: 'button',
    texto: 'Registrar',
    on: {
      click: (evento) =>
        enviarMovimento(
          produto,
          { tipo: tipo.value, quantidade: Number(quantidade.value), motivo: motivo.value },
          evento.currentTarget
        ),
    },
  });

  return criar('div', { class: 'admin-movimento' }, [
    criar('div', { class: 'admin-movimento__campos' }, [tipo, quantidade, motivo, registrar]),
    apoio,
  ]);
}

/** Alerta mínimo e produção sob encomenda. */
function configuracao(produto) {
  const estoque = produto.estoque;

  const minimo = criar('input', {
    class: 'campo__controle campo__controle--curto',
    type: 'number',
    min: '0',
    value: String(estoque?.alertaMinimo ?? 5),
    'aria-label': `Alerta mínimo de ${produto.nome}`,
  });

  const sobEncomenda = criar('input', {
    type: 'checkbox',
    id: `encomenda-${produto.id}`,
    checked: Boolean(estoque?.sobEncomenda),
  });

  const salvar = criar('button', {
    class: 'btn btn--secundario btn--pequeno',
    type: 'button',
    texto: 'Salvar',
    on: {
      click: (evento) =>
        salvarConfiguracao(
          produto,
          {
            alertaMinimo: Number(minimo.value),
            sobEncomenda: sobEncomenda.checked,
          },
          evento.currentTarget
        ),
    },
  });

  return criar('div', { class: 'admin-config' }, [
    criar('label', { class: 'texto-mini', texto: 'Avisar quando restar' }),
    minimo,
    criar('label', { class: 'campo-marcavel', for: `encomenda-${produto.id}` }, [
      sobEncomenda,
      criar('span', { texto: 'Produzido sob encomenda' }),
    ]),
    salvar,
  ]);
}

function criarCartao(produto) {
  const historico = criar('div', { class: 'admin-historico' });

  const verHistorico = criar('button', {
    class: 'btn btn--secundario btn--pequeno',
    type: 'button',
    texto: 'Ver histórico',
    on: { click: (evento) => alternarHistorico(produto, historico, evento.currentTarget) },
  });

  return criar('article', { class: 'admin-estoque-item', dataset: { id: produto.id } }, [
    criar('div', { class: 'admin-estoque-item__topo' }, [
      criar('div', {}, [
        criar('h3', { class: 'admin-produto__nome', texto: produto.nome }),
        criar('span', {
          class: 'texto-mini texto-suave',
          texto: produto.publicado ? 'No ar' : 'Rascunho',
        }),
      ]),
      saldo(produto),
    ]),

    formularioMovimento(produto),
    configuracao(produto),

    criar('div', { class: 'mt-3' }, [verHistorico]),
    historico,
  ]);
}

/* =============================================================================
 * AÇÕES
 * ========================================================================== */

async function enviarMovimento(produto, movimento, botao) {
  if (!Number.isInteger(movimento.quantidade) || movimento.quantidade < 0) {
    toastErro('Informe uma quantidade válida.');
    return;
  }

  botaoCarregando(botao, true);

  try {
    const resposta = await api.post(`/admin/estoque/${produto.id}`, movimento);

    toastSucesso(resposta.mensagem);
    await carregar();
  } catch (erro) {
    if (await tratarErroDeSessao(erro)) return;
    toastErro(erro.message || 'Não conseguimos registrar o movimento.');
  } finally {
    botaoCarregando(botao, false);
  }
}

async function salvarConfiguracao(produto, config, botao) {
  botaoCarregando(botao, true);

  try {
    await api.patch(`/admin/estoque/${produto.id}`, config);

    toastSucesso('Configuração salva.');
    await carregar();
  } catch (erro) {
    if (await tratarErroDeSessao(erro)) return;
    toastErro(erro.message || 'Não conseguimos salvar.');
  } finally {
    botaoCarregando(botao, false);
  }
}

async function alternarHistorico(produto, container, botao) {
  if (container.childElementCount > 0) {
    container.replaceChildren();
    botao.textContent = 'Ver histórico';
    return;
  }

  botaoCarregando(botao, true);

  try {
    const { movimentos } = await api.get(`/admin/estoque/${produto.id}/movimentos`);

    botao.textContent = 'Esconder histórico';

    if (movimentos.length === 0) {
      container.replaceChildren(
        criar('p', {
          class: 'texto-mini texto-suave',
          texto: 'Nenhum movimento registrado ainda.',
        })
      );
      return;
    }

    container.replaceChildren(
      criar(
        'ul',
        { class: 'admin-historico__lista' },
        movimentos.map((m) =>
          criar('li', {}, [
            criar('span', {
              // Entrada e saída merecem cores diferentes: a leitura do
              // histórico é visual, não de texto corrido.
              class: `admin-historico__delta ${m.quantidade > 0 ? 'positivo' : 'negativo'}`,
              texto: `${m.quantidade > 0 ? '+' : ''}${m.quantidade}`,
            }),
            criar('span', { class: 'admin-historico__tipo', texto: m.tipoRotulo }),
            criar('span', {
              class: 'texto-mini texto-suave',
              texto: m.motivo || (m.pedidoId ? 'Pedido' : '—'),
            }),
            criar('span', {
              class: 'texto-mini texto-suave',
              texto: `saldo ${m.saldoApos}`,
            }),
            criar('time', { class: 'texto-mini texto-suave', texto: dataHora(m.criadoEm) }),
          ])
        )
      )
    );
  } catch (erro) {
    if (await tratarErroDeSessao(erro)) return;
    toastErro(erro.message || 'Não conseguimos carregar o histórico.');
  } finally {
    botaoCarregando(botao, false);
  }
}

/* =============================================================================
 * LISTA
 * ========================================================================== */

function renderizarLista() {
  const lista = $('[data-lista-estoque]');
  if (!lista) return;

  if (produtos.length === 0) {
    renderizarEstadoVazio(lista, {
      icone: 'caixa',
      titulo: busca ? 'Nenhum produto com esse nome' : 'Nenhum produto ativo',
      texto: busca
        ? 'Tente outro termo.'
        : 'Cadastre produtos na tela de catálogo para controlar o estoque.',
      acao: busca ? null : { texto: 'Ir para produtos', href: './produtos.html' },
    });
    return;
  }

  const criticos = produtos.filter(
    (p) => p.estoque && !p.estoque.sobEncomenda && p.estoque.disponivel <= p.estoque.alertaMinimo
  ).length;

  lista.replaceChildren(
    criar('p', {
      class: 'texto-mini texto-suave',
      texto:
        criticos > 0
          ? `${produtos.length} produto(s) · ${criticos} abaixo do mínimo`
          : `${produtos.length} produto(s) · estoque em dia`,
    }),
    ...produtos.map(criarCartao)
  );
}

async function carregar() {
  const lista = $('[data-lista-estoque]');

  lista?.replaceChildren(
    criar('p', { class: 'texto-suave texto-centro', texto: 'Carregando…' })
  );

  try {
    const resposta = await api.get('/admin/estoque', { busca });

    produtos = resposta.produtos;
    tiposMovimento = resposta.tipos;

    renderizarLista();
  } catch (erro) {
    console.error('[admin] Falha ao carregar o estoque:', erro);

    if (await tratarErroDeSessao(erro)) return;

    renderizarEstadoVazio(lista, {
      icone: 'alerta',
      titulo: 'Não conseguimos carregar o estoque',
      texto: erro.message || 'Tente novamente em instantes.',
      acao: { texto: 'Tentar de novo', onClick: carregar },
    });
  }
}

/* =============================================================================
 * INÍCIO
 * ========================================================================== */

function iniciar() {
  iniciarPainel({
    titulo: 'Estoque',
    aoEntrar: () => {
      $('[data-busca]')?.addEventListener(
        'input',
        debounce((evento) => {
          busca = evento.target.value;
          carregar();
        }, 400)
      );

      carregar();
    },
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', iniciar);
} else {
  iniciar();
}
