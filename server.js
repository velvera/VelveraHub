const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 5000;
const HOST = '0.0.0.0';
app.disable('x-powered-by');

// Express must only trust proxy headers when the deployment explicitly
// configures the proxy boundary. Otherwise an attacker can spoof X-Forwarded-For
// and evade IP-based controls.
const configuredTrustProxy = cleanRuntimeValue(process.env.TRUST_PROXY);
if (configuredTrustProxy === 'true') {
    app.set('trust proxy', true);
} else if (/^\d+$/.test(configuredTrustProxy)) {
    app.set('trust proxy', Number(configuredTrustProxy));
} else if (configuredTrustProxy) {
    app.set('trust proxy', configuredTrustProxy.split(',').map((value) => value.trim()).filter(Boolean));
}

function cleanRuntimeValue(value) {
    return String(value || '')
        .trim()
        .replace(/^[\s"'`]+/, '')
        .replace(/[\s"'`,;]+$/, '');
}

function cleanSupabaseUrl(value) {
    const candidate = cleanRuntimeValue(value).replace(/\/+$/, '');
    try {
        const parsed = new URL(candidate);
        if (!['http:', 'https:'].includes(parsed.protocol)) return '';
        return parsed.toString().replace(/\/+$/, '');
    } catch (_) {
        return '';
    }
}

const SUPABASE_URL = cleanSupabaseUrl(process.env.SUPABASE_URL);
const SUPABASE_ANON_KEY = cleanRuntimeValue(
    process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY
);

const LOCAL_ASSET_VERSION = '20261125-1';

function bustLocalAssetCache(html) {
    return html.replace(
        /((?:href|src)=")(?!https?:\/\/)([^"]+\.(?:css|js))(?:\?[^"]*)?(")/gi,
        `$1$2?v=${LOCAL_ASSET_VERSION}$3`
    );
}

function injectDomainRouting(html) {
    const cacheBustedHtml = bustLocalAssetCache(html);
    if (!cacheBustedHtml.includes('</head>') || cacheBustedHtml.includes('/assets/js/services/domain-routing.js')) {
        return cacheBustedHtml;
    }
    return cacheBustedHtml.replace(
        /<\/head>/i,
        '<script src="/assets/js/services/domain-routing.js"></script></head>'
    );
}

function surfaceForHost(hostname) {
    const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
    if (host === 'velverahub.shop') return 'shop';
    if (host === 'velverahub.org') return 'admin';
    if (host === 'velverahub.com') return 'ng';
    if (host === 'velverahub.co.uk') return 'uk';
    return 'local';
}

function redirectToSurface(req, res, origin, pathname = '/') {
    const destination = new URL(pathname, origin);
    destination.search = req.originalUrl.includes('?')
        ? req.originalUrl.slice(req.originalUrl.indexOf('?'))
        : '';
    return res.redirect(302, destination.toString());
}

function surfaceRoutingMiddleware(req, res, next) {
    const surface = surfaceForHost(req.hostname);
    if (surface === 'local') return next();

    if (surface === 'shop') {
        if (req.path.startsWith('/dashboards/admin')) {
            return redirectToSurface(req, res, 'https://velverahub.org', '/dashboards/admin/');
        }
        if (!req.path.startsWith('/api/')) {
            req.url = `/velverahub-shop${req.url === '/' ? '/index.html' : req.url}`;
        }
        return next();
    }

    if (surface === 'seller') {
        if (req.path === '/' || req.path === '/index.html' || req.path === '/pages/sell.html') {
            return redirectToSurface(req, res, 'https://velverahub.shop', '/');
        }
        if (req.path.startsWith('/dashboards/admin')) {
            return redirectToSurface(req, res, 'https://velverahub.org', '/dashboards/admin/');
        }
    }

    if (surface === 'admin') {
        if (req.path === '/' || req.path === '/index.html') {
            return redirectToSurface(req, res, 'https://velverahub.org', '/dashboards/admin/');
        }
        if (req.path.startsWith('/dashboards/shop-owner')) {
            return redirectToSurface(req, res, 'https://velverahub.shop', '/');
        }
    }

    if (surface === 'ng' || surface === 'uk') {
        if (req.path.startsWith('/dashboards/shop-owner')) {
            return redirectToSurface(req, res, 'https://velverahub.shop', '/');
        }
        if (req.path.startsWith('/dashboards/admin')) {
            return redirectToSurface(req, res, 'https://velverahub.org', '/dashboards/admin/');
        }
    }

    next();
}

const NIGERIAN_STATES = [
    'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa',
    'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo',
    'Ekiti', 'Enugu', 'FCT (Abuja)', 'Gombe', 'Imo', 'Jigawa',
    'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara',
    'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun',
    'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara'
];
const LOCATION_OPTIONS = [
    ...NIGERIAN_STATES,
    'London', 'South East England', 'South West England',
    'East of England', 'East Midlands', 'West Midlands',
    'Yorkshire & The Humber', 'North West England', 'North East England',
    'Scotland', 'Wales', 'Northern Ireland'
];
const AD_PRICE_NGN = 999;
const MARKET_CONTEXTS = {
    ng: {
        country: 'Nigeria',
        language: 'en-NG',
        paymentMethods: ['bank_transfer', 'cash_on_delivery'],
        cashOnDeliveryRisk: 0.34,
        mobilePaymentReliability: 0.76,
        promotion: 'Save on local delivery lanes and eligible pay-on-delivery orders',
        localSignalWeight: 0.22
    },
    uk: {
        country: 'United Kingdom',
        language: 'en-GB',
        paymentMethods: ['bank_transfer', 'cash_on_delivery'],
        cashOnDeliveryRisk: 0.08,
        mobilePaymentReliability: 0.94,
        promotion: 'Free delivery on qualifying UK orders',
        localSignalWeight: 0.16
    }
};

function isMissingSchemaError(error) {
    return ['42P01', '42703'].includes(error?.code);
}

const DELIVERY_HOLIDAYS = {
    ng: ['01-01', '05-01', '05-29', '06-12', '10-01', '12-25', '12-26'],
    uk: ['01-01', '04-18', '04-21', '05-05', '05-26', '08-25', '12-25', '12-26']
};

function addBusinessDays(start, days, region = 'ng') {
    const date = new Date(start);
    let remaining = Math.max(0, Number(days) || 0);
    while (remaining > 0) {
        date.setDate(date.getDate() + 1);
        const monthDay = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        if (date.getDay() !== 0 && date.getDay() !== 6 && !(DELIVERY_HOLIDAYS[region] || []).includes(monthDay)) remaining--;
    }
    return date;
}

function calculatePromise({ location, processingDays = 1, courierDays = 3, cutoffHour = 14, reliability = 86 } = {}) {
    const region = NIGERIAN_STATES.includes(location) ? 'ng' : 'uk';
    const now = new Date();
    const cutoffPassed = now.getHours() >= Number(cutoffHour || 14);
    const handling = Math.max(1, Number(processingDays) || 1) + (cutoffPassed ? 1 : 0);
    const earliest = addBusinessDays(now, handling + Math.max(1, Number(courierDays) || 1) - 1, region);
    const latest = addBusinessDays(now, handling + Math.max(2, Number(courierDays) || 1) + 1, region);
    return {
        earliest: earliest.toISOString(),
        latest: latest.toISOString(),
        reliability: Math.max(50, Math.min(99, Number(reliability) || 86)),
        cutoffPassed,
        label: `${earliest.toLocaleDateString(region === 'uk' ? 'en-GB' : 'en-NG', { month: 'short', day: 'numeric' })}–${latest.toLocaleDateString(region === 'uk' ? 'en-GB' : 'en-NG', { month: 'short', day: 'numeric' })}`
    };
}

function listingQuality({ title = '', description = '', category = '', imageUrl = null, provenanceUrl = null } = {}) {
    const errors = [];
    const warnings = [];
    if (String(title).trim().length < 12) errors.push('Use a more descriptive title (12+ characters).');
    if (String(description).trim().length < 40) warnings.push('Add more detail to improve buyer confidence.');
    if (!String(category).trim()) errors.push('Choose a category.');
    if (!imageUrl) warnings.push('Add at least one product image.');
    if (['electronics', 'beauty', 'automotive'].some(value => String(category).toLowerCase().includes(value)) && !provenanceUrl) {
        warnings.push('Add an authenticity or provenance reference for this category.');
    }
    if (/(cure|guaranteed cure|miracle|100% risk[- ]free|fake review)/i.test(`${title} ${description}`)) {
        errors.push('Remove unsupported medical, guarantee, or review claims.');
    }
    return {
        score: Math.max(0, Math.min(100, 100 - errors.length * 24 - warnings.length * 10)),
        errors,
        warnings,
        policyStatus: errors.length ? 'blocked' : warnings.length ? 'review' : 'ready'
    };
}

const configuredJwtSecret = process.env.JWT_SECRET || process.env.SESSION_SECRET;
if (!configuredJwtSecret && process.env.NODE_ENV === 'production') {
    console.error('FATAL: JWT_SECRET (or SESSION_SECRET fallback) is not set in production. Refusing to start.');
    process.exit(1);
}
if (!process.env.DATABASE_URL && process.env.NODE_ENV === 'production') {
    console.error('FATAL: DATABASE_URL is not set in production. Refusing to start.');
    process.exit(1);
}
const JWT_SECRET = configuredJwtSecret || 'velverahub-dev-secret-key-change-in-production';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    query_timeout: 10000,
    statement_timeout: 10000
});

const defaultCorsOrigins = [
    'http://localhost:5000',
    'http://127.0.0.1:5000',
    'https://velverahub.com',
    'https://velverahub.co.uk',
    'https://velverahub.org',
    'https://velverahub.shop'
];
const corsOrigins = String(process.env.API_CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
const allowedCorsOrigins = new Set(corsOrigins.length ? corsOrigins : defaultCorsOrigins);

app.use(cors({
    origin(origin, callback) {
        // Non-browser health checks and same-origin preview requests have no
        // Origin header. Cross-origin browser calls must use the allowlist.
        if (!origin || allowedCorsOrigins.has(origin)) return callback(null, true);
        // Let Express serve the route without CORS headers. The browser then
        // blocks the response without turning a rejected origin into a 500.
        return callback(null, false);
    },
    // The API deliberately does not authenticate with ambient browser cookies.
    // Frontends send Supabase/JWT bearer tokens explicitly instead.
    credentials: false,
    methods: ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept', 'X-Request-ID', 'Idempotency-Key'],
    exposedHeaders: ['X-Request-ID', 'X-Pagination-Limit', 'X-Pagination-Offset', 'X-Pagination-Total'],
    maxAge: 600
}));
app.use((req, res, next) => {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    req.requestId = requestId;
    res.setHeader('X-Request-ID', requestId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
        'Cross-Origin-Resource-Policy',
        req.path.startsWith('/api/') || req.path === '/healthz' ? 'cross-origin' : 'same-site'
    );

    if (req.path.startsWith('/api/')) {
        res.on('finish', () => {
            const durationMs = Math.max(0, Date.now() - startedAt);
            const requestLog = {
                level: 'info',
                event: 'api_request',
                requestId,
                method: req.method,
                path: req.path,
                status: res.statusCode,
                durationMs
            };
            console.info(JSON.stringify(requestLog));
            if (durationMs >= 1500) {
                console.warn(JSON.stringify({ ...requestLog, level: 'warn', event: 'slow_api_request' }));
            }
        });
    }
    if (process.env.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    if (process.env.NODE_ENV === 'production' && (req.path.endsWith('.html') || req.path === '/')) {
        res.setHeader('Content-Security-Policy', [
            "default-src 'self'",
            "base-uri 'self'",
            "object-src 'none'",
             "frame-ancestors 'none'",
            "form-action 'self' https:",
            "img-src 'self' data: blob: https:",
            "font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
            "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
            "connect-src 'self' https: wss:",
            "media-src 'self' blob: https:",
             "manifest-src 'self'",
             "worker-src 'self' blob:",
            "upgrade-insecure-requests"
        ].join('; '));
    }
    next();
});
app.use(express.json({ limit: '2mb', strict: true }));

const rateLimitStoreMode = String(process.env.RATE_LIMIT_STORE || 'memory').trim().toLowerCase();
const rateLimitMemoryMaxKeys = Math.min(
    100000,
    Math.max(1000, Number.parseInt(process.env.RATE_LIMIT_MEMORY_MAX_KEYS || '50000', 10) || 50000)
);
const rateLimitBuckets = new Map();
let rateLimitStoreWarningShown = false;

function rateLimitClientIp(req) {
    // req.ip is proxy-aware only when TRUST_PROXY is explicitly configured.
    return String(req.ip || req.socket?.remoteAddress || 'unknown').slice(0, 128);
}

function rateLimitKey(req, name) {
    const parts = [`${name}:${rateLimitClientIp(req)}`];
    // Login/register limits are keyed by both IP and a one-way account
    // fingerprint so one hostile IP cannot cycle through unlimited accounts,
    // while the raw email never enters memory or logs.
    if (req.baseUrl === '/api/auth' || req.originalUrl.startsWith('/api/auth/')) {
        const email = String(req.body?.email || '').trim().toLowerCase();
        if (email) parts.push(`account:${crypto.createHash('sha256').update(email).digest('hex').slice(0, 24)}`);
    }
    return parts.join('|');
}

function memoryRateLimitHit(key, windowMs) {
    const now = Date.now();
    const current = rateLimitBuckets.get(key);
    const bucket = !current || now >= current.resetAt
        ? { count: 0, resetAt: now + windowMs, touchedAt: now }
        : current;
    bucket.count += 1;
    bucket.touchedAt = now;
    rateLimitBuckets.set(key, bucket);

    if (rateLimitBuckets.size > rateLimitMemoryMaxKeys) {
        const entries = [...rateLimitBuckets.entries()]
            .sort((left, right) => left[1].touchedAt - right[1].touchedAt)
            .slice(0, Math.ceil(rateLimitMemoryMaxKeys * 0.1));
        for (const [staleKey] of entries) rateLimitBuckets.delete(staleKey);
    }
    for (const [staleKey, staleBucket] of rateLimitBuckets) {
        if (staleBucket.resetAt <= now) rateLimitBuckets.delete(staleKey);
    }
    return { count: bucket.count, resetAt: bucket.resetAt };
}

async function postgresRateLimitHit(key, windowMs) {
    const result = await pool.query(`
        INSERT INTO api_rate_limit_buckets (
            bucket_key, window_started_at, request_count, expires_at
        )
        VALUES ($1, now(), 1, now() + ($2::TEXT || ' milliseconds')::INTERVAL)
        ON CONFLICT (bucket_key) DO UPDATE SET
            window_started_at = CASE
                WHEN api_rate_limit_buckets.expires_at <= now() THEN now()
                ELSE api_rate_limit_buckets.window_started_at
            END,
            request_count = CASE
                WHEN api_rate_limit_buckets.expires_at <= now() THEN 1
                ELSE api_rate_limit_buckets.request_count + 1
            END,
            expires_at = CASE
                WHEN api_rate_limit_buckets.expires_at <= now()
                    THEN now() + ($2::TEXT || ' milliseconds')::INTERVAL
                ELSE api_rate_limit_buckets.expires_at
            END
        RETURNING request_count, expires_at
    `, [key, Math.round(windowMs)]);
    const row = result.rows[0];
    return {
        count: Number(row.request_count),
        resetAt: new Date(row.expires_at).getTime()
    };
}

function isMutatingRequest(req) {
    return !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
}

function rateLimit({
    windowMs = 15 * 60 * 1000,
    max = 120,
    name = 'requests',
    failClosed = false
} = {}) {
    return async (req, res, next) => {
        const key = rateLimitKey(req, name);
        let bucket;
        try {
            if (rateLimitStoreMode === 'postgres') {
                bucket = await postgresRateLimitHit(key, windowMs);
            } else {
                if (rateLimitStoreMode !== 'memory' && !rateLimitStoreWarningShown) {
                    rateLimitStoreWarningShown = true;
                    console.warn('Unknown RATE_LIMIT_STORE; using bounded memory rate limiting.');
                }
                bucket = memoryRateLimitHit(key, windowMs);
            }
        } catch (error) {
            // A configured shared store must not silently degrade on writes and
            // authentication. Public reads may continue with the bounded local
            // guard while the operator repairs the shared store.
            if (rateLimitStoreMode === 'postgres' && failClosed && isMutatingRequest(req)) {
                console.error(JSON.stringify({
                    level: 'error',
                    event: 'rate_limit_store_unavailable',
                    requestId: req.requestId,
                    path: req.path,
                    error: error.message
                }));
                return res.status(503).json({
                    error: 'Request protection is temporarily unavailable. Please try again.',
                    requestId: req.requestId
                });
            }
            if (rateLimitStoreMode === 'postgres') {
                console.error(JSON.stringify({
                    level: 'error',
                    event: 'rate_limit_store_fallback',
                    requestId: req.requestId,
                    path: req.path,
                    error: error.message
                }));
            }
            bucket = memoryRateLimitHit(key, windowMs);
        }

        const resetSeconds = Math.max(0, Math.ceil((bucket.resetAt - Date.now()) / 1000));
        res.setHeader('RateLimit-Limit', String(max));
        res.setHeader('RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
        res.setHeader('RateLimit-Reset', String(resetSeconds));
        res.setHeader('RateLimit-Policy', `${max};w=${Math.ceil(windowMs / 1000)}`);
        if (bucket.count > max) {
            res.setHeader('Retry-After', String(resetSeconds));
            return res.status(429).json({
                error: `Too many ${name}. Please try again later.`,
                requestId: req.requestId
            });
        }
        next();
    };
}

function boundedPagination(req, { defaultLimit = 50, maxLimit = 100 } = {}) {
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const requestedOffset = Number.parseInt(req.query.offset, 10);
    return {
        limit: Number.isFinite(requestedLimit)
            ? Math.min(Math.max(requestedLimit, 1), maxLimit)
            : defaultLimit,
        offset: Number.isFinite(requestedOffset)
            ? Math.max(requestedOffset, 0)
            : 0
    };
}

function setPaginationHeaders(res, { limit, offset, total }) {
    res.setHeader('X-Pagination-Limit', String(limit));
    res.setHeader('X-Pagination-Offset', String(offset));
    if (Number.isFinite(total)) res.setHeader('X-Pagination-Total', String(total));
}

// A bounded request surface protects every public API, while stricter
// route-level limits cover the endpoints most often targeted by abuse.
app.use('/api', rateLimit({ max: 240, name: 'api requests' }));
app.use('/api/auth', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    name: 'authentication requests',
    failClosed: true
}));
app.use('/api/orders', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    name: 'order requests',
    failClosed: true
}));
app.use('/api/account', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    name: 'account requests',
    failClosed: true
}));
app.use('/api/admin', rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 120,
    name: 'admin requests',
    failClosed: true
}));
app.use('/api/seller', rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 120,
    name: 'seller requests',
    failClosed: true
}));
app.use('/api/analytics', rateLimit({ max: 60, name: 'analytics requests' }));
app.use('/api/observability', rateLimit({ max: 60, name: 'observability requests' }));
app.use((req, res, next) => {
    if (req.path.startsWith('/api/') && req.originalUrl.length > 4096) {
        return res.status(414).json({ error: 'Request URL is too long', requestId: req.requestId });
    }
    next();
});

