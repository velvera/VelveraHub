# VelveraHub Master Roadmap

**Updated:** 22 November 2026
**Release decision:** **DO NOT LAUNCH YET**

This is the current source of truth, consolidated from `improvement.md`, `finalassessment.md`, the previous `roadmap.md`, and the repository checks run during this review. The two dated review files are retained as historical evidence; their current status is superseded by this document.

## Status definitions

- **PASS** — implemented and verified in the repository or local preview. This does not prove the deployed production service is correct.
- **NEEDS REVIEW** — implementation exists or is partial, but a complete audit, external migration, production test, or owner approval is still required.
- **BLOCKED** — completion depends on an operator detail, production access, a provider, or another external control that is not available in this repository.

## Summary

The local implementation now includes 40 MiB per-file media limits, 10-item quotas, resumable TUS uploads for files above 6 MiB, progress/cancellation, requester-only account-deletion status visibility, stricter public review displays, and draft legal/support copy that no longer promises an unimplemented deletion or refund process. Migrations 15 and 16 remain local and unverified. No Supabase staging integration is connected, and the actual project plan/global Storage limit have not been inspected.

The 30 October checklist counts below are a historical snapshot, not the current status. Local tests and code changes do not establish staging or production readiness. The last recorded production preflight found both product-media bucket size/MIME limits unset; manual-payment schema exists in production but no receiving destinations are configured. No complete account-deletion acceptance or provider-payment acceptance has passed. The release decision remains **DO NOT LAUNCH YET**.

## Work completed

### Changes in this review

- Raised local product photo and video file ceilings to 40 MiB, while preserving 10 shop photos and 10 independent-listing media items; the project plan and global limit remain an explicit pre-migration check.
- Added shared standard/TUS upload handling: standard uploads through 6 MiB, 6 MiB TUS chunks above that, authenticated direct Storage requests, progress, cancellation, and retry/resume behavior for recoverable TUS interruptions.
- Added per-file progress/cancel UI to independent listings and seller product uploads; compressed photos are handled as blobs rather than expanded base64 data URLs.
- Replaced public fallback ratings and synthetic seller trust scores with an explicit verified-review-unavailable state; seller review reads now require both verified-purchase and approved flags.
- Reworked public shop discovery to avoid unsupported ratings/sales rankings and limited its shop query to fields needed for the directory.
- Marked privacy, terms, and refund text as drafts; removed the unsupported 14-day deadline and corrected the account-deletion wording to say that queuing a request does not delete the Supabase Auth user.
- Replaced escrow, trade-insurance, and unsupported security claims on the payment/support page with the current state: no Paystack/Stripe checkout and no escrow/insurance protection.
- Expanded staging guidance with the 40 MiB plan/global-limit precondition and standard-versus-TUS acceptance cases.
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
- Corrected the upload routing boundary to use standard uploads through exactly 6 MiB and TUS above 6 MiB; added a local boundary regression test. This does not establish that Storage accepts 40 MiB in staging or production.
- Added client-side extension and file-signature checks for WebP, MP4, WebM, and QuickTime product media before standard/TUS transfer. This is defense-in-depth only; the database trigger and Storage bucket restrictions validate metadata, not the complete file bytes.
- Expanded the public privacy/terms draft with the known data categories, current payment/deletion limitations, and explicit owner/legal placeholders; it remains unapproved and must not be treated as final legal advice.
- Kept the two-choice cookie consent banner and added a way to reopen it from the cookie policy so users can change their optional analytics choice.
- Expanded [`requiredinformations.md`](requiredinformations.md) with the owner decision form, current local implementation boundary, third-party inventory, and exact next-workflow steps.
- Checked the three supplied Supabase Storage documentation pages. They confirm the plan-level global maximum, that bucket limits cannot exceed the global limit, the 6 MiB TUS chunk size, and the recommendation to use TUS for larger or interruption-prone uploads. The target project's actual plan and global limit remain unverified.
- Tightened the mobile regression check to wait for the bottom-navigation scroll animation to settle before measuring its position; this removes a timing-only false failure without changing navigation behavior.
- Updated the Express dependency override for the reported body-parser advisory; the current dependency audit reports no vulnerabilities.
- Added a disaster-recovery runbook that separates database backups, Storage objects/settings, Cloudflare deployments, authentication, and payment reconciliation. It is a procedure only; no restore was performed.
- Added migration 16 and account-page status messages so a signed-in requester can see the latest deletion-request state without exposing the request email or implying that the Auth user or related data has been deleted.
- Added read-only preflight coverage and a local regression test for the requester-only deletion-status RPC; the account page checks for a signed-in session before calling it. The migration and UI remain unverified in staging.
- Synchronized the existing listing-upload cancellation-cleanup failure reporting into the Nigeria, UK, shop-owner, and admin app roots after targeted parity checks found stale copies. Kept all unrelated per-root files untouched.
- Improved mobile-regression console diagnostics to show the failing resource URL, which identified an anonymous request to the not-yet-applied deletion-status RPC; the UI now avoids that request unless a session exists.

