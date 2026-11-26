# Build Prompt: VelveraHub Nigeria Mobile App

Copy the prompt below into the coding agent that will build the Android and iOS app.

---

## Prompt

You are a senior mobile and full-stack engineer. Build a production-minded Android and iOS app for **VelveraHub**, extending the existing Nigerian marketplace. This is a mobile client for the current platform—not a replacement for the website, a separate marketplace, or a new backend.

### Product scope

- Build for **Nigeria only** in this release. Use NGN (₦), Nigerian addresses and states, and Nigerian phone numbers (+234). Do not show UK prices, UK addresses, GBP, or a market switcher. UK support will be a separate future phase.
- Support buyers, sellers/shop owners, logistics companies, and independent dispatch riders. A user may have more than one permitted role; use the existing account and authorization model rather than inventing roles or trusting role values supplied by the app.
- Keep the existing VelveraHub website, admin dashboard, database, and deployed storefronts working. Build the mobile client as an isolated Android/iOS app package (Expo/React Native with TypeScript is the preferred default unless the repository already has a deliberate mobile stack). Do not restructure the existing web project or replace its tooling.
- Use the existing Supabase project, authentication, database, storage, Row Level Security, Edge Functions/RPCs, and payment flows. Do not create a duplicate database, bypass existing policies, expose privileged keys, or invent backend endpoints. Inspect the current implementations and migrations before integrating; adapt to what is actually present.

### Inspect before implementation

Start by tracing the current Nigerian experience and the relevant shared backend:

- `velverahub-ng/` is the Nigerian storefront root.
- Review the current auth, listing, shop, cart, checkout, order, seller, and logistics flows in `velverahub-ng/` and shared `assets/`.
- Review `database/schema.sql`, the applicable database security/RLS files, and the additive location/logistics migrations, especially `database/physical-store-logistics.sql` and `database/location-logistics-workflows.sql`. Check `docs/cloudflare-pages.md` for migration order and operational notes.
- Inspect current Supabase RPCs, Edge Functions, payment integration, and role/ownership checks. Verify names, arguments, permissions, and deployed availability before calling them from the mobile app.
- Keep the current database authoritative. Do not apply migrations, change production configuration, or assume that a documented migration has already been applied. If a necessary external setup is missing, identify it clearly rather than substituting fake data.

### Brand and visual direction

Match the existing VelveraHub identity and assets. Use the existing logo rather than recreating it. The core palette is:

- Primary violet: `#6D28D9`
- Primary hover/darker violet: `#5B21B6`
- Light violet accent: `#8B5CF6`
- Pale violet background: `#F5F3FF`
- Dark purple navigation/footer: `#1A0533`
- Main text: `#171717`
- Success: `#16A34A`; error: `#DC2626`

Use Inter for interface text and Poppins for prominent headings where available. Keep the product experience compact, clear, image-led, and familiar to existing VelveraHub users. Use the current logo, icon assets, terminology, and design conventions where appropriate. Build mobile-first screens with safe-area support, accessible contrast and touch targets, clear loading/empty/error states, and layouts that work on small phones and tablets. Do not copy a desktop page into a narrow screen or introduce a conflicting visual identity.

### Buyer experience

Implement real, authenticated and public-browsing flows as supported by the current platform:

