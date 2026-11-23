# 🍫 Doce Fefê.21 — Loja Virtual

> Muito mais que doces, uma história de amor em cada pedaço.

Loja virtual completa de doces artesanais: catálogo, carrinho, checkout,
pagamentos e painel administrativo.

---

## 📑 Índice

- [Tecnologias](#-tecnologias)
- [Como executar](#-como-executar)
- [Estrutura do projeto](#-estrutura-do-projeto)
- [Variáveis de ambiente](#-variáveis-de-ambiente)
- [Decisões de arquitetura](#-decisões-de-arquitetura)
- [Segurança](#-segurança)
- [Roteiro de fases](#-roteiro-de-fases)
- [Identidade visual](#-identidade-visual)

---

## 🛠 Tecnologias

| Camada | Tecnologia |
|---|---|
| Frontend | HTML5, CSS3, JavaScript puro (sem frameworks) |
| Build | Vite 6 (multipágina) |
| Backend | Node.js 20+, Express |
| Banco de dados | PostgreSQL via Supabase |
| Autenticação | Supabase Auth |
| Imagens | Supabase Storage |
| Pagamentos | Mercado Pago (Pix e cartão) |
| Versionamento | Git / GitHub |

**Não são usados** React, Vue, Angular, Next.js ou qualquer framework de
frontend — conforme a especificação do projeto.

---

## 🚀 Como executar

### Pré-requisitos

- [Node.js](https://nodejs.org) versão 20 ou superior
- npm (vem junto com o Node)

Para conferir:

```bash
node --version
npm --version
```

### Instalação

```bash
# 1. Instalar as dependências
npm install

# 2. Criar o arquivo de variáveis de ambiente
copy .env.example .env      # Windows
# cp .env.example .env      # macOS / Linux
```

### Rodando

```bash
# Somente o site (suficiente até a Fase 4)
npm run dev
```

Abra <http://localhost:5173>.

```bash
# Site + API juntos (a partir da Fase 5)
npm start
```

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento do Vite (porta 5173) |
| `npm run build` | Gera a versão de produção em `dist/` |
| `npm run preview` | Serve o `dist/` para conferir antes de publicar |
| `npm run server` | Sobe apenas a API Express (porta 3000) |
| `npm start` | Sobe o site e a API ao mesmo tempo |

> **Nota:** até a Fase 5 o backend ainda não existe. `npm run dev` é o
> suficiente para trabalhar no site.

---

## 📁 Estrutura do projeto

```
DoceFefe21/
│
├── index.html                   Página inicial
├── produtos.html                Catálogo
├── produto.html                 Detalhes do produto
├── nossa-historia.html          História da marca
├── seja-revendedor.html         Cadastro de parceiros comerciais
├── contato.html                 Atendimento
├── carrinho.html                Carrinho de compras
├── checkout.html                Finalização do pedido
├── minha-conta.html             Área do cliente
├── politica-privacidade.html    LGPD e políticas
│
├── admin/                       Painel administrativo (9 páginas)
│
├── assets/
│   ├── images/                  Logomarca e fotos dos produtos
│   ├── icons/
│   └── fonts/
│
├── css/
│   ├── global.css               ★ Design system: tokens, reset, componentes
│   ├── header.css               Cabeçalho e menu do celular
│   ├── footer.css               Rodapé
│   ├── home.css                 Página inicial
│   ├── institucional.css        Nossa História e Contato
│   ├── produtos.css             Catálogo            (Fase 3)
│   ├── carrinho.css             Carrinho            (Fase 4)
│   ├── checkout.css             Checkout            (Fase 7)
│   └── admin.css                Painel              (Fase 9)
│
├── js/
│   ├── config.js                ★ Dados da marca, rotas e configurações
│   ├── main.js                  Ponto de entrada das páginas públicas
│   ├── navigation.js            Menu, página atual, rolagem
│   ├── whatsapp.js              Links e botão flutuante do WhatsApp
│   ├── contato.js               Formulário de contato e FAQ
│   ├── products.js              Catálogo            (Fase 3)
│   ├── cart.js                  Carrinho            (Fase 4)
│   ├── auth.js                  Autenticação        (Fase 6)
│   ├── checkout.js              Checkout            (Fase 7)
│   │
│   ├── lib/
│   │   ├── format.js            Moeda, data, telefone, CEP, CNPJ
│   │   ├── ui.js                Toasts, esqueletos, validação visual
│   │   └── api.js               Cliente HTTP da API
│   │
│   ├── components/
│   │   ├── site-header.js       Cabeçalho compartilhado
│   │   ├── site-footer.js       Rodapé compartilhado
│   │   ├── accordion.js         Sanfona acessível (FAQ)
│   │   └── icons.js             Ícones SVG inline
│   │
│   └── admin/                   Scripts do painel  (Fase 9)
│
├── backend/                                        (Fase 5)
│   ├── server.js
│   ├── routes/
│   ├── controllers/
│   ├── middleware/
│   └── webhooks/
│
├── services/                                       (Fase 5)
│   ├── database.js
│   ├── auth-service.js
│   ├── order-service.js
│   └── payment-service.js
│
├── database/                                       (Fase 5)
│   ├── schema.sql               Tabelas e relacionamentos
│   ├── rls.sql                  Políticas de segurança
│   └── seed.sql                 Dados de demonstração
│
├── robots.txt
├── sitemap.xml
├── .env.example
├── vite.config.js
└── package.json
```

★ = arquivos centrais, bons pontos de partida para entender o projeto.

---

## 🔐 Variáveis de ambiente

Copie `.env.example` para `.env` e preencha. **O `.env` nunca vai para o Git.**

### Regra fundamental

```
VITE_*          →  vai para o NAVEGADOR  →  apenas valores públicos
(sem prefixo)   →  fica no SERVIDOR      →  segredos
```

O Vite só embute no JavaScript do navegador as variáveis que começam com
`VITE_`. Um segredo sem esse prefixo é **estruturalmente incapaz** de vazar
para o cliente — não depende de disciplina do desenvolvedor.

### O que você precisa providenciar

| Serviço | Onde obter | Quando |
|---|---|---|
| **Supabase** | [supabase.com](https://supabase.com) → Project Settings → API | Fase 5 |
| **Mercado Pago** | [Painel do desenvolvedor](https://www.mercadopago.com.br/developers) → Suas integrações → Credenciais | Fase 8 |
| **Google Analytics** *(opcional)* | [analytics.google.com](https://analytics.google.com) | Fase 11 |

Do Supabase são necessárias três informações:

1. `Project URL` → vai em `VITE_SUPABASE_URL` **e** `SUPABASE_URL`
2. `anon public key` → vai em `VITE_SUPABASE_ANON_KEY` *(pública por design)*
3. `service_role key` → vai em `SUPABASE_SERVICE_ROLE_KEY` **(SEGREDO ABSOLUTO)**

> ⚠️ A `service_role key` ignora todas as políticas de segurança do banco.
> Ela existe apenas para o backend. Se vazar, o banco inteiro fica exposto.

---

## 🏛 Decisões de arquitetura

### Cabeçalho e rodapé gerados por JavaScript

Com 11 páginas públicas, copiar o HTML do menu em cada arquivo significaria
11 edições a cada mudança — e uma delas sempre ficaria para trás. Os
componentes em `js/components/` são a fonte única de verdade.

As páginas declaram apenas os pontos de montagem:

```html
<div id="cabecalho"></div>
<main id="conteudo"> ... </main>
<div id="rodape"></div>
```

### Dinheiro em centavos

Todos os valores monetários trafegam como **números inteiros em centavos**.
Isso elimina o erro clássico de ponto flutuante (`0.1 + 0.2` resulta em
`0.30000000000000004`), que em um carrinho vira diferença de centavos no
total. A conversão para exibição acontece só na hora de mostrar na tela,
via `lib/format.js`.

### Preços de atacado decididos no servidor

O navegador **nunca** informa se o usuário é revendedor. Ele pede o catálogo;
o backend consulta `resellers.status = 'aprovado'` no banco e decide se
devolve o preço de varejo ou o de atacado. Não há como forjar isso pelo
console do navegador.

### Nada de `innerHTML` com dados externos

As funções de `lib/ui.js` inserem texto via `textContent`, que escapa HTML
automaticamente. Se um produto se chamasse `<img onerror=alert(1)>`, o nome
apareceria como texto literal na tela em vez de executar — proteção contra XSS
por construção, e não por lembrança.

---

## 🛡 Segurança

Implementado ou preparado:

- [x] Segredos isolados do frontend por prefixo de variável
- [x] Proteção contra XSS por construção (`textContent`, nunca `innerHTML`)
- [x] `rel="noopener noreferrer"` em todo link que abre nova aba
- [x] Painel administrativo com `noindex, nofollow`
- [x] `.env` no `.gitignore`
- [ ] Validação de dados no servidor *(Fase 5)*
- [ ] Rate limiting *(Fase 5)*
- [ ] Políticas RLS no Supabase *(Fase 5)*
- [ ] Autorização por perfil nas rotas admin *(Fase 9)*
- [ ] Validação de assinatura dos webhooks *(Fase 8)*
- [ ] HTTPS obrigatório *(Fase 12)*

### Pagamentos

A confirmação de pagamento **nunca** acontece porque o cliente voltou à
página de sucesso. Ela ocorre apenas quando o webhook do Mercado Pago é
recebido, tem a assinatura validada e o valor confere com o pedido
registrado no banco.

---

## 🗺 Roteiro de fases

| Fase | Escopo | Situação |
|---|---|---|
| 1 | Configuração do projeto e identidade visual | ✅ Concluída |
| 2 | Páginas institucionais e layout | ✅ Concluída |
| 3 | Catálogo e produtos | ✅ Concluída |
| 4 | Carrinho | ✅ Concluída |
| 5 | Backend e banco de dados | ✅ Concluída |
| 6 | Autenticação e cadastro de clientes | ✅ Concluída |
| 7 | Checkout e pedidos | ✅ Concluída |
| 8 | Pagamentos | ✅ Concluída |
| 9 | Painel administrativo | ⬜ |
| 10 | Revendedores e atacado | ⬜ |
| 11 | Marketing e relatórios | ⬜ |
| 12 | Testes, segurança e publicação | ⬜ |

---

## 🎨 Identidade visual

### Paleta

| Cor | Código | Uso |
|---|---|---|
| Marrom chocolate | `#4A2C18` | Cor principal da marca |
| Chocolate escuro | `#2E1810` | Rodapé, fundos profundos |
| Dourado | `#C9922B` | Destaques, botões de ação |
| Dourado claro | `#EBD2A0` | Detalhes sobre fundo escuro |
| Creme | `#FFF9F1` | Fundo geral do site |
| Bege | `#F4E4CE` | Seções alternadas |

Todas as cores são variáveis CSS em `css/global.css`. Alterar lá muda o site
inteiro.

### Tipografia

- **Títulos:** Playfair Display — serifada, elegante, remete a confeitaria fina
- **Texto:** Nunito Sans — arredondada, acolhedora, ótima legibilidade

### ⚠️ Sobre a história da marca

O texto publicado em `nossa-historia.html` foi **escrito pela família** e está
no site na íntegra, palavra por palavra.

**Nenhuma informação biográfica pode ser criada, interpretada, resumida ou
ampliada.** Datas, diagnósticos e acontecimentos só entram no site se vierem
da família. Os marcos da linha do tempo foram extraídos exclusivamente desse
texto.

Há um teste automatizado que compara o texto publicado com o original e
falha se alguma palavra for alterada.

### ⚠️ Sobre a logomarca

O arquivo `assets/images/logo.jpeg` é a **logomarca original da marca**, com o
rosto do Fernando (Fefê).

**É proibido:** recriar, redesenhar, estilizar, deformar, recortar, aplicar
filtros de cor ou alterar de qualquer forma a imagem.

**É permitido:** redimensionar proporcionalmente e posicionar.

Os efeitos visuais do banner (anel dourado, brilho) são aplicados em elementos
irmãos da imagem — **nunca** sobre ela.

---

## 📞 Contato da marca

- **WhatsApp:** (11) 97978-8231
- **Instagram:** [@docefefe.21](https://instagram.com/docefefe.21)

---

*Doce Fefê.21 — Muito mais que doces, uma história de amor em cada pedaço.*
