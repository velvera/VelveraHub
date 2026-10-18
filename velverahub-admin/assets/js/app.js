document.addEventListener('DOMContentLoaded', async function() {
    const authIntent = new URLSearchParams(window.location.search).get('account');
    if (authIntent === 'login' || authIntent === 'register') {
        const redirect = `${window.location.pathname}${window.location.hash}`;
        const authUrl = new URL('/veeve/auth.html', window.location.origin);
        authUrl.searchParams.set('mode', authIntent);
        if (redirect !== '/') authUrl.searchParams.set('redirect', redirect);
        window.location.replace(authUrl.toString());
        return;
    }

    CartService.init();
    Store.loadWishlist();

    initRegion();
    const configPromise = window.SupabaseClient?.loadConfig?.() || Promise.resolve();
    const locationsPromise = window.RegionService?.loadAvailableLocations?.() || Promise.resolve();
    const marketPromise = window.RegionService?.loadMarketContext?.() || Promise.resolve();
    const authPromise = window.AuthService?.init?.() || Promise.resolve();
    await Promise.allSettled([configPromise, locationsPromise, marketPromise, authPromise]);
    window.RegionService?.syncLocationSelect(document.getElementById('locationSelect'));
    window.RegionService?.syncLocationSelect(document.getElementById('headerLocationSelect'));
    window.addEventListener('velveraLocationChange', () => {
        ymlRequestId++;
        ymlLoading = false;
        ymlPage = 0;
        ymlHasMore = true;
        window.RegionService?.loadMarketContext();
        const container = document.getElementById('youMayLike');
        if (container) container.innerHTML = '';
        loadPopularInRegion();
        loadYouMayLike(true);
    });

    const businessState = document.getElementById('businessState');
    if (businessState && window.RegionService) {
        window.RegionService.appendLocationOptions(businessState, false);
        businessState.insertAdjacentHTML('afterbegin', '<option value="">Select state</option>');
        businessState.value = '';
        window.CustomSelect?.refresh(businessState);
    }

    await loadInitialData();
    initHeroSlider();
    initEventListeners();
    updateAuthUI();
    updateCartUI();
    console.log('VelveraHub initialized successfully!');
});

function initRegion() {
    const region = window.RegionService;
    if (!region) return;

    const flag = document.getElementById('regionFlag');
    const name = document.getElementById('regionName');
    if (flag) flag.textContent = region.flag;
    if (name) name.textContent = region.countryName;

    const currentRegion = region.region;
    const ngBtn = document.getElementById('regionNG');
    const ukBtn = document.getElementById('regionUK');
    if (ngBtn && currentRegion === 'ng') ngBtn.classList.add('active');
    if (ukBtn && currentRegion === 'uk') ukBtn.classList.add('active');

    const bannerShipping = document.querySelectorAll('.banner-shipping');
    bannerShipping.forEach(el => {
        el.textContent = `Free Shipping on Orders Over ${region.formatShippingThreshold()}`;
    });

    const regionBadgeBtn = document.getElementById('regionBadgeBtn');
    const regionModal = document.getElementById('regionModal');

    regionBadgeBtn?.addEventListener('click', () => {
        regionModal?.classList.add('active');
    });

    regionModal?.addEventListener('click', (e) => {
        if (e.target === regionModal) {
            regionModal.classList.remove('active');
        }
    });
}

async function loadInitialData() {
    await Promise.all([
        loadPopularInRegion(),
        loadYouMayLike(true)
    ]);
}

