let privateMediaFeatureCache = { enabled: false, expiresAt: 0 };

const ProductsService = {
    getLocation(options = {}) {
        return options.location || window.RegionService?.location || 'all';
    },

    getSchool(options = {}) {
        return options.school || window.RegionService?.school?.slug || null;
    },

    getArea(options = {}) {
        return options.area || window.RegionService?.area || null;
    },

    getProductImage(product, fallback = '/img/product-placeholder.svg') {
        const images = Array.isArray(product?.product_images) && product.product_images.length
            ? product.product_images
            : Array.isArray(product?.images)
                ? product.images
                : [];
        const orderedImages = [...images].sort((a, b) =>
            Number(Boolean(b?.is_primary)) - Number(Boolean(a?.is_primary))
            || Number(a?.display_order || 0) - Number(b?.display_order || 0)
        );
        const imageUrl = orderedImages
            .filter((image) => typeof image === 'string' || image?.alt_text !== 'video')
            .map((image) => typeof image === 'string' ? image : image?.url)
            .find(Boolean);
        return imageUrl || product?.image_url || product?.image || fallback;
    },

    getTransformedImageUrl(value, { width = 480, height = 480, format = 'webp', quality = 78 } = {}) {
        const candidate = String(value || '').trim();
        if (!candidate) return null;
        try {
            const url = new URL(candidate, window.location.origin);
            if (!/\/storage\/v1\/object\/public\//.test(url.pathname)) return null;
            url.pathname = url.pathname.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/');
            url.searchParams.set('width', String(width));
            url.searchParams.set('height', String(height));
            url.searchParams.set('resize', 'cover');
            url.searchParams.set('quality', String(quality));
            url.searchParams.set('format', format);
            return url.href;
        } catch (_) {
            return null;
        }
    },

    getProductImageSources(product, options = {}) {
        const original = this.getProductImage(product, options.fallback || '/img/product-placeholder.svg');
        return {
            original,
            avif: this.getTransformedImageUrl(original, { ...options, format: 'avif' }),
            webp: this.getTransformedImageUrl(original, { ...options, format: 'webp' })
        };
    },

    async resolvePrivateProductMedia(products = []) {
        const rows = Array.isArray(products) ? products : [products];
        if (!rows.length || !window.SupabaseClient?.isConfigured()) return products;
        const supabase = window.SupabaseClient.get();
        if (privateMediaFeatureCache.expiresAt <= Date.now()) {
            try {
                const { data, error } = await supabase.rpc('get_phone_verification_enabled');
                if (error) throw error;
                privateMediaFeatureCache = { enabled: data === true, expiresAt: Date.now() + 10000 };
            } catch (error) {
                privateMediaFeatureCache = { enabled: false, expiresAt: Date.now() + 3000 };
                window.Observability?.reportError(
                    'private-product-media-status',
                    `private-media-${Date.now().toString(36)}`,
                    error,
                    { source: 'catalogue-service' }
                );
            }
        }
        if (!privateMediaFeatureCache.enabled) return products;

        const projectUrl = String(window.VELVERAHUB_CONFIG?.SUPABASE_URL || '').replace(/\/+$/, '');
        let projectOrigin = '';
        try { projectOrigin = new URL(projectUrl).origin; } catch (_) {}
        if (!projectOrigin) return products;

        const pending = new Map();
        const parseStoragePath = (value) => {
            try {
                const url = new URL(String(value || ''), window.location.origin);
                if (url.origin !== projectOrigin) return null;
                const match = url.pathname.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/(product-images|product-videos)\/(.+)$/);
                if (!match) return null;
                return { bucket: match[1], path: decodeURIComponent(match[2]) };
            } catch (_) {
                return null;
            }
        };
        const addTarget = (product, value, setter) => {
            const reference = parseStoragePath(value);
            if (!reference || !product?.id || !reference.path.startsWith(`${product.id}/`)) return;
            if (!pending.has(reference.bucket)) pending.set(reference.bucket, new Map());
            const paths = pending.get(reference.bucket);
            if (!paths.has(reference.path)) paths.set(reference.path, []);
            paths.get(reference.path).push(setter);
        };

        rows.forEach((product) => {
            ['image', 'image_url'].forEach((key) => {
                if (typeof product?.[key] === 'string') {
                    addTarget(product, product[key], (value) => { product[key] = value; });
                }
            });
            ['product_images', 'images'].forEach((key) => {
                (Array.isArray(product?.[key]) ? product[key] : []).forEach((image) => {
                    if (typeof image === 'string') return;
                    if (typeof image?.url === 'string') {
                        addTarget(product, image.url, (value) => { image.url = value; });
                    }
                });
            });
        });

        for (const [bucket, pathTargets] of pending) {
            const paths = [...pathTargets.keys()];
            for (let offset = 0; offset < paths.length; offset += 100) {
                const batch = paths.slice(offset, offset + 100);
                const { data, error } = await supabase.storage.from(bucket).createSignedUrls(batch, 3600);
                const signedByPath = new Map((data || []).map((entry) => [entry.path, entry.signedUrl]));
                if (error) {
                    window.Observability?.reportError(
                        'private-product-media-sign',
                        `private-media-sign-${Date.now().toString(36)}`,
                        error,
                        { source: 'catalogue-service', bucket }
                    );
                }
                batch.forEach((path) => {
                    const signedUrl = signedByPath.get(path);
                    const replacement = signedUrl
                        ? (signedUrl.startsWith('http') ? signedUrl : new URL(signedUrl, `${projectUrl}/storage/v1/`).href)
                        : '/img/product-placeholder.svg';
                    pathTargets.get(path).forEach((setter) => setter(replacement));
                });
            }
        }
        return products;
    },

    normaliseLocation(value) {
        return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    },

    levenshtein(left, right) {
        const a = this.normaliseLocation(left);
        const b = this.normaliseLocation(right);
        if (!a || !b) return Math.max(a.length, b.length);
        const row = Array.from({ length: b.length + 1 }, (_, index) => index);
        for (let i = 1; i <= a.length; i++) {
            let previous = row[0];
            row[0] = i;
            for (let j = 1; j <= b.length; j++) {
                const current = row[j];
                row[j] = Math.min(
                    row[j] + 1,
                    row[j - 1] + 1,
                    previous + (a[i - 1] === b[j - 1] ? 0 : 1)
                );
                previous = current;
            }
        }
        return row[b.length];
    },

    fuzzyScore(product, query) {
        const words = this.normaliseLocation(query).split(' ').filter(Boolean);
        const haystack = this.normaliseLocation(`${product.title || ''} ${product.description || ''}`);
        if (!words.length || !haystack) return 0;
        return words.reduce((score, word) => {
            if (haystack.includes(word)) return score + 2;
            const tokens = haystack.split(' ');
            const closest = Math.min(...tokens.map((token) => this.levenshtein(word, token)));
            return score + (closest <= Math.max(1, Math.floor(word.length / 4)) ? 1 : 0);
        }, 0);
    },

    matchesLocation(product, location, area) {
        if (location === 'all') return true;
        const state = this.normaliseLocation(location);
        const areaNeedle = this.normaliseLocation(area);
        const values = [
            product.location,
            product.campus_area,
            product.school_city,
            product.school_name,
            product.shops?.city,
            product.shops?.address,
            product.shops?.service_location,
            ...(product.shops?.coverage_areas || [])
        ].map((value) => this.normaliseLocation(value));
        const stateMatch = values.some((value) => value === state || value.includes(state) || state.includes(value));
        if (!stateMatch) return false;
        if (!areaNeedle) return true;
        const areaMatch = values.some((value) => value && (value.includes(areaNeedle) || areaNeedle.includes(value)));
        // State-wide listings remain discoverable from a more specific place.
        return areaMatch || product.location === location || !product.location;
    },

    matchesSchool(product, school) {
        if (!school) return true;
        // An institution is optional location context. Listings without a
        // selected institution remain visible in institution-based searches.
        return product.school_slug === school || !product.school_slug;
    },

    async requestProducts(options = {}) {
        const params = new URLSearchParams();
        if (options.category && options.category !== 'all') {
            const categories = window.VelveraCategories?.getValues(options.category) || [options.category];
            categories.forEach((category) => params.append('category', category));
        }
        if (options.limit) params.append('limit', options.limit);
        if (options.offset) params.append('offset', options.offset);
        if (options.featured) params.append('featured', 'true');
        if (options.flash_deal) params.append('flash_deal', 'true');
        if (options.search) params.append('search', options.search);
        if (options.shop_id) params.append('shop_id', options.shop_id);
        if (this.getLocation(options) !== 'all') params.append('location', this.getLocation(options));
        if (this.getSchool(options)) params.append('school', this.getSchool(options));
        if (this.getArea(options)) params.append('area', this.getArea(options));
        if (options.sort) params.append('sort', options.sort);
        if (options.filter === 'new') params.set('sort', 'newest');
        if (options.filter === 'bestseller') params.set('sort', 'sales');
        if (options.filter === 'trending') params.set('sort', 'rating');

        const apiFetch = window.VelveraAPI?.fetch || fetch;
        const response = await apiFetch(`/api/products?${params.toString()}`);
        if (!response.ok) throw new Error(`Products request failed (${response.status})`);
        return response.json();
    },

    async getProducts(options = {}) {
        if (window.supabaseConfigReady) await window.supabaseConfigReady;

        // Supabase is the production source of truth. Express remains a
        // useful fallback for local deployments without Supabase access.
        if (window.SupabaseClient?.isConfigured()) {
            const supabase = window.SupabaseClient.get();
            try {
                let query = supabase.from('products')
                    .select('*, shops(*), product_images(url, alt_text, is_primary, display_order)', { count: 'exact' })
                    .eq('status', 'active');
                
                if (options.category && options.category !== 'all') {
                    const categoryValues = window.VelveraCategories?.getValues(options.category) || [options.category];
                    query = categoryValues.length > 1
                        ? query.in('category', categoryValues)
                        : query.eq('category', categoryValues[0] || options.category);
                }
                if (options.search) {
                    const safeSearch = String(options.search).replace(/[,()]/g, ' ').trim();
                    query = query.or(`title.ilike.%${safeSearch}%,description.ilike.%${safeSearch}%`);
                }
                if (options.featured) {
                    query = query.eq('is_featured', true);
                }
                if (options.flash_deal) {
                    query = query.eq('is_flash_deal', true);
                }
                if (options.shop_id) {
                    query = query.eq('shop_id', options.shop_id);
                }
                if (options.filter === 'trending') {
                    query = query.order('rating', { ascending: false, nullsFirst: false });
                }
                if (options.filter === 'bestseller' || options.sort === 'sales') {
                    query = query.order('sales_count', { ascending: false, nullsFirst: false });
                }
                if (options.filter === 'new' || options.sort === 'newest') {
                    query = query.order('created_at', { ascending: false, nullsFirst: false });
                }
                if (!options.filter && !options.sort) {
                    // The homepage recommendation feed should surface new
                    // active listings instead of relying on database row order.
                    query = query.order('created_at', { ascending: false, nullsFirst: false });
                }
                /*
                 * Location coverage is stored on either the product or its shop.
                 * Supabase cannot express the shop coverage fallback reliably in
                 * the same query on every schema version, so fetch a bounded
                 * active set before applying that business rule client-side.
                 * Without this, applying LIMIT first can return an empty page even
                 * when matching products exist later in the result set.
                 */
                const location = this.getLocation(options);
                if (location !== 'all') {
                    query = query.limit(Math.min(Math.max(options.locationLimit || 1000, 100), 1000));
                } else if (options.limit) {
                    const offset = Math.max(0, Number(options.offset) || 0);
                    query = query.range(offset, offset + options.limit - 1);
                }

                const { data, error, count } = await query;
                if (!error && data) {
                    let candidateData = data;
                    if (options.search && !data.length) {
                        // A second bounded read makes common typos discoverable
                        // without weakening the normal exact search query.
                        let fuzzyQuery = supabase.from('products')
                            .select('*, shops(*), product_images(url, alt_text, is_primary, display_order)')
                            .eq('status', 'active')
                            .limit(1000);
                        if (options.category && options.category !== 'all') {
                            const categoryValues = window.VelveraCategories?.getValues(options.category) || [options.category];
                            fuzzyQuery = categoryValues.length > 1
                                ? fuzzyQuery.in('category', categoryValues)
                                : fuzzyQuery.eq('category', categoryValues[0] || options.category);
                        }
                        const fuzzyResult = await fuzzyQuery;
                        if (!fuzzyResult.error) {
                            candidateData = (fuzzyResult.data || [])
                                .map((product) => ({ product, score: this.fuzzyScore(product, options.search) }))
                                .filter((entry) => entry.score > 0)
                                .sort((a, b) => b.score - a.score)
                                .map((entry) => entry.product);
                        }
                    }
                    const school = this.getSchool(options);
                    const area = this.getArea(options);
                    const available = candidateData.filter((product) => {
                        const locationMatch = this.matchesLocation(product, location, area);
                        return locationMatch && this.matchesSchool(product, school);
                    }).sort((a, b) => Number(Boolean(b.is_priority_ad)) - Number(Boolean(a.is_priority_ad)));
                    const paged = location === 'all'
                        ? available
                        : available.slice(options.offset || 0, (options.offset || 0) + (options.limit || available.length));
                    const formatted = paged.map(p => this.formatSupabaseProduct(p));
                    await this.resolvePrivateProductMedia(formatted);
                    this.rememberProducts(formatted);
                    return {
                        data: formatted,
                        total: location === 'all' ? (options.search && !data.length ? available.length : (count ?? available.length)) : available.length,
                        error: null 
                    };
                }
                if (error) throw error;
            } catch (err) {
                const requestId = window.AsyncFeedback?.createRequestId('products') || `products-${Date.now()}`;
                window.AsyncFeedback?.log('products', requestId, err, {
                    source: 'supabase',
                    recoverable: true
                });
            }
        }

        if (window.VELVERAHUB_CONFIG?.STATIC_ONLY) {
            const error = new Error('The product catalogue service is unavailable.');
            window.Observability?.track('catalogue_failure', { source: 'supabase' });
            window.Observability?.reportError('products-catalogue', `products-${Date.now().toString(36)}`, error, { source: 'catalogue-service' });
            return { data: [], total: 0, error };
        }

        try {
            const data = await this.requestProducts(options);
            const formatted = (data.products || []).map(p => this.formatProduct(p));
            await this.resolvePrivateProductMedia(formatted);
            this.rememberProducts(formatted);
            return {
                data: formatted,
                total: data.total,
                error: null
            };
        } catch (error) {
            const requestId = window.AsyncFeedback?.createRequestId('products') || `products-${Date.now()}`;
            window.AsyncFeedback?.log('products', requestId, error, { source: 'api-fallback' });
            window.Observability?.track('catalogue_failure', { source: 'products_api' });
            return { data: [], total: 0, error };
        }
    },

    async getProduct(id, { requireLive = false } = {}) {
        if (window.supabaseConfigReady) await window.supabaseConfigReady;

        const productId = decodeURIComponent(String(id || '')).trim();
        if (!productId) return { data: null, error: new Error('Product id is required') };

        let liveLookupCompleted = false;
        let liveLookupError = null;
        if (window.SupabaseClient && window.SupabaseClient.isConfigured()) {
            const supabase = window.SupabaseClient.get();
            try {
                // maybeSingle avoids a 406 response when RLS hides a listing.
                // Keep the status filter aligned with the catalogue query.
                let { data, error } = await supabase
                    .from('products')
                    .select('*, shops(*), product_images(url, alt_text, is_primary, display_order)')
                    .eq('id', productId)
                    .eq('status', 'active')
                    .maybeSingle();

                // A partially migrated Supabase project may not expose the
                // relationship views yet. The product itself is still a
                // valid listing, so retry with the base table and hydrate
                // images independently.
                if (error) {
                    const fallback = await supabase
                        .from('products')
                        .select('*')
                        .eq('id', productId)
                        .eq('status', 'active')
                        .maybeSingle();
                    data = fallback.data;
                    error = fallback.error;
                    if (!error && data) {
                        const images = await supabase
                            .from('product_images')
                            .select('url, alt_text, is_primary, display_order')
                            .eq('product_id', productId)
                            .order('is_primary', { ascending: false })
                            .order('display_order', { ascending: true });
                        data.product_images = images.data || [];
                    }
                }
                if (!error) liveLookupCompleted = true;
                else liveLookupError = error;
                if (!error && data) {
                    const formatted = this.formatSupabaseProduct(data);
                    await this.resolvePrivateProductMedia([formatted]);
                    if (!data.shop_id && data.seller_id) {
                        const { data: contact, error: contactError } = await supabase
                            .from('seller_public_contacts')
                            .select('public_email, public_phone, whatsapp, instagram, facebook, twitter, other_contact_label, other_contact_url, is_public')
                            .eq('seller_id', data.seller_id)
                            .maybeSingle();
                        if (!contactError && contact?.is_public) {
                            formatted.seller.contact = contact;
                        } else if (contactError && !/relation .* does not exist|schema cache/i.test(contactError.message || '')) {
                            window.Observability?.reportError('product-seller-contact', `seller-contact-${Date.now().toString(36)}`, contactError, { source: 'catalogue-service' });
                        }
                    }
                    this.rememberProducts([formatted]);
                    return { data: formatted, error: null };
                }
                if (error) {
                    const requestId = window.AsyncFeedback?.createRequestId('product-detail') || `product-detail-${Date.now()}`;
                    window.AsyncFeedback?.log('product-detail', requestId, error, {
                        product_id: productId,
                        recoverable: true
                    });
                }
            } catch (error) {
                liveLookupError = error;
                const requestId = window.AsyncFeedback?.createRequestId('product-detail') || `product-detail-${Date.now()}`;
                window.AsyncFeedback?.log('product-detail', requestId, error, {
                    product_id: productId,
                    recoverable: true
                });
            }
        }

        if (window.VELVERAHUB_CONFIG?.STATIC_ONLY) {
            if (requireLive) {
                return liveLookupCompleted
                    ? { data: null, error: null }
                    : {
                        data: null,
                        error: liveLookupError || new Error('The live listing could not be verified.')
                    };
            }
            const cached = this.recalledProduct(productId);
            return cached
                ? { data: cached, error: null }
                : { data: null, error: new Error('Product details are temporarily unavailable.') };
        }

        try {
            const apiFetch = window.VelveraAPI?.fetch || fetch;
            const response = await apiFetch(`/api/products/${encodeURIComponent(productId)}`);
            if (!response.ok) throw new Error('Product not found');
            const data = await response.json();
            const formatted = this.formatProduct(data);
            await this.resolvePrivateProductMedia([formatted]);
            this.rememberProducts([formatted]);
            return { data: formatted, error: null };
        } catch (error) {
            const cached = this.recalledProduct(productId);
            if (cached) return { data: cached, error: null };
            const requestId = window.AsyncFeedback?.createRequestId('product-detail') || `product-detail-${Date.now()}`;
            window.AsyncFeedback?.log('product-detail', requestId, error, { product_id: productId });
            return { data: null, error };
        }
    },

    rememberProducts(products = []) {
        try {
            const current = JSON.parse(sessionStorage.getItem('velverahub_product_cache') || '{}');
            products.filter(product => product?.id != null).forEach(product => {
                current[String(product.id)] = product;
            });
            sessionStorage.setItem('velverahub_product_cache', JSON.stringify(current));
        } catch (_) {
            // Storage can be disabled in privacy-restricted browsers.
        }
    },

    recalledProduct(id) {
        try {
            return JSON.parse(sessionStorage.getItem('velverahub_product_cache') || '{}')[String(id)] || null;
        } catch (_) {
            return null;
        }
    },

    async getFlashDeals(limit = 20) {
        try {
            const result = await this.getProducts({ flash_deal: true, limit });
            return { data: result.data || [], error: result.error || null };
        } catch (error) {
            return { data: [], error };
        }
    },

    async getNewArrivals(limit = 8) {
        try {
            const result = await this.getProducts({ sort: 'newest', limit });
            return { data: result.data || [], error: result.error || null };
        } catch (error) {
            return { data: [], error };
        }
    },

    async getFeaturedProducts(limit = 8) {
        try {
            const result = await this.getProducts({ featured: true, limit });
            return { data: result.data || [], error: result.error || null };
        } catch (error) {
            return { data: [], error };
        }
    },

    async searchProducts(query, options = {}) {
        try {
            /*
             * Use the same Supabase-first path as normal listings so search
             * respects the selected Nigerian state. The old API-only path made
             * search results ignore the location filter whenever Supabase was
             * configured.
             */
            const result = await this.getProducts({ ...options, search: query });
            return result;
        } catch (error) {
            window.Observability?.reportError('product-search', `search-${Date.now().toString(36)}`, error, { source: 'catalogue-service' });
            return { data: [], error };
        }
    },

    async getSearchSuggestions(query, options = {}) {
        if (!window.VELVERAHUB_CONFIG?.STATIC_ONLY) {
            try {
                const location = this.getLocation(options);
                const suffix = location !== 'all' ? `&location=${encodeURIComponent(location)}` : '';
                const apiFetch = window.VelveraAPI?.fetch || fetch;
                const response = await apiFetch(`/api/search/suggestions?q=${encodeURIComponent(query)}${suffix}`);
                if (response.ok) {
                    const suggestions = await response.json();
                    return Array.isArray(suggestions) ? suggestions : suggestions.suggestions || [];
                }
            } catch (error) {
                window.Observability?.reportError('search-suggestions-api', `search-suggestions-${Date.now().toString(36)}`, error, { source: 'catalogue-service' });
            }
        }

        if (window.supabaseConfigReady) await window.supabaseConfigReady;
        if (window.SupabaseClient?.isConfigured()) {
            try {
                let suggestionQuery = window.SupabaseClient.get()
                    .from('products')
                    .select('title, location, shops(coverage_areas)')
                    .eq('status', 'active')
                    .ilike('title', `%${query}%`)
                    .limit(8);
                const location = this.getLocation(options);
                if (location !== 'all') {
                    suggestionQuery = suggestionQuery.limit(100);
                }
                const { data, error } = await suggestionQuery;
                if (!error) {
                    const matching = location === 'all' ? data : (data || []).filter((item) =>
                        item.location === location ||
                        (!item.location && (!item.shops?.coverage_areas?.length || item.shops.coverage_areas.includes(location)))
                    );
                    return matching.map((item) => item.title).filter(Boolean).slice(0, 8);
                }
            } catch (error) {
                window.Observability?.reportError('product-suggestions', `suggestions-${Date.now().toString(36)}`, error, { source: 'catalogue-service' });
            }
        }
        if (window.SupabaseClient?.isConfigured()) {
            try {
                const { data, error } = await window.SupabaseClient.get()
                    .from('products')
                    .select('title, description')
                    .eq('status', 'active')
                    .limit(1000);
                if (!error) {
                    return (data || [])
                        .map((item) => ({ title: item.title, score: this.fuzzyScore(item, query) }))
                        .filter((item) => item.score > 0)
                        .sort((a, b) => b.score - a.score)
                        .map((item) => item.title)
                        .filter(Boolean)
                        .filter((title, index, values) => values.indexOf(title) === index)
                        .slice(0, 8);
                }
            } catch (error) {
                window.AsyncFeedback?.log('search-suggestions', window.AsyncFeedback?.createRequestId('search-suggestions'), error);
            }
        }
        return [];
    },

    formatSupabaseProduct(p) {
        return this.formatProduct({
            ...p,
            shop_name: p.shops?.name,
            shop_logo: p.shops?.logo_url,
            shop_verified: p.shops?.verified,
            shop_rating: p.shops?.rating,
            shop_reviews_count: p.shops?.reviews_count ?? p.shops?.review_count,
            shop_total_sales: p.shops?.total_sales,
            shop_coverage_areas: p.shops?.coverage_areas,
            shop_slug: p.shops?.slug,
            shop_phone: p.shops?.phone,
            shop_email: p.shops?.email,
            shop_whatsapp: p.shops?.whatsapp,
            shop_instagram: p.shops?.instagram,
            shop_facebook: p.shops?.facebook,
            shop_twitter: p.shops?.twitter,
            shop_other_contact_label: p.shops?.other_contact_label,
            shop_other_contact_url: p.shops?.other_contact_url,
            image_url: p.image_url || p.images?.find((item) => item?.alt_text !== 'video')?.url || p.product_images?.find((item) => item?.alt_text !== 'video')?.url,
            images: p.product_images || p.images,
            delivery_options: p.delivery_options || null
        });
    },

    formatProduct(p) {
        const badges = [];
        if (p.discount_percent > 20) badges.push('sale');
        if (p.is_flash_deal) badges.push('hot');
        if (p.sales_count > 1000) badges.push('bestseller');
        const image = this.getProductImage(p);
        const productImages = Array.isArray(p.product_images)
            ? [...p.product_images].sort((a, b) =>
                Number(Boolean(b?.is_primary)) - Number(Boolean(a?.is_primary))
                || Number(a?.display_order || 0) - Number(b?.display_order || 0)
            )
            : Array.isArray(p.images)
                ? [...p.images].sort((a, b) =>
                    Number(Boolean(b?.is_primary)) - Number(Boolean(a?.is_primary))
                    || Number(a?.display_order || 0) - Number(b?.display_order || 0)
                )
                : [];
        
        return {
            id: p.id,
            title: p.title,
            description: p.description || p.short_description,
            category: p.category,
            price: parseFloat(p.price),
            original_price: p.original_price ? parseFloat(p.original_price) : null,
            discount_percent: p.discount_percent || 0,
            rating: p.rating || 0,
            reviews_count: p.reviews_count || 0,
            sales_count: p.sales_count || 0,
            stock: p.stock || 0,
            delivery_options: p.delivery_options || null,
            shops: {
                id: p.shop_id,
                name: p.shop_name || 'VelveraHub Store',
                logo_url: p.shop_logo || `https://ui-avatars.com/api/?name=${encodeURIComponent(p.shop_name || 'S')}&background=6366f1&color=fff`,
                verified: p.shop_verified || false,
                identity_verified: p.shop_identity_verified,
                rating: p.shop_rating,
                reviews_count: p.shop_reviews_count,
                total_sales: p.shop_total_sales,
                slug: p.shop_slug,
                coverage_areas: p.coverage_areas ?? p.shop_coverage_areas ?? p.shops?.coverage_areas,
                city: p.shop_city || p.shops?.city,
                country: p.shop_country || p.shops?.country,
                address: p.shop_address || p.shops?.address,
                service_location: p.service_location || p.shops?.service_location,
                phone: p.shop_phone || p.shops?.phone,
                email: p.shop_email || p.shops?.email,
                whatsapp: p.shop_whatsapp || p.shops?.whatsapp,
                instagram: p.shop_instagram || p.shops?.instagram,
                facebook: p.shop_facebook || p.shops?.facebook,
                twitter: p.shop_twitter || p.shops?.twitter,
                other_contact_label: p.shop_other_contact_label || p.shops?.other_contact_label,
                other_contact_url: p.shop_other_contact_url || p.shops?.other_contact_url
            },
            seller: {
                id: p.seller_id || null,
                display_name: p.seller_display_name || p.seller?.display_name || p.seller?.name || null,
                avatar_url: p.seller_avatar_url || p.seller?.avatar_url || null,
                contact: p.seller_contact || p.seller?.contact || null
            },
            image,
            formattedPrice: window.RegionService?.formatPrice
                ? window.RegionService.formatPrice(p.price)
                : String(p.price ?? ''),
            condition: p.condition || null,
            is_priority_ad: Boolean(p.is_priority_ad || p.ad_status === 'approved'),
            ad_status: p.ad_status || null,
            ad_expires_at: p.ad_expires_at || null,
            ad_promoter_name: p.ad_promoter_name || null,
            school_id: p.school_id || null,
            school_slug: p.school_slug || null,
            school_name: p.school_name || null,
            school_city: p.school_city || null,
            campus_area: p.campus_area || null,
            product_images: productImages.length ? productImages : [{ id: 1, url: image, is_primary: true }],
            badge: p.is_priority_ad || p.ad_status === 'approved' ? 'hot-sale' : (badges[0] || null),
            is_flash_deal: p.is_flash_deal,
            is_featured: p.is_featured,
            created_at: p.created_at
        };
    }
};

window.ProductsService = ProductsService;
