"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });

    if (error) {
      setMessage(error.message === "Invalid login credentials" ? "The email address or password is incorrect." : error.message);
      setLoading(false);
      return;
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <main style={pageStyle}>
      <form onSubmit={handleSubmit} style={cardStyle}>
        <div style={badgeStyle}>C</div>
        <h1 style={{ margin: "0 0 7px", fontSize: "30px" }}>Creations on the Coast</h1>
        <p style={{ color: "#666", margin: "0 0 26px" }}>Sign in to the business management system.</p>
        {message && <div style={errorStyle}>{message}</div>}
        <label style={labelStyle}>Email address</label>
        <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} style={fieldStyle} required />
        <label style={{ ...labelStyle, marginTop: "17px" }}>Password</label>
        <input type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} style={fieldStyle} required />
        <label style={showStyle}>
          <input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} />
          Show password
        </label>
        <button type="submit" disabled={loading} style={buttonStyle}>{loading ? "Signing In..." : "Sign In"}</button>
      </form>
    </main>
  );
}

const pageStyle = { minHeight: "100vh", background: "#f7f7f8", display: "grid", placeItems: "center", padding: "24px", fontFamily: "Arial, sans-serif" };
const cardStyle = { width: "100%", maxWidth: "420px", boxSizing: "border-box", background: "#fff", padding: "34px", borderRadius: "16px", boxShadow: "0 4px 24px rgba(0,0,0,0.09)", textAlign: "center" };
const badgeStyle = { width: "54px", height: "54px", margin: "0 auto 18px", borderRadius: "50%", display: "grid", placeItems: "center", background: "#111", color: "#fff", fontSize: "26px", fontWeight: "700" };
const labelStyle = { display: "block", marginBottom: "7px", fontWeight: "700", textAlign: "left" };
const fieldStyle = { width: "100%", boxSizing: "border-box", padding: "13px", border: "1px solid #ccc", borderRadius: "8px", background: "#fff", fontSize: "16px" };
const showStyle = { display: "flex", alignItems: "center", gap: "7px", marginTop: "11px", color: "#555", fontSize: "14px", textAlign: "left" };
const buttonStyle = { width: "100%", marginTop: "23px", padding: "14px", border: "none", borderRadius: "8px", background: "#111", color: "#fff", fontSize: "16px", fontWeight: "700", cursor: "pointer" };
const errorStyle = { padding: "12px", marginBottom: "18px", borderRadius: "8px", background: "#fff0f0", border: "1px solid #f1c1c1", color: "#9b1c1c", textAlign: "left", fontWeight: "600" };
