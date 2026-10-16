if (!window.RegionService) {
    window.RegionService = {
        _region: null,

        detect() {
            if (this._region) return this._region;
            const configuredRegion = String(window.VELVERAHUB_CONFIG?.APP_REGION || '').toLowerCase();
            if (configuredRegion === 'ng' || configuredRegion === 'uk') {
                this._region = configuredRegion;
                return this._region;
            }
            const host = window.location.hostname.toLowerCase();
            if (host.endsWith('.com.ng') || host.endsWith('.ng')) {
                this._region = 'ng';
            } else if (host.endsWith('.co.uk') || host.endsWith('.uk')) {
                this._region = 'uk';
            } else {
                this._region = localStorage.getItem('velvera_region') || 'ng';
            }
            return this._region;
        },

        get region() { return this.detect(); },

        get isNigeria() { return this.region === 'ng'; },
        get isUK() { return this.region === 'uk'; },

        get currency() {
            return this.region === 'uk'
                ? { symbol: '£', code: 'GBP' }
                : { symbol: '₦', code: 'NGN' };
        },

        get countryName() {
            return this.region === 'uk' ? 'United Kingdom' : 'Nigeria';
        },

        get flag() {
            return this.region === 'uk' ? '🇬🇧' : '🇳🇬';
        },

        get freeShippingThreshold() {
            return this.region === 'uk' ? 30 : 5000;
        },

        get phonePrefix() {
            return this.region === 'uk' ? '+44' : '+234';
        },

        get phonePlaceholder() {
            return this.region === 'uk' ? '+44 7911 123456' : '+234 801 234 5678';
        },

        get conversionFactor() {
            return this.region === 'uk' ? 0.79 : 900;
        },

        formatPrice(amount) {
            const val = parseFloat(amount) || 0;
            const converted = val * this.conversionFactor;
            if (this.region === 'uk') {
                return '£' + converted.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            }
            return '₦' + Math.round(converted).toLocaleString('en-NG');
        },

        formatShippingThreshold() {
            return this.region === 'uk' ? '£30' : '₦5,000';
        },

        setRegion(region) {
            this._region = null;
            localStorage.setItem('velvera_region', region);
            window.location.reload();
        },

        getNigerianStates() {
            return [
                'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa',
                'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo',
                'Ekiti', 'Enugu', 'FCT (Abuja)', 'Gombe', 'Imo', 'Jigawa',
                'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara',
                'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun',
                'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara'
            ];
        },

        getUKRegions() {
            return [
                'London', 'South East England', 'South West England',
                'East of England', 'East Midlands', 'West Midlands',
                'Yorkshire & The Humber', 'North West England', 'North East England',
                'Scotland', 'Wales', 'Northern Ireland'
            ];
        },

        searchLocations(query, state) {
            const needle = String(query || '').toLocaleLowerCase().trim();
            if (this.region === 'uk') {
                return this.getUKRegions()
                    .filter((name) => (!state || name === state) &&
                        (!needle || name.toLocaleLowerCase().includes(needle)))
                    .map((name) => ({
                        kind: 'state',
                        state: name,
                        name,
                        city: name,
                        type: 'Region',
                        aliases: []
                    }));
            }
            return window.CampusService?.searchLocations?.(query, state) || [];
        },

        getCoverageAreas() {
            return this.region === 'uk' ? this.getUKRegions() : this.getNigerianStates();
        },

        get locationOptions() {
            return ['all', ...this.getCoverageAreas()];
        },

        get availableLocations() {
            return this._availableLocations || this.getCoverageAreas();
        },

        get marketContext() {
            return this._marketContext || null;
        },

        async loadMarketContext() {
            if (window.VELVERAHUB_CONFIG?.STATIC_ONLY) {
                this._marketContext = {
                    region: this.region,
                    location: this.location,
                    paymentMethods: ['bank_transfer', 'cash_on_delivery'],
                    cashOnDeliveryRisk: this.region === 'uk' ? 0.08 : 0.34,
                    mobilePaymentReliability: this.region === 'uk' ? 0.94 : 0.76,
                    localSignalWeight: this.region === 'uk' ? 0.16 : 0.22
                };
                return this._marketContext;
            }
            try {
                const apiFetch = window.VelveraAPI?.fetch || fetch;
                const response = await apiFetch(`/api/market/context?region=${this.region}&location=${encodeURIComponent(this.location)}`, {
                    signal: AbortSignal.timeout(5000)
                });
                if (response.ok) this._marketContext = await response.json();
            } catch (_) {
                this._marketContext = {
                    region: this.region,
                    location: this.location,
                    paymentMethods: ['bank_transfer', 'cash_on_delivery'],
                    cashOnDeliveryRisk: this.region === 'uk' ? 0.08 : 0.34,
                    mobilePaymentReliability: this.region === 'uk' ? 0.94 : 0.76,
                    localSignalWeight: this.region === 'uk' ? 0.16 : 0.22
                };
            }
            return this._marketContext;
        },

        async loadAvailableLocations() {
            if (this.region !== 'ng') return this.getCoverageAreas();

            /*
             * Supabase is the production source of truth. Prefer it before
             * the optional Express development endpoint so Pages deployments
             * never depend on a Worker/API server just to populate the picker.
             */
            if (window.supabaseConfigReady) await window.supabaseConfigReady;
            if (window.SupabaseClient?.isConfigured()) {
                try {
                    const { data, error } = await window.SupabaseClient.get()
                        .from('products')
                        .select('location, shops(coverage_areas)')
                        .eq('status', 'active')
                        .limit(1000);
                    if (!error) {
                        const available = [...new Set((data || []).flatMap((row) => [
                            row.location,
                            ...(Array.isArray(row.shops?.coverage_areas) ? row.shops.coverage_areas : [])
                        ]))]
                            .filter((location) => this.getNigerianStates().includes(location));
                        if (available.length) this._availableLocations = available.sort();
                        return this.availableLocations;
                    }
                } catch (_) {
                    // Fall through to the optional local endpoint.
                }
            }
            if (window.VELVERAHUB_CONFIG?.STATIC_ONLY) return this.availableLocations;

            try {
                const apiFetch = window.VelveraAPI?.fetch || fetch;
                const response = await apiFetch('/api/locations?region=ng', {
                    signal: AbortSignal.timeout(5000)
                });
                if (!response.ok) throw new Error(`Location API unavailable (${response.status})`);
                const data = await response.json();
                if (Array.isArray(data.locations) && data.locations.length) {
                    this._availableLocations = data.locations;
                }
            } catch (error) {
                // The complete state list remains a safe fallback for an
                // empty catalogue or an unavailable optional API.
            }
            return this.availableLocations;
        },

        get location() {
            const saved = localStorage.getItem('velvera_location');
            return this.locationOptions.includes(saved) ? saved : 'all';
        },

        get locationLabel() {
            return this.location === 'all'
                ? (this.region === 'uk' ? 'All Regions' : 'All States')
                : (this.place?.label || this.location);
        },

        get place() {
            try {
                const raw = localStorage.getItem('velvera_place');
                const place = raw ? JSON.parse(raw) : null;
                return place && place.state === this.location ? place : null;
            } catch (_) {
                return null;
            }
        },

        get area() {
            return this.place?.area || this.place?.city || null;
        },

        get school() {
            const slug = localStorage.getItem('velvera_school');
            const school = window.CampusService?.find?.(slug);
            return school && (this.location === 'all' || school.state === this.location) ? school : null;
        },

        get schoolLabel() {
            return this.school?.name || '';
        },

        setLocation(location) {
            const next = this.locationOptions.includes(location) ? location : 'all';
            localStorage.setItem('velvera_location', next);
            localStorage.removeItem('velvera_place');
            const selectedSchool = this.school;
            if (selectedSchool && (next === 'all' || selectedSchool.state !== next)) {
                localStorage.removeItem('velvera_school');
            }
            this._marketContext = null;
            window.dispatchEvent(new CustomEvent('velveraLocationChange', {
                detail: {
                    location: next,
                    label: next === 'all' ? this.locationLabel : next,
                    school: this.school
                }
            }));
        },

        setPlace(place) {
            const next = place && this.locationOptions.includes(place.state) ? {
                slug: place.slug || null,
                label: place.name || place.city || place.state,
                name: place.name || place.city || place.state,
                area: place.area || place.city || null,
                city: place.city || null,
                state: place.state,
                kind: place.kind || 'place'
            } : null;
            if (!next) {
                localStorage.removeItem('velvera_place');
                this.setSchool(null);
                window.dispatchEvent(new CustomEvent('velveraLocationChange', {
                    detail: { location: this.location, label: this.locationLabel, school: this.school, place: null }
                }));
                return;
            }
            localStorage.setItem('velvera_location', next.state);
            localStorage.setItem('velvera_place', JSON.stringify(next));
            localStorage.removeItem('velvera_school');
            this._marketContext = null;
            window.dispatchEvent(new CustomEvent('velveraLocationChange', {
                detail: { location: next.state, label: next.label, school: null, place: next }
            }));
        },

        setSchool(school) {
            const next = typeof school === 'string'
                ? window.CampusService?.find?.(school)
                : school;
            if (!next) {
                localStorage.removeItem('velvera_school');
            } else if (this.location === next.state || this.location === 'all') {
                localStorage.setItem('velvera_school', next.slug);
                if (this.location === 'all') localStorage.setItem('velvera_location', next.state);
                localStorage.removeItem('velvera_place');
            } else {
                return;
            }
            window.dispatchEvent(new CustomEvent('velveraSchoolChange', {
                detail: { school: this.school }
            }));
        },

        appendLocationOptions(select, includeAll = true) {
            if (!select) return;
            select.dataset.searchable = 'true';
            select.dataset.searchPlaceholder = 'Search locations...';
            select.dataset.searchLabel = 'Search locations';
            select.dataset.emptyLabel = 'No locations found';
            const placeholder = !includeAll
                ? Array.from(select.options).find((option) => option.value === '')
                : null;
            const options = includeAll ? this.locationOptions : this.getCoverageAreas();
            const optionMarkup = options.map(value => {
                const label = value === 'all' ? this.locationLabel : value;
                return `<option value="${value}">${label}</option>`;
            }).join('');
            select.innerHTML = `${placeholder ? `<option value="">${placeholder.textContent}</option>` : ''}${optionMarkup}`;
            select.value = includeAll ? this.location : '';
            window.CustomSelect?.refresh?.(select);
        },

        syncLocationSelect(select) {
            if (!select) return;
            this.appendLocationOptions(select);
            if (select.dataset.locationSyncReady === 'true') return;
            select.dataset.locationSyncReady = 'true';
            const update = () => {
                this.setLocation(select.value);
                this.syncLocationSelects();
            };
            select.addEventListener('change', update);
        },

        syncLocationSelects() {
            document.querySelectorAll('[data-location-select], #locationSelect').forEach(select => {
                if (select.value !== this.location) {
                    select.value = this.location;
                    window.CustomSelect?.refresh(select);
                }
            });
        }
    };
}
