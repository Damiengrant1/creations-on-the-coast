-- Isolated transactional integration test. No test business rows are retained.
begin;
set local role service_role;
do $$ declare first_cutoff timestamptz; first_shipping uuid; c public.shopify_import_settings%rowtype; begin
 select * into c from public.activate_shopify_imports('https://dashboard.test/api/shopify/webhooks','[{"topic":"ORDERS_CREATE"},{"topic":"ORDERS_PAID"},{"topic":"ORDERS_UPDATED"},{"topic":"ORDERS_CANCELLED"}]'::jsonb);
 first_cutoff:=c.start_at;first_shipping:=c.shipping_product_id;
 if not c.enabled or first_cutoff is null or first_shipping is null or c.account_id is null then raise exception 'Atomic activation incomplete';end if;
 select * into c from public.activate_shopify_imports('https://dashboard.test/api/shopify/webhooks','[{"topic":"ORDERS_CREATE"},{"topic":"ORDERS_PAID"},{"topic":"ORDERS_UPDATED"},{"topic":"ORDERS_CANCELLED"}]'::jsonb);
 if c.start_at is distinct from first_cutoff or c.shipping_product_id is distinct from first_shipping then raise exception 'Repeated activation changed cutoff or duplicated shipping product';end if;
 if has_function_privilege('authenticated','public.activate_shopify_imports(text,jsonb)','execute') then raise exception 'Browser role can activate directly';end if;
end $$;
reset role;
update public.shopify_import_settings set enabled=true,start_at=now()-interval '1 day',account_id=(select id from public.accounts where account_type='shopify' and active limit 1);
insert into public.products(product_name,category,stock_cost,production_cost,cost_price,selling_price,track_stock,low_stock_level,active)
values('Temporary delivery test','Delivery',0,0,0,0,false,0,true);
update public.shopify_import_settings set shipping_product_id=(select id from public.products where product_name='Temporary delivery test' order by created_at desc limit 1);
set local role service_role;
do $$
declare
 m public.shopify_variant_mappings%rowtype;
 p jsonb; r jsonb; sale uuid; job uuid; amount numeric; qty integer; cost numeric; expected_cost numeric;
 sales_before bigint; jobs_before bigint; stock_before bigint; cash_before bigint; total_after bigint;
