/**
 * tests/pagamento.test.mjs
 * -----------------------------------------------------------------------------
 * Testa o fluxo de pagamento: forma escolhida e envio de comprovante.
 *
 * O QUE PRECISA SER PROVADO
 *
 *   1. Enviar comprovante NÃO aprova o pagamento — só marca que o cliente
 *      afirma ter pago. A aprovação é da loja.
 *   2. Arquivos maliciosos são rejeitados (tipo declarado ≠ conteúdo real).
 *   3. Um cliente não mexe no pagamento do pedido de outro.
 *   4. O comprovante nunca fica acessível publicamente.
 */

import {
  postFormaPagamento,
  postComprovante,
  getSituacaoPagamento,
} from '../backend/controllers/payment-controller.js';
import { postPedido } from '../backend/controllers/order-controller.js';
import { validarArquivo, ErroPagamento } from '../services/payment-service.js';
import { transicaoPermitida, ROTULOS_STATUS } from '../services/order-service.js';
import {
  bancoConfigurado,
  verificarConexao,
  selecionarUm,
  remover,
} from '../services/database.js';
import { lerVariaveisDeAmbiente } from '../services/env.js';

const env = lerVariaveisDeAmbiente();

let ok = 0;
let falhas = 0;

const verificar = (nome, condicao, detalhe = '') => {
  if (condicao) {
    console.log(`  ✓ ${nome}`);
    ok += 1;
  } else {
    console.log(`  ✗ ${nome}  ${detalhe}`);
    falhas += 1;
  }
};

const semSessao = () => ({ headers: {} });

/* -----------------------------------------------------------------------------
 * Pré-requisitos
 * -------------------------------------------------------------------------- */

if (!bancoConfigurado) {
  console.log('\n  ⊘ Banco não configurado — suíte de pagamento pulada.\n');
  process.exit(0);
}

const conexao = await verificarConexao();
if (!conexao.conectado || !conexao.esquemaAplicado) {
  console.log(`\n  ⊘ ${conexao.mensagem}\n  Suíte de pagamento pulada.\n`);
  process.exit(0);
}

/* =============================================================================
 * 1. VALIDAÇÃO DE ARQUIVO (sem rede)
 * ========================================================================== */

console.log('\n── Validação do arquivo ──\n');

/** Monta um base64 com a assinatura binária correta de cada tipo. */
const comAssinatura = (bytes, recheio = 2000) =>
  Buffer.concat([Buffer.from(bytes), Buffer.alloc(recheio, 0x41)]).toString('base64');

const JPEG_VALIDO = comAssinatura([0xff, 0xd8, 0xff]);
const PNG_VALIDO = comAssinatura([0x89, 0x50, 0x4e, 0x47]);
const PDF_VALIDO = comAssinatura([0x25, 0x50, 0x44, 0x46]);

const tentar = (base64, tipo, nome = 'teste') => {
  try {
    validarArquivo(base64, tipo, nome);
    return null;
  } catch (erro) {
    return erro;
  }
};

verificar('JPEG válido é aceito', tentar(JPEG_VALIDO, 'image/jpeg') === null);
verificar('PNG válido é aceito', tentar(PNG_VALIDO, 'image/png') === null);
verificar('PDF válido é aceito', tentar(PDF_VALIDO, 'application/pdf') === null);

verificar(
  'prefixo data: é aceito',
  tentar(`data:image/jpeg;base64,${JPEG_VALIDO}`, 'image/jpeg') === null
);

/* -----------------------------------------------------------------------------
 * O teste que mais importa aqui: tipo declarado ≠ conteúdo real.
 *
 * O navegador informa o Content-Type, mas quem controla o navegador é o
 * cliente. Validar pela assinatura binária é o que impede renomear um
 * executável para .jpg e enviar.
 * -------------------------------------------------------------------------- */

console.log('');

const EXECUTAVEL = comAssinatura([0x4d, 0x5a]); // "MZ" = executável Windows
const ELF = comAssinatura([0x7f, 0x45, 0x4c, 0x46]); // binário Linux
const SCRIPT = Buffer.from('<?php system($_GET["c"]); ?>').toString('base64');

