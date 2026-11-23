-- =============================================================================
-- DOCE FEFÊ.21 — 07-catalogo-real.sql
-- Enxuga o catálogo e cadastra os Kits de Natal
-- =============================================================================
--
-- EXECUTE DEPOIS DE 06.
--
-- O QUE ESTE ARQUIVO FAZ
--
--   1. REMOVE os produtos de demonstração, mantendo apenas três:
--        • Pão de Mel Tradicional
--        • Alfajor de Doce de Leite
--        • Brownie Tradicional
--
--   2. CADASTRA os 4 Kits de Natal, com os preços reais informados pela
--      cliente na arte da campanha.
--
--   3. REGISTRA as fotografias enviadas.
--
-- -----------------------------------------------------------------------------
-- SOBRE OS PREÇOS
--
--   Os preços dos KITS são REAIS — vieram da arte oficial da campanha.
--
--   Os preços dos três produtos individuais ainda são valores de referência
--   (inventados na Fase 3 para o layout). Por isso eles mantêm o prefixo
--   `demo-` no slug: é o que faz o site exibir o aviso de "preço de
--   referência" para eles, e só para eles.
--
--   Quando a cliente informar os valores reais, basta atualizar o preço e
--   renomear o slug — e o aviso some sozinho.
--
-- -----------------------------------------------------------------------------
-- SOBRE OS KITS
--
--   Estes são PRODUTOS PRONTOS, de preço fixo — não a funcionalidade de
--   "monte seu kit", que segue fora do escopo. O cliente escolhe um kit
--   pronto da mesma forma que escolheria um brownie.
-- =============================================================================


-- =============================================================================
-- 1. REMOVE OS PRODUTOS QUE NÃO FAZEM PARTE DO CATÁLOGO
--
-- `delete` de verdade, e não arquivamento: estes produtos nunca foram
-- vendidos (eram de demonstração), então não há histórico de pedido a
-- preservar. A exclusão leva junto as imagens e o estoque, por cascata.
-- =============================================================================

delete from public.products
 where slug like 'demo-%'
   and slug not in (
     'demo-pao-de-mel-tradicional',
     'demo-alfajor-doce-de-leite',
     'demo-brownie-tradicional'
   );


-- =============================================================================
-- 2. AJUSTA OS TRÊS PRODUTOS QUE FICAM
--
-- Tira o destaque de "mais vendido" e a promoção: as seções que os exibiam
-- foram removidas da página inicial a pedido da cliente.
-- =============================================================================

update public.products
   set mais_vendido = false,
       preco_promocional = null,
       destaque = true,
       novidade = false
 where slug in (
   'demo-pao-de-mel-tradicional',
   'demo-alfajor-doce-de-leite',
   'demo-brownie-tradicional'
 );


-- =============================================================================
-- 3. KITS DE NATAL
--
-- Dados extraídos da arte oficial da campanha. Nada foi inventado:
--
--   Kit 1 ....................... 1 pão de mel ou 1 alfajor ..... R$ 12,90
--   Kit 2 — Cesta de Natal ...... 2 pães de mel ou 2 alfajores .. R$ 26,00
--   Kit 3 — Cesta de Papai Noel . 3 pães de mel ou 3 alfajores .. R$ 35,00
--   Kit 4 — Papai Noel Especial . 3 pães de mel ou 3 alfajores .. R$ 34,00
--
-- Observação: o Kit 4 custa menos que o Kit 3 com o mesmo conteúdo. A
-- diferença está na embalagem, e é assim que consta na arte — reproduzimos
-- fielmente em vez de "corrigir" o que a cliente definiu.
--
-- `preco_atacado` fica nulo: a cliente ainda não informou tabela de atacado
-- para os kits, e inventar um valor criaria desconto inexistente.
-- =============================================================================

