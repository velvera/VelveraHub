(() => {
    const TABLES = {
        verificationBucket: 'delivery-provider-verification-private'
    };

    function client() {
        return window.SupabaseClient?.get() || null;
    }

    function marketCountry(region = window.RegionService?.region) {
        return ['uk', 'gb'].includes(String(region || '').toLowerCase()) ? 'GB' : 'NG';
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (character) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[character]);
    }

    function formatFee(amount, currency = 'NGN') {
        const locale = currency === 'GBP' ? 'en-GB' : 'en-NG';
        try {
            return new Intl.NumberFormat(locale, {
                style: 'currency',
                currency,
                maximumFractionDigits: currency === 'GBP' ? 2 : 0
            }).format(Number(amount) || 0);
        } catch (_) {
            return `${currency} ${Number(amount || 0).toFixed(2)}`;
        }
    }

    function marketCurrency(region = window.RegionService?.region) {
        return ['uk', 'gb'].includes(String(region || '').toLowerCase()) ? 'GBP' : 'NGN';
    }

    async function getDeliveryPromise(productId, location, region) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(productId || ''))) {
            throw new Error('A valid item is required to estimate delivery timing.');
        }
        const market = String(region || '').toLowerCase();
        if (!['ng', 'uk'].includes(market)) throw new Error('Delivery timing is unavailable for this market.');

        const params = new URLSearchParams({
            productId: String(productId),
            location: String(location || ''),
            region: market
        });
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 8000);
        try {
            const apiFetch = window.VelveraAPI?.fetch || fetch;
            const response = await apiFetch(`/api/delivery/promise?${params}`, {
                signal: controller.signal,
                timeoutMs: 9000
            });
            if (!response.ok) throw new Error(`Delivery timing is unavailable (${response.status}).`);
            const data = await response.json();
            const earliest = new Date(data?.promise?.earliest);
            const latest = new Date(data?.promise?.latest);
            if (!Number.isFinite(earliest.getTime()) || !Number.isFinite(latest.getTime()) || earliest > latest) {
                throw new Error('The delivery estimate could not be validated.');
            }
            return { earliest, latest };
        } finally {
            window.clearTimeout(timeout);
        }
    }

    function formatDeliveryWindow(promises, region = window.RegionService?.region) {
        if (!Array.isArray(promises) || !promises.length) throw new Error('Delivery timing is unavailable.');
        const earliest = Math.max(...promises.map((item) => new Date(item.earliest).getTime()));
        const latest = Math.max(...promises.map((item) => new Date(item.latest).getTime()));
        if (!Number.isFinite(earliest) || !Number.isFinite(latest) || earliest > latest) {
            throw new Error('The delivery estimate could not be validated.');
        }
        const locale = String(region || '').toLowerCase() === 'uk' ? 'en-GB' : 'en-NG';
        const formatter = new Intl.DateTimeFormat(locale, {
            day: 'numeric',
            month: 'short',
            timeZone: 'UTC'
        });
        return `${formatter.format(earliest)}–${formatter.format(latest)}`;
    }

    function normalizeProviderQuote(provider, region = window.RegionService?.region) {
        const providerId = String(provider?.provider_id || '');
        const serviceAreaId = String(provider?.service_area_id || '');
        const fee = Number(provider?.total_fee_amount);
        const etaMin = Number(provider?.eta_min_minutes);
        const etaMax = Number(provider?.eta_max_minutes);
        const currency = String(provider?.currency_code || '');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(providerId)
            || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(serviceAreaId)
            || !Number.isFinite(fee) || fee < 0 || fee > 1000000
            || currency !== marketCurrency(region)
            || !Number.isInteger(etaMin) || etaMin < 1
            || !Number.isInteger(etaMax) || etaMax < etaMin || etaMax > 10080) {
            return null;
        }
        return { providerId, serviceAreaId, fee, currency, etaMin, etaMax };
    }

    async function geocodeAddress(query, countryCode) {
        const text = String(query || '').trim().slice(0, 180);
        if (text.length < 5 || !['NG', 'GB'].includes(countryCode)) {
            throw new Error('Enter a full address and select a supported market.');
        }
        const params = new URLSearchParams({
            q: text,
            format: 'jsonv2',
            limit: '1',
            countrycodes: countryCode.toLowerCase()
        });
        const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
            headers: { Accept: 'application/json' }
        });
        if (!response.ok) throw new Error('Address lookup is temporarily unavailable. You can place the map pin manually.');
        const results = await response.json();
        const location = results?.[0];
        if (!location || !Number.isFinite(Number(location.lat)) || !Number.isFinite(Number(location.lon))) {
            throw new Error('We could not locate that address. Try a nearby landmark or place the pin on the map.');
        }
        return {
            latitude: Number(location.lat),
            longitude: Number(location.lon),
            displayName: String(location.display_name || text).slice(0, 240)
        };
    }

    async function loadLeaflet() {
        if (window.L) return window.L;
        if (!window.__velveraLeafletPromise) {
            window.__velveraLeafletPromise = new Promise((resolve, reject) => {
                if (!document.querySelector('[data-leaflet-css]')) {
                    const link = document.createElement('link');
                    link.rel = 'stylesheet';
                    link.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css';
                    link.dataset.leafletCss = 'true';
                    document.head.append(link);
                }
                const script = document.createElement('script');
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js';
                script.async = true;
                script.onload = () => window.L ? resolve(window.L) : reject(new Error('Map library did not load.'));
                script.onerror = () => reject(new Error('Interactive maps are temporarily unavailable.'));
                document.head.append(script);
            });
        }
        return window.__velveraLeafletPromise;
    }

    async function createMap(element, initial, options = {}) {
        if (!element) throw new Error('Map container is missing.');
        const L = await loadLeaflet();
        const fallbackCenter = options.countryCode === 'GB' ? [54.5, -2.5] : [9.082, 8.6753];
        const start = initial && Number.isFinite(Number(initial.latitude)) && Number.isFinite(Number(initial.longitude))
            ? [Number(initial.latitude), Number(initial.longitude)]
            : fallbackCenter;
        const map = L.map(element, { scrollWheelZoom: false }).setView(start, initial ? 14 : 5);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>'
        }).addTo(map);
        let marker = initial ? L.marker(start, { draggable: options.draggable === true }).addTo(map) : null;
        const extraMarkers = [];
        if (marker && options.onSelect) {
            marker.on('dragend', () => {
                const point = marker.getLatLng();
                options.onSelect(point.lat, point.lng);
            });
        }
        if (options.draggable) {
            map.on('click', (event) => {
                if (!marker) marker = L.marker(event.latlng, { draggable: true }).addTo(map);
                else marker.setLatLng(event.latlng);
                marker.off('dragend');
                marker.on('dragend', () => {
                    const point = marker.getLatLng();
                    options.onSelect?.(point.lat, point.lng);
                });
                options.onSelect?.(event.latlng.lat, event.latlng.lng);
            });
        }
        return {
            map,
            setLocation(latitude, longitude, zoom = 14) {
                const point = [Number(latitude), Number(longitude)];
                if (marker) marker.setLatLng(point);
                else marker = L.marker(point, { draggable: options.draggable === true }).addTo(map);
                map.setView(point, zoom);
                if (options.draggable) marker.on('dragend', () => {
                    const selected = marker.getLatLng();
                    options.onSelect?.(selected.lat, selected.lng);
                });
            },
            clearLocation(countryCode = options.countryCode) {
                if (marker) map.removeLayer(marker);
                marker = null;
                map.setView(countryCode === 'GB' ? [54.5, -2.5] : [9.082, 8.6753], 5);
            },
            addMarker(latitude, longitude, label) {
                const point = [Number(latitude), Number(longitude)];
                const item = L.marker(point).addTo(map);
                if (label) item.bindPopup(escapeHtml(label));
                extraMarkers.push(item);
                return item;
            },
            clearMarkers() {
                extraMarkers.splice(0).forEach((item) => map.removeLayer(item));
            },
            fitMarkers(markers) {
                const points = markers.map((item) => [Number(item.latitude), Number(item.longitude)]);
                if (points.length) map.fitBounds(L.latLngBounds(points).pad(0.18), { maxZoom: 13 });
            },
            invalidateSize() { map.invalidateSize(); }
        };
    }

    async function rpc(name, args = {}) {
        const supabase = client();
        if (!supabase || !window.SupabaseClient?.isConfigured()) {
            throw new Error('Live location services are not configured.');
        }
        const { data, error } = await supabase.rpc(name, args);
        if (error) throw error;
        return data;
    }

    window.LogisticsService = Object.freeze({
        TABLES,
        client,
        marketCountry,
        escapeHtml,
        formatFee,
        marketCurrency,
        getDeliveryPromise,
        formatDeliveryWindow,
        normalizeProviderQuote,
        geocodeAddress,
        createMap,
        rpc
    });
})();
