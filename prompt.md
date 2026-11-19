VELVERAHUB — MASTER IMPLEMENTATION DIRECTIVE

Legal, Privacy, Marketplace Integrity, Security, Payments & Reliability

Project: VelveraHub
Implementation scope: Master Roadmap Sections 1 and 2
Source of truth: "roadmap.md" — updated 30 October 2026
Priority: Critical — pre-launch requirements
Objective: Implement, audit, test and document every technically actionable requirement in the two pending roadmap sections. Do not merely produce recommendations or a checklist.

---

1. YOUR MISSION

You are responsible for bringing VelveraHub's outstanding legal, privacy, marketplace-integrity, security, payment and reliability requirements to implementation-ready and independently verifiable standards.

Start by inspecting the entire existing repository, database schema, migrations, Supabase configuration, Storage policies, API implementation, frontend applications, administrative workspace, authentication flows and existing tests.

Do not assume that an item is implemented simply because it appears in documentation or a previous assessment.

Do not rebuild existing working functionality unnecessarily. Preserve established product behaviour, architecture, design language, regional functionality and existing database relationships.

Implement actual functionality, database enforcement, access controls, operational safeguards and automated tests.

Do not substitute:

- Decorative UI for working functionality.
- Frontend validation for server/database enforcement.
- Client-side role checks for authorization.
- Placeholder legal documents for approved legal policies.
- Fake payment success for verified payment processing.
- Static monitoring indicators for actual monitoring.
- Passing local tests for verified production behaviour.

Every completed requirement must have implementation evidence.

2. NON-NEGOTIABLE PROJECT ARCHITECTURE

VelveraHub is an existing Nigeria/UK marketplace. Preserve its architecture.

Hosting and application structure

Four separate static Cloudflare Pages applications:

Application| Directory| Domain| Purpose
Nigeria marketplace| "velverahub-ng/"| "velverahub.com"| Nigerian buyers and sellers
UK marketplace| "velverahub-uk/"| "velverahub.co.uk"| UK buyers and sellers
Seller portal| "velverahub-seller/"| "velverahub.shop"| Seller/shop-owner operations
Admin portal| "velverahub-admin/"| "velverahub.org"| Administrative operations

These are separate static deployments.

Architectural restrictions:

1. Do not introduce Cloudflare Workers.
2. Do not introduce Cloudflare Pages Functions.
3. Do not introduce "_middleware.mjs".
4. Do not introduce an "API_ORIGIN" configuration dependency.
5. Do not migrate the project to a server-rendered framework.
6. Preserve the existing Supabase-first architecture.
7. Use the existing API where already implemented and necessary.
8. Maintain the existing direct Supabase integration from static JavaScript applications.
9. Only the Supabase project URL and public anon/publishable key may be exposed in frontend code.
10. Never expose Supabase service-role keys, payment secrets, webhook secrets, private API credentials or administrative secrets in browser bundles.

Do not introduce additional infrastructure merely to solve a problem that can be safely addressed using the existing architecture.

Technology and design

Preserve the existing vanilla HTML, CSS and JavaScript approach where applicable.

Maintain the existing brand identity:

- Primary purple: "#6D28D9".
- White navigation/header text where currently specified.
- Existing Veeve/VelveraHub branding assets and established component styling.
- Consistent UI across Nigeria, UK, seller and admin applications.

Preserve regional pricing, currencies, phone formats, location handling, delivery coverage, seller operations, product management and existing responsive behaviour.

All changes must remain synchronized across the four generated application roots wherever shared functionality is involved.

3. SECTION ONE — LEGAL, PRIVACY AND MARKETPLACE INTEGRITY

3.1 Privacy Policy

Audit and complete the Privacy Policy.

It must accurately explain:

- Information collected during registration.
- Buyer and seller profile information.
- Seller verification and KYC information.
- Product listings, images and uploaded files.
- Orders, transactions and payment records.
- Delivery and location information.
- Customer-support and dispute information.
- Authentication and security information.
- Cookies, analytics and consent.
- Third-party services and external processing.
- Data sharing between buyers, sellers, payment providers and delivery partners.
- International and cross-border data processing.
- Data retention and deletion.
- User rights and privacy-request procedures.
- Security measures and incident communication.
- Contact details for privacy requests.

Audit actual data collection throughout all four applications, APIs, Supabase tables, logs, analytics and third-party integrations.

The policy must describe what the application actually does, not what it might do in the future.

Do not invent the legal operator, registered company name, registration number, business address or privacy contact.

