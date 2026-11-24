const TERMII_API = 'https://api.ng.termii.com/api/sms/otp';
const TERMII_BASE = 'https://api.ng.termii.com/api';
const PRODUCT_MEDIA_BUCKETS = ['product-images', 'product-videos'];

export function normalizeNigerianPhone(value) {
    const input = String(value || '').trim();
    if (!input || input.length > 40) return '';

    let digits = input.replace(/\D/g, '');
    if (digits.startsWith('234')) digits = digits.slice(3);
    else if (digits.startsWith('0')) digits = digits.slice(1);

    return /^[789]\d{9}$/.test(digits) ? `+234${digits}` : '';
}

export function termiiVerified(payload) {
    const value = payload?.verified;
    return value === true || String(value || '').trim().toLowerCase() === 'true';
}

function json(payload, status = 200, _requestOrigin = '*') {
    return new Response(JSON.stringify(payload), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Vary': 'Origin'
        }
    });
}

function envValue(env, key) {
    return String(env?.[key] || '').trim();
}

function configuration(env) {
    const url = envValue(env, 'SUPABASE_URL').replace(/\/+$/, '');
    const anonKey = envValue(env, 'SUPABASE_ANON_KEY') || envValue(env, 'SUPABASE_PUBLISHABLE_KEY');
    const serviceKey = envValue(env, 'SUPABASE_SERVICE_ROLE_KEY');
    const termiiKey = envValue(env, 'TERMII_API_KEY');
    const termiiSenderId = envValue(env, 'TERMII_SENDER_ID');
    return {
        url,
        anonKey,
        serviceKey,
        termiiKey,
        termiiSenderId,
        termiiConfigured: Boolean(termiiKey && termiiSenderId),
        ready: Boolean(url && anonKey && serviceKey && termiiKey && termiiSenderId)
    };
}

