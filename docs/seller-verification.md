# Seller verification and trust

The seller, admin, and public-badge flows are implemented in the existing
Supabase-backed marketplace. Identity documents use the private
`seller-identity-private` bucket. The upload function authenticates the
applicant, checks the file signature and 5 MiB limit, applies an upload
rate-limit, and stores files with a server-only service-role client. An
authorized admin reviews each case; an upload never marks a seller verified.

## Install or upgrade

1. Apply database migrations 1–22 from `database/run-schema.txt`.
2. Apply `database/seller-trust-verification.sql` (migration 23).
3. Apply `database/seller-verification-case-history.sql` (migration 24). This
   is required on databases where migration 23 was already applied; it removes
   the one-case-per-seller constraint and replaces the affected RPCs. Fresh
   installations should apply both 23 and 24 in order.
4. Deploy the upload function:

   ```sh
   supabase functions deploy seller-verification-documents
   ```

   Hosted Supabase provides the project URL, anon key, and service-role key to
   the function runtime. If deploying elsewhere, configure them only as
   server-side function secrets.
5. Apply `database/admin-access-and-verification-hardening.sql` (migration 25)
   after migrations 1–24 when enabling administrator role management or the
   account-specific logistics-provider document workflow. It does not promote
   the primary administrator; follow `docs/operator-runbook.md`.
6. In a dedicated non-production Supabase project, verify seller submission,
   private upload, admin review, and public badges with disposable accounts
   before enabling the feature for real sellers.

Run the local checks with:

```sh
npm run test:seller-verification
npm run test:admin-access
npm run test:supabase-readiness
npm run apps:check
```

## Account-specific checks

- Buyers keep email and phone verification separate from identity KYC; no
  identity document is required to buy.
- Individual sellers submit identity evidence through the manual seller review
  flow. Business sellers also need separately reviewed registry or proprietor
  evidence before a business badge is returned.
- Logistics companies submit representative identity and business evidence.
  Independent riders submit identity and a selfie; Nigerian riders must use
  NIN, while a driver’s licence is an additional document when applicable.
- All document buckets remain private. Public badge RPCs return booleans only,
  and phone verification alone cannot produce an identity or business badge.

## Current operational boundaries

- Identity checks are **manual review only**. No Smile ID or UK KYC provider is
  integrated, and no submitted document or provider response is treated as an
  automatic approval.
- Case submission, status, review decisions, and history stay separate from
  provider integration. A future adapter should feed the existing case flow;
  provider results must not grant public badges or approval on their own.
- Business registry evidence is reviewed by an administrator. CAC and
  Companies House checks are not live registry integrations.
- The existing phone OTP provider covers Nigeria only. UK phone verification
  must remain unavailable until a suitable provider and country-specific
  onboarding are configured.
- Status and review messages appear in the seller dashboard. No separate email,
  SMS, or push-notification delivery is claimed by this feature.
- Country retention periods are configurable in the database, but an automated
  document-redaction and secure-deletion schedule is not configured. Set the
  legally approved retention policy and implement its purge job before storing
  real identity documents in production.
- Malware scanning and provider-backed liveness checks are not configured.

These boundaries are intentional: the system remains pending/manual rather
than simulating provider success. The currently configured Supabase project is
for testing; use the separately created production project for live documents
after its policies, provider contracts, notification requirements, and
retention schedule are approved.