Use clearly identified owner-input placeholders where verified information is unavailable. Never publish fabricated legal details.

Prepare the policy for legal review before marking it approved.

3.2 Terms of Service

Create or revise a complete marketplace Terms of Service document.

It must address:

- Buyer and seller eligibility.
- Account registration and account security.
- Seller onboarding and verification.
- Listing accuracy and prohibited products.
- Product ownership and authenticity representations.
- Seller responsibilities.
- Buyer responsibilities.
- Pricing and regional currency.
- Marketplace commissions and applicable fees.
- Payment methods and payment processing.
- Order formation and order cancellation.
- Inventory and stock accuracy.
- Delivery responsibilities and estimated delivery times.
- Returns, refunds and disputes.
- Seller suspension and account termination.
- Fraud, abuse and prohibited activities.
- Intellectual property and uploaded content.
- Marketplace liability and limitations.
- Complaints and dispute-resolution procedures.
- Governing law and jurisdiction.
- Support and contact procedures.

Keep Nigeria and UK regional requirements distinct where necessary.

Do not present unimplemented features as existing contractual services.

Do not invent governing-law decisions or legal entity information. Flag unresolved owner decisions for approval.

3.3 Business identity and legal disclosures

Audit every public-facing application for:

- Business identity.
- Legal operator information.
- Registered business details.
- Contact information.
- Support channels.
- Privacy contact.
- Applicable regional disclosures.

Identify missing information and create an explicit owner-input list.

Do not manufacture company registration details or use an unverified company suffix.

3.4 Data minimization

Perform a full data-collection audit.

Inspect:

- Registration forms.
- Login forms.
- Seller onboarding.
- KYC forms.
- Checkout.
- Order creation.
- Customer support.
- Reviews and messaging.
- Administrative forms.
- API request bodies.
- Database tables.
- Analytics events.
- Cookies and local storage.
- Application and server logs.

Remove unnecessary collection of personal information.

Ensure each retained field has a legitimate operational purpose.

Avoid collecting sensitive information unless necessary for a documented purpose and appropriately protected.

Never expose private customer or seller information in public listing queries, URLs, browser logs or analytics.

3.5 Third-party SDK and asset audit

Inventory all external dependencies and services, including:

- Supabase.
- Google Fonts.
- Font Awesome.
- External APIs.
- Analytics.
- CDN-hosted assets.
- Payment integrations.
- Email services.
- Any other third-party scripts or libraries.

For each dependency, document:

1. Purpose.
2. Data it accesses.
3. Whether it is essential.
4. Whether it requires consent.
5. Data retention and processing implications.
6. Commercial licensing requirements.
7. Security and supply-chain risks.

Remove unused dependencies and unnecessary external scripts.

Do not break existing product functionality while removing dependencies.

3.6 Cookie consent and dark-pattern audit

Preserve the existing two-choice cookie consent implementation:

- Decline.
- Accept.

Ensure optional analytics and other non-essential tracking respect the recorded consent decision.

Audit all four applications for:

- Preselected optional consent.
- Misleading consent buttons.
- Hidden cancellation controls.
- Coercive promotional messages.
- Unclear account deletion.
- Misleading checkout hierarchy.
- Hidden mandatory charges.
- Confusing seller upgrade flows.
- Unnecessary friction when declining optional services.
- Misleading subscription or recurring-payment language.

The user must be able to make an informed decision without coercion.

Preserve the existing accessible consent banner and test it across mobile and desktop.

3.7 Fees, commissions and pricing transparency

Audit buyer and seller pricing throughout Nigeria and UK applications.

Clearly disclose applicable:

- Product prices.
- Delivery charges.
- Marketplace commissions.
- Seller charges.
- Payment processing charges where applicable.
- Taxes where applicable.
- Other mandatory fees.

The final payable amount must be visible before order confirmation.

Sellers must understand applicable deductions before accepting a commercial arrangement.

Do not invent commission rates, taxes or fees.

Use the existing configured values and identify missing business decisions for owner approval.

Ensure frontend pricing, order calculations and database calculations agree.

The database remains authoritative for checkout totals.

3.8 Review and rating integrity

Ensure reviews and ratings cannot be fabricated or manipulated.

Implement or verify:

- Reviews tied to eligible completed transactions.
- One permitted review per eligible order/product relationship, according to the existing data model.
- Server-side eligibility verification.
- Duplicate-review prevention.
- Authorization checks.
- Moderation and reporting.
- Protection against unauthorized review editing.
- Auditability of moderation actions.
- Protection against sellers reviewing their own products through buyer accounts.
- Protection against fake review insertion through direct API calls.

