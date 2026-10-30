# VelveraHub Master Roadmap

**Updated:** 30 October 2026
**Release decision:** **DO NOT LAUNCH YET**

This is the current source of truth, consolidated from `improvement.md`, `finalassessment.md`, the previous `roadmap.md`, and the repository checks run during this review. The two dated review files are retained as historical evidence; their current status is superseded by this document.

## Status definitions

- **PASS** — implemented and verified in the repository or local preview. This does not prove the deployed production service is correct.
- **NEEDS REVIEW** — implementation exists or is partial, but a complete audit, external migration, production test, or owner approval is still required.
- **BLOCKED** — completion depends on an operator detail, production access, a provider, or another external control that is not available in this repository.

## Summary

The project has substantial marketplace, security, mobile, and operational groundwork. The current local product, payment, storage-safety, generated-app, image-alt, and smoke checks pass. A production read-only Supabase preflight before the latest media-settings checks returned 46 of 47 checks as passing; both product-media buckets had null size and MIME limits. Migration 15 now defines seller-friendly admin controls, fixed Storage ceilings, and database enforcement locally, but it has not been applied to production or verified in staging.

The expanded 66-item production checklist contains **20 PASS, 37 NEEDS REVIEW, and 9 BLOCKED** items. Do not treat a local PASS or metadata-only database check as evidence that an authenticated production upload, payment flow, or domain has been tested. The release decision remains **DO NOT LAUNCH YET**.

## Work completed

### Changes in this review

- Rendered the checked-in brand mark immediately rather than waiting for remote branding settings, and added a retry to the local footer-logo fallback.
- Prevented generic site SEO settings from overwriting listing-specific product titles, descriptions, canonical URLs, and sharing metadata.
- Removed the unverified “Ltd.” company suffix and “trusted products” claim from shared footer copy.
- Updated Express within major version 5 and pinned its vulnerable router dependency to patched `path-to-regexp` 8.4.2.
- Replaced a timing-sensitive product-form regression wait with Playwright visibility waits.
- Synchronized shared navigation changes across the Nigeria, UK, shop-owner, and admin static roots.
- Replaced the cookie settings dialog and separate personalization prompt with one accessible, two-choice Decline/Accept banner; optional analytics now follows the same consent decision.
- Expanded the read-only Supabase preflight to check Storage ownership/validation policies and quota triggers, deletion-request access, checkout RPC access, idempotency indexing, and server-only payment tables.
- Extended the read-only preflight to cover the manual-payment migration's tables, RLS, and RPC grants; the production manual-payment schema was applied on 29 October, with no receiving destination configured or enabled.
- Re-ran the read-only production preflight on 30 October. Ownership policies, quota triggers, moderation metadata, and manual-payment grants are present; product bucket size/MIME restrictions are not.
- Corrected the Cloudflare upload-acceptance instructions to require disposable staging accounts and prohibit write tests against production.
- Added a staging acceptance runbook covering disposable-account checks, evidence handling, and the payment-provider test matrix.

### Production checklist items marked PASS

- **Legal and privacy:** Refund policy, cookie policy, opt-in cookie-consent banner, and linked form acknowledgements.
- **Security and reliability:** API rate limits, payload/resource limits, database/API timeouts, and redacted request/error logging.
- **UX and accessibility:** Shared loading/empty states, image alt-text audit, mobile breakpoints, and scroll-aware mobile navigation.
- **SEO and discoverability:** Page titles/descriptions, `robots.txt`, `sitemap.xml`, and favicon/app-icon set.
- **User flows:** Registration/order/listing success page and the final-readiness report.

### Marketplace and product work already present

