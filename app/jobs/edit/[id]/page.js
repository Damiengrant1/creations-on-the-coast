"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../../lib/supabase";

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
        "Convert this job into a paid sale? This will update sales, cash and stock."
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
      setMessage(
        `Job #${jobNumber} converted to a sale successfully. Sales, cash and stock have been updated.`
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

  return (
    <main style={pageStyle}>
      <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
        <Link href="/jobs" style={backLinkStyle}>
          ← Back to Jobs
        </Link>
        <h1 style={{ fontSize: "36px", margin: "0 0 8px" }}>
          Edit Job #{jobNumber}
        </h1>
        <p style={{ color: "#666", margin: "0 0 26px" }}>
          Correct job information, update items or convert it into a sale.
        </p>

        {saleId && (
          <div style={successStyle}>
            This job has already been converted to a sale. Use Manage
            Transactions if the sale needs correcting.
          </div>
        )}

        <form onSubmit={saveChanges}>
          <Section title="Customer & Job Details">
            <div style={gridStyle}>
              <Field label="Date Received">
                <input type="date" value={form.receivedDate} onChange={(e) => updateForm("receivedDate", e.target.value)} style={fieldStyle} required />
              </Field>
              <Field label="Customer Name">
                <input value={form.customerName} onChange={(e) => updateForm("customerName", e.target.value)} style={fieldStyle} required />
              </Field>
              <Field label="Phone">
                <input value={form.customerPhone} onChange={(e) => updateForm("customerPhone", e.target.value)} style={fieldStyle} />
              </Field>
              <Field label="Email">
                <input type="email" value={form.customerEmail} onChange={(e) => updateForm("customerEmail", e.target.value)} style={fieldStyle} />
              </Field>
              <Field label="Order Source">
                <select value={form.source} onChange={(e) => updateForm("source", e.target.value)} style={fieldStyle}>
                  <option value="in_person">In Person</option>
                  <option value="facebook">Facebook</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="website">Website</option>
                  <option value="other">Other</option>
                </select>
              </Field>
              <Field label="Due Date">
                <input type="date" value={form.dueDate} onChange={(e) => updateForm("dueDate", e.target.value)} style={fieldStyle} />
              </Field>
              <Field label="Priority">
                <select value={form.priority} onChange={(e) => updateForm("priority", e.target.value)} style={fieldStyle}>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </Field>
              <Field label="Current Status">
                <select value={form.status} onChange={(e) => updateForm("status", e.target.value)} style={fieldStyle}>
                  {STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </Field>
              <Field label="Collection / Delivery">
                <select value={form.deliveryMethod} onChange={(e) => updateForm("deliveryMethod", e.target.value)} style={fieldStyle}>
                  <option value="">Not decided</option>
                  <option value="collection">Collection</option>
                  <option value="postage">Postage</option>
                  <option value="delivery">Local Delivery</option>
                  <option value="other">Other</option>
                </select>
              </Field>
              <Field label="Payment Status">
                <select value={form.paymentStatus} onChange={(e) => updateForm("paymentStatus", e.target.value)} style={fieldStyle}>
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
                <div style={itemHeadingStyle}>
                  <strong>Item {index + 1}</strong>
                  {items.length > 1 && !saleId && (
                    <button type="button" onClick={() => removeItem(index)} style={removeButtonStyle}>Remove</button>
                  )}
                </div>
                <div style={gridStyle}>
                  <Field label="Catalogue Product">
                    <select value={item.productId} onChange={(e) => selectProduct(index, e.target.value)} style={fieldStyle} disabled={Boolean(saleId)}>
                      <option value="">Manual / unlinked item</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>{productLabel(product)}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Item Description">
                    <input value={item.description} onChange={(e) => updateItem(index, "description", e.target.value)} style={fieldStyle} disabled={Boolean(saleId)} required />
                  </Field>
                  <Field label="Quantity">
                    <input type="number" min="1" step="1" value={item.quantity} onChange={(e) => updateItem(index, "quantity", e.target.value)} style={fieldStyle} disabled={Boolean(saleId)} required />
                  </Field>
                  <Field label="Price Each">
                    <input type="number" min="0" step="0.01" value={item.unitPrice} onChange={(e) => updateItem(index, "unitPrice", e.target.value)} style={fieldStyle} disabled={Boolean(saleId)} />
                  </Field>
                </div>
                <div style={stockMessageStyle(stockStatus.type)}>
                  {stockStatus.text}
                </div>
                <Field label="Personalisation / Item Instructions">
                  <textarea value={item.personalisation} onChange={(e) => updateItem(index, "personalisation", e.target.value)} style={{ ...fieldStyle, minHeight: "80px" }} disabled={Boolean(saleId)} />
                </Field>
              </div>
              );
            })}
            {!saleId && (
              <button type="button" onClick={addItem} style={secondaryButtonStyle}>+ Add Another Item</button>
            )}
          </Section>

          <Section title="Value & Notes">
            <div style={gridStyle}>
              <Field label="Job Value">
                <input type="number" min="0" step="0.01" value={form.quotedTotal} onChange={(e) => updateForm("quotedTotal", e.target.value)} style={fieldStyle} disabled={Boolean(saleId)} />
                <div style={helpStyle}>
                  Item total: £{itemTotal.toFixed(2)}
                  {!totalsMatch ? " — values do not match" : ""}
                </div>
              </Field>
              <Field label="Artwork / Information">
                <textarea value={form.artworkDetails} onChange={(e) => updateForm("artworkDetails", e.target.value)} style={{ ...fieldStyle, minHeight: "100px" }} />
              </Field>
            </div>
            <Field label="General Notes">
              <textarea value={form.notes} onChange={(e) => updateForm("notes", e.target.value)} style={{ ...fieldStyle, minHeight: "100px" }} />
            </Field>
          </Section>

          {message && (
            <div style={success ? successStyle : errorStyle}>{message}</div>
          )}

          {!saleId && (
            <button type="submit" disabled={saving || converting} style={saveButtonStyle}>
              {saving ? "Saving..." : "Save Changes"}
            </button>
          )}
        </form>

        {!saleId && (
          <Section title="Convert Job to Sale">
            <p style={{ color: "#555", marginTop: 0 }}>
              Use this once payment has been received in full. It will create
              the sale, record the cash and reduce stock automatically.
            </p>
            {!stockLinked && (
              <div style={warningStyle}>
                Every item must be linked to a catalogue product before this
                job can become a sale.
              </div>
            )}
            <div style={gridStyle}>
              <Field label="Sale Date">
                <input type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} style={fieldStyle} />
              </Field>
              <Field label="Payment Method">
                <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} style={fieldStyle}>
                  <option>Bank Transfer</option>
                  <option>Card</option>
                  <option>Cash</option>
                  <option>Shopify Payments</option>
                  <option>PayPal</option>
                  <option>Other</option>
                </select>
              </Field>
              <Field label="Account Payment Went Into">
                <select value={accountId} onChange={(e) => setAccountId(e.target.value)} style={fieldStyle}>
                  <option value="">Select account</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>{account.account_name}</option>
                  ))}
                </select>
              </Field>
            </div>
            <button type="button" onClick={convertToSale} disabled={converting || !stockLinked || !totalsMatch} style={convertButtonStyle}>
              {converting ? "Converting..." : "Convert to Paid Sale"}
            </button>
          </Section>
        )}
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
const itemHeadingStyle = { display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", marginBottom: "14px" };
const secondaryButtonStyle = { padding: "11px 15px", border: "1px solid #aaa", borderRadius: "8px", background: "#fff", fontWeight: "700", cursor: "pointer" };
const removeButtonStyle = { ...secondaryButtonStyle, color: "#9b1c1c", borderColor: "#d3a0a0", padding: "7px 10px" };
const saveButtonStyle = { width: "100%", padding: "15px", border: 0, borderRadius: "9px", background: "#111", color: "#fff", fontSize: "17px", fontWeight: "700", cursor: "pointer", marginBottom: "20px" };
const convertButtonStyle = { ...saveButtonStyle, background: "#176b35", marginBottom: 0 };
const helpStyle = { color: "#666", fontSize: "13px", marginTop: "6px" };
const errorStyle = { padding: "14px 16px", marginBottom: "16px", borderRadius: "9px", background: "#fff0f0", color: "#9b1c1c", border: "1px solid #f1c1c1", fontWeight: "600" };
const successStyle = { padding: "14px 16px", marginBottom: "16px", borderRadius: "9px", background: "#eefaf0", color: "#166534", border: "1px solid #b9dfc2", fontWeight: "600" };
const warningStyle = { padding: "12px 14px", marginBottom: "16px", borderRadius: "8px", background: "#fff8df", color: "#6b4e00", border: "1px solid #ead99f" };
