-- Fresh start: one settings row holding the date the books restart from,
-- plus what the website-order flow needs to record sales correctly.

create table if not exists public.business_settings (
  id boolean primary key default true check (id),
  fresh_start_date date,
  fresh_start_completed_at timestamptz,
  square_account_id uuid references public.accounts(id),
  delivery_product_id uuid references public.products(id),
  updated_at timestamptz not null default now()
);

insert into public.business_settings (id, square_account_id, delivery_product_id)
select true,
       (select account_id from public.square_import_settings where id = true),
       (select shipping_product_id from public.shopify_import_settings limit 1)
on conflict (id) do nothing;

alter table public.business_settings enable row level security;

drop policy if exists "Signed-in team can read business settings" on public.business_settings;
create policy "Signed-in team can read business settings" on public.business_settings
  for select to authenticated
  using (public.is_active_staff() or exists (
    select 1 from public.app_users u
    where u.user_id = (select auth.uid()) and u.role = 'admin' and u.active
  ));

drop policy if exists "Admin can change business settings" on public.business_settings;
create policy "Admin can change business settings" on public.business_settings
  for update to authenticated
  using (exists (select 1 from public.app_users u where u.user_id = (select auth.uid()) and u.role = 'admin' and u.active))
  with check (exists (select 1 from public.app_users u where u.user_id = (select auth.uid()) and u.role = 'admin' and u.active));

-- Mark jobs from before the fresh start as dealt with, without creating sales.
alter table public.jobs add column if not exists closed_at_fresh_start boolean not null default false;

-- Set an account's balance to the real figure on the fresh start date.
create or replace function public.set_fresh_start_balance(p_account uuid, p_actual numeric)
returns numeric
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_date date;
  v_current numeric;
  v_diff numeric;
begin
  if not exists (select 1 from app_users u where u.user_id = auth.uid() and u.role = 'admin' and u.active) then
    raise exception 'Only the admin can set opening balances.';
  end if;
  select fresh_start_date into v_date from business_settings where id;
  if v_date is null then raise exception 'Choose the fresh start date first.'; end if;
  if p_actual is null then raise exception 'Enter the real balance.'; end if;

  select current_balance into v_current from account_balances where account_id = p_account;
  if not found then raise exception 'Account not found.'; end if;
  v_diff := round(p_actual - v_current, 2);
  if v_diff = 0 then return 0; end if;

  insert into cash_transactions (transaction_datetime, transaction_type, category, amount, from_account_id, to_account_id, description, notes)
  values (
    (v_date::timestamp at time zone 'Europe/London'),
    'adjustment',
    'Fresh start',
    abs(v_diff),
    case when v_diff < 0 then p_account end,
    case when v_diff > 0 then p_account end,
    'Fresh start balance correction',
    'Set to the real balance of £' || to_char(p_actual, 'FM999999990.00') || ' on ' || to_char(v_date, 'DD/MM/YYYY')
  );
  return v_diff;
end $$;

grant execute on function public.set_fresh_start_balance(uuid, numeric) to authenticated;

-- Turn Shopify imports off now that Shopify is being retired.
create or replace function public.retire_shopify()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from app_users u where u.user_id = auth.uid() and u.role = 'admin' and u.active) then
    raise exception 'Only the admin can retire Shopify.';
  end if;
  update shopify_import_settings set enabled = false, payouts_enabled = false;
end $$;

revoke all on function public.retire_shopify() from public, anon;
grant execute on function public.retire_shopify() to authenticated;

-- The delivery line is now used for website orders too, not just Shopify.
update public.products set product_name = 'Delivery income'
where id = (select delivery_product_id from public.business_settings where id) and product_name = 'Shopify delivery income';
