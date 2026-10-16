# VelveraHub Roadmap

This roadmap records the ideas currently captured in `ideas.txt` and separates work that is already present from work that is still pending.

## Completed or substantially implemented

- **Nigeria and UK regional marketplace foundation** — the project has region-aware pricing, phone formats, shipping thresholds, location choices, and Nigerian/UK coverage areas.
- **Product location filtering foundation** — product listings, the home-page location controls, the locations API, and seller product location fields are wired for state-aware filtering.
- **Mobile-first marketplace layout foundation** — responsive product grids, horizontal product rails, mobile bottom navigation, and responsive seller dashboard styling are present.
- **Supabase-first seller product management foundation** — authenticated shop owners can create, edit, delete, and list products through Supabase when their account is linked to a shop.
- **Compressed product image foundation** — selected product images are resized in the browser, encoded as WebP previews, and uploaded to the Supabase `product-images` storage bucket.
- **Deep Violet brand system** — the faculty-recommended `#6D28D9` palette is used across the shared design system.
- **Seller shop coverage areas** — sellers can select Nigerian states or UK regions where their shop delivers.
- **Consistent application states** — storefront, seller, and admin JavaScript entry points expose loading, empty, error, and expired-session states.
- **Location-aware search assistance** — search suggestions honor the selected location and navigate shoppers to filtered results.
- **Compact buyer assistance** — static entry points include the dark support/AI assistance widget.
- **Homepage and product rail polish** — hero spacing and invisible horizontal product rails prevent overlap and improve mobile browsing.
- **Shopper location controls** — header and homepage selectors expose the available Nigeria/UK locations and refresh listings.
- **Seller live-data sections** — seller orders, reviews, promotions, analytics, reports export, and settings navigation have live-data states.
- **Seller image lifecycle** — product create/edit supports six compressed WebP images with replacement, deletion, and failed-upload cleanup.
- **Supabase RLS and Storage policy documentation** — owner-scoped product CRUD and the public, WebP-only `product-images` bucket are defined in `database/supabase-rls.sql`.
- **Trust graph and buyer protection score — first slice** — normalized seller evidence score uses verified identity, ratings, sales history, and delivery coverage; returns, response time, and disputes remain explicitly “Not measured yet” until their data exists. Scores and confidence are shown on shop cards, shop pages, and product detail pages with the evidence breakdown.
- **Production smoke-check tooling** — `npm run smoke` checks storefront/dashboard routes locally or against a deployed Pages URL.
- **Authenticated Supabase browser checks** — `npm run auth:browser` signs in with injected shopper, seller, and admin accounts, verifies their profile roles and seller shop ownership, and checks the relevant authenticated routes without storing credentials.
- **Delivery promise engine — first slice** — product cards and recommendation cards now show an item-level business-day arrival range using selected location, seller coverage, processing time, courier history, cut-off time, weekends, and configured public holidays, plus a reliability score.
- **Personalized discovery and experimentation — first slice** — shoppers can opt into browser-only event tracking; session signals rank recommendations, a deterministic 15% holdout supports controlled comparison, and recommendation events retain contribution-margin fields when supplied.
- **Delivery promise engine — expanded slice** — promise calculations now have a server-backed endpoint with seller handling time, courier SLA, cut-off, reliability, holiday-aware business days, inventory verification, and checkout-level arrival windows, while preserving the client fallback.
- **Personalized discovery with an experimentation moat — expanded slice** — consented events are durably ingested when the analytics table is available, search/checkout/purchase events are supported, and admins have a 90-day variant, session, event, and contribution-margin report.
- **Seller operating system — first operational slice** — seller operations now have a durable endpoint for demand forecasts, reorder quantities, pricing signals, listing quality issues, and next-best actions, with the existing client-side fallback retained.
- **Verified quality and provenance layer — first operational slice** — products now have quality, policy, inventory, provenance, and duplicate-listing metadata; seller validation blocks policy/duplicate errors and surfaces review warnings before publishing.
- **Local-market advantage — first operational slice** — Nigeria/UK market contexts now feed location-aware delivery, payment, cash-on-delivery, and promotion signals into discovery, checkout messaging, and product presentation.
- **Compounding marketplace data advantage — first operational slice** — consented events retain location, seller benchmarks remain private, and aggregated demand-versus-supply gaps are available for seller opportunity discovery and admin assortment planning.

## Pending

### Marketplace intelligence and reliability

### Production readiness

- Configure the production Cloudflare Pages project and run the documented deployment smoke test against its configured Supabase project.
- **Reliability and observability gate** — add real-user performance monitoring, API error budgets, synthetic checkout tests, structured audit logs, and an incident playbook before scaling acquisition.
- **Unit economics control plane** — track contribution margin by seller, category, region, delivery lane, and promotion; require experiments and subsidies to show payback before expansion.
- **Security and compliance baseline** — complete threat modeling, least-privilege access reviews, consent/retention policies, privacy export/deletion flows, and payment-data isolation before handling meaningful volume.

### Highest-leverage sequence

1. Establish the event taxonomy, seller/buyer outcome metrics, and contribution-margin dashboard.
2. Launch verified seller trust signals and delivery promises in one Nigerian city cluster and one UK region.
3. Use the resulting data to improve ranking, recommendations, and seller next-best actions through measured experiments.
4. Scale the winning playbook only after reliability, fraud, support, and unit-economics gates pass.