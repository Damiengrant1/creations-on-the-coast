"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

const CATEGORIES = [
  "Advertising & Marketing",
  "Equipment",
  "Postage & Delivery",
  "Printing Materials",
  "Professional Fees",
  "Software & Subscriptions",
  "Travel",
  "Utilities",
  "Other",
];

function todayString() {
  const now = new Date();
  const offset = now.getTimezoneOffset();

  return new Date(now.getTime() - offset * 60000)
    .toISOString()
    .slice(0, 10);
}

export default function ExpensesPage() {
  const [accounts, setAccounts] = useState([]);
  const [recentExpenses, setRecentExpenses] = useState([]);

  const [expenseDate, setExpenseDate] = useState(todayString());
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [customCategory, setCustomCategory] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [supplier, setSupplier] = useState("");
  const [accountId, setAccountId] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData({ keepMessage = false } = {}) {
    setLoading(true);

    if (!keepMessage) {
      setMessage("");
      setMessageType("");
    }

    const { data: accountData, error: accountError } = await supabase
      .from("accounts")
      .select("id, account_name, account_type, active")
      .eq("active", true)
      .order("account_name");

    const { data: expenseData, error: expenseError } = await supabase
      .from("expenses")
      .select(
        "id, expense_date, category, description, amount, supplier, account_id, reference, notes, created_at"
      )
      .order("expense_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(20);

    if (accountError || expenseError) {
      const error = accountError || expenseError;
      console.error("Could not load expenses page:", error);
      setMessage(`Could not load the page: ${error.message}`);
      setMessageType("error");
      setAccounts([]);
      setRecentExpenses([]);
      setLoading(false);
      return;
    }

    setAccounts(accountData || []);
    setRecentExpenses(expenseData || []);
    setLoading(false);
  }

  const accountNames = useMemo(
    () =>
      new Map(
        accounts.map((account) => [
          account.id,
          account.account_name,
        ])
      ),
    [accounts]
  );

  const recentTotal = useMemo(
    () =>
      recentExpenses.reduce(
        (sum, expense) => sum + Number(expense.amount || 0),
        0
      ),
    [recentExpenses]
  );

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");
    setMessageType("");

    const finalCategory =
      category === "Other" ? customCategory.trim() : category;

    if (!expenseDate) {
      setMessage("Please select the expense date.");
      setMessageType("error");
      return;
    }

    if (!finalCategory) {
      setMessage("Please enter the expense category.");
      setMessageType("error");
      return;
    }

    if (!amount || Number(amount) <= 0) {
      setMessage("Please enter an expense amount greater than zero.");
      setMessageType("error");
      return;
    }

    if (!accountId) {
      setMessage("Please select the account used to pay.");
      setMessageType("error");
      return;
    }

    setSaving(true);

    const { error } = await supabase.from("expenses").insert({
      expense_date: expenseDate,
      category: finalCategory,
      description: description.trim() || null,
      amount: Number(amount),
      event_id: null,
      supplier: supplier.trim() || null,
      account_id: accountId,
      reference: reference.trim() || null,
      notes: notes.trim() || null,
    });

    if (error) {
      console.error("Could not create expense:", error);
      setMessage(`Could not record expense: ${error.message}`);
      setMessageType("error");
      setSaving(false);
      return;
    }

    const savedAmount = Number(amount);

    setMessage(
      `Expense recorded successfully — £${savedAmount.toFixed(2)}`
    );
    setMessageType("success");

    setExpenseDate(todayString());
    setCategory(CATEGORIES[0]);
    setCustomCategory("");
    setDescription("");
    setAmount("");
    setSupplier("");
    setAccountId("");
    setReference("");
    setNotes("");
    setSaving(false);

    await loadData({ keepMessage: true });
  }

  const fieldStyle = {
    width: "100%",
    padding: "12px",
    border: "1px solid #ddd",
    borderRadius: "8px",
    fontSize: "16px",
    boxSizing: "border-box",
    background: "#fff",
  };

  const labelStyle = {
    display: "block",
    fontWeight: "600",
    marginBottom: "6px",
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#f7f7f8",
        padding: "40px 20px",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
        <Link
          href="/"
          style={{
            display: "inline-block",
            marginBottom: "24px",
            color: "#333",
          }}
        >
          ← Back to Dashboard
        </Link>

        <h1
          style={{
            fontSize: "36px",
            margin: "0 0 8px",
          }}
        >
          Expenses
        </h1>

        <p
          style={{
            color: "#666",
            margin: "0 0 28px",
          }}
        >
          Record operating expenses and the account used to pay them.
        </p>

        {message && (
          <div
            style={{
              padding: "14px 16px",
              marginBottom: "20px",
              borderRadius: "9px",
              background:
                messageType === "error" ? "#fff0f0" : "#edf9f0",
              color: messageType === "error" ? "#9b1c1c" : "#176b31",
              border:
                messageType === "error"
                  ? "1px solid #f1c1c1"
                  : "1px solid #bfe2c8",
              fontWeight: "600",
            }}
          >
            {message}
          </div>
        )}

        {loading ? (
          <div
            style={{
              background: "#fff",
              padding: "28px",
              borderRadius: "14px",
            }}
          >
            Loading expenses...
          </div>
        ) : (
          <>
            <form onSubmit={handleSubmit}>
              <div
                style={{
                  background: "#fff",
                  padding: "28px",
                  borderRadius: "14px",
                  boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
                  marginBottom: "20px",
                }}
              >
                <h2 style={{ marginTop: 0 }}>Record Expense</h2>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fit, minmax(220px, 1fr))",
                    gap: "16px",
                    marginBottom: "18px",
                  }}
                >
                  <div>
                    <label style={labelStyle}>Expense Date</label>
                    <input
                      type="date"
                      value={expenseDate}
                      onChange={(event) =>
                        setExpenseDate(event.target.value)
                      }
                      style={fieldStyle}
                      required
                    />
                  </div>

                  <div>
                    <label style={labelStyle}>Category</label>
                    <select
                      value={category}
                      onChange={(event) =>
                        setCategory(event.target.value)
                      }
                      style={fieldStyle}
                    >
                      {CATEGORIES.map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  </div>

                  {category === "Other" && (
                    <div>
                      <label style={labelStyle}>
                        Other Category
                      </label>
                      <input
                        value={customCategory}
                        onChange={(event) =>
                          setCustomCategory(event.target.value)
                        }
                        placeholder="Enter category"
                        style={fieldStyle}
                        required
                      />
                    </div>
                  )}

                  <div>
                    <label style={labelStyle}>Amount (£)</label>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={amount}
                      onChange={(event) =>
                        setAmount(event.target.value)
                      }
                      placeholder="0.00"
                      style={fieldStyle}
                      required
                    />
                  </div>

                  <div>
                    <label style={labelStyle}>Paid From</label>
                    <select
                      value={accountId}
                      onChange={(event) =>
                        setAccountId(event.target.value)
                      }
                      style={fieldStyle}
                      required
                    >
                      <option value="">Select account...</option>
                      {accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.account_name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={labelStyle}>Supplier</label>
                    <input
                      value={supplier}
                      onChange={(event) =>
                        setSupplier(event.target.value)
                      }
                      placeholder="Optional"
                      style={fieldStyle}
                    />
                  </div>

                  <div>
                    <label style={labelStyle}>Reference</label>
                    <input
                      value={reference}
                      onChange={(event) =>
                        setReference(event.target.value)
                      }
                      placeholder="Receipt or invoice number"
                      style={fieldStyle}
                    />
                  </div>
                </div>

                <div style={{ marginBottom: "18px" }}>
                  <label style={labelStyle}>Description</label>
                  <input
                    value={description}
                    onChange={(event) =>
                      setDescription(event.target.value)
                    }
                    placeholder="What was the expense for?"
                    style={fieldStyle}
                  />
                </div>

                <div style={{ marginBottom: "22px" }}>
                  <label style={labelStyle}>Notes</label>
                  <textarea
                    value={notes}
                    onChange={(event) =>
                      setNotes(event.target.value)
                    }
                    rows="3"
                    style={fieldStyle}
                  />
                </div>

                <button
                  type="submit"
                  disabled={saving}
                  style={{
                    width: "100%",
                    padding: "16px",
                    border: "none",
                    borderRadius: "9px",
                    background: saving ? "#777" : "#111",
                    color: "#fff",
                    fontSize: "17px",
                    fontWeight: "700",
                    cursor: saving ? "not-allowed" : "pointer",
                  }}
                >
                  {saving
                    ? "Recording Expense..."
                    : `Record Expense${amount ? ` — £${Number(amount).toFixed(2)}` : ""}`}
                </button>
              </div>
            </form>

            <div
              style={{
                background: "#fff",
                borderRadius: "14px",
                boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
                overflowX: "auto",
              }}
            >
              <div
                style={{
                  padding: "24px 26px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "16px",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <h2 style={{ margin: "0 0 5px" }}>
                    Recent Expenses
                  </h2>
                  <div style={{ color: "#666", fontSize: "14px" }}>
                    Latest 20 entries
                  </div>
                </div>

                <div style={{ textAlign: "right" }}>
                  <div style={{ color: "#666", fontSize: "13px" }}>
                    Shown Total
                  </div>
                  <strong style={{ fontSize: "22px" }}>
                    £{recentTotal.toFixed(2)}
                  </strong>
                </div>
              </div>

              {recentExpenses.length === 0 ? (
                <div
                  style={{
                    padding: "0 26px 26px",
                    color: "#666",
                  }}
                >
                  No expenses recorded yet.
                </div>
              ) : (
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    minWidth: "900px",
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        textAlign: "left",
                        background: "#fafafa",
                      }}
                    >
                      <Th>Date</Th>
                      <Th>Category</Th>
                      <Th>Supplier</Th>
                      <Th>Description</Th>
                      <Th>Account</Th>
                      <Th>Reference</Th>
                      <Th>Amount</Th>
                    </tr>
                  </thead>

                  <tbody>
                    {recentExpenses.map((expense) => (
                      <tr
                        key={expense.id}
                        style={{ borderTop: "1px solid #eee" }}
                      >
                        <Td>{expense.expense_date}</Td>
                        <Td>{expense.category}</Td>
                        <Td>{expense.supplier || "—"}</Td>
                        <Td>{expense.description || "—"}</Td>
                        <Td>
                          {accountNames.get(expense.account_id) ||
                            "—"}
                        </Td>
                        <Td>{expense.reference || "—"}</Td>
                        <Td>
                          <strong>
                            £{Number(expense.amount || 0).toFixed(2)}
                          </strong>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function Th({ children }) {
  return (
    <th
      style={{
        padding: "14px",
        fontSize: "14px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  );
}

function Td({ children }) {
  return (
    <td
      style={{
        padding: "14px",
        fontSize: "14px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </td>
  );
}