- Nigeria/UK regional pricing, locations, phone formats, delivery coverage, location-aware search, and product filters.
- Responsive storefronts and mobile navigation; Supabase-first seller product management and compressed image lifecycle.
- Loading, empty, error, and expired-session states across storefront, seller, and admin surfaces.
- Delivery promises and reliability signals using seller handling time, location, cut-offs, courier SLAs, weekends, holidays, and inventory checks.
- Consent-gated discovery events, recommendation experiments, and admin reporting; seller demand/reorder/pricing tools.
- Product quality/provenance checks, duplicate-listing warnings, and private seller benchmarks.
- Server-side order price/stock calculation and order-creation idempotency. Card payments remain disabled until payment providers and webhooks are implemented and verified.
- Authenticated API deployment contract, health endpoints, CORS controls, shared static-root parity checks, operator runbook, and mobile regression tooling.

### Local verification recorded in this review

- `npm run test:product-meta`
- `npm run test:messages-moderation`
- `npm run test:storage-policy-safety`
- `npm run test:category-images`
- `npm run test:domain-routing`
- `npm run audit:image-alt`
- `npm run apps:check`
- `npm run apps:production:check`
- `npm run smoke`
- `npm run test:storage-policy-safety` — passed; this is a static repository test, not a live Supabase request.
- `npm run test:cookie-consent`
- `npm run test:supabase-readiness` — validates the local migration manifest and safe-check definitions; it does not connect to Supabase.
- `npm run apps:check` and `npm run apps:production:check` — both pass after synchronizing all four generated roots.
- `npm run smoke` — API, route, CORS, and static-root checks pass after the workflow restart.
- 30 October re-run: all eight focused product, message-moderation, storage-safety, Supabase-readiness, cookie-consent, manual-payment, category-image, and domain-routing test scripts pass; both generated-root checks, the image-alt audit, and the smoke suite pass.
- Filtered mobile regressions at 320px, 390px, and 430px pass across the storefront, regional, admin, and shop-owner roots. The 320px matrix was rerun after the final analytics-consent change.
- Preview checked at 1024px desktop and 402px mobile; the two-choice banner renders and the browser console is clean.
- `npm audit` — 0 vulnerabilities after the dependency update.
- Focused mobile regression at 320px for the parent storefront and standalone shop-owner portal.
- Full `npm run mobile:regression` — completed with exit code 0 across the configured viewport and app-root matrix.

## Supabase and payment acceptance status — 30 October 2026

### Confirmed from the repository

- `database/run-schema.txt` defines the 15-step Supabase migration order: `schema.sql`, `seller.sql`, `admin.sql`, `supabase-rls.sql`, `security-hardening.sql`, `cloudflare-dashboard.sql`, `cloudflare-supabase-direct.sql`, `production-hardening.sql`, `shop-owner-payments.sql`, `shop-verification-compliance.sql`, `seller-contact-safety.sql`, `product-delivery-options.sql`, `client-error-logging.sql`, `marketplace-manual-payments.sql`, and `marketplace-media-settings.sql`.
- `database/account-deletion.sql` is a **legacy-only** migration. The runbook says to apply it after `schema.sql` and before `cloudflare-supabase-direct.sql` only when the older database lacks the deletion-request objects. Do not apply it as an extra migration to a fresh/current schema.
- The supplied storage-test path `scripts/test-storage-policy-safety.mjs` does not exist. The actual test is `scripts/storage-policy-safety.test.mjs`, run by `npm run test:storage-policy-safety`; it checks source and SQL invariants without contacting Supabase.
- `docs/cloudflare-pages.md` contains direct Storage acceptance steps for a dedicated staging project: verify the admin-controlled defaults and a temporary settings change, then concurrently upload eleven distinct valid objects to a disposable listing at the default cap of ten. Verify cross-owner and invalid-path/MIME/size rejections and clean up the test objects. Production write tests are prohibited.
- `database/production-hardening.sql` derives checkout totals from database product prices, locks products, enforces stock and idempotency, and allows only cash-on-delivery or bank-transfer orders. The repository has no current evidence that the latest RPC has passed a staging invocation.
- `docs/payment-architecture.md` confirms the existing plan: Paystack Transaction Splits/subaccounts for Nigeria and Stripe Connect for the UK. This remains design/data-model work: there are no provider charge, signature-verification, refund, settlement, or reconciliation handlers. The API accepts only offline payment methods.
- `database/safety-verification.sql` checks whether the key Storage, deletion, checkout, idempotency, regional payment, manual-payment, and media-settings objects are installed and safely granted. It remains a read-only metadata check and cannot prove real owner/cross-owner behavior.
- `docs/staging-acceptance.md` defines the staging-only tests and sanitized evidence format. No staging test was run in this workspace.
- On 30 October, before the new media-settings checks were added, the read-only production preflight returned 46/47 checks passing. The failed bucket check and a separate metadata-only query confirmed both `product-images` and `product-videos` had `file_size_limit` and `allowed_mime_types` unset. The new step 15 is local only; no production migration or write test has been run for it.
- The 29 October production migration for manual marketplace payments was previously verified for table RLS and RPC grants. No Nigeria or UK receiving destination exists or is enabled, and no checkout/order/confirmation behavior has been tested.
- The cookie change is synchronized to all generated roots and verified with `apps:check`, `apps:production:check`, unit coverage, and filtered browser regressions. This is local preview evidence, not deployed-domain evidence.

