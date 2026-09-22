import { SquareError, reply, requireAdmin, serviceDatabase, settings, squareGet } from "../../../../lib/square/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function fail(error) {
  return reply(
    { error: error instanceof SquareError ? error.message : "The Square payout request could not be completed. Please try again." },
    error instanceof SquareError ? error.status : 503
  );
}

function pounds(money) {
  const value = Number(money?.amount);
  if (!Number.isSafeInteger(value)) throw new SquareError("Square returned an invalid money amount.");
  return Math.round(value) / 100;
}

function payoutDate(payout) {
  const value = payout?.updated_at || payout?.created_at || payout?.arrival_date;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new SquareError("Square returned an invalid payout date.");
  return date.toISOString();
}

function sameMoney(left, right) {
  return Math.abs(Number(left) - Number(right)) < 0.02;
}

async function getAccounts(db, cfg) {
  const result = await db
    .from("accounts")
    .select("id, account_name, account_type")
    .eq("active", true)
    .in("account_type", ["square", "bank"]);

  if (result.error) throw new SquareError("Could not load the Square and bank accounts.");
  const square = result.data?.find((account) => account.id === cfg.account_id);
  const banks = (result.data || []).filter((account) => account.account_type === "bank");

  if (!square || square.account_type !== "square") {
    throw new SquareError("The Square account is not configured correctly.", 409);
  }
  if (banks.length !== 1) {
    throw new SquareError("Exactly one active bank account is required before Square payouts can be imported.", 409);
  }
  return { square, bank: banks[0] };
}

async function entriesForPayout(payoutId) {
  const entries = [];
  let cursor = "";
  do {
    const params = new URLSearchParams({ limit: "100" });
    if (cursor) params.set("cursor", cursor);
    const response = await squareGet(`/payouts/${encodeURIComponent(payoutId)}/payout-entries?${params}`);
    if (!Array.isArray(response.payout_entries)) throw new SquareError("Square returned incomplete payout entries.");
    entries.push(...response.payout_entries);
    cursor = typeof response.cursor === "string" ? response.cursor : "";
  } while (cursor);
  return entries;
}

async function saveReview(db, payout, detail, entries) {
  const result = await db.from("square_payout_imports").upsert(
    {
      payout_id: String(payout.id),
      payout_date: payoutDate(payout),
      gross_amount: null,
      fee_amount: null,
      net_amount: pounds(payout.amount_money),
      currency: String(payout.amount_money?.currency || "GBP").toUpperCase(),
      status: "needs_review",
      detail,
      payout_data: { payout, entries },
    },
    { onConflict: "payout_id" }
  );
  if (result.error) throw new SquareError("Could not save the Square payout for review.");
}

export async function importSquarePayout(db, payoutId) {
  if (!payoutId || typeof payoutId !== "string") throw new SquareError("Square did not provide a payout ID.");

  const existing = await db
    .from("square_payout_imports")
    .select("status")
    .eq("payout_id", payoutId)
    .maybeSingle();
  if (existing.error) throw new SquareError("Could not check existing Square payouts.");
  if (existing.data?.status === "imported") return { duplicate: true };
  if (existing.data?.status === "needs_review") {
    const removed = await db.from("square_payout_imports").delete().eq("payout_id", payoutId);
    if (removed.error) throw new SquareError("Could not retry the Square payout review.");
  }

  const response = await squareGet(`/payouts/${encodeURIComponent(payoutId)}`);
  const payout = response?.payout;
  if (!payout?.id || String(payout.status).toUpperCase() !== "PAID" || !payout.amount_money) return { skipped: true };

  const cfg = await settings(db);
  if (!cfg.enabled || !cfg.start_at || new Date(payoutDate(payout)) < new Date(cfg.start_at)) return { skipped: true };

  const accounts = await getAccounts(db, cfg);
  const entries = await entriesForPayout(payoutId);
  const types = [...new Set(entries.map((entry) => String(entry.type || "unknown").toUpperCase()))];
  const chargeEntries = entries.filter((entry) => String(entry.type || "").toUpperCase() === "CHARGE");
  const instantDepositFees = entries.filter((entry) => String(entry.type || "").toUpperCase() === "DEPOSIT_FEE");
  const gross = chargeEntries.reduce((sum, entry) => sum + pounds(entry.gross_amount_money), 0);
  const processingFees = chargeEntries.reduce((sum, entry) => sum + Math.abs(pounds(entry.fee_amount_money)), 0);
  // Square records the extra Instant Deposit charge as a negative DEPOSIT_FEE
  // entry rather than in a card charge's fee_amount_money.
  const transferFees = instantDepositFees.reduce((sum, entry) => sum + Math.abs(pounds(entry.net_amount_money)), 0);
  const fees = processingFees + transferFees;
  const net = entries.reduce((sum, entry) => sum + pounds(entry.net_amount_money), 0);
  const payoutAmount = pounds(payout.amount_money);
  const currency = String(payout.amount_money.currency || "GBP").toUpperCase();
  const supportedEntries = chargeEntries.length > 0 && types.every((type) => type === "CHARGE" || type === "DEPOSIT_FEE");

  if (
    currency !== "GBP" ||
    !supportedEntries ||
    gross <= 0 ||
    !sameMoney(gross - fees, net) ||
    !sameMoney(net, payoutAmount)
  ) {
    await saveReview(
      db,
      payout,
      `Needs review: transaction types ${types.join(", ") || "none"}; gross £${gross.toFixed(2)}, fees £${fees.toFixed(2)}, net £${net.toFixed(2)}, payout £${payoutAmount.toFixed(2)}.`,
      entries
    );
    return { review: true };
  }

  const recorded = await db.rpc("record_square_payout", {
    p_payout_id: payoutId,
    p_payout_date: payoutDate(payout),
    p_gross_amount: gross,
    p_fee_amount: fees,
    p_net_amount: payoutAmount,
    p_currency: currency,
    p_from_account_id: accounts.square.id,
    p_to_account_id: accounts.bank.id,
    p_payout_data: { payout, entries },
  });
  if (recorded.error || !recorded.data) throw new SquareError("Could not record the Square payout in the accounts.");
  return { imported: !recorded.data.already_recorded, duplicate: Boolean(recorded.data.already_recorded) };
}

