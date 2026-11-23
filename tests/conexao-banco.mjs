/**
 * tests/conexao-banco.mjs
 * -----------------------------------------------------------------------------
 * Diagnóstico da conexão com o Supabase.
 *
 *   npm run db:check
 *
 * Diz exatamente em que ponto a configuração está e o que fazer a seguir.
 * Não é um teste automatizado comum (depende de rede), por isso não tem o
 * sufixo .test.mjs e não entra no `npm test`.
 */

import { verificarConexao, bancoConfigurado, selecionar } from '../services/database.js';
import { lerVariaveisDeAmbiente } from '../services/env.js';

const env = lerVariaveisDeAmbiente();

const linha = (c = '─') => console.log(c.repeat(54));

console.log('');
linha('═');
console.log('  🍫 Doce Fefê.21 — diagnóstico do banco de dados');
linha('═');
console.log('');

/* -----------------------------------------------------------------------------
 * 1. Variáveis de ambiente
 * -------------------------------------------------------------------------- */

console.log('1. Configuração (.env)');
console.log('');

const mascarar = (valor) =>
  !valor ? '(vazio)' : `${valor.slice(0, 14)}…${valor.slice(-4)}`;

const itens = [
  ['SUPABASE_URL', env.SUPABASE_URL, false],
  ['SUPABASE_SERVICE_ROLE_KEY', env.SUPABASE_SERVICE_ROLE_KEY, true],
  ['VITE_SUPABASE_URL', env.VITE_SUPABASE_URL, false],
  ['VITE_SUPABASE_ANON_KEY', env.VITE_SUPABASE_ANON_KEY, true],
];

let faltando = 0;
for (const [nome, valor, secreto] of itens) {
  const marca = valor ? '✓' : '✗';
  if (!valor) faltando += 1;
  console.log(`   ${marca} ${nome.padEnd(28)} ${secreto ? mascarar(valor) : valor || '(vazio)'}`);
}

if (faltando > 0) {
  console.log('');
  console.log(`   ⚠ ${faltando} variável(is) ausente(s). Preencha o arquivo .env`);
  console.log('     (use .env.example como modelo).');
  console.log('');
  process.exit(1);
}

/* -----------------------------------------------------------------------------
 * 2. Conexão
 * -------------------------------------------------------------------------- */

console.log('');
console.log('2. Conexão com o Supabase');
console.log('');

if (!bancoConfigurado) {
  console.log('   ✗ Credenciais ausentes.');
  process.exit(1);
}

const resultado = await verificarConexao();

if (!resultado.conectado) {
  console.log(`   ✗ ${resultado.mensagem}`);
  console.log('');

  if (/self-signed certificate|CERT/i.test(resultado.mensagem)) {
    linha();
    console.log('  CAUSA PROVÁVEL: proxy corporativo inspecionando HTTPS.');
    console.log('');
    console.log('  Rode com a flag que faz o Node confiar nos certificados');
    console.log('  do Windows:');
    console.log('');
    console.log('      node --use-system-ca tests/conexao-banco.mjs');
    console.log('');
    console.log('  O arquivo .npmrc do projeto já aplica isso ao npm.');
    linha();
  }

  console.log('');
  process.exit(1);
}

console.log('   ✓ Conectado ao Supabase');

/* -----------------------------------------------------------------------------
 * 3. Esquema
 * -------------------------------------------------------------------------- */

console.log('');
console.log('3. Esquema do banco');
console.log('');

if (!resultado.esquemaAplicado) {
  console.log('   ✗ As tabelas ainda não existem.');
  console.log('');
  linha();
  console.log('  O QUE FAZER AGORA');
  console.log('');
  console.log('  1. Abra o painel do Supabase');
  console.log('  2. Menu lateral > SQL Editor > New query');
  console.log('  3. Cole e execute, NESTA ORDEM:');
  console.log('');
  console.log('       database/01-schema.sql');
  console.log('       database/02-rls.sql');
  console.log('       database/03-seed.sql');
  console.log('');
  console.log('  4. Rode este diagnóstico de novo: npm run db:check');
  linha();
  console.log('');
  process.exit(1);
}

console.log('   ✓ Tabelas criadas');
console.log(`   ✓ Categorias cadastradas: ${resultado.detalhes.categorias}`);
console.log(`   ✓ Produtos publicados:    ${resultado.detalhes.produtosPublicados}`);

/* -----------------------------------------------------------------------------
 * 4. Amostra do catálogo
 * -------------------------------------------------------------------------- */

if (resultado.detalhes.produtosPublicados > 0) {
  console.log('');
  console.log('4. Amostra do catálogo');
  console.log('');

  const amostra = await selecionar('catalogo_publico', {
    colunas: 'nome,preco_varejo,categoria_nome,disponivel',
    ordenar: 'nome.asc',
    limite: 5,
  });

  for (const p of amostra) {
    const preco = (p.preco_varejo / 100).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });
    console.log(
      `   • ${p.nome.padEnd(34)} ${preco.padStart(10)}  ${p.categoria_nome}`
    );
  }
}

/* -----------------------------------------------------------------------------
 * 5. Verificação de segurança
 * -------------------------------------------------------------------------- */

console.log('');
console.log('5. Segurança');
console.log('');

// A visão pública NÃO pode expor preço de atacado.
const amostraPublica = await selecionar('catalogo_publico', { limite: 1 });
if (amostraPublica.length > 0) {
  const colunas = Object.keys(amostraPublica[0]);
  if (colunas.includes('preco_atacado')) {
    console.log('   ✗ FALHA GRAVE: catalogo_publico expõe preco_atacado!');
    process.exit(1);
  }
  console.log('   ✓ catalogo_publico não expõe preço de atacado');
}

// A chave pública não deve conseguir ler a tabela de cupons.
try {
  const resposta = await fetch(
    `${env.SUPABASE_URL}/rest/v1/coupons?select=codigo&limit=1`,
    {
      headers: {
        apikey: env.VITE_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}`,
      },
    }
  );
  const dados = await resposta.json().catch(() => []);

  if (Array.isArray(dados) && dados.length > 0) {
    console.log('   ✗ ALERTA: a chave pública consegue ler os cupons!');
    console.log('     Confira se 02-rls.sql foi executado.');
    process.exit(1);
  }
  console.log('   ✓ chave pública não lê a tabela de cupons (RLS ativo)');
} catch {
  console.log('   ⚠ não foi possível testar o RLS dos cupons');
}

console.log('');
linha('═');
console.log('  ✓ Banco de dados pronto para uso.');
linha('═');
console.log('');
