"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useBusinessSettings } from "../lib/useBusinessSettings";
import { useAccess } from "./AuthGate";
import {
  BOARD_COLUMNS,
  CLOSED_STATUSES,
  friendlyDue,
  localDateString,
  needsPayment,
  STATUS_LABELS,
  statusTone,
} from "../lib/jobStages";

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function isJwtTimingError(error) {
  return error?.message?.toLowerCase().includes("jwt issued at future");
}

function money(value) {
  const amount = Number(value || 0);
  return `${amount < -0.004 ? "−" : ""}£${Math.abs(amount).toFixed(2)}`;
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

async function fetchJobs() {
  return supabase
    .from("jobs")
    .select("id, job_number, customer_name, status, priority, due_date, payment_status, quoted_total, sale_id, square_order_id, closed_at_fresh_start, completed_at, created_at, job_items(quantity, item_description)")
    .order("due_date", { ascending: true, nullsFirst: false });
}

async function fetchMoney(since) {
  let sales = supabase.from("sale_totals").select("total_sales, gross_profit");
  let expenses = supabase.from("expenses").select("amount");
  if (since) {
    sales = sales.gte("sale_datetime", `${since}T00:00:00`);
    expenses = expenses.gte("expense_date", since);
  }
  return Promise.all([
    sales,
    expenses,
    supabase.from("account_balances").select("account_id, account_name, account_type, current_balance").order("account_name"),
  ]);
}

export default function HomePage() {
  const { isAdmin } = useAccess();
  const settings = useBusinessSettings();
  const freshStart = settings.fresh_start_date;
  const [jobs, setJobs] = useState([]);
  const [figures, setFigures] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!settings.loaded) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, settings.loaded, freshStart]);

  async function load() {
    setLoading(true);
    setError("");

    let jobsResult = await fetchJobs();
    if (isJwtTimingError(jobsResult.error)) {
      await supabase.auth.refreshSession();
      await wait(3000);
      jobsResult = await fetchJobs();
    }

    if (jobsResult.error) {
      setError(`Could not load jobs: ${jobsResult.error.message}`);
      setLoading(false);
      return;
    }
    setJobs(jobsResult.data || []);

    if (isAdmin) {
      const results = await fetchMoney(freshStart);
      const firstError = results.find((result) => result.error)?.error;
      if (firstError) {
        setError(`Could not load money figures: ${firstError.message}`);
      } else {
        const [salesResult, expensesResult, accountsResult] = results;
        const sum = (rows, key) => (rows || []).reduce((total, row) => total + Number(row[key] || 0), 0);
        const grossProfit = sum(salesResult.data, "gross_profit");
        const expenses = sum(expensesResult.data, "amount");
        setFigures({
          sales: sum(salesResult.data, "total_sales"),
          grossProfit,
          expenses,
          netProfit: grossProfit - expenses,
          cash: sum(accountsResult.data, "current_balance"),
          square: (accountsResult.data || []).find((a) => a.account_id === settings.square_account_id) || (accountsResult.data || []).find((a) => /square/i.test(a.account_name)),
          tin: (accountsResult.data || []).find((a) => /^cash$/i.test(a.account_name)),
          accounts: accountsResult.data || [],
        });
      }
    }

    setLoading(false);
  }

  const today = localDateString();

  const view = useMemo(() => {
    const active = jobs.filter((job) => !CLOSED_STATUSES.has(job.status));
    const due = (job) => friendlyDue(job.due_date, today);
    const overdue = active.filter((job) => job.due_date && job.due_date < today);
    const thisWeek = active.filter((job) => {
      if (!job.due_date) return false;
      const days = Math.round((new Date(job.due_date) - new Date(today)) / 86400000);
      return days >= 0 && days <= 7;
    });
    const columns = BOARD_COLUMNS.map((column) => ({
      ...column,
      count: active.filter((job) => column.statuses.includes(job.status)).length,
    }));
    const upNext = [...active]
      .sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999"))
      .slice(0, 6)
      .map((job) => ({ ...job, due: due(job) }));
    const unpaidFinished = jobs.filter((job) => needsPayment(job, freshStart));
    const paidNotRecorded = jobs.filter(
      (job) =>
        job.payment_status === "paid" && !job.sale_id && !job.closed_at_fresh_start &&
        job.status !== "cancelled" && job.status !== "completed" && !job.square_order_id
    );
    const websiteWaiting = jobs.filter((job) => job.square_order_id && !CLOSED_STATUSES.has(job.status));
    return { active, overdue, thisWeek, columns, upNext, unpaidFinished, paidNotRecorded, websiteWaiting };
  }, [jobs, today, freshStart]);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>{greeting()}</h1>
          <p>Here&apos;s what needs doing at Creations on the Coast.</p>
        </div>
        <button type="button" className="btn ghost small" onClick={load}>Refresh</button>
      </div>

      {error && (
        <div className="notice error">
          {error}{" "}
          <button type="button" className="btn small ghost" onClick={load}>Try again</button>
        </div>
      )}

      {isAdmin && settings.loaded && !settings.fresh_start_completed_at && (
        <Link href="/fresh-start" className="notice" style={{ display: "block", textDecoration: "none" }}>
          🧹 <strong>Fresh start{freshStart ? ` on ${freshStart.split("-").reverse().join("/")}` : ""}:</strong> set the real balances, count the stock and clear out old jobs. Open the checklist →
        </Link>
      )}

      {view.websiteWaiting.length > 0 && (
        <Link href="/jobs" className="notice good" style={{ display: "block", textDecoration: "none" }}>
          🌐 {view.websiteWaiting.length} website order{view.websiteWaiting.length === 1 ? "" : "s"} paid and waiting to be made. They&apos;re on the jobs board.
        </Link>
      )}

      <div className="quick-actions">
        <Link href="/jobs/new" className="primary"><span>➕</span>New job</Link>
        <Link href="/jobs"><span>🧵</span>Jobs board</Link>
        <Link href="/event-pos"><span>🛍️</span>Event till</Link>
        <Link href="/record-sale"><span>🧾</span>Record a sale</Link>
        <Link href="/products"><span>👕</span>Check stock</Link>
      </div>

      <div className="grid-tiles">
        <Tile label="Active jobs" value={loading ? "…" : view.active.length} href="/jobs" tone="sea" />
        <Tile label="Overdue" value={loading ? "…" : view.overdue.length} href="/jobs?filter=overdue" tone={view.overdue.length ? "alert" : "good"} hint={view.overdue.length ? "Sort these first" : "Nothing late"} />
        <Tile label="Due in the next 7 days" value={loading ? "…" : view.thisWeek.length} href="/jobs?filter=week" tone={view.thisWeek.length ? "warn" : ""} />
        <Tile label="Finished but not paid for" value={loading ? "…" : view.unpaidFinished.length} href="/jobs?filter=payment" tone={view.unpaidFinished.length ? "alert" : "good"} hint="Take payment so it counts as a sale" />
      </div>

      <h2 className="section-title">Jobs by stage</h2>
      <div className="grid-tiles stages">
        {view.columns.map((column) => (
          <Tile key={column.key} label={column.title} value={loading ? "…" : column.count} hint={column.hint} href={`/jobs?stage=${column.key}`} />
        ))}
      </div>

      <div style={{ display: "grid", gap: 22, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", marginBottom: 26 }}>
        <div>
          <h2 className="section-title">Up next</h2>
          <div className="list-rows">
            {!loading && view.upNext.length === 0 && <div className="card">No active jobs. 🎉</div>}
            {view.upNext.map((job) => (
              <Link key={job.id} href={`/jobs/edit/${job.id}`} className="list-row">
                <div>
                  <strong>#{job.job_number} · {job.customer_name}</strong>
                  <div className="sub">
                    {(job.job_items || []).map((item) => `${item.quantity}× ${item.item_description}`).join(", ") || "No items yet"}
                  </div>
                </div>
                <div style={{ display: "grid", gap: 4, justifyItems: "end" }}>
                  <span className={`pill ${job.due.tone}`}>{job.due.text}</span>
                  <span className={`pill ${statusTone(job.status)}`}>{STATUS_LABELS[job.status]}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div>
          <h2 className="section-title">Needs tidying up</h2>
          <div className="list-rows">
            {!loading && view.unpaidFinished.length === 0 && view.paidNotRecorded.length === 0 && (
              <div className="card">Everything is in order.</div>
            )}
            {view.unpaidFinished.slice(0, 8).map((job) => (
              <Link key={job.id} href={`/jobs/edit/${job.id}#take-payment`} className="list-row">
                <div>
                  <strong>#{job.job_number} · {job.customer_name}</strong>
                  <div className="sub">Completed, but no payment recorded{job.quoted_total ? ` (${money(job.quoted_total)})` : " and no price set"}</div>
                </div>
                <span className="pill coral">Take payment</span>
              </Link>
            ))}
            {view.paidNotRecorded.slice(0, 5).map((job) => (
              <Link key={job.id} href={`/jobs/edit/${job.id}#take-payment`} className="list-row">
                <div>
                  <strong>#{job.job_number} · {job.customer_name}</strong>
                  <div className="sub">Marked paid but not recorded as a sale yet</div>
                </div>
                <span className="pill sun">Record sale</span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {isAdmin && (
        <>
          <h2 className="section-title">Does it match? (admin only)</h2>
          <div className="grid-tiles">
            <Tile
              label="Square in the dashboard"
              value={figures?.square ? money(figures.square.current_balance) : "…"}
              tone={figures?.square && Number(figures.square.current_balance) < -0.005 ? "alert" : "good"}
              hint={
                figures?.square && Number(figures.square.current_balance) < -0.005
                  ? "Below zero: Square paid out money for card sales nobody recorded."
                  : "Should be about what Square hasn't paid out yet."
              }
            />
            <Tile
              label="Cash in the dashboard"
              value={figures?.tin ? money(figures.tin.current_balance) : "…"}
              tone={figures?.tin && Number(figures.tin.current_balance) < -0.005 ? "alert" : "sea"}
              hint="Count the cash tin. It should match this."
            />
            <Tile
              label="Finished jobs with no sale"
              value={loading ? "…" : view.unpaidFinished.length}
              tone={view.unpaidFinished.length ? "alert" : "good"}
              href="/jobs?filter=payment"
              hint={view.unpaidFinished.length ? "Money missing from the figures" : "All recorded"}
            />
          </div>

          <h2 className="section-title">Money{freshStart ? ` since ${freshStart.split("-").reverse().join("/")}` : ""} (admin only)</h2>
          <div className="grid-tiles">
            <Tile label="Total sales" value={figures ? money(figures.sales) : "…"} />
            <Tile label="Gross profit" value={figures ? money(figures.grossProfit) : "…"} />
            <Tile label="Expenses" value={figures ? money(figures.expenses) : "…"} />
            <Tile label="Net profit" value={figures ? money(figures.netProfit) : "…"} tone={figures && figures.netProfit < 0 ? "alert" : "good"} />
            <Tile label="Cash balance" value={figures ? money(figures.cash) : "…"} href="/cash-flow" />
          </div>
          {figures?.accounts?.length > 0 && (
            <div className="grid-tiles">
              {figures.accounts.map((account) => (
                <Tile key={account.account_id} label={account.account_name} value={money(account.current_balance)} hint={{ bank: "Bank", cash: "Cash", payment_provider: "Card payments" }[account.account_type] || account.account_type} />
              ))}
            </div>
          )}
        </>
      )}

      <div style={{ color: "var(--muted)", fontSize: 13, textAlign: "center", marginTop: 10 }}>Creations on the Coast Ltd</div>
    </main>
  );
}

function Tile({ label, value, hint, href, tone = "" }) {
  const body = (
    <>
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {hint && <div className="tile-hint">{hint}</div>}
    </>
  );
  return href ? (
    <Link href={href} className={`tile ${tone}`}>{body}</Link>
  ) : (
    <div className={`tile ${tone}`}>{body}</div>
  );
}