async function syncPayouts(db) {
  const cfg = await settings(db);
  if (!cfg.enabled || !cfg.start_at) throw new SquareError("Enable Square payout tracking before importing payouts.", 409);

  await getAccounts(db, cfg);
  const params = new URLSearchParams({
    begin_time: new Date(cfg.start_at).toISOString(),
    limit: "100",
    sort_order: "ASC",
  });
  let cursor = "";
  const summary = { imported: 0, review: 0, duplicate: 0, pending: 0, failed: 0, skipped: 0 };

  do {
    if (cursor) params.set("cursor", cursor);
    const response = await squareGet(`/payouts?${params}`);
    // Square omits the `payouts` property completely when this search has no
    // matching results. That is a valid empty result, not an import failure.
    const payouts = Array.isArray(response.payouts) ? response.payouts : [];
    for (const payout of payouts) {
      const payoutStatus = String(payout.status || "").toUpperCase();
      if (payoutStatus === "SENT") {
        summary.pending += 1;
        continue;
      }
      if (payoutStatus === "FAILED") {
        summary.failed += 1;
        continue;
      }
      if (payoutStatus !== "PAID") {
        summary.skipped += 1;
        continue;
      }
      const outcome = await importSquarePayout(db, String(payout.id || ""));
      if (outcome.imported) summary.imported += 1;
      if (outcome.review) summary.review += 1;
      if (outcome.duplicate) summary.duplicate += 1;
      if (outcome.skipped) summary.skipped += 1;
    }
    cursor = typeof response.cursor === "string" ? response.cursor : "";
  } while (cursor);

  const saved = await db
    .from("square_import_settings")
    .update({ last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", true);
  if (saved.error) throw new SquareError("Payouts were checked, but the sync time could not be saved.");

  return { summary, accounts: await getAccounts(db, cfg), settings: cfg };
}

async function status(db) {
  const [cfg, payoutResult] = await Promise.all([
    settings(db),
    db
      .from("square_payout_imports")
      .select("payout_id, payout_date, gross_amount, fee_amount, net_amount, currency, status, detail, transfer_id, imported_at")
      .order("payout_date", { ascending: false })
      .limit(100),
  ]);
  if (payoutResult.error) throw new SquareError("Could not load Square payout history.");
  return { settings: cfg, payouts: payoutResult.data || [], accounts: await getAccounts(db, cfg) };
}

function hasCronAccess(request) {
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

export async function GET(request) {
  try {
    const db = serviceDatabase();
    if (hasCronAccess(request)) return Response.json((await syncPayouts(db)).summary, { headers: { "Cache-Control": "no-store" } });
    await requireAdmin(request);
    return reply(await status(db));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request) {
  try {
    await requireAdmin(request);
    const input = await request.json().catch(() => null);
    if (!input || !["enable", "sync"].includes(input.action)) throw new SquareError("Unknown Square payout action.", 400);

    const db = serviceDatabase();
    if (input.action === "enable") {
      await getAccounts(db, await settings(db));
      await squareGet("/payouts?limit=1");
      const saved = await db
        .from("square_import_settings")
        .update({ enabled: true, start_at: new Date().toISOString(), last_sync_at: null, updated_at: new Date().toISOString() })
        .eq("id", true);
      if (saved.error) throw new SquareError("Could not enable Square payout tracking.");
      return reply({ message: "Square payout tracking is enabled. Only payouts paid from now on will be imported." });
    }

    const result = await syncPayouts(db);
    const awaiting = result.summary.pending ? ` ${result.summary.pending} awaiting Square confirmation.` : "";
    const failed = result.summary.failed ? ` ${result.summary.failed} failed in Square.` : "";
    return reply({
      message: `Payout check complete: ${result.summary.imported} imported, ${result.summary.review} need review, ${result.summary.duplicate} already recorded.${awaiting}${failed}`,
      ...result,
    });
  } catch (error) {
    return fail(error);
  }
}
