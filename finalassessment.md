# VelveraHub — Final Production Readiness Roadmap

**Purpose:** Track the work required to prepare VelveraHub for release to real users. Completed suggestions are recorded separately from the remaining roadmap so the next work is clear.

## How to use this roadmap

For every pending item:
1. Inspect the existing VelveraHub codebase and current implementation first.
2. Implement the requirement without unnecessarily changing the existing architecture or folder structure.
3. Do not create duplicate systems if an equivalent implementation already exists; improve it instead.
4. Test the change on desktop and mobile where applicable.
5. Do not mark an item complete unless it is actually implemented and verified.
6. When completing an item, record the files changed, evidence, tests performed, and any remaining risks.

---

# Completed Suggestions

These items were marked complete in the previous assessment. Keep their evidence in `PRODUCTION_READINESS_REPORT.md` and revisit them if later changes affect their scope.

## Legal, Privacy & Compliance

### [x] Refund Policy
Create and publish a clear VelveraHub Refund/Returns Policy explaining when refunds are available, who is responsible, eligible and excluded purchases, timelines, evidence requirements, and how users request refunds. Ensure it matches the actual payment and seller workflow.

### [x] Cookie Policy
Create and publish a Cookie Policy identifying cookies/local storage/tracking technologies used by VelveraHub, their purposes, categories, providers, retention, and how users can manage consent.

### [x] Cookie Consent Banner
Implement a compact, slim, rectangular VelveraHub cookie-consent banner with a single-line layout on supported screen widths where practical. It must remain readable and accessible on mobile, clearly explain consent, provide appropriate choices/settings, and never use deceptive design.

## Security, Reliability & Abuse Prevention

### [x] Rate Limiting
Add server-side rate limiting to authentication, registration, password reset, contact forms, listing creation, search, API endpoints, uploads, payment actions, and other abuse-prone endpoints. Use sensible limits without breaking normal marketplace usage.

### [x] API Limits
Define and enforce sensible request, payload, pagination, upload, and resource limits for every public API endpoint. Prevent abuse and uncontrolled resource consumption.

### [x] API Timeouts
Set appropriate timeouts for external API/database/network operations. Handle timeout failures gracefully, avoid indefinite requests, and ensure retries use bounded exponential backoff where appropriate.

### [x] Error Logging
Implement centralized production error logging for frontend/backend failures and important integration errors. Never log passwords, payment secrets, authentication tokens, private keys, or unnecessary personal data.

## Database & Performance

### [x] Loading States
Audit loading indicators across the app. Add consistent loading states only where users genuinely need feedback, avoid unnecessary spinners, and prevent layout jumps during loading.

### [x] Empty States
Add clear, useful empty states for searches, categories, seller listings, carts, orders, messages, notifications, dashboards, and other states where no content exists. Avoid blank screens.

## SEO & Discoverability

### [x] Meta Title Per Page
Give every indexable VelveraHub page a unique, descriptive, SEO-appropriate `<title>` based on its actual content.

### [x] Meta Description Per Page
Give every important indexable page a unique, accurate meta description that summarizes the page without keyword stuffing or unsupported claims.

### [x] robots.txt
Create and verify a production `robots.txt` that permits legitimate public crawling while protecting private/admin/seller/account areas and other non-indexable routes.

### [x] sitemap.xml
Generate and verify a production `sitemap.xml` containing only valid, canonical, indexable VelveraHub URLs. Exclude private, duplicate, parameter-only, and non-indexable pages.

## Mobile & UX

### [x] Mobile Breakpoints
Test VelveraHub at realistic mobile widths, especially approximately 320–430px, then tablet and desktop widths. Fix overflow, clipped content, shrinking controls, broken dropdowns, horizontal scrolling, layout collisions, and unusable touch targets.

### [x] Scroll-aware Mobile Navigation
Hide the shared mobile bottom navigation while scrolling down or at the bottom of a page, and show it again while scrolling up or at the top.

**Completion evidence:** `npm run mobile:regression` passed the hide/show checks at 320px, 390px, and 430px across the parent, Nigeria, and UK storefronts.

## Final Production Gate

### [x] Final Launch Report
Produce a final `PRODUCTION_READINESS_REPORT.md` listing every checklist item as PASS, FAIL, or NEEDS REVIEW, including evidence, files changed, tests performed, known risks, and any remaining launch blockers. Do not declare VelveraHub production-ready while critical blockers remain.

---

# Pending Roadmap