Do not display fabricated ratings, seeded testimonials or artificial review counts as genuine customer feedback.

Review moderation must not become an arbitrary mechanism for suppressing legitimate negative feedback.

3.9 Unsupported marketing claims

Audit the entire public marketplace, seller portal and admin-controlled promotional content.

Inspect:

- Trust badges.
- Seller verification badges.
- Product quality labels.
- Guarantees.
- Security claims.
- Delivery promises.
- Ratings.
- Performance statistics.
- Promotional banners.
- Footer claims.
- Marketing copy.

Only display claims supported by actual functionality and verifiable evidence.

Preserve the existing KYC-verified seller concept, but ensure the badge reflects a genuinely verified seller status.

Do not claim that all products are verified, guaranteed authentic or universally trusted unless such claims can be substantiated.

3.10 Account deletion and data rights

Complete the existing account-deletion implementation.

IMPORTANT EXISTING DATABASE CONTEXT:

- "database/account-deletion.sql" is a legacy-only migration.
- The existing migration sequence is documented in "database/run-schema.txt".
- The account-deletion request queue was reportedly applied to production on 14 October 2026.
- Earlier external tests confirmed request submission, duplicate-request reuse, access denial and transitions through "rejected".
- The "completed" transition and actual Supabase Auth-user deletion were not performed.
- Earlier records also identified stale deployed "account-privacy.js" files on the NG/UK roots.

Do not blindly reapply the legacy migration.

Inspect the current schema and migration history first.

Implement and verify:

1. Authenticated deletion requests.
2. Duplicate-request protection.
3. Authorized administrative review.
4. Explicit approval/rejection states.
5. Secure completion workflow.
6. Actual Supabase Auth-user deletion.
7. Appropriate removal or anonymization of associated personal data.
8. Retention of legally or operationally necessary records where justified.
9. Removal or anonymization of associated profile, seller and personal information.
10. Cleanup of associated private files where appropriate.
11. Protection of order and financial records that must be retained.
12. Audit logs without unnecessarily retaining personal information.
13. Clear user-facing request status.
14. Secure administrative completion controls.

Do not delete financial or transactional records indiscriminately.

Determine the correct handling of outstanding orders, disputes, refunds and legally required records.

Implement the workflow on staging with disposable accounts before any production deletion.

Synchronize the corrected privacy functionality across the Nigeria and UK roots.

3.11 Children's data and age eligibility

Audit all registration and external sign-up paths.

Implement the intended minimum-age restriction consistently.

Ensure:

- Registration cannot bypass the age requirement.
- Regional applications use consistent eligibility rules.
- External sign-up flows enforce the same restrictions.
- Age-related data collection is proportionate.
- Privacy and Terms documents reflect the actual age policy.

Do not invent an age threshold. Identify the required legal/business decision and obtain owner approval before publishing the policy.

3.12 Marketing email unsubscribe

No marketing sender is currently configured according to the roadmap.

Do not introduce marketing campaigns or advertise subscription functionality as operational unless a compliant sending and unsubscribe mechanism exists.

If marketing email is introduced, implement:

- Explicit marketing consent.
- Unsubscribe links.
- Reliable unsubscribe processing.
- Suppression lists.
- Prevention of future marketing sends after unsubscribe.
- Auditability of consent changes.

Transactional account and order emails must remain distinct from optional marketing communications.

3.13 Font, image and icon licensing

Inventory all bundled and remotely loaded assets.

Verify commercial usage rights for:

- Fonts.
- Icons.
- Product/category imagery.
- Illustrations.
- Logos.
- CDN-hosted assets.

Replace assets without acceptable licensing evidence.

Maintain the established VelveraHub brand identity.

---

4. SECTION TWO — SECURITY, PAYMENTS AND RELIABILITY

4.1 File upload limits — NEW OWNER REQUIREMENT

This requirement is mandatory.

Users must be able to upload individual files of up to:

40 MiB = 41,943,040 bytes.

This is the maximum size for each individual uploaded file, not the combined size of a multi-file selection.

The target must remain within the applicable Supabase project-plan limits.

Supabase Free currently supports a global maximum of 50 MB, so 40 MiB is within the documented ceiling, subject to the actual project settings.

Required implementation

Inspect:

