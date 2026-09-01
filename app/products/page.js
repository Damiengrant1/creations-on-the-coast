"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

export default function ProductsPage() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadProducts();
  }, []);

  async function loadProducts() {
    setLoading(true);
    setMessage("");

    const { data: stockData, error: stockError } = await supabase
      .from("current_stock")
      .select(
        "product_id, product_name, sku, category, cost_price, selling_price, low_stock_level, active, current_stock, stock_value"
      )
      .order("product_name");

    const { data: productData, error: productError } = await supabase
      .from("products")
      .select("id, track_stock, colour, size");

    if (stockError) {
      console.error("Stock error:", stockError);
      setMessage(`Could not load stock: ${stockError.message}`);
      setProducts([]);
      setLoading(false);
      return;
    }

    if (productError) {
      console.error("Product error:", productError);
      setMessage(`Could not load products: ${productError.message}`);
      setProducts([]);
      setLoading(false);
      return;
    }

    const productSettings = new Map(
      (productData || []).map((product) => [
        product.id,
        {
          track_stock: product.track_stock,
          colour: product.colour,
          size: product.size,
        },
      ])
    );

    const mergedProducts = (stockData || []).map((product) => {
      const settings = productSettings.get(product.product_id) || {};

      return {
        ...product,
        track_stock: settings.track_stock ?? true,
        colour: settings.colour ?? null,
        size: settings.size ?? null,
      };
    });

    setProducts(mergedProducts);
    setLoading(false);
  }

  const totals = useMemo(() => {
    const stockValue = products.reduce(
      (sum, product) =>
        sum +
        (product.track_stock
          ? Number(product.stock_value || 0)
          : 0),
      0
    );

    const trackedProducts = products.filter(
      (product) => product.track_stock
    ).length;

    const lowStock = products.filter(
      (product) =>
        product.track_stock &&
        Number(product.current_stock || 0) <=
          Number(product.low_stock_level || 0)
    ).length;

    return {
      stockValue,
      trackedProducts,
      lowStock,
    };
  }, [products]);

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
          maxWidth: "1300px",
          margin: "0 auto",
        }}
      >
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

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "16px",
            alignItems: "center",
            flexWrap: "wrap",
            marginBottom: "24px",
          }}
        >
          <div>
            <h1
              style={{
                fontSize: "36px",
                margin: 0,
                marginBottom: "8px",
              }}
            >
              Products & Stock
            </h1>

            <p
              style={{
                color: "#666",
                margin: 0,
              }}
            >
              View products, variants, prices and current stock levels.
            </p>
          </div>

          <Link
            href="/products/new"
            style={{
              background: "#111",
              color: "#fff",
              textDecoration: "none",
              padding: "13px 18px",
              borderRadius: "9px",
              fontWeight: "700",
            }}
          >
            + Add New Product
          </Link>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(200px, 1fr))",
            gap: "16px",
            marginBottom: "24px",
          }}
        >
          <SummaryCard
            title="Products"
            value={products.length}
          />

          <SummaryCard
            title="Tracked Products"
            value={totals.trackedProducts}
          />

          <SummaryCard
            title="Low Stock"
            value={totals.lowStock}
          />

          <SummaryCard
            title="Stock Value"
            value={`£${totals.stockValue.toFixed(2)}`}
          />
        </div>

        <div
          style={{
            background: "#fff",
            borderRadius: "14px",
            boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
            overflowX: "auto",
          }}
        >
          {loading ? (
            <div style={{ padding: "28px" }}>
              Loading products...
            </div>
          ) : message ? (
            <div style={{ padding: "28px" }}>
              {message}
            </div>
          ) : products.length === 0 ? (
            <div style={{ padding: "28px" }}>
              No products found.
            </div>
          ) : (
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                minWidth: "1100px",
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
                  <Th>Category</Th>
                  <Th>Cost</Th>
                  <Th>Selling Price</Th>
                  <Th>Current Stock</Th>
                  <Th>Low Stock Level</Th>
                  <Th>Stock Value</Th>
                  <Th>Track Stock</Th>
                  <Th>Status</Th>
                </tr>
              </thead>

              <tbody>
                {products.map((product) => {
                  const isLowStock =
                    product.track_stock &&
                    Number(product.current_stock || 0) <=
                      Number(product.low_stock_level || 0);

                  return (
                    <tr
                      key={product.product_id}
                      style={{
                        borderTop: "1px solid #eee",
                      }}
                    >
                      <Td>
                        <strong>{product.product_name}</strong>
                      </Td>

                      <Td>{product.colour || "—"}</Td>

                      <Td>{product.size || "—"}</Td>

                      <Td>{product.sku || "—"}</Td>

                      <Td>{product.category || "—"}</Td>

                      <Td>
                        £
                        {Number(
                          product.cost_price || 0
                        ).toFixed(2)}
                      </Td>

                      <Td>
                        £
                        {Number(
                          product.selling_price || 0
                        ).toFixed(2)}
                      </Td>

                      <Td>
                        {product.track_stock
                          ? Number(product.current_stock || 0)
                          : "N/A"}
                      </Td>

                      <Td>
                        {product.track_stock ? (
                          <span
                            style={{
                              fontWeight: isLowStock
                                ? "700"
                                : "400",
                            }}
                          >
                            {product.low_stock_level}
                            {isLowStock ? " — LOW" : ""}
                          </span>
                        ) : (
                          "N/A"
                        )}
                      </Td>

                      <Td>
                        {product.track_stock
                          ? `£${Number(
                              product.stock_value || 0
                            ).toFixed(2)}`
                          : "N/A"}
                      </Td>

                      <Td>
                        {product.track_stock ? "Yes" : "No"}
                      </Td>

                      <Td>
                        {product.active ? "Active" : "Inactive"}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </main>
  );
}

function SummaryCard({ title, value }) {
  return (
    <div
      style={{
        background: "#fff",
        padding: "22px",
        borderRadius: "12px",
        boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
      }}
    >
      <div
        style={{
          color: "#666",
          marginBottom: "8px",
        }}
      >
        {title}
      </div>

      <div
        style={{
          fontSize: "28px",
          fontWeight: "700",
        }}
      >
        {value}
      </div>
    </div>
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
