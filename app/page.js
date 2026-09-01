import { supabase } from "../lib/supabase";

export const dynamic = "force-dynamic";

async function getDashboardData() {
  const { data: salesData, error: salesError } = await supabase
    .from("sale_totals")
    .select("total_sales,gross_profit");

  if (salesError) {
    console.error("Sales dashboard error:", salesError);
  }

  const totalSales =
    salesData?.reduce(
      (total, sale) => total + Number(sale.total_sales || 0),
      0
    ) || 0;

  const grossProfit =
    salesData?.reduce(
      (total, sale) => total + Number(sale.gross_profit || 0),
      0
    ) || 0;

  return {
    totalSales,
    grossProfit,
  };
}

export default async function HomePage() {
  const { totalSales, grossProfit } = await getDashboardData();

  const dashboardCards = [
    {
      title: "Total Sales",
      value: `£${totalSales.toFixed(2)}`,
    },
    {
      title: "Gross Profit",
      value: `£${grossProfit.toFixed(2)}`,
    },
    {
      title: "Net Profit",
      value: "£0.00",
    },
    {
      title: "Cash Balance",
      value: "£0.00",
    },
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
        <h1 style={{ fontSize: "42px", marginBottom: "8px" }}>
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
          {dashboardCards.map((card) => (
            <div
              key={card.title}
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
                {card.title}
              </div>

              <div
                style={{
                  fontSize: "30px",
                  fontWeight: "700",
                }}
              >
                {card.value}
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
          {[
            "Record Sale",
            "Products & Stock",
            "Stock Purchases",
            "Events",
            "Expenses",
            "Cash Flow",
            "Reports",
          ].map((label) => (
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
