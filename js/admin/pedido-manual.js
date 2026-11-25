/**
 * admin/pedido-manual.js
 * -----------------------------------------------------------------------------
 * A loja lançando um pedido, e desfazendo um pedido.
 *
 * O QUE ESTA TELA RESOLVE
 *   A maior parte da venda fecha no WhatsApp: a cliente manda mensagem,
 *   combina, paga no Pix. Antes da Fase 13 esse pedido não existia para o
 *   sistema — não baixava estoque, não contava no faturamento e não aparecia
 *   na separação do dia. O painel mostrava uma loja menor do que ela é.
 *
 * ⚠️ NÃO EXISTE CAMPO DE PREÇO, DE PROPÓSITO
 *   O total que aparece aqui é só conferência visual. Quem decide quanto
 *   custa é o banco, dentro de `criar_pedido`. Se a loja pudesse digitar o
 *   preço, a promoção valeria no site e outra coisa no WhatsApp — e nenhum
 *   relatório saberia qual está certo.
 *
 * ⚠️ A INTERFACE NÃO É A PROTEÇÃO
 *   Toda rota /api/admin/* passa por `exigirAdmin` no servidor. Esconder
 *   estes botões é conveniência, não segurança.
 */

import { api } from '../lib/api.js';
import { icone } from '../components/icons.js';
import {
  criar,
  toastSucesso,
  toastErro,
  botaoCarregando,
  confirmar,
} from '../lib/ui.js';
import { moeda } from '../lib/format.js';

/* =============================================================================
 * OPÇÕES
 * ========================================================================== */

/**
 * De onde a venda veio.
 *
 * `site` não está aqui de propósito: um pedido lançado à mão nunca nasceu do
 * site, e deixar a opção disponível corromperia a resposta de "quanto a loja
 * vende sozinha?". O banco também recusa.
 */
const ORIGENS = [
  ['whatsapp', 'WhatsApp'],
  ['instagram', 'Instagram'],
  ['presencial', 'Presencial'],
];

const METODOS = [
  ['pix', 'Pix'],
  ['dinheiro', 'Dinheiro'],
  ['cartao_credito', 'Cartão de crédito'],
  ['cartao_debito', 'Cartão de débito'],
];

/** Catálogo carregado uma vez por abertura do formulário. */
let catalogo = [];

/* =============================================================================
 * PEÇAS DO FORMULÁRIO
 * ========================================================================== */

function campo(rotulo, controle, dica = '') {
  return criar('label', { class: 'campo' }, [
    criar('span', { class: 'campo__rotulo', texto: rotulo }),
    controle,
    ...(dica ? [criar('span', { class: 'campo__dica', texto: dica })] : []),
  ]);
}

function selecao(nome, opcoes, valorInicial) {
  return criar(
    'select',
    { class: 'campo__controle', name: nome },
    opcoes.map(([valor, rotulo]) =>
      criar('option', {
        value: valor,
        texto: rotulo,
        ...(valor === valorInicial ? { selected: 'selected' } : {}),
      })
    )
  );
}

/** Preço que vale hoje para este produto — promoção quando houver. */
function precoAtual(produto) {
  return produto.emPromocao ? produto.precoPromocional : produto.precoVarejo;
}

/**
 * Uma linha de item: produto, quantidade e o subtotal só para conferir.
 *
 * O estoque disponível aparece junto do nome porque a loja precisa saber,
 * no momento de lançar, se consegue entregar. Descobrir que faltou doce só
 * quando o banco recusa é tarde: a cliente já está esperando no WhatsApp.
 */
function criarLinhaItem(aoMudar, aoRemover) {
  const seletor = criar(
    'select',
    { class: 'campo__controle', 'data-produto': '' },
    [
      criar('option', { value: '', texto: 'Escolha o doce…' }),
      ...catalogo.map((produto) => {
        const disponivel = produto.estoque?.disponivel ?? 0;
        const sobEncomenda = produto.estoque?.sobEncomenda;

        const sufixo = sobEncomenda
          ? 'sob encomenda'
          : `${disponivel} em estoque`;

        return criar('option', {
          value: produto.id,
          texto: `${produto.nome} — ${moeda(precoAtual(produto))} (${sufixo})`,
        });
      }),
    ]
  );

  const quantidade = criar('input', {
    class: 'campo__controle campo__controle--curto',
    type: 'number',
    min: '1',
    step: '1',
    value: '1',
    'data-quantidade': '',
    inputmode: 'numeric',
  });

  const subtotal = criar('span', {
    class: 'item-pedido__subtotal',
    'data-subtotal': '',
    texto: moeda(0),
  });

  const remover = criar(
    'button',
    {
      class: 'botao-icone botao-icone--perigo',
      type: 'button',
      'aria-label': 'Remover este item',
    },
    [icone('lixeira')]
  );

  const linha = criar('div', { class: 'item-pedido' }, [
    seletor,
    quantidade,
    subtotal,
    remover,
  ]);

  seletor.addEventListener('change', aoMudar);
  quantidade.addEventListener('input', aoMudar);
  remover.addEventListener('click', () => {
    linha.remove();
    aoRemover();
  });

  return linha;
}

