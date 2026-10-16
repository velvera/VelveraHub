function normaliseApiOrigin(value) {
    const candidate = String(value || '').trim().replace(/\/+$/, '');
    if (!candidate) return '';
    try {
        const parsed = new URL(candidate, window.location.origin);
        if (!['http:', 'https:'].includes(parsed.protocol)) return '';
        return parsed.origin;
    } catch {
        return '';
    }
}

function currentApiOrigin() {
    return normaliseApiOrigin(window.VELVERAHUB_CONFIG?.API_ORIGIN);
}

function apiUrl(endpoint) {
    const path = String(endpoint || '');
    if (/^https?:\/\//i.test(path)) return path;
    const apiOrigin = currentApiOrigin();
    if (window.VELVERAHUB_CONFIG?.STATIC_ONLY && !apiOrigin && path.startsWith('/api/')) return '';
    return `${apiOrigin}${path.startsWith('/') ? path : `/${path}`}`;
}

async function apiFetch(endpoint, options = {}) {
    const url = apiUrl(endpoint);
    if (!url) {
        return Promise.reject(new Error('Authenticated API origin is not configured for this static deployment.'));
    }
    const timeoutMs = Number.isFinite(Number(options.timeoutMs))
        ? Math.min(Math.max(Number(options.timeoutMs), 1000), 30000)
        : 15000;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    const upstreamSignal = options.signal;
    const abortFromUpstream = () => controller.abort(upstreamSignal?.reason);
    if (upstreamSignal) {
        if (upstreamSignal.aborted) abortFromUpstream();
        else upstreamSignal.addEventListener('abort', abortFromUpstream, { once: true });
    }
    const headers = {
        Accept: 'application/json',
        ...options.headers
    };
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const { timeoutMs: _timeoutMs, signal: _signal, ...fetchOptions } = options;
    try {
        return await fetch(url, {
            ...fetchOptions,
            credentials: 'omit',
            headers,
            signal: controller.signal
        });
    } catch (error) {
        if (error?.name === 'AbortError') {
            throw new Error(`The request timed out after ${Math.round(timeoutMs / 1000)} seconds. Please try again.`);
        }
        throw error;
    } finally {
        window.clearTimeout(timeout);
        upstreamSignal?.removeEventListener('abort', abortFromUpstream);
    }
}

const API = {
    get baseUrl() {
        return currentApiOrigin();
    },
    token: localStorage.getItem('velverahub_token'),

    fetch(endpoint, options = {}) {
        const headers = {
            ...options.headers
        };
        if (this.token && !headers.Authorization) {
            headers.Authorization = `Bearer ${this.token}`;
        }
        return apiFetch(endpoint, { ...options, headers });
    },

    async request(endpoint, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };

        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }

        try {
            const response = await this.fetch(endpoint, { ...options, headers });

            if (!response.ok) {
                const error = await response.json().catch(() => ({ error: 'Request failed' }));
                throw new Error(error.error || 'Request failed');
            }

            return await response.json();
        } catch (error) {
            window.Observability?.reportError('api-request', `api-${Date.now().toString(36)}`, error, { source: 'api-client' });
            throw error;
        }
    },

    setToken(token, { persist = true } = {}) {
        this.token = token || null;
        if (!persist) return;
        if (this.token) {
            localStorage.setItem('velverahub_token', this.token);
        } else {
            localStorage.removeItem('velverahub_token');
        }
    },

    get(endpoint) {
        return this.request(endpoint, { method: 'GET' });
    },

    post(endpoint, data) {
        return this.request(endpoint, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    put(endpoint, data) {
        return this.request(endpoint, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    },

    delete(endpoint) {
        return this.request(endpoint, { method: 'DELETE' });
    }
};

window.API = API;
window.VelveraAPI = Object.freeze({
    get origin() {
        return currentApiOrigin();
    },
    fetch: apiFetch,
    url: apiUrl
});
