/*
 * Lightweight, consent-aware marketplace intelligence.
 *
 * This intentionally keeps buyer signals in the browser until a persistent
 * analytics store is configured. It gives the storefront useful session
 * recommendations and a deterministic experiment holdout without leaking
 * browsing data for shoppers who have not opted in.
 */
(function () {
    'use strict';

    const CONSENT_KEY = 'velvera_personalization_consent';
    const PROFILE_KEY = 'velvera_discovery_profile';
    const EXPERIMENT_KEY = 'velvera_recommendation_experiment';
    const EVENTS_KEY = 'velvera_marketplace_events';
    const EVENT_NAMES = new Set([
        'product_view',
        'product_click',
        'wishlist_add',
        'cart_add',
        'recommendation_impression',
        'recommendation_click',
        'experiment_assignment',
        'search',
        'checkout_start',
        'purchase'
    ]);

    function readJson(key, fallback) {
        try {
            const value = JSON.parse(localStorage.getItem(key));
            return value ?? fallback;
        } catch (_) {
            return fallback;
        }
    }

    function writeJson(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (_) {
            // Private browsing/storage limits should never break shopping.
        }
    }

    function sessionId() {
        try {
            let id = sessionStorage.getItem('velvera_session_id');
            if (!id) {
                id = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                sessionStorage.setItem('velvera_session_id', id);
            }
            return id;
        } catch (_) {
            return 'session_unavailable';
        }
    }

    function stableBucket(value) {
        return String(value).split('').reduce((sum, char) => ((sum * 31) + char.charCodeAt(0)) % 100, 7);
    }

    function getVariant() {
        if (getConsent() !== 'granted') return 'holdout';
        let variant = localStorage.getItem(EXPERIMENT_KEY);
        if (!variant) {
            variant = stableBucket(sessionId()) < 15 ? 'holdout' : 'personalized';
            try { localStorage.setItem(EXPERIMENT_KEY, variant); } catch (_) {}
        }
        return variant;
    }

    function getConsent() {
        if (window.CookieConsent?.getStatus?.() !== 'granted') return null;
        try { return localStorage.getItem(CONSENT_KEY); } catch (_) { return null; }
    }

    function setConsent(value) {
        const consent = value === 'granted' ? 'granted' : 'denied';
        let previous = null;
        try {
            previous = localStorage.getItem(CONSENT_KEY);
            localStorage.setItem(CONSENT_KEY, consent);
        } catch (_) {}
        if (consent === 'granted' && previous !== 'granted') {
            track('experiment_assignment', { variant: getVariant() });
        } else if (consent === 'denied') {
            try {
                localStorage.removeItem(PROFILE_KEY);
                localStorage.removeItem(EXPERIMENT_KEY);
                localStorage.removeItem(EVENTS_KEY);
            } catch (_) {}
        }
    }

    function syncCookieConsent(value) {
        if (!['granted', 'rejected'].includes(value)) return;
        const consent = value === 'granted' ? 'granted' : 'denied';
        try {
            if (localStorage.getItem(CONSENT_KEY) === consent) return;
        } catch (_) {}
        setConsent(consent);
    }

    window.addEventListener('velverahub:cookie-consent', (event) => {
        syncCookieConsent(event.detail?.value);
    });
    window.addEventListener('velverahub:cookie-consent-ready', (event) => {
        syncCookieConsent(event.detail?.value);
    });

    function track(name, properties = {}) {
        if (!EVENT_NAMES.has(name) || getConsent() !== 'granted') return;
        const event = {
            name,
            sessionId: sessionId(),
            variant: getVariant(),
            region: window.RegionService?.region || 'ng',
            location: window.RegionService?.location || 'all',
            timestamp: new Date().toISOString(),
            contributionMargin: properties.contributionMargin ?? null,
            ...properties
        };
        const events = readJson(EVENTS_KEY, []);
        events.push(event);
        writeJson(EVENTS_KEY, events.slice(-200));
        // Static Pages deployments keep personalization events on-device.
        // Do not call a missing API host or send analytics through the anon key.
        if (!window.VELVERAHUB_CONFIG?.STATIC_ONLY) {
            try {
                const apiFetch = window.VelveraAPI?.fetch || fetch;
                apiFetch('/api/analytics/events', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ events: [event] }),
                    keepalive: true
                }).catch(() => {});
            } catch (_) {}
        }
        const profile = readJson(PROFILE_KEY, { categories: {}, viewed: [], clicked: [] });
        const category = properties.category;
        if (category) profile.categories[category] = (profile.categories[category] || 0) + 1;
        if (properties.productId && ['product_view', 'product_click', 'recommendation_click'].includes(name)) {
            profile[name === 'product_view' ? 'viewed' : 'clicked'] = [
                ...(profile[name === 'product_view' ? 'viewed' : 'clicked'] || []),
                String(properties.productId)
            ].slice(-40);
        }
        writeJson(PROFILE_KEY, profile);
    }

    function getProfile() {
        if (getConsent() !== 'granted') {
            return { categories: {}, viewed: [], clicked: [] };
        }
        return readJson(PROFILE_KEY, { categories: {}, viewed: [], clicked: [] });
    }

    function rankProducts(products = []) {
        const list = [...products];
        const variant = getVariant();
        const profile = getProfile();
        const maxSales = Math.max(1, ...list.map((p) => Number(p.sales_count || 0)));
        const now = Date.now();

        return list.map((product, index) => {
            const categoryAffinity = Number(profile.categories?.[product.category] || 0);
            const rating = Math.min(5, Number(product.rating || 0)) / 5;
            const sales = Math.min(1, Number(product.sales_count || 0) / maxSales);
            const market = window.RegionService?.marketContext || {};
            const selectedLocation = window.RegionService?.location || 'all';
            const coverage = product.shops?.coverage_areas || product.shop_coverage_areas || [];
            const localMatch = selectedLocation !== 'all' && (
                product.location === selectedLocation || coverage.includes(selectedLocation)
            ) ? 1 : selectedLocation === 'all' ? 0.5 : 0;
            const paymentFit = market.mobilePaymentReliability || 0.75;
            const localSignal = (localMatch * 0.6) + (paymentFit * 0.2) +
                ((1 - (market.cashOnDeliveryRisk || 0.25)) * 0.2);
            const freshness = product.created_at
                ? Math.max(0, 1 - ((now - new Date(product.created_at).getTime()) / 2.592e9))
                : 0.35;
            const delivery = window.DeliveryPromiseEngine?.calculate(product)?.reliability || 70;
            const personalizedScore = (categoryAffinity * 0.34) + (rating * 0.24) +
                (sales * 0.14) + (freshness * 0.08) + ((delivery / 100) * 0.16) +
                (localSignal * (market.localSignalWeight || 0.18));
            const baselineScore = (freshness * 0.42) + (rating * 0.32) + (sales * 0.26);
            return {
                product,
                score: variant === 'personalized' ? personalizedScore : baselineScore,
                originalIndex: index
            };
        }).sort((a, b) => b.score - a.score || a.originalIndex - b.originalIndex).map((entry) => entry.product);
    }

    function formatDate(date) {
        return new Intl.DateTimeFormat(window.RegionService?.region === 'uk' ? 'en-GB' : 'en-NG', {
            weekday: 'short',
            month: 'short',
            day: 'numeric'
        }).format(date);
    }

    function isHoliday(date, region) {
        const monthDay = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        const holidays = ['01-01', '05-01', '12-25', '12-26'];
        if (region === 'ng') holidays.push('10-01', '05-29');
        return holidays.includes(monthDay);
    }

    function addBusinessDays(start, days, region) {
        const result = new Date(start);
        let remaining = days;
        while (remaining > 0) {
            result.setDate(result.getDate() + 1);
            const isWeekend = result.getDay() === 0 || result.getDay() === 6;
            if (!isWeekend && !isHoliday(result, region)) remaining--;
        }
        return result;
    }

    const DeliveryPromiseEngine = {
        calculate(product = {}, selectedLocation = window.RegionService?.location || 'all') {
            const region = window.RegionService?.region || 'ng';
            const shop = product.shops || {};
            const coverage = Array.isArray(shop.coverage_areas) ? shop.coverage_areas : [];
            const exactLocation = selectedLocation !== 'all' && product.location === selectedLocation;
            const coveredLocation = selectedLocation !== 'all' && coverage.includes(selectedLocation);
            const laneDays = selectedLocation === 'all' ? 2 : exactLocation ? 1 : coveredLocation ? 2 : 3;
            const processingDays = Math.max(1, Math.min(3, Number(product.processing_days || shop.processing_days || 1)));
            const courierPerformance = Math.max(0.55, Math.min(0.99, Number(shop.courier_performance || 0.84)));
            const cutoffDays = new Date().getHours() >= 14 ? 1 : 0;
            const reliability = Math.round((courierPerformance * 72) + (exactLocation ? 22 : coveredLocation ? 17 : 10) - (cutoffDays * 3));
            const minDays = laneDays + processingDays + cutoffDays;
            const maxDays = Math.min(10, minDays + (courierPerformance < 0.75 ? 2 : 1));
            const start = addBusinessDays(new Date(), minDays, region);
            const end = addBusinessDays(new Date(), maxDays, region);
            const reason = exactLocation
                ? 'Ships from your selected location'
                : coveredLocation ? 'Seller coverage area matched' : 'Estimated from seller lane and courier history';
            return {
                minDays,
                maxDays,
                reliability: Math.max(52, Math.min(98, reliability)),
                label: `Arrives ${formatDate(start)}–${formatDate(end)}`,
                shortLabel: `${minDays}–${maxDays} business days`,
                reason
            };
        },

        render(product) {
            const promise = this.calculate(product);
            const trust = product.inventory_verified ? ' · inventory verified' : '';
            return `<div class="delivery-promise" title="${promise.reason}">
                <i class="fas fa-truck-fast"></i>
                <span><strong>${promise.label}</strong></span>
            </div>`;
        }
    };

    const MarketplaceIntelligence = {
        getConsent,
        setConsent,
        getVariant,
        getProfile,
        rankProducts,
        track,
        init() {
            syncCookieConsent(window.CookieConsent?.getStatus?.());

            document.addEventListener('click', (event) => {
                const target = event.target.closest('[data-product-id], [data-action]');
                if (!target) return;
                const productId = target.dataset.productId;
                const category = target.dataset.category;
                const action = target.dataset.action;
                if (productId && target.closest('.yml-card')) {
                    track('recommendation_click', { productId, category });
                } else if (productId && action === 'wishlist') {
                    track('wishlist_add', { productId, category });
                } else if (productId && action === 'add-to-cart') {
                    track('cart_add', { productId, category });
                } else if (productId && target.matches('.product-title, .product-card')) {
                    track('product_click', { productId, category });
                }
            });
        }
    };

    window.DeliveryPromiseEngine = DeliveryPromiseEngine;
    window.MarketplaceIntelligence = MarketplaceIntelligence;
    document.addEventListener('DOMContentLoaded', () => MarketplaceIntelligence.init());
})();