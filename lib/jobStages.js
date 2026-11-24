// One place for job statuses, their plain-English names, and the order work flows through.

export const STATUSES = [
  ["new", "New"],
  ["artwork_information_needed", "Artwork/Information Needed"],
  ["awaiting_customer_approval", "Awaiting Customer Approval"],
  ["awaiting_stock_order", "Awaiting Stock Order"],
  ["awaiting_stock_delivery", "Awaiting Stock Delivery"],
  ["ready_to_produce", "Ready to Produce"],
  ["in_production", "In Production"],
  ["ready_for_collection_postage", "Ready for Collection/Postage"],
  ["completed", "Completed"],
  ["cancelled", "Cancelled"],
];

export const STATUS_LABELS = Object.fromEntries(STATUSES);
export const CLOSED_STATUSES = new Set(["completed", "cancelled"]);

// Board columns: the stages the team actually thinks in.
export const BOARD_COLUMNS = [
  { key: "todo", title: "To sort", hint: "New, or waiting on artwork/info", statuses: ["new", "artwork_information_needed"] },
  { key: "customer", title: "With customer", hint: "Waiting for approval", statuses: ["awaiting_customer_approval"] },
  { key: "stock", title: "Stock", hint: "To order or on its way", statuses: ["awaiting_stock_order", "awaiting_stock_delivery"] },
  { key: "make", title: "Ready to make", hint: "Everything is here", statuses: ["ready_to_produce"] },
  { key: "making", title: "Making", hint: "In production", statuses: ["in_production"] },
  { key: "ready", title: "Ready to go", hint: "Collection or post", statuses: ["ready_for_collection_postage"] },
];

// What the "next step" button on a job does, by current status.
export const NEXT_STEP = {
  new: { to: "artwork_information_needed", label: "Need artwork/info" },
  artwork_information_needed: { to: "awaiting_customer_approval", label: "Sent for approval" },
  awaiting_customer_approval: { to: "awaiting_stock_order", label: "Approved" },
  awaiting_stock_order: { to: "awaiting_stock_delivery", label: "Stock ordered" },
  awaiting_stock_delivery: { to: "ready_to_produce", label: "Stock arrived" },
  ready_to_produce: { to: "in_production", label: "Start making" },
  in_production: { to: "ready_for_collection_postage", label: "Made" },
  ready_for_collection_postage: { to: "completed", label: "Collected / posted" },
};

export const SOURCE_LABELS = {
  website: "Website",
  facebook: "Facebook",
  whatsapp: "WhatsApp",
  in_person: "In Person",
  other: "Other",
};

export const PAYMENT_LABELS = {
  unpaid: "Unpaid",
  deposit_paid: "Deposit Paid",
  paid: "Paid",
  refunded: "Refunded",
};

export function statusTone(status) {
  if (status === "completed") return "leaf";
  if (status === "cancelled") return "";
  if (["awaiting_stock_order", "awaiting_stock_delivery"].includes(status)) return "sun";
  if (["ready_for_collection_postage", "ready_to_produce"].includes(status)) return "sea";
  return "ink";
}

export function paymentTone(payment) {
  if (payment === "paid") return "leaf";
  if (payment === "deposit_paid") return "sun";
  if (payment === "refunded") return "";
  return "coral";
}

export function localDateString(date = new Date()) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
}

export function displayDate(value) {
  if (!value) return "No deadline";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

export function friendlyDue(value, today = localDateString()) {
  if (!value) return { text: "No deadline", tone: "" };
  const days = Math.round((new Date(value) - new Date(today)) / 86400000);
  if (days < 0) return { text: `Overdue ${-days}d`, tone: "coral" };
  if (days === 0) return { text: "Due today", tone: "coral" };
  if (days === 1) return { text: "Due tomorrow", tone: "sun" };
  if (days <= 7) return { text: `Due in ${days} days`, tone: "sun" };
  return { text: `Due ${displayDate(value)}`, tone: "" };
}

// Finished jobs whose money hasn't reached the books (no sale recorded).
// Anything sorted at the fresh start, or finished before it, is left alone.
export function needsPayment(job, freshStartDate) {
  if (job.sale_id || job.closed_at_fresh_start || job.payment_status === "refunded" || job.status === "cancelled") return false;
  if (freshStartDate && job.status === "completed" && (job.completed_at || job.created_at || "").slice(0, 10) < freshStartDate) return false;
  return job.status === "completed";
}

export function isWebsiteOrder(job) {
  return Boolean(job.square_order_id);
}
