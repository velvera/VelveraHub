import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function ensureDir(directory) {
    fs.mkdirSync(directory, { recursive: true });
}

function copy(source, destination) {
    ensureDir(path.dirname(destination));
    fs.copyFileSync(source, destination);
}

function copyDirectory(source, destination) {
    fs.cpSync(source, destination, { recursive: true });
}

function copyStaticBrandIcons(destination) {
    copy(path.join(root, 'img/favicon.ico'), path.join(destination, 'favicon.ico'));
    copy(path.join(root, 'img/apple-touch-icon.png'), path.join(destination, 'apple-touch-icon.png'));
}

function write(file, content) {
    ensureDir(path.dirname(file));
    fs.writeFileSync(file, content);
}

const SECURITY_HEADERS = `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(self), payment=()
  X-Frame-Options: DENY
  Cross-Origin-Opener-Policy: same-origin-allow-popups
  Cross-Origin-Resource-Policy: same-site
  Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self' https:; img-src 'self' data: blob: https:; font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; connect-src 'self' https: wss:; media-src 'self' blob: https:; manifest-src 'self'; worker-src 'self' blob:; upgrade-insecure-requests
`;

function writeSecurityHeaders(destination, noindex = false) {
    write(path.join(destination, '_headers'), `${SECURITY_HEADERS}${noindex ? '  X-Robots-Tag: noindex, nofollow\n' : ''}`);
}

function assertNew(directory) {
    if (fs.existsSync(directory)) {
        if (process.argv.includes('--refresh')) {
            fs.rmSync(directory, { recursive: true, force: true });
            return;
        }
        // --sync overlays generated files without removing unique assets.
        if (process.argv.includes('--sync')) return;
        throw new Error(`Refusing to overwrite existing application directory: ${directory}`);
    }
}

function injectMetadata(html, values) {
    const robots = values.type === 'public' ? 'index,follow' : 'noindex,nofollow';
    html = html
        .replaceAll('href="/img/favicon.ico"', 'href="/favicon.ico"')
        .replaceAll('href="img/favicon.ico"', 'href="/favicon.ico"');
    const tags = [
        `    <link rel="canonical" href="${values.siteUrl}">`,
        `    <meta name="robots" content="${robots}">`,
        html.includes('rel="icon"') ? '' : '    <link rel="icon" href="/favicon.ico" type="image/x-icon">',
        html.includes('rel="manifest"') ? '' : '    <link rel="manifest" href="/manifest.webmanifest">',
        html.includes('rel="apple-touch-icon"') ? '' : '    <link rel="apple-touch-icon" href="/apple-touch-icon.png">',
        `    <meta property="og:url" content="${values.siteUrl}">`,
        '    <meta property="og:site_name" content="VelveraHub">'
    ].filter(Boolean).join('\n');
    return html.replace('</head>', `${tags}\n</head>`);
}

function copySharedFrontend(destination) {
    copyDirectory(path.join(root, 'assets'), path.join(destination, 'assets'));
    copyDirectory(path.join(root, 'img'), path.join(destination, 'img'));
    copy(path.join(root, 'manifest.webmanifest'), path.join(destination, 'manifest.webmanifest'));
    copyStaticBrandIcons(destination);
}

function copyProductMetadataFunction(destination) {
    const functionSource = path.join(root, 'functions/veeve/product.html.js');
    const functionTarget = path.join(destination, 'functions/veeve/product.html.js');
    if (path.resolve(functionSource) !== path.resolve(functionTarget)) {
        copy(functionSource, functionTarget);
    }
    write(path.join(destination, '_routes.json'), `${JSON.stringify({
        version: 1,
        include: ['/veeve/product.html'],
        exclude: []
    }, null, 2)}\n`);
}

