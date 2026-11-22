# VelveraHub — Required Owner Information and Staging Access

**Updated:** 22 November 2026
**Purpose:** Gather the owner decisions and non-production access needed to finish legal approval and genuine staging acceptance. This is not a launch approval.

## Keep credentials and payment details out of this file

Do not put passwords, API keys, Supabase service-role keys, database URLs, webhook secrets, access tokens, bank account numbers, or customer information in this file or in chat.

- Add application credentials through the workspace Secrets flow.
- Enter verified Nigeria and UK receiving-account details only in the authenticated VelveraHub admin workspace, after staging checks.
- Use synthetic information and disposable accounts in staging.

## Required before upload acceptance

| Information or action | Why it is needed | Where to provide or verify it |
| --- | --- | --- |
| Dedicated Supabase staging project, separate from production | All migration, upload, ownership, quota, checkout, and deletion write tests must run outside production. | Share staging access through the approved integration/secrets workflow; do not paste keys here. |
| Staging project reference and public URL | Confirms that the browser and test credentials target staging rather than production. | Verify in the Supabase dashboard and configure through the workspace Secrets flow. |
| Actual Supabase plan for the target project | The plan determines the maximum Storage upload size. | Supabase dashboard → project billing/plan. |
| Current global Storage file-size limit | The global limit must be at least **40 MiB (41,943,040 bytes)** before the bucket limits can be set to 40 MiB. | Supabase dashboard → Storage → Settings. Record the observed limit and unit here after verification. |
| Effective `product-images` and `product-videos` bucket settings in staging | Confirms the bucket limits do not exceed the global limit and accepted MIME types remain restricted. | Supabase dashboard → Storage → Buckets, followed by the staging acceptance checks. |
| Disposable buyer, seller A, seller B, and administrator accounts | Needed for authenticated upload, cross-owner, quota, checkout, and admin authorization tests. | Create in the staging project with synthetic details; configure test credentials through workspace Secrets. |
| Staging migration access and migration history | Migration 15 and the new migration 16 exist locally but are not evidence that they ran in staging or production. | Authorized operator applies the ordered migrations in `database/run-schema.txt` to staging and records sanitized results. |

### Supabase upload references

