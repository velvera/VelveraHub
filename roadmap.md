# VelveraHub Master Roadmap

**Updated:** 22 October 2026  
**Release decision:** **DO NOT LAUNCH YET**

This is the current source of truth, consolidated from `improvement.md`, `finalassessment.md`, the previous `roadmap.md`, and the repository checks run during this review. The two dated review files are retained as historical evidence; their current status is superseded by this document.

## Status definitions

- **PASS** — implemented and verified in the repository or local preview. This does not prove the deployed production service is correct.
- **NEEDS REVIEW** — implementation exists or is partial, but a complete audit, external migration, production test, or owner approval is still required.
- **BLOCKED** — completion depends on an operator detail, production access, a provider, or another external control that is not available in this repository.

## Summary

The project has substantial marketplace, security, mobile, and operational groundwork. Local route, generated-app, accessibility-alt, and targeted regression checks pass. A Supabase account-deletion request-queue migration and its access controls were recorded as verified on 14 October; that does not establish that the full migration set or upload/checkout policies are ready. Payment provider/webhook configuration, operator/legal details, monitoring, backups, and domain verification remain unresolved.

The 65-item production checklist currently contains **20 PASS, 36 NEEDS REVIEW, and 9 BLOCKED** items. Do not treat a local PASS as evidence that a production database, payment flow, or domain has been tested.

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
- Filtered mobile regressions at 320px, 390px, and 430px pass across the storefront, regional, admin, and shop-owner roots. The 320px matrix was rerun after the final analytics-consent change.
- Preview checked at 1024px desktop and 402px mobile; the two-choice banner renders and the browser console is clean.
- `npm audit` — 0 vulnerabilities after the dependency update.
- Focused mobile regression at 320px for the parent storefront and standalone shop-owner portal.
- Full `npm run mobile:regression` — completed with exit code 0 across the configured viewport and app-root matrix.

## Supabase and payment acceptance status — 22 October 2026

### Confirmed from the repository

- `database/run-schema.txt` defines the 13-step Supabase migration order: `schema.sql`, `seller.sql`, `admin.sql`, `supabase-rls.sql`, `security-hardening.sql`, `cloudflare-dashboard.sql`, `cloudflare-supabase-direct.sql`, `production-hardening.sql`, `shop-owner-payments.sql`, `shop-verification-compliance.sql`, `seller-contact-safety.sql`, `product-delivery-options.sql`, and `client-error-logging.sql`.
- `database/account-deletion.sql` is a **legacy-only** migration. The runbook says to apply it after `schema.sql` and before `cloudflare-supabase-direct.sql` only when the older database lacks the deletion-request objects. Do not apply it as an extra migration to a fresh/current schema.
- The supplied storage-test path `scripts/test-storage-policy-safety.mjs` does not exist. The actual test is `scripts/storage-policy-safety.test.mjs`, run by `npm run test:storage-policy-safety`; it checks source and SQL invariants without contacting Supabase.
- `docs/cloudflare-pages.md` contains direct Storage acceptance steps: concurrently upload seven distinct valid objects to a disposable listing, require six successes and at least one rejection, then verify cross-owner and invalid-path/MIME/size rejections and clean up the test objects.
- `database/production-hardening.sql` derives checkout totals from database product prices, locks products, enforces stock and idempotency, and allows only cash-on-delivery or bank-transfer orders. The repository has no current evidence that the latest RPC has passed a staging invocation.
- `docs/payment-architecture.md` confirms the existing plan: Paystack Transaction Splits/subaccounts for Nigeria and Stripe Connect for the UK. This remains design/data-model work: there are no provider charge, signature-verification, refund, settlement, or reconciliation handlers. The API accepts only offline payment methods.
- `database/safety-verification.sql` now checks whether the key Storage, deletion, checkout, idempotency, and payment-schema objects are installed and safely granted. It remains a read-only metadata check and cannot prove real owner/cross-owner behavior.
- `docs/staging-acceptance.md` defines the staging-only tests and sanitized evidence format. No staging test was run in this workspace.
- The cookie change is synchronized to all generated roots and verified with `apps:check`, `apps:production:check`, unit coverage, and filtered browser regressions. This is local preview evidence, not deployed-domain evidence.

