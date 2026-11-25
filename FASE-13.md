# Fase 13 — A loja lança pedido

## Por que esta fase existe

A maior parte da venda da Doce Fefê.21 fecha no **WhatsApp**: a cliente manda
mensagem, combina, paga no Pix. Até aqui, esse pedido não existia para o
sistema — não baixava estoque, não entrava no faturamento, não aparecia na
separação do dia.

O painel sabia conferir, separar e despachar. Não sabia **criar**. Ou seja,
estava cego justamente para o caminho principal do negócio, e mostrava uma
loja menor do que ela é.

## Decisões já tomadas (não reabrir)

| Pergunta | Decisão |
|---|---|
| Como identificar a cliente | Nome e WhatsApp, **sem exigir conta** |
| Apagar pedido | Cancelar no dia a dia; apagar de vez só o que já foi cancelado |
| Pagamento | A loja escolhe na hora: já pago ou a pagar |

Três princípios que o código segue e devem continuar valendo:

1. **O preço vem do banco, sempre.** Nem a administradora digita quanto custa.
   Se digitasse, a promoção valeria no site e outra coisa no WhatsApp, e
   nenhum relatório saberia qual está certo.
2. **Cancelar devolve o estoque; apagar não.** Por isso apagar exige cancelar
   antes — nenhum clique isolado destrói uma venda.
3. **O movimento de cancelamento tem tipo próprio.** Olhando para trás,
   "comprei mais ingrediente" e "uma venda caiu" não podem parecer a mesma
   coisa.

## O que já está pronto

### Banco — `database/20-pedido-manual.sql` ✅ aplicado

| Função | O que faz |
|---|---|
| `criar_pedido_manual` | Reaproveita `criar_pedido` com usuário nulo |
| `cancelar_pedido` | Devolve estoque, encerra pagamento pendente, mantém histórico |
| `excluir_pedido` | Apaga de vez; recusa se não estiver cancelado |

Também adicionou `orders.origem` (`site` \| `whatsapp` \| `instagram` \|
`presencial`). Os pedidos que já existiam ficaram como `site`.

> ⚠️ `criar_pedido` devolve **`codigo` e `total`** — não `id` nem
> `total_centavos`. A função localiza o pedido pelo código por causa disso.

### API ✅

- `services/manual-order-service.js` — validação barata e tradução de erro
- `backend/controllers/admin-pedido-manual-controller.js`
- Rotas registradas em `backend/routes/index.js`:

```
POST   /api/admin/pedidos
POST   /api/admin/pedidos/:codigo/cancelar
DELETE /api/admin/pedidos/:codigo
```

Todas atrás de `exigirAdmin`. Carregamento das rotas verificado.

## O que falta

### 1. A tela — `admin/pedidos.html` + `js/admin/pedidos.js`

- Botão **Novo pedido** abrindo um formulário
- Nome, WhatsApp, origem, itens (produto + quantidade), forma de pagamento,
  caixa "já pago", entrega/retirada, data, observações
- **Sem campo de preço.** Mostrar o preço vindo do catálogo e somar o total
  apenas para conferência visual
- Na listagem: **Cancelar** (pede motivo) e **Apagar** (só aparece em pedido
  já cancelado, com confirmação)
- Marcar visualmente a origem do pedido na lista

Os ícones ficam em `js/components/icons.js` — **nunca emoji**.

### 2. Testes — `tests/pedido-manual.test.mjs`

Casos que importam: pedido sem itens, WhatsApp malformado, origem `site`
recusada, cancelar devolve a quantidade certa, cancelar duas vezes falha,
apagar sem cancelar falha, pedido entregue não cancela.

### 3. Conferir no ar

Lançar um pedido de teste pelo celular, cancelar, apagar. Confirmar que o
estoque voltou ao número de antes.