### Previously passed local baseline checks on 30 October

These repository and preview checks are historical local evidence only; they do
not prove production readiness.

- **Privacy UX:** Opt-in cookie-consent banner and linked form acknowledgements. The public legal copy is now explicitly a draft pending owner and legal review.
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

### Local verification run on 21 November 2026

These checks ran against the local repository and Replit preview only. None
connected to Supabase staging or production.

- Passed: `npm run test:product-meta`
- Passed: `npm run test:messages-moderation`
- Passed: `npm run test:storage-policy-safety`
- Passed: `npm run test:storage-upload-service` — covers accepted/rejected product-media signatures, extension matching, the exact 6 MiB standard/TUS boundary, TUS chunk size, retry settings, direct Storage host, and progress callbacks; it does not upload to Supabase.
- Passed: `npm run test:marketplace-integrity`
- Passed: `npm run test:supabase-readiness` — checks local migration/read-only-check definitions only.
- Passed: `npm run test:cookie-consent`
- Passed: `npm run test:manual-payments` — source and SQL safety checks only.
- Passed: `npm run test:category-images`
- Passed: `npm run test:domain-routing`
- Passed: `npm run audit:image-alt` — 374 static image tags and 32 dynamic image elements checked across 259 HTML/JS files.
- Passed: `npm run apps:check` and `npm run apps:production:check` — generated-root parity and JavaScript syntax checks for all four app roots.
- Passed: `SMOKE_PORT=5000 npm run smoke` — local API health, routes, CORS, redirects, and static-root checks.
- Passed: `npm audit --omit=dev` — zero reported vulnerabilities.
- Passed: `git diff --check`.
- Passed: `npm run mobile:regression` run separately at 320px, 390px, and 430px; all configured parent, Nigeria, UK, admin, and shop-owner checks passed. The combined run was stopped by its five-minute timeout while running concurrently; the completed per-width runs are the evidence of the full viewport matrix.
- Browser screenshot of the legal page was checked in the local preview; the draft disclosures and cookie-preference control rendered, and no browser-console errors were reported.

An initial `npm run smoke -- --help` invocation was invalid for this script and
returned `Invalid URL`; the correct `SMOKE_PORT=5000 npm run smoke` command
passed. This invocation error is not an application or smoke-test failure.

### Latest local verification run on 22 November 2026

These are local repository/API/browser checks only. They did not use Supabase
staging or production:

