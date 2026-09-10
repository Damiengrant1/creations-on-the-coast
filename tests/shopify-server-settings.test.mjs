import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
const source=await readFile(new URL('../lib/shopify/server.js',import.meta.url),'utf8');
async function harness({key='sb_secret_test-server',response=()=>Response.json({shop_domain:'ku1cvy-ue.myshopify.com',enabled:false})}={}){
 const requests=[];
 const context=vm.createContext({Response,Headers,Buffer,URL,URLSearchParams,AbortSignal,process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',SUPABASE_SECRET_KEY:key}},fetch:async(url,options)=>{requests.push({url,headers:new Headers(options.headers)});return response();}});
 const supabase=new vm.SyntheticModule(['createClient'],function(){this.setExport('createClient',createClient);},{context});
 const orders=new vm.SyntheticModule(['SHOP_DOMAIN'],function(){this.setExport('SHOP_DOMAIN','ku1cvy-ue.myshopify.com');},{context});
 const mod=new vm.SourceTextModule(source,{context});await mod.link(path=>path.includes('supabase')?supabase:orders);await mod.evaluate();
 return {api:mod.namespace,requests};
}
const legacy=claims=>['eyJhbGciOiJIUzI1NiJ9',Buffer.from(JSON.stringify(claims)).toString('base64url'),'testsignature'].join('.');
test('real SDK sends modern server key only as apikey when reading settings',async()=>{
 const h=await harness();const db=h.api.serviceDatabase();const cfg=await h.api.settings(db);
 assert.equal(cfg.enabled,false);assert.equal(h.requests.length,1);
 assert.equal(h.requests[0].headers.get('apikey'),'sb_secret_test-server');
 assert.equal(h.requests[0].headers.has('Authorization'),false);
});
test('legacy service-role keys retain their JWT Authorization header',async()=>{
 const key=legacy({role:'service_role',ref:'example'}),h=await harness({key});await h.api.settings(h.api.serviceDatabase());
 assert.equal(h.requests[0].headers.get('Authorization'),'Bearer '+key);assert.equal(h.requests[0].headers.get('apikey'),key);
});
test('wrong key types and copied masking are diagnosed before making a request',async()=>{
 for(const [key,pattern] of [['sb_publishable_example',/publishable key/],['shpss_wrong-provider',/not a Supabase server API key/],['JWT-signing-secret',/not a Supabase server API key/],['sb_secret_***masked***',/masking/],[legacy({role:'anon',ref:'example'}),/anonymous key/],[legacy({role:'authenticated',ref:'example'}),/login token/],[legacy({role:'service_role',ref:'different'}),/different Supabase project/]]){
  const h=await harness({key});assert.throws(()=>h.api.serviceDatabase(),pattern);assert.equal(h.requests.length,0);
 }
});
test('settings errors report safe role, HTTP status and database code without leaking error bodies',async()=>{
 for(const [status,code,message,expected] of [[401,'PGRST301','Invalid JWT with PRIVATE_PAYLOAD',/server credential/],[401,'PGRST301','JWT issued at future PRIVATE_PAYLOAD',/issued in the future/],[403,'42501','permission denied PRIVATE_PAYLOAD',/denied database access/],[406,'PGRST116','JSON object requested PRIVATE_PAYLOAD',/exactly one settings row/],[404,'PGRST205','PRIVATE_PAYLOAD',/API schema/]]){
  const h=await harness({response:()=>Response.json({code,message},{status})});
  await assert.rejects(()=>h.api.settings(h.api.serviceDatabase()),error=>{assert.match(error.message,expected);assert.match(error.message,new RegExp(code));assert.match(error.message,/server/);assert.doesNotMatch(error.message,/PRIVATE_PAYLOAD|sb_secret_test-server/);return true;});
 }
});
