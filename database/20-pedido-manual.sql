-- =============================================================================
-- DOCE FEFÊ.21 — 20-pedido-manual.sql
-- A loja passa a lançar pedidos, não só acompanhá-los
-- =============================================================================
--
-- EXECUTE DEPOIS DE 19.
--
-- -----------------------------------------------------------------------------
-- O QUE ESTAVA FALTANDO
--
--   Até aqui, um pedido só nascia de um jeito: a cliente no site, fazendo o
--   caminho inteiro sozinha. O painel sabia conferir pagamento, separar e
--   despachar — mas não sabia CRIAR.
--
--   Só que a maior parte da venda acontece no WhatsApp. A cliente manda
--   mensagem, combina, paga no Pix e pronto. Esse pedido não existia para o
--   sistema: não baixava estoque, não entrava no faturamento, não aparecia
--   na separação do dia.
--
--   Ou seja, o sistema estava cego justamente para o caminho principal do
--   negócio. Quem olhasse o painel veria uma loja muito menor do que ela é.
--
-- -----------------------------------------------------------------------------
-- POR QUE REAPROVEITAR `criar_pedido`, E NÃO ESCREVER OUTRA
--
--   `criar_pedido` já faz, numa transação só: busca o preço NO BANCO, cria os
--   itens, baixa o estoque, grava o movimento e calcula os totais. E ela já
--   aceita `p_usuario_id` nulo — o único trecho que depende do usuário está
--   dentro de um `if p_usuario_id is not null`, por causa do atacado.
--
--   Uma segunda função de criar pedido seria uma segunda chance de divergir:
--   bastaria alguém corrigir o cálculo numa e esquecer da outra. O pedido do
--   WhatsApp passa exatamente pelas mesmas regras que o pedido do site.
--
--   Em especial: o preço continua vindo do banco. Nem a administradora digita
--   quanto custa — senão a promoção de R$ 8,50 valeria no site e outra coisa
--   no WhatsApp, e ninguém saberia qual está certa.
-- =============================================================================


-- =============================================================================
-- 1. DE ONDE VEIO O PEDIDO
--
-- Sem isto, o pedido do WhatsApp fica indistinguível do pedido do site, e a
-- pergunta "quanto a loja vende sozinha?" não tem resposta.
-- =============================================================================

alter table public.orders
  add column if not exists origem text not null default 'site';

do $$ begin
  alter table public.orders
    add constraint orders_origem_valida
    check (origem in ('site', 'whatsapp', 'instagram', 'presencial'));
exception when duplicate_object then null; end $$;

comment on column public.orders.origem is
  'Por onde a venda chegou. "site" é o padrão: todo pedido que nasce do '
  'checkout. Os outros são lançados pela loja no painel.';


-- =============================================================================
-- 2. LANÇAR UM PEDIDO PELO PAINEL
--
-- `p_ja_pago` existe porque as duas situações são comuns de verdade: a
-- cliente que já mandou o Pix antes de você lançar, e a encomenda que só
-- será paga na entrega. Obrigar uma das duas faria a loja mentir no sistema
-- para conseguir seguir em frente — e sistema em que se mente não serve para
-- consultar depois.
-- =============================================================================