insert into public.products (
  categoria_id, slug, nome, descricao_curta, descricao, ingredientes,
  alergenicos, preco_varejo, peso_gramas, minimo_atacado,
  destaque, mais_vendido, novidade, sazonal, publicado
)
select
  c.id, d.slug, d.nome, d.descricao_curta, d.descricao, d.ingredientes,
  d.alergenicos, d.preco_varejo, null, 1,
  false, false, true, true, true
from (values
  (
    'kit-natal-1-arvore',
    'Kit 1 — Caixinha Árvore de Natal',
    'Caixinha de Natal com 1 pão de mel ou 1 alfajor.',
    'Presente individual na caixinha em formato de árvore de Natal. Escolha entre 1 pão de mel ou 1 alfajor. Perfeito para lembrancinhas e amigo secreto. Quantidade limitada de embalagem.',
    'Conforme o doce escolhido: pão de mel (mel, farinha de trigo, açúcar mascavo, cacau, especiarias, leite, ovos, doce de leite, chocolate) ou alfajor (farinha de trigo, amido de milho, manteiga, açúcar, ovos, doce de leite, chocolate).',
    'Contém glúten, leite e ovos.',
    1290
  ),
  (
    'kit-natal-2-cesta',
    'Kit 2 — Cesta de Natal',
    'Cesta natalina com 2 pães de mel ou 2 alfajores.',
    'Cesta decorada com tema de Natal, finalizada com laço dourado. Escolha entre 2 pães de mel ou 2 alfajores. Quantidade limitada de embalagem.',
    'Conforme o doce escolhido: pão de mel (mel, farinha de trigo, açúcar mascavo, cacau, especiarias, leite, ovos, doce de leite, chocolate) ou alfajor (farinha de trigo, amido de milho, manteiga, açúcar, ovos, doce de leite, chocolate).',
    'Contém glúten, leite e ovos.',
    2600
  ),
  (
    'kit-natal-3-papai-noel',
    'Kit 3 — Cesta de Papai Noel',
    'Cesta do Papai Noel com 3 pães de mel ou 3 alfajores.',
    'Cesta especial com a estampa do Papai Noel e laço verde. Escolha entre 3 pães de mel ou 3 alfajores. Quantidade limitada de embalagem.',
    'Conforme o doce escolhido: pão de mel (mel, farinha de trigo, açúcar mascavo, cacau, especiarias, leite, ovos, doce de leite, chocolate) ou alfajor (farinha de trigo, amido de milho, manteiga, açúcar, ovos, doce de leite, chocolate).',
    'Contém glúten, leite e ovos.',
    3500
  ),
  (
    'kit-natal-4-papai-noel-especial',
    'Kit 4 — Papai Noel Especial',
    'Caixa Feliz Natal com 3 pães de mel ou 3 alfajores.',
    'Caixa vermelha Feliz Natal, elegante e pronta para presentear. Escolha entre 3 pães de mel ou 3 alfajores. Quantidade limitada de embalagem.',
    'Conforme o doce escolhido: pão de mel (mel, farinha de trigo, açúcar mascavo, cacau, especiarias, leite, ovos, doce de leite, chocolate) ou alfajor (farinha de trigo, amido de milho, manteiga, açúcar, ovos, doce de leite, chocolate).',
    'Contém glúten, leite e ovos.',
    3400
  )
) as d(slug, nome, descricao_curta, descricao, ingredientes, alergenicos, preco_varejo)
join public.categories c on c.slug = 'sazonais'
on conflict (slug) do update set
  nome            = excluded.nome,
  descricao_curta = excluded.descricao_curta,
  descricao       = excluded.descricao,
  ingredientes    = excluded.ingredientes,
  alergenicos     = excluded.alergenicos,
  preco_varejo    = excluded.preco_varejo,
  novidade        = true,
  sazonal         = true,
  publicado       = true;


-- =============================================================================
-- 4. ESTOQUE DOS KITS
--
-- `sob_encomenda = true`: a produção é artesanal e feita conforme o pedido.
-- A embalagem é que tem quantidade limitada, e esse controle a cliente fará
-- pelo painel administrativo quando quiser limitar as vendas.
-- =============================================================================

