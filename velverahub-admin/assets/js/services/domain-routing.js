/*
 * VelveraHub surface routing.
 *
 * Production uses separate origins for shoppers, sellers, and administrators.
 * Local and Replit preview hosts intentionally stay same-origin so the
 * development workflow remains easy to use.
 */
(function () {
    'use strict';

    const DOMAINS = Object.freeze({
        ng: 'https://velverahub.com',
        uk: 'https://velverahub.co.uk',
        admin: 'https://velverahub.org',
        shop: 'https://velverahub.shop'
    });

    function isLocalHost(hostname = window.location.hostname) {
        const host = String(hostname).toLowerCase();
        return host === 'localhost'
            || host === '127.0.0.1'
            || host === '0.0.0.0'
            || host.endsWith('.replit.dev')
            || host.endsWith('.repl.co');
    }

    function currentSurface() {
        const host = window.location.hostname.toLowerCase().replace(/^www\./, '');
        if (isLocalHost(host)) return 'local';
        if (host === 'velverahub.org') return 'admin';
        if (host === 'velverahub.shop') return 'shop';
        if (host === 'velverahub.co.uk') return 'uk';
        if (host === 'velverahub.com') return 'ng';
        return 'unknown';
    }

    function regionCode(region) {
        if (region === 'uk' || region === 'ng') return region;
        if (window.RegionService?.region === 'uk') return 'uk';
        if (currentSurface() === 'uk') return 'uk';
        return 'ng';
    }

    function join(origin, pathname = '/') {
        const path = String(pathname || '/');
        return `${origin}${path.startsWith('/') ? path : `/${path}`}`;
    }

    function originFor(surface = 'ng') {
        if (isLocalHost()) return window.location.origin;
        return DOMAINS[surface] || DOMAINS.ng;
    }

    function publicUrl(pathname = '/', region) {
        if (isLocalHost()) return join(window.location.origin, pathname);
        return join(originFor(regionCode(region)), pathname);
    }

    function sellerUrl(pathname = '/') {
        return publicUrl(pathname === '/' ? '/veeve/seller.html' : pathname);
    }

    function productUrl(productId, region) {
        if (!productId) return publicUrl('/veeve/products.html', region);
        const url = new URL(publicUrl('/veeve/product.html', region));
        url.searchParams.set('id', String(productId));
        return url.href;
    }

    function adminUrl(pathname = '/') {
        return join(originFor('admin'), pathname);
    }

    function shopOwnerUrl(pathname = '/') {
        if (isLocalHost()) {
            const localPath = pathname === '/' ? '/velverahub-shop/' : pathname;
            return join(window.location.origin, localPath);
        }
        return join(originFor('shop'), pathname);
    }

    function loginUrl(target = 'seller') {
        return target === 'admin' ? adminUrl('/?auth=login') : publicUrl('/veeve/auth.html?mode=login');
    }

    function isTrustedDestination(value) {
        try {
            const url = new URL(value);
        return [
            new URL(publicUrl('/')).origin,
            new URL(adminUrl('/')).origin,
            new URL(shopOwnerUrl('/')).origin
        ].includes(url.origin);
        } catch {
            return false;
        }
    }

    window.VelveraHubDomains = Object.freeze({
        ...DOMAINS,
        isLocalHost,
        currentSurface,
        publicUrl,
        sellerUrl,
        productUrl,
        shopOwnerUrl,
        adminUrl,
        loginUrl,
        isTrustedDestination,
        publicOrigin: (region) => new URL(publicUrl('/', region)).origin,
        sellerOrigin: () => new URL(publicUrl('/')).origin,
        adminOrigin: () => new URL(adminUrl('/')).origin
    });
})();