(() => {
    let selectedProvider = null;
    let destination = null;
    let signedIn = false;
    let searchRevision = 0;
    const byId = (id) => document.getElementById(id);
    const service = () => window.LogisticsService;

    function notifySelectionChange() {
        document.dispatchEvent(new CustomEvent('checkout:delivery-selection-change'));
    }

    function setStatus(message, error = false) {
        const node = byId('deliveryProviderStatus');
        if (!node) return;
        node.textContent = message || '';
        node.classList.toggle('is-error', error);
    }

    function cartShopId() {
        const cart = window.CartService?.getCart?.() || [];
        const ids = [...new Set(cart.map((item) => item.product?.shop_id || item.shop_id).filter(Boolean).map(String))];
        return ids.length === 1 ? ids[0] : null;
    }

    async function loadMatches() {
        const revision = ++searchRevision;
        const shopId = cartShopId();
        const host = byId('deliveryProviderMatches');
        selectedProvider = null;
        destination = null;
        host.replaceChildren();
        if (byId('deliveryProviderQuote')) byId('deliveryProviderQuote').textContent = '';
        notifySelectionChange();
        if (!shopId) {
            setStatus('Provider selection is available for orders from one shop. This cart contains multiple shops or an item without a shop assignment.');
            return;
        }
        const address = [
            byId('address').value,
            byId('address2').value,
            byId('city').value,
            byId('state').value,
            byId('zip').value,
            byId('country').selectedOptions?.[0]?.textContent
        ].filter(Boolean).join(', ');
        if (address.length < 8 || byId('city').value.trim().length < 2) {
            setStatus('Complete your street address and city before searching for providers.', true);
            return;
        }
        const countryCode = byId('country').value;
        setStatus('Finding the delivery address and checking live provider availability…');
        host.innerHTML = '<p>Checking current coverage, availability, fees, and delivery estimates.</p>';
        try {
            const found = await service().geocodeAddress(address, countryCode);
            if (revision !== searchRevision) return;
            destination = found;
            const results = await service().rpc('get_available_delivery_providers_for_shop', {
                p_shop_id: shopId,
                p_destination_latitude: found.latitude,
                p_destination_longitude: found.longitude,
                p_country_code: countryCode,
                p_service_type: byId('deliveryServiceType').value,
                p_limit: 30
            });
            if (revision !== searchRevision) return;
            const providers = (Array.isArray(results) ? results : [])
                .map((provider) => ({ provider, quote: service().normalizeProviderQuote(provider) }))
                .filter((match) => match.quote);
            if (!providers.length) {
                host.innerHTML = '<p>No currently available provider with a valid fee and delivery window was found for both locations. You can continue and arrange delivery with the seller.</p>';
                setStatus('No valid live provider match. No rider was selected.');
                return;
            }
            host.innerHTML = providers.map(({ provider, quote }) => `
                <article class="logistics-result">
                    <header><strong>${service().escapeHtml(provider.display_name)}</strong><span class="logistics-badge">${provider.provider_type === 'independent_rider' ? 'Independent rider' : 'Logistics company'}</span></header>
                    <p>${service().escapeHtml(provider.vehicle_type)} · ${service().escapeHtml(provider.service_city)}, ${service().escapeHtml(provider.service_region)}</p>
                    <p>${service().escapeHtml(provider.distance_km)} km · ${service().formatFee(quote.fee, quote.currency)} estimated · ${quote.etaMin}–${quote.etaMax} minutes</p>
                    <p class="logistics-help">${service().escapeHtml(provider.description || 'Verified delivery provider.')}</p>
                    ${signedIn
                        ? `<button class="logistics-button logistics-button--secondary" type="button" data-select-provider="${service().escapeHtml(quote.providerId)}" data-service-area="${service().escapeHtml(quote.serviceAreaId)}" data-fee="${quote.fee}" data-currency="${quote.currency}" data-eta-min="${quote.etaMin}" data-eta-max="${quote.etaMax}" data-provider-name="${service().escapeHtml(provider.display_name)}">Choose this provider</button>`
                        : '<p class="logistics-help">Sign in to request this provider. Guests can continue with seller-arranged delivery.</p>'}
                </article>`).join('');
            setStatus(`Address found: ${found.displayName}. Provider availability is checked again when the order is created.`);
        } catch (error) {
            if (revision !== searchRevision) return;
            window.AsyncFeedback?.log('checkout-provider-match', window.AsyncFeedback?.createRequestId('delivery-match'), error);
            host.replaceChildren();
            const message = /function .* does not exist|pgrst202|schema cache/i.test(String(error?.message || ''))
                ? 'Provider matching is not installed yet. You can still place an order and arrange delivery with the seller.'
                : error.message || 'Available providers could not be checked. You can still arrange delivery with the seller.';
            setStatus(message, true);
        }
    }

    function chooseProvider(event) {
        const button = event.target.closest('[data-select-provider]');
        if (!button) return;
        const quote = service().normalizeProviderQuote({
            provider_id: button.dataset.selectProvider,
            service_area_id: button.dataset.serviceArea,
            total_fee_amount: button.dataset.fee,
            currency_code: button.dataset.currency,
            eta_min_minutes: button.dataset.etaMin,
            eta_max_minutes: button.dataset.etaMax
        });
        if (!quote || !destination) {
            setStatus('This provider estimate is no longer valid. Search again before selecting a provider.', true);
            return;
        }
        const providerCard = button.closest('.logistics-result');
        selectedProvider = {
            ...quote,
            providerName: button.dataset.providerName || 'Selected provider',
            shopId: cartShopId(),
            destination,
        };
        byId('deliveryProviderMatches').querySelectorAll('[data-select-provider]').forEach((item) => {
            item.classList.toggle('logistics-button--secondary', item !== button);
            item.textContent = item === button ? 'Selected for this order' : 'Choose this provider';
        });
        providerCard?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        byId('deliveryProviderQuote').textContent =
            `Selected provider estimate: ${service().formatFee(selectedProvider.fee, selectedProvider.currency)} · ${selectedProvider.etaMin}–${selectedProvider.etaMax} minutes. Price and availability are rechecked when you place the order.`;
        notifySelectionChange();
        setStatus('Provider estimate selected. The fee and availability are checked again when the request is submitted.');
    }

    async function requestProvider(orderId) {
        if (!selectedProvider) return { requested: false };
        const result = await service().rpc('buyer_request_order_delivery', {
            p_order_id: orderId,
            p_provider_id: selectedProvider.providerId,
            p_service_area_id: selectedProvider.serviceAreaId,
            p_destination_latitude: selectedProvider.destination.latitude,
            p_destination_longitude: selectedProvider.destination.longitude,
            p_service_type: byId('deliveryServiceType').value
        });
        return { requested: true, result };
    }

    function invalidateMatches() {
        searchRevision++;
        selectedProvider = null;
        destination = null;
        byId('deliveryProviderMatches')?.replaceChildren();
        if (byId('deliveryProviderQuote')) byId('deliveryProviderQuote').textContent = '';
        notifySelectionChange();
        setStatus('Address changed. Search again to check current provider coverage.');
    }

    async function initialize() {
        if (!byId('deliveryProviderPicker')) return;
        if (window.supabaseConfigReady) await window.supabaseConfigReady;
        const supabase = service().client();
        if (supabase) {
            const { data } = await supabase.auth.getUser();
            signedIn = Boolean(data?.user);
        }
        byId('findDeliveryProviders').addEventListener('click', loadMatches);
        byId('deliveryProviderMatches').addEventListener('click', chooseProvider);
        byId('deliveryServiceType').addEventListener('change', invalidateMatches);
        ['address', 'address2', 'city', 'zip'].forEach((id) => byId(id)?.addEventListener('input', invalidateMatches));
        ['state', 'country'].forEach((id) => {
            byId(id)?.addEventListener('input', invalidateMatches);
            byId(id)?.addEventListener('change', invalidateMatches);
        });
        window.CheckoutLogistics = Object.freeze({
            requestProvider,
            hasSelection: () => Boolean(selectedProvider && selectedProvider.shopId === cartShopId()),
            getSelectedProvider: () => selectedProvider && selectedProvider.shopId === cartShopId()
                ? { ...selectedProvider }
                : null
        });
        byId('deliveryProviderMatches').innerHTML = '<p>Enter your delivery address, then search to compare verified providers that are available now.</p>';
        setStatus(signedIn
            ? 'Provider selection is optional. Selected fees are estimates and are checked again when your order is placed.'
            : 'Sign in to request a provider. Guest checkout and seller-arranged delivery still work as before.');
    }

    document.addEventListener('DOMContentLoaded', () => initialize().catch((error) => {
        window.AsyncFeedback?.log('checkout-logistics-start', window.AsyncFeedback?.createRequestId('delivery-match'), error);
        setStatus('Provider matching could not start. You may still place an order with seller-arranged delivery.', true);
    }));
})();
