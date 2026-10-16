# API-free Cloudflare Pages deployment

VelveraHub's Cloudflare Pages roots are static applications that talk directly
to Supabase with the public anon key. They do not deploy `server.js`, a Worker,
or Pages Functions. Keep `API_ORIGIN` empty in all four roots.

The browser client uses Supabase Auth and PostgREST/Storage. Every table and
bucket operation must be protected by the project's RLS policies; privileged
actions use database RPCs that check the caller's Supabase role. A browser role
check or hidden button is not an authorization boundary.

The repository's Express `server.js` is retained for local development and
smoke tests only. Static builds must not fall back to it. Operations requiring
provider secrets or Supabase Auth administration (for example deleting an Auth
user) cannot be performed safely by an anon-key browser client. The current
account deletion UI therefore submits a request for a trusted admin to review
and complete manually.

Run `npm run apps:sync` followed by `npm run apps:production:check` before
deploying. The production check requires real public Supabase configuration and
rejects a non-empty API origin.