const BRAND_LOGO_PATH = path.join(__dirname, 'img', 'logo.png');

function getBrandingPayload() {
    if (!fs.existsSync(BRAND_LOGO_PATH)) return { logoUrl: null };
    const stat = fs.statSync(BRAND_LOGO_PATH);
    return { logoUrl: `/img/logo.png?v=${stat.mtimeMs}` };
}

function healthPayload() {
    return {
        status: 'ok',
        service: 'velverahub-api',
        version: LOCAL_ASSET_VERSION,
        auth: 'bearer-token',
        cookies: 'not-used'
    };
}

app.get(['/healthz', '/api/health'], (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(healthPayload());
});

const DEFAULT_SEO_SETTINGS = {
    site_name: 'VelveraHub',
    meta_title: 'VelveraHub — Smart marketplace for everyday shopping',
    meta_description: 'VelveraHub is a trusted marketplace for discovering products from verified shops across Nigeria and the United Kingdom.',
    keywords: 'VelveraHub, online marketplace, Nigeria shopping, UK shopping, verified shops',
    canonical_base_url: '',
    og_title: 'VelveraHub — Smart marketplace for everyday shopping',
    og_description: 'Discover products from verified shops across Nigeria and the United Kingdom.',
    og_image_url: '/img/velverahub.png',
    og_image_alt: 'VelveraHub marketplace',
    twitter_handle: '',
    locale: 'en_GB',
    robots: 'index,follow',
    social_profiles: ''
};

async function getSeoSettings() {
    try {
        const result = await pool.query(`
            SELECT site_name, meta_title, meta_description, keywords,
                   canonical_base_url, og_title, og_description, og_image_url,
                   og_image_alt, twitter_handle, locale, robots, social_profiles,
                   updated_at
            FROM site_settings
            WHERE id = 'seo'
            LIMIT 1
        `);
        return { ...DEFAULT_SEO_SETTINGS, ...(result.rows[0] || {}) };
    } catch (error) {
        if (!isMissingSchemaError(error)) console.warn('SEO settings unavailable:', error.message);
        return { ...DEFAULT_SEO_SETTINGS };
    }
}

function publicSeoPayload(settings, req) {
    const base = String(
        settings.canonical_base_url
        || process.env.PUBLIC_SITE_URL
        || `${req.protocol}://${req.get('host')}`
    ).replace(/\/+$/, '');
    const image = String(settings.og_image_url || DEFAULT_SEO_SETTINGS.og_image_url);
    return {
        siteName: settings.site_name || DEFAULT_SEO_SETTINGS.site_name,
        title: settings.meta_title || DEFAULT_SEO_SETTINGS.meta_title,
        description: settings.meta_description || DEFAULT_SEO_SETTINGS.meta_description,
        keywords: settings.keywords || DEFAULT_SEO_SETTINGS.keywords,
        canonicalBaseUrl: base,
        ogTitle: settings.og_title || settings.meta_title || DEFAULT_SEO_SETTINGS.og_title,
        ogDescription: settings.og_description || settings.meta_description || DEFAULT_SEO_SETTINGS.og_description,
        ogImageUrl: /^https?:\/\//i.test(image) ? image : `${base}/${image.replace(/^\/+/, '')}`,
        ogImageAlt: settings.og_image_alt || DEFAULT_SEO_SETTINGS.og_image_alt,
        twitterHandle: settings.twitter_handle || '',
        locale: settings.locale || DEFAULT_SEO_SETTINGS.locale,
        robots: settings.robots || DEFAULT_SEO_SETTINGS.robots,
        socialProfiles: String(settings.social_profiles || '')
            .split(/\r?\n/)
            .map((value) => value.trim())
            .filter(Boolean)
    };
}