function copySellerWorkspace(destination) {
    const source = path.join(root, 'seller-workspace');
    const page = path.join(destination, 'veeve', 'seller.html');
    copy(path.join(source, 'index.html'), page);
    copy(path.join(source, 'dashboard.css'), path.join(destination, 'assets/css/seller-dashboard.css'));
    // The seller portal is the shared dashboard implementation for both the
    // shop-owner shell and the seller-facing storefront workspace.
    const dashboardSource = fs.existsSync(path.join(source, 'dashboard.js'))
        ? path.join(source, 'dashboard.js')
        : path.join(root, 'shop-owner/dashboard.js');
    copy(dashboardSource, path.join(destination, 'assets/js/pages/seller-dashboard.js'));

    let html = fs.readFileSync(page, 'utf8')
        .replaceAll('../../assets/', '../assets/')
        .replaceAll('../../img/', '../img/')
        .replace('href="dashboard.css"', 'href="../assets/css/seller-dashboard.css"')
        .replace('src="dashboard.js"', 'src="../assets/js/pages/seller-dashboard.js"')
        .replace(/<link rel="canonical"[^>]*>\s*/g, '')
        .replace(/<meta name="robots"[^>]*>\s*/g, '')
        .replace('<title>Shop Owner Dashboard - VelveraHub</title>', '<title>Seller Workspace - VelveraHub</title>')
        .replace('<body data-support-audience="shop-owner">', '<body data-support-audience="seller">');
    html = injectMetadata(html, {
        type: 'seller',
        siteUrl: valuesForPublicSellerPage(destination)
    });
    html = html.replaceAll('href="/pages/', 'href="/veeve/');
    write(page, html);
}

function prepareShopApp() {
    const destination = path.join(root, 'velverahub-shop');
    assertNew(destination);
    ensureDir(destination);
    copySharedFrontend(destination);
    writeAppConfig(destination, {
        type: 'shop-owner',
        region: '',
        siteUrl: 'https://velverahub.shop',
        staticOnly: true,
    });

    const source = path.join(root, 'shop-owner');
    const entry = path.join(destination, 'index.html');
    copy(path.join(root, 'seller-workspace/dashboard.css'), path.join(destination, 'shop.css'));
    copy(path.join(source, 'dashboard.js'), path.join(destination, 'shop.js'));

    let html = fs.readFileSync(path.join(source, 'index.html'), 'utf8')
        .replace(/^\s*<meta http-equiv="refresh"[^>]*>\s*/mi, '')
        .replace(/<script>\s*const marketplaceHosts[\s\S]*?window\.location\.replace\(portalUrl\);\s*<\/script>\s*/i, '')
        .replaceAll('../../assets/', 'assets/')
        .replaceAll('../../img/', 'img/')
        .replace('href="dashboard.css"', 'href="shop.css"')
        .replace('src="dashboard.js"', 'src="shop.js"')
        .replace('<title>Seller Workspace - VelveraHub</title>', '<title>Shop Owner Portal - VelveraHub</title>')
        .replace(
            '<script src="assets/js/config.js"></script>',
            '<script src="assets/js/config.js"></script>\n    <script src="assets/js/services/domain-routing.js"></script>'
        )
        .replace(/<link rel="canonical"[^>]*>\s*/g, '')
        .replace(/<meta name="robots"[^>]*>\s*/g, '');
    html = injectMetadata(html, {
        type: 'shop-owner',
        siteUrl: 'https://velverahub.shop/',
    });
    write(entry, html);
    writeSecurityHeaders(destination, true);
}

