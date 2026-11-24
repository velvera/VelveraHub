function escapeProductHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[character]));
}

function safeMediaUrl(value, fallback = '/img/product-placeholder.svg') {
    const candidate = String(value ?? '').trim();
    if (!candidate) return fallback;
    try {
        const parsed = new URL(candidate, window.location.origin);
        if (parsed.protocol === 'https:' || parsed.origin === window.location.origin) {
            return candidate;
        }
    } catch (_) {
        // Invalid media URLs use the local basket placeholder instead.
    }
    return fallback;
}

function responsiveImageMarkup(product, options = {}) {
    const width = Number(options.width || 480);
    const height = Number(options.height || 480);
    const sources = window.ProductsService?.getProductImageSources(product, {
        width,
        height,
        fallback: options.fallback || '/img/product-placeholder.svg'
    }) || { original: options.fallback || '/img/product-placeholder.svg' };
    const original = safeMediaUrl(sources.original, options.fallback || '/img/product-placeholder.svg');
    const alt = escapeProductHtml(options.alt || product?.title || 'Product');
    const className = options.className ? ` class="${escapeProductHtml(options.className)}"` : '';
    const sourceMarkup = [
        sources.avif ? `<source type="image/avif" srcset="${escapeProductHtml(sources.avif)}">` : '',
        sources.webp ? `<source type="image/webp" srcset="${escapeProductHtml(sources.webp)}">` : ''
    ].join('');
    return `<picture>${sourceMarkup}<img${className} src="${escapeProductHtml(original)}" alt="${alt}" width="${width}" height="${height}" loading="${options.loading || 'lazy'}" decoding="async" onerror="this.onerror=null;this.src='/img/product-placeholder.svg';"></picture>`;
}
window.responsiveImageMarkup = responsiveImageMarkup;

