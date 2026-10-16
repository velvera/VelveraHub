/*
 * Shared mobile navigation for every storefront page.
 * The HTML entry points keep their own documents, so normalize the nav here
 * instead of maintaining slightly different copies on every page.
 */
(function () {
    'use strict';

    const NAV_ITEMS = [
        { key: 'home', label: 'Home', icon: 'fa-home', href: '/', path: '/' },
        { key: 'browse', label: 'Browse', icon: 'fa-compass', href: '/pages/browse.html', path: '/pages/browse.html' },
        { key: 'cart', label: 'Cart', icon: 'fa-shopping-cart', href: '/pages/cart.html', path: '/pages/cart.html', action: 'cart' },
        { key: 'sell', label: 'Sell', icon: 'fa-store', href: '/pages/sell.html', path: '/pages/sell.html' },
        { key: 'account', label: 'Account', icon: 'fa-user', href: '/pages/account.html', path: '/pages/account.html', action: 'account' }
    ];
    const SCROLL_THRESHOLD = 8;
    const TOP_EDGE = 24;
    const BOTTOM_EDGE = 24;

    function resolvedHref(item) {
        const domains = window.VelveraHubDomains;
        if (!domains || domains.currentSurface?.() !== 'shop') return item.href;
        if (item.key === 'sell') return domains.shopOwnerUrl('/');

        const storefrontPath = item.href.replace(/^\/pages\//, '/veeve/');
        return domains.publicUrl(storefrontPath, window.RegionService?.region);
    }

    function openCart() {
        const sidebar = document.getElementById('cartSidebar');
        const overlay = document.getElementById('cartOverlay');
        if (sidebar) {
            const focusTrigger = document.activeElement;
            sidebar.classList.add('active');
            overlay?.classList.add('active');
            sidebar.setAttribute('role', 'dialog');
            sidebar.setAttribute('aria-modal', 'true');
            sidebar.setAttribute('aria-label', 'Shopping cart');
            document.body.style.overflow = 'hidden';
            sidebar.__velveraFocusTrigger = focusTrigger;
            window.VelveraFocusManager?.open(sidebar, { trap: true });
            window.dispatchEvent(new CustomEvent('velveraCartOpen'));
            return;
        }
        window.location.assign(resolvedHref(NAV_ITEMS.find((item) => item.key === 'cart')));
    }

    function openAccount() {
        window.location.assign(resolvedHref(NAV_ITEMS.find((item) => item.key === 'account')));
    }

    function normalizePath(value = window.location.pathname) {
        let path = String(value || '/').split('?')[0].split('#')[0];
        path = path.replace(/\/index\.html?$/i, '').replace(/\/+$/, '') || '/';

        // Cloudflare Pages previews can expose a project folder before the
        // actual site path. Ignore that prefix so the same nav works in the
        // parent app, generated roots, and folder-based local previews.
        path = path.replace(/^\/(?:velverahub-(?:ng|uk)|public)(?=\/|$)/i, '') || '/';
        return path.toLowerCase();
    }

    function activeKey(path = window.location.pathname) {
        const normalized = normalizePath(path);
        const page = normalized.split('/').pop();
        if (window.VelveraHubDomains?.currentSurface?.() === 'shop' || page === 'seller.html' || page === 'seller') return 'sell';
        if (normalized === '/') return 'home';
        if (page === 'cart.html' || page === 'checkout.html' || page === 'cart' || page === 'checkout') return 'cart';
        if (page === 'account.html' || page === 'account') return 'account';
        if (page === 'auth.html' || page === 'auth') return 'account';
        if (page === 'sell.html' || page === 'sell' || normalized.startsWith('/dashboards/shop-owner')) return 'sell';

        // Product discovery pages belong to Browse, including category,
        // product, shop, and content pages that do not have their own tab.
        return 'browse';
    }

    function setActive(nav, key) {
        const container = nav.querySelector('.bottom-nav-items');
        if (!container) return;

        const activeIndex = Math.max(0, NAV_ITEMS.findIndex((item) => item.key === key));
        container.style.setProperty('--active-index', String(activeIndex));
        container.querySelectorAll('.bottom-nav-item').forEach((item) => {
            const active = item.dataset.navKey === key;
            item.classList.toggle('active', active);
            if (active) item.setAttribute('aria-current', 'page');
            else item.removeAttribute('aria-current');
        });
    }

    function renderNavItems(nav) {
        const container = nav.querySelector('.bottom-nav-items');
        if (!container) return;

        const active = activeKey();
        container.innerHTML = NAV_ITEMS.map((item) => {
            const activeClass = item.key === active ? ' active' : '';
            const ariaCurrent = item.key === active ? ' aria-current="page"' : '';
            const common = `class="bottom-nav-item${activeClass}" data-nav-key="${item.key}" data-nav-path="${item.path}"`;
            const icon = `<i class="fas ${item.icon}" aria-hidden="true"></i>`;
            const label = `<span>${item.label}</span>`;

            if (item.action === 'cart') {
                return `<button ${common} id="bottomCartBtn" type="button"${ariaCurrent}>${icon}<span class="bottom-cart-badge" id="bottomCartBadge" style="display:none">0</span>${label}</button>`;
            }
            if (item.action === 'account') {
                return `<button ${common} id="bottomAccountBtn" type="button"${ariaCurrent}>${icon}${label}</button>`;
            }
            return `<a ${common} href="${resolvedHref(item)}"${ariaCurrent}>${icon}${label}</a>`;
        }).join('');
        container.classList.add('is-ready');
        setActive(nav, active);
    }

    function updateCartBadge() {
        let items = [];
        try {
            items = JSON.parse(localStorage.getItem('velverahub_cart') || '[]');
        } catch (_) {
            items = [];
        }
        const count = items.reduce((total, item) => total + Number(item.quantity || 1), 0);
        document.querySelectorAll('#bottomCartBadge').forEach((badge) => {
            badge.textContent = String(count);
            badge.style.display = count > 0 ? 'flex' : 'none';
        });
    }

    function setupScrollBehavior(nav) {
        if (nav.dataset.scrollBehaviorReady === 'true') return;
        nav.dataset.scrollBehaviorReady = 'true';

        const mobileQuery = window.matchMedia('(max-width: 768px)');
        let lastY = window.scrollY || document.documentElement.scrollTop || 0;
        let framePending = false;

        function setHidden(hidden) {
            const keepVisibleForFocus = nav.contains(document.activeElement);
            const shouldHide = Boolean(hidden && mobileQuery.matches && !keepVisibleForFocus);
            nav.classList.toggle('is-scroll-hidden', shouldHide);
            nav.setAttribute('aria-hidden', String(shouldHide));
            if ('inert' in nav) nav.inert = shouldHide;
        }

        function update() {
            framePending = false;
            const currentY = Math.max(0, window.scrollY || document.documentElement.scrollTop || 0);
            const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

            if (!mobileQuery.matches) {
                setHidden(false);
                lastY = currentY;
            } else if (currentY <= TOP_EDGE) {
                setHidden(false);
                lastY = currentY;
            } else if (currentY >= maxY - BOTTOM_EDGE) {
                setHidden(true);
                lastY = currentY;
            } else if (currentY - lastY >= SCROLL_THRESHOLD) {
                setHidden(true);
                lastY = currentY;
            } else if (lastY - currentY >= SCROLL_THRESHOLD) {
                setHidden(false);
                lastY = currentY;
            }
        }

        function scheduleUpdate() {
            if (framePending) return;
            framePending = true;
            window.requestAnimationFrame(update);
        }

        window.addEventListener('scroll', scheduleUpdate, { passive: true });
        window.addEventListener('resize', scheduleUpdate, { passive: true });
        window.addEventListener('pageshow', scheduleUpdate);
        mobileQuery.addEventListener?.('change', scheduleUpdate);
        setHidden(false);
    }

    function init() {
        document.querySelectorAll('.mobile-bottom-nav').forEach((nav) => {
            renderNavItems(nav);
            setupScrollBehavior(nav);
            if (nav.dataset.mobileNavReady === 'true') return;
            nav.dataset.mobileNavReady = 'true';
            nav.addEventListener('click', (event) => {
                const item = event.target.closest('.bottom-nav-item');
                if (!item || !nav.contains(item)) return;

                const key = item.dataset.navKey;
                if (!key) return;
                setActive(nav, key);

                if (key === 'cart') {
                    event.preventDefault();
                    openCart();
                } else if (key === 'account') {
                    event.preventDefault();
                    openAccount();
                }
            });
        });
        updateCartBadge();
        window.addEventListener('velveraCartChange', updateCartBadge);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();