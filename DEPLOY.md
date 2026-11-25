# 🚀 Publicar no Render

Guia completo para colocar a Doce Fefê.21 no ar, no plano gratuito.

São **dois serviços**, porque o projeto tem backend:

| Serviço | O que é | O que faz |
|---|---|---|
| `docefefe21-api` | Web Service | Roda o Node: pedidos, pagamento, painel |
| `docefefe21` | Static Site | Entrega as páginas, o CSS e o JavaScript |

A ordem importa: **publique a API primeiro**, porque o endereço dela é uma
das configurações do site.

---

## Antes de começar

1. O código precisa estar no GitHub, atualizado (`git push`)
2. Tenha o `.env` aberto — você vai copiar quatro valores de lá
3. Crie a conta em [render.com](https://render.com) com o GitHub

---

## Parte 1 — A API

**New +** → **Web Service** → conecte o repositório `DoceFefe21`.

| Campo | Valor |
|---|---|
| Name | `docefefe21-api` |
| Region | Oregon (US West) |
| Branch | `main` |
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `node backend/server.js` |
| Instance Type | **Free** |

### Variáveis de ambiente

Abra **Advanced** → **Add Environment Variable** e acrescente, uma a uma:

| Chave | Valor |
|---|---|
| `SUPABASE_URL` | copie do seu `.env` |
| `SUPABASE_SERVICE_ROLE_KEY` | copie do seu `.env` |
| `VITE_SUPABASE_ANON_KEY` | copie do seu `.env` |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | deixe vazio por enquanto — preenche na Parte 3 |

> ⚠️ A `SUPABASE_SERVICE_ROLE_KEY` tem poder total sobre o banco. Ela vive
> aqui e **só** aqui. Nunca num arquivo que vá para o GitHub.

Clique em **Create Web Service** e espere. Ao terminar, anote o endereço —
algo como `https://docefefe21-api.onrender.com`.

**Confira se subiu:** abra `https://docefefe21-api.onrender.com/api/saude`
no navegador. Precisa aparecer um JSON dizendo `"conectado": true`.

---

## Parte 2 — O site

**New +** → **Static Site** → o mesmo repositório.

| Campo | Valor |
|---|---|
| Name | `docefefe21` |
| Branch | `main` |
| Build Command | `npm install && npm run build` |
| Publish Directory | `dist` |

### Variáveis de ambiente

| Chave | Valor |
|---|---|
| `VITE_SUPABASE_URL` | copie do seu `.env` |
| `VITE_SUPABASE_ANON_KEY` | copie do seu `.env` |
| `VITE_API_URL` | o endereço da API, da Parte 1, **sem barra no fim** |

A `anon key` é pública por desenho — o que protege o banco são as políticas
RLS, não o segredo dessa chave. A `service_role` é que nunca pode aparecer
aqui: tudo que entra num `VITE_*` vai parar dentro do JavaScript que o
navegador baixa.

### Regra de reescrita — não pule esta

**Redirects/Rewrites** → **Add Rule**:

| Campo | Valor |
|---|---|
| Source | `/*` |
| Destination | `/404.html` |
| Action | Rewrite |
| Status | 404 |

Sem isso, um endereço errado mostra a tela de erro crua do Render em vez da
página 404 da marca.

Clique em **Create Static Site** e anote o endereço:
`https://docefefe21.onrender.com`.

---

## Parte 3 — Ligar os dois

Agora que você tem os dois endereços, falta apresentá-los um ao outro.

### 3.1 — CORS na API

Volte no serviço `docefefe21-api` → **Environment** → edite `CORS_ORIGINS`:

```
https://docefefe21.onrender.com
```

Sem barra no fim. Salve — o Render reinicia a API sozinho.

Essa variável é a lista de sites autorizados a chamar a API. Fica explícita,
nunca `*`: com curinga, qualquer site conseguiria fazer requisições
autenticadas em nome das suas clientes.

### 3.2 — Supabase

**Authentication** → **URL Configuration**:

- **Site URL**: `https://docefefe21.onrender.com`
- **Redirect URLs**: acrescente `https://docefefe21.onrender.com/**`

É isto que faz o e-mail de cadastro apontar para o site de verdade, em vez
de `localhost`.

---

## Parte 4 — Testar, clicando

Abra o site e percorra tudo. **Pelo celular também** — é de onde vem a
maioria das clientes.

- [ ] Home carrega com os produtos
- [ ] Catálogo mostra preços e o selo de promoção
- [ ] Página de um produto abre
- [ ] Adicionar ao carrinho, mudar quantidade
- [ ] Checkout pede login quando você não está logada
- [ ] Criar conta e receber o código por e-mail
- [ ] Fazer um pedido de ponta a ponta
- [ ] Tela de pagamento mostra o QR do Pix
- [ ] Enviar um comprovante
- [ ] Painel em `/admin/` — as sete telas
- [ ] Aprovar o pagamento do pedido de teste
- [ ] Um endereço errado mostra a página 404 da marca

**Apague o pedido de teste depois.**

---

## O que esperar do plano gratuito

**A API hiberna.** Depois de 15 minutos sem ninguém acessar, o Render
desliga o serviço. A visita seguinte espera de 30 a 60 segundos numa tela
carregando — e a cliente acha que quebrou.

Para divulgação no Instagram, onde a visita vem em rajada, isso custa venda.
Quando incomodar, o **Starter do Render (US$ 7/mês)** tira a hibernação sem
mudar nada na configuração.

**O site estático não hiberna** — só a API. Então a home abre rápido e os
produtos demoram, o que é confuso. Vale um aviso de "carregando" paciente,
ou o plano pago.

---

## Quando tiver domínio próprio

No Static Site → **Settings** → **Custom Domain**. O Render emite o
certificado HTTPS sozinho. Depois, repita a Parte 3 com o endereço novo —
`CORS_ORIGINS` e Supabase precisam acompanhar.

---

## Se algo der errado

| Sintoma | Causa provável |
|---|---|
| Catálogo vazio, console mostra erro de CORS | `CORS_ORIGINS` errado ou com barra no fim |
| Catálogo vazio, erro 500 | Variáveis do Supabase faltando na API |
| `/api/saude` diz `conectado: false` | `SUPABASE_SERVICE_ROLE_KEY` errada |
| E-mail de cadastro aponta para localhost | Site URL do Supabase não foi trocado |
| Build falha | Veja o log do Render; quase sempre é variável ausente |

O log fica em **Logs**, dentro de cada serviço. Ele diz o motivo real — vale
ler antes de tentar adivinhar.
