# Cloudflare Pages production checklist

For the full step-by-step procedure, see
[`connect-live-catalogue.md`](./connect-live-catalogue.md).

VelveraHub is deployed as separate Cloudflare Pages projects. The regional,
admin, and shop-owner folders contain the files Pages serves. The NG and UK
storefront roots include one Pages Function, routed only to
`/veeve/product.html` by `_routes.json`, to render accurate per-listing social
metadata. Admin and shop-owner roots remain static-only. No root runs
`server.js`.

## Pages configuration

Create a separate static Pages project for each application root:

| Project root | Domain |
| --- | --- |
| `velverahub-ng/` | `velverahub.com` |
| `velverahub-uk/` | `velverahub.co.uk` |
| `velverahub-admin/` | `velverahub.org` |
| `velverahub-shop/` | `velverahub.shop` |

`seller-workspace/` and `shop-owner/` hold source files only; they are not
deployment roots. Run `npm run apps:sync` to copy them and the shared static
assets into the NG, UK, and shop Pages roots. The seller workspace is served
inside both regional storefronts at `/veeve/seller.html`.

For each project, select the matching folder as the project root, use no build
command, and set the output directory to `.`. Do not deploy the repository root
for these sites. Keep `_routes.json` and `functions/` in both regional
storefront roots; the route manifest ensures the metadata Function does not
intercept other paths. The shop and admin roots must not contain either file.

Cloudflare's dashboard drag-and-drop upload does not compile Pages Functions.
Publish the regional roots through a Git-integrated Pages project or Wrangler.
For Wrangler, use the matching generated root as the working directory, for
example:

```bash
cd velverahub-ng
npx wrangler pages deploy . --project-name <existing-ng-pages-project>
```

Repeat from `velverahub-uk/` with that existing Pages project name. The project
name must match the Pages project already configured for the domain.

Before uploading, sync the generated roots and run the production gate:

```bash
npm run apps:sync
npm run apps:production:check
npm run test:product-meta
npm run test:domain-routing
```

The four Pages roots are Supabase-only static deployments: keep `API_ORIGIN`
empty. The production check verifies that each root has a real public Supabase
URL and anon key and that no separate API origin is configured. Do not set
`API_ORIGIN` to the Supabase project URL; the static applications use the
Supabase client directly.

The browser Supabase URL and anon key belong in the public static configuration
inside each application root. Do not add privileged secrets to static files or
browser-visible Pages variables. No `npm install` or build step is needed.

The following commands are optional HTTP checks against each separately
deployed static root. `SMOKE_APP` selects the expected page set; it does not
enable API or Worker checks.

```bash
SMOKE_APP=public SMOKE_BASE_URL=https://velverahub.com SMOKE_REQUIRE_SUPABASE=1 npm run smoke
SMOKE_APP=public SMOKE_BASE_URL=https://velverahub.co.uk SMOKE_REQUIRE_SUPABASE=1 npm run smoke
SMOKE_APP=admin SMOKE_BASE_URL=https://velverahub.org SMOKE_REQUIRE_SUPABASE=1 npm run smoke
SMOKE_APP=shop SMOKE_BASE_URL=https://velverahub.shop SMOKE_REQUIRE_SUPABASE=1 npm run smoke
```

After migrations and seed inventory are present, add
`SMOKE_REQUIRE_CATALOGUE=1` to one public-root check. That performs a read-only
Supabase request and requires an active, in-stock product to be visible through
public RLS.

These commands use the repository's local verification script; they are not
part of the Pages deployment process.

## Supabase setup

For the canonical migration order, conditional legacy scripts, operator
promotion notes, and read-only verification step, see
[`database/run-schema.txt`](../database/run-schema.txt).

Run these files in order in the Supabase SQL editor:

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
13. `database/client-error-logging.sql`

For an existing database that reports PostgreSQL error `42702` while removing
or cleaning up failed listing media uploads, apply
`database/fix-product-media-delete-ambiguity.sql` after the base RLS migration.

