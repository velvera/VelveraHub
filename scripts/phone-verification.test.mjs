import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createPhoneVerificationHandler, normalizeNigerianPhone } from '../supabase/functions/phone-verification/core.mjs';

const env = {
    SUPABASE_URL: 'https://supabase.example.test',
    SUPABASE_ANON_KEY: 'public-test-key',
    SUPABASE_SERVICE_ROLE_KEY: 'server-only-test-key',
    TERMII_API_KEY: 'termii-test-key',
    TERMII_SENDER_ID: 'VELVERAHUB'
};

function createHarness(options = {}) {
    const state = {
        enabled: options.enabled === true,
        roleByToken: { 'admin-token': 'admin', 'user-token': 'seller' },
        media: { 'product-images': true, 'product-videos': true, ...(options.media || {}) },
        restoreMedia: options.restoreMedia
            || (options.enabled ? { 'product-images': true, 'product-videos': true } : null),
        profilePhones: new Set(options.profilePhones || []),
        challenge: null,
        now: 1_000_000,
        sends: 0,
        verifies: 0,
        termiiChecks: 0,
        lastSms: null,
        failMediaBucket: '',
        failSettingsWrite: false,
        disableAfterReserve: options.disableAfterReserve === true,
        disableAfterAttempt: options.disableAfterAttempt === true,
        termiiSenderStatus: options.termiiSenderStatus || 'active',
        termiiBalanceAvailable: options.termiiBalanceAvailable !== false,
        otpResult: 'wrong',
        user: { id: 'user-id', email: 'seller@example.test' }
    };

    const json = (body, status = 200) => new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });

    const fetchImpl = async (input, init = {}) => {
        const url = String(input);
        const method = String(init.method || 'GET').toUpperCase();
        const headers = new Headers(init.headers || {});
        const body = init.body ? JSON.parse(init.body) : {};

        if (url.endsWith('/auth/v1/user')) {
            const token = (headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
            if (!state.roleByToken[token]) return json({ message: 'invalid token' }, 401);
            return json(token === 'admin-token'
                ? { id: 'admin-id', email: 'admin@example.test' }
                : state.user);
        }

        const rpcMatch = url.match(/\/rest\/v1\/rpc\/([^/?]+)/);
        if (rpcMatch) {
            switch (rpcMatch[1]) {
                case 'get_phone_verification_enabled':
                    return json(state.enabled);
                case 'get_phone_verification_media_restore_state':
                    return json({
                        saved: Boolean(state.restoreMedia),
                        product_images_public: state.restoreMedia?.['product-images'] ?? null,
                        product_videos_public: state.restoreMedia?.['product-videos'] ?? null
                    });
                case 'current_profile_role': {
                    const token = (headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
                    return json(state.roleByToken[token] || null);
                }
                case 'phone_verification_reserve': {
                    const phone = body.p_phone_e164;
                    if (state.profilePhones.has(phone) && body.p_auth_user_id !== state.user.id) {
                        return json({ ok: false, code: 'phone_in_use' });
                    }
                    if (state.challenge?.phone === phone && state.challenge.resendAfter > state.now) {
                        return json({
                            ok: false,
                            code: 'cooldown',
                            retry_after_seconds: Math.ceil((state.challenge.resendAfter - state.now) / 1000)
                        });
                    }
                    state.challenge = {
                        phone,
                        email: body.p_email,
                        authUserId: body.p_auth_user_id,
                        sentAt: state.now,
                        expiresAt: state.now + 300_000,
                        resendAfter: state.now + 60_000,
                        attempts: 0,
                        pinId: null
                    };
                    if (state.disableAfterReserve) state.enabled = false;
                    return json({ ok: true, expires_in_seconds: 300, resend_after_seconds: 60 });
                }
                case 'phone_verification_store_pin':
                    if (!state.challenge || state.challenge.phone !== body.p_phone_e164) return json(false);
                    state.challenge.pinId = body.p_termii_pin_id;
                    return json(true);
                case 'phone_verification_begin_attempt': {
                    const challenge = state.challenge;
                    if (!challenge || challenge.phone !== body.p_phone_e164 || !challenge.pinId) {
                        return json({ ok: false, code: 'not_found' });
                    }
                    if (challenge.expiresAt <= state.now) return json({ ok: false, code: 'expired' });
                    if (challenge.attempts >= 5) return json({ ok: false, code: 'attempts_exceeded' });
                    challenge.attempts += 1;
                    if (state.disableAfterAttempt) state.enabled = false;
                    return json({
                        ok: true,
                        pin_id: challenge.pinId,
                        attempt_number: challenge.attempts,
                        attempts_remaining: 5 - challenge.attempts
                    });
                }
                case 'phone_verification_complete_signup':
                    if (!state.challenge || state.challenge.phone !== body.p_phone_e164) return json(false);
                    state.challenge.signupTicket = body.p_signup_ticket;
                    return json(true);
                case 'phone_verification_complete_update':
                    if (!state.challenge || state.challenge.phone !== body.p_phone_e164) return json(false);
                    state.profilePhones.add(body.p_phone_e164);
                    return json(true);
                case 'admin_update_phone_verification':
                    if (state.failSettingsWrite) return json({ message: 'write failed' }, 500);
                    if (body.p_enabled === true && !state.enabled) {
                        state.restoreMedia = {
                            'product-images': body.p_product_images_public,
                            'product-videos': body.p_product_videos_public
                        };
                    }
                    state.enabled = body.p_enabled === true;
                    return json({
                        ok: true,
                        enabled: state.enabled,
                        media_state_saved: Boolean(state.restoreMedia),
                        product_images_public: state.restoreMedia?.['product-images'] ?? null,
                        product_videos_public: state.restoreMedia?.['product-videos'] ?? null
                    });
                default:
                    return json({ message: `Unexpected RPC ${rpcMatch[1]}` }, 404);
            }
        }

        const bucketMatch = url.match(/\/storage\/v1\/bucket\/(product-images|product-videos)$/);
        if (bucketMatch) {
            const bucket = bucketMatch[1];
            if (method === 'GET') return json({ id: bucket, public: state.media[bucket] });
            if (method === 'PUT') {
                if (state.failMediaBucket === bucket) return json({ message: 'storage failure' }, 500);
                state.media[bucket] = body.public;
                return json({ id: bucket, public: body.public });
            }
        }

        if (url.includes('/api/sms/otp/send')) {
            state.sends += 1;
            state.lastSms = body;
            return json({ pinId: `pin-${state.sends}` });
        }
        if (url.includes('/api/sms/otp/verify')) {
            state.verifies += 1;
            if (state.otpResult === 'expired') return json({ verified: 'Expired' }, 400);
            return json({ verified: body.pin === '123456' && state.otpResult === 'correct' });
        }
        if (url.includes('/api/get-balance')) {
            state.termiiChecks += 1;
            return state.termiiBalanceAvailable
                ? json({ balance: 100 })
                : json({ message: 'invalid key' }, 401);
        }
        if (url.includes('/api/sender-id')) {
            state.termiiChecks += 1;
            return json([{
                sender_id: 'VELVERAHUB',
                status: state.termiiSenderStatus
            }]);
        }

        return json({ message: `Unexpected request ${method} ${url}` }, 404);
    };

    const handler = createPhoneVerificationHandler({
        env: { ...env, ...(options.env || {}) },
        fetchImpl,
        makeTicket: () => 'single-use-signup-ticket',
        clock: () => state.now
    });
    return { handler, state };
}

async function call(handler, action, payload = {}, token = '') {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await handler(new Request('https://function.example.test', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action, ...payload })
    }));
    return { status: response.status, body: await response.json() };
}