1. **Discover and search:** Nigerian marketplace home, categories, listings, shops, search, useful filters, product details, seller/shop details, favorites if supported, and clear listing availability.
2. **Account and cart:** Use the existing authentication and account model. Keep cart behavior consistent with the web app. Before checkout, confirm current product availability from the live backend; cached listing data is not proof of stock.
3. **Checkout and orders:** Reuse the existing Nigerian checkout and payment flow. Show NGN amounts and the actual selected delivery cost. Do not claim payment succeeded until the existing payment confirmation path verifies it. Give buyers an order list and status view consistent with the existing order records.
4. **Physical shop discovery:** Let buyers search shops by Nigerian location and view nearby eligible shops on an interactive, mobile-friendly map and in a useful list. A public shop marker is allowed only when the shop is active/eligible and its physical location has been approved. Show its approved address and a button that opens directions in the device’s navigation app. Never substitute the seller’s pickup/delivery address or a guessed/default coordinate for the verified shop-visit location.
5. **Delivery choice:** Let buyers use device location only after a clear permission request, or enter/search for a delivery destination manually. Find providers using the platform’s authoritative location-matching workflow. Show only approved, verified providers who are currently available and whose active service area covers both the shop’s approved origin and the buyer’s destination for the requested service type. Present provider type, service, fee, currency, estimated time, and any relevant conditions. Allow provider selection during the existing order flow and show the selected provider and delivery status afterward.
6. **Graceful location handling:** If permission is denied, location is unavailable, an address cannot be geocoded, a service is offline, or there are no matching providers, explain the issue and offer a useful manual-location or existing delivery alternative. Never fabricate coordinates, provider availability, a fee, an ETA, or a successful match.

### Seller and shop-owner experience

- Reuse current seller sign-in, shop ownership checks, listing tools, order management, and seller dashboard concepts.
- Let an authorized shop owner submit and manage the **physical shop-visit location** separately from pickup, delivery, and account addresses. Show review status and make clear that an unapproved location is not public and cannot be used as an approved origin for provider matching.
- Allow an owner to find currently approved and available delivery companies/riders serving the shop, with meaningful fee/ETA information where the backend provides it.
- Give sellers a way to manage incoming orders and see delivery-request status through the existing order workflow.
- Let sellers invite an eligible independent rider to a workforce arrangement when supported. Temporary and permanent engagements must have their own terms, dates, status, and records. They are not orders and must not be created, tracked, or cancelled as delivery requests.

### Provider experience

Provide distinct onboarding for:

- **Logistics companies**, with business profile and business-verification details.
- **Independent dispatch riders**, who register as individuals and do not need a company affiliation.

Providers must be able to submit and edit their own profile, operating areas, services, rates, ETAs, and availability using server-authorized operations. Collect only information required by the current verification process. Show clear pending, resubmission, approved, rejected, or suspended states. Pending, rejected, or suspended providers must not be publicly discoverable or receive new delivery work.

For availability and matching:

- Make provider availability explicitly time-bounded or otherwise consistent with the backend’s expiry rules; show when it expires and let the owner renew or turn it off.
- Treat availability for an individual order delivery as separate from a rider’s willingness to accept temporary or permanent employment.
- Make the provider’s active service areas and service types visible to them and editable under the existing rules.
- Always use live backend matching, not a broad state-only filter or client-side distance estimate, as the authority for whether a provider is eligible. A provider who is registered but unavailable, expired, unverified, or outside coverage must not appear as a selectable match.
- Let a provider review, accept, reject, and update the status of delivery requests that are assigned to them. Use only valid status transitions and the server’s authorization rules. Show a status timeline from real request events.
- Let eligible independent riders manage separate workforce invitations and engagements. These records and transitions must remain isolated from per-order delivery records.

### Keep these three location and work domains separate

1. **Store discovery** answers where a buyer can find and physically visit a shop. Use the shop’s separately reviewed physical location.
2. **Order delivery** answers which currently available provider can deliver a particular order from that shop to that buyer. Use the live provider-matching and delivery-request workflow.
3. **Workforce hiring** answers whether a seller and rider/company have a temporary or permanent work arrangement. Use a separate engagement workflow with its own terms and lifecycle.

These domains may reuse map display, geocoding, shared provider profiles, and verification status, but must not share or overload each other’s records, addresses, availability semantics, status transitions, or business rules.

### Admin and trust boundaries

