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
    netCostPerUnit: "",
    priceMode: "unit",
    totalCost: "",
    totalIncludesVat: false,
    vatRate: "0.2",
  };
}

function netUnitCost(item) {
  if (item.priceMode !== "total") return Number(item.netCostPerUnit || 0);
  const quantity = Number(item.quantity);
  if (!(quantity > 0)) return 0;
  const total = Number(item.totalCost || 0);
  return total / quantity / (item.totalIncludesVat ? 1 + Number(item.vatRate) : 1);
}

function grossCostPerUnit(item) {
  return netUnitCost(item) * (1 + Number(item.vatRate || 0));
}

function grossLineTotal(item) {
  const total = item.priceMode === "total" && item.totalIncludesVat
    ? Number(item.totalCost || 0)
    : Number(item.quantity || 0) * grossCostPerUnit(item);
  return Math.round((total + Number.EPSILON) * 100) / 100;
}

// Allocate whole pennies proportionally so saved line totals exactly match the order.
function supplierDiscount(lines, type, value) {
  const cents = lines.map((line) => Math.round(line * 100));
  const subtotal = cents.reduce((sum, line) => sum + line, 0);
  const input = Number(value || 0);
  const discount = Math.round(type === "percent" ? subtotal * input / 100 : input * 100);
  if (!Number.isFinite(input) || input < 0 || (type === "percent" && input > 100) || discount > subtotal) {
    return { error: "Supplier discount must be between zero and the stock subtotal (maximum 100%).", amount: 0, lines };
  }
  if (!subtotal || !discount) return { amount: 0, lines };
  const shares = cents.map((line, index) => {
    const exact = discount * line / subtotal;
    return { index, pennies: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let remaining = discount - shares.reduce((sum, share) => sum + share.pennies, 0);
  const ranked = [...shares].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; i < remaining; i++) ranked[i].pennies++;
  return { amount: discount / 100, lines: cents.map((line, index) => (line - shares[index].pennies) / 100) };
}

export default function StockPurchasesPage() {
  const [products, setProducts] = useState([]);
  const [accounts, setAccounts] = useState([]);

  const [purchaseDate, setPurchaseDate] = useState(todayString());
  const [supplier, setSupplier] = useState("");
  const [accountId, setAccountId] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [deliveryFee, setDeliveryFee] = useState("");
  const [discountType, setDiscountType] = useState("amount");
  const [discountValue, setDiscountValue] = useState("");

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
    setItems((currentItems) =>
      currentItems.map((item, itemIndex) => {
        if (itemIndex !== index) return item;

        return {
          ...item,
          productId,
          netCostPerUnit: "",
          totalCost: "",
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

  const stockSubtotal = useMemo(
    () =>
      items.reduce(
        (sum, item) =>
          sum +
          grossLineTotal(item),
        0
      ),
    [items]
  );
  const deliveryTotal = Number(deliveryFee || 0);
  const discount = supplierDiscount(items.map(grossLineTotal), discountType, discountValue);
  const discountedStockTotal = Math.round((stockSubtotal - discount.amount) * 100) / 100;
  const purchaseTotal = discountedStockTotal + deliveryTotal;

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
        (item.priceMode === "total" ? item.totalCost : item.netCostPerUnit) === "" ||
        !Number.isFinite(netUnitCost(item)) ||
        netUnitCost(item) < 0 ||
        ![0, 0.2].includes(Number(item.vatRate))
    );

    if (invalidItem) {
      setMessage(
        "Complete every item with a product, whole-number quantity, price and VAT choice."
      );
      setMessageType("error");
      return;
    }

    if (deliveryFee !== "" && (Number.isNaN(deliveryTotal) || deliveryTotal < 0)) {
      setMessage("Delivery fee must be zero or a positive amount.");
      setMessageType("error");
      return;
    }

    if (discount.error) {
      setMessage(discount.error);
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
        notes: [notes.trim(), discount.amount > 0
          ? `Supplier discount: ${discountType === "percent" ? `${Number(discountValue)}% — ` : ""}£${discount.amount.toFixed(2)} including VAT, applied to stock only. Stock before discount £${stockSubtotal.toFixed(2)}; after discount £${discountedStockTotal.toFixed(2)}.`
          : ""].filter(Boolean).join("\n") || null,
        delivery_fee: deliveryTotal,
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

    const purchaseItems = items.map((item, index) => {
      const quantity = Number(item.quantity);
      const vatRate = Number(item.vatRate);
      const grossUnitCost = discount.amount > 0
        ? discount.lines[index] / quantity
        : grossCostPerUnit(item);
      const netCostPerUnit = grossUnitCost / (1 + vatRate);

      return {
        stock_purchase_id: purchase.id,
        product_id: item.productId,
        quantity,
        net_cost_per_unit: netCostPerUnit,
        vat_rate: vatRate,
        cost_per_unit: grossUnitCost,
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
    setDeliveryFee("");
    setDiscountValue("");
    setDiscountType("amount");
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

        <Link href="/supplier-credits" style={{ display: "inline-block", marginBottom: "24px", color: "#333", fontWeight: "600" }}>
          Record a supplier refund or credit note →
        </Link>

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

                <div>
                  <label style={labelStyle}>Delivery Fee (Gross £)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={deliveryFee}
                    onChange={(event) => setDeliveryFee(event.target.value)}
                    placeholder="0.00"
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
                const grossUnitCost = grossCostPerUnit(item);
                const lineTotal = grossLineTotal(item);

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
                          "repeat(auto-fit, minmax(170px, 1fr))",
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
                        <label style={labelStyle} htmlFor={`price-mode-${index}`}>Enter Price As</label>
                        <select id={`price-mode-${index}`} value={item.priceMode}
                          onChange={(event) => updateItem(index, "priceMode", event.target.value)} style={fieldStyle}>
                          <option value="unit">Unit price</option>
                          <option value="total">Total for this quantity</option>
                        </select>
                      </div>

                      <div>
                        <label style={labelStyle} htmlFor={`price-${index}`}>
                          {item.priceMode === "total" ? "Total Price (£)" : "Net Cost Each (£)"}
                        </label>
                        <input
                          type="number"
                          min="0"
                          id={`price-${index}`}
                          step={item.priceMode === "total" ? "0.01" : "any"}
                          value={item.priceMode === "total" ? item.totalCost : item.netCostPerUnit}
                          onChange={(event) =>
                            updateItem(
                              index,
                              item.priceMode === "total" ? "totalCost" : "netCostPerUnit",
                              event.target.value
                            )
                          }
                          style={fieldStyle}
                          required
                        />
                      </div>

                      {item.priceMode === "total" && (
                        <div>
                          <label style={labelStyle} htmlFor={`vat-basis-${index}`}>Total Price Is</label>
                          <select id={`vat-basis-${index}`} value={String(item.totalIncludesVat)}
                            onChange={(event) => updateItem(index, "totalIncludesVat", event.target.value === "true")} style={fieldStyle}>
                            <option value="false">Excluding VAT</option>
                            <option value="true">Including VAT</option>
                          </select>
                        </div>
                      )}

                      <div>
                        <label style={labelStyle}>VAT</label>
                        <select
                          value={item.vatRate}
                          onChange={(event) =>
                            updateItem(index, "vatRate", event.target.value)
                          }
                          style={fieldStyle}
                        >
                          <option value="0.2">{item.priceMode === "total" && item.totalIncludesVat ? "VAT included (20%)" : "Add VAT (20%)"}</option>
                          <option value="0">No VAT</option>
                        </select>
                      </div>

                      <div>
                        <label style={labelStyle}>Gross Cost Each</label>
                        <div
                          style={{
                            ...fieldStyle,
                            background: "#eee",
                            fontWeight: "700",
                          }}
                        >
                          £{grossUnitCost.toFixed(2)}
                        </div>
                      </div>

                      <div>
                        <label style={labelStyle}>Gross Line Total</label>
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
              <h2 style={{ marginTop: 0 }}>Supplier Discount</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px" }}>
                <div>
                  <label htmlFor="supplier-discount-type" style={labelStyle}>Discount Type</label>
                  <select id="supplier-discount-type" value={discountType} onChange={(event) => { setDiscountType(event.target.value); setDiscountValue(""); }} style={fieldStyle}>
                    <option value="amount">Amount (£ including VAT)</option>
                    <option value="percent">Percentage (%)</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="supplier-discount" style={labelStyle}>Supplier Discount ({discountType === "percent" ? "%" : "£"})</label>
                  <input id="supplier-discount" type="number" min="0" max={discountType === "percent" ? 100 : stockSubtotal} step="0.01" placeholder="0.00" value={discountValue} onChange={(event) => setDiscountValue(event.target.value)} style={fieldStyle} />
                </div>
              </div>
              <p style={{ color: "#666", lineHeight: 1.5 }}>Optional. Applies to the stock subtotal including VAT, before delivery. Enter prices before this discount; do not enter a discount already included in your item prices.</p>
              {discount.error && <p role="alert" style={{ color: "#9b1c1c" }}>{discount.error}</p>}

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
                    Stock Before Discount
                  </div>
                  <div style={{ fontSize: "20px", fontWeight: "700" }}>
                    £{stockSubtotal.toFixed(2)}
                  </div>
                </div>

                <div>
                  <div style={{ color: "#666", marginBottom: "5px" }}>Supplier Discount</div>
                  <div style={{ fontSize: "20px", fontWeight: "700" }}>−£{discount.amount.toFixed(2)}</div>
                </div>
                <div>
                  <div style={{ color: "#666", marginBottom: "5px" }}>Stock After Discount</div>
                  <div style={{ fontSize: "20px", fontWeight: "700" }}>£{discountedStockTotal.toFixed(2)}</div>
                </div>

                <div>
                  <div style={{ color: "#666", marginBottom: "5px" }}>
                    Delivery Fee
                  </div>
                  <div style={{ fontSize: "20px", fontWeight: "700" }}>
                    £{deliveryTotal.toFixed(2)}
                  </div>
                </div>

                <div>
                  <div style={{ color: "#666", marginBottom: "5px" }}>
                    Total Paid
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
                  Enter a unit price or the total price for each product’s quantity.
                  For a total, choose whether VAT is included. Unit costs are calculated
                  automatically without rounding to whole pennies before saving.
                  Delivery is entered including VAT and remains separate.
                </div>
              </div>

              <button
                type="submit"
                disabled={saving || Boolean(discount.error)}
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
