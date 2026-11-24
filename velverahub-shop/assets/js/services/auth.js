function authApiOrigin() {
    const candidate = String(window.VELVERAHUB_CONFIG?.API_ORIGIN || '').trim().replace(/\/+$/, '');
    if (!candidate) return '';
    try {
        const parsed = new URL(candidate, window.location.origin);
        return ['http:', 'https:'].includes(parsed.protocol) ? parsed.origin : '';
    } catch {
        return '';
    }
}

function authErrorMessage(error, fallback = 'Authentication failed. Please try again.') {
    const message = String(error?.message || error || '').trim();
    const looksTechnical = /supabase|postgrest|postgres|schema|migration|sqlstate|pgrst\d|database|permission denied|could not find the|relation .+ does not exist|column .+ does not exist|constraint|duplicate key|violates|stack trace|internal server|http\s*\d{3}|status code|failed to fetch|econn(?:refused|reset|timedout)?/i.test(message);
    if (looksTechnical) {
        const requestId = window.AsyncFeedback?.createRequestId('auth') || `auth-${Date.now().toString(36)}`;
        window.Observability?.reportError('auth', requestId, error, { source: 'auth-service' });
    }
    return window.Observability?.userMessage?.(error, fallback) || fallback;
}

async function parseAuthResponse(response) {
    const text = await response.text();
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch {
        return { error: text.slice(0, 240) };
    }
}

function authApiFetch(endpoint, options = {}) {
    if (window.VelveraAPI?.fetch) return window.VelveraAPI.fetch(endpoint, options);
    const origin = authApiOrigin();
    const path = String(endpoint || '');
    const url = /^https?:\/\//i.test(path)
        ? path
        : `${origin}${path.startsWith('/') ? path : `/${path}`}`;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    const { signal: upstreamSignal, ...fetchOptions } = options;
    const abortFromUpstream = () => controller.abort(upstreamSignal?.reason);
    if (upstreamSignal) {
        if (upstreamSignal.aborted) abortFromUpstream();
        else upstreamSignal.addEventListener('abort', abortFromUpstream, { once: true });
    }
    return fetch(url, {
        ...fetchOptions,
        credentials: 'omit',
        headers: { Accept: 'application/json', ...(options.headers || {}) },
        signal: controller.signal
    }).catch((error) => {
        if (error?.name === 'AbortError') {
            throw new Error('The authentication request timed out. Please try again.');
        }
        throw error;
    }).finally(() => {
        window.clearTimeout(timeout);
        upstreamSignal?.removeEventListener('abort', abortFromUpstream);
    });
}