const cases = [];
function test(name, run) {
    cases.push({ name, run });
}

test('normalizes common Nigerian mobile formats to E.164', () => {
    assert.equal(normalizeNigerianPhone('0801 234 5678'), '+2348012345678');
    assert.equal(normalizeNigerianPhone('+234 801-234-5678'), '+2348012345678');
    assert.equal(normalizeNigerianPhone('2348012345678'), '+2348012345678');
    assert.equal(normalizeNigerianPhone('0201 234 5678'), '');
    assert.equal(normalizeNigerianPhone('0801 234 567'), '');
});

test('disabled mode rejects every OTP action and never contacts Termii', async () => {
    const { handler, state } = createHarness();
    for (const action of ['send_signup', 'verify_signup', 'send_update', 'verify_update']) {
        const result = await call(handler, action, {
            phone: '0801 234 5678',
            email: 'seller@example.test',
            code: '123456'
        }, 'user-token');
        assert.equal(result.status, 409, action);
        assert.equal(result.body.code, 'PHONE_VERIFICATION_DISABLED', action);
    }
    assert.equal(state.sends, 0);
    assert.equal(state.verifies, 0);
});

test('signup challenge sends a six-digit five-minute Termii OTP and returns no provider secrets', async () => {
    const { handler, state } = createHarness({ enabled: true });
    const result = await call(handler, 'send_signup', {
        phone: '0801 234 5678',
        email: 'seller@example.test'
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.phone, '+2348012345678');
    assert.match(result.body.message, /expires in 5 minutes/i);
    assert.match(result.body.message, /another after 60 seconds/i);
    assert.equal(state.sends, 1);
    assert.equal(state.lastSms.to, '2348012345678');
    assert.equal(state.lastSms.pin_length, 6);
    assert.equal(state.lastSms.pin_time_to_live, 5);
    assert.equal(state.lastSms.pin_attempts, 5);
    assert.doesNotMatch(JSON.stringify(result.body), /termii-test-key|server-only-test-key|pin-/i);
});

test('resend cooldown is enforced before another SMS is sent', async () => {
    const { handler, state } = createHarness({ enabled: true });
    const first = await call(handler, 'send_signup', { phone: '0801 234 5678', email: 'buyer@example.test' });
    const second = await call(handler, 'send_signup', { phone: '0801 234 5678', email: 'buyer@example.test' });
    assert.equal(first.status, 200);
    assert.equal(second.status, 429);
    assert.equal(second.body.code, 'RESEND_COOLDOWN');
    assert.match(second.body.error, /60 seconds/i);
    assert.equal(state.sends, 1);
});

test('a mid-request deactivation blocks OTP send and verification calls to Termii', async () => {
    const sending = createHarness({ enabled: true, disableAfterReserve: true });
    const sendResult = await call(sending.handler, 'send_signup', {
        phone: '0801 234 5678',
        email: 'buyer@example.test'
    });
    assert.equal(sendResult.status, 409);
    assert.equal(sendResult.body.code, 'PHONE_VERIFICATION_DISABLED');
    assert.equal(sending.state.sends, 0);

    const verifying = createHarness({ enabled: true, disableAfterAttempt: true });
    await call(verifying.handler, 'send_signup', {
        phone: '0801 234 5678',
        email: 'buyer@example.test'
    });
    const verifyResult = await call(verifying.handler, 'verify_signup', {
        phone: '0801 234 5678',
        email: 'buyer@example.test',
        code: '123456'
    });
    assert.equal(verifyResult.status, 409);
    assert.equal(verifyResult.body.code, 'PHONE_VERIFICATION_DISABLED');
    assert.equal(verifying.state.verifies, 0);
});

test('duplicate account phone numbers are rejected', async () => {
    const { handler } = createHarness({
        enabled: true,
        profilePhones: ['+2348012345678']
    });
    const result = await call(handler, 'send_signup', {
        phone: '0801 234 5678',
        email: 'another@example.test'
    });
    assert.equal(result.status, 409);
    assert.equal(result.body.code, 'PHONE_IN_USE');
});

test('wrong codes count toward a five-attempt lockout', async () => {
    const { handler, state } = createHarness({ enabled: true });
    await call(handler, 'send_signup', { phone: '0801 234 5678', email: 'buyer@example.test' });
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const result = await call(handler, 'verify_signup', {
            phone: '0801 234 5678',
            email: 'buyer@example.test',
            code: '000000'
        });
        assert.equal(result.status, 400);
        assert.equal(result.body.code, 'OTP_INCORRECT');
    }
    const locked = await call(handler, 'verify_signup', {
        phone: '0801 234 5678',
        email: 'buyer@example.test',
        code: '000000'
    });
    assert.equal(locked.status, 429);
    assert.equal(locked.body.code, 'OTP_ATTEMPTS_EXCEEDED');
    assert.equal(state.verifies, 5);
});