async function getSupabaseAuthUser(accessToken) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;

    try {
        const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            headers: {
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${accessToken}`
            }
        });
        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        console.warn('Supabase token verification failed:', error.message);
        return null;
    }
}

async function getSupabaseProfile(authUser) {
    if (!authUser?.id) return null;

    try {
        const result = await pool.query(
            `SELECT id, user_id, email, first_name, last_name, role, avatar_url, phone
             FROM profiles
             WHERE user_id = $1 OR id = $1 OR lower(email) = lower($2)
             ORDER BY (user_id = $1) DESC
             LIMIT 1`,
            [authUser.id, authUser.email || '']
        );
        if (result.rows[0]) return result.rows[0];
    } catch (error) {
        if (!isMissingSchemaError(error)) {
            console.warn('Local Supabase profile lookup failed:', error.message);
        }
    }

    // Some deployments use Supabase Auth and Supabase PostgREST without
    // exposing the same database through DATABASE_URL. Fall back to the
    // authenticated user's own profile row through the Supabase API.
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
    try {
        const filters = encodeURIComponent(`user_id.eq.${authUser.id},id.eq.${authUser.id}`);
        const response = await fetch(
            `${SUPABASE_URL}/rest/v1/profiles?select=id,user_id,email,first_name,last_name,role,avatar_url,phone&or=(${filters})&limit=1`,
            {
                headers: {
                    apikey: SUPABASE_ANON_KEY,
                    Authorization: `Bearer ${authUser.access_token || ''}`
                }
            }
        );
        if (!response.ok) return null;
        const profiles = await response.json();
        return profiles[0] || null;
    } catch (error) {
        console.warn('Supabase profile API lookup failed:', error.message);
        return null;
    }
}

const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Access denied' });

    try {
        req.user = jwt.verify(token, JWT_SECRET);
        return next();
    } catch {
        // Not a local JWT. Continue with the verified Supabase Auth path.
    }

    try {
        const authUser = await getSupabaseAuthUser(token);
        if (!authUser) return res.status(403).json({ error: 'Invalid token' });

        const profile = await getSupabaseProfile({ ...authUser, access_token: token });
        req.user = {
            id: profile?.id || authUser.id,
            auth_id: authUser.id,
            email: authUser.email,
            role: profile?.role || 'customer',
            first_name: profile?.first_name,
            last_name: profile?.last_name
        };
        return next();
    } catch (error) {
        console.error('Supabase authentication error:', error);
        return res.status(403).json({ error: 'Invalid token' });
    }
};

const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

const isSellerAccount = (req, res, next) => {
    if (!['seller', 'shop_owner', 'admin'].includes(String(req.user?.role || '').toLowerCase())) {
        return res.status(403).json({ error: 'Seller account required' });
    }
    next();
};

app.get('/api/branding', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(getBrandingPayload());
});

app.get('/api/seo', async (req, res) => {
    const settings = await getSeoSettings();
    res.set('Cache-Control', 'no-store');
    res.json(publicSeoPayload(settings, req));
});

app.get('/api/admin/seo', authenticateToken, isAdmin, async (req, res) => {
    const settings = await getSeoSettings();
    res.set('Cache-Control', 'no-store');
    res.json(settings);
});

app.put('/api/admin/seo', authenticateToken, isAdmin, async (req, res) => {
    const body = req.body || {};
    const values = {
        site_name: String(body.siteName || '').trim(),
        meta_title: String(body.title || '').trim(),
        meta_description: String(body.description || '').trim(),
        keywords: String(body.keywords || '').trim(),
        canonical_base_url: String(body.canonicalBaseUrl || '').trim(),
        og_title: String(body.ogTitle || '').trim(),
        og_description: String(body.ogDescription || '').trim(),
        og_image_url: String(body.ogImageUrl || '').trim(),
        og_image_alt: String(body.ogImageAlt || '').trim(),
        twitter_handle: String(body.twitterHandle || '').trim(),
        locale: String(body.locale || 'en_GB').trim(),
        robots: String(body.robots || 'index,follow').trim(),
        social_profiles: String(body.socialProfiles || '').trim()
    };
    if (values.site_name.length < 2 || values.meta_title.length < 5
        || values.meta_description.length < 20 || values.og_title.length < 5
        || values.og_description.length < 20 || !values.og_image_url) {
        return res.status(400).json({ error: 'SEO fields are incomplete.' });
    }
    if (!['index,follow', 'noindex,follow', 'index,nofollow', 'noindex,nofollow'].includes(values.robots)) {
        return res.status(400).json({ error: 'Crawler policy is invalid.' });
    }
    try {
        const result = await pool.query(`
            INSERT INTO site_settings (
                id, site_name, meta_title, meta_description, keywords,
                canonical_base_url, og_title, og_description, og_image_url,
                og_image_alt, twitter_handle, locale, robots, social_profiles, updated_at
            ) VALUES ('seo', $1, $2, $3, $4, NULLIF($5, ''), $6, $7, $8, $9, $10, $11, $12, $13, NOW())
            ON CONFLICT (id) DO UPDATE SET
                site_name = EXCLUDED.site_name,
                meta_title = EXCLUDED.meta_title,
                meta_description = EXCLUDED.meta_description,
                keywords = EXCLUDED.keywords,
                canonical_base_url = EXCLUDED.canonical_base_url,
                og_title = EXCLUDED.og_title,
                og_description = EXCLUDED.og_description,
                og_image_url = EXCLUDED.og_image_url,
                og_image_alt = EXCLUDED.og_image_alt,
                twitter_handle = EXCLUDED.twitter_handle,
                locale = EXCLUDED.locale,
                robots = EXCLUDED.robots,
                social_profiles = EXCLUDED.social_profiles,
                updated_at = NOW()
            RETURNING *
        `, [
            values.site_name, values.meta_title, values.meta_description, values.keywords,
            values.canonical_base_url, values.og_title, values.og_description, values.og_image_url,
            values.og_image_alt, values.twitter_handle, values.locale, values.robots, values.social_profiles
        ]);
        res.set('Cache-Control', 'no-store');
        res.json(result.rows[0]);
    } catch (error) {
        console.error('SEO settings save error:', error);
        res.status(500).json({ error: 'SEO settings could not be saved. Apply the Cloudflare dashboard SQL migration first.' });
    }
});

app.get('/api/admin/branding', authenticateToken, isAdmin, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(getBrandingPayload());
});

app.put('/api/admin/branding', authenticateToken, isAdmin, (req, res) => {
    const dataUrl = String(req.body?.dataUrl || '');
    const match = dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/]+=*)$/);
    if (!match) {
        return res.status(400).json({ error: 'Upload a valid PNG logo.' });
    }

    const image = Buffer.from(match[1], 'base64');
    if (!image.length || image.length > 1.5 * 1024 * 1024) {
        return res.status(400).json({ error: 'Logo must be smaller than 1.5 MB.' });
    }

    const tempPath = `${BRAND_LOGO_PATH}.upload-${process.pid}-${Date.now()}`;
    try {
        fs.writeFileSync(tempPath, image, { flag: 'wx' });
        fs.renameSync(tempPath, BRAND_LOGO_PATH);
        res.set('Cache-Control', 'no-store');
        res.json({ ok: true, ...getBrandingPayload() });
    } catch (error) {
        try { fs.unlinkSync(tempPath); } catch (_) {}
        console.error('Branding upload error:', error);
        res.status(500).json({ error: 'Failed to publish the logo.' });
    }
});

app.delete('/api/admin/branding', authenticateToken, isAdmin, (req, res) => {
    try {
        if (fs.existsSync(BRAND_LOGO_PATH)) fs.unlinkSync(BRAND_LOGO_PATH);
        res.set('Cache-Control', 'no-store');
        res.json({ ok: true, logoUrl: null });
    } catch (error) {
        console.error('Branding removal error:', error);
        res.status(500).json({ error: 'Failed to remove the logo.' });
    }
});

function authIdentityIds(user) {
    return [...new Set([user?.id, user?.auth_id].filter(Boolean))];
}

// API Routes
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, firstName, lastName, phone, accountType = 'customer', businessName = '', businessState = '', ageConfirmed, termsAccepted } = req.body;
        const normalizedEmail = String(email || '').trim().toLowerCase();
        if (!normalizedEmail || !password || String(password).length < 8) {
            return res.status(400).json({ error: 'Email and a password of at least 8 characters are required.' });
        }
        if (ageConfirmed !== true || termsAccepted !== true) {
            return res.status(400).json({ error: 'You must confirm that you are at least 18 and accept the Terms and Privacy Policy.' });
        }
        const existing = await pool.query('SELECT id FROM profiles WHERE lower(email) = $1', [normalizedEmail]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Email already registered' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await pool.query(
            `INSERT INTO profiles (email, password_hash, first_name, last_name, phone, account_type, business_name, business_state, role)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $6) RETURNING id, email, first_name, last_name, phone, account_type, business_name, business_state, role`,
            [normalizedEmail, hashedPassword, String(firstName || '').trim(), String(lastName || '').trim(), String(phone || '').trim(), accountType === 'seller' ? 'seller' : 'customer', String(businessName || '').trim(), String(businessState || '').trim()]
        );
        const user = result.rows[0];
        const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '6h' });
        res.json({ user, token });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const normalizedEmail = String(email || '').trim().toLowerCase();
        if (!normalizedEmail || !password) {
            return res.status(400).json({ error: 'Email and password are required.' });
        }
        const result = await pool.query(
            'SELECT id, email, password_hash, first_name, last_name, role, avatar_url FROM profiles WHERE lower(email) = $1',
            [normalizedEmail]
        );
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const user = result.rows[0];
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '6h' });
        delete user.password_hash;
        res.json({ user, token });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, email, first_name, last_name, role, avatar_url, phone FROM profiles WHERE id = $1',
            [req.user.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: 'Failed to get user' });
    }
});

app.post('/api/account/deletion-request', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const request = await client.query(`
            INSERT INTO data_deletion_requests (user_id, email_at_request, status, request_id)
            VALUES ($1, $2, 'completed', $3)
            RETURNING id, status, created_at
        `, [req.user.id, String(req.user.email || '').slice(0, 320), req.requestId]);
        const anonymizedEmail = `deleted-${crypto.randomUUID()}@invalid.velverahub`;
        await client.query(`
            UPDATE profiles
            SET email = $1, first_name = 'Deleted', last_name = 'User',
                phone = NULL, avatar_url = NULL, password_hash = NULL,
                business_name = NULL, business_state = NULL, business_institution = NULL,
                deleted_at = NOW(), updated_at = NOW()
            WHERE id = $2
        `, [anonymizedEmail, req.user.id]);
        await client.query('DELETE FROM wishlists WHERE user_id = $1', [req.user.id]);
        await client.query('DELETE FROM cart_items WHERE user_id = $1', [req.user.id]);
        await client.query('COMMIT');
        res.status(202).json({ success: true, message: 'Your account data was anonymised. Required transaction records may be retained.', request: request.rows[0] });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(JSON.stringify({ level: 'error', event: 'account_deletion_failed', requestId: req.requestId, message: error.message }));
        if (isMissingSchemaError(error)) return res.status(503).json({ error: 'Account deletion is not configured in the database yet.' });
        res.status(500).json({ error: 'We could not complete the deletion request.' });
    } finally {
        client.release();
    }
});

app.get('/api/categories', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM categories WHERE is_active = true ORDER BY display_order LIMIT 200');
        res.json(result.rows);
    } catch (error) {
        console.error('Categories error:', error);
        res.status(500).json({ error: 'Failed to fetch categories' });
    }
});

app.get('/api/locations', async (req, res) => {
    const region = req.query.region || 'ng';
    const fallback = region === 'ng' ? NIGERIAN_STATES : LOCATION_OPTIONS.filter(location => !NIGERIAN_STATES.includes(location));

    try {
        const result = await pool.query(`
            SELECT DISTINCT location
            FROM (
                SELECT p.location
                FROM products p
                WHERE p.status = 'active' AND p.location IS NOT NULL
                UNION
                SELECT unnest(s.coverage_areas)
                FROM products p
                JOIN shops s ON s.id = p.shop_id
                WHERE p.status = 'active' AND s.coverage_areas IS NOT NULL
            ) available
            WHERE location = ANY($1::text[])
            ORDER BY location
        `, [fallback]);
        const locations = result.rows.map(row => row.location).filter(Boolean);
        res.json({ locations: locations.length ? locations : fallback });
    } catch (error) {
        console.warn('Locations query unavailable, using configured locations:', error.message);
        res.json({ locations: fallback });
    }
});

app.get('/api/market/context', async (req, res) => {
    const location = LOCATION_OPTIONS.includes(req.query.location) ? req.query.location : 'all';
    const region = NIGERIAN_STATES.includes(location)
        ? 'ng'
        : LOCATION_OPTIONS.includes(location) && location !== 'all' ? 'uk' : (req.query.region === 'uk' ? 'uk' : 'ng');
    const context = { ...MARKET_CONTEXTS[region], region, location };
    try {
        const [catalog, signals] = await Promise.all([
            pool.query(`
                SELECT COUNT(*)::int AS products,
                       COUNT(DISTINCT p.shop_id)::int AS shops
                FROM products p LEFT JOIN shops s ON s.id = p.shop_id
                WHERE p.status = 'active'
                  AND ($1 = 'all' OR p.location = $1 OR $1 = ANY(COALESCE(s.coverage_areas, ARRAY[]::text[])))
            `, [location]),
            pool.query(`
                SELECT category, COUNT(*)::int AS demand_events
                FROM marketplace_events
                WHERE occurred_at >= NOW() - INTERVAL '90 days'
                  AND event_name IN ('search', 'product_click', 'product_view')
                  AND ($1 = 'all' OR location = $1)
                  AND category IS NOT NULL
                GROUP BY category ORDER BY demand_events DESC LIMIT 8
            `, [location])
        ]);
        context.catalog = catalog.rows[0];
        context.demandSignals = signals.rows;
    } catch (error) {
        if (!isMissingSchemaError(error)) console.warn('Market context lookup failed:', error.message);
        context.catalog = { products: 0, shops: 0 };
        context.demandSignals = [];
    }
    res.json(context);
});

app.get('/api/products', async (req, res) => {
    const parsedLimit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const parsedOffset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    try {
        const { category: requestedCategories, search, location, school, area, shop_id, featured, flash_deal, sort } = req.query;
        const categories = [...new Set((Array.isArray(requestedCategories) ? requestedCategories : [requestedCategories])
            .filter((value) => typeof value === 'string')
            .map((value) => value.trim())
            .filter(Boolean))].slice(0, 100);
        const safeSearch = typeof search === 'string' ? search.trim().slice(0, 160) : '';
        const requestedLocation = typeof location === 'string' ? location.trim() : '';
        const selectedLocation = requestedLocation && LOCATION_OPTIONS.includes(requestedLocation)
            ? requestedLocation
            : null;
        let query = `
            SELECT p.*, pi.url as image_url, s.name as shop_name, s.slug as shop_slug,
                   s.logo_url as shop_logo, s.verified as shop_verified,
                   s.rating as shop_rating, s.total_sales as shop_total_sales,
                   s.coverage_areas, s.city as shop_city, s.country as shop_country,
                   s.service_location
            FROM products p
            LEFT JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = true
            LEFT JOIN shops s ON p.shop_id = s.id
            WHERE p.status = 'active'
        `;
        const params = [];
        let paramCount = 0;

        if (categories.length && !categories.includes('all')) {
            paramCount++;
            query += ` AND p.category = ANY($${paramCount}::text[])`;
            params.push(categories);
        }

        if (safeSearch) {
            paramCount++;
            query += ` AND (p.search_vector @@ plainto_tsquery('english', $${paramCount})
                       OR p.title ILIKE '%' || $${paramCount} || '%'
                       OR COALESCE(p.description, '') ILIKE '%' || $${paramCount} || '%')`;
            params.push(safeSearch);
        }

        if (shop_id) {
            paramCount++;
            query += ` AND p.shop_id = $${paramCount}`;
            params.push(shop_id);
        }

        if (selectedLocation) {
            paramCount++;
            query += ` AND (
                (p.location IS NOT NULL AND p.location = $${paramCount})
                OR (p.location IS NULL AND (s.coverage_areas IS NULL OR cardinality(s.coverage_areas) = 0 OR $${paramCount} = ANY(s.coverage_areas)))
            )`;
            params.push(selectedLocation);
        }

        if (school) {
            paramCount++;
            query += ` AND (p.school_slug = $${paramCount} OR p.school_slug IS NULL)`;
            params.push(String(school).slice(0, 160));
        }

        if (area) {
            paramCount++;
            query += ` AND (
                p.campus_area ILIKE '%' || $${paramCount} || '%'
                OR COALESCE(p.school_city, '') ILIKE '%' || $${paramCount} || '%'
                OR COALESCE(s.city, '') ILIKE '%' || $${paramCount} || '%'
                OR COALESCE(s.address, '') ILIKE '%' || $${paramCount} || '%'
                OR COALESCE(s.service_location, '') ILIKE '%' || $${paramCount} || '%'
                OR p.location = $${paramCount}
                OR p.location IS NULL
            )`;
            params.push(String(area).slice(0, 160));
        }

        if (featured === 'true' || featured === true) {
            query += ' AND p.is_featured = true';
        }

        if (flash_deal === 'true' || flash_deal === true) {
            query += ' AND p.is_flash_deal = true';
        }

        if (!sort) query += ' ORDER BY p.is_priority_ad DESC NULLS LAST, p.created_at DESC';
        else switch (sort) {
            case 'price_asc':
                query += ' ORDER BY p.is_priority_ad DESC NULLS LAST, p.price ASC';
                break;
            case 'price_desc':
                query += ' ORDER BY p.is_priority_ad DESC NULLS LAST, p.price DESC';
                break;
            case 'rating':
                query += ' ORDER BY p.is_priority_ad DESC NULLS LAST, p.rating DESC';
                break;
            case 'newest':
                query += ' ORDER BY p.is_priority_ad DESC NULLS LAST, p.created_at DESC';
                break;
            case 'sales':
                query += ' ORDER BY p.is_priority_ad DESC NULLS LAST, p.sales_count DESC';
                break;
            default:
                query += ' ORDER BY p.is_priority_ad DESC NULLS LAST, p.created_at DESC';
        }

        paramCount++;
        query += ` LIMIT $${paramCount}`;
        params.push(parsedLimit);

        paramCount++;
        query += ` OFFSET $${paramCount}`;
        params.push(parsedOffset);

        const result = await pool.query(query, params);
        
        let countQuery = `SELECT COUNT(*) FROM products p
                          LEFT JOIN shops s ON p.shop_id = s.id
                          WHERE p.status = 'active'`;
        const countParams = [];
        let countParamCount = 0;

        if (categories.length && !categories.includes('all')) {
            countParamCount++;
            countQuery += ` AND p.category = ANY($${countParamCount}::text[])`;
            countParams.push(categories);
        }
        if (safeSearch) {
            countParamCount++;
            countQuery += ` AND (p.search_vector @@ plainto_tsquery('english', $${countParamCount})
                            OR p.title ILIKE '%' || $${countParamCount} || '%'
                            OR COALESCE(p.description, '') ILIKE '%' || $${countParamCount} || '%')`;
            countParams.push(safeSearch);
        }
        if (shop_id) {
            countParamCount++;
            countQuery += ` AND p.shop_id = $${countParamCount}`;
            countParams.push(shop_id);
        }
        if (selectedLocation) {
            countParamCount++;
            countQuery += ` AND (
                (p.location IS NOT NULL AND p.location = $${countParamCount})
                OR (p.location IS NULL AND (s.coverage_areas IS NULL OR cardinality(s.coverage_areas) = 0 OR $${countParamCount} = ANY(s.coverage_areas)))
            )`;
            countParams.push(selectedLocation);
        }
        if (school) {
            countParamCount++;
            countQuery += ` AND (p.school_slug = $${countParamCount} OR p.school_slug IS NULL)`;
            countParams.push(String(school).slice(0, 160));
        }
        if (area) {
            countParamCount++;
            countQuery += ` AND (
                p.campus_area ILIKE '%' || $${countParamCount} || '%'
                OR COALESCE(p.school_city, '') ILIKE '%' || $${countParamCount} || '%'
                OR COALESCE(s.city, '') ILIKE '%' || $${countParamCount} || '%'
                OR COALESCE(s.address, '') ILIKE '%' || $${countParamCount} || '%'
                OR p.location = $${countParamCount}
                OR p.location IS NULL
            )`;
            countParams.push(String(area).slice(0, 160));
        }
        if (featured === 'true' || featured === true) {
            countQuery += ' AND p.is_featured = true';
        }
        if (flash_deal === 'true' || flash_deal === true) {
            countQuery += ' AND p.is_flash_deal = true';
        }

        const countResult = await pool.query(countQuery, countParams);
        
        res.json({
            products: result.rows,
            total: parseInt(countResult.rows[0].count),
            limit: parsedLimit,
            offset: parsedOffset
        });
    } catch (error) {
        console.error('Products error:', error);
        if (isMissingSchemaError(error)) {
            return res.status(503).json({
                products: [],
                total: 0,
                limit: parsedLimit,
                offset: parsedOffset,
                error: 'Live catalogue is not configured. Apply the production database schema before opening the marketplace.'
            });
        }
        res.status(500).json({ error: 'Failed to fetch products' });
    }
});

app.get('/api/products/:id', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT p.*, s.name as shop_name, s.slug as shop_slug, s.logo_url as shop_logo,
                   s.rating as shop_rating, s.verified as shop_verified,
                   s.total_sales as shop_total_sales,
                   s.coverage_areas, s.city as shop_city, s.country as shop_country,
                   s.service_location
            FROM products p
            LEFT JOIN shops s ON p.shop_id = s.id
            WHERE p.id = $1
        `, [req.params.id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }
        
        const images = await pool.query(
            'SELECT * FROM product_images WHERE product_id = $1 ORDER BY display_order LIMIT 50',
            [req.params.id]
        );
        
        const product = result.rows[0];
        product.images = images.rows;
        
        await pool.query('UPDATE products SET view_count = view_count + 1 WHERE id = $1', [req.params.id]);
        
        res.json(product);
    } catch (error) {
        console.error('Product detail error:', error);
        if (isMissingSchemaError(error)) {
            return res.status(404).json({ error: 'Product not found' });
        }
        res.status(500).json({ error: 'Failed to fetch product' });
    }
});

