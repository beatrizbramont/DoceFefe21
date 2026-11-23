/**
 * backend/server.js
 * -----------------------------------------------------------------------------
 * Servidor da API da Doce Fefê.21.
 *
 *   npm run server          produção
 *   npm run server:dev      recarrega ao salvar
 *
 * SOBRE A IMPLEMENTAÇÃO
 *   O servidor usa o módulo `http` nativo do Node, com um roteador próprio
 *   alimentado pela tabela de rotas em routes/index.js.
 *
 *   Essa escolha é deliberada: o projeto roda numa rede com proxy que
 *   inspeciona HTTPS, onde instalar pacotes já se mostrou frágil. Um backend
 *   sem dependências sempre sobe, não tem vulnerabilidade de terceiros para
 *   acompanhar e inicia instantaneamente.
 *
 *   Os CONTROLADORES não sabem disso. Eles recebem um objeto simples e
 *   devolvem `{ status, corpo }`. Migrar para Express, Fastify ou funções
 *   serverless significa trocar apenas este arquivo — nenhuma regra de
 *   negócio muda.
 */

import { createServer } from 'node:http';
import { lerVariaveisDeAmbiente } from '../services/env.js';
import { bancoConfigurado, verificarConexao } from '../services/database.js';
import {
  identificarUsuarioId,
  autenticacaoConfigurada,
} from '../services/auth-service.js';
import { encontrarRota } from './routes/index.js';
import {
  cabecalhosSeguranca,
  avaliarCors,
  identificarCliente,
} from './middleware/seguranca.js';

const env = lerVariaveisDeAmbiente();
const PORTA = Number(env.PORT) || 3000;
const EM_PRODUCAO = env.NODE_ENV === 'production';

/* =============================================================================
 * RESPOSTA
 * ========================================================================== */

function responder(res, status, corpo, cabecalhosExtras = {}) {
  const texto = JSON.stringify(corpo);

  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(texto),
    ...cabecalhosSeguranca(),
    ...cabecalhosExtras,
  });

  res.end(texto);
}

/* =============================================================================
 * LEITURA DO CORPO DA REQUISIÇÃO
 * ========================================================================== */

/**
 * Tamanho máximo do corpo da requisição.
 *
 * Os comprovantes de pagamento chegam em base64, que infla o arquivo em ~33%.
 * Com o limite de 5 MB por arquivo (ver payment-service.js), o corpo pode
 * chegar a ~6,7 MB — mais a folga do JSON em volta.
 *
 * O limite existe para uma requisição gigante não consumir a memória do
 * servidor. A validação real de tamanho, tipo e conteúdo acontece depois,
 * em payment-service.js.
 */
const CORPO_MAXIMO_BYTES = 8 * 1024 * 1024; // 8 MB

/**
 * Lê e interpreta o corpo JSON.
 *
 * @returns {Promise<{ok: boolean, dados?: object, mensagem?: string}>}
 */
function lerCorpo(req) {
  return new Promise((resolver) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      resolver({ ok: true, dados: {} });
      return;
    }

    const pedacos = [];
    let tamanho = 0;
    let abortado = false;

    req.on('data', (pedaco) => {
      if (abortado) return;

      tamanho += pedaco.length;

      // Corta a conexão assim que o limite é ultrapassado, em vez de
      // acumular tudo na memória para só então recusar.
      if (tamanho > CORPO_MAXIMO_BYTES) {
        abortado = true;
        req.destroy();
        resolver({ ok: false, mensagem: 'O conteúdo enviado é grande demais.' });
        return;
      }

      pedacos.push(pedaco);
    });

    req.on('end', () => {
      if (abortado) return;

      const texto = Buffer.concat(pedacos).toString('utf8');
      if (!texto) {
        resolver({ ok: true, dados: {} });
        return;
      }

      try {
        const dados = JSON.parse(texto);

        // Só aceitamos objetos. Um JSON válido pode ser `"texto"` ou `42`,
        // e os controladores esperam um objeto.
        if (dados === null || typeof dados !== 'object' || Array.isArray(dados)) {
          resolver({ ok: false, mensagem: 'O corpo precisa ser um objeto JSON.' });
          return;
        }

        resolver({ ok: true, dados });
      } catch {
        resolver({ ok: false, mensagem: 'JSON inválido no corpo da requisição.' });
      }
    });

    req.on('error', () => {
      if (!abortado) resolver({ ok: false, mensagem: 'Falha ao ler a requisição.' });
    });
  });
}

/* =============================================================================
 * AUTENTICAÇÃO
 * ========================================================================== */

/**
 * Identifica o usuário a partir do token no cabeçalho Authorization.
 *
 * A validação de verdade está em services/auth-service.js, que pergunta ao
 * Supabase se o token é autêntico. Aqui só repassamos o resultado.
 *
 * Importante: mesmo com um usuário identificado, o preço de atacado continua
 * dependendo da consulta à tabela `resellers` em product-service.js. Estar
 * logado não dá desconto; estar APROVADO como revendedor dá.
 *
 * @returns {Promise<string|null>}
 */
async function identificarUsuario(req) {
  return identificarUsuarioId(req);
}

/* =============================================================================
 * SERVIDOR
 * ========================================================================== */