test('expired OTPs are rejected before Termii verification', async () => {
    const { handler, state } = createHarness({ enabled: true });
    await call(handler, 'send_signup', { phone: '0801 234 5678', email: 'buyer@example.test' });
    state.now = state.challenge.expiresAt + 1;
    const result = await call(handler, 'verify_signup', {
        phone: '0801 234 5678',
        email: 'buyer@example.test',
        code: '123456'
    });
    assert.equal(result.status, 410);
    assert.equal(result.body.code, 'OTP_EXPIRED');
    assert.equal(state.verifies, 0);
});

test('successful signup verification returns only a short-lived registration ticket', async () => {
    const { handler, state } = createHarness({ enabled: true });
    state.otpResult = 'correct';
    await call(handler, 'send_signup', { phone: '0801 234 5678', email: 'buyer@example.test' });
    const result = await call(handler, 'verify_signup', {
        phone: '0801 234 5678',
        email: 'buyer@example.test',
        code: '123456'
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.phone, '+2348012345678');
    assert.equal(result.body.ticket, 'single-use-signup-ticket');
    assert.equal(state.challenge.signupTicket, result.body.ticket);
});

test('phone changes require a signed-in user and save only after successful OTP verification', async () => {
    const { handler, state } = createHarness({ enabled: true });
    const unauthenticated = await call(handler, 'send_update', { phone: '0801 234 5678' });
    assert.equal(unauthenticated.status, 401);
    assert.equal(state.sends, 0);

    state.otpResult = 'correct';
    const sent = await call(handler, 'send_update', { phone: '0801 234 5678' }, 'user-token');
    assert.equal(sent.status, 200);
    assert.equal(state.profilePhones.has('+2348012345678'), false);
    const verified = await call(handler, 'verify_update', {
        phone: '0801 234 5678',
        code: '123456'
    }, 'user-token');
    assert.equal(verified.status, 200);
    assert.equal(verified.body.verified, true);
    assert.equal(state.profilePhones.has('+2348012345678'), true);
});

test('only an administrator can read or change the global setting', async () => {
    const { handler, state } = createHarness();
    const status = await call(handler, 'admin_status', {}, 'user-token');
    const update = await call(handler, 'admin_set', { enabled: true }, 'user-token');
    assert.equal(status.status, 403);
    assert.equal(update.status, 403);
    assert.equal(state.enabled, false);
});

test('disabled admin status reports secret presence without contacting Termii', async () => {
    const ready = createHarness();
    const status = await call(ready.handler, 'admin_status', {}, 'admin-token');
    assert.equal(status.status, 200);
    assert.equal(status.body.enabled, false);
    assert.equal(status.body.providerStatus, 'Configured');
    assert.equal(status.body.configurationReady, true);
    assert.equal(status.body.mediaAccessStatus, 'Unchanged (Public)');
    assert.equal(status.body.providerValidation, 'Will validate on activation');
    assert.equal(ready.state.termiiChecks, 0);

    const invalid = createHarness({ termiiSenderStatus: 'pending' });
    const invalidStatus = await call(invalid.handler, 'admin_status', {}, 'admin-token');
    assert.equal(invalidStatus.status, 200);
    assert.equal(invalidStatus.body.providerStatus, 'Configured');
    assert.equal(invalidStatus.body.configurationReady, true);
    assert.equal(invalid.state.termiiChecks, 0);
});

test('activation validates Termii, privately configures media, and takes effect without redeploy', async () => {
    const { handler, state } = createHarness();
    const activated = await call(handler, 'admin_set', { enabled: true }, 'admin-token');
    assert.equal(activated.status, 200);
    assert.equal(state.enabled, true);
    assert.deepEqual(state.media, { 'product-images': false, 'product-videos': false });
    assert.equal(activated.body.configurationReady, true);
    assert.equal(activated.body.mediaAccessStatus, 'Private (eligible listings only)');

    const sent = await call(handler, 'send_signup', {
        phone: '0801 234 5678',
        email: 'buyer@example.test'
    });
    assert.equal(sent.status, 200);
    assert.equal(state.sends, 1);
});

test('activation fails when Termii secrets are missing', async () => {
    const { handler, state } = createHarness({
        env: { TERMII_API_KEY: '', TERMII_SENDER_ID: '' }
    });
    const result = await call(handler, 'admin_set', { enabled: true }, 'admin-token');
    assert.equal(result.status, 503);
    assert.equal(result.body.code, 'PROVIDER_NOT_CONFIGURED');
    assert.equal(state.enabled, false);
    assert.deepEqual(state.media, { 'product-images': true, 'product-videos': true });
});

test('activation validates the actual Termii Sender ID before changing settings', async () => {
    const { handler, state } = createHarness({ termiiSenderStatus: 'pending' });
    const result = await call(handler, 'admin_set', { enabled: true }, 'admin-token');
    assert.equal(result.status, 503);
    assert.equal(result.body.code, 'TERMII_SENDER_NOT_ACTIVE');
    assert.equal(state.enabled, false);
    assert.deepEqual(state.media, { 'product-images': true, 'product-videos': true });
    assert.equal(state.sends, 0);
});

test('a partial media update rolls back to the exact previous bucket state', async () => {
    const { handler, state } = createHarness();
    state.failMediaBucket = 'product-videos';
    const result = await call(handler, 'admin_set', { enabled: true }, 'admin-token');
    assert.equal(result.status, 503);
    assert.equal(state.enabled, false);
    assert.deepEqual(state.media, { 'product-images': true, 'product-videos': true });
});

test('a failed database toggle restores prior media access and keeps the setting unchanged', async () => {
    const { handler, state } = createHarness();
    state.failSettingsWrite = true;
    const result = await call(handler, 'admin_set', { enabled: true }, 'admin-token');
    assert.equal(result.status, 503);
    assert.equal(state.enabled, false);
    assert.deepEqual(state.media, { 'product-images': true, 'product-videos': true });
});

test('deactivation restores the saved media modes, stops OTPs, and retains verification records', async () => {
    const { handler, state } = createHarness({ enabled: true });
    state.media = { 'product-images': false, 'product-videos': false };
    state.challenge = { phone: '+2348012345678', signupTicket: 'preserved-ticket' };
    const result = await call(handler, 'admin_set', { enabled: false }, 'admin-token');
    assert.equal(result.status, 200);
    assert.equal(state.enabled, false);
    assert.deepEqual(state.media, { 'product-images': true, 'product-videos': true });
    assert.equal(state.challenge.signupTicket, 'preserved-ticket');
    const send = await call(handler, 'send_signup', { phone: '0801 234 5678', email: 'buyer@example.test' });
    assert.equal(send.status, 409);
    assert.equal(send.body.code, 'PHONE_VERIFICATION_DISABLED');
    assert.equal(state.sends, 0);
    assert.equal(state.termiiChecks, 0);
});

test('failed deactivation restores private media and leaves server enforcement enabled', async () => {
    const { handler, state } = createHarness({ enabled: true });
    state.media = { 'product-images': false, 'product-videos': false };
    state.failSettingsWrite = true;
    const result = await call(handler, 'admin_set', { enabled: false }, 'admin-token');
    assert.equal(result.status, 503);
    assert.equal(state.enabled, true);
    assert.deepEqual(state.media, { 'product-images': false, 'product-videos': false });
});

test('activation and deactivation preserve originally private and mixed media settings', async () => {
    for (const original of [
        { 'product-images': false, 'product-videos': false },
        { 'product-images': true, 'product-videos': false }
    ]) {
        const { handler, state } = createHarness({ media: original });
        const activated = await call(handler, 'admin_set', { enabled: true }, 'admin-token');
        assert.equal(activated.status, 200);
        assert.deepEqual(state.media, { 'product-images': false, 'product-videos': false });
        assert.deepEqual(state.restoreMedia, original);

        const disabled = await call(handler, 'admin_set', { enabled: false }, 'admin-token');
        assert.equal(disabled.status, 200);
        assert.deepEqual(state.media, original);
        assert.match(disabled.body.mediaAccessStatus, /Restored/);
    }
});

test('saving disabled mode without a prior activation does not change media access', async () => {
    const original = { 'product-images': false, 'product-videos': true };
    const { handler, state } = createHarness({ media: original });
    const result = await call(handler, 'admin_set', { enabled: false }, 'admin-token');
    assert.equal(result.status, 200);
    assert.equal(state.enabled, false);
    assert.deepEqual(state.media, original);
    assert.equal(state.restoreMedia, null);
});

test('deactivation stops OTPs even when product media cannot be made public', async () => {
    const { handler, state } = createHarness({ enabled: true });
    state.media = { 'product-images': false, 'product-videos': false };
    state.failMediaBucket = 'product-videos';
    const result = await call(handler, 'admin_set', { enabled: false }, 'admin-token');
    assert.equal(result.status, 200);
    assert.equal(result.body.enabled, false);
    assert.equal(result.body.configurationReady, false);
    assert.equal(result.body.mediaAccessStatus, 'Needs attention');
    assert.match(result.body.warning, /new OTPs have stopped/i);
    assert.match(result.body.warning, /could not be restored/i);
    assert.equal(state.enabled, false);

    const blocked = await call(handler, 'send_signup', {
        phone: '0801 234 5678',
        email: 'buyer@example.test'
    });
    assert.equal(blocked.status, 409);
    assert.equal(state.sends, 0);
});

test('migration and browser wiring keep disabled state invisible and server-owned', () => {
    const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    const migration = read('database/phone-verification.sql');
    assert.match(migration, /phone_verification_enabled BOOLEAN NOT NULL DEFAULT FALSE/i);
    assert.match(migration, /phone_verification_restore_product_images_public BOOLEAN/i);
    assert.match(migration, /phone_verification_restore_product_videos_public BOOLEAN/i);
    assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS profiles_phone_e164_unique/i);
    assert.match(migration, /phone_verification_challenges ENABLE ROW LEVEL SECURITY/i);
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.admin_update_phone_verification\(BOOLEAN, BOOLEAN, BOOLEAN\) FROM PUBLIC, anon, authenticated/i);
    assert.match(migration, /CREATE TRIGGER enforce_phone_verification_before_publish/i);
    assert.match(migration, /phone_verification_product_media_is_public/i);
    assert.match(migration, /product_row\.status IS DISTINCT FROM 'active'/i);
    assert.match(migration, /product_row\.moderation_status = 'rejected'/i);
    assert.match(migration, /COALESCE\(product_row\.stock, 0\) <= 0/i);
    assert.match(migration, /product_row\.listing_type = 'shop'[\s\S]*?shop\.status = 'active'/i);
    assert.match(migration, /product_row\.moderation_status = 'approved'/i);
    assert.match(migration, /WHEN NOT public\.get_phone_verification_enabled\(\) THEN EXISTS[\s\S]*?product\.moderation_status = 'approved'/i);
    assert.match(migration, /AND public\.get_phone_verification_enabled\(\)\s+AND CASE[\s\S]*?phone_verification_product_media_is_public/i);
    assert.match(migration, /profile\.phone_verified IS TRUE/i);
    assert.match(migration, /auth_user\.email_confirmed_at IS NOT NULL/i);
    assert.match(migration, /shop\.verified IS TRUE/i);
    assert.match(migration, /WHEN NOT public\.get_phone_verification_enabled\(\) THEN EXISTS[\s\S]*?product\.status = 'active'/i);
    assert.match(migration, /ELSIF NEW\.phone IS DISTINCT FROM OLD\.phone THEN/i);
    assert.match(migration, /NEW\.phone_verified := FALSE;/i);
    assert.match(migration, /IF NOT feature_enabled THEN\s+RETURN FALSE;\s+END IF;/i);
    const roots = [
        ['assets/js/services/phone-verification.js', 'assets/js/services/auth.js', 'veeve/account.html'],
        ['velverahub-ng/assets/js/services/phone-verification.js', 'velverahub-ng/assets/js/services/auth.js', 'velverahub-ng/veeve/account.html'],
        ['velverahub-uk/assets/js/services/phone-verification.js', 'velverahub-uk/assets/js/services/auth.js', 'velverahub-uk/veeve/account.html'],
        ['velverahub-shop/assets/js/services/phone-verification.js', 'velverahub-shop/assets/js/services/auth.js', 'velverahub-shop/index.html'],
        ['velverahub-admin/assets/js/services/phone-verification.js', 'velverahub-admin/assets/js/services/auth.js', 'velverahub-admin/index.html']
    ];
    for (const [servicePath, authPath, pagePath] of roots) {
        const service = read(servicePath);
        const auth = read(authPath);
        const page = read(pagePath);
        assert.match(service, /get_phone_verification_enabled/, servicePath);
        assert.doesNotMatch(service, /TERMII_API_KEY|api_key\s*:/i, `${servicePath} must not contain provider credentials`);
        assert.match(auth, /PhoneVerification\.isEnabled/, authPath);
        if (pagePath.endsWith('account.html')) {
            assert.match(page, /id="accountPhoneVerification" hidden/, pagePath);
        }
    }

    const adminSource = read('admin-workspace/admin.js');
    const adminGenerated = read('velverahub-admin/admin.js');
    const adminPage = read('admin-workspace/index.html');
    assert.equal(adminGenerated, adminSource, 'generated admin dashboard must include the source settings controls');
    assert.match(adminSource, /loadPhoneVerificationSettings/);
    assert.match(adminPage, /id="phoneVerificationSettingsTab"/);
    assert.match(adminPage, /id="phoneVerificationProviderValidation"/);

    const listingRoots = [
        ['.', 'veeve/sell.html'],
        ['velverahub-ng', 'velverahub-ng/veeve/sell.html'],
        ['velverahub-uk', 'velverahub-uk/veeve/sell.html']
    ];
    for (const [root, pagePath] of listingRoots) {
        const page = read(pagePath);
        const listing = read(`${root === '.' ? '' : `${root}/`}assets/js/pages/student-listing.js`);
        assert.match(page, /services\/phone-verification\.js/, pagePath);
        assert.match(listing, /PhoneVerification\.requireVerifiedPhone/, `${root} student listing`);
        const sellerPage = read(`${root === '.' ? '' : `${root}/`}assets/js/pages/seller-dashboard.js`);
        assert.match(sellerPage, /PhoneVerification\.requireVerifiedPhone/, `${root} seller dashboard`);
    }
});