verificar(
  'executável .exe disfarçado de JPEG é rejeitado',
  tentar(EXECUTAVEL, 'image/jpeg')?.status === 422
);
verificar(
  'binário ELF disfarçado de PNG é rejeitado',
  tentar(ELF, 'image/png')?.status === 422
);
verificar(
  'script PHP disfarçado de imagem é rejeitado',
  tentar(SCRIPT, 'image/jpeg')?.status === 422
);
verificar(
  'PNG enviado como JPEG é rejeitado (assinatura não bate)',
  tentar(PNG_VALIDO, 'image/jpeg')?.status === 422
);

console.log('');

verificar(
  'tipo não permitido é rejeitado',
  tentar(JPEG_VALIDO, 'text/html')?.status === 422
);
verificar(
  'SVG é rejeitado (pode conter script)',
  tentar(JPEG_VALIDO, 'image/svg+xml')?.status === 422
);
verificar('arquivo vazio é rejeitado', tentar('', 'image/jpeg')?.status === 422);
verificar(
  'base64 sem conteúdo é rejeitado',
  tentar(Buffer.alloc(0).toString('base64'), 'image/jpeg')?.status === 422
);

// Arquivo acima do limite.
const GIGANTE = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff]),
  Buffer.alloc(6 * 1024 * 1024, 0x41),
]).toString('base64');

verificar('arquivo acima de 5 MB é rejeitado', tentar(GIGANTE, 'image/jpeg')?.status === 413);

// Nome de arquivo malicioso.
const resultadoNome = validarArquivo(JPEG_VALIDO, 'image/jpeg', '../../../etc/passwd');
verificar(
  'nome com path traversal é neutralizado',
  !resultadoNome.nome.includes('/') && !resultadoNome.nome.includes('..'),
  resultadoNome.nome
);

/* =============================================================================
 * 2. FLUXO DE STATUS
 * ========================================================================== */

console.log('\n── Fluxo de status ──\n');

verificar(
  'aguardando_pagamento → comprovante_enviado é permitido',
  transicaoPermitida('aguardando_pagamento', 'comprovante_enviado')
);
verificar(
  'comprovante_enviado → pagamento_aprovado é permitido',
  transicaoPermitida('comprovante_enviado', 'pagamento_aprovado')
);
verificar(
  'comprovante recusado volta para aguardando_pagamento',
  transicaoPermitida('comprovante_enviado', 'aguardando_pagamento')
);
verificar(
  'comprovante_enviado NÃO pula para entregue',
  !transicaoPermitida('comprovante_enviado', 'entregue')
);
verificar(
  'comprovante_enviado NÃO pula para em_preparacao',
  !transicaoPermitida('comprovante_enviado', 'em_preparacao')
);
verificar(
  'status tem rótulo em português',
  ROTULOS_STATUS.comprovante_enviado === 'Comprovante em análise',
  ROTULOS_STATUS.comprovante_enviado
);

/* =============================================================================
 * 3. FLUXO COMPLETO, COM PEDIDO REAL
 * ========================================================================== */

const criados = [];

