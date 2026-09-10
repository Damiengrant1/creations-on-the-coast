import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {normalizeOrder,validSignature,cents} from '../lib/shopify/orders.js';
export const webhook=()=>({
 id:123,admin_graphql_api_id:'gid://shopify/Order/123',name:'#123',created_at:'2026-09-10T15:00:00Z',updated_at:'2026-09-10T15:01:00Z',processed_at:'2026-09-10T15:00:00Z',financial_status:'paid',fulfillment_status:null,test:false,cancelled_at:null,
 currency:'GBP',source_name:'web',payment_gateway_names:['shopify_payments'],total_price:'36.00',current_total_price:'36.00',subtotal_price:'31.00',current_shipping_price_set:{shop_money:{amount:'5.00',currency_code:'GBP'}},total_tax:'0.00',taxes_included:false,total_outstanding:'0.00',refunds:[],note:'Please package together',note_attributes:[{name:'Message',value:'Thanks'}],email:'test@example.com',phone:'01234',shipping_address:{name:'Test Customer',address1:'Test Street',city:'Test City',zip:'TEST',country:'United Kingdom'},
 line_items:[{id:111,admin_graphql_api_id:'gid://shopify/LineItem/111',variant_id:65883916501341,name:'Rise of Champions - Boxing Show Tshirt - 9-10 years',quantity:3,current_quantity:3,price:'12.00',discount_allocations:[{amount:'5.00'}],properties:[{name:'Name',value:'Alex'}]}],
});
const money=(amount)=>({shopMoney:{amount,currencyCode:'GBP'}});
export const graph=()=>({
 id:'gid://shopify/Order/123',name:'#123',createdAt:'2026-09-10T15:00:00Z',updatedAt:'2026-09-10T15:01:00Z',processedAt:'2026-09-10T15:00:00Z',displayFinancialStatus:'PAID',displayFulfillmentStatus:'UNFULFILLED',test:false,cancelledAt:null,sourceName:'web',paymentGatewayNames:['shopify_payments'],totalPriceSet:money('36.00'),currentTotalPriceSet:money('36.00'),subtotalPriceSet:money('31.00'),currentShippingPriceSet:money('5.00'),totalTaxSet:money('0.00'),totalRefundedSet:money('0.00'),totalOutstandingSet:money('0.00'),taxesIncluded:false,note:'Please package together',customAttributes:[{key:'Message',value:'Thanks'}],email:'test@example.com',phone:'01234',shippingAddress:{name:'Test Customer',address1:'Test Street',city:'Test City',zip:'TEST',country:'United Kingdom'},
 lineItems:{pageInfo:{hasNextPage:false},nodes:[{id:'gid://shopify/LineItem/111',variant:{id:'gid://shopify/ProductVariant/65883916501341'},name:'Rise of Champions - Boxing Show Tshirt - 9-10 years',quantity:3,currentQuantity:3,originalTotalSet:money('36.00'),discountAllocations:[{allocatedAmountSet:money('5.00')}],customAttributes:[{key:'Name',value:'Alex'}]}]},
});
test('webhook and GraphQL recovery produce the same price, personalisation and fingerprint',()=>{
 const a=normalizeOrder(webhook()),b=normalizeOrder(graph(),'graphql');
 assert.deepEqual(a.issues,[]);assert.deepEqual(b.issues,[]);assert.equal(a.lines[0].total_cents,3100);assert.equal(a.shipping_cents,500);assert.equal(a.fingerprint,b.fingerprint);assert.equal(a.lines[0].quantity,3);assert.match(a.lines[0].personalisation,/Alex/);
});
test('rejects tampered body, wrong secret, malformed/missing signature',()=>{
 const body=Buffer.from('{"id":123}'),sig=createHmac('sha256','test-secret').update(body).digest('base64');
 assert.equal(validSignature(body,sig,'test-secret'),true);
 for(const s of [null,'',sig.slice(1),'!'.repeat(44)])assert.equal(validSignature(body,s,'test-secret'),false);
 assert.equal(validSignature(Buffer.from('{}'),sig,'test-secret'),false);assert.equal(validSignature(body,sig,'wrong'),false);
});
test('uses string GIDs without rounding large Shopify identifiers',()=>{
 const w=webhook();w.admin_graphql_api_id='gid://shopify/Order/820982911946154508';assert.equal(normalizeOrder(w).order_id,w.admin_graphql_api_id);
 delete w.admin_graphql_api_id;w.id=820982911946154508;assert.throws(()=>normalizeOrder(w),/identifier/);
});
test('all incomplete/unsupported monetary cases are held instead of silently undercounted',()=>{
 const changes=[w=>w.currency='USD',w=>w.payment_gateway_names=['shopify_payments','gift_card'],w=>w.source_name='pos',w=>w.refunds=[{id:1}],w=>w.total_tax='1.00',w=>w.line_items[0].price=undefined,w=>w.line_items[0].discount_allocations=[],w=>w.line_items[0].quantity=1.5,w=>w.current_total_price='35.00',w=>w.line_items[0].current_quantity=2,w=>w.total_outstanding='1.00',w=>w.current_shipping_price_set=null];
 for(const change of changes){const w=webhook();change(w);assert.ok(normalizeOrder(w).issues.length>0);}
 const g=graph();g.lineItems.pageInfo.hasNextPage=true;assert.ok(normalizeOrder(g,'graphql').issues.length>0);
});
test('detects cancellations and personalisation changes after import',()=>{
 const w=webhook(),original=normalizeOrder(w);w.line_items[0].properties[0].value='Different';assert.notEqual(normalizeOrder(w).fingerprint,original.fingerprint);
 w.cancelled_at='2026-09-10T15:02:00Z';assert.match(normalizeOrder(w).issues.join(' '),/cancelled/);
});
test('integer pence have no binary floating point rounding',()=>{
 assert.equal(cents('10.74'),1074);assert.equal(cents('0.70'),70);
 for(const value of [12,null,'NaN','-1.00','1.005','1e2'])assert.throws(()=>cents(value));
});
