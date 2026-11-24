/**
 * checkout.js
 * -----------------------------------------------------------------------------
 * Finalização do pedido (checkout.html).
 *
 * A página tem dois estados:
 *   • formulário  → contato, entrega, data, observações
 *   • confirmação → código do pedido e próximos passos
 *
 * ⚠️ OS VALORES MOSTRADOS AQUI SÃO INFORMATIVOS
 *   O resumo vem da validação do carrinho no servidor, e o total definitivo é
 *   recalculado de novo na criação do pedido — dentro da transação do banco.
 *   Se alguém editar o localStorage entre uma coisa e outra, o pedido sai com
 *   o valor correto mesmo assim.
 *
 * ⚠️ ESTA TELA NÃO CONFIRMA PAGAMENTO
 *   Todo pedido nasce como "aguardando pagamento". A confirmação virá do
 *   webhook do Mercado Pago na Fase 8.
 */

import {
  validarNoServidor,
  obterItens,
  esvaziar,
  atualizarContador,
} from './cart.js';
import { api, ErroApi } from './lib/api.js';
import { estaLogado } from './auth.js';
import {
  $,
  $$,
  criar,
  toastErro,
  toastSucesso,
  botaoCarregando,
  marcarErroCampo,
  limparErroCampo,
  limparErrosFormulario,
  renderizarEstadoVazio,
} from './lib/ui.js';
import { moeda, plural, somenteDigitos, cep as formatarCep } from './lib/format.js';
import { icone } from './components/icons.js';
import { ROTAS, rota } from './config.js';

/* =============================================================================
 * ESTADO
 * ========================================================================== */

/** Carrinho validado pelo servidor. Fonte dos valores exibidos. */
let carrinho = null;

/* =============================================================================
 * RESUMO DO PEDIDO
 * ========================================================================== */

function renderizarResumo() {
  const container = $('[data-resumo-checkout]');
  if (!container || !carrinho) return;

  const itens = carrinho.itens.map((item) =>
    criar('div', { class: 'resumo-item' }, [
      criar('span', {
        class: 'resumo-item__quantidade',
        texto: `${item.quantidade}×`,
      }),
      criar('span', { class: 'resumo-item__nome', texto: item.nome }),
      criar('span', { class: 'resumo-item__valor', texto: moeda(item.subtotal) }),
    ])
  );

  const valores = [
    criar('div', { class: 'resumo__linha' }, [
      criar('span', { texto: plural(carrinho.quantidadeItens, 'item', 'itens') }),
      criar('span', { texto: moeda(carrinho.subtotal) }),
    ]),
  ];

  if (carrinho.desconto > 0) {
    valores.push(
      criar('div', { class: 'resumo__linha resumo__linha--desconto' }, [
        criar('span', { texto: 'Desconto' }),
        criar('span', { texto: `− ${moeda(carrinho.desconto)}` }),
      ])
    );
  }

  const tipoEntrega = $('input[name="tipoEntrega"]:checked')?.value || 'retirada';

  valores.push(
    criar('div', { class: 'resumo__linha' }, [
      criar('span', { texto: 'Entrega' }),
      criar('span', {
        texto: tipoEntrega === 'retirada' ? 'Retirada' : 'A combinar',
      }),
    ])
  );

  valores.push(
    criar('div', { class: 'resumo__total' }, [
      criar('span', { texto: 'Total' }),
      criar('strong', { class: 'preco preco--grande', texto: moeda(carrinho.total) }),
    ])
  );

  container.replaceChildren(
    criar('h2', { class: 'resumo__titulo', texto: 'Seu pedido' }),
    ...itens,
    criar('div', { class: 'checkout-resumo__valores' }, valores)
  );
}

/* =============================================================================
 * CAMPOS DE ENDEREÇO
 * ========================================================================== */

/**
 * Mostra ou esconde o bloco de endereço conforme a escolha de entrega.
 *
 * Os campos ficam `disabled` quando escondidos. Só escondê-los visualmente
 * deixaria campos obrigatórios invisíveis bloqueando o envio — e o usuário
 * não teria como saber o que corrigir.
 */
function alternarEndereco() {
  const tipoEntrega = $('input[name="tipoEntrega"]:checked')?.value;
  const bloco = $('[data-bloco-endereco]');
  if (!bloco) return;

  const paraEntrega = tipoEntrega === 'entrega';

  bloco.hidden = !paraEntrega;

  $$('input, select', bloco).forEach((campo) => {
    campo.disabled = !paraEntrega;
    if (!paraEntrega) limparErroCampo(campo);
  });

  renderizarResumo();
}

/* =============================================================================
 * BUSCA DE CEP
 * ========================================================================== */