- "database/marketplace-media-settings.sql" or its actual migration counterpart.
- Migration 15 in "database/run-schema.txt".
- "product-images" bucket.
- "product-videos" bucket.
- All other user-facing upload buckets.
- Storage policies.
- Database quota triggers.
- Existing admin media-settings interface.
- Product image compression and media-upload JavaScript.
- Seller and buyer upload workflows.
- API payload limits and any upload proxying.

Implement the following:

A. File-size enforcement

- Maximum individual file: 40 MiB.
- Set the Supabase global limit to at least 40 MiB.
- Set appropriate bucket-level limits without exceeding the global limit.
- Update database-side upload validation.
- Update existing client-side validation.
- Remove conflicting 10 MiB photo and 100 MiB video limits where they conflict with the new maximum.
- Keep any smaller limits only where there is a documented technical reason and explicit product approval.

B. Resumable uploads

Use Supabase TUS resumable uploads for files exceeding 6 MiB.

Use the existing Supabase project and authenticated user session.

Use the recommended 6 MiB TUS chunk size.

Where appropriate, use the direct Supabase Storage hostname for resumable uploads.

Implement:

- Upload progress percentage.
- Upload status.
- Retry after recoverable failure.
- Resume interrupted uploads where supported.
- Cancellation.
- Duplicate-submit protection.
- Clear completion and failure states.
- Cleanup of incomplete uploads where applicable.

Do not introduce unnecessary backend infrastructure.

C. MIME and file validation

Allow only file types required by actual VelveraHub functionality.

Validate:

- MIME type.
- File extension.
- Actual file content where practical.
- File size.
- Storage path.
- Ownership.
- Upload quota.

Do not rely on the browser's "accept" attribute as a security control.

Do not permit arbitrary executable uploads.

D. Preserve listing quotas

The existing migration-15 design specifies:

- Default maximum of 10 shop photos per listing.
- Default maximum of 10 independent-listing media items.
- Admin-controlled bounded media settings.

Preserve those item-count limits unless an existing approved business rule explicitly differs.

A 40 MiB per-file limit must not accidentally remove listing-count restrictions.

E. Storage ownership and isolation

Verify:

- Users can upload only to authorized paths.
- Sellers cannot overwrite another seller's files.
- Cross-owner access is denied.
- Unauthorized users cannot delete other users' objects.
- Admin-only media settings cannot be modified by ordinary users.
- Invalid MIME types and oversized files are rejected by Storage/database enforcement.

F. User experience

Display the 40 MiB maximum clearly in relevant upload interfaces.

For multiple selections, show each file's progress and status independently.

Preserve form state when an upload fails.

Display useful, non-technical error messages without exposing internal database or Storage information.

G. Cost and performance

Preserve image compression and optimization where appropriate.

Do not unnecessarily store multiple uncompressed image copies.

Avoid uncontrolled concurrent uploads.

Use sensible upload concurrency and retry limits.

Do not silently degrade the quality of videos or documents.

Do not remove files until the corresponding database operation has succeeded or a controlled cleanup process has been established.

H. Production configuration

Migration 15 is currently local according to the roadmap.

Both production product-media buckets previously had null file-size and MIME restrictions.

Do not claim the 40 MiB limit is operational until:

1. The migration is applied to the correct staging project.
2. Global and bucket-level settings are confirmed.
3. Actual authenticated uploads are tested.
4. Ownership and invalid-upload checks pass.
5. Production migration and configuration are separately verified.

4.2 Duplicate subscriptions

The roadmap reports that no complete subscription flow is configured.

Do not advertise or activate subscriptions unless they are genuinely implemented.

If a subscription flow already exists in the repository, inspect it and ensure:

- Idempotent creation.
- Protection against duplicate requests.
- Protection against simultaneous requests.
- Unique provider references.
- Correct subscription state transitions.
- Correct cancellation handling.
- Reliable webhook processing where applicable.

Do not introduce recurring billing without an approved business model and functional payment-provider integration.

4.3 Duplicate payments, webhooks and card-payment security

This is a critical requirement.

Existing architecture documented in "docs/payment-architecture.md":

- Nigeria: Paystack Transaction Splits/subaccounts.
- UK: Stripe Connect.

However, the roadmap confirms that provider charge execution, signature verification, refunds, settlement and reconciliation handlers are not complete.

Do not claim either integration is production-ready merely because an SDK or configuration exists.

Nigeria — Paystack

Implement the actual Paystack integration where authorized credentials and test-mode access are available.

Requirements:

