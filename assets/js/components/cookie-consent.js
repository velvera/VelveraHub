(function () {
    'use strict';
    const KEY = 'velverahub_cookie_consent';
    const read = () => {
        try { return localStorage.getItem(KEY) || 'unset'; } catch (_) { return 'unset'; }
    };
    const write = (value) => {
        try { localStorage.setItem(KEY, value); } catch (_) {}
        window.dispatchEvent(new CustomEvent('velverahub:cookie-consent', { detail: { value } }));
    };
    function render() {
        if (document.getElementById('cookieConsentBanner') || read() !== 'unset') return;
        const banner = document.createElement('section');
        banner.id = 'cookieConsentBanner';
        banner.className = 'cookie-consent-banner';
        banner.setAttribute('aria-label', 'Cookie preferences');
        banner.innerHTML = '<div><strong>Cookie choices</strong><span> We use essential storage to run VelveraHub. Optional analytics is off until you allow it. <a href="/veeve/legal.html#cookies">Learn more</a></span></div><div class="cookie-consent-actions"><button type="button" data-cookie-choice="reject">Essential only</button><button type="button" data-cookie-settings>Settings</button><button type="button" class="cookie-primary" data-cookie-choice="granted">Allow analytics</button></div>';
        document.body.appendChild(banner);
        banner.addEventListener('click', (event) => {
            const choice = event.target.closest('[data-cookie-choice]')?.dataset.cookieChoice;
            if (choice) { write(choice); banner.remove(); }
        });
    }
    function showSettings() {
        const existing = document.getElementById('cookieSettingsDialog');
        if (existing?.open) {
            existing.querySelector('input, button')?.focus();
            return;
        }
        existing?.remove();
        const dialog = document.createElement('dialog');
        dialog.id = 'cookieSettingsDialog';
        dialog.className = 'cookie-settings-dialog';
        dialog.innerHTML = '<form method="dialog"><button class="dialog-close" value="close" aria-label="Close cookie settings">×</button><h2>Cookie settings</h2><p>Essential storage is always active. Optional analytics helps us improve the marketplace and remains off unless you choose it.</p><div class="cookie-setting-row"><span><strong>Essential</strong><small>Authentication, cart, region and consent preferences.</small></span><input type="checkbox" checked disabled aria-label="Essential cookies always enabled"></div><div class="cookie-setting-row"><span><strong>Analytics</strong><small>Aggregated marketplace events, only after consent.</small></span><input type="checkbox" id="optionalAnalyticsConsent" aria-label="Allow optional analytics"></div><div class="cookie-settings-actions"><button value="save" class="cookie-primary">Save choices</button></div></form>';
        document.body.appendChild(dialog);
        document.getElementById('cookieConsentBanner')?.classList.add('is-hidden');
        dialog.addEventListener('close', () => {
            if (dialog.returnValue === 'save') write(dialog.querySelector('#optionalAnalyticsConsent').checked ? 'granted' : 'rejected');
            const banner = document.getElementById('cookieConsentBanner');
            if (read() === 'unset') banner?.classList.remove('is-hidden');
            else banner?.remove();
            dialog.remove();
        });
        dialog.showModal();
    }
    function init() {
        document.addEventListener('click', (event) => {
            if (event.target.closest('[data-cookie-settings]')) showSettings();
        });
        render();
    }
    window.CookieConsent = { getStatus: read, setStatus: write, showSettings };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();