const UI = {
    showToast(message, type = 'info', duration = 3000) {
        const container = document.getElementById('toastContainer');
        if (!container) return;

        let displayMessage = String(message ?? '');
        if (type === 'error' || type === 'warning') {
            const technical = /supabase|postgrest|postgres|schema cache|schema|migration|sqlstate|pgrst\d|database error|permission denied|could not find the table|could not find the .+ column|relation .+ does not exist|column .+ does not exist|constraint|duplicate key|violates|stack trace|internal server|http\s*\d{3}|status code|failed to fetch|econn(?:refused|reset|timedout)?/i;
            if (technical.test(displayMessage) || displayMessage.length > 300) {
                const diagnostic = new Error(displayMessage);
                const requestId = window.AsyncFeedback?.createRequestId('user-notification') || `notify-${Date.now().toString(36)}`;
                window.Observability?.reportError('user-notification', requestId, diagnostic, { source: 'toast' });
                displayMessage = window.Observability?.userMessage?.(
                    diagnostic,
                    'We could not complete that request. Please try again.'
                ) || 'We could not complete that request. Please try again.';
            }
        }
        
        const icons = {
            success: 'fa-check-circle',
            error: 'fa-exclamation-circle',
            warning: 'fa-exclamation-triangle',
            info: 'fa-info-circle'
        };
        
        const titles = {
            success: 'Success',
            error: 'Error',
            warning: 'Warning',
            info: 'Info'
        };
        
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        const iconContainer = document.createElement('div');
        iconContainer.className = 'toast-icon';
        const icon = document.createElement('i');
        icon.className = `fas ${icons[type] || icons.info}`;
        icon.setAttribute('aria-hidden', 'true');
        iconContainer.append(icon);
        const content = document.createElement('div');
        content.className = 'toast-content';
        const title = document.createElement('div');
        title.className = 'toast-title';
        title.textContent = titles[type] || titles.info;
        const toastMessage = document.createElement('div');
        toastMessage.className = 'toast-message';
        toastMessage.textContent = displayMessage;
        content.append(title, toastMessage);
        const closeButton = document.createElement('button');
        closeButton.className = 'toast-close';
        closeButton.type = 'button';
        closeButton.setAttribute('aria-label', 'Dismiss notification');
        const closeIcon = document.createElement('i');
        closeIcon.className = 'fas fa-times';
        closeIcon.setAttribute('aria-hidden', 'true');
        closeButton.append(closeIcon);
        toast.append(iconContainer, content, closeButton);
        
        container.appendChild(toast);
        
        const closeBtn = closeButton;
        closeBtn.addEventListener('click', () => {
            toast.style.animation = 'slideOutRight 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        });
        
        setTimeout(() => {
            if (toast.parentElement) {
                toast.style.animation = 'slideOutRight 0.3s ease forwards';
                setTimeout(() => toast.remove(), 300);
            }
        }, duration);
    },
    
    renderProductCard(product, showActions = true, redirectToShop = false) {
        const imageMarkup = responsiveImageMarkup(product, { width: 480, height: 480 });
        const shop = product.shops || {};
        const seller = product.seller || {};
        const sellerName = seller.display_name || shop.name || 'Seller';
        const sellerAvatar = safeMediaUrl(seller.avatar_url || shop.logo_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(sellerName)}&size=40&background=6D28D9&color=fff`);
        const hasDiscount = product.discount_percent > 0;
        const isInWishlist = window.Store?.isInWishlist(product.id);
        const region = window.RegionService;
        const priceDisplay = region ? region.formatPrice(product.price) : '$' + parseFloat(product.price).toFixed(2);
        const origPriceDisplay = hasDiscount && region ? region.formatPrice(product.original_price) : hasDiscount ? '$' + parseFloat(product.original_price).toFixed(2) : '';
        const coverageAreas = shop.coverage_areas;
        const coverageLabel = product.school_name
            ? `Near ${product.school_name}${product.school_city ? `, ${product.school_city}` : ''}`
            : Array.isArray(coverageAreas) && coverageAreas.length > 0
            ? coverageAreas.slice(0, 2).join(', ') + (coverageAreas.length > 2 ? ` +${coverageAreas.length - 2}` : '')
            : '';
        const selectedLocation = window.RegionService?.location || 'all';
        const selectedSchool = window.RegionService?.school?.slug || null;
        const localMatch = selectedLocation !== 'all' && (
            (product.location === selectedLocation || (Array.isArray(coverageAreas) && coverageAreas.includes(selectedLocation))) &&
            (!selectedSchool || product.school_slug === selectedSchool || !product.school_slug)
        );
        const marketContext = window.RegionService?.marketContext;
        const localMarketHtml = localMatch
            ? `<span class="local-market-signal"><i class="fas fa-location-dot"></i> Local lane · ${marketContext?.mobilePaymentReliability >= 0.9 ? 'mobile pay ready' : 'pay options shown at checkout'}</span>`
            : '';
        
        let badgeHtml = '';
        if (product.is_priority_ad || product.ad_status === 'approved') {
            badgeHtml += '<span class="badge badge-hot"><i class="fas fa-fire"></i> Hot sale</span>';
        }
        if (product.badge) {
            badgeHtml += `<span class="badge badge-${product.badge}">${escapeProductHtml(product.badge.replace(/-/g, ' '))}</span>`;
        } else if (hasDiscount) {
            badgeHtml = `<span class="badge badge-sale">-${product.discount_percent}%</span>`;
        }
        if (product.condition) {
            const conditionLabel = product.condition === 'new' ? 'Brand new' : product.condition === 'fairly_used' ? 'Fairly used' : 'Used';
            badgeHtml += `<span class="badge badge-campus">${conditionLabel}</span>`;
        }
        
        return `
            <div class="product-card" data-product-id="${escapeProductHtml(product.id)}" data-category="${escapeProductHtml(product.category || '')}"${redirectToShop && shop.id ? ` data-shop-id="${escapeProductHtml(shop.id)}"` : ''}>
                <div class="product-image">
                        ${imageMarkup}
                    <div class="product-badges">${badgeHtml}</div>
                    ${showActions ? `
                    <div class="product-actions">
                        <button class="action-btn wishlist ${isInWishlist ? 'active' : ''}" data-action="wishlist" data-product-id="${escapeProductHtml(product.id)}" title="Add to Wishlist">
                            <i class="fas fa-heart"></i>
                        </button>
                        <button class="action-btn" data-action="quickview" data-product-id="${escapeProductHtml(product.id)}" title="Quick View">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="action-btn" data-action="compare" data-product-id="${escapeProductHtml(product.id)}" title="Compare">
                            <i class="fas fa-random"></i>
                        </button>
                    </div>
                    ` : ''}
                </div>
                <div class="product-info">
                    <div class="product-shop">
                        <img src="${sellerAvatar}" alt="${escapeProductHtml(sellerName)}" class="shop-avatar">
                        <div style="display:flex;flex-direction:column;overflow:hidden;min-width:0;">
                            <span class="shop-name">${escapeProductHtml(sellerName)}</span>
                            ${coverageLabel ? `<span class="shop-location"><i class="fas fa-map-marker-alt"></i>${coverageLabel}</span>` : ''}
                        </div>
                    </div>
                    <h3 class="product-title"${!redirectToShop ? ` data-action="view-product" data-product-id="${escapeProductHtml(product.id)}"` : ''}>${escapeProductHtml(product.title)}</h3>
                    ${this.renderVerifiedReviewSummary(product)}
                    <div class="product-price">
                        <span class="current-price">${priceDisplay}</span>
                        ${hasDiscount ? `<span class="original-price">${origPriceDisplay}</span>` : ''}
                        ${hasDiscount ? `<span class="discount-percent">-${product.discount_percent}%</span>` : ''}
                    </div>
                    ${window.DeliveryPromiseEngine ? window.DeliveryPromiseEngine.render(product) : ''}
                    ${localMarketHtml}
                    ${!redirectToShop ? `<div class="product-footer">
                        <button class="add-to-cart-btn" data-action="add-to-cart" data-product-id="${escapeProductHtml(product.id)}">
                            <i class="fas fa-cart-plus"></i> Add to Cart
                        </button>
                    </div>` : ''}
                </div>
            </div>
        `;
    },
    
    renderStars(rating) {
        const fullStars = Math.floor(rating);
        const hasHalf = rating % 1 >= 0.5;
        const emptyStars = 5 - fullStars - (hasHalf ? 1 : 0);
        
        let html = '';
        for (let i = 0; i < fullStars; i++) {
            html += '<i class="fas fa-star"></i>';
        }
        if (hasHalf) {
            html += '<i class="fas fa-star-half-alt"></i>';
        }
        for (let i = 0; i < emptyStars; i++) {
            html += '<i class="far fa-star"></i>';
        }
        return html;
    },

    renderVerifiedReviewSummary(product = {}) {
        const count = Number(product.verified_reviews_count);
        const rating = Number(product.verified_rating);
        if (!Number.isSafeInteger(count) || count < 1 || !Number.isFinite(rating) || rating < 1 || rating > 5) {
            return '<div class="product-rating"><span class="rating-count">Verified-purchase reviews unavailable</span></div>';
        }
        return `<div class="product-rating"><div class="stars">${this.renderStars(rating)}</div><span class="rating-count">${rating.toFixed(1)} · ${count} verified review${count === 1 ? '' : 's'}</span></div>`;
    },
    
    renderProductSkeleton() {
        return `
            <div class="product-skeleton">
                <div class="skeleton-image skeleton"></div>
                <div class="skeleton-content">
                    <div class="skeleton-text short skeleton"></div>
                    <div class="skeleton-text medium skeleton"></div>
                    <div class="skeleton-text skeleton"></div>
                    <div class="skeleton-text short skeleton"></div>
                </div>
            </div>
        `;
    },
    
    renderCategories() {
        const categories = [
            { id: 'electronics', name: 'Electronics', image: '/img/home-category/electronics.png', gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' },
            { id: 'fashion', name: 'Fashion', image: '/img/home-category/fashion.png', gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' },
            { id: 'home', name: 'Home & Garden', image: '/img/home-category/home-furniture-and-appliances.png', gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)' },
            { id: 'sports', name: 'Sports', image: '/img/home-category/sports.png', gradient: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)' },
            { id: 'beauty', name: 'Beauty', image: '/img/home-category/beauty-and-personal-care.png', gradient: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)' },
            { id: 'toys', name: 'Toys & Games', image: '/img/home-category/toys-and-games.png', gradient: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)' }
        ];
        
        return categories.map(cat => `
            <a href="/pages/products.html?category=${cat.id}" class="category-card" data-category="${cat.id}">
                <div class="category-icon" style="background: ${cat.gradient}"><img src="${cat.image}" alt="" aria-hidden="true"></div>
                <div class="category-name">${cat.name}</div>
                <div class="category-count">Browse products</div>
            </a>
        `).join('');
    },
    
    renderShops(shopsData) {
        const shops = Array.isArray(shopsData) ? shopsData : [];
        return shops.map(shop => {
            const shopName = escapeProductHtml(shop.name || 'Shop');
            const shopDescription = escapeProductHtml(shop.description || 'Live marketplace shop on VelveraHub.');
            const shopId = escapeProductHtml(shop.id || '');
            const logoUrl = shop.logo || shop.logo_url;
            const avatarUrl = safeMediaUrl(logoUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(shop.name || 'Shop')}&background=random&color=fff&size=100`);
            const bannerUrl = safeMediaUrl(shop.banner, '/img/basket.png');

            return `
            <div class="shop-card" data-shop-id="${shopId}">
                <div class="shop-banner" style="background-image: url('${escapeProductHtml(bannerUrl)}'); background-size: cover; background-position: center;"></div>
                <div class="shop-card-content">
                    <div class="shop-avatar-container">
                        <img src="${escapeProductHtml(avatarUrl)}" alt="${shopName}" class="shop-avatar-lg" onerror="this.onerror=null;this.src='/img/basket.png';">
                        ${shop.verified ? '<span class="shop-verified"><i class="fas fa-check"></i></span>' : ''}
                    </div>
                    <div class="shop-info">
                        <div class="shop-header"><h4 class="shop-name-lg" style="margin: 0;">${shopName}</h4></div>
                        <p class="shop-description">${shopDescription}</p>
                    </div>
                    <div class="shop-footer">
                        <a href="/pages/shop.html?id=${encodeURIComponent(shop.id || '')}" class="visit-shop-btn">Visit Shop</a>
                        <button class="follow-shop-btn" data-shop-id="${shopId}"><i class="far fa-heart"></i></button>
                    </div>
                </div>
            </div>
        `}).join('');
    },
    
    renderCartItems(cart) {
        if (cart.length === 0) {
            return `
                <div class="cart-empty">
                    <i class="fas fa-shopping-cart"></i>
                    <h4>Your cart is empty</h4>
                    <p>Add some products to your cart and they will appear here.</p>
                    <button class="btn btn-primary" id="startShoppingBtn">Start Shopping</button>
                </div>
            `;
        }
        
        const region = window.RegionService;
        const fmt = (usd) => region ? region.formatPrice(usd) : '$' + parseFloat(usd).toFixed(2);

        return cart.map(item => {
            const product = item.product || item;
            const imageMarkup = responsiveImageMarkup(product, { width: 96, height: 96, className: 'cart-item-media' });
            const linePrice = fmt(parseFloat(product.price) * item.quantity);

            return `
                <div class="cart-item" data-product-id="${product.id}">
                    <div class="cart-item-image">
                        ${imageMarkup}
                    </div>
                    <div class="cart-item-info">
                        <h4 class="cart-item-title">${product.title}</h4>
                        <p class="cart-item-shop">${product.shops?.name || 'VelveraHub Store'}</p>
                        <p class="cart-item-price">${linePrice}</p>
                        <div class="cart-item-controls">
                            <button class="cart-qty-btn" data-action="decrease" data-product-id="${product.id}">
                                <i class="fas fa-minus"></i>
                            </button>
                            <span class="cart-item-qty">${item.quantity}</span>
                            <button class="cart-qty-btn" data-action="increase" data-product-id="${product.id}">
                                <i class="fas fa-plus"></i>
                            </button>
                        </div>
                    </div>
                    <button class="cart-item-remove" data-action="remove" data-product-id="${product.id}">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `;
        }).join('');
    },
    
    renderQuickView(product) {
        const imageMarkup = responsiveImageMarkup(product, { width: 640, height: 520, loading: 'eager' });
        const shop = product.shops || {};
        const hasDiscount = product.discount_percent > 0;
        const isInWishlist = window.Store?.isInWishlist(product.id);
        const region = window.RegionService;
        const priceDisplay = region ? region.formatPrice(product.price) : '$' + parseFloat(product.price).toFixed(2);
        const origPriceDisplay = hasDiscount && region ? region.formatPrice(product.original_price) : hasDiscount ? '$' + parseFloat(product.original_price).toFixed(2) : '';

        return `
            <div class="quick-view-content">
                <div class="quick-view-image">
                    ${imageMarkup}
                </div>
                <div class="quick-view-info">
                    <div class="product-shop">
                        <img src="${shop.logo_url || 'https://ui-avatars.com/api/?name=Shop&size=20'}" alt="${shop.name || 'Shop'}" class="shop-avatar">
                        <span class="shop-name">${shop.name || 'VelveraHub Store'}</span>
                    </div>
                    <h3 class="quick-view-title">${product.title}</h3>
                    ${this.renderVerifiedReviewSummary(product)}
                    <div class="product-price">
                        <span class="current-price">${priceDisplay}</span>
                        ${hasDiscount ? `<span class="original-price">${origPriceDisplay}</span>` : ''}
                        ${hasDiscount ? `<span class="discount-percent">-${product.discount_percent}%</span>` : ''}
                    </div>
                    <p class="quick-view-description">${product.description || 'No description available for this product.'}</p>
                    <div class="quick-view-actions">
                        <button class="add-to-cart-btn" data-action="add-to-cart" data-product-id="${product.id}">
                            <i class="fas fa-cart-plus"></i> Add to Cart
                        </button>
                        <button class="action-btn wishlist ${isInWishlist ? 'active' : ''}" data-action="wishlist" data-product-id="${product.id}" title="Add to Wishlist">
                            <i class="fas fa-heart"></i>
                        </button>
                    </div>
                    <a href="${window.VelveraHubDomains?.productUrl?.(product.id) || `/pages/product.html?id=${encodeURIComponent(product.id || '')}`}" class="view-full-details-link">View Full Details</a>
                </div>
            </div>
        `;
    },

    updateCartSummary() {
        const region = window.RegionService;
        const fmt = (usd) => region ? region.formatPrice(usd) : '$' + parseFloat(usd).toFixed(2);

        const subtotal = window.CartService.getSubtotal();
        const shipping = window.CartService.getShipping();
        const total = window.CartService.getTotal();
        
        const subtotalEl = document.getElementById('cartSubtotal');
        const shippingEl = document.getElementById('cartShipping');
        const totalEl = document.getElementById('cartTotal');
        
        if (subtotalEl) subtotalEl.textContent = fmt(subtotal);
        if (shippingEl) shippingEl.textContent = shipping === 0 ? 'Free' : fmt(shipping);
        if (totalEl) totalEl.textContent = fmt(total);
    }
};

const styleSheet = document.createElement('style');
styleSheet.textContent = `
    @keyframes slideOutRight {
        from { opacity: 1; transform: translateX(0); }
        to { opacity: 0; transform: translateX(100%); }
    }
`;
document.head.appendChild(styleSheet);

window.UI = UI;
