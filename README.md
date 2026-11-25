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
- [Painel administrativo](#-painel-administrativo)
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
| Pagamentos | Pix com comprovante, conferido no painel |
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
├── admin/                       Painel administrativo
│   ├── index.html               Redireciona para a visão geral
│   ├── dashboard.html           Faturamento, fila de trabalho, alertas
│   ├── pedidos.html             Conferência de comprovantes e status
│   ├── produtos.html            Cadastro, preços e fotos
│   ├── estoque.html             Saldo, movimentos e histórico
│   ├── clientes.html            Cadastros e histórico de compras
│   └── (revendedores, cupons e relatórios: Fases 10 e 11)
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
│   ├── pagamento.css            Pagamento           (Fase 8)
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
│   └── admin/                   Painel             (Fase 9)
│       ├── sessao.js            ★ Login, cabeçalho e menu compartilhados
│       ├── dashboard.js
│       ├── pedidos.js
│       ├── produtos.js
│       ├── estoque.js
│       └── clientes.js
│
├── backend/                                        (Fase 5)
│   ├── server.js
│   ├── routes/index.js          ★ Tabela única de rotas
│   ├── controllers/
│   └── middleware/
│
├── services/                                       (Fase 5)
│   ├── database.js              Acesso ao PostgreSQL via PostgREST
│   ├── auth-service.js          Quem é o usuário e o que ele pode
│   ├── order-service.js
│   ├── payment-service.js
│   ├── product-service.js       Catálogo do visitante
│   ├── upload.js                Validação e gravação de arquivos
│   ├── product-admin-service.js Catálogo da loja     (Fase 9)
│   └── admin-service.js         Resumo, estoque e clientes (Fase 9)
│
├── database/                    Arquivos SQL, executados EM ORDEM
│   ├── 01-schema.sql            Tabelas e relacionamentos
│   ├── 02-rls.sql               Políticas de segurança
│   ├── 03-seed.sql              Dados de demonstração
│   ├── …                        Correções e ajustes de catálogo
│   ├── 13-criar-admin.sql       Promove uma conta a administradora
│   ├── 14-painel-admin.sql      Fotos, estoque e resumo  (Fase 9)
│   ├── 15-revendedores.sql      Desconto e pedido mínimo (Fase 10)
│   └── 16-conferencia-sem-comprovante.sql   Correção
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

> **É só isso.** A Fase 8 foi entregue com **Pix por comprovante**, conferido
> pela loja no painel — sem intermediador de pagamento. E não há rastreamento
> de visitantes. Nenhuma outra credencial é necessária.

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

A conta do parceiro é feita por `preco_para_usuario`, uma função do banco:

```
preço do parceiro = preço de atacado − (atacado × desconto do parceiro)
```

Ela é chamada a cada item de cada pedido, dentro da mesma transação que grava
o pedido. Nem o preço nem a condição de atacado chegam como parâmetro — se o
backend inteiro fosse comprometido e tentasse gravar um item pela metade do
preço, a função recalcularia o valor correto.

### Ícones em SVG, nunca emoji

Emoji parece prático e é armadilha: **cada sistema desenha o seu**. O 🤝 do
Windows não é o do iPhone, que não é o do Android — e não há CSS que conserte,
porque o desenho vem da fonte do sistema. Um painel montado com emoji muda de
cara conforme quem abre.

Os ícones ficam em `js/components/icons.js`, como SVG inline: desenhados uma
vez, iguais em todo lugar, herdando a cor do texto via `currentColor` e sem
nenhuma requisição extra. Uma biblioteca como Font Awesome traria o mesmo
resultado visual ao custo de um pedido a um servidor de terceiros em cada
carregamento de página — num projeto cuja regra é zero dependência externa.

Há duas formas de pedir um ícone:

```js
icone('alerta')                              // no JavaScript
```
```html
<span data-icone="alerta" aria-hidden="true"></span>   <!-- no HTML -->
```

`tests/icones.test.mjs` falha se um emoji voltar para a interface. Ele
distingue emoji de **tipografia**: `←`, `→` e `−` continuam permitidos, porque
quem os desenha é a fonte do texto, não o sistema.

### Nada de `innerHTML` com dados externos

As funções de `lib/ui.js` inserem texto via `textContent`, que escapa HTML
automaticamente. Se um produto se chamasse `<img onerror=alert(1)>`, o nome
apareceria como texto literal na tela em vez de executar — proteção contra XSS
por construção, e não por lembrança.

---

## 🔐 Painel administrativo

Fica em `/admin/`. Cinco telas, um login só.

| Tela | Para quê |
|---|---|
| **Visão geral** | Faturamento do período, fila de trabalho, produtos acabando |
| **Separação** | O que produzir e separar num dia, com folha para imprimir |
| **Pedidos** | Abrir o comprovante, conferir no extrato, aprovar e avançar o pedido |
| **Produtos** | Cadastrar, editar preço, enviar foto, publicar e arquivar |
| **Estoque** | Entrada, saída, perda, contagem — tudo com histórico |
| **Clientes** | Cadastros, contato e quanto cada pessoa já comprou |
| **Parceiros** | Aprovar revendedores e definir desconto e pedido mínimo |

### Como ganhar acesso

1. Crie sua conta normalmente pelo site, em `minha-conta.html`
2. Abra `database/13-criar-admin.sql`, troque o e-mail e execute no Supabase
3. Entre em `/admin/dashboard.html`

Não existe tela para promover administrador, e isso é deliberado: a permissão
mais sensível do sistema não deve ter superfície exposta à internet. Quem
promove precisa ter a senha do banco.

### O que o painel NÃO faz

- **Não apaga produto.** Arquiva. `order_items` aponta para o produto, e
  apagar transformaria o histórico de vendas em "produto removido".
- **Não edita cliente.** Alterar dado pessoal exigiria registrar quem alterou
  o quê e quando. Enquanto esse registro não existir, a tela é só leitura.
- **Não promove ninguém.** Ver acima.
- **Não tem cupons.** A tabela `coupons` e a lógica de desconto seguem no
  banco, usadas por `criar_pedido`, mas não há como criar nem aplicar cupom:
  a loja decidiu não trabalhar com eles.
- **Não mede visitas.** Não há Google Analytics nem rastreador nenhum. Se um
  dia houver, vem junto com o aviso de cookies que a LGPD exige.

### A folha de separação

A tela **Separação** responde uma pergunta só: *o que precisa sair da cozinha
neste dia?* Por isso ela abre com o somatório por produto — **18 brownies** —
e não com a lista de pedidos. Na hora de assar não interessa que o brownie
está em seis pedidos; interessa na hora de embalar, e aí vêm as duas listas
de baixo, entregas e retiradas.

⚠️ **O dia que filtra é o que o cliente pediu**, não a data da venda. Um
pedido feito hoje para sexta não entra na produção de hoje.

Por padrão entram só pedidos com **pagamento já conferido**: produzir antes de
receber é decisão da dona, não comportamento automático do sistema. Pedidos
sem dia combinado não somem — viram um aviso, porque são trabalho pendente.

O botão de imprimir não gera arquivo: chama a janela de impressão do
navegador, que também salva em PDF. Os estilos `@media print` tiram menu,
filtros e botões, e deixam uma caixa vazia na frente de cada linha para
riscar conforme separa.

### Revenda e atacado

Quem quer revender se cadastra em `seja-revendedor.html` — **com conta**, já
que o preço de atacado fica vinculado a ela. A candidatura nasce `pendente` e
não concede nada; na tela **Parceiros** a loja aprova e define duas condições:

| Condição | O que faz |
|---|---|
| **Desconto** | Percentual abatido do preço de **atacado** de cada produto |
| **Pedido mínimo** | Valor em mercadoria abaixo do qual o pedido é recusado |

O mínimo é conferido no banco, dentro da transação que cria o pedido — não só
no botão do carrinho. Frete não entra nessa conta: senão um endereço distante
ajudaria a atingir o mínimo.

Suspender um parceiro devolve a conta dele ao preço de varejo imediatamente.

### Antes de usar

O painel depende dos arquivos `database/14-painel-admin.sql` (bucket das
fotos, funções de estoque e resumo) e `database/15-revendedores.sql` (desconto
do parceiro e pedido mínimo). Execute os arquivos SQL **em ordem numérica**.

---

## 🛡 Segurança

Implementado ou preparado:

- [x] Segredos isolados do frontend por prefixo de variável
- [x] Proteção contra XSS por construção (`textContent`, nunca `innerHTML`)
- [x] `rel="noopener noreferrer"` em todo link que abre nova aba
- [x] Painel administrativo com `noindex, nofollow`
- [x] `.env` no `.gitignore`
- [x] Validação de dados no servidor *(Fase 5)*
- [x] Rate limiting por rota *(Fase 5)*
- [x] Políticas RLS no Supabase *(Fase 5)*
- [x] Autorização por perfil nas rotas admin *(Fase 9)*
- [x] Arquivos validados pela assinatura binária, não pela extensão *(Fases 8 e 9)*
- [x] HTTPS obrigatório — certificado emitido pelo Render *(Fase 12)*
- [x] Política de privacidade descrevendo os dados realmente coletados *(Fase 12)*
- [x] Teste de invasão com a chave pública, a partir de fora *(Fase 12)*

### Pagamentos

A confirmação de pagamento **nunca** acontece porque o cliente disse que
pagou. O fluxo tem dois estados separados de propósito:

```
comprovante_enviado  →  "o cliente afirma que pagou"
pagamento_aprovado   →  "a loja conferiu no extrato"
```

Só o painel administrativo, atrás de `exigirAdmin`, consegue levar um pedido
do primeiro estado ao segundo. É o mesmo princípio do webhook de um
intermediador: a confirmação precisa vir de uma fonte que o cliente não
controla. Aqui essa fonte é a pessoa que olha a conta bancária.

**Conferir exige lastro, não necessariamente comprovante.** Quando o cliente
paga o Pix e avisa por fora sem enviar o print, a loja aprova escrevendo como
confirmou — "conferido no extrato". O texto fica gravado junto de quem aprovou
e quando. O que não existe é aprovação no escuro.

### Dois buckets, duas naturezas

| Bucket | Acesso | Por quê |
|---|---|---|
| `comprovantes` | **Privado** — link assinado que expira em 5 min | Traz nome, banco, valor e horário: dado pessoal de um cliente |
| `produtos` | **Público para leitura** | É foto de brownie, feita para o mundo ver |

Nos dois casos a **escrita** é exclusiva do backend: nenhum bucket tem
política de insert, então o RLS do Storage nega gravação para as chaves
pública e autenticada.

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
| 9 | Painel administrativo | ✅ Concluída |
| 10 | Revendedores e atacado | ✅ Concluída |
| 11 | Separação do dia | ✅ Concluída |
| 12 | Testes, segurança e publicação | ✅ Concluída |

**O site está no ar:** <https://docefefe21.onrender.com>

A Fase 12 entregou as 15 suítes de teste, a auditoria de segurança (incluindo
um teste de invasão feito de fora, usando só a chave pública que todo
navegador baixa), a **política de privacidade**, a página 404, o `sitemap.xml`
e a publicação no Render. O passo a passo está em [`DEPLOY.md`](DEPLOY.md).

O que ficou registrado como melhoria futura, e não como pendência: o plano
gratuito do Render hiberna a API depois de 15 minutos parada, e a primeira
visita seguinte espera até um minuto carregando.

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