The pending work is grouped by release risk. Complete the blocking workstreams before launch, then address the remaining quality and growth work.

## Phase 1 — Blocking Legal, Privacy & Compliance

### Privacy Policy
Create and publish a clear VelveraHub Privacy Policy covering what data is collected, why it is collected, legal basis where applicable, storage, sharing, third parties, retention, security, user rights, deletion requests, contact details, and international data transfers. Ensure the policy matches the actual application behavior.

### Terms of Service
Create and publish comprehensive VelveraHub Terms of Service covering buyers, sellers, accounts, marketplace rules, prohibited activities, listings, payments, delivery, disputes, intellectual property, liability, termination, and applicable law. Make sure the terms match the actual marketplace workflow.

### [x] Form Consents
Audit every form that collects personal data. Add explicit, understandable consent/acknowledgement controls where legally or operationally required, link to the relevant policy, and ensure consent is recorded only when necessary.

**Completion evidence:** Registration, seller registration, checkout, and campus-listing forms now use required, linked acknowledgements. Campus listing consent is recorded with the listing metadata; `npm run smoke`, `npm run apps:check`, and `npm run mobile:regression` passed. Remaining risk: confirm any future external/Supabase-native forms follow the same policy.

### No Unnecessary Data
Audit every form, API payload, database field, cookie, and tracking event. Remove collection of personal or sensitive data that VelveraHub does not genuinely need for its stated purpose.

### Third-Party SDK Audit
Inventory every third-party SDK, script, API, widget, analytics service, payment integration, font, and tracking technology. Document its purpose, data access, permissions, security/privacy implications, and whether it is actually necessary. Remove unnecessary dependencies.

### Remove Dark Patterns
Audit the entire user interface for deceptive or coercive UX, including preselected optional choices, confusing consent wording, disguised buttons, difficult cancellation, forced actions, misleading hierarchy, or intentionally difficult privacy controls. Replace them with clear user-controlled interactions.

### Remove Hidden Fees
Audit every buyer and seller pricing flow. Ensure all mandatory fees, commissions, delivery charges, taxes where applicable, and other required costs are disclosed clearly before the user commits to payment.

### Remove Fake Reviews
Ensure VelveraHub does not generate, fabricate, seed, manipulate, or misleadingly present reviews. Clearly distinguish genuine user-generated reviews from other content and implement appropriate review integrity controls.

### Remove Unsupported Claims
Audit marketing copy, product claims, badges, guarantees, statistics, trust statements, and promotional language. Remove or qualify anything that VelveraHub cannot substantiate.

### Data Deletion Request
Implement a clear user data-deletion request process. Verify the requester appropriately, identify what can/cannot be deleted, handle legal/financial retention requirements, delete or anonymize eligible data, and record the request outcome securely.

### Children's Data / Age Consent
Audit whether VelveraHub collects or processes children's personal data. Implement an appropriate age gate, parental/guardian consent mechanism, or restriction where required by the applicable jurisdiction. Do not collect unnecessary age or identity information merely to implement this control.

### Email Unsubscribe
Add a clearly visible unsubscribe mechanism to every applicable marketing email. Ensure unsubscribe requests are honored reliably and promptly, while keeping legally necessary transactional emails separate.

### Business Details
Add accurate VelveraHub business/operator details wherever legally or commercially required, including business name, contact method, physical/business address where required, registration details where applicable, and responsible support contact.

### Real Contact Address
Replace placeholder or fictional contact information with a genuine VelveraHub contact address and verified support contact details. Ensure the same information is consistent across the website, policies, emails, and business pages.

### Font/Image Licensing
Audit every font, icon, image, illustration, video, and other visual asset. Verify that VelveraHub has permission to use each asset commercially. Replace anything with unclear, expired, incompatible, or missing licensing.

## Phase 2 — Blocking Security, Reliability & Abuse Prevention

### Upload Limits
Enforce server-side upload size, file-count, MIME/type, extension, filename, and storage limits. Never rely only on client-side validation. Reject unsafe or unsupported files safely.

**Progress update — 7 October 2026:** Campus listings reject selections above six files, accept only JPEG/PNG/WebP images and MP4/WebM/QuickTime videos, check input sizes, compress images to the Storage WebP limit, upload video `File` objects without base64 expansion, and attempt storage cleanup if listing metadata creation fails. Seller product uploads now reject rather than truncate selections above six, accept only JPEG/PNG/WebP, enforce the 8 MB source and 5 MB compressed-image limits, and use generated UUIDv4 filenames. `database/supabase-rls.sql` now defines strict media paths and an atomic per-listing Storage counter/ledger trigger for the combined campus image/video quota; bucket rules retain per-object size and MIME limits. Concurrent Storage API requests therefore contend on one counter row instead of relying on a stale object-count snapshot.

