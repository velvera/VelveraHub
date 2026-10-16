(function () {
    'use strict';

    const SESSION_KEY = 'velvera_ops_session';
    const MAX_EVENTS_PER_PAGE = 40;
    const SLOW_REQUEST_MS = 1500;
    const allowedEvents = new Set([
        'catalogue_failure',
        'checkout_abandonment',
        'checkout_failure',
        'auth_failure',
        'slow_api_request',
        'seller_publish_error',
        'client_error'
    ]);
    let sent = 0;
    let errorSequence = 0;
    let checkoutStarted = false;
    let checkoutCompleted = false;
    const recentErrors = new Map();

    function getSessionId() {
        try {
            let value = sessionStorage.getItem(SESSION_KEY);
            if (!value) {
                value = `o_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
                sessionStorage.setItem(SESSION_KEY, value);
            }
            return value;
        } catch (_) {
            return 'session_unavailable';
        }
    }

    function safeRoute() {
        return `${window.location.pathname || '/'}`.slice(0, 180);
    }

    function cleanProperties(properties = {}) {
        const result = {};
        Object.entries(properties).slice(0, 12).forEach(([key, value]) => {
            if (['password', 'token', 'authorization', 'email', 'phone', 'address', 'payment', 'card', 'secret'].some((blocked) => key.toLowerCase().includes(blocked))) return;
            if (value === null || typeof value === 'boolean' || typeof value === 'number') result[key] = value;
            else if (typeof value === 'string') result[key] = value.slice(0, key === 'diagnostic' ? 1200 : 120);
        });
        return result;
    }

    function cleanDiagnostic(value) {
        return String(value || 'Unknown client error')
            .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
            .replace(/\b(password|access[_ -]?token|refresh[_ -]?token|authorization|secret|api[_ -]?key)\b\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
            .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[token]')
            .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
            .replace(/\b(?:\+?\d[\s().-]*){8,}\b/g, '[phone]')
            .replace(/[\u0000-\u001f\u007f]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 1200);
    }

    function track(name, properties = {}) {
        if (!allowedEvents.has(name) || sent >= MAX_EVENTS_PER_PAGE) return;
        sent += 1;
        const payload = {
            name,
            sessionId: getSessionId(),
            region: window.RegionService?.region || 'unknown',
            route: safeRoute(),
            timestamp: new Date().toISOString(),
            properties: cleanProperties(properties)
        };
        try {
            const body = JSON.stringify({ events: [payload] });
            const endpoint = window.VelveraAPI?.url?.('/api/observability/events');
            if (!endpoint) return;
            if (navigator.sendBeacon) {
                navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
            } else {
                const apiFetch = window.VelveraAPI?.fetch || fetch;
                apiFetch('/api/observability/events', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body,
                    keepalive: true
                }).catch(() => {});
            }
        } catch (_) {
            // Telemetry must never interrupt a buyer or seller flow.
        }
    }

    function reportError(scope, requestId, error, context = {}) {
        if (!error) return requestId;
        const diagnostic = cleanDiagnostic(error?.message || error);
        if (!diagnostic) return requestId;
        const safeScope = String(scope || 'client').replace(/[^a-z0-9_-]/gi, '-').slice(0, 80);
        const errorCode = String(error?.code || error?.status || '').replace(/[^a-z0-9_.-]/gi, '').slice(0, 80);
        const dedupeKey = `${safeRoute()}|${errorCode}|${diagnostic}`;
        const now = Date.now();
        if ((recentErrors.get(dedupeKey) || 0) > now - 30000) return requestId;
        recentErrors.set(dedupeKey, now);
        if (recentErrors.size > 100) {
            const oldest = recentErrors.keys().next().value;
            recentErrors.delete(oldest);
        }
        return track('client_error', {
            scope: safeScope,
            source: context.source || 'handled',
            errorName: String(error?.name || 'Error').slice(0, 80),
            errorCode,
            diagnostic,
            clientRequestId: String(requestId || `client-error-${now.toString(36)}-${++errorSequence}`).slice(0, 120),
            action: context.action || ''
        });
    }

    function captureGlobalError(event) {
        const error = event?.error || event?.reason || event?.message;
        if (!error) return;
        reportError(
            event?.type === 'unhandledrejection' ? 'unhandled-rejection' : 'browser-runtime',
            `runtime-${Date.now().toString(36)}-${++errorSequence}`,
            error,
            { source: event?.type || 'runtime' }
        );
    }

    function classifyApiFailure(pathname) {
        if (/\/api\/(?:products|shops|search)\b/.test(pathname)) return 'catalogue_failure';
        if (/\/api\/auth\b/.test(pathname)) return 'auth_failure';
        if (/\/api\/orders\b/.test(pathname)) return 'checkout_failure';
        if (/\/api\/seller\b/.test(pathname)) return 'seller_publish_error';
        return null;
    }

    function installFetchObserver() {
        if (window.__velveraFetchObserved || typeof window.fetch !== 'function') return;
        window.__velveraFetchObserved = true;
        const originalFetch = window.fetch.bind(window);
        window.fetch = async function observedFetch(input, init) {
            const requestUrl = typeof input === 'string' ? input : input?.url || '';
            let parsed;
            try { parsed = new URL(requestUrl, window.location.origin); } catch (_) { return originalFetch(input, init); }
            const started = performance.now();
            try {
                const response = await originalFetch(input, init);
                const durationMs = Math.round(performance.now() - started);
                if (parsed.origin === window.location.origin && parsed.pathname.startsWith('/api/') &&
                    parsed.pathname !== '/api/observability/events') {
                    if (!response.ok) track(classifyApiFailure(parsed.pathname), {
                        statusCode: response.status,
                        method: init?.method || 'GET'
                    });
                    if (durationMs >= SLOW_REQUEST_MS) track('slow_api_request', {
                        statusCode: response.status,
                        durationMs,
                        method: init?.method || 'GET'
                    });
                }
                return response;
            } catch (error) {
                if (parsed.origin === window.location.origin && parsed.pathname.startsWith('/api/') &&
                    parsed.pathname !== '/api/observability/events') {
                    track(classifyApiFailure(parsed.pathname), { method: init?.method || 'GET', network: true });
                }
                throw error;
            }
        };
    }

    const Observability = {
        track,
        reportError,
        userMessage(error, fallback = 'We could not complete that request. Please try again.') {
            const message = String(error?.message || error || '').toLowerCase();
            if (/invalid login credentials|invalid email or password|email or password is incorrect/.test(message)) {
                return 'Your email or password is incorrect.';
            }
            if (/already registered|already exists|duplicate key|unique constraint/.test(message)) {
                return 'An account or value with those details already exists.';
            }
            if (/email not confirmed|confirm your email/.test(message)) {
                return 'Please verify your email before signing in.';
            }
            if (/too many requests|too many attempts|rate limit/.test(message)) {
                return 'Too many attempts. Please wait a moment and try again.';
            }
            if (/password.*(weak|short|at least)|weak password/.test(message)) {
                return 'Choose a stronger password and try again.';
            }
            if (/failed to fetch|network|timed? ?out|connection/.test(message)) {
                return 'We could not connect. Check your connection and try again.';
            }
            const safeFallback = String(fallback || '');
            return /supabase|postgrest|postgres|schema|migration|sqlstate|pgrst|database|permission|could not find the|relation .+ does not exist|column .+ does not exist|table .+ does not exist|constraint|duplicate key|violates|stack trace|internal server|http\s*\d{3}|status code|failed to fetch|econn(?:refused|reset|timedout)?/i.test(safeFallback)
                ? 'We could not complete that request. Please try again.'
                : safeFallback || 'We could not complete that request. Please try again.';
        },
        startCheckout() {
            checkoutStarted = true;
            try { sessionStorage.setItem('velvera_checkout_started', '1'); } catch (_) {}
        },
        completeCheckout() {
            checkoutCompleted = true;
            try { sessionStorage.removeItem('velvera_checkout_started'); } catch (_) {}
        },
        init() {
            installFetchObserver();
            window.addEventListener('error', captureGlobalError);
            window.addEventListener('unhandledrejection', captureGlobalError);
            const pending = Array.isArray(window.__velveraPendingClientErrors)
                ? window.__velveraPendingClientErrors.splice(0)
                : [];
            pending.forEach((entry) => reportError(
                entry.scope || 'client-bootstrap',
                entry.requestId || `bootstrap-${Date.now().toString(36)}-${++errorSequence}`,
                entry.error || new Error('A client service failed during startup.'),
                { source: 'bootstrap' }
            ));
            try { checkoutStarted = sessionStorage.getItem('velvera_checkout_started') === '1'; } catch (_) {}
            window.addEventListener('pagehide', () => {
                if (checkoutStarted && !checkoutCompleted) track('checkout_abandonment', {
                    reason: 'page_exit'
                });
            }, { once: true });
        }
    };

    window.Observability = Observability;
    document.addEventListener('DOMContentLoaded', () => Observability.init(), { once: true });
})();