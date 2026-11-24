"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import ui from "../../lib/ui";

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
        <h1 style={{ fontSize: "30px", margin: "22px 0 8px" }}>Supplier Refunds & Credit Notes</h1>
        <p style={{ color: "var(--muted)", marginBottom: "28px" }}>
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

const pageStyle = { ...ui.page };
const backStyle = { ...ui.back };
const cardStyle = { ...ui.card };
const gridStyle = { ...ui.grid, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" };
const labelStyle = { ...ui.label };
const fieldStyle = { ...ui.field };
const infoStyle = { ...ui.info };
const buttonStyle = { ...ui.primary, width: "100%" };
const successStyle = { ...ui.success };
const errorStyle = { ...ui.error };