async function loadPopularInRegion() {
    const region = window.RegionService;
    const isNG = !region || region.region === 'ng';

    const headerEl = document.getElementById('popularHeader');
    const flagEl = document.getElementById('popularFlag');
    const titleEl = document.getElementById('popularTitle');
    const container = document.getElementById('popularProducts');

    if (!container) return;

    if (flagEl) flagEl.textContent = isNG ? '🇳🇬' : '🇬🇧';
    if (titleEl) titleEl.textContent = isNG ? 'Popular in Nigeria' : 'Popular in UK';

    let products = [];
    try {
        const result = await ProductsService.getProducts({
            filter: 'bestseller',
            limit: 19,
            location: region?.location
        });
        products = result.data || [];
    } catch (error) {
        window.AsyncFeedback?.log('popular-products-load', window.AsyncFeedback?.createRequestId('popular-products-load'), error);
    }

    container.innerHTML = products.length ? products.map(p => `
        <a href="${p.id ? (window.VelveraHubDomains?.productUrl?.(p.id) || `/veeve/product.html?id=${encodeURIComponent(p.id)}`) : '#'}" class="popular-card">
            <div class="popular-card-image">
            ${window.responsiveImageMarkup ? responsiveImageMarkup(p, { width: 420, height: 420 }) : `<img src="${ProductsService.getProductImage(p)}" alt="${p.title || 'Product'}" loading="lazy" decoding="async" />`}
            </div>
            <div class="popular-card-info">
                <div class="popular-card-price">${window.RegionService?.formatPrice(p.price) || p.price}</div>
            </div>
        </a>
    `).join('') : `
            <div class="location-empty-state">
            <i class="fas fa-location-dot"></i>
            <strong>No live products are available in ${region?.locationLabel || 'this area'} yet</strong>
            <span>Try another location or check back after sellers publish listings.</span>
        </div>
    `;
}

/* ── You May Like (live Supabase products only) ───────────────────── */

let ymlPage = 0;
const YML_PAGE_SIZE = 20;
let ymlLoading = false;
let ymlHasMore = true;
let ymlRequestId = 0;

function renderYmlCard(p) {
    return `
            <a class="yml-card" href="${window.VelveraHubDomains?.productUrl?.(p.id) || `/veeve/product.html?id=${encodeURIComponent(p.id)}`}" data-product-id="${p.id}" data-category="${p.category || ''}">
            <div class="yml-card-image">
                ${window.responsiveImageMarkup ? responsiveImageMarkup(p, { width: 420, height: 420 }) : `<img src="${p.image}" alt="${p.title}" loading="lazy" decoding="async" />`}
            </div>
            <div class="yml-card-info">
                <div class="yml-card-title">${p.title}</div>
                <div class="yml-card-price">${p.price}</div>
                <div class="yml-card-moq">${p.moq}</div>
                ${window.DeliveryPromiseEngine ? window.DeliveryPromiseEngine.render(p) : ''}
            </div>
        </a>
    `;
}

async function loadYouMayLike(initial = false) {
    if (ymlLoading || !ymlHasMore) return;

    const container = document.getElementById('youMayLike');
    const spinner = document.getElementById('ymlSpinner');
    const endEl = document.getElementById('ymlEnd');
    if (!container) return;

    const requestId = ++ymlRequestId;
    ymlLoading = true;
    if (spinner) spinner.style.display = 'flex';
    if (initial && endEl) endEl.style.display = 'none';

    await new Promise(r => setTimeout(r, initial ? 200 : 600));

    try {
        const pageSize = initial ? 40 : YML_PAGE_SIZE;
        const offset = initial ? 0 : (ymlPage * YML_PAGE_SIZE) + 40;
        const result = await ProductsService.getProducts({
            limit: pageSize,
            offset,
            sort: 'newest',
            location: window.RegionService?.location
        });
        if (requestId !== ymlRequestId) return;
        let products = (result.data || []).map(p => ({
            ...p,
            id: p.id,
            title: p.title,
            price: window.RegionService ? window.RegionService.formatPrice(p.price) : `₦${p.price}`,
            moq: p.min_order || '1 Piece',
            image: ProductsService.getProductImage(p)
        }));
        products = window.MarketplaceIntelligence?.rankProducts(products) || products;

        if (products.length === 0) {
            ymlHasMore = false;
        } else {
            container.insertAdjacentHTML('beforeend', products.map(renderYmlCard).join(''));
            if (!initial) ymlPage++;
            const loadedThrough = offset + products.length;
            ymlHasMore = result.total != null && Number.isFinite(Number(result.total))
                ? loadedThrough < Number(result.total)
                : products.length === pageSize;
        }
    } catch (err) {
        if (requestId !== ymlRequestId) return;
        window.AsyncFeedback?.log('recommendations-load', window.AsyncFeedback?.createRequestId('recommendations-load'), err);
        ymlHasMore = false;
        container.innerHTML = `
            <div class="location-empty-state">
                <i class="fas fa-cloud-arrow-down"></i>
                <strong>Live recommendations are temporarily unavailable</strong>
                <span>Please try again shortly.</span>
            </div>`;
    }

    if (requestId === ymlRequestId) {
        if (spinner) spinner.style.display = 'none';
        if (!ymlHasMore && endEl) endEl.style.display = 'block';
        ymlLoading = false;
    }
}

