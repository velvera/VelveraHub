# VelveraHub backup and restoration runbook

**Status:** Procedure documented; no restore has been performed.  
**Scope:** Supabase database and Storage, Cloudflare Pages, authentication,
marketplace orders, and external payment records.

This runbook is an operational procedure, not proof that backups are enabled,
complete, or restorable for the current accounts. Do not perform a restoration
exercise against production. A production restore is a destructive incident
response step and requires the authorized project owner to approve the target,
restore point, expected downtime, and user/data impact.

## System boundaries

- The four deployed application roots are separate static Cloudflare Pages
  projects: Nigeria storefront, UK storefront, admin, and shop-owner portal.
  The Nigeria and UK projects also contain the existing product-metadata Pages
  Function. Do not add Workers or Pages Functions as part of recovery.
- Supabase contains application tables, database functions/policies, Auth data,
  and Storage bucket metadata. **Database backups do not contain Storage object
  bytes.** Restoring the database alone cannot recover deleted product images,
  videos, verification files, or receipt files.
- The local Express server is not the production runtime for these Pages roots.
  Restore it only if a separately authorized deployment actually uses it.
- Payment provider state is external to VelveraHub's database. Current Paystack
  and Stripe processing is not implemented; manual-payment database records
  exist, but no regional VelveraHub receiving accounts are configured. Never
  infer that an order is paid from a restored row alone.

## Owner-provided recovery prerequisites

Before scheduling a drill, the owner/operator must provide:

1. A named recovery lead and authorized Supabase/Cloudflare operators.
2. The actual Supabase plan, available backup type, retention window, latest
   usable recovery point, and whether Point-in-Time Recovery (PITR) is enabled.
3. A separate, protected backup strategy for Storage object bytes and bucket
   settings, with a verified inventory and integrity-check method.
4. A non-production restore target and disposable accounts.
5. Approved recovery-time objective (RTO), recovery-point objective (RPO),
   maintenance window, escalation contact, and user-communication owner.
6. The authorized method for secure backup access and any required external
   provider records. Credentials stay in the approved secrets/operations
   systems, never in this file, chat, screenshots, or shell arguments.

Do not invent an RTO, RPO, retention period, monitoring destination, or backup
provider.

## Verify backup coverage before a drill

1. In Supabase **Database → Backups**, inspect the target project's plan and
   available backup history. Supabase documents automatic daily database
   backups for Pro, Team, and Enterprise plans, with plan-dependent retention;
   Free projects should maintain off-site logical exports. Verify what is
   actually enabled on the target rather than assuming these general plan
   descriptions apply.
2. If PITR is enabled, record its configured recovery window and the earliest
   and latest available recovery points shown by the dashboard. Supabase
   documents PITR as an add-on for Pro, Team, and Enterprise plans; availability
   and settings for this project are unverified.
3. Confirm database backup coverage separately from Storage. Supabase states
   that database backups exclude Storage API object files. Verify the independent
   file backup includes object bytes, paths, bucket IDs, and required metadata.
   A database-only clone also requires manual reconfiguration, including
   Storage objects/settings and Auth settings as applicable.
4. Confirm the repository/source revision and the last successful production
   deployment for each of the four Pages projects. Rollback targets are
   successful production deployments and may be unavailable if deleted; verify
   the target in the Cloudflare dashboard before relying on it.
5. Identify external records that must be reconciled after recovery: manual
   bank-transfer confirmations, provider transactions/refunds if later enabled,
   email delivery, and any off-platform seller/buyer communications relevant to
   pending orders.
6. Save sanitized evidence of the plan, backup timestamp/recovery point, object
   backup timestamp, code revision, and deployment IDs. Do not save secrets or
   customer data in the evidence.

## Controlled non-production restore drill

Use a dedicated non-production Supabase project and non-production Cloudflare
preview or equivalent isolated Pages target. Never overwrite production during
this exercise.

