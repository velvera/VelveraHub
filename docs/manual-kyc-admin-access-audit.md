# Manual KYC and admin-access audit

## Scope and result

This audit kept manual, admin-led identity review as the only active KYC
method. It did not add a paid provider, automated approval, credential, or
database operation. Existing account, case-history, private-upload, and review
flows were reused rather than replaced.

## Existing KYC safeguards confirmed

- Seller identity files use the private `seller-identity-private` bucket and an
  authenticated upload function with file-signature and size checks, upload
  limits, and server-side storage credentials.
- Consent and case history are recorded. Admins review submissions through
  short-lived signed links; approval or rejection is not inferred from an
  upload.
- Contact verification and KYC remain separate. Nigerian phone OTP does not
  produce an identity badge. Buyers do not need identity documents to purchase.
- Registered businesses and sole traders have separate registry/evidence and
  representative-review checks. Logistics companies need representative identity
  and business evidence; Nigerian dispatch riders need NIN and a selfie.
  Public verification data is limited to approval booleans.
- The seller identity form currently accepts one government-ID file. It does
  not collect a separate individual-seller selfie. Contact/phone state remains
  separate from KYC; the Nigeria OTP flow is not a KYC badge or a replacement
  for identity review.
- The existing lifecycle statuses and resubmission history are retained for
  compatibility. They were not collapsed into a smaller set of labels.
- No external KYC adapter is active. A future adapter must feed the existing
  case and review flow and must not approve an account or publish a badge by
  itself.

## Changes made

- Connected admin sign-in to the live Supabase session, `auth.getUser()`, and
  the server-side `current_profile_role()` result. A fresh access check sees a
  newly assigned role; the browser does not write profile roles.
- Added a primary-admin-only **Admin access** area with account lookup,
  reason-required grant/revoke actions, confirmation before revocation, and
  recent audit history. The server checks primary-admin status, protects the
  primary and last administrator, preserves the prior customer/seller role,
  and records changes in an append-only audit table, including initial
  primary-admin bootstrap.
- Repaired legacy profile lookup for accounts whose profile has no Auth-user
  link but whose email matches. The email fallback only selects unlinked
  profiles; conflicting Auth links are not reassigned.
- Added read-only safety checks for the role tables, primary-admin bootstrap
  grants, audit controls, and private delivery-provider document bucket.
- Corrected checkout to show the verified-shop indicator only when the shop is
  verified, and restored the supported next-day delivery option.
- Corrected admin review validation so missing seller and internal notes are
  reported inline before browser-native required-field validation blocks the
  message.
- Updated regression assertions that still expected the former cookie-banner
  styling, old related-card breakpoints, obsolete asset versions, or a retired
  staging-project state.

## Database and operator setup

Migration 25 is `database/admin-access-and-verification-hardening.sql`. It is
listed after migrations 1–24 in `database/run-schema.txt`; it adds the
primary-admin role-management tables and functions and strengthens
account-specific logistics-provider evidence. The migration is additive, but it
has **not** been applied to any Supabase project in this work. The configured
project is for testing, and no target project was selected for a write.

After an operator selects the intended non-production project and applies the
ordered migrations, the first authorized administrator must be promoted and
bootstrapped once from a trusted SQL Editor session. The exact procedure and
staging matrix are in `docs/operator-runbook.md` and
`docs/staging-acceptance.md`. No shared password is created or stored.

## Verification performed

- `npm run test:admin-access`
- `npm run test:supabase-readiness`
- `npm run test:seller-verification`
- `npm run test:location-logistics`
- `npm run test:cookie-consent`
- `npm run test:listing-copy`
- All `scripts/*.test.mjs` test files — passed
- `npm run apps:check`
- `npm run smoke`
- `npm run mobile:regression` — passed at 320px, 390px, 430px, and 1280px

The admin route was visually checked at desktop width and shows the existing
sign-in screen. The signed-in role-management UI was not verified in a browser
because this preview cannot sign in, and no staging test account was used.
Local SQL/source checks do not prove that Supabase has applied the migration or
enforces it for real users.

## Remaining manual work

- Apply migration 25 and bootstrap the first administrator only after the
  operator explicitly chooses the test project and uses the trusted SQL Editor.
- Run the role grant/revoke and five-account-type KYC acceptance matrix with
  disposable accounts, including private-file access and public-badge checks.
- If the individual-seller policy requires a separate selfie in addition to a
  photo ID, add and test that extra private document field before rollout. The
  current seller identity case accepts one government-ID file; the logistics
  rider selfie requirement is already enforced separately.
- Approve legal retention periods and configure a secure document-purge job
  before collecting real identity documents. Malware scanning and automated
  deletion are not currently configured.
- UK phone verification, separate email/SMS notifications, and any paid KYC
  service remain unconfigured and are not claimed as implemented.
