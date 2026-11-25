# VelveraHub - Multi-Vendor E-Commerce Platform

## Overview
VelveraHub is a world-class multi-vendor e-commerce platform designed to compete with Jumia. Built with vanilla HTML/CSS/JS frontend and Express.js + PostgreSQL backend. Targets Nigeria (.com.ng) and United Kingdom (.co.uk) markets with full region-aware pricing, phone formats, and address flows.

## Brand Colors
- Primary: #6D28D9 (deep violet) — buttons, CTA, search, logo accent and seller tools
- Primary hover: #5B21B6
- Light accent: #8B5CF6
- Light background: #F5F3FF
- Dark text: #171717
- Success: #16A34A; Error: #DC2626
- Secondary (dark nav/footer): #1a0533 (dark purple)
- Category nav: #1e1b4b → #312e81 (dark indigo, Jumia-style)

## Tech Stack
- **Frontend**: Vanilla HTML5, CSS3, JavaScript (ES6+)
- **Production hosting**: Cloudflare Pages serves the repository as static files; there is no build command or package installation required for deployment
- **Database**: Supabase/PostgreSQL as the permanent production data source
- **Auth**: Supabase Auth in production
- **Local preview only**: Node.js + Express.js (`server.js`) remains available for the Replit preview and API fallback; it is not required by the Cloudflare Pages static deployment

## Directory Structure
```
/
├── index.html                  # Main homepage (region-aware, Jumia/Alibaba-style)
├── server.js                   # Express server for the static frontend and API fallback
├── config.js                   # Local Supabase config (gitignored)
├── assets/
│   ├── css/
│   │   ├── base.css            # Global styles & CSS variables
│   │   └── components/
│   │       ├── navbar.css      # Compact navbar, region badge, dark purple cat nav
│   │       ├── products.css    # 5-col desktop grid, compact 200px cards
│   │       ├── hero.css        # Compact hero banner (220px desktop, 160px mobile)
│   │       ├── home-sections.css # Quick links, trending, popular, you-may-like
│   │       ├── categories.css
│   │       ├── footer.css
│   │       ├── modal.css
│   │       └── cart.css        # Cart sidebar with mobile flex fix (flex-shrink footer)
│   └── js/
│       ├── app.js              # Main app: trending, popular-in-region, YML infinite scroll, hero, cart, auth
│       ├── services/
│       │   ├── region.js       # RegionService: NG/UK detection, formatPrice, states/regions
│       │   ├── supabaseClient.js
│       │   ├── auth.js
│       │   ├── products.js
│       │   └── cart.js
│       ├── state/
│       │   └── store.js
│       └── components/
│           └── ui.js           # UI rendering (region-aware prices, coverage areas)
├── veeve/
│   ├── product.html
│   ├── products.html
│   ├── shop.html
│   └── checkout.html           # Region-aware: phone, state dropdown, pricing
├── seller-workspace/           # Canonical seller UI copied into NG and UK storefronts
│   ├── index.html
│   └── dashboard.css
├── shop-owner/                 # Source files for the standalone static shop portal
│   ├── index.html
│   └── dashboard.js
├── velverahub-shop/            # Static Pages output for velverahub.shop
└── database/
    ├── schema.sql                 # Canonical Supabase schema
    ├── supabase-rls.sql           # RLS and Storage policies
    ├── production-hardening.sql  # Secure checkout RPC
    ├── shop-owner-payments.sql  # Shop-owner and regional payment records
    ├── admin.sql                  # Operator-only admin promotion
    └── seller.sql                 # Operator-only seller promotion
```

## Region System (assets/js/services/region.js)
- Detects region from hostname: `.com.ng` / `.ng` → Nigeria, `.co.uk` / `.uk` → UK
- Falls back to `localStorage.getItem('velvera_region')` → defaults to `ng`
- `RegionService.formatPrice(usdAmount)` — converts USD → ₦ (×900) or £ (×0.79)
- `RegionService.freeShippingThreshold` — ₦5,000 (NG) / £30 (UK)
- `RegionService.phonePrefix` — +234 (NG) / +44 (UK)
- `RegionService.setRegion(r)` — saves to localStorage and reloads
- Must be loaded BEFORE supabaseClient.js and ui.js on every page