The dashboard-named SQL migration adds Supabase tables, RLS policies, and
database RPCs for branding, seller advertisements, private product conversations,
listing moderation, and admin operations. It does not deploy a Cloudflare endpoint.
The schema migration adds moderation fields and the buyer/seller conversation
tables. Public product and image reads require an approved moderation decision;
older live listings are preserved as approved. The shop-owner migration adds owner
onboarding, private verification storage, payout-account references,
earnings/withdrawal tables, guarded RPCs, and regional payment attempt/event/
refund records. The compliance migration adds document submission, an
admin-only review queue, append-only review history, and approval protection
for shops. Neither migration enables provider checkout.

The delivery-options migration adds seller-selected pickup/local/regional
delivery indicators and an optional 300-character note. It does not set prices,
delivery coverage, or timing; sellers and buyers must confirm those separately.

Product conversations are accessible only to the buyer and current seller.
Messages are created through authenticated RPCs; direct browser inserts and
updates are revoked. Listing moderation is separate from the existing product
availability and promotion-request statuses. Declined listings retain their
content and review reason until the seller edits and resubmits them. Apply the
updated `database/schema.sql`, `database/supabase-rls.sql`, and
`database/cloudflare-dashboard.sql` files in the listed order before enabling
these screens in production.

The base RLS migration:

- limits public reads to active shops/products and active product images;
- limits product and relational image CRUD to the authenticated shop owner;
- creates or updates the public `product-images` bucket and the public
  `product-videos` bucket for independent campus listings;
- accepts only WebP images up to 5 MiB and MP4/WebM/QuickTime videos up to
  50 MiB;
- requires a product UUID folder and a generated UUIDv4 filename with the
  matching media extension;
- enforces the campus limit of six images and videos combined with an atomic
  per-listing counter and private Storage-object ledger, so parallel direct
  Storage uploads cannot reserve the same remaining slot;
- keeps shop uploads image-only and uses the configured shop image limit.

The product row must exist before its images are uploaded. This allows the
Storage insert policy to verify the product UUID and its owning shop.

### Production upload-policy acceptance

After applying `database/supabase-rls.sql` in the Supabase SQL editor, check that
the production schema has the restrictive upload policy and both quota triggers:

```sql
SELECT policyname, permissive, cmd
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND policyname IN ('restrict product media uploads', 'restrict product media updates');

SELECT tgname
FROM pg_trigger
WHERE tgrelid = 'storage.objects'::regclass
  AND NOT tgisinternal
  AND tgname IN ('enforce_product_media_object_quota', 'release_product_media_quota');
```

Then, using an authenticated test seller and a disposable listing they own,
send direct Storage API requests (not the marketplace upload form) with seven
distinct, valid image/video paths at the same time. Exactly six combined
uploads should succeed and at least one should be rejected. Repeat with an
invalid filename and with another seller's listing; both must be rejected.
Also confirm the bucket still rejects unsupported MIME types and oversized
objects. Remove the test objects and listing afterward. Do not mark Upload
Limits complete until these checks have been run against production.

For operator role setup, `database/admin.sql` and `database/seller.sql` only
expose role-promotion functions to `service_role`; they do not create browser
admin or seller controls. Direct SQL promotion also needs a transaction-local
`service_role` claim because the profile-security trigger otherwise preserves
the old role. Follow `docs/operator-runbook.md`; never set this context in a
browser.

For a legacy database that has `public.profiles` but predates the deletion
request additions, apply `database/account-deletion.sql` separately. A fresh
database does not need it because `schema.sql` includes those objects.

### Account-deletion request queue and operator completion

`database/cloudflare-supabase-direct.sql` installs the request and admin queue
RPCs. It does not delete Supabase Auth users. Apply it after the schema, admin,
security-hardening, and Cloudflare dashboard migrations listed above.

Run this read-only check in the Supabase SQL Editor after applying the migration.
Expected results: the table exists; anonymous execution and direct table reads
are false; signed-in execution is true for the request RPC and the two
admin-gated RPCs.

