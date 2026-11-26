import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migrationGuide = read('database/run-schema.txt');
const verificationSql = read('database/safety-verification.sql');
const storagePolicies = read('database/supabase-rls.sql');
const deletionPolicies = read('database/cloudflare-supabase-direct.sql');
const checkoutMigration = read('database/production-hardening.sql');
const paymentsMigration = read('database/shop-owner-payments.sql');
const manualPaymentsMigration = read('database/marketplace-manual-payments.sql');
const mediaSettingsMigration = read('database/marketplace-media-settings.sql');
const listingSubmissionFixes = read('database/student-listing-submission-fixes.sql');
const mediaQuotaConflictFix = read('database/fix-product-media-upload-quota-conflict.sql');
const phoneVerificationMigration = read('database/phone-verification.sql');
const deletionStatusMigration = read('database/account-deletion-status.sql');
const adminWorkspace = read('admin-workspace/index.html');
const adminWorkspaceJs = read('admin-workspace/admin.js');
const sellerDashboard = read('assets/js/pages/seller-dashboard.js');
const studentListing = read('assets/js/pages/student-listing.js');
const server = read('server.js');
const stagingGuide = read('docs/staging-acceptance.md');
const cloudflareGuide = read('docs/cloudflare-pages.md');

const migrations = [...migrationGuide.matchAll(/^\s*(\d+)\.\s+(database\/[^\s—]+)/gm)]
    .map((match) => ({ order: Number(match[1]), path: match[2] }));
assert.equal(migrations.length, 21, 'the migration guide must list the full numbered migration set');
assert.deepEqual(migrations.map(({ order }) => order), Array.from({ length: 21 }, (_, index) => index + 1));
assert.equal(new Set(migrations.map(({ path }) => path)).size, migrations.length, 'migration files must not be duplicated');
for (const { path } of migrations) assert.ok(fs.existsSync(new URL(`../${path}`, import.meta.url)), `${path} must exist`);
const sqlFiles = fs.readdirSync(new URL('../database/', import.meta.url)).filter((name) => name.endsWith('.sql'));
for (const filename of sqlFiles) {
    assert.ok(migrationGuide.includes(`database/${filename}`), `${filename} must be classified in the migration runbook`);
}
assert.match(migrationGuide, /account-deletion\.sql.*legacy databases/i);
assert.match(migrationGuide, /docs\/staging-acceptance\.md/);

const readOnlySql = verificationSql.replace(/--.*$/gm, '');
assert.doesNotMatch(readOnlySql, /^\s*(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|GRANT|REVOKE|TRUNCATE)\b/gim);
for (const check of [
    'product media buckets enforce platform ceilings and MIME types',
    'product media uploads require owner policies and restrictive validation',
    'obsolete student-only listing policies are removed',
    'atomic product media quota tables and storage triggers exist',
    'product media quota state is private to server-side policies',
    'account deletion request table is protected by RLS',
    'account deletion RPCs exist with restricted request access',
    'account deletion status RPC is requester-only',
    'account deletion status RPC is requester-only',
    'secure checkout RPC exists and is not missing its client grants',
    'order idempotency has a valid unique index',
    'regional payment records remain server-only',
    'manual-payment columns exist',
    'manual-payment destinations have scoped read and admin-only writes',
    'manual-payment confirmations remain server and RPC only',
    'manual-payment RPCs have the expected role grants',
    'marketplace media settings are protected and complete',
    'marketplace media settings RPCs have restricted write access',
    'marketplace media size guard is installed',
    'product media quota trigger avoids ambiguous conflict variables',
    'phone verification schema is private and disabled by default',
    'phone verification setting and verification state are server controlled',
    'phone verification signup and publishing triggers are installed',
    'public product and media reads use phone verification visibility',
]) {
    assert.ok(verificationSql.includes(check), `read-only preflight must report: ${check}`);
}

assert.match(storagePolicies, /CREATE POLICY "sellers can upload listing images"/);
assert.match(storagePolicies, /CREATE POLICY "restrict product media uploads"/);
assert.match(storagePolicies, /CREATE TRIGGER enforce_product_media_object_quota/);
assert.match(storagePolicies, /CREATE TRIGGER release_product_media_quota/);
assert.match(deletionPolicies, /create or replace function public\.request_account_deletion\(\)/i);
assert.match(deletionPolicies, /create or replace function public\.admin_update_account_deletion_request/i);
assert.match(deletionStatusMigration, /create or replace function public\.get_my_account_deletion_request\(\)/i);
assert.match(deletionStatusMigration, /grant execute on function public\.get_my_account_deletion_request\(\) to authenticated/i);
assert.doesNotMatch(deletionStatusMigration, /grant execute on function public\.get_my_account_deletion_request\(\) to [^;]*anon/i);
assert.match(checkoutMigration, /v_payment_method NOT IN \('cash_on_delivery', 'bank_transfer'\)/);
assert.match(server, /if \(!\['cash_on_delivery', 'bank_transfer'\]\.includes\(payment_method\)\)/);

