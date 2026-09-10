import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createHmac} from 'node:crypto';
import * as orders from '../lib/shopify/orders.js';
const source=await readFile(new URL('../app/api/shopify/webhooks/route.js',import.meta.url),'utf8');
async function harness({dbError=null}={}){
 const calls=[];
 const context=vm.createContext({Response,Buffer,process:{env:{SHOPIFY_CLIENT_SECRET:'secret'}}});
 const deps={
  orders:new vm.SyntheticModule(Object.keys(orders),function(){for(const k of Object.keys(orders))this.setExport(k,orders[k]);},{context}),
  server:new vm.SyntheticModule(['serviceDatabase'],function(){this.setExport('serviceDatabase',()=>({rpc:async(name,args)=>{calls.push({name,args});return {error:dbError};}}));},{context}),
 };
 const mod=new vm.SourceTextModule(source,{context});await mod.link(path=>path.includes('/orders')?deps.orders:deps.server);await mod.evaluate();
 return {calls,post:mod.namespace.POST};
}
const payload={admin_graphql_api_id:'gid://shopify/Order/555',name:'#555',created_at:'2026-09-10T16:00:00Z',updated_at:'2026-09-10T16:00:00Z',processed_at:'2026-09-10T16:00:00Z',line_items:[],financial_status:'paid',test:false};
const body=JSON.stringify(payload);
const sig=createHmac('sha256','secret').update(body).digest('base64');
const request=(headers={},value=body)=>new Request('https://dashboard.test/api/shopify/webhooks',{method:'POST',headers:{'x-shopify-shop-domain':orders.SHOP_DOMAIN,'x-shopify-topic':'orders/paid','x-shopify-webhook-id':'delivery-123','x-shopify-hmac-sha256':sig,...headers},body:value});
test('wrong shop, topic, signature and changed body are rejected before database access',async()=>{
 for(const [headers,value,status] of [[{'x-shopify-shop-domain':'other.myshopify.com'},body,401],[{'x-shopify-topic':'products/update'},body,400],[{'x-shopify-hmac-sha256':'invalid'},body,401],[{},'{}',401]]){
 const h=await harness();assert.equal((await h.post(request(headers,value))).status,status);assert.equal(h.calls.length,0);
 }
});
test('verified delivery is durably passed to the importer before acknowledgement; invalid totals stay reviewable',async()=>{
 const h=await harness();const response=await h.post(request());assert.equal(response.status,200);assert.equal(h.calls.length,1);assert.equal(h.calls[0].name,'receive_shopify_order');assert.equal(h.calls[0].args.p_event_id,'webhook:delivery-123');assert.equal(h.calls[0].args.p_order.order_id,payload.admin_graphql_api_id);assert.ok(h.calls[0].args.p_order.issues.length>0);
});
test('database failure returns retryable 503 and never leaks the database error',async()=>{
 const h=await harness({dbError:{message:'PRIVATE_DATABASE_ERROR'}});const response=await h.post(request());assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/PRIVATE/);
});
test('oversized bodies and missing delivery ID never reach the database',async()=>{
 const h=await harness();assert.equal((await h.post(request({'x-shopify-webhook-id':''}))).status,400);
 assert.equal((await h.post(request({},'x'.repeat(2*1024*1024+1)))).status,413);assert.equal(h.calls.length,0);
});
