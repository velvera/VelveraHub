import { execFileSync, spawn } from 'node:child_process';
import { chromium } from 'playwright';

const port = Number(process.env.AUTH_BROWSER_PORT || 5051);
const suppliedBaseUrl = process.env.AUTH_BROWSER_BASE_URL ||
    process.argv.slice(2).find((argument) => !argument.startsWith('-'));
const baseUrl = (suppliedBaseUrl || `http://127.0.0.1:${port}`).replace(/\/+$/, '');
const timeout = Number(process.env.AUTH_BROWSER_TIMEOUT_MS || 20_000);
const headed = process.env.AUTH_BROWSER_HEADED === '1';
const screenshotDir = process.env.AUTH_BROWSER_SCREENSHOTS_DIR || 'test-results/authenticated-browser';
const sellerAcceptance = process.argv.includes('--seller-acceptance');
const registerSeller = sellerAcceptance && (
    process.argv.includes('--register-seller') || process.env.AUTH_BROWSER_REGISTER_SELLER === '1'
);

const roles = [
    {
        name: 'shopper',
        expectedProfileRole: 'customer',
        email: process.env.SUPABASE_SHOPPER_EMAIL,
        password: process.env.SUPABASE_SHOPPER_PASSWORD,
        route: '/veeve/products.html',
    },
    {
        name: 'seller',
        expectedProfileRole: 'seller',
        email: process.env.SUPABASE_SELLER_EMAIL,
        password: process.env.SUPABASE_SELLER_PASSWORD,
        route: '/veeve/seller.html',
        requiresShop: !sellerAcceptance,
    },
    {
        name: 'admin',
        expectedProfileRole: 'admin',
        email: process.env.SUPABASE_ADMIN_EMAIL,
        password: process.env.SUPABASE_ADMIN_PASSWORD,
        route: '/dashboards/admin/',
    },
];

const sellerSurfaces = [
    { name: 'main storefront', route: '/', selector: 'main' },
    { name: 'NG storefront', route: '/velverahub-ng/veeve/products.html', selector: '#productsGrid' },
    { name: 'UK storefront', route: '/velverahub-uk/veeve/products.html', selector: '#productsGrid' },
    { name: 'seller workspace', route: '/veeve/seller.html', selector: '#dashboardContent' },
    { name: 'shop-owner portal', route: '/shop-owner/index.html', selector: '#dashboardContent' },
];

let server;

function printHelp() {
    console.log(`
Authenticated Supabase browser checks

Usage:
  npm run auth:browser
  npm run auth:seller:acceptance
  npm run auth:browser -- https://your-preview.example

The full check requires:
  SUPABASE_SHOPPER_EMAIL / SUPABASE_SHOPPER_PASSWORD
  SUPABASE_SELLER_EMAIL  / SUPABASE_SELLER_PASSWORD
  SUPABASE_ADMIN_EMAIL   / SUPABASE_ADMIN_PASSWORD

Seller acceptance:
  npm run auth:seller:acceptance -- --register-seller
  (or set AUTH_BROWSER_REGISTER_SELLER=1)
  This registers the supplied dedicated seller credentials through the public
  auth page, verifies the seller profile role, then checks both storefront
  regions and both seller portals. A new seller does not need an assigned shop
  for this acceptance flow.

Optional:
  AUTH_BROWSER_BASE_URL       Use an already-running app instead of starting port ${port}
  AUTH_BROWSER_HEADED=1       Show the browser while running
  AUTH_BROWSER_TIMEOUT_MS     Per-step timeout (default ${timeout}ms)
  AUTH_BROWSER_EXECUTABLE_PATH  Chromium executable override
  AUTH_BROWSER_SCREENSHOTS_DIR  Failure screenshot directory
`);
}

function getChromiumExecutable() {
    if (process.env.AUTH_BROWSER_EXECUTABLE_PATH) return process.env.AUTH_BROWSER_EXECUTABLE_PATH;
    try {
        return execFileSync('which', ['chromium'], { encoding: 'utf8' }).trim() || undefined;
    } catch {
        return undefined;
    }
}

function waitForExit(child) {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    return new Promise((resolve) => child.once('exit', resolve));
}

async function waitForServer(url, attempts = 40) {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
            const response = await fetch(`${url}/`);
            if (response.ok) return;
        } catch (error) {
            lastError = error;
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw lastError || new Error(`Application did not start at ${url}`);
}

function requireCredentials(requiredRoles) {
    const missing = requiredRoles.flatMap(({ name, email, password }) => [
        email ? null : `SUPABASE_${name.toUpperCase()}_EMAIL`,
        password ? null : `SUPABASE_${name.toUpperCase()}_PASSWORD`,
    ]).filter(Boolean);

    if (missing.length) throw new Error(`Missing test-account variables: ${missing.join(', ')}`);
}

