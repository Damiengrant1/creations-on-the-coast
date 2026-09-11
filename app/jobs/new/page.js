"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

const STATUSES = [
  ["new", "New"],
  ["artwork_information_needed", "Artwork/Information Needed"],
  ["awaiting_customer_approval", "Awaiting Customer Approval"],
  ["awaiting_stock_order", "Awaiting Stock Order"],
  ["awaiting_stock_delivery", "Awaiting Stock Delivery"],
  ["ready_to_produce", "Ready to Produce"],
  ["in_production", "In Production"],
  ["ready_for_collection_postage", "Ready for Collection/Postage"],
  ["completed", "Completed"],
  ["cancelled", "Cancelled"],
];

const CLOSED_STATUSES = new Set(["completed", "cancelled"]);

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
    description: "",
    quantity: 1,
    unitPrice: "",
    personalisation: "",
  };
}

function productLabel(product) {
  const variant = [product.colour, product.size]
    .filter(Boolean)
    .join(" / ");
  const sku = product.sku ? ` — ${product.sku}` : "";
  return `${product.product_name}${variant ? ` — ${variant}` : ""}${sku}`;
}

export default function AddJobPage() {
  const router = useRouter();
  const [products, setProducts] = useState([]);
  const [receivedDate, setReceivedDate] = useState(todayString());
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [source, setSource] = useState("in_person");
  const [status, setStatus] = useState("new");
  const [priority, setPriority] = useState("normal");
  const [dueDate, setDueDate] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("unpaid");
  const [quotedTotal, setQuotedTotal] = useState("");
  const [artworkDetails, setArtworkDetails] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState([blankItem()]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadProducts();
  }, []);

  async function loadProducts() {
    const [productsResult, stockResult, jobsResult] = await Promise.all([
      supabase
        .from("products")
        .select(
          "id, product_name, sku, colour, size, selling_price, track_stock"
        )
        .eq("active", true)
        .order("product_name"),
      supabase
        .from("current_stock")
        .select("product_id, current_stock"),
      supabase
        .from("jobs")
        .select("id, status, sale_id, job_items(product_id, quantity)"),
    ]);

    const error = productsResult.error || stockResult.error || jobsResult.error;

    if (error) {
      console.error("Products or stock error:", error);
      setMessage(`Could not load products or stock: ${error.message}`);
    } else {
      const stockByProduct = new Map(
        (stockResult.data || []).map((stock) => [
          stock.product_id,
          Number(stock.current_stock || 0),
        ])
      );

      const reservedByProduct = new Map();
      (jobsResult.data || [])
        .filter((job) => !job.sale_id && !CLOSED_STATUSES.has(job.status))
        .forEach((job) => {
          (job.job_items || []).forEach((item) => {
            if (!item.product_id) return;
            reservedByProduct.set(
              item.product_id,
              (reservedByProduct.get(item.product_id) || 0) +
                Number(item.quantity || 0)
            );
          });
        });

      setProducts(
        (productsResult.data || []).map((product) => ({
          ...product,
          currentStock: stockByProduct.get(product.id) || 0,
          reservedStock: reservedByProduct.get(product.id) || 0,
        }))
      );
    }
  }

  function updateItem(index, field, value) {
    setItems((currentItems) =>
      currentItems.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item
      )
    );
  }

  function selectProduct(index, productId) {
    const product = products.find((entry) => entry.id === productId);

    setItems((currentItems) =>
      currentItems.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        if (!product) return { ...item, productId: "" };

        return {
          ...item,
          productId,
          description: productLabel(product),
          unitPrice: product.selling_price ?? "",
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

  function getItemStockStatus(item) {
    if (!item.productId) {
      return {
        type: "check",
        text: "Select a catalogue product to check its stock.",
      };
    }

    const product = products.find((entry) => entry.id === item.productId);

    if (!product) {
      return { type: "check", text: "Stock information is unavailable." };
    }

    if (!product.track_stock) {
      return { type: "info", text: "Stock is not tracked for this product." };
    }

    const requiredQuantity = items
      .filter((entry) => entry.productId === item.productId)
      .reduce((total, entry) => total + Number(entry.quantity || 0), 0);
    const physicalQuantity = Number(product.currentStock || 0);
    const reservedQuantity = Number(product.reservedStock || 0);
    const availableQuantity = Math.max(0, physicalQuantity - reservedQuantity);

    if (availableQuantity >= requiredQuantity) {
      return {
        type: "yes",
        text: `Physical stock: ${physicalQuantity}. Reserved for other active jobs: ${reservedQuantity}. Available for this job: ${availableQuantity}. This job needs: ${requiredQuantity}.`,
      };
    }

    return {
      type: "no",
      text: `Physical stock: ${physicalQuantity}. Reserved for other active jobs: ${reservedQuantity}. Available for this job: ${availableQuantity}. This job needs: ${requiredQuantity}. You need to order ${requiredQuantity - availableQuantity}.`,
    };
  }

  const calculatedTotal = useMemo(
    () =>
      items.reduce(
        (sum, item) =>
          sum +
          Number(item.quantity || 0) * Number(item.unitPrice || 0),
        0
      ),
    [items]
  );

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");

    if (!customerName.trim()) {
      setMessage("Please enter the customer name.");
      return;
    }

    const invalidItem = items.some(
      (item) => !item.description.trim() || Number(item.quantity) <= 0
    );

    if (invalidItem) {
      setMessage("Please add a description and valid quantity for every item.");
      return;
    }

    setSaving(true);

    const totalToSave =
      quotedTotal !== ""
        ? Number(quotedTotal)
        : calculatedTotal > 0
        ? calculatedTotal
        : null;

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .insert({
        received_date: receivedDate,
        customer_name: customerName.trim(),
        customer_phone: customerPhone.trim() || null,
        customer_email: customerEmail.trim() || null,
        source,
        status,
        priority,
        due_date: dueDate || null,
        delivery_method: deliveryMethod || null,
        payment_status: paymentStatus,
        quoted_total: totalToSave,
        artwork_details: artworkDetails.trim() || null,
        notes: notes.trim() || null,
        completed_at:
          status === "completed" ? new Date().toISOString() : null,
      })
      .select("id, job_number")
      .single();

    if (jobError) {
      console.error("Job error:", jobError);
      setMessage(`Could not create job: ${jobError.message}`);
      setSaving(false);
      return;
    }

    const itemRows = items.map((item) => ({
      job_id: job.id,
      product_id: item.productId || null,
      item_description: item.description.trim(),
      quantity: Number(item.quantity),
      unit_price:
        item.unitPrice === "" ? null : Number(item.unitPrice),
      personalisation: item.personalisation.trim() || null,
    }));

    const { error: itemError } = await supabase
      .from("job_items")
      .insert(itemRows);

    if (itemError) {
      console.error("Job items error:", itemError);
      await supabase.from("jobs").delete().eq("id", job.id);
      setMessage(`Could not add job items: ${itemError.message}`);
      setSaving(false);
      return;
    }

    router.push(`/jobs?created=${job.job_number}`);
    router.refresh();
  }

  return (
    <main style={pageStyle}>
      <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
        <Link href="/jobs" style={backLinkStyle}>
          ← Back to Jobs
        </Link>

        <h1 style={{ fontSize: "36px", margin: "0 0 8px" }}>
          Add New Job
        </h1>
        <p style={{ color: "#666", margin: "0 0 28px" }}>
          Record a new website, social media or in-person order.
        </p>

        <form onSubmit={handleSubmit}>
          <Section title="Customer & Job Details">
            <div style={gridStyle}>
              <Field label="Date Received">
                <input type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} style={fieldStyle} required />
              </Field>
              <Field label="Customer Name">
                <input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} style={fieldStyle} placeholder="Customer or business name" required />
              </Field>
              <Field label="Phone">
                <input type="tel" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} style={fieldStyle} />
              </Field>
              <Field label="Email">
                <input type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} style={fieldStyle} />
              </Field>
              <Field label="Order Source">
                <select value={source} onChange={(e) => setSource(e.target.value)} style={fieldStyle}>
                  <option value="in_person">In Person</option>
                  <option value="facebook">Facebook</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="website">Website</option>
                  <option value="other">Other</option>
                </select>
              </Field>
              <Field label="Due Date">
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={fieldStyle} />
              </Field>
              <Field label="Priority">
                <select value={priority} onChange={(e) => setPriority(e.target.value)} style={fieldStyle}>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </Field>
              <Field label="Current Status">
                <select value={status} onChange={(e) => setStatus(e.target.value)} style={fieldStyle}>
                  {STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </Field>
              <Field label="Collection / Delivery">
                <select value={deliveryMethod} onChange={(e) => setDeliveryMethod(e.target.value)} style={fieldStyle}>
                  <option value="">Not decided</option>
                  <option value="collection">Collection</option>
                  <option value="postage">Postage</option>
                  <option value="delivery">Local Delivery</option>
                  <option value="other">Other</option>
                </select>
              </Field>
              <Field label="Payment Status">
                <select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)} style={fieldStyle}>
                  <option value="unpaid">Unpaid</option>
                  <option value="deposit_paid">Deposit Paid</option>
                  <option value="paid">Paid</option>
                  <option value="refunded">Refunded</option>
                </select>
              </Field>
            </div>
          </Section>

          <Section title="Items Required">
            {items.map((item, index) => {
              const stockStatus = getItemStockStatus(item);

              return (
              <div key={index} style={itemCardStyle}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", marginBottom: "14px" }}>
                  <strong>Item {index + 1}</strong>
                  {items.length > 1 && (
                    <button type="button" onClick={() => removeItem(index)} style={removeButtonStyle}>Remove</button>
                  )}
                </div>

                <div style={gridStyle}>
                  <Field label="Select Existing Product (optional)">
                    <select value={item.productId} onChange={(e) => selectProduct(index, e.target.value)} style={fieldStyle}>
                      <option value="">Manual / custom item</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>{productLabel(product)}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Item Description">
                    <input type="text" value={item.description} onChange={(e) => updateItem(index, "description", e.target.value)} style={fieldStyle} placeholder="e.g. 10 black workwear T-shirts" required />
                  </Field>
                  <Field label="Quantity">
                    <input type="number" min="1" step="1" value={item.quantity} onChange={(e) => updateItem(index, "quantity", e.target.value)} style={fieldStyle} required />
                  </Field>
                  <Field label="Price Each (optional)">
                    <input type="number" min="0" step="0.01" value={item.unitPrice} onChange={(e) => updateItem(index, "unitPrice", e.target.value)} style={fieldStyle} />
                  </Field>
                </div>

                <div style={stockMessageStyle(stockStatus.type)}>
                  {stockStatus.text}
                </div>

                <Field label="Personalisation / Item Instructions">
                  <textarea value={item.personalisation} onChange={(e) => updateItem(index, "personalisation", e.target.value)} style={{ ...fieldStyle, minHeight: "80px", resize: "vertical" }} placeholder="Names, sizes, colours, wording or design details" />
                </Field>
              </div>
              );
            })}

            <button type="button" onClick={addItem} style={secondaryButtonStyle}>+ Add Another Item</button>
          </Section>

          <Section title="Value & Notes">
            <div style={gridStyle}>
              <Field label="Job Value">
                <input type="number" min="0" step="0.01" value={quotedTotal} onChange={(e) => setQuotedTotal(e.target.value)} style={fieldStyle} placeholder={calculatedTotal > 0 ? calculatedTotal.toFixed(2) : "Optional"} />
                <div style={helpTextStyle}>Item total: £{calculatedTotal.toFixed(2)}. Leave blank to use this total.</div>
              </Field>
              <Field label="Artwork / Information">
                <textarea value={artworkDetails} onChange={(e) => setArtworkDetails(e.target.value)} style={{ ...fieldStyle, minHeight: "100px", resize: "vertical" }} placeholder="Logos received, artwork required, approval details..." />
              </Field>
            </div>
            <Field label="General Notes">
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} style={{ ...fieldStyle, minHeight: "100px", resize: "vertical" }} />
            </Field>
          </Section>

          {message && <div style={errorStyle}>{message}</div>}

          <button type="submit" disabled={saving} style={{ ...primaryButtonStyle, opacity: saving ? 0.6 : 1 }}>
            {saving ? "Saving Job..." : "Save Job"}
          </button>
        </form>
      </div>
    </main>
  );
}