begin
 select * into strict m from public.shopify_variant_mappings where shopify_product_id='gid://shopify/Product/16178796888413' and product_id is not null and shopify_variant_exists order by shopify_variant_id limit 1;
 select stock_cost+production_cost into expected_cost from public.products where id=m.product_id;
 select count(*) into sales_before from public.sales;
 select count(*) into jobs_before from public.jobs;
 select count(*) into stock_before from public.stock_movements;
 select count(*) into cash_before from public.cash_transactions;
 p:=jsonb_build_object('order_id','gid://shopify/Order/999999000000001','name','#TEST-IMPORT','created_at',now(),'updated_at',now(),'processed_at',now(),'test',false,'cancelled',false,'financial_status','paid','fulfilled',false,'currency','GBP','customer_name','Temporary test','email','test@example.invalid','phone','','notes','Rollback-only integration test','delivery_address','Test address','total_cents',3600,'shipping_cents',500,'fingerprint','test-fingerprint','issues','[]'::jsonb,'lines',jsonb_build_array(jsonb_build_object('id','gid://shopify/LineItem/999999000000001','variant_id',m.shopify_variant_id,'description','Rise of Champions test','quantity',3,'total_cents',3100,'personalisation','Name: Test')));
 r:=public.receive_shopify_order('test-delivery-1',p);
 if r->>'status'<>'imported' then raise exception 'Import failed: %', (select detail from public.shopify_order_imports where order_id=p->>'order_id'); end if;
 select sale_id,job_id into sale,job from public.shopify_order_imports where order_id=p->>'order_id';
 select sum(line_revenue),sum(line_cost) into amount,cost from public.sale_items where sale_id=sale;
 if amount<>36 or cost<>expected_cost*3 then raise exception 'Revenue or costs wrong: %, %',amount,cost;end if;
 if (select sum(quantity) from public.sale_items where sale_id=sale and product_id=m.product_id)<>3 then raise exception 'Wrong sale quantity';end if;
 if (select count(*) from public.sale_items where sale_id=sale)<>3 then raise exception 'Penny discount was not split into two rows plus shipping';end if;
 select sum(sm.quantity_change) into qty from public.stock_movements sm join public.sale_items si on si.id=sm.sale_item_id where si.sale_id=sale;
 if qty<>-3 then raise exception 'Stock deducted incorrectly: %',qty;end if;
 if (select sum(ct.amount) from public.cash_transactions ct where ct.sale_id=sale)<>36 then raise exception 'Cash receipt wrong';end if;
 if (select to_account_id from public.cash_transactions where sale_id=sale) is distinct from (select account_id from public.shopify_import_settings) then raise exception 'Wrong cash account';end if;
 if (select sale_id from public.jobs where id=job) is distinct from sale then raise exception 'Job not linked to sale';end if;
 if (select sum(quantity*unit_price) from public.job_items where job_id=job)<>36 then raise exception 'Job total differs from sale';end if;
 if not exists(select 1 from public.job_items where job_id=job and personalisation='Name: Test')then raise exception 'Personalisation lost';end if;
 -- Same delivery, another delivery and explicit retry all remain one sale/job.
 if public.receive_shopify_order('test-delivery-1',p)->>'status'<>'duplicate' then raise exception 'Delivery not deduplicated';end if;
 perform public.receive_shopify_order('test-delivery-2',p);
 perform public.receive_shopify_order('test-delivery-3',p,true);
 if (select count(*) from public.sales)<>sales_before+1 or (select count(*) from public.jobs)<>jobs_before+1 or (select count(*) from public.cash_transactions)<>cash_before+1 then raise exception 'Duplicate business records';end if;
 -- The existing job conversion guard prevents a second sale.
 begin
   perform public.convert_job_to_sale(job,now(),'Card',(select account_id from public.shopify_import_settings));
   raise exception 'Conversion was not blocked';
 exception when others then
   if SQLERRM not like '%already been converted%' then raise;end if;
 end;
 -- Older deliveries never replace current source state.
 r:=public.receive_shopify_order('test-delivery-old',p||jsonb_build_object('updated_at',now()-interval '1 hour'));
 if r->>'status'<>'stale' then raise exception 'Stale event accepted';end if;
 -- Cancelled imported order is flagged without changing stock, sale, or cash.
 perform public.receive_shopify_order('test-delivery-cancel',p||jsonb_build_object('updated_at',now()+interval '1 minute','cancelled',true,'issues',jsonb_build_array('Cancelled')));
 if (select status from public.shopify_order_imports where sale_id=sale)<>'needs_review' then raise exception 'Cancellation not flagged';end if;
 if (select count(*) from public.sales)<>sales_before+1 or (select count(*) from public.cash_transactions)<>cash_before+1 then raise exception 'Cancellation changed financial records';end if;
 -- One valid line followed by an unmatched line must not import part of the order.
 p:=p||jsonb_build_object('order_id','gid://shopify/Order/999999000000002','fingerprint','second','lines',(p->'lines')||jsonb_build_array(jsonb_build_object('id','gid://shopify/LineItem/999999000000002','variant_id','gid://shopify/ProductVariant/999999000000000','description','Unmatched item','quantity',1,'total_cents',1000)),'total_cents',4600);
 r:=public.receive_shopify_order('test-unmatched',p);
 if r->>'status'<>'needs_review' then raise exception 'Unmatched order not held';end if;
 if (select count(*) from public.sales)<>sales_before+1 or (select count(*) from public.jobs)<>jobs_before+1 then raise exception 'Partial order created';end if;
 -- Force a late numeric constraint failure after the first valid stock line was inserted.
 perform public.receive_shopify_order('test-late-failure',p||jsonb_build_object('order_id','gid://shopify/Order/999999000000007','total_cents',10000003600,'lines',jsonb_build_array((p->'lines')->0,jsonb_build_object('id','gid://shopify/LineItem/999999000000007','variant_id',m.shopify_variant_id,'description','Excessive price','quantity',1,'total_cents',10000000000))));
 if (select status from public.shopify_order_imports where order_id='gid://shopify/Order/999999000000007')<>'needs_review' or (select count(*) from public.sales)<>sales_before+1 or (select count(*) from public.cash_transactions)<>cash_before+1 or (select count(*) from public.stock_movements)<>stock_before+2 then raise exception 'Late failure did not roll back all writes';end if;
 -- Cancellation before payment remains held even if a delayed paid event shares its timestamp.
 perform public.receive_shopify_order('test-cancel-first',p||jsonb_build_object('order_id','gid://shopify/Order/999999000000008','cancelled',true,'issues',jsonb_build_array('Cancelled')));
 perform public.receive_shopify_order('test-cancel-delayed-paid',p||jsonb_build_object('order_id','gid://shopify/Order/999999000000008'));
 if (select detail from public.shopify_order_imports where order_id='gid://shopify/Order/999999000000008') not like 'A cancellation or refund%' then raise exception 'A delayed payment overwrote cancellation';end if;
 -- Earlier and test orders never create records.
 perform public.receive_shopify_order('test-before',p||jsonb_build_object('order_id','gid://shopify/Order/999999000000003','created_at',now()-interval '2 days'));
 perform public.receive_shopify_order('test-test',p||jsonb_build_object('order_id','gid://shopify/Order/999999000000004','test',true));
 if exists(select 1 from public.shopify_order_imports where order_id in ('gid://shopify/Order/999999000000003','gid://shopify/Order/999999000000004') and status<>'ignored')then raise exception 'Historical or test order accepted';end if;
 -- Paused deliveries remain queued; payment-pending deliveries do not create a sale.
 update public.shopify_import_settings set enabled=false;
 perform public.receive_shopify_order('test-paused',p||jsonb_build_object('order_id','gid://shopify/Order/999999000000005'));
 if (select status from public.shopify_order_imports where order_id='gid://shopify/Order/999999000000005')<>'paused' then raise exception 'Pause not honoured';end if;
 update public.shopify_import_settings set enabled=true;
 perform public.receive_shopify_order('test-unpaid',p||jsonb_build_object('order_id','gid://shopify/Order/999999000000006','financial_status','pending'));
 if (select status from public.shopify_order_imports where order_id='gid://shopify/Order/999999000000006')<>'waiting_payment' then raise exception 'Unpaid order not held';end if;
 if has_function_privilege('anon','public.receive_shopify_order(text,jsonb,boolean)','execute') or has_function_privilege('authenticated','public.receive_shopify_order(text,jsonb,boolean)','execute') then raise exception 'Browser roles can execute importer';end if;
 if has_function_privilege('authenticated','public.prepare_shopify_imports(text)','execute') or has_table_privilege('authenticated','public.shopify_import_settings','update') then raise exception 'Browser roles can activate imports directly';end if;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
do $$ begin
 if exists(select 1 from public.shopify_order_imports) or exists(select 1 from public.shopify_import_settings)then raise exception 'Unapproved user can read imports';end if;
end $$;
reset role;
select 'PASS: totals, direct costs, penny discounts, cash, stock, jobs, duplicate and stale deliveries, review, cutoff, pause, payment and access controls' as result;
rollback;