/**
 * Preenche o endereço a partir do CEP, usando a API pública ViaCEP.
 *
 * Serviço externo e gratuito, sem autenticação. Se estiver fora do ar, a
 * pessoa digita à mão — por isso a falha aqui NUNCA bloqueia o checkout.
 */
async function buscarCep(valor) {
  const digitos = somenteDigitos(valor);
  if (digitos.length !== 8) return;

  const aviso = $('[data-aviso-cep]');
  if (aviso) aviso.textContent = 'Buscando endereço…';

  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), 6000);

  try {
    const resposta = await fetch(`https://viacep.com.br/ws/${digitos}/json/`, {
      signal: controlador.signal,
    });

    const dados = await resposta.json();

    if (dados.erro) {
      if (aviso) aviso.textContent = 'CEP não encontrado. Preencha à mão.';
      return;
    }

    const formulario = $('[data-formulario-checkout]');
    if (!formulario) return;

    if (dados.logradouro) formulario.elements.logradouro.value = dados.logradouro;
    if (dados.bairro) formulario.elements.bairro.value = dados.bairro;
    if (dados.localidade) formulario.elements.cidade.value = dados.localidade;
    if (dados.uf) formulario.elements.estado.value = dados.uf;

    if (aviso) aviso.textContent = '';

    // Leva o foco ao número, que é o que a pessoa ainda precisa digitar.
    formulario.elements.numero?.focus();
  } catch {
    if (aviso) aviso.textContent = 'Não foi possível buscar. Preencha à mão.';
  } finally {
    clearTimeout(temporizador);
  }
}

/* =============================================================================
 * VALIDAÇÃO
 *
 * Conveniência para o usuário. O servidor revalida tudo — inclusive os campos
 * do endereço, um a um.
 * ========================================================================== */

const REGRAS = {
  nome: (v) => {
    const t = v.trim();
    if (!t) return 'Informe seu nome.';
    if (t.length < 2) return 'O nome parece curto demais.';
    return null;
  },
  whatsapp: (v) => {
    const d = somenteDigitos(v);
    if (!d) return 'Informe seu WhatsApp.';
    if (d.length < 10 || d.length > 11) return 'Informe o número completo, com DDD.';
    return null;
  },
  email: (v) => {
    const t = v.trim();
    if (!t) return null; // opcional
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t)) return 'Esse e-mail parece incompleto.';
    return null;
  },
  cep: (v) => (somenteDigitos(v).length === 8 ? null : 'CEP inválido.'),
  logradouro: (v) => (v.trim().length >= 3 ? null : 'Informe a rua.'),
  numero: (v) => (v.trim() ? null : 'Informe o número.'),
  bairro: (v) => (v.trim().length >= 2 ? null : 'Informe o bairro.'),
  cidade: (v) => (v.trim().length >= 2 ? null : 'Informe a cidade.'),
  estado: (v) => (/^[A-Za-z]{2}$/.test(v.trim()) ? null : 'Informe a UF.'),
};

function validarFormulario(formulario) {
  limparErrosFormulario(formulario);

  let primeiro = null;

  for (const [nome, regra] of Object.entries(REGRAS)) {
    const campo = formulario.elements[nome];

    // Campos desabilitados (endereço na retirada) não são validados.
    if (!campo || campo.disabled) continue;

    const erro = regra(campo.value);
    if (erro) {
      marcarErroCampo(campo, erro);
      if (!primeiro) primeiro = campo;
    }
  }

  const consentimento = formulario.elements.consentimento;
  if (consentimento && !consentimento.checked) {
    marcarErroCampo(consentimento, 'Precisamos da sua autorização para continuar.');
    if (!primeiro) primeiro = consentimento;
  }

  if (primeiro) {
    primeiro.focus();
    primeiro.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return false;
  }

  return true;
}

/* =============================================================================
 * ENVIO
 * ========================================================================== */

function montarCorpoDoPedido(formulario) {
  const tipoEntrega = formulario.elements.tipoEntrega.value;

  const corpo = {
    nome: formulario.elements.nome.value.trim(),
    whatsapp: somenteDigitos(formulario.elements.whatsapp.value),
    email: formulario.elements.email.value.trim(),
    tipoEntrega,
    dataDesejada: formulario.elements.dataDesejada.value || '',
    observacoes: formulario.elements.observacoes.value.trim(),
    consentimento: true,
    // Só slug e quantidade. Preço é decidido pelo servidor.
    itens: obterItens().map((i) => ({ slug: i.slug, quantidade: i.quantidade })),
  };

  if (tipoEntrega === 'entrega') {
    corpo.endereco = {
      cep: somenteDigitos(formulario.elements.cep.value),
      logradouro: formulario.elements.logradouro.value.trim(),
      numero: formulario.elements.numero.value.trim(),
      complemento: formulario.elements.complemento.value.trim(),
      bairro: formulario.elements.bairro.value.trim(),
      cidade: formulario.elements.cidade.value.trim(),
      estado: formulario.elements.estado.value.trim().toUpperCase(),
      referencia: formulario.elements.referencia.value.trim(),
    };
  }

  return corpo;
}

