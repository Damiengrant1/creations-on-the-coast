"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";
import ui from "../../../lib/ui";
import { Choice, Field, FormSection, PageHeader, StickyActions } from "../../FormParts";

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
        text: "Custom item, so stock can't be checked.",
      };
    }

    const product = products.find((entry) => entry.id === item.productId);

    if (!product) {
      return { type: "check", text: "Stock information is unavailable." };
    }

    if (!product.track_stock) {
      return { type: "info", text: "Stock isn't counted for this product." };
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
        text: `Enough stock: ${availableQuantity} free (${physicalQuantity} on the shelf, ${reservedQuantity} kept for other jobs). This job needs ${requiredQuantity}.`,
      };
    }

    return {
      type: "no",
      text: `Order ${requiredQuantity - availableQuantity} more: only ${availableQuantity} free (${physicalQuantity} on the shelf, ${reservedQuantity} kept for other jobs). This job needs ${requiredQuantity}.`,
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

  const stockTone = { yes: "✓", no: "⚠", check: "•", info: "i" };

  return (
    <main className="form-page">
      <PageHeader back="/jobs" backLabel="Jobs" title="New job" intro="Take down an order from Facebook, WhatsApp, the website or in person." />

      <form onSubmit={handleSubmit}>
        <FormSection step="1" title="Who's it for?">
          <div className="form-grid">
            <Field label="Customer name" wide>
              <input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} style={ui.field} placeholder="Person or business name" required autoFocus />
            </Field>
            <Field label="Phone" optional>
              <input type="tel" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} style={ui.field} inputMode="tel" />
            </Field>
            <Field label="Email" optional>
              <input type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} style={ui.field} />
            </Field>
            <Field label="Where did the order come from?" wide>
              <Choice name="Order source" value={source} onChange={setSource} options={SOURCES} />
            </Field>
          </div>
        </FormSection>

        <FormSection step="2" title="What do they want?" hint="Pick a product to check stock and fill in the price, or type a custom item.">
          {items.map((item, index) => {
            const stockStatus = getItemStockStatus(item);
            return (
              <div key={index} className="item-card">
                <div className="item-card-head">
                  <strong>Item {index + 1}</strong>
                  {items.length > 1 && (
                    <button type="button" onClick={() => removeItem(index)} style={ui.danger}>Remove</button>
                  )}
                </div>

                <div className="form-grid">
                  <Field label="Product" wide>
                    <select value={item.productId} onChange={(e) => selectProduct(index, e.target.value)} style={ui.field}>
                      <option value="">Custom item (not in the product list)</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>{productLabel(product)}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Description" wide>
                    <input type="text" value={item.description} onChange={(e) => updateItem(index, "description", e.target.value)} style={ui.field} placeholder="e.g. Black hoodie, white logo on back" required />
                  </Field>
                  <Field label="Quantity">
                    <input type="number" min="1" step="1" inputMode="numeric" value={item.quantity} onChange={(e) => updateItem(index, "quantity", e.target.value)} style={ui.field} required />
                  </Field>
                  <Field label="Price each (£)" optional>
                    <input type="number" min="0" step="0.01" inputMode="decimal" value={item.unitPrice} onChange={(e) => updateItem(index, "unitPrice", e.target.value)} style={ui.field} />
                  </Field>
                  <Field label="Personalisation / instructions" optional wide>
                    <textarea value={item.personalisation} onChange={(e) => updateItem(index, "personalisation", e.target.value)} style={{ ...ui.field, minHeight: "76px", resize: "vertical" }} placeholder="Names, sizes, colours, wording or design details" />
                  </Field>
                </div>

                <div className={`stock-line ${stockStatus.type}`}>
                  {stockTone[stockStatus.type]} {stockStatus.text}
                </div>
              </div>
            );
          })}

          <button type="button" onClick={addItem} style={ui.secondary}>+ Add another item</button>
        </FormSection>

        <FormSection step="3" title="When and how much?">
          <div className="form-grid">
            <Field label="Due date" optional>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={ui.field} />
            </Field>
            <Field label="Job value (£)" hint={`Items add up to £${calculatedTotal.toFixed(2)}. Leave blank to use that.`} optional>
              <input type="number" min="0" step="0.01" inputMode="decimal" value={quotedTotal} onChange={(e) => setQuotedTotal(e.target.value)} style={ui.field} placeholder={calculatedTotal > 0 ? calculatedTotal.toFixed(2) : ""} />
            </Field>
            <Field label="Collection or delivery?" wide>
              <Choice name="Collection or delivery" value={deliveryMethod} onChange={setDeliveryMethod} options={DELIVERY} />
            </Field>
            <Field label="Has the customer paid?" wide hint="When they pay in full, open the job and use Take payment so it counts as a sale.">
              <Choice name="Payment" value={paymentStatus} onChange={setPaymentStatus} options={PAYMENTS} />
            </Field>
          </div>
        </FormSection>

        <FormSection step="4" title="Artwork and notes">
          <div className="form-grid">
            <Field label="Artwork / information" optional wide>
              <textarea value={artworkDetails} onChange={(e) => setArtworkDetails(e.target.value)} style={{ ...ui.field, minHeight: "90px", resize: "vertical" }} placeholder="Logo received? Artwork to design? Approval sent?" />
            </Field>
            <Field label="Other notes" optional wide>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} style={{ ...ui.field, minHeight: "80px", resize: "vertical" }} />
            </Field>
          </div>
        </FormSection>

        <details className="more-details">
          <summary>More details (date received, priority, starting stage)</summary>
          <div className="form-section">
            <div className="form-grid">
              <Field label="Date received">
                <input type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} style={ui.field} required />
              </Field>
              <Field label="Starting stage">
                <select value={status} onChange={(e) => setStatus(e.target.value)} style={ui.field}>
                  {STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </Field>
              <Field label="Priority" wide>
                <Choice name="Priority" value={priority} onChange={setPriority} options={PRIORITIES} />
              </Field>
            </div>
          </div>
        </details>

        {message && <div style={ui.error}>{message}</div>}

        <StickyActions
          summary={
            <>
              {items.length} item{items.length === 1 ? "" : "s"} · <strong>£{(quotedTotal !== "" ? Number(quotedTotal) : calculatedTotal).toFixed(2)}</strong>
            </>
          }
        >
          <Link href="/jobs" style={ui.secondary}>Cancel</Link>
          <button type="submit" disabled={saving} style={ui.primary}>
            {saving ? "Saving…" : "Save job"}
          </button>
        </StickyActions>
      </form>
    </main>
  );
}

const SOURCES = [
  ["in_person", "In person"],
  ["facebook", "Facebook"],
  ["whatsapp", "WhatsApp"],
  ["website", "Website"],
  ["other", "Other"],
];

const DELIVERY = [
  ["", "Not decided"],
  ["collection", "Collection"],
  ["postage", "Post"],
  ["delivery", "Local delivery"],
  ["other", "Other"],
];

const PAYMENTS = [
  ["unpaid", "Not yet"],
  ["deposit_paid", "Deposit paid"],
  ["paid", "Paid in full"],
];

const PRIORITIES = [
  ["normal", "Normal"],
  ["high", "High"],
  ["urgent", "Urgent"],
];
