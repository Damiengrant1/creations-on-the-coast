"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { useAccess } from "../AuthGate";
import ui from "../../lib/ui";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

export default function ProductsPage() {
  const { isAdmin } = useAccess();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    loadProducts();
  }, []);

  async function loadProducts() {
    setLoading(true);
    setMessage("");

    const { data: stockData, error: stockError } = await supabase
      .from("current_stock")
      .select(
        "product_id, product_name, sku, category, stock_cost, production_cost, cost_price, selling_price, low_stock_level, active, current_stock, stock_value"
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
      const settings =
        productSettings.get(product.product_id) || {};

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

    const potentialSalesValue = products.reduce(
      (sum, product) =>
        sum +
        (product.track_stock
          ? Number(product.current_stock || 0) *
            Number(product.selling_price || 0)
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
      potentialSalesValue,
      trackedProducts,
      lowStock,
    };
  }, [products]);

  const filteredProducts = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();

    if (!search) {
      return products;
    }

    return products.filter((product) =>
      [
        product.product_name,
        product.colour,
        product.size,
        product.sku,
        product.category,
      ].some((value) =>
        String(value || "").toLowerCase().includes(search)
      )
    );
  }, [products, searchTerm]);

  return (
    <main
      style={{ ...ui.page }}
    >
      <div
        style={{
          maxWidth: "1500px",
          margin: "0 auto",
        }}
      >
        <Link
          href="/"
          style={ui.back}
        >
          ← Home
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
              style={{ fontSize: "30px", margin: 0, marginBottom: "8px" }}
            >
              Products & Stock
            </h1>

            <p
              style={{
                color: "var(--muted)",
                margin: 0,
              }}
            >
              View products, variants, costs, prices and stock levels.
            </p>
          </div>

          {isAdmin && (
            <Link
              href="/products/new"
              style={{
                background: "var(--ink)",
                color: "#fff",
                textDecoration: "none",
                padding: "13px 18px",
                borderRadius: "9px",
                fontWeight: "700",
              }}
            >
              + Add New Product
            </Link>
          )}
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

          <SummaryCard
            title="Potential Sales Value"
            value={`£${totals.potentialSalesValue.toFixed(2)}`}
          />
        </div>

        <div
          style={{ ...ui.card, marginBottom: "16px" }}
        >
          <label
            htmlFor="product-search"
            style={{
              display: "block",
              fontWeight: "700",
              marginBottom: "8px",
            }}
          >
            Search Products
          </label>

          <div
            style={{
              display: "flex",
              gap: "10px",
              alignItems: "center",
            }}
          >
            <input
              id="product-search"
              type="search"
              value={searchTerm}
              onChange={(event) =>
                setSearchTerm(event.target.value)
              }
              placeholder="Search by product, colour, size, SKU or category"
              style={{
                width: "100%",
                padding: "12px 14px",
                border: "1px solid var(--line-strong)",
                borderRadius: "8px",
                fontSize: "16px",
              }}
            />

            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                style={{
                  padding: "12px 16px",
                  border: "1px solid var(--line-strong)",
                  borderRadius: "8px",
                  background: "#fff",
                  cursor: "pointer",
                  fontWeight: "600",
                  whiteSpace: "nowrap",
                }}
              >
                Clear
              </button>
            )}
          </div>

          {searchTerm.trim() && (
            <div
              style={{
                marginTop: "9px",
                color: "var(--muted)",
                fontSize: "14px",
              }}
            >
              {filteredProducts.length}{" "}
              {filteredProducts.length === 1
                ? "product"
                : "products"}{" "}
              found
            </div>
          )}
        </div>

        <div
          style={{ ...ui.card, overflowX: "auto" }}
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
          ) : filteredProducts.length === 0 ? (
            <div style={{ padding: "28px" }}>
              No products match your search.
            </div>
          ) : (
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                minWidth: "1450px",
              }}
            >
              <thead>
                <tr
                  style={{
                    textAlign: "left",
                    background: "var(--surface-2)",
                  }}
                >
                  <Th>Product</Th>
                  <Th>Colour</Th>
                  <Th>Size</Th>
                  <Th>SKU</Th>
                  <Th>Category</Th>

                  <Th>Stock Cost</Th>
                  <Th>Production Cost</Th>
                  <Th>Total Cost</Th>
                  <Th>Selling Price</Th>

                  <Th>Current Stock</Th>
                  <Th>Low Stock</Th>
                  <Th>Stock Value</Th>
                  <Th>Status</Th>
                  {isAdmin && <Th>Actions</Th>}
                </tr>
              </thead>

              <tbody>
                {filteredProducts.map((product) => {
                  const currentStock = Number(
                    product.current_stock || 0
                  );

                  const lowStockLevel = Number(
                    product.low_stock_level || 0
                  );

                  const isLowStock =
                    product.track_stock &&
                    currentStock <= lowStockLevel;

                  return (
                    <tr
                      key={product.product_id}
                      style={{
                        borderTop: "1px solid var(--line)",
                      }}
                    >
                      <Td>
                        <strong>
                          {product.product_name}
                        </strong>
                      </Td>

                      <Td>{product.colour || "—"}</Td>

                      <Td>{product.size || "—"}</Td>

                      <Td>{product.sku || "—"}</Td>

                      <Td>{product.category || "—"}</Td>

                      <Td>
                        £
                        {Number(
                          product.stock_cost || 0
                        ).toFixed(2)}
                      </Td>

                      <Td>
                        £
                        {Number(
                          product.production_cost || 0
                        ).toFixed(2)}
                      </Td>

                      <Td>
                        <strong>
                          £
                          {Number(
                            product.cost_price || 0
                          ).toFixed(2)}
                        </strong>
                      </Td>

                      <Td>
                        £
                        {Number(
                          product.selling_price || 0
                        ).toFixed(2)}
                      </Td>

                      <Td>
                        {product.track_stock
                          ? currentStock
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
                            {lowStockLevel}
                            {isLowStock
                              ? " — LOW"
                              : ""}
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
                        {product.active
                          ? "Active"
                          : "Inactive"}
                      </Td>

                      {isAdmin && (
                        <Td>
                          <div
                            style={{
                              display: "flex",
                              gap: "8px",
                              alignItems: "center",
                            }}
                          >
                            <Link
                              href={`/products/edit/${product.product_id}`}
                              style={{
                                display: "inline-block",
                                padding: "8px 11px",
                                border: "1px solid var(--line-strong)",
                                borderRadius: "7px",
                                color: "var(--ink)",
                                textDecoration: "none",
                                fontWeight: "600",
                                whiteSpace: "nowrap",
                              }}
                            >
                              Edit
                            </Link>

                            <Link
                              href={`/products/new?copy=${product.product_id}`}
                              style={{
                                display: "inline-block",
                                padding: "8px 11px",
                                border: "1px solid var(--line-strong)",
                                borderRadius: "7px",
                                color: "var(--ink)",
                                textDecoration: "none",
                                fontWeight: "600",
                                whiteSpace: "nowrap",
                              }}
                            >
                              + Add Variant
                            </Link>
                          </div>
                        </Td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div
          style={{
            marginTop: "16px",
            color: "var(--muted)",
            fontSize: "13px",
          }}
        >
          Stock Value is calculated using Stock Cost only.
          Potential Sales Value is current stock multiplied by
          the normal selling price. Total Cost includes production
          costs and is used for profitability.
        </div>
      </div>
    </main>
  );
}

function SummaryCard({ title, value }) {
  return (
    <div
      style={{ ...ui.card }}
    >
      <div
        style={{
          color: "var(--muted)",
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
