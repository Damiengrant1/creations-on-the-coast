import { createClient } from "@supabase/supabase-js";
import { SHOP_DOMAIN } from "./orders";

export class ImportError extends Error {
  constructor(message, status = 503) { super(message); this.status = status; }
}
export function reply(body, status = 200) {
  return Response.json(body, {status, headers:{"Cache-Control":"private, no-store, max-age=0", Vary:"Authorization"}});
}
function client(key, bearer, timeout = 8000) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !key) throw new ImportError("The server database configuration is missing.");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, {
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{...(bearer ? {headers:{Authorization:bearer}} : {}),
      fetch:(url,options)=>fetch(url,{...options,cache:"no-store",signal:AbortSignal.timeout(timeout)})},
  });
}
export async function requireAdmin(request) {
  const bearer = request.headers.get("authorization") || "";
  const match = /^Bearer ([^\s]+)$/i.exec(bearer);
  if (!match) throw new ImportError("Please sign in to manage Shopify imports.",401);
  const db = client(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, bearer);
  const {data,error} = await db.auth.getUser(match[1]);
  if (error || !data?.user) throw new ImportError("Please sign in again; your session could not be verified.",401);
  const result = await db.from("app_users").select("role,active").eq("user_id",data.user.id).maybeSingle();
  if (result.error) throw new ImportError("Could not verify your admin access.");
  if (!result.data?.active || result.data.role!=="admin") throw new ImportError("An approved admin account is required.",403);
  return db;
}
export function serviceDatabase(timeout=8000) {
  const key=process.env.SUPABASE_SECRET_KEY?.trim();
  if (!key) throw new ImportError("Add SUPABASE_SECRET_KEY to the Production environment in Vercel, then redeploy. Use your Supabase server secret key, never a NEXT_PUBLIC variable.");
  return client(key,null,timeout);
}
export function productionBase() {
  if (process.env.VERCEL_ENV !== "production") throw new ImportError("Enable imports from the production dashboard.",409);
  const hostname=process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (!hostname || !/^[a-zA-Z0-9.-]+$/.test(hostname)) throw new ImportError("Vercel's production domain setting is missing. Enable system environment variables and redeploy.");
  return `https://${hostname}`;
}
export async function settings(db) {
  const r=await db.from("shopify_import_settings").select("*").eq("shop_domain",SHOP_DOMAIN).single();
  if (r.error) throw new ImportError("Could not read the Shopify import settings. Check the database setup and server key.");
  return r.data;
}
let tokenCache=null, pending=null;
async function shopFetch(path,options) {
  try {return await fetch(`https://${SHOP_DOMAIN}${path}`,{...options,cache:"no-store",redirect:"error",signal:AbortSignal.timeout(8000)});}
  catch {throw new ImportError("Shopify could not be reached. Please try again.");}
}
async function token() {
  if (tokenCache?.expires>Date.now())return tokenCache.value;
  if (!pending) pending=(async()=>{
    const clientId=process.env.SHOPIFY_CLIENT_ID?.trim(),secret=process.env.SHOPIFY_CLIENT_SECRET?.trim();
    if (!clientId || !secret)throw new ImportError("SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET must be configured in Vercel.");
    const r=await shopFetch("/admin/oauth/access_token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"client_credentials",client_id:clientId,client_secret:secret})});
    const data=await r.json().catch(()=>null);
    if (!r.ok || typeof data?.access_token!=="string" || !Number.isFinite(data.expires_in) || data.expires_in<=60)throw new ImportError("Shopify could not authorise the app. Check the existing app credentials and installation.");
    tokenCache={value:data.access_token,expires:Date.now()+(data.expires_in-60)*1000};return tokenCache.value;
  })().finally(()=>{pending=null;});
  return pending;
}
export async function graphql(query,variables={}) {
  const send=async()=>shopFetch("/admin/api/2026-07/graphql.json",{method:"POST",headers:{"Content-Type":"application/json","X-Shopify-Access-Token":await token()},body:JSON.stringify({query,variables})});
  let r=await send();
  if(r.status===401){tokenCache=null;r=await send();}
  if(!r.ok)throw new ImportError(`Shopify returned HTTP ${r.status}. Check the app permissions or try again shortly.`);
  const payload=await r.json().catch(()=>null);
  if (payload?.errors?.length) {
    const denied=payload.errors.some(x=>x.extensions?.code==="ACCESS_DENIED");
    throw new ImportError(denied?"Shopify denied access. Check read_orders permissions and customer-data access for this app.":"Shopify could not complete the request. Please retry; check app logs if this continues.");
  }
  if(!payload?.data)throw new ImportError("Shopify returned an incomplete response.");
  return payload.data;
}
export const CHECK_STORE = `query DashboardImportShop { shop { id myshopifyDomain currencyCode } }`;
export async function verifyStore() {
  const {shop}=await graphql(CHECK_STORE);
  if(shop?.id!=="gid://shopify/Shop/95483199837" || shop.myshopifyDomain!==SHOP_DOMAIN || shop.currencyCode!=="GBP")throw new ImportError("This app must connect to the Creations on the Coast GBP store.",409);
}