function initYmlInfiniteScroll() {
    const sentinel = document.getElementById('ymlSentinel');
    if (!sentinel) return;

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !ymlLoading && ymlHasMore) {
                loadYouMayLike(false);
            }
        });
    }, { rootMargin: '400px' });

    observer.observe(sentinel);
}

/* ── Hero Slider ───────────────────── */
function initHeroSlider() {
    const slides = document.querySelectorAll('.hero-slide');
    const dotsContainer = document.getElementById('heroDots');
    const prevBtn = document.querySelector('.hero-prev');
    const nextBtn = document.querySelector('.hero-next');
    const slider = document.getElementById('heroSlider');

    if (!slides.length || !dotsContainer) return;

    let currentSlide = 0;
    let autoSlideInterval;
    const motionPreference = window.matchMedia?.('(prefers-reduced-motion: reduce)');

    slides.forEach((_, i) => {
        const dot = document.createElement('button');
        dot.className = `hero-dot ${i === 0 ? 'active' : ''}`;
        dot.type = 'button';
        dot.setAttribute('aria-label', `Show featured message ${i + 1}`);
        dot.addEventListener('click', () => {
            goToSlide(i);
            stopAutoSlide();
            startAutoSlide();
        });
        dotsContainer.appendChild(dot);
    });

    const dots = dotsContainer.querySelectorAll('.hero-dot');

    function goToSlide(index) {
        slides[currentSlide].classList.remove('active');
        dots[currentSlide].classList.remove('active');
        currentSlide = index;
        if (currentSlide >= slides.length) currentSlide = 0;
        if (currentSlide < 0) currentSlide = slides.length - 1;
        slides[currentSlide].classList.add('active');
        dots[currentSlide].classList.add('active');
    }

    function nextSlide() { goToSlide(currentSlide + 1); }
    function prevSlide() { goToSlide(currentSlide - 1); }
    function startAutoSlide() {
        stopAutoSlide();
        if (
            motionPreference?.matches ||
            document.hidden ||
            slider?.matches(':hover') ||
            slider?.contains(document.activeElement)
        ) return;
        autoSlideInterval = window.setInterval(nextSlide, 7000);
    }
    function stopAutoSlide() { clearInterval(autoSlideInterval); }

    prevBtn?.addEventListener('click', () => { prevSlide(); stopAutoSlide(); startAutoSlide(); });
    nextBtn?.addEventListener('click', () => { nextSlide(); stopAutoSlide(); startAutoSlide(); });
    slider?.addEventListener('pointerenter', stopAutoSlide);
    slider?.addEventListener('pointerleave', startAutoSlide);
    slider?.addEventListener('focusin', stopAutoSlide);
    slider?.addEventListener('focusout', (event) => {
        if (!slider.contains(event.relatedTarget)) startAutoSlide();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopAutoSlide();
        else startAutoSlide();
    });
    motionPreference?.addEventListener?.('change', () => startAutoSlide());

    startAutoSlide();

    setTimeout(initYmlInfiniteScroll, 500);
}

