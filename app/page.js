"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAccess } from "./AuthGate";

const buttons = [
  ["Jobs", "/jobs"],
  ["Record Sale", "/record-sale"],
  ["Products & Stock", "/products"],
  ["Stocktake / Adjustments", "/stocktake"],
  ["Stock Purchases", "/stock-purchases"],
  ["Events", "/events"],
  ["Expenses", "/expenses"],
  ["Cash Flow", "/cash-flow"],
  ["Manage Transactions", "/transactions"],
  ["Reports", "/reports"],
  ["Shopify", "/shopify"],
];

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function isJwtTimingError(error) {
  return error?.message?.toLowerCase().includes("jwt issued at future");
}

async function fetchDashboardFigures() {
  return Promise.all([
    supabase.from("sale_totals").select("total_sales, gross_profit"),
    supabase.from("expenses").select("amount"),
    supabase
      .from("account_balances")
      .select("account_id, account_name, account_type, current_balance")
      .order("account_name"),
  ]);
}

export default function HomePage() {
  const { isAdmin } = useAccess();
  const [figures, setFigures] = useState({
    sales: 0,
    grossProfit: 0,
    expenses: 0,
    netProfit: 0,
    cash: 0,
    accounts: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    setLoading(true);
    setError("");

    let results = await fetchDashboardFigures();
    let firstError = results.find((result) => result.error)?.error;

    if (isJwtTimingError(firstError)) {
      await supabase.auth.refreshSession();
      await wait(3000);
      results = await fetchDashboardFigures();
      firstError = results.find((result) => result.error)?.error;
    }

    if (firstError) {
      setError(`Could not load dashboard figures: ${firstError.message}`);
      setLoading(false);
      return;
    }

    const [salesResult, expensesResult, accountsResult] = results;

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
      accounts: accountsResult.data || [],
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

        {error && (
          <div style={errorStyle}>
            <div>{error}</div>
            <button type="button" onClick={loadDashboard} style={retryStyle}>
              Try Again
            </button>
          </div>
        )}

        <div style={summaryGridStyle}>
          <SummaryCard title="Total Sales" value={loading ? "..." : money(figures.sales)} />
          <SummaryCard title="Gross Profit" value={loading ? "..." : money(figures.grossProfit)} />
          <SummaryCard title="Expenses" value={loading ? "..." : money(figures.expenses)} />
          <SummaryCard title="Net Profit" value={loading ? "..." : money(figures.netProfit)} />
          <SummaryCard title="Cash Balance" value={loading ? "..." : money(figures.cash)} />
        </div>

        <div style={{ ...managementStyle, marginBottom: "32px" }}>
          <h2 style={{ margin: "0 0 8px", fontSize: "24px" }}>
            Money Held by Account
          </h2>
          <p style={{ color: "#666", margin: "0 0 20px" }}>
            Current balance in each business account.
          </p>
          <div style={summaryGridStyle}>
            {loading ? (
              <SummaryCard title="Accounts" value="..." />
            ) : figures.accounts.length === 0 ? (
              <div style={{ color: "#666" }}>No accounts have been added yet.</div>
            ) : (
              figures.accounts.map((account) => (
                <SummaryCard
                  key={account.account_id}
                  title={account.account_name}
                  value={money(account.current_balance)}
                  detail={account.account_type}
                />
              ))
            )}
          </div>
        </div>

        <div style={managementStyle}>
          <h2 style={{ margin: "0 0 20px", fontSize: "24px" }}>
            Business Management
          </h2>
          <div style={buttonGridStyle}>
            {buttons.filter(([label]) => isAdmin || label === "Jobs" || label === "Products & Stock").map(([label, href]) => (
              <Link key={label} href={href} style={linkStyle}>
                {label}
              </Link>
            ))}
          </div>
        </div>

        <div style={footerStyle}>Creations on the Coast Ltd</div>
      </div>
    </main>
  );
}

function money(value) {
  return `£${Number(value || 0).toFixed(2)}`;
}

function SummaryCard({ title, value, detail = "" }) {
  return (
    <div style={cardStyle}>
      <div style={{ color: "#666", marginBottom: "8px", fontSize: "14px" }}>
        {title}
      </div>
      <div style={{ fontSize: "28px", fontWeight: "700" }}>{value}</div>
      {detail && (
        <div style={{ color: "#777", marginTop: "7px", fontSize: "13px" }}>
          {detail}
        </div>
      )}
    </div>
  );
}

const pageStyle = {
  minHeight: "100vh",
  background: "#f7f7f8",
  padding: "40px 20px",
  fontFamily: "Arial, sans-serif",
};

const summaryGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: "16px",
  marginBottom: "32px",
};

const cardStyle = {
  background: "#fff",
  padding: "22px",
  borderRadius: "12px",
  boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
};

const managementStyle = {
  background: "#fff",
  padding: "28px",
  borderRadius: "14px",
  boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
};

const buttonGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: "14px",
};

const linkStyle = {
  padding: "16px",
  borderRadius: "9px",
  background: "#111",
  color: "#fff",
  textAlign: "center",
  textDecoration: "none",
  fontWeight: "700",
};

const errorStyle = {
  padding: "14px 16px",
  marginBottom: "20px",
  borderRadius: "9px",
  background: "#fff0f0",
  color: "#9b1c1c",
  border: "1px solid #f1c1c1",
  fontWeight: "600",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
};

const retryStyle = {
  border: "1px solid #9b1c1c",
  borderRadius: "7px",
  background: "#fff",
  color: "#9b1c1c",
  padding: "8px 12px",
  fontWeight: "700",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const footerStyle = {
  marginTop: "18px",
  color: "#777",
  fontSize: "13px",
  textAlign: "center",
};