/* =============================================================================
 * LEITURA DO FORMULÁRIO
 * ========================================================================== */

/** Converte as linhas visíveis em itens, ignorando as que ninguém preencheu. */
function lerItens(area) {
  const itens = [];

  area.querySelectorAll('.item-pedido').forEach((linha) => {
    const produtoId = linha.querySelector('[data-produto]').value;
    const quantidade = Number(linha.querySelector('[data-quantidade]').value);

    if (produtoId && quantidade > 0) {
      itens.push({ produtoId, quantidade });
    }
  });

  return itens;
}

/**
 * Soma o pedido para a loja conferir antes de lançar.
 *
 * Este número não é enviado a lugar nenhum. O valor que vale é o que o banco
 * calcula com os preços dele.
 */
function recalcular(area, totalEl) {
  let total = 0;

  area.querySelectorAll('.item-pedido').forEach((linha) => {
    const produtoId = linha.querySelector('[data-produto]').value;
    const quantidade = Number(linha.querySelector('[data-quantidade]').value) || 0;
    const produto = catalogo.find((p) => p.id === produtoId);

    const subtotal = produto ? precoAtual(produto) * quantidade : 0;
    total += subtotal;

    linha.querySelector('[data-subtotal]').textContent = moeda(subtotal);
  });

  totalEl.textContent = moeda(total);
}

/* =============================================================================
 * O FORMULÁRIO
 * ========================================================================== */

/**
 * Abre o formulário de novo pedido.
 *
 * @param {Function} aoCriar - chamado depois de lançar, para a tela recarregar
 */
export async function abrirNovoPedido(aoCriar) {
  try {
    const dados = await api.get('/admin/produtos', { situacao: 'publicados' });
    catalogo = dados.produtos || [];
  } catch {
    toastErro('Não conseguimos carregar os produtos.');
    return;
  }

  if (catalogo.length === 0) {
    toastErro('Nenhum produto publicado para incluir no pedido.');
    return;
  }

  const areaItens = criar('div', { class: 'itens-pedido' });
  const total = criar('strong', { class: 'resumo-pedido__valor', texto: moeda(0) });

  const atualizar = () => recalcular(areaItens, total);

  const adicionarLinha = () => {
    areaItens.append(criarLinhaItem(atualizar, atualizar));
    atualizar();
  };

  const metodo = selecao('metodo', METODOS, 'pix');

  const jaPago = criar('input', { type: 'checkbox', name: 'jaPago' });

  // A forma de pagamento só faz sentido quando já houve pagamento. Deixá-la
  // ativa numa encomenda a pagar faria a loja escolher algo que não aconteceu.
  const sincronizarMetodo = () => {
    metodo.disabled = !jaPago.checked;
  };
  jaPago.addEventListener('change', sincronizarMetodo);
  sincronizarMetodo();

  const formulario = criar('form', { class: 'formulario-pedido' }, [
    criar('div', { class: 'formulario-pedido__linha' }, [
      campo(
        'Nome da cliente',
        criar('input', {
          class: 'campo__controle',
          name: 'clienteNome',
          type: 'text',
          required: 'required',
          autocomplete: 'off',
        })
      ),
      campo(
        'WhatsApp',
        criar('input', {
          class: 'campo__controle',
          name: 'clienteWhatsapp',
          type: 'tel',
          required: 'required',
          placeholder: '11988887777',
          inputmode: 'numeric',
        }),
        'Com DDD.'
      ),
    ]),

    criar('div', { class: 'formulario-pedido__linha' }, [
      campo('De onde veio', selecao('origem', ORIGENS, 'whatsapp')),
      campo(
        'Entrega',
        selecao('tipoEntrega', [['retirada', 'Retirada'], ['entrega', 'Entrega']], 'retirada')
      ),
      // "(opcional)" no rótulo em vez de dica embaixo: uma linha a menos, e
      // a informação chega antes de a pessoa começar a preencher.
      campo(
        'Para quando (opcional)',
        criar('input', {
          class: 'campo__controle',
          name: 'dataDesejada',
          type: 'date',
        })
      ),
    ]),

    criar('fieldset', { class: 'formulario-pedido__itens' }, [
      criar('legend', { texto: 'Doces do pedido' }),
      areaItens,
      criar(
        'button',
        { class: 'btn btn--secundario btn--pequeno', type: 'button', 'data-adicionar': '' },
        [icone('mais'), criar('span', { texto: 'Adicionar doce' })]
      ),
    ]),

    criar('div', { class: 'resumo-pedido' }, [
      criar('span', { texto: 'Total para conferência' }),
      total,
    ]),

    criar('div', { class: 'formulario-pedido__linha' }, [
      criar('label', { class: 'campo campo--caixa' }, [
        jaPago,
        criar('span', { texto: 'A cliente já pagou' }),
      ]),
      campo('Forma de pagamento', metodo),
    ]),

    campo(
      'Observações (opcional)',
      criar('textarea', {
        class: 'campo__controle',
        name: 'observacoes',
        rows: '2',
        placeholder: 'Sem nozes, entregar após as 18h…',
      })
    ),
  ]);

  formulario.querySelector('[data-adicionar]').addEventListener('click', adicionarLinha);
  adicionarLinha();

  const cancelar = criar('button', {
    class: 'btn btn--secundario',
    type: 'button',
    texto: 'Cancelar',
  });

  const salvar = criar('button', {
    class: 'btn btn--primario',
    type: 'submit',
    texto: 'Lançar pedido',
  });

  const dialogo = criar('dialog', { class: 'dialogo dialogo--largo' }, [
    criar('h2', { class: 'dialogo__titulo', texto: 'Novo pedido' }),
    formulario,
    criar('div', { class: 'dialogo__acoes' }, [cancelar, salvar]),
  ]);

  document.body.append(dialogo);
  dialogo.showModal();

  const fechar = () => {
    dialogo.close();
    dialogo.remove();
  };

  cancelar.addEventListener('click', fechar);

  // Os botões ficam fora do <form> para o diálogo controlar o espaçamento,
  // então o submit é disparado à mão.
  salvar.addEventListener('click', (evento) => {
    evento.preventDefault();
    formulario.requestSubmit();
  });

  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();

    const itens = lerItens(areaItens);

    if (itens.length === 0) {
      toastErro('Escolha ao menos um doce.');
      return;
    }

    const dados = new FormData(formulario);
    const parar = botaoCarregando(salvar);

    try {
      const resposta = await api.post('/admin/pedidos', {
        clienteNome: dados.get('clienteNome'),
        clienteWhatsapp: dados.get('clienteWhatsapp'),
        origem: dados.get('origem'),
        tipoEntrega: dados.get('tipoEntrega'),
        dataDesejada: dados.get('dataDesejada') || null,
        observacoes: dados.get('observacoes'),
        jaPago: jaPago.checked,
        metodo: dados.get('metodo'),
        itens,
      });

      fechar();
      toastSucesso(resposta.mensagem);
      await aoCriar?.();
    } catch (erro) {
      // O servidor devolve qual campo errou; sem isso a loja lê "quantidade
      // inválida" e precisa caçar qual das linhas está errada.
      toastErro(erro.mensagem || 'Não conseguimos lançar o pedido.');
      parar();
    }
  });
}

