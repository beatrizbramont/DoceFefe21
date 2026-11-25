-- =============================================================================
-- DOCE FEFÊ.21 — 03-seed.sql
-- Dados iniciais e de DEMONSTRAÇÃO
-- =============================================================================
--
-- EXECUTE DEPOIS DE 01-schema.sql e 02-rls.sql
--
-- ⚠️ ATENÇÃO — PRODUTOS DE DEMONSTRAÇÃO
--
--   Os produtos abaixo NÃO são o catálogo real da Doce Fefê.21. Eles existem
--   para que o site possa ser visto funcionando antes de a cliente informar
--   nomes, sabores, pesos e preços verdadeiros.
--
--   Todos têm o slug começando com `demo-`, o que torna trivial identificá-los
--   e removê-los depois:
--
--       delete from public.products where slug like 'demo-%';
--
--   Os PREÇOS são valores de referência inventados para o layout. NÃO
--   representam a tabela real da marca e devem ser substituídos antes de
--   o site ir ao ar.
--
--   As CATEGORIAS, por outro lado, são reais — foram definidas na
--   especificação do projeto e podem ficar como estão.
-- =============================================================================


-- =============================================================================
-- 1. CATEGORIAS (dados reais)
-- =============================================================================

insert into public.categories (slug, nome, descricao, icone, ordem, ativa) values
  -- Nome no singular: existe um sabor de cada. O slug fica no plural porque
  -- é endereço de página, não texto de vitrine — ver 21-categorias-no-singular.sql.
  ('brownies',    'Brownie',        'Brownie artesanal, denso e úmido.',                        '🍫', 1, true),
  ('paes-de-mel', 'Pão de Mel',     'Pão de mel recheado e coberto com chocolate.',             '🍯', 2, true),
  ('alfajores',   'Alfajor',        'Alfajor artesanal com recheio cremoso.',                   '🥮', 3, true),
  ('fit',         'Doce Fefê Fit',  'Opções mais leves, sem abrir mão do sabor.',               '🌿', 4, true),
  ('sazonais',    'Sazonais',       'Produtos especiais de Páscoa, Natal e datas comemorativas.','🎁', 5, true)
on conflict (slug) do update set
  nome      = excluded.nome,
  descricao = excluded.descricao,
  icone     = excluded.icone,
  ordem     = excluded.ordem;


-- =============================================================================
-- 2. PRODUTOS DE DEMONSTRAÇÃO
--
-- Preços em CENTAVOS. Exemplo: 1200 = R$ 12,00
-- =============================================================================

insert into public.products (
  categoria_id, slug, nome, descricao_curta, descricao, ingredientes, alergenicos,
  preco_varejo, preco_atacado, preco_promocional, peso_gramas, minimo_atacado,
  destaque, mais_vendido, novidade, sazonal, publicado, vendas_total
)
select
  c.id, d.slug, d.nome, d.descricao_curta, d.descricao, d.ingredientes, d.alergenicos,
  d.preco_varejo, d.preco_atacado, d.preco_promocional, d.peso_gramas, d.minimo_atacado,
  d.destaque, d.mais_vendido, d.novidade, d.sazonal, true, d.vendas_total
