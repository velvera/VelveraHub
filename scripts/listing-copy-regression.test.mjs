import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const roots = [
    '',
    'velverahub-ng/',
    'velverahub-uk/',
    'velverahub-shop/',
    'velverahub-admin/',
];
const storefrontRoots = roots.slice(0, 3);
const forbiddenPublicLabels =
    /student\s+(?:seller|listing|shop)|independent seller|private conversation|view more products|velverahub marketplace seller/i;

for (const root of storefrontRoots) {
    for (const page of ['index.html', 'veeve/products.html', 'veeve/product.html', 'veeve/sell.html', 'veeve/my-listings.html', 'veeve/auth.html', 'veeve/seller.html']) {
        const source = read(`${root}${page}`);
        assert.doesNotMatch(source, forbiddenPublicLabels, `${root || 'root'} ${page} must use general marketplace copy`);
    }

    const product = read(`${root}veeve/product.html`);
    const css = read(`${root}veeve/pages.css`);
    const gallery = product.match(/<section class="product-gallery"[\s\S]*?<\/section>/)?.[0];
    const actions = product.match(/<div class="product-action-row">([\s\S]*?)<\/div>/)?.[1];
    assert.ok(gallery, `${root || 'root'} product page must have a media gallery`);
    assert.match(gallery, /<button class="product-share-button"[^>]*aria-label="Share product link"[^>]*><i[^>]*><\/i><\/button>/);
    assert.match(css, /\.product-share-button\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?top:\s*\.75rem;[\s\S]*?right:\s*\.75rem;/);
    assert.ok(actions, `${root || 'root'} product page must have purchase actions`);
    assert.match(actions, /id="addToCart"/);
    assert.match(actions, /class="btn btn-secondary product-save-button"[^>]*aria-label="Save product"[^>]*><i[^>]*><\/i><\/button>/);
    assert.doesNotMatch(actions, />\s*Save\s*</i);
    assert.doesNotMatch(product, /listing_type|Listing type|Private conversation|Independent seller|View more products/i);
    assert.match(product, />View more<\/a>/);
}

for (const root of roots) {
    for (const file of [
        'assets/js/components/ui.js',
        'assets/js/services/products.js',
        'assets/js/pages/seller-dashboard.js',
        'assets/js/pages/student-listing.js',
        'assets/js/pages/auth-page.js',
        'assets/js/services/auth.js',
    ]) {
        const source = read(`${root}${file}`);
        assert.doesNotMatch(source, /listing_type|student_item|student_ad|Student seller|businessInstitution/);
    }
    const listingScript = read(`${root}assets/js/pages/student-listing.js`);
    const marketplaceCss = read(`${root}assets/css/components/campus-marketplace.css`);
    assert.doesNotMatch(listingScript, /Ready to upload|Cancel uploads|Current limit:|listingMediaLimitHelp/);
    assert.match(listingScript, /removeButton\.className = 'campus-media-remove'/);
    assert.match(listingScript, /removeButton\.addEventListener\('click', \(\) => removeSelectedMedia\(index\)\)/);
    assert.match(listingScript, /submission\.removedIndices\.add\(index\)/);
    assert.match(listingScript, /row\.task\?\.cancel\(\)/);
    assert.match(marketplaceCss, /\.campus-media-remove\s*\{[\s\S]*?color:\s*#b42318;/);
    for (const file of [
        'assets/css/components/products.css',
        'assets/css/components/campus-marketplace.css',
    ]) {
        const source = read(`${root}${file}`);
        assert.doesNotMatch(source, /\.seller-type|\.product-shop\.student-seller/, `${root || 'root'} ${file} removes seller-type styling`);
    }
}

for (const root of storefrontRoots) {
    const sell = read(`${root}veeve/sell.html`);
    const sellerWorkspace = read(`${root}veeve/seller.html`);
    assert.match(sell, /<label for="listingImages">Photos and videos<\/label>/);
    assert.match(sell, /Never share passwords or payment details in a listing\./);
    assert.doesNotMatch(sell, /count set by administrator|Current limit:|compressed photos up to|Original photos may be up to|Your seller name and avatar come from your account/);
    for (const [source, label] of [[sell, 'sell form'], [sellerWorkspace, 'seller workspace']]) {
        assert.match(
            source,
            /Institution(?:\s*<span[^>]*>\(optional location\)<\/span>|\s+\(optional location\))/,
            `${root || 'root'} ${label} keeps institution as optional location`,
        );
        assert.match(source, /Nearby area/, `${root || 'root'} ${label} keeps nearby location details`);
    }
}

for (const root of ['admin-workspace/', 'velverahub-admin/']) {
    const adminPage = read(`${root}index.html`);
    const adminScript = read(`${root}admin.js`);
    assert.match(adminPage, /id="productMediaLimit"/);
    assert.doesNotMatch(adminPage, /student_listing_media_limit|independentListingMediaLimit|shopProductImageLimit/);
    assert.doesNotMatch(adminScript, /student_listing_media_limit|p_student_listing_media_limit/);
}

for (const root of storefrontRoots) {
    const css = read(`${root}veeve/pages.css`);
    const product = read(`${root}veeve/product.html`);
    assert.match(css, /\.related-products-section\s*\{[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0;/);
    assert.match(css, /\.related-products-grid\s*\{[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0;[\s\S]*?grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*16rem\),\s*1fr\)\)/);
    assert.match(css, /\.related-products-grid \.product-card\s*\{[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0;/);
    assert.match(css, /@media \(max-width:\s*480px\)[\s\S]*?\.related-products-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    assert.match(product, /href="pages\.css\?v=20261125-1"/);
}

assert.match(read('server.js'), /const LOCAL_ASSET_VERSION = '20261125-1'/);
assert.match(read('docs/listing-copy-audit.md'), /Root[\s\S]*Nigeria[\s\S]*UK[\s\S]*Shop owner[\s\S]*Admin/);
console.log('PASS general listing copy, optional institution context, icon-only product actions, and shared media controls');
