const CartService = {
    cart: [],
    
    init() {
        const savedCart = localStorage.getItem('velverahub_cart');
        if (savedCart) {
            try {
                this.cart = JSON.parse(savedCart);
            } catch {
                this.cart = [];
            }
        }
        this.updateCartCount();
    },
    
    saveCart() {
        localStorage.setItem('velverahub_cart', JSON.stringify(this.cart));
        this.updateCartCount();
        window.dispatchEvent(new CustomEvent('cartUpdate', { detail: { cart: this.cart } }));
        window.dispatchEvent(new CustomEvent('velveraCartChange', { detail: { cart: this.cart } }));
    },
    
    addItem(product, quantity = 1) {
        const existingItem = this.cart.find(item => (item.product || item).id === product.id);
        
        if (existingItem) {
            existingItem.quantity += quantity;
        } else {
            this.cart.push({
                product,
                quantity,
                currency: window.RegionService?.currency?.code || null
            });
        }
        
        this.saveCart();
        return true;
    },
    
    removeItem(productId) {
        this.cart = this.cart.filter(item => (item.product || item).id !== productId);
        this.saveCart();
    },
    
    updateQuantity(productId, quantity) {
        const item = this.cart.find(item => (item.product || item).id === productId);
        if (item) {
            if (quantity <= 0) {
                this.removeItem(productId);
            } else {
                item.quantity = quantity;
                this.saveCart();
            }
        }
    },
    
    getCart() {
        return this.cart;
    },
    
    getItemCount() {
        return this.cart.reduce((total, item) => total + (Number(item.quantity) || 1), 0);
    },
    
    getSubtotal() {
        return this.cart.reduce((total, item) => {
            const product = item.product || item;
            return total + ((Number(product.price) || 0) * (Number(item.quantity) || 1));
        }, 0);
    },
    
    getShipping() {
        if (this.isEmpty()) return 0;
        const subtotal = this.getSubtotal();
        const region = window.RegionService;
        const threshold = region?.freeShippingThreshold || 50;
        const convertedSubtotal = subtotal * (region?.conversionFactor || 1);
        if (convertedSubtotal >= threshold) return 0;
        return region?.region === 'ng' ? 0.56 : 3.99;
    },
    
    getTotal() {
        return this.getSubtotal() + this.getShipping();
    },
    
    updateCartCount() {
        const cartCountEl = document.getElementById('cartCount');
        if (cartCountEl) {
            const count = this.getItemCount();
            cartCountEl.textContent = count;
            cartCountEl.style.display = count > 0 ? 'flex' : 'none';
        }
    },
    
    clearCart() {
        this.cart = [];
        this.saveCart();
    },
    
    isEmpty() {
        return this.cart.length === 0;
    },

    async revalidate({ location = 'all', area = null, currency = null } = {}) {
        const requestId = window.AsyncFeedback?.createRequestId('cart-revalidate') || `cart-revalidate-${Date.now()}`;
        const corrections = [];
        const nextCart = [];
        const previousCart = this.cart.map((item) => ({ ...item }));

        for (const item of this.cart) {
            const cachedProduct = item.product || item;
            const requestedQuantity = Math.max(1, Number(item.quantity) || 1);
            let result;
            try {
                result = await window.ProductsService?.getProduct(cachedProduct.id);
            } catch (error) {
                window.AsyncFeedback?.log('cart-revalidate', requestId, error, { product_id: cachedProduct.id });
                result = { data: null, error };
            }
            const product = result?.data;
            if (!product) {
                if (result?.error || !result) {
                    corrections.push({
                        type: 'verification',
                        title: cachedProduct.title || 'Item',
                        message: 'We could not verify this listing right now. Your item remains in the cart; try again before placing the order.'
                    });
                    nextCart.push({
                        ...item,
                        product: cachedProduct,
                        quantity: requestedQuantity,
                        currency: item.currency || currency || null
                    });
                } else {
                    corrections.push({
                        type: 'unavailable',
                        title: cachedProduct.title || 'Item',
                        message: 'This item is no longer available and was removed from your cart.'
                    });
                }
                continue;
            }

            const stock = Math.max(0, Number(product.stock) || 0);
            if (stock < 1) {
                corrections.push({
                    type: 'stock',
                    title: product.title || cachedProduct.title || 'Item',
                    message: 'This item is now out of stock and was removed from your cart.'
                });
                continue;
            }
            const quantity = Math.min(requestedQuantity, stock);
            if (quantity !== requestedQuantity) {
                corrections.push({
                    type: 'stock',
                    title: product.title || cachedProduct.title || 'Item',
                    message: `Quantity changed from ${requestedQuantity} to ${quantity} because only ${stock} remain.`
                });
            }
            if (Number(cachedProduct.price) !== Number(product.price)) {
                corrections.push({
                    type: 'price',
                    title: product.title || cachedProduct.title || 'Item',
                    message: `Price updated from ${window.RegionService?.formatPrice(cachedProduct.price) || cachedProduct.price} to ${window.RegionService?.formatPrice(product.price) || product.price}.`
                });
            }
            if (item.currency && currency && item.currency !== currency) {
                corrections.push({
                    type: 'currency',
                    title: product.title || cachedProduct.title || 'Item',
                    message: `Your cart was saved in ${item.currency}; the current checkout market uses ${currency}.`
                });
            }
            const productCurrency = product.currency || product.price_currency;
            if (productCurrency && currency && productCurrency !== currency) {
                corrections.push({
                    type: 'currency',
                    title: product.title || cachedProduct.title || 'Item',
                    message: `This listing is priced in ${productCurrency}; checkout is currently set to ${currency}.`
                });
            }
            if (location !== 'all' && window.ProductsService?.matchesLocation &&
                !window.ProductsService.matchesLocation(product, location, area)) {
                corrections.push({
                    type: 'coverage',
                    title: product.title || cachedProduct.title || 'Item',
                    message: `Delivery coverage does not include ${area || location}; this item was removed from your cart.`
                });
                continue;
            }
            nextCart.push({ product, quantity, currency: item.currency || currency || null });
        }

        const changed = JSON.stringify(previousCart) !== JSON.stringify(nextCart);
        this.cart = nextCart;
        if (changed) this.saveCart();
        return { ok: corrections.length === 0, corrections, cart: this.cart, requestId };
    }
};

window.CartService = CartService;
