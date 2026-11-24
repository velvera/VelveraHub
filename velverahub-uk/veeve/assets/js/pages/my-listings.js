(function () {
    'use strict';

    const STATUS_LABELS = {
        active: 'Live',
        draft: 'Draft',
        inactive: 'Paused',
        out_of_stock: 'Out of stock'
    };
    const STATUS_NOTES = {
        active: 'Visible to nearby buyers',
        draft: 'Not visible to buyers',
        inactive: 'Hidden until resumed',
        out_of_stock: 'Update availability to relist'
    };
    const FILTERS = ['all', 'active', 'draft', 'inactive', 'out_of_stock'];
    const ICONS = {
        electronics: 'fa-mobile-screen-button',
        fashion: 'fa-shirt',
        home: 'fa-house',
        books: 'fa-book-open',
        services: 'fa-screwdriver-wrench',
        beauty: 'fa-wand-magic-sparkles',
        sports: 'fa-futbol',
        other: 'fa-box'
    };
    const state = {
        user: null,
        ownerIds: [],
        listings: [],
        statusFilter: 'all',
        search: '',
        loading: false,
        toastTimer: null
    };

    const $ = (id) => document.getElementById(id);
    const viewIds = ['mlLoading', 'mlSignIn', 'mlError', 'mlEmpty', 'mlNoMatches', 'mlListingList'];

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (character) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[character]);
    }

    function setVisible(id, visible) {
        const element = $(id);
        if (element) element.hidden = !visible;
    }

    function showView(viewId) {
        viewIds.forEach((id) => setVisible(id, id === viewId));
        const searchWrap = document.querySelector('.ml-search-wrap');
        const filters = $('mlFilters');
        const resultSummary = $('mlResultSummary');
        const controlsVisible = viewId !== 'mlSignIn' && viewId !== 'mlError' && viewId !== 'mlLoading';
        if (searchWrap) searchWrap.hidden = !controlsVisible;
        if (filters) filters.hidden = !controlsVisible;
        if (resultSummary) resultSummary.hidden = !controlsVisible;
    }

    function formatPrice(value) {
        if (window.RegionService?.formatPrice) return window.RegionService.formatPrice(value);
        return String(value ?? '');
    }

    function safeImageUrl(value) {
        if (!value) return '';
        try {
            const parsed = new URL(String(value), window.location.origin);
            return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : '';
        } catch (_) {
            return '';
        }
    }

    function primaryImage(product) {
        const images = Array.isArray(product.product_images) ? product.product_images.slice() : [];
        images.sort((first, second) => {
            const primaryDifference = Number(Boolean(second.is_primary)) - Number(Boolean(first.is_primary));
            return primaryDifference || Number(first.display_order || 0) - Number(second.display_order || 0);
        });
        return safeImageUrl(images[0]?.url);
    }

    function listingLocation(product) {
        return [product.campus_area, product.location].filter(Boolean).join(' · ');
    }

    function formatDate(value) {
        if (!value) return '';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        const locale = window.RegionService?.region === 'uk' ? 'en-GB' : 'en-NG';
        return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
    }

    function listingEditUrl(product) {
        return `/pages/seller.html?view=products&edit=${encodeURIComponent(product.id)}`;
    }

    function renderCard(product, index) {
        const status = STATUS_LABELS[product.status] ? product.status : 'draft';
        const moderationStatus = ['pending', 'approved', 'rejected'].includes(String(product.moderation_status || '').toLowerCase())
            ? String(product.moderation_status).toLowerCase()
            : 'approved';
        const statusText = STATUS_LABELS[status];
        const image = primaryImage(product);
        const categoryKey = String(product.category || '').toLowerCase();
        const icon = ICONS[categoryKey] || ICONS.other;
        const location = listingLocation(product);
        const date = formatDate(product.updated_at || product.created_at);
        const price = formatPrice(product.price);
        const editUrl = listingEditUrl(product);
        const title = escapeHtml(product.title || 'Untitled listing');
        const category = escapeHtml(product.category || 'Other');
        const imageAlt = `${product.title || 'Listing'} listing photo`;
        let statusAction = '';

        if (status === 'active') {
            statusAction = `<button class="ml-action-button ml-action-button--pause" type="button" data-listing-action="pause" data-product-id="${escapeHtml(product.id)}" aria-label="Pause ${title}"><i class="fas fa-pause" aria-hidden="true"></i> Pause</button>`;
        } else if (status === 'inactive') {
            statusAction = `<button class="ml-action-button ml-action-button--resume" type="button" data-listing-action="resume" data-product-id="${escapeHtml(product.id)}" aria-label="Resume ${title}"><i class="fas fa-play" aria-hidden="true"></i> Resume</button>`;
        }

        const editLabel = moderationStatus === 'rejected'
            ? 'Edit and resubmit'
            : status === 'draft' ? 'Edit draft' : status === 'out_of_stock' ? 'Update stock' : 'Edit';
        const editIcon = status === 'draft' ? 'fa-pen-to-square' : 'fa-arrow-up-right-from-square';
        return `
            <article class="ml-card" style="animation-delay:${Math.min(index * 35, 175)}ms">
                <div class="ml-thumb" aria-hidden="true">
                    <i class="fas ${icon}"></i>
                    ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(imageAlt)}" loading="lazy">` : ''}
                </div>
                <div class="ml-card-main">
                    <div class="ml-card-title-row">
                        <span class="ml-card-title">${title}</span>
                    </div>
                    <div class="ml-card-meta">
                        <span>${category}</span>
                        ${price ? `<span class="ml-price">${escapeHtml(price)}</span>` : ''}
                        ${location ? `<span><i class="fas fa-location-dot" aria-hidden="true"></i>${escapeHtml(location)}</span>` : ''}
                        ${product.stock != null ? `<span>${escapeHtml(String(product.stock))} available</span>` : ''}
                    </div>
                    ${date ? `<time class="ml-card-date" datetime="${escapeHtml(product.updated_at || product.created_at)}">Updated ${escapeHtml(date)}</time>` : ''}
                </div>
                <div class="ml-status-column">
                    <span class="ml-status ml-status-${escapeHtml(status)}">${escapeHtml(statusText)}</span>
                    <p class="ml-status-note">${escapeHtml(
                        moderationStatus === 'rejected'
                            ? 'Hidden until you edit and resubmit'
                            : moderationStatus === 'pending'
                                ? 'Visibility paused until listing review is approved'
                                : STATUS_NOTES[status]
                    )}</p>
                    ${moderationStatus === 'rejected'
                        ? `<div class="ml-moderation ml-moderation-rejected"><strong>Changes requested</strong><p>${escapeHtml(product.moderation_note || 'The admin requested a change to this listing.')}</p></div>`
                        : moderationStatus === 'pending'
                            ? '<div class="ml-moderation ml-moderation-pending"><strong>Awaiting listing review</strong><p>Buyers can see this listing after it is approved.</p></div>'
                            : product.moderated_at
                                ? '<div class="ml-moderation ml-moderation-approved"><strong>Listing approved</strong></div>'
                                : ''}
                </div>
                <div class="ml-actions">
                    <a class="ml-action-link" href="${escapeHtml(editUrl)}" aria-label="${editLabel} ${title}"><i class="fas ${editIcon}" aria-hidden="true"></i> ${editLabel}</a>
                    ${statusAction}
                </div>
            </article>`;
    }

    function updateCounters() {
        const counts = {
            all: state.listings.length,
            active: 0,
            draft: 0,
            inactive: 0,
            out_of_stock: 0
        };
        state.listings.forEach((listing) => {
            if (Object.hasOwn(counts, listing.status)) counts[listing.status] += 1;
        });
        $('mlCountAll').textContent = String(counts.all);
        $('mlCountActive').textContent = String(counts.active);
        $('mlCountDraft').textContent = String(counts.draft);
        FILTERS.forEach((filter) => {
            const count = document.querySelector(`[data-filter-count="${filter}"]`);
            if (count) count.textContent = String(counts[filter]);
        });
    }

    function filteredListings() {
        const search = state.search.trim().toLocaleLowerCase();
        return state.listings.filter((listing) => {
            if (state.statusFilter !== 'all' && listing.status !== state.statusFilter) return false;
            if (!search) return true;
            const searchable = [
                listing.title,
                listing.category,
                listing.campus_area,
                listing.location,
                listing.school_name,
            ].filter(Boolean).join(' ').toLocaleLowerCase();
            return searchable.includes(search);
        });
    }

    function renderResults() {
        updateCounters();
        if (!state.listings.length) {
            $('mlResultSummary').textContent = '0 listings';
            showView('mlEmpty');
            return;
        }

        const results = filteredListings();
        if (!results.length) {
            $('mlResultSummary').textContent = 'No results';
            showView('mlNoMatches');
            return;
        }

        const countLabel = `${results.length} ${results.length === 1 ? 'listing' : 'listings'}`;
        const isFiltered = state.statusFilter !== 'all' || Boolean(state.search.trim());
        $('mlResultSummary').textContent = isFiltered
            ? `Showing ${countLabel} · ${state.listings.length} total`
            : `${countLabel} · newest updated first`;
        $('mlListingList').innerHTML = results.map(renderCard).join('');
        showView('mlListingList');
    }

    function showFeedback(message, kind) {
        const feedback = $('mlFeedback');
        if (!feedback) return;
        window.clearTimeout(state.toastTimer);
        feedback.textContent = message;
        feedback.dataset.kind = kind || 'info';
        feedback.hidden = false;
        state.toastTimer = window.setTimeout(() => {
            feedback.hidden = true;
            feedback.textContent = '';
        }, 4600);
    }

    function setLoading(isLoading) {
        state.loading = isLoading;
        $('mlRetry').disabled = isLoading;
        $('mlRetry').innerHTML = isLoading
            ? '<i class="fas fa-rotate-right" aria-hidden="true"></i> Loading…'
            : '<i class="fas fa-rotate-right" aria-hidden="true"></i> Try again';
    }

    function queryOwnerIds() {
        const user = window.AuthService?.getUser();
        const profile = window.AuthService?.getProfile();
        state.user = user || null;
        state.ownerIds = [...new Set([user?.id, profile?.id].filter((id) => typeof id === 'string' && id.trim()))];
        return state.ownerIds;
    }

    async function loadListings() {
        if (state.loading) return;
        const ownerIds = queryOwnerIds();
        if (!state.user) {
            showView('mlSignIn');
            return;
        }
        if (!ownerIds.length) {
            $('mlErrorMessage').textContent = 'Your account could not be identified. Please sign in again.';
            showView('mlError');
            return;
        }

        const supabase = window.SupabaseClient?.get();
        if (!supabase || !window.SupabaseClient?.isConfigured()) {
            $('mlErrorMessage').textContent = 'The marketplace connection is not ready. Try again in a moment.';
            showView('mlError');
            return;
        }

        setLoading(true);
        showView('mlLoading');
        $('mlResultSummary').textContent = 'Loading your listings…';
        try {
            const { data, error } = await supabase
                .from('products')
                .select('id,seller_id,shop_id,title,category,condition,price,stock,status,moderation_status,moderation_note,moderated_at,location,campus_area,school_name,created_at,updated_at,view_count,sales_count,ad_status,is_priority_ad,product_images(url,is_primary,display_order)')
                .in('seller_id', ownerIds)
                .is('shop_id', null)
                .order('updated_at', { ascending: false, nullsFirst: false });
            if (error) throw error;
            state.listings = Array.isArray(data) ? data : [];
            await window.ProductsService?.resolvePrivateProductMedia(state.listings);
            state.listings = state.listings.filter((listing) =>
                ownerIds.includes(listing.seller_id) &&
                listing.shop_id == null
            );
            state.listings.sort((first, second) =>
                new Date(second.updated_at || second.created_at || 0).getTime() -
                new Date(first.updated_at || first.created_at || 0).getTime()
            );
            renderResults();
        } catch (error) {
            window.AsyncFeedback?.log('my-listings-load', window.AsyncFeedback?.createRequestId('my-listings-load'), error);
            $('mlErrorMessage').textContent = 'Check your connection and try again. Your listings have not been changed.';
            $('mlResultSummary').textContent = 'Listings unavailable';
            showView('mlError');
        } finally {
            setLoading(false);
        }
    }

    async function changeStatus(button) {
        if (button.disabled || !state.user) return;
        const productId = button.dataset.productId;
        const targetStatus = button.dataset.listingAction === 'pause' ? 'inactive' :
            button.dataset.listingAction === 'resume' ? 'active' : '';
        if (!productId || !['active', 'inactive'].includes(targetStatus)) return;
        const product = state.listings.find((listing) => String(listing.id) === String(productId));
        const expectedStatus = targetStatus === 'inactive' ? 'active' : 'inactive';
        if (!product || product.status !== expectedStatus) return;

        const supabase = window.SupabaseClient?.get();
        if (!supabase || !window.SupabaseClient?.isConfigured()) {
            const error = new Error('Listing service is not configured.');
            window.AsyncFeedback?.log('my-listings-config', window.AsyncFeedback?.createRequestId('my-listings-config'), error);
            showFeedback('The marketplace connection is not ready. Try again.', 'error');
            return;
        }

        const originalText = button.innerHTML;
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        button.innerHTML = '<i class="fas fa-rotate-right" aria-hidden="true"></i> Saving';
        try {
            const { data, error } = await supabase
                .from('products')
                .update({ status: targetStatus })
                .eq('id', productId)
                .in('seller_id', state.ownerIds)
                .is('shop_id', null)
                .eq('status', expectedStatus)
                .select('id,status')
                .maybeSingle();
            if (error) throw error;
            if (!data?.id || data.status !== targetStatus) {
                throw new Error('This listing could not be updated. Refresh and try again.');
            }

            product.status = targetStatus;
            renderResults();
            showFeedback(targetStatus === 'inactive'
                ? 'Listing paused. It is now hidden from buyers.'
                : 'Listing resumed. It is visible to buyers again.', 'success');
        } catch (error) {
            window.AsyncFeedback?.log('my-listings-status', window.AsyncFeedback?.createRequestId('my-listings-status'), error);
            button.disabled = false;
            button.removeAttribute('aria-busy');
            button.innerHTML = originalText;
            showFeedback(error?.message === 'This listing could not be updated. Refresh and try again.'
                ? error.message
                : 'We could not update that listing. Please try again.', 'error');
        }
    }

    function bindEvents() {
        $('mlFilters').addEventListener('click', (event) => {
            const button = event.target.closest('[data-status-filter]');
            if (!button) return;
            state.statusFilter = FILTERS.includes(button.dataset.statusFilter) ? button.dataset.statusFilter : 'all';
            $('mlFilters').querySelectorAll('[data-status-filter]').forEach((filter) => {
                filter.setAttribute('aria-pressed', String(filter === button));
            });
            renderResults();
        });

        $('mlSearch').addEventListener('input', (event) => {
            state.search = event.target.value || '';
            if (state.listings.length) renderResults();
        });

        $('mlRetry').addEventListener('click', () => loadListings());
        $('mlClearSearch').addEventListener('click', () => {
            state.statusFilter = 'all';
            state.search = '';
            $('mlSearch').value = '';
            $('mlFilters').querySelectorAll('[data-status-filter]').forEach((button) => {
                button.setAttribute('aria-pressed', String(button.dataset.statusFilter === 'all'));
            });
            renderResults();
            $('mlSearch').focus();
        });

        $('mlListingList').addEventListener('click', (event) => {
            const button = event.target.closest('[data-listing-action]');
            if (button) changeStatus(button);
        });
        $('mlListingList').addEventListener('error', (event) => {
            if (event.target instanceof HTMLImageElement && event.target.closest('.ml-thumb')) {
                event.target.hidden = true;
            }
        }, true);
    }

    function setMobileAccountActive() {
        document.querySelectorAll('.mobile-bottom-nav .bottom-nav-items').forEach((container) => {
            container.querySelectorAll('.bottom-nav-item').forEach((item) => {
                const active = item.dataset.navKey === 'account';
                item.classList.toggle('active', active);
                if (active) item.setAttribute('aria-current', 'page');
                else item.removeAttribute('aria-current');
            });
        });
    }

    async function init() {
        bindEvents();
        setMobileAccountActive();
        try {
            if (window.supabaseConfigReady) await window.supabaseConfigReady;
            if (window.AuthService) await window.AuthService.init();
            if (!window.AuthService?.getUser()) {
                showView('mlSignIn');
                return;
            }
            await loadListings();
        } catch (error) {
            window.AsyncFeedback?.log('my-listings-init', window.AsyncFeedback?.createRequestId('my-listings-init'), error);
            $('mlErrorMessage').textContent = 'We could not restore your sign-in session. Please try again.';
            $('mlResultSummary').textContent = 'Listings unavailable';
            showView('mlError');
        }
    }

    document.addEventListener('DOMContentLoaded', init, { once: true });
})();