- Secure transaction initialization.
- Server-authoritative amount calculation.
- Correct currency and regional handling.
- Unique transaction references.
- Idempotency protection.
- Secure verification of transaction status.
- Verified webhook signature validation.
- Duplicate webhook protection.
- Replay protection.
- Payment/order state synchronization.
- Failure and cancellation handling.
- Refund processing.
- Settlement tracking.
- Reconciliation.

UK — Stripe Connect

Implement the actual Stripe Connect integration where authorized credentials and test-mode access are available.

Requirements:

- Correct connected-account handling.
- Secure payment initialization.
- Server-authoritative pricing.
- Correct currency.
- Idempotency.
- Verified webhook signatures.
- Replay protection.
- Duplicate-event handling.
- Payment/order state synchronization.
- Refund handling.
- Settlement tracking.
- Reconciliation.

General payment security

Never trust:

- Client-submitted payment amounts.
- Client-submitted payment-success flags.
- Browser redirect success as proof of payment.
- Unverified webhook payloads.
- User-submitted transaction references without verification.

Ensure that:

- Orders cannot be marked paid by unauthorized clients.
- A payment cannot be credited twice.
- Webhook retries cannot duplicate fulfilment.
- Payment references are unique.
- Payment status transitions are validated.
- Failed payments do not create false paid orders.
- Refunds update the correct order and payment records.
- Sensitive payment credentials remain server-side.

Card-payment release restriction

Keep card and wallet payments disabled until the complete provider implementation has passed staging tests.

Do not display a functional card-payment option if it cannot successfully process and verify payments.

Do not simulate payment success.

4.4 Manual bank-transfer payments

The roadmap confirms that the manual marketplace payment migration was applied to production on 29 October 2026.

However:

- No Nigeria receiving destination was configured or enabled.
- No UK receiving destination was configured or enabled.
- Complete order/receipt/confirmation behaviour has not been tested.

Inspect the existing implementation and complete the workflow.

Required:

- Admin-controlled regional receiving-account configuration.
- Separate Nigeria and UK settings.
- Authenticated administrative access.
- Secure storage of receiving-account information.
- Regional enable/disable controls.
- Order-specific payment instructions.
- Clear transfer reference/instructions.
- Receipt submission.
- Receipt storage with appropriate private access.
- Pending-payment status.
- Administrative verification.
- Approval/rejection.
- Rejection reasons.
- Duplicate receipt/submission protection.
- Audit history.
- Order-state synchronization.
- Buyer notifications.

Never invent receiving-account details.

Do not enable a regional bank-transfer method until an authorized administrator has entered and verified the actual receiving details directly in the admin workspace.

A buyer's uploaded receipt is not proof that funds have arrived.

Manual payment confirmation must remain an authorized administrative action.

4.5 Error handling and failed requests

Audit every application surface.

Cover:

- Supabase connection errors.
- Authentication errors.
- Expired sessions.
- Database failures.
- Network timeouts.
- Storage upload failures.
- Payment initialization failures.
- Payment verification failures.
- Order creation failures.
- Inventory conflicts.
- Duplicate submissions.
- API errors.
- Rate-limit responses.

Requirements:

- Clear user-facing error messages.
- No sensitive internal error leakage.
- Retry only when safe.
- Idempotency for operations that may be retried.
- Preserve user-entered data.
- Prevent accidental duplicate orders.
- Prevent duplicate payments.
- Prevent repeated upload submissions.
- Appropriate loading states.
- Recovery paths for interrupted operations.

Ensure that a failed request does not leave the application displaying a false success state.

4.6 Uptime and production monitoring

The roadmap identifies monitoring as BLOCKED because the monitoring provider and alert destination have not been selected.

Implement the monitoring integration in a provider-neutral manner where possible.

Monitor:

- Nigeria storefront availability.
- UK storefront availability.
- Seller portal availability.
- Admin portal availability.
- API health.
- Supabase availability and relevant failures.
- Authentication failures.
- Database/API errors.
- Storage upload failures.
- Checkout failures.
- Payment webhook failures.
- Payment reconciliation discrepancies.
- Critical frontend errors.

Create meaningful alerts for:

- Service outages.
- Sustained elevated error rates.
- Payment-processing failures.
- Webhook failures.
- Storage failures.
- Abnormal authentication activity.
- Unexpected resource usage.

Do not send secrets or personal information to logs or alerts.

Do not invent an alert destination or claim active monitoring without a configured provider and tested notification route.

Identify the monitoring provider and alert recipient as owner decisions where required.

4.7 Concurrent usage and race conditions

Perform controlled concurrency testing.

The objective is to establish that critical marketplace operations remain correct under simultaneous usage.

Test:

