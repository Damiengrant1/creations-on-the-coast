"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useAccess } from "../AuthGate";

const money = (value) => `£${Number(value || 0).toFixed(2)}`;

export default function EventPosPage() {
  const { isAdmin } = useAccess();
  const [products, setProducts] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [events, setEvents] = useState([]);
  const [category, setCategory] = useState("All");
  const [basket, setBasket] = useState([]);
  const [eventId, setEventId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setMessage("");
    const [productResult, accountResult, eventResult] = await Promise.all([
      supabase
        .from("products")
        .select("id, product_name, category, selling_price, cost_price, colour, size, track_stock")
        .eq("active", true)
        .order("product_name"),
      supabase
        .from("accounts")
        .select("id, account_name, account_type")
        .eq("active", true)
        .order("account_name"),
      supabase
        .from("events")
        .select("id, event_name, start_date, status")
        .neq("status", "cancelled")
        .order("start_date", { ascending: false }),
    ]);

    const error = productResult.error || accountResult.error || eventResult.error;
    if (error) {
      setMessage(`Could not load the POS: ${error.message}`);
    } else {
      const loadedAccounts = accountResult.data || [];
      setProducts(productResult.data || []);
      setAccounts(loadedAccounts);
      setEvents(eventResult.data || []);
      const cashAccount = loadedAccounts.find((account) =>
        account.account_name.toLowerCase().includes("cash")
      );
      setAccountId(cashAccount?.id || loadedAccounts[0]?.id || "");
    }
    setLoading(false);
  }

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(products.map((product) => product.category || "Other"))).sort()],
    [products]
  );

  const visibleProducts = useMemo(
    () => products.filter((product) => category === "All" || (product.category || "Other") === category),
    [products, category]
  );

  const total = basket.reduce((sum, item) => sum + item.quantity * item.price, 0);

  function productLabel(product) {
    return [product.product_name, product.colour, product.size].filter(Boolean).join(" · ");
  }

  function addProduct(product) {
    setMessage("");
    setBasket((current) => {
      const existing = current.find((item) => item.productId === product.id && item.price === Number(product.selling_price || 0));
      if (existing) {
        return current.map((item) => item.productId === product.id && item.price === Number(product.selling_price || 0)
          ? { ...item, quantity: item.quantity + 1 }
          : item
        );
      }
      return [...current, {
        productId: product.id,
        name: productLabel(product),
        quantity: 1,
        price: Number(product.selling_price || 0),
        cost: Number(product.cost_price || 0),
      }];
    });
  }

  function updateItem(index, changes) {
    setBasket((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...changes } : item));
  }

  function removeItem(index) {
    setBasket((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function choosePayment(method) {
    setPaymentMethod(method);
    const account = accounts.find((item) => {
      const name = item.account_name.toLowerCase();
      if (method === "Cash") return name.includes("cash");
      if (method === "Card") return name.includes("sumup") || name.includes("card");
      return false;
    });
    if (account) setAccountId(account.id);
  }

  async function completeSale() {
    setMessage("");
    if (!isAdmin) {
      setMessage("Only administrators can complete POS sales.");
      return;
    }
    if (!basket.length) {
      setMessage("Add at least one item to the basket.");
      return;
    }
    if (!accountId) {
      setMessage("Select where the payment was received.");
      return;
    }
    if (basket.some((item) => item.quantity <= 0 || Number.isNaN(item.price) || item.price < 0)) {
      setMessage("Check the quantity and price for every basket item.");
      return;
    }

    setSaving(true);
    const { data: sale, error: saleError } = await supabase
      .from("sales")
      .insert({
        sale_datetime: new Date().toISOString(),
        customer_reference: null,
        sales_channel: "Event POS",
        payment_method: paymentMethod,
        account_id: accountId,
        event_id: eventId || null,
        notes: "Event POS sale",
      })
      .select("id")
      .single();

    if (saleError) {
      setMessage(`Could not complete sale: ${saleError.message}`);
      setSaving(false);
      return;
    }

    const { error: itemError } = await supabase.from("sale_items").insert(
      basket.map((item) => ({
        sale_id: sale.id,
        product_id: item.productId,
        quantity: Number(item.quantity),
        selling_price_each: Number(item.price),
        cost_price_each: Number(item.cost),
      }))
    );

    if (itemError) {
      await supabase.from("sales").delete().eq("id", sale.id);
      setMessage(`Could not add POS items: ${itemError.message}`);
      setSaving(false);
      return;
    }

    setMessage(`Sale completed — ${money(total)}`);
    setBasket([]);
    setSaving(false);
  }

  return (
    <main style={pageStyle}>
      <header style={headerStyle}>
        <div>
          <Link href="/" style={backStyle}>← Dashboard</Link>
          <h1 style={{ margin: "10px 0 4px" }}>Event POS</h1>
          <p style={{ margin: 0, color: "#555" }}>Fast sales for events — customer details are not needed.</p>
        </div>
        <button type="button" onClick={() => setBasket([])} disabled={!basket.length} style={secondaryButtonStyle}>Clear basket</button>
      </header>

      {message && <div style={message.toLowerCase().startsWith("sale completed") ? successStyle : errorStyle}>{message}</div>}

      <section style={settingsStyle}>
        <label style={labelStyle}>Event
          <select value={eventId} onChange={(event) => setEventId(event.target.value)} style={inputStyle}>
            <option value="">No event selected</option>
            {events.map((event) => <option key={event.id} value={event.id}>{event.event_name} — {event.start_date}</option>)}
          </select>
        </label>
        <label style={labelStyle}>Payment received into
          <select value={accountId} onChange={(event) => setAccountId(event.target.value)} style={inputStyle}>
            <option value="">Select account...</option>
            {accounts.map((account) => <option key={account.id} value={account.id}>{account.account_name}</option>)}
          </select>
        </label>
        <div>
          <div style={{ ...labelStyle, marginBottom: "8px" }}>Payment method</div>
          <div style={paymentRowStyle}>
            {["Cash", "Card", "Other"].map((method) => <button key={method} type="button" onClick={() => choosePayment(method)} style={paymentMethod === method ? selectedPaymentStyle : paymentStyle}>{method}</button>)}
          </div>
        </div>
      </section>

      <div style={layoutStyle}>
        <section>
          <div style={categoryRowStyle}>
            {categories.map((item) => <button key={item} type="button" onClick={() => setCategory(item)} style={category === item ? selectedCategoryStyle : categoryStyle}>{item}</button>)}
          </div>
          {loading ? <div style={panelStyle}>Loading products…</div> : <div style={productGridStyle}>
            {visibleProducts.map((product) => <button key={product.id} type="button" onClick={() => addProduct(product)} style={productButtonStyle}>
              <strong>{productLabel(product)}</strong>
              <span style={{ fontSize: "22px", marginTop: "10px" }}>{money(product.selling_price)}</span>
            </button>)}
          </div>}
        </section>

        <aside style={basketStyle}>
          <h2 style={{ marginTop: 0 }}>Basket</h2>
          {!basket.length ? <p style={{ color: "#666" }}>Tap products to add them here.</p> : basket.map((item, index) => <div key={`${item.productId}-${index}`} style={basketItemStyle}>
            <strong>{item.name}</strong>
            <div style={itemControlsStyle}>
              <button type="button" onClick={() => updateItem(index, { quantity: Math.max(1, item.quantity - 1) })} style={smallButtonStyle}>−</button>
              <span style={{ minWidth: "25px", textAlign: "center" }}>{item.quantity}</span>
              <button type="button" onClick={() => updateItem(index, { quantity: item.quantity + 1 })} style={smallButtonStyle}>+</button>
              <label style={{ marginLeft: "auto" }}>£<input aria-label={`Price for ${item.name}`} type="number" min="0" step="0.01" value={item.price} onChange={(event) => updateItem(index, { price: Number(event.target.value) })} style={priceInputStyle} /></label>
              <button type="button" onClick={() => removeItem(index)} style={removeStyle}>×</button>
            </div>
            <div style={{ textAlign: "right", fontWeight: "700", marginTop: "7px" }}>{money(item.quantity * item.price)}</div>
          </div>)}
          <div style={totalStyle}><span>Total</span><strong>{money(total)}</strong></div>
          <button type="button" disabled={saving || !basket.length || !isAdmin} onClick={completeSale} style={completeStyle}>{saving ? "Completing sale…" : `Complete Sale — ${money(total)}`}</button>
          {!isAdmin && <p style={{ color: "#9b1c1c", fontSize: "14px" }}>You can view the POS, but an administrator must complete sales.</p>}
        </aside>
      </div>
    </main>
  );
}

const pageStyle = { minHeight: "100vh", background: "#f4f4f5", padding: "24px", fontFamily: "Arial, sans-serif", boxSizing: "border-box" };
const headerStyle = { maxWidth: "1500px", margin: "0 auto 18px", display: "flex", justifyContent: "space-between", gap: "16px", alignItems: "flex-start" };
const backStyle = { color: "#222", fontWeight: "700" };
const settingsStyle = { maxWidth: "1500px", margin: "0 auto 18px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "14px", background: "#fff", padding: "18px", borderRadius: "14px" };
const labelStyle = { display: "grid", gap: "7px", fontWeight: "700" };
const inputStyle = { width: "100%", boxSizing: "border-box", padding: "12px", border: "1px solid #ccc", borderRadius: "8px", fontSize: "16px", background: "#fff" };
const layoutStyle = { maxWidth: "1500px", margin: "0 auto", display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(330px, 430px)", gap: "18px", alignItems: "start" };
const categoryRowStyle = { display: "flex", flexWrap: "wrap", gap: "9px", marginBottom: "16px" };
const categoryStyle = { border: "1px solid #bbb", background: "#fff", borderRadius: "9px", padding: "11px 14px", fontWeight: "700", cursor: "pointer" };
const selectedCategoryStyle = { ...categoryStyle, background: "#111", color: "#fff", borderColor: "#111" };
const productGridStyle = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: "12px" };
const productButtonStyle = { minHeight: "125px", textAlign: "left", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "16px", background: "#fff", border: "1px solid #ddd", borderRadius: "13px", cursor: "pointer", fontSize: "16px", boxShadow: "0 1px 4px rgba(0,0,0,0.05)" };
const basketStyle = { position: "sticky", top: "16px", background: "#fff", padding: "20px", borderRadius: "14px", boxShadow: "0 2px 10px rgba(0,0,0,0.08)" };
const basketItemStyle = { borderBottom: "1px solid #e5e5e5", padding: "12px 0" };
const itemControlsStyle = { display: "flex", alignItems: "center", gap: "8px", marginTop: "10px" };
const smallButtonStyle = { width: "31px", height: "31px", border: "1px solid #bbb", background: "#fff", borderRadius: "7px", cursor: "pointer", fontWeight: "700", fontSize: "18px" };
const priceInputStyle = { width: "68px", marginLeft: "3px", padding: "7px", border: "1px solid #bbb", borderRadius: "6px", fontSize: "15px" };
const removeStyle = { border: "none", background: "transparent", color: "#a11", fontSize: "25px", cursor: "pointer", marginLeft: "2px" };
const totalStyle = { display: "flex", justifyContent: "space-between", fontSize: "25px", padding: "20px 0", marginTop: "5px" };
const completeStyle = { width: "100%", padding: "17px", background: "#111", border: "none", borderRadius: "10px", color: "#fff", fontSize: "18px", fontWeight: "700", cursor: "pointer" };
const paymentRowStyle = { display: "flex", gap: "8px", flexWrap: "wrap" };
const paymentStyle = { padding: "11px 14px", border: "1px solid #bbb", borderRadius: "8px", background: "#fff", fontWeight: "700", cursor: "pointer" };
const selectedPaymentStyle = { ...paymentStyle, background: "#111", color: "#fff", borderColor: "#111" };
const secondaryButtonStyle = { padding: "12px 16px", background: "#fff", border: "1px solid #bbb", borderRadius: "9px", fontWeight: "700", cursor: "pointer" };
const panelStyle = { background: "#fff", padding: "24px", borderRadius: "14px" };
const successStyle = { maxWidth: "1500px", margin: "0 auto 18px", padding: "15px", background: "#edf9f0", border: "1px solid #b9e5c2", borderRadius: "10px", color: "#166534", fontWeight: "700" };
const errorStyle = { maxWidth: "1500px", margin: "0 auto 18px", padding: "15px", background: "#fff0f0", border: "1px solid #f1c1c1", borderRadius: "10px", color: "#9b1c1c", fontWeight: "700" };