from (values
  -- ---------------------------------------------------------------- BROWNIES
  ('brownies', 'demo-brownie-tradicional', 'Brownie Tradicional',
   'Clássico, denso e com casquinha crocante por cima.',
   'Nosso brownie tradicional: massa densa e úmida, feita com chocolate meio amargo e aquela casquinha fina e crocante que se forma no forno. Um clássico que nunca sai de moda.',
   'Chocolate meio amargo, manteiga, açúcar, ovos, farinha de trigo, cacau em pó, sal.',
   'Contém glúten, leite e ovos. Pode conter traços de castanhas.',
   1200, 850, null, 90, 10, true, true, false, false, 142),

  ('brownies', 'demo-brownie-nutella', 'Brownie Recheado de Nutella',
   'Brownie com recheio generoso de creme de avelã.',
   'A massa do nosso brownie tradicional com um recheio generoso de creme de avelã no centro. Melhor servido levemente aquecido.',
   'Chocolate meio amargo, manteiga, açúcar, ovos, farinha de trigo, cacau em pó, creme de avelã, sal.',
   'Contém glúten, leite, ovos e castanhas (avelã).',
   1600, 1150, 1400, 110, 10, true, true, false, false, 118),

  ('brownies', 'demo-brownie-doce-de-leite', 'Brownie de Doce de Leite',
   'Massa de chocolate com fio de doce de leite.',
   'Brownie tradicional com doce de leite distribuído na massa, criando faixas cremosas em cada mordida.',
   'Chocolate meio amargo, manteiga, açúcar, ovos, farinha de trigo, cacau em pó, doce de leite, sal.',
   'Contém glúten, leite e ovos.',
   1500, 1080, null, 105, 10, false, true, false, false, 96),

  -- ------------------------------------------------------------ PÃES DE MEL
  ('paes-de-mel', 'demo-pao-de-mel-tradicional', 'Pão de Mel Tradicional',
   'Recheado com doce de leite e coberto com chocolate.',
   'Massa macia de mel e especiarias, recheio de doce de leite cremoso e cobertura generosa de chocolate. O produto que deu origem à Doce Fefê.',
   'Mel, farinha de trigo, açúcar mascavo, cacau em pó, especiarias, leite, ovos, doce de leite, chocolate.',
   'Contém glúten, leite e ovos.',
   900, 620, null, 80, 12, true, true, false, false, 287),

  ('paes-de-mel', 'demo-pao-de-mel-brigadeiro', 'Pão de Mel de Brigadeiro',
   'Recheio cremoso de brigadeiro tradicional.',
   'A mesma massa macia de mel e especiarias, agora com recheio de brigadeiro cremoso e cobertura de chocolate.',
   'Mel, farinha de trigo, açúcar mascavo, cacau em pó, especiarias, leite condensado, manteiga, chocolate.',
   'Contém glúten, leite e ovos.',
   950, 660, null, 80, 12, false, true, false, false, 203),

  ('paes-de-mel', 'demo-pao-de-mel-branco', 'Pão de Mel com Chocolate Branco',
   'Cobertura de chocolate branco e recheio de doce de leite.',
   'Para quem prefere o chocolate branco: mesma massa de mel, recheio de doce de leite e cobertura branca.',
   'Mel, farinha de trigo, açúcar mascavo, especiarias, leite, ovos, doce de leite, chocolate branco.',
   'Contém glúten, leite e ovos.',
   1000, 700, null, 80, 12, false, false, true, false, 54),

  -- -------------------------------------------------------------- ALFAJORES
  ('alfajores', 'demo-alfajor-doce-de-leite', 'Alfajor de Doce de Leite',
   'Dois discos macios, doce de leite e banho de chocolate.',
   'Dois discos de massa amanteigada que derretem na boca, unidos por doce de leite cremoso e mergulhados em chocolate.',
   'Farinha de trigo, amido de milho, manteiga, açúcar, ovos, doce de leite, chocolate.',
   'Contém glúten, leite e ovos.',
   1100, 780, null, 70, 12, true, false, false, false, 164),

  ('alfajores', 'demo-alfajor-branco', 'Alfajor de Chocolate Branco',
   'Versão com cobertura de chocolate branco.',
   'O mesmo alfajor macio, com doce de leite e banho de chocolate branco.',
   'Farinha de trigo, amido de milho, manteiga, açúcar, ovos, doce de leite, chocolate branco.',
   'Contém glúten, leite e ovos.',
   1150, 810, null, 70, 12, false, false, true, false, 71),

  -- ------------------------------------------------------------ DOCE FEFÊ FIT
  ('fit', 'demo-brownie-fit-cacau', 'Brownie Fit de Cacau 70%',
   'Sem açúcar refinado, adoçado com tâmaras.',
   'Versão mais leve do nosso brownie: cacau 70%, adoçado com tâmaras e farinha de amêndoas. Sem açúcar refinado.',
   'Cacau 70%, tâmaras, farinha de amêndoas, ovos, óleo de coco, fermento, sal.',
   'Contém ovos e castanhas (amêndoas). Não contém glúten.',
   1800, 1300, null, 85, 8, true, false, true, false, 38),

  ('fit', 'demo-pao-de-mel-fit', 'Pão de Mel Fit',
   'Sem açúcar refinado, com chocolate 70%.',
   'Massa de mel integral com especiarias, recheio sem açúcar refinado e cobertura de chocolate 70%.',
   'Mel, farinha integral, cacau, especiarias, ovos, chocolate 70%.',
   'Contém glúten e ovos.',
   1400, 980, null, 75, 8, false, false, true, false, 29),

  -- --------------------------------------------------------------- SAZONAIS
  ('sazonais', 'demo-ovo-de-pascoa-brownie', 'Ovo de Páscoa de Brownie',
   'Casca de chocolate recheada com brownie.',
   'Produto sazonal de Páscoa: casca de chocolate ao leite recheada com pedaços do nosso brownie tradicional.',
   'Chocolate ao leite, brownie (chocolate, manteiga, açúcar, ovos, farinha de trigo).',
   'Contém glúten, leite e ovos.',
   5900, 4200, null, 250, 5, false, false, false, true, 17),

  ('sazonais', 'demo-panetone-trufado', 'Panetone Trufado',
   'Produto de Natal, recheado com trufa de chocolate.',
   'Produto sazonal de Natal: panetone artesanal recheado com trufa de chocolate meio amargo.',
   'Farinha de trigo, ovos, manteiga, açúcar, fermento biológico, chocolate meio amargo, creme de leite.',
   'Contém glúten, leite e ovos.',
   6500, 4700, null, 500, 5, false, false, false, true, 8)

) as d(categoria_slug, slug, nome, descricao_curta, descricao, ingredientes, alergenicos,
       preco_varejo, preco_atacado, preco_promocional, peso_gramas, minimo_atacado,
       destaque, mais_vendido, novidade, sazonal, vendas_total)
