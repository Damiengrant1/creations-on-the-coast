"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

const REASONS = ["Stocktake", "Damaged", "Missing", "Correction", "Other"];

export default function StocktakePage() {
  const [products, setProducts] = useState([]);
  const [counts, setCounts] = useState({});
  const [reason, setReason] = useState("Stocktake");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("");

  useEffect(() => {
    loadProducts();
  }, []);

  async function loadProducts({ keepMessage = false } = {}) {
    setLoading(true);

    if (!keepMessage) {
      setMessage("");
      setMessageType("");
    }

    const { data: stockData, error: stockError } = await supabase
      .from("current_stock")
      .select("product_id, product_name, sku, category, active, current_stock")
      .order("product_name");

    const { data: productData, error: productError } = await supabase
      .from("products")
      .select("id, track_stock, colour, size");

    if (stockError || productError) {
      const error = stockError || productError;
      console.error("Could not load stocktake products:", error);
      setMessage(`Could not load products: ${error.message}`);
      setMessageType("error");
      setProducts([]);
      setLoading(false);
      return;
    }

    const productSettings = new Map(
      (productData || []).map((product) => [product.id, product])
    );

    const trackedProducts = (stockData || [])
      .map((product) => {
        const settings = productSettings.get(product.product_id) || {};

        return {
          ...product,
          track_stock: settings.track_stock ?? true,
          colour: settings.colour ?? null,
          size: settings.size ?? null,
          current_stock: Number(product.current_stock || 0),
        };
      })
      .filter((product) => product.track_stock);

    setProducts(trackedProducts);
    setCounts({});
    setLoading(false);
  }

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase();

    if (!term) return products;

    return products.filter((product) =>
      [
        product.product_name,
        product.colour,
        product.size,
        product.sku,
        product.category,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    );
  }, [products, search]);

  const enteredRows = useMemo(
    () =>
      products.filter((product) => {
        const value = counts[product.product_id];
        return value !== undefined && value !== "";
      }),
    [products, counts]
  );

  const adjustmentPreview = useMemo(
    () =>
      enteredRows.reduce(
        (total, product) =>
          total +
          (Number(counts[product.product_id]) -
            Number(product.current_stock || 0)),
        0
      ),
    [enteredRows, counts]
  );

  function updateCount(productId, value) {
    setCounts((current) => ({
      ...current,
      [productId]: value,
    }));
  }

  async function saveAdjustments(event) {
    event.preventDefault();
    setMessage("");
    setMessageType("");

    if (enteredRows.length === 0) {
      setMessage("Enter at least one counted quantity.");
      setMessageType("error");
      return;
    }

    for (const product of enteredRows) {
      const value = Number(counts[product.product_id]);

      if (!Number.isInteger(value) || value < 0) {
        setMessage(
          `Enter a whole number of 0 or more for ${product.product_name}.`
        );
        setMessageType("error");
        return;
      }
    }

    setSaving(true);

    const productIds = enteredRows.map((product) => product.product_id);

    const { data: latestStock, error: latestStockError } = await supabase
      .from("current_stock")
      .select("product_id, current_stock")
      .in("product_id", productIds);

    if (latestStockError) {
      console.error("Could not refresh stock:", latestStockError);
      setMessage(
        `Could not refresh stock before saving: ${latestStockError.message}`
      );
      setMessageType("error");
      setSaving(false);
      return;
    }

    const latestStockByProduct = new Map(
      (latestStock || []).map((row) => [
        row.product_id,
        Number(row.current_stock || 0),
      ])
    );

    const movements = enteredRows
      .map((product) => {
        const systemQuantity =
          latestStockByProduct.get(product.product_id) ?? 0;
        const countedQuantity = Number(counts[product.product_id]);
        const quantityChange = countedQuantity - systemQuantity;

        if (quantityChange === 0) return null;

        const auditDetails = [
          reason,
          `System quantity: ${systemQuantity}`,
          `Counted quantity: ${countedQuantity}`,
          note.trim() || null,
        ]
          .filter(Boolean)
          .join(" | ");

        return {
          product_id: product.product_id,
          movement_type: "adjustment",
          quantity_change: quantityChange,
          notes: auditDetails,
        };
      })
      .filter(Boolean);

    if (movements.length === 0) {
      setMessage(
        "The counted quantities match the system. No stock movements were needed."
      );
      setMessageType("success");
      setSaving(false);
      await loadProducts({ keepMessage: true });
      return;
    }

    const { error: movementError } = await supabase
      .from("stock_movements")
      .insert(movements);

    if (movementError) {
      console.error("Could not save stock adjustments:", movementError);
      setMessage(
        `Could not save stock adjustments: ${movementError.message}`
      );
      setMessageType("error");
      setSaving(false);
      return;
    }

    setMessage(
      `${movements.length} stock adjustment${movements.length === 1 ? "" : "s"} saved successfully.`
    );
    setMessageType("success");
    setNote("");
    setSaving(false);
    await loadProducts({ keepMessage: true });
  }

  const fieldStyle = {
    width: "100%",
    padding: "11px",
    border: "1px solid #d8d8d8",
    borderRadius: "8px",
    fontSize: "15px",
    boxSizing: "border-box",
    background: "#fff",
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
      <div style={{ maxWidth: "1250px", margin: "0 auto" }}>
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

        <div style={{ marginBottom: "24px" }}>
          <h1 style={{ fontSize: "36px", margin: "0 0 8px" }}>
            Stocktake / Stock Adjustments
          </h1>
          <p style={{ color: "#666", margin: 0 }}>
            Enter the actual quantity counted. The system will calculate and
            record the adjustment automatically.
          </p>
        </div>

        <form onSubmit={saveAdjustments}>
          <div
            style={{
              background: "#fff",
              padding: "22px",
              borderRadius: "14px",
              boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
              marginBottom: "20px",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "16px",
              }}
            >
              <div>
                <label
                  style={{
                    display: "block",
                    fontWeight: "700",
                    marginBottom: "6px",
                  }}
                >
                  Reason
                </label>
                <select
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  style={fieldStyle}
                >
                  {REASONS.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontWeight: "700",
                    marginBottom: "6px",
                  }}
                >
                  Note (optional)
                </label>
                <input
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Extra detail for the audit trail"
                  style={fieldStyle}
                />
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontWeight: "700",
                    marginBottom: "6px",
                  }}
                >
                  Search products
                </label>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Name, colour, size, SKU..."
                  style={fieldStyle}
                />
              </div>
            </div>
          </div>

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

          <div
            style={{
              background: "#fff",
              borderRadius: "14px",
              boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
              overflowX: "auto",
            }}
          >
            {loading ? (
              <div style={{ padding: "28px" }}>Loading stock...</div>
            ) : filteredProducts.length === 0 ? (
              <div style={{ padding: "28px" }}>No tracked products found.</div>
            ) : (
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  minWidth: "900px",
                }}
              >
                <thead>
                  <tr
                    style={{
                      textAlign: "left",
                      background: "#fafafa",
                    }}
                  >
                    <Th>Product</Th>
                    <Th>Colour</Th>
                    <Th>Size</Th>
                    <Th>SKU</Th>
                    <Th>System Qty</Th>
                    <Th>Actual Counted Qty</Th>
                    <Th>Adjustment</Th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map((product) => {
                    const enteredValue = counts[product.product_id];
                    const hasCount =
                      enteredValue !== undefined && enteredValue !== "";
                    const adjustment = hasCount
                      ? Number(enteredValue) - product.current_stock
                      : null;

                    return (
                      <tr
                        key={product.product_id}
                        style={{ borderTop: "1px solid #eee" }}
                      >
                        <Td>
                          <strong>{product.product_name}</strong>
                          {!product.active && (
                            <span style={{ color: "#777", marginLeft: "8px" }}>
                              (Inactive)
                            </span>
                          )}
                        </Td>
                        <Td>{product.colour || "—"}</Td>
                        <Td>{product.size || "—"}</Td>
                        <Td>{product.sku || "—"}</Td>
                        <Td>
                          <strong>{product.current_stock}</strong>
                        </Td>
                        <Td>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={enteredValue ?? ""}
                            onChange={(event) =>
                              updateCount(
                                product.product_id,
                                event.target.value
                              )
                            }
                            placeholder="Leave blank"
                            aria-label={`Actual counted quantity for ${product.product_name}`}
                            style={{
                              ...fieldStyle,
                              width: "150px",
                            }}
                          />
                        </Td>
                        <Td>
                          {adjustment === null ? (
                            "—"
                          ) : (
                            <span
                              style={{
                                fontWeight: "700",
                                color:
                                  adjustment > 0
                                    ? "#176b31"
                                    : adjustment < 0
                                      ? "#9b1c1c"
                                      : "#555",
                              }}
                            >
                              {adjustment > 0 ? "+" : ""}
                              {adjustment}
                            </span>
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div
            style={{
              position: "sticky",
              bottom: "16px",
              marginTop: "20px",
              background: "#fff",
              padding: "18px",
              borderRadius: "12px",
              boxShadow: "0 5px 22px rgba(0,0,0,0.14)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "16px",
              flexWrap: "wrap",
            }}
          >
            <div>
              <strong>{enteredRows.length}</strong>{" "}
              {enteredRows.length === 1 ? "product" : "products"} counted
              <div style={{ color: "#666", fontSize: "13px", marginTop: "4px" }}>
                Preview net change: {adjustmentPreview > 0 ? "+" : ""}
                {adjustmentPreview}
              </div>
            </div>

            <button
              type="submit"
              disabled={saving || loading}
              style={{
                border: "none",
                borderRadius: "9px",
                padding: "14px 20px",
                background: saving || loading ? "#777" : "#111",
                color: "#fff",
                fontWeight: "700",
                fontSize: "16px",
                cursor: saving || loading ? "not-allowed" : "pointer",
              }}
            >
              {saving ? "Saving Adjustments..." : "Save Stock Adjustments"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

function Th({ children }) {
  return (
    <th
      style={{
        padding: "14px",
        fontSize: "14px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  );
}

function Td({ children }) {
  return (
    <td
      style={{
        padding: "14px",
        fontSize: "14px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </td>
  );
}
