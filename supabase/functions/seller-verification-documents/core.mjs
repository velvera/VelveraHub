const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const MIME_BY_EXTENSION = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    png: 'image/png'
};

function jsonResponse(body, status, origin = '*') {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Cache-Control': 'no-store'
        }
    });
}

export function detectIdentityDocument(bytes, declaredType = '') {
    if (!(bytes instanceof Uint8Array) || bytes.length < 8) return null;
    const prefix = new TextDecoder().decode(bytes.subarray(0, 8));
    let extension = null;
    if (prefix.startsWith('%PDF-')) extension = 'pdf';
    else if (
        bytes[0] === 0xff
        && bytes[1] === 0xd8
        && bytes[2] === 0xff
    ) extension = 'jpg';
    else if (
        bytes[0] === 0x89
        && prefix.slice(1, 4) === 'PNG'
        && bytes[4] === 0x0d
        && bytes[5] === 0x0a
        && bytes[6] === 0x1a
        && bytes[7] === 0x0a
    ) extension = 'png';

    if (!extension) return null;
    const expectedType = MIME_BY_EXTENSION[extension];
    const normalizedType = String(declaredType || '').toLowerCase().trim();
    if (normalizedType && normalizedType !== 'application/octet-stream' && normalizedType !== expectedType) {
        return null;
    }
    return { extension, contentType: expectedType };
}

export function createSellerVerificationUploadHandler({ env, createClient }) {
    return async function handleSellerVerificationUpload(request) {
        const origin = request.headers.get('origin') || '*';
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                status: 204,
                headers: {
                    'Access-Control-Allow-Origin': origin,
                    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
                    'Access-Control-Allow-Methods': 'POST, OPTIONS',
                    'Cache-Control': 'no-store'
                }
            });
        }
        if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405, origin);

        const authorization = request.headers.get('authorization') || '';
        if (!/^Bearer\s+\S+$/i.test(authorization)) {
            return jsonResponse({ error: 'Sign in before uploading a document.' }, 401, origin);
        }
        const projectUrl = String(env.SUPABASE_URL || '').trim();
        const publicKey = String(env.SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY || '').trim();
        const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
        if (!projectUrl || !publicKey || !serviceRoleKey) {
            return jsonResponse({ error: 'Secure document upload is not configured.' }, 503, origin);
        }

        const contentLength = Number(request.headers.get('content-length') || 0);
        if (contentLength > MAX_BYTES + 128 * 1024) {
            return jsonResponse({ error: 'Choose a PDF, JPG, or PNG file up to 5 MB.' }, 413, origin);
        }

        let form;
        try {
            form = await request.formData();
        } catch {
            return jsonResponse({ error: 'Choose a valid verification document.' }, 400, origin);
        }
        const file = form.get('document');
        const caseId = String(form.get('case_id') || '').trim();
        if (!file || typeof file.arrayBuffer !== 'function' || file.size < 8 || file.size > MAX_BYTES) {
            return jsonResponse({ error: 'Choose a PDF, JPG, or PNG file up to 5 MB.' }, 413, origin);
        }
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(caseId)) {
            return jsonResponse({ error: 'The verification case is invalid.' }, 400, origin);
        }

        const userClient = createClient(projectUrl, publicKey, {
            auth: { persistSession: false, autoRefreshToken: false },
            global: { headers: { Authorization: authorization } }
        });
        const { data: { user } = {}, error: userError } = await userClient.auth.getUser();
        if (userError || !user?.id) {
            return jsonResponse({ error: 'Your sign-in has expired. Sign in again and retry.' }, 401, origin);
        }

        const bytes = new Uint8Array(await file.arrayBuffer());
        const detected = detectIdentityDocument(bytes, file.type);
        if (!detected || !ALLOWED_MIME_TYPES.has(detected.contentType)) {
            return jsonResponse({ error: 'The file content does not match a supported PDF, JPG, or PNG document.' }, 415, origin);
        }

        const serviceClient = createClient(projectUrl, serviceRoleKey, {
            auth: { persistSession: false, autoRefreshToken: false }
        });
        const { error: limitError } = await serviceClient.rpc('seller_identity_upload_reserve', {
            p_applicant_user_id: user.id,
            p_case_id: caseId
        });
        if (limitError) {
            const status = /limit reached/i.test(limitError.message || '') ? 429 : 403;
            return jsonResponse({
                error: status === 429
                    ? 'Upload limit reached. Try again later.'
                    : 'This case cannot accept a document right now.'
            }, status, origin);
        }

        const path = `${user.id}/${caseId}/${crypto.randomUUID()}.${detected.extension}`;
        const { error: uploadError } = await serviceClient.storage
            .from('seller-identity-private')
            .upload(path, bytes, {
                contentType: detected.contentType,
                cacheControl: '0',
                upsert: false
            });
        if (uploadError) {
            return jsonResponse({ error: 'The document could not be stored securely. Try again.' }, 502, origin);
        }
        return jsonResponse({ path }, 201, origin);
    };
}

export const sellerIdentityUploadLimits = Object.freeze({
    maxBytes: MAX_BYTES,
    mimeTypes: [...ALLOWED_MIME_TYPES]
});
