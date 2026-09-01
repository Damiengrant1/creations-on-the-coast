import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

export default async function HomePage() {
  // Load sales totals
  const { data: salesData, error: salesError } = await supabase
    .from("sale_totals")
    .select("total_sales, gross_profit");

  // Load expenses
  const { data: expensesData, error: expensesError } =
    await supabase.from("expenses").select("amount");

  // Load account balances
  const { data: accountData, error: accountError } =
    await supabase
      .from("account_balances")
      .select("current_balance");

  if (salesError) {
    console.error("Sales error:", salesError);
  }

  if (expensesError) {
    console.error("Expenses error:", expensesError);
  }

  if (accountError) {
    console.error("Account balance error:", accountError);
  }

  const totalSales = (salesData || []).reduce(
    (sum, row) => sum + Number(row.total_sales || 0),
    0
  );

  const grossProfit = (salesData || []).reduce(
    (sum, row) => sum + Number(row.gross_profit || 0),
    0
  );

  const totalExpenses = (expensesData || []).reduce(
    (sum, row) => sum + Number(row.amount || 0),
    0
  );

  const netProfit = grossProfit - totalExpenses;

  const cashBalance = (accountData || []).reduce(
    (sum, row) => sum + Number(row.current_balance || 0),
    0
  );

  const buttons = [
    {
      label: "Record Sale",
      href: "/record-sale",
    },
    {
      label: "Products & Stock",
      href: "/products",
    },
    {
      label: "Stock Purchases",
      href: "#",
    },
    {
      label: "Events",
      href: "#",
    },
    {
      label: "Expenses",
      href: "#",
    },
    {
      label: "Cash Flow",
      href: "#",
    },
    {
      label: "Reports",
      href: "#",
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
          maxWidth: "1200px",
          margin: "0 auto",
        }}
      >
        <div style={{ marginBottom: "32px" }}>
          <h1
            style={{
              fontSize: "40px",
              margin: "0 0 8px 0",
            }}
          >
            Creations on the Coast
          </h1>

          <p
            style={{
              color: "#666",
              fontSize: "17px",
              margin: 0,
            }}
          >
            Business Dashboard
          </p>
        </div>

        {/* Financial summary */}

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(200px, 1fr))",
            gap: "16px",
            marginBottom: "32px",
          }}
        >
          <SummaryCard
            title="Total Sales"
            value={`£${totalSales.toFixed(2)}`}
          />

          <SummaryCard
            title="Gross Profit"
            value={`£${grossProfit.toFixed(2)}`}
          />

          <SummaryCard
            title="Expenses"
            value={`£${totalExpenses.toFixed(2)}`}
          />

          <SummaryCard
            title="Net Profit"
            value={`£${netProfit.toFixed(2)}`}
          />

          <SummaryCard
            title="Cash Balance"
            value={`£${cashBalance.toFixed(2)}`}
          />
        </div>

        {/* Navigation */}

        <div
          style={{
            background: "#fff",
            padding: "28px",
            borderRadius: "14px",
            boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
          }}
        >
          <h2
            style={{
              marginTop: 0,
              marginBottom: "20px",
              fontSize: "24px",
            }}
          >
            Business Management
          </h2>

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "14px",
            }}
          >
            {buttons.map((button) => {
              const isActive = button.href !== "#";

              if (!isActive) {
                return (
                  <div
                    key={button.label}
                    style={{
                      padding: "16px",
                      borderRadius: "9px",
                      background: "#f2f2f2",
                      color: "#888",
                      textAlign: "center",
                      fontWeight: "600",
                      cursor: "default",
                    }}
                  >
                    {button.label}
                  </div>
                );
              }

              return (
                <Link
                  key={button.label}
                  href={button.href}
                  style={{
                    padding: "16px",
                    borderRadius: "9px",
                    background: "#111",
                    color: "#fff",
                    textAlign: "center",
                    textDecoration: "none",
                    fontWeight: "700",
                  }}
                >
                  {button.label}
                </Link>
              );
            })}
          </div>
        </div>

        <div
          style={{
            marginTop: "18px",
            color: "#777",
            fontSize: "13px",
            textAlign: "center",
          }}
        >
          Creations on the Coast Ltd
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
          fontSize: "14px",
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
