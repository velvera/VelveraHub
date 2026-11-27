import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const sellerScripts = [
    'assets/js/pages/seller-dashboard.js',
    'velverahub-ng/assets/js/pages/seller-dashboard.js',
    'velverahub-uk/assets/js/pages/seller-dashboard.js',
    'velverahub-shop/assets/js/pages/seller-dashboard.js',
    'velverahub-admin/assets/js/pages/seller-dashboard.js',
    'shop-owner/dashboard.js',
    'velverahub-shop/shop.js'
];
const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const source = read(sellerScripts[0]);
const helpersStart = source.indexOf('function normalizeSellerRevenuePeriod');
const helpersEnd = source.indexOf('function setSellerRevenueUnavailable', helpersStart);
assert.ok(helpersStart >= 0 && helpersEnd > helpersStart, 'Seller revenue helpers should be available for regression checks.');

const context = { Intl, Date, Math };
vm.runInNewContext(`${source.slice(helpersStart, helpersEnd)}
globalThis.revenueTestHelpers = {
    normalizeSellerRevenuePeriod,
    getSellerRevenueDateBounds,
    summarizeSellerRevenueOrders,
    describeSellerRevenueTrend
};`, context);

const {
    normalizeSellerRevenuePeriod,
    getSellerRevenueDateBounds,
    summarizeSellerRevenueOrders,
    describeSellerRevenueTrend
} = context.revenueTestHelpers;

const now = new Date('2026-11-27T12:00:00.000Z');
const bounds = getSellerRevenueDateBounds(7, now);
assert.equal(bounds.previousStart.toISOString(), '2026-11-13T12:00:00.000Z');
assert.equal(bounds.currentStart.toISOString(), '2026-11-20T12:00:00.000Z');
assert.equal(bounds.currentEnd.toISOString(), now.toISOString());
assert.equal(normalizeSellerRevenuePeriod(15), 30);

const summary = summarizeSellerRevenueOrders([
    { status: 'confirmed', total: '10.00', created_at: '2026-11-20T12:00:00.000Z' },
    { status: 'delivered', total: 20, created_at: '2026-11-27T11:59:59.999Z' },
    { status: 'processing', total: 30, created_at: '2026-11-13T12:00:00.000Z' },
    { status: 'cancelled', total: 900, created_at: '2026-11-22T08:00:00.000Z' },
    { status: 'REFUNDED', total: 900, created_at: '2026-11-14T08:00:00.000Z' },
    { status: 'delivered', total: 500, created_at: '2026-11-27T12:00:00.000Z' },
    { status: 'delivered', total: 500, created_at: 'not-a-date' },
    { status: 'delivered', total: null, created_at: '2026-11-21T08:00:00.000Z' }
], bounds);
assert.equal(summary.current.revenue, 30);
assert.equal(summary.current.orderCount, 2);
assert.equal(summary.previous.revenue, 30);
assert.equal(summary.previous.orderCount, 1);
assert.match(describeSellerRevenueTrend(summary, 7).message, /unchanged from the previous 7 days/i);

const noHistory = summarizeSellerRevenueOrders([], bounds);
const noHistoryTrend = describeSellerRevenueTrend(noHistory, 7);
assert.equal(noHistoryTrend.empty, true);
assert.match(noHistoryTrend.message, /No comparison is available/);
assert.doesNotMatch(noHistoryTrend.message, /%/);

const currentOnly = summarizeSellerRevenueOrders([
    { status: 'delivered', total: 12, created_at: '2026-11-22T08:00:00.000Z' }
], bounds);
const insufficientTrend = describeSellerRevenueTrend(currentOnly, 7);
assert.equal(insufficientTrend.empty, false);
assert.match(insufficientTrend.message, /Not enough order history/);
assert.doesNotMatch(insufficientTrend.message, /%/);

const previousOnly = summarizeSellerRevenueOrders([
    { status: 'delivered', total: 40, created_at: '2026-11-16T08:00:00.000Z' }
], bounds);
assert.match(describeSellerRevenueTrend(previousOnly, 7).message, /decreased 100%/);

for (const path of sellerScripts) {
    const script = read(path);
    assert.ok(script.includes(".eq('shop_id', context.shop.id)"), `${path} must scope revenue history to the seller's shop.`);
    assert.ok(script.includes(".gte('created_at', bounds.previousStart.toISOString())"), `${path} must query the complete matched history window.`);
    assert.ok(script.includes(".lt('created_at', bounds.currentEnd.toISOString())"), `${path} must bound history by timestamps.`);
    assert.ok(script.includes(".range(offset, offset + pageSize - 1)"), `${path} must page through the full order history.`);
    assert.ok(script.includes("No eligible order history for the last"), `${path} must show an honest missing-history state.`);
    assert.ok(script.includes("node.dataset.empty = String(!hasHistory)"), `${path} must identify the no-history value state.`);
}

for (const path of [
    'assets/css/seller-dashboard.css',
    'velverahub-ng/assets/css/seller-dashboard.css',
    'velverahub-uk/assets/css/seller-dashboard.css',
    'velverahub-shop/assets/css/seller-dashboard.css',
    'velverahub-admin/assets/css/seller-dashboard.css',
    'seller-workspace/dashboard.css',
    'velverahub-shop/shop.css'
]) {
    const css = read(path);
    assert.ok(css.includes('.seller-revenue-stat'), `${path} must style the neutral revenue card.`);
    assert.ok(css.includes('.seller-analytics'), `${path} must style analytics content.`);
    assert.ok(css.includes('@media (max-width: 480px)'), `${path} must keep analytics readable on narrow phones.`);
}

console.log('Seller revenue history and responsive analytics checks passed.');