function ensurePageClientConfiguration(html) {
    let result = html;
    if (!result.includes('rel="icon"')) {
        result = result.replace(
            '</head>',
            '    <link rel="icon" href="../img/favicon.ico">\n</head>'
        );
    }
    if (!result.includes('rel="apple-touch-icon"')) {
        result = result.replace(
            '</head>',
            '    <link rel="apple-touch-icon" href="../img/apple-touch-icon.png">\n</head>'
        );
    }
    if (!result.includes('rel="manifest"')) {
        result = result.replace(
            '</head>',
            '    <link rel="manifest" href="../manifest.webmanifest">\n</head>'
        );
    }
    if (!result.includes('../assets/js/services/publicSupabaseConfig.js')) {
        result = result.replace(
            '<script src="../assets/js/services/supabaseClient.js"></script>',
            '<script src="../assets/js/services/publicSupabaseConfig.js"></script>'
        );
    }
    if (!result.includes('../assets/js/config.js')) {
        result = result.replace(
            '<script src="../assets/js/services/supabaseClient.js"></script>',
            '<script src="../assets/js/config.js"></script>'
        );
    }
    if (!result.includes('../assets/js/services/api.js')) {
        result = result.replace(
            '<script src="../assets/js/config.js"></script>',
            '<script src="../assets/js/config.js"></script>\n<script src="../assets/js/services/api.js"></script>'
        );
    }
    if (!result.includes('../assets/js/components/focus-manager.js')) {
        result = result.replace(
            '<script src="../assets/js/components/site-navigation.js"></script>',
            '<script src="../assets/js/components/focus-manager.js"></script>\n<script src="../assets/js/components/site-navigation.js"></script>'
        );
    }
    if (!result.includes('../assets/js/services/observability.js')) {
        result = result.replace(
            '<script src="../assets/js/services/supabaseClient.js"></script>',
            '<script src="../assets/js/services/observability.js"></script>\n<script src="../assets/js/services/supabaseClient.js"></script>'
        );
    }
    return result;
}

function valuesForPublicSellerPage(destination) {
    return destination.endsWith('velverahub-uk')
        ? 'https://velverahub.co.uk/veeve/seller.html'
        : 'https://velverahub.com/veeve/seller.html';
}

function writeAppConfig(destination, values) {
    const apiOrigin = values.staticOnly ? '' : (values.apiOrigin || '');
    write(path.join(destination, 'assets/js/config.js'), `window.VELVERAHUB_CONFIG = {
    ...(window.VELVERAHUB_CONFIG || {}),
    APP_TYPE: ${JSON.stringify(values.type)},
    APP_REGION: ${JSON.stringify(values.region || '')},
    SITE_URL: ${JSON.stringify(values.siteUrl)},
    API_ORIGIN: ${JSON.stringify(apiOrigin)},
    STATIC_ONLY: ${Boolean(values.staticOnly)}
};
`);
}

function preparePublicApp(name, values) {
    const destination = path.join(root, name);
    assertNew(destination);
    ensureDir(destination);
    copy(path.join(root, 'index.html'), path.join(destination, 'index.html'));
    copyDirectory(path.join(root, 'veeve'), path.join(destination, 'veeve'));
    copySharedFrontend(destination);
    copyProductMetadataFunction(destination);
    writeAppConfig(destination, values);
    copySellerWorkspace(destination);
    writeSecurityHeaders(destination);

    const entry = path.join(destination, 'index.html');
    let html = fs.readFileSync(entry, 'utf8');
    html = html.replace(
        '<script src="assets/js/services/publicSupabaseConfig.js"></script>',
        '<script src="assets/js/services/publicSupabaseConfig.js"></script>\n        <script src="assets/js/config.js"></script>'
    );
    write(entry, injectMetadata(html, values));
    for (const page of fs.readdirSync(path.join(destination, 'veeve')).filter((file) => file.endsWith('.html'))) {
        const pagePath = path.join(destination, 'veeve', page);
        let pageHtml = fs.readFileSync(pagePath, 'utf8');
        pageHtml = pageHtml
            .replaceAll('../logo.png', '../img/logo.png')
            .replaceAll('../header-logo.png', '../img/logo.png')
            .replaceAll('href="/pages/', 'href="/veeve/');
        pageHtml = ensurePageClientConfiguration(pageHtml);
        write(pagePath, pageHtml);
    }
    let publicHtml = fs.readFileSync(entry, 'utf8').replaceAll('href="/pages/', 'href="/veeve/');
    write(entry, publicHtml);
    write(path.join(destination, '_redirects'), '/pages/* /veeve/:splat 301\n/pages /veeve/ 301\n');
}