```sql
select
  to_regclass('public.data_deletion_requests') is not null as queue_table_exists,
  has_function_privilege('anon', 'public.request_account_deletion()', 'execute') as anon_can_submit,
  has_function_privilege('authenticated', 'public.request_account_deletion()', 'execute') as signed_in_can_submit,
  has_function_privilege('anon', 'public.admin_list_account_deletion_requests(text)', 'execute') as anon_can_call_admin_list,
  has_function_privilege('authenticated', 'public.admin_list_account_deletion_requests(text)', 'execute') as signed_in_can_call_admin_list_gate,
  has_function_privilege('anon', 'public.admin_update_account_deletion_request(uuid,text)', 'execute') as anon_can_call_admin_update,
  has_function_privilege('authenticated', 'public.admin_update_account_deletion_request(uuid,text)', 'execute') as signed_in_can_call_admin_update_gate,
  has_table_privilege('authenticated', 'public.data_deletion_requests', 'select') as signed_in_can_read_queue;
```

The `authenticated` grants let the RPC perform its own role check; they do not
make the admin queue available to every signed-in user. Verify with a dedicated
standard test account and a dedicated admin account, never a real customer's
account:

1. Sign in as the standard user, submit a deletion request, and confirm the UI
   displays its reference and says the account is not deleted yet. A second
   submission should return the existing pending request rather than create a
   duplicate.
2. As that standard user, verify the admin-list and admin-update RPC calls fail
   with an administrator-required error. The user should not be able to read the
   request table directly.
3. Sign in at the admin Pages root, open **Account deletion**, find the
   reference, and move it from **Awaiting review** to **In review**. Verify
   that the status filter returns it under the new status.
4. For a disposable test request that is not being deleted, reject it. Verify
   it appears as **Rejected** and cannot be changed again. Test the **Completed**
   transition only after actually deleting the dedicated test Auth user and
   finishing its eligible data cleanup.

For a real request, the trusted operator must complete the following outside
the static browser before selecting **Mark complete**:

1. Move the request to **In review**. In Supabase SQL Editor, resolve the
   request reference to its profile and Auth user IDs; use the returned IDs
   only in the authorized operator workflow:

   ```sql
   select r.request_id, r.status, r.user_id as profile_id,
          p.user_id as auth_user_id
   from public.data_deletion_requests as r
   left join public.profiles as p on p.id = r.user_id
   where r.request_id = 'VH-REPLACE-WITH-REQUEST-REFERENCE';
   ```

2. Verify the exact account against the request using the organization's
   identity-check policy. Review foreign-key relationships and legal or
   financial retention requirements before removing or anonymizing any public
   data; do not issue a blanket cascade or delete required transaction records.
3. Delete the verified Auth user through Supabase **Authentication → Users**
   or another trusted Supabase Auth admin workflow. Complete and verify the
   approved cleanup of eligible profile and related personal data separately.
   The queue's `user_id` references `profiles.id`, not `auth.users.id`; the
   lookup above maps the request to the Auth ID.
4. Retain the queue audit row. Anonymize `email_at_request` only when the
   retention policy permits it. If Auth deletion or cleanup cannot be
   completed, leave the request **In review** and do not mark it complete.
5. Only after both Auth deletion and eligible cleanup are verified, use the
   admin queue's **Mark complete** action. That RPC records queue status; it
   does not delete users or data.

Never put a service-role key, database password, or other privileged credential
in a Pages root or browser configuration. No Worker or Pages Function is
required for this manual operator process.

## Separate static shop-owner Pages project

Deploy `velverahub-shop/` as its own static Pages project for
`velverahub.shop`:

- Build command: none
- Output directory: `.`
- Do not deploy it as a Worker
- Keep only the public Supabase URL and anon key in browser configuration.
  Provider secrets and Supabase service-role credentials must remain server-side.
- Apply the ordered migrations above before testing signup or shop onboarding.

New sellers can create an account from the portal sign-in screen. Independent
sellers remain seller accounts until they explicitly create a shop in this
portal. Shop creation starts in `pending`; the owner must then submit 1–5
private identity/business documents. The shop enters the admin review queue
only after that secure submission succeeds. Only an approved shop can publish
shop products.