- Registration and sign-in.
- Product search.
- Listing creation.
- Multiple uploads.
- Inventory reservation.
- Checkout.
- Concurrent purchases of limited stock.
- Duplicate order submissions.
- Seller order management.
- Administrative review.
- Payment confirmation.
- Refund operations.

Verify:

- Inventory never becomes negative.
- Stock cannot be oversold.
- Order creation remains idempotent.
- Simultaneous requests cannot bypass authorization.
- Payment events cannot fulfil orders twice.
- Seller quotas cannot be bypassed by concurrent uploads.

The existing checkout architecture uses database-side price and stock calculations, product locking and order-creation idempotency.

Preserve these safeguards.

Test the existing "place_order_secure" implementation against staging before changing its logic.

Document the tested concurrency level and observed outcomes.

Do not invent capacity claims.

4.8 Backup and restoration

The roadmap identifies a controlled restoration test as BLOCKED.

Implement or document the complete operational restoration procedure.

Inspect:

- Supabase database backup availability.
- Point-in-time recovery availability, if applicable.
- Storage backup and recovery strategy.
- Database migration history.
- Application deployment recovery.
- External dependencies.
- Payment records and reconciliation data.

Create a restoration runbook covering:

1. Recovery prerequisites.
2. Backup selection.
3. Database restoration.
4. Storage recovery.
5. Migration reconciliation.
6. Authentication and application checks.
7. Order and payment consistency checks.
8. Domain/service verification.
9. Recovery-time measurement.
10. Recovery-point measurement.

Do not claim a successful restore until a controlled test has actually been performed.

Never perform a destructive restoration test against the live production project.

4.9 Spending limits and resource controls

Inspect current resource consumption and provider configurations.

Establish recommended budgets and alerts for:

- Supabase database.
- Supabase Storage.
- Storage egress.
- Cloudflare hosting.
- API infrastructure.
- Email services.
- Analytics.
- Payment processing.

Where provider-level spending controls are available, document and configure them with authorized account access.

Where only usage alerts are available, configure those instead.

Do not invent budget amounts or claim that hard spending caps exist where the provider does not offer them.

Require owner approval for financial thresholds.

4.10 Shared rate-limit storage

The roadmap confirms that the current rate limiter uses in-memory storage.

This is insufficient where multiple API instances can operate independently.

Inspect the existing deployment topology.

Implement a shared rate-limit store if the deployment architecture requires multiple instances.

Use an existing compatible shared infrastructure only if available and authorized.

If the current API deployment guarantees a single instance, document and verify that guarantee rather than introducing unnecessary infrastructure.

Preserve existing rate-limit coverage and add protection for:

- Authentication.
- Registration.
- Password recovery.
- Listing creation.
- Messaging.
- Upload initiation.
- Checkout.
- Payment verification.
- Receipt submission.
- Administrative actions.

Use appropriate limits per operation and avoid blocking legitimate buyers and sellers.

---

5. DATABASE, STORAGE AND MIGRATION RULES

Follow the existing migration manifest in:

"database/run-schema.txt"

The documented migration sequence contains 15 steps:

1. "schema.sql"
2. "seller.sql"
3. "admin.sql"
4. "supabase-rls.sql"
5. "security-hardening.sql"
6. "cloudflare-dashboard.sql"
7. "cloudflare-supabase-direct.sql"
8. "production-hardening.sql"
9. "shop-owner-payments.sql"
10. "shop-verification-compliance.sql"
11. "seller-contact-safety.sql"
12. "product-delivery-options.sql"
13. "client-error-logging.sql"
14. "marketplace-manual-payments.sql"
15. "marketplace-media-settings.sql"

Inspect the actual repository and database before applying migrations.

Do not:

- Blindly rerun migrations.
- Reapply legacy account-deletion SQL to an already-updated schema.
- Drop existing tables or columns unnecessarily.
- Remove existing RLS policies without understanding their dependencies.
- Disable security policies to make tests pass.
- Use production as a test environment.
- Assume migration files have already been applied because they exist locally.

Every database change must have:

- A migration file.
- A clear purpose.
- Safe application order.
- Appropriate rollback or recovery considerations.
- RLS and grants where applicable.
- Automated coverage where practical.
- Staging verification.

Keep the existing manual-payment migration and media-settings migration compatible.

---

6. MANDATORY STAGING ACCEPTANCE

This section is a release requirement, not optional documentation.

Use a dedicated Supabase staging project with disposable:

- Buyer account.
- Seller account.
- Administrator account.