### Existing external evidence (not re-run in this review)

- `docs/cloudflare-pages.md` records that the account-deletion request-queue migration was applied on 14 October 2026, with RLS/grants checked and disposable customer/admin RPC tests passed for submission, duplicate reuse, access denial, and transitions through `rejected`.
- The record explicitly says the `completed` transition and Auth-user deletion were not performed; test accounts remained active. It also records stale deployed `account-privacy.js` files on the NG/UK roots and a Cloudflare challenge blocking automated inspection of the admin/shop roots.
- No external record confirms the seven-upload quota test, cross-owner upload denial, invalid upload rejection, or current `place_order_secure` staging behavior. The earlier improvement review said that RPC was missing from the live schema cache at that time.

### Access required to complete the acceptance tests

- This workspace has no Supabase staging connection or approved provider test credentials. No payment credentials were accessed or exposed. The managed Stripe connector is optional; it is not connected. Paystack is not offered by the current managed payment connector flow.
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
| Upload limits | NEEDS REVIEW | Local static source checks pass. Apply `database/supabase-rls.sql` in staging and verify bucket policies, ownership, invalid paths/MIME/size rejection, and concurrent six-file quota enforcement using disposable accounts. |
| Duplicate subscriptions | NEEDS REVIEW | No complete subscription flow is configured. Confirm subscriptions are not advertised; if introduced, make creation idempotent across retries and races. |
| Duplicate payments and webhooks | NEEDS REVIEW / BLOCKED | Order creation is idempotent, but provider charge execution, signed webhooks, replay protection, refunds, and authoritative reconciliation are not complete. Implement and stage-test Paystack for Nigeria and Stripe Connect for the UK before enabling card/wallet payments. |
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

- **BLOCKED — Production Cloudflare/Supabase:** apply ordered migrations and validate real active catalogue data, checkout RPCs, and account deletion against the configured production project.
- **NEEDS REVIEW — Environment and secrets:** verify production secrets remain server-side and deployed static bundles contain only intended public configuration.
- **NEEDS REVIEW — Debug/test cleanup:** audit production bundles, endpoints, sample data, test accounts, and debug settings.
- **NEEDS REVIEW — Security headers:** verify CSP, HSTS, frame, referrer, and permissions policies on every deployed domain without breaking required flows.
- **NEEDS REVIEW — Authentication/authorization:** complete IDOR and Supabase RLS testing against production-like roles and data.
- **BLOCKED — HTTPS/domains:** verify Cloudflare deployment, certificates, redirects, and canonical host behavior for every public domain.
- **BLOCKED — Full production audit:** test registration, seller onboarding, listings, search, checkout/payment, refunds, account settings/deletion, email, mobile/accessibility, monitoring, backups, and concurrent use in the production environment.

**Release gate:** Do not launch or enable card payments until the blocked items are resolved and the NEEDS REVIEW items have production evidence. Keep checkout limited to the currently supported offline methods until provider/webhook flows are verified.

## Product growth roadmap after launch gates

1. Define event taxonomy, buyer/seller outcomes, and contribution-margin metrics.
2. Pilot verified seller trust and delivery promises in one Nigerian city cluster and one UK region.
3. Use measured experiments to improve ranking, recommendations, and seller next-best actions.
4. Scale only after reliability, fraud controls, support capacity, and unit economics meet agreed thresholds.

## Source documents

- `improvement.md` — 25 September 2026 implementation review and UI/platform backlog snapshot.
- `finalassessment.md` — 7 October 2026 production checklist and external verification record.
- `PRODUCTION_READINESS_REPORT.md` — detailed evidence snapshot with the 21 October local verification update; append production evidence as those checks are completed.