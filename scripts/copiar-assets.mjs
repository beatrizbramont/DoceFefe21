// scripts/copiar-assets.mjs
// -----------------------------------------------------------------------------
// Copia a pasta `assets/` inteira para dentro do `dist/`, depois do build.
//
// POR QUE ISTO PRECISA EXISTIR
//
//   O Vite só copia para o `dist/` os arquivos que ele consegue ENXERGAR no
//   código — um `import`, ou um `src="..."` escrito direto no HTML. Tudo que
//   é montado em tempo de execução passa despercebido.
//
//   E o projeto monta em tempo de execução de propósito: `rota()` e
//   `urlMidia()` constroem os caminhos quando a página roda, justamente para
//   que o site funcione em qualquer servidor de arquivos, com ou sem Vite.
//
//   O resultado era este: no `npm run dev` tudo aparecia (o servidor do Vite
//   entrega os arquivos direto do disco), e no site publicado as fotos dos
//   produtos simplesmente não existiam. A logomarca aparecia em algumas
//   páginas e sumia em outras — justamente as em que ela vinha do JavaScript.
//
//   Um defeito que NÃO dá para ver em desenvolvimento. Só no ar.
//
// POR QUE CÓPIA, E NÃO `publicDir`
//
//   O caminho padrão do Vite seria mover `assets/` para dentro de `public/`.
//   Mas os arquivos HTML referenciam `./assets/images/...` diretamente, e
//   mover a pasta quebraria essas referências no disco. Copiar depois do
//   build resolve o mesmo problema sem mexer em nenhum caminho existente.
//
//   Os dois convivem: o Vite grava as versões com hash em `dist/assets/`, e
//   esta cópia cria `dist/assets/images/`. Pastas diferentes, sem conflito.
// -----------------------------------------------------------------------------

import { cp, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const origem = resolve(raiz, 'assets');
const destino = resolve(raiz, 'dist', 'assets');

try {
  await access(origem);
} catch {
  console.error('\n  Pasta `assets/` não encontrada. Nada foi copiado.\n');
  // Sair com erro: um build sem imagens é um build quebrado, e passar
  // adiante em silêncio é como o defeito chegou à produção da primeira vez.
  process.exit(1);
}

await cp(origem, destino, { recursive: true });

console.log('  assets/ copiada para dist/assets/');