async function enviarPedido(formulario, botao) {
  if (!validarFormulario(formulario)) {
    toastErro('Confira os campos destacados.');
    return;
  }

  if (!carrinho || carrinho.itens.length === 0) {
    toastErro('Seu carrinho está vazio.');
    return;
  }

  botaoCarregando(botao, true);

  // Montado uma vez só: a confirmação precisa dos mesmos dados enviados.
  const dadosEnviados = montarCorpoDoPedido(formulario);

  try {
    const resposta = await api.post('/pedidos', dadosEnviados);

    // O pedido foi gravado: o carrinho já cumpriu o papel dele.
    esvaziar();
    atualizarContador();

    toastSucesso('Pedido registrado!');

    // Vai direto para a escolha da forma de pagamento.
    //
    // `replace`, e não `href`: substitui o checkout no histórico. Assim,
    // apertar "voltar" na tela de pagamento não devolve a pessoa a um
    // formulário que reenviaria o pedido.
    window.location.replace(
      `${rota(ROTAS.pagamento)}?pedido=${encodeURIComponent(resposta.pedido.codigo)}`
    );
  } catch (erro) {
    console.error('[checkout] Falha ao criar pedido:', erro);

    if (erro instanceof ErroApi && erro.erros) {
      // O servidor devolve erros por campo, inclusive aninhados
      // ("endereco.cep"). Mapeamos cada um para o input correspondente.
      for (const [caminho, mensagem] of Object.entries(erro.erros)) {
        const campo = formulario.elements[caminho.replace('endereco.', '')];
        if (campo) marcarErroCampo(campo, mensagem);
      }

      toastErro(erro.message);
      return;
    }

    // 409 = o estoque mudou entre a validação e o envio. É preciso voltar ao
    // carrinho para o cliente ver o que aconteceu.
    if (erro instanceof ErroApi && erro.status === 409) {
      toastErro(erro.message, 9000);
      mostrarConflito(erro.message);
      return;
    }

    toastErro(erro.message || 'Não conseguimos registrar seu pedido.');
  } finally {
    botaoCarregando(botao, false);
  }
}