- Keep administrator review, provider approval/rejection/suspension, identity and business-document access, complaint handling, platform fees, and provider-related configuration within the existing admin authorization system and dashboard unless the project already has a deliberately supported admin mobile workflow.
- Do not make an administrator action available merely because the client hides or shows a button. Every privileged operation must be enforced by RLS, a guarded RPC/Edge Function, or the existing trusted server path.
- Never download verification documents into public storage or expose their storage paths/contents to buyers, sellers, or other providers. Use the existing private bucket and short-lived authorized access pattern.
- Never allow a client to set its own verification, approval, admin role, platform commission, or another user’s profile, delivery assignment, or review decision.
- Preserve and strengthen existing policies; do not remove policies or grant broad table access as a shortcut.
- Use safe error messages that do not disclose private identity or business information.

### Location, maps, and external configuration

The existing web logistics service uses OpenStreetMap tiles/geocoding with Leaflet/Nominatim. Inspect its current use and applicable service terms before choosing a native map renderer or geocoder. Leaflet is a web map library, so do not assume it can render a proper native map view. Use a mobile-compatible integration with required attribution, sensible request behavior, and the same trusted location/matching data as the platform. Do not invent or commit provider credentials; report any required map SDK keys or service configuration for secure setup.

The app must distinguish:

- A map’s neutral initial camera from a real, verified shop/provider coordinate.
- A user-selected delivery destination from the seller’s shop location.
- Public, approved shop coordinates from private or pending coordinates.

If map tiles, geocoding, or device location fail, preserve a useful address/list flow and show a clear retry or manual-entry path.

### Engineering and compatibility requirements

- Keep the mobile package isolated from the existing Cloudflare Pages roots and avoid changing root scripts, lockfiles, deployment settings, or database behavior unless necessary and explicitly explained.
- Reuse current APIs/RPCs and canonical data. Do not duplicate business rules in the client; server-side results decide permissions, eligibility, fees, statuses, and checkout validity.
- Keep secrets out of source, app bundles, logs, and error reports. Use only public client configuration in the app and trusted server-side secrets for privileged work.
- Handle expired sessions, network timeouts, retries, duplicate taps, stale quotes, unavailable inventory, and interrupted uploads safely. Avoid creating duplicate orders or engagements when a request is retried.
- Respect Nigerian date/phone/address conventions and the current market’s currency and payment configuration. Do not assume a specific payment option is enabled if the live configuration says otherwise.
- Include accessible labels, screen-reader-friendly controls, keyboard-safe forms, offline/error feedback, and loading/empty states. Do not display success when a request has only been queued or submitted.
- Do not use mock providers, fake verification badges, placeholder shop pins, simulated availability, or hard-coded delivery quotes in release flows. Seeded fixtures are acceptable only in isolated tests and must never appear as production data.

### Verification and handoff

Implement the working app; do not stop after generating screens or a proposal. Test on both iOS and Android targets, including:

- Buyer browse, account, cart, checkout, and order flows against the existing backend.
- Physical-shop map/list behavior, approved-location visibility, and directions handoff.
- Location permission denied, manual destination entry, bad address, map/geocoder/network failure, and no matching provider.
- Provider onboarding for both provider categories, pending/approved/rejected states, availability expiry, coverage matching, delivery request handling, and status tracking.
- Seller-owned shop-location editing/review state, delivery-provider discovery, and distinct temporary/permanent rider engagement flows.
- Unauthorized access attempts for private documents, provider edits, delivery assignment/status changes, engagement changes, and admin-only actions.
- Existing web storefront, checkout, seller, shop-owner, and admin behavior remains unchanged.

Run the repository’s relevant checks and add mobile tests for key workflows and authorization-sensitive states. Verify that any needed database migrations are additive and documented; do not apply them to production without authorization. Report:

1. Mobile app structure and features implemented.
2. Existing backend/RPCs and migrations reused, and any additive database changes.
3. Security and authorization boundaries tested.
4. Android/iOS and regression checks performed, with results.
5. External configuration still needed (such as map credentials, Supabase public configuration, or payment setup), without exposing secret values.

Do not claim deployment, store publication, or live-service readiness unless those steps were actually authorized and completed.
