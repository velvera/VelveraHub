import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import vm from 'node:vm';
import { chromium } from 'playwright';

const read = (path) => fs.readFileSync(path, 'utf8');
function testCartPreservesItemsWhenAvailabilityCannotBeVerified() {
    const cart = [{ product: { id: 'product-1', title: 'Test item', price: 20, stock: 3 }, quantity: 1, currency: 'NGN' }];
    const storage = new Map([['velverahub_cart', JSON.stringify(cart)]]);
    const localStorage = {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: (key) => storage.delete(key)
    };
    const window = {
        RegionService: { region: 'ng', currency: { code: 'NGN' } },
        ProductsService: { getProduct: async () => ({ data: null, error: new Error('Temporary network failure') }) },
        dispatchEvent: () => {},
        AsyncFeedback: { createRequestId: () => 'cart-test', log: () => {} }
    };
    const context = vm.createContext({
        window,
        document: { getElementById: () => null },
        localStorage,
        CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
        Date,
        JSON,
        Number,
        Math
    });
    vm.runInContext(read('assets/js/services/cart.js'), context);
    window.CartService.init();

    return window.CartService.revalidate().then((result) => {
        assert.equal(result.corrections[0]?.type, 'verification');
        assert.equal(result.cart.length, 1, 'temporary product lookup failure must not remove a cart item');
        assert.equal(window.CartService.getItemCount(), 1);
        console.log('PASS cart keeps items when product verification temporarily fails');
    });
}

async function testCartDoesNotTrustCachedAvailability() {
    const product = {
        id: 'stale-product-id',
        title: 'Cached listing',
        price: 20,
        stock: 3
    };
    const createStorage = (initial = {}) => {
        const values = new Map(Object.entries(initial));
        return {
            getItem: (key) => values.get(key) ?? null,
            setItem: (key, value) => values.set(key, String(value)),
            removeItem: (key) => values.delete(key)
        };
    };
    const localStorage = createStorage({
        velverahub_cart: JSON.stringify([{ product, quantity: 1, currency: 'NGN' }])
    });
    const sessionStorage = createStorage();
    const query = {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() { return { data: null, error: null }; }
    };
    const window = {
        VELVERAHUB_CONFIG: { STATIC_ONLY: true },
        SupabaseClient: { isConfigured: () => true, get: () => ({ from: () => query }) },
        RegionService: { region: 'ng', currency: { code: 'NGN' } },
        dispatchEvent: () => {}
    };
    const context = vm.createContext({
        window,
        document: { getElementById: () => null },
        localStorage,
        sessionStorage,
        CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
        decodeURIComponent,
        Date,
        JSON,
        Number,
        Math,
        String,
        Promise
    });
    vm.runInContext(read('assets/js/services/products.js'), context);
    vm.runInContext(read('assets/js/services/cart.js'), context);
    window.ProductsService.rememberProducts([product]);
    window.CartService.init();

    const result = await window.CartService.revalidate();
    assert.equal(result.cart.length, 0, 'a cached listing absent from the live catalogue must not pass checkout revalidation');
    assert.equal(result.corrections[0]?.type, 'unavailable');
    assert.equal((await window.ProductsService.getProduct(product.id)).data?.id, product.id, 'cached product details can still render outside checkout');
    console.log('PASS checkout revalidation rejects cached listings absent from live inventory');
}

async function openCheckout(browser, { rpcResult, failOrder = false }) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const product = {
        id: '49b0aef1-8052-4f6c-93ac-25b4375f1e20',
        title: 'Checkout regression item',
        price: 20,
        stock: 5,
        product_images: [],
        shops: {}
    };
    await page.addInitScript((item) => {
        if (location.pathname.endsWith('/checkout.html')) {
            localStorage.setItem('velverahub_cart', JSON.stringify([item]));
        }
    }, { product, quantity: 1, currency: 'NGN' });

    await page.goto('http://127.0.0.1:5000/veeve/checkout.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.CartService && window.ProductsService && document.getElementById('placeOrderBtn')));
    await page.evaluate(({ product, rpcResult, failOrder }) => {
        const cartItem = { product, quantity: 1, currency: window.RegionService?.currency?.code || 'NGN' };
        window.CartService.cart = [cartItem];
        localStorage.setItem('velverahub_cart', JSON.stringify([cartItem]));
        window.ProductsService.getProduct = async () => ({ data: product, error: null });
        window.ProductsService.matchesLocation = () => true;
        window.SupabaseClient.get = () => ({
            rpc: async (name, payload) => {
                sessionStorage.setItem('checkout-regression-rpc-name', name);
                sessionStorage.setItem('checkout-regression-rpc-payload', JSON.stringify(payload));
                return failOrder
                    ? { data: null, error: { message: 'PGRST202: function public.place_order_secure was not found' } }
                    : { data: rpcResult, error: null };
            }
        });
    }, { product, rpcResult, failOrder });
    return page;
}