**Still pending:** The Replit workspace has no Supabase connection that can apply or inspect the external production schema. Apply `database/supabase-rls.sql` in the production Supabase SQL editor, verify the policies and triggers are present, and test direct uploads with a disposable owned listing, including seven simultaneous valid uploads, invalid filenames, MIME/size rejection, and a different owner's listing. Do not mark Upload Limits complete until those production checks pass; the code and local regression coverage alone do not establish production enforcement.

### Duplicate Subscriptions
Audit all subscription/membership creation flows and make them idempotent. Prevent duplicate subscriptions caused by double-clicks, retries, refreshes, race conditions, or repeated API requests.

### Duplicate Payments
Make every payment operation idempotent. Prevent duplicate charges from retries, refreshes, webhooks, double-clicks, network failures, or simultaneous requests. Reconcile payment state using the payment provider's authoritative transaction identifiers.

### Error Handling
Audit frontend, backend, Functions, API, database, authentication, payment, upload, and third-party integration failures. Replace unhandled exceptions and raw errors with safe, user-friendly responses while preserving diagnostic information in server logs.

### Failed Requests
Ensure failed API/network requests are handled consistently with useful user feedback, safe retry behavior where appropriate, preserved form state where possible, and no duplicate submissions.

### Uptime Monitoring
Add production uptime/health monitoring for the public website and critical API/health endpoints. Configure alerts for sustained downtime or critical failures.

### Simultaneous Users
Load/stress test critical marketplace flows with concurrent users, especially authentication, search, product pages, listing creation, checkout, payment confirmation, and seller operations. Identify race conditions and resource bottlenecks.

### Backup Restoration
Verify that production backups are actually restorable. Perform a controlled restoration test and document the recovery procedure, recovery time, recovery point, and any missing dependencies.

### Spending Caps
Set sensible spending/resource caps for paid infrastructure, third-party APIs, storage, email, analytics, and other usage-based services. Configure alerts before limits are reached.

## Phase 3 — Database & Performance

### Optimise DB Queries
Audit slow and repeated database queries across product search, location filtering, seller pages, authentication, orders, payments, and admin operations. Remove N+1 queries, unnecessary columns, repeated queries, and inefficient joins.

### Database Indexes
Review database query patterns and add appropriate indexes for frequently filtered, searched, joined, sorted, and uniquely constrained fields. Verify that indexes improve real query performance without excessive write/storage overhead.

### Large-Result Pagination
Paginate all potentially large API/database results, including products, sellers, orders, reviews, messages, admin records, and search results. Never load an unbounded dataset into a page or API response.

### Cache Repeat Requests
Identify safe, frequently repeated read requests and add appropriate caching with clear invalidation/expiration rules. Do not cache private or rapidly changing data incorrectly.

### Compress Files
Compress and optimise production HTML, CSS, JavaScript, images, fonts, and other static assets where appropriate. Enable modern HTTP compression such as Brotli/Gzip where supported.

## Phase 4 — Accessibility

### [x] Image Alt Text
Audit every meaningful image and add concise, descriptive alt text. Mark purely decorative images appropriately so screen readers do not announce unnecessary content.

**Completion evidence:** Added `npm run audit:image-alt`, which checked 400 static image tags and five dynamically created image elements across 225 HTML/JavaScript files, including generated storefront roots. The sole missing alternative was the basket mark beside the visible VelveraHub wordmark; it is now explicitly decorative. `npm run audit:image-alt`, `npm run apps:check`, `npm run smoke`, and `npm run mobile:regression` passed.

### Accessibility Contrast
Audit text, buttons, links, form controls, icons, borders, placeholders, and interactive states against appropriate WCAG contrast requirements. Fix insufficient contrast while preserving VelveraHub's brand styling.

### Keyboard Navigation
Ensure the entire website can be operated using a keyboard. Audit focus order, visible focus states, dropdowns, dialogs, menus, forms, buttons, links, and interactive marketplace components.

### Form Error States
Give every form clear, accessible error states. Identify the affected field, explain what needs correction, preserve valid input where possible, and expose errors properly to assistive technologies.

