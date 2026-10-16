# Connect the live VelveraHub catalogue

This guide connects the buyer storefront to a real Supabase catalogue when
VelveraHub is deployed on Cloudflare Pages.

The storefront is intentionally empty when the connection is missing. It does
not create sample products or shops in the browser.

## What this deployment uses

```text
Customer browser
    ├─ Cloudflare Pages static files
    └─ Supabase REST/Auth/Storage APIs

Supabase
    ├─ shops
    ├─ products
    ├─ product_images
    └─ RLS policies
```

The browser receives only the Supabase project URL and the Supabase publishable
key (or the legacy public anon key).
Supabase Row Level Security (RLS) protects the data. Never put a Supabase
service-role key in Cloudflare Pages variables exposed to the browser.

## Before you start

You need:

- access to the Supabase project that owns the catalogue;
- access to the Cloudflare Pages project for VelveraHub;
- the repository deployed from its root directory;
- a test shop owner account if you want to create inventory from the seller
  dashboard.

The browser may receive the Supabase URL and anon/publishable key. The anon key
is safe for browser use when RLS is correctly configured. This repository
injects only those public client values into rendered HTML; it never injects a
service-role key, database password, JWT secret, or session secret.

## Step 1: Apply the Supabase database setup

Open the Supabase project, select **SQL Editor**, and run these repository
files separately in the exact order below:

1. `database/schema.sql`
2. `database/seller.sql`
3. `database/admin.sql`
4. `database/supabase-rls.sql`
5. `database/security-hardening.sql`
6. `database/cloudflare-dashboard.sql`
7. `database/cloudflare-supabase-direct.sql`
8. `database/production-hardening.sql`
9. `database/shop-owner-payments.sql`
10. `database/shop-verification-compliance.sql`
11. `database/seller-contact-safety.sql`

Wait for each script to finish before running the next one. The first script
creates the catalogue tables and supporting functions. The second enables the
Auth profile trigger needed by seller accounts. The RLS and dashboard scripts
then install the browser policies and Supabase-side authorization for direct
browser access. They do not require Pages Functions, Workers, or a Cloudflare
API runtime.
The production hardening migration adds secure buyer checkout. The next
migrations add the standalone shop-owner portal, verification workflow,
public-contact opt-in, and bank-transfer safeguards. They do not activate
Paystack or Stripe checkout.

If you need to promote an existing Supabase Auth account, run
`database/admin.sql` or `database/seller.sql` separately with a privileged
operator role, then call the operator-only function documented in that file.

### Confirm the schema exists

Run this read-only check in Supabase SQL Editor:

```sql
select
  to_regclass('public.shops') as shops_table,
  to_regclass('public.products') as products_table,
  to_regclass('public.product_images') as product_images_table,
  to_regclass('public.orders') as orders_table;
```

All four values should be non-null.

### Confirm there is publishable inventory

Run:

```sql
select
  (select count(*) from public.shops
   where status = 'active') as active_shops,
  (select count(*) from public.products
   where status = 'active' and coalesce(stock, 0) > 0) as active_in_stock_products;
```

The second count must be at least `1` before a product can appear in the
storefront.

If the counts are zero, create or activate real inventory. The preferred path
is:

1. Sign in to the VelveraHub seller dashboard with a seller account.
2. Ensure the account is linked to an active shop.
3. Add a product with a positive stock quantity.
4. Upload a WebP product image if desired.
5. Confirm the product status is `active`.

The production database folder intentionally contains no seed scripts. Create
real inventory through the seller dashboard or a reviewed import.

### Current verification status

The connected Supabase project has been checked through its authenticated
REST API:

- the `shops` endpoint responds successfully and contains active shops;
- the `products` endpoint responds successfully and contains active,
  in-stock products;
- the `place_order_secure` RPC is not currently present in the Supabase
  schema cache.

The last item is a checkout hardening issue, not a catalogue visibility issue.
Run `database/production-hardening.sql` after the first four migrations, then
wait briefly and retry the smoke check. If the RPC still returns
`PGRST202`, refresh the Supabase schema cache by making a harmless request
again or use the Supabase dashboard's project restart/support tools.

