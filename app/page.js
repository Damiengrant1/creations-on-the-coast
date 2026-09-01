import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

async function getDashboardData() {
  const { data: sales, error } = await supabase
    .from("sale_totals")
    .select("total_sales, gross_profit");

  if (error) {
    console.error("Supabase error:", error);
    return {
      totalSales: 0,
      grossProfit: 0,
    };
  }

  const totalSales = sales.reduce(
    (sum, sale) => sum + Number(sale.total_sales || 0),
    0
  );

  const grossProfit = sales.reduce(
    (sum, sale) => sum + Number(sale.gross_profit || 0),
    0
  );

  return {
    totalSales,
    grossProfit,
  };
}

export default async function HomePage() {
  const { totalSales, grossProfit } = await getDashboardData();

  const cards = [
    ["Total Sales", `£${totalSales.toFixed(2)}`],
    ["Gross Profit", `£${grossProfit.toFixed(2)}`],
    ["Net Profit", "£0.00"],
    ["Cash Balance", "£0.00"],
  ];

  const buttons = [
    "Record Sale",
    "Products & Stock",
    "Stock Purchases",
    "Events",
    "Expenses",
    "Cash Flow",
    "Reports",
  ];

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
          maxWidth: "1100px",
          margin: "0 auto",
        }}
      >
        <h1
          style={{
            fontSize: "42px",
            marginBottom: "8px",
          }}
        >
          Creations on the Coast
        </h1>

        <p
          style={{
            fontSize: "18px",
            color: "#666",
            marginBottom: "32px",
          }}
        >
          Business Management Dashboard
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "16px",
            marginBottom: "32px",
          }}
        >
          {cards.map(([title, value]) => (
            <div
              key={title}
              style={{
                background: "#fff",
                padding: "24px",
                borderRadius: "14px",
                boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
              }}
            >
              <div
                style={{
                  color: "#666",
                  marginBottom: "10px",
                }}
              >
                {title}
              </div>

              <div
                style={{
                  fontSize: "30px",
                  fontWeight: "700",
                }}
              >
                {value}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "12px",
          }}
        >
          {buttons.map((label) => (
            <button
              key={label}
              style={{
                padding: "16px",
                borderRadius: "10px",
                border: "1px solid #ddd",
                background: "#fff",
                fontWeight: "600",
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}