## Phase 5 — SEO & Discoverability

### CTA Above the Fold
Audit every important landing/product/category page and ensure the primary user action is visible above the fold without requiring unnecessary scrolling, especially on mobile.

### Open Graph Image
Add valid Open Graph metadata and an appropriate branded `og:image` for VelveraHub pages, with sensible defaults and page-specific values where useful.

### [x] Favicon Set
Implement a complete favicon/app-icon set appropriate for modern browsers and mobile devices, including the correct manifest/icon references where applicable.

**Completion evidence:** `favicon.ico`, `apple-touch-icon.png`, and `manifest.webmanifest` are committed at the static deployment root, and the generator copies them into every Pages root. Root HTML links them directly, while the manifest references the 192px and 512px Android icons with a maskable 512px purpose. The static favicon contract passed for the parent, Nigeria, UK, admin, and shop roots; local HTTP checks returned 200 for the root favicon, Apple icon, and manifest. Remaining risk: verify browser cache/certificate behavior after each production domain deploy.

### Image SEO
Audit every indexable image for appropriate alt text, dimensions, loading behavior, filenames where useful, and SEO/accessibility requirements.

## Phase 6 — Mobile & UX

### Sticky Mobile CTA
Where a page has a critical conversion action, add a mobile-friendly sticky CTA that does not obscure content, respects safe-area insets, remains accessible, and does not become intrusive.

### [x] Thank-You Page
Implement appropriate post-action thank-you/success pages for important flows such as registration, contact forms, seller onboarding, orders, payments, or other completed actions. Clearly state what happened and what the user can do next.

**Completion evidence:** `veeve/success.html` provides accessible registration, order, and campus-listing confirmation states. Registration, checkout, and successful listing flows route there with safe, encoded context and a next action. The order state was browser-previewed with a reference number; smoke, syntax, generated-root, and mobile checks passed. Remaining risk: payment-provider confirmation and email delivery remain external launch gates.

## Phase 7 — Analytics & Operational Visibility

### Analytics
Install privacy-conscious analytics only where justified and configure it according to the VelveraHub consent/privacy requirements. Track meaningful product events without collecting unnecessary personal data.

### Production Monitoring
Verify that monitoring covers uptime, critical API health, server errors, payment failures, database failures, and other production-critical signals. Ensure alerts reach the responsible operator.

## Phase 8 — Final Production Gate

### Full Production Audit
Perform one final end-to-end production readiness audit of VelveraHub. Test registration, login, seller onboarding, product creation, product browsing, search, location selection, checkout/payment, order flow, refunds, account settings, data deletion, contact forms, email flows, mobile UI, accessibility, SEO, security controls, rate limits, error handling, backups, monitoring, and concurrent usage. Fix all critical and high-severity issues before launch.

### Environment & Secrets
Verify that production secrets, API keys, payment credentials, database credentials, and service tokens are stored only in secure server-side environment/secret storage. Remove secrets, test credentials, debug settings, and sensitive configuration from client-side code and repositories.

### Debug & Test Cleanup
Remove production console debugging, test accounts, mock payment flows, placeholder content, temporary bypasses, development endpoints, sample credentials, and unfinished features. Confirm production builds use production configuration.

### Security Headers
Audit and configure appropriate production security headers, including Content-Security-Policy where practical, HSTS, X-Content-Type-Options, Referrer-Policy, and appropriate frame/embed protections. Verify they do not break legitimate VelveraHub functionality.

### Authentication & Authorization
Audit every protected route and API endpoint to ensure authentication and authorization are enforced server-side. Verify that users cannot access another user's account, seller data, orders, private files, admin functions, or restricted resources by changing IDs or URLs.

### Payment Webhooks
Verify payment webhooks use signature/authenticity verification, idempotency, replay protection where supported, and server-side transaction verification. Never trust payment success based only on client-side state.

### Canonical URLs
Audit canonical URL handling across VelveraHub's Nigeria/UK/public pages and product/category/location routes. Prevent duplicate indexing caused by query parameters, alternate URLs, or duplicate page paths.

### HTTPS & Domain Configuration
Verify all production domains use HTTPS correctly, certificates are valid, insecure HTTP requests redirect appropriately, and canonical domain/redirect rules do not create loops or duplicate versions.

---

## Release Gate

**Do not launch VelveraHub until all blocking legal, privacy, security, payment, data-protection, reliability, and critical UX issues are resolved and the final production report confirms the application has been tested in the production environment.**