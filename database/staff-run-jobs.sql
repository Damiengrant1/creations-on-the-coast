-- Staff ("accountability" logins) run jobs, sales and stock, but not the money side.
-- They can: add, edit and move jobs; convert a job to a sale; record sales and event POS sales;
-- record stocktake adjustments; see events to tag sales.
-- They can no longer see expenses or cash transactions (so bank balances and cash flow stay private).

create or replace function public.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.app_users
    where user_id = (select auth.uid()) and role = 'accountability' and active = true
  );
$$;
revoke all on function public.is_active_staff() from public, anon;
grant execute on function public.is_active_staff() to authenticated;

-- Jobs
drop policy if exists "Staff can add jobs" on public.jobs;
create policy "Staff can add jobs" on public.jobs
  for insert to authenticated with check (public.is_active_staff());

drop policy if exists "Staff can update jobs" on public.jobs;
create policy "Staff can update jobs" on public.jobs
  for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());

-- Only lets the New Job screen undo a job it has just created when saving its items failed.
drop policy if exists "Staff can undo a job they just created" on public.jobs;
create policy "Staff can undo a job they just created" on public.jobs
  for delete to authenticated
  using (public.is_active_staff() and sale_id is null and created_at > now() - interval '10 minutes');

-- Job items (editing a job replaces its items)
drop policy if exists "Staff can manage job items" on public.job_items;
create policy "Staff can manage job items" on public.job_items
  for all to authenticated using (public.is_active_staff()) with check (public.is_active_staff());

-- Stocktake adjustments
drop policy if exists "Staff can record stock adjustments" on public.stock_movements;
create policy "Staff can record stock adjustments" on public.stock_movements
  for insert to authenticated with check (public.is_active_staff());

-- Events (to pick the event on Event POS and Record Sale)
drop policy if exists "Staff can see events" on public.events;
create policy "Staff can see events" on public.events
  for select to authenticated using (public.is_active_staff());

-- The money side stays with the admin
drop policy if exists "Accountability staff read-only" on public.expenses;
drop policy if exists "Accountability staff read-only" on public.cash_transactions;
