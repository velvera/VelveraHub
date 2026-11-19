# VelveraHub — Required Owner Information and Staging Access

**Updated:** 19 November 2026  
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
| Staging migration access and migration history | Migration 15 exists locally but is not evidence that it ran in staging or production. | Authorized operator applies the ordered migration in `database/run-schema.txt` to staging and records sanitized results. |

### Supabase upload references

- [Storage file-size limits](https://supabase.com/docs/guides/storage/uploads/file-limits) — plan maximums, global limit, and bucket limits.
- [Resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads) — TUS, resume behavior, direct Storage hostname, and 6 MiB chunks.
- [Standard uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads) — recommended for files up to 6 MB; TUS is recommended above that size.

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
| Backup/restore owner, recovery window, and acceptable recovery-point/time objectives | Needed for an authorized, measured restore exercise and runbook. | Owner assigns an operator and approves the test window; test only against a non-production target. |
| Approved spending thresholds and alert levels | Provider budgets are financial decisions and vary by account capability. | Account owners configure provider-level caps or usage alerts in the relevant dashboards. |
| Production Cloudflare access and exact approved domains | Needed only for a later authorized production configuration/deployment review. | Authorized operator provides access through the platform's secure integration flow. Do not deploy as part of staging acceptance. |
| Approved server-side path for Supabase Auth-user deletion | The static Cloudflare apps cannot hold the privileged key required to delete Auth users; current SQL only advances the request queue. | Owner/platform operator identifies an authorized server-side execution environment and grants access through Secrets. Do not put privileged credentials in browser code. |

## Current evidence boundary

- No Supabase integration is connected in this workspace, so the actual project plan and global Storage limit have not been inspected.
- The roadmap records no dedicated staging project or disposable acceptance accounts.
- Migration 15 is present locally but has not been verified in production.
- Production manual-payment schema was applied, but no regional receiving destination is configured or enabled.
- Paystack and Stripe processing, webhooks, refunds, settlement, and reconciliation are not complete; card/wallet payments must remain disabled.
- Account-deletion request handling exists, but the complete end-to-end acceptance test and actual Supabase Auth-user deletion have not passed.
- Passing local automated tests is repository evidence only, not staging or production evidence.

## Acceptance evidence to return with the next workflow

For each staging test, record only a sanitized environment label, date, case, expected result, actual result, pass/fail, and non-sensitive request/reference ID. Do not include user emails, account numbers, tokens, provider secrets, raw customer data, or production write results.

The staging acceptance matrix is in `docs/staging-acceptance.md`; migration ordering and read-only checks are in `database/run-schema.txt`. Production must not be used for upload, account-deletion, checkout, payment, refund, or admin-approval write tests.
