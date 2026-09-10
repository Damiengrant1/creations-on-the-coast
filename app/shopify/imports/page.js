"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../../../lib/supabase";
const labels={imported:"Imported",needs_review:"Needs review",waiting_payment:"Awaiting payment",paused:"Queued",ignored:"Excluded"};
const when=(value)=>value?new Date(value).toLocaleString("en-GB",{timeZone:"Europe/London"}):"—";

export default function ShopifyImportsPage(){
  const [data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState(""),[reviewOnly,setReviewOnly]=useState(false);
  const pending=useRef(false),mounted=useRef(true);
  const request=useCallback(async(action,extra={})=>{
    const {data:sessionData,error:sessionError}=await supabase.auth.getSession();
    if(sessionError || !sessionData.session)throw new Error("Please sign in again.");
    const r=await fetch(`/api/shopify/imports${!action&&reviewOnly?"?review=1":""}`,{
      method:action?"POST":"GET",cache:"no-store",signal:AbortSignal.timeout(65000),
      headers:{Authorization:`Bearer ${sessionData.session.access_token}`,...(action?{"Content-Type":"application/json"}:{})},
      ...(action?{body:JSON.stringify({action,...extra})}:{}),
    });
    const body=await r.json().catch(()=>null);
    if(!r.ok || !body)throw new Error(body?.error||"The import request failed. Reload to check whether it completed.");
    return body;
  },[reviewOnly]);
  const reload=useCallback(async()=>{const result=await request();if(mounted.current)setData(result);},[request]);
  useEffect(()=>{mounted.current=true;reload().catch(e=>setError(e.message));return()=>{mounted.current=false;};},[reload]);
  async function run(action,extra={}){
    if(pending.current)return;
    pending.current=true;setBusy(true);setError("");setMessage("");
    try{
      if(action==="recover"){
        let cursor=null,count=0;
        do{
          const result=await request("recover",{cursor});
          count+=result.processed;cursor=result.nextCursor;
          if(mounted.current)setMessage(`Checked ${count} orders${cursor?"…":". No duplicate sales created."}`);
        }while(cursor && mounted.current);
      }else{
        const result=await request(action,extra);setMessage(result.message);
        if(action==="enable"){
          let cursor=null;
          do{const checked=await request("recover",{cursor});cursor=checked.nextCursor;}while(cursor && mounted.current);
          setMessage(`${result.message} The initial missed-order check is complete.`);
        }
      }
      await reload();
    }catch(e){setError(e.name==="TimeoutError"?"The request took too long. Reload to check its status before trying again.":e.message);await reload().catch(()=>{});}
    finally{pending.current=false;if(mounted.current)setBusy(false);}
  }
  const cfg=data?.settings,canEnable=data && data.missing.length===0 && data.production && data.accounts.length>0;
  return <main style={page}><div style={{maxWidth:1150,margin:"0 auto"}}>
    <Link href="/shopify" style={link}>← Back to Shopify</Link>
    <h1 style={{fontSize:34,marginBottom:8}}>Website sales</h1>
    <p style={muted}>Paid Shopify website orders, linked jobs and import checks.</p>
    {error&&<div role="alert" style={{...notice,background:"#fff1f2",color:"#991b1b"}}>{error}</div>}
    {message&&<div role="status" style={{...notice,background:"#edf9f0",color:"#166534"}}>{message}</div>}
    {!data?<p>Loading import settings…</p>:<>
      <section style={card}>
        <h2 style={{marginTop:0}}>Automatic imports: {cfg.enabled?"enabled":cfg.start_at?"paused":"not enabled"}</h2>
        <p style={muted}>Each eligible paid order creates one sale and one paid job. Your stock is reduced once, and the receipt goes into {data.accounts.find(a=>a.id===cfg.account_id)?.account_name||"Shopify Payments"}.</p>
        <p style={muted}>{cfg.start_at?<>Orders created from <strong>{when(cfg.start_at)} (UK time)</strong> are included. Earlier orders stay excluded.</>:<>Imports will start from the moment you enable them. Older orders will stay excluded so earlier sales and stocktakes are not counted again.</>}</p>
        {data.missing.length>0&&<div style={{...notice,background:"#fff8e8",color:"#714700"}}>
          <strong>One-time server setup</strong>
          <p>Add <strong>{data.missing.join(", ")}</strong> in Vercel → creations-on-the-coast → Settings → Environment Variables → Production, then redeploy.</p>
          {data.missing.includes("SUPABASE_SECRET_KEY")&&<p>For SUPABASE_SECRET_KEY, use the secret key from Supabase → Project Settings → API Keys → Secret keys. Keep it in Vercel; do not paste it into this page or the chat.</p>}
        </div>}
        {!data.production&&<p style={{color:"#991b1b"}}>Open the production dashboard to enable automatic imports.</p>}
        {!data.accounts.length&&<p style={{color:"#991b1b"}}>An active Shopify Payments account is required.</p>}
        <div style={buttons}>
          {cfg.enabled?<button disabled={busy} onClick={()=>run("pause")} style={secondary}>Pause imports</button>:<button disabled={busy||!canEnable} onClick={()=>run("enable")} style={{...button,opacity:busy||!canEnable?0.55:1}}>{busy?"Working…":cfg.start_at?"Resume automatic imports":"Enable new website sales"}</button>}
          <button disabled={busy||!cfg.enabled} onClick={()=>run("recover")} style={secondary}>Check missed orders</button>
          <button disabled={busy} onClick={()=>run()} style={secondary}>Reload status</button>
          <Link href="/shopify/products" style={{...link,padding:12}}>Match products</Link>
        </div>
        <p style={{...muted,fontSize:13}}>Last missed-order check: {when(cfg.last_sync_at)}. Shopify normally makes the last 60 days available to this app. Run this check after enabling or resuming imports.</p>
      </section>
      <section style={card}>
        <div style={{...buttons,justifyContent:"space-between"}}>
          <h2 style={{margin:0}}>Received orders</h2>
          <label><input type="checkbox" checked={reviewOnly} disabled={busy} onChange={e=>setReviewOnly(e.target.checked)}/> Needs review only</label>
        </div>
        <p style={muted}>Latest 100 matching orders. Unmatched clothing, non-clothing, other payment methods, refunds and order changes are held for review. Review messages explain what needs attention.</p>
        <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",minWidth:780}}>
          <thead><tr>{["Order","Placed (UK time)","Status","Details","Actions"].map(x=><th key={x} style={cell}>{x}</th>)}</tr></thead>
          <tbody>{data.orders.map(o=><tr key={o.order_id}>
            <td style={cell}><a href={`https://admin.shopify.com/store/ku1cvy-ue/orders/${o.order_id.split("/").pop()}`} target="_blank" rel="noreferrer" style={link}>{o.order_name}</a></td>
            <td style={cell}>{when(o.order_created_at)}</td>
            <td style={{...cell,color:o.status==="needs_review"?"#a33d00":o.status==="imported"?"#166534":"#444",fontWeight:700}}>{labels[o.status]||o.status}</td>
            <td style={{...cell,maxWidth:430}}>{o.detail}</td>
            <td style={cell}>{o.job_id?<Link href={`/jobs/edit/${o.job_id}`} style={link}>View job</Link>:!o.sale_id&&["needs_review","paused"].includes(o.status)?<button disabled={busy||!cfg.enabled} onClick={()=>run("retry",{orderId:o.order_id})} style={secondary}>Retry after matching</button>:"—"}</td>
          </tr>)}{!data.orders.length&&<tr><td colSpan={5} style={{...cell,color:"#666"}}>No orders received{reviewOnly?" needing review":" yet"}.</td></tr>}</tbody>
        </table></div>
      </section>
      <section style={card}>
        <h2 style={{marginTop:0}}>What gets recorded</h2>
        <p style={muted}>Sale prices include the customer’s actual discounts. Delivery charged to the customer is a separate non-stock sale line. Clothing costs use the blank cost plus production cost.</p>
        <p style={muted}>Jobs include the website item names, chosen sizes, personalisation and delivery details when Shopify supplies them. The sale is already linked, so the job cannot create a second sale.</p>
        <p style={muted}>Refunds, cancellations and changes to imported orders need reconciliation in the dashboard; they do not automatically reverse cash or stock. Shopify payout transfers and payment fees will be connected in the next stage.</p>
      </section>
    </>}
  </div></main>;
}
const page={minHeight:"100vh",background:"#f7f7f8",padding:"40px 22px",fontFamily:"Arial,sans-serif",color:"#111"};
const card={background:"white",borderRadius:16,padding:26,marginTop:22,boxShadow:"0 4px 18px rgba(0,0,0,.04)"};
const muted={color:"#555",lineHeight:1.65};
const notice={padding:18,borderRadius:10,margin:"16px 0",lineHeight:1.6};
const button={background:"#111",color:"white",padding:"13px 18px",border:0,borderRadius:9,fontSize:15,fontWeight:700,cursor:"pointer"};
const secondary={...button,background:"white",color:"#222",border:"1px solid #ccc"};
const buttons={display:"flex",flexWrap:"wrap",alignItems:"center",gap:12};
const link={color:"#111",fontWeight:700,textDecoration:"underline"};
const cell={textAlign:"left",padding:"15px 10px",borderBottom:"1px solid #eee",verticalAlign:"top",lineHeight:1.5};