async function getAuthenticatedRole(page, expectedRole) {
    return page.evaluate(async (role) => {
        const supabase = window.SupabaseClient?.get();
        const authService = window.AuthService;
        if (!supabase || !window.SupabaseClient?.isConfigured()) {
            return { error: 'Supabase is not configured in the browser' };
        }

        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError || !user) return { error: userError?.message || 'No Supabase session found' };

        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('id, user_id, role')
            .or(`user_id.eq.${user.id},id.eq.${user.id}`)
            .limit(1)
            .maybeSingle();

        let hasShop = false;
        if (role === 'seller') {
            const ownerIds = [...new Set([user.id, profile?.id].filter(Boolean))];
            const ownerFilters = ownerIds
                .flatMap((id) => [`owner_id.eq.${id}`, `current_owner_id.eq.${id}`])
                .join(',');
            if (ownerFilters) {
                const { data: shop } = await supabase
                    .from('shops')
                    .select('id')
                    .or(ownerFilters)
                    .limit(1)
                    .maybeSingle();
                hasShop = Boolean(shop);
            }
        }

        return {
            email: user.email,
            userId: user.id,
            profileId: profile?.id || null,
            profileRole: profile?.role || null,
            profileError: profileError?.message || null,
            hasShop,
            authServiceLoggedIn: Boolean(authService?.isLoggedIn?.()),
            authServiceAdmin: Boolean(authService?.isAdmin?.()),
        };
    }, expectedRole);
}

async function waitForAuthenticatedRole(page, expectedRole) {
    const deadline = Date.now() + timeout;
    let latest = null;
    while (Date.now() < deadline) {
        latest = await getAuthenticatedRole(page, expectedRole);
        if (latest?.email && latest?.profileRole) return latest;
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return latest || { error: 'Timed out while loading the authenticated profile' };
}

async function signIn(page, role) {
    await page.goto(`${baseUrl}/veeve/auth.html?mode=login`, { waitUntil: 'domcontentloaded' });
    await page.locator('#authLoginForm').waitFor({ state: 'visible', timeout });
    await page.locator('#authLoginEmail').fill(role.email);
    await page.locator('#authLoginPassword').fill(role.password);
    await page.locator('#authLoginForm button[type="submit"]').click();
    try {
        await page.waitForFunction(() => window.AuthService?.isLoggedIn?.() === true, undefined, { timeout });
    } catch (error) {
        const diagnostics = await page.evaluate(() => ({
            feedback: document.querySelector('#authFeedback')?.textContent.trim() || '',
            loginFormVisible: Boolean(document.querySelector('#authLoginForm')?.getClientRects().length),
            sessionPresent: Boolean(window.AuthService?.getUser?.()),
        }));
        throw new Error(`Seller sign-in did not complete: ${JSON.stringify(diagnostics)}; ${error.message}`);
    }
}

async function registerDedicatedSeller(page, role) {
    await page.goto(`${baseUrl}/veeve/auth.html?mode=register`, { waitUntil: 'domcontentloaded' });
    await page.locator('#authRegisterForm').waitFor({ state: 'visible', timeout });
    await page.locator('label.auth-account-type-option')
        .filter({ hasText: 'Shop and sell on VelveraHub' })
        .click();
    await page.locator('#authFirstName').fill('Acceptance');
    await page.locator('#authLastName').fill('Seller');
    await page.locator('#authRegisterEmail').fill(role.email);
    await page.locator('#authRegisterPassword').fill(role.password);
    await page.locator('#authBusinessName').fill('VelveraHub Acceptance Seller');
    await page.locator('#authBusinessState').selectOption({ label: 'Lagos' }).catch(() => {});
    await page.locator('input[name="ageConfirmed"]').check();
    await page.locator('input[name="terms"]').check();
    await page.locator('#authRegisterForm button[type="submit"]').click();

    let navigated = false;
    try {
        await page.waitForURL((url) => !url.pathname.endsWith('/auth.html'), { timeout });
        navigated = true;
        await page.waitForLoadState('domcontentloaded');
    } catch {
        // Some auth configurations create the session without redirecting.
        // In that case the session check below is the authoritative result.
    }

    try {
        await page.waitForFunction(
            () => window.AuthService?.isLoggedIn?.() === true,
            undefined,
            { timeout: navigated ? timeout : 2500 }
        );
    } catch {
        const feedback = await page.locator('#authFeedback').textContent().catch(() => '');
        throw new Error(
            `Seller registration did not create an active session${feedback ? `: ${feedback.trim()}` : ''}`
        );
    }
}

async function assertSellerPrivacy(page, session) {
    const result = await page.evaluate(async ({ profileId }) => {
        const supabase = window.SupabaseClient.get();
        const contactResult = await supabase
            .from('seller_public_contacts')
            .select('seller_id,is_public')
            .limit(100);
        const visibleContactsArePublic = (contactResult.data || []).every((row) => row.is_public === true);

        // RLS must not expose another profile. If another profile exists,
        // explicitly requesting it must still return no row.
        const otherProfiles = await supabase
            .from('profiles')
            .select('id')
            .neq('id', profileId || '00000000-0000-0000-0000-000000000000')
            .limit(1);
        let otherProfileHidden = !otherProfiles.data?.length;
        if (otherProfiles.data?.[0]?.id) {
            const targeted = await supabase
                .from('profiles')
                .select('id,email,role')
                .eq('id', otherProfiles.data[0].id)
                .maybeSingle();
            otherProfileHidden = !targeted.data;
        }

        return {
            contactError: contactResult.error?.message || null,
            visibleContactsArePublic,
            otherProfileError: otherProfiles.error?.message || null,
            otherProfileHidden
        };
    }, session);

    if (result.contactError) {
        throw new Error(`Seller public-contact table could not be read: ${result.contactError}`);
    }
    if (!result.visibleContactsArePublic) {
        throw new Error('Seller public-contact RLS exposed a non-public contact row');
    }
    if (!result.otherProfileHidden) {
        throw new Error('Profile RLS exposed another user profile');
    }
    console.log('PASS seller public-contact opt-in and profile privacy checks');
}

async function checkSellerAcceptance(browser, role) {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
        if (registerSeller) await registerDedicatedSeller(page, role);
        else await signIn(page, role);

        const session = await waitForAuthenticatedRole(page, 'seller');
        if (session.error) throw new Error(session.error);
        if (session.email?.toLowerCase() !== role.email.toLowerCase()) {
            throw new Error(`Session email mismatch: expected ${role.email}, received ${session.email || 'none'}`);
        }
        if (session.profileRole !== 'seller') {
            throw new Error(`Profile role mismatch: expected seller, received ${session.profileRole || 'none'}`);
        }
        if (!session.authServiceLoggedIn) throw new Error('AuthService did not expose the active Supabase session');

        await assertSellerPrivacy(page, session);
        for (const surface of sellerSurfaces) {
            await page.goto(`${baseUrl}${surface.route}`, { waitUntil: 'domcontentloaded' });
            await page.locator(surface.selector).waitFor({ state: 'attached', timeout });
            await page.waitForFunction(() => window.AuthService?.isLoggedIn?.() === true, undefined, { timeout });
            console.log(`PASS seller ${surface.name} (${surface.route})`);
        }
    } catch (error) {
        await page.screenshot({ path: `${screenshotDir}/seller-acceptance-failure.png`, fullPage: true }).catch(() => {});
        console.error(`FAIL seller acceptance: ${error.message}`);
        throw error;
    } finally {
        await context.close();
    }
}

