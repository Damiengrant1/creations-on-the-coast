"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

function todayString() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10);
}

export default function SupplierCreditsPage() {
  const [accounts, setAccounts] = useState([]);
  const [creditDate, setCreditDate] = useState(todayString());
  const [creditType, setCreditType] = useState("refund");
  const [supplier, setSupplier] = useState("");
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("");

  useEffect(() => {
    loadAccounts();
  }, []);

  async function loadAccounts() {
    const { data, error } = await supabase
      .from("accounts")
      .select("id, account_name")
      .eq("active", true)
      .order("account_name");

    if (error) {
      setMessage(`Could not load accounts: ${error.message}`);
      setMessageType("error");
      return;
    }

    setAccounts(data || []);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");
    setMessageType("");

    if (!supplier.trim()) {
      setMessage("Please enter the supplier.");
      setMessageType("error");
      return;
    }

    if (!creditDate || Number(amount) <= 0) {
      setMessage("Enter a date and an amount greater than zero.");
      setMessageType("error");
      return;
    }

    if (creditType === "refund" && !accountId) {
      setMessage("Choose the account the refund was paid into.");
      setMessageType("error");
      return;
    }

    setSaving(true);
    const { error } = await supabase.from("supplier_credits").insert({
      credit_date: creditDate,
      credit_type: creditType,
      supplier: supplier.trim(),
      amount: Number(amount),
      account_id: creditType === "refund" ? accountId : null,
      reference: reference.trim() || null,
      notes: notes.trim() || null,
    });

    if (error) {
      setMessage(`Could not record supplier ${creditType === "refund" ? "refund" : "credit note"}: ${error.message}`);
      setMessageType("error");
      setSaving(false);
      return;
    }

    setMessage(
      creditType === "refund"
        ? `Supplier refund recorded — £${Number(amount).toFixed(2)} has been added to the selected account.`
        : `Supplier credit note recorded — £${Number(amount).toFixed(2)}.`
    );
    setMessageType("success");
    setCreditDate(todayString());
    setSupplier("");
    setAmount("");
    setAccountId("");
    setReference("");
    setNotes("");
    setSaving(false);
  }

  return (
    <main style={pageStyle}>
      <div style={{ maxWidth: "760px", margin: "0 auto" }}>
        <Link href="/stock-purchases" style={backStyle}>← Back to Stock Purchases</Link>
        <h1 style={{ fontSize: "36px", margin: "22px 0 8px" }}>Supplier Refunds & Credit Notes</h1>
        <p style={{ color: "#666", marginBottom: "28px" }}>
          Record money returned by a supplier, or a credit note to use against a future invoice.
        </p>

        {message && <div style={messageType === "error" ? errorStyle : successStyle}>{message}</div>}

        <form onSubmit={handleSubmit} style={cardStyle}>
          <div style={gridStyle}>
            <div>
              <label style={labelStyle}>Type</label>
              <select value={creditType} onChange={(event) => setCreditType(event.target.value)} style={fieldStyle}>
                <option value="refund">Refund received</option>
                <option value="credit_note">Credit note</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Date</label>
              <input type="date" value={creditDate} onChange={(event) => setCreditDate(event.target.value)} style={fieldStyle} required />
            </div>
            <div>
              <label style={labelStyle}>Supplier</label>
              <input value={supplier} onChange={(event) => setSupplier(event.target.value)} placeholder="e.g. Uneek Clothing" style={fieldStyle} required />
            </div>
            <div>
              <label style={labelStyle}>Amount (£)</label>
              <input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} style={fieldStyle} required />
            </div>
            {creditType === "refund" && (
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={labelStyle}>Refund Paid Into</label>
                <select value={accountId} onChange={(event) => setAccountId(event.target.value)} style={fieldStyle} required>
                  <option value="">Select account...</option>
                  {accounts.map((account) => <option key={account.id} value={account.id}>{account.account_name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label style={labelStyle}>Credit / Invoice Reference</label>
              <input value={reference} onChange={(event) => setReference(event.target.value)} style={fieldStyle} />
            </div>
          </div>
          <div style={{ marginTop: "16px" }}>
            <label style={labelStyle}>Notes</label>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows="4" style={fieldStyle} />
          </div>
          <div style={infoStyle}>
            {creditType === "refund"
              ? "A refund increases the selected account balance. It is recorded as a supplier refund, not sales income."
              : "A credit note is recorded for reference only. It does not change an account balance until the supplier actually refunds it."}
          </div>
          <button type="submit" disabled={saving} style={buttonStyle}>
            {saving ? "Recording..." : `Record ${creditType === "refund" ? "Refund" : "Credit Note"}`}
          </button>
        </form>
      </div>
    </main>
  );
}

const pageStyle = { minHeight: "100vh", background: "#f7f7f8", padding: "40px 20px", fontFamily: "Arial, sans-serif" };
const backStyle = { color: "#333", fontWeight: "600" };
const cardStyle = { background: "#fff", padding: "28px", borderRadius: "14px", boxShadow: "0 2px 10px rgba(0,0,0,0.06)" };
const gridStyle = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" };
const labelStyle = { display: "block", fontWeight: "600", marginBottom: "6px" };
const fieldStyle = { width: "100%", padding: "12px", border: "1px solid #ddd", borderRadius: "8px", fontSize: "16px", boxSizing: "border-box", background: "#fff" };
const infoStyle = { margin: "20px 0", padding: "14px", background: "#f2f2f2", borderRadius: "8px", color: "#555" };
const buttonStyle = { width: "100%", padding: "16px", border: "none", borderRadius: "9px", background: "#111", color: "#fff", fontSize: "17px", fontWeight: "700", cursor: "pointer" };
const successStyle = { padding: "14px", marginBottom: "20px", borderRadius: "9px", background: "#edf9f0", color: "#176b31", border: "1px solid #bfe2c8", fontWeight: "600" };
const errorStyle = { padding: "14px", marginBottom: "20px", borderRadius: "9px", background: "#fff0f0", color: "#9b1c1c", border: "1px solid #f1c1c1", fontWeight: "600" };
