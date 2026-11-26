---
name: Live checkout inventory verification
description: Checkout must confirm availability from current Supabase data, not a session cache.
---

Cached product details may be used to render a previously viewed listing, but checkout must not treat that cache as proof of current active stock. An inactive or RLS-hidden product can remain in the browser session and fail only when the secure order function runs.

**Why:** a checkout failure can appear after contact details are entered when stale session data passes preflight but the database no longer exposes the listing.

**How to apply:** order preflight must require a live product lookup. Preserve the cart when verification fails temporarily, but do not submit the order; when the live result confirms the product is absent, mark it unavailable and update the cart. Never treat local or session cache as verified inventory.