app.get('/api/shops', async (req, res) => {
    const requestedLimit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 100);
    const requestedOffset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
    try {
        const { status = 'active', available, rental_status } = req.query;
        let query = `SELECT * FROM shops WHERE 1=1`;
        const params = [];
        let paramCount = 0;

        if (status) {
            paramCount++;
            query += ` AND status = $${paramCount}`;
            params.push(status);
        }

        if (available !== undefined) {
            paramCount++;
            query += ` AND is_available = $${paramCount}`;
            params.push(available === 'true');
        }

        if (rental_status) {
            paramCount++;
            query += ` AND rental_status = $${paramCount}`;
            params.push(rental_status);
        }

        query += ' ORDER BY rating DESC, total_sales DESC';
        
        paramCount++;
        query += ` LIMIT $${paramCount}`;
        params.push(requestedLimit);
        
        paramCount++;
        query += ` OFFSET $${paramCount}`;
        params.push(requestedOffset);

        const result = await pool.query(query, params);
        const countResult = await pool.query('SELECT COUNT(*) FROM shops WHERE status = $1', [status]);
        
        res.json({
            shops: result.rows,
            total: parseInt(countResult.rows[0].count),
            limit: requestedLimit,
            offset: requestedOffset
        });
    } catch (error) {
        console.error('Shops error:', error);
        if (isMissingSchemaError(error)) {
            return res.status(503).json({
                shops: [],
                total: 0,
                limit: requestedLimit,
                offset: requestedOffset,
                error: 'Live shops are not configured. Apply the production database schema before opening the marketplace.'
            });
        }
        res.status(500).json({ error: 'Failed to fetch shops' });
    }
});

app.get('/api/shops/:slug', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM shops WHERE slug = $1 OR id::text = $1 LIMIT 1',
            [req.params.slug]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Shop not found' });
        }
        const shop = result.rows[0];
        const requestedLocation = typeof req.query.location === 'string' ? req.query.location.trim() : '';
        const selectedLocation = requestedLocation && LOCATION_OPTIONS.includes(requestedLocation)
            ? requestedLocation
            : null;
        const locationParams = [shop.id];
        const locationClause = selectedLocation
            ? ' AND (s.coverage_areas IS NULL OR cardinality(s.coverage_areas) = 0 OR $2 = ANY(s.coverage_areas))'
            : '';
        if (selectedLocation) locationParams.push(selectedLocation);
        const products = await pool.query(`
            SELECT p.*, pi.url as image_url, s.coverage_areas, s.service_location,
                   s.name as shop_name, s.slug as shop_slug, s.logo_url as shop_logo,
                   s.verified as shop_verified
            FROM products p
            LEFT JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = true
            LEFT JOIN shops s ON p.shop_id = s.id
            WHERE p.shop_id = $1 AND p.status = 'active'${locationClause}
            ORDER BY p.created_at DESC LIMIT 20
        `, locationParams);
        shop.products = products.rows;
        res.json(shop);
    } catch (error) {
        console.error('Shop detail error:', error);
        if (isMissingSchemaError(error)) {
            return res.status(404).json({ error: 'Shop not found' });
        }
        res.status(500).json({ error: 'Failed to fetch shop' });
    }
});

app.get('/api/admin/shops', authenticateToken, isAdmin, async (req, res) => {
    try {
        const { status, rental_status } = req.query;
        const { limit, offset } = boundedPagination(req);
        let query = `
            SELECT s.*, p.email as owner_email, p.first_name as owner_first_name, p.last_name as owner_last_name,
                   rc.start_date as current_rental_start, rc.end_date as current_rental_end
            FROM shops s
            LEFT JOIN profiles p ON s.current_owner_id = p.id
            LEFT JOIN rental_contracts rc ON s.id = rc.shop_id AND rc.status = 'active'
            WHERE 1=1
        `;
        const params = [];
        let paramCount = 0;

        if (status) {
            paramCount++;
            query += ` AND s.status = $${paramCount}`;
            params.push(status);
        }

        if (rental_status) {
            paramCount++;
            query += ` AND s.rental_status = $${paramCount}`;
            params.push(rental_status);
        }

        query += ' ORDER BY s.created_at DESC';
        
        paramCount++;
        query += ` LIMIT $${paramCount}`;
        params.push(parseInt(limit));
        
        paramCount++;
        query += ` OFFSET $${paramCount}`;
        params.push(parseInt(offset));

        const result = await pool.query(query, params);
        const countResult = await pool.query('SELECT COUNT(*) FROM shops');
        
        setPaginationHeaders(res, { limit, offset, total: parseInt(countResult.rows[0].count) });
        res.json({
            shops: result.rows,
            total: parseInt(countResult.rows[0].count),
            limit,
            offset
        });
    } catch (error) {
        console.error('Admin shops error:', error);
        res.status(500).json({ error: 'Failed to fetch shops' });
    }
});

