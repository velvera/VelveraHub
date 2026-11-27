import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSellerVerificationUploadHandler, detectIdentityDocument } from '../supabase/functions/seller-verification-documents/core.mjs';

const root = new URL('../', import.meta.url);
const read = (relativePath) => fs.readFileSync(new URL(relativePath, root), 'utf8');
const testEnv = {
    SUPABASE_URL: 'https://supabase.example.test',
    SUPABASE_ANON_KEY: 'public-test-key',
    SUPABASE_SERVICE_ROLE_KEY: 'server-only-test-key'
};
const userId = 'e2e15b60-0b92-4aa0-bfc0-fcf8bb173b16';
const caseId = 'b38a33a5-0a6e-4a3a-b010-b63c92011b3a';

function formRequest(bytes, contentType = 'application/pdf', token = 'valid-token') {
    const form = new FormData();
    form.append('case_id', caseId);
    form.append('document', new Blob([bytes], { type: contentType }), 'identity.pdf');
    return new Request('https://function.example.test/upload', {
        method: 'POST',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body: form
    });
}

function createHarness({ reserveError = null } = {}) {
    const state = { uploaded: [], reserveCalls: 0, userClientCalls: 0 };
    const userClient = {
        auth: {
            getUser: async () => ({
                data: { user: { id: userId } },
                error: null
            })
        }
    };
    const serviceClient = {
        rpc: async (name, args) => {
            assert.equal(name, 'seller_identity_upload_reserve');
            assert.deepEqual(args, {
                p_applicant_user_id: userId,
                p_case_id: caseId
            });
            state.reserveCalls += 1;
            return { error: reserveError };
        },
        storage: {
            from(bucket) {
                assert.equal(bucket, 'seller-identity-private');
                return {
                    upload: async (path, bytes, options) => {
                        state.uploaded.push({ path, bytes, options });
                        return { error: null };
                    }
                };
            }
        }
    };
    const handler = createSellerVerificationUploadHandler({
        env: testEnv,
        createClient: (_url, key) => {
            if (key === testEnv.SUPABASE_SERVICE_ROLE_KEY) return serviceClient;
            state.userClientCalls += 1;
            return userClient;
        }
    });
    return { handler, state };
}

assert.equal(
    detectIdentityDocument(new TextEncoder().encode('%PDF-1.7'), 'application/pdf')?.extension,
    'pdf'
);
assert.equal(
    detectIdentityDocument(new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 0, 0, 0]), 'image/jpeg')?.extension,
    'jpg'
);
assert.equal(
    detectIdentityDocument(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png')?.extension,
    'png'
);
assert.equal(
    detectIdentityDocument(new TextEncoder().encode('not a pdf'), 'application/pdf'),
    null,
    'declared browser MIME types must not replace signature checks'
);

{
    const { handler, state } = createHarness();
    const response = await handler(formRequest(new TextEncoder().encode('%PDF-1.7'), 'application/pdf', ''));
    assert.equal(response.status, 401);
    assert.equal(state.userClientCalls, 0);
}

{
    const handler = createSellerVerificationUploadHandler({
        env: { SUPABASE_URL: testEnv.SUPABASE_URL },
        createClient: () => { throw new Error('No client should be created for missing configuration.'); }
    });
    const response = await handler(formRequest(new TextEncoder().encode('%PDF-1.7')));
    assert.equal(response.status, 503);
}

{
    const { handler, state } = createHarness();
    const response = await handler(formRequest(new TextEncoder().encode('not actually a pdf')));
    assert.equal(response.status, 415);
    assert.equal(state.reserveCalls, 0);
    assert.equal(state.uploaded.length, 0);
}

{
    const { handler, state } = createHarness();
    const response = await handler(formRequest(new TextEncoder().encode('%PDF-1.7')));
    const payload = await response.json();
    assert.equal(response.status, 201);
    assert.match(payload.path, new RegExp(`^${userId}/${caseId}/[0-9a-f-]{36}\\.pdf$`));
    assert.equal(state.reserveCalls, 1);
    assert.equal(state.uploaded.length, 1);
    assert.equal(state.uploaded[0].options.contentType, 'application/pdf');
    assert.equal(state.uploaded[0].options.cacheControl, '0');
    assert.equal(state.uploaded[0].options.upsert, false);
}

{
    const { handler, state } = createHarness({ reserveError: { message: 'Upload limit reached.' } });
    const response = await handler(formRequest(new TextEncoder().encode('%PDF-1.7')));
    assert.equal(response.status, 429);
    assert.equal(state.uploaded.length, 0);
}

const migration = read('database/seller-trust-verification.sql');
assert.match(migration, /seller-identity-private[\s\S]*?\bFALSE\b/);
assert.match(migration, /p_consent BOOLEAN DEFAULT FALSE[\s\S]*?p_consent IS NOT TRUE/);
assert.match(migration, /seller_identity_admin_read_documents[\s\S]*?current_profile_role\(\) = 'admin'/);
assert.match(migration, /seller_identity_service_only_upload[\s\S]*?bucket_id <> 'seller-identity-private'/);
assert.match(migration, /admin_review_shop_verification_with_basis/);
assert.match(migration, /Approve a current identity verification for the business representative first/);
assert.match(migration, /get_public_seller_verification_badges/);

for (const appRoot of ['velverahub-ng', 'velverahub-uk', 'velverahub-shop', 'velverahub-admin']) {
    assert.ok(fs.existsSync(new URL(`${appRoot}/assets/js/services/seller-verification.js`, root)));
    assert.ok(fs.existsSync(new URL(`${appRoot}/assets/css/components/seller-verification.css`, root)));
}

for (const scriptPath of [
    'assets/js/pages/seller-dashboard.js',
    'velverahub-ng/assets/js/pages/seller-dashboard.js',
    'velverahub-uk/assets/js/pages/seller-dashboard.js'
]) {
    assert.match(read(scriptPath), /SellerVerification\?\.mountSellerPanel\(context\)/);
}

assert.match(read('admin-workspace/index.html'), /id="sellerIdentityQueue"/);
assert.match(read('admin-workspace/index.html'), /id="sellerInspectionQueue"/);
assert.match(read('admin-workspace/admin.js'), /admin_review_shop_verification_with_basis/);
assert.match(read('admin-workspace/admin.js'), /SellerVerification\?\.initAdmin\(state\.supabase\)/);

console.log('Seller verification upload security and workflow wiring checks passed.');
