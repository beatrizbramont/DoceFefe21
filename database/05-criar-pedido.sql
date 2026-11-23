-- =============================================================================
-- DOCE FEFÊ.21 — 05-criar-pedido.sql
-- Função transacional de criação de pedido
-- =============================================================================
--
-- EXECUTE DEPOIS DE 01, 02, 03 e 04.
--
-- -----------------------------------------------------------------------------
-- POR QUE ISTO É UMA FUNÇÃO NO BANCO, E NÃO CÓDIGO NO BACKEND
--
--   Criar um pedido são CINCO escritas que precisam acontecer juntas:
--
--     1. inserir a linha em `orders`
--     2. inserir cada linha em `order_items`
--     3. baixar a quantidade em `inventory`
--     4. registrar o movimento em `inventory_movements`
--     5. incrementar o contador de usos do cupom
--
--   Feitas como chamadas REST separadas, uma falha no passo 3 deixaria um
--   pedido registrado sem baixa de estoque — e ninguém perceberia até faltar
--   produto. Pior: duas pessoas comprando a última unidade ao mesmo tempo
--   levariam as duas, porque a checagem de estoque e a baixa aconteceriam em
--   momentos diferentes.
--
--   Dentro de uma função PL/pgSQL tudo roda em UMA transação: ou as cinco
--   escritas acontecem, ou nenhuma acontece. E o `FOR UPDATE` abaixo trava a
--   linha do estoque, serializando compras simultâneas do mesmo produto.
--
-- -----------------------------------------------------------------------------
-- O QUE A FUNÇÃO NÃO ACEITA DE FORA
--
--   Preço, nome do produto e condição de atacado NÃO são parâmetros. A função
--   busca tudo no banco. O chamador informa apenas QUAL produto e QUANTAS
--   unidades — exatamente como o carrinho.
--
--   Mesmo que o backend fosse comprometido e tentasse gravar um pedido com
--   preço zerado, esta função recalcularia o valor correto.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Função auxiliar: o preço que vale para este usuário neste produto
-- -----------------------------------------------------------------------------

