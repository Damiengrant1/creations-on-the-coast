"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../../../lib/supabase";

const money = (value) => `£${Number(value || 0).toFixed(2)}`;
const when = (value) =>
  value
    ? new Date(value).toLocaleString("en-GB", { timeZone: "Europe/London" })
    : "—";

export default function ShopifyPayoutsPage() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const pending = useRef(false);

  const request = useCallback(async (action) => {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !sessionData.session) throw new Error("Please sign in again.");

    const response = await fetch("/api/shopify/payouts", {
      method: action ? "POST" : "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(65000),
      headers: {
        Authorization: `Bearer ${sessionData.session.access_token}`,
        ...(action ? { "Content-Type": "application/json" } : {}),
      },
      ...(action ? { body: JSON.stringify({ action }) } : {}),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body) throw new Error(body?.error || "The payout request failed. Please reload and try again.");
    return body;
  }, []);

  const reload = useCallback(async () => {
    const result = await request();
    setData(result);
  }, [request]);

  useEffect(() => {
    reload().catch((cause) => setError(cause.message));
  }, [reload]);

  async function run(action) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await request(action);
      setMessage(result.message || "Payout settings saved.");
      await reload();
    } catch (cause) {
      setError(cause.name === "TimeoutError" ? "The payout request took too long. Reload to check its status before trying again." : cause.message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  const cfg = data?.settings;
  const accounts = data?.accounts;

  return (
    <main style={pageStyle}>
      <div style={{ maxWidth: "1150px", margin: "0 auto" }}>
        <Link href="/shopify" style={linkStyle}>← Back to Shopify</Link>
        <h1 style={{ fontSize: "36px", margin: "24px 0 8px" }}>Shopify Payments Payouts</h1>
        <p style={mutedStyle}>Move cleared Shopify Payments payouts into your bank automatically, with payment fees recorded separately.</p>

        {error && <div role="alert" style={{ ...noticeStyle, background: "#fff1f2", color: "#991b1b" }}>{error}</div>}
        {message && <div role="status" style={{ ...noticeStyle, background: "#edf9f0", color: "#166534" }}>{message}</div>}

        {!data ? (
          <p>Loading payout settings…</p>
        ) : (
          <>
            <section style={cardStyle}>
              <h2 style={{ marginTop: 0 }}>Automatic payout tracking: {cfg.payouts_enabled ? "enabled" : "not enabled"}</h2>
              <p style={mutedStyle}>
                A cleared payout creates an account transfer from <strong>{accounts.shopify.account_name}</strong> to <strong>{accounts.bank.account_name}</strong>. Any Shopify fee is recorded as a Card Fees expense from Shopify Payments.
              </p>
              {cfg.payouts_enabled ? (
                <>
                  <p style={mutedStyle}>Payouts paid from <strong>{when(cfg.payout_start_at)} (UK time)</strong> are eligible. Earlier payouts remain excluded so your starting balances are not changed.</p>
                  <div style={buttonRowStyle}>
                    <button type="button" disabled={busy} onClick={() => run("sync")} style={{ ...buttonStyle, opacity: busy ? 0.6 : 1 }}>
                      {busy ? "Checking…" : "Check payouts now"}
                    </button>
                    <button type="button" disabled={busy} onClick={reload} style={secondaryButtonStyle}>Reload status</button>
                  </div>
                  <p style={{ ...mutedStyle, fontSize: "13px", marginBottom: 0 }}>Last payout check: {when(cfg.payout_last_sync_at)}. Automatic daily checks are enabled once the Vercel cron secret is added.</p>
                </>
              ) : (
                <>
                  <p style={mutedStyle}>Payouts before you enable this will not be imported. This protects the opening bank and Shopify balances you have already set.</p>
                  <button type="button" disabled={busy} onClick={() => run("enable")} style={{ ...buttonStyle, opacity: busy ? 0.6 : 1 }}>
                    {busy ? "Enabling…" : "Enable future Shopify payouts"}
                  </button>
                </>
              )}
            </section>

            <section style={cardStyle}>
              <h2 style={{ marginTop: 0 }}>How each payout is recorded</h2>
              <div style={flowStyle}>
                <div><strong>Shopify Payments</strong><br /><span style={mutedStyle}>Gross payout less the fee</span></div>
                <div style={arrowStyle}>→</div>
                <div><strong>{accounts.bank.account_name}</strong><br /><span style={mutedStyle}>Net amount that cleared</span></div>
                <div style={arrowStyle}>+</div>
                <div><strong>Card Fees expense</strong><br /><span style={mutedStyle}>Shopify payment fee</span></div>
              </div>
            </section>

            <section style={cardStyle}>
              <h2 style={{ marginTop: 0 }}>Payout history</h2>
              <p style={mutedStyle}>Payouts with refunds, adjustments, non-GBP currency or unexpected balance movements are held for review instead of being posted automatically.</p>
              <div style={{ overflowX: "auto" }}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      {['Payout date', 'Gross', 'Fee', 'To bank', 'Status', 'Details'].map((heading) => <th key={heading} style={cellStyle}>{heading}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {data.payouts.map((payout) => (
                      <tr key={payout.payout_id}>
                        <td style={cellStyle}>{when(payout.payout_date)}</td>
                        <td style={cellStyle}>{payout.gross_amount === null ? "—" : money(payout.gross_amount)}</td>
                        <td style={cellStyle}>{payout.fee_amount === null ? "—" : money(payout.fee_amount)}</td>
                        <td style={cellStyle}><strong>{money(payout.net_amount)}</strong></td>
                        <td style={{ ...cellStyle, color: payout.status === "imported" ? "#166534" : "#9a5a00", fontWeight: 700 }}>
                          {payout.status === "imported" ? "Imported" : "Needs review"}
                        </td>
                        <td style={{ ...cellStyle, maxWidth: "420px" }}>{payout.detail}</td>
                      </tr>
                    ))}
                    {!data.payouts.length && <tr><td colSpan="6" style={{ ...cellStyle, color: "#666" }}>No Shopify payouts have been recorded yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

const pageStyle = { minHeight: "100vh", background: "#f7f7f8", padding: "40px 22px", fontFamily: "Arial, sans-serif", color: "#111" };
const cardStyle = { background: "#fff", borderRadius: "16px", padding: "26px", marginTop: "22px", boxShadow: "0 4px 18px rgba(0,0,0,.04)" };
const mutedStyle = { color: "#555", lineHeight: 1.65 };
const noticeStyle = { padding: "16px 18px", margin: "18px 0", borderRadius: "10px", lineHeight: 1.6 };
const buttonStyle = { background: "#111", color: "#fff", padding: "13px 18px", border: 0, borderRadius: "9px", fontSize: "15px", fontWeight: 700, cursor: "pointer" };
const secondaryButtonStyle = { ...buttonStyle, background: "#fff", color: "#222", border: "1px solid #bbb" };
const buttonRowStyle = { display: "flex", gap: "12px", flexWrap: "wrap" };
const linkStyle = { color: "#111", fontWeight: 700 };
const flowStyle = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "14px", padding: "18px", borderRadius: "10px", background: "#fafafa", lineHeight: 1.5 };
const arrowStyle = { fontSize: "24px", fontWeight: 700, color: "#555" };
const tableStyle = { width: "100%", borderCollapse: "collapse", minWidth: "860px" };
const cellStyle = { padding: "14px 10px", textAlign: "left", verticalAlign: "top", borderBottom: "1px solid #eee", lineHeight: 1.5 };
