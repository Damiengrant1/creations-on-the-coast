import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SHOP_DOMAIN = "ku1cvy-ue.myshopify.com";
export const ORDER_TOPICS = new Set(["orders/create", "orders/paid", "orders/updated", "orders/cancelled"]);
const text = (value, max = 10000) => typeof value === "string" ? value.slice(0, max) : "";

export function validSignature(body, header, secret) {
  if (!secret || !/^[A-Za-z0-9+/]{43}=$/.test(header || "")) return false;
  const actual = Buffer.from(header, "base64");
  const expected = createHmac("sha256", secret).update(body).digest();
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function cents(value) {
  if (typeof value !== "string" || !/^\d{1,9}(\.\d{1,2})?$/.test(value)) throw new Error("An order amount is missing or invalid.");
  const [whole, fraction = ""] = value.split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(amount)) throw new Error("An order amount is too large.");
  return amount;
}
function gid(kind, value) {
  if (typeof value === "string" && new RegExp(`^gid://shopify/${kind}/[0-9]+$`).test(value)) return value;
  if ((typeof value === "number" && Number.isSafeInteger(value) && value > 0) || (typeof value === "string" && /^[1-9][0-9]*$/.test(value))) return `gid://shopify/${kind}/${value}`;
  return null;
}
const attributes = (items) => (Array.isArray(items) ? items : []).map(x => `${text(x.key ?? x.name, 200)}: ${text(x.value, 5000)}`).sort().join("\n");
function date(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error("An order date is missing or invalid.");
  return new Date(value).toISOString();
}