## Step 2: Configure the public browser client

The storefront does not require Cloudflare Pages variables for its public
Supabase client. Copy `config.example.js` to the static browser configuration
used by the storefront and replace the public URL and anon key with the values
from Supabase.

The Supabase URL normally looks like:

```text
https://your-project-ref.supabase.co
```

Use the URL and anon/publishable key from **Supabase → Project Settings → API**.
Do not use the `service_role` or `sb_secret_...` key. The anon key is public;
RLS is the security boundary.

### Public connection ownership

The Admin Dashboard's **Settings → Public Supabase connection** view is
read-only. The shared public values are maintained in the static frontend
configuration for each independently deployable application. Never put a
service-role key, database password, JWT secret, or session secret there.

## Step 3: Verify the static browser configuration

Set `DEPLOYED_URL` locally to the deployed Pages or custom-domain URL, then
run:

```bash
DEPLOYED_URL="https://your-domain.example"
curl -fsS "$DEPLOYED_URL/assets/js/services/publicSupabaseConfig.js" \
  | grep -E 'SUPABASE_URL|SUPABASE_ANON_KEY'
```

The asset must contain the public Supabase URL and anon key. It must never
contain a service-role key, secret key, database password, JWT secret, or
session secret.

Then open the deployed storefront in a private browser window and verify:

1. the storefront loads without a configuration warning banner;
2. the header location control opens and selecting a state changes its label;
3. the browser Network panel shows a successful request to
   `https://<project-ref>.supabase.co/rest/v1/products`;
4. the page shows real listings when the database has active, RLS-visible
   products, or an honest empty-catalogue message when it does not.

If the asset still contains placeholders, update the static public config in
the application root and create a new deployment.

## Step 4: Run the public smoke checks

From the repository:

```bash
SMOKE_BASE_URL="$DEPLOYED_URL" npm run smoke
SMOKE_BASE_URL="$DEPLOYED_URL" \
SMOKE_REQUIRE_SUPABASE=1 \
npm run smoke
```

The second command fails if the static public config still contains
placeholders. It does not print either value.

## Step 5: Check the storefront

Open the deployed URL in a private browser window and confirm:

- the location selector can be used;
- the active product appears in the product grid;
- the product detail page loads the real product;
- the shop page loads the real shop;
- the product image comes from the configured Supabase Storage URL;
- the browser console has no Supabase configuration error.

Test both Preview and Production. Do not rely only on a cached browser tab.

## If the catalogue is still empty

Check these in order:

1. The static public Supabase configuration is populated.
2. The Supabase SQL counts show an active shop and active in-stock product.
3. The product's `shop_id` points to an active shop.
4. The product's `status` is exactly `active`.
5. The product's `stock` is greater than zero.
6. The selected delivery location matches the product or shop coverage.
7. `database/supabase-rls.sql` was applied after `database/schema.sql`.
8. The Pages deployment includes the `functions/` directory when edge
   functions are needed.

If the API response is `503` or the local server logs say that the `products`
relation does not exist, that is the local Express/PostgreSQL environment, not
the Cloudflare Supabase connection. The Cloudflare buyer storefront uses the
Pages Function and Supabase directly.

## Security checklist

- [ ] The static browser configuration contains only the public URL and anon key.
- [ ] No service-role key is present in Pages variables, frontend files, or
      commits.
- [ ] RLS migration has been applied.
- [ ] Public reads expose only active catalogue records.
- [ ] Product image uploads follow the WebP and ownership rules.
- [ ] `place_order_secure` has been applied before enabling checkout.
- [ ] At least one real active shop and in-stock product is visible.
- [ ] The deployed smoke check passes with
      `SMOKE_REQUIRE_SUPABASE=1`.

## Related files

- `docs/cloudflare-pages.md` — short deployment checklist.
- `improvement.md` — production-readiness status and remaining limitations.
- `database/schema.sql` — base schema.
- `database/supabase-rls.sql` — RLS and storage policies.
- `database/production-hardening.sql` — secure order RPC.
- `database/admin.sql` — operator-only admin promotion.
- `database/seller.sql` — operator-only seller promotion.