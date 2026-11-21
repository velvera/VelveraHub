# VelveraHub operator runbook

## Before a database change

1. Follow [`backup-restore-runbook.md`](./backup-restore-runbook.md) to confirm
   that the selected target has a usable backup and that Storage objects are
   separately protected. Confirm the target is the intended development or
   production project; do not treat this procedure as evidence that a restore
   has been tested.
2. Inspect existing profile, shop, and product ownership data. Resolve duplicate
   Auth/profile mappings manually; do not rewrite `owner_id` or `seller_id` as
   part of a routine migration.
3. Apply SQL migrations one at a time, in the order in
   `docs/cloudflare-pages.md`. Keep the SQL Editor result for each step.
4. After functions or policies change, allow PostgREST to refresh its schema
   cache. If a new RPC returns `PGRST202`, retry after refresh before changing
   application code.

## Public configuration rotation

- Only the Supabase project URL and anon/publishable key belong in static
  browser configuration. They are public by design and must still be
  protected by Row Level Security.
- Never put a service-role key, database password, JWT signing key, Paystack
  secret, Stripe secret, or webhook signing secret in a Pages asset.
- After rotating public values, update the shared configuration, run
  `npm run apps:sync`, verify with `npm run apps:check`, then redeploy each
  Pages project that uses it.

## Seller and admin role promotion

Use a privileged Supabase SQL Editor session. The role-promotion functions are
not available to browser users:

- `public.assign_seller_role(email)` in `database/seller.sql`
- `public.assign_admin_role(email)` in `database/admin.sql`

Run a promotion only after the ordered migrations, from a trusted Supabase SQL
Editor session. The profile-security trigger deliberately ignores role changes
without the transaction-local service-role claim. Use this exact pattern:

```sql
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT * FROM public.assign_admin_role('registered-email@example.com');
COMMIT;
```

For seller repair, replace the function with
`public.assign_seller_role('registered-email@example.com')`. The function
returns the linked profile, Auth user ID, email, and final role. Confirm the
expected role there and verify actual access after a fresh login. Never set the
claim in a browser or Pages asset; `COMMIT` clears it. Promote only the
specifically authorized account. If the email's profile is linked to a
different Auth user, resolve that mapping before retrying.
A seller role does not create a shop; the seller must submit shop onboarding at
`velverahub.shop`.

## Failed and pending orders

- Orders are not paid merely because the checkout form succeeded. Offline
  orders remain `pending` until an operator verifies the agreed cash-on-delivery
  or bank-transfer process.
- Never mark an order paid from a browser request or from a screenshot/receipt
  supplied by a shopper. Reconcile against the provider/bank record first.
- For an order still pending, inspect `orders` and `order_items` by the order
  ID/order number and confirm its payment method, email, quantities, and stock
  effects. Do not restore stock twice or edit payment status directly.
- If the order was paid or a provider transaction exists, follow the provider's
  refund workflow and record its reference before changing order state.
- If no payment was made and cancellation is required, use the approved
  cancellation process for the deployment. Do not run ad-hoc stock updates;
  this repository does not yet expose a customer-facing cancellation action.

## Regional release verification

1. Apply pending Supabase migrations listed in `database/run-schema.txt`,
   including `database/product-delivery-options.sql` before enabling delivery
   choices in seller listings.
2. Run `npm run apps:sync`, then `npm run apps:check`.
3. Run `npm run smoke`; use `SMOKE_REQUIRE_SUPABASE=1` only when checking a
   deployment that has its public Supabase configuration set.
4. Check `https://velverahub.com/healthz` and
   `https://velverahub.co.uk/healthz` for the independently deployed API.
   Verify CORS origins against the exact Pages domains.
5. Confirm the active shop and positive-stock product catalogue, checkout's
   pending state for offline methods, and mobile layouts at 320, 390, and 430 px.
6. Deploy `velverahub-shop/` separately for `velverahub.shop`; verify seller
   signup, explicit shop creation, pending review, private document access,
   draft product creation, owner-scoped orders, and withdrawal validation.
7. Keep card checkout disabled until provider approval, server-side credentials,
   signed webhook handling, refund/settlement reconciliation, and staging tests
   have all passed.