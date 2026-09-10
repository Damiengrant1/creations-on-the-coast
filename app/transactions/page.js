"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

const tabs = [
  ["sales", "Sales"],
  ["purchases", "Stock Purchases"],
  ["expenses", "Expenses"],
  ["transfers", "Transfers"],
  ["director", "Director Money"],
  ["accounts", "Accounts"],
];

const deleteSettings = {
  sales: ["delete_sale_safely", "p_sale_id", "sale"],
  purchases: ["delete_stock_purchase_safely", "p_purchase_id", "stock purchase"],
  expenses: ["delete_expense_safely", "p_expense_id", "expense"],
  transfers: ["delete_transfer_safely", "p_transfer_id", "transfer"],
  director: ["delete_director_transaction_safely", "p_transaction_id", "director transaction"],
  accounts: ["delete_unused_account_safely", "p_account_id", "account"],
};

function money(value) {
  return `£${Number(value || 0).toFixed(2)}`;
}

function date(value) {
  return value ? new Date(value).toLocaleString("en-GB") : "—";
}

function dateForInput(value) {
  return value ? String(value).slice(0, 10) : "";
}

function dateTimeForInput(value) {
  if (!value) return "";
  const valueDate = new Date(value);
  const offset = valueDate.getTimezoneOffset();
  return new Date(valueDate.getTime() - offset * 60000)
    .toISOString()
    .slice(0, 16);
}