app.post('/api/admin/shops/:id/assign', authenticateToken, isAdmin, async (req, res) => {
    try {
        const { userId, startDate, endDate, monthlyRent } = req.body;
        const shopId = req.params.id;

        const shopCheck = await pool.query('SELECT * FROM shops WHERE id = $1', [shopId]);
        if (shopCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Shop not found' });
        }

        const userCheck = await pool.query('SELECT * FROM profiles WHERE id = $1', [userId]);
        if (userCheck.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        await pool.query(`
            INSERT INTO rental_contracts (shop_id, tenant_id, assigned_by, start_date, end_date, monthly_rent, status)
            VALUES ($1, $2, $3, $4, $5, $6, 'active')
        `, [shopId, userId, req.user.id, startDate, endDate, monthlyRent]);

        await pool.query(`
            UPDATE shops SET 
                current_owner_id = $1, 
                rental_start_date = $2, 
                rental_end_date = $3,
                rental_status = 'rented',
                is_available = false,
                monthly_rent = $4
            WHERE id = $5
        `, [userId, startDate, endDate, monthlyRent, shopId]);

        await pool.query(`
            UPDATE profiles SET role = 'seller' WHERE id = $1 AND role = 'customer'
        `, [userId]);

        res.json({ message: 'Shop assigned successfully' });
    } catch (error) {
        console.error('Assign shop error:', error);
        res.status(500).json({ error: 'Failed to assign shop' });
    }
});

app.post('/api/admin/shops/:id/revoke', authenticateToken, isAdmin, async (req, res) => {
    try {
        const shopId = req.params.id;
        
        await pool.query(`
            UPDATE rental_contracts SET status = 'cancelled', updated_at = NOW()
            WHERE shop_id = $1 AND status = 'active'
        `, [shopId]);

        await pool.query(`
            UPDATE shops SET 
                current_owner_id = NULL, 
                rental_start_date = NULL, 
                rental_end_date = NULL,
                rental_status = 'available',
                is_available = true
            WHERE id = $1
        `, [shopId]);

        res.json({ message: 'Shop ownership revoked successfully' });
    } catch (error) {
        console.error('Revoke shop error:', error);
        res.status(500).json({ error: 'Failed to revoke shop' });
    }
});

app.post('/api/admin/shops/:id/renew', authenticateToken, isAdmin, async (req, res) => {
    try {
        const { newEndDate, monthlyRent } = req.body;
        const shopId = req.params.id;

        await pool.query(`
            UPDATE rental_contracts SET status = 'renewed', updated_at = NOW()
            WHERE shop_id = $1 AND status = 'active'
        `, [shopId]);

        const shop = await pool.query('SELECT current_owner_id FROM shops WHERE id = $1', [shopId]);
        if (shop.rows.length === 0 || !shop.rows[0].current_owner_id) {
            return res.status(400).json({ error: 'Shop has no current owner to renew' });
        }

        await pool.query(`
            INSERT INTO rental_contracts (shop_id, tenant_id, assigned_by, start_date, end_date, monthly_rent, status)
            VALUES ($1, $2, $3, NOW(), $4, $5, 'active')
        `, [shopId, shop.rows[0].current_owner_id, req.user.id, newEndDate, monthlyRent]);

        await pool.query(`
            UPDATE shops SET rental_end_date = $1, monthly_rent = $2, rental_status = 'rented'
            WHERE id = $3
        `, [newEndDate, monthlyRent, shopId]);

        res.json({ message: 'Shop rental renewed successfully' });
    } catch (error) {
        console.error('Renew shop error:', error);
        res.status(500).json({ error: 'Failed to renew shop' });
    }
});

app.get('/api/admin/users', authenticateToken, isAdmin, async (req, res) => {
    try {
        const { limit, offset } = boundedPagination(req);
        const result = await pool.query(`
            SELECT id, email, first_name, last_name, role, phone, created_at
            FROM profiles
            ORDER BY created_at DESC
            LIMIT $1 OFFSET $2
        `, [limit, offset]);
        const countResult = await pool.query('SELECT COUNT(*) FROM profiles');
        setPaginationHeaders(res, { limit, offset, total: parseInt(countResult.rows[0].count) });
        res.json(result.rows);
    } catch (error) {
        console.error('Admin users error:', error);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

app.get('/api/admin/rental-contracts', authenticateToken, isAdmin, async (req, res) => {
    try {
        const { limit, offset } = boundedPagination(req);
        const result = await pool.query(`
            SELECT rc.*, s.name as shop_name, s.slug as shop_slug,
                   p.email as tenant_email, p.first_name as tenant_first_name, p.last_name as tenant_last_name
            FROM rental_contracts rc
            JOIN shops s ON rc.shop_id = s.id
            JOIN profiles p ON rc.tenant_id = p.id
            ORDER BY rc.created_at DESC
            LIMIT $1 OFFSET $2
        `, [limit, offset]);
        const countResult = await pool.query('SELECT COUNT(*) FROM rental_contracts');
        setPaginationHeaders(res, { limit, offset, total: parseInt(countResult.rows[0].count) });
        res.json(result.rows);
    } catch (error) {
        console.error('Rental contracts error:', error);
        res.status(500).json({ error: 'Failed to fetch rental contracts' });
    }
});

app.get('/api/admin/stats', authenticateToken, isAdmin, async (req, res) => {
    try {
        const stats = await Promise.all([
            pool.query('SELECT COUNT(*) FROM shops'),
            pool.query("SELECT COUNT(*) FROM shops WHERE rental_status = 'available'"),
            pool.query("SELECT COUNT(*) FROM shops WHERE rental_status = 'rented'"),
            pool.query('SELECT COUNT(*) FROM products'),
            pool.query('SELECT COUNT(*) FROM profiles'),
            pool.query("SELECT COUNT(*) FROM profiles WHERE role = 'seller'"),
            pool.query('SELECT COUNT(*) FROM orders'),
            pool.query("SELECT COALESCE(SUM(total), 0) as revenue FROM orders WHERE status != 'cancelled'")
        ]);

        res.json({
            totalShops: parseInt(stats[0].rows[0].count),
            availableShops: parseInt(stats[1].rows[0].count),
            rentedShops: parseInt(stats[2].rows[0].count),
            totalProducts: parseInt(stats[3].rows[0].count),
            totalUsers: parseInt(stats[4].rows[0].count),
            totalSellers: parseInt(stats[5].rows[0].count),
            totalOrders: parseInt(stats[6].rows[0].count),
            totalRevenue: parseFloat(stats[7].rows[0].revenue)
        });
    } catch (error) {
        console.error('Admin stats error:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

app.get('/api/seller/shop', authenticateToken, isSellerAccount, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT s.*, rc.start_date, rc.end_date, rc.monthly_rent as current_rent
            FROM shops s
            LEFT JOIN rental_contracts rc ON s.id = rc.shop_id AND rc.status = 'active'
            WHERE s.current_owner_id = ANY($1::uuid[]) OR s.owner_id = ANY($1::uuid[])
        `, [authIdentityIds(req.user)]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'No shop assigned to this user' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Seller shop error:', error);
        res.status(500).json({ error: 'Failed to fetch shop' });
    }
});

app.put('/api/seller/shop', authenticateToken, isSellerAccount, async (req, res) => {
    try {
        const { name, description, logoUrl, bannerUrl, email, phone, address, serviceLocation, city, country, whatsapp, facebook, instagram, twitter, coverageAreas } = req.body;

        const result = await pool.query(`
            UPDATE shops SET 
                name = COALESCE($1, name),
                description = COALESCE($2, description),
                logo_url = COALESCE($3, logo_url),
                banner_url = COALESCE($4, banner_url),
                email = COALESCE($5, email),
                phone = COALESCE($6, phone),
                address = COALESCE($7, address),
                service_location = COALESCE($8, service_location),
                city = COALESCE($9, city),
                country = COALESCE($10, country),
                whatsapp = COALESCE($11, whatsapp),
                facebook = COALESCE($12, facebook),
                instagram = COALESCE($13, instagram),
                twitter = COALESCE($14, twitter),
                coverage_areas = COALESCE($15, coverage_areas),
                updated_at = NOW()
            WHERE current_owner_id = ANY($16::uuid[]) OR owner_id = ANY($16::uuid[])
            RETURNING *
        `, [name, description, logoUrl, bannerUrl, email, phone, address, serviceLocation, city, country, whatsapp, facebook, instagram, twitter, coverageAreas || null, authIdentityIds(req.user)]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'No shop found or not authorized' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Update shop error:', error);
        res.status(500).json({ error: 'Failed to update shop' });
    }
});

app.get('/api/seller/products', authenticateToken, isSellerAccount, async (req, res) => {
    try {
        const { limit, offset } = boundedPagination(req);
        const ownerIds = authIdentityIds(req.user);
        const shop = await pool.query(
            'SELECT id FROM shops WHERE current_owner_id = ANY($1::uuid[]) OR owner_id = ANY($1::uuid[]) LIMIT 1',
            [ownerIds]
        );
        if (shop.rows.length === 0) {
            return res.status(404).json({ error: 'No shop assigned' });
        }

        const result = await pool.query(`
            SELECT p.*, pi.url as image_url
            FROM products p
            LEFT JOIN product_images pi ON p.id = pi.product_id AND pi.is_primary = true
            WHERE p.shop_id = $1
            ORDER BY p.created_at DESC
            LIMIT $2 OFFSET $3
        `, [shop.rows[0].id, limit, offset]);

        const countResult = await pool.query('SELECT COUNT(*) FROM products WHERE shop_id = $1', [shop.rows[0].id]);
        setPaginationHeaders(res, { limit, offset, total: parseInt(countResult.rows[0].count) });
        res.json(result.rows);
    } catch (error) {
        console.error('Seller products error:', error);
        res.status(500).json({ error: 'Failed to fetch products' });
    }
});

app.post('/api/seller/products', authenticateToken, isSellerAccount, async (req, res) => {
    try {
        const ownerIds = authIdentityIds(req.user);
        const shop = await pool.query(
            'SELECT id FROM shops WHERE current_owner_id = ANY($1::uuid[]) OR owner_id = ANY($1::uuid[]) LIMIT 1',
            [ownerIds]
        );
        if (shop.rows.length === 0) {
            return res.status(404).json({ error: 'No shop assigned' });
        }

        const { title, description, shortDescription, price, originalPrice, discountPercent, category, location, schoolSlug, schoolName, schoolCity, campusArea, condition, sellerId, sellerDisplayName, sellerAvatarUrl, imageUrl, specifications, provenanceUrl } = req.body;
        const safeDiscount = Math.min(99, Math.max(0, Number(discountPercent) || 0));
        if (!title || !category || !location || !Number.isFinite(Number(price)) || Number(price) < 0) {
            return res.status(400).json({ error: 'Title, category, location and a valid price are required' });
        }
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now();

        const quality = listingQuality({ title, description, category, imageUrl, provenanceUrl });
        let result;
        try {
            result = await pool.query(`
                INSERT INTO products (shop_id, seller_id, seller_display_name, seller_avatar_url, school_slug, school_name, school_city, campus_area, condition, title, slug, description, short_description, price, original_price, discount_percent, category, location, stock, specifications, provenance_documents, provenance_status, quality_score, policy_status, status)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, 'active')
                RETURNING *
            `, [shop.rows[0].id, sellerId || req.user.id, sellerDisplayName || null, sellerAvatarUrl || null, schoolSlug || null, schoolName || null, schoolCity || null, campusArea || null, ['new', 'used', 'fairly_used'].includes(condition) ? condition : null, title.trim(), slug, description, shortDescription, price, originalPrice || (safeDiscount ? Number(price) / (1 - safeDiscount / 100) : price), safeDiscount, category, location, Math.max(0, Number(stock) || 0), JSON.stringify(specifications || {}), JSON.stringify(provenanceUrl ? [{ url: provenanceUrl, type: 'reference' }] : []), provenanceUrl ? 'submitted' : 'not_required', quality.score, quality.policyStatus]);
        } catch (error) {
            if (!isMissingSchemaError(error)) throw error;
            result = await pool.query(`
                INSERT INTO products (shop_id, title, slug, description, short_description, price, original_price, discount_percent, category, location, stock, status)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active')
                RETURNING *
            `, [shop.rows[0].id, title.trim(), slug, description, shortDescription, price, originalPrice || (safeDiscount ? Number(price) / (1 - safeDiscount / 100) : price), safeDiscount, category, location, Math.max(0, Number(stock) || 0)]);
        }

        if (imageUrl) {
            await pool.query(`
                INSERT INTO product_images (product_id, url, is_primary, display_order)
                VALUES ($1, $2, true, 1)
            `, [result.rows[0].id, imageUrl]);
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Create product error:', error);
        res.status(500).json({ error: 'Failed to create product' });
    }
});

app.put('/api/seller/products/:id', authenticateToken, isSellerAccount, async (req, res) => {
    try {
        const ownerIds = authIdentityIds(req.user);
        const shop = await pool.query(
            'SELECT id FROM shops WHERE current_owner_id = ANY($1::uuid[]) OR owner_id = ANY($1::uuid[]) LIMIT 1',
            [ownerIds]
        );
        if (shop.rows.length === 0) {
            return res.status(404).json({ error: 'No shop assigned' });
        }

        const { title, description, shortDescription, price, originalPrice, discountPercent, category, location, schoolSlug, schoolName, schoolCity, campusArea, condition, stock, status, imageUrl } = req.body;
        const safeDiscount = Math.min(99, Math.max(0, Number(discountPercent) || 0));

        const result = await pool.query(`
            UPDATE products SET 
                title = COALESCE($1, title),
                description = COALESCE($2, description),
                short_description = COALESCE($3, short_description),
                price = COALESCE($4, price),
                original_price = COALESCE($5, original_price),
                discount_percent = COALESCE($6, discount_percent),
                category = COALESCE($7, category),
                location = COALESCE($8, location),
                school_slug = COALESCE($9, school_slug),
                school_name = COALESCE($10, school_name),
                school_city = COALESCE($11, school_city),
                campus_area = COALESCE($12, campus_area),
                condition = COALESCE($13, condition),
                stock = COALESCE($14, stock),
                status = COALESCE($15, status),
                updated_at = NOW()
            WHERE id = $16 AND shop_id = $17
            RETURNING *
        `, [title, description, shortDescription, price, originalPrice || (safeDiscount && price ? Number(price) / (1 - safeDiscount / 100) : price), safeDiscount, category, location, schoolSlug, schoolName, schoolCity, campusArea, ['new', 'used', 'fairly_used'].includes(condition) ? condition : null, Math.max(0, Number(stock) || 0), status, req.params.id, shop.rows[0].id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Product not found or not authorized' });
        }

        if (imageUrl) {
            await pool.query('DELETE FROM product_images WHERE product_id = $1 AND is_primary = true', [req.params.id]);
            await pool.query(`
                INSERT INTO product_images (product_id, url, is_primary, display_order)
                VALUES ($1, $2, true, 0)
            `, [req.params.id, imageUrl]);
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Update product error:', error);
        res.status(500).json({ error: 'Failed to update product' });
    }
});

app.delete('/api/seller/products/:id', authenticateToken, isSellerAccount, async (req, res) => {
    try {
        const ownerIds = authIdentityIds(req.user);
        const shop = await pool.query(
            'SELECT id FROM shops WHERE current_owner_id = ANY($1::uuid[]) OR owner_id = ANY($1::uuid[]) LIMIT 1',
            [ownerIds]
        );
        if (shop.rows.length === 0) {
            return res.status(404).json({ error: 'No shop assigned' });
        }

        await pool.query('DELETE FROM products WHERE id = $1 AND shop_id = $2', [req.params.id, shop.rows[0].id]);
        res.json({ message: 'Product deleted successfully' });
    } catch (error) {
        console.error('Delete product error:', error);
        res.status(500).json({ error: 'Failed to delete product' });
    }
});

app.get('/api/advertisements/settings', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT bank_name, account_name, account_number, instructions, amount_ngn
            FROM advertisement_settings
            WHERE id = 1
            LIMIT 1
        `);
        res.json(result.rows[0] || {
            bank_name: '',
            account_name: '',
            account_number: '',
            instructions: 'Transfer the exact amount and include your payment reference below.',
            amount_ngn: AD_PRICE_NGN
        });
    } catch (error) {
        if (isMissingSchemaError(error)) {
            return res.json({
                bank_name: '',
                account_name: '',
                account_number: '',
                instructions: 'Transfer the exact amount and include your payment reference below.',
                amount_ngn: AD_PRICE_NGN,
                setupRequired: true
            });
        }
        console.error('Advertisement settings error:', error);
        res.status(500).json({ error: 'Failed to load advertisement payment details' });
    }
});

app.get('/api/seller/advertisements', authenticateToken, isSellerAccount, async (req, res) => {
    try {
        const { limit, offset } = boundedPagination(req);
        const ownerIds = authIdentityIds(req.user);
        const result = await pool.query(`
            SELECT a.*, p.title AS product_title, p.is_priority_ad, p.ad_status
            FROM advertisement_requests a
            LEFT JOIN products p ON p.id = a.product_id
            WHERE a.promoter_id = ANY($1::uuid[])
               OR EXISTS (
                   SELECT 1 FROM shops s
                   WHERE s.id = a.shop_id
                     AND (s.owner_id = ANY($1::uuid[]) OR s.current_owner_id = ANY($1::uuid[]))
               )
            ORDER BY a.created_at DESC
            LIMIT $2 OFFSET $3
        `, [ownerIds, limit, offset]);
        setPaginationHeaders(res, { limit, offset });
        res.json(result.rows);
    } catch (error) {
        if (isMissingSchemaError(error)) return res.json([]);
        console.error('Seller advertisements error:', error);
        res.status(500).json({ error: 'Failed to load advertisements' });
    }
});

app.post('/api/seller/advertisements', authenticateToken, isSellerAccount, async (req, res) => {
    try {
        const ownerIds = authIdentityIds(req.user);
        const { productId, paymentReference } = req.body;
        if (!productId || !String(paymentReference || '').trim()) {
            return res.status(400).json({ error: 'Choose a product and enter the bank transfer reference' });
        }

        const product = await pool.query(`
            SELECT p.id, p.title, p.shop_id, p.seller_id
            FROM products p
            LEFT JOIN shops s ON s.id = p.shop_id
            WHERE p.id = $1
              AND (
                  p.seller_id = ANY($2::uuid[])
                  OR s.owner_id = ANY($2::uuid[])
                  OR s.current_owner_id = ANY($2::uuid[])
              )
            LIMIT 1
        `, [productId, ownerIds]);
        if (!product.rows.length) return res.status(404).json({ error: 'Product not found or not authorized' });

        const duplicate = await pool.query(`
            SELECT id FROM advertisement_requests
            WHERE product_id = $1 AND status IN ('pending', 'approved')
            LIMIT 1
        `, [productId]);
        if (duplicate.rows.length) return res.status(409).json({ error: 'This product already has a pending or active advertisement' });

        const result = await pool.query(`
            INSERT INTO advertisement_requests
                (product_id, shop_id, promoter_id, amount_ngn, payment_reference, status)
            VALUES ($1, $2, $3, $4, $5, 'pending')
            RETURNING *
        `, [
            productId,
            product.rows[0].shop_id || null,
            req.user.id,
            AD_PRICE_NGN,
            String(paymentReference).trim().slice(0, 120)
        ]);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        if (isMissingSchemaError(error)) {
            return res.status(503).json({ error: 'Advertisement payments are not enabled until the latest database schema is applied.' });
        }
        console.error('Create advertisement error:', error);
        res.status(500).json({ error: 'Failed to submit advertisement for review' });
    }
});

app.get('/api/admin/advertisements', authenticateToken, isAdmin, async (req, res) => {
    try {
        const { limit, offset } = boundedPagination(req);
        const result = await pool.query(`
            SELECT a.*, p.title AS product_title, p.image_url, s.name AS shop_name,
                   pr.email AS promoter_email, pr.first_name, pr.last_name
            FROM advertisement_requests a
            JOIN products p ON p.id = a.product_id
            LEFT JOIN shops s ON s.id = a.shop_id
            LEFT JOIN profiles pr ON pr.id = a.promoter_id
            ORDER BY CASE WHEN a.status = 'pending' THEN 0 ELSE 1 END, a.created_at DESC
            LIMIT $1 OFFSET $2
        `, [limit, offset]);
        const countResult = await pool.query('SELECT COUNT(*) FROM advertisement_requests');
        setPaginationHeaders(res, { limit, offset, total: parseInt(countResult.rows[0].count) });
        res.json(result.rows);
    } catch (error) {
        if (isMissingSchemaError(error)) return res.json([]);
        console.error('Admin advertisements error:', error);
        res.status(500).json({ error: 'Failed to load advertisement requests' });
    }
});

app.put('/api/admin/advertisements/:id', authenticateToken, isAdmin, async (req, res) => {
    const status = ['approved', 'rejected'].includes(req.body?.status) ? req.body.status : null;
    if (!status) return res.status(400).json({ error: 'Status must be approved or rejected' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const request = await client.query(`
            UPDATE advertisement_requests
            SET status = $1, reviewed_by = $2, reviewed_at = NOW(), review_note = $3
            WHERE id = $4
            RETURNING *
        `, [status, req.user.id, String(req.body?.reviewNote || '').trim().slice(0, 500) || null, req.params.id]);
        if (!request.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Advertisement request not found' });
        }
        await client.query(`
            UPDATE products
            SET is_priority_ad = $1,
                ad_status = $2,
                ad_amount_ngn = CASE WHEN $1 THEN $3 ELSE ad_amount_ngn END,
                ad_approved_at = CASE WHEN $1 THEN NOW() ELSE ad_approved_at END,
                updated_at = NOW()
            WHERE id = $4
        `, [status === 'approved', status, AD_PRICE_NGN, request.rows[0].product_id]);
        await client.query('COMMIT');
        res.json(request.rows[0]);
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (isMissingSchemaError(error)) return res.status(503).json({ error: 'Advertisement schema is not enabled yet.' });
        console.error('Review advertisement error:', error);
        res.status(500).json({ error: 'Failed to review advertisement' });
    } finally {
        client.release();
    }
});

app.get('/api/admin/advertisement-settings', authenticateToken, isAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM advertisement_settings WHERE id = 1');
        res.json(result.rows[0] || { id: 1, bank_name: '', account_name: '', account_number: '', instructions: '', amount_ngn: AD_PRICE_NGN });
    } catch (error) {
        if (isMissingSchemaError(error)) return res.status(503).json({ error: 'Advertisement schema is not enabled yet.' });
        res.status(500).json({ error: 'Failed to load advertisement settings' });
    }
});

app.put('/api/admin/advertisement-settings', authenticateToken, isAdmin, async (req, res) => {
    const { bankName, accountName, accountNumber, instructions } = req.body || {};
    if (!String(bankName || '').trim() || !String(accountName || '').trim() || !String(accountNumber || '').trim()) {
        return res.status(400).json({ error: 'Bank name, account name and account number are required' });
    }
    try {
        const result = await pool.query(`
            INSERT INTO advertisement_settings (id, bank_name, account_name, account_number, instructions, amount_ngn, updated_at)
            VALUES (1, $1, $2, $3, $4, $5, NOW())
            ON CONFLICT (id) DO UPDATE SET
                bank_name = EXCLUDED.bank_name,
                account_name = EXCLUDED.account_name,
                account_number = EXCLUDED.account_number,
                instructions = EXCLUDED.instructions,
                amount_ngn = EXCLUDED.amount_ngn,
                updated_at = NOW()
            RETURNING *
        `, [String(bankName).trim().slice(0, 120), String(accountName).trim().slice(0, 160), String(accountNumber).trim().slice(0, 80), String(instructions || '').trim().slice(0, 500), AD_PRICE_NGN]);
        res.json(result.rows[0]);
    } catch (error) {
        if (isMissingSchemaError(error)) return res.status(503).json({ error: 'Advertisement schema is not enabled yet.' });
        res.status(500).json({ error: 'Failed to save advertisement payment details' });
    }
});

app.get('/api/search/suggestions', async (req, res) => {
    try {
        const q = String(req.query.q || '').trim().slice(0, 80);
        const { location } = req.query;
        if (q.length < 2) {
            return res.json([]);
        }

        const params = [`%${q}%`];
        let locationClause = '';
        if (LOCATION_OPTIONS.includes(location)) {
            params.push(location);
            locationClause = `AND (
                p.location = $2
                OR (p.location IS NULL AND (s.coverage_areas IS NULL OR cardinality(s.coverage_areas) = 0 OR $2 = ANY(s.coverage_areas)))
            )`;
        }
        const result = await pool.query(`
            SELECT DISTINCT p.title FROM products p
            LEFT JOIN shops s ON s.id = p.shop_id
            WHERE p.title ILIKE $1 AND p.status = 'active'
            ${locationClause}
            ORDER BY p.title
            LIMIT 10
        `, params);

        res.json(result.rows.map(r => r.title));
    } catch (error) {
        console.error('Search suggestions error:', error);
        if (isMissingSchemaError(error)) {
            return res.json([]);
        }
        res.status(500).json({ error: 'Failed to fetch suggestions' });
    }
});

app.post('/api/orders', async (req, res) => {
    const client = await pool.connect();
    try {
        const { customer, shipping, items, region = 'ng', payment_method = 'cash_on_delivery', policyAccepted } = req.body;
        const idempotencyKey = String(req.get('Idempotency-Key') || req.body?.idempotencyKey || '').trim();

        if (!customer || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(customer.email || '').trim())) {
            return res.status(400).json({ error: 'Customer email is required' });
        }
        if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) {
            return res.status(400).json({ error: 'A valid Idempotency-Key is required to place an order' });
        }
        if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
            return res.status(400).json({ error: 'No items in order' });
        }
        if (!shipping || !String(shipping.address || '').trim() || !String(shipping.city || '').trim()) {
            return res.status(400).json({ error: 'Shipping address is required' });
        }
        if (policyAccepted !== true) {
            return res.status(400).json({ error: 'Please accept the Terms of Service and Refunds and Returns Policy before ordering.' });
        }
        if (!['ng', 'uk'].includes(region)) return res.status(400).json({ error: 'Unsupported market region' });
        if (!['cash_on_delivery', 'bank_transfer'].includes(payment_method)) {
            return res.status(400).json({ error: 'Unsupported payment method' });
        }

        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [idempotencyKey]);
        const existingOrder = await client.query(`
            SELECT id, order_number, customer_email, subtotal, shipping_cost, tax, total, payment_status
            FROM orders
            WHERE idempotency_key = $1
            LIMIT 1
        `, [idempotencyKey]);
        if (existingOrder.rows.length) {
            const existing = existingOrder.rows[0];
            if (String(existing.customer_email || '').toLowerCase() !== String(customer.email).trim().toLowerCase()) {
                await client.query('ROLLBACK');
                return res.status(409).json({ error: 'This Idempotency-Key belongs to another customer' });
            }
            await client.query('COMMIT');
            return res.json({
                success: true,
                message: 'The existing order was returned safely',
                orderId: existing.id,
                orderNumber: existing.order_number,
                subtotal: Number(existing.subtotal),
                shipping_cost: Number(existing.shipping_cost),
                tax: Number(existing.tax),
                total: Number(existing.total),
                payment_status: existing.payment_status,
                idempotentReplay: true
            });
        }
        const orderItems = [];
        let computedSubtotal = 0;
        const seenProductIds = new Set();

        for (const item of items) {
            const productId = String(item?.product_id || item?.product?.id || '').trim();
            const quantity = Number(item?.quantity);
            if (!/^[0-9a-f-]{36}$/i.test(productId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Each order item must contain a valid product and quantity' });
            }
            if (seenProductIds.has(productId)) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Duplicate products are not allowed in an order' });
            }
            seenProductIds.add(productId);

            const productResult = await client.query(`
                SELECT p.id, p.title, p.price, p.stock, p.shop_id,
                       s.status AS shop_status, s.verified AS shop_verified,
                       (SELECT pi.url FROM product_images pi
                        WHERE pi.product_id = p.id
                        ORDER BY pi.is_primary DESC, pi.display_order ASC
                        LIMIT 1) AS image_url
                FROM products p
                LEFT JOIN shops s ON s.id = p.shop_id
                WHERE p.id = $1 AND p.status = 'active'
                FOR UPDATE OF p
            `, [productId]);
            const product = productResult.rows[0];
            if (!product) {
                await client.query('ROLLBACK');
                return res.status(409).json({ error: 'One of the products is no longer available' });
            }
            if (Number(product.stock) < quantity) {
                await client.query('ROLLBACK');
                return res.status(409).json({ error: `${product.title} does not have enough stock` });
            }

            const price = Number(product.price);
            const lineTotal = Math.round(price * quantity * 100) / 100;
            computedSubtotal = Math.round((computedSubtotal + lineTotal) * 100) / 100;
            orderItems.push({ product, quantity, price, lineTotal });
        }

        if (payment_method === 'bank_transfer' && orderItems.some(({ product }) => (
            !product.shop_id
            || product.shop_status !== 'active'
            || product.shop_verified !== true
        ))) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                error: 'Bank transfer is available only for active, verified shops. Choose pay on delivery.'
            });
        }

        const shippingCost = (region === 'ng' ? 0.56 : 3.99);
        const freeThreshold = region === 'ng' ? 5000 / 900 : 30 / 0.79;
        const actualShipping = computedSubtotal >= freeThreshold ? 0 : shippingCost;
        const computedTax = Math.round(computedSubtotal * 0.075 * 100) / 100;
        const finalTotal = Math.round((computedSubtotal + actualShipping + computedTax) * 100) / 100;
        const orderNumber = `VH-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
        const shopIds = [...new Set(orderItems.map(item => item.product.shop_id).filter(Boolean))];

        const orderResult = await client.query(`
            INSERT INTO orders (
                order_number, idempotency_key, customer_id, shop_id, customer_email, region,
                subtotal, shipping_cost, tax, total, shipping_address,
                payment_method, status, payment_status, notes
            )
            VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', 'pending', $12)
            RETURNING id, order_number
        `, [
            orderNumber,
            idempotencyKey,
            shopIds.length === 1 ? shopIds[0] : null,
            String(customer.email).trim().toLowerCase(),
            region,
            computedSubtotal,
            actualShipping,
            computedTax,
            finalTotal,
            JSON.stringify(shipping),
            payment_method,
            `Customer: ${String(customer.firstName || '').trim()} ${String(customer.lastName || '').trim()} <${String(customer.email).trim()}>`
        ]);

        const orderId = orderResult.rows[0].id;

        for (const item of orderItems) {
            const product = item.product;
            await client.query(`
                INSERT INTO order_items (order_id, product_id, shop_id, title, price, quantity, total, image_url)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `, [
                orderId,
                product.id || null,
                product.shop_id || null,
                product.title || 'Product',
                item.price,
                item.quantity,
                item.lineTotal,
                product.image_url || null
            ]);
            await client.query(`
                UPDATE products
                SET stock = stock - $1,
                    status = CASE WHEN stock - $1 <= 0 THEN 'out_of_stock' ELSE status END,
                    updated_at = NOW()
                WHERE id = $2
            `, [item.quantity, product.id]);
        }

        await client.query('COMMIT');

        res.json({
            success: true,
            message: 'Order created and is pending payment confirmation',
            orderId,
            orderNumber: orderResult.rows[0].order_number,
            subtotal: computedSubtotal,
            shipping_cost: actualShipping,
            tax: computedTax,
            total: finalTotal
        });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Place order error:', error);
        if (isMissingSchemaError(error)) {
            return res.status(503).json({ error: 'Ordering is not configured for idempotent checkout yet. Apply the latest database migration.' });
        }
        res.status(500).json({ error: 'Failed to place order. Please try again.' });
    } finally {
        client.release();
    }
});

// Delivery promise details are calculated from seller handling time, the
// configured courier SLA, cut-off time, and business-day calendars. The
// endpoint is intentionally additive so existing product-card rendering
// continues to work when a deployment has not yet run the new migration.
app.get('/api/delivery/promise', async (req, res) => {
    const { productId, location } = req.query;
    if (!productId) return res.status(400).json({ error: 'productId is required' });
    try {
        const result = await pool.query(`
            SELECT p.processing_days, s.courier_sla_days, s.delivery_cutoff_hour,
                   s.delivery_reliability, p.inventory_verified
            FROM products p LEFT JOIN shops s ON s.id = p.shop_id
            WHERE p.id = $1 LIMIT 1
        `, [productId]);
        const row = result.rows[0] || {};
        res.json({
            promise: calculatePromise({
                location,
                processingDays: row.processing_days || 1,
                courierDays: row.courier_sla_days || 3,
                cutoffHour: row.delivery_cutoff_hour || 14,
                reliability: row.delivery_reliability || 86
            }),
            inventoryVerified: row.inventory_verified ?? false
        });
    } catch (error) {
        if (!isMissingSchemaError(error)) console.warn('Delivery promise lookup failed:', error.message);
        res.json({ promise: calculatePromise({ location }), inventoryVerified: false });
    }
});

app.post('/api/analytics/events', async (req, res) => {
    const events = Array.isArray(req.body?.events) ? req.body.events : [req.body];
    const allowed = new Set([
        'product_view', 'product_click', 'wishlist_add', 'cart_add',
        'recommendation_impression', 'recommendation_click', 'experiment_assignment',
        'search', 'checkout_start', 'purchase'
    ]);
    const valid = events.filter(event => event && allowed.has(event.name)).slice(0, 50);
    if (!valid.length) return res.status(400).json({ error: 'No valid events supplied' });
    try {
        for (const event of valid) {
            await pool.query(`
                INSERT INTO marketplace_events
                    (event_name, session_id, variant, region, location, product_id, category, properties, contribution_margin, occurred_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10::timestamptz, NOW()))
            `, [
                event.name,
                String(event.sessionId || 'anonymous').slice(0, 120),
                String(event.variant || 'unknown').slice(0, 40),
                String(event.region || 'ng').slice(0, 10),
                event.location || null,
                event.productId || null,
                event.category || null,
                JSON.stringify(event),
                Number.isFinite(Number(event.contributionMargin)) ? Number(event.contributionMargin) : null,
                event.timestamp || null
            ]);
        }
        res.status(202).json({ accepted: valid.length });
    } catch (error) {
        if (isMissingSchemaError(error)) return res.status(202).json({ accepted: valid.length, durable: false });
        console.error('Analytics event ingestion error:', error);
        res.status(500).json({ error: 'Could not record analytics events' });
    }
});

app.post('/api/observability/events', async (req, res) => {
    const allowed = new Set([
        'catalogue_failure',
        'checkout_abandonment',
        'checkout_failure',
        'auth_failure',
        'slow_api_request',
        'seller_publish_error',
        'client_error'
    ]);
    const sanitizeDiagnostic = (value) => String(value || '')
        .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
        .replace(/\b(password|access[_ -]?token|refresh[_ -]?token|authorization|secret|api[_ -]?key)\b\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
        .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[token]')
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
        .replace(/\b(?:\+?\d[\s().-]*){8,}\b/g, '[phone]')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 1200);
    const events = Array.isArray(req.body?.events) ? req.body.events : [req.body];
    const valid = events
        .filter((event) => event && allowed.has(event.name))
        .slice(0, 40)
        .map((event) => ({
            name: event.name,
            sessionId: /^[a-z0-9_-]{1,80}$/i.test(String(event.sessionId || ''))
                ? String(event.sessionId)
                : 'anonymous',
            route: String(event.route || '')
                .replace(/[?#].*$/, '')
                .replace(/[^a-z0-9/._-]/gi, '')
                .slice(0, 180),
            region: /^[a-z]{2,20}$/i.test(String(event.region || ''))
                ? String(event.region)
                : 'unknown',
            statusCode: Number.isInteger(Number(event.properties?.statusCode)) ? Number(event.properties.statusCode) : null,
            durationMs: Number.isInteger(Number(event.properties?.durationMs)) ? Math.min(Number(event.properties.durationMs), 120000) : null,
            properties: Object.fromEntries(
                Object.entries(event.properties || {})
                    .filter(([key]) => [
                        'source', 'statusCode', 'method', 'network', 'durationMs', 'provider',
                        'action', 'reason', 'scope', 'errorName', 'errorCode', 'diagnostic',
                        'clientRequestId'
                    ].includes(key))
                    .slice(0, 12)
                    .map(([key, value]) => {
                        if (key === 'diagnostic') return [key, sanitizeDiagnostic(value)];
                        if (typeof value === 'string') return [key, sanitizeDiagnostic(value).slice(0, 120)];
                        if (typeof value === 'number' && Number.isFinite(value)) return [key, value];
                        if (typeof value === 'boolean') return [key, value];
                        return [key, ''];
                    })
            )
        }));
    if (!valid.length) return res.status(400).json({ error: 'No valid operational events supplied' });
    try {
        for (const event of valid) {
            await pool.query(`
                INSERT INTO operational_events
                    (event_name, session_id, route, region, status_code, duration_ms, request_id, properties, occurred_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::timestamptz, NOW()))
            `, [
                event.name,
                event.sessionId,
                event.route || null,
                event.region,
                event.statusCode,
                event.durationMs,
                req.requestId,
                JSON.stringify(event.properties),
                null
            ]);
        }
        res.status(202).json({ accepted: valid.length });
    } catch (error) {
        if (isMissingSchemaError(error)) return res.status(202).json({ accepted: valid.length, durable: false });
        console.error(JSON.stringify({ level: 'error', event: 'observability_ingestion_error', requestId: req.requestId }));
        res.status(202).json({ accepted: valid.length, durable: false });
    }
});

app.get('/api/admin/observability/errors', authenticateToken, isAdmin, async (req, res) => {
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 200) : 100;
    try {
        const result = await pool.query(`
            SELECT id, session_id, route, region, request_id, properties, occurred_at
            FROM operational_events
            WHERE event_name = 'client_error'
            ORDER BY occurred_at DESC
            LIMIT $1
        `, [limit]);
        res.set('Cache-Control', 'no-store');
        res.json({ errors: result.rows });
    } catch (error) {
        console.error(JSON.stringify({
            level: 'error',
            event: 'admin_error_log_read_failed',
            requestId: req.requestId,
            code: error.code || 'unknown'
        }));
        res.status(503).json({
            error: 'The system error log is temporarily unavailable.',
            requestId: req.requestId
        });
    }
});

app.get('/api/admin/analytics/experiments', authenticateToken, isAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT variant, event_name, COUNT(*)::int AS events,
                   COUNT(DISTINCT session_id)::int AS sessions,
                   COALESCE(SUM(contribution_margin), 0)::numeric AS contribution_margin
            FROM marketplace_events
            WHERE occurred_at >= NOW() - INTERVAL '90 days'
            GROUP BY variant, event_name ORDER BY variant, event_name
            LIMIT 500
        `);
        res.json({ windowDays: 90, results: result.rows });
    } catch (error) {
        if (isMissingSchemaError(error)) return res.json({ windowDays: 90, results: [], durable: false });
        res.status(500).json({ error: 'Could not load experiment reporting' });
    }
});