assert.match(paymentsMigration, /provider IN \('paystack', 'stripe'\)/);
assert.match(manualPaymentsMigration, /CREATE TABLE IF NOT EXISTS public\.marketplace_payment_destinations/i);
assert.match(manualPaymentsMigration, /REVOKE ALL ON public\.order_manual_payment_confirmations FROM PUBLIC, anon, authenticated/i);
assert.match(mediaSettingsMigration, /product_image_max_bytes BIGINT NOT NULL DEFAULT 41943040/i);
assert.match(mediaSettingsMigration, /product_video_max_bytes BIGINT NOT NULL DEFAULT 41943040/i);
assert.match(mediaSettingsMigration, /CREATE TRIGGER enforce_marketplace_product_media_size/i);
assert.match(mediaSettingsMigration, /coalesce\(NEW\.metadata->>'size', NEW\.metadata->>'contentLength'\)/i);
assert.match(phoneVerificationMigration, /phone_verification_enabled BOOLEAN NOT NULL DEFAULT FALSE/i);
assert.match(phoneVerificationMigration, /phone_verification_challenges ENABLE ROW LEVEL SECURITY/i);
assert.match(phoneVerificationMigration, /phone_e164_unique/i);
assert.match(phoneVerificationMigration, /enforce_phone_verification_signup/i);
assert.match(phoneVerificationMigration, /enforce_phone_verification_before_publish/i);
assert.match(phoneVerificationMigration, /phone_verification_product_is_public/i);
assert.match(phoneVerificationMigration, /phone_verification_product_media_is_public/i);
assert.match(phoneVerificationMigration, /REVOKE ALL ON FUNCTION public\.admin_update_phone_verification\(BOOLEAN, BOOLEAN, BOOLEAN\) FROM PUBLIC, anon, authenticated/i);
assert.match(read('supabase/functions/phone-verification/core.mjs'), /await requireAdmin\(request\)/);
assert.match(read('supabase/functions/phone-verification/core.mjs'), /TERMII_API_KEY/);
assert.match(read('docs/phone-verification.md'), /TERMII_API_KEY/);
assert.match(read('docs/phone-verification.md'), /disabled by default/i);
assert.match(listingSubmissionFixes, /coalesce\(NEW\.metadata->>'size', NEW\.metadata->>'contentLength'\)/i);
assert.match(listingSubmissionFixes, /to_jsonb\(new\) -> 'image_url'/i);
assert.match(listingSubmissionFixes, /to_jsonb\(old\) -> 'image_url'/i);
assert.match(mediaQuotaConflictFix, /DECLARE\s+v_product_id UUID/i);
assert.match(mediaQuotaConflictFix, /VALUES \(v_product_id, 1\)\s+ON CONFLICT \(product_id\)/i);
assert.match(mediaQuotaConflictFix, /SECURITY DEFINER/i);
assert.doesNotMatch(
    read('database/cloudflare-dashboard.sql'),
    /new\.image_url|old\.image_url/i,
    'the listing review trigger must support product schemas without an image_url column',
);
assert.match(mediaSettingsMigration, /admin_update_marketplace_media_limits/i);
assert.match(adminWorkspace, /id="mediaSettingsPanel"/);
assert.match(adminWorkspaceJs, /get_marketplace_media_limits/);
assert.match(adminWorkspaceJs, /admin_update_marketplace_media_limits/);
assert.match(sellerDashboard, /loadSellerMediaLimits/);
assert.match(studentListing, /loadMarketplaceMediaLimits/);
assert.match(studentListing, /product_video_max_bytes/);
assert.doesNotMatch(studentListing, /listing_type|student_item|student_ad/);
assert.doesNotMatch(storagePolicies, /listing_type|student_item|student_ad/);
assert.match(mediaSettingsMigration, /p_product_image_limit INTEGER/);
assert.doesNotMatch(mediaSettingsMigration, /student_listing_media_limit/);
assert.match(stagingGuide, /Do not run the write tests against production/);
assert.match(cloudflareGuide, /Staging upload-policy acceptance/);
assert.match(cloudflareGuide, /Never run these\s+write tests against production/);
assert.match(stagingGuide, /Invalid signature/);
assert.match(stagingGuide, /Timeout\/unknown result/);
assert.match(stagingGuide, /Partial and full refund/);

console.log('PASS migration manifest, read-only Supabase checks, and offline-only checkout safety guards');
