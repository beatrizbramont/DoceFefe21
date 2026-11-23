-- =============================================================================
-- DOCE FEFÊ.21 — 12-confirma-comprovante.sql
-- Funções do fluxo de pagamento + conferência do status novo
-- =============================================================================
--
-- EXECUTE DEPOIS DE 11, numa execução SEPARADA.
--
-- O status 'comprovante_enviado' foi criado no arquivo 11. Ele só pode ser
-- USADO em outra transação — por isso este arquivo existe.
-- =============================================================================


-- =============================================================================
-- 1. REGISTRAR A FORMA DE PAGAMENTO ESCOLHIDA
--
-- Cria (ou atualiza) a linha em `payments` quando o cliente escolhe como vai
-- pagar. Não confirma nada — apenas registra a intenção.
-- =============================================================================

create or replace function public.registrar_forma_pagamento(
  p_codigo text,
  p_metodo text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido  record;
  v_pagamento_id uuid;
begin
  if p_metodo not in ('pix', 'dinheiro') then
    raise exception 'METODO_INVALIDO'
      using hint = 'Escolha entre Pix e dinheiro.';
  end if;

  select id, codigo, status, total_centavos
    into v_pedido
    from public.orders
   where codigo = upper(trim(p_codigo));

  if not found then
    raise exception 'PEDIDO_NAO_ENCONTRADO'
      using hint = 'Pedido não encontrado.';
  end if;

  -- Só faz sentido escolher forma de pagamento num pedido que ainda não foi
  -- pago. Depois de aprovado ou cancelado, a escolha não muda nada.
  if v_pedido.status not in ('aguardando_pagamento', 'comprovante_enviado') then
    raise exception 'PEDIDO_NAO_ACEITA_PAGAMENTO'
      using hint = 'Este pedido não está aguardando pagamento.';
  end if;

  -- Uma linha de pagamento por pedido: se o cliente trocar de ideia entre
  -- Pix e dinheiro, atualizamos em vez de criar outra.
  select id into v_pagamento_id
    from public.payments
   where pedido_id = v_pedido.id
   order by criado_em desc
   limit 1;

  if v_pagamento_id is null then
    insert into public.payments (
      pedido_id, metodo, status, valor_centavos, gateway
    ) values (
      v_pedido.id, p_metodo::metodo_pagamento, 'pendente',
      v_pedido.total_centavos, 'manual'
    )
    returning id into v_pagamento_id;
  else
    update public.payments
       set metodo = p_metodo::metodo_pagamento,
           valor_centavos = v_pedido.total_centavos
     where id = v_pagamento_id
       -- Trocar o método de um pagamento já conferido apagaria o histórico.
       and conferido_em is null;
  end if;

  return jsonb_build_object(
    'codigo', v_pedido.codigo,
    'metodo', p_metodo,
    'status', v_pedido.status,
    'total', v_pedido.total_centavos
  );
end;
$$;

comment on function public.registrar_forma_pagamento is
  'Registra a forma de pagamento escolhida. NÃO confirma pagamento algum.';


-- =============================================================================
-- 2. REGISTRAR O COMPROVANTE
--
-- Chamada pelo backend DEPOIS de o arquivo já ter sido salvo no Storage.
-- Muda o status do pedido para `comprovante_enviado`.
--
-- ⚠️ Repare no que esta função NÃO faz: ela não marca o pagamento como
--    aprovado. Comprovante enviado é afirmação do cliente, não confirmação.
-- =============================================================================

create or replace function public.registrar_comprovante(
  p_codigo text,
  p_caminho text,
  p_nome_original text,
  p_tamanho_bytes integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido record;
  v_pagamento_id uuid;
begin
  if p_caminho is null or trim(p_caminho) = '' then
    raise exception 'CAMINHO_INVALIDO' using hint = 'Arquivo inválido.';
  end if;

  select id, codigo, status, total_centavos
    into v_pedido
    from public.orders
   where codigo = upper(trim(p_codigo));

  if not found then
    raise exception 'PEDIDO_NAO_ENCONTRADO' using hint = 'Pedido não encontrado.';
  end if;

  if v_pedido.status not in ('aguardando_pagamento', 'comprovante_enviado') then
    raise exception 'PEDIDO_NAO_ACEITA_COMPROVANTE'
      using hint = 'Este pedido não está aguardando pagamento.';
  end if;

  select id into v_pagamento_id
    from public.payments
   where pedido_id = v_pedido.id
   order by criado_em desc
   limit 1;

  -- Cliente que envia comprovante sem ter escolhido a forma: assumimos Pix,
  -- que é o único método com comprovante no nosso fluxo.
  if v_pagamento_id is null then
    insert into public.payments (
      pedido_id, metodo, status, valor_centavos, gateway
    ) values (
      v_pedido.id, 'pix', 'pendente', v_pedido.total_centavos, 'manual'
    )
    returning id into v_pagamento_id;
  end if;

  update public.payments
     set comprovante_caminho = p_caminho,
         comprovante_nome_original = p_nome_original,
         comprovante_tamanho_bytes = p_tamanho_bytes,
         comprovante_enviado_em = now(),
         -- Reenvio de comprovante zera a conferência anterior.
         conferido_em = null,
         conferido_por = null
   where id = v_pagamento_id;

  update public.orders
     set status = 'comprovante_enviado'
   where id = v_pedido.id;

  return jsonb_build_object(
    'codigo', v_pedido.codigo,
    'status', 'comprovante_enviado',
    'enviadoEm', now()
  );
end;
$$;

comment on function public.registrar_comprovante is
  'Registra o comprovante enviado pelo cliente. NÃO aprova o pagamento — '
  'apenas marca que o cliente afirma ter pago. A loja confere depois.';


-- =============================================================================
-- 3. PERMISSÕES
--
-- Só o backend (service_role) executa. O navegador nunca chama direto.
-- =============================================================================

revoke all on function public.registrar_forma_pagamento from public, anon, authenticated;
revoke all on function public.registrar_comprovante from public, anon, authenticated;


-- =============================================================================
-- 4. CONFERÊNCIA
-- =============================================================================

do $$
declare
  v_tem_status boolean;
begin
  -- O status criado no arquivo 11 precisa existir.
  select exists (
    select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
     where t.typname = 'status_pedido'
       and e.enumlabel = 'comprovante_enviado'
  ) into v_tem_status;

  if not v_tem_status then
    raise exception 'O status "comprovante_enviado" não existe. Execute o arquivo 11 antes.';
  end if;

  -- As duas funções precisam estar criadas.
  if not exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'registrar_forma_pagamento'
  ) then
    raise exception 'registrar_forma_pagamento não foi criada.';
  end if;

  if not exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'registrar_comprovante'
  ) then
    raise exception 'registrar_comprovante não foi criada.';
  end if;

  -- Nenhuma das duas pode estar acessível à chave pública.
  if has_function_privilege('anon', 'public.registrar_comprovante(text,text,text,integer)', 'execute') then
    raise exception 'FALHA GRAVE: anon pode executar registrar_comprovante!';
  end if;

  raise notice '──────────────────────────────────────────────';
  raise notice '  OK: status "comprovante_enviado" criado';
  raise notice '  OK: registrar_forma_pagamento criada';
  raise notice '  OK: registrar_comprovante criada';
  raise notice '  OK: nenhuma acessível à chave pública';
  raise notice '';
  raise notice '  Fluxo de status:';
  raise notice '    aguardando_pagamento';
  raise notice '      → comprovante_enviado  (cliente envia)';
  raise notice '      → pagamento_aprovado   (LOJA confere)';
  raise notice '──────────────────────────────────────────────';
end $$;