const AuthService = {
    sessionMaxAgeMs: 6 * 60 * 60 * 1000,
    sessionStartedAtKey: 'velverahub_session_started_at',
    currentUser: null,
    userProfile: null,
    token: localStorage.getItem('velverahub_token'),
    authSubscription: null,
    initPromise: null,

    isStaticOnly() {
        return Boolean(window.VELVERAHUB_CONFIG?.STATIC_ONLY);
    },

    hasApiOrigin() {
        return Boolean(authApiOrigin());
    },

    syncApiToken(token, persist = false) {
        this.token = token || null;
        if (window.API?.setToken) {
            window.API.setToken(this.token, { persist });
        }
    },

    async loadSupabaseProfile(user) {
        if (!user) return null;

        const fallbackProfile = {
            ...(user.user_metadata || {}),
            id: user.id,
            user_id: user.id,
            email: user.email
        };
        const supabase = window.SupabaseClient?.get();
        if (!supabase || !window.SupabaseClient?.isConfigured()) {
            return fallbackProfile;
        }

        try {
            const { data: profile, error } = await supabase
                .from('profiles')
                .select('id, user_id, email, first_name, last_name, avatar_url, phone, phone_e164, phone_verified, phone_verified_at, role, business_name, business_state, business_institution')
                .or(`user_id.eq.${user.id},id.eq.${user.id}`)
                .limit(1)
                .maybeSingle();

            if (error) {
                window.Observability?.reportError('auth-profile-load', `auth-profile-${Date.now().toString(36)}`, error, { source: 'auth-service' });
                return fallbackProfile;
            }

            return profile
                ? { ...fallbackProfile, ...profile, auth_id: user.id }
                : fallbackProfile;
        } catch (error) {
            window.Observability?.reportError('auth-profile-load', `auth-profile-${Date.now().toString(36)}`, error, { source: 'auth-service' });
            return fallbackProfile;
        }
    },

    async applySupabaseSession(session, dispatch = true) {
        if (!session?.user) {
            this.syncApiToken(null, true);
            this.currentUser = null;
            this.userProfile = null;
            this.clearSessionStart();
            if (dispatch) {
                window.dispatchEvent(new CustomEvent('authStateChange', {
                    detail: { user: null, profile: null }
                }));
            }
            return null;
        }

        this.currentUser = session.user;
        // Supabase Auth is the source of truth, but the seller/admin API still
        // expects the current bearer token. Keep both clients in sync without
        // duplicating the Supabase token in localStorage.
        this.syncApiToken(session.access_token, false);
        localStorage.removeItem('velverahub_token');
        if (!localStorage.getItem(this.sessionStartedAtKey)) {
            localStorage.setItem(this.sessionStartedAtKey, String(Date.now()));
        }
        // A profile row is useful for routing and display, but it must never
        // make a valid Supabase session look like a failed sign-in. This is
        // especially important on static regional and shop-owner origins
        // where a slow or restricted PostgREST profile query can otherwise
        // leave the submit button spinning indefinitely.
        const fallbackProfile = {
            ...(session.user.user_metadata || {}),
            id: session.user.id,
            user_id: session.user.id,
            email: session.user.email
        };
        const profilePromise = this.loadSupabaseProfile(session.user)
            .catch((error) => {
                window.Observability?.reportError('auth-profile-load', `auth-profile-${Date.now().toString(36)}`, error, { source: 'auth-service' });
                return fallbackProfile;
            });
        this.userProfile = await Promise.race([
            profilePromise,
            new Promise((resolve) => window.setTimeout(() => resolve(fallbackProfile), 5000))
        ]);
        if (dispatch) {
            window.dispatchEvent(new CustomEvent('authStateChange', {
                detail: { user: this.currentUser, profile: this.userProfile }
            }));
        }
        return this.currentUser;
    },

    async _init() {
        // Generated Cloudflare pages load configuration asynchronously. Wait
        // for that promise before deciding whether Supabase is available;
        // otherwise a page refresh can incorrectly fall through to the local
        // Express auth API and make a valid session look signed out.
        if (window.supabaseConfigReady) {
            await window.supabaseConfigReady;
        }

        // Use Supabase if configured, otherwise fallback to API
        if (window.SupabaseClient && window.SupabaseClient.isConfigured()) {
            const supabase = window.SupabaseClient.get();
            try {
                this.authSubscription?.unsubscribe?.();
                this.authSubscription = supabase.auth.onAuthStateChange((event, nextSession) => {
                    // Supabase recommends keeping async work out of the auth
                    // callback to avoid blocking its internal lock.
                    setTimeout(() => {
                        this.applySupabaseSession(nextSession, true).catch((error) => {
                            window.Observability?.reportError('auth-session-update', `auth-session-${Date.now().toString(36)}`, error, { source: 'auth-service' });
                        });
                    }, 0);
                }).data?.subscription;

                const { data: { session } } = await supabase.auth.getSession();
                if (session?.user && this.isSessionExpired()) {
                    await supabase.auth.signOut();
                    this.clearSessionStart();
                    await this.applySupabaseSession(null);
                    return null;
                }
                await this.applySupabaseSession(session);
                return this.currentUser;
            } catch (error) {
                window.Observability?.reportError('auth-session-check', `auth-check-${Date.now().toString(36)}`, error, { source: 'auth-service' });
            }
        }

        if ((this.isStaticOnly() && !this.hasApiOrigin()) || !this.token) return null;
        if (this.isSessionExpired()) {
            this.clearLocalSession(true);
            return null;
        }
        if (!localStorage.getItem(this.sessionStartedAtKey)) {
            localStorage.setItem(this.sessionStartedAtKey, String(Date.now()));
        }
        
        try {
            const response = await authApiFetch('/api/auth/me', {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            
            if (response.ok) {
                const user = await response.json();
                this.currentUser = user;
                this.userProfile = user;
                window.dispatchEvent(new CustomEvent('authStateChange', { 
                    detail: { user: this.currentUser, profile: this.userProfile } 
                }));
                return user;
            } else {
                this.clearLocalSession(true);
            }
        } catch (error) {
            window.Observability?.reportError('auth-init', `auth-init-${Date.now().toString(36)}`, error, { source: 'auth-service' });
        }
        return null;
    },

    init() {
        // Every standalone HTML page loads its own JavaScript context. Reuse
        // one initialization promise per page so navigation, page scripts,
        // and the shared header cannot race and briefly render a signed-out
        // state while Supabase restores the persisted session.
        if (!this.initPromise) {
            this.initPromise = this._init().catch((error) => {
                this.initPromise = null;
                throw error;
            });
        }
        return this.initPromise;
    },

    clearLocalSession(expired = false) {
        this.syncApiToken(null);
        this.currentUser = null;
        this.userProfile = null;
        localStorage.removeItem('velverahub_token');
        this.clearSessionStart();
        window.dispatchEvent(new CustomEvent('authStateChange', {
            detail: { user: null, profile: null, expired }
        }));
    },

    async signUp(email, password, userData = {}) {
        if (window.supabaseConfigReady) await window.supabaseConfigReady;
        const normalizedEmail = String(email || '').trim().toLowerCase();
        if (window.PhoneVerification?.isEnabled && await window.PhoneVerification.isEnabled(true)) {
            try {
                const verification = await window.PhoneVerification.verifyForSignup(
                    normalizedEmail,
                    userData.phone || userData.businessPhone || ''
                );
                if (!verification?.ticket || !verification?.phone) {
                    return {
                        data: null,
                        error: { message: 'Verify your Nigerian phone number before creating an account.' }
                    };
                }
                userData = {
                    ...userData,
                    phone_e164: verification.phone,
                    phone_verification_ticket: verification.ticket
                };
            } catch (error) {
                return {
                    data: null,
                    error: { message: authErrorMessage(error, 'Phone verification could not be completed.') }
                };
            }
        }
        if (window.SupabaseClient && window.SupabaseClient.isConfigured()) {
            const supabase = window.SupabaseClient.get();
            try {
                const { data, error } = await supabase.auth.signUp({
                    email: normalizedEmail,
                    password,
                    options: {
                        data: {
                            ...userData,
                            phone: userData.phone || userData.businessPhone || '',
                            businessPhone: userData.businessPhone || userData.phone || ''
                        }
                    }
                });
                if (error) {
                    window.Observability?.track('auth_failure', { provider: 'supabase', action: 'sign_up' });
                    return { data: null, error };
                }
                // Email-confirmation projects return a user without a session.
                // Do not mark that account as logged in until confirmation/sign-in.
                await this.applySupabaseSession(data.session, true);
                return { data: this.currentUser, user: data.user || null, error: null };
            } catch (error) {
                window.Observability?.track('auth_failure', { provider: 'supabase', action: 'sign_up' });
                window.Observability?.reportError('auth-sign-up', `auth-${Date.now().toString(36)}`, error, { source: 'auth-service' });
                return { data: null, error: { message: authErrorMessage(error, 'Account creation failed.') } };
            }
        }
        if (this.isStaticOnly() && !this.hasApiOrigin()) {
            const error = new Error('Marketplace sign-in is not configured for this environment.');
            window.Observability?.reportError('auth-configuration', `auth-config-${Date.now().toString(36)}`, error, { source: 'auth-service' });
            return { data: null, error: { message: 'Sign-in is temporarily unavailable. Please try again later.' } };
        }

        return this.signUpWithApi(normalizedEmail, password, userData);
    },

    async signUpWithApi(email, password, userData = {}) {
        try {
            const response = await authApiFetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email,
                    password,
                    firstName: userData.firstName || '',
                    lastName: userData.lastName || '',
                    phone: userData.phone || userData.businessPhone || '',
                    accountType: userData.accountType || 'customer',
                    businessName: userData.businessName || '',
                    businessState: userData.businessState || '',
                    businessInstitution: userData.businessInstitution || '',
                    ageConfirmed: userData.ageConfirmed === true,
                    termsAccepted: userData.termsAccepted === true
                })
            });

            const data = await parseAuthResponse(response);
            
            if (!response.ok) {
                window.Observability?.track('auth_failure', { provider: 'api', action: 'sign_up' });
                return { data: null, error: { message: data.error || 'Registration failed.' } };
            }
            if (!data.token || !data.user) {
                window.Observability?.track('auth_failure', { provider: 'api', action: 'sign_up' });
                return { data: null, error: { message: 'Account creation completed without a valid session. Please try signing in.' } };
            }

            this.syncApiToken(data.token, true);
            localStorage.setItem(this.sessionStartedAtKey, String(Date.now()));
            this.currentUser = data.user;
            this.userProfile = data.user;
            
            window.dispatchEvent(new CustomEvent('authStateChange', { 
                detail: { user: this.currentUser, profile: this.userProfile } 
            }));

            return { data: data.user, user: data.user, error: null };
        } catch (error) {
            window.Observability?.track('auth_failure', { provider: 'api', action: 'sign_up' });
            window.Observability?.reportError('auth-sign-up', `auth-${Date.now().toString(36)}`, error, { source: 'auth-service' });
            return { data: null, error: { message: authErrorMessage(error, 'Registration failed.') } };
        }
    },

    async signIn(email, password) {
        if (window.supabaseConfigReady) await window.supabaseConfigReady;
        const normalizedEmail = String(email || '').trim().toLowerCase();
        if (window.SupabaseClient && window.SupabaseClient.isConfigured()) {
            const supabase = window.SupabaseClient.get();
            try {
                const { data, error } = await supabase.auth.signInWithPassword({
                    email: normalizedEmail,
                    password
                });
                if (error) {
                    window.Observability?.track('auth_failure', { provider: 'supabase', action: 'sign_in' });
                    return { data: null, error };
                }
                await this.applySupabaseSession(data.session, true);
                return { data: this.currentUser, error: null };
            } catch (error) {
                window.Observability?.track('auth_failure', { provider: 'supabase', action: 'sign_in' });
                window.Observability?.reportError('auth-sign-in', `auth-${Date.now().toString(36)}`, error, { source: 'auth-service' });
                return { data: null, error: { message: authErrorMessage(error, 'Sign-in could not be completed. Please try again.') } };
            }
        }
        if (this.isStaticOnly() && !this.hasApiOrigin()) {
            const error = new Error('Marketplace sign-in is not configured for this environment.');
            window.Observability?.reportError('auth-configuration', `auth-config-${Date.now().toString(36)}`, error, { source: 'auth-service' });
            return { data: null, error: { message: 'Sign-in is temporarily unavailable. Please try again later.' } };
        }

        return this.signInWithApi(normalizedEmail, password);
    },

    async signInWithApi(email, password) {
        try {
            const response = await authApiFetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            const data = await parseAuthResponse(response);
            
            if (!response.ok) {
                window.Observability?.track('auth_failure', { provider: 'api', action: 'sign_in' });
                return { data: null, error: { message: data.error || 'Invalid credentials.' } };
            }
            if (!data.token || !data.user) {
                window.Observability?.track('auth_failure', { provider: 'api', action: 'sign_in' });
                return { data: null, error: { message: 'Sign in completed without a valid session. Please try again.' } };
            }

            this.syncApiToken(data.token, true);
            localStorage.setItem(this.sessionStartedAtKey, String(Date.now()));
            this.currentUser = data.user;
            this.userProfile = data.user;
            
            window.dispatchEvent(new CustomEvent('authStateChange', { 
                detail: { user: this.currentUser, profile: this.userProfile } 
            }));

            return { data: data.user, user: data.user, error: null };
        } catch (error) {
            window.Observability?.track('auth_failure', { provider: 'api', action: 'sign_in' });
            window.Observability?.reportError('auth-sign-in', `auth-${Date.now().toString(36)}`, error, { source: 'auth-service' });
            return { data: null, error: { message: authErrorMessage(error, 'Sign in failed.') } };
        }
    },

    async signOut() {
        if (window.SupabaseClient && window.SupabaseClient.isConfigured()) {
            const supabase = window.SupabaseClient.get();
            try {
                await supabase.auth.signOut();
            } catch (error) {
                window.Observability?.reportError('auth-sign-out', `auth-${Date.now().toString(36)}`, error, { source: 'auth-service' });
            }
        }

        this.clearLocalSession(false);
    },

    getUser() {
        return this.currentUser;
    },

    getProfile() {
        return this.userProfile;
    },

    isLoggedIn() {
        return this.currentUser !== null;
    },

    isAdmin() {
        return this.userProfile?.role === 'admin';
    },

    isSeller() {
        // Selling is a capability available to every authenticated account.
        // A shop-owner role remains a separate concern and is resolved by the
        // seller workspace from an actual shops ownership relationship.
        return Boolean(this.currentUser);
    },

    isSellerAccount() {
        const profile = this.userProfile || {};
        const metadata = this.currentUser?.user_metadata || {};
        return [
            profile.account_type,
            profile.role,
            metadata.accountType
        ].some((value) => ['seller', 'shop_owner'].includes(String(value || '').toLowerCase()));
    },

    getToken() {
        return this.token;
    },

    clearSessionStart() {
        localStorage.removeItem(this.sessionStartedAtKey);
    },

    isSessionExpired() {
        const startedAt = Number(localStorage.getItem(this.sessionStartedAtKey));
        return Boolean(startedAt && Date.now() - startedAt >= this.sessionMaxAgeMs);
    }
};

window.AuthService = AuthService;
