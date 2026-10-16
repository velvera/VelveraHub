function clean(value) {
    return String(value || '').trim().replace(/^[\s"'`]+/, '').replace(/[\s"'`,;]+$/, '');
}

export function getSupabaseConfig(env) {
    const url = clean(env.SUPABASE_URL).replace(/\/+$/, '');
    const key = clean(env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY);
    if (!url || !key) throw new Error('Supabase is not configured for this Pages deployment.');
    return { url, key };
}

export function getBearer(request) {
    const value = request.headers.get('Authorization') || '';
    return value.startsWith('Bearer ') ? value.slice(7).trim() : '';
}

export function responseHeaders(request, extra = {}) {
    const origin = request.headers.get('Origin');
    return {
        'Access-Control-Allow-Origin': origin || '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Cache-Control': 'no-store',
        Vary: 'Origin',
        ...extra
    };
}

export function json(request, payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: responseHeaders(request, { 'Content-Type': 'application/json' })
    });
}

export function handleOptions(request) {
    return request.method === 'OPTIONS'
        ? new Response(null, { status: 204, headers: responseHeaders(request) })
        : null;
}

export async function supabaseRequest(context, path, options = {}) {
    const { url, key } = getSupabaseConfig(context.env);
    const token = options.token || getBearer(context.request);
    const headers = new Headers(options.headers || {});
    headers.set('apikey', key);
    headers.set('Authorization', `Bearer ${token || key}`);
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

    const response = await fetch(`${url}${path.startsWith('/') ? path : `/${path}`}`, {
        ...options,
        headers
    });
    return response;
}

export async function readSupabaseJson(response) {
    const text = await response.text();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        return { error: text };
    }
}

export async function callRpc(context, name, args = {}) {
    const response = await supabaseRequest(context, `/rest/v1/rpc/${name}`, {
        method: 'POST',
        body: JSON.stringify(args)
    });
    const payload = await readSupabaseJson(response);
    if (!response.ok) {
        const message = payload?.message || payload?.error_description || payload?.hint || payload?.error || `Supabase RPC failed (${response.status})`;
        const error = new Error(message);
        error.status = response.status;
        throw error;
    }
    return payload;
}

export async function requireRole(context, roles) {
    const token = getBearer(context.request);
    if (!token) throw Object.assign(new Error('Authentication required'), { status: 401 });

    const role = await callRpc(context, 'current_profile_role');
    const allowed = Array.isArray(roles) ? roles : [roles];
    if (!allowed.includes(role)) throw Object.assign(new Error('Access denied'), { status: 403 });
    return { role, token };
}

export function getPath(context) {
    const value = context.params?.path;
    return Array.isArray(value) ? value.filter(Boolean) : String(value || '').split('/').filter(Boolean);
}

export function errorResponse(request, error) {
    const status = Number(error?.status) || 500;
    return json(request, {
        error: status >= 500 ? 'Production API request failed.' : error.message
    }, status);
}