# 📋 Conteúdo pendente — Doce Fefê.21

Lista do que ainda precisa ser fornecido pela Doce Fefê.21 para o site ficar
completo. Nada desta lista será inventado — os espaços ficam reservados até o
material chegar.

Atualizado em: 24/11/2026

---

## 🖼 Imagens

| O quê | Onde aparece | Formato ideal | Situação |
|---|---|---|---|
| **Logomarca** | Cabeçalho, banner, rodapé | — | ✅ Recebida (`logo.jpeg`) |
| **Foto do Fefê** | Nossa História — abertura | Retrato 3:4, mín. 800×1067 | ⬜ Pendente |
| **Arte do Super Fefê** | Nossa História — seção própria | Quadrada ou retrato | ⬜ Pendente |
| **Fotos da caminhada** (3) | Nossa História — galeria | Quadradas, mín. 800×800 | ⬜ Pendente |
| **Fotos dos produtos** | Catálogo, página inicial | Quadradas, mín. 1000×1000 | ⬜ Pendente — envie pelo painel |
| **Foto da produção** | Página inicial, Nossa História | Paisagem 4:3 | ⬜ Opcional |

**Fotos de produto você mesma coloca agora.** Desde a Fase 9 o painel tem
envio de foto: abra `/admin/produtos.html`, clique em **Editar** no produto e
use o campo **Enviar foto**. Aceita JPG, PNG e WEBP até 5 MB, e a primeira
foto enviada vira a principal automaticamente.

**As demais imagens** (Nossa História) continuam entrando pelo código: salve
os arquivos em `assets/images/` com nomes simples e sem acentos (ex.:
`fefe-retrato.jpg`, `super-fefe.png`, `galeria-01.jpg`) e me avise. Eu coloco
no lugar certo.

---

## ✍️ Textos

| O quê | Situação |
|---|---|
| **História da marca** | ✅ Recebida e publicada na íntegra |
| **Descrição dos produtos** | ⬜ Pendente — edite pelo painel |
| **Ingredientes de cada produto** | ⬜ Pendente — edite pelo painel |
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
| **Pedido mínimo para atacado** | ✅ Definido por parceiro no painel | Tela Parceiros |
| **Tabela de preços de atacado** | ⬜ Pendente | Cadastro de cada produto |
| **Razão social e CNPJ** | ⬜ Pendente | Rodapé, política de privacidade |

> Os campos de e-mail e cidade já estão programados em `js/config.js`. Assim
> que você informar, eles aparecem automaticamente no rodapé — é só preencher
> `CONTATO.email` e `CONTATO.cidade`.

---

## 🔑 Credenciais de serviços externos

Nenhuma credencial foi inventada. Estas são necessárias nas fases indicadas:

| Serviço | O que pegar | Fase |
|---|---|---|
| **Supabase** | Project URL, anon key, service_role key | 5 ✅ |
| **Domínio** | Registro de `docefefe21.com.br` ou similar | 12 |

> Só falta o domínio. Não há intermediador de pagamento (o Pix é conferido
> no painel) nem rastreamento de visitantes.

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

O que a **Fase 8** entregou no lugar: o cliente paga pelo próprio banco e
envia o comprovante pelo site. O arquivo vai para um bucket privado, e a
loja confere no extrato antes de aprovar — na tela **Pedidos** do painel.

Resolve a rastreabilidade (cada comprovante fica preso a um pedido) sem expor
chave nem nome de titular a visitante nenhum. A contrapartida é que a
confirmação não é automática: alguém precisa olhar.

O arquivo foi mantido na pasta (pode ser útil para impressão ou uso presencial),
apenas renomeado para deixar claro que não vai para o site.

---

*Pode mandar os itens aos poucos — cada um que chegar eu já encaixo no lugar.*
