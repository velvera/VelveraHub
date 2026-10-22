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
   accounts. Create a student listing and products specifically for the test.
   Use synthetic names, addresses, and contact details.
3. Keep staging credentials in the workspace’s secure secrets store. Never put
   service-role keys or bearer tokens in browser code, command arguments,
   terminal output, screenshots, issue reports, or this document.
4. Record the date, environment label, test case, expected result, actual result,
   and a sanitized request/reference ID. Do not record account emails, addresses,
   tokens, provider secrets, or raw customer payloads.

## Supabase migrations and read-only preflight

1. Apply the numbered migrations from `database/run-schema.txt` in order, using
   the Supabase migration workflow chosen by the operator. Record each migration
   and the result before moving to the next. Do not infer that a migration ran
   from a local file or a passing source test.
2. Apply `database/account-deletion.sql` only if the target is a legacy schema
   that lacks the request-queue objects. It is not an additional migration for
   a fresh/current schema.
3. Run `database/safety-verification.sql` after migration. It is read-only and
   checks the effective schema, access grants, triggers, RPCs, and selected
   invariants. Save sanitized output. A passing metadata check does not prove
   the behavior of a signed-in browser role.
4. Stop and investigate any `passed = false` result before running write tests.

## Storage ownership, validation, and quota

Use owner A’s test listing and two seller accounts. Generate unique UUIDv4
filenames under the test listing UUID folder.

| Case | Action | Expected result |
| --- | --- | --- |
| Owner access | Owner A uploads one valid WebP image, no larger than 5 MiB | Accepted |
| Cross-owner access | Owner B uploads to owner A’s listing path | Rejected |
| Invalid path | Owner A uses a non-UUID listing folder or non-UUIDv4 filename | Rejected |
| Invalid type | Owner A sends an unsupported MIME type such as `image/jpeg` | Rejected |
| Invalid size | Owner A sends an image of 5 MiB plus one byte | Rejected |
| Concurrent quota | Owner A concurrently uploads seven distinct valid images to a fresh student listing | Exactly six accepted; at least one rejected |

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
   RPCs, and the permitted admin status transitions.
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

As of 22 October 2026, this repository contains the migration order, read-only
verification SQL, Storage acceptance procedure, and payment design. Local
Storage checks validate source/SQL invariants only. The recorded 14 October
account-deletion checks cover request queue/RLS behavior, not final Auth-user
deletion. No live Supabase staging run or provider payment scenario is recorded.