export default function TransactionsPage() {
  const [activeTab, setActiveTab] = useState("sales");
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [editing, setEditing] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError("");

    const queries = await Promise.all([
      supabase.from("accounts").select("id, account_name, account_type, opening_balance, active, notes").order("account_name"),
      supabase.from("products").select("id, product_name, sku, colour, size"),
      supabase.from("events").select("id, event_name, start_date, status").neq("status", "cancelled").order("start_date", { ascending: false }),
      supabase.from("sales").select("id, sale_number, sale_datetime, customer_reference, sales_channel, payment_method, account_id, notes, created_at").order("sale_datetime", { ascending: false }),
      supabase.from("sale_items").select("id, sale_id, product_id, quantity, selling_price_each, cost_price_each, line_revenue, line_cost, gross_profit"),
      supabase.from("stock_purchases").select("id, purchase_date, supplier, account_id, reference, notes, created_at").order("purchase_date", { ascending: false }),
      supabase.from("stock_purchase_items").select("id, stock_purchase_id, product_id, quantity, cost_per_unit, line_total"),
      supabase.from("expenses").select("id, expense_date, category, description, amount, supplier, account_id, event_id, reference, notes, created_at").order("expense_date", { ascending: false }),
      supabase.from("transfers").select("id, transfer_date, from_account_id, to_account_id, gross_amount, fee_amount, net_amount, reference, notes, created_at").order("transfer_date", { ascending: false }),
      supabase.from("director_transactions").select("id, transaction_date, transaction_type, amount, account_id, reference, notes, created_at").order("transaction_date", { ascending: false }),
    ]);

    const firstError = queries.find((query) => query.error)?.error;
    if (firstError) {
      setError(`Could not load transactions: ${firstError.message}`);
      setLoading(false);
      return;
    }

    setData({
      accounts: queries[0].data || [],
      products: queries[1].data || [],
      events: queries[2].data || [],
      sales: queries[3].data || [],
      saleItems: queries[4].data || [],
      purchases: queries[5].data || [],
      purchaseItems: queries[6].data || [],
      expenses: queries[7].data || [],
      transfers: queries[8].data || [],
      director: queries[9].data || [],
    });
    setLoading(false);
  }

  const accountNames = useMemo(
    () => new Map((data.accounts || []).map((item) => [item.id, item.account_name])),
    [data.accounts]
  );
  const productNames = useMemo(
    () => new Map((data.products || []).map((item) => [item.id, [item.product_name, item.colour, item.size, item.sku].filter(Boolean).join(" / ")])),
    [data.products]
  );
  const activeAccounts = useMemo(
    () => (data.accounts || []).filter((account) => account.active),
    [data.accounts]
  );

  async function deleteRecord(id) {
    const [rpc, parameter, label] = deleteSettings[activeTab];
    const warning = activeTab === "accounts"
      ? `Delete this ${label}? This only works when it has no linked transactions.`
      : `Delete this ${label}? Its linked cash and stock records will also be safely reversed. This cannot be undone.`;

    if (!window.confirm(warning)) return;

    setDeletingId(id);
    setMessage("");
    setError("");
    const { error: deleteError } = await supabase.rpc(rpc, { [parameter]: id });
    if (deleteError) {
      setError(`Could not delete ${label}: ${deleteError.message}`);
      setDeletingId("");
      return;
    }

    setMessage(`${label.charAt(0).toUpperCase() + label.slice(1)} deleted safely.`);
    setDeletingId("");
    await loadData();
  }

  function startEdit(type, record) {
    setMessage("");
    setError("");

    if (type === "expenses") {
      setEditing({
        type,
        id: record.id,
        expenseDate: dateForInput(record.expense_date),
        category: record.category || "",
        description: record.description || "",
        amount: String(record.amount || ""),
        supplier: record.supplier || "",
        accountId: record.account_id || "",
        eventId: record.event_id || "",
        reference: record.reference || "",
        notes: record.notes || "",
      });
    }

    if (type === "transfers") {
      setEditing({
        type,
        id: record.id,
        transferDate: dateTimeForInput(record.transfer_date),
        fromAccountId: record.from_account_id || "",
        toAccountId: record.to_account_id || "",
        grossAmount: String(record.gross_amount || ""),
        feeAmount: String(record.fee_amount || 0),
        reference: record.reference || "",
        notes: record.notes || "",
      });
    }
  }

  function updateEditing(field, value) {
    setEditing((current) => ({ ...current, [field]: value }));
  }

  async function saveEdit(event) {
    event.preventDefault();
    setMessage("");
    setError("");

    if (!editing) return;

    if (editing.type === "expenses") {
      if (!editing.expenseDate || !editing.category.trim() || Number(editing.amount) <= 0) {
        setError("Enter an expense date, category and amount greater than zero.");
        return;
      }
    }

    if (editing.type === "transfers") {
      if (!editing.transferDate || !editing.fromAccountId || !editing.toAccountId) {
        setError("Select the transfer date and both accounts.");
        return;
      }
      if (editing.fromAccountId === editing.toAccountId) {
        setError("The transfer accounts must be different.");
        return;
      }
      if (Number(editing.grossAmount) <= 0 || Number(editing.feeAmount || 0) < 0 || Number(editing.feeAmount || 0) > Number(editing.grossAmount)) {
        setError("Enter a valid transfer amount and fee.");
        return;
      }
    }

    setSavingEdit(true);

    const request = editing.type === "expenses"
      ? supabase.rpc("update_expense_safely", {
          p_expense_id: editing.id,
          p_expense_date: editing.expenseDate,
          p_category: editing.category.trim(),
          p_description: editing.description,
          p_amount: Number(editing.amount),
          p_supplier: editing.supplier,
          p_account_id: editing.accountId || null,
          p_event_id: editing.eventId || null,
          p_reference: editing.reference,
          p_notes: editing.notes,
        })
      : supabase.rpc("update_transfer_safely", {
          p_transfer_id: editing.id,
          p_transfer_date: new Date(editing.transferDate).toISOString(),
          p_from_account_id: editing.fromAccountId,
          p_to_account_id: editing.toAccountId,
          p_gross_amount: Number(editing.grossAmount),
          p_fee_amount: Number(editing.feeAmount || 0),
          p_reference: editing.reference,
          p_notes: editing.notes,
        });

    const { error: saveError } = await request;
    if (saveError) {
      setError(`Could not save changes: ${saveError.message}`);
      setSavingEdit(false);
      return;
    }

    const label = editing.type === "expenses" ? "Expense" : "Transfer";
    setEditing(null);
    setSavingEdit(false);
    setMessage(`${label} updated safely.`);
    await loadData();
  }

  function itemsFor(parentId, type) {
    const list = type === "sales" ? data.saleItems || [] : data.purchaseItems || [];
    const key = type === "sales" ? "sale_id" : "stock_purchase_id";
    return list.filter((item) => item[key] === parentId);
  }

  const records = data[activeTab] || [];
  const currentLabel = tabs.find(([key]) => key === activeTab)?.[1].toLowerCase();

  return (
    <main style={pageStyle}>
      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
        <Link href="/" style={{ display: "inline-block", marginBottom: "24px", color: "#333" }}>← Back to Dashboard</Link>
        <h1 style={{ fontSize: "36px", margin: "0 0 8px" }}>Manage Transactions</h1>
        <p style={{ color: "#666", margin: "0 0 18px" }}>Review entries, edit expenses and transfers, and safely remove mistakes or test data.</p>

        <div style={noticeStyle}><strong>Important:</strong> Use these controls rather than deleting database rows manually. Linked cash, stock and fee records are handled together.</div>
        {message && <div style={{ ...alertStyle, background: "#edf9f0", color: "#176b31", borderColor: "#bfe2c8" }}>{message}</div>}
        {error && <div style={{ ...alertStyle, background: "#fff0f0", color: "#9b1c1c", borderColor: "#f1c1c1" }}>{error}</div>}

        <div style={{ display: "flex", gap: "9px", flexWrap: "wrap", marginBottom: "18px" }}>
          {tabs.map(([key, label]) => <button key={key} type="button" onClick={() => { setActiveTab(key); setEditing(null); setMessage(""); setError(""); }} style={tabStyle(activeTab === key)}>{label}</button>)}
        </div>

        {editing && <EditPanel editing={editing} onChange={updateEditing} onCancel={() => setEditing(null)} onSave={saveEdit} saving={savingEdit} accounts={activeAccounts} events={data.events || []} />}

        {loading ? <div style={panelStyle}>Loading transactions...</div> : records.length === 0 ? <div style={panelStyle}>No {currentLabel} found.</div> : (
          <div style={{ display: "grid", gap: "14px" }}>
            {records.map((record) => {
              const lineItems = ["sales", "purchases"].includes(activeTab) ? itemsFor(record.id, activeTab) : [];
              const canEdit = ["expenses", "transfers"].includes(activeTab);
              return (
                <section key={record.id} style={panelStyle}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "18px", alignItems: "flex-start", flexWrap: "wrap" }}>
                    <div style={{ flex: "1 1 650px" }}><RecordDetails type={activeTab} record={record} accountNames={accountNames} total={lineItems.reduce((sum, item) => sum + Number(activeTab === "sales" ? item.line_revenue : item.line_total || 0), 0)} /></div>
                    <div style={{ display: "flex", gap: "9px", flexWrap: "wrap" }}>
                      {canEdit && <button type="button" onClick={() => startEdit(activeTab, record)} style={editButtonStyle}>Edit</button>}
                      <button type="button" disabled={deletingId === record.id} onClick={() => deleteRecord(record.id)} style={deleteButtonStyle}>{deletingId === record.id ? "Deleting..." : "Delete Safely"}</button>
                    </div>
                  </div>
                  {lineItems.length > 0 && <div style={{ borderTop: "1px solid #eee", marginTop: "16px", paddingTop: "12px" }}>{lineItems.map((item) => <div key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: "16px", padding: "5px 0", color: "#555" }}><span>{item.quantity} × {productNames.get(item.product_id) || "Unknown product"}</span><strong>{money(activeTab === "sales" ? item.line_revenue : item.line_total)}</strong></div>)}</div>}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

function EditPanel({ editing, onChange, onCancel, onSave, saving, accounts, events }) {
  return (
    <form onSubmit={onSave} style={{ ...panelStyle, marginBottom: "18px", border: "2px solid #111" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "16px", alignItems: "center", flexWrap: "wrap", marginBottom: "18px" }}>
        <div><h2 style={{ margin: 0 }}>Edit {editing.type === "expenses" ? "Expense" : "Transfer"}</h2><div style={{ color: "#666", fontSize: "14px", marginTop: "5px" }}>The linked cash records will be updated at the same time.</div></div>
        <button type="button" onClick={onCancel} style={cancelButtonStyle}>Cancel</button>
      </div>
      {editing.type === "expenses" ? (
        <div style={formGridStyle}>
          <Field label="Expense Date"><input type="date" value={editing.expenseDate} onChange={(event) => onChange("expenseDate", event.target.value)} style={fieldStyle} required /></Field>
          <Field label="Category"><input value={editing.category} onChange={(event) => onChange("category", event.target.value)} style={fieldStyle} required /></Field>
          <Field label="Amount (£)"><input type="number" min="0.01" step="0.01" value={editing.amount} onChange={(event) => onChange("amount", event.target.value)} style={fieldStyle} required /></Field>
          <Field label="Paid From"><select value={editing.accountId} onChange={(event) => onChange("accountId", event.target.value)} style={fieldStyle}><option value="">No account selected</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.account_name}</option>)}</select></Field>
          <Field label="Event"><select value={editing.eventId} onChange={(event) => onChange("eventId", event.target.value)} style={fieldStyle}><option value="">Not linked to an event</option>{events.map((event) => <option key={event.id} value={event.id}>{event.event_name} — {event.start_date}</option>)}</select></Field>
          <Field label="Supplier"><input value={editing.supplier} onChange={(event) => onChange("supplier", event.target.value)} style={fieldStyle} /></Field>
          <Field label="Reference"><input value={editing.reference} onChange={(event) => onChange("reference", event.target.value)} style={fieldStyle} /></Field>
          <Field label="Description"><input value={editing.description} onChange={(event) => onChange("description", event.target.value)} style={fieldStyle} /></Field>
          <Field label="Notes"><input value={editing.notes} onChange={(event) => onChange("notes", event.target.value)} style={fieldStyle} /></Field>
        </div>
      ) : (
        <div style={formGridStyle}>
          <Field label="Date and Time"><input type="datetime-local" value={editing.transferDate} onChange={(event) => onChange("transferDate", event.target.value)} style={fieldStyle} required /></Field>
          <Field label="From Account"><select value={editing.fromAccountId} onChange={(event) => onChange("fromAccountId", event.target.value)} style={fieldStyle} required><option value="">Select account...</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.account_name}</option>)}</select></Field>
          <Field label="To Account"><select value={editing.toAccountId} onChange={(event) => onChange("toAccountId", event.target.value)} style={fieldStyle} required><option value="">Select account...</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.account_name}</option>)}</select></Field>
          <Field label="Amount Sent (£)"><input type="number" min="0.01" step="0.01" value={editing.grossAmount} onChange={(event) => onChange("grossAmount", event.target.value)} style={fieldStyle} required /></Field>
          <Field label="Fee (£)"><input type="number" min="0" step="0.01" value={editing.feeAmount} onChange={(event) => onChange("feeAmount", event.target.value)} style={fieldStyle} required /></Field>
          <Field label="Reference"><input value={editing.reference} onChange={(event) => onChange("reference", event.target.value)} style={fieldStyle} /></Field>
          <Field label="Notes"><input value={editing.notes} onChange={(event) => onChange("notes", event.target.value)} style={fieldStyle} /></Field>
        </div>
      )}
      <button type="submit" disabled={saving} style={saveButtonStyle}>{saving ? "Saving..." : "Save Changes"}</button>
    </form>
  );
}

