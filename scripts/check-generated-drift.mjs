import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generatedRoots = ['velverahub-ng', 'velverahub-uk', 'velverahub-admin'];
const staticRoots = [...generatedRoots, 'velverahub-shop'];
const productionCheck = process.argv.includes('--production');
let failures = 0;
const sharedFiles = [
    'assets/css/base.css',
    'assets/css/components/hero.css',
    'assets/css/components/home-sections.css',
    'assets/css/components/custom-select.css',
    'assets/css/components/footer.css',
    'assets/js/app.js',
    'assets/js/components/brand-asset.js',
    'assets/js/components/custom-select.js',
    'assets/js/components/product-sharing.js',
    'assets/js/components/site-navigation.js',
    'assets/js/components/ui.js',
    'assets/js/services/domain-routing.js',
    'assets/js/services/products.js',
    'assets/js/services/region.js',
    'assets/js/services/publicSupabaseConfig.js',
    'assets/js/pages/account-page.js',
    'assets/js/pages/account-privacy.js',
    'assets/js/pages/seller-dashboard.js',
    'assets/js/pages/student-listing.js',
    'assets/css/components/seller-updates.css',
    'assets/js/state/store.js'
];

function digest(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

for (const publicRoot of ['velverahub-ng', 'velverahub-uk']) {
    for (const relative of [
        'veeve/product.html',
        'veeve/pages.css',
        'img/logo.png',
        'img/product-placeholder.svg',
        '_redirects',
        '_routes.json',
        'functions/veeve/product.html.js'
    ]) {
        if (!fs.existsSync(path.join(root, publicRoot, relative))) {
            console.error(`DRIFT ${publicRoot}/${relative} is missing`);
            failures++;
        }
    }
    for (const relative of ['_routes.json', 'functions/veeve/product.html.js']) {
        const source = path.join(root, relative);
        const copy = path.join(root, publicRoot, relative);
        if (fs.existsSync(source) && fs.existsSync(copy) && digest(source) !== digest(copy)) {
            console.error(`DRIFT ${publicRoot}/${relative} differs from the shared source`);
            failures++;
        }
    }
    const sellerPage = path.join(root, publicRoot, 'veeve/seller.html');
    if (!fs.existsSync(sellerPage)) {
        console.error(`DRIFT ${publicRoot}/veeve/seller.html is missing`);
        failures++;
    } else {
        const html = fs.readFileSync(sellerPage, 'utf8');
        const expectedDomain = publicRoot === 'velverahub-uk' ? 'velverahub.co.uk' : 'velverahub.com';
        for (const required of [
            'id="dashboardContent"',
            '../assets/css/seller-dashboard.css',
            '../assets/css/components/seller-updates.css',
            '../assets/js/pages/seller-dashboard.js',
            `https://${expectedDomain}/veeve/seller.html`,
        ]) {
            if (!html.includes(required)) {
                console.error(`DRIFT ${publicRoot}/veeve/seller.html is missing ${required}`);
                failures++;
            }
        }
    }
}

for (const publicRoot of ['.', 'velverahub-ng', 'velverahub-uk']) {
    const sellPath = path.join(root, publicRoot, 'veeve/sell.html');
    const accountPath = path.join(root, publicRoot, 'veeve/account.html');
    if (!fs.existsSync(sellPath)) {
        console.error(`DRIFT ${publicRoot}/veeve/sell.html is missing`);
        failures++;
    } else {
        const sellHtml = fs.readFileSync(sellPath, 'utf8');
        if (sellHtml.includes('class="campus-hero"') ||
            sellHtml.includes('Turn things you no longer need into your next win') ||
            sellHtml.includes('Your profile and campus context help nearby shoppers')) {
            console.error(`DRIFT ${publicRoot}/veeve/sell.html still contains the removed campus intro card`);
            failures++;
        }
    }
    if (!fs.existsSync(accountPath)) {
        console.error(`DRIFT ${publicRoot}/veeve/account.html is missing`);
        failures++;
    } else {
        const accountHtml = fs.readFileSync(accountPath, 'utf8');
        if (!accountHtml.includes('id="accountRegion"') ||
            accountHtml.includes('<dd>VelveraHub marketplace</dd>') ||
            !accountHtml.includes('account-page.js')) {
            console.error(`DRIFT ${publicRoot}/veeve/account.html does not load the live account region`);
            failures++;
        }
    }
}

for (const relative of ['veeve/product.html', 'veeve/pages.css', 'img/logo.png', 'img/product-placeholder.svg', '_redirects']) {
    const ngFile = path.join(root, 'velverahub-ng', relative);
    const ukFile = path.join(root, 'velverahub-uk', relative);
    if (fs.existsSync(ngFile) && fs.existsSync(ukFile) && digest(ngFile) !== digest(ukFile)) {
        console.error(`DRIFT regional storefront copies differ: ${relative}`);
        failures++;
    }
}

for (const generatedRoot of generatedRoots) {
    for (const relative of sharedFiles) {
        const source = path.join(root, relative);
        const copy = path.join(root, generatedRoot, relative);
        if (!fs.existsSync(copy)) {
            console.error(`DRIFT ${generatedRoot}/${relative} is missing`);
            failures++;
            continue;
        }
        if (digest(source) !== digest(copy)) {
            console.error(`DRIFT ${generatedRoot}/${relative} differs from the shared source`);
            failures++;
        }
    }
}

for (const appRoot of ['.', ...generatedRoots]) {
    const configPath = path.join(root, appRoot, 'assets/js/config.js');
    if (!fs.existsSync(configPath)) {
        console.error(`DRIFT ${appRoot}/assets/js/config.js is missing`);
        failures++;
        continue;
    }
    if (!fs.readFileSync(configPath, 'utf8').includes('...(window.VELVERAHUB_CONFIG || {})')) {
        console.error(`DRIFT ${appRoot}/assets/js/config.js replaces the public Supabase settings`);
        failures++;
    }
}

const expectedRegions = {
    'velverahub-ng': '"NG"',
    'velverahub-uk': '"UK"',
    'velverahub-admin': '""',
    'velverahub-shop': '""'
};
let sharedPublicSupabaseValues = null;
for (const appRoot of staticRoots) {
    const configPath = path.join(root, appRoot, 'assets/js/config.js');
    if (!fs.existsSync(configPath)) continue;
    const config = fs.readFileSync(configPath, 'utf8');
    if (!config.includes('STATIC_ONLY: true')) {
        console.error(`DRIFT ${appRoot}/assets/js/config.js does not enforce static-only behavior`);
        failures++;
    }
    if (!config.includes(`APP_REGION: ${expectedRegions[appRoot]}`)) {
        console.error(`DRIFT ${appRoot}/assets/js/config.js has the wrong app region`);
        failures++;
    }
}

for (const appRoot of staticRoots) {
    const configPath = path.join(root, appRoot, 'assets/js/config.js');
    const config = fs.readFileSync(configPath, 'utf8');
    const match = config.match(/API_ORIGIN:\s*"([^"]*)"/);
    const origin = match?.[1] || '';
    if (productionCheck && origin) {
        console.error(`PRODUCTION ${appRoot}/assets/js/config.js must leave API_ORIGIN empty for the Supabase-only static deployment`);
        failures++;
    }
    if (productionCheck) {
        const publicConfigPath = path.join(root, appRoot, 'assets/js/services/publicSupabaseConfig.js');
        if (!fs.existsSync(publicConfigPath)) {
            console.error(`PRODUCTION ${appRoot}/assets/js/services/publicSupabaseConfig.js is missing`);
            failures++;
            continue;
        }
        const publicConfig = fs.readFileSync(publicConfigPath, 'utf8');
        const publicUrl = publicConfig.match(/SUPABASE_URL\s*=\s*["']([^"']+)["']/)?.[1] || '';
        const anonKey = publicConfig.match(/SUPABASE_ANON_KEY\s*=\s*["']([^"']+)["']/)?.[1] || '';
        const hasPlaceholder = /YOUR-PROJECT|YOUR_PUBLIC_ANON_KEY/i.test(publicConfig);
        if (!publicUrl || !anonKey || hasPlaceholder) {
            console.error(`PRODUCTION ${appRoot}/assets/js/services/publicSupabaseConfig.js must contain the public Supabase URL and anon key`);
            failures++;
        } else if (sharedPublicSupabaseValues &&
            (publicUrl !== sharedPublicSupabaseValues.url || anonKey !== sharedPublicSupabaseValues.anonKey)) {
            console.error(`PRODUCTION ${appRoot} does not use the same Supabase project configuration as the other static roots`);
            failures++;
        } else if (!sharedPublicSupabaseValues) {
            sharedPublicSupabaseValues = { url: publicUrl, anonKey };
        }
    }
}