/* ── Event Listeners ───────────────────── */
function initEventListeners() {
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const mobileMenu = document.getElementById('mobileMenu');
    const mobileMenuOverlay = document.getElementById('mobileMenuOverlay');
    const mobileMenuClose = document.getElementById('mobileMenuClose');

    function openMobileMenu() {
        mobileMenu?.classList.add('active');
        mobileMenuOverlay?.classList.add('active');
        mobileMenu?.setAttribute('role', 'dialog');
        mobileMenu?.setAttribute('aria-modal', 'true');
        mobileMenu?.setAttribute('aria-label', 'Main menu');
        document.body.style.overflow = 'hidden';
        if (mobileMenu) mobileMenu.__velveraFocusTrigger = mobileMenuBtn;
        window.VelveraFocusManager?.open(mobileMenu, { trigger: mobileMenuBtn, trap: true });
    }

    function closeMobileMenu() {
        mobileMenu?.classList.remove('active');
        mobileMenuOverlay?.classList.remove('active');
        document.body.style.overflow = '';
        window.VelveraFocusManager?.close(mobileMenu, mobileMenu?.__velveraFocusTrigger || mobileMenuBtn);
    }

    mobileMenuBtn?.addEventListener('click', openMobileMenu);
    mobileMenuClose?.addEventListener('click', closeMobileMenu);
    mobileMenuOverlay?.addEventListener('click', closeMobileMenu);

    const cartBtn = document.getElementById('cartBtn');
    const cartSidebar = document.getElementById('cartSidebar');
    const cartOverlay = document.getElementById('cartOverlay');
    const cartClose = document.getElementById('cartClose');
    const continueShoppingBtn = document.getElementById('continueShoppingBtn');

    function openCart(event) {
        const focusTrigger = event?.currentTarget || document.activeElement;
        cartSidebar?.classList.add('active');
        cartOverlay?.classList.add('active');
        cartSidebar?.setAttribute('role', 'dialog');
        cartSidebar?.setAttribute('aria-modal', 'true');
        cartSidebar?.setAttribute('aria-label', 'Shopping cart');
        document.body.style.overflow = 'hidden';
        if (cartSidebar) cartSidebar.__velveraFocusTrigger = focusTrigger;
        window.VelveraFocusManager?.open(cartSidebar, {
            trigger: focusTrigger,
            trap: true
        });
        updateCartUI();
    }

    function closeCart() {
        cartSidebar?.classList.remove('active');
        cartOverlay?.classList.remove('active');
        document.body.style.overflow = '';
        window.VelveraFocusManager?.close(
            cartSidebar,
            cartSidebar?.__velveraFocusTrigger
        );
    }

    cartBtn?.addEventListener('click', openCart);
    cartClose?.addEventListener('click', closeCart);
    cartOverlay?.addEventListener('click', closeCart);
    continueShoppingBtn?.addEventListener('click', closeCart);

    document.getElementById('bottomCartBtn')?.addEventListener('click', openCart);
    document.getElementById('bottomAccountBtn')?.addEventListener('click', () => {
        document.getElementById('accountBtn')?.click();
    });

    const accountBtn = document.getElementById('accountBtn');
    const authModal = document.getElementById('authModal');
    const authModalClose = document.getElementById('authModalClose');
    const mobileLoginBtn = document.getElementById('mobileLoginBtn');
    const mobileRegisterBtn = document.getElementById('mobileRegisterBtn');

    function openAuthModal(tab = 'login') {
        const redirect = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        const params = new URLSearchParams({ mode: tab, redirect });
        window.location.assign(`/pages/auth.html?${params.toString()}`);
    }

    function closeAuthModal() {
        authModal?.classList.remove('active');
        window.VelveraFocusManager?.close(authModal);
    }

    accountBtn?.addEventListener('click', (event) => {
        event.preventDefault();
        window.location.assign('/pages/account.html');
    });

    authModalClose?.addEventListener('click', closeAuthModal);
    authModal?.querySelector('.modal-overlay')?.addEventListener('click', closeAuthModal);

    mobileLoginBtn?.addEventListener('click', (e) => { e.preventDefault(); openAuthModal('login'); });
    mobileRegisterBtn?.addEventListener('click', (e) => { e.preventDefault(); openAuthModal('register'); });

    const authTabs = document.querySelectorAll('.auth-tab');
    authTabs.forEach(tab => {
        tab.addEventListener('click', () => switchAuthTab(tab.dataset.tab));
    });

    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const sellerDetails = document.getElementById('sellerDetails');
    const accountTypeInputs = document.querySelectorAll('input[name="accountType"]');

    function syncSellerFields() {
        const isSeller = document.querySelector('input[name="accountType"]:checked')?.value === 'seller';
        sellerDetails?.classList.toggle('is-visible', isSeller);
        document.getElementById('businessName')?.toggleAttribute('required', isSeller);
        document.getElementById('businessState')?.toggleAttribute('required', isSeller);
    }

    accountTypeInputs.forEach((input) => input.addEventListener('change', syncSellerFields));
    syncSellerFields();

    loginForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;
        const submitBtn = loginForm.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Signing in...';
        try {
            const { error } = await AuthService.signIn(email, password);
            if (error) {
                UI.showToast(window.AsyncFeedback?.errorMessage(error, 'Sign-in could not be completed. Please try again.', 'auth-sign-in') || 'Sign-in could not be completed. Please try again.', 'error');
                return;
            }
            UI.showToast('Welcome back!', 'success');
            closeAuthModal();
            updateAuthUI();
            if (AuthService.isSellerAccount?.()) {
                window.location.assign(window.VelveraHubDomains?.sellerUrl?.('/') || '/pages/seller.html');
            }
        } catch (error) {
            UI.showToast(window.AsyncFeedback?.errorMessage(error, 'Sign-in could not be completed. Please try again.', 'auth-sign-in') || 'Sign-in could not be completed. Please try again.', 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Sign In';
        }
    });

    registerForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('regEmail')?.value?.trim();
        const password = document.getElementById('regPassword')?.value;
        const accountTypeRadio = document.querySelector('input[name="accountType"]:checked');
        const accountType = accountTypeRadio ? accountTypeRadio.value : 'customer';
        const businessName = document.getElementById('businessName')?.value?.trim() || '';
        const businessState = document.getElementById('businessState')?.value || '';
        const businessPhone = document.getElementById('businessPhone')?.value?.trim() || '';
        const agreeTerms = document.getElementById('agreeTerms')?.checked;
        const ageConfirmed = document.getElementById('ageConfirmed')?.checked;

        if (!email) { UI.showToast('Please enter your email address', 'warning'); return; }
        if (!password || password.length < 8) { UI.showToast('Password must be at least 8 characters', 'warning'); return; }
        if (accountType === 'seller' && (!businessName || !businessState)) {
            UI.showToast('Add your business name and state to open a store', 'warning');
            return;
        }
        if (!agreeTerms) { UI.showToast('Please agree to the terms and conditions', 'warning'); return; }
        if (!ageConfirmed) { UI.showToast('You must confirm that you are at least 18 to create an account.', 'warning'); return; }

        const submitBtn = registerForm.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating account...';
        try {
            const { data, error } = await AuthService.signUp(email, password, {
                accountType,
                ageConfirmed,
                termsAccepted: agreeTerms,
                businessName,
                businessState,
                businessPhone
            });
            if (error) {
                UI.showToast(window.AsyncFeedback?.errorMessage(error, 'Account creation could not be completed. Please try again.', 'auth-sign-up') || 'Account creation could not be completed. Please try again.', 'error');
                return;
            }
            if (data && accountType === 'seller') {
                UI.showToast('Seller account created. Opening your workspace…', 'success');
                window.location.assign(window.VelveraHubDomains?.sellerUrl?.('/') || '/pages/seller.html');
            } else if (data) {
                UI.showToast('Account created successfully!', 'success');
                closeAuthModal();
                updateAuthUI();
            } else {
                UI.showToast('Account created. Check your email to verify it, then sign in.', 'success');
                switchAuthTab('login');
            }
        } catch (error) {
            UI.showToast(window.AsyncFeedback?.errorMessage(error, 'Account creation could not be completed. Please try again.', 'auth-sign-up') || 'Account creation could not be completed. Please try again.', 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Create Account';
        }
    });

    const regPassword = document.getElementById('regPassword');
    const passwordStrength = document.getElementById('passwordStrength');
    regPassword?.addEventListener('input', () => {
        const strength = calculatePasswordStrength(regPassword.value);
        passwordStrength.className = 'password-strength ' + strength;
    });

    const searchInput = document.getElementById('searchInput');
    const searchBtn = document.getElementById('searchBtn');

    /*
     * Search is owned by smart-features.js. Keeping a second handler here
     * caused one click to both render homepage results and navigate away.
     */

    document.addEventListener('click', async (e) => {
        const target = e.target.closest('[data-action]');
        if (!target) return;

        const action = target.dataset.action;
        const productId = target.dataset.productId;

        switch (action) {
            case 'add-to-cart':
                await addToCart(productId);
                break;
            case 'wishlist':
                toggleWishlist(target, productId);
                break;
            case 'quickview':
                await showQuickView(productId);
                break;
            case 'increase':
                CartService.updateQuantity(productId, getCartItemQuantity(productId) + 1);
                updateCartUI();
                break;
            case 'decrease':
                CartService.updateQuantity(productId, getCartItemQuantity(productId) - 1);
                updateCartUI();
                break;
            case 'remove':
                CartService.removeItem(productId);
                updateCartUI();
                UI.showToast('Item removed from cart', 'info');
                break;
        }
    });

    window.addEventListener('cartUpdate', updateCartUI);
}

