"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabase";

// Fresh start date and shared settings. Returns {} until loaded, and keeps working if the row is missing.
export function useBusinessSettings() {
  const [settings, setSettings] = useState({ loaded: false });

  useEffect(() => {
    let alive = true;
    supabase
      .from("business_settings")
      .select("fresh_start_date, fresh_start_completed_at, square_account_id, delivery_product_id")
      .eq("id", true)
      .maybeSingle()
      .then(({ data }) => {
        if (alive) setSettings({ ...(data || {}), loaded: true });
      });
    return () => {
      alive = false;
    };
  }, []);

  return settings;
}
