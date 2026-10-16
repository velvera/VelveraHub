import { spawn } from 'node:child_process';

const port = Number(process.env.SMOKE_PORT || 5050);
const externalBaseUrl = process.env.SMOKE_BASE_URL || process.argv[2];
const baseUrl = (externalBaseUrl || `http://127.0.0.1:${port}`).replace(/\/+$/, '');
const requireSupabase = process.env.SMOKE_REQUIRE_SUPABASE === '1';
const requireCatalogue = process.env.SMOKE_REQUIRE_CATALOGUE === '1';
const smokeApp = process.env.SMOKE_APP || (externalBaseUrl ? 'public' : 'local');
const localChecks = [
    ['API health', '/healthz', '"status":"ok"'],
    ['API namespace health', '/api/health', '"service":"velverahub-api"'],
    ['storefront', '/', '<title>VelveraHub'],
    ['regional Nigeria entry point', '/velverahub-ng/index.html', '<title>VelveraHub'],
    ['regional UK entry point', '/velverahub-uk/index.html', '<title>VelveraHub'],
    ['products page', '/veeve/products.html', 'id="productsGrid"'],
    ['product page', '/veeve/product.html', 'Product Details'],
    ['shop page', '/veeve/shop.html', 'VelveraHub'],
    ['checkout page', '/veeve/checkout.html', 'Checkout'],
    ['seller workspace', '/veeve/seller.html', 'id="dashboardContent"'],
    ['standalone static shop portal', '/velverahub-shop/', '<title>Shop Owner Portal - VelveraHub</title>'],
    ['shop onboarding form', '/velverahub-shop/', 'id="shopOnboardingForm"'],
    ['shop document verification form', '/velverahub-shop/', 'id="shopVerificationForm"'],
    ['shop account registration UI', '/velverahub-shop/shop.js', 'Create seller account'],
    ['shop portal marketplace footer stylesheet', '/velverahub-shop/assets/css/components/footer.css', '.footer-bottom'],
    ['shop creation RPC wiring', '/velverahub-shop/shop.js', "rpc('shop_owner_create_shop'"],
    ['shop private verification RPC wiring', '/velverahub-shop/shop.js', "shop_owner_submit_verification_documents"],
    ['shop pending status display', '/velverahub-shop/shop.js', "label: 'Pending review'"],
    ['shop approved status display', '/velverahub-shop/shop.js', "label: 'Approved'"],
    ['shop rejected status display', '/velverahub-shop/shop.js', "label: 'Rejected'"],
    ['shop static-only configuration', '/velverahub-shop/assets/js/config.js', 'STATIC_ONLY: true'],
    ['admin dashboard', '/velverahub-admin/', 'id="adminAuthPanel"'],
    ['admin shop verification queue', '/velverahub-admin/admin.js', 'admin_review_shop_verification'],
    ['admin account deletion queue', '/velverahub-admin/admin.js', 'admin_list_account_deletion_requests'],
    ['shared smart features', '/assets/js/components/smart-features.js', 'support-widget'],
    ['public Supabase config', '/assets/js/services/publicSupabaseConfig.js', 'SUPABASE_ANON_KEY'],
];
const externalChecks = {
    public: [
        ['storefront', '/', '<title>VelveraHub'],
        ['products page', '/veeve/products.html', 'id="productsGrid"'],
        ['product page', '/veeve/product.html', 'Product Details'],
        ['shop page', '/veeve/shop.html', 'VelveraHub'],
        ['checkout page', '/veeve/checkout.html', 'Checkout'],
        ['seller workspace', '/veeve/seller.html', 'id="dashboardContent"'],
        ['account deletion request UI', '/veeve/account.html', 'data-account-delete'],
        ['account deletion Supabase RPC', '/assets/js/pages/account-privacy.js', "rpc('request_account_deletion')"],
        ['public Supabase config', '/assets/js/services/publicSupabaseConfig.js', 'SUPABASE_ANON_KEY'],
    ],
    admin: [
        ['admin dashboard', '/', 'id="adminAuthPanel"'],
        ['admin shop verification queue', '/admin.js', 'admin_review_shop_verification'],
        ['admin account deletion queue', '/admin.js', 'admin_list_account_deletion_requests'],
        ['public Supabase config', '/assets/js/services/publicSupabaseConfig.js', 'SUPABASE_ANON_KEY'],
    ],
    shop: [
        ['standalone shop portal', '/', '<title>Shop Owner Portal - VelveraHub</title>'],
        ['shop onboarding form', '/', 'id="shopOnboardingForm"'],
        ['shop document verification form', '/', 'id="shopVerificationForm"'],
        ['shop Supabase RPC wiring', '/shop.js', "rpc('shop_owner_create_shop'"],
        ['public Supabase config', '/assets/js/services/publicSupabaseConfig.js', 'SUPABASE_ANON_KEY'],
    ],
};
const checks = externalBaseUrl ? externalChecks[smokeApp] : localChecks;