// Both sources become one checked, minimal record. No financial values are guessed.
export function normalizeOrder(source, format = "webhook") {
  const graph = format === "graphql";
  const orderId = gid("Order", graph ? source.id : source.admin_graphql_api_id || source.id);
  if (!orderId) throw new Error("The Shopify order identifier is missing or invalid.");
  const order = {
    order_id: orderId,
    name: text(source.name, 150) || orderId.split("/").pop(),
    created_at: date(graph ? source.createdAt : source.created_at),
    updated_at: date(graph ? source.updatedAt : source.updated_at),
    processed_at: date((graph ? source.processedAt : source.processed_at) || (graph ? source.createdAt : source.created_at)),
    financial_status: String(graph ? source.displayFinancialStatus : source.financial_status).toLowerCase(),
    fulfilled: (graph ? source.displayFulfillmentStatus : source.fulfillment_status)?.toLowerCase() === "fulfilled",
    test: source.test === true,
    cancelled: !!(graph ? source.cancelledAt : source.cancelled_at),
    customer_name: text(graph ? source.shippingAddress?.name : source.shipping_address?.name, 300) || `Shopify ${text(source.name,150)}`,
    email: text(graph ? source.email : source.contact_email || source.email, 300),
    phone: text(source.phone, 100),
    delivery_address: graph ? [source.shippingAddress?.name, source.shippingAddress?.company, source.shippingAddress?.address1, source.shippingAddress?.address2, source.shippingAddress?.city, source.shippingAddress?.province, source.shippingAddress?.zip, source.shippingAddress?.country].filter(Boolean).join("\n") : [source.shipping_address?.name, source.shipping_address?.company, source.shipping_address?.address1, source.shipping_address?.address2, source.shipping_address?.city, source.shipping_address?.province, source.shipping_address?.zip, source.shipping_address?.country].filter(Boolean).join("\n"),
    notes: [text(source.note), attributes(graph ? source.customAttributes : source.note_attributes)].filter(Boolean).join("\n"),
    lines: [], issues: [], currency: "", total_cents: 0, shipping_cents: 0,
  };
  const fail = message => { if (!order.issues.includes(message)) order.issues.push(message); };
  try {
    order.currency = graph ? source.totalPriceSet?.shopMoney?.currencyCode : source.currency;
    if (order.currency !== "GBP") fail("Only GBP orders can be imported automatically.");
    const sourceName = graph ? source.sourceName : source.source_name;
    if (sourceName !== "web") fail("This order did not come through the website checkout.");
    const gateways = graph ? source.paymentGatewayNames : source.payment_gateway_names;
    if (!Array.isArray(gateways) || gateways.length !== 1 || !["shopify_payments", "shopify payments"].includes(String(gateways[0]).toLowerCase())) fail("Check the payment method: automatic receipts require Shopify Payments only.");
    const money = (bag) => {
      const m = bag?.shopMoney;
      if (!m || m.currencyCode !== order.currency) throw new Error("Order amounts use inconsistent currencies.");
      return cents(m.amount);
    };
    order.total_cents = graph ? money(source.totalPriceSet) : cents(source.total_price);
    const currentTotal = graph ? money(source.currentTotalPriceSet) : cents(source.current_total_price);
    if (currentTotal !== order.total_cents) fail("The order total has changed; check edits, returns or refunds.");
    const subtotal = graph ? money(source.subtotalPriceSet) : cents(source.subtotal_price);
    order.shipping_cents = graph ? money(source.currentShippingPriceSet) : cents(source.current_shipping_price_set?.shop_money?.amount);
    const tax = graph ? money(source.totalTaxSet) : cents(source.total_tax);
    if (tax > 0 && !(graph ? source.taxesIncluded : source.taxes_included)) fail("Tax is charged separately; review the tax treatment before recording this sale.");
    if (graph ? money(source.totalRefundedSet) > 0 : Array.isArray(source.refunds) && source.refunds.length > 0) fail("This order has a refund; reconcile it before importing or changing the sale.");
    if (graph ? money(source.totalOutstandingSet) !== 0 : source.total_outstanding !== undefined && cents(source.total_outstanding) !== 0) fail("This order has an outstanding payment or refund balance.");
    if (graph && source.lineItems?.pageInfo?.hasNextPage) fail("This order has more than 100 lines and needs review.");
    const items = graph ? source.lineItems?.nodes : source.line_items;
    if (!Array.isArray(items) || items.length === 0 || items.length > 100) throw new Error("The order items are missing or exceed 100 lines.");
    for (const item of items) {
      const quantity = item.quantity;
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10000) throw new Error("An item quantity is invalid.");
      if ((graph ? item.currentQuantity : item.current_quantity) !== quantity) fail("An item has been removed or returned; review the order changes.");
      const original = graph ? money(item.originalTotalSet) : cents(item.price) * quantity;
      const allocations = graph ? item.discountAllocations : item.discount_allocations;
      if (!Array.isArray(allocations)) throw new Error("Item discount allocations are missing.");
      const discount = allocations.reduce((sum, d) => sum + (graph ? money(d.allocatedAmountSet) : cents(d.amount)), 0);
      const total = original - discount;
      if (!Number.isSafeInteger(total) || total < 0) throw new Error("Item discounts exceed the item price.");
      const id = gid("LineItem", graph ? item.id : item.admin_graphql_api_id || item.id);
      if (!id) throw new Error("An order line identifier is invalid.");
      const variant = gid("ProductVariant", graph ? item.variant?.id : item.variant_id);
      if (!variant) fail("An item has no Shopify variant to match to your stock.");
      order.lines.push({id, variant_id: variant, quantity, total_cents: total,
        description: text(item.name || [item.title, graph ? item.variantTitle : item.variant_title].filter(Boolean).join(" / "), 1000),
        personalisation: attributes(graph ? item.customAttributes : item.properties)});
    }
    if (new Set(order.lines.map(x => x.id)).size !== order.lines.length) fail("Duplicate line identifiers need review.");
    const lineTotal = order.lines.reduce((sum, x) => sum + x.total_cents, 0);
    if (lineTotal !== subtotal || lineTotal + order.shipping_cents !== order.total_cents) fail("Items, discounts and delivery do not exactly match the paid order total.");
  } catch (error) { fail(error.message); }
  if (order.cancelled) fail("This order was cancelled. Review any sale, payment and stock already recorded.");
  if (["refunded", "partially_refunded", "voided"].includes(order.financial_status)) fail("This order was refunded or voided; reconcile the payment and stock.");
  order.fingerprint = createHash("sha256").update(JSON.stringify({
    currency: order.currency, total: order.total_cents, shipping: order.shipping_cents,
    lines: [...order.lines].sort((a,b) => a.id.localeCompare(b.id)),
    name: order.customer_name, email: order.email, phone: order.phone,
    address: order.delivery_address, notes: order.notes,
  })).digest("hex");
  return order;
}
