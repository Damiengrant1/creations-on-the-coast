begin;
set local lock_timeout = '5s';
create temporary table purchase_totals_before on commit drop as select id,line_total from public.stock_purchase_items;
alter table public.stock_purchase_items alter column line_total set expression as (0::numeric);
alter table public.stock_purchase_items alter column cost_per_unit type numeric(24,12), alter column net_cost_per_unit type numeric(24,12);
alter table public.stock_purchase_items alter column line_total set expression as (quantity::numeric * cost_per_unit);
do $$ begin
if exists (select 1 from public.stock_purchase_items p join purchase_totals_before b using(id) where p.line_total is distinct from b.line_total) then raise exception 'Existing totals changed'; end if;
end $$;
commit;