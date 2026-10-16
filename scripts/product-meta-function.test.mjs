import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const functionPath = new URL('../functions/veeve/product.html.js', import.meta.url);
const source = fs.readFileSync(functionPath, 'utf8');
const { onRequest } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const productId = '123e4567-e89b-42d3-a456-426614174000';
const supabaseUrl = 'https://catalogue.example.supabase.co';
const anonKey = 'test-public-anon-key';
const originalFetch = globalThis.fetch;
const staticHtml = '<!doctype html><html><head><title>VelveraHub Product</title><meta name="description" content="Browse products"><meta property="og:type" content="website"><meta property="og:title" content="VelveraHub"><link rel="canonical" href="https://velverahub.com/veeve/product.html"></head><body><main id="productDetail">Listing</main></body></html>';

function createContext(url, { method = 'GET', productRows = null, fetchError = false } = {}) {
    const calls = [];
    const assetConfig = `const SUPABASE_URL = "${supabaseUrl}";\nconst SUPABASE_ANON_KEY = "${anonKey}";`;
    const staticResponse = () => new Response(staticHtml, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' }
    });
    const context = {
        request: new Request(url, { method }),
        env: {
            ASSETS: {
                fetch: async (assetUrl) => {
                    assert.equal(new URL(assetUrl).pathname, '/assets/js/services/publicSupabaseConfig.js');
                    return new Response(assetConfig, { status: 200 });
                }
            }
        },
        next: async () => staticResponse()
    };

    globalThis.fetch = async (input, init) => {
        const requestUrl = new URL(input);
        calls.push({ url: requestUrl, init });
        if (fetchError) throw new Error('simulated public catalogue outage');
        if (requestUrl.pathname.endsWith('/rest/v1/products')) {
            const rows = productRows ?? [{
                id: productId,
                title: 'Solar & Battery Unit',
                description: 'Solar storage with <excellent> output & warranty',
                price: 100,
                category: 'Power',
                location: 'Ikeja',
                stock: 2,
                status: 'active'
            }];
            return new Response(JSON.stringify(rows), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            });
        }
        if (requestUrl.pathname.endsWith('/rest/v1/product_images')) {
            return new Response(JSON.stringify([{
                url: `${supabaseUrl}/storage/v1/object/public/product-images/${productId}/cover.jpg`,
                alt_text: 'Solar battery front',
                is_primary: true,
                display_order: 0
            }]), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            });
        }
        throw new Error(`Unexpected test request to ${requestUrl.pathname}`);
    };
    return { context, calls };
}

try {
    {
        const { context, calls } = createContext(`https://velverahub.com/veeve/product.html?id=${productId}`);
        const response = await onRequest(context);
        const html = await response.text();
        assert.equal(response.status, 200);
        assert.match(response.headers.get('cache-control'), /s-maxage=60/);
        assert.match(html, /<title>Solar &amp; Battery Unit - VelveraHub<\/title>/);
        assert.match(html, /property="og:type" content="product"/);
        assert.match(html, /property="og:title" content="Solar &amp; Battery Unit - VelveraHub"/);
        assert.match(html, /property="og:description" content="[^"]*Ikeja[^"]*Solar storage with &lt;excellent&gt; output &amp; warranty/);
        assert.match(html, /property="og:url" content="https:\/\/velverahub\.com\/veeve\/product\.html\?id=/);
        assert.match(html, /property="og:image" content="https:\/\/catalogue\.example\.supabase\.co\/storage\/v1\/object\/public\/product-images\//);
        assert.match(html, /property="product:price:amount" content="90000"/);
        assert.match(html, /property="product:price:currency" content="NGN"/);
        assert.match(html, /name="twitter:card" content="summary_large_image"/);
        assert.equal(calls.length, 2);
        assert.equal(calls[0].url.searchParams.get('status'), 'eq.active');
        assert.equal(calls[0].url.searchParams.get('moderation_status'), 'eq.approved');
        assert.equal(calls[0].url.searchParams.get('stock'), 'gt.0');
        assert.equal(calls[0].init.headers.apikey, anonKey);
        console.log('PASS product metadata uses active public catalogue fields, escapes content, and includes NG price and image');
    }

    {
        const { context } = createContext(`https://velverahub.co.uk/veeve/product.html?id=${productId}`);
        const html = await (await onRequest(context)).text();
        assert.match(html, /property="product:price:amount" content="79\.00"/);
        assert.match(html, /property="product:price:currency" content="GBP"/);
        console.log('PASS UK product metadata uses the storefront conversion and currency');
    }

    {
        const { context, calls } = createContext('https://velverahub.com/veeve/product.html?id=not-a-uuid');
        const response = await onRequest(context);
        assert.equal(await response.text(), staticHtml);
        assert.equal(calls.length, 0);
        console.log('PASS invalid listing IDs leave the static page untouched and make no catalogue request');
    }

    {
        const { context } = createContext(`https://velverahub.com/veeve/product.html?id=${productId}`, { productRows: [] });
        assert.equal(await (await onRequest(context)).text(), staticHtml);
        console.log('PASS unavailable or non-public listings receive no metadata enrichment');
    }

    {
        const { context, calls } = createContext(`https://velverahub.com/veeve/product.html?id=${productId}`, { method: 'POST' });
        const response = await onRequest(context);
        assert.equal(await response.text(), staticHtml);
        assert.equal(calls.length, 0);
        console.log('PASS non-GET requests pass through without public catalogue lookup');
    }

    {
        const { context } = createContext(`https://velverahub.com/veeve/product.html?id=${productId}`, { fetchError: true });
        assert.equal(await (await onRequest(context)).text(), staticHtml);
        console.log('PASS temporary Supabase errors preserve the static product page');
    }
} finally {
    globalThis.fetch = originalFetch;
}
