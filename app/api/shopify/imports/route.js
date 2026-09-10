import { randomUUID } from "node:crypto";
import { SHOP_DOMAIN, normalizeOrder } from "../../../../lib/shopify/orders";
import { CREATE_WEBHOOK, LIST_WEBHOOKS, RECOVER_ORDERS, WEBHOOK_TOPICS } from "../../../../lib/shopify/queries";
import { ImportError, graphql, productionBase, reply, requireAdmin, serviceDatabase, settings, verifyStore } from "../../../../lib/shopify/server";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=60;
const fail=(e)=>reply({error:e instanceof ImportError?e.message:"The Shopify import request could not be completed. Please try again."},e instanceof ImportError?e.status:503);

export async function GET(request) {
  try {
    const db=await requireAdmin(request);
    const cfg=await settings(db);
    let ordersQuery=db.from("shopify_order_imports").select("order_id,order_name,order_created_at,status,detail,sale_id,job_id,received_at").order("received_at",{ascending:false}).limit(100);
    if(new URL(request.url).searchParams.get("review")==="1")ordersQuery=ordersQuery.eq("status","needs_review");
    const [{data:orders,error},{data:accounts,error:accountError}]=await Promise.all([
      ordersQuery,
      db.from("accounts").select("id,account_name").eq("account_type","shopify").eq("active",true),
    ]);
    if(error || accountError)throw new ImportError("Could not load the import history or Shopify Payments account.");
    const missing=[];
    if(!process.env.SUPABASE_SECRET_KEY?.trim())missing.push("SUPABASE_SECRET_KEY");
    if(!process.env.SHOPIFY_CLIENT_SECRET?.trim())missing.push("SHOPIFY_CLIENT_SECRET");
    if(!process.env.SHOPIFY_CLIENT_ID?.trim())missing.push("SHOPIFY_CLIENT_ID");
    return reply({settings:cfg,orders:orders||[],accounts:accounts||[],missing,production:process.env.VERCEL_ENV==="production"});
  }catch(e){return fail(e);}
}
async function updateSettings(db,values) {
  const {error}=await db.from("shopify_import_settings").update({...values,updated_at:new Date().toISOString()}).eq("shop_domain",SHOP_DOMAIN);
  if(error)throw new ImportError("Could not save the import settings. Please reload and try again.");
}
export async function POST(request) {
  try {
    await requireAdmin(request);
    const input=await request.json().catch(()=>null);
    if(!input || !["enable","pause","recover","retry"].includes(input.action))throw new ImportError("Unknown import action.",400);
    const db=serviceDatabase();
    let cfg=await settings(db);
    if(input.action==="pause") {
      await updateSettings(db,{enabled:false});
      return reply({message:"Imports paused. Incoming orders will remain queued."});
    }
    if(input.action==="enable") {
      const base=productionBase(),uri=`${base}/api/shopify/webhooks`;
      let probe;
      try {const r=await fetch(uri,{cache:"no-store",redirect:"error",signal:AbortSignal.timeout(10000)});probe=r.ok?await r.json():null;}catch{probe=null;}
      if(probe?.service!=="creations-shopify-orders" || probe.ready!==true)throw new ImportError("The production webhook is not reachable. Check that the production dashboard has been redeployed with the server key and is accessible without Vercel deployment protection.",409);
      await verifyStore();
      const subscriptions=[];let after=null;
      do {
        const page=(await graphql(LIST_WEBHOOKS,{uri,after})).webhookSubscriptions;
        if(!page?.nodes || !page.pageInfo)throw new ImportError("Could not check existing Shopify notifications.");
        subscriptions.push(...page.nodes);after=page.pageInfo.hasNextPage?page.pageInfo.endCursor:null;
        if(subscriptions.length>300)throw new ImportError("Too many existing notifications; review the app configuration.");
      }while(after);
      for(const topic of WEBHOOK_TOPICS) {
        if(subscriptions.some(s=>s.topic===topic && s.uri===uri))continue;
        const result=(await graphql(CREATE_WEBHOOK,{topic,input:{uri,format:"JSON"}})).webhookSubscriptionCreate;
        if(result?.userErrors?.length || !result?.webhookSubscription)throw new ImportError("Shopify could not register all order notifications. Check the app's order permissions, then retry; existing subscriptions will be reused.",409);
        subscriptions.push(result.webhookSubscription);
      }
      const activated=await db.rpc("activate_shopify_imports",{p_url:uri,p_subscriptions:subscriptions});
      if(activated.error)throw new ImportError("Could not enable imports. Check the active Shopify Payments account and retry; notifications already registered will be reused.");
      cfg=await settings(db);
      return reply({message:"Automatic imports enabled. New paid website orders will create a sale and linked job.",startAt:cfg.start_at});
    }
    if(!cfg.enabled || !cfg.start_at)throw new ImportError("Enable imports before processing queued orders.",409);
    if(input.action==="retry") {
      if(typeof input.orderId!=="string" || !/^gid:\/\/shopify\/Order\/[0-9]+$/.test(input.orderId))throw new ImportError("Invalid order identifier.",400);
      const found=await db.from("shopify_order_imports").select("order_data,sale_id").eq("order_id",input.orderId).single();
      if(found.error || !found.data)throw new ImportError("The saved order could not be found.",404);
      if(found.data.sale_id)throw new ImportError("This order already has a sale. Reconcile any changes against that sale; it will not be imported twice.",409);
      const r=await db.rpc("receive_shopify_order",{p_event_id:`retry:${randomUUID()}`,p_order:found.data.order_data,p_retry:true});
      if(r.error)throw new ImportError("The saved order could not be processed. Please retry.");
      return reply({message:r.data?.status==="imported"?"Sale and job imported successfully.":"Order checked. See its review message below."});
    }
    // Recover missed webhooks without importing any orders before the initial start.
    // Bounded pages keep requests within Vercel limits; the UI follows every cursor.
    if(input.cursor!==undefined && input.cursor!==null && (typeof input.cursor!=="string" || input.cursor.length>1000))throw new ImportError("Invalid page cursor.",400);
    const start=new Date(cfg.start_at).toISOString();
    const page=(await graphql(RECOVER_ORDERS,{query:`created_at:>='${start}' source_name:web`,after:input.cursor||null})).orders;
    if(!page?.nodes || !page.pageInfo)throw new ImportError("Shopify returned an incomplete order list.");
    for(const source of page.nodes) {
      const order=normalizeOrder(source,"graphql");
      const r=await db.rpc("receive_shopify_order",{p_event_id:`recover:${randomUUID()}`,p_order:order,p_retry:true});
      if(r.error)throw new ImportError("An order could not be saved. Run Check missed orders again; previously saved orders will not duplicate.");
    }
    const nextCursor=page.pageInfo.hasNextPage?page.pageInfo.endCursor:null;
    if(!nextCursor)await updateSettings(db,{last_sync_at:new Date().toISOString()});
    return reply({processed:page.nodes.length,nextCursor,message:nextCursor?"Checking more orders…":"Missed-order check complete."});
  }catch(e){return fail(e);}
}
