"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  BOARD_COLUMNS,
  CLOSED_STATUSES,
  NEXT_STEP,
  PAYMENT_LABELS,
  SOURCE_LABELS,
  STATUSES,
  STATUS_LABELS,
  displayDate,
  friendlyDue,
  localDateString,
  needsPayment,
  paymentTone,
  statusTone,
} from "../../lib/jobStages";

const VIEW_KEY = "coast-jobs-view";

function money(value) {
  return value === null || value === undefined ? "—" : `£${Number(value).toFixed(2)}`;
}

function itemsSummary(job) {
  const items = job.job_items || [];
  if (items.length === 0) return "No items yet";
  return items.map((item) => `${item.quantity}× ${item.item_description}`).join(", ");
}

export default function JobsPage() {
  const [jobs, setJobs] = useState([]);
  const [products, setProducts] = useState([]);
  const [stockLevels, setStockLevels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [quickFilter, setQuickFilter] = useState("all"); // all | overdue | week | payment
  const [stageFilter, setStageFilter] = useState("");
  const [view, setView] = useState("board");
  const [showClosed, setShowClosed] = useState(false);
  const [updatingId, setUpdatingId] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const filter = params.get("filter");
    if (["overdue", "week", "payment"].includes(filter)) setQuickFilter(filter);
    if (filter === "payment") setShowClosed(true);
    const stage = params.get("stage");
    if (BOARD_COLUMNS.some((column) => column.key === stage)) setStageFilter(stage);
    try {
      const saved = window.localStorage.getItem(VIEW_KEY);
      if (saved === "board" || saved === "list") setView(saved);
      else if (window.innerWidth < 700) setView("list");
    } catch {
      // storage unavailable: keep the default view
    }
    loadJobs();
  }, []);

  function chooseView(next) {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // ignore
    }
  }

  async function loadJobs() {
    setLoading(true);
    setMessage("");

    const [jobsResult, productsResult, stockResult] = await Promise.all([
      supabase
        .from("jobs")
        .select(
          "id, job_number, received_date, customer_name, customer_phone, customer_email, source, status, priority, due_date, delivery_method, payment_status, quoted_total, artwork_details, notes, sale_id, created_at, updated_at, job_items(id, item_description, quantity, unit_price, personalisation, product_id)"
        )
        .order("due_date", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false }),
      supabase.from("products").select("id, track_stock"),
      supabase.from("current_stock").select("product_id, current_stock"),
    ]);

    const firstError = jobsResult.error || productsResult.error || stockResult.error;

    if (firstError) {
      console.error("Jobs error:", firstError);
      setMessage(`Could not load jobs: ${firstError.message}`);
      setJobs([]);
    } else {
      setJobs(jobsResult.data || []);
      setProducts(productsResult.data || []);
      setStockLevels(stockResult.data || []);
    }

    setLoading(false);
  }

  async function changeStatus(jobId, status) {
    setUpdatingId(jobId);
    setMessage("");

    const updates = {
      status,
      updated_at: new Date().toISOString(),
      completed_at: status === "completed" ? new Date().toISOString() : null,
    };

    const { error } = await supabase.from("jobs").update(updates).eq("id", jobId);

    if (error) {
      console.error("Status update error:", error);
      setMessage(`Could not update job: ${error.message}`);
    } else {
      setJobs((current) => current.map((job) => (job.id === jobId ? { ...job, ...updates } : job)));
    }

    setUpdatingId("");
  }

  const today = localDateString();

  // ---- Stock check: give stock to the oldest jobs first ----
  const productMap = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const stockMap = useMemo(
    () => new Map(stockLevels.map((stock) => [stock.product_id, Number(stock.current_stock || 0)])),
    [stockLevels]
  );

  const stockStatusByJob = useMemo(() => {
    const statuses = new Map();
    const allocatedByProduct = new Map();
    const waiting = jobs
      .filter((job) => !job.sale_id && !CLOSED_STATUSES.has(job.status))
      .sort((a, b) => {
        const first = a.received_date || a.created_at || "";
        const second = b.received_date || b.created_at || "";
        if (first !== second) return first.localeCompare(second);
        return String(a.created_at || "").localeCompare(String(b.created_at || ""));
      });

    waiting.forEach((job) => {
      const required = new Map();
      let hasUnlinkedItem = false;

      (job.job_items || []).forEach((item) => {
        const product = item.product_id ? productMap.get(item.product_id) : null;
        if (!product) {
          hasUnlinkedItem = true;
          return;
        }
        if (product.track_stock) {
          required.set(item.product_id, (required.get(item.product_id) || 0) + Number(item.quantity || 0));
        }
      });

      let short = false;
      required.forEach((quantity, productId) => {
        const available = Math.max(0, (stockMap.get(productId) || 0) - (allocatedByProduct.get(productId) || 0));
        if (available < quantity) short = true;
      });

      if (short) {
        statuses.set(job.id, { label: "Stock needed", tone: "coral", title: "Earlier jobs have used the stock on hand. Order more for this job." });
      } else if (hasUnlinkedItem) {
        statuses.set(job.id, { label: "Check stock", tone: "sun", title: "At least one item isn't linked to a product, so stock can't be checked." });
      } else {
        statuses.set(job.id, { label: "Stock ready", tone: "leaf", title: "Stock is available after earlier jobs have had theirs." });
      }

      required.forEach((quantity, productId) => {
        allocatedByProduct.set(productId, (allocatedByProduct.get(productId) || 0) + quantity);
      });
    });

    return statuses;
  }, [jobs, productMap, stockMap]);

  function stockStatus(job) {
    if (job.sale_id) return { label: "Stock taken", tone: "", title: "Stock came off when this job was recorded as a sale." };
    if (CLOSED_STATUSES.has(job.status)) return null;
    if ((job.job_items || []).length === 0) return { label: "No items", tone: "sun", title: "Add the items to this job." };
    return stockStatusByJob.get(job.id) || null;
  }

  // ---- Filtering ----
  const filteredJobs = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    const stage = BOARD_COLUMNS.find((column) => column.key === stageFilter);

    return jobs.filter((job) => {
      const closed = CLOSED_STATUSES.has(job.status);
      if (quickFilter === "payment") {
        if (!needsPayment(job)) return false;
      } else if (closed && !showClosed) {
        return false;
      }
      if (quickFilter === "overdue" && !(job.due_date && job.due_date < today && !closed)) return false;
      if (quickFilter === "week") {
        if (!job.due_date || closed) return false;
        const days = Math.round((new Date(job.due_date) - new Date(today)) / 86400000);
        if (days < 0 || days > 7) return false;
      }
      if (stage && !stage.statuses.includes(job.status)) return false;
      if (!search) return true;

      const itemText = (job.job_items || []).map((item) => `${item.item_description} ${item.personalisation || ""}`).join(" ");
      return [
        job.job_number,
        job.customer_name,
        job.customer_phone,
        job.customer_email,
        SOURCE_LABELS[job.source],
        STATUS_LABELS[job.status],
        job.notes,
        job.artwork_details,
        itemText,
      ].some((value) => String(value || "").toLowerCase().includes(search));
    });
  }, [jobs, searchTerm, quickFilter, stageFilter, showClosed, today]);

  const counts = useMemo(() => {
    const active = jobs.filter((job) => !CLOSED_STATUSES.has(job.status));
    return {
      active: active.length,
      overdue: active.filter((job) => job.due_date && job.due_date < today).length,
      week: active.filter((job) => {
        if (!job.due_date) return false;
        const days = Math.round((new Date(job.due_date) - new Date(today)) / 86400000);
        return days >= 0 && days <= 7;
      }).length,
      payment: jobs.filter(needsPayment).length,
    };
  }, [jobs, today]);

  const closedJobs = filteredJobs.filter((job) => CLOSED_STATUSES.has(job.status));

  function clearFilters() {
    setQuickFilter("all");
    setStageFilter("");
    setSearchTerm("");
    window.history.replaceState(null, "", "/jobs");
  }

  const filtersOn = quickFilter !== "all" || stageFilter || searchTerm;

  return (
    <main className="page" style={{ maxWidth: 1700 }}>
      <div className="page-head">
        <div>
          <h1>Jobs</h1>
          <p>Every order from first message to collected. Tap the green button to move a job on.</p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/jobs/stock-order" className="btn ghost">📦 Stock order</Link>
          <Link href="/jobs/new" className="btn sea">➕ New job</Link>
        </div>
      </div>

      <div className="card" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 16, padding: 14 }}>
        <input
          type="search"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Search name, job number, item, notes…"
          aria-label="Search jobs"
          style={{ flex: "1 1 260px", padding: "11px 12px", border: "1px solid var(--line-strong)", borderRadius: 10, fontSize: 15 }}
        />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <FilterChip on={quickFilter === "all"} onClick={() => setQuickFilter("all")}>All active · {counts.active}</FilterChip>
          <FilterChip on={quickFilter === "overdue"} tone="coral" onClick={() => setQuickFilter("overdue")}>Overdue · {counts.overdue}</FilterChip>
          <FilterChip on={quickFilter === "week"} tone="sun" onClick={() => setQuickFilter("week")}>Due this week · {counts.week}</FilterChip>
          <FilterChip on={quickFilter === "payment"} tone="coral" onClick={() => setQuickFilter("payment")}>Needs payment · {counts.payment}</FilterChip>
        </div>
        <div className="segmented" role="group" aria-label="View">
          <button type="button" className={view === "board" ? "on" : ""} onClick={() => chooseView("board")}>Board</button>
          <button type="button" className={view === "list" ? "on" : ""} onClick={() => chooseView("list")}>List</button>
        </div>
      </div>

      {(filtersOn || stageFilter) && (
        <div style={{ marginBottom: 12, color: "var(--muted)", fontSize: 14 }}>
          Showing {filteredJobs.length} job{filteredJobs.length === 1 ? "" : "s"}
          {stageFilter && ` in “${BOARD_COLUMNS.find((c) => c.key === stageFilter)?.title}”`}.{" "}
          <button type="button" className="btn small ghost" onClick={clearFilters}>Clear filters</button>
        </div>
      )}

      {quickFilter === "payment" && (
        <div className="notice">
          These jobs are marked completed but were never recorded as a sale, so the money isn&apos;t in the figures or the stock count. Open each one and use <strong>Take payment</strong> at the bottom.
        </div>
      )}

      {message && <div className="notice error">{message}</div>}

      {loading ? (
        <div className="card">Loading jobs…</div>
      ) : view === "board" && quickFilter !== "payment" ? (
        <div className="board">
          {BOARD_COLUMNS.filter((column) => !stageFilter || column.key === stageFilter).map((column) => {
            const columnJobs = filteredJobs.filter((job) => column.statuses.includes(job.status));
            return (
              <section key={column.key} className="board-col">
                <div className="board-col-head">
                  <div>
                    {column.title}
                    <small>{column.hint}</small>
                  </div>
                  <span className="count">{columnJobs.length}</span>
                </div>
                {columnJobs.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13, padding: "4px 6px 10px" }}>Nothing here</div>}
                {columnJobs.map((job) => (
                  <JobCard key={job.id} job={job} today={today} stock={stockStatus(job)} busy={updatingId === job.id} onMove={changeStatus} />
                ))}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="list-rows">
          {filteredJobs.length === 0 && (
            <div className="card">{jobs.length === 0 ? "No jobs yet. Add your first one with New job." : "No jobs match. Try clearing the filters."}</div>
          )}
          {filteredJobs.filter((job) => quickFilter === "payment" || !CLOSED_STATUSES.has(job.status)).map((job) => (
            <JobRow key={job.id} job={job} today={today} stock={stockStatus(job)} busy={updatingId === job.id} onMove={changeStatus} />
          ))}
        </div>
      )}

      {quickFilter !== "payment" && (
        <div style={{ marginTop: 26 }}>
          <button type="button" className="btn ghost small" onClick={() => setShowClosed((value) => !value)}>
            {showClosed ? "Hide" : "Show"} completed & cancelled jobs
          </button>
          {showClosed && (
            <div className="list-rows" style={{ marginTop: 12 }}>
              {closedJobs.length === 0 && <div className="card">None to show.</div>}
              {closedJobs.map((job) => (
                <JobRow key={job.id} job={job} today={today} stock={stockStatus(job)} busy={updatingId === job.id} onMove={changeStatus} />
              ))}
            </div>
          )}
        </div>
      )}
    </main>
  );
}

