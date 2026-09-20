import { createHmac, timingSafeEqual } from "crypto";
import { importSquarePayout } from "../payouts/route";
import { productionWebhookUrl, serviceDatabase } from "../../../../lib/square/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isValidSignature(body, signature) {
  const key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY?.trim();
  if (!key || !signature) return false;
  const expected = createHmac("sha256", key).update(productionWebhookUrl() + body).digest("base64");
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(signature);
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

function payoutIdFrom(event) {
  const payout = event?.data?.object?.payout;
  return typeof payout?.id === "string"
    ? payout.id
    : event?.data?.type === "payout" && typeof event?.data?.id === "string"
      ? event.data.id
      : "";
}

export async function GET() {
  return Response.json({ service: "creations-square-payouts", ready: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request) {
  try {
    const body = await request.text();
    if (!isValidSignature(body, request.headers.get("x-square-hmacsha256-signature"))) {
      return new Response("Invalid signature", { status: 401 });
    }

    const event = JSON.parse(body);
    if (event?.type !== "payout.paid") return new Response(null, { status: 200 });

    const payoutId = payoutIdFrom(event);
    if (!payoutId) return new Response("Missing payout ID", { status: 400 });
    await importSquarePayout(serviceDatabase(), payoutId);
    return new Response(null, { status: 200 });
  } catch {
    return new Response("Could not process Square payout", { status: 503 });
  }
}