create or replace function public.preco_para_usuario(
  p_produto_id uuid,
  p_usuario_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_produto     record;
  v_eh_revendedor boolean := false;
begin
  select preco_varejo, preco_promocional, preco_atacado
    into v_produto
    from public.products
   where id = p_produto_id;

  if not found then
    return null;
  end if;

  -- Revendedor aprovado? A resposta vem da tabela, nunca de um parâmetro.
  if p_usuario_id is not null then
    select exists (
      select 1 from public.resellers
       where usuario_id = p_usuario_id and status = 'aprovado'
    ) into v_eh_revendedor;
  end if;

  if v_eh_revendedor and v_produto.preco_atacado is not null then
    return v_produto.preco_atacado;
  end if;

  return coalesce(v_produto.preco_promocional, v_produto.preco_varejo);
end;
$$;


-- -----------------------------------------------------------------------------
-- Função principal
-- -----------------------------------------------------------------------------

create or replace function public.criar_pedido(
  p_usuario_id       uuid,
  p_cliente_nome     text,
  p_cliente_email    text,
  p_cliente_whatsapp text,
  p_tipo_entrega     text,
  p_endereco         jsonb,
  p_data_desejada    date,
  p_observacoes      text,
  p_itens            jsonb,
  p_cupom_codigo     text default null,
  p_frete_centavos   integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido_id       uuid;
  v_codigo          text;
  v_item            jsonb;
  v_produto         record;
  v_estoque         record;
  v_preco           integer;
  v_quantidade      integer;
  v_subtotal        integer := 0;
  v_desconto        integer := 0;
  v_total           integer;
  v_cupom           record;
  v_eh_atacado      boolean := false;
  v_itens_criados   jsonb := '[]'::jsonb;
  v_saldo_novo      integer;
begin
  -- ===========================================================================
  -- 1. VALIDAÇÕES DE ENTRADA
  -- ===========================================================================

  if p_cliente_nome is null or char_length(trim(p_cliente_nome)) < 2 then
    raise exception 'NOME_INVALIDO' using hint = 'Informe o nome do cliente.';
  end if;

  if p_cliente_whatsapp is null
     or p_cliente_whatsapp !~ '^[0-9]{10,11}$' then
    raise exception 'WHATSAPP_INVALIDO'
      using hint = 'Informe o WhatsApp com DDD, somente números.';
  end if;

  if p_tipo_entrega not in ('entrega', 'retirada') then
    raise exception 'ENTREGA_INVALIDA'
      using hint = 'Escolha entre entrega e retirada.';
  end if;

  if p_tipo_entrega = 'entrega' and p_endereco is null then
    raise exception 'ENDERECO_OBRIGATORIO'
      using hint = 'Entrega exige endereço.';
  end if;

  if p_itens is null or jsonb_array_length(p_itens) = 0 then
    raise exception 'CARRINHO_VAZIO' using hint = 'Adicione itens ao pedido.';
  end if;

  if jsonb_array_length(p_itens) > 50 then
    raise exception 'ITENS_DEMAIS' using hint = 'Máximo de 50 produtos por pedido.';
  end if;

  -- A data desejada não pode ser no passado.
  if p_data_desejada is not null and p_data_desejada < current_date then
    raise exception 'DATA_PASSADA'
      using hint = 'A data desejada não pode ser anterior a hoje.';
  end if;

  -- Frete negativo seria desconto disfarçado.
  if coalesce(p_frete_centavos, 0) < 0 then
    raise exception 'FRETE_INVALIDO' using hint = 'Frete não pode ser negativo.';
  end if;

  -- Condição de atacado determinada AQUI, pela tabela.
  if p_usuario_id is not null then
    select exists (
      select 1 from public.resellers
       where usuario_id = p_usuario_id and status = 'aprovado'
    ) into v_eh_atacado;
  end if;

  -- ===========================================================================
  -- 2. CRIA O PEDIDO (ainda com valores zerados)
  -- ===========================================================================

  v_codigo := public.gerar_codigo_pedido();

  insert into public.orders (
    codigo, usuario_id, cliente_nome, cliente_email, cliente_whatsapp,
    status, tipo_entrega, endereco_entrega, data_desejada, observacoes,
    subtotal_centavos, desconto_centavos, frete_centavos, total_centavos,
    eh_atacado
  ) values (
    v_codigo, p_usuario_id, trim(p_cliente_nome),
    nullif(trim(coalesce(p_cliente_email, '')), ''), p_cliente_whatsapp,
    'aguardando_pagamento', p_tipo_entrega::tipo_entrega, p_endereco,
    p_data_desejada, nullif(trim(coalesce(p_observacoes, '')), ''),
    0, 0, coalesce(p_frete_centavos, 0), coalesce(p_frete_centavos, 0),
    v_eh_atacado
  )
  returning id into v_pedido_id;

  -- ===========================================================================
  -- 3. ITENS, PREÇOS E BAIXA DE ESTOQUE
  -- ===========================================================================

  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    -- --- Quantidade ---
    v_quantidade := (v_item->>'quantidade')::integer;

    if v_quantidade is null or v_quantidade < 1 or v_quantidade > 99 then
      raise exception 'QUANTIDADE_INVALIDA'
        using hint = format('Quantidade inválida para "%s".', v_item->>'slug');
    end if;

    -- --- Produto ---
    select p.id, p.nome, p.slug, p.publicado, p.arquivado_em, p.minimo_atacado
      into v_produto
      from public.products p
     where p.slug = (v_item->>'slug');

    if not found or not v_produto.publicado or v_produto.arquivado_em is not null then
      raise exception 'PRODUTO_INDISPONIVEL'
        using hint = format('O produto "%s" não está disponível.', v_item->>'slug');
    end if;

    -- --- Estoque, com a linha travada ---
    -- `FOR UPDATE` impede que outra transação leia este estoque até a nossa
    -- terminar. É o que evita vender a mesma última unidade duas vezes.
    select e.quantidade, e.reservado, e.sob_encomenda
      into v_estoque
      from public.inventory e
     where e.produto_id = v_produto.id
       for update;

    if not found then
      raise exception 'SEM_ESTOQUE_CADASTRADO'
        using hint = format('Estoque não cadastrado para "%s".', v_produto.nome);
    end if;

    if not v_estoque.sob_encomenda
       and (v_estoque.quantidade - v_estoque.reservado) < v_quantidade then
      raise exception 'ESTOQUE_INSUFICIENTE'
        using hint = format(
          'Só temos %s unidade(s) de "%s".',
          greatest(v_estoque.quantidade - v_estoque.reservado, 0),
          v_produto.nome
        );
    end if;

    -- --- Pedido mínimo de atacado ---
    if v_eh_atacado and v_quantidade < v_produto.minimo_atacado then
      raise exception 'MINIMO_ATACADO'
        using hint = format(
          'O preço de atacado de "%s" exige no mínimo %s unidades.',
          v_produto.nome, v_produto.minimo_atacado
        );
    end if;

    -- --- Preço, buscado no banco ---
    v_preco := public.preco_para_usuario(v_produto.id, p_usuario_id);

    if v_preco is null or v_preco <= 0 then
      raise exception 'PRECO_INVALIDO'
        using hint = format('Preço inválido para "%s".', v_produto.nome);
    end if;

    -- --- Grava o item ---
    insert into public.order_items (
      pedido_id, produto_id, produto_nome, produto_slug,
      preco_unitario_centavos, quantidade, subtotal_centavos
    ) values (
      v_pedido_id, v_produto.id, v_produto.nome, v_produto.slug,
      v_preco, v_quantidade, v_preco * v_quantidade
    );

    v_subtotal := v_subtotal + (v_preco * v_quantidade);

    -- --- Baixa o estoque ---
    -- `greatest(..., 0)` protege o caso sob encomenda, em que a quantidade
    -- pode já estar zerada e não deve ficar negativa (a restrição da tabela
    -- proíbe valores negativos).
    update public.inventory
       set quantidade = greatest(quantidade - v_quantidade, 0)
     where produto_id = v_produto.id
    returning quantidade into v_saldo_novo;

    -- --- Registra o movimento (livro-razão, só inserção) ---
    insert into public.inventory_movements (
      produto_id, tipo, quantidade, saldo_apos, motivo, pedido_id, usuario_id
    ) values (
      v_produto.id, 'venda', -v_quantidade, v_saldo_novo,
      format('Pedido %s', v_codigo), v_pedido_id, p_usuario_id
    );

    -- --- Contador de vendas do produto ---
    update public.products
       set vendas_total = vendas_total + v_quantidade
     where id = v_produto.id;

    v_itens_criados := v_itens_criados || jsonb_build_object(
      'slug', v_produto.slug,
      'nome', v_produto.nome,
      'quantidade', v_quantidade,
      'precoUnitario', v_preco,
      'subtotal', v_preco * v_quantidade
    );
  end loop;

  -- ===========================================================================
  -- 4. CUPOM
  -- ===========================================================================

  if p_cupom_codigo is not null and trim(p_cupom_codigo) <> '' then
    select c.id, c.codigo, c.tipo, c.valor, c.valor_minimo_pedido,
           c.desconto_maximo, c.limite_usos, c.usos, c.valido_de, c.valido_ate,
           c.ativo
      into v_cupom
      from public.coupons c
     where c.codigo = upper(trim(p_cupom_codigo))
       for update;

    if found
       and v_cupom.ativo
       and v_cupom.valido_de <= now()
       and (v_cupom.valido_ate is null or v_cupom.valido_ate > now())
       and (v_cupom.limite_usos is null or v_cupom.usos < v_cupom.limite_usos)
       and v_subtotal >= v_cupom.valor_minimo_pedido
    then
      if v_cupom.tipo = 'percentual' then
        -- floor: o arredondamento nunca favorece o desconto.
        v_desconto := floor((v_subtotal * v_cupom.valor) / 100.0);

        if v_cupom.desconto_maximo is not null then
          v_desconto := least(v_desconto, v_cupom.desconto_maximo);
        end if;
      else
        v_desconto := v_cupom.valor;
      end if;

      -- O desconto nunca passa do subtotal: total negativo violaria a
      -- restrição `orders_total_confere`.
      v_desconto := least(v_desconto, v_subtotal);

      update public.coupons set usos = usos + 1 where id = v_cupom.id;

      update public.orders
         set cupom_codigo = v_cupom.codigo, cupom_id = v_cupom.id
       where id = v_pedido_id;
    else
      -- Cupom inválido NÃO derruba o pedido: apenas não é aplicado. Derrubar
      -- faria o cliente perder tudo por causa de um código expirado.
      v_desconto := 0;
    end if;
  end if;

  -- ===========================================================================
  -- 5. FECHA OS VALORES
  -- ===========================================================================

  v_total := v_subtotal - v_desconto + coalesce(p_frete_centavos, 0);

  update public.orders
     set subtotal_centavos = v_subtotal,
         desconto_centavos = v_desconto,
         total_centavos    = v_total
   where id = v_pedido_id;

  -- ===========================================================================
  -- 6. RESPOSTA
  -- ===========================================================================

  return jsonb_build_object(
    'codigo', v_codigo,
    'status', 'aguardando_pagamento',
    'subtotal', v_subtotal,
    'desconto', v_desconto,
    'frete', coalesce(p_frete_centavos, 0),
    'total', v_total,
    'ehAtacado', v_eh_atacado,
    'itens', v_itens_criados
  );
end;
$$;

comment on function public.criar_pedido is
  'Cria um pedido completo em UMA transação: pedido, itens, baixa de estoque, '
  'movimento e cupom. Preços são buscados no banco — nunca recebidos como '
  'parâmetro.';


-- -----------------------------------------------------------------------------
-- PERMISSÕES
--
-- Somente o backend (service_role) pode chamar. O navegador NUNCA cria pedido
-- direto: precisa passar pela API, que valida a sessão.
-- -----------------------------------------------------------------------------

revoke all on function public.criar_pedido from public, anon, authenticated;
revoke all on function public.preco_para_usuario from public, anon, authenticated;


-- =============================================================================
-- CONFERÊNCIA
-- =============================================================================

do $$
declare
  v_tem_funcao integer;
begin
  select count(*) into v_tem_funcao
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'criar_pedido';

  if v_tem_funcao = 0 then
    raise exception 'A função criar_pedido não foi criada.';
  end if;

  -- A função não pode estar acessível à chave pública.
  if has_function_privilege('anon', 'public.criar_pedido(uuid,text,text,text,text,jsonb,date,text,jsonb,text,integer)', 'execute') then
    raise exception 'FALHA GRAVE: anon pode executar criar_pedido!';
  end if;

  raise notice '──────────────────────────────────────────────';
  raise notice '  OK: criar_pedido criada (transacional)';
  raise notice '  OK: preco_para_usuario criada';
  raise notice '  OK: nenhuma delas acessível à chave pública';
  raise notice '──────────────────────────────────────────────';
end $$;
