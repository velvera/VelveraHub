import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/js/services/domain-routing.js', import.meta.url), 'utf8');
const productId = '123e4567-e89b-42d3-a456-426614174000';

function createDomains(hostname, origin, region) {
    const window = {
        location: { hostname, origin },
        RegionService: region ? { region } : undefined
    };
    vm.runInNewContext(source, { window, URL });
    return window.VelveraHubDomains;
}

const shopDomains = createDomains('velverahub.shop', 'https://velverahub.shop', 'ng');
assert.equal(
    shopDomains.productUrl(productId),
    `https://velverahub.com/veeve/product.html?id=${productId}`
);
assert.equal(
    shopDomains.productUrl(productId, 'uk'),
    `https://velverahub.co.uk/veeve/product.html?id=${productId}`
);

const localDomains = createDomains('127.0.0.1', 'http://127.0.0.1:5000');
assert.equal(
    localDomains.productUrl(productId),
    `http://127.0.0.1:5000/veeve/product.html?id=${productId}`
);

console.log('PASS product detail links route from shop/local surfaces to a real regional product page');
