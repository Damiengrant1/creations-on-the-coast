"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

export default function AuthGate({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);
  const isLoginPage = pathname === "/login";

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setChecking(false);
      if (!data.session && !isLoginPage) router.replace("/login");
      if (data.session && isLoginPage) router.replace("/");
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setChecking(false);
      if (!nextSession && !isLoginPage) router.replace("/login");
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [isLoginPage, router]);

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (isLoginPage) return children;

  if (checking || !session) {
    return <main style={loadingStyle}><div style={loadingCardStyle}>Checking secure access...</div></main>;
  }

  return (
    <>
      <button type="button" onClick={signOut} style={signOutStyle}>Sign Out</button>
      {children}
    </>
  );
}

const loadingStyle = { minHeight: "100vh", background: "#f7f7f8", display: "grid", placeItems: "center", padding: "20px", fontFamily: "Arial, sans-serif" };
const loadingCardStyle = { background: "#fff", padding: "28px", borderRadius: "12px", boxShadow: "0 2px 10px rgba(0,0,0,0.06)", fontWeight: "700" };
const signOutStyle = { position: "fixed", top: "14px", right: "14px", zIndex: 1000, border: "1px solid #ccc", borderRadius: "8px", background: "#fff", color: "#111", padding: "9px 13px", fontWeight: "700", cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.08)" };
