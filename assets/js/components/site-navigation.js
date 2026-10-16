/*
 * Shared storefront navigation for the standalone HTML entry points.
 * The project intentionally keeps pages separate, so this small enhancement
 * keeps their route directory and Browse destination consistent without
 * turning the pages into a single-page app.
 */
(function () {
    'use strict';

    // Load shared validation/action feedback on every storefront page without
    // requiring every independently generated HTML root to duplicate the tag.
    if (!window.VelveraInteractionFeedback && document.currentScript) {
        const feedbackScript = document.createElement('script');
        feedbackScript.src = new URL('./interaction-feedback.js', document.currentScript.src).href;
        document.head.appendChild(feedbackScript);
    }
    if (!window.VelveraFocusManager && document.currentScript) {
        const focusScript = document.createElement('script');
        focusScript.src = new URL('./focus-manager.js', document.currentScript.src).href;
        document.head.appendChild(focusScript);
    }

    // Release the shared first-paint loader only after the standalone page
    // has reached DOM ready. The loader itself is CSS-only, so this remains
    // safe even if a later marketplace service is unavailable.
    function markAppReady() {
        document.body?.classList.add('app-ready');
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', markAppReady, { once: true });
    } else {
        markAppReady();
    }

    function ensureAppIcons() {
        const pagePath = window.location.pathname;
        const pagePrefix = /^\/(?:pages|veeve)(?:\/|$)/.test(pagePath) ? '../' : '/';
        const links = [
            ['manifest', `${pagePrefix}manifest.webmanifest`],
            ['apple-touch-icon', `${pagePrefix}img/apple-touch-icon.png`]
        ];
        links.forEach(([rel, href]) => {
            if (document.head.querySelector(`link[rel="${rel}"]`)) return;
            const link = document.createElement('link');
            link.rel = rel;
            link.href = href;
            document.head.appendChild(link);
        });
    }
    ensureAppIcons();

    let brandingPromise;

    function loadBranding() {
        if (brandingPromise) return brandingPromise;
        brandingPromise = (async () => {
            try {
                if (window.supabaseConfigReady) await window.supabaseConfigReady;
                const supabase = window.SupabaseClient?.get();
                if (supabase && window.SupabaseClient.isConfigured()) {
                    const { data, error } = await supabase
                        .from('site_settings')
                        .select('logo_url')
                        .eq('id', 'branding')
                        .maybeSingle();
                    if (!error) return { logoUrl: data?.logo_url || null };
                }
                if (!window.VELVERAHUB_CONFIG?.STATIC_ONLY) {
                    const apiFetch = window.VelveraAPI?.fetch || fetch;
                    const response = await apiFetch('/api/branding', { cache: 'no-store' });
                    if (response.ok) return response.json();
                }
            } catch (_) {
                // Keep the checked-in static brand mark when Supabase is unavailable.
            }
            return { logoUrl: null };
        })();
        return brandingPromise;
    }

    const ROUTES = [
        { href: '/pages/categories.html', icon: 'fa-layer-group', image: '/img/quick-links/all-categories.png', label: 'All Categories' },
        { href: '/pages/shops.html', icon: 'fa-store', image: '/img/quick-links/top-shops.png', label: 'Top Shops' },
        { href: '/pages/secured-trading.html', icon: 'fa-shield-halved', image: '/img/quick-links/secured-trading.png', label: 'Secured Trading' },
        { href: '/pages/video-channel.html', icon: 'fa-circle-play', image: '/img/quick-links/video-channel.png', label: 'Video Channel' },
        { href: '/pages/new-users.html', icon: 'fa-gift', image: '/img/quick-links/new-users-benefits.png', label: 'New Users Benefits' },
        { href: '/pages/categories.html', icon: 'fa-layer-group', image: '/img/quick-links/all-categories.png', label: 'Shop By Category' },
        { href: '/pages/products.html?category=electronics', icon: 'fa-laptop', image: '/img/home-category/electronics.png', label: 'Electronics' },
        { href: '/pages/products.html?category=fashion', icon: 'fa-shirt', image: '/img/home-category/fashion.png', label: 'Fashion' },
        { href: '/pages/products.html?category=home', icon: 'fa-house', image: '/img/home-category/home-furniture-and-appliances.png', label: 'Home & Garden' },
        { href: '/pages/products.html?category=sports', icon: 'fa-person-running', image: '/img/home-category/sports.png', label: 'Sports' },
        { href: '/pages/products.html?category=beauty', icon: 'fa-spa', image: '/img/home-category/beauty-and-personal-care.png', label: 'Beauty' },
        { href: '/pages/products.html?category=toys', icon: 'fa-gamepad', image: '/img/home-category/toys-and-games.png', label: 'Toys & Games' },
        { href: '/pages/account.html', icon: 'fa-user', label: 'Account' },
        { href: '/pages/sell.html', icon: 'fa-store', label: 'Sell on VelveraHub', seller: true }
    ];

    function routeDirectory() {
        return `
            <div class="category-nav site-route-directory" aria-label="VelveraHub navigation">
                <div class="category-nav-container">
                    ${ROUTES.map((route) => `
                        <a href="${route.href}" class="category-link${route.seller ? ' seller-link' : ''}">
                            ${route.image
                                ? `<img src="${route.image}" alt="" aria-hidden="true">`
                                : `<i class="fas ${route.icon}" aria-hidden="true"></i>`} ${route.label}
                        </a>
                    `).join('')}
                </div>
            </div>
        `;
    }

    function regionBadgeMarkup() {
        return `
            <button class="region-badge" id="regionBadgeBtn" type="button" title="Change region" aria-label="Change region">
                <span id="regionFlag" aria-hidden="true">🇳🇬</span>
                <span id="regionName">Nigeria</span>
            </button>
        `;
    }

    function headerLocationMarkup() {
        const allLocationsLabel = window.RegionService?.region === 'uk' ? 'All Regions' : 'All States';
        return `
            <label class="header-location-select" title="Choose your delivery location">
                <i class="fas fa-location-dot" aria-hidden="true"></i>
                <select id="headerLocationSelect" data-location-select aria-label="Choose your delivery location">
                    <option value="all">${allLocationsLabel}</option>
                </select>
            </label>
        `;
    }

    function sharedFooterMarkup() {
        const profile = window.VELVERAHUB_CONFIG?.APP_PROFILE || 'base';
        const suffix = profile === 'uk' ? 'uk' : profile === 'ng' ? 'ng' : '';
        const instagram = `https://instagram.com/velverahub${suffix}`;
        const twitter = `https://x.com/velverahub${suffix}`;
        return `
            <footer id="siteFooter" class="footer shared-footer" data-collapsible-footer data-default-footer="true">
                <div class="footer-mobile-bar" data-footer-bar>
                    <div class="footer-container">
                        <div class="footer-mobile-brand">
                            <span class="footer-brand-mark" aria-hidden="true"></span>
                            <img src="/img/velverahub.png" alt="VelveraHub" class="footer-brand-wordmark" loading="eager" decoding="async">
                        </div>
                        <button class="footer-toggle" type="button" data-footer-toggle aria-expanded="false" aria-controls="footer-expandable-content" aria-label="Expand footer">
                            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.25"></path>
                            </svg>
                        </button>
                    </div>
                </div>

                <div class="footer-expandable" id="footer-expandable-content" data-footer-content aria-hidden="true">
                    <div class="footer-links">
                        <div class="footer-container">
                            <div class="footer-intro">
                                <p>Discover trusted products and shops with delivery-aware shopping.</p>
                            </div>
                            <div class="footer-col">
                                <h4>Shop</h4>
                                <ul>
                                    <li><a href="/pages/products.html">Browse products</a></li>
                                    <li><a href="/pages/categories.html">Categories</a></li>
                                    <li><a href="/pages/shops.html">Top shops</a></li>
                                </ul>
                            </div>
                            <div class="footer-col">
                                <h4>Account</h4>
                                <ul>
                                    <li><a href="/pages/account.html">My account</a></li>
                                    <li><a href="/pages/cart.html">Your cart</a></li>
                                    <li><a href="/pages/new-users.html">New user benefits</a></li>
                                </ul>
                            </div>
                            <div class="footer-col">
                                <h4>Seller</h4>
                                <ul>
                                    <li><a href="/pages/sell.html">Sell on VelveraHub</a></li>
                                    <li><a href="/pages/secured-trading.html">Secured trading</a></li>
                                    <li><a href="/pages/shops.html">Shop owner tools</a></li>
                                </ul>
                            </div>
                            <div class="footer-col">
                                <h4>Support</h4>
                                <ul>
                                    <li><a href="/veeve/legal.html#privacy">Privacy policy</a></li>
                                    <li><a href="/veeve/legal.html#terms">Terms of service</a></li>
                                    <li><a href="/veeve/legal.html#refunds">Refunds and returns</a></li>
                                    <li><a href="/veeve/legal.html#cookies">Cookie policy</a></li>
                                    <li><a href="/pages/video-channel.html">Video channel</a></li>
                                </ul>
                            </div>
                        </div>
                    </div>
                    <div class="footer-bottom">
                        <div class="footer-container">
                            <div class="footer-bottom-left">
                                <p>© ${new Date().getFullYear()} VelveraHub Ltd. All rights reserved.</p>
                            </div>
                            <div class="footer-bottom-right">
                                <div class="footer-social" aria-label="Social links">
                                    <a class="footer-social-item" aria-label="Facebook" href="https://facebook.com/velverahub" target="_blank" rel="noopener noreferrer"><img src="/img/footer-social/facebook.png" alt="Facebook" /></a>
                                    <a class="footer-social-item" aria-label="Instagram" href="${instagram}" target="_blank" rel="noopener noreferrer"><img src="/img/footer-social/instagram.png" alt="Instagram" /></a>
                                    <a class="footer-social-item" aria-label="Twitter" href="${twitter}" target="_blank" rel="noopener noreferrer"><img src="/img/footer-social/twitter.png" alt="X / Twitter" /></a>
                                    <a class="footer-social-item" aria-label="YouTube" href="https://youtube.com/@velverahub" target="_blank" rel="noopener noreferrer"><img src="/img/footer-social/youtube.png" alt="YouTube" /></a>
                                    <a class="footer-social-item" aria-label="TikTok" href="https://www.tiktok.com/@velverahub?_r=1&_t=ZS-99pXmDumPFi" target="_blank" rel="noopener noreferrer"><img src="/img/footer-social/tiktok.png" alt="TikTok" /></a>
                                    <a class="footer-social-item" aria-label="Email" href="mailto:velverahub@gmail.com"><img src="/img/footer-social/mail.png" alt="Email" /></a>
                                </div>
                                <div class="footer-payments" aria-label="Payment status">
                                    <span>Payment options are confirmed at checkout</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </footer>
        `;
    }

    function ensureRegionBadge(navbar) {
        const left = navbar.querySelector('.nav-left');
        if (!left || left.querySelector('#regionBadgeBtn')) return;
        const logo = left.querySelector('.logo');
        logo?.insertAdjacentHTML('afterend', regionBadgeMarkup());
    }

    function ensureHeaderControls(navbar) {
        const pageName = window.location.pathname.split('/').pop()?.toLowerCase() || '';
        const utilityPage = new Set(['account.html', 'auth.html', 'cart.html', 'checkout.html', 'sell.html']);
        if (document.body?.dataset.headerSearch === 'false' || utilityPage.has(pageName)) {
            navbar.querySelector('.nav-center')?.remove();
        }

        const navRight = navbar.querySelector('.nav-right');
        if (!navRight) return;
        if (!navRight.querySelector('#headerLocationSelect')) {
            navRight.insertAdjacentHTML('afterbegin', headerLocationMarkup());
        }

        let icons = navRight.querySelector('.nav-icons');
        if (!icons) {
            icons = document.createElement('div');
            icons.className = 'nav-icons';
            navRight.appendChild(icons);
        }

        const isAccountItem = (item) => {
            if (item.id === 'accountBtn') return true;
            const href = item.getAttribute('href') || '';
            const label = item.querySelector('.icon-label')?.textContent.trim().toLowerCase();
            return href.includes('/account') || label === 'account' || !!item.querySelector('.fa-user, .fa-user-circle');
        };
        const isCartItem = (item) => {
            if (item.id === 'cartBtn') return true;
            const href = item.getAttribute('href') || '';
            const label = item.querySelector('.icon-label')?.textContent.trim().toLowerCase();
            return href.includes('/cart') || label === 'cart' || !!item.querySelector('.fa-shopping-cart');
        };
        const keepOne = (items, id) => {
            const preferred = items.find((item) => item.id === id) || items[0];
            items.forEach((item) => {
                if (item !== preferred) item.remove();
            });
            if (preferred) preferred.id = id;
            return preferred;
        };

        const accountItem = keepOne(
            Array.from(icons.querySelectorAll('.nav-icon-item')).filter(isAccountItem),
            'accountBtn'
        );
        if (!accountItem) {
            icons.insertAdjacentHTML('afterbegin', `
                <a class="nav-icon-item" id="accountBtn" href="/pages/account.html" aria-label="Open account">
                    <i class="fas fa-user" aria-hidden="true"></i><span class="icon-label">Account</span>
                </a>
            `);
        }
        const cartItem = keepOne(
            Array.from(icons.querySelectorAll('.nav-icon-item')).filter(isCartItem),
            'cartBtn'
        );
        if (!cartItem) {
            icons.insertAdjacentHTML('beforeend', `
                <a class="nav-icon-item" id="cartBtn" href="/pages/cart.html" aria-label="Open cart">
                    <i class="fas fa-shopping-cart" aria-hidden="true"></i><span class="icon-label">Cart</span>
                </a>
            `);
        } else if (!cartItem.matches('a, button')) {
            cartItem.setAttribute('role', 'button');
            cartItem.setAttribute('tabindex', '0');
            cartItem.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                cartItem.click();
            });
        }
    }

    function ensureRegionModal() {
        if (!document.querySelector('.navbar') || document.getElementById('regionModal')) return;
        document.body.insertAdjacentHTML('beforeend', `
            <div class="region-modal" id="regionModal" role="dialog" aria-modal="true" aria-label="Choose region">
                <div class="region-modal-content">
                    <p>Prices and delivery options will be shown for your region.</p>
                    <div class="region-options">
                        <button class="region-option" type="button" data-region-choice="ng"><span class="flag">🇳🇬</span><span class="country">Nigeria</span></button>
                        <button class="region-option" type="button" data-region-choice="uk"><span class="flag">🇬🇧</span><span class="country">United Kingdom</span></button>
                    </div>
                </div>
            </div>
        `);
        const modal = document.getElementById('regionModal');
        modal.addEventListener('click', (event) => {
            if (event.target === modal) modal.classList.remove('active');
            const choice = event.target.closest('[data-region-choice]')?.dataset.regionChoice;
            if (choice && window.RegionService) {
                window.RegionService.setRegion(choice);
                modal.classList.remove('active');
            }
        });
    }

    function syncRegionBadge() {
        const region = window.RegionService;
        if (!region) return;
        document.querySelectorAll('#regionFlag').forEach((node) => node.textContent = region.flag);
        document.querySelectorAll('#regionName').forEach((node) => node.textContent = region.countryName);
    }

    function ensureSharedFooter() {
        const footers = [...document.querySelectorAll('footer.footer')];
        const footer = footers[0];
        if (footer?.dataset.defaultFooter === 'true') {
            footers.slice(1).forEach((duplicate) => duplicate.remove());
            return;
        }
        if (footer) {
            footer.outerHTML = sharedFooterMarkup();
            footers.slice(1).forEach((duplicate) => duplicate.remove());
            return;
        }
        const bottomNav = document.querySelector('.mobile-bottom-nav');
        if (bottomNav) bottomNav.insertAdjacentHTML('beforebegin', sharedFooterMarkup());
        else document.body.insertAdjacentHTML('beforeend', sharedFooterMarkup());
    }

    function ensureFooterStyles() {
        if (document.querySelector('link[data-shared-footer-styles]')) return;
        const existing = [...document.querySelectorAll('link[rel="stylesheet"]')]
            .find((link) => /(?:^|\/)footer\.css(?:$|\?)/.test(link.href));
        if (existing) {
            existing.dataset.sharedFooterStyles = 'true';
            return;
        }
        const navigationScript = [...document.scripts]
            .find((script) => script.src.includes('/components/site-navigation.js'));
        const style = document.createElement('link');
        style.rel = 'stylesheet';
        style.href = navigationScript
            ? new URL('../../css/components/footer.css', navigationScript.src).href
            : '/assets/css/components/footer.css';
        style.dataset.sharedFooterStyles = 'true';
        document.head.appendChild(style);
    }

    function removeHeaderCategorySelectors() {
        document.querySelectorAll('.navbar .search-container select#searchCategory, .navbar .search-container select.category-select')
            .forEach((select) => {
                select.closest('.cs-select')?.remove();
                select.remove();
            });
        document.querySelectorAll('.cs-panel[data-select-id="searchCategory"]').forEach((panel) => panel.remove());
    }

    function ensureCategorySelectors() {
        if (window.VelveraCategories) {
            window.VelveraCategories.initialize();
            return;
        }
        if (document.querySelector('script[data-marketplace-categories]')) return;
        const navigationScript = [...document.scripts]
            .find((script) => script.src.includes('/components/site-navigation.js'));
        const script = document.createElement('script');
        script.src = navigationScript
            ? new URL('../services/categories.js', navigationScript.src).href
            : '/assets/js/services/categories.js';
        script.dataset.marketplaceCategories = 'true';
        script.onload = () => window.VelveraCategories?.initialize();
        document.head.appendChild(script);
    }

    function setupCollapsibleFooter() {
        const mobileQuery = window.matchMedia('(max-width: 768px)');

        document.querySelectorAll('[data-collapsible-footer]').forEach((footer) => {
            const toggle = footer.querySelector('[data-footer-toggle]');
            const content = footer.querySelector('[data-footer-content]');
            const bar = footer.querySelector('[data-footer-bar]');
            if (!toggle || !content || toggle.dataset.bound === 'true') return;

            let mobileExpanded = false;

            const syncFooterState = () => {
                const expanded = !mobileQuery.matches || mobileExpanded;
                footer.dataset.expanded = String(expanded);
                toggle.setAttribute('aria-expanded', String(expanded));
                toggle.setAttribute('aria-label', expanded ? 'Collapse footer' : 'Expand footer');
                content.setAttribute('aria-hidden', String(!expanded));
            };

            toggle.addEventListener('click', () => {
                if (!mobileQuery.matches) return;
                mobileExpanded = !mobileExpanded;
                syncFooterState();
            });

            bar?.addEventListener('click', (event) => {
                if (event.target.closest('a, button')) return;
                toggle.click();
            });

            mobileQuery.addEventListener?.('change', syncFooterState);
            toggle.dataset.bound = 'true';
            syncFooterState();
        });
    }

    function safeBrandImageUrl(value) {
        const fallback = '/img/logo.png';
        const raw = String(value || '').trim();
        if (!raw) return fallback;
        try {
            const url = new URL(raw, window.location.origin);
            if (url.pathname === '/' || url.pathname.endsWith('/')) return fallback;
            if (url.protocol === 'https:' || url.origin === window.location.origin) return url.href;
        } catch (_) {}
        return fallback;
    }

    async function normalizeBranding() {
        const branding = await loadBranding();
        // This is a plain static asset, so keep the brand visible even when
        // Supabase branding is unavailable or unconfigured.
        const logoUrl = safeBrandImageUrl(branding.logoUrl);
        document.querySelectorAll('.navbar .logo').forEach((logo) => {
            const icon = logo.querySelector('.logo-icon');
            if (!icon) return;

            icon.classList.add('logo-mark');
            icon.classList.toggle('logo-icon--empty', !logoUrl);
            const image = document.createElement('img');
            image.src = logoUrl;
            image.alt = '';
            image.setAttribute('aria-hidden', 'true');
            image.className = 'header-brand-mark';
            icon.replaceChildren(image);
            icon.hidden = !logoUrl;
            image.addEventListener('error', () => {
                if (image.dataset.staticFallback) return;
                image.dataset.staticFallback = 'true';
                image.src = '/img/logo.png';
            }, { once: true });

            let wordmark = logo.querySelector('.logo-wordmark');
            if (!wordmark) {
                wordmark = document.createElement('img');
                logo.appendChild(wordmark);
            }
            wordmark.src = '/img/velverahub.png';
            wordmark.alt = 'VelveraHub';
            wordmark.className = 'logo-wordmark';
            logo.querySelector('.logo-text')?.remove();
        });
        document.querySelectorAll('.footer-brand-mark').forEach((mark) => {
            const footerLogoUrl = '/img/logo.png';
            const image = document.createElement('img');
            image.src = footerLogoUrl;
            image.alt = '';
            image.setAttribute('aria-hidden', 'true');
            image.className = 'footer-brand-mark-image';
            image.loading = 'eager';
            image.decoding = 'async';
            image.addEventListener('error', () => {
                mark.classList.add('footer-brand-mark--empty');
            }, { once: true });
            mark.classList.remove('footer-brand-mark--empty');
            mark.replaceChildren(image);
            mark.hidden = false;
        });
    }

    function optimizeImages() {
        document.querySelectorAll('img').forEach((image) => {
            image.decoding = image.decoding || 'async';
            if (image.loading) return;
            const isCritical = image.matches(
                '.logo-wordmark, .header-brand-mark, .auth-brand-logo, .hero-slide.active img'
            );
            image.loading = isCritical ? 'eager' : 'lazy';
        });
    }

    function normalizeBrowseLinks() {
        document.querySelectorAll('.navbar a, .mobile-bottom-nav a').forEach((link) => {
            const label = link.querySelector('.icon-label, span:last-child')?.textContent.trim().toLowerCase();
            const isBrowse = label === 'browse' || (
                link.getAttribute('href') === '/pages/products.html'
                && link.querySelector('.fa-compass, .fa-th-large')
            );
            if (isBrowse) link.setAttribute('href', '/pages/browse.html');
        });

        document.querySelectorAll('.navbar a, .mobile-bottom-nav a').forEach((link) => {
            const label = link.querySelector('.icon-label, span:last-child')?.textContent.trim().toLowerCase();
            const icon = link.querySelector('.fa-shopping-cart');
            if (label === 'cart' || icon) link.setAttribute('href', '/pages/cart.html');
        });
    }

    function normalizeSurfaceLinks() {
        const domains = window.VelveraHubDomains;
        document.querySelectorAll('a[href="/?account=login"], a[href="/?account=register"]').forEach((link) => {
            const intent = new URL(link.href, window.location.origin).searchParams.get('account') || 'login';
            const mode = intent === 'register' ? 'register' : 'login';
            link.href = domains?.publicUrl
                ? domains.publicUrl(`/veeve/auth.html?mode=${mode}`)
                : `/pages/auth.html?mode=${mode}`;
        });
        if (!domains) return;

        if (domains.currentSurface() === 'shop') {
            const region = window.RegionService?.region === 'uk' ? 'uk' : 'ng';
            document.querySelectorAll('.shared-footer a[href^="/pages/"]').forEach((link) => {
                const storefrontPath = link.getAttribute('href').replace(/^\/pages\//, '/veeve/');
                link.href = domains.publicUrl(storefrontPath, region);
            });
        }

        document.querySelectorAll('[data-surface-target="seller"]').forEach((link) => {
            link.href = '/pages/seller.html';
        });
        document.querySelectorAll('a[href^="/pages/sell.html"], a[href^="/dashboards/shop-owner"]').forEach((link) => {
            if (link.closest('.mobile-bottom-nav')) return;
            link.href = link.getAttribute('href').startsWith('/dashboards/shop-owner')
                ? domains.shopOwnerUrl('/')
                : '/pages/seller.html';
        });
        document.querySelectorAll('[data-surface-target="shop-owner"]').forEach((link) => {
            link.href = domains.shopOwnerUrl('/');
        });
        document.querySelectorAll('a[href^="/dashboards/admin"]').forEach((link) => {
            link.href = domains.adminUrl('/');
        });
    }

    function setMeta(attribute, value, content) {
        if (!content) return;
        let tag = document.head.querySelector(`meta[${attribute}="${value}"]`);
        if (!tag) {
            tag = document.createElement('meta');
            tag.setAttribute(attribute, value);
            document.head.appendChild(tag);
        }
        tag.setAttribute('content', content);
    }

    async function syncSeoMetadata() {
        try {
            let seo = null;
            if (window.supabaseConfigReady) await window.supabaseConfigReady;
            const supabase = window.SupabaseClient?.get();
            if (supabase && window.SupabaseClient.isConfigured()) {
                const { data, error } = await supabase
                    .from('site_settings')
                    .select('site_name, meta_title, meta_description, keywords, canonical_base_url, og_title, og_description, og_image_url, og_image_alt, locale, robots')
                    .eq('id', 'seo')
                    .maybeSingle();
                if (error) throw error;
                if (data) {
                    seo = {
                        siteName: data.site_name,
                        title: data.meta_title,
                        description: data.meta_description,
                        keywords: data.keywords,
                        canonicalBaseUrl: data.canonical_base_url,
                        ogTitle: data.og_title,
                        ogDescription: data.og_description,
                        ogImageUrl: data.og_image_url,
                        ogImageAlt: data.og_image_alt,
                        locale: data.locale,
                        robots: data.robots
                    };
                }
            } else if (!window.VELVERAHUB_CONFIG?.STATIC_ONLY) {
                const apiFetch = window.VelveraAPI?.fetch || fetch;
                const response = await apiFetch('/api/seo', { cache: 'no-store' });
                if (response.ok) seo = await response.json();
            }
            if (!seo) return;
            document.title = seo.title || document.title;
            setMeta('name', 'description', seo.description);
            setMeta('name', 'keywords', seo.keywords);
            setMeta('name', 'robots', seo.robots);
            setMeta('property', 'og:title', seo.ogTitle);
            setMeta('property', 'og:description', seo.ogDescription);
            setMeta('property', 'og:site_name', seo.siteName);
            setMeta('property', 'og:locale', seo.locale);
            setMeta('property', 'og:url', `${seo.canonicalBaseUrl || window.location.origin}${window.location.pathname}`);
            setMeta('property', 'og:image', seo.ogImageUrl);
            setMeta('property', 'og:image:alt', seo.ogImageAlt);
            setMeta('name', 'twitter:title', seo.ogTitle);
            setMeta('name', 'twitter:description', seo.ogDescription);
            setMeta('name', 'twitter:image', seo.ogImageUrl);
            let canonical = document.head.querySelector('link[rel="canonical"]');
            if (!canonical) {
                canonical = document.createElement('link');
                canonical.rel = 'canonical';
                document.head.appendChild(canonical);
            }
            canonical.href = `${seo.canonicalBaseUrl || window.location.origin}${window.location.pathname}`;
        } catch (_) {
            // Static metadata remains available when the API is unavailable.
        }
    }

    function setupProductNavigation() {
        document.addEventListener('click', (event) => {
            const actionTarget = event.target.closest('[data-action="view-product"]');
            const card = event.target.closest('.product-card[data-product-id]');
            if (!actionTarget && !card) return;
            if (event.target.closest('button, a, [data-action]:not([data-action="view-product"])')) return;
            const productId = actionTarget?.dataset.productId || card?.dataset.productId;
            if (!productId) return;
            const productUrl = window.VelveraHubDomains?.productUrl?.(productId)
                || `/pages/product.html?id=${encodeURIComponent(productId)}`;
            window.location.assign(productUrl);
        });
    }

    function ensureAuthService() {
        if (window.AuthService) return window.AuthService.init?.();
        const navScript = [...document.scripts].find((script) => script.src.includes('/components/site-navigation.js'));
        const authUrl = navScript
            ? new URL('../services/auth.js', navScript.src).href
            : '/assets/js/services/auth.js';
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = authUrl;
            script.onload = () => window.AuthService?.init?.().then(resolve, reject);
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    function init() {
        removeHeaderCategorySelectors();
        ensureCategorySelectors();
        if (!document.querySelector('link[data-cookie-consent-styles]')) {
            const style = document.createElement('link');
            style.rel = 'stylesheet';
            style.href = '/assets/css/components/cookie-consent.css';
            style.dataset.cookieConsentStyles = 'true';
            document.head.appendChild(style);
        }
        if (!window.CookieConsent) {
            const script = document.createElement('script');
            script.src = '/assets/js/components/cookie-consent.js';
            script.defer = true;
            document.head.appendChild(script);
        }
        ensureAuthService().catch((error) => {
            window.Observability?.reportError('shared-auth-init', `shared-auth-${Date.now().toString(36)}`, error, { source: 'site-navigation' });
        });
        document.querySelectorAll('.navbar').forEach((navbar) => {
            ensureRegionBadge(navbar);
            ensureHeaderControls(navbar);
            const currentDirectory = navbar.querySelector('.category-nav');
            if (currentDirectory) {
                currentDirectory.outerHTML = routeDirectory();
            } else {
                navbar.insertAdjacentHTML('beforeend', routeDirectory());
            }
        });
        ensureRegionModal();
        ensureFooterStyles();
        ensureSharedFooter();
        setupCollapsibleFooter();
        normalizeBranding().finally(optimizeImages);
        optimizeImages();
        syncRegionBadge();
        document.addEventListener('click', (event) => {
            if (event.target.closest('#regionBadgeBtn')) {
                document.getElementById('regionModal')?.classList.add('active');
            }
        });
        normalizeBrowseLinks();
        normalizeSurfaceLinks();
        setupProductNavigation();
        syncSeoMetadata();
    }

    document.addEventListener('DOMContentLoaded', init, { once: true });
})();