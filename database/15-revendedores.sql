-- =============================================================================
-- DOCE FEFÊ.21 — 15-revendedores.sql
-- Fase 10: o desconto do parceiro passa a valer, e o pedido mínimo também
-- =============================================================================
--
-- EXECUTE DEPOIS DE 14.
--
-- O QUE MUDA
--
--   1. `preco_para_usuario` aplica o desconto_percentual sobre o atacado
--   2. `criar_pedido` recusa pedido de revendedor abaixo do mínimo dele
--   3. Visão `revendedores_admin`, para a tela de aprovação
--
-- -----------------------------------------------------------------------------
-- 1. O DESCONTO QUE NÃO DESCONTAVA NADA
--
--   A coluna `resellers.desconto_percentual` existe desde o esquema inicial,
--   é lida em dois lugares e era exibida na área do cliente — mas NENHUM
--   preço jamais foi alterado por ela. Um controle que não controla nada é
--   pior que controle nenhum: alguém o ajusta, confere a tela do cliente, vê
--   o número certo e supõe que o preço acompanhou.
--
--   A partir daqui a conta é:
--
--       preço do parceiro = preço de atacado − (atacado × percentual)
--
--   Ex.: atacado R$ 7,00 com 10% → R$ 6,30
--
--   O desconto é arredondado para BAIXO, como já acontece com o cupom em
--   criar_pedido: o arredondamento nunca favorece quem recebe o desconto.
--
-- -----------------------------------------------------------------------------
-- 2. O PEDIDO MÍNIMO SÓ EXISTIA NO NAVEGADOR
--
--   `cart-page.js` desabilita o botão de finalizar quando o total está abaixo
--   do mínimo do revendedor. Botão desabilitado não é regra: bastava chamar
--   POST /api/pedidos direto para comprar uma unidade com preço de atacado.
--
--   Agora a checagem acontece onde não há como desviar — dentro da mesma
--   transação que cria o pedido.
--
--   ⚠️ O MÍNIMO É SOBRE A MERCADORIA, NÃO SOBRE O TOTAL
--     Frete não entra na conta. Senão um endereço distante "ajudaria" a
--     atingir o mínimo, e a loja entregaria menos doce por mais quilômetro.
-- =============================================================================


-- =============================================================================
-- 1. PREÇO DO PARCEIRO
-- =============================================================================

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
  v_produto  record;
  v_preco    integer;
  -- Variável ESCALAR, não `record`: um record que nunca recebeu `select into`
  -- — o caso do visitante sem conta, que é o mais comum — não pode sequer ser
  -- comparado com null sem o PL/pgSQL reclamar de "record not assigned yet".
  -- Escalar nasce nula, e nula aqui significa "não é revendedor aprovado".
  v_desconto numeric := null;
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
    select coalesce(desconto_percentual, 0)
      into v_desconto
      from public.resellers
     where usuario_id = p_usuario_id and status = 'aprovado';
  end if;

  if v_desconto is not null and v_produto.preco_atacado is not null then
    v_preco := v_produto.preco_atacado
             - floor((v_produto.preco_atacado * v_desconto) / 100.0);

    -- Um desconto de 100% zeraria o preço, e item com preço zero violaria
    -- `order_items_preco_positivo`. O piso de 1 centavo mantém a regra do
    -- banco intacta e deixa o erro de cadastro visível no extrato.
    return greatest(v_preco, 1);
  end if;

  return coalesce(v_produto.preco_promocional, v_produto.preco_varejo);
end;
$$;

comment on function public.preco_para_usuario is
  'Preço que vale para este usuário: atacado menos o desconto do parceiro, '
  'promocional, ou varejo — nessa ordem. Nunca recebe preço como parâmetro.';

