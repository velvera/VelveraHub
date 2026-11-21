import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read('database/account-deletion-status.sql');
const page = read('assets/js/pages/account-privacy.js');
const accountPage = read('veeve/account.html');
const runbook = read('database/run-schema.txt');
const preflight = read('database/safety-verification.sql');

assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_my_account_deletion_request\(\)/i);
assert.match(migration, /request\.user_id = public\.current_profile_id\(\)/i);
assert.match(migration, /'request_id', request\.request_id/i);
assert.doesNotMatch(migration, /email_at_request|customer_email|shipping_address/i);
assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_my_account_deletion_request\(\) FROM PUBLIC, anon/i);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_my_account_deletion_request\(\) TO authenticated/i);
assert.match(migration, /does not delete an Auth user or related marketplace data/i);

assert.match(page, /rpc\('get_my_account_deletion_request'\)/);
assert.match(page, /Your request is awaiting review/);
assert.match(page, /Your request is being reviewed/);
assert.match(page, /marked complete in the review queue/);
assert.match(page, /The request was rejected/);
assert.match(page, /button\.disabled = activeRequest/);
assert.match(accountPage, /check its status here/);
assert.match(runbook, /^16\.\s+database\/account-deletion-status\.sql/m);
assert.match(preflight, /account deletion status RPC is requester-only/);

console.log('PASS requester-only deletion status, minimal response fields, and honest queue messaging');
