"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

export default function EditProductPage() {
  const params = useParams();
  const productId = params.id;

  const [productName, setProductName] = useState("");
  const [sku, setSku] = useState("");
  const [category, setCategory] = useState("");
  const [colour, setColour] = useState("");
  const [size, setSize] = useState("");

  const [stockCost, setStockCost] = useState("");
  const [productionCost, setProductionCost] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");

  const [lowStockLevel, setLowStockLevel] = useState(0);
  const [trackStock, setTrackStock] = useState(true);
  const [active, setActive] = useState(true);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!productId) return;

    async function loadProduct() {
      setLoading(true);

      const { data, error } = await supabase
        .from("products")
        .select(
          "id, product_name, sku, category, colour, size, stock_cost, production_cost, cost_price, selling_price, low_stock_level, track_stock, active"
        )
        .eq("id", productId)
        .single();

      if (error) {
        console.error(error);
        setMessage(`Could not load product: ${error.message}`);
        setLoading(false);
        return;
      }

      setProductName(data.product_name || "");
      setSku(data.sku || "");
      setCategory(data.category || "");
      setColour(data.colour || "");
      setSize(data.size || "");

      setStockCost(
        data.stock_cost !== null && data.stock_cost !== undefined
          ? String(data.stock_cost)
          : ""
      );

      setProductionCost(
        data.production_cost !== null &&
          data.production_cost !== undefined
          ? String(data.production_cost)
          : ""
      );

      setSellingPrice(
        data.selling_price !== null &&
          data.selling_price !== undefined
          ? String(data.selling_price)
          : ""
      );

      setLowStockLevel(data.low_stock_level ?? 0);
      setTrackStock(data.track_stock ?? true);
      setActive(data.active ?? true);

      setLoading(false);
    }

    loadProduct();
  }, [productId]);

  const totalDirectCost =
    Number(stockCost || 0) + Number(productionCost || 0);

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

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");

    if (!productName.trim()) {
      setMessage("Please enter a product name.");
      return;
    }

    if (
      Number(stockCost) < 0 ||
      Number(productionCost) < 0 ||
      Number(sellingPrice) < 0
    ) {
      setMessage("Costs and selling price cannot be negative.");
      return;
    }

    setSaving(true);

    const totalCost =
      Number(stockCost || 0) +
      Number(productionCost || 0);

    const { error } = await supabase
      .from("products")
      .update({
        product_name: productName.trim(),
        sku: sku.trim() || null,
        category: category.trim() || null,
        colour: colour.trim() || null,
        size: size.trim() || null,

        stock_cost: Number(stockCost || 0),
        production_cost: Number(productionCost || 0),

        // Keep old cost_price in sync for existing
        // sales/profit logic.
        cost_price: totalCost,

        selling_price: Number(sellingPrice || 0),

        low_stock_level: trackStock
          ? Number(lowStockLevel || 0)
          : 0,

        track_stock: trackStock,
        active,
      })
      .eq("id", productId);

    if (error) {
      console.error(error);
      setMessage(`Could not update product: ${error.message}`);
      setSaving(false);
      return;
    }

    setMessage("Product updated successfully.");
    setSaving(false);
  }

  if (loading) {
    return (
      <main
        style={{
          padding: "40px",
          fontFamily: "Arial, sans-serif",
        }}
      >
        Loading product...
      </main>
    );
  }

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
          maxWidth: "760px",
          margin: "0 auto",
        }}
      >
        <Link
          href="/products"
          style={{
            display: "inline-block",
            marginBottom: "24px",
            color: "#333",
          }}
        >
          ← Back to Products
        </Link>

        <h1
          style={{
            fontSize: "36px",
            marginBottom: "8px",
          }}
        >
          Edit Product
        </h1>

        <p
          style={{
            color: "#666",
            marginBottom: "28px",
          }}
        >
          Update product details, pricing and stock settings.
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
            <label style={labelStyle}>Product Name</label>

            <input
              type="text"
              value={productName}
              onChange={(e) =>
                setProductName(e.target.value)
              }
              style={fieldStyle}
              required
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
              <label style={labelStyle}>Category</label>

              <input
                type="text"
                value={category}
                onChange={(e) =>
                  setCategory(e.target.value)
                }
                style={fieldStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>SKU</label>

              <input
                type="text"
                value={sku}
                onChange={(e) =>
                  setSku(e.target.value)
                }
                style={fieldStyle}
              />
            </div>
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
              <label style={labelStyle}>Colour</label>

              <input
                type="text"
                value={colour}
                onChange={(e) =>
                  setColour(e.target.value)
                }
                style={fieldStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Size</label>

              <input
                type="text"
                value={size}
                onChange={(e) =>
                  setSize(e.target.value)
                }
                style={fieldStyle}
              />
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "16px",
              marginBottom: "20px",
            }}
          >
            <div>
              <label style={labelStyle}>
                Stock Cost (£)
              </label>

              <input
                type="number"
                step="0.01"
                min="0"
                value={stockCost}
                onChange={(e) =>
                  setStockCost(e.target.value)
                }
                style={fieldStyle}
                required
              />
            </div>

            <div>
              <label style={labelStyle}>
                Production Cost (£)
              </label>

              <input
                type="number"
                step="0.01"
                min="0"
                value={productionCost}
                onChange={(e) =>
                  setProductionCost(e.target.value)
                }
                style={fieldStyle}
                required
              />
            </div>

            <div>
              <label style={labelStyle}>
                Selling Price (£)
              </label>

              <input
                type="number"
                step="0.01"
                min="0"
                value={sellingPrice}
                onChange={(e) =>
                  setSellingPrice(e.target.value)
                }
                style={fieldStyle}
                required
              />
            </div>
          </div>

          <div
            style={{
              background: "#f7f7f8",
              padding: "18px",
              borderRadius: "10px",
              marginBottom: "20px",
            }}
          >
            <div style={{ color: "#666" }}>
              Total Direct Cost
            </div>

            <div
              style={{
                fontSize: "28px",
                fontWeight: "700",
                marginTop: "4px",
              }}
            >
              £{totalDirectCost.toFixed(2)}
            </div>

            <div
              style={{
                color: "#777",
                fontSize: "13px",
                marginTop: "6px",
              }}
            >
              Used for gross profit calculations. Stock value uses
              Stock Cost only.
            </div>
          </div>

          <div
            style={{
              padding: "18px",
              background: "#f7f7f8",
              borderRadius: "10px",
              marginBottom: "20px",
            }}
          >
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                fontWeight: "600",
                marginBottom: trackStock
                  ? "18px"
                  : "0",
              }}
            >
              <input
                type="checkbox"
                checked={trackStock}
                onChange={(e) =>
                  setTrackStock(e.target.checked)
                }
              />

              Track stock for this product
            </label>

            {trackStock && (
              <div>
                <label style={labelStyle}>
                  Low Stock Warning Level
                </label>

                <input
                  type="number"
                  min="0"
                  value={lowStockLevel}
                  onChange={(e) =>
                    setLowStockLevel(e.target.value)
                  }
                  style={fieldStyle}
                />
              </div>
            )}
          </div>

          <div style={{ marginBottom: "24px" }}>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                fontWeight: "600",
              }}
            >
              <input
                type="checkbox"
                checked={active}
                onChange={(e) =>
                  setActive(e.target.checked)
                }
              />

              Active product
            </label>
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
              borderRadius: "9px",
              border: "none",
              background: "#111",
              color: "#fff",
              fontWeight: "700",
              fontSize: "16px",
              cursor: saving
                ? "not-allowed"
                : "pointer",
            }}
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </form>
      </div>
    </main>
  );
}
