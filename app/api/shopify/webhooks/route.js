import { ORDER_TOPICS, SHOP_DOMAIN, normalizeOrder, validSignature } from "../../../../lib/shopify/orders";
import { serviceDatabase } from "../../../../lib/shopify/server";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=60;

// Public readiness probe: no credentials or business data are returned.
export async function GET() {
  try {
    if(!process.env.SHOPIFY_CLIENT_SECRET)throw new Error("missing");
    const db=serviceDatabase(3500);
    const {data,error}=await db.from("shopify_import_settings").select("shop_domain").eq("shop_domain",SHOP_DOMAIN).single();
    if(error || !data)throw new Error("database");
    return Response.json({service:"creations-shopify-orders",ready:true},{headers:{"Cache-Control":"no-store"}});
  }catch{return Response.json({ready:false},{status:503,headers:{"Cache-Control":"no-store"}});}
}
export async function POST(request) {
  if(request.headers.get("x-shopify-shop-domain")!==SHOP_DOMAIN)return new Response("Invalid shop",{status:401});
  const topic=request.headers.get("x-shopify-topic");
  if(!ORDER_TOPICS.has(topic))return new Response("Unsupported topic",{status:400});
  if(!process.env.SHOPIFY_CLIENT_SECRET)return new Response("Not configured",{status:503});
  const event=request.headers.get("x-shopify-webhook-id");
  if(!event || !/^[A-Za-z0-9-]{1,100}$/.test(event))return new Response("Missing delivery identifier",{status:400});
  try {
    const reader=request.body?.getReader();
    if(!reader)return new Response("Missing body",{status:400});
    const chunks=[];let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2*1024*1024){await reader.cancel();return new Response("Payload too large",{status:413});}chunks.push(Buffer.from(value));}
    const body=Buffer.concat(chunks);
    if(!validSignature(body,request.headers.get("x-shopify-hmac-sha256"),process.env.SHOPIFY_CLIENT_SECRET.trim()))return new Response("Invalid signature",{status:401});
    let order;
    try {order=normalizeOrder(JSON.parse(body.toString("utf8")));}
    catch {return new Response("Invalid order payload",{status:400});}
    const {error}=await serviceDatabase(4000).rpc("receive_shopify_order",{p_event_id:`webhook:${event}`,p_order:order});
    // A retry after a timeout is safe: the database deduplicates delivery AND order IDs.
    if(error)return new Response("Could not save order; please retry",{status:503});
    return new Response("Saved",{status:200});
  }catch{return new Response("Temporarily unavailable",{status:503});}
}
