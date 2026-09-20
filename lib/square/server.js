import { createClient } from "@supabase/supabase-js";

export class SquareError extends Error {
  constructor(message, status = 503) {
    super(message);
    this.status = status;
  }
}

export function reply(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" },
  });
}

function database(key, bearer, timeout = 12000) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !key) {
    throw new SquareError("The server database configuration is missing.");
  }

  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      ...(bearer ? { headers: { Authorization: bearer } } : {}),
      fetch: (url, options) => {
        const headers = new Headers(options?.headers);
        if (!bearer && key.startsWith("sb_secret_") && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        return fetch(url, { ...options, headers, cache: "no-store", signal: AbortSignal.timeout(timeout) });
      },
    },
  });
}

function serverKey() {
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!key) {
    throw new SquareError("Add SUPABASE_SECRET_KEY to the Production environment in Vercel, then redeploy.");
  }
  if (key.startsWith("sb_publishable_")) {
    throw new SquareError("SUPABASE_SECRET_KEY is a publishable key. Replace it with the Supabase secret key beginning sb_secret_.", 409);
  }
  return key;
}

export function serviceDatabase(timeout = 12000) {
  return database(serverKey(), null, timeout);
}

export async function requireAdmin(request) {
  const bearer = request.headers.get("authorization") || "";
  const match = /^Bearer ([^\s]+)$/i.exec(bearer);
  if (!match) throw new SquareError("Please sign in to manage Square payouts.", 401);

  const db = database(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, bearer);
  const { data, error } = await db.auth.getUser(match[1]);
  if (error || !data?.user) throw new SquareError("Please sign in again; your session could not be verified.", 401);

  const access = await db
    .from("app_users")
    .select("role, active")
    .eq("user_id", data.user.id)
    .maybeSingle();

  if (access.error || !access.data?.active || access.data.role !== "admin") {
    throw new SquareError("An approved admin account is required.", 403);
  }
}

function accessToken() {
  const token = process.env.SQUARE_ACCESS_TOKEN?.trim();
  if (!token) {
    throw new SquareError("Add SQUARE_ACCESS_TOKEN to the Production environment in Vercel, then redeploy.", 409);
  }
  return token;
}

export async function squareGet(path) {
  let response;
  try {
    response = await fetch(`https://connect.squareup.com/v2${path}`, {
      headers: {
        Authorization: `Bearer ${accessToken()}`,
        "Square-Version": "2026-09-16",
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new SquareError("Square could not be reached. Please try again.");
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || typeof payload !== "object") {
    if (response?.status === 401 || response?.status === 403) {
      throw new SquareError("Square denied access. Check that the Production Access Token in Vercel belongs to this Square account.", 409);
    }
    throw new SquareError(`Square returned HTTP ${response?.status || 503}. Please try again shortly.`);
  }
  return payload;
}

export function productionWebhookUrl() {
  if (process.env.VERCEL_ENV !== "production") {
    throw new SquareError("Square webhooks must be configured from the production dashboard.", 409);
  }
  const hostname = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (!hostname || !/^[A-Za-z0-9.-]+$/.test(hostname)) {
    throw new SquareError("Vercel's production domain setting is missing. Enable system environment variables and redeploy.", 409);
  }
  return `https://${hostname}/api/square/webhooks`;
}

export async function settings(db) {
  const result = await db.from("square_import_settings").select("*").eq("id", true).single();
  if (result.error || !result.data) {
    throw new SquareError("The Square payout settings could not be read. Check the database setup and server key.", 409);
  }
  return result.data;
}