app.get('/api/seller/operations', authenticateToken, isSellerAccount, async (req, res) => {
    try {
        const { limit, offset } = boundedPagination(req, { defaultLimit: 100, maxLimit: 200 });
        const ownerIds = authIdentityIds(req.user);
        const shop = await pool.query(
            'SELECT id, name FROM shops WHERE current_owner_id = ANY($1::uuid[]) OR owner_id = ANY($1::uuid[]) LIMIT 1',
            [ownerIds]
        );
        if (!shop.rows[0]) return res.status(404).json({ error: 'No shop assigned' });
        const products = await pool.query(`
            SELECT id, title, category, price, stock, low_stock_threshold, sales_count, view_count,
                   status, quality_score, policy_status, inventory_verified, provenance_status
            FROM products WHERE shop_id = $1 ORDER BY created_at DESC
            LIMIT $2 OFFSET $3
        `, [shop.rows[0].id, limit, offset]);
        const catalog = products.rows;
        const reorderAlerts = catalog.map(product => {
            const dailyDemand = Math.max(0.15, Number(product.sales_count || 0) / 30, Number(product.view_count || 0) * 0.02 / 30);
            const forecast14 = Math.ceil(dailyDemand * 14);
            return { ...product, forecast14, reorderQuantity: Math.max(0, Math.ceil(dailyDemand * 21 - Number(product.stock || 0))) };
        }).filter(product => Number(product.stock || 0) <= Math.max(Number(product.low_stock_threshold || 5), product.forecast14));
        const pricingSuggestions = catalog.map(product => {
            const conversion = Number(product.view_count || 0) ? Number(product.sales_count || 0) / Number(product.view_count) : 0;
            return conversion < 0.02 && Number(product.view_count || 0) > 25
                ? { productId: product.id, title: product.title, suggestion: 'Test a 5–10% price reduction' }
                : conversion > 0.08 && Number(product.stock || 0) < 10
                    ? { productId: product.id, title: product.title, suggestion: 'Demand is strong — test a small price increase' }
                    : null;
        }).filter(Boolean).slice(0, 10);
        const qualityIssues = catalog.filter(product => product.policy_status === 'blocked' || Number(product.quality_score || 100) < 80);
        const nextActions = [
            ...reorderAlerts.slice(0, 3).map(item => `Reorder ${item.title} — projected ${item.forecast14} units in 14 days.`),
            ...qualityIssues.slice(0, 2).map(item => `Review ${item.title} before scaling this listing.`),
            ...pricingSuggestions.slice(0, 2).map(item => `${item.title}: ${item.suggestion}.`)
        ].slice(0, 7);
        res.json({
            shop: shop.rows[0], products: catalog, reorderAlerts, pricingSuggestions, qualityIssues,
            forecast14: Math.round(catalog.reduce((sum, product) => sum + Number(product.sales_count || 0) / 30 * 14, 0)),
            nextActions,
            limit,
            offset
        });
    } catch (error) {
        if (isMissingSchemaError(error)) return res.json({ products: [], reorderAlerts: [], pricingSuggestions: [], qualityIssues: [], forecast14: 0, nextActions: [], durable: false });
        console.error('Seller operations error:', error);
        res.status(500).json({ error: 'Failed to load seller operations' });
    }
});