Use provider test-mode accounts where required.

Store credentials through the authorized secure secrets mechanism. Never place credentials in source files, browser bundles or chat messages.

Follow the existing:

"docs/staging-acceptance.md"

and

"docs/cloudflare-pages.md"

Required upload tests

1. Upload a valid file smaller than 6 MiB.
2. Upload a valid file larger than 6 MiB.
3. Upload a file close to 40 MiB.
4. Attempt an oversized file.
5. Attempt an unsupported MIME type.
6. Attempt an invalid storage path.
7. Attempt cross-owner access.
8. Attempt unauthorized deletion.
9. Verify listing-count limits.
10. Test interrupted uploads and recovery.
11. Test concurrent uploads.
12. Verify admin media-settings changes.
13. Verify the configured limits are enforced by Supabase itself.

Use disposable staging data and clean up test objects.

Required account-deletion tests

Test:

- Request submission.
- Duplicate request.
- Unauthorized request.
- Administrative approval.
- Administrative rejection.
- Completed transition.
- Auth-user deletion.
- Appropriate personal-data cleanup.
- Retention of necessary transactional records.
- Private file cleanup.

Required payment tests

Test:

- Order creation.
- Manual transfer instructions.
- Receipt submission.
- Duplicate receipt prevention.
- Administrative verification.
- Payment rejection.
- Payment approval.
- Failed payment.
- Duplicate webhook.
- Invalid webhook signature.
- Replay attempt.
- Refund.
- Settlement/reconciliation handling.

Keep live payment methods disabled during staging.

Required security tests

Test:

- Anonymous access.
- Authenticated buyer access.
- Authenticated seller access.
- Administrator access.
- Cross-owner access.
- Direct Supabase API access.
- RLS enforcement.
- IDOR attempts.
- Unauthorized administrative RPC execution.
- Rate limiting.
- Authentication abuse.
- Sensitive-data exposure.

A successful frontend test does not prove database authorization.

---

7. REGRESSION AND QUALITY ASSURANCE

Preserve existing automated checks.

Run the existing project scripts where available, including:

- "npm run test:product-meta"
- "npm run test:messages-moderation"
- "npm run test:storage-policy-safety"
- "npm run test:category-images"
- "npm run test:domain-routing"
- "npm run test:cookie-consent"
- "npm run test:supabase-readiness"
- "npm run test:manual-payments"
- "npm run audit:image-alt"
- "npm run apps:check"
- "npm run apps:production:check"
- "npm run smoke"
- "npm run mobile:regression"
- "npm audit"

Use the actual script names in "package.json" if they differ.

Add focused tests for newly implemented functionality.

Verify all four application roots.

Test mobile widths:

- 320px.
- 390px.
- 430px.

Also test desktop layouts.

Verify:

- No broken navigation.
- No broken authentication.
- No console errors.
- No missing assets.
- No broken upload interfaces.
- No inaccessible forms.
- No accidental exposure of secrets.
- No regression in Nigeria/UK functionality.
- No regression in seller/admin operations.

---

8. OWNER-DEPENDENT BLOCKERS

Some requirements cannot legitimately be finalized by a coding agent without verified owner information or external provider access.

Do not fabricate or guess:

1. Legal operator/company name.
2. Company registration details.
3. Registered jurisdiction.
4. Business address.
5. Official support contact.
6. Privacy contact.
7. Governing-law decision.
8. Minimum eligible age.
9. Final buyer/seller fee and commission schedule.
10. Authorized Nigeria receiving-account details.
11. Authorized UK receiving-account details.
12. Paystack business onboarding and test credentials.
13. Stripe Connect onboarding and test credentials.
14. Monitoring provider and alert destination.
15. Backup/restore owner and recovery window.
16. Approved spending limits.
17. Production and staging access.

Implement everything that can be completed without these inputs.

For unavailable inputs:

- Identify the exact missing information.
- Identify which feature or release gate depends on it.
- Provide the exact place where the owner must configure it.
- Keep dependent functionality disabled where necessary.
- Never insert dummy credentials or fabricated business information.

Do not block unrelated implementation work simply because an external dependency is unavailable.

---

9. PRODUCTION SAFETY AND DEPLOYMENT RULES

The current roadmap explicitly says:

DO NOT LAUNCH YET.

Respect that decision.

Never perform test writes against production for:

- Storage uploads.
- Account deletion.
- Checkout.
- Payment processing.
- Refunds.
- Administrative payment approval.

Do not deploy unverified migrations or production changes without authorized approval.

