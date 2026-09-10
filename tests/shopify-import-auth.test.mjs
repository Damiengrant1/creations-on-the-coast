import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../lib/shopify/server.js',import.meta.url),'utf8');
async function harness({access={role:'admin',active:true},authError=null,lookupError=null}={}){
 const calls=[];
 const context=vm.createContext({Response,URLSearchParams,AbortSignal,process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'test-publishable',SUPABASE_SECRET_KEY:'private-server-key'}},fetch:()=>{throw new Error('Unexpected network call');}});
 const dep=new vm.SyntheticModule(['createClient'],function(){this.setExport('createClient',(_url,key,options)=>{calls.push({key,headers:options.global.headers});return {auth:{getUser:async token=>{calls.push({token});return {data:authError?null:{user:{id:'verified-admin'}},error:authError};}},from:table=>{assert.equal(table,'app_users');return {select(){return this;},eq(k,v){assert.equal(k,'user_id');assert.equal(v,'verified-admin');return this;},maybeSingle:async()=>({data:access,error:lookupError})};}};});},{context});
 const orders=new vm.SyntheticModule(['SHOP_DOMAIN'],function(){this.setExport('SHOP_DOMAIN','ku1cvy-ue.myshopify.com');},{context});
 const mod=new vm.SourceTextModule(source,{context});await mod.link(path=>path.includes('supabase')?dep:orders);await mod.evaluate();return {calls,admin:mod.namespace.requireAdmin};
}
const req=(auth=true)=>new Request('https://dashboard.test/api/shopify/imports',{headers:auth?{Authorization:'Bearer signed-user-token'}:{}});
test('missing or invalid session cannot access integration management',async()=>{
 const h=await harness();await assert.rejects(()=>h.admin(req(false)),e=>e.status===401);assert.equal(h.calls.length,0);
 const bad=await harness({authError:{message:'expired'}});await assert.rejects(()=>bad.admin(req()),e=>e.status===401);assert.ok(bad.calls.every(c=>c.key!=='private-server-key'));
});
test('unapproved, inactive or non-admin users are rejected even with a valid session',async()=>{
 for(const access of [null,{role:'admin',active:false},{role:'viewer',active:true}]){const h=await harness({access});await assert.rejects(()=>h.admin(req()),e=>e.status===403);assert.ok(h.calls.every(c=>c.key!=='private-server-key'));}
 const failed=await harness({lookupError:{message:'unavailable'}});await assert.rejects(()=>failed.admin(req()),e=>e.status===503);
});
test('approved admin is verified with getUser and RLS publishable client',async()=>{
 const h=await harness();await h.admin(req());assert.equal(h.calls[0].key,'test-publishable');assert.equal(h.calls[0].headers.Authorization,'Bearer signed-user-token');assert.equal(h.calls[1].token,'signed-user-token');
});