function FilterChip({ on, tone = "", onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`pill ${on ? "" : tone}`}
      style={{
        border: on ? "1px solid var(--ink)" : "1px solid transparent",
        background: on ? "var(--ink)" : undefined,
        color: on ? "#fff" : undefined,
        padding: "8px 12px",
        fontSize: 13,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

// The main "move it on" control. Finishing a job that hasn't been paid for sends you to take payment first.
function NextStep({ job, busy, onMove }) {
  if (needsPayment(job)) {
    return <Link href={`/jobs/edit/${job.id}#take-payment`} className="btn small" style={{ background: "var(--coral)" }}>💷 Take payment</Link>;
  }
  const next = NEXT_STEP[job.status];
  if (!next) return null;
  if (next.to === "completed" && !job.sale_id) {
    return <Link href={`/jobs/edit/${job.id}#take-payment`} className="btn small" style={{ background: "var(--leaf)" }}>💷 Take payment & finish</Link>;
  }
  return (
    <button type="button" className="btn small" style={{ background: "var(--leaf)" }} disabled={busy} onClick={() => onMove(job.id, next.to)}>
      {busy ? "Saving…" : `✓ ${next.label}`}
    </button>
  );
}

function MoveSelect({ job, busy, onMove }) {
  return (
    <select
      aria-label={`Move job ${job.job_number}`}
      value={job.status}
      disabled={busy}
      onChange={(event) => onMove(job.id, event.target.value)}
      style={{ border: "1px solid var(--line-strong)", borderRadius: 8, padding: "6px 6px", fontSize: 12.5, background: "#fff", maxWidth: 130 }}
    >
      {STATUSES.map(([value, label]) => (
        <option key={value} value={value}>{value === job.status ? "Move to another stage…" : label}</option>
      ))}
    </select>
  );
}

function JobCard({ job, today, stock, busy, onMove }) {
  const due = friendlyDue(job.due_date, today);
  const overdue = due.tone === "coral";
  const soon = due.tone === "sun";
  return (
    <article className={`job-card${overdue ? " overdue" : soon ? " soon" : ""}`}>
      <div className="job-card-top">
        <Link href={`/jobs/edit/${job.id}`}>#{job.job_number}</Link>
        <span className={`pill ${due.tone}`}>{due.text}</span>
      </div>
      <div className="customer">{job.customer_name}</div>
      <div className="items">{itemsSummary(job)}</div>
      <div className="meta">
        <span className={`pill ${statusTone(job.status)}`}>{STATUS_LABELS[job.status]}</span>
        <span className={`pill ${paymentTone(job.payment_status)}`}>{PAYMENT_LABELS[job.payment_status] || job.payment_status}</span>
        {stock && <span className={`pill ${stock.tone}`} title={stock.title}>{stock.label}</span>}
        {job.priority && job.priority !== "normal" && <span className="pill coral">{job.priority === "urgent" ? "Urgent" : "High priority"}</span>}
      </div>
      <div className="actions">
        <NextStep job={job} busy={busy} onMove={onMove} />
        <MoveSelect job={job} busy={busy} onMove={onMove} />
      </div>
    </article>
  );
}

function JobRow({ job, today, stock, busy, onMove }) {
  const due = friendlyDue(job.due_date, today);
  const closed = CLOSED_STATUSES.has(job.status);
  return (
    <div className="list-row" style={{ flexWrap: "wrap", borderLeft: due.tone === "coral" && !closed ? "4px solid var(--coral)" : undefined }}>
      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
        <Link href={`/jobs/edit/${job.id}`} style={{ textDecoration: "none" }}>
          <strong>#{job.job_number} · {job.customer_name}</strong>
        </Link>
        <div className="sub">{itemsSummary(job)}</div>
        <div className="sub">
          {SOURCE_LABELS[job.source] || job.source} · received {displayDate(job.received_date)} · {money(job.quoted_total)}
          {job.customer_phone ? ` · ${job.customer_phone}` : ""}
        </div>
      </div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
        {!closed && <span className={`pill ${due.tone}`}>{due.text}</span>}
        <span className={`pill ${statusTone(job.status)}`}>{STATUS_LABELS[job.status]}</span>
        <span className={`pill ${paymentTone(job.payment_status)}`}>{PAYMENT_LABELS[job.payment_status] || job.payment_status}</span>
        {stock && <span className={`pill ${stock.tone}`} title={stock.title}>{stock.label}</span>}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <NextStep job={job} busy={busy} onMove={onMove} />
        <MoveSelect job={job} busy={busy} onMove={onMove} />
        <Link href={`/jobs/edit/${job.id}`} className="btn small ghost">{job.sale_id ? "View" : "Edit"}</Link>
      </div>
    </div>
  );
}
