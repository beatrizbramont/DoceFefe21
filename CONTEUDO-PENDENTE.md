# 📋 Conteúdo pendente — Doce Fefê.21

Lista do que ainda precisa ser fornecido pela Doce Fefê.21 para o site ficar
completo. Nada desta lista será inventado — os espaços ficam reservados até o
material chegar.

Atualizado em: 22/11/2026

---

## 🖼 Imagens

| O quê | Onde aparece | Formato ideal | Situação |
|---|---|---|---|
| **Logomarca** | Cabeçalho, banner, rodapé | — | ✅ Recebida (`logo.jpeg`) |
| **Foto do Fefê** | Nossa História — abertura | Retrato 3:4, mín. 800×1067 | ⬜ Pendente |
| **Arte do Super Fefê** | Nossa História — seção própria | Quadrada ou retrato | ⬜ Pendente |
| **Fotos da caminhada** (3) | Nossa História — galeria | Quadradas, mín. 800×800 | ⬜ Pendente |
| **Fotos dos produtos** | Catálogo, página inicial | Quadradas, mín. 1000×1000 | ⬜ Pendente (Fase 3) |
| **Foto da produção** | Página inicial, Nossa História | Paisagem 4:3 | ⬜ Opcional |

**Como enviar:** salve os arquivos em `assets/images/` com nomes simples e sem
acentos (ex.: `fefe-retrato.jpg`, `super-fefe.png`, `galeria-01.jpg`) e me avise.
Eu coloco no lugar certo.

---

## ✍️ Textos

| O quê | Situação |
|---|---|
| **História da marca** | ✅ Recebida e publicada na íntegra |
| **Descrição dos produtos** | ⬜ Pendente (Fase 3) |
| **Ingredientes de cada produto** | ⬜ Pendente (Fase 3) |
| **Política de trocas e devoluções** | ⬜ Pendente (Fase 12) |

---

## 📞 Informações comerciais

| O quê | Situação | Onde é usado |
|---|---|---|
| **WhatsApp** | ✅ (11) 97978-8231 | Site inteiro |
| **Instagram** | ✅ @docefefe.21 | Rodapé, contato, home |
| **E-mail comercial** | ⬜ Pendente | Rodapé, contato |
| **Cidade / região de atendimento** | ⬜ Pendente | Rodapé, contato, FAQ |
| **Endereço para retirada** | ⬜ Pendente | Checkout (Fase 7) |
| **Prazo de produção** | ⬜ Pendente | FAQ, checkout |
| **Área e valor de entrega** | ⬜ Pendente | Checkout (Fase 7) |
| **Pedido mínimo para atacado** | ⬜ Pendente | Seja Revendedor (Fase 10) |
| **Razão social e CNPJ** | ⬜ Pendente | Rodapé, política de privacidade |

> Os campos de e-mail e cidade já estão programados em `js/config.js`. Assim
> que você informar, eles aparecem automaticamente no rodapé — é só preencher
> `CONTATO.email` e `CONTATO.cidade`.

---

## 🔑 Credenciais de serviços externos

Nenhuma credencial foi inventada. Estas são necessárias nas fases indicadas:

| Serviço | O que pegar | Fase |
|---|---|---|
| **Supabase** | Project URL, anon key, service_role key | 5 |
| **Mercado Pago** | Access Token, Public Key, segredo do webhook | 8 |
| **Google Analytics** | ID de medição (G-XXXXXXXXXX) | 11 (opcional) |
| **Domínio** | Registro de `docefefe21.com.br` ou similar | 12 |

Instruções detalhadas de onde obter cada uma estão no `README.md`.

---

## ⚠️ Observação sobre a arte do Pix

O arquivo `assets/images/PRIVADO-arte-pix-nao-publicar.jpeg` contém um QR Code
de Pix e o nome da titular da conta.

**Esse arquivo não é usado em nenhuma página do site, e não deve ser.**

Publicar um QR Code estático de Pix em site aberto traz dois problemas:

1. **Rastreabilidade** — não há como saber qual pagamento corresponde a qual
   pedido. A conferência vira manual e sujeita a erro.
2. **Exposição de dados** — nome completo da titular e chave bancária ficam
   acessíveis a qualquer visitante.

A partir da **Fase 8**, o Pix será gerado pelo Mercado Pago com um QR Code
único por pedido, valor já preenchido e **confirmação automática** por webhook.
Mais seguro para a marca e mais simples para o cliente.

O arquivo foi mantido na pasta (pode ser útil para impressão ou uso presencial),
apenas renomeado para deixar claro que não vai para o site.

---

*Pode mandar os itens aos poucos — cada um que chegar eu já encaixo no lugar.*