### Existing external evidence (not re-run in this review)

- `docs/cloudflare-pages.md` records that the account-deletion request-queue migration was applied on 14 October 2026, with RLS/grants checked and disposable customer/admin RPC tests passed for submission, duplicate reuse, access denial, and transitions through `rejected`.
- The record explicitly says the `completed` transition and Auth-user deletion were not performed; test accounts remained active. It also records stale deployed `account-privacy.js` files on the NG/UK roots and a Cloudflare challenge blocking automated inspection of the admin/shop roots.
- No external record confirms the seven-upload quota test, cross-owner upload denial, invalid upload rejection, current `place_order_secure` staging behavior, or manual-payment order/receipt behavior. The earlier improvement review said that RPC was missing from the live schema cache at that time.

### Access required to complete the acceptance tests

- A production database connection was available for read-only catalog checks, but this workspace has no dedicated Supabase staging project or disposable test accounts. No payment credentials were accessed or exposed. The managed Stripe connector is optional; it is not connected. Paystack is not offered by the current managed payment connector flow.
- Do not run storage, checkout, account-deletion, or payment writes against the live project. Complete acceptance only with a dedicated staging Supabase target, disposable seller/customer/admin accounts, provider test-mode accounts, and server-only credentials stored through the secure secrets flow. Paystack and Stripe Connect adapters, webhook handling, refunds, settlement, and reconciliation are still unimplemented.

## Pending work and launch gates

### 1. Legal, privacy, and marketplace integrity

| Item | Status | Required next step |
|---|---|---|
| Privacy Policy | NEEDS REVIEW | Confirm the real operator, jurisdiction, contact details, data flows, retention, and cross-border processing; obtain appropriate legal review and verify publication on every public domain. |
| Terms of Service | NEEDS REVIEW | Confirm governing law, operator details, marketplace/payment/delivery/dispute terms, and that the text matches the actual seller and buyer workflows. |
| Business details and real contact address | BLOCKED | Supply the verified legal/operator name, registration details, jurisdiction, and address/contact information. Do not invent these details. |
| Minimize data collection | NEEDS REVIEW | Audit forms, API payloads, database fields, cookies, logs, and analytics events; remove data not required for the stated purpose. |
| Third-party SDK and asset review | NEEDS REVIEW | Inventory Supabase, Google Fonts, Font Awesome, external APIs, and other scripts/assets; record purpose, access, necessity, retention, and commercial licensing, then approve or remove each. |
| Dark patterns | NEEDS REVIEW | Audit consent, cancellation, account, seller, checkout, and promotional flows for preselected choices, coercive copy, hidden controls, or misleading hierarchy. |
| Fees and pricing disclosure | NEEDS REVIEW | Verify all mandatory buyer/seller fees, delivery charges, taxes, commissions, and regional pricing before users commit. |
| Review integrity | NEEDS REVIEW | Verify reviews are tied to eligible transactions, approval/moderation is server-enforced, and no seeded or fabricated reviews/ratings are presented as genuine. |
| Unsupported marketing claims | NEEDS REVIEW | Review badges, guarantees, ratings, trust language, and performance claims against evidence. The unsupported footer wording found in this pass has been removed; the wider audit remains. |
| Account data deletion | NEEDS REVIEW | Follow `database/run-schema.txt`; use `database/account-deletion.sql` only for a legacy schema. The 14 October request-queue/RLS checks passed, but Auth-user deletion and final data cleanup were intentionally not performed. Test the complete operator workflow on staging with disposable accounts and document retention. |
| Children’s data / age consent | NEEDS REVIEW | Verify every regional and external sign-up path enforces the intended age restriction and that the policy matches applicable law. |
| Marketing email unsubscribe | NEEDS REVIEW | No marketing sender is configured. If marketing email is enabled, implement and test reliable unsubscribe handling before sending. |
| Font/image licensing | NEEDS REVIEW | Confirm commercial rights for bundled images, fonts, icons, and third-party CDN assets. |

