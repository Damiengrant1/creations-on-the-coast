# Shopify order imports

Deployed to the existing Next.js dashboard. The Supabase migration is already applied.
Automatic imports remain disabled until an approved admin enables them on `/shopify/imports`.

## Production setup

1. In Supabase Project Settings → API Keys, copy a server secret key.
2. Add it to Vercel's Production environment as `SUPABASE_SECRET_KEY` and redeploy.
   Never prefix this variable with `NEXT_PUBLIC_`. Existing `SHOPIFY_CLIENT_ID` and
   `SHOPIFY_CLIENT_SECRET` stay server-side too.
3. Open Dashboard → Shopify → Automatic imports → Enable new website sales.

Vercel's system environment variables must be enabled. Registration uses
`VERCEL_PROJECT_PRODUCTION_URL`, never an arbitrary request hostname or a preview URL.
The public webhook URL must be reachable without Vercel deployment protection. The
integration verifies its readiness before registering subscriptions.

The app registers its own `ORDERS_CREATE`, `ORDERS_PAID`, `ORDERS_UPDATED` and
`ORDERS_CANCELLED` subscriptions using its Vercel credentials. These subscriptions
must belong to this app because webhook HMAC verification uses this app's client secret.
The ChatGPT Shopify plugin's credentials are not used by the deployed importer.

Registration is idempotent for the production URI and topic. Only after all four
subscriptions exist does a database transaction set the initial cutoff and enable imports.
A failed setup does not leave an earlier cutoff behind. Resume keeps the original cutoff.

## Recorded behaviour

Only non-test GBP website-checkout orders created at or after the initial cutoff,
fully paid through Shopify Payments alone, are eligible. Each order must have every
line linked to an active, current Shopify variant and an active stock-tracked Clothing
product. There is no partial-order import.

The sale, its items, the paid job, the job items and the receipt ID are committed in
one database transaction. Existing sale-item triggers record cash and stock. The import
function does not create a second cash or stock entry itself.

Actual discounted line totals are used. When a discount cannot divide evenly into
penny-priced units, a line is split into at most two rows. Their combined quantity,
revenue and direct cost stay exact. Cost is `stock_cost + production_cost` at import.
Delivery income uses a non-stock product created on first activation; actual postage
costs must still be recorded separately as expenses. Tax charged separately is held
for review because the current dashboard has no output-tax ledger.

Jobs preserve the website item names, personalisation, supplied contact information,
notes and delivery address. They already have `sale_id`, so the existing conversion
function rejects a second conversion. Completing a job does not deduct stock again.

## Reliability and review

- Raw request bytes are checked with SHA-256 HMAC and a constant-time comparison.
  Wrong shop, topic, delivery identifier or signature is rejected before database access.
- Delivery IDs and order IDs are deduplicated. Per-order database locking serializes
  concurrent deliveries. Stale source updates are ignored.
- A database failure returns HTTP 503; Shopify can retry. A committed order remains
  deduplicated even if the HTTP response is lost.
- Invalid totals, currencies, non-clothing, missing mappings, unsupported gateways,
  refunds and cancellations remain visible in the admin review queue.
- Changes to an imported order's quantities, prices, personalisation or customer details
  are flagged. Existing sales, cash and stock are never silently rewritten or reversed.
- A prior cancellation/refund cannot be overwritten by a delayed paid notification.
- Imported sale/job references use restrictive foreign keys, so deleting linked records
  requires a deliberate reconciliation workflow rather than allowing a future re-import.
- `Check missed orders` paginates Shopify orders from the original cutoff and safely
  retries saved orders. It runs once after enable/resume. It is also available manually.
  There is no recurring reconciliation cron in this version; the live path is webhooks.
- Shopify's normal `read_orders` scope exposes the last 60 days. Longer history requires
  separate scope approval and a deliberate historical import. Older records already in
  this dashboard are not matched by guessing a customer name or amount.
- Catalogue links are a saved snapshot. Newly created Shopify variants need refreshing
  and matching; they are held for review until then.
- Payout transfers, payment fees, automatic refund reconciliation, and bidirectional
  Shopify inventory/fulfilment updates are not enabled by this change.

## Access controls

Integration tables have RLS. Only approved active admins can read setup/import data;
webhook receipts and settings writes are server-only. Browser roles cannot invoke the
import or activation functions. Server functions use SECURITY INVOKER; no new
SECURITY DEFINER functions or anonymous access policies were added.
Admin API requests call Supabase `getUser` and check the caller's own `app_users` row
before constructing a service-key database client or using Shopify credentials.

## Verification

- Next.js production build passed with placeholder public build environment values.
- Node tests cover signature rejection, retryable database errors, admin access,
  monetary validation, source-normalization parity, customer changes and safe IDs.
- `tests/shopify-order-imports.sql` runs inside a transaction and rolls back: exact
  discounted totals, direct costs, cash receipt, stock deduction, linked job, repeated
  activation, duplicate/stale events, cancellation ordering, missing mappings, late
  constraint-failure rollback, cutoff, pause, unpaid status and access controls.
- Shopify GraphQL operations were validated against the live schema; the recovery query
  also executed successfully using a future-date filter that returned no orders.
- No real sales, jobs, stock movements or cash transactions were created by testing.
- Live end-to-end delivery still requires the production server key, activation and a
  genuine new eligible paid website order. Test orders are deliberately excluded.

Commands:

```sh
node --test tests/shopify-orders.test.mjs
node --experimental-vm-modules --test tests/shopify-webhook.test.mjs tests/shopify-import-auth.test.mjs tests/shopify-connection.test.mjs
npm run build
```

## References

- [Shopify webhook verification and retries](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries)
- [Shopify webhook subscriptions](https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/webhookSubscriptionCreate)
- [Shopify order line discounts](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/LineItem)
- [Supabase server secret keys](https://supabase.com/docs/guides/api/api-keys)