join public.categories c on c.slug = d.categoria_slug
on conflict (slug) do nothing;


-- =============================================================================
-- 3. ESTOQUE DOS PRODUTOS DE DEMONSTRAÇÃO
--
-- A linha de estoque é criada automaticamente pelo gatilho `ao_criar_produto`
-- com quantidade zero. Aqui damos quantidades para o catálogo não aparecer
-- todo esgotado.
-- =============================================================================

update public.inventory e
set quantidade = case
      when p.sazonal then 12
      when p.mais_vendido then 60
      else 30
    end,
    alerta_minimo = 10,
    sob_encomenda = true
from public.products p
where p.id = e.produto_id
  and p.slug like 'demo-%';


-- =============================================================================
-- 4. IMAGENS
--
-- Ainda não temos fotografias dos produtos — a cliente vai fornecer.
-- Em vez de usar imagens genéricas de banco de imagens (que destoariam da
-- marca), deixamos sem imagem: o frontend mostra um marcador elegante com
-- a identidade visual da Doce Fefê.21.
--
-- Quando as fotos chegarem, elas entram no Supabase Storage e são
-- registradas aqui. Exemplo:
--
--   insert into public.product_images (produto_id, url, alt, ordem, principal)
--   select id,
--          'https://SEU-PROJETO.supabase.co/storage/v1/object/public/produtos/brownie.jpg',
--          'Brownie tradicional da Doce Fefê.21',
--          0, true
--   from public.products where slug = 'demo-brownie-tradicional';
-- =============================================================================


-- =============================================================================
-- 5. CUPOM DE DEMONSTRAÇÃO
-- =============================================================================

insert into public.coupons (
  codigo, descricao, tipo, valor, valor_minimo_pedido,
  limite_usos, limite_por_cliente, valido_ate, ativo
) values
  ('BEMVINDO10', 'Demonstração: 10% de desconto na primeira compra',
   'percentual', 10, 5000, 100, 1, now() + interval '90 days', true)
on conflict (codigo) do nothing;


-- =============================================================================
-- 6. CONFERÊNCIA
-- =============================================================================

do $$
declare
  qtd_categorias integer;
  qtd_produtos   integer;
  qtd_demo       integer;
begin
  select count(*) into qtd_categorias from public.categories where ativa;
  select count(*) into qtd_produtos   from public.products where publicado;
  select count(*) into qtd_demo       from public.products where slug like 'demo-%';

  raise notice '──────────────────────────────────────────────';
  raise notice '  Categorias ativas: %', qtd_categorias;
  raise notice '  Produtos publicados: %', qtd_produtos;
  raise notice '  Dos quais são DEMONSTRAÇÃO: %', qtd_demo;
  raise notice '──────────────────────────────────────────────';
  raise notice '  Para remover os produtos de demonstração:';
  raise notice '    delete from public.products where slug like ''demo-%%'';';
  raise notice '──────────────────────────────────────────────';
end $$;