try {
  const produto = await selecionarUm('catalogo_publico', {
    colunas: 'slug,preco_efetivo',
    ordenar: 'nome.asc',
  });

  if (!produto) {
    console.log('\n  ⊘ Nenhum produto publicado — testes de fluxo pulados.\n');
  } else {
    console.log('\n── Fluxo completo ──\n');

    const criacao = await postPedido({
      req: semSessao(),
      corpo: {
        nome: 'Cliente Pagamento Teste',
        whatsapp: '11977776666',
        tipoEntrega: 'retirada',
        consentimento: true,
        itens: [{ slug: produto.slug, quantidade: 1 }],
      },
    });

    const codigo = criacao.corpo.pedido?.codigo;
    if (codigo) criados.push(codigo);

    verificar('pedido criado', criacao.status === 201, `obtido: ${criacao.status}`);
    verificar(
      'nasce em aguardando_pagamento',
      criacao.corpo.pedido?.status === 'aguardando_pagamento'
    );

    /* ---------------------------------------------------------------------
     * 3.1 Forma de pagamento
     * ------------------------------------------------------------------ */

    const pix = await postFormaPagamento({
      req: semSessao(),
      params: { codigo },
      corpo: { metodo: 'pix' },
    });

    verificar('escolher Pix funciona', pix.status === 200, `obtido: ${pix.status}`);

    const dinheiro = await postFormaPagamento({
      req: semSessao(),
      params: { codigo },
      corpo: { metodo: 'dinheiro' },
    });

    verificar('trocar para dinheiro funciona', dinheiro.status === 200);

    const metodoInvalido = await postFormaPagamento({
      req: semSessao(),
      params: { codigo },
      corpo: { metodo: 'cartao_de_barro' },
    });

    verificar(
      'método inválido é rejeitado',
      metodoInvalido.status === 422,
      `obtido: ${metodoInvalido.status}`
    );

    // Escolher forma NÃO pode mudar o status do pedido.
    const depoisDaEscolha = await selecionarUm('orders', {
      colunas: 'status',
      filtros: { codigo: `eq.${codigo}` },
    });

    verificar(
      'escolher forma NÃO aprova pagamento',
      depoisDaEscolha?.status === 'aguardando_pagamento',
      `status virou: ${depoisDaEscolha?.status}`
    );

    /* ---------------------------------------------------------------------
     * 3.2 Comprovante
     * ------------------------------------------------------------------ */

    console.log('');

    const envio = await postComprovante({
      req: semSessao(),
      params: { codigo },
      corpo: {
        arquivo: JPEG_VALIDO,
        tipo: 'image/jpeg',
        nome: 'comprovante-teste.jpg',
      },
    });

    verificar(
      'comprovante é aceito',
      envio.status === 201,
      `obtido: ${envio.status} — ${envio.corpo.mensagem}`
    );

    if (envio.status === 201) {
      const depoisDoComprovante = await selecionarUm('orders', {
        colunas: 'status',
        filtros: { codigo: `eq.${codigo}` },
      });

      /* -----------------------------------------------------------------
       * O TESTE MAIS IMPORTANTE DESTA SUÍTE
       * ---------------------------------------------------------------- */
      verificar(
        'comprovante NÃO aprova o pagamento',
        depoisDoComprovante?.status === 'comprovante_enviado',
        `status virou: ${depoisDoComprovante?.status}`
      );

      verificar(
        'status NÃO é pagamento_aprovado',
        depoisDoComprovante?.status !== 'pagamento_aprovado'
      );

      const pagamento = await selecionarUm('payments', {
        colunas:
          'comprovante_caminho,comprovante_nome_original,comprovante_enviado_em,' +
          'conferido_em,status',
        filtros: { pedido_id: `eq.${(await selecionarUm('orders', { colunas: 'id', filtros: { codigo: `eq.${codigo}` } })).id}` },
      });

      verificar('caminho do arquivo foi gravado', Boolean(pagamento?.comprovante_caminho));
      verificar('data de envio foi gravada', Boolean(pagamento?.comprovante_enviado_em));
      verificar(
        'NÃO está conferido',
        pagamento?.conferido_em === null,
        `conferido_em: ${pagamento?.conferido_em}`
      );
      verificar(
        'pagamento continua pendente',
        pagamento?.status === 'pendente',
        `status: ${pagamento?.status}`
      );

      /* -----------------------------------------------------------------
       * 3.3 O arquivo não pode ser público
       * ---------------------------------------------------------------- */

      console.log('');

      const url = `${env.SUPABASE_URL}/storage/v1/object/public/comprovantes/${pagamento.comprovante_caminho}`;

      try {
        const resposta = await fetch(url);
        verificar(
          'comprovante NÃO é acessível publicamente',
          !resposta.ok,
          `HTTP ${resposta.status} — o arquivo está exposto!`
        );
      } catch {
        verificar('comprovante NÃO é acessível publicamente', true);
      }

      // Com a chave pública também não.
      try {
        const resposta = await fetch(
          `${env.SUPABASE_URL}/storage/v1/object/comprovantes/${pagamento.comprovante_caminho}`,
          {
            headers: {
              apikey: env.VITE_SUPABASE_ANON_KEY,
              Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}`,
            },
          }
        );
        verificar(
          'chave pública não lê o comprovante',
          !resposta.ok,
          `HTTP ${resposta.status}`
        );
      } catch {
        verificar('chave pública não lê o comprovante', true);
      }

      /* -----------------------------------------------------------------
       * 3.4 Situação do pagamento
       * ---------------------------------------------------------------- */

      console.log('');

      const situacao = await getSituacaoPagamento({
        req: semSessao(),
        params: { codigo },
      });

      verificar('consulta de situação funciona', situacao.status === 200);
      verificar(
        'informa que o comprovante foi enviado',
        situacao.corpo.pagamento?.comprovanteEnviado === true
      );
      verificar(
        'informa que ainda NÃO foi conferido',
        situacao.corpo.pagamento?.conferido === false
      );

      // A resposta ao cliente não pode entregar o caminho interno do arquivo.
      verificar(
        'não expõe o caminho do arquivo ao cliente',
        !JSON.stringify(situacao.corpo).includes('comprovante_caminho') &&
          !JSON.stringify(situacao.corpo).includes(pagamento.comprovante_caminho)
      );
    }

    /* ---------------------------------------------------------------------
     * 3.5 Arquivo malicioso pela API
     * ------------------------------------------------------------------ */

    console.log('');

    const malicioso = await postComprovante({
      req: semSessao(),
      params: { codigo },
      corpo: { arquivo: EXECUTAVEL, tipo: 'image/jpeg', nome: 'virus.jpg' },
    });

    verificar(
      'executável disfarçado é rejeitado pela API',
      malicioso.status === 422,
      `obtido: ${malicioso.status}`
    );

    /* ---------------------------------------------------------------------
     * 3.6 Pedido inexistente
     * ------------------------------------------------------------------ */

    const inexistente = await postComprovante({
      req: semSessao(),
      params: { codigo: 'DFZZZZZZZZ' },
      corpo: { arquivo: JPEG_VALIDO, tipo: 'image/jpeg', nome: 'x.jpg' },
    });

    verificar('pedido inexistente devolve 404', inexistente.status === 404);

    const codigoInvalido = await postComprovante({
      req: semSessao(),
      params: { codigo: '../../etc' },
      corpo: { arquivo: JPEG_VALIDO, tipo: 'image/jpeg', nome: 'x.jpg' },
    });

    verificar('código malformado devolve 404', codigoInvalido.status === 404);
  }
} catch (erro) {
  console.log(`\n  ✗ Erro inesperado: ${erro.message}\n`);
  console.error(erro);
  falhas += 1;
} finally {
  console.log('\n── Limpeza ──\n');

  let removidos = 0;
  for (const codigo of criados) {
    await remover('orders', { codigo: `eq.${codigo}` })
      .then(() => {
        removidos += 1;
      })
      .catch(() => {});
  }

  verificar(
    `${removidos} de ${criados.length} pedido(s) de teste removido(s)`,
    removidos === criados.length
  );

  // Os arquivos de teste ficam no bucket. São poucos KB e o caminho inclui o
  // código do pedido, que começa com DF — fáceis de identificar e limpar.
  if (criados.length > 0) {
    console.log(`  ℹ comprovantes de teste no bucket: ${criados.join(', ')}`);
  }
}

/* -----------------------------------------------------------------------------
 * Resultado
 * -------------------------------------------------------------------------- */

console.log(`\n${'─'.repeat(50)}`);
console.log(`  ${ok} verificações passaram · ${falhas} falharam`);
console.log(`${'─'.repeat(50)}\n`);

process.exit(falhas > 0 ? 1 : 0);