function Field({ label, children }) {
  return <div><label style={{ display: "block", fontWeight: "600", marginBottom: "6px" }}>{label}</label>{children}</div>;
}

function RecordDetails({ type, record, accountNames, total }) {
  if (type === "sales") return <><Title>Sale #{record.sale_number || "—"} · {money(total)}</Title><Meta>{date(record.sale_datetime)} · {record.customer_reference || "No customer/reference"}</Meta><Meta>{record.sales_channel || "No channel"} · {record.payment_method || "No payment method"} · {accountNames.get(record.account_id) || "No account"}</Meta></>;
  if (type === "purchases") return <><Title>{record.supplier || "Stock purchase"}</Title><Meta>{date(record.purchase_date)} · Ref: {record.reference || "—"} · {accountNames.get(record.account_id) || "No account"}</Meta><Meta>{record.notes || "No notes"}</Meta></>;
  if (type === "expenses") return <><Title>{record.description || record.category} · {money(record.amount)}</Title><Meta>{date(record.expense_date)} · {record.category} · {record.supplier || "No supplier"}</Meta><Meta>{accountNames.get(record.account_id) || "No account"} · Ref: {record.reference || "—"}</Meta></>;
  if (type === "transfers") return <><Title>{accountNames.get(record.from_account_id) || "Unknown"} → {accountNames.get(record.to_account_id) || "Unknown"}</Title><Meta>{date(record.transfer_date)} · Sent {money(record.gross_amount)} · Fee {money(record.fee_amount)} · Arrived {money(record.net_amount)}</Meta><Meta>Ref: {record.reference || "—"}</Meta></>;
  if (type === "director") return <><Title>{record.transaction_type === "money_in" ? "Director Money In" : "Director Money Out"} · {money(record.amount)}</Title><Meta>{date(record.transaction_date)} · {accountNames.get(record.account_id) || "No account"} · Ref: {record.reference || "—"}</Meta></>;
  return <><Title>{record.account_name}</Title><Meta>{record.account_type} · Opening balance {money(record.opening_balance)} · {record.active ? "Active" : "Inactive"}</Meta><Meta>{record.notes || "No notes"}</Meta></>;
}

