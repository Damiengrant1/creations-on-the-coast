"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

export default function NewProductPage() {
  const [copyProductId, setCopyProductId] = useState(null);

  const [productName, setProductName] = useState("");
  const [sku, setSku] = useState("");
  const [category, setCategory] = useState("");
  const [colour, setColour] = useState("");
  const [size, setSize] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [lowStockLevel, setLowStockLevel] = useState(0);
  const [trackStock, setTrackStock] = useState(true);
  const [openingStock, setOpeningStock] = useState(0);
  const [active, setActive] = useState(true);

  const [saving, setSaving] = useState(false);
  const [loadingCopy, setLoadingCopy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const copyId = params.get("copy");

    if (copyId) {
      setCopyProductId(copyId);
    }
  }, []);

  useEffect(() => {
    if (!copyProductId) return;

    async function loadProductToCopy() {
      setLoadingCopy(true);
      setMessage("");

      const { data, error } = await supabase
        .from("products")
        .select(
          "id, product_name, sku, category, colour, size, cost_price, selling_price, low_stock_level, track_stock, active"
        )
        .eq("id", copyProductId)
        .single();

      if (error) {
        console.error(error);
        setMessage(
          `Could not load product to copy: ${error.message}`
        );
        setLoadingCopy(false);
        return;
      }

      setProductName(data.product_name || "");
      setCategory(data.category || "");
      setCostPrice(
        data.cost_price !== null && data.cost_price !== undefined
          ? String(data.cost_price)
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

      // Keep the colour because you'll often be adding
      // another size of the same colour.
      setColour(data.colour || "");

      // Clear fields that should be unique to the variant.
      setSize("");
      setSku("");

      // Stock will be set later during stocktake.
      setOpeningStock(0);

      setLoadingCopy(false);
    }

    loadProductToCopy();
  }, [copyProductId]);

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

    if (Number(costPrice) < 0 || Number(sellingPrice) < 0) {
      setMessage("Prices cannot be negative.");
      return;
    }

    if (trackStock && Number(openingStock) < 0) {
      setMessage("Opening stock cannot be negative.");
      return;
    }

    setSaving(true);

    const { data: product, error: productError } = await supabase
      .from("products")
      .insert({
        product_name: productName.trim(),
        sku: sku.trim() || null,
        category: category.trim() || null,
        colour: colour.trim() || null,
        size: size.trim() || null,
        cost_price: Number(costPrice || 0),
        selling_price: Number(sellingPrice || 0),
        low_stock_level: trackStock
          ? Number(lowStockLevel || 0)
          : 0,
        track_stock: trackStock,
        active,
      })
      .select("id")
      .single();

    if (productError) {
      console.error(productError);
      setMessage(
        `Could not create product: ${productError.message}`
      );
      setSaving(false);
      return;
    }

    if (trackStock && Number(openingStock) !== 0) {
      const { error: stockError } = await supabase
        .from("stock_movements")
        .insert({
          product_id: product.id,
          movement_type: "adjustment",
          quantity_change: Number(openingStock),
          notes: "Opening stock",
        });

      if (stockError) {
        console.error(stockError);
        setMessage(
          `Product created, but opening stock could not be added: ${stockError.message}`
        );
        setSaving(false);
        return;
      }
    }

    if (copyProductId) {
      setMessage("Variant created successfully.");

      // Keep the shared information ready so another
      // size can be entered immediately.
      setSku("");
      setSize("");
      setOpeningStock(0);
    } else {
      setMessage("Product created successfully.");

      setProductName("");
      setSku("");
      setCategory("");
      setColour("");
      setSize("");
      setCostPrice("");
      setSellingPrice("");
      setLowStockLevel(0);
      setTrackStock(true);
      setOpeningStock(0);
      setActive(true);
    }

    setSaving(false);
  }

  if (loadingCopy) {
    return (
      <main
        style={{
          minHeight: "100vh",
          background: "#f7f7f8",
          padding: "40px 20px",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div style={{ maxWidth: "760px", margin: "0 auto" }}>
          Loading product details...
        </div>
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
          {copyProductId
            ? "Add Product Variant"
            : "Add New Product"}
        </h1>

        <p
          style={{
            color: "#666",
            marginBottom: "28px",
          }}
        >
          {copyProductId
            ? "Shared product details have been copied. Enter the details for the new variant."
            : "Add a physical product or service to Creations on the Coast."}
        </p>

        {copyProductId && (
          <div
            style={{
              background: "#eef6ff",
              border: "1px solid #cfe4ff",
              padding: "14px",
              borderRadius: "9px",
              marginBottom: "20px",
            }}
          >
            <strong>Adding a variant</strong>

            <div
              style={{
                marginTop: "4px",
                color: "#555",
                fontSize: "14px",
              }}
            >
              Product details and colour have been carried
              across. Enter the new size and SKU.
            </div>
          </div>
        )}

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
            <label style={labelStyle}>
              Product Name
            </label>

            <input
              type="text"
              value={productName}
              onChange={(e) =>
                setProductName(e.target.value)
              }
              placeholder="e.g. Uneek Hoody (Adult)"
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
              <label style={labelStyle}>
                Category
              </label>

              <input
                type="text"
                value={category}
                onChange={(e) =>
                  setCategory(e.target.value)
                }
                placeholder="e.g. Hoodies"
                style={fieldStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>
                SKU
              </label>

              <input
                type="text"
                value={sku}
                onChange={(e) =>
                  setSku(e.target.value)
                }
                placeholder="Optional"
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
              <label style={labelStyle}>
                Colour
              </label>

              <input
                type="text"
                value={colour}
                onChange={(e) =>
                  setColour(e.target.value)
                }
                placeholder="e.g. Black"
                style={fieldStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>
                Size
              </label>

              <input
                type="text"
                value={size}
                onChange={(e) =>
                  setSize(e.target.value)
                }
                placeholder="e.g. L"
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
              <label style={labelStyle}>
                Cost Price (£)
              </label>

              <input
                type="number"
                step="0.01"
                min="0"
                value={costPrice}
                onChange={(e) =>
                  setCostPrice(e.target.value)
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
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "16px",
                }}
              >
                <div>
                  <label style={labelStyle}>
                    Opening Stock
                  </label>

                  <input
                    type="number"
                    min="0"
                    value={openingStock}
                    onChange={(e) =>
                      setOpeningStock(e.target.value)
                    }
                    style={fieldStyle}
                  />
                </div>

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
            {saving
              ? "Saving..."
              : copyProductId
              ? "Create Variant"
              : "Create Product"}
          </button>
        </form>
      </div>
    </main>
  );
}
