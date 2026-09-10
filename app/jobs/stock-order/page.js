"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { useAccess } from "../../AuthGate";

const todayString = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000)
    .toISOString()
    .slice(0, 10);
};

const displayDate = (value) => {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
};

const money = (value) => `£${Number(value || 0).toFixed(2)}`;

export default function StockOrderPage() {
  const { isAdmin } = useAccess();
  const [jobs, setJobs] = useState([]);
  const [products, setProducts] = useState([]);
  const [stockLevels, setStockLevels] = useState([]);
  const [supplier, setSupplier] = useState("");
  const [orderDate, setOrderDate] = useState(todayString());
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadRequirements();
  }, []);

  async function loadRequirements() {
    setLoading(true);
    setMessage("");

    const [jobsResult, productsResult, stockResult] = await Promise.all([
      supabase
        .from("jobs")
        .select(
          "id, job_number, customer_name, due_date, job_items(id, product_id, item_description, quantity, personalisation)"
        )
        .eq("status", "awaiting_stock_order")
        .order("due_date", { ascending: true, nullsFirst: false }),
      supabase
        .from("products")
        .select(
          "id, product_name, sku, colour, size, stock_cost, track_stock"
        )
        .eq("active", true),
      supabase.from("current_stock").select("product_id, current_stock"),
    ]);

    const error =
      jobsResult.error || productsResult.error || stockResult.error;

    if (error) {
      console.error("Stock order error:", error);
      setMessage(`Could not load stock order: ${error.message}`);
    } else {
      setJobs(jobsResult.data || []);
      setProducts(productsResult.data || []);
      setStockLevels(stockResult.data || []);
    }

    setLoading(false);
  }

  const order = useMemo(() => {
    const productMap = new Map(
      products.map((product) => [product.id, product])
    );
    const stockMap = new Map(
      stockLevels.map((stock) => [
        stock.product_id,
        Math.max(0, Number(stock.current_stock || 0)),
      ])
    );
    const grouped = new Map();

    jobs.forEach((job) => {
      (job.job_items || []).forEach((item) => {
        const product = item.product_id
          ? productMap.get(item.product_id)
          : null;
        const key = product
          ? `product:${product.id}`
          : `manual:${item.item_description.trim().toLowerCase()}:${
              item.personalisation || ""
            }`;

        if (!grouped.has(key)) {
          grouped.set(key, {
            key,
            description: product
              ? [product.product_name, product.colour, product.size]
                  .filter(Boolean)
                  .join(" / ")
              : item.item_description,
            sku: product?.sku || "Manual item",
            required: 0,
            available:
              product?.track_stock
                ? stockMap.get(product.id) || 0
                : 0,
            costEach: Number(product?.stock_cost || 0),
            manual: !product,
            jobs: new Set(),
            customers: new Set(),
          });
        }

        const row = grouped.get(key);
        row.required += Number(item.quantity || 0);
        row.jobs.add(`#${job.job_number}`);
        row.customers.add(job.customer_name);
      });
    });

    const rows = Array.from(grouped.values())
      .map((row) => ({
        ...row,
        orderQuantity: Math.max(0, row.required - row.available),
        jobs: Array.from(row.jobs),
        customers: Array.from(row.customers),
      }))
      .sort((a, b) => a.description.localeCompare(b.description));

    return {
      rows,
      units: rows.reduce((sum, row) => sum + row.orderQuantity, 0),
      cost: rows.reduce(
        (sum, row) => sum + row.orderQuantity * row.costEach,
        0
      ),
      manualItems: rows.filter((row) => row.manual).length,
    };
  }, [jobs, products, stockLevels]);

  async function markPlaced() {
    if (jobs.length === 0 || order.units === 0) return;

    if (
      !window.confirm(
        "Mark this order as placed and move all linked jobs to Awaiting Stock Delivery?"
      )
    ) {
      return;
    }

    setSaving(true);
    setMessage("");

    const { error } = await supabase
      .from("jobs")
      .update({
        status: "awaiting_stock_delivery",
        updated_at: new Date().toISOString(),
      })
      .in(
        "id",
        jobs.map((job) => job.id)
      );

    if (error) {
      setMessage(`Could not update jobs: ${error.message}`);
    } else {
      setMessage(
        "Order marked as placed. Jobs moved to Awaiting Stock Delivery."
      );
      setJobs([]);
    }

    setSaving(false);
  }

  return (
    <main style={pageStyle}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          main { padding: 0 !important; background: white !important; }
          .print-panel { box-shadow: none !important; }
        }
      `}</style>

      <div style={{ maxWidth: "1300px", margin: "0 auto" }}>
        <div className="no-print">
          <Link href="/jobs" style={backLinkStyle}>
            ← Back to Jobs
          </Link>
        </div>

        <div style={headingStyle}>
          <div>
            <h1 style={{ fontSize: "36px", margin: "0 0 8px" }}>
              Stock Order Form
            </h1>
            <p style={{ color: "#666", margin: 0 }}>
              Combined requirements from jobs awaiting a stock order.
            </p>
          </div>

          <div className="no-print" style={{ display: "flex", gap: "10px" }}>
            <button
              type="button"
              onClick={() => window.print()}
              style={secondaryButtonStyle}
              disabled={order.rows.length === 0}
            >
              Print / Save PDF
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={markPlaced}
                style={primaryButtonStyle}
                disabled={saving || jobs.length === 0 || order.units === 0}
              >
                {saving ? "Updating..." : "Mark Order Placed"}
              </button>
            )}
          </div>
        </div>

        <div className="print-panel" style={panelStyle}>
          <div style={detailsGridStyle}>
            <Field label="Supplier">
              <input
                value={supplier}
                onChange={(event) => setSupplier(event.target.value)}
                placeholder="Enter supplier name"
                style={fieldStyle}
              />
            </Field>
            <Field label="Order Date">
              <input
                type="date"
                value={orderDate}
                onChange={(event) => setOrderDate(event.target.value)}
                style={fieldStyle}
              />
            </Field>
            <Field label="Reference">
              <input
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                placeholder="Optional order reference"
                style={fieldStyle}
              />
            </Field>
          </div>

          <div style={{ marginBottom: "18px", fontWeight: "700" }}>
            {supplier ? `Supplier: ${supplier} · ` : ""}
            Date: {displayDate(orderDate)}
            {reference ? ` · Reference: ${reference}` : ""}
          </div>

          {message && (
            <div className="no-print" style={messageStyle}>
              {message}
            </div>
          )}

          {loading ? (
            <div style={{ padding: "24px" }}>
              Loading stock requirements...
            </div>
          ) : order.rows.length === 0 ? (
            <div style={emptyStyle}>
              There are no jobs currently marked Awaiting Stock Order.
            </div>
          ) : (
            <>
              <div style={summaryGridStyle}>
                <SummaryCard title="Jobs Included" value={jobs.length} />
                <SummaryCard title="Units to Order" value={order.units} />
                <SummaryCard
                  title="Estimated Stock Cost"
                  value={money(order.cost)}
                />
                <SummaryCard
                  title="Manual Items"
                  value={order.manualItems}
                />
              </div>

              {order.manualItems > 0 && (
                <div style={warningStyle}>
                  Manual items have no linked catalogue product, so their
                  available stock and cost cannot be calculated automatically.
                </div>
              )}

              <div style={{ overflowX: "auto" }}>
                <table style={tableStyle}>
                  <thead>
                    <tr style={{ textAlign: "left", background: "#f7f7f8" }}>
                      <Th>Product</Th>
                      <Th>SKU</Th>
                      <Th>Jobs / Customers</Th>
                      <Th>Required</Th>
                      <Th>In Stock</Th>
                      <Th>Order Qty</Th>
                      <Th>Cost Each</Th>
                      <Th>Est. Cost</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.rows.map((row) => (
                      <tr
                        key={row.key}
                        style={{ borderTop: "1px solid #eee" }}
                      >
                        <Td><strong>{row.description}</strong></Td>
                        <Td>{row.sku}</Td>
                        <Td>
                          <div>{row.jobs.join(", ")}</div>
                          <div style={subTextStyle}>
                            {row.customers.join(", ")}
                          </div>
                        </Td>
                        <Td>{row.required}</Td>
                        <Td>{row.manual ? "Unknown" : row.available}</Td>
                        <Td><strong>{row.orderQuantity}</strong></Td>
                        <Td>
                          {row.manual ? "Unknown" : money(row.costEach)}
                        </Td>
                        <Td>
                          {row.manual
                            ? "Unknown"
                            : money(row.orderQuantity * row.costEach)}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: "22px" }}>
                <label style={labelStyle}>Order Notes</label>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Supplier notes or delivery instructions"
                  style={{
                    ...fieldStyle,
                    minHeight: "90px",
                    resize: "vertical",
                  }}
                />
              </div>

              <div style={totalStyle}>
                Estimated Order Cost: {money(order.cost)}
              </div>
              <div style={helpStyle}>
                Uses Stock Cost only. Production costs are not included.
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

function SummaryCard({ title, value }) {
  return (
    <div style={summaryCardStyle}>
      <div style={{ color: "#666", fontSize: "13px", marginBottom: "6px" }}>
        {title}
      </div>
      <div style={{ fontSize: "24px", fontWeight: "700" }}>{value}</div>
    </div>
  );
}

function Th({ children }) {
  return <th style={{ padding: "13px", whiteSpace: "nowrap" }}>{children}</th>;
}

function Td({ children }) {
  return (
    <td style={{ padding: "13px", fontSize: "14px", verticalAlign: "top" }}>
      {children}
    </td>
  );
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
const headingStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  flexWrap: "wrap",
  gap: "16px",
  marginBottom: "24px",
};
const panelStyle = {
  background: "#fff",
  padding: "26px",
  borderRadius: "14px",
  boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
};
const detailsGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "16px",
  marginBottom: "18px",
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
const primaryButtonStyle = {
  border: 0,
  borderRadius: "8px",
  background: "#111",
  color: "#fff",
  padding: "12px 15px",
  fontWeight: "700",
  cursor: "pointer",
};
const secondaryButtonStyle = {
  ...primaryButtonStyle,
  border: "1px solid #aaa",
  background: "#fff",
  color: "#111",
};
const summaryGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
  gap: "12px",
  marginBottom: "20px",
};
const summaryCardStyle = {
  background: "#fafafa",
  border: "1px solid #eee",
  padding: "16px",
  borderRadius: "9px",
};
const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
  minWidth: "1000px",
};
const warningStyle = {
  padding: "12px 14px",
  marginBottom: "16px",
  background: "#fff8df",
  border: "1px solid #ead99f",
  borderRadius: "8px",
  color: "#6b4e00",
};
const messageStyle = {
  padding: "12px 14px",
  marginBottom: "16px",
  borderRadius: "8px",
  background: "#eefaf0",
  color: "#166534",
  fontWeight: "600",
};
const emptyStyle = {
  padding: "28px",
  textAlign: "center",
  color: "#666",
};
const subTextStyle = {
  color: "#666",
  fontSize: "12px",
  marginTop: "3px",
};
const totalStyle = {
  marginTop: "22px",
  textAlign: "right",
  fontSize: "22px",
  fontWeight: "700",
};
const helpStyle = {
  color: "#666",
  fontSize: "13px",
  textAlign: "right",
  marginTop: "6px",
};
