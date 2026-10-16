if (typeof window.supabaseInstance === 'undefined') {
    window.supabaseInstance = null;
    window.isSupabaseConfiguredInstance = false;
    window.configLoadedStatus = false;
    window.supabaseConfigPromise = null;
    window.productionReadiness = {
        ready: false,
        reason: 'Live catalogue configuration has not been loaded.'
    };
}

async function loadConfig() {
    if (window.configLoadedStatus) return;
    if (window.supabaseConfigPromise) return window.supabaseConfigPromise;

    window.supabaseConfigPromise = (async () => {
        // The public client is intentionally configured only by a static
        // browser config. It must not depend on Cloudflare bindings or an API
        // endpoint just to discover a public Supabase URL and anon key.
        const localConfigKey = window.VELVERAHUB_CONFIG?.SUPABASE_PUBLISHABLE_KEY
            || window.VELVERAHUB_CONFIG?.SUPABASE_ANON_KEY;
        const isPlaceholderConfig = /YOUR-PROJECT|YOUR_PUBLIC_ANON_KEY/i.test(
            `${window.VELVERAHUB_CONFIG?.SUPABASE_URL || ''}${localConfigKey || ''}`
        );
        if (window.VELVERAHUB_CONFIG?.SUPABASE_URL && localConfigKey && !isPlaceholderConfig) {
            if (initSupabase(window.VELVERAHUB_CONFIG.SUPABASE_URL, localConfigKey)) {
                window.configLoadedStatus = true;
                window.productionReadiness = { ready: true, source: 'static browser config' };
                return;
            }
        }

        // Product pages can continue through their regular API path when a
        // static Supabase config has not been supplied. Missing optional
        // client configuration is not a storefront outage and must not block
        // the catalogue UI.
        window.productionReadiness = {
            ready: true,
            source: 'catalogue API fallback'
        };
        window.configLoadedStatus = true;
    })();

    return window.supabaseConfigPromise;
}

function cleanRuntimeValue(value) {
    return String(value || '')
        .trim()
        .replace(/^[\s"'`]+/, '')
        .replace(/[\s"'`,;]+$/, '');
}

function cleanSupabaseUrl(value) {
    const candidate = cleanRuntimeValue(value).replace(/\/+$/, '');
    if (!candidate) return '';
    try {
        const parsed = new URL(candidate, window.location.origin);
        if (!['http:', 'https:'].includes(parsed.protocol)) return '';
        return parsed.toString().replace(/\/+$/, '');
    } catch (_) {
        return '';
    }
}

function initSupabase(url, key) {
    const normalizedUrl = cleanSupabaseUrl(url);
    const normalizedKey = cleanRuntimeValue(key);
    if (!normalizedUrl || !normalizedKey) return false;
    
    if (typeof window.supabase === 'undefined') {
        reportClientStartupError('marketplace-client-init', new Error('Marketplace data provider library is unavailable.'));
        return false;
    }

    try {
        window.supabaseInstance = window.supabase.createClient(normalizedUrl, normalizedKey, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true,
                storageKey: 'velverahub-auth'
            }
        });
        window.isSupabaseConfiguredInstance = true;
        return true;
    } catch (error) {
        reportClientStartupError('marketplace-client-init', error);
        return false;
    }
}

function getSupabase() {
    return window.supabaseInstance;
}

function isSupabaseConfigured() {
    return window.isSupabaseConfiguredInstance && window.supabaseInstance !== null;
}

async function testConnection() {
    if (!window.supabaseInstance) return false;
    try {
        const { error } = await window.supabaseInstance.from('products').select('id').limit(1);
        return !error;
    } catch {
        return false;
    }
}

function setCredentials(url, key) {
    // Runtime configuration belongs in deployment variables, not browser
    // storage. This method is retained for compatibility with older pages.
    return initSupabase(url, key);
}

function showConfigPrompt() {
    if (!isSupabaseConfiguredInstance) {
        console.info('Marketplace connection is not configured for this environment.');
    }
}

function reportClientStartupError(scope, error) {
    if (window.Observability?.reportError) {
        window.Observability.reportError(scope, `startup-${Date.now().toString(36)}`, error, { source: 'bootstrap' });
        return;
    }
    window.__velveraPendingClientErrors ||= [];
    window.__velveraPendingClientErrors.push({ scope, error });
}

// Global accessor
window.SupabaseClient = {
    init: initSupabase,
    get: getSupabase,
    isConfigured: isSupabaseConfigured,
    testConnection,
    setCredentials,
    showConfigPrompt,
    loadConfig,
    isLoading: () => !window.configLoadedStatus
};

// Start initialization immediately, while allowing page boot code to await it.
window.supabaseConfigReady = loadConfig();