1. **Open the change record.** Record the incident/drill lead, start time,
   isolated target project reference, target code revision, approved recovery
   point, expected downtime, and rollback/stop criteria. Record no keys, tokens,
   user emails, addresses, or account numbers.
2. **Select and preserve the source.** Choose a database backup/PITR point
   appropriate to the exercise. Before any authorized production incident
   restore, preserve the current state where feasible and document the exact
   intended point and data that may be lost. Never restore blindly.
3. **Restore the database to isolation.** Use the documented Supabase dashboard
   or approved CLI procedure for the selected backup type. Record completion
   and elapsed time. If daily backup restoration omits custom-role passwords,
   reset them through the authorized operator process; never copy them into
   logs.
4. **Restore Storage separately.** Recreate/verify bucket settings and access
   rules, then restore object bytes from the approved independent backup.
   Compare object counts and checksums against the sanitized backup manifest.
   Do not make buckets public or broaden Storage policies to make restoration
   easier.
5. **Reconcile schema and migrations.** Compare the restored schema with
   `database/run-schema.txt` and the project's migration history. Do not blindly
   reapply SQL. Apply only reviewed, missing migrations to the isolated target,
   in order and with the plan/global Storage-limit precondition before migration
   15. Run `database/safety-verification.sql`; it is read-only metadata evidence,
   not a substitute for authenticated behavior tests.
6. **Verify Auth and application configuration.** Test sign-in with disposable
   accounts and verify RLS roles. Confirm every Pages root points at the
   intended non-production Supabase project and exposes only public client
   configuration. Never place service-role, database, payment, or webhook
   secrets in the static roots.
7. **Restore/revert application deployments separately.** If code rollback is
   part of the drill, use each Pages project's own previous successful
   production deployment as the documented rollback target, but execute against
   an isolated target for the drill. Do not assume one project's rollback
   affects the other roots.
8. **Check order and financial consistency.** Compare orders, order items,
   stock, manual-payment instruction snapshots, receipt references, and
   operational events around the chosen recovery point. Confirm no order is
   marked paid solely by a browser state or restored client-submitted value.
   Reconcile any actual external transfer/provider event with its authoritative
   bank/provider record before taking action.
9. **Run isolated acceptance checks.** Verify public routes and catalogue
   reads, sign-in and role boundaries, product/media references, seller/admin
   workflows, and the safe checkout state. For this project, payment-provider
   processing is not ready; do not simulate a card payment or perform a real
   transfer. Do not test deletion on a real account.
10. **Measure and close.** Record actual recovery-point age/data loss and
    elapsed recovery time, compare them with the owner-approved RPO/RTO, list
    missing objects/configuration and failed checks, and obtain operator review
    before declaring the drill passed. Destroy disposable test data only using
    the approved staging cleanup process.

## Production incident restore

This section is not authorization to restore production. During an actual
incident, the named owner must first authorize the project, restore point,
maintenance window, expected data loss, and user communication. Preserve
forensic evidence where appropriate, halt risky writes through the approved
operational controls, and coordinate Supabase database recovery, Storage object
recovery, each Cloudflare deployment, Auth validation, and payment/order
reconciliation as separate workstreams. Do not delete or recreate a Supabase
project as a shortcut. Do not reopen traffic or mark affected orders paid until
the authorized operator has reviewed the reconciliation evidence.

## Current evidence and references

- Current status: Supabase plan/backups/PITR and Storage-object backup are
  unverified; no restore drill or production restoration has been performed.
- Migration ordering and read-only metadata checks:
  [`database/run-schema.txt`](../database/run-schema.txt) and
  [`database/safety-verification.sql`](../database/safety-verification.sql).
- Supabase database backups:
  <https://supabase.com/docs/guides/platform/backups>
- Supabase project cloning and manual reconfiguration:
  <https://supabase.com/docs/guides/platform/clone-project>
- Cloudflare Pages deployment rollbacks:
  <https://developers.cloudflare.com/pages/configuration/rollbacks/>