function prepareDashboardApp(name, values, dashboard) {
    const destination = path.join(root, name);
    assertNew(destination);
    ensureDir(destination);
    copySharedFrontend(destination);
    writeAppConfig(destination, values);

    const sourceDashboard = path.join(root, `${dashboard}-workspace`);
    copy(path.join(sourceDashboard, 'index.html'), path.join(destination, 'index.html'));
    copy(path.join(sourceDashboard, `${dashboard === 'admin' ? 'admin' : 'dashboard'}.css`), path.join(destination, `${dashboard === 'admin' ? 'admin' : 'dashboard'}.css`));
    copy(path.join(sourceDashboard, `${dashboard === 'admin' ? 'admin' : 'dashboard'}.js`), path.join(destination, `${dashboard === 'admin' ? 'admin' : 'dashboard'}.js`));
    if (dashboard === 'admin') {
        copy(path.join(root, 'seller-workspace/dashboard.css'), path.join(destination, 'shop-owner/dashboard.css'));
    }

    const entry = path.join(destination, 'index.html');
    let html = fs.readFileSync(entry, 'utf8')
        .replaceAll('../../assets/', 'assets/')
        .replaceAll('../../img/', 'img/')
        .replaceAll('../shop-owner/dashboard.css', 'shop-owner/dashboard.css')
        .replace(
            '<script src="assets/js/services/publicSupabaseConfig.js"></script>',
            '<script src="assets/js/services/publicSupabaseConfig.js"></script>\n    <script src="assets/js/config.js"></script>'
        );
    write(entry, injectMetadata(html, values));
    if (values.type === 'seller') {
        copy(path.join(root, 'database/seller.sql'), path.join(destination, 'database/seller.sql'));
    } else {
        // Admin is static too; its review operations use role-checked
        // Supabase RPCs rather than a separate API host or Pages Function.
    }
    writeSecurityHeaders(destination, true);
}

preparePublicApp('velverahub-ng', {
    type: 'public',
    region: 'NG',
    siteUrl: 'https://velverahub.com',
    staticOnly: true,
});
preparePublicApp('velverahub-uk', {
    type: 'public',
    region: 'UK',
    siteUrl: 'https://velverahub.co.uk',
    staticOnly: true,
});
writeAppConfig(root, {
    type: 'public',
    siteUrl: 'http://localhost:5000',
});
copyProductMetadataFunction(root);
copySellerWorkspace(root);
// Some deployments keep the admin dashboard as a generated artifact only.
// Do not make refreshing the public storefronts fail when that optional source
// dashboard is not present in the checkout.
if (fs.existsSync(path.join(root, 'admin-workspace/index.html'))) {
    prepareDashboardApp('velverahub-admin', {
        type: 'admin',
        siteUrl: 'https://velverahub.org',
        staticOnly: true,
    }, 'admin');
} else {
    console.warn('Skipping optional admin app refresh: admin-workspace/index.html is not present.');
    // Keep the previously generated optional admin shell's shared assets in
    // sync even when its source dashboard is not part of this checkout.
    if (fs.existsSync(path.join(root, 'velverahub-admin'))) {
        copySharedFrontend(path.join(root, 'velverahub-admin'));
        writeAppConfig(path.join(root, 'velverahub-admin'), {
            type: 'admin',
            siteUrl: 'https://velverahub.org',
            staticOnly: true,
        });
    }
}

prepareShopApp();

copyStaticBrandIcons(root);
write(path.join(root, '_redirects'), '/pages/* /veeve/:splat 301\n/pages /veeve/ 301\n');
writeSecurityHeaders(root);

console.log(process.argv.includes('--sync')
    ? 'Synced the static storefronts, admin, and shop-owner Pages roots without deleting unique files.'
    : 'Created the static storefront, admin, and shop-owner Pages roots.');