- Passed: `npm run test:account-deletion-status` — requester-only response, session-gated status lookup, and honest queue-state wording.
- Passed: `npm run test:storage-upload-service`, `npm run test:storage-policy-safety`, `npm run test:marketplace-integrity`, `npm run test:supabase-readiness`, and `npm run test:manual-payments`.
- Passed: `npm run apps:check` and `npm run apps:production:check` after targeted root updates; generated JavaScript syntax and static-page parity checks pass for all four app roots.
- Passed: mobile regression at 320px and 390px in the combined run; isolated 430px run also passed across the parent, Nigeria, UK, admin, and shop-owner roots after preventing anonymous status-RPC calls. The combined run exceeded five minutes before the 430px pass, and the desktop portion was not run.
- Passed: `SMOKE_PORT=5000 npm run smoke` — local API health, routes, CORS, redirects, and static-root checks.
- Passed: `npm audit --omit=dev` — zero reported vulnerabilities.
- Passed: `git diff --check`.

The 430px run first exposed that an unauthenticated account page attempted to
call migration 16 before it exists in the hosted project; the page now checks
for a local session first. Signed-in status behavior remains unverified until
migration 16 is applied in staging. No production or staging readiness is
implied by these local passes.

### Production upload check on 22 November 2026

- A read-only call to `get_marketplace_media_limits()` against the configured
  production Supabase project returned 10 items per independent listing and
  40 MiB image/video limits.
- The user reports the Supabase project is on the Free plan. The documented
  Free maximum is 50 MB, so 40 MiB is below that plan ceiling; the project's
  actual global Storage limit and effective bucket settings were not verified.
- The reported image upload fails with `HTTP 500`, code `DatabaseError`. This
  points to a Storage/database-layer failure but does not identify the SQL
  exception or trigger. The Replit project has no active production deployment
  or Supabase integration, so its production logs are not available here.
- Do not claim the upload is fixed until the timestamped Supabase Storage log
  identifies and resolves the database error, then the seller upload passes.

## Supabase and payment evidence from 30 October 2026 (historical)

### Confirmed from the repository

- `database/run-schema.txt` defines the 16-step Supabase migration order. The current production media-settings RPC responds with 10-item quotas and 40 MiB limits, but migration history, effective bucket/global settings, and real upload behavior are not fully verified; migration 16 adds only a requester-scoped status lookup and is not verified in staging.
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
| Privacy Policy | NEEDS REVIEW | Public copy describes known data categories and current limitations but remains a draft. Confirm operator, jurisdiction, contacts, data flows, retention, and cross-border processing; obtain counsel review and verify each approved market. |
| Terms of Service | NEEDS REVIEW | Public copy now covers the current marketplace/payment model and unresolved regional terms, but remains a draft. Confirm governing law, operator details, fees, delivery, disputes, and statutory consumer protections with counsel. |
| Business details and real contact address | BLOCKED | Supply the verified legal/operator name, registration details, jurisdiction, and address/contact information. Do not invent these details. |
| Minimize data collection | NEEDS REVIEW | Public shop-directory reads now request only displayed fields. Finish the wider form, API, database, cookie, log, and analytics audit and remove unnecessary data. |
| Third-party SDK and asset review | NEEDS REVIEW | TUS is pinned to a specific CDN version; inventory all SDKs, fonts, icons, external images/APIs and their data access, necessity, licensing, and retention before approval. |
| Dark patterns | NEEDS REVIEW | Audit consent, cancellation, account, seller, checkout, and promotional flows for preselected choices, coercive copy, hidden controls, or misleading hierarchy. |
| Fees and pricing disclosure | NEEDS REVIEW | Checkout displays item subtotal, delivery, tax and total, but its fixed 7.5% subtotal tax calculation is not owner/legal approved or region-specific. Fees, commissions, delivery charges and regional rules remain unconfirmed. Verify each market before users commit. |
| Review integrity | NEEDS REVIEW | Storefronts no longer show fallback ratings or synthetic trust scores, and seller review reads filter to approved verified purchases. There is no complete customer review submission/eligibility workflow; verify its design and server enforcement before enabling reviews. |
| Unsupported marketing claims | NEEDS REVIEW | Removed rating/sales-ranked “Top Shops,” unverified buyer-protection score, escrow/trade-insurance promises, and unsupported 14-day refund copy from the reviewed pages. Continue the site-wide claims audit. |
| Account data deletion | BLOCKED | Deletion requests are queued only; the approved privileged Auth-user deletion path is not implemented or available in static Pages. The 14 October queue/RLS tests did not verify deletion. Complete and stage-test the operator workflow. |
| Requester-visible deletion status | NEEDS REVIEW | Migration 16 and account-page status text are implemented locally with a narrow status-only response. Apply it to staging and verify buyer isolation; it does not perform Auth deletion or associated-data cleanup. |
| Children’s data / age consent | NEEDS REVIEW | Registration forms request an 18+ confirmation, but the owner and counsel must confirm the minimum age and regional legal requirement; verify every signup path and record retention. |
| Marketing email unsubscribe | NEEDS REVIEW | No marketing sender is configured. If marketing email is enabled, implement and test reliable unsubscribe handling before sending. |
| Font/image licensing | NEEDS REVIEW | Inventory and confirm commercial rights for bundled images, fonts, icons, and third-party CDN assets; repository availability is not proof of a license. |

