"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import Link from "next/link";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

function todayString() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000)
    .toISOString()
    .slice(0, 10);
}

function blankItem() {
  return {
    productId: "",
    quantity: 1,
    sellingPrice: "",
    costPrice: "",
  };
}

export default function RecordSalePage() {
  const [products, setProducts] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [events, setEvents] = useState([]);

  const [saleDate, setSaleDate] = useState(todayString());
  const [customerReference, setCustomerReference] = useState("");
  const [salesChannel, setSalesChannel] = useState("Direct");
  const [paymentMethod, setPaymentMethod] = useState("Bank Transfer");
  const [accountId, setAccountId] = useState("");
  const [eventId, setEventId] = useState("");
  const [notes, setNotes] = useState("");

  const [items, setItems] = useState([blankItem()]);

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const { data: productData, error: productError } = await supabase
      .from("products")
      .select("id, product_name, cost_price, selling_price")
      .eq("active", true)
      .order("product_name");

    const { data: accountData, error: accountError } = await supabase
      .from("accounts")
      .select("id, account_name")
      .order("account_name");

    const { data: eventData, error: eventError } = await supabase
      .from("events")
      .select("id, event_name, start_date, status")
      .neq("status", "cancelled")
      .order("start_date", { ascending: false });

    if (productError) {
      console.error("Products error:", productError);
    } else {
      setProducts(productData || []);
    }

    if (accountError) {
      console.error("Accounts error:", accountError);
    } else {
      setAccounts(accountData || []);
    }

    if (eventError) {
      console.error("Events error:", eventError);
    } else {
      setEvents(eventData || []);
    }
  }

  function updateItem(index, field, value) {
    setItems((currentItems) =>
      currentItems.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              [field]: value,
            }
          : item
      )
    );
  }

  function selectProduct(index, productId) {
    const product = products.find(
      (productItem) => productItem.id === productId
    );

    setItems((currentItems) =>
      currentItems.map((item, itemIndex) => {
        if (itemIndex !== index) return item;

        return {
          ...item,
          productId,
          sellingPrice: product?.selling_price ?? "",
          costPrice: product?.cost_price ?? "",
        };
      })
    );
  }

  function addItem() {
    setItems((currentItems) => [...currentItems, blankItem()]);
  }

  function removeItem(index) {
    if (items.length === 1) return;

    setItems((currentItems) =>
      currentItems.filter((_, itemIndex) => itemIndex !== index)
    );
  }

  const saleTotal = items.reduce((sum, item) => {
    return (
      sum +
      Number(item.quantity || 0) * Number(item.sellingPrice || 0)
    );
  }, 0);

  const directCostTotal = items.reduce((sum, item) => {
    return (
      sum +
      Number(item.quantity || 0) * Number(item.costPrice || 0)
    );
  }, 0);

  const grossProfit = saleTotal - directCostTotal;

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");

    if (!saleDate) {
      setMessage("Please select a sale date.");
      return;
    }

    if (!accountId) {
      setMessage("Please select the account the payment went into.");
      return;
    }

    const invalidItem = items.some(
      (item) =>
        !item.productId ||
        Number(item.quantity) <= 0 ||
        item.sellingPrice === "" ||
        item.costPrice === ""
    );

    if (invalidItem) {
      setMessage("Please complete every product line.");
      return;
    }

    setSaving(true);

    const saleDateTime = new Date(
      `${saleDate}T12:00:00`
    ).toISOString();

    const { data: sale, error: saleError } = await supabase
      .from("sales")
      .insert({
        sale_datetime: saleDateTime,
        customer_reference: customerReference || null,
        sales_channel: salesChannel,
        payment_method: paymentMethod,
        account_id: accountId,
        event_id: eventId || null,
        notes: notes || null,
      })
      .select("id")
      .single();

    if (saleError) {
      console.error("Sale error:", saleError);
      setMessage(`Could not create sale: ${saleError.message}`);
      setSaving(false);
      return;
    }

    const saleItems = items.map((item) => ({
      sale_id: sale.id,
      product_id: item.productId,
      quantity: Number(item.quantity),
      selling_price_each: Number(item.sellingPrice),
      cost_price_each: Number(item.costPrice),
    }));

    const { error: itemsError } = await supabase
      .from("sale_items")
      .insert(saleItems);

    if (itemsError) {
      console.error("Sale items error:", itemsError);

      await supabase
        .from("sales")
        .delete()
        .eq("id", sale.id);

      setMessage(
        `Could not add sale items: ${itemsError.message}`
      );
      setSaving(false);
      return;
    }

    setMessage(
      `Sale recorded successfully — £${saleTotal.toFixed(2)}`
    );

    setItems([blankItem()]);
    setCustomerReference("");
    setEventId("");
    setNotes("");
    setSaleDate(todayString());

    setSaving(false);
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
      <div
        style={{
          maxWidth: "900px",
          margin: "0 auto",
        }}
      >
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
            marginBottom: "8px",
          }}
        >
          Record Sale
        </h1>

        <p
          style={{
            color: "#666",
            marginBottom: "28px",
          }}
        >
          Record one or more products as a single sale.
        </p>

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
            <h2 style={{ marginTop: 0 }}>
              Sale Details
            </h2>

            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "16px",
                marginBottom: "20px",
              }}
            >
              <div>
                <label style={labelStyle}>
                  Sale Date
                </label>

                <input
                  type="date"
                  value={saleDate}
                  onChange={(e) =>
                    setSaleDate(e.target.value)
                  }
                  style={fieldStyle}
                  required
                />
              </div>

              <div>
                <label style={labelStyle}>
                  Customer / Reference
                </label>

                <input
                  type="text"
                  value={customerReference}
                  onChange={(e) =>
                    setCustomerReference(e.target.value)
                  }
                  placeholder="e.g. Luxury Roofing"
                  style={fieldStyle}
                />
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fit, minmax(180px, 1fr))",
                gap: "16px",
                marginBottom: "20px",
              }}
            >
              <div>
                <label style={labelStyle}>
                  Sales Channel
                </label>

                <select
                  value={salesChannel}
                  onChange={(e) =>
                    setSalesChannel(e.target.value)
                  }
                  style={fieldStyle}
                >
                  <option>Direct</option>
                  <option>Shopify</option>
                  <option>Event</option>
                  <option>Other</option>
                </select>
              </div>

              <div>
                <label style={labelStyle}>
                  Payment Method
                </label>

                <select
                  value={paymentMethod}
                  onChange={(e) =>
                    setPaymentMethod(e.target.value)
                  }
                  style={fieldStyle}
                >
                  <option>Bank Transfer</option>
                  <option>Cash</option>
                  <option>Card</option>
                  <option>Shopify</option>
                  <option>Other</option>
                </select>
              </div>

              <div>
                <label style={labelStyle}>Event</label>

                <select
                  value={eventId}
                  onChange={(e) => setEventId(e.target.value)}
                  style={fieldStyle}
                >
                  <option value="">Not linked to an event</option>
                  {events.map((event) => (
                    <option key={event.id} value={event.id}>
                      {event.event_name} — {event.start_date}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={labelStyle}>
                  Money Paid Into
                </label>

                <select
                  value={accountId}
                  onChange={(e) =>
                    setAccountId(e.target.value)
                  }
                  style={fieldStyle}
                  required
                >
                  <option value="">
                    Select account...
                  </option>

                  {accounts.map((account) => (
                    <option
                      key={account.id}
                      value={account.id}
                    >
                      {account.account_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label style={labelStyle}>Notes</label>

              <textarea
                value={notes}
                onChange={(e) =>
                  setNotes(e.target.value)
                }
                rows="3"
                style={fieldStyle}
              />
            </div>
          </div>

          <div
            style={{
              background: "#fff",
              padding: "28px",
              borderRadius: "14px",
              boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
              marginBottom: "20px",
            }}
          >
            <h2 style={{ marginTop: 0 }}>
              Products / Services
            </h2>

            {items.map((item, index) => {
              const lineTotal =
                Number(item.quantity || 0) *
                Number(item.sellingPrice || 0);

              return (
                <div
                  key={index}
                  style={{
                    padding: "20px",
                    background: "#f7f7f8",
                    borderRadius: "10px",
                    marginBottom: "16px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "14px",
                    }}
                  >
                    <strong>
                      Item {index + 1}
                    </strong>

                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          removeItem(index)
                        }
                        style={{
                          border: "none",
                          background: "transparent",
                          cursor: "pointer",
                          textDecoration: "underline",
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fit, minmax(150px, 1fr))",
                      gap: "14px",
                    }}
                  >
                    <div
                      style={{
                        gridColumn: "span 2",
                      }}
                    >
                      <label style={labelStyle}>
                        Product / Service
                      </label>

                      <select
                        value={item.productId}
                        onChange={(e) =>
                          selectProduct(
                            index,
                            e.target.value
                          )
                        }
                        style={fieldStyle}
                        required
                      >
                        <option value="">
                          Select product...
                        </option>

                        {products.map((product) => (
                          <option
                            key={product.id}
                            value={product.id}
                          >
                            {product.product_name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label style={labelStyle}>
                        Qty
                      </label>

                      <input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(e) =>
                          updateItem(
                            index,
                            "quantity",
                            e.target.value
                          )
                        }
                        style={fieldStyle}
                        required
                      />
                    </div>

                    <div>
                      <label style={labelStyle}>
                        Price Each (£)
                      </label>

                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.sellingPrice}
                        onChange={(e) =>
                          updateItem(
                            index,
                            "sellingPrice",
                            e.target.value
                          )
                        }
                        style={fieldStyle}
                        required
                      />
                    </div>

                    <div>
                      <label style={labelStyle}>
                        Cost Each (£)
                      </label>

                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.costPrice}
                        onChange={(e) =>
                          updateItem(
                            index,
                            "costPrice",
                            e.target.value
                          )
                        }
                        style={fieldStyle}
                        required
                      />
                    </div>

                    <div>
                      <label style={labelStyle}>
                        Line Total
                      </label>

                      <div
                        style={{
                          ...fieldStyle,
                          background: "#eee",
                          fontWeight: "700",
                        }}
                      >
                        £{lineTotal.toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            <button
              type="button"
              onClick={addItem}
              style={{
                padding: "12px 18px",
                border: "1px solid #ccc",
                borderRadius: "8px",
                background: "#fff",
                fontWeight: "600",
                cursor: "pointer",
              }}
            >
              + Add Another Item
            </button>
          </div>

          <div
            style={{
              background: "#fff",
              padding: "28px",
              borderRadius: "14px",
              boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fit, minmax(180px, 1fr))",
                gap: "18px",
                marginBottom: "24px",
              }}
            >
              <div>
                <div style={{ color: "#666" }}>
                  Sale Total
                </div>
                <div
                  style={{
                    fontSize: "30px",
                    fontWeight: "700",
                  }}
                >
                  £{saleTotal.toFixed(2)}
                </div>
              </div>

              <div>
                <div style={{ color: "#666" }}>
                  Direct Cost
                </div>
                <div
                  style={{
                    fontSize: "30px",
                    fontWeight: "700",
                  }}
                >
                  £{directCostTotal.toFixed(2)}
                </div>
              </div>

              <div>
                <div style={{ color: "#666" }}>
                  Gross Profit
                </div>
                <div
                  style={{
                    fontSize: "30px",
                    fontWeight: "700",
                  }}
                >
                  £{grossProfit.toFixed(2)}
                </div>
              </div>
            </div>

            {message && (
              <div
                style={{
                  padding: "14px",
                  background: "#f2f2f2",
                  borderRadius: "8px",
                  marginBottom: "18px",
                }}
              >
                {message}
              </div>
            )}

            <button
              type="submit"
              disabled={saving}
              style={{
                width: "100%",
                padding: "16px",
                border: "none",
                borderRadius: "9px",
                background: "#111",
                color: "#fff",
                fontSize: "17px",
                fontWeight: "700",
                cursor: saving
                  ? "not-allowed"
                  : "pointer",
              }}
            >
              {saving
                ? "Recording Sale..."
                : `Record Sale — £${saleTotal.toFixed(
                    2
                  )}`}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