async function testCheckout(browser) {
    const successPage = await openCheckout(browser, {
        rpcResult: {
            success: true,
            orderId: 'bbba6360-a22a-4647-8bc1-95cda070b65d',
            orderNumber: 'VH-TEST-ORDER'
        }
    });
    for (const [selector, value] of [
        ['#email', 'buyer@example.test'],
        ['#firstName', 'Test'],
        ['#lastName', 'Buyer'],
        ['#address', '12 Test Street'],
        ['#city', 'Lagos']
    ]) {
        await successPage.locator(selector).fill(value);
    }
    await successPage.locator('#checkoutPolicyConsent').check();
    await successPage.locator('#placeOrderBtn').click();
    await successPage.waitForURL((url) => url.pathname.includes('success.html'), { timeout: 10000 });
    assert.match(successPage.url(), /order=VH-TEST-ORDER/);
    assert.deepEqual(await successPage.evaluate(() => JSON.parse(localStorage.getItem('velverahub_cart') || '[]')), []);
    assert.equal(await successPage.evaluate(() => sessionStorage.getItem('checkout-regression-rpc-name')), 'place_order_secure');
    console.log('PASS checkout creates a confirmed order request and redirects only after a valid response');
    await successPage.close();

    const failurePage = await openCheckout(browser, { failOrder: true });
    for (const [selector, value] of [
        ['#email', 'buyer@example.test'],
        ['#firstName', 'Test'],
        ['#lastName', 'Buyer'],
        ['#address', '12 Test Street'],
        ['#city', 'Lagos']
    ]) {
        await failurePage.locator(selector).fill(value);
    }
    await failurePage.locator('#checkoutPolicyConsent').check();
    await failurePage.locator('#placeOrderBtn').click();
    await failurePage.locator('#checkoutStatus').getByText('Secure order processing is not available right now').waitFor();
    assert.equal(await failurePage.evaluate(() => JSON.parse(localStorage.getItem('velverahub_cart') || '[]').length), 1);
    console.log('PASS failed checkout explains the issue and preserves the cart');
    await failurePage.close();
}

async function testResponsiveAndGeneratedCopies() {
    const productPaths = ['veeve/product.html', 'velverahub-ng/veeve/product.html', 'velverahub-uk/veeve/product.html'];
    const pagePaths = ['veeve/pages.css', 'velverahub-ng/veeve/pages.css', 'velverahub-uk/veeve/pages.css'];
    const cartPaths = ['veeve/cart.html', 'velverahub-ng/veeve/cart.html', 'velverahub-uk/veeve/cart.html'];

    for (const path of productPaths) {
        const html = read(path);
        assert.ok(html.indexOf('id="saveProduct"') < html.indexOf('id="addToCart"'), `${path}: save button must precede add to cart`);
        for (const removedCopy of ['Secure marketplace checkout', 'Delivery arranged with seller', 'Seller details shown clearly']) {
            assert.ok(!html.includes(removedCopy), `${path}: removed product trust label remains`);
        }
        assert.ok(!html.includes('<p class="eyebrow">${esc(product.category'), `${path}: category must not appear above the product title`);
    }
    for (const path of pagePaths) {
        const css = read(path);
        assert.match(css, /\.related-products-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4,/s, `${path}: desktop cards`);
        assert.match(css, /\.related-products-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,/s, `${path}: tablet cards`);
        assert.match(css, /\.related-products-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s, `${path}: mobile cards`);
        assert.ok(!css.includes('A single full-width card'), `${path}: old single-card mobile rule remains`);
    }
    for (const path of cartPaths) {
        const html = read(path);
        assert.match(html, /\.cart-page-item-actions\s*\{[^}]*justify-content:flex-end/s, `${path}: cart controls align right`);
        assert.match(html, /\.cart-page-remove\s*\{[^}]*color:#b42318/s, `${path}: remove control must be red`);
    }
    for (const path of [
        'assets/css/seller-dashboard.css',
        'velverahub-ng/assets/css/seller-dashboard.css',
        'velverahub-uk/assets/css/seller-dashboard.css',
        'velverahub-shop/assets/css/seller-dashboard.css',
        'velverahub-admin/assets/css/seller-dashboard.css'
    ]) {
        assert.ok(read(path).includes('button.icon-btn[onclick^="deleteProduct"]'), `${path}: seller delete buttons must be red`);
    }
    console.log('PASS product, cart, and related-card changes cover root, NG, and UK apps');
}

await testCartPreservesItemsWhenAvailabilityCannotBeVerified();
await testCartDoesNotTrustCachedAvailability();
await testResponsiveAndGeneratedCopies();
const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || execFileSync('which', ['chromium'], { encoding: 'utf8' }).trim(),
    args: ['--no-sandbox']
});
try {
    await testCheckout(browser);
} finally {
    await browser.close();
}