/** Aviso quando o estoque muda no meio do caminho. */
function mostrarConflito(mensagem) {
  const container = $('[data-avisos-checkout]');
  if (!container) return;

  container.replaceChildren(
    criar('div', { class: 'alerta alerta--aviso', role: 'alert' }, [
      icone('alerta'),
      criar('div', {}, [
        criar('p', { class: 'sem-margem', texto: mensagem }),
        criar('a', {
          class: 'btn btn--secundario btn--pequeno mt-2',
          href: rota(ROTAS.carrinho),
          texto: 'Revisar carrinho',
        }),
      ]),
    ])
  );

  container.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* =============================================================================
 * CARREGAMENTO
 * ========================================================================== */


async function carregarCarrinho() {
  const area = $('[data-area-checkout]');
  const vazio = $('[data-checkout-vazio]');

  try {
    carrinho = await validarNoServidor();
  } catch (erro) {
    console.error('[checkout] Falha ao validar carrinho:', erro);

    toastErro(
      erro instanceof ErroApi && erro.status === 0
        ? 'Sem conexão com o servidor. Tente novamente.'
        : erro.message || 'Não conseguimos carregar seu carrinho.'
    );

    carrinho = null;
  }

  if (!carrinho || carrinho.itens.length === 0) {
    area?.setAttribute('hidden', '');
    vazio?.removeAttribute('hidden');

    if (vazio) {
      renderizarEstadoVazio(vazio, {
        icone: 'carrinho',
        titulo: 'Seu carrinho está vazio',
        texto: 'Escolha seus doces antes de finalizar o pedido.',
        acao: { texto: 'Ver nossos doces', href: rota(ROTAS.produtos) },
      });
    }
    return;
  }

  vazio?.setAttribute('hidden', '');
  area?.removeAttribute('hidden');

  renderizarResumo();

  // Avisos da validação (item esgotado, quantidade ajustada, preço alterado).
  const avisos = $('[data-avisos-checkout]');
  if (avisos && carrinho.avisos?.length > 0) {
    avisos.replaceChildren(
      ...carrinho.avisos.map((aviso) =>
        criar('div', { class: 'alerta alerta--aviso', role: 'status' }, [
          criar('span', { texto: '•', 'aria-hidden': 'true' }),
          criar('p', { class: 'sem-margem', texto: aviso.mensagem }),
        ])
      )
    );
  }
}

/* =============================================================================
 * INÍCIO
 * ========================================================================== */

/** Formata uma data como AAAA-MM-DD, que é o formato do <input type="date">. */
function paraIso(data) {
  return [
    data.getFullYear(),
    String(data.getMonth() + 1).padStart(2, '0'),
    String(data.getDate()).padStart(2, '0'),
  ].join('-');
}

/**
 * Pede login antes de deixar preencher o checkout.
 *
 * Aviso no lugar do formulário, e não um bloqueio depois de enviar: descobrir
 * que precisa de conta DEPOIS de digitar endereço inteiro é o jeito mais
 * certo de perder a venda.
 *
 * Quem barra de verdade é o servidor (`postPedido` devolve 401). Isto aqui
 * existe para a pessoa não perder tempo.
 */
function pedirLoginParaFinalizar(formulario) {
  const aviso = criar('div', { class: 'alerta alerta--info' }, [
    icone('cadeado'),
    criar('div', {}, [
      criar('p', {
        class: 'sem-margem negrito',
        texto: 'Entre na sua conta para finalizar',
      }),
      criar('p', {
        class: 'sem-margem mt-2',
        texto:
          'Para finalizar a compra pelo site é necessário realizar o login '
      }),
      criar('a', {
        class: 'btn btn--primario mt-4',
        href: `${rota(ROTAS.minhaConta)}?retorno=checkout`,
        texto: 'Entrar ou criar conta',
      }),
    ]),
  ]);

  formulario.hidden = true;
  formulario.before(aviso);
}

async function iniciar() {
  const formulario = $('[data-formulario-checkout]');
  if (!formulario) return;

  formulario.setAttribute('novalidate', '');

  // --- Limites da data desejada ---
  const campoData = formulario.elements.dataDesejada;
  if (campoData) {
    const hoje = new Date();
    campoData.min = paraIso(hoje);

    // Teto de um ano: evita pedido para 2099 por erro de digitação no ano.
    const limite = new Date(hoje);
    limite.setFullYear(limite.getFullYear() + 1);
    campoData.max = paraIso(limite);
  }

  // --- Entrega ou retirada ---
  $$('input[name="tipoEntrega"]').forEach((radio) => {
    radio.addEventListener('change', alternarEndereco);
  });
  alternarEndereco();

  // --- CEP ---
  const campoCep = formulario.elements.cep;
  campoCep?.addEventListener('input', () => {
    campoCep.value = formatarCep(campoCep.value);
    if (somenteDigitos(campoCep.value).length === 8) buscarCep(campoCep.value);
  });

  // --- UF sempre em maiúsculas, só letras ---
  const campoEstado = formulario.elements.estado;
  campoEstado?.addEventListener('input', () => {
    campoEstado.value = campoEstado.value
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .slice(0, 2);
  });

  // --- Limpa erro ao corrigir ---
  $$('input, select, textarea', formulario).forEach((campo) => {
    const evento =
      campo.type === 'checkbox' || campo.tagName === 'SELECT' ? 'change' : 'input';
    campo.addEventListener(evento, () => limparErroCampo(campo));
  });

  // --- Envio ---
  formulario.addEventListener('submit', (evento) => {
    evento.preventDefault();
    enviarPedido(formulario, $('[type="submit"]', formulario));
  });

  // --- Preenche os dados de quem está logado ---
  if (estaLogado()) {
    try {
      const { perfil } = await api.get('/perfil');

      if (perfil) {
        if (!formulario.elements.nome.value) {
          formulario.elements.nome.value = perfil.nome || '';
        }
        if (!formulario.elements.email.value) {
          formulario.elements.email.value = perfil.email || '';
        }
        if (!formulario.elements.whatsapp.value && perfil.telefone) {
          formulario.elements.whatsapp.value = perfil.telefone;
          // Dispara o evento para a máscara de telefone formatar o valor.
          formulario.elements.whatsapp.dispatchEvent(
            new Event('input', { bubbles: true })
          );
        }
      }
    } catch {
      // Sem perfil carregado, a pessoa preenche à mão. Não é motivo para
      // travar o checkout.
    }
  }

  await carregarCarrinho();

  /*
    O pedido de login vem DEPOIS de carregar o carrinho, não antes.

    A primeira versão abortava a inicialização logo no começo — e com isso
    o carrinho nunca era carregado. Como a página só aparece depois disso,
    o resultado foi uma tela em branco: o aviso existia, dentro de um bloco
    ainda escondido.

    Carregando primeiro, a pessoa vê o que está comprando e o quanto vai
    pagar, e só então descobre que falta entrar. É também a ordem que
    convence: ninguém cria conta por um resumo que não viu.
  */
  if (!estaLogado()) pedirLoginParaFinalizar(formulario);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', iniciar);
} else {
  iniciar();
}
