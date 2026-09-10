-- Schema for a saved link from each website variant to one physical stock item.
-- Catalogue data is loaded separately; prices on actual orders remain authoritative.
create table public.shopify_variant_mappings (
  shop_domain text not null check (shop_domain = 'ku1cvy-ue.myshopify.com'),
  shopify_variant_id text not null check (shopify_variant_id ~ '^gid://shopify/ProductVariant/[0-9]+$'),
  shopify_product_id text not null check (shopify_product_id ~ '^gid://shopify/Product/[0-9]+$'),
  shopify_product_title text not null,
  shopify_variant_title text not null,
  shopify_status text not null check (shopify_status in ('ACTIVE', 'DRAFT', 'ARCHIVED')),
  shopify_price numeric(12,2) not null check (shopify_price >= 0),
  product_id uuid references public.products(id) on delete restrict,
  match_note text,
  catalog_checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (shop_domain, shopify_variant_id)
);

create index shopify_variant_mappings_product_idx on public.shopify_variant_mappings(product_id);
create index shopify_variant_mappings_updated_by_idx on public.shopify_variant_mappings(updated_by);
alter table public.shopify_variant_mappings enable row level security;
revoke all on public.shopify_variant_mappings from public, anon, authenticated;
grant select on public.shopify_variant_mappings to authenticated;
grant update (product_id, match_note, updated_at, updated_by) on public.shopify_variant_mappings to authenticated;

create policy "Approved admins can read Shopify product links"
on public.shopify_variant_mappings for select to authenticated
using (exists (select 1 from public.app_users a where a.user_id = (select auth.uid()) and a.role = 'admin' and a.active));

create policy "Approved admins can edit Shopify product links"
on public.shopify_variant_mappings for update to authenticated
using (exists (select 1 from public.app_users a where a.user_id = (select auth.uid()) and a.role = 'admin' and a.active))
with check (exists (select 1 from public.app_users a where a.user_id = (select auth.uid()) and a.role = 'admin' and a.active));

-- Save the whole selection atomically. Stale edits must be reloaded, never overwritten.
create function public.save_shopify_variant_mappings(p_mappings jsonb)
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

revoke all on function public.save_shopify_variant_mappings(jsonb) from public, anon;
grant execute on function public.save_shopify_variant_mappings(jsonb) to authenticated;
