# Supabase and payment staging acceptance

This runbook is for a dedicated non-production Supabase project and disposable
test accounts only. Do not run the write tests against production or use a real
customer, seller, listing, order, or payment. The read-only checks do not replace
the authenticated behavior tests.

## Preconditions and evidence handling

1. Confirm the target is a separate staging Supabase project. Compare its
   project reference with the production configuration without copying keys or
   tokens into notes, screenshots, or chat.
2. Use dedicated disposable owner A, owner B, customer, and administrator
   accounts. Create ordinary marketplace listings specifically for the test.
   Use synthetic names, addresses, and contact details.
3. Keep staging credentials in the workspace’s secure secrets store. Never put
   service-role keys or bearer tokens in browser code, command arguments,
   terminal output, screenshots, issue reports, or this document.
4. Record the date, environment label, test case, expected result, actual result,
   and a sanitized request/reference ID. Do not record account emails, addresses,
   tokens, provider secrets, or raw customer payloads.

## Supabase migrations and read-only preflight

1. Apply migrations 1–14 from `database/run-schema.txt` in order, using the
   Supabase migration workflow chosen by the operator. Record each result before
   moving to the next. Do not infer that a migration ran from a local file or a
   passing source test.
2. Before migration 15, verify the actual project plan and global Storage limit
   in the dashboard. Both must support at least 40 MiB (41,943,040 bytes);
   otherwise stop and do not apply the 40 MiB bucket settings.
3. Apply migration 15 only after that check, then run the media acceptance
   cases below. The general Free-plan limit is not verification of this
   project's settings.
4. Apply `database/account-deletion.sql` only if the target is a legacy schema
   that lacks the request-queue objects. It is not an additional migration for
   a fresh/current schema.
5. Run `database/safety-verification.sql` after migrations. It is read-only and
   checks the effective schema, access grants, triggers, RPCs, and selected
   invariants. Save sanitized output. A passing metadata check does not prove
   the behavior of a signed-in browser role.
6. Stop and investigate any `passed = false` result before running write tests.

## Admin-controlled media settings

Before applying migration 15 to staging, confirm the project's plan and global
Storage file-size limit are at least 40 MiB (41,943,040 bytes). Then use the
authenticated staging admin workspace to verify the defaults: 10 photos or
videos per listing and 40 MiB per individual file. Original photos up to 40 MiB
are compressed by the upload form. Temporarily set the shared listing limit to
7 and both size limits to 6 MiB; verify every listing form reflects the new
count and Storage rejects objects above the selected size. Restore the defaults.
MIME types must remain fixed regardless of these settings.

## Storage ownership, validation, and quota

Use owner A’s test listing and two seller accounts. Generate unique UUIDv4
filenames under the test listing UUID folder.

The browser uploader checks the expected extension and basic WebP, MP4, WebM,
or QuickTime signature before sending product media. This is a client-side
defense-in-depth check; the current database trigger and bucket MIME rules
validate metadata, not the complete object bytes. Do not report a client check
as server-side content enforcement.

| Case | Action | Expected result |
| --- | --- | --- |
| Owner access | Owner A uploads one valid WebP image, no larger than the configured 40 MiB default | Accepted |
| Cross-owner access | Owner B uploads to owner A’s listing path | Rejected |
| Invalid path | Owner A uses a non-UUID listing folder or non-UUIDv4 filename | Rejected |
| Invalid type | Owner A sends an unsupported MIME type such as `image/jpeg` | Rejected |
| Invalid size | Owner A sends an image of 40 MiB plus one byte at the default setting | Rejected |
| Standard upload boundary | Upload a valid file of exactly 6 MiB (6,291,456 bytes) | Accepted through the standard upload path |
| Resumable upload | Upload a valid file one byte above 6 MiB and one close to 40 MiB | Accepted; TUS progress, retry, and resume work |
| Cancel and recover | Cancel one upload, then separately interrupt and restore network access during TUS | Cancellation stops the upload; network recovery resumes the same upload without duplicate objects |
| Concurrent quota | Owner A concurrently uploads eleven distinct valid media files to a fresh listing | Exactly ten accepted at the default; at least one rejected |

Capture only statuses and sanitized references. Delete successful test objects
with owner A and confirm quota usage returns to its pre-test level. Do not use
bucket listing as a test mechanism or broaden Storage `SELECT` policies to make
verification easier.