if (productionCheck && sharedPublicSupabaseValues) {
    const parentConfigPath = path.join(root, 'assets/js/services/publicSupabaseConfig.js');
    if (!fs.existsSync(parentConfigPath)) {
        console.error('PRODUCTION parent app is missing assets/js/services/publicSupabaseConfig.js');
        failures++;
    } else {
        const parentConfig = fs.readFileSync(parentConfigPath, 'utf8');
        const parentUrl = parentConfig.match(/SUPABASE_URL\s*=\s*["']([^"']+)["']/)?.[1] || '';
        const parentKey = parentConfig.match(/SUPABASE_ANON_KEY\s*=\s*["']([^"']+)["']/)?.[1] || '';
        if (parentUrl !== sharedPublicSupabaseValues.url || parentKey !== sharedPublicSupabaseValues.anonKey) {
            console.error('PRODUCTION parent app does not use the same Supabase project configuration as the four static roots');
            failures++;
        }
    }
}

function findStaticClientFiles(directory, files = []) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            findStaticClientFiles(absolute, files);
        } else if (/\.(?:html|js)$/.test(entry.name)) {
            files.push(absolute);
        }
    }
    return files;
}

for (const appRoot of staticRoots) {
    for (const file of findStaticClientFiles(path.join(root, appRoot))) {
        const source = fs.readFileSync(file, 'utf8');
        if (/(?:fetch|sendBeacon)\(\s*[`'"]\/api\//.test(source)) {
            console.error(`PRODUCTION ${path.relative(root, file)} contains a relative /api request; use the shared API origin helper`);
            failures++;
        }
        if (/postgres(?:ql)?:\/\//i.test(source) || /\b(?:DATABASE_URL|DB_URL)\s*=/i.test(source)) {
            console.error(`PRODUCTION ${path.relative(root, file)} contains a database connection string or URL assignment`);
            failures++;
        }
    }
}

const shopSharedFiles = [
    'assets/css/components/footer.css',
    'assets/css/components/seller-updates.css',
    'assets/js/components/site-navigation.js',
    'assets/js/services/domain-routing.js',
    'assets/js/services/publicSupabaseConfig.js',
    'assets/js/services/supabaseClient.js',
    'assets/js/services/auth.js',
    'assets/js/pages/account-page.js',
    'assets/js/pages/seller-dashboard.js',
    'assets/js/pages/student-listing.js'
];
for (const relative of shopSharedFiles) {
    const source = path.join(root, relative);
    const copy = path.join(root, 'velverahub-shop', relative);
    if (!fs.existsSync(copy)) {
        console.error(`DRIFT velverahub-shop/${relative} is missing`);
        failures++;
    } else if (digest(source) !== digest(copy)) {
        console.error(`DRIFT velverahub-shop/${relative} differs from the shared source`);
        failures++;
    }
}
for (const relative of ['index.html', 'shop.js', 'shop.css', '_headers']) {
    if (!fs.existsSync(path.join(root, 'velverahub-shop', relative))) {
        console.error(`DRIFT velverahub-shop/${relative} is missing`);
        failures++;
    }
}
if (!fs.readFileSync(path.join(root, 'velverahub-shop/index.html'), 'utf8')
    .includes('assets/css/components/seller-updates.css')) {
    console.error('DRIFT velverahub-shop/index.html is missing the shared Listing updates styles');
    failures++;
}

for (const [file, required] of [
    ['shop-owner/index.html', 'href="../../assets/css/components/footer.css"'],
    ['shop-owner/index.html', 'data-shared-footer-placeholder'],
    ['shop-owner/index.html', '../../assets/js/components/site-navigation.js'],
    ['velverahub-shop/index.html', 'href="assets/css/components/footer.css"'],
    ['velverahub-shop/index.html', 'data-shared-footer-placeholder'],
    ['velverahub-shop/index.html', 'src="assets/js/components/site-navigation.js"'],
    ['assets/js/components/site-navigation.js', "domains.currentSurface() === 'shop'"],
]) {
    const filePath = path.join(root, file);
    if (!fs.existsSync(filePath) || !fs.readFileSync(filePath, 'utf8').includes(required)) {
        console.error(`DRIFT ${file} is missing ${required}`);
        failures++;
    }
}

for (const [source, output] of [
    ['shop-owner/dashboard.js', 'velverahub-shop/shop.js'],
    ['seller-workspace/dashboard.css', 'velverahub-shop/shop.css'],
    ['admin-workspace/admin.js', 'velverahub-admin/admin.js'],
    ['admin-workspace/admin.css', 'velverahub-admin/admin.css'],
]) {
    if (!fs.existsSync(path.join(root, output))) continue;
    if (!fs.existsSync(path.join(root, source)) || digest(path.join(root, source)) !== digest(path.join(root, output))) {
        console.error(`DRIFT ${output} differs from ${source}`);
        failures++;
    }
}

for (const appRoot of ['velverahub-admin', 'velverahub-shop']) {
    if (fs.existsSync(path.join(root, appRoot, 'functions')) ||
        fs.existsSync(path.join(root, appRoot, '_routes.json'))) {
        console.error(`DRIFT ${appRoot} must not receive the storefront product metadata Function`);
        failures++;
    }
}

if (fs.existsSync(path.join(root, 'dashboards'))) {
    console.error('DRIFT the legacy dashboards/ source directory still exists');
    failures++;
}

for (const [source, required] of [
    ['seller-workspace/index.html', 'id="dashboardContent"'],
    ['seller-workspace/dashboard.css', '.dashboard-container'],
    ['seller-workspace/index.html', 'id="productDeliveryPickup"'],
    ['seller-workspace/index.html', 'id="promoteCurrentProduct"'],
    ['shop-owner/index.html', '<title>Shop Owner Portal - VelveraHub</title>'],
    ['shop-owner/index.html', 'id="productDeliveryPickup"'],
    ['shop-owner/index.html', 'id="promoteCurrentProduct"'],
    ['shop-owner/dashboard.js', 'DOMContentLoaded'],
    ['shop-owner/dashboard.js', 'await scopeSellerProducts('],
    ['assets/js/services/domain-routing.js', 'function productUrl(productId, region)'],
    ['veeve/product.html', 'id="shareProductButton"'],
    ['veeve/product.html', 'setProductMetadata'],
    ['veeve/product.html', 'product-delivery-panel'],
    ['database/product-delivery-options.sql', 'products_delivery_options_shape'],
    ['docs/cloudflare-pages.md', 'drag-and-drop upload does not compile Pages Functions'],
    ['shop-owner/dashboard.js', 'id="surfaceRegisterForm"'],
    ['shop-owner/index.html', 'id="shopVerificationForm"'],
    ['shop-owner/dashboard.js', 'shop_owner_submit_verification_documents'],
    ['admin-workspace/index.html', 'id="adminWorkspace"'],
    ['admin-workspace/admin.js', 'admin_review_shop_verification'],
    ['database/shop-verification-compliance.sql', 'shop_verification_reviews'],
]) {
    const sourcePath = path.join(root, source);
    if (!fs.existsSync(sourcePath) || !fs.readFileSync(sourcePath, 'utf8').includes(required)) {
        console.error(`DRIFT canonical source ${source} is missing or invalid`);
        failures++;
    }
}

const syntaxExcludedDirectories = new Set([
    '.agents', '.git', '.local', 'node_modules', 'attached_assets',
    'coverage', '.wrangler'
]);
function findJavaScriptFiles(directory, files = []) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory() && syntaxExcludedDirectories.has(entry.name)) continue;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            findJavaScriptFiles(absolute, files);
        } else if (/\.(?:cjs|js|mjs)$/.test(entry.name)) {
            files.push(absolute);
        }
    }
    return files;
}

let syntaxFailures = 0;
for (const file of findJavaScriptFiles(root)) {
    try {
        const source = fs.readFileSync(file, 'utf8');
        const isPagesFunction = /(?:^|[\\/])functions[\\/]veeve[\\/]product\.html\.js$/.test(path.relative(root, file));
        execFileSync(
            process.execPath,
            isPagesFunction ? ['--input-type=module', '--check'] : ['--check', file],
            {
                cwd: root,
                input: isPagesFunction ? source : undefined,
                stdio: 'pipe'
            }
        );
    } catch (error) {
        const detail = String(error.stderr || error.stdout || error.message).trim().split('\n').slice(0, 3).join('\n');
        console.error(`SYNTAX ${path.relative(root, file)} failed Node's parser check\n${detail}`);
        syntaxFailures++;
    }
}
if (syntaxFailures) {
    failures += syntaxFailures;
} else {
    console.log('JavaScript syntax check passed for project and generated app files.');
}

if (failures) {
    console.error(`Generated app drift check failed with ${failures} mismatch(es). Run npm run apps:sync and review the changes.`);
    process.exitCode = 1;
} else {
    console.log(`Static Pages drift check passed for ${staticRoots.length} app roots and their seller workspace sources.`);
}