function switchAuthTab(tab) {
    document.querySelectorAll('.auth-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tab);
    });
    document.querySelectorAll('.auth-form').forEach(f => {
        f.classList.toggle('active', f.dataset.form === tab);
    });
}

function calculatePasswordStrength(password) {
    if (password.length < 6) return 'weak';
    let score = 0;
    if (password.length >= 8) score++;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[^a-zA-Z0-9]/.test(password)) score++;
    if (score <= 1) return 'weak';
    if (score === 2) return 'fair';
    if (score === 3) return 'good';
    return 'strong';
}

async function addToCart(productId) {
    if (!productId) return;
    try {
        const { data: product } = await ProductsService.getProduct(productId);
        if (product) {
            CartService.addItem({ id: product.id, title: product.title, price: product.price, image: product.product_images?.[0]?.url, shop_name: product.shops?.name });
            updateCartUI();
            UI.showToast(`${product.title} added to cart!`, 'success');
        }
    } catch (error) {
        window.AsyncFeedback?.log('add-to-cart', window.AsyncFeedback?.createRequestId('add-to-cart'), error, { product_id: productId });
        UI.showToast('Failed to add item to cart', 'error');
    }
}

function toggleWishlist(btn, productId) {
    const isActive = btn.classList.toggle('active');
    const count = Store.toggleWishlist(productId);
    const wishlistCount = document.getElementById('wishlistCount');
    if (wishlistCount) wishlistCount.textContent = count;
    UI.showToast(isActive ? 'Added to wishlist!' : 'Removed from wishlist', isActive ? 'success' : 'info');
}

