import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const cookieScript = read('assets/js/components/cookie-consent.js');
const cookieStyles = read('assets/css/components/cookie-consent.css');
const legalPage = read('veeve/legal.html');
const homePage = read('index.html');
const intelligence = read('assets/js/services/marketplace-intelligence.js');

function createHarness(initialChoice = null) {
    const values = new Map(initialChoice ? [['velverahub_cookie_consent', initialChoice]] : []);
    const events = [];
    let banner = null;
    const document = {
        readyState: 'complete',
        createElement() {
            return {
                id: '',
                className: '',
                innerHTML: '',
                setAttribute() {},
                addEventListener(type, handler) {
                    if (type === 'click') this.clickHandler = handler;
                },
                contains(element) {
                    return element === this.acceptButton || element === this.declineButton;
                },
                remove() {
                    if (banner === this) banner = null;
                },
            };
        },
        getElementById(id) {
            return id === 'cookieConsentBanner' ? banner : null;
        },
        body: {
            appendChild(element) {
                banner = element;
            },
        },
    };
    const window = {
        dispatchEvent(event) {
            events.push(event);
            return true;
        },
    };
    class TestCustomEvent {
        constructor(type, options = {}) {
            this.type = type;
            this.detail = options.detail;
        }
    }
    const localStorage = {
        getItem(key) {
            return values.get(key) ?? null;
        },
        setItem(key, value) {
            values.set(key, String(value));
        },
        removeItem(key) {
            values.delete(key);
        },
    };

    vm.runInNewContext(cookieScript, {
        window,
        document,
        localStorage,
        CustomEvent: TestCustomEvent,
    });

    return {
        banner: () => banner,
        events,
        localStorage,
        values,
        window,
    };
}

function createAnalyticsHarness(initialCookieChoice, initialValues = []) {
    const values = new Map(initialValues);
    const windowListeners = new Map();
    const documentListeners = new Map();
    let cookieChoice = initialCookieChoice;
    const localStorage = {
        getItem(key) {
            return values.get(key) ?? null;
        },
        setItem(key, value) {
            values.set(key, String(value));
        },
        removeItem(key) {
            values.delete(key);
        },
    };
    const sessionStorage = {
        getItem: (key) => values.get(`session:${key}`) ?? null,
        setItem: (key, value) => values.set(`session:${key}`, String(value)),
    };
    const window = {
        VELVERAHUB_CONFIG: { STATIC_ONLY: true },
        addEventListener(type, handler) {
            const handlers = windowListeners.get(type) || [];
            handlers.push(handler);
            windowListeners.set(type, handlers);
        },
        dispatchEvent(event) {
            for (const handler of windowListeners.get(event.type) || []) handler(event);
            return true;
        },
    };
    const document = {
        addEventListener(type, handler) {
            const handlers = documentListeners.get(type) || [];
            handlers.push(handler);
            documentListeners.set(type, handlers);
        },
        getElementById() {
            return null;
        },
    };

    vm.runInNewContext(intelligence, {
        window,
        document,
        localStorage,
        sessionStorage,
    });
    window.CookieConsent = { getStatus: () => cookieChoice };
    window.MarketplaceIntelligence.init();
    return {
        values,
        window,
        setCookieChoice(value) {
            cookieChoice = value;
        },
    };
}

const fresh = createHarness();
assert.equal(fresh.window.CookieConsent.getStatus(), 'unset');
assert.ok(fresh.banner(), 'the consent banner appears when no choice is saved');
assert.match(fresh.banner().innerHTML, /Optional analytics and browsing-based recommendations are off unless you accept/);
assert.doesNotMatch(fresh.banner().innerHTML, /data-cookie-settings|Settings|cookieSettingsDialog/i);
const choices = [...fresh.banner().innerHTML.matchAll(
    /<button[^>]*data-cookie-choice="([^"]+)"[^>]*>([^<]+)<\/button>/g,
)].map((match) => ({ value: match[1], label: match[2] }));
assert.deepEqual(choices, [
    { value: 'rejected', label: 'Decline' },
    { value: 'granted', label: 'Accept' },
]);
assert.equal(typeof fresh.window.CookieConsent.showSettings, 'undefined');

