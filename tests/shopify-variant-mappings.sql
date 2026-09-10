-- Run in the Supabase SQL editor as the database owner.
-- Every test change is rolled back; no sales, stock or cash records are changed.
begin;

select set_config('request.jwt.claims',
  jsonb_build_object('sub', (
    select user_id from public.app_users where role = 'admin' and active
    order by created_at limit 1
  ), 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
declare
  first_row public.shopify_variant_mappings%rowtype;
  second_row public.shopify_variant_mappings%rowtype;
  saved_row public.shopify_variant_mappings%rowtype;
  target_product uuid;
  nonstock_product uuid;
  before_time timestamptz;
  result_count integer;
  rejected boolean := false;
begin
  select * into first_row from public.shopify_variant_mappings order by shopify_variant_id limit 1;
  select * into second_row from public.shopify_variant_mappings order by shopify_variant_id offset 1 limit 1;
  if first_row.shopify_variant_id is null or second_row.shopify_variant_id is null then
    raise exception 'Test requires an approved admin and at least two catalogue variants.';
  end if;
  select id into target_product from public.products where active and track_stock order by id limit 1;
  select id into nonstock_product from public.products where not track_stock order by id limit 1;
  if target_product is null or nonstock_product is null then
    raise exception 'Test requires a tracked product and a non-stock product.';
  end if;

  select * into saved_row from public.save_shopify_variant_mappings(jsonb_build_array(jsonb_build_object(
    'shopify_variant_id', first_row.shopify_variant_id,
    'product_id', target_product,
    'expected_updated_at', first_row.updated_at
  )));
  if saved_row.product_id is distinct from target_product
    or saved_row.updated_by is distinct from auth.uid()
    or saved_row.updated_at <= first_row.updated_at then
    raise exception 'Approved admin save or audit fields failed.';
  end if;

  begin
    perform public.save_shopify_variant_mappings(jsonb_build_array(jsonb_build_object(
      'shopify_variant_id', first_row.shopify_variant_id, 'product_id', null,
      'expected_updated_at', first_row.updated_at
    )));
  exception when raise_exception then
    if sqlerrm not like '%another session%' then raise; end if;
    rejected := true;
  end;
  if not rejected then raise exception 'Stale edits were accepted.'; end if;

  -- The first link is valid, but the second is stale: neither may be saved.
  rejected := false;
  before_time := saved_row.updated_at;
  begin
    perform public.save_shopify_variant_mappings(jsonb_build_array(
      jsonb_build_object('shopify_variant_id', first_row.shopify_variant_id, 'product_id', null, 'expected_updated_at', saved_row.updated_at),
      jsonb_build_object('shopify_variant_id', second_row.shopify_variant_id, 'product_id', target_product, 'expected_updated_at', second_row.updated_at - interval '1 second')
    ));
  exception when raise_exception then
    if sqlerrm not like '%another session%' then raise; end if;
    rejected := true;
  end;
  select * into saved_row from public.shopify_variant_mappings where shopify_variant_id = first_row.shopify_variant_id;
  if not rejected or saved_row.updated_at <> before_time or saved_row.product_id is distinct from target_product then
    raise exception 'A failed batch was not rolled back atomically.';
  end if;

  rejected := false;
  begin
    perform public.save_shopify_variant_mappings(jsonb_build_array(jsonb_build_object(
      'shopify_variant_id', first_row.shopify_variant_id, 'product_id', nonstock_product,
      'expected_updated_at', saved_row.updated_at
    )));
  exception when raise_exception then
    if sqlerrm not like '%stock-tracked%' then raise; end if;
    rejected := true;
  end;
  if not rejected then raise exception 'A non-stock product was accepted.'; end if;

  select count(*) into result_count from public.save_shopify_variant_mappings(jsonb_build_array(jsonb_build_object(
    'shopify_variant_id', first_row.shopify_variant_id, 'product_id', null,
    'expected_updated_at', saved_row.updated_at
  )));
  if result_count <> 1 or exists (
    select 1 from public.shopify_variant_mappings where shopify_variant_id = first_row.shopify_variant_id and product_id is not null
  ) then raise exception 'Unlinking failed.'; end if;
end $$;

reset role;
select set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare rejected boolean := false;
begin
  if exists (select 1 from public.shopify_variant_mappings) then
    raise exception 'An unapproved user could read product links.';
  end if;
  begin
    perform public.save_shopify_variant_mappings('[]'::jsonb);
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'An unapproved user could call the save function.'; end if;
end $$;

reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$
declare rejected boolean := false;
begin
  begin
    perform 1 from public.shopify_variant_mappings limit 1;
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'Anonymous access to product links was allowed.'; end if;
  rejected := false;
  begin
    perform public.save_shopify_variant_mappings('[]'::jsonb);
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'Anonymous access to saving was allowed.'; end if;
end $$;

rollback;

select 'All product-matching checks passed; test edits rolled back.' as test_result,
  (select count(*) from public.shopify_variant_mappings) as website_variants,
  (select count(*) from public.shopify_variant_mappings where product_id is not null) as linked_variants,
  (select count(*) from public.sales) as sales,
  (select count(*) from public.stock_movements) as stock_movements,
  (select count(*) from public.cash_transactions) as cash_transactions;