## Checkout RPC and account deletion

1. Use a disposable staging product with known price and stock, plus the
   dedicated customer account. Call `place_order_secure` with server-calculated
   checkout data; verify the returned amount/currency is derived from database
   values, not client-submitted totals.
2. Repeat the same request and idempotency key. It must return the same order
   and must not reserve stock twice. A conflicting customer or invalid payment
   method must be rejected. Use only offline methods while provider payments
   remain disabled.
3. Submit an account-deletion request as the disposable customer. Verify
   duplicate-request reuse, customer access denial to the private queue/admin
   RPCs, the requester-only status lookup, accurate status text in the account
   page, and the permitted admin status transitions.
4. Test Auth-user deletion only as the final, explicitly approved staging step
   against a disposable account. The request-queue migration does not itself
   delete the Supabase Auth user. Verify the deleted account’s token is rejected
   and document any legally retained transaction data. Never use this step on a
   production or real user account.

## Payment provider staging matrix

The documented provider choice is Paystack Transaction Splits/subaccounts for
Nigeria and Stripe Connect for the UK. It is a design decision, not evidence
that provider calls are implemented or accounts are approved. Do not enable
card/wallet checkout until each region has approved test-mode accounts, a
server-only adapter, a verified settlement/commission rule, signed webhooks,
and all applicable cases below pass:

| Case | Required assertion |
| --- | --- |
| Success | Provider status, order ID, amount, currency, and reference all match |
| Decline | Order is not marked paid; no seller ledger credit is created |
| Timeout/unknown result | Retry is safe; status is reconciled from the provider |
| Duplicate callback/replay | One event and one financial transition only |
| Invalid signature | Callback is rejected without changing order or ledger state |
| Amount/currency/reference mismatch | Callback is rejected and flagged for review |
| Partial failure | Order, attempt, and seller ledger remain recoverable without double charge |
| Partial and full refund | Provider refund, order status, and seller/platform ledger reverse once |
| Reconciliation | Provider transactions, attempts, orders, refunds, and ledger agree; unmatched rows are reported |

Run success, decline, timeout, duplicate callback, partial failure, and refund
scenarios with provider test-mode credentials only. Never use a live payment
secret or card number in a staging run.

## Current evidence boundary

As of 21 November 2026, this workspace still does not have a dedicated Supabase
staging project or disposable test accounts. No staging migrations,
authenticated acceptance tests, real Storage uploads, or payment-confirmation
checks have been run. Migration 15 and the admin controls are implemented
locally but have not been verified in production. Local tests and preview checks
are repository evidence only.

Historical production evidence from 29–30 October 2026: the manual-payment
schema was applied on 29 October; read-only checks confirmed its tables, RLS,
grants, and that no regional receiving destinations exist or are enabled. A
30 October read-only production preflight, before the media-settings checks were
added, passed 46 of 47 checks; both product-media buckets had size and MIME
limits unset. This verifies metadata only, not checkout, order snapshots,
uploads, or receipt-confirmation behavior. No customer rows were queried and no
writes were made.

The requester-only deletion-status lookup is now implemented as migration 16
and has local source-level regression coverage. It exposes no email or account
data and does not perform or prove Auth-user deletion or related-data cleanup.
The local checks recorded in `roadmap.md` and `requiredinformations.md` do not
prove effective project plan/global Storage settings, migration application,
real upload enforcement, role isolation, checkout behavior, deletion, or
production readiness.
The local checks `npm run test:manual-payments` and
`npm run test:supabase-readiness` validate source/SQL invariants only; they do
not prove that a migration was applied or that Supabase enforces the behavior.
This repository contains the migration order, read-only verification SQL,
Storage acceptance procedure, and payment design. The recorded 14 October
account-deletion checks cover request queue/RLS behavior, not final Auth-user
deletion.

Before enabling manual payments, an authorized admin must verify and configure
the correct VelveraHub receiving account for each market in the authenticated
admin workspace. In dedicated staging, verify that unverified sellers cannot
enable direct payment, approved KYC sellers can choose either destination,
missing regional admin details block VelveraHub manual payments, and test
orders snapshot the correct instructions while remaining pending. Verify that
the platform admin and each relevant seller can confirm only their own
receiving destination, and that a multi-shop order stays pending until all
destinations confirm. Do not use real orders or payment accounts for these
checks.
