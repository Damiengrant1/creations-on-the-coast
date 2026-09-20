"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

const money = (value) => `£${Number(value || 0).toFixed(2)}`;
const LIBBY_CUP_SKU = "LIB-001";
const MISCELLANEOUS_SKU = "MISC-EVENT-POS";
const POS_CACHE_KEY = "creations-event-pos-cache-v1";
const OFFLINE_SALES_KEY = "creations-event-pos-offline-sales-v1";

function readStoredJson(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredJson(key, value) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function createOfflineSaleId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function isNetworkFailure(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return !navigator.onLine || message.includes("failed to fetch") || message.includes("network") || message.includes("load failed");
}

export default function EventPosPage() {
  const [products, setProducts] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [events, setEvents] = useState([]);
  const [category, setCategory] = useState("All");
  const [basket, setBasket] = useState([]);
  const [eventId, setEventId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [showMiscellaneous, setShowMiscellaneous] = useState(false);
  const [miscellaneousDescription, setMiscellaneousDescription] = useState("");
  const [miscellaneousPrice, setMiscellaneousPrice] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingOfflineSales, setPendingOfflineSales] = useState(0);
  const [offlineMode, setOfflineMode] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    setPendingOfflineSales(readStoredJson(OFFLINE_SALES_KEY, []).length);
    const syncWhenOnline = () => {
      setOfflineMode(!navigator.onLine);
      if (navigator.onLine) flushOfflineSales();
    };

    window.addEventListener("online", syncWhenOnline);
    window.addEventListener("offline", syncWhenOnline);
    syncWhenOnline();
    return () => {
      window.removeEventListener("online", syncWhenOnline);
      window.removeEventListener("offline", syncWhenOnline);
    };
  }, []);

  async function loadData() {
    setLoading(true);
    setMessage("");
    const [productResult, accountResult, eventResult] = await Promise.all([
      supabase
        .from("products")
        .select("id, product_name, sku, category, selling_price, cost_price, colour, size, track_stock")
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
      const cached = readStoredJson(POS_CACHE_KEY, null);
      if (cached?.products?.length && !navigator.onLine) {
        setProducts(cached.products);
        setAccounts(cached.accounts || []);
        setEvents(cached.events || []);
        setAccountId(cached.accountId || "");
        setOfflineMode(true);
        setMessage("Offline mode — using the last saved product list.");
      } else {
        setMessage(`Could not load the POS: ${error.message}`);
      }
    } else {
      const loadedAccounts = accountResult.data || [];
      setProducts(productResult.data || []);
      setAccounts(loadedAccounts);
      setEvents(eventResult.data || []);
      const cashAccount = loadedAccounts.find((account) =>
        account.account_name.toLowerCase().includes("cash")
      );
      setAccountId(cashAccount?.id || loadedAccounts[0]?.id || "");
      writeStoredJson(POS_CACHE_KEY, {
        products: productResult.data || [],
        accounts: loadedAccounts,
        events: eventResult.data || [],
        accountId: cashAccount?.id || loadedAccounts[0]?.id || "",
      });
    }
    setLoading(false);
  }

  async function uploadSale(sale) {
    const { error } = await supabase.rpc("record_event_pos_sale", {
      p_offline_event_pos_id: sale.offlineId,
      p_sale_datetime: sale.saleDatetime,
      p_payment_method: sale.paymentMethod,
      p_account_id: sale.accountId,
      p_event_id: sale.eventId || null,
      p_items: sale.items,
    });
    if (error) throw error;
  }

  async function flushOfflineSales() {
    if (!navigator.onLine) return;
    const queuedSales = readStoredJson(OFFLINE_SALES_KEY, []);
    if (!queuedSales.length) return;

    let remaining = [...queuedSales];
    try {
      for (const sale of queuedSales) {
        await uploadSale(sale);
        remaining = remaining.filter((item) => item.offlineId !== sale.offlineId);
        writeStoredJson(OFFLINE_SALES_KEY, remaining);
      }
      setPendingOfflineSales(0);
      setOfflineMode(false);
      setMessage("Offline POS sales uploaded successfully.");
    } catch (error) {
      setPendingOfflineSales(remaining.length);
      if (!isNetworkFailure(error)) {
        setMessage(`Could not upload saved POS sales: ${error.message}`);
      }
    }
  }

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(
      products
        .filter((product) => product.sku !== MISCELLANEOUS_SKU)
        .map((product) => product.category || "Other")
    )).sort()],
    [products]
  );

  const visibleProducts = useMemo(
    () => products.filter((product) =>
      product.sku !== MISCELLANEOUS_SKU &&
      (category === "All" || (product.category || "Other") === category)
    ),
    [products, category]
  );

  const total = basket.reduce((sum, item) => sum + item.quantity * item.price, 0);

  function productLabel(product) {
    return [product.product_name, product.colour, product.size].filter(Boolean).join(" · ");
  }

  function addProduct(product) {
    setMessage("");
    setBasket((current) => {
      if (product.sku === LIBBY_CUP_SKU) {
        const singleIndex = current.findIndex(
          (item) => item.productId === product.id && item.isLibbySingle
        );

        if (singleIndex >= 0) {
          const next = current.filter((_, index) => index !== singleIndex);
          const offerIndex = next.findIndex(
            (item) => item.productId === product.id && item.isLibbyOffer
          );

          if (offerIndex >= 0) {
            return next.map((item, index) =>
              index === offerIndex
                ? { ...item, quantity: item.quantity + 2 }
                : item
            );
          }

          return [...next, {
            productId: product.id,
            name: `${productLabel(product)} — 2 for £14 offer`,
            quantity: 2,
            price: 7,
            cost: Number(product.cost_price || 0),
            isLibbyOffer: true,
          }];
        }

        return [...current, {
          productId: product.id,
          name: productLabel(product),
          quantity: 1,
          price: Number(product.selling_price || 0),
          cost: Number(product.cost_price || 0),
          isLibbySingle: true,
        }];
      }

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

  function addMiscellaneousItem() {
    const description = miscellaneousDescription.trim();
    const price = Number(miscellaneousPrice);
    const miscellaneousProduct = products.find(
      (product) => product.sku === MISCELLANEOUS_SKU
    );

    if (!description) {
      setMessage("Enter what the miscellaneous item was.");
      return;
    }
    if (!miscellaneousProduct || Number.isNaN(price) || price < 0) {
      setMessage("Enter a valid miscellaneous price.");
      return;
    }

    setBasket((current) => [
      ...current,
      {
        productId: miscellaneousProduct.id,
        name: `Miscellaneous — ${description}`,
        quantity: 1,
        price,
        cost: 0,
      },
    ]);
    setMiscellaneousDescription("");
    setMiscellaneousPrice("");
    setShowMiscellaneous(false);
    setMessage("");
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
      if (method === "Card") return name.includes("square") || name.includes("sumup") || name.includes("card");
      return false;
    });
    if (account) setAccountId(account.id);
  }

  async function completeSale() {
    setMessage("");
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
    const offlineSale = {
      offlineId: createOfflineSaleId(),
      saleDatetime: new Date().toISOString(),
      paymentMethod,
      accountId,
      eventId: eventId || null,
      items: basket.map((item) => ({
        productId: item.productId,
        quantity: Number(item.quantity),
        price: Number(item.price),
        cost: Number(item.cost),
      })),
    };

    try {
      if (!navigator.onLine) throw new Error("Offline");
      await uploadSale(offlineSale);
      setMessage(`Sale completed — ${money(total)}`);
      setOfflineMode(false);
    } catch (error) {
      if (!isNetworkFailure(error)) {
        setMessage(`Could not complete sale: ${error.message}`);
        setSaving(false);
        return;
      }

      try {
        const queuedSales = readStoredJson(OFFLINE_SALES_KEY, []);
        writeStoredJson(OFFLINE_SALES_KEY, [...queuedSales, offlineSale]);
        setPendingOfflineSales(queuedSales.length + 1);
        setOfflineMode(true);
        setMessage(`Sale saved offline — ${money(total)} will upload automatically when connected.`);
      } catch {
        setMessage("This iPad could not save the sale offline. Reconnect to the internet before completing it.");
        setSaving(false);
        return;
      }
    }

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

      {message && <div style={message.toLowerCase().startsWith("sale completed") || message.toLowerCase().startsWith("sale saved") || message.toLowerCase().startsWith("offline pos") || message.toLowerCase().startsWith("offline mode") ? successStyle : errorStyle}>{message}</div>}

      {(offlineMode || pendingOfflineSales > 0) && (
        <div style={offlineStatusStyle}>
          {offlineMode ? "Offline mode" : "Connection restored"}
          {pendingOfflineSales > 0 ? ` — ${pendingOfflineSales} sale${pendingOfflineSales === 1 ? "" : "s"} waiting to upload.` : " — sales are being saved live."}
        </div>
      )}

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
            <button type="button" onClick={() => setShowMiscellaneous(true)} style={miscellaneousButtonStyle}>+ Miscellaneous</button>
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
          <button type="button" disabled={saving || !basket.length} onClick={completeSale} style={completeStyle}>{saving ? "Completing sale…" : `Complete Sale — ${money(total)}`}</button>
        </aside>
      </div>

      {showMiscellaneous && (
        <div style={modalBackdropStyle}>
          <section style={modalStyle}>
            <h2 style={{ marginTop: 0 }}>Add Miscellaneous Item</h2>
            <p style={{ color: "#666", marginTop: 0 }}>Use this for an item not yet in the product list.</p>
            <label style={labelStyle}>What was sold?
              <input value={miscellaneousDescription} onChange={(event) => setMiscellaneousDescription(event.target.value)} placeholder="e.g. Custom keyring" style={inputStyle} autoFocus />
            </label>
            <label style={{ ...labelStyle, marginTop: "14px" }}>Price (£)
              <input type="number" min="0" step="0.01" value={miscellaneousPrice} onChange={(event) => setMiscellaneousPrice(event.target.value)} placeholder="0.00" style={inputStyle} />
            </label>
            <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
              <button type="button" onClick={addMiscellaneousItem} style={completeStyle}>Add to Basket</button>
              <button type="button" onClick={() => setShowMiscellaneous(false)} style={secondaryButtonStyle}>Cancel</button>
            </div>
          </section>
        </div>
      )}
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
const miscellaneousButtonStyle = { ...categoryStyle, background: "#fff7ed", borderColor: "#d97706", color: "#92400e" };
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
const offlineStatusStyle = { maxWidth: "1500px", margin: "0 auto 18px", padding: "15px", background: "#fff7ed", border: "1px solid #fdba74", borderRadius: "10px", color: "#9a3412", fontWeight: "700" };
const modalBackdropStyle = { position: "fixed", inset: 0, zIndex: 10, background: "rgba(0,0,0,0.45)", display: "grid", placeItems: "center", padding: "20px" };
const modalStyle = { width: "min(100%, 440px)", background: "#fff", padding: "24px", borderRadius: "14px", boxShadow: "0 10px 30px rgba(0,0,0,0.2)" };
