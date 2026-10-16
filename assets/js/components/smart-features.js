/*
 * Shared buyer assistance for every static entry point.
 * This deliberately uses platform-neutral browser APIs so it works on
 * Cloudflare Pages and in the Express preview without a second backend.
 */
(function () {
    'use strict';

    const STATES = () => window.RegionService?.getNigerianStates?.() || [
        'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue',
        'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu',
        'FCT (Abuja)', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina',
        'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun',
        'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba',
        'Yobe', 'Zamfara'
    ];

    const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));

    function addLocationSelector() {
        const navRight = document.querySelector('.nav-right');
        if (!navRight || navRight.querySelector('[data-location-select]')) return;
        const wrapper = document.createElement('label');
        wrapper.className = 'header-location-select injected-location-select';
        wrapper.title = 'Choose your Nigerian state';
        wrapper.innerHTML = '<i class="fas fa-location-dot" aria-hidden="true"></i><select id="headerLocationSelect" data-location-select aria-label="Choose your state"></select>';
        const navIcons = navRight.querySelector('.nav-icons');
        navRight.insertBefore(wrapper, navIcons || null);
    }

    function addAccountControl() {
        const navRight = document.querySelector('.nav-right');
        const navIcons = navRight?.querySelector('.nav-icons');
        const existingAccount = navIcons?.querySelector(
            '#accountBtn, a[href="/pages/account.html"], [aria-label*="account" i]'
        );
        if (!navIcons || existingAccount) return;

        const account = document.createElement('a');
        account.id = 'accountBtn';
        account.className = 'nav-icon-item';
        account.href = '/pages/account.html';
        account.dataset.injectedAccount = 'true';
        account.setAttribute('aria-label', 'Open your VelveraHub account');
        account.innerHTML = '<i class="fas fa-user-circle" aria-hidden="true"></i><span class="icon-label">Account</span>';
        navIcons.insertBefore(account, navIcons.firstChild);
    }

    function setupHeaderControls() {
        addLocationSelector();
        addAccountControl();
    }

    function setupLocations() {
        setupHeaderControls();
        const region = window.RegionService;
        if (!region) return;
        const selects = document.querySelectorAll('[data-location-select], #locationSelect');
        selects.forEach((select) => {
            if (!select.options.length || select.dataset.smartLocationReady !== 'true') {
                region.appendLocationOptions(select);
                select.dataset.smartLocationReady = 'true';
                select.addEventListener('change', () => region.setLocation(select.value));
            }
        });
        region.syncLocationSelects?.();
    }

    function installSuggestionBox(input) {
        if (!input || input.dataset.suggestionsReady === 'true') return;
        input.dataset.suggestionsReady = 'true';
        const host = input.closest('.search-container') || input.parentElement;
        if (!host) return;
        host.classList.add('smart-search');
        const box = document.createElement('div');
        box.className = 'search-suggestions';
        box.setAttribute('role', 'listbox');
        host.appendChild(box);
        let timer;
        let requestId = 0;

        const render = (items, recent = false) => {
            box.innerHTML = items.slice(0, 8).map((item) => {
                const label = typeof item === 'string' ? item : item.title;
                return `<button type="button" role="option" class="search-suggestion" data-value="${escapeHtml(label)}"><i class="fas ${recent ? 'fa-clock-rotate-left' : 'fa-arrow-trend-up'}"></i><span>${escapeHtml(label)}</span></button>`;
            }).join('');
            box.classList.toggle('active', items.length > 0);
        };

        const recentSearches = () => {
            try {
                const key = `velvera_recent_searches_${window.RegionService?.region || 'default'}`;
                return JSON.parse(localStorage.getItem(key) || '[]').filter(Boolean).slice(0, 6);
            } catch (_) {
                return [];
            }
        };

        input.addEventListener('input', () => {
            clearTimeout(timer);
            const query = input.value.trim();
            if (query.length < 2) {
                render(recentSearches(), true);
                return;
            }
            timer = setTimeout(async () => {
                const currentRequest = ++requestId;
                let items = [];
                try {
                    items = await window.ProductsService?.getSearchSuggestions(query, {
                        location: window.RegionService?.location
                    }) || [];
                } catch (_) {
                    items = [];
                }
                if (currentRequest !== requestId) return;
                render(items);
            }, 180);
        });

        box.addEventListener('mousedown', (event) => {
            const button = event.target.closest('.search-suggestion');
            if (!button) return;
            event.preventDefault();
            input.value = button.dataset.value;
            box.classList.remove('active');
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        });
        input.addEventListener('blur', () => setTimeout(() => box.classList.remove('active'), 150));
        input.addEventListener('focus', () => {
            if (!input.value.trim()) render(recentSearches(), true);
            else if (box.children.length) box.classList.add('active');
        });
    }

    function rememberSearch(query) {
        const value = String(query || '').trim();
        if (!value) return;
        try {
            const key = `velvera_recent_searches_${window.RegionService?.region || 'default'}`;
            const previous = JSON.parse(localStorage.getItem(key) || '[]');
            localStorage.setItem(key, JSON.stringify([value, ...previous.filter((item) => item.toLowerCase() !== value.toLowerCase())].slice(0, 6)));
        } catch (_) {
            // Recent searches are an enhancement; private browsing may disable storage.
        }
    }

    function doSearch(input) {
        const query = input?.value.trim();
        if (!query) return;
        rememberSearch(query);
        const params = new URLSearchParams({ search: query });
        if (window.RegionService?.location && window.RegionService.location !== 'all') {
            params.set('location', window.RegionService.location);
        }
        window.location.href = `/pages/products.html?${params.toString()}`;
    }

    function setupSearch() {
        document.querySelectorAll('.search-input').forEach((input) => {
            installSuggestionBox(input);
            const container = input.closest('.search-container');
            const button = container?.querySelector('.search-btn');
            if (button && button.dataset.smartSearchReady !== 'true') {
                button.dataset.smartSearchReady = 'true';
                button.addEventListener('click', () => doSearch(input));
            }
            if (input.dataset.smartEnterReady !== 'true') {
                input.dataset.smartEnterReady = 'true';
                input.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        doSearch(input);
                    }
                });
            }
        });
    }

    function setupNavigationLinks() {
        document.querySelectorAll('[data-category]').forEach((link) => {
            if (link.dataset.categoryReady === 'true') return;
            const category = link.dataset.category;
            if (!category) return;
            if (!link.getAttribute('href') || link.getAttribute('href') === '#') {
                link.setAttribute('href', category === 'all'
                    ? '/pages/categories.html'
                    : `/pages/products.html?category=${encodeURIComponent(category)}`);
            }
            link.dataset.categoryReady = 'true';
        });

        document.querySelectorAll('[data-page="seller"]').forEach((link) => {
            if (!link.getAttribute('href') || link.getAttribute('href') === '#') {
                link.setAttribute('href', '/pages/seller.html');
            }
        });

        document.querySelectorAll('a[data-page="home"]').forEach((link) => {
            if (!link.getAttribute('href') || link.getAttribute('href') === '#') {
                link.setAttribute('href', '/');
            }
        });
    }

    function answerFor(message) {
        const text = message.toLowerCase();
        if (/delivery|deliver|shipping|state|location/.test(text)) {
            return 'Choose your state from the location selector. I will show products with delivery coverage for that state.';
        }
        if (/return|refund|exchange/.test(text)) {
            return 'For returns, keep the order packaging and contact support with your order number. A support agent can guide you through the next step.';
        }
        if (/seller|sell|shop owner|upload/.test(text)) {
            return 'Shop owners can sign in, open Seller Dashboard, choose Products, and use Add Product. Images are compressed before upload.';
        }
        if (/pay|payment|checkout/.test(text)) {
            return 'Add an item to your cart and continue to checkout. Your order total and delivery information are shown before submission.';
        }
        if (/hello|hi|hey|help/.test(text)) {
            return 'Hello! I can help you find products, choose a delivery state, understand checkout, or connect you to support.';
        }
        return 'I can help with product search, delivery locations, checkout, returns, or selling on VelveraHub. What would you like to do?';
    }

    async function setupSupport() {
        // Support is an owner-only tool. Never render it in customer UI,
        // even when a seller is browsing the storefront in another tab.
        if (document.body.dataset.supportAudience !== 'shop-owner') {
            document.getElementById('supportWidget')?.remove();
            return;
        }
        if (!window.AuthService) return;
        if (!window.AuthService.isLoggedIn()) await window.AuthService.init();
        if (!window.AuthService.isLoggedIn()
            || !window.AuthService.isSeller()
            || window.AuthService.isAdmin()) return;
        if (document.getElementById('supportWidget')) return;
        const widget = document.createElement('aside');
        widget.id = 'supportWidget';
        widget.className = 'support-widget';
        widget.setAttribute('aria-label', 'Movable VelveraHub support widget');
        widget.innerHTML = `
            <button class="support-launcher" type="button" aria-label="Open VelveraHub support. Drag to move">
                <i class="fas fa-message"></i><span class="support-pulse"></span>
            </button>
            <div class="support-panel" aria-hidden="true">
                <div class="support-header">
                    <div><strong>VelveraHub help</strong><small><span class="support-status-dot"></span> Assistant online</small></div>
                    <button type="button" class="support-close" aria-label="Close support"><i class="fas fa-xmark"></i></button>
                </div>
                <div class="support-tabs"><button type="button" class="active" data-support-tab="assistant">AI assistant</button><button type="button" data-support-tab="live">Live support</button></div>
                <div class="support-messages" aria-live="polite"><div class="support-message assistant">Hi! I can help you shop or sell with confidence. Ask me anything.</div></div>
                <form class="support-form"><input aria-label="Support message" placeholder="Ask about delivery, products..." autocomplete="off"><button type="submit" aria-label="Send message"><i class="fas fa-paper-plane"></i></button></form>
                <p class="support-note">Live agents join when available. The assistant helps when they are offline.</p>
            </div>`;
        document.body.appendChild(widget);
        const panel = widget.querySelector('.support-panel');
        const messages = widget.querySelector('.support-messages');
        const input = widget.querySelector('.support-form input');
        const launcher = widget.querySelector('.support-launcher');
        let mode = 'assistant';
        let moved = false;
        let suppressClick = false;
        let dragState = null;

        function clampPosition(left, top) {
            const margin = 12;
            const rect = widget.getBoundingClientRect();
            return {
                left: Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - rect.width - margin)),
                top: Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - rect.height - margin))
            };
        }

        function savePosition(left, top) {
            localStorage.setItem('velvera_support_position', JSON.stringify({ left, top }));
        }

        function applyPosition(left, top, persist = true) {
            const position = clampPosition(left, top);
            widget.style.left = `${position.left}px`;
            widget.style.top = `${position.top}px`;
            widget.style.right = 'auto';
            widget.style.bottom = 'auto';
            widget.classList.add('is-moved');
            if (persist) savePosition(position.left, position.top);
            positionPanel();
        }

        function restorePosition() {
            try {
                const saved = JSON.parse(localStorage.getItem('velvera_support_position') || 'null');
                if (Number.isFinite(saved?.left) && Number.isFinite(saved?.top)) {
                    applyPosition(saved.left, saved.top, false);
                }
            } catch (_) {
                localStorage.removeItem('velvera_support_position');
            }
        }

        function positionPanel() {
            if (!panel.classList.contains('active')) return;
            const widgetRect = widget.getBoundingClientRect();
            const panelWidth = panel.offsetWidth;
            const panelHeight = panel.offsetHeight;
            const margin = 12;
            const globalLeft = Math.min(
                Math.max(margin, widgetRect.left),
                Math.max(margin, window.innerWidth - panelWidth - margin)
            );
            const aboveTop = widgetRect.top - panelHeight - 8;
            const globalTop = aboveTop >= margin
                ? aboveTop
                : Math.min(window.innerHeight - panelHeight - margin, widgetRect.bottom + 8);
            panel.style.left = `${globalLeft - widgetRect.left}px`;
            panel.style.right = 'auto';
            panel.style.top = `${globalTop - widgetRect.top}px`;
            panel.style.bottom = 'auto';
        }

        launcher.addEventListener('pointerdown', (event) => {
            if (event.button !== undefined && event.button !== 0) return;
            const rect = widget.getBoundingClientRect();
            dragState = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                left: rect.left,
                top: rect.top
            };
            moved = false;
            launcher.setPointerCapture?.(event.pointerId);
            widget.classList.add('is-dragging');
        });

        launcher.addEventListener('pointermove', (event) => {
            if (!dragState || event.pointerId !== dragState.pointerId) return;
            const deltaX = event.clientX - dragState.startX;
            const deltaY = event.clientY - dragState.startY;
            if (!moved && Math.hypot(deltaX, deltaY) < 5) return;
            moved = true;
            applyPosition(dragState.left + deltaX, dragState.top + deltaY);
            event.preventDefault();
        });

        launcher.addEventListener('pointerup', (event) => {
            if (!dragState || event.pointerId !== dragState.pointerId) return;
            suppressClick = moved;
            dragState = null;
            launcher.releasePointerCapture?.(event.pointerId);
            widget.classList.remove('is-dragging');
        });

        launcher.addEventListener('pointercancel', () => {
            dragState = null;
            widget.classList.remove('is-dragging');
        });

        launcher.addEventListener('click', () => {
            if (suppressClick) {
                suppressClick = false;
                return;
            }
            panel.classList.toggle('active');
            panel.setAttribute('aria-hidden', String(!panel.classList.contains('active')));
            if (panel.classList.contains('active')) {
                positionPanel();
                input.focus();
            }
        });
        widget.querySelector('.support-close').addEventListener('click', () => {
            panel.classList.remove('active');
            panel.setAttribute('aria-hidden', 'true');
            panel.style.left = '';
            panel.style.top = '';
            panel.style.right = '';
            panel.style.bottom = '';
        });
        widget.querySelectorAll('[data-support-tab]').forEach((tab) => tab.addEventListener('click', () => {
            mode = tab.dataset.supportTab;
            widget.querySelectorAll('[data-support-tab]').forEach((item) => item.classList.toggle('active', item === tab));
            widget.querySelector('.support-note').textContent = mode === 'live'
                ? 'Messages are ready for a live agent. If no agent is online, the assistant will respond.'
                : 'Live agents join when available. The assistant helps when they are offline.';
        }));
        widget.querySelector('.support-form').addEventListener('submit', (event) => {
            event.preventDefault();
            const value = input.value.trim();
            if (!value) return;
            messages.insertAdjacentHTML('beforeend', `<div class="support-message user">${escapeHtml(value)}</div>`);
            input.value = '';
            messages.scrollTop = messages.scrollHeight;
            setTimeout(() => {
                const reply = mode === 'assistant' ? answerFor(value) : 'Thanks, your message is in the support queue. I will keep helping while a live agent is unavailable.';
                messages.insertAdjacentHTML('beforeend', `<div class="support-message assistant">${escapeHtml(reply)}</div>`);
                messages.scrollTop = messages.scrollHeight;
            }, 450);
        });
        restorePosition();
        window.addEventListener('resize', () => {
            if (widget.classList.contains('is-moved')) {
                const rect = widget.getBoundingClientRect();
                applyPosition(rect.left, rect.top, false);
            }
            positionPanel();
        });
    }

    document.addEventListener('DOMContentLoaded', async () => {
        setupLocations();
        setupSearch();
        setupNavigationLinks();
        await setupSupport();
        window.RegionService?.loadAvailableLocations?.().then(setupLocations);
        window.addEventListener('velveraLocationChange', setupLocations);
        window.addEventListener('authStateChange', setupSupport);
    });
})();