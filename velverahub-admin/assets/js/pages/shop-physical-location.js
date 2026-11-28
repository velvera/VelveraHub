(() => {
    let latestShopId = null;
    let requestNumber = 0;

    async function loadPhysicalLocation(shopId) {
        const card = document.getElementById('publicShopLocation');
        if (!card || !shopId) return;
        const currentRequest = ++requestNumber;
        try {
            if (window.supabaseConfigReady) await window.supabaseConfigReady;
            const location = await window.LogisticsService.rpc('get_public_shop_physical_location', {
                p_shop_id: shopId
            });
            if (currentRequest !== requestNumber || !location) {
                if (currentRequest === requestNumber) card.classList.add('logistics-hidden');
                return;
            }
            document.getElementById('publicShopAddress').textContent = [
                location.address,
                location.city,
                location.state_or_region,
                location.postcode,
                location.country_code === 'GB' ? 'United Kingdom' : 'Nigeria'
            ].filter(Boolean).join(', ');
            const destination = `${Number(location.latitude)},${Number(location.longitude)}`;
            const directions = document.getElementById('publicShopDirections');
            directions.href = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
            card.classList.remove('logistics-hidden');
            await window.LogisticsService.createMap(document.getElementById('publicShopMap'), {
                latitude: location.latitude,
                longitude: location.longitude
            });
        } catch (error) {
            window.AsyncFeedback?.log('public-shop-physical-location', window.AsyncFeedback?.createRequestId('shop-location'), error);
            card.classList.add('logistics-hidden');
        }
    }

    window.addEventListener('velveraShopLoaded', (event) => {
        latestShopId = event.detail?.shopId;
        loadPhysicalLocation(latestShopId);
    });
})();