/* =============================================================================
 * CANCELAR E APAGAR
 * ========================================================================== */

/**
 * Cancela o pedido e devolve as unidades ao estoque.
 *
 * É o caminho do dia a dia, e tem volta: o pedido continua no histórico.
 */
export async function cancelarPedido(codigo, aoConcluir) {
  const confirmado = await confirmar(
    `Cancelar o pedido ${codigo}? Os doces voltam para o estoque e o pedido ` +
      'continua no histórico.',
    { confirmar: 'Cancelar pedido', cancelar: 'Voltar' }
  );

  if (!confirmado) return;

  try {
    const resposta = await api.post(`/admin/pedidos/${codigo}/cancelar`, {});
    toastSucesso(resposta.mensagem);
    await aoConcluir?.();
  } catch (erro) {
    toastErro(erro.mensagem || 'Não conseguimos cancelar o pedido.');
  }
}

/**
 * Apaga o pedido em definitivo.
 *
 * Serve para limpar teste. O servidor recusa se o pedido ainda não estiver
 * cancelado — é o cancelamento que devolve o estoque, e apagar direto
 * deixaria um buraco invisível na prateleira.
 *
 * A confirmação diz "não tem volta" com todas as letras porque é a única
 * ação do sistema que destrói informação.
 */
export async function apagarPedido(codigo, aoConcluir) {
  const confirmado = await confirmar(
    `Apagar o pedido ${codigo} para sempre? Isso não tem volta — o pedido, ` +
      'os itens e o pagamento somem do sistema.',
    { confirmar: 'Apagar para sempre', cancelar: 'Voltar' }
  );

  if (!confirmado) return;

  try {
    const resposta = await api.delete(`/admin/pedidos/${codigo}`);
    toastSucesso(resposta.mensagem);
    await aoConcluir?.();
  } catch (erro) {
    toastErro(erro.mensagem || 'Não conseguimos apagar o pedido.');
  }
}

export default { abrirNovoPedido, cancelarPedido, apagarPedido };
