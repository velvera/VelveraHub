# VelveraHub production-readiness review

Updated: 2026-09-25

> Historical review snapshot. The current consolidated status and next steps are maintained in [`roadmap.md`](roadmap.md), updated 21 October 2026.

## Completed in this pass

- Removed shopper-facing fabricated catalogue, recommendation, shop-directory, shop-detail, and checkout sample data.
- Added honest loading, empty, and unavailable states when the live catalogue cannot be reached.
- Routed catalogue, recommendations, shops, and shop products through Supabase-first queries so the static Cloudflare Pages deployment does not depend on Express.
- Removed the fake card, PayPal, and Apple Pay controls. Checkout now offers only order methods that do not claim to process a card payment, and orders remain `pending` until payment is confirmed.
- Changed browser checkout submissions to contain product IDs and quantities only.
- Hardened the Express order route: it reads prices and stock from the database, locks products in a transaction, rejects invalid/duplicate items, recalculates shipping/tax/total, decrements stock, and never trusts browser totals.
- Added `database/production-hardening.sql`, which provides the equivalent `place_order_secure` Supabase RPC for Cloudflare Pages and grants it only to `anon` and `authenticated`.
- Stopped persisting Supabase endpoints/keys in browser local storage and removed the old demo-mode configuration signal.
- Removed unconfigured payment-brand claims from the shared footer.
- Added a reproducible generated-app parity check for the shared storefront/admin assets, exposed it as `npm run apps:check`, and added a CI workflow that fails when a regional copy drifts.
- Added the authenticated API deployment contract: one configurable `API_ORIGIN`, deliberate bearer-token/no-cookie behavior, strict CORS allowlisting, documented deployment settings, and `/healthz` plus `/api/health` probes.
- Wired the authenticated API origin into browser auth/API requests, made cookie handling explicitly opt-out, added namespace health and CORS smoke checks, and removed the global search bar from account, auth, cart, checkout, and sell utility headers while retaining it on discovery pages.
- Replaced the generic payment-provider direction with a regional marketplace plan: Paystack Transaction Splits for Nigeria and Stripe Connect for the UK. Card checkout remains disabled until both payment lifecycles are implemented and verified.
- Fixed recommendation pagination to stop at the reported total, invalidate stale requests after location changes, and retain the 40-item initial load followed by 20-item pages.
- Fixed the generated-app drift check's initialization order and added a non-destructive `npm run apps:sync` overlay for regional storefronts and the standalone shop portal.
- Preserved public Supabase client settings when generated runtime configuration is loaded, so the storefront does not silently fall back to the local Express catalogue API.
- Added additive SQL for the shop-owner UI and provider-neutral payment attempts, webhook events, refunds, payout accounts, ledger, and withdrawal requests. The migrations are not yet applied to the live Supabase project.
- Added a standalone Cloudflare Pages deployment contract for `velverahub-shop/` and moved the old shop-owner entry point to a compatibility redirect.
- Added `docs/operator-runbook.md` for migration order, public config rotation, role promotion, pending-order handling, and regional release verification.
- Added the mobile interaction regression suite for 320px, 390px, and 430px viewports. It covers every storefront dropdown's selection, scroll retention, Escape/outside-click close behavior, safe-area bottom navigation, auth mode switching, checkout fields, seller dynamic forms, admin review forms, and shop-owner mobile registration/sidebar behavior.
- Verified `npm run apps:check`, `npm run smoke`, and `npm run mobile:regression`; the Replit preview initializes Supabase and renders the live catalogue.

## Required before enabling the live domain

1. In Supabase, apply the ordered migrations in `docs/cloudflare-pages.md`, including `database/production-hardening.sql` and `database/shop-owner-payments.sql`.
2. Put the public Supabase URL and anon key in the static browser configuration. The anonymous key is intended for browser use; never add a Supabase service-role key to Pages or frontend files.
3. Confirm the Supabase project has at least one `shops` row with `status = 'active'` and one `products` row with `status = 'active'` and positive stock. The storefront intentionally stays empty until real rows exist.
4. Configure and verify a real payment provider before offering card/wallet payments. The current checkout creates a pending order for cash-on-delivery or bank-transfer workflows; it does not process cards.
5. Test one order against a staging product: attempt altered browser prices, an out-of-stock quantity, duplicate product IDs, and a concurrent purchase. All invalid attempts should fail and stock should never go below zero.

## Remaining platform limitation

