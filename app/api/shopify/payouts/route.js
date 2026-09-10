import { ImportError, reply, requireAdmin, serviceDatabase, settings, shopifyRest } from "../../../../lib/shopify/server";
import { SHOP_DOMAIN } from "../../../../lib/shopify/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const API_VERSION = "2026-07";

function fail(error) {
  return reply(
    {
      error:
        error instanceof ImportError
          ? error.message
          : "The Shopify payout request could not be completed. Please try again.",
    },
    error instanceof ImportError ? error.status : 503
  );
}

function amount(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) throw new ImportError("Shopify returned an invalid payout amount.");
  return Math.round(parsed * 100) / 100;
}

function sameMoney(left, right) {
  return Math.abs(amount(left) - amount(right)) < 0.02;
}

function payoutDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ImportError("Shopify returned an invalid payout date.");
  return date.toISOString();
}

async function getAccounts(db, cfg) {
  const { data, error } = await db
    .from("accounts")
    .select("id, account_name, account_type")
    .eq("active", true)
    .in("account_type", ["shopify", "bank"]);

  if (error) throw new ImportError("Could not load the Shopify Payments and bank accounts.");

  const shopify = data?.find((account) => account.id === cfg.account_id);
  const banks = (data || []).filter((account) => account.account_type === "bank");

  if (!shopify || shopify.account_type !== "shopify") {
    throw new ImportError("The Shopify Payments account is not configured correctly.");
  }
  if (banks.length !== 1) {
    throw new ImportError("Exactly one active bank account is required before Shopify payouts can be imported.");
  }

  return { shopify, bank: banks[0] };
}

async function saveReview(db, payout, detail, payoutData) {
  const { error } = await db.from("shopify_payout_imports").upsert(
    {
      payout_id: String(payout.id),
      shop_domain: SHOP_DOMAIN,
      payout_date: payoutDate(payout.date),
      gross_amount: null,
      fee_amount: null,
      net_amount: amount(payout.amount),
      currency: String(payout.currency || "GBP"),
      status: "needs_review",
      detail,
      payout_data: payoutData,
    },
    { onConflict: "payout_id", ignoreDuplicates: true }
  );

  if (error) throw new ImportError("Could not save a Shopify payout for review.");
}

async function importOnePayout(db, payout, accounts) {
  const payoutId = String(payout?.id || "");
  if (!payoutId || !payout.date || payout.amount === undefined) {
    throw new ImportError("Shopify returned an incomplete payout.");
  }

  if (String(payout.status || "").toLowerCase() !== "paid") return { skipped: true };

  const existing = await db
    .from("shopify_payout_imports")
    .select("status")
    .eq("payout_id", payoutId)
    .maybeSingle();

  if (existing.error) throw new ImportError("Could not check existing Shopify payouts.");
  if (existing.data) return { duplicate: true, review: existing.data.status === "needs_review" };

  const transactions = await shopifyRest(
    `/shopify_payments/balance/transactions.json?payout_id=${encodeURIComponent(payoutId)}&limit=250`
  );
  const rows = Array.isArray(transactions.transactions) ? transactions.transactions : null;

  if (!rows || rows.length === 0) {
    await saveReview(db, payout, "Shopify provided no balance transactions for this paid payout.", { payout, transactions });
    return { review: true };
  }

  const types = [...new Set(rows.map((row) => String(row.type || "unknown").toLowerCase()))];
  const gross = rows.reduce((sum, row) => sum + amount(row.amount), 0);
  const fees = rows.reduce((sum, row) => sum + Math.abs(amount(row.fee)), 0);
  const net = rows.reduce((sum, row) => sum + amount(row.net), 0);
  const payoutAmount = amount(payout.amount);
  const currency = String(payout.currency || "GBP").toUpperCase();
  const simpleChargesOnly = types.every((type) => type === "charge");

  if (
    currency !== "GBP" ||
    !simpleChargesOnly ||
    gross <= 0 ||
    fees < 0 ||
    !sameMoney(gross - fees, net) ||
    !sameMoney(net, payoutAmount)
  ) {
    await saveReview(
      db,
      payout,
      `Needs review: transaction types ${types.join(", ")}; gross £${gross.toFixed(2)}, fees £${fees.toFixed(2)}, net £${net.toFixed(2)}, payout £${payoutAmount.toFixed(2)}.`,
      { payout, transactions }
    );
    return { review: true };
  }

  const { data, error } = await db.rpc("record_shopify_payout", {
    p_payout_id: payoutId,
    p_shop_domain: SHOP_DOMAIN,
    p_payout_date: payoutDate(payout.date),
    p_gross_amount: gross,
    p_fee_amount: fees,
    p_net_amount: payoutAmount,
    p_currency: currency,
    p_from_account_id: accounts.shopify.id,
    p_to_account_id: accounts.bank.id,
    p_payout_data: { payout, transactions },
  });

  if (error || !data) throw new ImportError("Could not record a Shopify payout in the accounts.");
  return { imported: !data.already_recorded, duplicate: Boolean(data.already_recorded) };
}

