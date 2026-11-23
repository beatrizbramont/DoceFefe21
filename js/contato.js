/**
 * contato.js
 * -----------------------------------------------------------------------------
 * Formulário de contato e perguntas frequentes.
 *
 * COMO O ENVIO FUNCIONA HOJE (Fase 2)
 * O backend ainda não existe. Em vez de deixar o botão sem ação — ou pior,
 * fingir que a mensagem foi enviada —, o formulário monta a mensagem com os
 * dados preenchidos e abre o WhatsApp da loja.
 *
 * Isso não é um remendo: o WhatsApp é o canal real de atendimento da marca,
 * então o cliente fala com quem precisa, de imediato, e a conversa fica no
 * histórico dele.
 *
 * NA FASE 5, quando a API existir, o envio passa a ser `POST /api/contato`,
 * gravando no banco. O WhatsApp continuará como alternativa. O ponto de troca
 * está marcado com TODO em `enviarFormulario()`.
 *
 * SEGURANÇA
 * Toda validação aqui é apenas conveniência para o usuário. Qualquer pessoa
 * pode desativar o JavaScript. Quando o backend entrar, ele revalidará tudo.
 */

import { $, $$, toastSucesso, toastErro, botaoCarregando,
         marcarErroCampo, limparErroCampo, limparErrosFormulario,
         aplicarErrosServidor } from './lib/ui.js';
import { api, ErroApi } from './lib/api.js';
import { somenteDigitos } from './lib/format.js';
import { montarLinkWhatsApp } from './whatsapp.js';
import { ativarAcordeoes } from './components/accordion.js';

/* =============================================================================
 * VALIDAÇÃO
 * ========================================================================== */

const LIMITE_MENSAGEM = 1000;

/**
 * Regras por campo. Cada função devolve a mensagem de erro, ou null se válido.
 * Centralizar assim evita um `if` gigante dentro do submit.
 */
const REGRAS = {
  nome: (valor) => {
    const limpo = valor.trim();
    if (!limpo) return 'Por favor, informe seu nome.';
    if (limpo.length < 2) return 'O nome parece curto demais.';
    if (limpo.length > 100) return 'O nome é longo demais.';
    return null;
  },

  whatsapp: (valor) => {
    const digitos = somenteDigitos(valor);
    if (!digitos) return 'Por favor, informe seu WhatsApp.';
    // Fixo com DDD = 10 dígitos; celular com DDD = 11.
    if (digitos.length < 10) return 'Informe o número completo, com DDD.';
    if (digitos.length > 11) return 'O número tem dígitos demais.';
    return null;
  },

  email: (valor) => {
    const limpo = valor.trim();
    // O e-mail é opcional — vazio não é erro.
    if (!limpo) return null;
    // Validação proposital simples: "tem algo@algo.algo".
    // Regras complexas rejeitam e-mails válidos e irritam o usuário; a
    // verificação de verdade é o envio chegar ou não.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(limpo)) {
      return 'Esse e-mail parece incompleto.';
    }
    return null;
  },

  assunto: (valor) => (valor ? null : 'Escolha um assunto.'),

  mensagem: (valor) => {
    const limpo = valor.trim();
    if (!limpo) return 'Escreva sua mensagem.';
    if (limpo.length < 10) return 'Conte um pouquinho mais, por favor.';
    if (limpo.length > LIMITE_MENSAGEM) {
      return `A mensagem passou de ${LIMITE_MENSAGEM} caracteres.`;
    }
    return null;
  },

  // Caixa de seleção: o que vale é `checked`, não `value` — por isso o
  // primeiro parâmetro é ignorado aqui.
  consentimento: (_valor, campo) =>
    campo.checked ? null : 'Precisamos da sua autorização para responder.',
};

/**
 * Valida o formulário inteiro.
 * @returns {{valido: boolean, dados: object}}
 */
function validar(formulario) {
  limparErrosFormulario(formulario);

  const dados = {};
  let primeiroErro = null;

  for (const [nome, regra] of Object.entries(REGRAS)) {
    const campo = formulario.elements[nome];
    if (!campo) continue;

    const valor = campo.type === 'checkbox' ? campo.checked : campo.value;
    const erro = regra(campo.value, campo);

    if (erro) {
      marcarErroCampo(campo, erro);
      if (!primeiroErro) primeiroErro = campo;
    } else {
      dados[nome] = typeof valor === 'string' ? valor.trim() : valor;
    }
  }

  if (primeiroErro) {
    primeiroErro.focus();
    primeiroErro.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return { valido: false, dados: null };
  }

  return { valido: true, dados };
}

/* =============================================================================
 * ENVIO
 * ========================================================================== */

/** Converte o valor do <select> no rótulo que a pessoa escolheu. */
function rotuloAssunto(formulario, valor) {
  const opcao = $(`option[value="${CSS.escape(valor)}"]`, formulario.elements.assunto);
  return opcao ? opcao.textContent.trim() : valor;
}

/** Monta a mensagem que será enviada pelo WhatsApp. */
function montarMensagem(dados, formulario) {
  const linhas = [
    'Olá! Vim pelo site da Doce Fefê.21.',
    '',
    `*Nome:* ${dados.nome}`,
    `*Assunto:* ${rotuloAssunto(formulario, dados.assunto)}`,
  ];

  if (dados.email) linhas.push(`*E-mail:* ${dados.email}`);

  linhas.push('', dados.mensagem);

  return linhas.join('\n');
}

