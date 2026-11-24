"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import ui from "../../lib/ui";

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
        <div style={badgeStyle}>CC</div>
        <h1 style={{ margin: "0 0 7px", fontSize: "30px" }}>Creations on the Coast</h1>
        <p style={{ color: "var(--muted)", margin: "0 0 26px" }}>Orders, stock and sales. Sign in to get started.</p>
        {message && <div style={errorStyle}>{message}</div>}
        <label style={labelStyle}>Email address</label>
        <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} style={fieldStyle} required />
        <label style={{ ...labelStyle, marginTop: "17px" }}>Password</label>
        <input type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} style={fieldStyle} required />
        <label style={showStyle}>
          <input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} />
          Show password
        </label>
        <button type="submit" disabled={loading} style={buttonStyle}>{loading ? "Signing in…" : "Sign in"}</button>
      </form>
    </main>
  );
}

const pageStyle = { minHeight: "100vh", background: "linear-gradient(180deg, var(--ink) 0%, var(--ink) 38%, var(--sand) 38%)", display: "grid", placeItems: "center", padding: "24px", fontFamily: "var(--font)" };
const cardStyle = { width: "100%", maxWidth: "420px", boxSizing: "border-box", background: "#fff", padding: "34px", borderRadius: "18px", boxShadow: "0 10px 40px rgba(18,50,74,0.18)", textAlign: "center" };
const badgeStyle = { width: "58px", height: "58px", margin: "0 auto 18px", borderRadius: "16px", display: "grid", placeItems: "center", background: "linear-gradient(160deg, #3bb3ae 0%, #1d8a8a 55%, #f2b43c 56%, #f2b43c 100%)", color: "#fff", fontSize: "20px", fontWeight: "800" };
const labelStyle = { ...ui.label, textAlign: "left" };
const fieldStyle = ui.field;
const showStyle = { display: "flex", alignItems: "center", gap: "7px", marginTop: "11px", color: "var(--muted)", fontSize: "14px", textAlign: "left" };
const buttonStyle = { ...ui.primary, width: "100%", marginTop: "23px" };
const errorStyle = { ...ui.error, textAlign: "left" };
