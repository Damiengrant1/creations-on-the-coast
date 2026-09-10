"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { supabase } from "../../lib/supabase";

const permissionNames = {
  read_orders: "Website orders",
  read_products: "Products and variants",
  read_shopify_payments_payouts: "Shopify Payments payouts and fees",
};

export default function ShopifyPage() {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const pending = useRef(false);

  async function checkConnection() {
    if (pending.current) return;
    pending.current = true;
    setChecking(true);
    setResult(null);
    setError("");

    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !data.session?.access_token) {
        throw new Error("Please sign in again before checking Shopify.");
      }
      const response = await fetch("/api/shopify/connection", {
        method: "POST",
        headers: { Authorization: `Bearer ${data.session.access_token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(55000),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || "The connection check failed. Please try again.");
      if (!body?.connected || !Array.isArray(body.permissions) || !body.shop) {
        throw new Error("The connection check returned an incomplete result. Please try again.");
      }
      setResult(body);
    } catch (cause) {
      setError(cause?.name === "TimeoutError"
        ? "The connection check took too long. Please try again."
        : cause.message || "The connection check failed. Please try again.");
    } finally {
      pending.current = false;
      setChecking(false);
    }
  }

  return (
    <main style={pageStyle}>
      <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
        <Link href="/" style={{ color: "#444", textDecoration: "none", fontWeight: 700 }}>
          ← Back to Dashboard
        </Link>
        <h1 style={{ fontSize: "36px", margin: "24px 0 8px" }}>Shopify</h1>
        <p style={{ color: "#666", margin: "0 0 28px", lineHeight: 1.6 }}>
          Connect website orders and Shopify Payments to Creations on the Coast.
        </p>

        <section style={cardStyle} aria-labelledby="connection-heading">
          <div style={{ display: "flex", flexWrap: "wrap", gap: "20px", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <h2 id="connection-heading" style={{ fontSize: "22px", margin: "0 0 8px" }}>Store connection</h2>
              <p style={{ margin: 0, color: "#666", lineHeight: 1.6 }}>
                Check that this dashboard can access your Shopify store.
              </p>
            </div>
            <button type="button" onClick={checkConnection} disabled={checking}
              style={{ ...buttonStyle, opacity: checking ? 0.65 : 1, cursor: checking ? "wait" : "pointer" }}>
              {checking ? "Checking…" : result ? "Check again" : "Check connection"}
            </button>
          </div>

          <div aria-live="polite" aria-busy={checking}>
            {checking && <p style={{ color: "#666", marginTop: "22px" }}>Checking your admin access and Shopify connection…</p>}
            {error && <div role="alert" style={{ ...noticeStyle, background: "#fff0f0", color: "#9b1c1c", borderColor: "#f1c1c1" }}>{error}</div>}
            {result && (
              <>
                <div style={{ ...noticeStyle, background: "#effaf1", color: "#166534", borderColor: "#c6e5cd" }}>
                  <strong>Connected to {result.shop.name}</strong>
                  <div style={{ marginTop: "5px", fontWeight: 400 }}>Connection checked successfully.</div>
                </div>
                <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "18px", margin: "24px 0" }}>
                  <Detail title="Store address" value={result.shop.domain} />
                  <Detail title="Currency" value={result.shop.currency} />
                  <Detail title="Time zone" value={result.shop.timezone} />
                </dl>
                <h3 style={{ fontSize: "17px", marginBottom: "10px" }}>Access permissions</h3>
                {result.permissions.map(({ scope, granted }) => (
                  <div key={scope} style={{ display: "flex", flexWrap: "wrap", gap: "12px", justifyContent: "space-between", padding: "13px 0", borderBottom: "1px solid #eee" }}>
                    <span>{permissionNames[scope] || scope}</span>
                    <strong style={{ color: granted ? "#166534" : "#9b1c1c" }}>{granted ? "Granted" : "Missing"}</strong>
                  </div>
                ))}
                {!result.permissionsReady && (
                  <p style={{ color: "#9b1c1c", lineHeight: 1.6 }}>
                    Add the missing permissions to your app in Shopify&apos;s Dev Dashboard, release the updated version,
                    approve the permissions on your store, then check again.
                  </p>
                )}
                <p style={{ fontSize: "13px", color: "#666", marginBottom: 0 }}>
                  Last checked: {new Date(result.checkedAt).toLocaleString("en-GB", { timeZone: "Europe/London" })} (UK time)
                </p>
              </>
            )}
          </div>
        </section>

        <section style={{ ...cardStyle, marginTop: "22px" }} aria-labelledby="imports-heading">
          <h2 id="imports-heading" style={{ fontSize: "22px", margin: "0 0 10px" }}>Automatic imports: not enabled yet</h2>
          <p style={{ margin: "0 0 12px", color: "#555", lineHeight: 1.7 }}>
            This connection check does not import orders or change sales, jobs, stock, or account balances.
          </p>
          <p style={{ margin: 0, color: "#555", lineHeight: 1.7 }}>
            Match website products to your stock items, then we will choose the first date to import,
            so sales already recorded in this dashboard are not entered twice.
          </p>
          <Link href="/shopify/products" style={{ ...buttonStyle, display: "inline-block", marginTop: "20px", textDecoration: "none" }}>
            Product matching
          </Link>
        </section>
      </div>
    </main>
  );
}

function Detail({ title, value }) {
  return (
    <div>
      <dt style={{ color: "#666", fontSize: "13px", marginBottom: "7px" }}>{title}</dt>
      <dd style={{ margin: 0, fontWeight: 700, overflowWrap: "anywhere" }}>{value}</dd>
    </div>
  );
}

const pageStyle = { minHeight: "100vh", background: "#f7f7f8", padding: "50px 20px", fontFamily: "Arial, sans-serif", color: "#111" };
const cardStyle = { background: "#fff", padding: "26px", borderRadius: "14px", boxShadow: "0 2px 10px rgba(0,0,0,0.06)" };
const buttonStyle = { border: 0, borderRadius: "9px", padding: "14px 22px", background: "#111", color: "#fff", fontWeight: 700, fontSize: "16px" };
const noticeStyle = { marginTop: "24px", padding: "16px", borderRadius: "9px", border: "1px solid", lineHeight: 1.6 };