## Key Features Implemented
1. **Region-aware homepage** — scrolling banner, flag badge, region switcher modal, mobile bottom nav
2. **Compact Jumia-style product grid** — 5 cols desktop, 3 tablet, 2 mobile; 200px image height
3. **Dark purple category nav** — gradient `#1e1b4b → #312e81`
4. **Shop coverage areas** — shop owners select Nigerian states or UK regions to serve
5. **Region-aware checkout** — phone placeholder, state/region dropdown, pricing in ₦ or £
6. **Server API** — `/api/orders`, `/api/seller/shop` (with `coverage_areas TEXT[]`)
7. **Mobile bottom nav** — Home, Cart (with badge), Wishlist, Account

## API Endpoints (server.js)
- `GET /api/products` — products with filters
- `GET /api/shops` — top shops
- `POST /api/orders` — create order
- `GET /api/orders` — seller orders (auth required)
- `PUT /api/seller/shop` — update shop + coverage_areas

## Replit Development

The Replit workflow is **Start application** and runs `npm start` (`node server.js`)
on `0.0.0.0:5000` for local preview only. Use Replit's Run button to start it;
there is no frontend build step. Dependencies are installed from `package.json`.
The existing `SESSION_SECRET` supplies the server's JWT signing secret.

The browser connects directly to the configured **test** Supabase project.
Do not create a replacement database or apply migrations just to start the
preview. The optional Express database-backed API requires an explicitly
configured `DATABASE_URL`; without it, the health and static routes work but
database-backed API features are not configured. A successful `/healthz`
response confirms the server is running, not database readiness.

Useful checks:
- `npm run smoke` checks local storefront, regional, seller, shop, admin, and health routes.
- `SMOKE_REQUIRE_SUPABASE=1 npm run smoke` additionally checks that public Supabase configuration is present (not live connectivity).

The browser uses `assets/js/services/publicSupabaseConfig.js` for the shared
public Supabase URL and anon key. Never expose `service_role`, `JWT_SECRET`,
`SESSION_SECRET`, `DATABASE_URL`, or any other server credential to the client.

## Independent Applications

The production structure has four independently deployable roots:

- `velverahub-ng/` → its own Cloudflare Pages project and domain: `velverahub.com`
- `velverahub-uk/` → its own Cloudflare Pages project and domain: `velverahub.co.uk`
- Seller workspace is integrated into both storefront roots at `/veeve/seller.html`; there is no separate seller deployment.
- `velverahub-admin/` → `velverahub.org`
- `velverahub-shop/` → `velverahub.shop`, with explicit shop onboarding separate from ordinary seller accounts

The NG and UK storefronts are deployed separately and must remain self-contained. `npm run apps:sync` copies the seller workspace source into both storefronts; do not link one region to assets hosted by the other.

The generated roots can be safely overlaid with `npm run apps:sync`; `npm run
apps:generate` is a full regeneration that removes and recreates generated
roots. The NG, UK, admin, and shop roots are static Pages output: do not add
Workers, Pages Functions, or `wrangler.toml` files to them. Public Supabase
values are static browser configuration; privileged credentials stay outside
the deployed static roots.

## Design System
- Primary: `#6D28D9` (Deep Violet)
- Secondary: `#f43f5e` (Rose)
- Category Nav: `linear-gradient(135deg, #1e1b4b, #312e81)`
- Typography: Poppins (display) + Inter (body)
- Copyright: VelveraHub © 2026

## Database Notes
- Tables: `profiles`, `shops` (has `coverage_areas TEXT[]`), `products`, `product_images`, `orders`, `order_items`, `reviews`
- Does not fall back to demo/mock data when the database is unavailable; storefronts show an honest empty/error state
- Apply the ordered migrations in `docs/cloudflare-pages.md` before enabling checkout on Cloudflare Pages
- Keep `velverahub-shop/` deployed separately; only a seller who explicitly creates a shop becomes a shop owner
- `ALTER TABLE shops ADD COLUMN IF NOT EXISTS coverage_areas TEXT[]` runs on shop update

## User Preferences
- Nigeria 🇳🇬 + UK 🇬🇧 only — no other markets
- Jumia-style compact design, world-class quality
- Fully responsive: desktop (5-col), iPad (3-col), mobile (2-col + bottom nav)
- Smart buyer assistance: state-aware filtering, search suggestions and compact AI/live-support widget
- Shop owners can create and update Supabase products with compressed WebP images
- VelveraHub branding everywhere, Copyright 2026