function errorResult(message, status = 400, code = 'PHONE_VERIFICATION_ERROR') {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

export function createPhoneVerificationHandler({
    env,
    fetchImpl = fetch,
    makeTicket = () => crypto.randomUUID() + crypto.randomUUID(),
    clock = () => Date.now()
}) {
    const config = configuration(env);

    async function rpc(name, args, token = config.serviceKey, apiKey = config.serviceKey) {
        const response = await fetchImpl(`${config.url}/rest/v1/rpc/${name}`, {
            method: 'POST',
            headers: {
                apikey: apiKey,
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                Accept: 'application/json'
            },
            body: JSON.stringify(args || {})
        });
        const raw = await response.text();
        let payload = null;
        try { payload = raw ? JSON.parse(raw) : null; } catch { payload = null; }
        if (!response.ok) throw errorResult('Phone verification service is temporarily unavailable.', 503, 'SERVICE_UNAVAILABLE');
        return payload;
    }

    async function enabled() {
        const value = await rpc('get_phone_verification_enabled', {});
        return value === true;
    }

    async function requireUser(request) {
        const authorization = request.headers.get('Authorization') || '';
        const match = authorization.match(/^Bearer\s+(.+)$/i);
        if (!match || !config.url || !config.anonKey) {
            throw errorResult('Sign in to continue.', 401, 'AUTH_REQUIRED');
        }
        const accessToken = match[1].trim();
        const response = await fetchImpl(`${config.url}/auth/v1/user`, {
            headers: { apikey: config.anonKey, Authorization: `Bearer ${accessToken}` }
        });
        if (!response.ok) throw errorResult('Sign in to continue.', 401, 'AUTH_REQUIRED');
        const user = await response.json();
        if (!user?.id || !user?.email) throw errorResult('Sign in to continue.', 401, 'AUTH_REQUIRED');
        return { user, accessToken };
    }

    async function requireAdmin(request) {
        const { user, accessToken } = await requireUser(request);
        const role = await rpc('current_profile_role', {}, accessToken, config.anonKey);
        if (role !== 'admin') throw errorResult('Administrator access required.', 403, 'ADMIN_REQUIRED');
        return { user, accessToken };
    }

    async function sendTermiiCode(phone) {
        if (!config.ready) {
            throw errorResult('Phone verification is not fully configured.', 503, 'PROVIDER_NOT_CONFIGURED');
        }
        const response = await fetchImpl(`${TERMII_API}/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
                api_key: config.termiiKey,
                pin_type: 'NUMERIC',
                to: phone.slice(1),
                from: config.termiiSenderId,
                channel: 'generic',
                pin_attempts: 5,
                pin_time_to_live: 5,
                pin_length: 6,
                pin_placeholder: '< 123456 >',
                message_text: 'Your VelveraHub code is < 123456 >. It expires in 5 minutes.'
            })
        });
        let payload = null;
        try { payload = await response.json(); } catch { payload = null; }
        const pinId = payload?.pinId || payload?.pin_id;
        if (!response.ok || !pinId) {
            throw errorResult('The SMS could not be sent. Please try again later.', 502, 'SMS_SEND_FAILED');
        }
        return String(pinId);
    }

    async function verifyTermiiCode(pinId, pin) {
        if (!config.ready) {
            throw errorResult('Phone verification is not fully configured.', 503, 'PROVIDER_NOT_CONFIGURED');
        }
        const response = await fetchImpl(`${TERMII_API}/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ api_key: config.termiiKey, pin_id: pinId, pin })
        });
        let payload = null;
        try { payload = await response.json(); } catch { payload = null; }
        if (termiiVerified(payload)) return true;
        const details = String(payload?.message || payload?.verified || '').toLowerCase();
        if (details.includes('expir')) {
            throw errorResult('That code has expired. Request a new code to continue.', 410, 'OTP_EXPIRED');
        }
        if (response.status === 429) {
            throw errorResult('Too many incorrect codes. Wait 60 seconds before requesting another code.', 429, 'OTP_ATTEMPTS_EXCEEDED');
        }
        throw errorResult('That code is incorrect. Check it and try again.', 400, 'OTP_INCORRECT');
    }

    async function validateTermiiConfiguration() {
        if (!config.ready) {
            throw errorResult(
                'Add the required Supabase and Termii Function secrets before enabling phone verification.',
                503,
                'PROVIDER_NOT_CONFIGURED'
            );
        }

        const timeoutSignal = () => AbortSignal.timeout(8000);
        const balanceUrl = new URL(`${TERMII_BASE}/get-balance`);
        balanceUrl.searchParams.set('api_key', config.termiiKey);
        const balanceResponse = await fetchImpl(balanceUrl, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: timeoutSignal()
        });
        let balance = null;
        try { balance = await balanceResponse.json(); } catch { balance = null; }
        if (!balanceResponse.ok || !Number.isFinite(Number(balance?.balance))) {
            throw errorResult(
                'Termii could not validate the configured API key. Check the Termii Function secrets.',
                503,
                'TERMII_KEY_INVALID'
            );
        }

        const senderUrl = new URL(`${TERMII_BASE}/sender-id`);
        senderUrl.searchParams.set('api_key', config.termiiKey);
        senderUrl.searchParams.set('sender_id', config.termiiSenderId);
        const senderResponse = await fetchImpl(senderUrl, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: timeoutSignal()
        });
        let senderPayload = null;
        try { senderPayload = await senderResponse.json(); } catch { senderPayload = null; }
        const senderRows = Array.isArray(senderPayload)
            ? senderPayload
            : Array.isArray(senderPayload?.data)
                ? senderPayload.data
                : Array.isArray(senderPayload?.content)
                    ? senderPayload.content
                    : Array.isArray(senderPayload?.content?.data)
                        ? senderPayload.content.data
                        : [];
        const configuredSender = senderRows.find((sender) =>
            String(sender?.sender_id || '').trim().toLowerCase() === config.termiiSenderId.toLowerCase()
        );
        const senderStatus = String(configuredSender?.status || '').trim().toLowerCase();
        if (!senderResponse.ok || !configuredSender || !['active', 'approved', 'unblock', 'unblocked'].includes(senderStatus)) {
            throw errorResult(
                'The configured Termii Sender ID is not active. Use an approved Sender ID before enabling verification.',
                503,
                'TERMII_SENDER_NOT_ACTIVE'
            );
        }
    }

    async function getProductMediaBucketStates() {
        const states = {};
        for (const bucket of PRODUCT_MEDIA_BUCKETS) {
            const response = await fetchImpl(`${config.url}/storage/v1/bucket/${bucket}`, {
                method: 'GET',
                headers: {
                    apikey: config.serviceKey,
                    Authorization: `Bearer ${config.serviceKey}`,
                    Accept: 'application/json'
                }
            });
            let details = null;
            try { details = await response.json(); } catch (_) {}
            if (!response.ok || typeof details?.public !== 'boolean') {
                throw errorResult('Product media access could not be checked safely.', 503, 'MEDIA_ACCESS_UPDATE_FAILED');
            }
            states[bucket] = details.public;
        }
        return states;
    }

    async function writeProductMediaBucket(bucket, isPublic) {
        const response = await fetchImpl(`${config.url}/storage/v1/bucket/${bucket}`, {
            method: 'PUT',
            headers: {
                apikey: config.serviceKey,
                Authorization: `Bearer ${config.serviceKey}`,
                'Content-Type': 'application/json',
                Accept: 'application/json'
            },
            body: JSON.stringify({ public: isPublic })
        });
        if (!response.ok) {
            throw errorResult('Product media access could not be updated safely.', 503, 'MEDIA_ACCESS_UPDATE_FAILED');
        }
    }

    async function restoreProductMediaBucketStates(states) {
        let restored = true;
        for (const bucket of [...PRODUCT_MEDIA_BUCKETS].reverse()) {
            if (typeof states?.[bucket] !== 'boolean') continue;
            try {
                await writeProductMediaBucket(bucket, states[bucket]);
            } catch (_) {
                restored = false;
            }
        }
        return restored;
    }

    async function setProductMediaBucketStates(targetStates) {
        const previousStates = await getProductMediaBucketStates();
        try {
            for (const bucket of PRODUCT_MEDIA_BUCKETS) {
                if (typeof targetStates?.[bucket] !== 'boolean') {
                    throw errorResult('The product-media access settings are incomplete.', 503, 'MEDIA_ACCESS_UPDATE_FAILED');
                }
                await writeProductMediaBucket(bucket, targetStates[bucket]);
            }
            return previousStates;
        } catch (error) {
            await restoreProductMediaBucketStates(previousStates);
            throw error;
        }
    }

    async function getProductMediaRestoreState() {
        const state = await rpc('get_phone_verification_media_restore_state', {});
        if (!state || typeof state.saved !== 'boolean') {
            throw errorResult('The product-media restore settings are unavailable.', 503, 'MEDIA_ACCESS_UPDATE_FAILED');
        }
        return state;
    }

    async function productMediaModeMatches(isEnabled, restoreState, currentStates) {
        if (!config.url || !config.serviceKey) return false;
        try {
            const states = currentStates || await getProductMediaBucketStates();
            if (isEnabled) return PRODUCT_MEDIA_BUCKETS.every((bucket) => states[bucket] === false);
            if (restoreState?.saved !== true) return true;
            const expected = {
                'product-images': restoreState.product_images_public,
                'product-videos': restoreState.product_videos_public
            };
            return PRODUCT_MEDIA_BUCKETS.every((bucket) =>
                typeof expected[bucket] === 'boolean' && states[bucket] === expected[bucket]
            );
        } catch (_) {
            return false;
        }
    }

    function productMediaStatus(isEnabled, restoreState, currentStates, ready) {
        if (!currentStates) return 'Unavailable';
        const imagePublic = currentStates['product-images'];
        const videoPublic = currentStates['product-videos'];
        const actualMode = imagePublic === videoPublic
            ? (imagePublic ? 'Public' : 'Private')
            : 'Mixed';
        if (!ready) return 'Needs attention';
        if (isEnabled) return 'Private (eligible listings only)';
        return restoreState?.saved === true
            ? `Restored (${actualMode})`
            : `Unchanged (${actualMode})`;
    }

    async function adminStatus() {
        const isEnabled = await enabled();
        let termiiReady = config.termiiConfigured;
        if (isEnabled && config.ready) {
            try {
                await validateTermiiConfiguration();
                termiiReady = true;
            } catch (_) {
                termiiReady = false;
            }
        }

        let currentStates = null;
        let restoreState = null;
        try {
            [currentStates, restoreState] = await Promise.all([
                getProductMediaBucketStates(),
                getProductMediaRestoreState()
            ]);
        } catch (_) {
            currentStates = null;
        }

        const mediaAccessReady = Boolean(
            currentStates && restoreState
            && await productMediaModeMatches(isEnabled, restoreState, currentStates)
        );
        return {
            enabled: isEnabled,
            mode: isEnabled ? 'Enabled' : 'Disabled',
            provider: 'Termii',
            providerConfigured: config.termiiConfigured,
            configurationReady: config.ready && termiiReady && mediaAccessReady,
            providerValidation: isEnabled
                ? (termiiReady ? 'Validated' : 'Validation failed')
                : (config.termiiConfigured ? 'Will validate on activation' : 'Not configured'),
            mediaAccessStatus: productMediaStatus(isEnabled, restoreState, currentStates, mediaAccessReady),
            providerStatus: config.termiiConfigured ? 'Configured' : 'Not configured'
        };
    }

    async function startChallenge(mode, body, request) {
        const isSignup = mode === 'signup';
        const user = isSignup ? null : (await requireUser(request)).user;
        const phone = normalizeNigerianPhone(body.phone);
        if (!phone) throw errorResult('Enter a valid Nigerian mobile number.', 400, 'INVALID_PHONE');
        const email = isSignup ? String(body.email || '').trim().toLowerCase() : String(user.email).toLowerCase();
        if (isSignup && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            throw errorResult('Enter a valid email address before requesting a code.', 400, 'INVALID_EMAIL');
        }

        const reserved = await rpc('phone_verification_reserve', {
            p_phone_e164: phone,
            p_email: email,
            p_auth_user_id: user?.id || null
        });
        if (!reserved?.ok) {
            if (reserved?.code === 'cooldown') {
                throw errorResult(
                    `Please wait ${Number(reserved.retry_after_seconds) || 60} seconds before requesting another code.`,
                    429,
                    'RESEND_COOLDOWN'
                );
            }
            if (reserved?.code === 'phone_in_use') {
                throw errorResult('That phone number is already linked to another account.', 409, 'PHONE_IN_USE');
            }
            if (reserved?.code === 'disabled') {
                throw errorResult('Phone verification is currently disabled.', 409, 'PHONE_VERIFICATION_DISABLED');
            }
            throw errorResult('A code could not be requested for that number.', 400, 'CHALLENGE_NOT_AVAILABLE');
        }

        if (!await enabled()) {
            throw errorResult('Phone verification is currently disabled.', 409, 'PHONE_VERIFICATION_DISABLED');
        }
        const pinId = await sendTermiiCode(phone);
        const saved = await rpc('phone_verification_store_pin', {
            p_phone_e164: phone,
            p_email: email,
            p_auth_user_id: user?.id || null,
            p_termii_pin_id: pinId
        });
        if (saved !== true) {
            throw errorResult('The code was sent but could not be recorded. Wait 60 seconds before trying again.', 503, 'CHALLENGE_SAVE_FAILED');
        }
        return {
            phone,
            message: 'A six-digit code was sent by SMS. It expires in 5 minutes; you can request another after 60 seconds.'
        };
    }

    async function checkCode(mode, body, request) {
        const isSignup = mode === 'signup';
        const { user } = isSignup ? { user: null } : await requireUser(request);
        const phone = normalizeNigerianPhone(body.phone);
        const code = String(body.code || '').trim();
        const email = isSignup ? String(body.email || '').trim().toLowerCase() : String(user.email).toLowerCase();
        if (!phone) throw errorResult('Enter a valid Nigerian mobile number.', 400, 'INVALID_PHONE');
        if (!/^\d{6}$/.test(code)) throw errorResult('Enter the six-digit code from your SMS.', 400, 'INVALID_CODE');

        const attempt = await rpc('phone_verification_begin_attempt', {
            p_phone_e164: phone,
            p_email: email,
            p_auth_user_id: user?.id || null
        });
        if (!attempt?.ok) {
            if (attempt?.code === 'expired') throw errorResult('That code has expired. Request a new code to continue.', 410, 'OTP_EXPIRED');
            if (attempt?.code === 'attempts_exceeded') throw errorResult('You have used all five attempts. Wait 60 seconds, then request a new code.', 429, 'OTP_ATTEMPTS_EXCEEDED');
            if (attempt?.code === 'disabled') throw errorResult('Phone verification is currently disabled.', 409, 'PHONE_VERIFICATION_DISABLED');
            throw errorResult('Request a new code before trying again.', 400, 'CHALLENGE_NOT_AVAILABLE');
        }

        if (!await enabled()) {
            throw errorResult('Phone verification is currently disabled.', 409, 'PHONE_VERIFICATION_DISABLED');
        }
        await verifyTermiiCode(attempt.pin_id, code);

        if (isSignup) {
            const ticket = makeTicket();
            const completed = await rpc('phone_verification_complete_signup', {
                p_phone_e164: phone,
                p_email: email,
                p_signup_ticket: ticket
            });
            if (completed !== true) {
                throw errorResult('Verification expired before registration could be completed. Request a new code.', 409, 'VERIFICATION_EXPIRED');
            }
            return {
                phone,
                ticket,
                message: 'Phone verified. You can now create your account.'
            };
        }

        const completed = await rpc('phone_verification_complete_update', {
            p_phone_e164: phone,
            p_auth_user_id: user.id
        });
        if (completed !== true) {
            throw errorResult('That number is already linked to another account. Use a different number.', 409, 'PHONE_IN_USE');
        }
        return {
            phone,
            verified: true,
            message: 'Phone number verified and saved.'
        };
    }

    return async function handle(request) {
        const origin = request.headers.get('Origin') || '*';
        if (request.method === 'OPTIONS') return json({}, 204, origin);
        if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, origin);

        try {
            if (!config.url || !config.anonKey || !config.serviceKey) {
                throw errorResult('Phone verification service is not fully configured.', 503, 'SERVICE_NOT_CONFIGURED');
            }
            const raw = await request.text();
            if (raw.length > 4096) throw errorResult('Request is too large.', 413, 'REQUEST_TOO_LARGE');
            let body;
            try { body = JSON.parse(raw || '{}'); } catch { throw errorResult('Invalid request.', 400, 'INVALID_REQUEST'); }

            const action = String(body.action || '');
            if (action === 'admin_status') {
                await requireAdmin(request);
                return json(await adminStatus(), 200, origin);
            }
            if (action === 'admin_set') {
                await requireAdmin(request);
                const nextEnabled = body.enabled === true;
                if (nextEnabled) {
                    await validateTermiiConfiguration();
                    if (await enabled()) {
                        await setProductMediaBucketStates({
                            'product-images': false,
                            'product-videos': false
                        });
                        return json(await adminStatus(), 200, origin);
                    }

                    const previousMediaStates = await setProductMediaBucketStates({
                        'product-images': false,
                        'product-videos': false
                    });
                    try {
                        const updated = await rpc('admin_update_phone_verification', {
                            p_enabled: true,
                            p_product_images_public: previousMediaStates['product-images'],
                            p_product_videos_public: previousMediaStates['product-videos']
                        });
                        if (updated?.ok !== true || updated?.enabled !== true) {
                            throw errorResult('The setting could not be saved.', 503, 'SETTINGS_SAVE_FAILED');
                        }
                    } catch (error) {
                        const restored = await restoreProductMediaBucketStates(previousMediaStates);
                        if (!restored) {
                            throw errorResult(
                                'The setting could not be saved and product media access needs administrator attention.',
                                503,
                                'MEDIA_ACCESS_UPDATE_FAILED'
                            );
                        }
                        throw error;
                    }
                } else {
                    // Disabling enforcement takes priority over storage cleanup:
                    // a Storage outage must not keep OTPs and publishing checks
                    // active after an administrator has turned the feature off.
                    const updated = await rpc('admin_update_phone_verification', { p_enabled: false });
                    if (updated?.ok !== true || updated?.enabled !== false) {
                        throw errorResult('The setting could not be saved.', 503, 'SETTINGS_SAVE_FAILED');
                    }
                    let warning = '';
                    if (updated.media_state_saved === true) {
                        try {
                            await setProductMediaBucketStates({
                                'product-images': updated.product_images_public,
                                'product-videos': updated.product_videos_public
                            });
                        } catch (_) {
                            warning = 'Phone verification is disabled and new OTPs have stopped, but the original product-media access could not be restored. Retry this setting and check the bucket access in Supabase.';
                        }
                    }
                    const status = await adminStatus();
                    if (warning) status.warning = warning;
                    return json(status, 200, origin);
                }
                return json(await adminStatus(), 200, origin);
            }

            if (!await enabled()) {
                throw errorResult('Phone verification is currently disabled.', 409, 'PHONE_VERIFICATION_DISABLED');
            }

            if (action === 'send_signup') {
                const result = await startChallenge('signup', body, request);
                return json(result, 200, origin);
            }
            if (action === 'verify_signup') {
                const result = await checkCode('signup', body, request);
                return json(result, 200, origin);
            }
            if (action === 'send_update') {
                const result = await startChallenge('update', body, request);
                return json(result, 200, origin);
            }
            if (action === 'verify_update') {
                const result = await checkCode('update', body, request);
                return json(result, 200, origin);
            }
            throw errorResult('Unsupported phone verification action.', 400, 'INVALID_ACTION');
        } catch (error) {
            const status = Number(error?.status) || 500;
            const message = status >= 500 && error?.code !== 'PROVIDER_NOT_CONFIGURED'
                ? 'Phone verification is temporarily unavailable. Please try again later.'
                : String(error?.message || 'Phone verification failed.');
            return json({
                error: message,
                code: String(error?.code || 'PHONE_VERIFICATION_ERROR')
            }, status, origin);
        }
    };
}