let server;

async function fetchSmokeRoute(url, options = {}) {
    const allowedOrigin = new URL(baseUrl).origin;
    let currentUrl = url;
    let redirects = 0;

    while (true) {
        const response = await fetch(currentUrl, { ...options, redirect: 'manual' });
        const location = response.headers.get('location');
        if (!externalBaseUrl || ![301, 302, 303, 307, 308].includes(response.status) || !location) {
            return { response, finalUrl: currentUrl, redirects, crossOriginRedirect: false };
        }

        const nextUrl = new URL(location, currentUrl);
        if (nextUrl.origin !== allowedOrigin) {
            return { response, finalUrl: currentUrl, redirects, crossOriginRedirect: true };
        }
        if (redirects >= 5) {
            return { response, finalUrl: currentUrl, redirects, crossOriginRedirect: false };
        }

        currentUrl = nextUrl.href;
        redirects += 1;
    }
}

function waitForExit(child) {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
        child.once('exit', resolve);
        child.once('close', resolve);
    });
}

async function fetchWithRetry(url, attempts = 30) {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
            return await fetch(url);
        } catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, 150));
        }
    }
    throw lastError;
}

async function loadPublicSupabaseConfig() {
    const { response } = await fetchSmokeRoute(`${baseUrl}/assets/js/services/publicSupabaseConfig.js`);
    if (!response.ok) throw new Error(`Supabase config returned ${response.status}`);
    const source = await response.text();
    const url = source.match(/const\s+SUPABASE_URL\s*=\s*["']([^"']+)["']/)?.[1];
    const anonKey = source.match(/const\s+SUPABASE_ANON_KEY\s*=\s*["']([^"']+)["']/)?.[1];
    if (!url || !anonKey || /YOUR-PROJECT|YOUR_PUBLIC_ANON_KEY/i.test(source)) {
        throw new Error('Public Supabase URL or anon key is missing or still a placeholder.');
    }
    if (externalBaseUrl) {
        const { response: appConfigResponse } = await fetchSmokeRoute(`${baseUrl}/assets/js/config.js`);
        const appConfig = appConfigResponse.ok ? await appConfigResponse.text() : '';
        const apiOrigin = appConfig.match(/API_ORIGIN:\s*["']([^"']*)["']/)?.[1] || '';
        if (!appConfig.includes('STATIC_ONLY: true') || apiOrigin) {
            throw new Error('The deployed root must use STATIC_ONLY and leave API_ORIGIN empty.');
        }
    }
    return { url, anonKey };
}

