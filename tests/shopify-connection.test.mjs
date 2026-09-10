import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../app/api/shopify/connection/route.js", import.meta.url), "utf8");
const scopes = ["read_orders", "read_products", "read_shopify_payments_payouts"];
const shop = { id: "gid://shopify/Shop/95483199837", name: "Creations on the Coast ", myshopifyDomain: "ku1cvy-ue.myshopify.com", currencyCode: "GBP", ianaTimezone: "Europe/London" };
const tokenReply = () => Response.json({ access_token: "TEST_SHOPIFY_TOKEN", expires_in: 86399 });
const shopReply = (permissions = scopes, store = shop) => Response.json({ data: { shop: store, currentAppInstallation: { accessScopes: permissions.map(handle => ({ handle })) } } });

async function harness({ userError = null, access = { role: "admin", active: true }, accessError = null, env = {}, replies = [tokenReply(), shopReply()] } = {}) {
  const calls = [];
  const userCalls = [];
  const context = vm.createContext({
    Response, URLSearchParams, AbortSignal,
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-publishable", SHOPIFY_CLIENT_ID: "TEST_ID", SHOPIFY_CLIENT_SECRET: "TEST_SECRET", ...env } },
    fetch: async (url, options) => {
      calls.push({ url, options });
      const response = replies.shift();
      assert.ok(response, "unexpected external request");
      return response;
    },
  });
  const supabase = new vm.SyntheticModule(["createClient"], function () {
    this.setExport("createClient", (_url, key, options) => {
      assert.equal(key, "test-publishable");
      assert.equal(options.global.headers.Authorization, "Bearer test-user-jwt");
      return {
        auth: { getUser: async (jwt) => { userCalls.push(jwt); return { data: { user: userError ? null : { id: "verified-user" } }, error: userError }; } },
        from(table) {
          assert.equal(table, "app_users");
          return { select() { return this; }, eq(column, value) { assert.equal(column, "user_id"); assert.equal(value, "verified-user"); return this; }, maybeSingle: async () => ({ data: access, error: accessError }) };
        },
      };
    });
  }, { context });
  const module = new vm.SourceTextModule(source, { context });
  await module.link(() => supabase);
  await module.evaluate();
  return { calls, userCalls, post: (signedIn = true) => module.namespace.POST(new Request("https://dashboard.test/api/shopify/connection", { method: "POST", headers: signedIn ? { Authorization: "Bearer test-user-jwt" } : {} })) };
}

test("rejects unauthenticated and invalid sessions before any Shopify call", async () => {
  const anonymous = await harness();
  assert.equal((await anonymous.post(false)).status, 401);
  assert.equal(anonymous.calls.length, 0);
  assert.equal(anonymous.userCalls.length, 0);
  const invalid = await harness({ userError: { message: "expired JWT" } });
  assert.equal((await invalid.post()).status, 401);
  assert.equal(invalid.calls.length, 0);
});

test("rejects inactive, non-admin, and unapproved users; fails closed on access lookup errors", async () => {
  for (const access of [null, { role: "admin", active: false }, { role: "viewer", active: true }]) {
    const h = await harness({ access });
    assert.equal((await h.post()).status, 403);
    assert.equal(h.calls.length, 0);
  }
  const h = await harness({ accessError: { message: "database unavailable" } });
  assert.equal((await h.post()).status, 503);
  assert.equal(h.calls.length, 0);
});

test("reports missing configuration only after verifying the admin", async () => {
  const h = await harness({ env: { SHOPIFY_CLIENT_SECRET: "" } });
  const response = await h.post();
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /SHOPIFY_CLIENT_SECRET/);
  assert.equal(h.calls.length, 0);
});

test("checks the pinned store, returns safe fields, and reuses the server token", async () => {
  const h = await harness({ replies: [tokenReply(), shopReply(), shopReply()] });
  const response = await h.post();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(response.headers.get("vary"), "Authorization");
  const body = await response.text();
  assert.doesNotMatch(body, /TEST_SECRET|TEST_SHOPIFY_TOKEN|TEST_ID|test-user-jwt/);
  const data = JSON.parse(body);
  assert.equal(data.connected, true);
  assert.equal(data.permissionsReady, true);
  assert.equal(data.importsEnabled, false);
  assert.equal(data.shop.name, "Creations on the Coast");
  assert.equal(h.calls[0].url, "https://ku1cvy-ue.myshopify.com/admin/oauth/access_token");
  assert.equal(h.calls[0].options.body.get("grant_type"), "client_credentials");
  assert.equal(h.calls[0].options.body.get("client_secret"), "TEST_SECRET");
  assert.equal(h.calls[1].options.headers["X-Shopify-Access-Token"], "TEST_SHOPIFY_TOKEN");
  assert.equal(h.calls[1].options.redirect, "error");
  assert.match(JSON.parse(h.calls[1].options.body).query, /query DashboardShopifyConnection/);
  assert.doesNotMatch(JSON.parse(h.calls[1].options.body).query, /mutation/);
  assert.equal((await h.post()).status, 200);
  assert.equal(h.calls.length, 3);
  assert.equal(h.userCalls.length, 2);
});

test("reports missing permissions and rejects a different store", async () => {
  const missing = await harness({ replies: [tokenReply(), shopReply(["read_orders"])] });
  const body = await (await missing.post()).json();
  assert.equal(body.connected, true);
  assert.equal(body.permissionsReady, false);
  assert.equal(body.permissions.find(p => p.scope === "read_products").granted, false);
  const wrong = await harness({ replies: [tokenReply(), shopReply(scopes, { ...shop, id: "another-store" })] });
  assert.equal((await wrong.post()).status, 409);
});

test("refreshes a revoked token once, without retrying forever", async () => {
  const h = await harness({ replies: [tokenReply(), new Response(null, { status: 401 }), tokenReply(), new Response(null, { status: 401 })] });
  assert.equal((await h.post()).status, 409);
  assert.equal(h.calls.length, 4);
});

test("never exposes secrets from upstream failures or partial GraphQL errors", async () => {
  const rejected = await harness({ replies: [Response.json({ error: "invalid_client", error_description: "TEST_SECRET" }, { status: 401 })] });
  const response = await rejected.post();
  assert.equal(response.status, 409);
  assert.doesNotMatch(await response.text(), /TEST_SECRET/);
  const partial = await harness({ replies: [tokenReply(), Response.json({ data: { shop }, errors: [{ message: "TEST_SECRET", extensions: { code: "ACCESS_DENIED" } }] })] });
  const failure = await partial.post();
  assert.equal(failure.status, 502);
  assert.doesNotMatch(await failure.text(), /TEST_SECRET/);
});