### 2. Security, payments, and reliability

| Item | Status | Required next step |
|---|---|---|
| Upload limits | NEEDS REVIEW | The user confirms Supabase Free. A read-only production RPC returns 40 MiB app limits and the two 10-item quotas; the documented Free maximum is 50 MB, but the actual global limit and bucket settings are not confirmed. The reported upload returns HTTP 500 `DatabaseError`, requiring the underlying Supabase Storage/database log before a root-cause fix can be verified. The last bucket metadata preflight on 30 October found both buckets unrestricted. Do not increase limits; inspect the actual global/bucket settings and test in staging. |
| Duplicate subscriptions | NEEDS REVIEW | No complete subscription flow is configured. Confirm subscriptions are not advertised; if introduced, make creation idempotent across retries and races. |
| Duplicate payments and webhooks | BLOCKED | Order creation is idempotent, but Paystack/Stripe provider execution, signed webhooks, replay protection, refunds, settlement, and reconciliation are not implemented or accepted. Keep card/wallet methods disabled. |
| Manual bank-transfer payments | BLOCKED | Production schema is applied, but no verified Nigeria/UK receiving account is configured or enabled and no staging order/receipt test has passed. Keep each market disabled until tested and authorized details are entered in the admin workspace. |
| Error handling and failed requests | NEEDS REVIEW | Complete the cross-surface audit for database, network, auth, upload, and payment failures; verify safe messages, retry rules, preserved form state, and duplicate-submit protection. |
| Uptime and production monitoring | BLOCKED | Choose a monitoring provider and responsible alert destination; cover storefront/API health, database, payment, and critical error signals. |
| Concurrent usage | NEEDS REVIEW | Run controlled load/concurrency tests for sign-in, search, listing creation, checkout, inventory locks, and seller operations; fix races and document capacity. |
| Backup restoration | BLOCKED | Procedure is documented in `docs/backup-restore-runbook.md`. Verify this project's actual backup/PITR plan and separate Storage-object backup, then run an authorized non-production restore exercise and record measured recovery point/time. No restore has been performed. |
| Spending caps | BLOCKED | Configure provider, storage, email, analytics, and infrastructure budgets and alerts with the relevant account owners. |
| Shared rate-limit storage | NEEDS REVIEW | The local Express API supports a PostgreSQL rate-limit store with a bounded-memory fallback. Production serves static Cloudflare roots; deployed enforcement and multi-instance behavior are not verified. |

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
- Confirm the current fixed 7.5% checkout tax treatment for Nigeria and the UK, or provide approved region-specific tax rules before orders are accepted.
- Provide a separate staging Supabase project and disposable buyer, seller, and admin accounts. Keep credentials in workspace Secrets; do not put them in chat.
- Complete [`requiredinformations.md`](requiredinformations.md) with verified business, market, legal, commercial, monitoring, recovery, and spending decisions. Never enter credentials or receiving-account numbers in the Markdown file.
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