app.post('/api/seller/products/validate', authenticateToken, isSellerAccount, async (req, res) => {
    try {
        const ownerIds = authIdentityIds(req.user);
        const shop = await pool.query(
            'SELECT id FROM shops WHERE current_owner_id = ANY($1::uuid[]) OR owner_id = ANY($1::uuid[]) LIMIT 1',
            [ownerIds]
        );
        if (!shop.rows[0]) return res.status(404).json({ error: 'No shop assigned' });
        const existing = await pool.query(
            'SELECT id, title FROM products WHERE shop_id = $1 ORDER BY created_at DESC LIMIT 200',
            [shop.rows[0].id]
        );
        const quality = listingQuality(req.body || {});
        const duplicate = existing.rows.find(product => product.title.toLowerCase() === String(req.body?.title || '').trim().toLowerCase());
        if (duplicate) quality.errors.push(`Possible duplicate of “${duplicate.title}”.`);
        quality.score = Math.max(0, quality.score - (duplicate ? 24 : 0));
        quality.policyStatus = quality.errors.length ? 'blocked' : quality.warnings.length ? 'review' : 'ready';
        res.json({ ...quality, canPublish: quality.errors.length === 0 });
    } catch (error) {
        if (isMissingSchemaError(error)) return res.json({ ...listingQuality(req.body || {}), canPublish: true, durable: false });
        res.status(500).json({ error: 'Could not validate listing' });
    }
});

