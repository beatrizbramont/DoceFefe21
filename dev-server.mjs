/**
 * dev-server.mjs
 * -----------------------------------------------------------------------------
 * Servidor de desenvolvimento com ZERO dependências.
 *
 * Por que isto existe?
 *   Módulos JavaScript (`<script type="module">`) não funcionam ao abrir o
 *   arquivo direto pelo navegador (protocolo file://) — o navegador bloqueia
 *   por segurança. É preciso servir as páginas por HTTP.
 *
 *   O Vite faz isso e muito mais, mas exige `npm install`. Este arquivo usa
 *   apenas módulos nativos do Node, então funciona de imediato, sem baixar
 *   nada. É a rede de segurança para desenvolver mesmo sem o Vite instalado.
 *
 * Como usar:
 *   node dev-server.mjs
 *   Depois abra  http://localhost:5173
 *
 * Importante: isto é só para DESENVOLVIMENTO. A publicação usa `npm run build`.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const RAIZ = dirname(fileURLToPath(import.meta.url));
const PORTA = Number(process.env.PORT) || 5173;

/** Endereço do backend, para onde as chamadas /api são encaminhadas. */
const API_URL = process.env.API_URL || 'http://localhost:3000';

/* -----------------------------------------------------------------------------
 * VARIÁVEIS PÚBLICAS PARA O NAVEGADOR
 *
 * O código do site lê as configurações de `import.meta.env.VITE_*`. Isso é uma
 * SUBSTITUIÇÃO FEITA PELO VITE em tempo de build — ele troca cada ocorrência
 * pelo valor literal antes de entregar o arquivo.
 *
 * Este servidor entrega os arquivos sem transformação nenhuma, então
 * `import.meta.env` chega ao navegador como `undefined`. Foi por isso que a
 * área do cliente acusava "faltam VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY"
 * mesmo com as duas preenchidas no .env.
 *
 * A solução: injetar as variáveis em `window.__ENV__` nas páginas HTML.
 * O js/config.js lê de `import.meta.env` primeiro e recorre a isto como
 * alternativa, então os dois modos de execução funcionam.
 *
 * ⚠️ SOMENTE variáveis com prefixo VITE_ são injetadas — a mesma regra do
 *    Vite. Um segredo sem esse prefixo é estruturalmente incapaz de chegar
 *    ao navegador, nem por engano.
 * -------------------------------------------------------------------------- */

function lerVariaveisPublicas() {
  const caminhoEnv = join(RAIZ, '.env');
  if (!existsSync(caminhoEnv)) return {};

  const publicas = {};

  for (const linha of readFileSync(caminhoEnv, 'utf8').split(/\r?\n/)) {
    const texto = linha.trim();
    if (!texto || texto.startsWith('#')) continue;

    const igual = texto.indexOf('=');
    if (igual === -1) continue;

    const chave = texto.slice(0, igual).trim();
    if (!chave.startsWith('VITE_')) continue;

    let valor = texto.slice(igual + 1).trim();
    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1);
    }

    publicas[chave] = valor;
  }

  return publicas;
}

/**
 * Monta o <script> injetado no <head> de cada página.
 *
 * O valor é serializado duas vezes de propósito: a primeira produz o JSON, a
 * segunda o transforma numa string JS escapada. Assim, nem aspas nem um
 * literal `</script>` dentro de alguma variável conseguem quebrar a página.
 */
function montarScriptDeAmbiente() {
  const json = JSON.stringify(JSON.stringify(lerVariaveisPublicas()));
  return `<script>window.__ENV__=JSON.parse(${json});</script>`;
}

/** Tipos MIME. Sem o correto, o navegador recusa executar os módulos JS. */
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

/**
 * Converte a URL pedida em um caminho de arquivo seguro.
 *
 * SEGURANÇA: impede "directory traversal" — pedidos como
 * `/../../Windows/System32/config` não podem escapar da pasta do projeto.
 * Retorna null quando a tentativa é suspeita.
 */
function resolverCaminho(urlPedida) {
  const semQuery = urlPedida.split('?')[0].split('#')[0];
  const decodificada = decodeURIComponent(semQuery);

  // A raiz do site serve a página inicial.
  const relativa = decodificada === '/' ? '/index.html' : decodificada;

  const completo = normalize(join(RAIZ, relativa));

  // O caminho final precisa continuar dentro da raiz do projeto.
  if (!completo.startsWith(RAIZ + sep) && completo !== RAIZ) return null;

  return completo;
}

/**
 * Encaminha as chamadas /api para o backend (porta 3000).
 *
 * Sem isso, o navegador veria o site em :5173 e a API em :3000 — origens
 * diferentes, o que dispararia CORS. Com o encaminhamento, tudo parece vir
 * do mesmo endereço, igual ao que acontece em produção.
 */
