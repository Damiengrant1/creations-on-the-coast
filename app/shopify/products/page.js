"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../../lib/supabase";

const SHOP_DOMAIN = "ku1cvy-ue.myshopify.com";
const money = value => `£${Number(value || 0).toFixed(2)}`;
const productLabel = p => [p.product_name, p.colour, p.size, p.sku].filter(Boolean).join(" / ");

async function readAll(query) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await query().range(offset, offset + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

export default function ShopifyProductMatchingPage() {
  const [rows, setRows] = useState([]);
  const [products, setProducts] = useState([]);
  const [edits, setEdits] = useState({});
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const busy = useRef(false);
  const dirtyCount = Object.keys(edits).length;

  useEffect(() => { loadData(); }, []);
  useEffect(() => {
    if (!dirtyCount) return;
    const warn = event => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirtyCount]);

  async function loadData() {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData.session) throw new Error("Please sign in again.");
      const { data: access, error: accessError } = await supabase.from("app_users").select("role, active")
        .eq("user_id", sessionData.session.user.id).maybeSingle();
      if (accessError) throw accessError;
      if (access?.role !== "admin" || !access.active) throw new Error("An approved admin account is required.");
      const [links, stock] = await Promise.all([
        readAll(() => supabase.from("shopify_variant_mappings").select("shopify_variant_id, shopify_product_title, shopify_variant_title, shopify_status, shopify_variant_exists, shopify_price, product_id, match_note, updated_at, catalog_checked_at")
          .eq("shop_domain", SHOP_DOMAIN).order("shopify_product_title").order("shopify_variant_id")),
        readAll(() => supabase.from("products").select("id, product_name, sku, colour, size, stock_cost, production_cost, active, track_stock")
          .order("product_name").order("id")),
      ]);
      setRows(links);
      setProducts(stock);
      setEdits({});
    } catch (cause) {
      setError(`Could not load product matching: ${cause.message}`);
    } finally {
      setLoading(false);
    }
  }

  const byId = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);
  const selectable = useMemo(() => products.filter(p => p.active && p.track_stock).sort((a, b) => productLabel(a).localeCompare(productLabel(b), "en-GB", { numeric: true })), [products]);
  const usable = id => { const p = byId.get(id); return Boolean(p?.active && p?.track_stock); };
  const scopeRows = rows.filter(row => row.shopify_variant_exists !== false && (includeInactive || row.shopify_status === "ACTIVE"));
  const linked = scopeRows.filter(row => usable(row.product_id)).length;
  const visible = scopeRows.filter(row => {
    if (filter === "pending" && usable(row.product_id)) return false;
    if (filter === "linked" && !usable(row.product_id)) return false;
    const selected = byId.get(edits[row.shopify_variant_id] ?? row.product_id);
    return `${row.shopify_product_title} ${row.shopify_variant_title} ${selected ? productLabel(selected) : ""}`.toLowerCase().includes(search.trim().toLowerCase());
  });

  function selectProduct(row, productId) {
    setMessage("");
    setEdits(current => {
      const next = { ...current };
      if (productId === (row.product_id || "")) delete next[row.shopify_variant_id];
      else next[row.shopify_variant_id] = productId;
      return next;
    });
  }

  async function save() {
    if (busy.current || !dirtyCount) return;
    if (dirtyCount > 200) { setError("Save up to 200 changes at a time."); return; }
    busy.current = true;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const changes = rows.filter(row => Object.hasOwn(edits, row.shopify_variant_id)).map(row => ({
        shopify_variant_id: row.shopify_variant_id,
        product_id: edits[row.shopify_variant_id] || null,
        expected_updated_at: row.updated_at,
      }));
      const { data, error: saveError } = await supabase.rpc("save_shopify_variant_mappings", { p_mappings: changes });
      if (saveError) throw saveError;
      if (!Array.isArray(data) || data.length !== changes.length) {
        throw new Error("The save result could not be confirmed. Reload before trying again.");
      }
      const saved = new Map(data.map(row => [row.shopify_variant_id, row]));
      setRows(current => current.map(row => saved.get(row.shopify_variant_id) || row));
      setEdits({});
      setMessage(`Saved ${data.length} product link${data.length === 1 ? "" : "s"}.`);
    } catch (cause) {
      setError(`Could not save product links: ${cause.message}`);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  function leavePage(event) {
    if (dirtyCount && !window.confirm("Leave this page and discard the unsaved product links?")) event.preventDefault();
  }

  return (
    <main style={pageStyle}>
      <div style={{ maxWidth: "1350px", margin: "0 auto" }}>
        <Link href="/shopify" onClick={leavePage} style={{ color: "#444", fontWeight: 700 }}>← Back to Shopify</Link>
        <h1 style={{ fontSize: "34px", margin: "24px 0 10px" }}>Shopify product matching</h1>
        <p style={{ color: "#555", lineHeight: 1.6, marginBottom: "24px" }}>
          Choose the blank stock item used for each website variant. Different designs can share the same stock item.
          Sales will use the amount actually charged on Shopify and the linked item&apos;s stock and production costs.
        </p>

        {error && <div role="alert" style={{ ...noticeStyle, color: "#9b1c1c", background: "#fff0f0" }}>{error}</div>}
        {message && <div role="status" style={{ ...noticeStyle, color: "#166534", background: "#effaf1" }}>{message}</div>}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px", marginBottom: "22px" }}>
          <Summary title="Website variants" value={loading ? "…" : scopeRows.length} />
          <Summary title="Linked to stock" value={loading ? "…" : linked} />
          <Summary title="Need matching" value={loading ? "…" : scopeRows.length - linked} />
        </div>

        <section style={cardStyle}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", alignItems: "end", marginBottom: "22px" }}>
            <label style={{ flex: "1 1 280px" }}>Search products, sizes, colours or SKU
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="For example: hoodie, Royal Blue, UAT…" style={inputStyle} />
            </label>
            <label>Show
              <select value={filter} onChange={e => setFilter(e.target.value)} style={inputStyle}>
                <option value="all">All variants</option><option value="pending">Need matching</option><option value="linked">Linked to stock</option>
              </select>
            </label>
            <label style={{ paddingBottom: "12px" }}><input type="checkbox" checked={includeInactive} onChange={e => setIncludeInactive(e.target.checked)} /> Include unlisted, draft and archived products</label>
          </div>

          {loading ? <p role="status">Loading product links…</p> : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", minWidth: "850px" }}>
                <thead><tr>{["Website product / variant", "Website price", "Stock item to use", "Direct cost", "Saved status"].map(label => <th key={label} scope="col" style={cellStyle}>{label}</th>)}</tr></thead>
                <tbody>{visible.map(row => {
                  const selectedId = edits[row.shopify_variant_id] ?? row.product_id ?? "";
                  const product = byId.get(selectedId);
                  const changed = Object.hasOwn(edits, row.shopify_variant_id);
                  return <tr key={row.shopify_variant_id} style={{ background: changed ? "#fffbed" : "transparent" }}>
                    <td style={cellStyle}><strong>{row.shopify_product_title}</strong><div style={{ color: "#555", marginTop: "6px" }}>{row.shopify_variant_title}</div>
                      {row.shopify_status !== "ACTIVE" && <small>{row.shopify_status.toLowerCase()}</small>}
                    </td>
                    <td style={cellStyle}>{money(row.shopify_price)}</td>
                    <td style={{ ...cellStyle, minWidth: "330px" }}>
                      <select aria-label={`Stock item for ${row.shopify_product_title} ${row.shopify_variant_title}`} value={selectedId} disabled={saving} onChange={e => selectProduct(row, e.target.value)} style={inputStyle}>
                        <option value="">Not linked — needs checking</option>
                        {selectedId && !usable(selectedId) && <option value={selectedId}>{product ? productLabel(product) : "Stock item unavailable"} — unavailable</option>}
                        {selectable.map(p => <option key={p.id} value={p.id}>{productLabel(p)}</option>)}
                      </select>
                      {!row.product_id && !changed && row.match_note && <div style={{ color: "#76541a", fontSize: "13px", lineHeight: 1.5, marginTop: "7px" }}>{row.match_note}</div>}
                      {changed && <small>Unsaved change</small>}
                    </td>
                    <td style={cellStyle}>{product ? <><strong>{money(Number(product.stock_cost) + Number(product.production_cost))}</strong><div style={{ fontSize: "12px", color: "#666", marginTop: "5px" }}>Stock {money(product.stock_cost)}<br />Production {money(product.production_cost)}</div></> : "—"}</td>
                    <td style={{ ...cellStyle, color: usable(row.product_id) ? "#166534" : "#8a6012", fontWeight: 700 }}>{usable(row.product_id) ? "Linked" : "Needs matching"}</td>
                  </tr>;
                })}</tbody>
              </table>
              {visible.length === 0 && <p>No variants match these filters.</p>}
            </div>
          )}
        </section>

        <div style={{ ...cardStyle, position: "sticky", bottom: "10px", marginTop: "16px", display: "flex", alignItems: "center", flexWrap: "wrap", justifyContent: "space-between", gap: "12px", border: "1px solid #ddd" }}>
          <div><strong>{dirtyCount} unsaved change{dirtyCount === 1 ? "" : "s"}</strong><div style={{ color: "#666", marginTop: "5px", fontSize: "13px" }}>Saving links does not change stock or sales. New imports use the saved links.</div></div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
            <button type="button" disabled={saving || loading} onClick={() => { if (!dirtyCount || window.confirm("Discard your unsaved changes and reload?")) loadData(); }} style={{ ...buttonStyle, color: "#111", background: "#eee" }}>{dirtyCount ? "Discard and reload" : "Reload links"}</button>
            <button type="button" disabled={saving || loading || !dirtyCount} onClick={save} style={{ ...buttonStyle, opacity: saving || loading || !dirtyCount ? 0.5 : 1 }}>{saving ? "Saving…" : "Save product links"}</button>
          </div>
        </div>
        <p style={{ color: "#777", fontSize: "13px", lineHeight: 1.6 }}>Only current variants from active Shopify products are shown by default. Unlisted, draft and archived products can be included above. Removed variants are kept in history. Reload links refreshes saved links and stock records; it does not fetch newly added Shopify products.</p>
      </div>
    </main>
  );
}

function Summary({ title, value }) { return <div style={cardStyle}><div style={{ color: "#666", marginBottom: "8px" }}>{title}</div><strong style={{ fontSize: "28px" }}>{value}</strong></div>; }
const pageStyle = { minHeight: "100vh", background: "#f7f7f8", padding: "50px 20px", color: "#111", fontFamily: "Arial, sans-serif" };
const cardStyle = { background: "#fff", padding: "22px", borderRadius: "12px", boxShadow: "0 2px 10px rgba(0,0,0,0.06)" };
const inputStyle = { display: "block", width: "100%", boxSizing: "border-box", marginTop: "7px", border: "1px solid #ccc", borderRadius: "8px", padding: "11px", fontSize: "14px", background: "#fff", color: "#111" };
const cellStyle = { padding: "14px 10px", borderBottom: "1px solid #e5e5e5", verticalAlign: "top", lineHeight: 1.5 };
const buttonStyle = { padding: "13px 18px", border: 0, borderRadius: "8px", color: "#fff", background: "#111", fontWeight: 700, cursor: "pointer" };
const noticeStyle = { borderRadius: "9px", marginBottom: "18px", padding: "15px", lineHeight: 1.5 };
