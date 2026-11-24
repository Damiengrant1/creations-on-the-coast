"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import ui from "../../lib/ui";
import { STATUS_LABELS, statusTone } from "../../lib/jobStages";
import { FormSection, PageHeader } from "../FormParts";

const DEFAULT_DATE = "2026-12-01";

function money(value) {
  const amount = Number(value || 0);
  return `${amount < -0.004 ? "−" : ""}£${Math.abs(amount).toFixed(2)}`;
}

function ukDate(value) {
  return value ? value.split("-").reverse().join("/") : "";
}

export default function FreshStartPage() {
  const [settings, setSettings] = useState(null);
  const [date, setDate] = useState(DEFAULT_DATE);
  const [accounts, setAccounts] = useState([]);
  const [actuals, setActuals] = useState({});
  const [doneAccounts, setDoneAccounts] = useState({});
  const [jobs, setJobs] = useState([]);
  const [kept, setKept] = useState({});
  const [counted, setCounted] = useState(0);
  const [shopifyOn, setShopifyOn] = useState(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState({ text: "", tone: "" });

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const [settingsResult, accountsResult, jobsResult, shopifyResult] = await Promise.all([
      supabase.from("business_settings").select("*").eq("id", true).maybeSingle(),
      supabase.from("account_balances").select("account_id, account_name, account_type, current_balance").order("account_name"),
      supabase
        .from("jobs")
        .select("id, job_number, customer_name, status, payment_status, quoted_total, sale_id, created_at, completed_at, closed_at_fresh_start, job_items(quantity, item_description)")
        .eq("closed_at_fresh_start", false)
        .is("sale_id", null)
        .neq("status", "cancelled")
        .order("job_number"),
      supabase.from("shopify_import_settings").select("enabled, payouts_enabled").limit(1).maybeSingle(),
    ]);

    const firstError = settingsResult.error || accountsResult.error || jobsResult.error;
    if (firstError) {
      setMessage({ text: `Could not load the checklist: ${firstError.message}`, tone: "error" });
      return;
    }

    const loadedSettings = settingsResult.data || {};
    setSettings(loadedSettings);
    const startDate = loadedSettings.fresh_start_date || DEFAULT_DATE;
    setDate(startDate);
    setAccounts(accountsResult.data || []);
    setJobs(jobsResult.data || []);
    if (shopifyResult.data) setShopifyOn(Boolean(shopifyResult.data.enabled || shopifyResult.data.payouts_enabled));

    const movements = await supabase
      .from("stock_movements")
      .select("product_id")
      .eq("movement_type", "adjustment")
      .gte("movement_datetime", `${startDate}T00:00:00`);
    setCounted(new Set((movements.data || []).map((row) => row.product_id)).size);
  }

  function say(text, tone = "good") {
    setMessage({ text, tone });
  }

  async function saveDate() {
    setBusy("date");
    const { error } = await supabase.from("business_settings").update({ fresh_start_date: date, updated_at: new Date().toISOString() }).eq("id", true);
    setBusy("");
    if (error) return say(`Could not save the date: ${error.message}`, "error");
    setSettings((current) => ({ ...current, fresh_start_date: date }));
    say(`Fresh start date set to ${ukDate(date)}. The dashboard's money figures now count from that day.`);
  }

  async function setBalance(account) {
    const raw = actuals[account.account_id];
    if (raw === undefined || raw === "") return say(`Enter the real balance for ${account.account_name} first.`, "error");
    setBusy(account.account_id);
    const { data, error } = await supabase.rpc("set_fresh_start_balance", { p_account: account.account_id, p_actual: Number(raw) });
    setBusy("");
    if (error) return say(`Could not set ${account.account_name}: ${error.message}`, "error");
    setDoneAccounts((current) => ({ ...current, [account.account_id]: true }));
    setAccounts((current) => current.map((row) => (row.account_id === account.account_id ? { ...row, current_balance: Number(raw) } : row)));
    say(
      Number(data) === 0
        ? `${account.account_name} already matched. Nothing changed.`
        : `${account.account_name} set to ${money(raw)} (a correction of ${money(Math.abs(Number(data)))}).`
    );
  }

  async function closeJob(job, outcome) {
    setBusy(job.id);
    const now = new Date().toISOString();
    const updates =
      outcome === "cancel"
        ? { status: "cancelled", closed_at_fresh_start: true, updated_at: now }
        : { status: "completed", completed_at: job.completed_at || now, closed_at_fresh_start: true, updated_at: now };
    const { error } = await supabase.from("jobs").update(updates).eq("id", job.id);
    setBusy("");
    if (error) return say(`Could not update job #${job.job_number}: ${error.message}`, "error");
    setJobs((current) => current.filter((row) => row.id !== job.id));
  }

  async function retireShopify() {
    if (!window.confirm("Turn off Shopify order and payout imports? Nothing already recorded is removed.")) return;
    setBusy("shopify");
    const { error } = await supabase.rpc("retire_shopify");
    setBusy("");
    if (error) return say(`Could not turn Shopify off: ${error.message}`, "error");
    setShopifyOn(false);
    say("Shopify imports are off.");
  }

  async function finish() {
    setBusy("finish");
    const { error } = await supabase.from("business_settings").update({ fresh_start_completed_at: new Date().toISOString() }).eq("id", true);
    setBusy("");
    if (error) return say(`Could not finish: ${error.message}`, "error");
    setSettings((current) => ({ ...current, fresh_start_completed_at: new Date().toISOString() }));
    say("Fresh start done. From here, the home screen's “Does it match?” box tells you if anything slips.");
  }

  const startDate = settings?.fresh_start_date;
  const oldJobs = useMemo(
    () => jobs.filter((job) => !startDate || job.created_at.slice(0, 10) < startDate || job.status === "completed"),
    [jobs, startDate]
  );
  const toSort = oldJobs.filter((job) => !kept[job.id]);

  if (!settings) {
    return (
      <main className="form-page">
        <PageHeader title="Fresh start" />
        {message.text ? <div style={ui.error}>{message.text}</div> : <div className="card">Loading…</div>}
      </main>
    );
  }

  return (
    <main className="form-page">
      <PageHeader
        title="Fresh start"
        intro="Draw a line under the old records. Nothing is deleted. You set where things really stand today, and the dashboard counts from there."
      />

      {settings.fresh_start_completed_at && (
        <div style={ui.success}>✓ Fresh start finished on {ukDate(settings.fresh_start_completed_at.slice(0, 10))}. You can still come back and adjust anything here.</div>
      )}
      {message.text && <div style={message.tone === "error" ? ui.error : ui.success}>{message.text}</div>}

      <FormSection step="1" title="Pick the start date" hint="Money figures on the dashboard will count from this day. Older records stay as they are, for looking back.">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
          <div style={{ flex: "0 1 240px" }}>
            <label style={ui.label}>Start date</label>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} style={ui.field} />
          </div>
          <button type="button" onClick={saveDate} disabled={busy === "date" || !date} style={ui.primary}>
            {startDate === date ? "✓ Saved" : busy === "date" ? "Saving…" : "Save date"}
          </button>
        </div>
      </FormSection>

      <FormSection
        step="2"
        title="Enter the real balances"
        hint={`On ${ukDate(startDate || date)}, check each one and type in what's really there. The dashboard adds one correction so it matches.`}
      >
        {!startDate && <div style={ui.notice}>Save the start date first.</div>}
        <div style={{ display: "grid", gap: 10 }}>
          {accounts.map((account) => {
            const where = /square/i.test(account.account_name)
              ? "Square app or dashboard: balance not yet paid out"
              : /shopify/i.test(account.account_name)
              ? "Shopify payouts: anything still to come (usually £0 now it's retired)"
              : /cash/i.test(account.account_name)
              ? "Count the cash tin"
              : "Bank app balance";
            return (
              <div key={account.account_id} className="item-card" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end", marginBottom: 0 }}>
                <div style={{ flex: "1 1 220px" }}>
                  <strong style={{ color: "var(--ink)" }}>{account.account_name}</strong>
                  <div style={ui.help}>{where}</div>
                  <div style={ui.help}>Dashboard says {money(account.current_balance)}</div>
                </div>
                <div style={{ flex: "0 1 170px" }}>
                  <label style={ui.label}>Real balance (£)</label>
                  <input
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    value={actuals[account.account_id] ?? ""}
                    onChange={(event) => setActuals((current) => ({ ...current, [account.account_id]: event.target.value }))}
                    style={ui.field}
                  />
                </div>
                <button type="button" onClick={() => setBalance(account)} disabled={!startDate || busy === account.account_id} style={ui.secondary}>
                  {doneAccounts[account.account_id] ? "✓ Set" : busy === account.account_id ? "Saving…" : "Set balance"}
                </button>
              </div>
            );
          })}
        </div>
      </FormSection>

      <FormSection step="3" title="Count the stock" hint="Go through the stocktake and type in what's on the shelf. Anything you don't count keeps its current figure.">
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <Link href="/stocktake" style={ui.primary}>📋 Open the stocktake</Link>
          <span style={{ color: "var(--muted)" }}>
            {counted > 0 ? `${counted} product${counted === 1 ? "" : "s"} counted since ${ukDate(startDate || date)}.` : "Nothing counted yet."}
          </span>
        </div>
      </FormSection>

      <FormSection
        step="4"
        title="Clear out the old jobs"
        hint="For each job: keep it if it's still being worked on, mark it done if it was finished and paid for before the fresh start, or cancel it if it's dead. Done and cancelled jobs won't ask for payment again."
      >
        {toSort.length === 0 ? (
          <div style={ui.success}>✓ No old jobs left to sort.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {toSort.map((job) => (
              <div key={job.id} className="list-row" style={{ flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 260px" }}>
                  <strong>#{job.job_number} · {job.customer_name}</strong>
                  <div className="sub">
                    {(job.job_items || []).map((item) => `${item.quantity}× ${item.item_description}`).join(", ") || "No items"}
                    {job.quoted_total ? ` · ${money(job.quoted_total)}` : ""}
                  </div>
                  <div style={{ marginTop: 5, display: "flex", gap: 5, flexWrap: "wrap" }}>
                    <span className={`pill ${statusTone(job.status)}`}>{STATUS_LABELS[job.status]}</span>
                    <span className="pill">{job.payment_status === "paid" ? "Marked paid" : job.payment_status === "deposit_paid" ? "Deposit paid" : "Not paid"}</span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {job.status !== "completed" && (
                    <button type="button" className="btn small ghost" onClick={() => setKept((current) => ({ ...current, [job.id]: true }))}>
                      Still live
                    </button>
                  )}
                  <button type="button" className="btn small" style={{ background: "var(--leaf)" }} disabled={busy === job.id} onClick={() => closeJob(job, "done")}>
                    Done before the fresh start
                  </button>
                  <button type="button" className="btn small" style={{ background: "var(--coral)" }} disabled={busy === job.id} onClick={() => closeJob(job, "cancel")}>
                    Cancel
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {Object.keys(kept).length > 0 && (
          <p style={ui.help}>{Object.keys(kept).length} job{Object.keys(kept).length === 1 ? "" : "s"} kept as live. They stay on the jobs board as normal.</p>
        )}
      </FormSection>

      <FormSection step="5" title="Turn off Shopify" hint="Shopify is being retired. This stops it importing orders and payouts. Everything already recorded stays.">
        {shopifyOn === false ? (
          <div style={ui.success}>✓ Shopify imports are off.</div>
        ) : (
          <button type="button" onClick={retireShopify} disabled={busy === "shopify"} style={ui.secondary}>
            {busy === "shopify" ? "Turning off…" : "Turn off Shopify imports"}
          </button>
        )}
      </FormSection>

      <FormSection step="6" title="Finish" hint="This removes the fresh start reminder from the home screen.">
        <button type="button" onClick={finish} disabled={busy === "finish" || !startDate} style={{ ...ui.primary, background: "var(--leaf)" }}>
          {settings.fresh_start_completed_at ? "✓ Finished (tap to update the date)" : busy === "finish" ? "Saving…" : "Finish the fresh start"}
        </button>
      </FormSection>
    </main>
  );
}