/**
 * Envia a mensagem.
 *
 * ESTRATÉGIA EM DOIS PASSOS
 *   1. Grava no banco pela API — assim a mensagem fica registrada no painel
 *      administrativo mesmo que o cliente não chegue a abrir o WhatsApp.
 *   2. Abre o WhatsApp com a mensagem pronta — o canal real de atendimento
 *      da marca.
 *
 *   Se a API falhar, o passo 2 acontece mesmo assim: o cliente não pode
 *   ficar sem caminho porque o nosso servidor teve um problema.
 */
async function enviarFormulario(formulario, botao) {
  const { valido, dados } = validar(formulario);

  if (!valido) {
    toastErro('Confira os campos destacados antes de enviar.');
    return;
  }

  botaoCarregando(botao, true);

  let registrado = false;

  // --- Passo 1: registrar no banco ---
  try {
    await api.post('/contato', {
      nome: dados.nome,
      whatsapp: somenteDigitos(formulario.elements.whatsapp.value),
      email: dados.email || '',
      assunto: dados.assunto,
      mensagem: dados.mensagem,
      consentimento: true,
    });
    registrado = true;
  } catch (erro) {
    // Erros de validação do servidor são mostrados campo a campo.
    if (erro instanceof ErroApi && erro.erros) {
      aplicarErrosServidor(formulario, erro.erros);
      toastErro('Confira os campos destacados.');
      botaoCarregando(botao, false);
      return;
    }

    // Outras falhas (API fora do ar, rede) não impedem o WhatsApp.
    console.warn('[contato] Não foi possível registrar no banco:', erro.message);
  }

  // --- Passo 2: abrir o WhatsApp ---
  try {
    const link = montarLinkWhatsApp(montarMensagem(dados, formulario));

    // `noopener` impede que a página aberta manipule a nossa aba.
    const janela = window.open(link, '_blank', 'noopener,noreferrer');

    if (!janela) {
      // O navegador bloqueou o pop-up. Em vez de falhar em silêncio,
      // oferecemos o link para a pessoa clicar.
      mostrarLinkAlternativo(formulario, link);

      if (registrado) {
        toastSucesso('Mensagem registrada! Use o botão abaixo para o WhatsApp.');
        formulario.reset();
        atualizarContador(formulario);
      } else {
        toastErro('Seu navegador bloqueou a janela. Use o botão que apareceu abaixo.');
      }
      return;
    }

    toastSucesso(
      registrado
        ? 'Mensagem registrada e WhatsApp aberto. É só enviar!'
        : 'Abrimos o WhatsApp com sua mensagem pronta. É só enviar!'
    );

    formulario.reset();
    atualizarContador(formulario);
  } catch (erro) {
    console.error('[contato] Falha ao abrir o WhatsApp:', erro);

    toastErro(
      registrado
        ? 'Mensagem registrada, mas não conseguimos abrir o WhatsApp.'
        : 'Não conseguimos enviar. Use o botão flutuante do WhatsApp.'
    );
  } finally {
    botaoCarregando(botao, false);
  }
}

/** Plano B quando o navegador bloqueia a abertura automática do WhatsApp. */
function mostrarLinkAlternativo(formulario, link) {
  let caixa = $('[data-link-alternativo]', formulario);

  if (!caixa) {
    caixa = document.createElement('div');
    caixa.className = 'alerta alerta--aviso mt-4';
    caixa.setAttribute('data-link-alternativo', '');
    formulario.append(caixa);
  }

  caixa.replaceChildren();

  const texto = document.createElement('p');
  texto.textContent = 'Clique no botão abaixo para abrir o WhatsApp:';
  caixa.append(texto);

  const botaoLink = document.createElement('a');
  botaoLink.className = 'btn btn--whatsapp btn--pequeno mt-2';
  botaoLink.href = link;
  botaoLink.target = '_blank';
  botaoLink.rel = 'noopener noreferrer';
  botaoLink.textContent = 'Abrir WhatsApp';
  caixa.append(botaoLink);
}

/* =============================================================================
 * CONTADOR DE CARACTERES
 * ========================================================================== */

function atualizarContador(formulario) {
  const campo = formulario.elements.mensagem;
  const contador = $('[data-contador]', formulario);
  if (!campo || !contador) return;

  const usados = campo.value.length;
  contador.textContent = `${usados} / ${LIMITE_MENSAGEM}`;
  contador.classList.toggle('contador-caracteres--limite', usados > LIMITE_MENSAGEM);
}

/* =============================================================================
 * INICIALIZAÇÃO
 * ========================================================================== */

function iniciar() {
  ativarAcordeoes(document, { umPorVez: true });

  const formulario = $('[data-formulario-contato]');
  if (!formulario) return;

  const botao = $('[type="submit"]', formulario);

  // `novalidate` desliga os balões nativos do navegador, que não seguem a
  // identidade visual e aparecem um de cada vez.
  formulario.setAttribute('novalidate', '');

  formulario.addEventListener('submit', (evento) => {
    evento.preventDefault();
    enviarFormulario(formulario, botao);
  });

  // Limpa o erro assim que a pessoa começa a corrigir o campo —
  // manter o aviso vermelho enquanto ela digita é desanimador.
  $$('input, select, textarea', formulario).forEach((campo) => {
    const evento = campo.type === 'checkbox' || campo.tagName === 'SELECT'
      ? 'change'
      : 'input';
    campo.addEventListener(evento, () => limparErroCampo(campo));
  });

  formulario.elements.mensagem?.addEventListener('input', () =>
    atualizarContador(formulario)
  );
  atualizarContador(formulario);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', iniciar);
} else {
  iniciar();
}
