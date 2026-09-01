"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import Link from "next/link";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

export default function RecordSalePage() {
  const [products, setProducts] = useState([]);
  const [accounts, setAccounts] = useState([]);

  const [productId, setProductId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [sellingPrice, setSellingPrice] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [customerReference, setCustomerReference] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Bank Transfer");
  const [salesChannel, setSalesChannel] = useState("Direct");
  const [notes, setNotes] = useState("");

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

    if (productError) {
      console.error(productError);
    } else {
      setProducts(productData || []);
    }

    if (accountError) {
      console.error(accountError);
    } else {
      setAccounts(accountData || []);
    }
  }

  function selectProduct(id) {
    setProductId(id);

    const product = products.find((item) => item.id === id);

    if (product) {
      setSellingPrice(product.selling_price ?? "");
      setCostPrice(product.cost_price ?? "");
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");

    if (!productId) {
      setMessage("Please select a product or service.");
      return;
    }

    if (!accountId) {
      setMessage("Please select the account the payment went into.");
      return;
    }

    if (Number(quantity) <= 0) {
      setMessage("Quantity must be at least 1.");
      return;
    }

    setSaving(true);

    const { data: sale, error: saleError } = await supabase
      .from("sales")
      .insert({
        sale_datetime: new Date().toISOString(),
        customer_reference: customerReference || null,
        sales_channel: salesChannel,
        payment_method: paymentMethod,
        account_id: accountId,
        notes: notes || null,
      })
      .select("id")
      .single();

    if (saleError) {
      console.error(saleError);
      setMessage(`Could not create sale: ${saleError.message}`);
      setSaving(false);
      return;
    }

    const { error: itemError } = await supabase
      .from("sale_items")
      .insert({
        sale_id: sale.id,
        product_id: productId,
        quantity: Number(quantity),
        selling_price_each: Number(sellingPrice),
        cost_price_each: Number(costPrice),
      });

    if (itemError) {
      console.error(itemError);

      // Remove the empty sale if its item failed.
      await supabase.from("sales").delete().eq("id", sale.id);

      setMessage(`Could not add sale item: ${itemError.message}`);
      setSaving(false);
      return;
    }

    const total = Number(quantity) * Number(sellingPrice);

    setMessage(`Sale recorded successfully — £${total.toFixed(2)}`);

    setProductId("");
    setQuantity(1);
    setSellingPrice("");
    setCostPrice("");
    setCustomerReference("");
    setNotes("");

    setSaving(false);
  }

  const total =
    Number(quantity || 0) * Number(sellingPrice || 0);

  const fieldStyle = {
    width: "100%",
    padding: "12px",
    border: "1px solid #ddd",
    borderRadius: "8px",
    fontSize: "16px",
    boxSizing: "border-box",
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
          maxWidth: "700px",
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

        <h1 style={{ fontSize: "36px", marginBottom: "8px" }}>
          Record Sale
        </h1>

        <p style={{ color: "#666", marginBottom: "28px" }}>
          Add a new Creations on the Coast sale.
        </p>

        <form
          onSubmit={handleSubmit}
          style={{
            background: "#fff",
            padding: "28px",
            borderRadius: "14px",
            boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
          }}
        >
          <div style={{ marginBottom: "20px" }}>
            <label style={labelStyle}>Product / Service</label>

            <select
              value={productId}
              onChange={(e) => selectProduct(e.target.value)}
              style={fieldStyle}
              required
            >
              <option value="">Select product...</option>

              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.product_name}
                </option>
              ))}
            </select>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "16px",
              marginBottom: "20px",
            }}
          >
            <div>
              <label style={labelStyle}>Quantity</label>

              <input
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                style={fieldStyle}
                required
              />
            </div>

            <div>
              <label style={labelStyle}>Selling Price Each (£)</label>

              <input
                type="number"
                step="0.01"
                min="0"
                value={sellingPrice}
                onChange={(e) => setSellingPrice(e.target.value)}
                style={fieldStyle}
                required
              />
            </div>
          </div>

          <div style={{ marginBottom: "20px" }}>
            <label style={labelStyle}>Direct Cost Each (£)</label>

            <input
              type="number"
              step="0.01"
              min="0"
              value={costPrice}
              onChange={(e) => setCostPrice(e.target.value)}
              style={fieldStyle}
              required
            />
          </div>

          <div style={{ marginBottom: "20px" }}>
            <label style={labelStyle}>Customer / Reference</label>

            <input
              type="text"
              value={customerReference}
              onChange={(e) => setCustomerReference(e.target.value)}
              placeholder="e.g. Luxury Roofing"
              style={fieldStyle}
            />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "16px",
              marginBottom: "20px",
            }}
          >
            <div>
              <label style={labelStyle}>Sales Channel</label>

              <select
                value={salesChannel}
                onChange={(e) => setSalesChannel(e.target.value)}
                style={fieldStyle}
              >
                <option>Direct</option>
                <option>Shopify</option>
                <option>Event</option>
                <option>Other</option>
              </select>
            </div>

            <div>
              <label style={labelStyle}>Payment Method</label>

              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                style={fieldStyle}
              >
                <option>Bank Transfer</option>
                <option>Cash</option>
                <option>Card</option>
                <option>Shopify</option>
                <option>Other</option>
              </select>
            </div>
          </div>

          <div style={{ marginBottom: "20px" }}>
            <label style={labelStyle}>Money Paid Into</label>

            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
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

          <div style={{ marginBottom: "24px" }}>
            <label style={labelStyle}>Notes</label>

            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows="3"
              style={fieldStyle}
            />
          </div>

          <div
            style={{
              background: "#f7f7f8",
              padding: "18px",
              borderRadius: "10px",
              marginBottom: "20px",
            }}
          >
            <div style={{ color: "#666" }}>Sale Total</div>

            <div
              style={{
                fontSize: "30px",
                fontWeight: "700",
                marginTop: "4px",
              }}
            >
              £{total.toFixed(2)}
            </div>
          </div>

          {message && (
            <div
              style={{
                marginBottom: "18px",
                padding: "12px",
                background: "#f2f2f2",
                borderRadius: "8px",
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
              padding: "15px",
              border: "none",
              borderRadius: "9px",
              background: "#111",
              color: "#fff",
              fontSize: "16px",
              fontWeight: "700",
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            {saving ? "Saving..." : "Record Sale"}
          </button>
        </form>
      </div>
    </main>
  );
}