async function run() {
    if (externalBaseUrl && !checks) {
        throw new Error(`Unsupported SMOKE_APP "${smokeApp}". Use public, admin, or shop.`);
    }
    if (!externalBaseUrl) {
        server = spawn(process.execPath, ['server.js'], {
            env: { ...process.env, PORT: String(port), NODE_ENV: 'test' },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        server.stdout.on('data', () => {});
        server.stderr.on('data', () => {});
            await fetchWithRetry(`${baseUrl}/`);
    }

    let failed = false;
    for (const [name, route, expected] of checks) {
        try {
            const { response, finalUrl, redirects, crossOriginRedirect } = await fetchSmokeRoute(`${baseUrl}${route}`, {
                headers: { accept: 'text/html,application/json,*/*' },
            });
            const body = await response.text();
            const passed = response.status === 200 && body.includes(expected) && !crossOriginRedirect;
            if (route === '/assets/js/services/publicSupabaseConfig.js' && requireSupabase &&
                (body.includes('YOUR-PROJECT') || body.includes('YOUR_PUBLIC_ANON_KEY'))) {
                throw new Error('Static public Supabase configuration is still using placeholders');
            }
            const redirectNote = redirects
                ? ` after ${redirects} same-origin redirect${redirects === 1 ? '' : 's'} to ${new URL(finalUrl).pathname}`
                : '';
            const originNote = crossOriginRedirect ? ' (blocked cross-origin redirect)' : '';
            console.log(`${passed ? 'PASS' : 'FAIL'} ${name} (${response.status}${redirectNote})${originNote}`);
            if (!passed) failed = true;
        } catch (error) {
            failed = true;
            console.error(`FAIL ${name}: ${error.message}`);
        }
    }

    if (requireSupabase || requireCatalogue) {
        try {
            await loadPublicSupabaseConfig();
            console.log('PASS public Supabase configuration is present');
        } catch (error) {
            failed = true;
            console.error(`FAIL public Supabase configuration: ${error.message}`);
        }
    }

    if (requireCatalogue) {
        try {
            const { url, anonKey } = await loadPublicSupabaseConfig();
            const catalogueUrl = new URL('/rest/v1/products', url);
            catalogueUrl.searchParams.set('select', 'id');
            catalogueUrl.searchParams.set('status', 'eq.active');
            catalogueUrl.searchParams.set('stock', 'gt.0');
            catalogueUrl.searchParams.set('limit', '1');
            const response = await fetch(catalogueUrl, {
                headers: {
                    apikey: anonKey,
                    Authorization: `Bearer ${anonKey}`,
                    Accept: 'application/json',
                },
            });
            const products = await response.json().catch(() => null);
            const passed = response.ok && Array.isArray(products) && products.length > 0;
            console.log(`${passed ? 'PASS' : 'FAIL'} active in-stock catalogue visible through Supabase RLS (${response.status})`);
            if (!passed) failed = true;
        } catch (error) {
            failed = true;
            console.error(`FAIL Supabase catalogue check: ${error.message}`);
        }
    }

    if (!externalBaseUrl) {
        try {
            const malformedRegionalUrl = `${baseUrl}/index.htmlvelverahub-uk/index.html`;
            const response = await fetch(malformedRegionalUrl);
            const body = await response.text();
            const passed = response.status === 200 &&
                new URL(response.url).pathname === '/velverahub-uk/index.html' &&
                body.includes('<title>VelveraHub');
            console.log(`${passed ? 'PASS' : 'FAIL'} malformed regional URL redirects to the UK app (${response.status})`);
            if (!passed) failed = true;
        } catch (error) {
            failed = true;
            console.error(`FAIL malformed regional URL compatibility redirect: ${error.message}`);
        }

        for (const [name, origin, expectedHeader] of [
            ['allowed storefront CORS', 'https://velverahub.com', 'https://velverahub.com'],
            ['allowed UK CORS', 'https://velverahub.co.uk', 'https://velverahub.co.uk'],
            ['blocked unknown CORS', 'https://not-velverahub.example', null],
        ]) {
            try {
                const response = await fetch(`${baseUrl}/api/health`, {
                    headers: { Origin: origin }
                });
                const allowOrigin = response.headers.get('access-control-allow-origin');
                const allowCredentials = response.headers.get('access-control-allow-credentials');
                const passed = response.status === 200 &&
                    allowOrigin === expectedHeader &&
                    allowCredentials !== 'true';
                console.log(`${passed ? 'PASS' : 'FAIL'} ${name} (${allowOrigin || 'no allow-origin'})`);
                if (!passed) failed = true;
            } catch (error) {
                failed = true;
                console.error(`FAIL ${name}: ${error.message}`);
            }
        }

        for (const [legacyPath, expectedLocation] of [
            ['/pages/product.html?id=legacy-check', '/veeve/product.html?id=legacy-check'],
            ['/pages', '/veeve/'],
        ]) {
            try {
                const legacyResponse = await fetch(`${baseUrl}${legacyPath}`, { redirect: 'manual' });
                const location = legacyResponse.headers.get('location') || '';
                const passed = legacyResponse.status === 301 && location === expectedLocation;
                console.log(`${passed ? 'PASS' : 'FAIL'} legacy route ${legacyPath} → ${location || legacyResponse.status}`);
                if (!passed) failed = true;
            } catch (error) {
                failed = true;
                console.error(`FAIL legacy page route ${legacyPath}: ${error.message}`);
            }
        }
    }

    if (failed) process.exitCode = 1;
}

try {
    await run();
} finally {
    if (server) {
        const stopped = waitForExit(server);
        server.kill('SIGTERM');
        await Promise.race([
            stopped,
            new Promise((resolve) => setTimeout(resolve, 1000)),
        ]);
    }
}