async function encaminharParaApi(req, res) {
  const destino = `${API_URL}${req.url}`;

  try {
    // Junta o corpo da requisição, quando houver.
    const corpo =
      req.method === 'GET' || req.method === 'HEAD'
        ? undefined
        : await new Promise((resolver) => {
            const pedacos = [];
            req.on('data', (p) => pedacos.push(p));
            req.on('end', () => resolver(Buffer.concat(pedacos)));
          });

    // Cabeçalhos que NÃO podem ser repassados:
    //
    //   host              → precisa ser o do destino, não o deste servidor
    //   content-length    → o fetch recalcula; repassar causa conflito
    //   connection        → cabeçalho "salto a salto", proibido pelo fetch
    //   keep-alive        → idem
    //   transfer-encoding → idem
    //   upgrade           → idem
    //
    // Repassar qualquer um deles faz o fetch lançar erro e o proxy devolver
    // 502 — foi exatamente o que aconteceu nos primeiros testes de POST.
    //   expect            → "100-continue" é negociado entre cliente e este
    //                        servidor; repassá-lo faz o fetch recusar com
    //                        "expect header not supported"
    const PROIBIDOS = new Set([
      'host',
      'content-length',
      'connection',
      'keep-alive',
      'transfer-encoding',
      'upgrade',
      'proxy-connection',
      'te',
      'trailer',
      'expect',
    ]);

    const cabecalhos = {};
    for (const [nome, valor] of Object.entries(req.headers)) {
      if (!PROIBIDOS.has(nome.toLowerCase())) cabecalhos[nome] = valor;
    }

    const resposta = await fetch(destino, {
      method: req.method,
      headers: cabecalhos,
      body: corpo && corpo.length > 0 ? corpo : undefined,
    });

    const conteudo = Buffer.from(await resposta.arrayBuffer());

    const cabecalhosResposta = {};
    resposta.headers.forEach((valor, nome) => {
      // `content-encoding` e `content-length` já foram resolvidos pelo fetch;
      // repassá-los faria o navegador tentar descomprimir de novo.
      if (nome !== 'content-encoding' && nome !== 'content-length') {
        cabecalhosResposta[nome] = valor;
      }
    });

    res.writeHead(resposta.status, cabecalhosResposta);
    res.end(conteudo);

    console.log(`  ${resposta.status}  ${req.method} ${req.url}  → API`);
  } catch (erro) {
    // A causa real costuma estar em `erro.cause` — sem ela, a mensagem é
    // apenas "fetch failed", que não ajuda a diagnosticar nada.
    const causa = erro.cause?.message || erro.message;

    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        erro: true,
        mensagem:
          'A API não está respondendo. Em outro terminal, rode: npm run server',
        detalhe: causa,
      })
    );
    console.log(`  502  ${req.method} ${req.url}  → ${causa}`);
  }
}

const servidor = createServer(async (req, res) => {
  const inicio = Date.now();

  // Chamadas à API vão para o backend; o resto é arquivo estático.
  if (req.url.startsWith('/api/')) {
    await encaminharParaApi(req, res);
    return;
  }

  let caminho = resolverCaminho(req.url);

  if (!caminho) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 — Acesso negado');
    console.log(`  403  ${req.url}`);
    return;
  }

  try {
    let info = await stat(caminho);

    // Pediu uma pasta (ex.: /admin/) -> entrega o index.html dela.
    if (info.isDirectory()) {
      caminho = join(caminho, 'index.html');
      info = await stat(caminho);
    }

    const extensao = extname(caminho).toLowerCase();
    const tipo = TIPOS[extensao] || 'application/octet-stream';

    let conteudo = await readFile(caminho);

    // Páginas HTML recebem as variáveis públicas de ambiente logo no início
    // do <head>, antes de qualquer script do site rodar.
    if (extensao === '.html') {
      const html = conteudo.toString('utf8');
      const script = montarScriptDeAmbiente();

      conteudo = Buffer.from(
        html.includes('<head>')
          ? html.replace('<head>', `<head>\n  ${script}`)
          : `${script}\n${html}`,
        'utf8'
      );
    }

    res.writeHead(200, {
      'Content-Type': tipo,
      'Content-Length': Buffer.byteLength(conteudo),
      // Sem cache: toda alteração aparece ao recarregar a página.
      'Cache-Control': 'no-store, must-revalidate',
    });
    res.end(conteudo);

    console.log(`  200  ${req.url}  (${Date.now() - inicio}ms)`);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
       <title>404 — Página não encontrada</title>
       <style>
         body{font-family:system-ui,sans-serif;background:#FFF9F1;color:#35211A;
              display:grid;place-items:center;min-height:100vh;margin:0;text-align:center}
         h1{font-size:3rem;margin:0;color:#4A2C18}
         code{background:#F4E4CE;padding:.2rem .5rem;border-radius:6px}
         a{color:#C9922B;font-weight:700}
       </style></head>
       <body><div>
         <h1>404</h1>
         <p>Não encontramos <code>${req.url.replace(/[<>&"]/g, '')}</code></p>
         <p><a href="/">Voltar para a página inicial</a></p>
       </div></body></html>`
    );
    console.log(`  404  ${req.url}`);
  }
});

servidor.listen(PORTA, () => {
  console.log('');
  console.log('  🍫  Doce Fefê.21 — servidor de desenvolvimento');
  console.log('  ─────────────────────────────────────────────');
  console.log(`  Site:   http://localhost:${PORTA}`);
  console.log(`  Admin:  http://localhost:${PORTA}/admin/`);
  console.log('');
  console.log('  Pressione Ctrl+C para parar.');
  console.log('');
});

servidor.on('error', (erro) => {
  if (erro.code === 'EADDRINUSE') {
    console.error(`\n  ✕ A porta ${PORTA} já está em uso.`);
    console.error(`    Feche o outro servidor ou rode:  set PORT=5174 && node dev-server.mjs\n`);
  } else {
    console.error('\n  ✕ Erro no servidor:', erro.message, '\n');
  }
  process.exit(1);
});
