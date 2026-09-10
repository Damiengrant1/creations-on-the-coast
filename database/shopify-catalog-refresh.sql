-- Apply once to the existing product-matching setup.
-- Source statuses mirror Shopify. Removed variants stay available for history.
alter table public.shopify_variant_mappings
  drop constraint shopify_variant_mappings_shopify_status_check;
alter table public.shopify_variant_mappings
  add constraint shopify_variant_mappings_shopify_status_check
  check (shopify_status in ('ACTIVE', 'DRAFT', 'ARCHIVED', 'UNLISTED'));
alter table public.shopify_variant_mappings
  add column shopify_variant_exists boolean not null default true;
comment on column public.shopify_variant_mappings.shopify_variant_exists is
  'False when a complete Shopify product refresh confirms this variant ID no longer exists. Preserve its old link for history.';
create or replace function public.save_shopify_variant_mappings(p_mappings jsonb)
returns setof public.shopify_variant_mappings
language plpgsql
security invoker
set search_path = ''
as $$
declare
  change record;
  current_row public.shopify_variant_mappings%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.app_users a where a.user_id = auth.uid() and a.role = 'admin' and a.active
  ) then
    raise exception 'An approved admin account is required.' using errcode = '42501';
  end if;

  if p_mappings is null or jsonb_typeof(p_mappings) <> 'array' then
    raise exception 'Product links must be supplied as a list.';
  end if;
  if jsonb_array_length(p_mappings) < 1 or jsonb_array_length(p_mappings) > 200 then
    raise exception 'Save between 1 and 200 product links at a time.';
  end if;
  if (select count(distinct x->>'shopify_variant_id') from jsonb_array_elements(p_mappings) x) <> jsonb_array_length(p_mappings) then
    raise exception 'Each website variant must appear once.';
  end if;

  for change in
    select * from jsonb_to_recordset(p_mappings) as x (
      shopify_variant_id text, product_id uuid, expected_updated_at timestamptz
    ) order by shopify_variant_id
  loop
    select m.* into current_row from public.shopify_variant_mappings m
    where m.shop_domain = 'ku1cvy-ue.myshopify.com' and m.shopify_variant_id = change.shopify_variant_id
    for update;
    if not found then
      raise exception 'A website variant is no longer available. Reload the page.';
    end if;
    if not current_row.shopify_variant_exists then
      raise exception 'This website variant was removed. Reload the page before saving.';
    end if;
    if change.expected_updated_at is null or current_row.updated_at <> change.expected_updated_at then
      raise exception 'A product link was changed in another session. Reload the page before saving.';
    end if;
    if change.product_id is not null and not exists (
      select 1 from public.products p where p.id = change.product_id and p.active and p.track_stock
    ) then
      raise exception 'Choose an active stock-tracked product for each link.';
    end if;
    update public.shopify_variant_mappings m
    set product_id = change.product_id,
        match_note = case when change.product_id is null then 'Select the stock item used for this website product.' else 'Linked in product matching.' end,
        updated_at = clock_timestamp(),
        updated_by = auth.uid()
    where m.shop_domain = current_row.shop_domain and m.shopify_variant_id = current_row.shopify_variant_id
    returning m.* into current_row;
    return next current_row;
  end loop;
  return;
end;
$$;

