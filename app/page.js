export default function HomePage() {
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

        <p style={{ fontSize: "18px", color: "#666", marginBottom: "32px" }}>
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
          {[
            "Total Sales",
            "Gross Profit",
            "Net Profit",
            "Cash Balance",
          ].map((title) => (
            <div
              key={title}
              style={{
                background: "#fff",
                padding: "24px",
                borderRadius: "14px",
                boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
              }}
            >
              <div style={{ color: "#666", marginBottom: "10px" }}>{title}</div>
              <div style={{ fontSize: "30px", fontWeight: "700" }}>£0.00</div>
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
