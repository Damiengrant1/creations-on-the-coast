"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../../lib/supabase";
import ui from "../../../../lib/ui";
import { Choice, Field, FormSection, PageHeader, StickyActions } from "../../../FormParts";

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

const blankItem = () => ({
  productId: "",
  description: "",
  quantity: 1,
  unitPrice: "",
  personalisation: "",
});

const todayString = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000)
    .toISOString()
    .slice(0, 10);
};

function productLabel(product) {
  const variant = [product.colour, product.size]
    .filter(Boolean)
    .join(" / ");
  return [
    product.product_name,
    variant,
    product.sku,
  ]
    .filter(Boolean)
    .join(" — ");
}

export default function EditJobPage() {
  const params = useParams();
  const jobId = params.id;
  const [products, setProducts] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [jobNumber, setJobNumber] = useState("");
  const [saleId, setSaleId] = useState("");
  const [form, setForm] = useState(null);
  const [items, setItems] = useState([]);
  const [saleDate, setSaleDate] = useState(todayString());
  const [paymentMethod, setPaymentMethod] = useState("Bank Transfer");
  const [accountId, setAccountId] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (loading || !window.location.hash) return;
    const target = document.querySelector(window.location.hash);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [loading]);
  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (jobId) loadData();
  }, [jobId]);

  async function loadData() {
    setLoading(true);
    setMessage("");

    const [jobResult, productsResult, accountsResult, stockResult, jobsResult] = await Promise.all([
      supabase
        .from("jobs")
        .select(
          "id, job_number, received_date, customer_name, customer_phone, customer_email, source, status, priority, due_date, delivery_method, payment_status, quoted_total, artwork_details, notes, sale_id, job_items(id, product_id, item_description, quantity, unit_price, personalisation, created_at)"
        )
        .eq("id", jobId)
        .single(),
      supabase
        .from("products")
        .select(
          "id, product_name, sku, colour, size, selling_price, cost_price, track_stock"
        )
        .eq("active", true)
        .order("product_name"),
      supabase
        .from("accounts")
        .select("id, account_name")
        .eq("active", true)
        .order("account_name"),
      supabase
        .from("current_stock")
        .select("product_id, current_stock"),
      supabase
        .from("jobs")
        .select("id, status, sale_id, job_items(product_id, quantity)"),
    ]);

    const error =
      jobResult.error ||
      productsResult.error ||
      accountsResult.error ||
      stockResult.error ||
      jobsResult.error;

    if (error) {
      console.error("Edit job load error:", error);
      setMessage(`Could not load job: ${error.message}`);
      setLoading(false);
      return;
    }

    const job = jobResult.data;
    setJobNumber(job.job_number);
    setSaleId(job.sale_id || "");
    setForm({
      receivedDate: job.received_date,
      customerName: job.customer_name,
      customerPhone: job.customer_phone || "",
      customerEmail: job.customer_email || "",
      source: job.source,
      status: job.status,
      priority: job.priority,
      dueDate: job.due_date || "",
      deliveryMethod: job.delivery_method || "",
      paymentStatus: job.payment_status,
      quotedTotal:
        job.quoted_total === null ? "" : String(job.quoted_total),
      artworkDetails: job.artwork_details || "",
      notes: job.notes || "",
    });
    setItems(
      (job.job_items || [])
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((item) => ({
          productId: item.product_id || "",
          description: item.item_description,
          quantity: item.quantity,
          unitPrice:
            item.unit_price === null ? "" : String(item.unit_price),
          personalisation: item.personalisation || "",
        }))
    );
    const stockByProduct = new Map(
      (stockResult.data || []).map((stock) => [
        stock.product_id,
        Number(stock.current_stock || 0),
      ])
    );
    const reservedByProduct = new Map();
    (jobsResult.data || [])
      .filter(
        (otherJob) =>
          otherJob.id !== jobId &&
          !otherJob.sale_id &&
          !CLOSED_STATUSES.has(otherJob.status)
      )
      .forEach((otherJob) => {
        (otherJob.job_items || []).forEach((item) => {
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
    setAccounts(accountsResult.data || []);
    setLoading(false);
  }

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateItem(index, field, value) {
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item
      )
    );
  }

  function selectProduct(index, productId) {
    const product = products.find((entry) => entry.id === productId);
    setItems((current) =>
      current.map((item, itemIndex) => {
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
    setItems((current) => [...current, blankItem()]);
  }

  function removeItem(index) {
    if (items.length === 1) return;
    setItems((current) =>
      current.filter((_, itemIndex) => itemIndex !== index)
    );
  }

  function getItemStockStatus(item) {
    if (saleId) {
      return {
        type: "info",
        text: "This job is already a sale, so its stock has been deducted.",
      };
    }

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

  const itemTotal = useMemo(
    () =>
      items.reduce(
        (sum, item) =>
          sum +
          Number(item.quantity || 0) * Number(item.unitPrice || 0),
        0
      ),
    [items]
  );

  const stockLinked = items.every((item) => item.productId);
  const totalsMatch =
    form?.quotedTotal === "" ||
    Math.abs(Number(form?.quotedTotal || 0) - itemTotal) <= 0.01;

  function validate() {
    if (!form.customerName.trim()) {
      setMessage("Please enter the customer name.");
      return false;
    }

    if (
      items.length === 0 ||
      items.some(
        (item) =>
          !item.description.trim() || Number(item.quantity) <= 0
      )
    ) {
      setMessage(
        "Please add a description and valid quantity for every item."
      );
      return false;
    }

    return true;
  }

  function rpcPayload() {
    return {
      p_job_id: jobId,
      p_job: {
        received_date: form.receivedDate,
        customer_name: form.customerName.trim(),
        customer_phone: form.customerPhone.trim(),
        customer_email: form.customerEmail.trim(),
        source: form.source,
        status: form.status,
        priority: form.priority,
        due_date: form.dueDate,
        delivery_method: form.deliveryMethod,
        payment_status: form.paymentStatus,
        quoted_total: form.quotedTotal,
        artwork_details: form.artworkDetails.trim(),
        notes: form.notes.trim(),
      },
      p_items: items.map((item) => ({
        product_id: item.productId,
        item_description: item.description.trim(),
        quantity: Number(item.quantity),
        unit_price: item.unitPrice,
        personalisation: item.personalisation.trim(),
      })),
    };
  }

  async function saveChanges(event) {
    event.preventDefault();
    setMessage("");
    setSuccess(false);
    if (!validate()) return;

    setSaving(true);
    const { error } = await supabase.rpc(
      "update_job_with_items",
      rpcPayload()
    );

    if (error) {
      console.error("Save job error:", error);
      setMessage(`Could not save job: ${error.message}`);
    } else {
      setMessage("Job updated successfully.");
      setSuccess(true);
    }
    setSaving(false);
  }

  async function convertToSale() {
    setMessage("");
    setSuccess(false);

    if (!validate()) return;
    if (!stockLinked) {
      setMessage(
        "Every item must be linked to a catalogue product before converting this job to a sale."
      );
      return;
    }
    if (!totalsMatch) {
      setMessage(
        "The Job Value does not match the item total. Correct the item prices or Job Value before converting."
      );
      return;
    }
    if (!accountId) {
      setMessage("Please select the account that received the payment.");
      return;
    }

    if (
      !window.confirm(
        "Take payment for this job? This records the sale, the money and takes the items off stock."
      )
    ) {
      return;
    }

    setConverting(true);

    const { error: saveError } = await supabase.rpc(
      "update_job_with_items",
      rpcPayload()
    );

    if (saveError) {
      setMessage(`Could not save job before conversion: ${saveError.message}`);
      setConverting(false);
      return;
    }

    const saleDateTime = new Date(
      `${saleDate}T12:00:00`
    ).toISOString();

    const { data, error } = await supabase.rpc(
      "convert_job_to_sale",
      {
        p_job_id: jobId,
        p_sale_datetime: saleDateTime,
        p_payment_method: paymentMethod,
        p_account_id: accountId,
      }
    );

    if (error) {
      console.error("Convert job error:", error);
      setMessage(`Could not convert job: ${error.message}`);
    } else {
      setSaleId(data);
      updateForm("paymentStatus", "paid");

      // A job waiting for collection/postage is finished once it's paid for.
      let finished = false;
      if (form.status === "ready_for_collection_postage") {
        const now = new Date().toISOString();
        const { error: finishError } = await supabase
          .from("jobs")
          .update({ status: "completed", completed_at: now, updated_at: now })
          .eq("id", jobId);
        if (!finishError) {
          updateForm("status", "completed");
          finished = true;
        }
      }

      setMessage(
        `Payment taken for Job #${jobNumber}. Sales, cash and stock have been updated${finished ? " and the job is marked completed" : ""}.`
      );
      setSuccess(true);
    }

    setConverting(false);
  }

  if (loading) {
    return (
      <main style={pageStyle}>
        <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
          Loading job...
        </div>
      </main>
    );
  }

  if (!form) {
    return (
      <main style={pageStyle}>
        <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
          <Link href="/jobs">← Back to Jobs</Link>
          <div style={errorStyle}>{message || "Job not found."}</div>
        </div>
      </main>
    );
  }

  const stockTone = { yes: "✓", no: "⚠", check: "•", info: "i" };

  return (
    <main className="form-page">
      <PageHeader back="/jobs" backLabel="Jobs" title={`Job #${jobNumber}${form.customerName ? ` · ${form.customerName}` : ""}`} intro="Update the job, move it on, or take payment when it's paid for." />

      {saleId && (
        <div style={ui.success}>
          ✓ Paid and recorded as a sale. To correct the sale itself, an admin can use Transactions.
        </div>
      )}

      <form onSubmit={saveChanges}>
        <FormSection step="1" title="Where's it up to?">
          <div className="form-grid">
            <Field label="Stage">
              <select value={form.status} onChange={(e) => updateForm("status", e.target.value)} style={ui.field}>
                {STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
            <Field label="Due date" optional>
              <input type="date" value={form.dueDate} onChange={(e) => updateForm("dueDate", e.target.value)} style={ui.field} />
            </Field>
            <Field label="Has the customer paid?" wide>
              <Choice name="Payment" value={form.paymentStatus} onChange={(value) => updateForm("paymentStatus", value)} options={PAYMENTS} />
            </Field>
            <Field label="Priority" wide>
              <Choice name="Priority" value={form.priority} onChange={(value) => updateForm("priority", value)} options={PRIORITIES} />
            </Field>
          </div>
        </FormSection>

        <FormSection step="2" title="Customer">
          <div className="form-grid">
            <Field label="Customer name" wide>
              <input value={form.customerName} onChange={(e) => updateForm("customerName", e.target.value)} style={ui.field} required />
            </Field>
            <Field label="Phone" optional>
              <input type="tel" inputMode="tel" value={form.customerPhone} onChange={(e) => updateForm("customerPhone", e.target.value)} style={ui.field} />
            </Field>
            <Field label="Email" optional>
              <input type="email" value={form.customerEmail} onChange={(e) => updateForm("customerEmail", e.target.value)} style={ui.field} />
            </Field>
            <Field label="Where did the order come from?" wide>
              <Choice name="Order source" value={form.source} onChange={(value) => updateForm("source", value)} options={SOURCES} />
            </Field>
            <Field label="Collection or delivery?" wide>
              <Choice name="Collection or delivery" value={form.deliveryMethod} onChange={(value) => updateForm("deliveryMethod", value)} options={DELIVERY} />
            </Field>
          </div>
        </FormSection>

        <FormSection step="3" title="Items" hint={saleId ? "Items can't be changed once the job has been recorded as a sale." : "Link each item to a product so stock is checked and payment can be taken."}>
          {items.map((item, index) => {
            const stockStatus = getItemStockStatus(item);
            return (
              <div key={index} className="item-card">
                <div className="item-card-head">
                  <strong>Item {index + 1}</strong>
                  {items.length > 1 && !saleId && (
                    <button type="button" onClick={() => removeItem(index)} style={ui.danger}>Remove</button>
                  )}
                </div>
                <div className="form-grid">
                  <Field label="Product" wide>
                    <select value={item.productId} onChange={(e) => selectProduct(index, e.target.value)} style={ui.field} disabled={Boolean(saleId)}>
                      <option value="">Custom item (not linked to a product)</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>{productLabel(product)}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Description" wide>
                    <input value={item.description} onChange={(e) => updateItem(index, "description", e.target.value)} style={ui.field} disabled={Boolean(saleId)} required />
                  </Field>
                  <Field label="Quantity">
                    <input type="number" min="1" step="1" inputMode="numeric" value={item.quantity} onChange={(e) => updateItem(index, "quantity", e.target.value)} style={ui.field} disabled={Boolean(saleId)} required />
                  </Field>
                  <Field label="Price each (£)" optional>
                    <input type="number" min="0" step="0.01" inputMode="decimal" value={item.unitPrice} onChange={(e) => updateItem(index, "unitPrice", e.target.value)} style={ui.field} disabled={Boolean(saleId)} />
                  </Field>
                  <Field label="Personalisation / instructions" optional wide>
                    <textarea value={item.personalisation} onChange={(e) => updateItem(index, "personalisation", e.target.value)} style={{ ...ui.field, minHeight: "76px", resize: "vertical" }} disabled={Boolean(saleId)} />
                  </Field>
                </div>
                {!saleId && (
                  <div className={`stock-line ${stockStatus.type}`}>
                    {stockTone[stockStatus.type]} {stockStatus.text}
                  </div>
                )}
              </div>
            );
          })}
          {!saleId && (
            <button type="button" onClick={addItem} style={ui.secondary}>+ Add another item</button>
          )}
        </FormSection>

        <FormSection step="4" title="Value, artwork and notes">
          <div className="form-grid">
            <Field
              label="Job value (£)"
              optional
              hint={`Items add up to £${itemTotal.toFixed(2)}.${!totalsMatch ? " This doesn't match the job value, so fix one before taking payment." : ""}`}
            >
              <input type="number" min="0" step="0.01" inputMode="decimal" value={form.quotedTotal} onChange={(e) => updateForm("quotedTotal", e.target.value)} style={{ ...ui.field, borderColor: totalsMatch ? undefined : "var(--coral)" }} disabled={Boolean(saleId)} />
            </Field>
            <Field label="Date received">
              <input type="date" value={form.receivedDate} onChange={(e) => updateForm("receivedDate", e.target.value)} style={ui.field} required />
            </Field>
            <Field label="Artwork / information" optional wide>
              <textarea value={form.artworkDetails} onChange={(e) => updateForm("artworkDetails", e.target.value)} style={{ ...ui.field, minHeight: "90px", resize: "vertical" }} />
            </Field>
            <Field label="Other notes" optional wide>
              <textarea value={form.notes} onChange={(e) => updateForm("notes", e.target.value)} style={{ ...ui.field, minHeight: "80px", resize: "vertical" }} />
            </Field>
          </div>
        </FormSection>

        {message && <div style={success ? ui.success : ui.error}>{message}</div>}

        {!saleId && (
          <StickyActions summary={<>Job value <strong>£{(form.quotedTotal !== "" && form.quotedTotal !== null ? Number(form.quotedTotal) : itemTotal).toFixed(2)}</strong></>}>
            <a href="#take-payment" style={ui.secondary}>💷 Take payment</a>
            <button type="submit" disabled={saving || converting} style={ui.primary}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          </StickyActions>
        )}
      </form>

      {!saleId && (
        <div style={{ marginTop: 26 }}>
          <FormSection
            id="take-payment"
            step="£"
            title="Take payment"
            hint="Do this once the customer has paid in full. It records the sale and the money, and takes the items off stock."
          >
            {!stockLinked && (
              <div style={ui.notice}>Every item needs to be linked to a product before you can take payment. Pick one in Items above.</div>
            )}
            {stockLinked && !totalsMatch && (
              <div style={ui.notice}>The job value doesn&apos;t match the items total. Fix one of them above first.</div>
            )}
            <div className="form-grid">
              <Field label="Date paid">
                <input type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} style={ui.field} />
              </Field>
              <Field label="Paid into">
                <select value={accountId} onChange={(e) => setAccountId(e.target.value)} style={ui.field}>
                  <option value="">Choose account</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>{account.account_name}</option>
                  ))}
                </select>
              </Field>
              <Field label="How did they pay?" wide>
                <Choice name="Payment method" value={paymentMethod} onChange={setPaymentMethod} options={METHODS} />
              </Field>
            </div>
            <div style={{ marginTop: 16 }}>
              <button type="button" onClick={convertToSale} disabled={converting || !stockLinked || !totalsMatch} style={{ ...ui.primary, background: "var(--leaf)", width: "100%" }}>
                {converting ? "Saving…" : `Take payment of £${itemTotal.toFixed(2)}`}
              </button>
            </div>
          </FormSection>
        </div>
      )}
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
  ["refunded", "Refunded"],
];

const PRIORITIES = [
  ["normal", "Normal"],
  ["high", "High"],
  ["urgent", "Urgent"],
];

const METHODS = ["Bank Transfer", "Card", "Cash", "Shopify Payments", "PayPal", "Other"].map((method) => [method, method]);

const pageStyle = ui.page;
