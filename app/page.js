"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
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
  return `£${Number(value || 0).toFixed(2)}`;
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
    .select("id, job_number, customer_name, status, priority, due_date, payment_status, quoted_total, sale_id, created_at, job_items(quantity, item_description)")
    .order("due_date", { ascending: true, nullsFirst: false });
}

async function fetchMoney() {
  return Promise.all([
    supabase.from("sale_totals").select("total_sales, gross_profit"),
    supabase.from("expenses").select("amount"),
    supabase.from("account_balances").select("account_id, account_name, account_type, current_balance").order("account_name"),
  ]);
}

export default function HomePage() {
  const { isAdmin } = useAccess();
  const [jobs, setJobs] = useState([]);
  const [figures, setFigures] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

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
      const results = await fetchMoney();
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
    const unpaidFinished = jobs.filter(needsPayment);
    const paidNotRecorded = jobs.filter(
      (job) => job.payment_status === "paid" && !job.sale_id && job.status !== "cancelled" && job.status !== "completed"
    );
    return { active, overdue, thisWeek, columns, upNext, unpaidFinished, paidNotRecorded };
  }, [jobs, today]);

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
          <h2 className="section-title">Money (admin only)</h2>
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
                <Tile key={account.account_id} label={account.account_name} value={money(account.current_balance)} hint={account.account_type} />
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