revoke all on function public.preco_para_usuario(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.preco_para_usuario(uuid, uuid) to service_role;


-- =============================================================================
-- 2. CRIAÇÃO DO PEDIDO
--
-- A função inteira é recriada porque `create or replace` exige o corpo
-- completo. Em relação à versão do arquivo 05, mudaram DOIS trechos, ambos
-- marcados com "FASE 10" no comentário:
--
--   • a consulta do revendedor agora traz o pedido mínimo junto
--   • uma checagem nova, logo depois de fechar os valores
--
-- Todo o resto é idêntico — preços continuam vindo do banco, estoque continua
-- travado com FOR UPDATE, cupom inválido continua sem derrubar o pedido.
-- =============================================================================

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
  v_minimo_atacado  integer := 0;   -- FASE 10
  v_mercadoria      integer;        -- FASE 10
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

  -- FASE 10: condição de atacado E pedido mínimo, ambos vindos da tabela.
  if p_usuario_id is not null then
    select true, coalesce(pedido_minimo_centavos, 0)
      into v_eh_atacado, v_minimo_atacado
      from public.resellers
     where usuario_id = p_usuario_id and status = 'aprovado';

    -- `select into` sem linha deixa as variáveis nulas, não em false.
    v_eh_atacado := coalesce(v_eh_atacado, false);
    v_minimo_atacado := coalesce(v_minimo_atacado, 0);
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

    -- --- Mínimo de unidades POR PRODUTO ---
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

  -- FASE 10: pedido mínimo do parceiro.
  --
  -- Comparado contra a MERCADORIA (subtotal menos desconto), não contra o
  -- total: frete não é compra. Se entrasse na conta, um endereço distante
  -- ajudaria a atingir o mínimo.
  --
  -- A exceção aqui desfaz tudo que esta transação fez — pedido, itens, baixa
  -- de estoque e uso do cupom. É por isso que a checagem pode vir no fim sem
  -- deixar sujeira.
  v_mercadoria := v_subtotal - v_desconto;

  if v_eh_atacado and v_minimo_atacado > 0 and v_mercadoria < v_minimo_atacado then
    raise exception 'MINIMO_PEDIDO_ATACADO'
      -- `D` e `G` do to_char seguem a localização do servidor, que num
      -- Supabase padrão é en_US — sairia "1,234.50" para quem lê em português.
      -- Com '.' literal no padrão e um replace, o formato é sempre o nosso.
      using hint = format(
        'Pedidos de atacado começam em R$ %s. Seu pedido soma R$ %s em produtos.',
        replace(to_char(v_minimo_atacado / 100.0, 'FM999999990.00'), '.', ','),
        replace(to_char(v_mercadoria / 100.0, 'FM999999990.00'), '.', ',')
      );
  end if;

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
  'parâmetro. Recusa pedido de revendedor abaixo do mínimo dele.';

revoke all on function public.criar_pedido from public, anon, authenticated;
grant execute on function public.criar_pedido(
  uuid, text, text, text, text, jsonb, date, text, jsonb, text, integer
) to service_role;


-- =============================================================================
-- 3. VISÃO DOS REVENDEDORES, PARA O PAINEL
--
-- Junta a candidatura com o quanto o parceiro já comprou. Sem isso, decidir
-- se alguém continua merecendo desconto exigiria duas telas e uma soma de
-- cabeça.
--
-- ⚠️ Sem `security_invoker`: a visão lê `auth.users` para trazer o e-mail da
--   conta. O acesso é revogado de anon e authenticated logo abaixo — só a
--   chave de serviço, no backend atrás de `exigirAdmin`, consegue ler.
-- =============================================================================

create or replace view public.revendedores_admin as
select
  r.id,
  r.usuario_id,
  r.nome_responsavel,
  r.nome_estabelecimento,
  r.cnpj,
  r.tipo_estabelecimento,
  r.cidade,
  r.estado,
  r.whatsapp,
  coalesce(r.email, u.email)              as email,
  r.quantidade_estimada,
  r.mensagem,
  r.status,
  coalesce(r.desconto_percentual, 0)      as desconto_percentual,
  coalesce(r.pedido_minimo_centavos, 0)   as pedido_minimo_centavos,
  r.observacoes_internas,
  r.motivo_recusa,
  r.aprovado_em,
  r.criado_em,
  coalesce(c.pedidos, 0)                  as pedidos,
  coalesce(c.gasto_centavos, 0)::bigint   as gasto_centavos,
  c.ultimo_pedido_em
from public.resellers r
left join auth.users u on u.id = r.usuario_id
left join (
  select
    usuario_id,
    count(*)            as pedidos,
    sum(total_centavos) as gasto_centavos,
    max(criado_em)      as ultimo_pedido_em
  from public.orders
  where usuario_id is not null
    and eh_atacado
    and status in (
      'pagamento_aprovado', 'em_preparacao',
      'pronto_para_retirada', 'saiu_para_entrega', 'entregue'
    )
  group by usuario_id
) c on c.usuario_id = r.usuario_id;

comment on view public.revendedores_admin is
  'Candidaturas de revenda com o histórico de compras de atacado. Só a chave '
  'de serviço lê.';

revoke all on public.revendedores_admin from anon, authenticated;
grant select on public.revendedores_admin to service_role;


-- =============================================================================
-- 4. CONFERÊNCIA
-- =============================================================================

do $$
declare
  v_produto_id   uuid;
  v_atacado      integer;
  v_visao        integer;
begin
  -- A visão precisa existir e estar fechada ao público.
  select count(*) into v_visao
    from information_schema.views
   where table_schema = 'public' and table_name = 'revendedores_admin';

  if v_visao <> 1 then
    raise exception 'A visão revendedores_admin não foi criada.';
  end if;

  if has_table_privilege('anon', 'public.revendedores_admin', 'select')
     or has_table_privilege('authenticated', 'public.revendedores_admin', 'select') then
    raise exception 'FALHA GRAVE: revendedores_admin está legível fora do backend!';
  end if;

  -- Sem usuário, o preço precisa continuar sendo o de varejo/promocional.
  select id, preco_atacado into v_produto_id, v_atacado
    from public.products
   where preco_atacado is not null and arquivado_em is null
   limit 1;

  if v_produto_id is not null then
    if public.preco_para_usuario(v_produto_id, null) = v_atacado then
      raise exception
        'FALHA GRAVE: visitante sem conta recebeu preço de atacado!';
    end if;
  end if;

  raise notice '──────────────────────────────────────────────';
  raise notice '  OK: desconto do parceiro aplicado sobre o atacado';
  raise notice '  OK: pedido mínimo checado dentro de criar_pedido';
  raise notice '  OK: revendedores_admin criada e fechada ao público';
  raise notice '';
  raise notice '  Aprovação de parceiros em /admin/revendedores.html';
  raise notice '──────────────────────────────────────────────';
end $$;