function Section({ title, children }) {
  return (
    <div style={sectionStyle}>
      <h2 style={{ margin: "0 0 20px" }}>{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: "16px" }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

function stockMessageStyle(type) {
  const colours = {
    yes: { background: "#e8f7ed", color: "#176b35", border: "#b8dfc3" },
    no: { background: "#fff0f0", color: "#9b1c1c", border: "#efb3b3" },
    check: { background: "#fff8df", color: "#6b4e00", border: "#ead99f" },
    info: { background: "#eef4ff", color: "#254f87", border: "#c8d7ef" },
  };
  const colour = colours[type] || colours.check;

  return {
    background: colour.background,
    color: colour.color,
    border: `1px solid ${colour.border}`,
    borderRadius: "8px",
    padding: "10px 12px",
    margin: "0 0 16px",
    fontWeight: "700",
  };
}

const pageStyle = { minHeight: "100vh", background: "#f7f7f8", padding: "40px 20px", fontFamily: "Arial, sans-serif" };
const backLinkStyle = { display: "inline-block", marginBottom: "24px", color: "#333" };
const sectionStyle = { background: "#fff", padding: "26px", borderRadius: "14px", boxShadow: "0 2px 10px rgba(0,0,0,0.06)", marginBottom: "20px" };
const gridStyle = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" };
const labelStyle = { display: "block", fontWeight: "600", marginBottom: "6px" };
const fieldStyle = { width: "100%", padding: "12px", border: "1px solid #ccc", borderRadius: "8px", fontSize: "16px", boxSizing: "border-box", background: "#fff" };
const itemCardStyle = { border: "1px solid #e3e3e3", background: "#fafafa", borderRadius: "10px", padding: "18px", marginBottom: "16px" };
const primaryButtonStyle = { width: "100%", padding: "15px 20px", border: 0, borderRadius: "9px", background: "#111", color: "#fff", fontSize: "17px", fontWeight: "700", cursor: "pointer" };
const secondaryButtonStyle = { padding: "11px 15px", border: "1px solid #aaa", borderRadius: "8px", background: "#fff", fontWeight: "700", cursor: "pointer" };
const removeButtonStyle = { padding: "7px 10px", border: "1px solid #d3a0a0", borderRadius: "7px", background: "#fff", color: "#9b1c1c", fontWeight: "600", cursor: "pointer" };
const helpTextStyle = { color: "#666", fontSize: "13px", marginTop: "6px" };
const errorStyle = { padding: "14px 16px", marginBottom: "16px", borderRadius: "9px", background: "#fff0f0", color: "#9b1c1c", border: "1px solid #f1c1c1", fontWeight: "600" };