app.get('/api/seller/benchmarks', authenticateToken, isSellerAccount, async (req, res) => {
    try {
        const ownerIds = authIdentityIds(req.user);
        const shop = await pool.query(
            'SELECT id FROM shops WHERE current_owner_id = ANY($1::uuid[]) OR owner_id = ANY($1::uuid[]) LIMIT 1',
            [ownerIds]
        );
        if (!shop.rows[0]) return res.status(404).json({ error: 'No shop assigned' });
        const result = await pool.query(`
            WITH mine AS (
                SELECT category, COALESCE(location, 'all') AS location,
                       COUNT(*)::int AS listings, COALESCE(SUM(sales_count), 0)::int AS sales,
                       COALESCE(SUM(view_count), 0)::int AS views
                FROM products WHERE shop_id = $1 GROUP BY category, COALESCE(location, 'all')
            ), market AS (
                SELECT category, COALESCE(location, 'all') AS location,
                       COUNT(*)::int AS market_listings,
                       COALESCE(AVG(sales_count), 0)::numeric AS avg_sales,
                       COALESCE(AVG(view_count), 0)::numeric AS avg_views
                FROM products WHERE status = 'active' GROUP BY category, COALESCE(location, 'all')
            )
            SELECT mine.category, mine.location, mine.listings, mine.sales, mine.views,
                   market.market_listings, ROUND(market.avg_sales, 1) AS market_avg_sales,
                   ROUND(market.avg_views, 1) AS market_avg_views,
                   ROUND(CASE WHEN mine.views > 0 THEN mine.sales::numeric / mine.views ELSE 0 END, 4) AS conversion_rate
            FROM mine LEFT JOIN market USING (category, location)
            ORDER BY mine.sales DESC, mine.category
        `, [shop.rows[0].id]);
        const gaps = await pool.query(`
            WITH demand AS (
                SELECT region, location, category, COUNT(*)::int AS demand_events
                FROM marketplace_events
                WHERE occurred_at >= NOW() - INTERVAL '90 days'
                  AND event_name IN ('search', 'product_click', 'product_view')
                  AND category IS NOT NULL
                GROUP BY region, location, category
            ), supply AS (
                SELECT CASE WHEN location = ANY($1::text[]) THEN 'ng' ELSE 'uk' END AS region,
                       COALESCE(location, 'all') AS location, category, COUNT(*)::int AS supply_count
                FROM products WHERE status = 'active'
                GROUP BY CASE WHEN location = ANY($1::text[]) THEN 'ng' ELSE 'uk' END, COALESCE(location, 'all'), category
            )
            SELECT demand.region, demand.location, demand.category, demand.demand_events,
                   COALESCE(supply.supply_count, 0) AS supply_count
            FROM demand LEFT JOIN supply USING (region, location, category)
            WHERE demand.demand_events >= 3
              AND COALESCE(supply.supply_count, 0) < GREATEST(2, CEIL(demand.demand_events / 4.0))
            ORDER BY demand.demand_events DESC LIMIT 12
        `, [NIGERIAN_STATES]);
        res.json({ private: true, benchmarks: result.rows, assortmentGaps: gaps.rows });
    } catch (error) {
        if (isMissingSchemaError(error)) return res.json({ private: true, benchmarks: [], durable: false });
        console.error('Seller benchmark error:', error);
        res.status(500).json({ error: 'Failed to load seller benchmarks' });
    }
});

app.get('/api/admin/marketplace/assortment-gaps', authenticateToken, isAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            WITH demand AS (
                SELECT region, location, category, COUNT(*)::int AS demand_events,
                       COUNT(DISTINCT session_id)::int AS interested_sessions
                FROM marketplace_events
                WHERE occurred_at >= NOW() - INTERVAL '90 days'
                  AND event_name IN ('search', 'product_click', 'product_view')
                  AND category IS NOT NULL
                GROUP BY region, location, category
            ), supply AS (
                SELECT CASE WHEN location = ANY($1::text[]) THEN 'ng' ELSE 'uk' END AS region,
                       COALESCE(location, 'all') AS location, category, COUNT(*)::int AS supply_count
                FROM products WHERE status = 'active'
                GROUP BY CASE WHEN location = ANY($1::text[]) THEN 'ng' ELSE 'uk' END, COALESCE(location, 'all'), category
            )
            SELECT demand.region, demand.location, demand.category, demand.demand_events,
                   demand.interested_sessions, COALESCE(supply.supply_count, 0) AS supply_count,
                   GREATEST(0, demand.demand_events - COALESCE(supply.supply_count, 0) * 4)::int AS gap_score
            FROM demand LEFT JOIN supply USING (region, location, category)
            WHERE demand.demand_events >= 3
              AND COALESCE(supply.supply_count, 0) < GREATEST(2, CEIL(demand.demand_events / 4.0))
            ORDER BY gap_score DESC, demand.demand_events DESC
            LIMIT 100
        `, [NIGERIAN_STATES]);
        res.json({ privacy: 'aggregated', windowDays: 90, gaps: result.rows });
    } catch (error) {
        if (isMissingSchemaError(error)) return res.json({ privacy: 'aggregated', windowDays: 90, gaps: [], durable: false });
        console.error('Assortment gap error:', error);
        res.status(500).json({ error: 'Failed to load assortment gaps' });
    }
});

// API clients should never receive the storefront shell for an unknown API
// path; return a machine-readable response instead.
app.use('/api', (req, res) => {
    res.status(404).json({ error: 'API endpoint not found', requestId: req.requestId });
});

// Repair a malformed local-preview URL produced by concatenating "index.html"
// with a sibling app path. Redirect only this known pattern; unknown files
// still return a real 404.
app.use((req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method)) return next();
    const malformedAppPath = req.path.match(
        /^\/index\.html(velverahub-(?:ng|uk|admin|shop)(?:\/.*)?)$/
    );
    if (!malformedAppPath) return next();
    const query = req.originalUrl.slice(req.path.length);
    return res.redirect(308, `/${malformedAppPath[1]}${query}`);
});

// Local preview mirrors the static Pages deployment: public Supabase client
// settings are available before page scripts initialize the client.
app.use(surfaceRoutingMiddleware);

// Keep existing bookmarks and external product links working after the
// storefront's static page directory moved from /pages/ to /veeve/.
app.use((req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method) || (req.path !== '/pages' && !req.path.startsWith('/pages/'))) {
        return next();
    }
    const destination = req.path === '/pages'
        ? `/veeve/${req.originalUrl.slice('/pages'.length)}`
        : req.originalUrl.replace(/^\/pages(?=\/|$)/, '/veeve');
    return res.redirect(301, destination);
});

app.use(async (req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();

    const relativePath = req.path === '/'
        ? 'index.html'
        : `${req.path.replace(/^\/+/, '').replace(/\/+$/, '')}${req.path.endsWith('/') ? '/index.html' : ''}`;
    if (!relativePath.endsWith('.html')) return next();

    const filePath = path.join(__dirname, relativePath);
    if (!filePath.startsWith(__dirname) || !fs.existsSync(filePath)) return next();

    try {
        const html = await fs.promises.readFile(filePath, 'utf8');
        res.type('html').send(injectDomainRouting(html));
    } catch (error) {
        next(error);
    }
});

app.use(express.static('.', {
    setHeaders: (res, filePath) => {
        const normalizedPath = filePath.split(path.sep).join('/');
        const isMutableCodeAsset = /\.(?:css|js|mjs)$/i.test(normalizedPath);
        const isStaticAsset = normalizedPath.includes('/assets/') || normalizedPath.includes('/img/');
        res.setHeader(
            'Cache-Control',
            isMutableCodeAsset
                ? 'no-cache, no-store, must-revalidate'
                : isStaticAsset
                ? 'public, max-age=3600, stale-while-revalidate=86400'
                : 'no-cache, no-store, must-revalidate'
        );
    }
}));

app.get('/{*path}', (req, res) => {
    if (req.path.includes('.')) {
        return res.status(404).send('Not found');
    }
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status === 413 || error.type === 'entity.too.large' ? 413 : 500;
    const message = status === 413
        ? 'Request payload is too large.'
        : 'Something went wrong. Please try again later.';
    console.error(JSON.stringify({
        level: 'error',
        event: 'request_error',
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        status,
        message: error.message
    }));
    res.status(status).json({ error: message, requestId: req.requestId });
});

async function startServer() {
    app.listen(PORT, HOST, () => {
        console.log(`VelveraHub server running at http://${HOST}:${PORT}`);
        console.log('Database pool initialized; schema availability is checked per request.');
    });
}

startServer();
