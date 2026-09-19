"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";

const AccessContext = createContext({ role: null, isAdmin: false });
const ACCESS_CACHE_KEY = "creations-access-cache-v1";

export function useAccess() {
  return useContext(AccessContext);
}

const accountabilityRoutes = new Set(["/", "/jobs", "/jobs/stock-order", "/products", "/event-pos"]);

export default function AuthGate({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [access, setAccess] = useState(null);
  const [checking, setChecking] = useState(true);
  const isLoginPage = pathname === "/login";

  useEffect(() => {
    let mounted = true;

    function cachedAccessFor(userId) {
      try {
        const cached = JSON.parse(window.localStorage.getItem(ACCESS_CACHE_KEY) || "null");
        return cached?.userId === userId && cached?.active ? cached : null;
      } catch {
        return null;
      }
    }

    async function loadAccess(nextSession) {
      if (!nextSession) {
        if (mounted) {
          setSession(null);
          setAccess(null);
          setChecking(false);
          if (!isLoginPage) router.replace("/login");
        }
        return;
      }

      const { data, error } = await supabase
        .from("app_users")
        .select("role, active")
        .eq("user_id", nextSession.user.id)
        .maybeSingle();

      if (!mounted) return;

      const cachedAccess = error && !navigator.onLine ? cachedAccessFor(nextSession.user.id) : null;
      const nextAccess = !error && data?.active ? data : cachedAccess;
      if (!error && data?.active) {
        window.localStorage.setItem(ACCESS_CACHE_KEY, JSON.stringify({
          userId: nextSession.user.id,
          role: data.role,
          active: true,
        }));
      }

      setSession(nextSession);
      setAccess(nextAccess);
      setChecking(false);

      if (isLoginPage) router.replace("/");
    }

    async function restoreSession() {
      const { data, error } = await supabase.auth.getSession();

      if (!mounted) return;

      if (error) {
        setSession(null);
        setAccess(null);
        setChecking(false);
        if (!isLoginPage) router.replace("/login");
        return;
      }

      await loadAccess(data.session);
    }

    restoreSession();

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        if (!mounted) return;
        setChecking(true);
        loadAccess(nextSession);
      }
    );

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [isLoginPage, router]);

  useEffect(() => {
    if (
      !isLoginPage &&
      access?.role === "accountability" &&
      !accountabilityRoutes.has(pathname)
    ) {
      router.replace("/");
    }
  }, [access, isLoginPage, pathname, router]);

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (isLoginPage) return children;

  if (checking || !session) {
    return (
      <main style={loadingStyle}>
        <div style={loadingCardStyle}>Checking secure access...</div>
      </main>
    );
  }

  if (!access) {
    return (
      <main style={loadingStyle}>
        <div style={loadingCardStyle}>
          <div style={{ marginBottom: "12px" }}>This account has not been given access yet.</div>
          <button type="button" onClick={signOut} style={accessButtonStyle}>
            Sign Out
          </button>
        </div>
      </main>
    );
  }

  const contextValue = { role: access.role, isAdmin: access.role === "admin" };

  return (
    <AccessContext.Provider value={contextValue}>
      <button type="button" onClick={signOut} style={signOutStyle}>
        Sign Out
      </button>
      {children}
    </AccessContext.Provider>
  );
}

const loadingStyle = {
  minHeight: "100vh",
  background: "#f7f7f8",
  display: "grid",
  placeItems: "center",
  padding: "20px",
  fontFamily: "Arial, sans-serif",
};

const loadingCardStyle = {
  background: "#fff",
  padding: "28px",
  borderRadius: "12px",
  boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
  fontWeight: "700",
  textAlign: "center",
};

const signOutStyle = {
  position: "fixed",
  top: "14px",
  right: "14px",
  zIndex: 1000,
  border: "1px solid #ccc",
  borderRadius: "8px",
  background: "#fff",
  color: "#111",
  padding: "9px 13px",
  fontWeight: "700",
  cursor: "pointer",
  boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
};

const accessButtonStyle = {
  border: 0,
  borderRadius: "8px",
  background: "#111",
  color: "#fff",
  padding: "10px 14px",
  fontWeight: "700",
  cursor: "pointer",
};