async function syncPayouts(db) {
  const cfg = await settings(db);
  if (!cfg.payouts_enabled || !cfg.payout_start_at) {
    throw new ImportError("Enable Shopify payout tracking before importing payouts.", 409);
  }

  const accounts = await getAccounts(db, cfg);
  const startDate = new Date(cfg.payout_start_at).toISOString().slice(0, 10);
  const response = await shopifyRest(
    `/shopify_payments/payouts.json?status=paid&date_min=${encodeURIComponent(startDate)}&limit=250`
  );
  const payouts = Array.isArray(response.payouts) ? response.payouts : null;
  if (!payouts) throw new ImportError("Shopify returned an incomplete payout list.");

  const summary = { imported: 0, review: 0, duplicate: 0, skipped: 0 };
  for (const payout of payouts) {
    const result = await importOnePayout(db, payout, accounts);
    if (result.imported) summary.imported += 1;
    if (result.review) summary.review += 1;
    if (result.duplicate) summary.duplicate += 1;
    if (result.skipped) summary.skipped += 1;
  }

  const { error } = await db
    .from("shopify_import_settings")
    .update({ payout_last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("shop_domain", SHOP_DOMAIN);
  if (error) throw new ImportError("Payouts were checked, but the sync time could not be saved.");

  return { cfg, accounts, summary };
}

async function status(db) {
  const cfg = await settings(db);
  const [{ data: payouts, error: payoutError }, accounts] = await Promise.all([
    db
      .from("shopify_payout_imports")
      .select("payout_id, payout_date, gross_amount, fee_amount, net_amount, currency, status, detail, transfer_id, imported_at")
      .order("payout_date", { ascending: false })
      .limit(100),
    getAccounts(db, cfg),
  ]);
  if (payoutError) throw new ImportError("Could not load the Shopify payout history.");
  return { settings: cfg, payouts: payouts || [], accounts };
}

function hasCronAccess(request) {
  const secret = process.env.CRON_SECRET?.trim();
  const provided = request.headers.get("authorization") || "";
  return Boolean(secret && provided === `Bearer ${secret}`);
}

export async function GET(request) {
  try {
    if (new URL(request.url).searchParams.get("cron") === "1") {
      if (!hasCronAccess(request)) return new Response("Unauthorized", { status: 401 });
      const result = await syncPayouts(serviceDatabase());
      return Response.json(result.summary, { headers: { "Cache-Control": "no-store" } });
    }

    const db = await requireAdmin(request);
    return reply(await status(db));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request) {
  try {
    await requireAdmin(request);
    const input = await request.json().catch(() => null);
    if (!input || !["enable", "sync"].includes(input.action)) {
      throw new ImportError("Unknown Shopify payout action.", 400);
    }

    const db = serviceDatabase();
    if (input.action === "enable") {
      const cfg = await settings(db);
      await getAccounts(db, cfg);
      const { error } = await db
        .from("shopify_import_settings")
        .update({
          payouts_enabled: true,
          payout_start_at: new Date().toISOString(),
          payout_last_sync_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("shop_domain", SHOP_DOMAIN);
      if (error) throw new ImportError("Could not enable Shopify payout tracking.");
      return reply({ message: "Shopify payout tracking is enabled. Only payouts paid from now on will be imported." });
    }

    const result = await syncPayouts(db);
    return reply({
      message: `Payout check complete: ${result.summary.imported} imported, ${result.summary.review} need review, ${result.summary.duplicate} already recorded.`,
      ...result,
    });
  } catch (error) {
    return fail(error);
  }
}
