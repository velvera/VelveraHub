---
name: Seller-friendly upload limits
description: The marketplace's media caps should be reasonable for sellers and adjustable by admins.
---

For VelveraHub, upload limits should not be so restrictive that sellers complain, and the admin should control them. The current user-approved target is 40 MiB per image or video, with 10 shop photos per product and 10 media files per independent listing. The user states the connected Supabase project is on the Free plan as of 22 November 2026.

The 40 MiB per-file target is below Supabase Free's documented 50 MB maximum, but that does not prove the project's global Storage limit or bucket configuration. Verify the actual settings before attributing failures to size or changing them. Keep MIME types fixed and do not increase the 10-item quotas.

**Why:** the user explicitly approved the 40 MiB file target, retained both 10-item quotas, and stated the current Supabase plan is Free.

**How to apply:** enforce the same per-file ceilings at the client, database, and bucket layers; check the live global and bucket limits before diagnosing or changing production settings.