function Title({ children }) { return <h2 style={{ fontSize: "19px", margin: "0 0 8px" }}>{children}</h2>; }
function Meta({ children }) { return <div style={{ color: "#666", fontSize: "14px", marginTop: "5px" }}>{children}</div>; }

const pageStyle = { minHeight: "100vh", background: "#f7f7f8", padding: "40px 20px", fontFamily: "Arial, sans-serif" };
const panelStyle = { background: "#fff", padding: "22px", borderRadius: "12px", boxShadow: "0 2px 10px rgba(0,0,0,0.06)" };
const noticeStyle = { padding: "14px 16px", marginBottom: "18px", borderRadius: "9px", background: "#fff8e5", border: "1px solid #ead59a", color: "#6d5310" };
const alertStyle = { padding: "14px 16px", marginBottom: "18px", border: "1px solid", fontWeight: "600" };
const fieldStyle = { width: "100%", padding: "11px", border: "1px solid #ddd", borderRadius: "8px", fontSize: "15px", boxSizing: "border-box", background: "#fff" };
const formGridStyle = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "15px" };
const editButtonStyle = { border: "1px solid #111", borderRadius: "8px", background: "#fff", color: "#111", padding: "11px 15px", fontWeight: "700", cursor: "pointer" };
const deleteButtonStyle = { border: "none", borderRadius: "8px", background: "#a61b1b", color: "#fff", padding: "11px 15px", fontWeight: "700", cursor: "pointer" };
const cancelButtonStyle = { border: "1px solid #aaa", borderRadius: "8px", background: "#fff", color: "#111", padding: "10px 14px", fontWeight: "700", cursor: "pointer" };
const saveButtonStyle = { marginTop: "18px", width: "100%", border: "none", borderRadius: "8px", background: "#111", color: "#fff", padding: "14px", fontSize: "16px", fontWeight: "700", cursor: "pointer" };
function tabStyle(active) { return { border: active ? "1px solid #111" : "1px solid #ccc", borderRadius: "8px", background: active ? "#111" : "#fff", color: active ? "#fff" : "#111", padding: "11px 14px", fontWeight: "700", cursor: "pointer" }; }
