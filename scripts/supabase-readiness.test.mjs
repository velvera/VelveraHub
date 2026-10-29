import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migrationGuide = read('database/run-schema.txt');
const verificationSql = read('database/safety-verification.sql');
const storagePolicies = read('database/supabase-rls.sql');
const deletionPolicies = read('database/cloudflare-supabase-direct.sql');
const checkoutMigration = read('database/production-hardening.sql');
const paymentsMigration = read('database/shop-owner-payments.sql');
const server = read('server.js');
const stagingGuide = read('docs/staging-acceptance.md');

const migrations = [...migrationGuide.matchAll(/^\s*(\d+)\.\s+(database\/[^\s—]+)/gm)]
    .map((match) => ({ order: Number(match[1]), path: match[2] }));
assert.equal(migrations.length, 14, 'the migration guide must list the full numbered migration set');
assert.deepEqual(migrations.map(({ order }) => order), Array.from({ length: 14 }, (_, index) => index + 1));
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
    'product image bucket enforces WebP and 5 MiB',
    'product media uploads require owner policies and restrictive validation',
    'atomic product media quota tables and storage triggers exist',
    'product media quota state is private to server-side policies',
    'account deletion request table is protected by RLS',
    'account deletion RPCs exist with restricted request access',
    'secure checkout RPC exists and is not missing its client grants',
    'order idempotency has a valid unique index',
    'regional payment records remain server-only',
]) {
    assert.ok(verificationSql.includes(check), `read-only preflight must report: ${check}`);
}

assert.match(storagePolicies, /CREATE POLICY "students can upload listing images"/);
assert.match(storagePolicies, /CREATE POLICY "restrict product media uploads"/);
assert.match(storagePolicies, /CREATE TRIGGER enforce_product_media_object_quota/);
assert.match(storagePolicies, /CREATE TRIGGER release_product_media_quota/);
assert.match(deletionPolicies, /create or replace function public\.request_account_deletion\(\)/i);
assert.match(deletionPolicies, /create or replace function public\.admin_update_account_deletion_request/i);
assert.match(checkoutMigration, /v_payment_method NOT IN \('cash_on_delivery', 'bank_transfer'\)/);
assert.match(server, /if \(!\['cash_on_delivery', 'bank_transfer'\]\.includes\(payment_method\)\)/);

assert.match(paymentsMigration, /provider IN \('paystack', 'stripe'\)/);
assert.match(stagingGuide, /Do not run the write tests against production/);
assert.match(stagingGuide, /Invalid signature/);
assert.match(stagingGuide, /Timeout\/unknown result/);
assert.match(stagingGuide, /Partial and full refund/);

console.log('PASS migration manifest, read-only Supabase checks, and offline-only checkout safety guards');
