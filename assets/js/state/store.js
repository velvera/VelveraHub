const Store = {
    state: {
        user: null,
        profile: null,
        cart: [],
        wishlist: [],
        products: [],
        categories: [],
        currentPage: 'home',
        isLoading: false,
        searchQuery: '',
        selectedCategory: 'all',
        filters: {
            priceRange: [0, 1000],
            rating: 0,
            sortBy: 'relevance'
        }
    },

    listeners: new Map(),

    getState() {
        return this.state;
    },

    setState(updates) {
        const prevState = { ...this.state };
        this.state = { ...this.state, ...updates };

        Object.keys(updates).forEach(key => {
            if (this.listeners.has(key)) {
                this.listeners.get(key).forEach(callback => {
                    callback(this.state[key], prevState[key]);
                });
            }
        });
    },

    subscribe(key, callback) {
        if (!this.listeners.has(key)) {
            this.listeners.set(key, new Set());
        }
        this.listeners.get(key).add(callback);

        return () => {
            this.listeners.get(key).delete(callback);
        };
    },

    getUser() {
        return this.state.user;
    },

    setUser(user) {
        this.setState({ user });
    },

    getProducts() {
        return this.state.products;
    },

    setProducts(products) {
        this.setState({ products });
    },

    addToWishlist(productId) {
        if (!this.state.wishlist.includes(productId)) {
            const newWishlist = [...this.state.wishlist, productId];
            this.setState({ wishlist: newWishlist });
            localStorage.setItem('velverahub_wishlist', JSON.stringify(newWishlist));
            this.updateWishlistCount();
        }
    },

    removeFromWishlist(productId) {
        const newWishlist = this.state.wishlist.filter(id => id !== productId);
        this.setState({ wishlist: newWishlist });
        localStorage.setItem('velverahub_wishlist', JSON.stringify(newWishlist));
        this.updateWishlistCount();
    },

    isInWishlist(productId) {
        return this.state.wishlist.includes(productId);
    },

    toggleWishlist(productId) {
        if (this.isInWishlist(productId)) {
            this.removeFromWishlist(productId);
        } else {
            this.addToWishlist(productId);
        }
        return this.state.wishlist.length;
    },

    loadWishlist() {
        const saved = localStorage.getItem('velverahub_wishlist');
        if (saved) {
            try {
                const wishlist = JSON.parse(saved);
                this.setState({ wishlist });
            } catch {
                this.setState({ wishlist: [] });
            }
        }
        this.updateWishlistCount();
    },

    updateWishlistCount() {
        const wishlistCountEl = document.getElementById('wishlistCount');
        if (wishlistCountEl) {
            const count = this.state.wishlist.length;
            wishlistCountEl.textContent = count;
            wishlistCountEl.style.display = count > 0 ? 'flex' : 'none';
        }
    },

    setLoading(isLoading) {
        this.setState({ isLoading });
    },

    setSearchQuery(query) {
        this.setState({ searchQuery: query });
    },

    setSelectedCategory(category) {
        this.setState({ selectedCategory: category });
    },

    setFilters(filters) {
        this.setState({ filters: { ...this.state.filters, ...filters } });
    }
};

window.Store = Store;