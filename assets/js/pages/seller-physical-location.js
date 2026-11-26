(() => {
    let shopId = null;
    let selectedPoint = null;
    let mapController = null;
    const byId = (id) => document.getElementById(id);

    function setStatus(message, error = false) {
        const status = byId('physicalStoreStatus');
        if (!status) return;
        status.textContent = message || '';
        status.classList.toggle('is-error', error);
        status.classList.toggle('is-success', Boolean(message) && !error);
    }

    function updateCoordinates(latitude, longitude) {
        selectedPoint = { latitude: Number(latitude), longitude: Number(longitude) };
        byId('physicalStoreCoordinates').textContent =
            `Selected pin: ${selectedPoint.latitude.toFixed(6)}, ${selectedPoint.longitude.toFixed(6)}.`;
    }

    async function initialize() {
        if (!byId('shopPhysicalLocationForm')) return;
        if (window.supabaseConfigReady) await window.supabaseConfigReady;
        if (window.AuthService) await window.AuthService.init();
        const context = await window.getSupabaseSellerContext?.();
        if (!context?.shop?.id || !context?.supabase) {
            byId('shopPhysicalLocationCard').hidden = true;
            return;
        }
        shopId = context.shop.id;
        byId('physicalStoreCountry').value = window.LogisticsService.marketCountry(
            /united kingdom|uk|gb/i.test(context.shop.country || '') ? 'uk' : window.RegionService?.region
        );
        byId('physicalStoreCity').value = context.shop.city || '';

        let saved = null;
        try {
            saved = await window.LogisticsService.rpc('shop_owner_get_physical_location', { p_shop_id: shopId });
        } catch (error) {
            window.AsyncFeedback?.log('seller-physical-location-load', window.AsyncFeedback?.createRequestId('seller-location'), error);
            setStatus('Location details are not available. Confirm the location database migration has been applied.', true);
        }
        if (saved) {
            byId('physicalStoreAddress').value = saved.address || '';
            byId('physicalStoreCity').value = saved.city || '';
            byId('physicalStoreRegion').value = saved.state_or_region || '';
            byId('physicalStorePostcode').value = saved.postcode || '';
            byId('physicalStoreCountry').value = saved.country_code || byId('physicalStoreCountry').value;
            selectedPoint = { latitude: Number(saved.latitude), longitude: Number(saved.longitude) };
            byId('physicalStoreCoordinates').textContent =
                `${saved.review_status === 'approved' ? 'Approved public pin' : `Review status: ${saved.review_status}`} · ${selectedPoint.latitude.toFixed(6)}, ${selectedPoint.longitude.toFixed(6)}. Saving a change sends it back for review.`;
        }

        try {
            mapController = await window.LogisticsService.createMap(byId('physicalStoreMap'), selectedPoint, {
                draggable: true,
                countryCode: byId('physicalStoreCountry').value,
                onSelect: updateCoordinates
            });
        } catch (error) {
            setStatus(error.message, true);
        }

        byId('physicalStoreFindAddress').addEventListener('click', async () => {
            const country = byId('physicalStoreCountry').value;
            const query = [
                byId('physicalStoreSearch').value,
                byId('physicalStoreAddress').value,
                byId('physicalStoreCity').value,
                byId('physicalStoreRegion').value,
                country === 'GB' ? 'United Kingdom' : 'Nigeria'
            ].filter(Boolean).join(', ');
            try {
                const result = await window.LogisticsService.geocodeAddress(query, country);
                selectedPoint = { latitude: result.latitude, longitude: result.longitude };
                mapController?.setLocation(result.latitude, result.longitude);
                setStatus(`Address found: ${result.displayName}. Confirm the pin is at your shop entrance.`);
            } catch (error) {
                setStatus(error.message, true);
            }
        });
        byId('shopPhysicalLocationForm').addEventListener('submit', async (event) => {
            event.preventDefault();
            const button = event.currentTarget.querySelector('button[type="submit"]');
            if (!selectedPoint) {
                setStatus('Search for the address or place the map pin at the physical shop before submitting.', true);
                return;
            }
            button.disabled = true;
            try {
                const result = await window.LogisticsService.rpc('shop_owner_save_physical_location', {
                    p_shop_id: shopId,
                    p_address: byId('physicalStoreAddress').value.trim(),
                    p_city: byId('physicalStoreCity').value.trim(),
                    p_state_or_region: byId('physicalStoreRegion').value.trim(),
                    p_postcode: byId('physicalStorePostcode').value.trim(),
                    p_country_code: byId('physicalStoreCountry').value,
                    p_latitude: selectedPoint.latitude,
                    p_longitude: selectedPoint.longitude
                });
                byId('physicalStoreCoordinates').textContent =
                    `Submitted at ${selectedPoint.latitude.toFixed(6)}, ${selectedPoint.longitude.toFixed(6)}.`;
                setStatus(`Physical location submitted for admin review (${result?.review_status || 'pending'}). The public map marker remains hidden until approval.`);
            } catch (error) {
                window.AsyncFeedback?.log('seller-physical-location-save', window.AsyncFeedback?.createRequestId('seller-location'), error);
                const message = /function .* does not exist|pgrst202/i.test(String(error?.message || ''))
                    ? 'The physical location workflow is not installed yet. Apply the location and logistics migrations.'
                    : error?.message || 'Location could not be submitted. Check the address and map pin.';
                setStatus(message, true);
            } finally {
                button.disabled = false;
            }
        });
    }

    document.addEventListener('DOMContentLoaded', () => initialize().catch((error) => {
        window.AsyncFeedback?.log('seller-physical-location-start', window.AsyncFeedback?.createRequestId('seller-location'), error);
        setStatus('Physical store location settings could not be loaded. Refresh and try again.', true);
    }));
})();
