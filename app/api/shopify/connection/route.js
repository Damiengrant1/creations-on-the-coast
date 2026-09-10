import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Verified against the connected Creations on the Coast store.
// These identifiers are public configuration, never credentials.
const SHOP_DOMAIN = "ku1cvy-ue.myshopify.com";
const SHOP_ID = "gid://shopify/Shop/95483199837";
const API_VERSION = "2026-07";
const REQUIRED_SCOPES = [
  "read_orders",
  "read_products",
  "read_shopify_payments_payouts",
];
const CONNECTION_QUERY = `
  query DashboardShopifyConnection {
    shop { id name myshopifyDomain currencyCode ianaTimezone }
    currentAppInstallation { accessScopes { handle } }
  }
`;

// Short-lived Shopify tokens stay in this server process only.
let cachedToken = null;
let pendingToken = null;

class ConnectionError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

function reply(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Vary: "Authorization",
    },
  });
}

async function shopifyFetch(path, options) {
  try {
    return await fetch(`https://${SHOP_DOMAIN}${path}`, {
      ...options,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new ConnectionError("Shopify could not be reached. Please try again.", 503);
  }
}

async function requestToken(clientId, clientSecret) {
  const response = await shopifyFetch("/admin/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (response.status === 429 || response.status >= 500) {
    throw new ConnectionError("Shopify is temporarily busy. Please try again shortly.", 503);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (data?.error === "invalid_client") {
      throw new ConnectionError(
        "Shopify rejected the app credentials. Check that SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET in Vercel match the same Shopify app, then redeploy.",
        409
      );
    }
    throw new ConnectionError(
      "Shopify did not authorise this app. Check that Creations on the Coast Dash is installed on this store and belongs to the same Shopify organisation.",
      409
    );
  }

  if (typeof data?.access_token !== "string" || !data.access_token ||
      !Number.isFinite(data.expires_in) || data.expires_in <= 60) {
    throw new ConnectionError("Shopify returned an incomplete authentication response. Please try again.");
  }
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return cachedToken.value;
}

async function getToken(clientId, clientSecret) {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  if (!pendingToken) {
    pendingToken = requestToken(clientId, clientSecret).finally(() => {
      pendingToken = null;
    });
  }
  return pendingToken;
}

export async function POST(request) {
  // Validate authentication and approved admin access BEFORE touching Shopify.
  const bearer = request.headers.get("authorization") || "";
  const match = /^Bearer ([^\s]+)$/i.exec(bearer);
  if (!match) return reply({ error: "Please sign in to check the Shopify connection." }, 401);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return reply({ error: "The dashboard sign-in configuration is missing in Vercel." }, 503);
  }

  try {
    // Use the caller's JWT and the publishable key so existing RLS still applies.
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        headers: { Authorization: bearer },
        fetch: (url, options) => fetch(url, {
          ...options, cache: "no-store", signal: AbortSignal.timeout(8000),
        }),
      },
    });
    const { data: userData, error: userError } = await supabase.auth.getUser(match[1]);
    if (userError || !userData?.user) {
      return reply({ error: "Your sign-in could not be verified. Please sign in again." }, 401);
    }

    const { data: access, error: accessError } = await supabase
      .from("app_users")
      .select("role, active")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (accessError) {
      return reply({ error: "Could not check your admin access. Please try again." }, 503);
    }
    if (access?.role !== "admin" || access.active !== true) {
      return reply({ error: "An approved admin account is required to access Shopify." }, 403);
    }

    const clientId = process.env.SHOPIFY_CLIENT_ID?.trim();
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET?.trim();
    const missing = [!clientId && "SHOPIFY_CLIENT_ID", !clientSecret && "SHOPIFY_CLIENT_SECRET"].filter(Boolean);
    if (missing.length) {
      return reply({ error: `Missing ${missing.join(" and ")} in Vercel. Save the variable(s) for Production, then redeploy.` }, 503);
    }

    let token = await getToken(clientId, clientSecret);
    const queryShop = (accessToken) => shopifyFetch(`/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
      body: JSON.stringify({ query: CONNECTION_QUERY }),
    });
    let response = await queryShop(token);
    if (response.status === 401) {
      // A cached token can be revoked before its normal expiry. Retry once.
      cachedToken = null;
      token = await getToken(clientId, clientSecret);
      response = await queryShop(token);
    }
    if (response.status === 429 || response.status >= 500) {
      throw new ConnectionError("Shopify is temporarily busy. Please try again shortly.", 503);
    }
    if (response.status === 401 || response.status === 403) {
      throw new ConnectionError("Shopify denied access. Check the app installation and its approved permissions.", 409);
    }
    if (!response.ok) throw new ConnectionError(`Shopify returned HTTP ${response.status}. Please try again.`);

    const result = await response.json().catch(() => null);
    if (result?.errors?.length) {
      const denied = result.errors.some((error) => error.extensions?.code === "ACCESS_DENIED");
      throw new ConnectionError(denied
        ? "Shopify denied the connection check. Check the app's approved permissions."
        : "Shopify could not complete the connection check. Please try again.");
    }

    const shop = result?.data?.shop;
    const scopes = result?.data?.currentAppInstallation?.accessScopes;
    if (!shop || !Array.isArray(scopes)) {
      throw new ConnectionError("Shopify returned an incomplete connection response. Please try again.");
    }
    if (shop.id !== SHOP_ID || shop.myshopifyDomain !== SHOP_DOMAIN) {
      throw new ConnectionError("The connection returned a different Shopify store. Please check the app installation.", 409);
    }

    const handles = new Set(scopes.map((scope) => scope.handle));
    const permissions = REQUIRED_SCOPES.map((scope) => ({
      scope,
      granted: handles.has(scope) || handles.has(scope.replace(/^read_/, "write_")),
    }));
    return reply({
      connected: true,
      permissionsReady: permissions.every((permission) => permission.granted),
      shop: { name: shop.name.trim(), domain: shop.myshopifyDomain, currency: shop.currencyCode, timezone: shop.ianaTimezone },
      permissions,
      checkedAt: new Date().toISOString(),
      importsEnabled: false,
    });
  } catch (error) {
    // Never return upstream response bodies, credentials, tokens, or stack traces.
    return reply({ error: error instanceof ConnectionError ? error.message : "Could not complete the connection check. Please try again." },
      error instanceof ConnectionError ? error.status : 503);
  }
}