async function checkRole(browser, role) {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
        await signIn(page, role);
        const session = await waitForAuthenticatedRole(page, role.expectedProfileRole);
        if (session.error) throw new Error(session.error);
        if (session.email?.toLowerCase() !== role.email.toLowerCase()) {
            throw new Error(`Session email mismatch: expected ${role.email}, received ${session.email || 'none'}`);
        }
        if (session.profileRole !== role.expectedProfileRole) {
            throw new Error(`Profile role mismatch: expected ${role.expectedProfileRole}, received ${session.profileRole || 'none'}`);
        }
        if (!session.authServiceLoggedIn) throw new Error('AuthService did not expose the active Supabase session');
        if (role.expectedProfileRole === 'admin' && !session.authServiceAdmin) {
            throw new Error('AuthService did not expose the admin profile role');
        }
        if (role.requiresShop && !session.hasShop) throw new Error('Seller account is not linked to a shop');

        await page.goto(`${baseUrl}${role.route}`, { waitUntil: 'domcontentloaded' });
        await page.locator(role.name === 'shopper' ? '#productsGrid' : '#dashboardContent')
            .waitFor({ state: 'attached', timeout });
        await page.waitForFunction(() => window.AuthService?.isLoggedIn?.() === true, undefined, { timeout });
        console.log(`PASS ${role.name} (${role.route})`);
    } catch (error) {
        await page.screenshot({ path: `${screenshotDir}/${role.name}-failure.png`, fullPage: true }).catch(() => {});
        console.error(`FAIL ${role.name}: ${error.message}`);
        throw error;
    } finally {
        await context.close();
    }
}

async function run() {
    if (process.argv.includes('--help') || process.argv.includes('-h')) {
        printHelp();
        return;
    }

    if (sellerAcceptance) {
        requireCredentials([roles[1]]);
    } else {
        requireCredentials(roles);
    }

    if (!suppliedBaseUrl) {
        server = spawn(process.execPath, ['server.js'], {
            env: { ...process.env, PORT: String(port), NODE_ENV: 'test' },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        server.stderr.on('data', (chunk) => process.stderr.write(`[app] ${chunk}`));
        await waitForServer(baseUrl);
    }

    const browser = await chromium.launch({
        headless: !headed,
        executablePath: getChromiumExecutable(),
    });
    try {
        if (sellerAcceptance) await checkSellerAcceptance(browser, roles[1]);
        else for (const role of roles) await checkRole(browser, role);
    } finally {
        await browser.close();
    }
}

try {
    await run();
} catch (error) {
    console.error(`Authenticated browser checks stopped: ${error.message}`);
    process.exitCode = 1;
} finally {
    if (server) {
        const stopped = waitForExit(server);
        server.kill('SIGTERM');
        await Promise.race([stopped, new Promise((resolve) => setTimeout(resolve, 1000))]);
    }
}