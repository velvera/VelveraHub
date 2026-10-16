# VelveraHub on Cloudflare Pages: Supabase connection guide

VelveraHub uses separate Cloudflare Pages roots. The NG and UK storefronts
serve static HTML, CSS, JavaScript, and assets, with one narrowly routed Pages
Function that adds listing metadata only to `/veeve/product.html`. The admin
and shop roots remain static-only. None of the roots execute `server.js`.

## Production domains

Deploy each application root as its own static Pages project. The regular seller
workspace is part of both shopper storefronts; it is not a separate deployment.

| Surface | Domain | Behavior |
| --- | --- | --- |
| Nigeria shopper storefront | `https://velverahub.com` | Static root: `velverahub-ng/`; public catalogue, account, cart, and checkout |
| UK shopper storefront | `https://velverahub.co.uk` | Static root: `velverahub-uk/`; public catalogue with UK region defaults |
| Marketplace seller workspace | `/veeve/seller.html` on `velverahub.com` or `velverahub.co.uk` | Authenticated seller workspace for regular sellers |
| Shop-owner portal | `https://velverahub.shop` | Static root: `velverahub-shop/`; seller explicitly creates a shop to onboard |
| Admin workspace | `https://velverahub.org` | Static root: `velverahub-admin/`; redirects `/` to the admin dashboard |

Each root is self-contained. Cross-domain sign-in is not shared, and seller,
shop-owner, and admin pages use `noindex,nofollow` in their page markup. No
deployment middleware is required for these static sites.

Supabase Auth sessions are origin-scoped by the browser. A shopper-domain
session is not automatically available on `.shop` or `.org`, so the seller
and admin workspaces provide their own Supabase sign-in forms. This avoids
passing access or refresh tokens through URLs.

## How the production connection works

1. Cloudflare Pages serves files from the selected application root. On the NG
   and UK storefronts, the Pages Function runs only for `/veeve/product.html`;
   `_routes.json` excludes every other path.
2. The browser initializes Supabase from that root's public client config and
   calls Supabase Auth, REST, Storage, and permitted RPC endpoints directly.
3. Supabase Row Level Security and database permissions protect data access.
4. The deployment does not run Express. Do not expect `/api/seo`,
   `/api/admin/*`, or other Express endpoints to be available from these roots.

The product Function reads the active, in-stock public product and its image
through the public Supabase REST API, then adds listing-specific Open Graph,
Twitter, canonical, and price metadata to the static product page. If public
catalogue data is unavailable, it returns the static page unchanged.

Only a publishable/anon key is sent to the browser. Never add a Supabase
`service_role` key, database password, JWT secret, or `SESSION_SECRET` to
client-exposed variables.

## Public catalogue configuration

The public Supabase URL and anon/publishable key are browser-safe values and
must be present in `assets/js/services/publicSupabaseConfig.js` in each
deployed root. The storefront does not require Cloudflare variables to
initialize its public client.

Keep privileged values out of the browser, including service-role/secret keys,
database passwords, JWT secrets, `SESSION_SECRET`, and private API keys.
Privileged operations must use a separately hosted API or protected Supabase
RPCs. Never put privileged credentials in the static files.

## Supabase SQL order

Run the SQL files in the Supabase SQL Editor in this order:

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
12. `database/product-delivery-options.sql`

The delivery-options migration adds seller-provided delivery choices and a
bounded note. Sellers and buyers must confirm actual fees, coverage, and timing;
the application does not invent delivery prices or guarantees.

The Supabase migration creates or updates:

- the public active/in-stock catalogue policy;
- `site_settings` rows for branding and SEO;
- admin-only SEO save/read RPC functions;
- the public policy that allows only the `branding` and `seo` settings rows;
- narrow Supabase database functions used by the application.

`database/shop-owner-payments.sql` must run after the dashboard and production
hardening migrations. It adds the separate shop-owner portal's onboarding,
verification, payout, finance, and payment-lifecycle records. It does not
enable card checkout.
Deploy `velverahub-shop/` as a separate static Pages project with that folder
as its root and `velverahub.shop` as its custom domain. No Worker deployment is
needed.

The `seo` settings row is what powers the Admin Dashboard’s **SEO & Social**
screen. It controls the page title, description, keywords, canonical URL,
Open Graph fields, Twitter/X fields, robots policy, social image, and
Organization structured-data profile URLs.

## Verification checklist

Check that the deployed domain serves the static page and public config:

```text
https://your-domain.example/
https://your-domain.example/assets/js/services/publicSupabaseConfig.js
```

If products are empty, confirm that at least one shop is `active`, at least one
product is `active`, the product has `stock > 0`, and the product’s `shop_id`
belongs to that active shop.

Inspect the raw HTML to verify its static metadata:

```bash
curl -sS https://your-domain.example/ | grep -E 'og:title|twitter:card|canonical|application/ld+json'
```

SEO values saved in Supabase do not dynamically change static HTML. Update the
page metadata in the deployed application files when those values need to
change.

For local Replit preview, `server.js` may use server-side Supabase bindings for
privileged API compatibility. Those bindings are separate from the browser's
public client configuration and are not required to render the storefront.