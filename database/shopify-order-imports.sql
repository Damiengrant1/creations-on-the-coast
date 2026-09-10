-- Shopify paid website orders. Apply through Supabase's migration tool.
-- No imports are enabled by this migration. Existing business records are untouched.
create table public.shopify_import_settings (
  shop_domain text primary key check (shop_domain = 'ku1cvy-ue.myshopify.com'),
  enabled boolean not null default false,
  start_at timestamptz,
  account_id uuid references public.accounts(id) on delete restrict,
  shipping_product_id uuid references public.products(id) on delete restrict,
  webhook_url text,
  subscriptions jsonb not null default '[]'::jsonb,
  last_webhook_at timestamptz,
  last_sync_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.shopify_import_settings(shop_domain) values ('ku1cvy-ue.myshopify.com');
create index shopify_settings_account_idx on public.shopify_import_settings(account_id);
create index shopify_settings_shipping_idx on public.shopify_import_settings(shipping_product_id);

create table public.shopify_order_imports (
  order_id text primary key check (order_id ~ '^gid://shopify/Order/[0-9]+$'),
  order_name text not null,
  order_created_at timestamptz not null,
  source_updated_at timestamptz not null,
  order_data jsonb not null,
  status text not null default 'paused' check (status in ('paused','waiting_payment','needs_review','imported','ignored')),
  detail text,
  sale_id uuid unique references public.sales(id) on delete restrict,
  job_id uuid unique references public.jobs(id) on delete restrict,
  imported_fingerprint text,
  created_at timestamptz not null default now(),
  received_at timestamptz not null default now()
);
create index shopify_order_imports_received_idx on public.shopify_order_imports(received_at desc);
create table public.shopify_webhook_receipts (
  event_id text primary key check (length(event_id) between 1 and 300),
  order_id text not null references public.shopify_order_imports(order_id) on delete restrict,
  received_at timestamptz not null default now()
);
create index shopify_receipts_order_idx on public.shopify_webhook_receipts(order_id);

alter table public.shopify_import_settings enable row level security;
alter table public.shopify_order_imports enable row level security;
alter table public.shopify_webhook_receipts enable row level security;
revoke all on public.shopify_import_settings,public.shopify_order_imports,public.shopify_webhook_receipts from anon,authenticated;
grant select on public.shopify_import_settings,public.shopify_order_imports to authenticated;
grant all on public.shopify_import_settings,public.shopify_order_imports,public.shopify_webhook_receipts to service_role;
create policy "Approved admins read Shopify setup" on public.shopify_import_settings for select to authenticated
using (exists(select 1 from public.app_users u where u.user_id=(select auth.uid()) and u.active and u.role='admin'));
create policy "Approved admins read Shopify imports" on public.shopify_order_imports for select to authenticated
using (exists(select 1 from public.app_users u where u.user_id=(select auth.uid()) and u.active and u.role='admin'));

-- Only the authenticated server can change integration settings. Client JWTs cannot call this.
create function public.prepare_shopify_imports(p_url text) returns public.shopify_import_settings
language plpgsql security invoker set search_path='' as $$
declare v public.shopify_import_settings%rowtype; a uuid; shipping uuid;
begin
  select * into strict v from public.shopify_import_settings where shop_domain='ku1cvy-ue.myshopify.com' for update;
  if p_url !~ '^https://[^/]+/api/shopify/webhooks$' then raise exception 'Invalid webhook URL'; end if;
  if v.start_at is null then
    select id into a from public.accounts where active and account_type='shopify' order by created_at limit 1;
    if a is null then raise exception 'An active Shopify Payments account is required'; end if;
    -- A separate, non-stock sale line records delivery charged to customers.
    -- Actual postage costs continue to be recorded as expenses.
    insert into public.products(product_name,sku,category,stock_cost,production_cost,cost_price,selling_price,track_stock,low_stock_level,active,notes)
    values ('Shopify delivery income','SHOPIFY-DELIVERY-INCOME','Delivery',0,0,0,0,false,0,true,'Delivery charged on imported Shopify orders. Record actual postage costs separately as expenses.') returning id into shipping;
    update public.shopify_import_settings set start_at=clock_timestamp(),account_id=a,shipping_product_id=shipping where shop_domain=v.shop_domain;
  end if;
  update public.shopify_import_settings set webhook_url=p_url,updated_at=clock_timestamp() where shop_domain=v.shop_domain returning * into v;
  return v;
end $$;
revoke all on function public.prepare_shopify_imports(text) from public,anon,authenticated;
grant execute on function public.prepare_shopify_imports(text) to service_role;

-- One transaction stores the receipt and creates sale + lines + job + cash/stock triggers.
-- Failures of business validation leave the order in review with NO partial sale.
create function public.receive_shopify_order(p_event_id text,p_order jsonb,p_retry boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  cfg public.shopify_import_settings%rowtype;
  existing public.shopify_order_imports%rowtype;
  oid text := p_order->>'order_id';
  item jsonb; blank public.products%rowtype; line_map jsonb := '[]'::jsonb;
  sale uuid; job uuid; n integer; q integer; line_cents bigint; unit_cents bigint; remainder integer;
  total_cents bigint; shipping_cents bigint; subtotal bigint := 0;
  outcome text; message text; result jsonb; extra_notes text;
begin
  if oid is null or oid !~ '^gid://shopify/Order/[0-9]+$' or jsonb_typeof(p_order->'lines') is distinct from 'array' then raise exception 'Invalid normalized order'; end if;
  select * into strict cfg from public.shopify_import_settings where shop_domain='ku1cvy-ue.myshopify.com' for share;
  insert into public.shopify_order_imports(order_id,order_name,order_created_at,source_updated_at,order_data)
  values(oid,p_order->>'name',(p_order->>'created_at')::timestamptz,(p_order->>'updated_at')::timestamptz,p_order)
  on conflict(order_id) do nothing;
  select * into strict existing from public.shopify_order_imports where order_id=oid for update;
  insert into public.shopify_webhook_receipts(event_id,order_id) values(p_event_id,oid) on conflict(event_id) do nothing;
  get diagnostics n = row_count;
  if n=0 and not p_retry then return jsonb_build_object('status','duplicate','order_id',oid); end if;
  if (p_order->>'updated_at')::timestamptz < existing.source_updated_at then return jsonb_build_object('status','stale','order_id',oid); end if;
  update public.shopify_order_imports set order_name=p_order->>'name',order_data=p_order,source_updated_at=(p_order->>'updated_at')::timestamptz,received_at=clock_timestamp() where order_id=oid;
  -- A previously imported order is never re-created, even after retries or local edits.
  if existing.sale_id is not null then
    if coalesce(jsonb_array_length(p_order->'issues'),1)>0 or coalesce((p_order->>'cancelled')::boolean,true)
      or p_order->>'financial_status' is distinct from 'paid' or p_order->>'fingerprint' is distinct from existing.imported_fingerprint then
      outcome:='needs_review'; message:='Shopify changed after import. Review the linked sale, job, payment and stock; no automatic reversal has been made.';
    else
      -- Keep an earlier review flag until an admin has reconciled the change.
      outcome:=existing.status; message:=existing.detail;
    end if;
  elsif coalesce((existing.order_data->>'cancelled')::boolean,false) or existing.order_data->>'financial_status' in ('refunded','partially_refunded','voided') then
    outcome:='needs_review'; message:='A cancellation or refund was previously received for this order. Reconcile it before importing; delayed payment notifications cannot override it.';
  elsif coalesce((p_order->>'test')::boolean,true) then
    outcome:='ignored'; message:='Shopify test order; no business records created.';
  elsif cfg.start_at is null or (p_order->>'created_at')::timestamptz < cfg.start_at then
    outcome:='ignored'; message:='Order created before imports were first enabled; excluded to avoid historical duplicates.';
  elsif not cfg.enabled then
    outcome:='paused'; message:='Imports are paused. Use Check missed orders after resuming.';
  elsif p_order->>'financial_status' in ('pending','authorized','partially_paid') and not coalesce((p_order->>'cancelled')::boolean,true) then
    outcome:='waiting_payment'; message:='Waiting for full payment; no sale or stock deduction yet.';
  elsif coalesce(jsonb_array_length(p_order->'issues'),1)>0 then
    outcome:='needs_review'; select string_agg(value,' ') into message from jsonb_array_elements_text(p_order->'issues');
  elsif p_order->>'financial_status' is distinct from 'paid' then
    outcome:='waiting_payment'; message:='Waiting for full payment; no sale or stock deduction yet.';
  else
    begin
      if p_order->>'currency' is distinct from 'GBP' or (p_order->>'cancelled')::boolean then raise exception 'Currency or cancellation needs review'; end if;
      if not exists(select 1 from public.accounts where id=cfg.account_id and active and account_type='shopify') then raise exception 'The Shopify Payments account is missing or inactive'; end if;
      if exists(select 1 from public.jobs where shopify_order_id in (oid,split_part(oid,'/',5))) then raise exception 'This order is already linked to an existing job; review it to prevent a duplicate'; end if;
      if jsonb_array_length(p_order->'lines') not between 1 and 100 then raise exception 'Invalid number of order lines'; end if;
      total_cents := (p_order->>'total_cents')::bigint;
      shipping_cents := (p_order->>'shipping_cents')::bigint;
      if total_cents is null or shipping_cents is null or total_cents<0 or shipping_cents<0 then raise exception 'Invalid order totals'; end if;
      for item in select value from jsonb_array_elements(p_order->'lines') loop
        q := (item->>'quantity')::integer;
        line_cents := (item->>'total_cents')::bigint;
        if q is null or q not between 1 and 10000 or line_cents is null or line_cents<0 then raise exception 'Invalid order line'; end if;
        select p.* into blank from public.shopify_variant_mappings m join public.products p on p.id=m.product_id
        where m.shop_domain=cfg.shop_domain and m.shopify_variant_id=item->>'variant_id'
          and m.shopify_variant_exists and m.shopify_status='ACTIVE' and p.active and p.track_stock and p.category='Clothing'
        for share of m,p;
        if not found then raise exception 'Match an active clothing blank for: %',item->>'description'; end if;
        line_map:=line_map || jsonb_build_array(item || jsonb_build_object('product_id',blank.id,'cost',blank.stock_cost+blank.production_cost));
        subtotal:=subtotal+line_cents;
      end loop;
      if subtotal+shipping_cents<>total_cents then raise exception 'The item and delivery totals do not equal the paid amount'; end if;
      if shipping_cents>0 and not exists(select 1 from public.products where id=cfg.shipping_product_id and not track_stock and stock_cost=0 and production_cost=0) then raise exception 'Delivery income product needs checking'; end if;
      extra_notes := concat_ws(E'\n','Shopify ' || (p_order->>'name') || ' (' || oid || ')',nullif(p_order->>'notes',''),case when nullif(p_order->>'delivery_address','') is not null then E'Delivery address:\n'||(p_order->>'delivery_address') end);
      insert into public.sales(sale_datetime,customer_reference,sales_channel,payment_method,account_id,notes)
      values((p_order->>'processed_at')::timestamptz,'Shopify '||(p_order->>'name')||' - '||(p_order->>'customer_name'),'Website','Shopify Payments',cfg.account_id,extra_notes) returning id into sale;
      insert into public.jobs(received_date,customer_name,customer_phone,customer_email,source,status,payment_status,quoted_total,notes,shopify_order_id,sale_id,completed_at)
      values(((p_order->>'created_at')::timestamptz at time zone 'Europe/London')::date,p_order->>'customer_name',nullif(p_order->>'phone',''),nullif(p_order->>'email',''),'website',case when (p_order->>'fulfilled')::boolean then 'completed' else 'new' end,'paid',total_cents/100.0,extra_notes,oid,sale,case when (p_order->>'fulfilled')::boolean then now() end) returning id into job;
      for item in select value from jsonb_array_elements(line_map) loop
        q:=(item->>'quantity')::integer; line_cents:=(item->>'total_cents')::bigint;
        unit_cents:=line_cents/q; remainder:=(line_cents%q)::integer;
        -- Split at most two rows to retain every penny of an uneven order discount.
        -- Combined quantity and direct cost are exactly the original line quantity.
        if q-remainder>0 then
          insert into public.sale_items(sale_id,product_id,quantity,selling_price_each,cost_price_each) values(sale,(item->>'product_id')::uuid,q-remainder,unit_cents/100.0,(item->>'cost')::numeric);
          insert into public.job_items(job_id,product_id,item_description,quantity,unit_price,personalisation) values(job,(item->>'product_id')::uuid,item->>'description',q-remainder,unit_cents/100.0,nullif(item->>'personalisation',''));
        end if;
        if remainder>0 then
          insert into public.sale_items(sale_id,product_id,quantity,selling_price_each,cost_price_each) values(sale,(item->>'product_id')::uuid,remainder,(unit_cents+1)/100.0,(item->>'cost')::numeric);
          insert into public.job_items(job_id,product_id,item_description,quantity,unit_price,personalisation) values(job,(item->>'product_id')::uuid,item->>'description',remainder,(unit_cents+1)/100.0,nullif(item->>'personalisation',''));
        end if;
      end loop;
      if shipping_cents>0 then
        insert into public.sale_items(sale_id,product_id,quantity,selling_price_each,cost_price_each) values(sale,cfg.shipping_product_id,1,shipping_cents/100.0,0);
        insert into public.job_items(job_id,product_id,item_description,quantity,unit_price) values(job,cfg.shipping_product_id,'Delivery charged to customer',1,shipping_cents/100.0);
      end if;
      if (select coalesce(sum(line_revenue),0) from public.sale_items where sale_id=sale)<>total_cents/100.0 then raise exception 'Saved sale does not match Shopify total'; end if;
      update public.shopify_order_imports set sale_id=sale,job_id=job,imported_fingerprint=p_order->>'fingerprint' where order_id=oid;
      outcome:='imported'; message:='Sale and paid job recorded. Stock and Shopify Payments updated once.';
    exception when others then
      -- The nested transaction rolls back every financial/stock/job write.
      -- Only a sanitized message is exposed by the admin page, never publicly.
      outcome:='needs_review'; message:=left(SQLERRM,1000);
    end;
  end if;
  update public.shopify_order_imports set status=outcome,detail=message where order_id=oid;
  return jsonb_build_object('status',outcome,'order_id',oid);
end $$;
revoke all on function public.receive_shopify_order(text,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.receive_shopify_order(text,jsonb,boolean) to service_role;

-- Explicitly document the server-only receipt policy; browser roles have no grants.
create policy "Server manages webhook receipts" on public.shopify_webhook_receipts for all to service_role using (true) with check (true);

-- Set the first cutoff and enable together, AFTER webhook registration succeeds.
-- Failed setup attempts must not leave an earlier import cutoff behind.
create function public.activate_shopify_imports(p_url text,p_subscriptions jsonb)
returns public.shopify_import_settings language plpgsql security invoker set search_path='' as $$
declare cfg public.shopify_import_settings%rowtype;
begin
  if jsonb_typeof(p_subscriptions) is distinct from 'array' or jsonb_array_length(p_subscriptions)<4 then raise exception 'All four order notifications must be registered';end if;
  select * into cfg from public.prepare_shopify_imports(p_url);
  update public.shopify_import_settings set enabled=true,subscriptions=p_subscriptions,updated_at=clock_timestamp() where shop_domain=cfg.shop_domain returning * into cfg;
  return cfg;
end $$;
revoke all on function public.activate_shopify_imports(text,jsonb) from public,anon,authenticated;
grant execute on function public.activate_shopify_imports(text,jsonb) to service_role;