function getCartItemQuantity(productId) {
    const item = CartService.getCart().find(i => (i.product || i).id == productId);
    return item ? (Number(item.quantity) || 1) : 0;
}

async function showQuickView(productId) {
    const modal = document.getElementById('quickViewModal');
    const content = document.getElementById('quickViewContent');
    if (!modal || !content) return;

    modal.classList.add('active');
    window.VelveraFocusManager?.open(modal, { trigger: document.activeElement, trap: true });
    content.innerHTML = '<div style="text-align:center;padding:3rem;"><i class="fas fa-spinner fa-spin" style="font-size:2rem;color:var(--primary);"></i></div>';

    const { data: product } = await ProductsService.getProduct(productId);
    if (product) {
        content.innerHTML = UI.renderQuickView(product);
    }
}

function updateAuthUI() {
    const accountBtn = document.getElementById('accountBtn');
    const mobileLoginBtn = document.getElementById('mobileLoginBtn');
    const mobileRegisterBtn = document.getElementById('mobileRegisterBtn');

    if (AuthService.isLoggedIn()) {
        const user = AuthService.getUser();
        if (accountBtn) {
            accountBtn.innerHTML = `<i class="fas fa-user-circle"></i><span class="icon-label">Account</span>`;
        }
        if (mobileLoginBtn) mobileLoginBtn.style.display = 'none';
        if (mobileRegisterBtn) mobileRegisterBtn.style.display = 'none';
    } else {
        if (mobileLoginBtn) mobileLoginBtn.style.display = '';
        if (mobileRegisterBtn) mobileRegisterBtn.style.display = '';
    }
}

