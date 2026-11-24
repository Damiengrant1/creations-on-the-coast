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
        <Link href="/" style={{ color: "var(--text-2)", textDecoration: "none", fontWeight: 700 }}>
          ← Home
        </Link>
        <h1 style={{ fontSize: "36px", margin: "24px 0 8px" }}>Shopify</h1>
        <p style={{ color: "var(--muted)", margin: "0 0 28px", lineHeight: 1.6 }}>
          Connect website orders and Shopify Payments to Creations on the Coast.
        </p>

        <section style={cardStyle} aria-labelledby="connection-heading">
          <div style={{ display: "flex", flexWrap: "wrap", gap: "20px", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <h2 id="connection-heading" style={{ fontSize: "22px", margin: "0 0 8px" }}>Store connection</h2>
              <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6 }}>
                Check that this dashboard can access your Shopify store.
              </p>
            </div>
            <button type="button" onClick={checkConnection} disabled={checking}
              style={{ ...buttonStyle, opacity: checking ? 0.65 : 1, cursor: checking ? "wait" : "pointer" }}>
              {checking ? "Checking…" : result ? "Check again" : "Check connection"}
            </button>
          </div>

          <div aria-live="polite" aria-busy={checking}>
            {checking && <p style={{ color: "var(--muted)", marginTop: "22px" }}>Checking your admin access and Shopify connection…</p>}
            {error && <div role="alert" style={{ ...noticeStyle, background: "var(--coral-soft)", color: "#9b2c17", borderColor: "#f1c1c1" }}>{error}</div>}
            {result && (
              <>
                <div style={{ ...noticeStyle, background: "#effaf1", color: "var(--leaf)", borderColor: "#c6e5cd" }}>
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
                  <div key={scope} style={{ display: "flex", flexWrap: "wrap", gap: "12px", justifyContent: "space-between", padding: "13px 0", borderBottom: "1px solid var(--line)" }}>
                    <span>{permissionNames[scope] || scope}</span>
                    <strong style={{ color: granted ? "var(--leaf)" : "#9b2c17" }}>{granted ? "Granted" : "Missing"}</strong>
                  </div>
                ))}
                {!result.permissionsReady && (
                  <p style={{ color: "#9b2c17", lineHeight: 1.6 }}>
                    Add the missing permissions to your app in Shopify&apos;s Dev Dashboard, release the updated version,
                    approve the permissions on your store, then check again.
                  </p>
                )}
                <p style={{ fontSize: "13px", color: "var(--muted)", marginBottom: 0 }}>
                  Last checked: {new Date(result.checkedAt).toLocaleString("en-GB", { timeZone: "Europe/London" })} (UK time)
                </p>
              </>
            )}
          </div>
        </section>

        <section style={{ ...cardStyle, marginTop: "22px" }} aria-labelledby="imports-heading">
          <h2 id="imports-heading" style={{ fontSize: "22px", margin: "0 0 10px" }}>Website sales and jobs</h2>
          <p style={{ color: "var(--muted)", lineHeight: 1.7 }}>Manage automatic paid-order imports, product matching and orders needing review.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "16px" }}>
            <Link href="/shopify/imports" style={{ ...buttonStyle, textDecoration: "none" }}>Automatic imports</Link>
            <Link href="/shopify/products" style={{ ...buttonStyle, textDecoration: "none" }}>Product matching</Link>
          </div>
        </section>

        <section style={{ ...cardStyle, marginTop: "22px" }} aria-labelledby="payouts-heading">
          <h2 id="payouts-heading" style={{ fontSize: "22px", margin: "0 0 10px" }}>Shopify Payments payouts</h2>
          <p style={{ color: "var(--muted)", lineHeight: 1.7 }}>Track cleared Shopify payouts to your bank and record Shopify payment fees automatically.</p>
          <Link href="/shopify/payouts" style={{ ...buttonStyle, textDecoration: "none" }}>Payouts and fees</Link>
        </section>
      </div>
    </main>
  );
}

function Detail({ title, value }) {
  return (
    <div>
      <dt style={{ color: "var(--muted)", fontSize: "13px", marginBottom: "7px" }}>{title}</dt>
      <dd style={{ margin: 0, fontWeight: 700, overflowWrap: "anywhere" }}>{value}</dd>
    </div>
  );
}

const pageStyle = { minHeight: "100vh", background: "var(--sand)", padding: "50px 20px", fontFamily: "var(--font)", color: "var(--ink)" };
const cardStyle = { background: "#fff", padding: "26px", borderRadius: "14px", boxShadow: "var(--shadow)" };
const buttonStyle = { border: 0, borderRadius: "9px", padding: "14px 22px", background: "var(--ink)", color: "#fff", fontWeight: 700, fontSize: "16px" };
const noticeStyle = { marginTop: "24px", padding: "16px", borderRadius: "9px", border: "1px solid", lineHeight: 1.6 };
