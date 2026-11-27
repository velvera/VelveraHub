import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const accessService = read('assets/js/services/admin-access.js');
const adminMigration = read('database/admin-access-and-verification-hardening.sql');
const adminPromotion = read('database/admin.sql');
const sellerVerification = read('database/seller-trust-verification.sql');
const logisticsVerification = read('database/admin-access-and-verification-hardening.sql');
const phoneVerification = read('database/phone-verification.sql');
const adminScript = read('admin-workspace/admin.js');
const adminHtml = read('admin-workspace/index.html');

const accessWindow = {};
vm.runInNewContext(accessService, { window: accessWindow });

function makeSupabase({ role = 'customer', primary = false, session = true } = {}) {
    const calls = [];
    return {
        calls,
        auth: {
            async getSession() {
                calls.push('getSession');
                return { data: { session: session ? { user: { id: 'test-auth-id' } } : null }, error: null };
            },
            async getUser() {
                calls.push('getUser');
                return { data: { user: { id: 'test-auth-id' } }, error: null };
            }
        },
        async rpc(name) {
            calls.push(name);
            if (name === 'current_profile_role') return { data: role, error: null };
            if (name === 'admin_role_management_status') return { data: primary, error: null };
            throw new Error(`Unexpected RPC: ${name}`);
        }
    };
}

{
    const client = makeSupabase({ role: 'admin', primary: true });
    const result = await accessWindow.AdminWorkspaceAccess.resolve(client);
    assert.equal(result.status, 'admin', 'a linked admin profile must pass the live role check');
    assert.equal(result.user.id, 'test-auth-id');
    assert.deepEqual(client.calls, ['getSession', 'getUser', 'current_profile_role']);
    assert.equal(await accessWindow.AdminWorkspaceAccess.canManageAdminRoles(client), true);
}

{
    const client = makeSupabase({ role: 'customer' });
    assert.equal((await accessWindow.AdminWorkspaceAccess.resolve(client)).status, 'denied');
    assert.equal(client.calls.at(-1), 'current_profile_role');
}

{
    const client = makeSupabase({ session: false });
    assert.equal((await accessWindow.AdminWorkspaceAccess.resolve(client)).status, 'signed_out');
    assert.deepEqual(client.calls, ['getSession']);
}

{
    const client = makeSupabase({ role: 'customer' });
    assert.equal((await accessWindow.AdminWorkspaceAccess.resolve(client)).status, 'denied');
    client.auth.getSession = async () => ({ data: { session: { user: { id: 'test-auth-id' } } }, error: null });
    client.rpc = async (name) => ({ data: name === 'current_profile_role' ? 'admin' : false, error: null });
    assert.equal((await accessWindow.AdminWorkspaceAccess.resolve(client)).status, 'admin',
        'a fresh session must see a role promotion without trusting cached profile data');
}

assert.match(adminMigration, /CREATE OR REPLACE FUNCTION public\.admin_find_role_management_users/i);
assert.match(adminMigration, /candidate\.user_id IS NULL\s+AND lower\(candidate\.email\) = lower\(auth_user\.email\)/i,
    'role lookup must support a uniquely matching unlinked legacy profile');
assert.match(adminMigration, /profile\.user_id = p_target_user_id[\s\S]*?profile\.id = p_target_user_id[\s\S]*?lower\(profile\.email\) = lower\(v_target_email\)/i,
    'role changes must find and safely repair a legacy profile link by email');
assert.match(adminMigration, /v_target_linked_user_id <> p_target_user_id[\s\S]*?resolve the mapping first/i,
    'a profile linked to another Auth user must not be reassigned');
assert.match(adminMigration, /primary administrator access is required/i);
assert.match(adminMigration, /the primary administrator cannot be removed/i);
assert.match(adminMigration, /the last administrator cannot be removed/i);
assert.match(adminMigration, /char_length\(btrim\(coalesce\(p_reason, ''\)\)\) NOT BETWEEN 5 AND 500/i);
assert.match(adminMigration, /prevent_admin_role_audit_mutation[\s\S]*?BEFORE UPDATE OR DELETE/i);
assert.match(adminMigration, /REVOKE ALL ON FUNCTION public\.bootstrap_primary_admin_access\(TEXT\)[\s\S]*?FROM PUBLIC, anon, authenticated[\s\S]*?GRANT EXECUTE[\s\S]*?TO service_role/i);
assert.match(adminMigration, /REVOKE ALL ON FUNCTION public\.admin_update_user_admin_role\(UUID, BOOLEAN, TEXT\)[\s\S]*?FROM PUBLIC, anon[\s\S]*?GRANT EXECUTE[\s\S]*?TO authenticated/i);
assert.match(adminPromotion, /GRANT EXECUTE ON FUNCTION public\.assign_admin_role\(text\) TO service_role/i);

assert.match(adminHtml, /id="roleManagementTab"[^>]*data-admin-view="roleManagement"[^>]*hidden/);
assert.match(adminHtml, /id="adminRoleSearchForm"/);
assert.match(adminHtml, /id="adminRoleAuditList"/);
assert.match(adminHtml, /services\/admin-access\.js/);
assert.match(adminScript, /AdminWorkspaceAccess\.resolve\(state\.supabase\)/);
assert.match(adminScript, /admin_find_role_management_users/);
assert.match(adminScript, /admin_update_user_admin_role/);
assert.match(adminScript, /p_target_user_id:\s*user\.user_id/);
assert.match(adminScript, /p_grant_admin:\s*grantAdmin/);
assert.match(adminScript, /admin_list_admin_role_changes/);
assert.doesNotMatch(adminScript, /\.from\(['"]profiles['"]\)\s*\.update/i,
    'browser code must not assign profile roles directly');

assert.match(sellerVerification, /seller_type TEXT NOT NULL[\s\S]*'individual', 'registered_business', 'sole_trader'/);
assert.match(sellerVerification, /p_consent IS NOT TRUE/);
assert.match(sellerVerification, /seller-identity-private[\s\S]*?FALSE/);
assert.match(sellerVerification, /get_public_seller_verification_badges/);
assert.match(phoneVerification, /phone_verified/);
assert.match(logisticsVerification, /v_provider\.provider_type = 'logistics_company'[\s\S]*?v_business_count < 1/);
assert.match(logisticsVerification, /v_provider\.provider_type = 'independent_rider'[\s\S]*?v_selfie_count <> 1/);
assert.match(logisticsVerification, /v_verification\.identity_document_type <> 'national_id'/);
assert.match(logisticsVerification, /representative_selfie[\s\S]*?drivers_license/);

console.log('Admin access checks passed: linked-profile lookup, fresh role reads, primary-only changes, audit controls, and account-specific manual verification.');