After signing in, a seller selects **Create a shop** in the Shop section of the
portal navigation. The form calls the authenticated
`shop_owner_create_shop` Supabase RPC directly with the shop name, handle,
country, city, contact email, and optional description. The portal then reads
the seller's own shop status and opens the private document-submission form.
Document uploads use the private `shop-verification-private` bucket and the
owner-guarded `shop_owner_submit_verification_documents` RPC. Admins review
submitted documents through the separate `velverahub-admin/` project; no
shop listing is publishable before approval. This onboarding flow runs
browser-to-Supabase and does not require a Worker, Pages Function, or Express
API. Apply both `database/shop-owner-payments.sql` and
`database/shop-verification-compliance.sql` so the RPCs, private storage
policies, and admin review grants are present.

## Verification boundary

`npm run smoke` checks the storefront, shopper pages, regional seller
workspace, standalone shop portal, admin entry, shared support assets, and
public Supabase config. Use
`SMOKE_REQUIRE_SUPABASE=1` for runtime configuration and
`SMOKE_REQUIRE_CATALOGUE=1` only after production inventory is loaded.
Supabase Auth, public catalogue reads, seller-owned listing operations, shop
onboarding, the supported pending-order flow, seller ad requests, and guarded
admin RPCs run directly against Supabase. Account-deletion requests are queued
for admin review; completing a request still requires deleting the Auth user
through Supabase's trusted admin tooling. Do not put a database URL, password,
service-role key, or other privileged credential in a static root. The local
Express server remains for development and smoke tests only; it is not part of
the Pages deployment.

```sh
AUTH_BROWSER_BASE_URL="https://your-pages-domain.example" npm run auth:browser
```

That check requires test-account environment variables and does not print
credentials.

The request-queue migration was applied to the live Supabase project on 14 Oct
2026. Its RLS and grants were verified, and dedicated customer/admin accounts
passed the authenticated RPC status checks recorded below. Never mark a request
complete before trusted Auth deletion and approved personal-data cleanup have
been verified.

## External smoke status (14 Oct 2026)

These results were collected from the workspace against the documented custom
domains:

- `velverahub.com` and `velverahub.co.uk`: storefront routes and public
  Supabase configuration respond successfully. The `.html` routes use
  same-origin `308` redirects to extensionless routes; the smoke script follows
  these redirects and verifies the final page. Both roots report
  `STATIC_ONLY: true` with an empty `API_ORIGIN`.
- Both regional domains serve `assets/js/pages/account-privacy.js`, but the
  deployed file does not contain the `request_account_deletion` RPC call in the
  repository source. The external request-flow check fails; sync and redeploy
  the Pages roots before treating account-deletion submission as live.
- `velverahub.org` and `velverahub.shop` return Cloudflare HTTP 403 responses
  marked `cf-mitigated: challenge` for both the root and
  `assets/js/config.js`. The automated check cannot inspect those deployed
  roots or confirm their `API_ORIGIN` values; verify them from an authorized
  browser or adjust the Cloudflare challenge policy for the smoke runner.
- Public Supabase REST reads for active shops and active, in-stock products
  both return HTTP 200 with zero visible rows. This is not an HTTP permission
  error, but it does not prove catalogue RLS visibility until real inventory is
  present.
- The local `npm run apps:production:check` passes for all four static roots.
- The request-queue migration is applied. Post-apply checks confirmed queue RLS
  is enabled, anon cannot call the request/admin RPCs, authenticated users
  cannot read the table directly, and signed-in RPC execution is available.
- The dedicated customer/admin RPC test passed: customer submission entered
  `received`, a duplicate reused the pending request, customer admin/list and
  direct-table access were denied, and the customer account stayed active. The
  admin moved the test request `received` → `in_review` → `rejected`; direct
  completion before review and reopening a rejected request were rejected. The
  test request remains rejected; neither Auth user was deleted. The Completed
  transition was intentionally not exercised because it requires actual Auth
  deletion and approved data cleanup first.
- Those checks exercised Supabase RPCs directly, not the deployed pages UI.
  The NG/UK account-privacy asset is stale, and the admin Pages root remains
  behind a Cloudflare challenge, so redeploy/access checks are still required
  before considering the live browser flow verified.