- [Storage file-size limits](https://supabase.com/docs/guides/storage/uploads/file-limits) — plan maximums, global limit, and bucket limits.
- [Resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads) — TUS, resume behavior, direct Storage hostname, and 6 MiB chunks.
- [Standard uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads) — Supabase guidance for small files; this project uses standard uploads through exactly 6 MiB and TUS above 6 MiB per the project requirement.

Current documentation says Free projects allow a global maximum of 50 MB and paid plans allow a higher maximum. That general limit does **not** verify this project's plan or configured global limit. Do not change the target project's Storage settings until both are confirmed.

Keep the current **10 shop photos per product** and **10 independent-listing media files** quotas. The 40 MiB target applies to each individual file, not the combined selection and not the number of files.

## Legal and marketplace decisions

| Owner decision or verified detail | Blocks | Where it must be configured or approved |
| --- | --- | --- |
| Exact registered legal/operator name and trading name | Privacy Policy, Terms, business disclosures, receipts, support copy | Owner supplies verified details; legal reviewer approves public wording. |
| Country/jurisdiction of registration and registration number | Business disclosures and legal policy review | Owner supplies authoritative registration information. |
| Registered/business address | Legal disclosures and privacy contact information | Owner supplies the verified address; do not use an unverified address. |
| Official support contact and separate privacy-request contact | User support, privacy requests, Terms, and Privacy Policy | Owner supplies the addresses/channels and confirms who monitors them. |
| Governing-law and dispute-resolution decision for Nigeria and the UK | Terms of Service and complaint handling | Owner and qualified counsel approve the regional terms. |
| Minimum eligible age and any guardian/age-verification process | Registration gates and public policies | Owner and qualified counsel approve the rule before publication. |
| Buyer/seller fee and commission schedule, taxes, and payment-processing deductions | Checkout totals and seller disclosures | Owner supplies approved regional values; update only through the existing configured business rules. |
| Confirm or replace the existing fixed checkout tax calculation of 7.5% of item subtotal | The checkout UI and secure database RPC currently apply this rate in both NG and UK calculations; no owner/legal approval or region-specific tax basis is recorded. | Owner and qualified tax/legal adviser approve the applicable treatment before accepting orders; then configure and test database-authoritative totals. |
| Delivery responsibility, returns, refunds, cancellations, and dispute policy | Checkout, buyer/seller terms, support, and provider refunds | Owner approves the operational policy with legal review. |
| First launch markets | Scope and legal, tax, delivery, payment, and support requirements | Current product scope is Nigeria and the UK. If “global use” means enabling other countries, list each target country and approve its market requirements before adding it. |
| Evidence for seller verification, badges, guarantees, delivery promises, ratings, and marketing claims | Public trust and promotional content | Owner identifies the evidence and approves claims that remain visible. |
| Commercial licensing evidence for bundled/remote images, fonts, icons, and other assets | Third-party and licensing audit | Owner supplies licenses or source/contract evidence where repository records are absent. |

No legal entity, address, minimum age, governing law, fee, tax rate, or regional launch approval has been invented in this file. Public legal documents remain drafts until verified and reviewed by qualified counsel.

## Payments and operational access

| Information or action | Why it is needed | Where to provide or verify it |
| --- | --- | --- |
| Paystack Nigeria business onboarding and test-mode access | Provider initialization, verification, signed webhooks, refunds, and settlement/reconciliation tests. | Paystack business dashboard; keep test credentials in workspace Secrets. |
| Stripe Connect UK platform onboarding and test-mode access | Connected-account flows, signed webhooks, refunds, and settlement/reconciliation tests. | Stripe dashboard; keep test credentials in workspace Secrets. |
| Approved multi-seller commission, allocation, payout, refund, and chargeback rules | Provider integrations cannot safely calculate seller/platform shares without these rules. | Owner and finance/legal approvers document the rules before payment implementation is enabled. |
| Verified Nigeria and UK receiving destinations, if manual transfers will launch | Manual payment must remain disabled in a market without confirmed receiving details. | An authorized administrator enters and verifies details directly in the admin workspace; never send bank details through chat or this file. |
| Monitoring provider and alert recipient | Needed to prove alerts reach a responsible operator. | Owner chooses the provider and authorized destination; configure in that provider's dashboard and workspace Secrets as applicable. |
| Backup/restore owner, recovery window, and acceptable recovery-point/time objectives | Needed for an authorized, measured restore exercise. The procedure is documented in [`docs/backup-restore-runbook.md`](docs/backup-restore-runbook.md). | Owner assigns an operator, verifies the target project's backup/PITR and Storage-backup configuration, and approves the test window; test only against a non-production target. |
| Approved spending thresholds and alert levels | Provider budgets are financial decisions and vary by account capability. | Account owners configure provider-level caps or usage alerts in the relevant dashboards. |
| Production Cloudflare access and exact approved domains | Needed only for a later authorized production configuration/deployment review. | Authorized operator provides access through the platform's secure integration flow. Do not deploy as part of staging acceptance. |
| Approved server-side path for Supabase Auth-user deletion | The static Cloudflare apps cannot hold the privileged key required to delete Auth users; current SQL only advances the request queue. | Owner/platform operator identifies an authorized server-side execution environment and grants access through Secrets. Do not put privileged credentials in browser code. |

## Current evidence boundary

- No Supabase integration is connected in this workspace, so the actual Supabase plan and global Storage limit have not been inspected.
- The roadmap records no dedicated staging project or disposable acceptance accounts.
- Migration 15 is present locally but has not been verified in production.
- Production manual-payment schema was applied, but no regional receiving destination is configured or enabled.
- Paystack and Stripe processing, webhooks, refunds, settlement, and reconciliation are not complete; card/wallet payments must remain disabled.
- Account-deletion request handling exists, but the complete end-to-end acceptance test and actual Supabase Auth-user deletion have not passed.
- Passing local automated tests is repository evidence only, not staging or production evidence.

## Current local implementation status

These are repository-level facts only and do not prove deployed or staging
behavior:

- Product images are converted to WebP by the existing upload flow. Migration
  15 sets a maximum of 40 MiB per image/video and fixed bucket MIME allowlists;
  admin settings can lower those limits. Both listing quotas remain 10.
- Standard upload is used through exactly 6 MiB; a file one byte larger uses
  TUS with 6 MiB chunks. The client reports progress and retries resumable
  uploads. A local test checks the boundary, but not actual Supabase acceptance,
  cross-owner isolation, quota races, or recovery over a real interrupted
  connection.
- The cookie banner still offers only Decline and Accept. The policy page now
  lets users reopen the same two-choice banner to change their optional
  analytics choice.
- The public privacy/terms text is a more detailed draft describing known data
  categories and the actual unsupported payment/deletion states. Legal,
  operator, retention, and regional details are still unapproved.
- Manual-payment SQL/UI and order confirmations exist locally. No regional
  VelveraHub receiving destination is configured; buyer/seller order behavior
  still needs staging acceptance.
- Paystack/Stripe provider execution, verified webhooks, refund, payout, and
  reconciliation flows are not implemented. Keep card/wallet methods disabled.
- Account deletion queues a request and provides admin review. It does not
  perform privileged Supabase Auth deletion or complete associated-data
  cleanup. A new authenticated requester-only status lookup and account-page
  status display are implemented locally in migration 16; the browser checks
  for a signed-in session before querying. These changes do not verify the
  actual deletion step.
- The current app logic targets Nigeria and the UK. Additional global markets
  require separate legal, payment, tax, currency, and delivery decisions and
  implementation.
- A recovery procedure is documented, but the actual Supabase plan, backup
  retention/PITR settings, off-site Storage-object backup, alert path, and
  restore owner have not been verified or exercised.

## Local implementation and verification handoff

### Implemented locally

- Product media: `database/marketplace-media-settings.sql` (migration 15) sets
  image/video MIME and 40 MiB per-file bucket constraints and preserves the
  10-image shop and 10-file independent-listing quotas. Existing admin settings
  may lower supported sizes/counts; they cannot change MIME rules.
- Upload routing: `assets/js/services/storage-uploads.js` uses standard upload
  through exactly **6 MiB (6,291,456 bytes)** and TUS above that boundary with
  **6 MiB chunks**, progress, cancellation, and resumable retry support. Shared
  source changes are synchronized into the NG, UK, shop, and admin app roots.
  Before sending product media, it also checks the expected filename extension
  and basic WebP, MP4, WebM, or QuickTime file signatures.
- Public trust and legal copy: public review displays no longer invent ratings
  or seller trust scores; seller review reads require approved, verified
  purchases. `veeve/legal.html` contains expanded Privacy and Terms drafts with
  explicit gaps rather than invented operator, legal, payment, or deletion
  guarantees.
- Consent: users still see only Decline and Accept. The cookie policy can reopen
  the same banner so optional analytics choice can be changed.
- Local dependency safety: the Express body-parser advisory was addressed;
  `npm audit --omit=dev` reports zero vulnerabilities.
- Regression harness: mobile navigation measurements now wait for its scroll
  transition and top-of-page position to settle, preventing transient animation
  frames from being treated as viewport overflow.
- Account deletion request visibility: migration 16 returns only the signed-in
  requester's latest reference, status, and timestamps. The account page
  distinguishes received, in-review, completed-record, and rejected states,
  while explicitly warning that a completed queue status does not prove Auth
  deletion or data cleanup. Apply and behavior-test the migration in staging.

### Local checks completed on 21 November 2026

All of the following passed locally:

```text
npm run test:product-meta
npm run test:messages-moderation
npm run test:storage-policy-safety
npm run test:storage-upload-service
npm run test:marketplace-integrity
npm run test:supabase-readiness
npm run test:cookie-consent
npm run test:manual-payments
npm run test:category-images
npm run test:domain-routing
npm run audit:image-alt
npm run apps:check
npm run apps:production:check
SMOKE_PORT=5000 npm run smoke
npm audit --omit=dev
git diff --check
```

The image-alt audit checked 374 static image tags and 32 dynamic image elements
across 259 HTML/JS files. Mobile regression runs completed separately at
320px, 390px, and 430px across the parent, Nigeria, UK, admin, and shop-owner
roots. The combined mobile run hit its five-minute timeout while competing
with other checks; the per-width runs completed without assertion failures.
An initial smoke-script `--help` probe returned `Invalid URL` because that
script does not accept that option; the correct local smoke command above
passed.

The checks above do not connect to Supabase, run real Storage uploads, verify
authorization against staging roles, or establish production readiness.
The browser signature check is defense-in-depth, not a server-side security
boundary: current Storage/database enforcement checks MIME and size metadata,
which a direct authenticated Storage request can supply itself. Do not describe
the byte signature as independently enforced by Supabase.

## Latest local verification on 22 November 2026

- Passed the requester-only deletion-status test, storage upload service and
  policy tests, marketplace-integrity checks, Supabase-readiness checks, and
  manual-payment safety checks.
- Passed generated-root and production-root parity/syntax checks after updating
  only the affected account-status and listing-upload files across all app roots.
- Passed the mobile checks at 320px and 390px; the isolated 430px run passed
  across all roots after the anonymous status-RPC request was removed.
- Passed the local API smoke checks, dependency audit with zero reported
  vulnerabilities, and `git diff --check`.

These checks are local only. Migration 15 and migration 16 have not been
verified in production, no staging write acceptance has been performed, and
the signed-in status view still requires staging verification.

## Third-party services and asset review

This inventory is based on repository references. It does not establish
provider contracts, actual production configuration, data-processing terms,
or commercial licenses.

| Service / dependency | Current use | Data or review requirement |
|---|---|---|
| Supabase | Browser auth, database, and Storage. | Confirm project region, retention, access controls, and provider terms. |
| Cloudflare Pages | Hosts the static regional, seller, and admin roots. | Confirm production account, domains, request-log retention, and transfer terms. |
| Supabase JS via jsDelivr (`@2`) | Browser API client. | Major-version URL is not an exact pin; verify the deployed file/version and license. |
| tus-js-client 4.3.1 via jsDelivr | Loaded for large resumable uploads. | Upload metadata/file bytes go to Supabase; verify CDN, license, and version policy. |
| Google Fonts | Inter and Poppins web fonts. | Font requests disclose ordinary connection metadata; confirm commercial use and privacy terms. |
| Font Awesome 6.5.1 via cdnjs | UI icons. | Confirm license/attribution obligations and CDN integrity. |
| Node packages in `package.json` | Local Express preview/API, database access, authentication helpers, and browser regression tooling. | Review licenses and current dependency advisories; do not assume development-only dependencies are absent from deployment. |
| Analytics and marketing vendors | No distinct production vendor is documented. Optional activity is consent-gated in code. | Verify deployment configuration and event destination; do not collect after decline or claim an analytics provider is active. |
| Paystack and Stripe | Planned providers; checkout processing is not implemented. | Do not describe them as active processors until onboarding and complete staging acceptance. |
| Bundled and remotely referenced images, logos, icons, and illustrations | Marketplace and brand presentation. | Repository presence does not prove ownership or commercial rights; record source/license evidence or replace. |

## Next workflow sequence

1. Complete the legal, commercial, monitoring, recovery, and spending decisions
   above without adding credentials or receiving-account numbers to this file.
2. Connect a dedicated staging Supabase project and disposable buyer, seller,
   and admin accounts through secure workspace flows.
3. Confirm the staging plan and global Storage limit are at least
   **41,943,040 bytes** before applying migration 15; then complete
   `docs/staging-acceptance.md`.
4. Verify manual-payment order and receipt behavior in staging. Enter actual
   receiving details only through the authenticated admin workspace and only
   after an authorized decision.
5. Complete the privileged account-deletion workflow and staging acceptance.
    The account page now shows queue status, but do not mark a request completed
    based only on a browser confirmation or queue status.
6. Implement and test Paystack/Stripe only if approved for launch; otherwise
   keep card/wallet methods disabled.
7. Return sanitized staging evidence and update `roadmap.md`. Keep the release
   decision **DO NOT LAUNCH YET** until every required gate passes.

## Acceptance evidence to return with the next workflow

For each staging test, record only a sanitized environment label, date, case, expected result, actual result, pass/fail, and non-sensitive request/reference ID. Do not include user emails, account numbers, tokens, provider secrets, raw customer data, or production write results.

The staging acceptance matrix is in `docs/staging-acceptance.md`; migration ordering and read-only checks are in `database/run-schema.txt`. Production must not be used for upload, account-deletion, checkout, payment, refund, or admin-approval write tests.