const servidor = createServer(async (req, res) => {
  const inicio = Date.now();
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const caminho = url.pathname;

  // ---- CORS ----
  const cors = avaliarCors(req.headers.origin);

  if (!cors.permitida) {
    responder(res, 403, { erro: true, mensagem: 'Origem não autorizada.' });
    return;
  }

  // Sondagem do navegador antes do pedido real.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...cabecalhosSeguranca(), ...cors.cabecalhos });
    res.end();
    return;
  }

  // ---- Roteamento ----
  const encontrada = encontrarRota(req.method, caminho);

  if (!encontrada) {
    responder(
      res,
      404,
      { erro: true, mensagem: 'Endereço não encontrado nesta API.' },
      cors.cabecalhos
    );
    console.log(`  404  ${req.method} ${caminho}`);
    return;
  }

  const { rota, params } = encontrada;

  // ---- Limitação de requisições ----
  if (rota.limitador) {
    const limite = rota.limitador(identificarCliente(req));

    if (!limite.permitido) {
      responder(
        res,
        429,
        {
          erro: true,
          mensagem: 'Muitas requisições em pouco tempo. Aguarde um instante.',
        },
        {
          ...cors.cabecalhos,
          'Retry-After': String(limite.reiniciaEm),
          'X-RateLimit-Limit': String(limite.limite),
          'X-RateLimit-Remaining': '0',
        }
      );
      console.log(`  429  ${req.method} ${caminho}`);
      return;
    }

    cors.cabecalhos['X-RateLimit-Limit'] = String(limite.limite);
    cors.cabecalhos['X-RateLimit-Remaining'] = String(limite.restantes);
  }

  // ---- Execução ----
  try {
    const usuarioId = await identificarUsuario(req);

    const leitura = await lerCorpo(req);

    if (!leitura.ok) {
      responder(
        res,
        400,
        { erro: true, mensagem: leitura.mensagem },
        cors.cabecalhos
      );
      console.log(`  400  ${req.method} ${caminho}  (${leitura.mensagem})`);
      return;
    }

    const query = Object.fromEntries(url.searchParams.entries());

    const { status, corpo } = await rota.manipulador({
      query,
      params,
      corpo: leitura.dados,
      usuarioId,
      // Rotas protegidas precisam do `req` para reler o cabeçalho de
      // autorização e obter o perfil completo, não só o id.
      req,
    });

    responder(res, status, corpo, cors.cabecalhos);
    console.log(`  ${status}  ${req.method} ${caminho}  (${Date.now() - inicio}ms)`);
  } catch (erro) {
    console.error(`  ERRO  ${req.method} ${caminho}:`, erro);

    // Em produção, nunca devolver a mensagem interna ou o stack: eles revelam
    // estrutura de tabelas e caminhos de arquivo para quem está sondando.
    const mensagem =
      EM_PRODUCAO || !erro.message
        ? 'Tivemos um problema no servidor. Já estamos verificando.'
        : erro.message;

    responder(
      res,
      erro.status && erro.status < 500 ? erro.status : 500,
      { erro: true, mensagem },
      cors.cabecalhos
    );
  }
});

/* =============================================================================
 * INICIALIZAÇÃO
 * ========================================================================== */

servidor.listen(PORTA, async () => {
  const linha = (c = '─') => console.log(`  ${c.repeat(50)}`);

  console.log('');
  console.log('  🍫 Doce Fefê.21 — API');
  linha('═');
  console.log(`  Porta:     ${PORTA}`);
  console.log(`  Ambiente:  ${env.NODE_ENV || 'development'}`);
  console.log(`  Saúde:     http://localhost:${PORTA}/api/saude`);
  linha();

  if (autenticacaoConfigurada) {
    console.log('  ✓ Autenticação ativa (Supabase Auth)');
  } else {
    console.log('  ⚠ Autenticação inativa — todo visitante é anônimo.');
    console.log('    Falta VITE_SUPABASE_ANON_KEY no .env');
  }

  if (!bancoConfigurado) {
    console.log('  ⚠ Banco NÃO configurado.');
    console.log('    Preencha SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env');
  } else {
    const banco = await verificarConexao();

    if (banco.conectado && banco.esquemaAplicado) {
      console.log(`  ✓ Banco conectado`);
      console.log(`    Categorias: ${banco.detalhes.categorias}`);
      console.log(`    Produtos:   ${banco.detalhes.produtosPublicados}`);
    } else {
      console.log(`  ⚠ ${banco.mensagem}`);
    }
  }

  linha();
  console.log('  Ctrl+C para parar.');
  console.log('');
});

servidor.on('error', (erro) => {
  if (erro.code === 'EADDRINUSE') {
    console.error(`\n  ✕ A porta ${PORTA} já está em uso.`);
    console.error('    Feche o outro servidor ou mude PORT no .env\n');
  } else {
    console.error('\n  ✕ Erro no servidor:', erro.message, '\n');
  }
  process.exit(1);
});

// Encerramento limpo: espera as requisições em andamento terminarem antes
// de fechar, em vez de cortar no meio.
for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => {
    console.log('\n  Encerrando a API…');
    servidor.close(() => process.exit(0));
    // Se alguma conexão travar, força a saída em 5 segundos.
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
