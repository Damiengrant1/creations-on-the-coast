"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

function todayDateTime() {
  const now = new Date();
  const offset = now.getTimezoneOffset();

  return new Date(now.getTime() - offset * 60000)
    .toISOString()
    .slice(0, 16);
}

function money(value) {
  return `£${Number(value || 0).toFixed(2)}`;
}

function transactionLabel(value) {
  const labels = {
    sale_income: "Sale",
    expense: "Expense",
    stock_purchase: "Stock Purchase",
    card_fee: "Card Fee",
    transfer: "Transfer",
    director_money_in: "Director Money In",
    director_money_out: "Director Money Out",
    adjustment: "Adjustment",
  };

  return labels[value] || value || "Transaction";
}

export default function CashFlowPage() {
  const [accounts, setAccounts] = useState([]);
  const [balances, setBalances] = useState([]);
  const [transactions, setTransactions] = useState([]);

  const [transferDate, setTransferDate] = useState(todayDateTime());
  const [fromAccountId, setFromAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [grossAmount, setGrossAmount] = useState("");
  const [feeAmount, setFeeAmount] = useState("0");
  const [transferReference, setTransferReference] = useState("");
  const [transferNotes, setTransferNotes] = useState("");

  const [directorDate, setDirectorDate] = useState(todayDateTime());
  const [directorType, setDirectorType] = useState("money_in");
  const [directorAmount, setDirectorAmount] = useState("");
  const [directorAccountId, setDirectorAccountId] = useState("");
  const [directorReference, setDirectorReference] = useState("");
  const [directorNotes, setDirectorNotes] = useState("");

  const [accountName, setAccountName] = useState("");
  const [accountType, setAccountType] = useState("bank");
  const [openingBalance, setOpeningBalance] = useState("0");
  const [accountNotes, setAccountNotes] = useState("");

  const [activeForm, setActiveForm] = useState("transfer");
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

    const [
      { data: accountData, error: accountError },
      { data: balanceData, error: balanceError },
      { data: transactionData, error: transactionError },
    ] = await Promise.all([
      supabase
        .from("accounts")
        .select(
          "id, account_name, account_type, opening_balance, active, notes"
        )
        .order("account_name"),
      supabase.from("account_balances").select("*"),
      supabase
        .from("cash_transactions")
        .select(
          "id, transaction_datetime, transaction_type, category, amount, from_account_id, to_account_id, description, reference, notes, created_at"
        )
        .order("transaction_datetime", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(30),
    ]);

    if (accountError || balanceError || transactionError) {
      const error = accountError || balanceError || transactionError;
      console.error("Could not load cash flow:", error);
      setMessage(`Could not load cash flow: ${error.message}`);
      setMessageType("error");
      setAccounts([]);
      setBalances([]);
      setTransactions([]);
      setLoading(false);
      return;
    }

    setAccounts(accountData || []);
    setBalances(balanceData || []);
    setTransactions(transactionData || []);
    setLoading(false);
  }

  const activeAccounts = useMemo(
    () => accounts.filter((account) => account.active),
    [accounts]
  );

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

  const balancesByAccount = useMemo(() => {
    const map = new Map();

    balances.forEach((balance) => {
      const key =
        balance.account_id ||
        balance.id ||
        accounts.find(
          (account) =>
            account.account_name === balance.account_name
        )?.id;

      if (key) {
        map.set(key, Number(balance.current_balance || 0));
      }
    });

    return map;
  }, [balances, accounts]);

  const totalBalance = useMemo(
    () =>
      activeAccounts.reduce(
        (sum, account) =>
          sum +
          (balancesByAccount.has(account.id)
            ? balancesByAccount.get(account.id)
            : Number(account.opening_balance || 0)),
        0
      ),
    [activeAccounts, balancesByAccount]
  );

  async function saveTransfer(event) {
    event.preventDefault();
    setMessage("");
    setMessageType("");

    if (!transferDate) {
      setMessage("Please select the transfer date and time.");
      setMessageType("error");
      return;
    }

    if (!fromAccountId || !toAccountId) {
      setMessage("Please select both transfer accounts.");
      setMessageType("error");
      return;
    }

    if (fromAccountId === toAccountId) {
      setMessage("The transfer accounts must be different.");
      setMessageType("error");
      return;
    }

    if (!grossAmount || Number(grossAmount) <= 0) {
      setMessage("Enter a transfer amount greater than zero.");
      setMessageType("error");
      return;
    }

    if (Number(feeAmount || 0) < 0) {
      setMessage("The transfer fee cannot be negative.");
      setMessageType("error");
      return;
    }

    if (Number(feeAmount || 0) > Number(grossAmount)) {
      setMessage("The transfer fee cannot exceed the amount sent.");
      setMessageType("error");
      return;
    }

    setSaving(true);

    const { error } = await supabase.from("transfers").insert({
      transfer_date: new Date(transferDate).toISOString(),
      from_account_id: fromAccountId,
      to_account_id: toAccountId,
      gross_amount: Number(grossAmount),
      fee_amount: Number(feeAmount || 0),
      reference: transferReference.trim() || null,
      notes: transferNotes.trim() || null,
    });

    if (error) {
      console.error("Could not record transfer:", error);
      setMessage(`Could not record transfer: ${error.message}`);
      setMessageType("error");
      setSaving(false);
      return;
    }

    setMessage(
      `Transfer recorded successfully — ${money(grossAmount)}`
    );
    setMessageType("success");
    setTransferDate(todayDateTime());
    setFromAccountId("");
    setToAccountId("");
    setGrossAmount("");
    setFeeAmount("0");
    setTransferReference("");
    setTransferNotes("");
    setSaving(false);

    await loadData({ keepMessage: true });
  }

  async function saveDirectorTransaction(event) {
    event.preventDefault();
    setMessage("");
    setMessageType("");

    if (!directorDate) {
      setMessage("Please select the transaction date and time.");
      setMessageType("error");
      return;
    }

    if (!directorAccountId) {
      setMessage("Please select the account.");
      setMessageType("error");
      return;
    }

    if (!directorAmount || Number(directorAmount) <= 0) {
      setMessage("Enter an amount greater than zero.");
      setMessageType("error");
      return;
    }

    setSaving(true);

    const { error } = await supabase
      .from("director_transactions")
      .insert({
        transaction_date: new Date(directorDate).toISOString(),
        transaction_type: directorType,
        amount: Number(directorAmount),
        account_id: directorAccountId,
        reference: directorReference.trim() || null,
        notes: directorNotes.trim() || null,
      });

    if (error) {
      console.error("Could not record director transaction:", error);
      setMessage(
        `Could not record director transaction: ${error.message}`
      );
      setMessageType("error");
      setSaving(false);
      return;
    }

    setMessage(
      `Director ${directorType === "money_in" ? "money in" : "money out"} recorded — ${money(directorAmount)}`
    );
    setMessageType("success");
    setDirectorDate(todayDateTime());
    setDirectorAmount("");
    setDirectorAccountId("");
    setDirectorReference("");
    setDirectorNotes("");
    setSaving(false);

    await loadData({ keepMessage: true });
  }

  async function saveAccount(event) {
    event.preventDefault();
    setMessage("");
    setMessageType("");

    if (!accountName.trim()) {
      setMessage("Please enter the account name.");
      setMessageType("error");
      return;
    }

    if (openingBalance === "" || Number(openingBalance) < 0) {
      setMessage("Opening balance must be zero or more.");
      setMessageType("error");
      return;
    }

    setSaving(true);

    const { error } = await supabase.from("accounts").insert({
      account_name: accountName.trim(),
      account_type: accountType,
      opening_balance: Number(openingBalance),
      active: true,
      notes: accountNotes.trim() || null,
    });

    if (error) {
      console.error("Could not create account:", error);
      setMessage(`Could not create account: ${error.message}`);
      setMessageType("error");
      setSaving(false);
      return;
    }

    setMessage(`Account created successfully — ${accountName.trim()}`);
    setMessageType("success");
    setAccountName("");
    setAccountType("bank");
    setOpeningBalance("0");
    setAccountNotes("");
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

  const buttonStyle = {
    padding: "12px 16px",
    borderRadius: "8px",
    fontWeight: "700",
    cursor: "pointer",
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
      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
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

        <h1 style={{ fontSize: "36px", margin: "0 0 8px" }}>
          Cash Flow & Accounts
        </h1>
        <p style={{ color: "#666", margin: "0 0 28px" }}>
          View balances, move money between accounts and record director funds.
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
            Loading cash flow...
          </div>
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fit, minmax(210px, 1fr))",
                gap: "16px",
                marginBottom: "24px",
              }}
            >
              <BalanceCard
                title="Total Cash Balance"
                type="All Accounts"
                balance={totalBalance}
                featured
              />

              {activeAccounts.map((account) => (
                <BalanceCard
                  key={account.id}
                  title={account.account_name}
                  type={account.account_type}
                  balance={
                    balancesByAccount.has(account.id)
                      ? balancesByAccount.get(account.id)
                      : Number(account.opening_balance || 0)
                  }
                />
              ))}
            </div>

            <div
              style={{
                display: "flex",
                gap: "10px",
                flexWrap: "wrap",
                marginBottom: "16px",
              }}
            >
              <FormTab
                active={activeForm === "transfer"}
                onClick={() => setActiveForm("transfer")}
              >
                Transfer Money
              </FormTab>
              <FormTab
                active={activeForm === "director"}
                onClick={() => setActiveForm("director")}
              >
                Director Money
              </FormTab>
              <FormTab
                active={activeForm === "account"}
                onClick={() => setActiveForm("account")}
              >
                Add Account
              </FormTab>
            </div>

            <div
              style={{
                background: "#fff",
                padding: "28px",
                borderRadius: "14px",
                boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
                marginBottom: "24px",
              }}
            >
              {activeForm === "transfer" && (
                <form onSubmit={saveTransfer}>
                  <h2 style={{ marginTop: 0 }}>Transfer Money</h2>
                  <p style={{ color: "#666", marginTop: "-8px" }}>
                    Move money between business accounts. Any transfer fee is
                    recorded separately.
                  </p>

                  <div style={formGridStyle}>
                    <Field label="Date & Time" labelStyle={labelStyle}>
                      <input
                        type="datetime-local"
                        value={transferDate}
                        onChange={(event) =>
                          setTransferDate(event.target.value)
                        }
                        style={fieldStyle}
                        required
                      />
                    </Field>

                    <Field label="From Account" labelStyle={labelStyle}>
                      <AccountSelect
                        value={fromAccountId}
                        onChange={setFromAccountId}
                        accounts={activeAccounts}
                        fieldStyle={fieldStyle}
                      />
                    </Field>

                    <Field label="To Account" labelStyle={labelStyle}>
                      <AccountSelect
                        value={toAccountId}
                        onChange={setToAccountId}
                        accounts={activeAccounts}
                        fieldStyle={fieldStyle}
                      />
                    </Field>

                    <Field label="Amount Sent (£)" labelStyle={labelStyle}>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={grossAmount}
                        onChange={(event) =>
                          setGrossAmount(event.target.value)
                        }
                        style={fieldStyle}
                        required
                      />
                    </Field>

                    <Field label="Transfer Fee (£)" labelStyle={labelStyle}>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={feeAmount}
                        onChange={(event) =>
                          setFeeAmount(event.target.value)
                        }
                        style={fieldStyle}
                        required
                      />
                    </Field>

                    <Field label="Reference" labelStyle={labelStyle}>
                      <input
                        value={transferReference}
                        onChange={(event) =>
                          setTransferReference(event.target.value)
                        }
                        style={fieldStyle}
                        placeholder="Optional"
                      />
                    </Field>
                  </div>

                  <Field label="Notes" labelStyle={labelStyle}>
                    <textarea
                      rows="3"
                      value={transferNotes}
                      onChange={(event) =>
                        setTransferNotes(event.target.value)
                      }
                      style={fieldStyle}
                    />
                  </Field>

                  <div
                    style={{
                      margin: "16px 0",
                      padding: "14px",
                      borderRadius: "8px",
                      background: "#f7f7f8",
                    }}
                  >
                    Amount arriving:{" "}
                    <strong>
                      {money(
                        Math.max(
                          Number(grossAmount || 0) -
                            Number(feeAmount || 0),
                          0
                        )
                      )}
                    </strong>
                  </div>

                  <SubmitButton saving={saving}>
                    Record Transfer
                  </SubmitButton>
                </form>
              )}

              {activeForm === "director" && (
                <form onSubmit={saveDirectorTransaction}>
                  <h2 style={{ marginTop: 0 }}>Director Money</h2>
                  <p style={{ color: "#666", marginTop: "-8px" }}>
                    Record money a director puts into or takes out of the
                    business. This does not count as sales or an operating
                    expense.
                  </p>

                  <div style={formGridStyle}>
                    <Field label="Date & Time" labelStyle={labelStyle}>
                      <input
                        type="datetime-local"
                        value={directorDate}
                        onChange={(event) =>
                          setDirectorDate(event.target.value)
                        }
                        style={fieldStyle}
                        required
                      />
                    </Field>

                    <Field label="Transaction Type" labelStyle={labelStyle}>
                      <select
                        value={directorType}
                        onChange={(event) =>
                          setDirectorType(event.target.value)
                        }
                        style={fieldStyle}
                      >
                        <option value="money_in">Money In</option>
                        <option value="money_out">Money Out</option>
                      </select>
                    </Field>

                    <Field label="Account" labelStyle={labelStyle}>
                      <AccountSelect
                        value={directorAccountId}
                        onChange={setDirectorAccountId}
                        accounts={activeAccounts}
                        fieldStyle={fieldStyle}
                      />
                    </Field>

                    <Field label="Amount (£)" labelStyle={labelStyle}>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={directorAmount}
                        onChange={(event) =>
                          setDirectorAmount(event.target.value)
                        }
                        style={fieldStyle}
                        required
                      />
                    </Field>

                    <Field label="Reference" labelStyle={labelStyle}>
                      <input
                        value={directorReference}
                        onChange={(event) =>
                          setDirectorReference(event.target.value)
                        }
                        style={fieldStyle}
                        placeholder="Optional"
                      />
                    </Field>
                  </div>

                  <Field label="Notes" labelStyle={labelStyle}>
                    <textarea
                      rows="3"
                      value={directorNotes}
                      onChange={(event) =>
                        setDirectorNotes(event.target.value)
                      }
                      style={fieldStyle}
                    />
                  </Field>

                  <SubmitButton saving={saving}>
                    Record Director Transaction
                  </SubmitButton>
                </form>
              )}

              {activeForm === "account" && (
                <form onSubmit={saveAccount}>
                  <h2 style={{ marginTop: 0 }}>Add Account</h2>
                  <p style={{ color: "#666", marginTop: "-8px" }}>
                    Add a bank, cash, SumUp or Shopify account to track.
                  </p>

                  <div style={formGridStyle}>
                    <Field label="Account Name" labelStyle={labelStyle}>
                      <input
                        value={accountName}
                        onChange={(event) =>
                          setAccountName(event.target.value)
                        }
                        style={fieldStyle}
                        required
                      />
                    </Field>

                    <Field label="Account Type" labelStyle={labelStyle}>
                      <select
                        value={accountType}
                        onChange={(event) =>
                          setAccountType(event.target.value)
                        }
                        style={fieldStyle}
                      >
                        <option value="bank">Bank</option>
                        <option value="cash">Cash</option>
                        <option value="sumup">SumUp</option>
                        <option value="shopify">Shopify</option>
                      </select>
                    </Field>

                    <Field label="Opening Balance (£)" labelStyle={labelStyle}>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={openingBalance}
                        onChange={(event) =>
                          setOpeningBalance(event.target.value)
                        }
                        style={fieldStyle}
                        required
                      />
                    </Field>
                  </div>

                  <Field label="Notes" labelStyle={labelStyle}>
                    <textarea
                      rows="3"
                      value={accountNotes}
                      onChange={(event) =>
                        setAccountNotes(event.target.value)
                      }
                      style={fieldStyle}
                    />
                  </Field>

                  <SubmitButton saving={saving}>
                    Create Account
                  </SubmitButton>
                </form>
              )}
            </div>

            <div
              style={{
                background: "#fff",
                borderRadius: "14px",
                boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
                overflowX: "auto",
              }}
            >
              <div style={{ padding: "24px 26px" }}>
                <h2 style={{ margin: "0 0 5px" }}>
                  Recent Cash Transactions
                </h2>
                <div style={{ color: "#666", fontSize: "14px" }}>
                  Latest 30 entries
                </div>
              </div>

              {transactions.length === 0 ? (
                <div
                  style={{
                    padding: "0 26px 26px",
                    color: "#666",
                  }}
                >
                  No cash transactions recorded yet.
                </div>
              ) : (
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    minWidth: "980px",
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
                      <Th>Type</Th>
                      <Th>Description</Th>
                      <Th>From</Th>
                      <Th>To</Th>
                      <Th>Reference</Th>
                      <Th>Amount</Th>
                    </tr>
                  </thead>

                  <tbody>
                    {transactions.map((transaction) => {
                      const incoming =
                        transaction.to_account_id &&
                        !transaction.from_account_id;
                      const outgoing =
                        transaction.from_account_id &&
                        !transaction.to_account_id;

                      return (
                        <tr
                          key={transaction.id}
                          style={{ borderTop: "1px solid #eee" }}
                        >
                          <Td>
                            {new Date(
                              transaction.transaction_datetime
                            ).toLocaleString("en-GB")}
                          </Td>
                          <Td>
                            {transactionLabel(
                              transaction.transaction_type
                            )}
                          </Td>
                          <Td>
                            {transaction.description ||
                              transaction.category ||
                              "—"}
                          </Td>
                          <Td>
                            {accountNames.get(
                              transaction.from_account_id
                            ) || "—"}
                          </Td>
                          <Td>
                            {accountNames.get(
                              transaction.to_account_id
                            ) || "—"}
                          </Td>
                          <Td>{transaction.reference || "—"}</Td>
                          <Td>
                            <strong
                              style={{
                                color: incoming
                                  ? "#176b31"
                                  : outgoing
                                    ? "#9b1c1c"
                                    : "#111",
                              }}
                            >
                              {incoming ? "+" : outgoing ? "−" : ""}
                              {money(transaction.amount)}
                            </strong>
                          </Td>
                        </tr>
                      );
                    })}
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

const formGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
  gap: "16px",
  marginBottom: "18px",
};

function BalanceCard({ title, type, balance, featured = false }) {
  return (
    <div
      style={{
        background: featured ? "#111" : "#fff",
        color: featured ? "#fff" : "#111",
        padding: "22px",
        borderRadius: "12px",
        boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
      }}
    >
      <div
        style={{
          color: featured ? "#ccc" : "#666",
          fontSize: "13px",
          marginBottom: "7px",
          textTransform: "capitalize",
        }}
      >
        {type}
      </div>
      <div style={{ fontWeight: "700", marginBottom: "10px" }}>
        {title}
      </div>
      <div style={{ fontSize: "28px", fontWeight: "700" }}>
        {money(balance)}
      </div>
    </div>
  );
}

function FormTab({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "12px 16px",
        borderRadius: "8px",
        border: active ? "1px solid #111" : "1px solid #ccc",
        background: active ? "#111" : "#fff",
        color: active ? "#fff" : "#111",
        fontWeight: "700",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function Field({ label, labelStyle, children }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

function AccountSelect({
  value,
  onChange,
  accounts,
  fieldStyle,
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
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
  );
}

function SubmitButton({ saving, children }) {
  return (
    <button
      type="submit"
      disabled={saving}
      style={{
        width: "100%",
        padding: "15px",
        border: "none",
        borderRadius: "9px",
        background: saving ? "#777" : "#111",
        color: "#fff",
        fontSize: "16px",
        fontWeight: "700",
        cursor: saving ? "not-allowed" : "pointer",
        marginTop: "20px",
      }}
    >
      {saving ? "Saving..." : children}
    </button>
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
