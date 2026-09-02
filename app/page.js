"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

const buttons = [
  ["Record Sale", "/record-sale"],
  ["Products & Stock", "/products"],
  ["Stocktake / Adjustments", "/stocktake"],
  ["Stock Purchases", "/stock-purchases"],
  ["Events", "/events"],
  ["Expenses", "/expenses"],
  ["Cash Flow", "/cash-flow"],
  ["Reports", "/reports"],
];

export default function HomePage() {
  const [figures, setFigures] = useState({
    sales: 0,
    grossProfit: 0,
    expenses: 0,
    netProfit: 0,
    cash: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    const [salesResult, expensesResult, accountsResult] = await Promise.all([
      supabase.from("sale_totals").select("total_sales, gross_profit"),
      supabase.from("expenses").select("amount"),
      supabase.from("account_balances").select("current_balance"),
    ]);

    const firstError =
      salesResult.error || expensesResult.error || accountsResult.error;

    if (firstError) {
      setError(`Could not load dashboard figures: ${firstError.message}`);
      setLoading(false);
      return;
    }

    const sales = (salesResult.data || []).reduce(
      (sum, row) => sum + Number(row.total_sales || 0),
      0
    );
    const grossProfit = (salesResult.data || []).reduce(
      (sum, row) => sum + Number(row.gross_profit || 0),
      0
    );
    const expenses = (expensesResult.data || []).reduce(
      (sum, row) => sum + Number(row.amount || 0),
      0
    );
    const cash = (accountsResult.data || []).reduce(
      (sum, row) => sum + Number(row.current_balance || 0),
      0
    );

    setFigures({
      sales,
      grossProfit,
      expenses,
      netProfit: grossProfit - expenses,
      cash,
    });
    setLoading(false);
  }

  return (
    <main style={pageStyle}>
      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
        <div style={{ marginBottom: "32px" }}>
          <h1 style={{ fontSize: "40px", margin: "0 0 8px" }}>
            Creations on the Coast
          </h1>
          <p style={{ color: "#666", fontSize: "17px", margin: 0 }}>
            Business Dashboard
          </p>
        </div>

        {error && <div style={errorStyle}>{error}</div>}

        <div style={summaryGridStyle}>
          <SummaryCard title="Total Sales" value={loading ? "..." : money(figures.sales)} />
          <SummaryCard title="Gross Profit" value={loading ? "..." : money(figures.grossProfit)} />
          <SummaryCard title="Expenses" value={loading ? "..." : money(figures.expenses)} />
          <SummaryCard title="Net Profit" value={loading ? "..." : money(figures.netProfit)} />
          <SummaryCard title="Cash Balance" value={loading ? "..." : money(figures.cash)} />
        </div>

        <div style={managementStyle}>
          <h2 style={{ margin: "0 0 20px", fontSize: "24px" }}>
            Business Management
          </h2>
          <div style={buttonGridStyle}>
            {buttons.map(([label, href]) => (
              <Link key={label} href={href} style={linkStyle}>
                {label}
              </Link>
            ))}
          </div>
        </div>

        <div style={{ marginTop: "18px", color: "#777", fontSize: "13px", textAlign: "center" }}>
          Creations on the Coast Ltd
        </div>
      </div>
    </main>
  );
}

function money(value) {
  return `£${Number(value || 0).toFixed(2)}`;
}

function SummaryCard({ title, value }) {
  return (
    <div style={cardStyle}>
      <div style={{ color: "#666", marginBottom: "8px", fontSize: "14px" }}>
        {title}
      </div>
      <div style={{ fontSize: "28px", fontWeight: "700" }}>{value}</div>
    </div>
  );
}

const pageStyle = { minHeight: "100vh", background: "#f7f7f8", padding: "40px 20px", fontFamily: "Arial, sans-serif" };
const summaryGridStyle = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px", marginBottom: "32px" };
const cardStyle = { background: "#fff", padding: "22px", borderRadius: "12px", boxShadow: "0 2px 10px rgba(0,0,0,0.06)" };
const managementStyle = { background: "#fff", padding: "28px", borderRadius: "14px", boxShadow: "0 2px 10px rgba(0,0,0,0.06)" };
const buttonGridStyle = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "14px" };
const linkStyle = { padding: "16px", borderRadius: "9px", background: "#111", color: "#fff", textAlign: "center", textDecoration: "none", fontWeight: "700" };
const errorStyle = { padding: "14px 16px", marginBottom: "20px", borderRadius: "9px", background: "#fff0f0", color: "#9b1c1c", border: "1px solid #f1c1c1", fontWeight: "600" };