create or replace function public.criar_pedido_manual(
  p_cliente_nome     text,
  p_cliente_whatsapp text,
  p_itens            jsonb,
  p_origem           text    default 'whatsapp',
  p_ja_pago          boolean default false,
  p_metodo           text    default 'pix',
  p_cliente_email    text    default null,
  p_tipo_entrega     text    default 'retirada',
  p_endereco         jsonb   default null,
  p_data_desejada    date    default null,
  p_observacoes      text    default null,
  p_frete_centavos   integer default 0,
  p_usuario_id       uuid    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido   jsonb;
  v_pedido_id uuid;
  v_total    integer;
begin
  if p_origem not in ('whatsapp', 'instagram', 'presencial') then
    raise exception 'ORIGEM_INVALIDA'
      using hint = 'Um pedido lançado no painel não pode ter origem "site".';
  end if;

  if p_metodo not in ('pix', 'cartao_credito', 'cartao_debito', 'dinheiro') then
    raise exception 'METODO_INVALIDO'
      using hint = 'Forma de pagamento desconhecida.';
  end if;

  -- Toda a validação de nome, WhatsApp, itens, estoque e preço acontece aqui
  -- dentro — as mesmas regras do pedido do site, sem cópia.
  v_pedido := public.criar_pedido(
    null,                -- sem conta: a venda do WhatsApp não exige cadastro
    p_cliente_nome,
    p_cliente_email,
    p_cliente_whatsapp,
    p_tipo_entrega,
    p_endereco,
    p_data_desejada,
    p_observacoes,
    p_itens,
    null,                -- cupom: quem lança no painel já combinou o preço
    coalesce(p_frete_centavos, 0)
  );

  -- `criar_pedido` devolve o CÓDIGO, não o id — e o total vem como `total`,
  -- não `total_centavos`. Ler as chaves erradas aqui daria nulo em silêncio:
  -- o update não acharia o pedido e o pagamento quebraria no valor nulo,
  -- depois do estoque já ter baixado. Buscamos pelo código, que é único.
  select id, total_centavos
    into v_pedido_id, v_total
    from public.orders
   where codigo = (v_pedido->>'codigo');

  if v_pedido_id is null then
    raise exception 'PEDIDO_NAO_LOCALIZADO'
      using hint = 'O pedido foi criado mas não foi encontrado pelo código.';
  end if;

  update public.orders
     set origem = p_origem,
         -- `p_usuario_id` aqui é a ADMINISTRADORA que lançou, não a cliente.
         -- Ele não vai para `usuario_id` do pedido justamente por isso: o
         -- pedido não pertence a quem digitou.
         observacoes = case
           when p_usuario_id is null then observacoes
           else trim(coalesce(observacoes || E'\n', '') ||
                     'Lançado no painel.')
         end
   where id = v_pedido_id;

  -- ---------------------------------------------------------------------------
  -- Pagamento já recebido
  --
  -- O registro em `payments` não é decoração: é o que permite, meses depois,
  -- responder "como essa venda foi paga?". O faturamento do painel conta
  -- pedido em `pagamento_aprovado`, então os dois precisam andar juntos.
  -- ---------------------------------------------------------------------------
  if p_ja_pago then
    insert into public.payments (
      pedido_id, metodo, status, valor_centavos,
      gateway, gateway_status, pago_em
    )
    values (
      v_pedido_id,
      p_metodo::metodo_pagamento,
      'aprovado'::status_pagamento,
      v_total,
      -- Não passou por intermediador nenhum: foi dinheiro combinado direto.
      -- Gravar 'mercadopago' aqui seria falso, e o falso contamina relatório.
      'manual',
      'recebido_fora_do_site',
      now()
    );

    update public.orders
       set status = 'pagamento_aprovado'::status_pedido
     where id = v_pedido_id;

    v_pedido := jsonb_set(v_pedido, '{status}', '"pagamento_aprovado"'::jsonb);
  end if;

  -- O `id` não vinha de `criar_pedido`; devolvemos aqui porque o painel
  -- precisa dele para cancelar ou apagar logo em seguida.
  return v_pedido || jsonb_build_object(
    'id',      v_pedido_id,
    'origem',  p_origem,
    'ja_pago', p_ja_pago
  );
end;
$$;

comment on function public.criar_pedido_manual is
  'Lança no painel um pedido fechado por fora (WhatsApp, Instagram, balcão). '
  'Reaproveita criar_pedido: mesmos preços do banco, mesma baixa de estoque.';


-- =============================================================================
-- 3. CANCELAR — O CAMINHO DO DIA A DIA
--
-- Cancelar devolve o doce para a prateleira. Se não devolvesse, cada
-- desistência deixaria um buraco invisível no estoque, e em um mês o número
-- do sistema não teria mais relação com a bancada.
--
-- O pedido continua existindo. Desistência é informação: mostra qual produto
-- some do carrinho e qual cliente desmarca. Apagar jogaria isso fora.
-- =============================================================================

create or replace function public.cancelar_pedido(
  p_pedido_id  uuid,
  p_motivo     text default null,
  p_usuario_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido    record;
  v_item      record;
  v_saldo     integer;
  v_devolvidos integer := 0;
begin
  select id, codigo, status, cliente_nome
    into v_pedido
    from public.orders
   where id = p_pedido_id
     for update;

  if not found then
    raise exception 'PEDIDO_NAO_ENCONTRADO'
      using hint = 'Este pedido não existe.';
  end if;

  if v_pedido.status = 'cancelado' then
    raise exception 'JA_CANCELADO'
      using hint = format('O pedido %s já estava cancelado.', v_pedido.codigo);
  end if;

  -- Pedido entregue não volta para o estoque: o doce saiu de casa. Cancelar
  -- aqui seria inventar mercadoria que não existe mais.
  if v_pedido.status = 'entregue' then
    raise exception 'PEDIDO_ENTREGUE'
      using hint = 'Um pedido já entregue não pode ser cancelado.';
  end if;

  -- ---------------------------------------------------------------------------
  -- Devolve o estoque, item por item.
  --
  -- O movimento vai com tipo `cancelamento`, e não `entrada`, porque o
  -- histórico precisa diferenciar "comprei mais ingrediente" de "uma venda
  -- caiu". São coisas diferentes olhando para trás. É também por isso que
  -- esta função não usa `ajustar_estoque`: aquela só aceita entrada, saída,
  -- perda e ajuste.
  -- ---------------------------------------------------------------------------
  for v_item in
    select produto_id, quantidade
      from public.order_items
     where pedido_id = p_pedido_id
       and produto_id is not null
  loop
    update public.inventory
       set quantidade = quantidade + v_item.quantidade
     where produto_id = v_item.produto_id
    returning quantidade into v_saldo;

    if found then
      insert into public.inventory_movements (
        produto_id, tipo, quantidade, saldo_apos, motivo, usuario_id
      )
      values (
        v_item.produto_id,
        'cancelamento'::tipo_movimento_estoque,
        v_item.quantidade,
        v_saldo,
        format('Cancelamento do pedido %s', v_pedido.codigo),
        p_usuario_id
      );
      v_devolvidos := v_devolvidos + v_item.quantidade;
    end if;
  end loop;

  update public.orders
     set status              = 'cancelado'::status_pedido,
         cancelado_em        = now(),
         motivo_cancelamento = nullif(trim(coalesce(p_motivo, '')), '')
   where id = p_pedido_id;

  -- Um pagamento pendente de pedido cancelado não pode ficar esperando:
  -- apareceria para sempre na fila de conferência.
  update public.payments
     set status = 'cancelado'::status_pagamento
   where pedido_id = p_pedido_id
     and status = 'pendente';

  return jsonb_build_object(
    'id',                 v_pedido.id,
    'codigo',             v_pedido.codigo,
    'status',             'cancelado',
    'status_anterior',    v_pedido.status,
    'unidades_devolvidas', v_devolvidos
  );
end;
$$;

comment on function public.cancelar_pedido is
  'Cancela o pedido, devolve as unidades ao estoque com movimento do tipo '
  '"cancelamento" e encerra pagamentos pendentes. O pedido permanece no '
  'histórico.';


-- =============================================================================
-- 4. APAGAR DE VEZ — SÓ PARA LIMPAR TESTE
--
-- Existe porque pedido de teste polui o faturamento e a separação do dia, e
-- não há motivo para guardá-lo. Mas é a única operação do sistema que destrói
-- informação, então tem trava:
--
--   só apaga pedido JÁ CANCELADO.
--
-- Assim, apagar exige dois passos deliberados. Um clique errado na lista
-- cancela — e cancelar tem volta. Nenhum clique isolado destrói uma venda.
-- =============================================================================

create or replace function public.excluir_pedido(p_pedido_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido record;
begin
  select id, codigo, status, total_centavos
    into v_pedido
    from public.orders
   where id = p_pedido_id;

  if not found then
    raise exception 'PEDIDO_NAO_ENCONTRADO'
      using hint = 'Este pedido não existe.';
  end if;

  if v_pedido.status <> 'cancelado' then
    raise exception 'PRECISA_CANCELAR_ANTES'
      using hint =
        'Cancele o pedido primeiro. Cancelar devolve o estoque; apagar não.';
  end if;

  -- `order_items` e `payments` têm `on delete cascade`: somem junto, sem
  -- deixar linha órfã apontando para um pedido que não existe mais.
  delete from public.orders where id = p_pedido_id;

  return jsonb_build_object(
    'apagado', true,
    'codigo',  v_pedido.codigo
  );
end;
$$;

comment on function public.excluir_pedido is
  'Apaga o pedido em definitivo, com itens e pagamentos. Exige que ele já '
  'esteja cancelado — cancelar é que devolve o estoque.';


-- =============================================================================
-- PERMISSÕES
--
-- As três funções são `security definer` para conseguirem escrever no
-- estoque e no histórico, que o RLS reserva ao admin. Quem pode CHAMÁ-LAS
-- continua decidido no backend, pelo `exigirAdmin`. Por isso revogamos de
-- todo mundo e devolvemos só para a chave de serviço.
-- =============================================================================

revoke all on function public.criar_pedido_manual(
  text, text, jsonb, text, boolean, text, text, text, jsonb, date, text,
  integer, uuid
) from public, anon, authenticated;

revoke all on function public.cancelar_pedido(uuid, text, uuid)
  from public, anon, authenticated;

revoke all on function public.excluir_pedido(uuid)
  from public, anon, authenticated;

grant execute on function public.criar_pedido_manual(
  text, text, jsonb, text, boolean, text, text, text, jsonb, date, text,
  integer, uuid
) to service_role;

grant execute on function public.cancelar_pedido(uuid, text, uuid)
  to service_role;

grant execute on function public.excluir_pedido(uuid)
  to service_role;


-- =============================================================================
-- CONFERÊNCIA
-- =============================================================================

do $$
declare
  v_faltando text[] := '{}';
  v_nome     text;
  v_origem   integer;
begin
  foreach v_nome in array array[
    'criar_pedido_manual', 'cancelar_pedido', 'excluir_pedido'
  ]
  loop
    if not exists (
      select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = v_nome
    ) then
      v_faltando := v_faltando || v_nome;
    end if;
  end loop;

  if array_length(v_faltando, 1) > 0 then
    raise exception 'Funções não criadas: %', array_to_string(v_faltando, ', ');
  end if;

  select count(*) into v_origem
    from information_schema.columns
   where table_schema = 'public' and table_name = 'orders'
     and column_name = 'origem';

  if v_origem = 0 then
    raise exception 'A coluna orders.origem não foi criada.';
  end if;

  raise notice '──────────────────────────────────────────────';
  raise notice '  Pedido manual habilitado.';
  raise notice '';
  raise notice '    criar_pedido_manual  lança venda do WhatsApp';
  raise notice '    cancelar_pedido      devolve o estoque, mantém histórico';
  raise notice '    excluir_pedido       apaga de vez, só se já cancelado';
  raise notice '';
  raise notice '  Os pedidos existentes ficaram com origem = "site".';
  raise notice '──────────────────────────────────────────────';
end $$;