Separate:

1. Local implementation.
2. Local automated verification.
3. Staging deployment.
4. Staging acceptance.
5. Production migration.
6. Production deployment.
7. Production verification.

Never describe a local PASS as a production PASS.

Verify production configuration through read-only checks wherever possible.

Do not expose credentials in logs, reports or generated files.

---

10. REQUIRED DELIVERABLES

At completion, provide:

A. Implemented functionality

A precise list of every feature implemented, including relevant files, database migrations and affected application roots.

B. Database and Storage changes

Document:

- New/modified migrations.
- RLS changes.
- RPC changes.
- Storage policies.
- Global upload limits.
- Bucket MIME and size restrictions.
- Database enforcement.
- Admin media controls.

C. Upload implementation report

Explicitly confirm:

- Maximum file size in bytes and MiB.
- Whether the project plan permits it.
- Whether the global limit was changed.
- Whether bucket limits were changed.
- Whether TUS is implemented.
- Whether progress and retry work.
- Whether ownership and quota checks pass.
- Whether 40 MiB uploads passed on staging.

D. Security and payment report

Document:

- Authentication and authorization findings.
- RLS and IDOR test results.
- Payment integration status.
- Webhook security.
- Duplicate-payment protection.
- Refund and reconciliation status.
- Manual bank-transfer status.

E. Legal and privacy report

Document:

- Privacy Policy status.
- Terms of Service status.
- Data-minimization findings.
- Cookie-consent findings.
- Review integrity.
- Account deletion.
- Age eligibility.
- Third-party dependency audit.
- Licensing findings.
- Outstanding owner/legal approvals.

F. Reliability report

Document:

- Error-handling improvements.
- Monitoring implementation.
- Concurrency tests.
- Rate-limit architecture.
- Backup and restore evidence.
- Spending controls.

G. Test evidence

Provide exact commands executed, results, test environment and any failures.

H. Remaining blockers

List each unresolved item, why it remains unresolved, who must provide access or approval, and what is required to clear it.

I. Updated master roadmap

Update the original roadmap with evidence-based statuses.

Use only:

- PASS.
- NEEDS REVIEW.
- BLOCKED.

A task is PASS only when its required acceptance criteria have actually been verified in the relevant environment.

A local implementation with no staging or production evidence must not be marked as production PASS.

---

11. EXECUTION ORDER

Work in this order:

Phase 1 — Repository and production-state audit

- Inspect the entire codebase.
- Inspect migration history.
- Inspect existing production-readiness evidence.
- Identify incomplete functionality and dependencies.
- Produce a concise implementation plan.

Phase 2 — Legal and marketplace integrity

- Privacy and Terms implementation.
- Data minimization.
- Cookie/third-party review.
- Pricing transparency.
- Review integrity.
- Marketing-claim audit.
- Account deletion.
- Age eligibility.
- Licensing audit.

Phase 3 — Storage and upload security

- Implement 40 MiB per-file limits.
- Implement TUS uploads.
- Correct global and bucket restrictions.
- Enforce ownership, MIME, path and quota rules.
- Update admin controls.
- Test uploads and recovery.

Phase 4 — Payments and transactional security

- Complete manual-transfer workflow.
- Implement or complete Paystack.
- Implement or complete Stripe Connect.
- Secure webhook processing.
- Idempotency, refunds and reconciliation.
- Keep unverified payment methods disabled.

Phase 5 — Reliability

- Error-handling audit.
- Monitoring integration.
- Shared rate limiting where required.
- Concurrency tests.
- Backup and restoration procedures.
- Spending controls.

Phase 6 — Final verification

- Run automated tests.
- Complete staging acceptance.
- Verify all four application roots.
- Document owner-dependent blockers.
- Update the master roadmap.
- Prepare the production release decision.

Do not skip phases simply to produce a faster completion report.

FINAL INSTRUCTION

I am not asking for another assessment, another proposal, or a UI-only implementation.

I am authorizing implementation of the two pending roadmap sections.

Work directly in the existing VelveraHub repository. Reuse and improve existing functionality. Make the necessary code, database, Storage, security, administrative and testing changes.

Prioritize correctness, security, maintainability and real operational functionality over superficial completion.

Do not invent information, bypass security controls, disable working features or misrepresent test results.

Where access or owner approval is genuinely required, implement everything else possible and clearly identify the remaining dependency.

The expected outcome is a substantially completed, verifiable VelveraHub marketplace that is ready for the remaining authorized staging and production acceptance gates — not a project that merely looks ready.