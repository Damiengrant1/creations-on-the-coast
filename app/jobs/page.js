"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

const STATUSES = [
  ["new", "New"],
  ["artwork_information_needed", "Artwork/Information Needed"],
  ["awaiting_customer_approval", "Awaiting Customer Approval"],
  ["awaiting_stock_order", "Awaiting Stock Order"],
  ["awaiting_stock_delivery", "Awaiting Stock Delivery"],
  ["ready_to_produce", "Ready to Produce"],
  ["in_production", "In Production"],
  ["ready_for_collection_postage", "Ready for Collection/Postage"],
  ["completed", "Completed"],
  ["cancelled", "Cancelled"],
];

const STATUS_LABELS = Object.fromEntries(STATUSES);
const CLOSED_STATUSES = new Set(["completed", "cancelled"]);

const SOURCE_LABELS = {
  website: "Website",
  facebook: "Facebook",
  whatsapp: "WhatsApp",
  in_person: "In Person",
  other: "Other",
};

const PAYMENT_LABELS = {
  unpaid: "Unpaid",
  deposit_paid: "Deposit Paid",
  paid: "Paid",
  refunded: "Refunded",
};

function localDateString(date = new Date()) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000)
    .toISOString()
    .slice(0, 10);
}

function displayDate(value) {
  if (!value) return "No deadline";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function money(value) {
  return value === null || value === undefined
    ? "—"
    : `£${Number(value).toFixed(2)}`;
}

export default function JobsPage() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [updatingId, setUpdatingId] = useState("");

  useEffect(() => {
    loadJobs();
  }, []);

  async function loadJobs() {
    setLoading(true);
    setMessage("");

    const { data, error } = await supabase
      .from("jobs")
      .select(
        "id, job_number, received_date, customer_name, customer_phone, customer_email, source, status, priority, due_date, delivery_method, payment_status, quoted_total, artwork_details, notes, created_at, updated_at, job_items(id, item_description, quantity, unit_price, personalisation, product_id)"
      )
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Jobs error:", error);
      setMessage(`Could not load jobs: ${error.message}`);
      setJobs([]);
    } else {
      setJobs(data || []);
    }

    setLoading(false);
  }

  async function changeStatus(jobId, status) {
    setUpdatingId(jobId);
    setMessage("");

    const updates = {
      status,
      updated_at: new Date().toISOString(),
      completed_at:
        status === "completed" ? new Date().toISOString() : null,
    };

    const { error } = await supabase
      .from("jobs")
      .update(updates)
      .eq("id", jobId);

    if (error) {
      console.error("Status update error:", error);
      setMessage(`Could not update job: ${error.message}`);
    } else {
      setJobs((currentJobs) =>
        currentJobs.map((job) =>
          job.id === jobId ? { ...job, ...updates } : job
        )
      );
    }

    setUpdatingId("");
  }

  const today = localDateString();
  const inSevenDays = localDateString(
    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  );

  const summary = useMemo(() => {
    const activeJobs = jobs.filter(
      (job) => !CLOSED_STATUSES.has(job.status)
    );

    return {
      active: activeJobs.length,
      overdue: activeJobs.filter(
        (job) => job.due_date && job.due_date < today
      ).length,
      dueSoon: activeJobs.filter(
        (job) =>
          job.due_date &&
          job.due_date >= today &&
          job.due_date <= inSevenDays
      ).length,
      stockOrder: activeJobs.filter(
        (job) => job.status === "awaiting_stock_order"
      ).length,
      stockDelivery: activeJobs.filter(
        (job) => job.status === "awaiting_stock_delivery"
      ).length,
    };
  }, [jobs, today, inSevenDays]);

  const filteredJobs = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();

    return jobs.filter((job) => {
      const statusMatches =
        statusFilter === "all" ||
        (statusFilter === "active"
          ? !CLOSED_STATUSES.has(job.status)
          : job.status === statusFilter);

      if (!statusMatches) return false;
      if (!search) return true;

      const itemText = (job.job_items || [])
        .map(
          (item) =>
            `${item.item_description} ${item.personalisation || ""}`
        )
        .join(" ");

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
      ].some((value) =>
        String(value || "").toLowerCase().includes(search)
      );
    });
  }, [jobs, searchTerm, statusFilter]);

  return (
    <main style={pageStyle}>
      <div style={{ maxWidth: "1500px", margin: "0 auto" }}>
        <Link href="/" style={backLinkStyle}>
          ← Back to Dashboard
        </Link>

        <div style={headingRowStyle}>
          <div>
            <h1 style={{ fontSize: "36px", margin: "0 0 8px" }}>
              Jobs
            </h1>
            <p style={{ color: "#666", margin: 0 }}>
              Track every order from enquiry through to completion.
            </p>
          </div>

          <Link href="/jobs/new" style={primaryLinkStyle}>
            + Add New Job
          </Link>
        </div>

        <div style={summaryGridStyle}>
          <SummaryCard title="Active Jobs" value={summary.active} />
          <SummaryCard title="Overdue" value={summary.overdue} alert={summary.overdue > 0} />
          <SummaryCard title="Due Within 7 Days" value={summary.dueSoon} />
          <SummaryCard title="Awaiting Stock Order" value={summary.stockOrder} alert={summary.stockOrder > 0} />
          <SummaryCard title="Awaiting Stock Delivery" value={summary.stockDelivery} />
        </div>

        <div style={filterPanelStyle}>
          <div style={{ flex: "1 1 340px" }}>
            <label htmlFor="job-search" style={labelStyle}>
              Search Jobs
            </label>
            <input
              id="job-search"
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search job number, customer, item or notes"
              style={fieldStyle}
            />
          </div>

          <div style={{ flex: "0 1 300px" }}>
            <label htmlFor="status-filter" style={labelStyle}>
              Show
            </label>
            <select
              id="status-filter"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              style={fieldStyle}
            >
              <option value="active">All Active Jobs</option>
              <option value="all">All Jobs</option>
              {STATUSES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {message && <div style={errorStyle}>{message}</div>}

        <div style={tablePanelStyle}>
          {loading ? (
            <div style={{ padding: "28px" }}>Loading jobs...</div>
          ) : filteredJobs.length === 0 ? (
            <div style={{ padding: "28px" }}>
              {jobs.length === 0
                ? "No jobs have been added yet."
                : "No jobs match your search or filter."}
            </div>
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr style={{ textAlign: "left", background: "#fafafa" }}>
                  <Th>Job</Th>
                  <Th>Customer</Th>
                  <Th>Items</Th>
                  <Th>Received</Th>
                  <Th>Due</Th>
                  <Th>Source</Th>
                  <Th>Priority</Th>
                  <Th>Payment</Th>
                  <Th>Value</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {filteredJobs.map((job) => {
                  const isActive = !CLOSED_STATUSES.has(job.status);
                  const isOverdue =
                    isActive && job.due_date && job.due_date < today;

                  return (
                    <tr
                      key={job.id}
                      style={{
                        borderTop: "1px solid #eee",
                        background: isOverdue ? "#fff4f4" : "#fff",
                      }}
                    >
                      <Td>
                        <strong>#{job.job_number}</strong>
                      </Td>
                      <Td>
                        <strong>{job.customer_name}</strong>
                        {(job.customer_phone || job.customer_email) && (
                          <div style={subTextStyle}>
                            {job.customer_phone || job.customer_email}
                          </div>
                        )}
                      </Td>
                      <Td>
                        {(job.job_items || []).map((item) => (
                          <div key={item.id} style={{ marginBottom: "4px" }}>
                            {item.quantity} × {item.item_description}
                            {item.personalisation && (
                              <div style={subTextStyle}>
                                {item.personalisation}
                              </div>
                            )}
                          </div>
                        ))}
                      </Td>
                      <Td>{displayDate(job.received_date)}</Td>
                      <Td>
                        <span
                          style={{
                            color: isOverdue ? "#a40000" : "inherit",
                            fontWeight: isOverdue ? "700" : "400",
                          }}
                        >
                          {displayDate(job.due_date)}
                          {isOverdue ? " — OVERDUE" : ""}
                        </span>
                      </Td>
                      <Td>{SOURCE_LABELS[job.source] || job.source}</Td>
                      <Td>
                        <span style={priorityStyle(job.priority)}>
                          {job.priority.charAt(0).toUpperCase() + job.priority.slice(1)}
                        </span>
                      </Td>
                      <Td>{PAYMENT_LABELS[job.payment_status] || job.payment_status}</Td>
                      <Td>{money(job.quoted_total)}</Td>
                      <Td>
                        <select
                          value={job.status}
                          onChange={(event) =>
                            changeStatus(job.id, event.target.value)
                          }
                          disabled={updatingId === job.id}
                          style={{ ...fieldStyle, minWidth: "230px" }}
                        >
                          {STATUSES.map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </main>
  );
}

function SummaryCard({ title, value, alert = false }) {
  return (
    <div
      style={{
        background: alert ? "#fff0f0" : "#fff",
        padding: "20px",
        borderRadius: "12px",
        boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
        border: alert ? "1px solid #efb3b3" : "1px solid transparent",
      }}
    >
      <div style={{ color: alert ? "#9b1c1c" : "#666", marginBottom: "8px", fontSize: "14px" }}>
        {title}
      </div>
      <div style={{ fontSize: "28px", fontWeight: "700" }}>{value}</div>
    </div>
  );
}

function Th({ children }) {
  return <th style={{ padding: "14px", fontSize: "14px", whiteSpace: "nowrap" }}>{children}</th>;
}

function Td({ children }) {
  return <td style={{ padding: "14px", fontSize: "14px", verticalAlign: "top" }}>{children}</td>;
}

function priorityStyle(priority) {
  const colours = {
    normal: { background: "#f1f1f1", color: "#333" },
    high: { background: "#fff2cc", color: "#744c00" },
    urgent: { background: "#ffe0e0", color: "#9b1c1c" },
  };

  return {
    ...(colours[priority] || colours.normal),
    display: "inline-block",
    padding: "5px 8px",
    borderRadius: "6px",
    fontWeight: "700",
    whiteSpace: "nowrap",
  };
}

const pageStyle = {
  minHeight: "100vh",
  background: "#f7f7f8",
  padding: "40px 20px",
  fontFamily: "Arial, sans-serif",
};

const backLinkStyle = {
  display: "inline-block",
  marginBottom: "24px",
  color: "#333",
};

const headingRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: "16px",
  alignItems: "center",
  flexWrap: "wrap",
  marginBottom: "24px",
};

const primaryLinkStyle = {
  background: "#111",
  color: "#fff",
  textDecoration: "none",
  padding: "13px 18px",
  borderRadius: "9px",
  fontWeight: "700",
};

const summaryGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
  gap: "16px",
  marginBottom: "20px",
};

const filterPanelStyle = {
  background: "#fff",
  padding: "18px",
  borderRadius: "12px",
  boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
  marginBottom: "16px",
  display: "flex",
  gap: "16px",
  flexWrap: "wrap",
  alignItems: "end",
};

const labelStyle = {
  display: "block",
  fontWeight: "600",
  marginBottom: "6px",
};

const fieldStyle = {
  width: "100%",
  padding: "11px 12px",
  border: "1px solid #ccc",
  borderRadius: "8px",
  fontSize: "15px",
  boxSizing: "border-box",
  background: "#fff",
};

const errorStyle = {
  padding: "14px 16px",
  marginBottom: "16px",
  borderRadius: "9px",
  background: "#fff0f0",
  color: "#9b1c1c",
  border: "1px solid #f1c1c1",
  fontWeight: "600",
};

const tablePanelStyle = {
  background: "#fff",
  borderRadius: "14px",
  boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
  overflowX: "auto",
};

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
  minWidth: "1450px",
};

const subTextStyle = {
  color: "#666",
  fontSize: "12px",
  marginTop: "3px",
};