test('disabled client flow skips OTP forms, registration interruption, and seller publishing prompts', async () => {
    const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    const servicePaths = [
        'assets/js/services/phone-verification.js',
        'velverahub-ng/assets/js/services/phone-verification.js',
        'velverahub-uk/assets/js/services/phone-verification.js',
        'velverahub-shop/assets/js/services/phone-verification.js',
        'velverahub-admin/assets/js/services/phone-verification.js'
    ];
    for (const servicePath of servicePaths) {
        let statusCalls = 0;
        const client = { rpc: async () => { statusCalls += 1; return { data: false, error: null }; } };
        const context = {
            window: {
                SupabaseClient: { isConfigured: () => true, get: () => client },
                AuthService: { getProfile: () => ({}) }
            },
            document: { getElementById: () => null }
        };
        vm.runInNewContext(read(servicePath), context);
        assert.equal(await context.window.PhoneVerification.verifyForSignup('buyer@example.test'), null, servicePath);
        assert.equal(await context.window.PhoneVerification.requireVerifiedPhone(), true, servicePath);
        assert.equal(await context.window.PhoneVerification.showAccountSettings({}), false, servicePath);
        assert.equal(statusCalls, 3, servicePath);
    }

    let signupCalls = 0;
    let signinCalls = 0;
    let verificationUiCalls = 0;
    const storage = new Map();
    const supabase = {
        auth: {
            signUp: async () => {
                signupCalls += 1;
                return { data: { session: null, user: { id: 'new-user', email: 'buyer@example.test' } }, error: null };
            },
            signInWithPassword: async () => {
                signinCalls += 1;
                return { data: { session: null, user: null }, error: null };
            }
        }
    };
    const context = {
        window: {
            supabaseConfigReady: Promise.resolve(),
            PhoneVerification: {
                isEnabled: async () => false,
                verifyForSignup: async () => { verificationUiCalls += 1; }
            },
            SupabaseClient: { isConfigured: () => true, get: () => supabase },
            API: { setToken() {} },
            dispatchEvent() {},
            setTimeout,
            clearTimeout
        },
        localStorage: {
            getItem: (key) => storage.get(key) || null,
            setItem: (key, value) => storage.set(key, value),
            removeItem: (key) => storage.delete(key)
        },
        CustomEvent: class CustomEvent {},
        URL,
        AbortController,
        fetch,
        Date
    };
    const auth = vm.runInNewContext(`${read('assets/js/services/auth.js')}\nAuthService`, context);
    const signup = await auth.signUp(' Buyer@Example.test ', 'password', { accountType: 'customer' });
    const signin = await auth.signIn(' Buyer@Example.test ', 'password');
    assert.equal(signup.error, null);
    assert.equal(signin.error, null);
    assert.equal(signupCalls, 1);
    assert.equal(signinCalls, 1);
    assert.equal(verificationUiCalls, 0);

    for (const accountType of ['customer', 'seller']) {
        let signupMetadata = null;
        const activeContext = {
            window: {
                supabaseConfigReady: Promise.resolve(),
                PhoneVerification: {
                    isEnabled: async () => true,
                    verifyForSignup: async (email, phone) => ({
                        phone: '+2348012345678',
                        ticket: `ticket-${accountType}`,
                        requestedEmail: email,
                        requestedPhone: phone
                    })
                },
                SupabaseClient: {
                    isConfigured: () => true,
                    get: () => ({
                        auth: {
                            signUp: async (input) => {
                                signupMetadata = input.options.data;
                                return { data: { session: null, user: { id: 'new-user', email: input.email } }, error: null };
                            }
                        }
                    })
                },
                API: { setToken() {} },
                dispatchEvent() {},
                setTimeout,
                clearTimeout
            },
            localStorage: {
                getItem: () => null,
                setItem() {},
                removeItem() {}
            },
            CustomEvent: class CustomEvent {},
            URL,
            AbortController,
            fetch,
            Date
        };
        const activeAuth = vm.runInNewContext(`${read('assets/js/services/auth.js')}\nAuthService`, activeContext);
        const result = await activeAuth.signUp('Buyer@Example.test', 'password', {
            accountType,
            phone: '0801 234 5678'
        });
        assert.equal(result.error, null, accountType);
        assert.equal(signupMetadata.accountType, accountType, accountType);
        assert.equal(signupMetadata.phone_e164, '+2348012345678', accountType);
        assert.equal(signupMetadata.phone_verification_ticket, `ticket-${accountType}`, accountType);
        assert.equal(signupMetadata.email, undefined, accountType);
    }
});

test('admin controls and setup guide identify the real DB state and deploy requirements', () => {
    const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    const adminHtml = read('velverahub-admin/index.html');
    const adminJs = read('velverahub-admin/admin.js');
    const guide = read('docs/phone-verification.md');
    assert.match(adminHtml, /phoneVerificationSettingsPanel/);
    assert.match(adminJs, /action: 'admin_status'/);
    assert.match(adminJs, /action: 'admin_set'/);
    assert.match(guide, /TERMII_API_KEY/);
    assert.match(guide, /TERMII_SENDER_ID/);
    assert.match(guide, /disabled by default/i);
    assert.match(guide, /real SMS/i);
});

for (const { name, run } of cases) {
    await run();
    console.log(`PASS ${name}`);
}

console.log(`Passed ${cases.length} phone verification tests`);
