# ✉️ Modelos de e-mail

Os e-mails que o sistema envia para as clientes — confirmação de cadastro e
recuperação de senha.

## Onde eles vivem de verdade

**No painel do Supabase**, não neste repositório. Quem envia é o Supabase
Auth, e ele guarda os modelos no próprio painel:

> **Authentication → Email Templates**

Estes arquivos são a **fonte**: você edita aqui, cola lá. Manter a cópia no
projeto resolve três coisas que o painel não resolve — histórico de
alterações no Git, revisão antes de publicar, e não depender da memória de
ninguém para refazer um modelo que alguém apagou sem querer.

| Arquivo | Onde colar | Assunto sugerido |
|---|---|---|
| `confirmar-cadastro.html` | Confirm signup | Confirme seu cadastro na Doce Fefê.21 |

## Como atualizar

1. Edite o arquivo aqui
2. Copie o conteúdo inteiro
3. Supabase → Authentication → Email Templates → escolha o modelo
4. Cole no campo da mensagem e salve
5. **Teste**: crie uma conta e veja como chegou

## Por que o HTML parece antiquado

Tabelas no lugar de flexbox, estilo dentro de cada tag, largura fixa de
600px. Não é descuido.

Cliente de e-mail não é navegador. O Outlook renderiza com o motor do Word,
o Gmail apaga a tag `<style>` do cabeçalho, e quase nenhum entende flexbox ou
grid. O que funciona em e-mail é o que funcionava na web de 2005 — e é assim
que se escreve, mesmo hoje.

## Por que não tem a logomarca

A maioria dos clientes de e-mail **bloqueia imagem** até a pessoa autorizar.
Uma logo no topo viraria um quadrado vazio justo onde a marca deveria
aparecer. O desenho se sustenta com tipografia e cor.

Quando o site estiver publicado, dá para acrescentar a logo — ela precisa de
um endereço absoluto e público, algo como
`https://docefefe21.com.br/assets/images/logo.jpeg`.

## ⚠️ Sobre o link do e-mail

O endereço de destino **não vem destes arquivos**. Ele é montado pelo
Supabase a partir de:

> **Authentication → URL Configuration → Site URL**

Enquanto for `http://localhost:5173`, o link só abre no computador que está
rodando o projeto — num celular, "localhost" é o próprio celular, e a página
não existe lá. Quando o site for publicado, troque por esse endereço.
