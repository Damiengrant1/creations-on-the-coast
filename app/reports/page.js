"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

function localDate(value = new Date()) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

function yearStart() {
  const now = new Date();
  return `${now.getFullYear()}-01-01`;
}

function money(value) {
  return `£${Number(value || 0).toFixed(2)}`;
}

function csvValue(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export default function ReportsPage() {
  const [fromDate, setFromDate] = useState(yearStart());
  const [toDate, setToDate] = useState(localDate());
  const [sales, setSales] = useState([]);
  const [saleItems, setSaleItems] = useState([]);
  const [products, setProducts] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [events, setEvents] = useState([]);
  const [stock, setStock] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError("");

    const results = await Promise.all([
      supabase.from("sales").select("id, sale_number, sale_datetime, customer_reference, sales_channel, payment_method, event_id"),
      supabase.from("sale_items").select("id, sale_id, product_id, quantity, line_revenue, line_cost, gross_profit"),
      supabase.from("products").select("id, product_name, sku, category, colour, size, track_stock"),
      supabase.from("expenses").select("id, expense_date, category, description, amount, event_id"),
      supabase.from("events").select("id, event_name, start_date, status"),
      supabase.from("current_stock").select("product_id, product_name, sku, category, active, current_stock, stock_value"),
    ]);

    const firstError = results.find((result) => result.error)?.error;
    if (firstError) {
      setError(`Could not load reports: ${firstError.message}`);
      setLoading(false);
      return;
    }

    setSales(results[0].data || []);
    setSaleItems(results[1].data || []);
    setProducts(results[2].data || []);
    setExpenses(results[3].data || []);
    setEvents(results[4].data || []);
    setStock(results[5].data || []);
    setLoading(false);
  }

  const report = useMemo(() => {
    const filteredSales = sales.filter((sale) => {
      const day = sale.sale_datetime?.slice(0, 10);
      return day >= fromDate && day <= toDate;
    });
    const saleIds = new Set(filteredSales.map((sale) => sale.id));
    const filteredItems = saleItems.filter((item) => saleIds.has(item.sale_id));
    const filteredExpenses = expenses.filter(
      (expense) => expense.expense_date >= fromDate && expense.expense_date <= toDate
    );
    const saleById = new Map(filteredSales.map((sale) => [sale.id, sale]));
    const productById = new Map(products.map((product) => [product.id, product]));
    const eventById = new Map(events.map((event) => [event.id, event]));

    const totalSales = filteredItems.reduce((sum, item) => sum + Number(item.line_revenue || 0), 0);
    const directCost = filteredItems.reduce((sum, item) => sum + Number(item.line_cost || 0), 0);
    const grossProfit = totalSales - directCost;
    const totalExpenses = filteredExpenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);

    const productRows = aggregate(filteredItems, (item) => {
      const product = productById.get(item.product_id);
      return {
        key: item.product_id,
        name: [product?.product_name || "Unknown product", product?.colour, product?.size].filter(Boolean).join(" / "),
        category: product?.category || "Uncategorised",
        quantity: Number(item.quantity || 0),
        sales: Number(item.line_revenue || 0),
        cost: Number(item.line_cost || 0),
      };
    });

    const channelRows = aggregate(filteredItems, (item) => {
      const sale = saleById.get(item.sale_id);
      return {
        key: sale?.sales_channel || "Unspecified",
        name: sale?.sales_channel || "Unspecified",
        quantity: Number(item.quantity || 0),
        sales: Number(item.line_revenue || 0),
        cost: Number(item.line_cost || 0),
      };
    });

    const categoryMap = new Map();
    filteredExpenses.forEach((expense) => {
      const name = expense.category || "Uncategorised";
      categoryMap.set(name, (categoryMap.get(name) || 0) + Number(expense.amount || 0));
    });
    const expenseRows = [...categoryMap.entries()]
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);

    const eventMap = new Map();
    filteredItems.forEach((item) => {
      const sale = saleById.get(item.sale_id);
      if (!sale?.event_id) return;
      const event = eventById.get(sale.event_id);
      const row = eventMap.get(sale.event_id) || {
        name: event?.event_name || "Unknown event",
        sales: 0, cost: 0, expenses: 0,
      };
      row.sales += Number(item.line_revenue || 0);
      row.cost += Number(item.line_cost || 0);
      eventMap.set(sale.event_id, row);
    });
    filteredExpenses.forEach((expense) => {
      if (!expense.event_id) return;
      const event = eventById.get(expense.event_id);
      const row = eventMap.get(expense.event_id) || {
        name: event?.event_name || "Unknown event",
        sales: 0, cost: 0, expenses: 0,
      };
      row.expenses += Number(expense.amount || 0);
      eventMap.set(expense.event_id, row);
    });
    const eventRows = [...eventMap.values()]
      .map((row) => ({ ...row, gross: row.sales - row.cost, net: row.sales - row.cost - row.expenses }))
      .sort((a, b) => b.net - a.net);

    return {
      totalSales,
      directCost,
      grossProfit,
      totalExpenses,
      netProfit: grossProfit - totalExpenses,
      transactionCount: filteredSales.length,
      productRows,
      channelRows,
      expenseRows,
      eventRows,
    };
  }, [sales, saleItems, products, expenses, events, fromDate, toDate]);

  const stockValue = useMemo(
    () => stock.reduce((sum, row) => sum + Number(row.stock_value || 0), 0),
    [stock]
  );

  function exportCsv() {
    const rows = [
      ["Creations on the Coast Profitability Report"],
      ["From", fromDate, "To", toDate],
      [],
      ["Summary", "Amount"],
      ["Sales", report.totalSales],
      ["Direct Costs", report.directCost],
      ["Gross Profit", report.grossProfit],
      ["Other Expenses", report.totalExpenses],
      ["Net Profit", report.netProfit],
      ["Current Stock Value", stockValue],
      [],
      ["Product", "Category", "Quantity", "Sales", "Direct Cost", "Gross Profit"],
      ...report.productRows.map((row) => [row.name, row.category, row.quantity, row.sales, row.cost, row.sales - row.cost]),
      [],
      ["Expense Category", "Amount"],
      ...report.expenseRows.map((row) => [row.name, row.amount]),
    ];
    const csv = rows.map((row) => row.map(csvValue).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `creations-report-${fromDate}-to-${toDate}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main style={pageStyle}>
      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
        <Link href="/" style={{ display: "inline-block", marginBottom: "24px", color: "#333" }}>← Back to Dashboard</Link>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "18px", flexWrap: "wrap", alignItems: "flex-end", marginBottom: "24px" }}>
          <div>
            <h1 style={{ fontSize: "36px", margin: "0 0 8px" }}>Reports & Profitability</h1>
            <p style={{ color: "#666", margin: 0 }}>Review business performance for any date range.</p>
          </div>
          <button type="button" onClick={exportCsv} disabled={loading || !!error} style={buttonStyle}>Download CSV</button>
        </div>

        <div style={{ ...cardStyle, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "16px", marginBottom: "22px" }}>
          <Field label="From"><input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={fieldStyle} /></Field>
          <Field label="To"><input type="date" value={toDate} min={fromDate} onChange={(e) => setToDate(e.target.value)} style={fieldStyle} /></Field>
          <div style={{ display: "flex", alignItems: "flex-end" }}><button type="button" onClick={() => { setFromDate(yearStart()); setToDate(localDate()); }} style={{ ...buttonStyle, width: "100%" }}>This Year</button></div>
        </div>

        {error && <div style={errorStyle}>{error}</div>}
        {loading ? <div style={cardStyle}>Loading reports...</div> : !error && <>
          <div style={summaryGridStyle}>
            <Summary title="Sales" value={money(report.totalSales)} note={`${report.transactionCount} sales`} />
            <Summary title="Direct Costs" value={money(report.directCost)} />
            <Summary title="Gross Profit" value={money(report.grossProfit)} />
            <Summary title="Other Expenses" value={money(report.totalExpenses)} />
            <Summary title="Net Profit" value={money(report.netProfit)} featured />
            <Summary title="Current Stock Value" value={money(stockValue)} note="At today's stock levels" />
          </div>

          <ReportTable title="Sales by Product" empty="No product sales in this period." headings={["Product", "Category", "Qty", "Sales", "Direct Cost", "Gross Profit"]}>
            {report.productRows.map((row) => <tr key={row.key} style={rowStyle}><Td>{row.name}</Td><Td>{row.category}</Td><Td>{row.quantity}</Td><Td>{money(row.sales)}</Td><Td>{money(row.cost)}</Td><Td strong>{money(row.sales - row.cost)}</Td></tr>)}
          </ReportTable>

          <div style={twoColumnStyle}>
            <ReportTable title="Sales by Channel" empty="No sales in this period." headings={["Channel", "Qty", "Sales", "Gross Profit"]}>
              {report.channelRows.map((row) => <tr key={row.key} style={rowStyle}><Td>{row.name}</Td><Td>{row.quantity}</Td><Td>{money(row.sales)}</Td><Td strong>{money(row.sales - row.cost)}</Td></tr>)}
            </ReportTable>
            <ReportTable title="Expenses by Category" empty="No expenses in this period." headings={["Category", "Amount"]}>
              {report.expenseRows.map((row) => <tr key={row.name} style={rowStyle}><Td>{row.name}</Td><Td strong>{money(row.amount)}</Td></tr>)}
            </ReportTable>
          </div>

          <ReportTable title="Event Profitability" empty="No event-linked sales or expenses in this period." headings={["Event", "Sales", "Direct Cost", "Gross Profit", "Expenses", "Net Profit"]}>
            {report.eventRows.map((row) => <tr key={row.name} style={rowStyle}><Td>{row.name}</Td><Td>{money(row.sales)}</Td><Td>{money(row.cost)}</Td><Td>{money(row.gross)}</Td><Td>{money(row.expenses)}</Td><Td strong>{money(row.net)}</Td></tr>)}
          </ReportTable>

          <ReportTable title="Current Stock Valuation" subtitle="Uses Stock Cost only, not production cost." empty="No tracked stock found." headings={["Product", "SKU", "Category", "Qty", "Stock Value"]}>
            {stock.filter((row) => row.active !== false).sort((a, b) => Number(b.stock_value || 0) - Number(a.stock_value || 0)).map((row) => <tr key={row.product_id} style={rowStyle}><Td>{row.product_name}</Td><Td>{row.sku || "—"}</Td><Td>{row.category || "—"}</Td><Td>{Number(row.current_stock || 0)}</Td><Td strong>{money(row.stock_value)}</Td></tr>)}
          </ReportTable>
        </>}
      </div>
    </main>
  );
}

function aggregate(items, makeRow) {
  const map = new Map();
  items.forEach((item) => {
    const next = makeRow(item);
    const current = map.get(next.key) || { ...next, quantity: 0, sales: 0, cost: 0 };
    current.quantity += next.quantity;
    current.sales += next.sales;
    current.cost += next.cost;
    map.set(next.key, current);
  });
  return [...map.values()].sort((a, b) => b.sales - a.sales);
}

function Field({ label, children }) { return <div><label style={{ display: "block", fontWeight: "600", marginBottom: "6px" }}>{label}</label>{children}</div>; }
function Summary({ title, value, note, featured }) { return <div style={{ ...cardStyle, background: featured ? "#111" : "#fff", color: featured ? "#fff" : "#111" }}><div style={{ color: featured ? "#ccc" : "#666", fontSize: "14px", marginBottom: "8px" }}>{title}</div><div style={{ fontSize: "27px", fontWeight: "700" }}>{value}</div>{note && <div style={{ color: featured ? "#bbb" : "#777", fontSize: "12px", marginTop: "7px" }}>{note}</div>}</div>; }
function ReportTable({ title, subtitle, empty, headings, children }) {
  const hasRows = Array.isArray(children) ? children.length > 0 : !!children;
  return <section style={{ ...cardStyle, padding: 0, overflowX: "auto", marginBottom: "22px" }}><div style={{ padding: "22px 24px" }}><h2 style={{ margin: "0 0 5px", fontSize: "21px" }}>{title}</h2>{subtitle && <div style={{ color: "#666", fontSize: "13px" }}>{subtitle}</div>}</div>{!hasRows ? <div style={{ padding: "0 24px 24px", color: "#666" }}>{empty}</div> : <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "600px" }}><thead><tr style={{ textAlign: "left", background: "#fafafa" }}>{headings.map((heading) => <th key={heading} style={thStyle}>{heading}</th>)}</tr></thead><tbody>{children}</tbody></table>}</section>;
}
function Td({ children, strong }) { return <td style={{ padding: "13px 15px", fontSize: "14px", whiteSpace: "nowrap", fontWeight: strong ? "700" : "400" }}>{children}</td>; }

const pageStyle = { minHeight: "100vh", background: "#f7f7f8", padding: "40px 20px", fontFamily: "Arial, sans-serif" };
const cardStyle = { background: "#fff", padding: "22px", borderRadius: "12px", boxShadow: "0 2px 10px rgba(0,0,0,0.06)" };
const fieldStyle = { width: "100%", padding: "12px", border: "1px solid #ddd", borderRadius: "8px", fontSize: "16px", boxSizing: "border-box", background: "#fff" };
const buttonStyle = { padding: "12px 17px", border: "none", borderRadius: "8px", background: "#111", color: "#fff", fontWeight: "700", cursor: "pointer" };
const summaryGridStyle = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "15px", marginBottom: "22px" };
const twoColumnStyle = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: "22px" };
const thStyle = { padding: "13px 15px", fontSize: "13px", whiteSpace: "nowrap" };
const rowStyle = { borderTop: "1px solid #eee" };
const errorStyle = { padding: "14px 16px", marginBottom: "20px", borderRadius: "9px", background: "#fff0f0", color: "#9b1c1c", border: "1px solid #f1c1c1", fontWeight: "600" };