The NG, UK, admin, and shop roots are static Cloudflare Pages deployments. They do not include the repository-level `functions/` directory and do not execute Workers or `server.js`. The public catalogue and secure order RPC use Supabase directly. Seller/admin features that still call Express routes and optional `/api/*` endpoints need a separately hosted API before those features can be advertised as production-ready.

## Current external verification

- Supabase connectivity and a live product render were confirmed in the Replit preview on 2026-09-25.
- Last external check found that `place_order_secure` was not yet present in the live Supabase schema cache. The migration is now in the repository but still needs to be applied and verified against the project.
- The shared browser config contains the public Supabase URL and anon key. Repeat direct-read verification after the manual Pages deployment; never add a service-role key to static files.
- The `velverahub.shop` Pages project is prepared but has not been deployed; the user will deploy it manually.

## UI and product improvement backlog

Reviewed: 2026-09-25

These are follow-up ideas identified while reviewing the shared storefront, the
Nigeria and UK storefront copies, the seller workspace, and the admin app:

### Highest impact

1. **Add regional marketplace payment providers before advertising card checkout.**
   Use Paystack Transaction Splits/subaccounts for Nigeria and Stripe Connect
   for the UK. Keep the current pending-order behavior for offline methods,
   but make payment intent creation, webhook verification, refunds, seller
   settlement, and payment status transitions first-class before enabling cards
   or wallets. See `docs/payment-architecture.md`.
2. **[Complete] Deploy the authenticated API beside the public storefronts.** Seller and
   admin flows still depend on server routes that are not executed by a static
   Cloudflare Pages site. Establish one documented API origin, configure CORS
   and cookies deliberately, and add health checks for it. The autoscale
   deployment is configured to run `npm start`; publish it once, then set its
   resulting origin as `API_ORIGIN` in every static root.
3. **[Complete] Replace duplicated static storefront copies with a reproducible build
   artifact.** The four app roots are intentionally deployable separately, but
   shared HTML and assets should be generated in CI and checked for drift so a
   fix cannot land in only one region.
4. **[Complete] Create a mobile interaction regression suite.** Cover opening every
   dropdown, scrolling with a dropdown open, closing with Escape and outside
   click, safe-area bottom navigation, auth mode switching, checkout fields,
   and seller/admin dynamic forms at 320px, 390px, and 430px widths. The
   suite runs against the parent, Nigeria, UK, admin, and shop-owner surfaces.

### Experience and accessibility

5. **[Complete] Add a global focus manager for overlays.** Return focus to the trigger
   after closing, trap focus in full-screen location search, announce loading
   and empty states, and provide visible focus rings for keyboard and switch
   users.
6. **[Complete] Standardize async feedback.** Use one shared loading, retry, empty, and
   error pattern for catalogue, shops, account, checkout, seller, and admin
    screens, with a request ID in logs for support diagnostics. Added the shared
    browser feedback component and request-scoped support logging across these flows.
7. **[Complete] Improve search and discovery.** Add debounced suggestions, recent searches,
   spelling tolerance, filter chips that can be removed individually, and a
    result count that updates as the user changes location or category. Added recent
    search persistence, fuzzy catalogue fallback, and live filter/count refresh.
8. **[Complete] Make cart and checkout state resilient.** Revalidate prices, stock,
   delivery coverage, and currency immediately before checkout and explain
    every server-side correction in the confirmation step. Added a final live
    cart preflight with correction review before the authoritative order RPC/API call.

### Platform quality

9. **[Complete] Add image transformations and responsive sources.** Serve WebP/AVIF
   thumbnails at the rendered card size, reserve image dimensions to avoid
   layout shift, and provide an intentional fallback for missing catalogue
    media. Added Supabase storage transforms, responsive `<picture>` sources,
    intrinsic image dimensions, and a local placeholder fallback.
10. **[Complete] Harden browser security headers.** Add a production CSP, explicit
    referrer and permissions policies, stricter frame protection, and a plan
    for replacing third-party CDN scripts with pinned or self-hosted assets.
    Added the shared Express/Cloudflare header policy and documented the CDN
    migration sequence in `docs/security-headers.md`.
11. **[Complete] Add end-to-end observability.** Track catalogue failures, checkout
    abandonment, auth failures, slow API requests, and seller publish errors
    without collecting payment secrets or unnecessary personal data. Added
    privacy-bounded browser telemetry, server ingestion, slow-request logs, and
    the operational events schema.
12. **[Complete] Document operator workflows.** Add runbooks for applying database
    migrations, rotating public configuration, promoting seller/admin roles,
    handling failed orders, and verifying a regional deployment after release.