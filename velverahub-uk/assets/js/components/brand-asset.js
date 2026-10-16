(function () {
    'use strict';

    function safeBrandImageUrl(value) {
        try {
            const url = new URL(String(value || ''), window.location.origin);
            if (url.protocol === 'https:' || url.origin === window.location.origin) return url.href;
        } catch (_) {}
        return '/img/logo.png';
    }

    document.addEventListener('DOMContentLoaded', async () => {
        let branding = { logoUrl: '/img/logo.png' };
        try {
            if (window.supabaseConfigReady) await window.supabaseConfigReady;
            const supabase = window.SupabaseClient?.get();
            if (supabase && window.SupabaseClient.isConfigured()) {
                const { data, error } = await supabase
                    .from('site_settings')
                    .select('logo_url')
                    .eq('id', 'branding')
                    .maybeSingle();
                if (error) throw error;
                branding = { logoUrl: data?.logo_url || '/img/logo.png' };
            } else if (!window.VELVERAHUB_CONFIG?.STATIC_ONLY) {
                const apiFetch = window.VelveraAPI?.fetch || fetch;
                const response = await apiFetch('/api/branding', { cache: 'no-store' });
                if (response.ok) branding = await response.json();
            }
        } catch (_) {
            // Keep the checked-in static brand mark when branding is unavailable.
        }

        const logoUrl = safeBrandImageUrl(branding.logoUrl);
        document.querySelectorAll('.logo-icon').forEach((icon) => {
            icon.classList.toggle('logo-icon--empty', !logoUrl);
            const image = document.createElement('img');
            image.src = logoUrl;
            image.alt = '';
            image.setAttribute('aria-hidden', 'true');
            image.className = 'header-brand-mark';
            icon.replaceChildren(image);
            icon.hidden = !logoUrl;
            image.addEventListener('error', () => {
                if (image.dataset.staticFallback) return;
                image.dataset.staticFallback = 'true';
                image.src = '/img/logo.png';
            }, { once: true });
        });
    }, { once: true });
})();