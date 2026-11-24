// vite.config.js
// -----------------------------------------------------------------------------
// Configuração do Vite para um site MULTIPÁGINA (MPA) em HTML/CSS/JS puro.
//
// Por que cada página precisa ser declarada em `rollupOptions.input`?
//   O Vite, por padrão, assume uma aplicação de página única (só index.html).
//   Como a Doce Fefê.21 tem 11 páginas públicas + 9 do painel administrativo,
//   cada arquivo .html precisa ser listado para que o build gere todas elas.
//
// O proxy `/api` evita problemas de CORS durante o desenvolvimento: o navegador
// enxerga tudo no mesmo endereço (localhost:5173) e o Vite repassa as chamadas
// para o backend Express (localhost:3000).
// -----------------------------------------------------------------------------

import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// O projeto usa módulos ES ("type": "module" no package.json), onde `__dirname`
// não existe. Recriamos o caminho da raiz a partir da URL deste arquivo.
const raiz = dirname(fileURLToPath(import.meta.url));
const pagina = (caminho) => resolve(raiz, caminho);

export default defineConfig({
  // Caminhos relativos no build -> o site funciona em qualquer subpasta de deploy.
  base: './',

  server: {
    port: 5173,
    open: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // --- Páginas públicas ---
        index: pagina('index.html'),
        produtos: pagina('produtos.html'),
        produto: pagina('produto.html'),
        nossaHistoria: pagina('nossa-historia.html'),
        sejaRevendedor: pagina('seja-revendedor.html'),
        contato: pagina('contato.html'),
        carrinho: pagina('carrinho.html'),
        checkout: pagina('checkout.html'),
        pagamento: pagina('pagamento.html'),
        minhaConta: pagina('minha-conta.html'),
        politicaPrivacidade: pagina('politica-privacidade.html'),

        // --- Painel administrativo ---
        adminIndex: pagina('admin/index.html'),
        adminDashboard: pagina('admin/dashboard.html'),
        adminProdutos: pagina('admin/produtos.html'),
        adminPedidos: pagina('admin/pedidos.html'),
        adminClientes: pagina('admin/clientes.html'),
        adminEstoque: pagina('admin/estoque.html'),
        adminRevendedores: pagina('admin/revendedores.html'),
        adminSeparacao: pagina('admin/separacao.html'),
        adminCupons: pagina('admin/cupons.html'),
      },
    },
  },
});
