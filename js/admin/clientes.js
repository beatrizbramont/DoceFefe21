/**
 * admin/clientes.js
 * -----------------------------------------------------------------------------
 * Painel administrativo — clientes cadastrados.
 *
 * ⚠️ ESTA TELA MOSTRA DADO PESSOAL
 *   Nome, e-mail, telefone e histórico de compras são dados protegidos pela
 *   LGPD. Três consequências práticas, todas já implementadas:
 *
 *     • a rota exige perfil de administrador no servidor;
 *     • a visão `clientes_admin` é fechada para qualquer chave que não seja a
 *       de serviço — nem um usuário autenticado comum consegue lê-la;
 *     • nada é gravado ou alterado aqui. A tela é somente leitura.
 *
 *   Alterar dados de cliente pelo painel exigiria registrar quem alterou o
 *   quê e quando. Enquanto esse registro não existir, não existe a edição.
 */

import { iniciarPainel, tratarErroDeSessao } from './sessao.js';
import { api } from '../lib/api.js';
import {
  $,
  criar,
  renderizarEstadoVazio,
  debounce,
} from '../lib/ui.js';
import { moeda, data, telefone as formatarTelefone, somenteDigitos } from '../lib/format.js';

let clientes = [];
let busca = '';
let ordem = 'recentes';

const PERFIS = {
  cliente: ['selo--neutro', 'Cliente'],
  revendedor: ['selo--novo', 'Revendedor'],
  admin: ['selo--destaque', 'Administrador'],
};

/* =============================================================================
 * CARTÃO
 * ========================================================================== */

function dado(rotulo, conteudo) {
  return criar('div', {}, [
    criar('span', { class: 'admin-dado__rotulo', texto: rotulo }),
    conteudo,
  ]);
}

function contato(cliente) {
  const linhas = [
    dado('E-mail', criar('a', { href: `mailto:${cliente.email}`, texto: cliente.email })),
  ];

  if (cliente.telefone) {
    const digitos = somenteDigitos(cliente.telefone);

    linhas.push(
      dado(
        'WhatsApp',
        criar('a', {
          href: `https://wa.me/55${digitos}`,
          target: '_blank',
          rel: 'noopener noreferrer',
          texto: formatarTelefone(digitos),
        })
      )
    );
  }

  return linhas;
}

function criarCartao(cliente) {
  const [classePerfil, rotuloPerfil] = PERFIS[cliente.perfil] || PERFIS.cliente;

  return criar('article', { class: 'admin-cliente' }, [
    criar('div', { class: 'admin-cliente__topo' }, [
      criar('div', {}, [
        criar('h3', { class: 'admin-produto__nome', texto: cliente.nome }),
        criar('span', {
          class: 'texto-mini texto-suave',
          texto: `Cadastro em ${data(cliente.criadoEm)}`,
        }),
      ]),
      criar('span', { class: `selo ${classePerfil}`, texto: rotuloPerfil }),
    ]),

    criar('div', { class: 'admin-pedido__dados' }, [
      ...contato(cliente),

      dado(
        'Compras',
        criar('span', {
          texto:
            cliente.pedidos > 0
              ? `${cliente.pedidos} pedido(s) · ${moeda(cliente.gasto)}`
              : 'Ainda não comprou',
        })
      ),

      cliente.ultimoPedidoEm
        ? dado(
            'Último pedido',
            criar('span', { texto: data(cliente.ultimoPedidoEm) })
          )
        : null,

      // Só aparece quando a pessoa autorizou. Marcar "não" é uma decisão que
      // precisa ficar visível para quem for montar uma campanha.
      cliente.aceitaMarketing
        ? dado(
            'Marketing',
            criar('span', { class: 'selo selo--sucesso', texto: 'Aceita receber' })
          )
        : null,
    ]),
  ]);
}

/* =============================================================================
 * LISTA
 * ========================================================================== */

function renderizarResumo(resumo) {
  const container = $('[data-resumo-clientes]');
  if (!container) return;

  const metrica = (rotulo, valor) =>
    criar('div', { class: 'admin-metrica' }, [
      criar('span', { class: 'admin-metrica__valor', texto: String(valor) }),
      criar('span', { class: 'admin-metrica__rotulo', texto: rotulo }),
    ]);

  container.replaceChildren(
    metrica('Cadastros', resumo.total),
    metrica('Já compraram', resumo.compradores),
    metrica('Aceitam marketing', resumo.aceitamMarketing)
  );
}

function renderizarLista() {
  const lista = $('[data-lista-clientes]');
  if (!lista) return;

  if (clientes.length === 0) {
    renderizarEstadoVazio(lista, {
      icone: 'clientes',
      titulo: busca ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado',
      texto: busca
        ? 'Tente outro nome ou e-mail.'
        : 'Os cadastros feitos pelo site aparecem aqui.',
    });
    return;
  }

  lista.replaceChildren(...clientes.map(criarCartao));
}

async function carregar() {
  const lista = $('[data-lista-clientes]');

  lista?.replaceChildren(
    criar('p', { class: 'texto-suave texto-centro', texto: 'Carregando…' })
  );

  try {
    const resposta = await api.get('/admin/clientes', { busca, ordem });

    clientes = resposta.clientes;

    renderizarResumo(resposta.resumo);
    renderizarLista();
  } catch (erro) {
    console.error('[admin] Falha ao carregar clientes:', erro);

    if (await tratarErroDeSessao(erro)) return;

    renderizarEstadoVazio(lista, {
      icone: 'alerta',
      titulo: 'Não conseguimos carregar os clientes',
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
    titulo: 'Clientes',
    aoEntrar: () => {
      $('[data-busca]')?.addEventListener(
        'input',
        debounce((evento) => {
          busca = evento.target.value;
          carregar();
        }, 400)
      );

      $('[data-ordem]')?.addEventListener('change', (evento) => {
        ordem = evento.target.value;
        carregar();
      });

      carregar();
    },
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', iniciar);
} else {
  iniciar();
}