### 2. Security, payments, and reliability

| Item | Status | Required next step |
|---|---|---|
| Upload limits | NEEDS REVIEW | Step 15 now implements admin-controlled defaults (10 shop photos/listing, 10 independent-listing media, 10 MiB compressed photos, 100 MiB videos), bounded controls, client guidance, and database size/MIME enforcement locally. It is not applied in production; both production bucket limits remain unset. Apply and test in dedicated staging, including an admin settings change, 11-upload quota, cross-owner, invalid-path/MIME/size checks, before any production migration. |
| Duplicate subscriptions | NEEDS REVIEW | No complete subscription flow is configured. Confirm subscriptions are not advertised; if introduced, make creation idempotent across retries and races. |
| Duplicate payments and webhooks | NEEDS REVIEW / BLOCKED | Order creation is idempotent, but provider charge execution, signed webhooks, replay protection, refunds, and authoritative reconciliation are not complete. Implement and stage-test Paystack for Nigeria and Stripe Connect for the UK before enabling card/wallet payments. |
| Manual bank-transfer payments | NEEDS REVIEW | The production schema is applied, but no authorized Nigeria/UK receiving account is configured or enabled and no staging order/receipt tests have run. Verify the flow in staging first; then an authorized admin must configure only confirmed account details in the admin workspace. Do not send bank details in chat. |
| Error handling and failed requests | NEEDS REVIEW | Complete the cross-surface audit for database, network, auth, upload, and payment failures; verify safe messages, retry rules, preserved form state, and duplicate-submit protection. |
| Uptime and production monitoring | BLOCKED | Choose a monitoring provider and responsible alert destination; cover storefront/API health, database, payment, and critical error signals. |
| Concurrent usage | NEEDS REVIEW | Run controlled load/concurrency tests for sign-in, search, listing creation, checkout, inventory locks, and seller operations; fix races and document capacity. |
| Backup restoration | BLOCKED | Perform and document a controlled production restore, including recovery point/time and required external dependencies. |
| Spending caps | BLOCKED | Configure provider, storage, email, analytics, and infrastructure budgets and alerts with the relevant account owners. |
| Shared rate-limit storage | NEEDS REVIEW | Current limits are in-memory. Use a shared store or deployment guarantee before running multiple API instances. |

### 3. Database and performance

- **NEEDS REVIEW — Query optimization:** inspect production query plans and slow-query evidence before changing indexes or query shapes.
- **NEEDS REVIEW — Indexes:** validate existing schema indexes with production `EXPLAIN`/workload evidence.
- **NEEDS REVIEW — Pagination:** audit direct Supabase reads for orders, reviews, and messages as well as API responses; ensure no user-facing query can return unbounded results.
- **NEEDS REVIEW — Caching:** add shared caching only for safe repeat reads, with explicit expiry and invalidation rules.
- **NEEDS REVIEW — Compression:** verify Brotli/Gzip, image, and font compression on the deployed Cloudflare and API domains.

### 4. Accessibility, mobile UX, and SEO

