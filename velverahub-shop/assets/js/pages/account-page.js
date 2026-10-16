(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);

    function displayName(profile, user) {
        const name = [
            profile?.first_name || profile?.firstName,
            profile?.last_name || profile?.lastName
        ].filter(Boolean).join(' ');
        return name || profile?.display_name || user?.user_metadata?.full_name ||
            user?.email?.split('@')[0] || 'VelveraHub shopper';
    }

    function setText(id, value) {
        const node = $(id);
        if (node) node.textContent = value || 'Not added yet';
    }

    function renderAuthenticated(user, profile) {
        const name = displayName(profile, user);
        setText('accountName', name);
        setText('accountEmail', user?.email || profile?.email);
        setText('accountRole', profile?.role === 'seller'
            ? 'Seller account'
            : 'Customer account · Seller access enabled');
        const initial = $('accountInitial');
        if (initial) initial.textContent = name.charAt(0).toUpperCase();

        const avatarUrl = profile?.avatar_url || user?.user_metadata?.avatar_url;
        const avatar = $('accountAvatar');
        if (avatar && avatarUrl) {
            const displayName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || user?.email || 'Account profile';
            avatar.innerHTML = `<img src="${String(avatarUrl).replace(/"/g, '&quot;')}" alt="${String(displayName).replace(/"/g, '&quot;')} profile photo">`;
        }

        $('accountGuest')?.setAttribute('hidden', '');
        $('accountDashboard')?.removeAttribute('hidden');
    }

    function renderGuest() {
        $('accountDashboard')?.setAttribute('hidden', '');
        $('accountGuest')?.removeAttribute('hidden');
    }

    function businessRegionLabel(value) {
        const region = String(value || '').trim();
        if (!region) return '';
        const service = window.RegionService;
        if (service?.getUKRegions?.().includes(region)) return `${region}, United Kingdom`;
        if (service?.getNigerianStates?.().includes(region)) return `${region}, Nigeria`;
        return region;
    }

    function renderAccountRegion(value) {
        const node = $('accountRegion');
        if (node) node.textContent = value || 'Not provided';
    }

    async function loadAccountRegion(user, profile) {
        const supabase = window.SupabaseClient?.get();
        const ownerIds = [...new Set([user?.id, profile?.id].filter(Boolean))];
        const ownerFilters = ownerIds.flatMap((id) => [
            `owner_id.eq.${id}`,
            `current_owner_id.eq.${id}`
        ]).join(',');

        if (supabase && ownerFilters) {
            try {
                const { data, error } = await supabase.from('shops')
                    .select('city,country,service_location,updated_at')
                    .or(ownerFilters)
                    .order('updated_at', { ascending: false })
                    .limit(10);
                if (error) throw error;
                const shop = (data || []).find((item) => item.country || item.city || item.service_location);
                if (shop) {
                    const locality = String(shop.service_location || shop.city || '').trim();
                    const country = String(shop.country || '').trim();
                    const label = [locality, country].filter(Boolean).join(', ');
                    if (label) {
                        renderAccountRegion(label);
                        return;
                    }
                }
            } catch (error) {
                window.AsyncFeedback?.log(
                    'account-region',
                    window.AsyncFeedback?.createRequestId('account-region'),
                    error
                );
            }
        }

        const savedBusinessRegion = businessRegionLabel(profile?.business_state || profile?.businessState);
        if (savedBusinessRegion) {
            renderAccountRegion(savedBusinessRegion);
            return;
        }
        const selectedLocation = window.RegionService?.location;
        if (selectedLocation && selectedLocation !== 'all') {
            renderAccountRegion(businessRegionLabel(selectedLocation) || selectedLocation);
            return;
        }
        renderAccountRegion(window.RegionService?.countryName || 'Not provided');
    }

    function appendSellerAlert(container, request) {
        const status = String(request.status || 'pending').toLowerCase();
        const item = document.createElement('article');
        item.className = `account-alert-item ${status === 'rejected' ? 'is-attention' : 'is-pending'}`;

        const icon = document.createElement('span');
        icon.className = 'account-alert-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = `<i class="fas ${status === 'rejected' ? 'fa-circle-exclamation' : 'fa-clock'}"></i>`;

        const copy = document.createElement('div');
        copy.className = 'account-alert-copy';
        const heading = document.createElement('strong');
        heading.textContent = status === 'rejected' ? 'Promotion needs attention' : 'Promotion under review';
        const detail = document.createElement('p');
        const title = String(request.product_title || 'Your listing');
        detail.textContent = status === 'rejected'
            ? `${title} was declined.${request.review_note ? ` ${String(request.review_note)}` : ''}`
            : `${title} is waiting for an admin review.`;
        copy.append(heading, detail);

        const link = document.createElement('a');
        const productId = String(request.product_id || '');
        link.href = status === 'rejected' && productId
            ? `/veeve/seller.html?edit=${encodeURIComponent(productId)}`
            : '/veeve/seller.html?view=notifications';
        link.textContent = status === 'rejected' ? 'Review listing' : 'View status';
        item.append(icon, copy, link);
        container.appendChild(item);
    }

    function appendListingModerationAlert(container, product) {
        const status = String(product.moderation_status || 'pending').toLowerCase();
        const item = document.createElement('article');
        item.className = `account-alert-item ${status === 'rejected' ? 'is-attention' : 'is-pending'}`;

        const icon = document.createElement('span');
        icon.className = 'account-alert-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = `<i class="fas ${status === 'rejected' ? 'fa-circle-exclamation' : status === 'approved' ? 'fa-circle-check' : 'fa-clock'}"></i>`;

        const copy = document.createElement('div');
        copy.className = 'account-alert-copy';
        const heading = document.createElement('strong');
        heading.textContent = status === 'rejected'
            ? 'Listing declined'
            : status === 'approved' ? 'Listing approved' : 'Listing under review';
        const detail = document.createElement('p');
        detail.textContent = status === 'rejected'
            ? `${product.title || 'Your listing'} needs a change before it can be published. ${product.moderation_note || 'Open the listing to review and correct it.'}`
            : status === 'approved'
                ? `${product.title || 'Your listing'} passed listing review.`
                : `${product.title || 'Your listing'} is waiting for an admin review.`;
        copy.append(heading, detail);

        const link = document.createElement('a');
        const productId = String(product.id || '');
        link.href = status === 'rejected' && productId
            ? `/veeve/seller.html?edit=${encodeURIComponent(productId)}`
            : '/veeve/seller.html?view=notifications';
        link.textContent = status === 'rejected' ? 'Edit and resubmit' : 'View listing updates';
        item.append(icon, copy, link);
        container.appendChild(item);
    }

    async function loadSellerAlerts(profile) {
        const section = $('accountAlerts');
        const list = $('accountAlertList');
        if (!section || !list) return;
        try {
            const supabase = window.SupabaseClient?.get();
            if (!supabase) throw new Error('Seller data is not available');
            const { data: { user }, error: userError } = await supabase.auth.getUser();
            if (userError) throw userError;
            if (!user) return;
            const ownerIds = [...new Set([user.id, profile?.id].filter(Boolean))];
            const ownerFilters = ownerIds.flatMap((id) => [
                `owner_id.eq.${id}`,
                `current_owner_id.eq.${id}`
            ]).join(',');
            const [independentResult, shopsResult] = await Promise.all([
                supabase.from('products')
                    .select('id,title,moderation_status,moderation_note,moderated_at,updated_at')
                    .in('seller_id', ownerIds)
                    .is('shop_id', null)
                    .order('updated_at', { ascending: false })
                    .limit(100),
                ownerFilters
                    ? supabase.from('shops').select('id').or(ownerFilters).limit(100)
                    : Promise.resolve({ data: [], error: null })
            ]);
            if (independentResult.error) throw independentResult.error;
            if (shopsResult.error) throw shopsResult.error;
            const shopIds = [...new Set((shopsResult.data || []).map((shop) => shop.id).filter(Boolean))];
            const shopProductsResult = shopIds.length
                ? await supabase.from('products')
                    .select('id,title,moderation_status,moderation_note,moderated_at,updated_at')
                    .in('shop_id', shopIds)
                    .order('updated_at', { ascending: false })
                    .limit(100)
                : { data: [], error: null };
            if (shopProductsResult.error) throw shopProductsResult.error;
            const listings = new Map();
            [...(independentResult.data || []), ...(shopProductsResult.data || [])]
                .forEach((product) => listings.set(String(product.id), product));
            const listingAlerts = [...listings.values()]
                .filter((product) => ['pending', 'rejected'].includes(String(product.moderation_status || '').toLowerCase()) ||
                    (String(product.moderation_status || '').toLowerCase() === 'approved' && product.moderated_at))
                .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0))
                .slice(0, 8);

            const isSeller = ['seller', 'admin'].includes(String(profile?.role || '').toLowerCase());
            let promotionAlerts = [];
            let promotionError = null;
            if (isSeller) {
                const result = await supabase.rpc('seller_list_advertisements');
                if (result.error) promotionError = result.error;
                else {
                    promotionAlerts = (Array.isArray(result.data) ? result.data : [])
                .filter((request) => ['pending', 'rejected'].includes(String(request.status || '').toLowerCase()))
                .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
                .slice(0, 4);
                }
            }
            if (!isSeller && !listingAlerts.length) return;
            section.hidden = false;
            list.replaceChildren();
            listingAlerts.forEach((product) => appendListingModerationAlert(list, product));
            promotionAlerts.forEach((request) => appendSellerAlert(list, request));
            const count = $('accountAlertCount');
            const alertCount = listingAlerts.length + promotionAlerts.length;
            if (count) {
                count.textContent = String(alertCount);
                count.hidden = alertCount === 0;
            }
            if (!alertCount) {
                const empty = document.createElement('p');
                empty.className = 'account-alert-empty';
                empty.textContent = promotionError
                    ? 'Promotion decisions are temporarily unavailable. Open Listing updates in the seller workspace to retry.'
                    : 'No listing or promotion decisions need attention right now.';
                list.appendChild(empty);
            }
            if (promotionError && alertCount) {
                const warning = document.createElement('p');
                warning.className = 'account-alert-empty';
                warning.textContent = 'Promotion decisions are temporarily unavailable; listing moderation updates are shown separately.';
                list.appendChild(warning);
            }
        } catch (error) {
            section.hidden = false;
            list.replaceChildren();
            const message = document.createElement('p');
            message.className = 'account-alert-empty';
            message.textContent = 'Listing updates are temporarily unavailable. Open the seller workspace to retry.';
            list.appendChild(message);
        }
    }

    async function init() {
        if (!window.AuthService) {
            renderGuest();
            return;
        }
        const requestId = window.AsyncFeedback?.createRequestId('account') || `account-${Date.now()}`;
        try {
            await window.AuthService.init();
            if (window.AuthService.isLoggedIn()) {
                const profile = window.AuthService.getProfile();
                const user = window.AuthService.getUser();
                renderAuthenticated(user, profile);
                await Promise.all([
                    loadSellerAlerts(profile),
                    loadAccountRegion(user, profile)
                ]);
            } else {
                renderGuest();
            }
        } catch (error) {
            window.AsyncFeedback?.log('account', requestId, error);
            const main = document.querySelector('.account-page-main');
            if (main && window.AsyncFeedback) {
                AsyncFeedback.render(main, 'error', {
                    errorTitle: 'Account temporarily unavailable',
                    errorMessage: 'We could not restore your account session. Try again.',
                    onRetry: () => window.location.reload()
                });
            } else {
                renderGuest();
            }
        }
    }

    document.addEventListener('click', async (event) => {
        if (!event.target.closest('[data-account-signout]')) return;
        event.preventDefault();
        await window.AuthService?.signOut?.();
        window.location.reload();
    });

    document.addEventListener('DOMContentLoaded', init);
})();