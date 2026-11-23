/**
 * tests/executar.mjs
 * -----------------------------------------------------------------------------
 * Roda todos os testes do projeto.
 *
 *   npm test
 *
 * Usa apenas módulos nativos do Node — nenhuma biblioteca de teste precisa ser
 * instalada. Sai com código 1 se qualquer verificação falhar, o que permite
 * usar isso num hook de commit ou numa esteira de publicação no futuro.
 */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PASTA_TESTES = dirname(fileURLToPath(import.meta.url));
const RAIZ_PROJETO = join(PASTA_TESTES, '..');

const arquivos = readdirSync(PASTA_TESTES)
  .filter((f) => f.endsWith('.test.mjs'))
  .sort();

if (arquivos.length === 0) {
  console.log('Nenhum teste encontrado.');
  process.exit(0);
}

console.log(`\n🍫 Doce Fefê.21 — executando ${arquivos.length} suíte(s) de teste\n`);

let falharam = 0;

for (const arquivo of arquivos) {
  console.log(`${'═'.repeat(52)}`);
  console.log(`  ${arquivo}`);
  console.log(`${'═'.repeat(52)}`);

  const resultado = spawnSync(
    process.execPath,
    [join(PASTA_TESTES, arquivo), RAIZ_PROJETO],
    { stdio: 'inherit' }
  );

  if (resultado.status !== 0) falharam += 1;
}

console.log(`${'═'.repeat(52)}`);

if (falharam > 0) {
  console.log(`\n  ✕ ${falharam} suíte(s) com falhas.\n`);
  process.exit(1);
}

console.log('\n  ✓ Todas as suítes passaram.\n');