- **NEEDS REVIEW — Contrast, keyboard access, and form errors:** complete page-wide WCAG contrast and keyboard audits; verify every form identifies errors accessibly and preserves valid input.
- **NEEDS REVIEW — CTA placement:** check key landing, product, and category pages at mobile and desktop sizes.
- **NEEDS REVIEW — Open Graph and image SEO:** verify production absolute image URLs, canonical product metadata, alt text, dimensions, loading, and indexable filenames across all regional domains.
- **NEEDS REVIEW — Sticky mobile CTA:** assess only pages with a clear conversion action; avoid obscuring content or safe-area controls.
- **NEEDS REVIEW — Canonical URLs:** verify query parameters, product URLs, and Nigeria/UK/shop/admin domain routing after deployment.

### 5. Deployment and final production gate

- **BLOCKED — Production Cloudflare/Supabase:** verify the remaining ordered migrations and deploy the latest static roots. Manual-payment migration 14 is applied, but upload bucket limits are unset and authenticated upload/checkout/deletion behavior has not been tested.
- **NEEDS REVIEW — Environment and secrets:** verify production secrets remain server-side and deployed static bundles contain only intended public configuration.
- **NEEDS REVIEW — Debug/test cleanup:** audit production bundles, endpoints, sample data, test accounts, and debug settings.
- **NEEDS REVIEW — Security headers:** verify CSP, HSTS, frame, referrer, and permissions policies on every deployed domain without breaking required flows.
- **NEEDS REVIEW — Authentication/authorization:** complete IDOR and Supabase RLS testing against production-like roles and data.
- **BLOCKED — HTTPS/domains:** verify Cloudflare deployment, certificates, redirects, and canonical host behavior for every public domain.
- **BLOCKED — Full production audit:** test registration, seller onboarding, listings, search, checkout/payment, refunds, account settings/deletion, email, mobile/accessibility, monitoring, backups, and concurrent use in the production environment.

**Release gate:** Do not launch or enable card payments until the blocked items are resolved and the NEEDS REVIEW items have production evidence. Keep checkout limited to the currently supported offline methods until provider/webhook flows are verified.

## Owner input needed to clear the remaining gates

- Verified legal/operator name, registration jurisdiction and number, business address, and support contact; obtain legal review of privacy, terms, age/eligibility, fees, delivery, returns, and dispute wording.
- Confirm the first launch markets and seller eligibility/KYC approval process, listing moderation rules, commissions, buyer/seller fees, taxes, delivery responsibilities, and refund/dispute policy.
- Provide a separate staging Supabase project and disposable buyer, seller, and admin accounts. Keep credentials in workspace Secrets; do not put them in chat.
- Confirm whether the launch will use manual bank transfer only. After staging tests, an authorized admin should enter verified Nigeria and/or UK receiving details directly in the authenticated admin workspace; keep each market disabled until verified.
- Supply Paystack/Stripe business onboarding and test-mode access only if card/wallet payments are part of launch. Card/wallet payments must remain disabled until signed webhooks, refunds, settlement, and reconciliation are implemented and tested.
- Provide access to the existing Cloudflare Pages account and confirm the production domains so the latest static roots, security headers, redirects, and certificates can be checked and deployed.
- Choose an uptime/alert destination, backup-restore owner and window, and spending caps/alert limits for Supabase, storage, email, analytics, and hosting.

## Product growth roadmap after launch gates

1. Define event taxonomy, buyer/seller outcomes, and contribution-margin metrics.
2. Pilot verified seller trust and delivery promises in one Nigerian city cluster and one UK region.
3. Use measured experiments to improve ranking, recommendations, and seller next-best actions.
4. Scale only after reliability, fraud controls, support capacity, and unit economics meet agreed thresholds.

## Source documents

- `improvement.md` — 25 September 2026 implementation review and UI/platform backlog snapshot.
- `finalassessment.md` — 7 October 2026 production checklist and external verification record.
- `PRODUCTION_READINESS_REPORT.md` — detailed evidence snapshot with the 21 October local verification update; append production evidence as those checks are completed.