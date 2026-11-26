(() => {
    let mapController = null;
    let userPoint = null;
    let requestNumber = 0;
    const byId = (id) => document.getElementById(id);

    function setStatus(message, error = false) {
        const node = byId('shopDiscoveryStatus');
        node.textContent = message || '';
        node.classList.toggle('is-error', error);
    }

    function renderResults(shops, point) {
        const host = byId('shopDiscoveryResults');
        if (!shops.length) {
            host.innerHTML = '<p>No approved physical shop locations matched that search. Shops without verified locations are not placed on the map.</p>';
            return;
        }
        host.innerHTML = shops.map((shop) => {
            const shopHref = `/pages/shop.html?id=${encodeURIComponent(shop.shop_slug || shop.shop_id)}`;
            const directions = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${shop.latitude},${shop.longitude}`)}`;
            const distance = Number.isFinite(Number(shop.distance_km)) ? `${Number(shop.distance_km).toFixed(1)} km away · ` : '';
            return `<article class="logistics-result">
                <header><strong>${window.LogisticsService.escapeHtml(shop.shop_name)}</strong><span class="logistics-badge">${distance}Approved location</span></header>
                <p>${window.LogisticsService.escapeHtml([shop.address, shop.city, shop.state_or_region, shop.postcode].filter(Boolean).join(', '))}</p>
                <p>${window.LogisticsService.escapeHtml(shop.description || '')}</p>
                <div class="logistics-actions"><a class="logistics-directions" href="${shopHref}">View shop</a><a class="logistics-directions" href="${directions}" target="_blank" rel="noopener noreferrer">Directions</a></div>
            </article>`;
        }).join('');
        mapController?.clearMarkers();
        shops.forEach((shop) => {
            const marker = mapController?.addMarker(shop.latitude, shop.longitude, shop.shop_name);
            if (marker) {
                const name = window.LogisticsService.escapeHtml(shop.shop_name);
                const url = `/pages/shop.html?id=${encodeURIComponent(shop.shop_slug || shop.shop_id)}`;
                marker.bindPopup(`<strong>${name}</strong><br><a href="${url}">View shop</a>`);
            }
        });
        if (!point) mapController?.fitMarkers(shops);
    }

    async function searchShops(event) {
        event?.preventDefault();
        const current = ++requestNumber;
        const query = byId('shopDiscoveryQuery').value.trim();
        const countryCode = window.LogisticsService.marketCountry();
        if (query.length < 2 && !userPoint) {
            setStatus('Enter a shop name or city, or choose “Use my location”.', true);
            return;
        }
        setStatus('Searching approved shop locations…');
        byId('shopDiscoveryResults').innerHTML = '<p>Checking current verified store addresses.</p>';
        try {
            const shops = await window.LogisticsService.rpc('search_public_shop_physical_locations', {
                p_country_code: countryCode,
                p_query: query,
                p_latitude: userPoint?.latitude ?? null,
                p_longitude: userPoint?.longitude ?? null,
                p_radius_km: 25,
                p_limit: 30
            });
            if (current !== requestNumber) return;
            renderResults(Array.isArray(shops) ? shops : [], userPoint);
            setStatus(shops?.length
                ? `${shops.length} approved physical shop${shops.length === 1 ? '' : 's'} found.`
                : 'No approved physical shop locations matched your search.');
        } catch (error) {
            if (current !== requestNumber) return;
            window.AsyncFeedback?.log('shop-discovery', window.AsyncFeedback?.createRequestId('shop-discovery'), error);
            byId('shopDiscoveryResults').replaceChildren();
            setStatus(/function .* does not exist|pgrst202|schema cache/i.test(String(error?.message || ''))
                ? 'Physical store maps are not enabled yet. The location and logistics migrations need to be applied.'
                : 'Store locations could not be loaded. Check your connection and try again.', true);
        }
    }

    function useMyLocation() {
        if (!navigator.geolocation) {
            setStatus('Location access is not available in this browser. Search by shop, city, or area instead.', true);
            return;
        }
        setStatus('Waiting for your location permission…');
        navigator.geolocation.getCurrentPosition((position) => {
            userPoint = {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude
            };
            mapController?.setLocation(userPoint.latitude, userPoint.longitude, 12);
            searchShops();
        }, (error) => {
            const reason = error.code === error.PERMISSION_DENIED
                ? 'Location permission was not granted. You can still search by shop name or city.'
                : 'Your location could not be determined. Search by shop name or city instead.';
            setStatus(reason, true);
        }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 });
    }

    async function initialize() {
        if (window.supabaseConfigReady) await window.supabaseConfigReady;
        const countryCode = window.LogisticsService.marketCountry();
        try {
            mapController = await window.LogisticsService.createMap(byId('shopDiscoveryMap'), null, { countryCode });
        } catch (error) {
            setStatus(error.message, true);
        }
        byId('shopDiscoveryForm').addEventListener('submit', searchShops);
        byId('shopDiscoveryNearMe').addEventListener('click', useMyLocation);
    }

    document.addEventListener('DOMContentLoaded', () => initialize().catch((error) => {
        window.AsyncFeedback?.log('shop-discovery-start', window.AsyncFeedback?.createRequestId('shop-discovery'), error);
        setStatus('Shop map search could not start. Try refreshing the page.', true);
    }));
})();
