(function () {
    'use strict';
    const KEY = 'velverahub_cookie_consent';
    const normalize = (value) => {
        if (value === 'granted' || value === 'accepted') return 'granted';
        if (value === 'rejected' || value === 'reject' || value === 'denied') return 'rejected';
        return 'unset';
    };
    const read = () => {
        try { return normalize(localStorage.getItem(KEY)); } catch (_) { return 'unset'; }
    };
    const write = (value) => {
        const status = normalize(value);
        if (status === 'unset') return read();
        try { localStorage.setItem(KEY, status); } catch (_) {}
        window.dispatchEvent(new CustomEvent('velverahub:cookie-consent', { detail: { value: status } }));
        return status;
    };
    function render() {
        if (document.getElementById('cookieConsentBanner') || read() !== 'unset') return;
        const banner = document.createElement('section');
        banner.id = 'cookieConsentBanner';
        banner.className = 'cookie-consent-banner';
        banner.setAttribute('role', 'region');
        banner.setAttribute('aria-label', 'Cookie consent');
        banner.innerHTML = '<p class="cookie-consent-copy">We use essential storage to keep VelveraHub working. Optional analytics and browsing-based recommendations are off unless you accept. <a href="/veeve/legal.html#privacy">Privacy Policy</a></p><div class="cookie-consent-actions"><button type="button" data-cookie-choice="rejected">Decline</button><button type="button" data-cookie-choice="granted">Accept</button></div>';
        document.body.appendChild(banner);
        banner.addEventListener('click', (event) => {
            const button = event.target.closest('[data-cookie-choice]');
            if (!button || !banner.contains(button)) return;
            write(button.dataset.cookieChoice);
            banner.remove();
        });
    }
    function showBanner() {
        try { localStorage.removeItem(KEY); } catch (_) {}
        document.getElementById('cookieConsentBanner')?.remove();
        window.dispatchEvent(new CustomEvent('velverahub:cookie-consent', { detail: { value: 'unset' } }));
        render();
        const banner = document.getElementById('cookieConsentBanner');
        banner?.querySelector?.('[data-cookie-choice="rejected"]')?.focus?.();
        return Boolean(banner);
    }
    function init() {
        render();
        window.dispatchEvent(new CustomEvent('velverahub:cookie-consent-ready', {
            detail: { value: read() }
        }));
    }
    window.CookieConsent = Object.freeze({ getStatus: read, setStatus: write, showBanner });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();