const acceptButton = { dataset: { cookieChoice: 'granted' } };
fresh.banner().acceptButton = acceptButton;
fresh.banner().clickHandler({ target: { closest: () => acceptButton } });
assert.equal(fresh.window.CookieConsent.getStatus(), 'granted');
assert.equal(fresh.values.get('velverahub_cookie_consent'), 'granted');
assert.equal(fresh.banner(), null, 'the banner closes after a choice');
assert.ok(fresh.events.some((event) => (
    event.type === 'velverahub:cookie-consent' && event.detail.value === 'granted'
)));
assert.ok(fresh.events.some((event) => (
    event.type === 'velverahub:cookie-consent-ready' && event.detail.value === 'unset'
)));

const decline = createHarness();
const declineButton = { dataset: { cookieChoice: 'rejected' } };
decline.banner().declineButton = declineButton;
decline.banner().clickHandler({ target: { closest: () => declineButton } });
assert.equal(decline.window.CookieConsent.getStatus(), 'rejected');
assert.equal(decline.values.get('velverahub_cookie_consent'), 'rejected');
assert.equal(decline.banner(), null, 'declining also closes the banner');

assert.equal(createHarness('accepted').window.CookieConsent.getStatus(), 'granted');
assert.equal(createHarness('reject').window.CookieConsent.getStatus(), 'rejected');
assert.equal(createHarness('granted').banner(), null, 'a saved acceptance is not prompted again');
assert.equal(createHarness('rejected').banner(), null, 'a saved decline is not prompted again');
assert.doesNotMatch(cookieStyles, /cookie-settings-dialog|cookie-setting-row|cookie-settings-actions/);
assert.doesNotMatch(legalPage, /data-cookie-settings|Cookie settings/i);
assert.doesNotMatch(homePage, /personalizationConsent|data-consent="grant"/);
assert.match(intelligence, /window\.CookieConsent\?\.getStatus\?\.\(\) !== 'granted'/);
assert.match(intelligence, /velverahub:cookie-consent-ready/);

const analytics = createAnalyticsHarness('unset');
analytics.window.MarketplaceIntelligence.track('product_view', { productId: 'test-product' });
assert.equal(analytics.values.has('velvera_marketplace_events'), false, 'analytics stays off before consent');
assert.equal(analytics.window.MarketplaceIntelligence.getVariant(), 'holdout');
assert.equal(analytics.values.has('velvera_recommendation_experiment'), false);
assert.deepEqual(
    JSON.parse(JSON.stringify(analytics.window.MarketplaceIntelligence.getProfile())),
    { categories: {}, viewed: [], clicked: [] },
    'personalization data is not read before consent',
);
analytics.setCookieChoice('granted');
analytics.window.dispatchEvent({
    type: 'velverahub:cookie-consent',
    detail: { value: 'granted' },
});
analytics.window.MarketplaceIntelligence.track('product_view', { productId: 'test-product' });
const recordedEvents = JSON.parse(analytics.values.get('velvera_marketplace_events'));
assert.ok(recordedEvents.some((event) => event.name === 'product_view'));

const declinedAnalytics = createAnalyticsHarness('rejected', [
    ['velvera_personalization_consent', 'granted'],
    ['velvera_discovery_profile', JSON.stringify({ categories: { Books: 10 }, viewed: ['old'] })],
    ['velvera_recommendation_experiment', 'personalized'],
    ['velvera_marketplace_events', JSON.stringify([{ name: 'old-event' }])],
]);
declinedAnalytics.window.MarketplaceIntelligence.track('product_view', { productId: 'test-product' });
assert.equal(
    declinedAnalytics.values.has('velvera_marketplace_events'),
    false,
    'legacy personalization consent cannot bypass a declined cookie choice',
);
assert.equal(declinedAnalytics.values.has('velvera_discovery_profile'), false);
assert.equal(declinedAnalytics.values.has('velvera_recommendation_experiment'), false);
assert.equal(declinedAnalytics.values.has('velvera_personalization_consent'), true);
assert.equal(declinedAnalytics.values.get('velvera_personalization_consent'), 'denied');

console.log('PASS cookie consent offers only decline/accept, persists both choices, and gates optional analytics');
