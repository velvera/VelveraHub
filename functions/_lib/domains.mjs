export const DOMAIN_MAP = Object.freeze({
    ng: 'https://velverahub.com',
    uk: 'https://velverahub.co.uk',
    admin: 'https://velverahub.org',
    shop: 'https://velverahub.shop'
});

function normalizeHost(hostname) {
    return String(hostname || '').toLowerCase().replace(/^www\./, '').split(':')[0];
}

export function isLocalHost(hostname) {
    const host = normalizeHost(hostname);
    return host === 'localhost'
        || host === '127.0.0.1'
        || host === '0.0.0.0'
        || host.endsWith('.replit.dev')
        || host.endsWith('.repl.co');
}

export function getSurface(request) {
    const url = new URL(request.url);
    const host = normalizeHost(url.hostname);
    if (isLocalHost(host)) return 'local';
    if (host === 'velverahub.org') return 'admin';
    if (host === 'velverahub.shop') return 'shop';
    if (host === 'velverahub.co.uk') return 'uk';
    if (host === 'velverahub.com') return 'ng';
    return 'unknown';
}

export function originFor(surface, request) {
    if (surface === 'local' || surface === 'unknown') return new URL(request.url).origin;
    return DOMAIN_MAP[surface] || DOMAIN_MAP.ng;
}

export function publicOrigin(request, region = null) {
    const surface = getSurface(request);
    if (surface === 'local') return new URL(request.url).origin;
    if (region === 'uk' || surface === 'uk') return DOMAIN_MAP.uk;
    return DOMAIN_MAP.ng;
}

export function surfaceRedirect(request, pathname) {
    const surface = getSurface(request);
    if (surface === 'local' || surface === 'unknown') return null;

    const url = new URL(request.url);
    const target = (origin, path = '/') => {
        const destination = new URL(path, origin);
        destination.search = url.search;
        return Response.redirect(destination.toString(), 302);
    };

    if (surface === 'shop') {
        if (pathname.startsWith('/dashboards/admin')) {
            return target(DOMAIN_MAP.admin, '/dashboards/admin/');
        }
    }

    if (surface === 'admin') {
        if (pathname === '/' || pathname === '/index.html') {
            return target(DOMAIN_MAP.admin, '/dashboards/admin/');
        }
        if (pathname.startsWith('/dashboards/shop-owner')) {
            return target(DOMAIN_MAP.shop, '/');
        }
    }

    if (surface === 'ng' || surface === 'uk') {
        if (pathname.startsWith('/dashboards/shop-owner')) {
            return target(DOMAIN_MAP.shop, '/');
        }
        if (pathname.startsWith('/dashboards/admin')) {
            return target(DOMAIN_MAP.admin, '/dashboards/admin/');
        }
    }

    return null;
}