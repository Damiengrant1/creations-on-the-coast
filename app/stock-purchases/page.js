"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

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
    costPerUnit: "",
  };
}

export default function StockPurchasesPage() {
  const [products, setProducts] = useState([]);
  const [accounts, setAccounts] = useState([]);

  const [purchaseDate, setPurchaseDate] = useState(todayString());
  const [supplier, setSupplier] = useState("");
  const [accountId, setAccountId] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  const [items, setItems] = useState([blankItem()]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setMessage("");
    setMessageType("");

    const { data: productData, error: productError } = await supabase
      .from("products")
      .select(
        "id, product_name, sku, category, colour, size, stock_cost, track_stock, active"
      )
      .eq("track_stock", true)
      .eq("active", true)
      .order("product_name");

    const { data: accountData, error: accountError } = await supabase
      .from("accounts")
      .select("id, account_name, account_type, active")
      .eq("active", true)
      .order("account_name");

    if (productError || accountError) {
      const error = productError || accountError;
      console.error("Could not load stock purchase data:", error);
      setMessage(`Could not load the page: ${error.message}`);
      setMessageType("error");
      setProducts([]);
      setAccounts([]);
      setLoading(false);
      return;
    }

    setProducts(productData || []);
    setAccounts(accountData || []);
    setLoading(false);
  }

  function productLabel(product) {
    return [
      product.product_name,
      product.colour,
      product.size,
      product.sku ? `SKU: ${product.sku}` : null,
    ]
      .filter(Boolean)
      .join(" / ");
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
    const selectedProduct = products.find(
      (product) => product.id === productId
    );

    setItems((currentItems) =>
      currentItems.map((item, itemIndex) => {
        if (itemIndex !== index) return item;

        return {
          ...item,
          productId,
          costPerUnit:
            selectedProduct?.stock_cost !== null &&
            selectedProduct?.stock_cost !== undefined
              ? String(selectedProduct.stock_cost)
              : "",
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

  const purchaseTotal = useMemo(
    () =>
      items.reduce(
        (sum, item) =>
          sum +
          Number(item.quantity || 0) *
            Number(item.costPerUnit || 0),
        0
      ),
    [items]
  );

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");
    setMessageType("");

    if (!purchaseDate) {
      setMessage("Please select the purchase date.");
      setMessageType("error");
      return;
    }

    if (!supplier.trim()) {
      setMessage("Please enter the supplier.");
      setMessageType("error");
      return;
    }

    if (!accountId) {
      setMessage("Please select the account used to pay.");
      setMessageType("error");
      return;
    }

    const invalidItem = items.some(
      (item) =>
        !item.productId ||
        !Number.isInteger(Number(item.quantity)) ||
        Number(item.quantity) <= 0 ||
        item.costPerUnit === "" ||
        Number(item.costPerUnit) < 0
    );

    if (invalidItem) {
      setMessage(
        "Complete every item with a product, whole-number quantity and valid stock cost."
      );
      setMessageType("error");
      return;
    }

    const selectedProductIds = items.map((item) => item.productId);
    const duplicateProduct = selectedProductIds.some(
      (productId, index) =>
        selectedProductIds.indexOf(productId) !== index
    );

    if (duplicateProduct) {
      setMessage(
        "The same product appears more than once. Combine it into one line before saving."
      );
      setMessageType("error");
      return;
    }

    setSaving(true);

    const { data: purchase, error: purchaseError } = await supabase
      .from("stock_purchases")
      .insert({
        purchase_date: purchaseDate,
        supplier: supplier.trim(),
        account_id: accountId,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
      })
      .select("id")
      .single();

    if (purchaseError) {
      console.error("Could not create stock purchase:", purchaseError);
      setMessage(
        `Could not create stock purchase: ${purchaseError.message}`
      );
      setMessageType("error");
      setSaving(false);
      return;
    }

    const purchaseItems = items.map((item) => {
      const quantity = Number(item.quantity);
      const costPerUnit = Number(item.costPerUnit);

      return {
        stock_purchase_id: purchase.id,
        product_id: item.productId,
        quantity,
        cost_per_unit: costPerUnit,
      };
    });

    const { error: itemsError } = await supabase
      .from("stock_purchase_items")
      .insert(purchaseItems);

    if (itemsError) {
      console.error("Could not create stock purchase items:", itemsError);

      const { error: rollbackError } = await supabase
        .from("stock_purchases")
        .delete()
        .eq("id", purchase.id);

      if (rollbackError) {
        console.error(
          "Could not remove incomplete stock purchase:",
          rollbackError
        );
      }

      setMessage(
        `Could not add purchase items: ${itemsError.message}`
      );
      setMessageType("error");
      setSaving(false);
      return;
    }

    setMessage(
      `Stock purchase recorded successfully — £${purchaseTotal.toFixed(2)}`
    );
    setMessageType("success");

    setPurchaseDate(todayString());
    setSupplier("");
    setAccountId("");
    setReference("");
    setNotes("");
    setItems([blankItem()]);
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
      <div style={{ maxWidth: "1050px", margin: "0 auto" }}>
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
          Record Stock Purchase
        </h1>

        <p
          style={{
            color: "#666",
            margin: "0 0 28px",
          }}
        >
          Record blank stock purchased from a supplier. Stock quantities and
          the selected account will update automatically.
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
            Loading products and accounts...
          </div>
        ) : (
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
              <h2 style={{ marginTop: 0 }}>Purchase Details</h2>

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
                  <label style={labelStyle}>Purchase Date</label>
                  <input
                    type="date"
                    value={purchaseDate}
                    onChange={(event) =>
                      setPurchaseDate(event.target.value)
                    }
                    style={fieldStyle}
                    required
                  />
                </div>

                <div>
                  <label style={labelStyle}>Supplier</label>
                  <input
                    value={supplier}
                    onChange={(event) =>
                      setSupplier(event.target.value)
                    }
                    placeholder="e.g. Uneek Clothing"
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
                  <label style={labelStyle}>
                    Invoice / Order Reference
                  </label>
                  <input
                    value={reference}
                    onChange={(event) =>
                      setReference(event.target.value)
                    }
                    placeholder="Optional"
                    style={fieldStyle}
                  />
                </div>
              </div>

              <div>
                <label style={labelStyle}>Notes</label>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
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
              <h2 style={{ marginTop: 0 }}>Stock Purchased</h2>

              {items.map((item, index) => {
                const lineTotal =
                  Number(item.quantity || 0) *
                  Number(item.costPerUnit || 0);

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
                        gap: "12px",
                        marginBottom: "14px",
                      }}
                    >
                      <strong>Item {index + 1}</strong>

                      {items.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeItem(index)}
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
                          "minmax(280px, 2fr) repeat(3, minmax(130px, 1fr))",
                        gap: "14px",
                        alignItems: "end",
                      }}
                    >
                      <div>
                        <label style={labelStyle}>Product / Variant</label>
                        <select
                          value={item.productId}
                          onChange={(event) =>
                            selectProduct(index, event.target.value)
                          }
                          style={fieldStyle}
                          required
                        >
                          <option value="">Select product...</option>
                          {products.map((product) => (
                            <option
                              key={product.id}
                              value={product.id}
                            >
                              {productLabel(product)}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label style={labelStyle}>Quantity</label>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={item.quantity}
                          onChange={(event) =>
                            updateItem(
                              index,
                              "quantity",
                              event.target.value
                            )
                          }
                          style={fieldStyle}
                          required
                        />
                      </div>

                      <div>
                        <label style={labelStyle}>
                          Stock Cost Each (£)
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.costPerUnit}
                          onChange={(event) =>
                            updateItem(
                              index,
                              "costPerUnit",
                              event.target.value
                            )
                          }
                          style={fieldStyle}
                          required
                        />
                      </div>

                      <div>
                        <label style={labelStyle}>Line Total</label>
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
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "20px",
                  flexWrap: "wrap",
                  marginBottom: "22px",
                }}
              >
                <div>
                  <div style={{ color: "#666", marginBottom: "5px" }}>
                    Purchase Total
                  </div>
                  <div
                    style={{
                      fontSize: "32px",
                      fontWeight: "700",
                    }}
                  >
                    £{purchaseTotal.toFixed(2)}
                  </div>
                </div>

                <div
                  style={{
                    color: "#666",
                    maxWidth: "520px",
                    fontSize: "14px",
                  }}
                >
                  Unit cost defaults to the product’s Stock Cost. Change it if
                  the supplier price on this purchase is different.
                </div>
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
                  ? "Recording Purchase..."
                  : `Record Stock Purchase — £${purchaseTotal.toFixed(
                      2
                    )}`}
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
