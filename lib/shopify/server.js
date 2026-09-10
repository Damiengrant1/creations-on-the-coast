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
      fetch:(url,options)=>{
        const headers=new Headers(options?.headers);
        // Modern server keys belong in apikey. Do not present them as session JWTs.
        // Preserve the signed-in user's JWT and legacy service-role JWT unchanged.
        if(!bearer && key.startsWith("sb_secret_") && headers.get("Authorization")===`Bearer ${key}`){
          headers.delete("Authorization");
        }
        return fetch(url,{...options,headers,cache:"no-store",signal:AbortSignal.timeout(timeout)});
      }},
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
const serviceClients=new WeakSet();
function checkedServerKey() {
  const key=process.env.SUPABASE_SECRET_KEY?.trim();
  if(!key)throw new ImportError("Add SUPABASE_SECRET_KEY to the Production environment in Vercel, then redeploy. Use your Supabase server secret key, never a NEXT_PUBLIC variable.");
  if(key.startsWith("sb_publishable_"))throw new ImportError("SUPABASE_SECRET_KEY contains a publishable key. In Vercel, replace its Value with the secret API key beginning sb_secret_ from this Supabase project's Settings → API Keys → Secret keys, then redeploy.",409);
  if(key.startsWith("sb_secret_")){
    if(!/^sb_secret_[A-Za-z0-9_-]+$/.test(key))throw new ImportError("SUPABASE_SECRET_KEY is incomplete or contains copied spaces, quotes or masking characters. Copy the full secret API key into its Vercel Value and redeploy.",409);
    return key;
  }
  // Inspect legacy key metadata for helpful diagnostics only. Supabase still verifies
  // its signature and permissions; decoded claims never authorise a user here.
  if(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)){
    let claims;
    try{claims=JSON.parse(Buffer.from(key.split(".")[1],"base64url").toString("utf8"));}catch{claims=null;}
    if(claims?.role==="anon")throw new ImportError("SUPABASE_SECRET_KEY contains the legacy anonymous key. Use this Supabase project's secret API key beginning sb_secret_ instead, then redeploy.",409);
    if(claims?.role!=="service_role")throw new ImportError("SUPABASE_SECRET_KEY contains a login token rather than a server API key. Use the secret API key beginning sb_secret_ from Supabase Settings → API Keys.",409);
    const expectedRef=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
    if(claims.ref && claims.ref!==expectedRef)throw new ImportError("SUPABASE_SECRET_KEY belongs to a different Supabase project. Use the key from the Creations on the Coast project.",409);
    return key;
  }
  throw new ImportError("SUPABASE_SECRET_KEY is not a Supabase server API key. Its Value must be the secret API key beginning sb_secret_ from Supabase Settings → API Keys → Secret keys, not the Shopify secret, database password or JWT signing secret.",409);
}
export function serviceDatabase(timeout=8000) {
  const db=client(checkedServerKey(),null,timeout);
  serviceClients.add(db);
  return db;
}
export function productionBase() {
  if (process.env.VERCEL_ENV !== "production") throw new ImportError("Enable imports from the production dashboard.",409);
  const hostname=process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (!hostname || !/^[a-zA-Z0-9.-]+$/.test(hostname)) throw new ImportError("Vercel's production domain setting is missing. Enable system environment variables and redeploy.");
  return `https://${hostname}`;
}
export async function settings(db) {
  const r=await db.from("shopify_import_settings").select("*").eq("shop_domain",SHOP_DOMAIN).single();
  if(r.error){
    const server=serviceClients.has(db);
    const code=typeof r.error.code==="string" && /^(PGRST[0-9]{3}|[0-9A-Z]{5})$/.test(r.error.code)?r.error.code:"";
    const http=Number.isInteger(r.status) && r.status>=400 && r.status<=599?r.status:null;
    const detail=[code,http&&`HTTP ${http}`].filter(Boolean).join("; ");
    const context=server?"server":"signed-in admin";
    const message=String(r.error.message||"");
    let reason;
    if(/issued at future|not yet valid/i.test(message))reason="Supabase rejected a token as issued in the future. The settings table exists; this is a token timing error.";
    else if(http===401 || ["PGRST301","PGRST302","PGRST303"].includes(code))reason=server?"Supabase rejected the server credential. Check that the Vercel SUPABASE_SECRET_KEY is an active secret API key from this Supabase project.":"Supabase rejected your sign-in token. Please sign in again.";
    else if(code==="42501" || http===403)reason=server?"The server request was denied database access. The service_role grant is required; do not add anonymous access.":"Your signed-in account was denied access to the import settings.";
    else if(code==="PGRST116")reason="The request could not see exactly one settings row. Check the connected project and the request's database role.";
    else if(["42P01","PGRST205"].includes(code))reason="The import settings table is unavailable in the connected project's API schema.";
    else if(!http && /fetch|network|timeout|abort/i.test(message))reason="The server could not reach Supabase or the database request timed out.";
    else reason="Supabase could not complete the settings read.";
    // Error bodies can contain URLs, headers or keys: return only classified text
    // and allowlisted error codes, never the raw upstream message or credentials.
    throw new ImportError(`${reason} [${context}${detail?`; ${detail}`:""}]`,409);
  }
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

export async function shopifyRest(path) {
  const send = async () =>
    shopFetch(`/admin/api/2026-07${path}`, {
      headers: { "X-Shopify-Access-Token": await token() },
    });

  let response = await send();
  if (response.status === 401) {
    tokenCache = null;
    response = await send();
  }

  if (!response.ok) {
    if (response.status === 403) {
      throw new ImportError(
        "Shopify denied access to Shopify Payments payouts. Check the payouts permission in the Shopify app."
      );
    }
    throw new ImportError(
      `Shopify returned HTTP ${response.status}. Please retry shortly.`
    );
  }

  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    throw new ImportError("Shopify returned an incomplete payout response.");
  }
  return payload;
}
export const CHECK_STORE = `query DashboardImportShop { shop { id myshopifyDomain currencyCode } }`;
export async function verifyStore() {
  const {shop}=await graphql(CHECK_STORE);
  if(shop?.id!=="gid://shopify/Shop/95483199837" || shop.myshopifyDomain!==SHOP_DOMAIN || shop.currencyCode!=="GBP")throw new ImportError("This app must connect to the Creations on the Coast GBP store.",409);
}