update public.inventory e
   set sob_encomenda = true,
       quantidade = 0,
       alerta_minimo = 5
  from public.products p
 where p.id = e.produto_id
   and p.slug like 'kit-natal-%';


-- =============================================================================
-- 5. FOTOGRAFIAS
--
-- Os caminhos são relativos à raiz do site. O frontend resolve o endereço
-- conforme a página (ver urlMidia em js/config.js), o que permite migrar para
-- o Supabase Storage depois sem alterar o código: basta trocar o caminho por
-- uma URL completa, que o mesmo código passa a usar direto.
-- =============================================================================

-- Limpa antes de inserir, para o arquivo poder ser executado mais de uma vez
-- sem criar imagens duplicadas.
delete from public.product_images
 where produto_id in (
   select id from public.products
    where slug like 'kit-natal-%'
       or slug = 'demo-pao-de-mel-tradicional'
 );

insert into public.product_images (produto_id, url, alt, ordem, principal)
select p.id, d.url, d.alt, 0, true
from (values
  ('demo-pao-de-mel-tradicional',
   'assets/images/paodemel.jpeg',
   'Dois pães de mel da Doce Fefê.21 cobertos com chocolate, um deles cortado mostrando o recheio de doce de leite'),

  ('kit-natal-1-arvore',
   'assets/images/kitnatal1.jpeg',
   'Kit 1 da Doce Fefê.21: caixinha em formato de árvore de Natal acompanhada de um pão de mel embalado'),

  ('kit-natal-2-cesta',
   'assets/images/kitnatal2.jpeg',
   'Kit 2 Cesta de Natal da Doce Fefê.21: cesta decorada com laço dourado e dois pães de mel embalados'),

  ('kit-natal-3-papai-noel',
   'assets/images/kitnatal3.jpeg',
   'Kit 3 Cesta de Papai Noel da Doce Fefê.21: cesta com estampa de Papai Noel, laço verde e três pães de mel embalados'),

  ('kit-natal-4-papai-noel-especial',
   'assets/images/kitnatal4.jpeg',
   'Kit 4 Papai Noel Especial da Doce Fefê.21: caixa vermelha Feliz Natal com três pães de mel embalados')
) as d(slug, url, alt)
join public.products p on p.slug = d.slug;


-- =============================================================================
-- 6. CONFERÊNCIA
-- =============================================================================

do $$
declare
  v_total      integer;
  v_kits       integer;
  v_demo       integer;
  v_novidades  integer;
  v_sem_foto   integer;
  r            record;
begin
  select count(*) into v_total from public.products where publicado;
  select count(*) into v_kits  from public.products where slug like 'kit-natal-%';
  select count(*) into v_demo  from public.products where slug like 'demo-%';

  select count(*) into v_novidades
    from public.catalogo_publico where novidade;

  select count(*) into v_sem_foto
    from public.catalogo_publico where imagens is null;

  if v_kits <> 4 then
    raise exception 'Esperados 4 kits de Natal, encontrados %.', v_kits;
  end if;

  if v_demo <> 3 then
    raise exception 'Esperados 3 produtos individuais, encontrados %.', v_demo;
  end if;

  raise notice '──────────────────────────────────────────────';
  raise notice '  Produtos publicados: %', v_total;
  raise notice '    Kits de Natal:     %', v_kits;
  raise notice '    Individuais:       %', v_demo;
  raise notice '  Em "Novidades":      %', v_novidades;
  raise notice '  Ainda sem foto:      %', v_sem_foto;
  raise notice '──────────────────────────────────────────────';

  for r in
    select nome, preco_varejo, novidade
      from public.catalogo_publico
     order by novidade desc, preco_varejo asc
  loop
    raise notice '  % — R$ %', rpad(r.nome, 36), to_char(r.preco_varejo / 100.0, 'FM990.00');
  end loop;

  raise notice '──────────────────────────────────────────────';
end $$;