function updateCartUI() {
    const cart = CartService.getCart();
    const totalItems = CartService.getItemCount();
    const subtotal = CartService.getSubtotal();
    const shipping = CartService.getShipping();
    const total = subtotal + shipping;

    const cartCount = document.getElementById('cartCount');
    if (cartCount) cartCount.textContent = totalItems;

    const bottomCartBadge = document.getElementById('bottomCartBadge');
    if (bottomCartBadge) {
        bottomCartBadge.textContent = totalItems;
        bottomCartBadge.style.display = totalItems > 0 ? 'flex' : 'none';
    }

    const cartSubtotal = document.getElementById('cartSubtotal');
    const cartShipping = document.getElementById('cartShipping');
    const cartTotal = document.getElementById('cartTotal');
    const cartItems = document.getElementById('cartItems');

    const fmtPrice = (amount) => window.RegionService ? window.RegionService.formatPrice(amount) : `$${amount.toFixed(2)}`;

    if (cartSubtotal) cartSubtotal.textContent = fmtPrice(subtotal);
    if (cartShipping) cartShipping.textContent = shipping === 0 ? 'Free' : fmtPrice(shipping);
    if (cartTotal) cartTotal.textContent = fmtPrice(total);

    if (cartItems) {
        if (cart.length === 0) {
            cartItems.innerHTML = `
                <div class="cart-empty">
                    <i class="fas fa-shopping-cart"></i>
                    <h4>Your cart is empty</h4>
                    <p>Add items to your cart to see them here.</p>
                </div>
            `;
        } else {
            cartItems.innerHTML = cart.map(item => {
                const product = item.product || item;
                const quantity = Number(item.quantity) || 1;
                return `
                <div class="cart-item">
                    <div class="cart-item-image">
                        <img src="${product.product_images?.[0]?.url || product.image || product.image_url || '/img/basket.png'}" alt="${product.title || 'Product'}" />
                    </div>
                    <div class="cart-item-info">
                        <div class="cart-item-title">${product.title || 'Product'}</div>
                        <div class="cart-item-shop">${product.shops?.name || product.shop_name || 'VelveraHub Store'}</div>
                        <div class="cart-item-price">${fmtPrice((Number(product.price) || 0) * quantity)}</div>
                        <div class="cart-item-controls">
                            <button class="cart-qty-btn" data-action="decrease" data-product-id="${product.id}"><i class="fas fa-minus"></i></button>
                            <span class="cart-item-qty">${quantity}</span>
                            <button class="cart-qty-btn" data-action="increase" data-product-id="${product.id}"><i class="fas fa-plus"></i></button>
                        </div>
                    </div>
                    <button class="cart-item-remove" data-action="remove" data-product-id="${product.id}"><i class="fas fa-times"></i></button>
                </div>
            `;
            }).join('');
        }
    }
}

function showAccountMenu() {
    const existing = document.getElementById('accountMenu');
    if (existing) {
        existing.remove();
        return;
    }
    const profile = AuthService.getProfile() || AuthService.getUser() || {};
    const displayName = profile.first_name || profile.firstName || profile.email?.split('@')[0] || 'Shopper';
    const menu = document.createElement('div');
    menu.id = 'accountMenu';
    menu.className = 'account-popover';
    menu.innerHTML = `
        <div class="account-popover-header">
            <strong>${displayName}</strong>
            <small>${profile.email || 'Signed in'}</small>
        </div>
        <a href="/pages/products.html"><i class="fas fa-bag-shopping"></i> Continue shopping</a>
        ${AuthService.isSeller() ? `<a href="/pages/seller.html"><i class="fas fa-store"></i> Seller workspace</a>` : ''}
        ${AuthService.isAdmin() ? `<a href="${window.VelveraHubDomains?.adminUrl('/') || '/dashboards/admin/'}"><i class="fas fa-shield-halved"></i> Admin dashboard</a>` : ''}
        <button type="button" data-account-action="signout"><i class="fas fa-right-from-bracket"></i> Sign out</button>
    `;
    const account = document.getElementById('accountBtn');
    account?.parentElement?.appendChild(menu);
    menu.querySelector('[data-account-action="signout"]')?.addEventListener('click', async () => {
        await AuthService.signOut();
        menu.remove();
        updateAuthUI();
        UI.showToast('You have been signed out.', 'success');
    });
    setTimeout(() => {
        const close = (event) => {
            if (!menu.contains(event.target) && !account?.contains(event.target)) {
                menu.remove();
                document.removeEventListener('click', close);
            }
        };
        document.addEventListener('click', close);
    }, 0);
}

async function filterByCategory(category) {
    const ymlContainer = document.getElementById('youMayLike');
    if (!ymlContainer) return;
    ymlContainer.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:2rem;"><i class="fas fa-spinner fa-spin" style="font-size:2rem;color:var(--primary);"></i></div>';

    const { data: products } = await ProductsService.getProducts({ category, limit: 20 });
    if (products && products.length > 0) {
        ymlContainer.innerHTML = products.map(p => renderYmlCard({
            id: p.id, title: p.title,
            price: window.RegionService ? window.RegionService.formatPrice(p.price) : `$${p.price}`,
            moq: '1 Piece', image: p.product_images?.[0]?.url || ''
        })).join('');
    } else {
        ymlContainer.innerHTML = `
            <div class="location-empty-state">
                <i class="fas fa-box-open"></i>
                <strong>No live products found in this category</strong>
                <span>Try another category or check back after sellers publish listings.</span>
            </div>`;
    }
    document.querySelector('.you-may-like-section')?.scrollIntoView({ behavior: 'smooth' });
}
