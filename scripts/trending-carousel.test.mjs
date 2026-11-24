import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url);
const appPath = new URL('assets/js/app.js', root);
const cssPath = new URL('assets/css/components/home-sections.css', root);
const appSource = fs.readFileSync(appPath, 'utf8');
const sharedRoots = ['velverahub-ng', 'velverahub-uk', 'velverahub-shop', 'velverahub-admin'];

for (const appRoot of sharedRoots) {
    assert.equal(
        fs.readFileSync(new URL(`${appRoot}/assets/js/app.js`, root), 'utf8'),
        appSource,
        `${appRoot} must use the shared storefront script`
    );
    assert.equal(
        fs.readFileSync(new URL(`${appRoot}/assets/css/components/home-sections.css`, root), 'utf8'),
        fs.readFileSync(cssPath, 'utf8'),
        `${appRoot} must use the shared homepage section styles`
    );
}

function chromiumExecutable() {
    try {
        return execFileSync('which', ['chromium'], { encoding: 'utf8' }).trim() || undefined;
    } catch {
        return undefined;
    }
}

async function createStorefrontPage(browser, region, width, reducedMotion = false) {
    const page = await browser.newPage({ viewport: { width, height: 620 } });
    await page.emulateMedia({ reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
    await page.setContent(`<!doctype html>
        <html lang="en">
        <head><meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            html, body { margin: 0; width: 100%; }
            .popular-section { width: 100%; }
            .popular-grid {
                box-sizing: border-box;
                display: flex;
                flex-flow: row nowrap;
                gap: 12px;
                width: 100%;
                padding: 0 12px;
                overflow-x: auto;
                overflow-y: hidden;
                scroll-snap-type: x proximity;
            }
            .popular-card { box-sizing: border-box; flex: 0 0 230px; height: 120px; }
            .popular-card-image, .popular-card-info { height: 50%; }
        </style></head>
        <body>
            <section class="popular-section">
                <strong id="popularTitle">Trending in Nigeria</strong>
                <div class="popular-grid" id="popularProducts"></div>
            </section>
        </body></html>`);
    await page.addScriptTag({ path: appPath.pathname });
    await page.evaluate(async (activeRegion) => {
        window.RegionService = {
            region: activeRegion,
            location: 'all',
            locationLabel: activeRegion === 'uk' ? 'all regions' : 'all states',
            formatPrice: (price) => `₦${price}`
        };
        window.ProductsService = {
            getProducts: async () => ({
                data: Array.from({ length: 6 }, (_, index) => ({
                    id: `product-${index + 1}`,
                    title: `Product ${index + 1}`,
                    price: 100 + index,
                    image: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='
                }))
            }),
            getProductImage: (product) => product.image
        };
        window.responsiveImageMarkup = (product) =>
            `<img id="image-${product.id}" src="${product.image}" alt="${product.title}">`;
        await window.loadPopularInRegion();
    }, region);
    await page.mouse.move(width - 4, 600);
    return page;
}

const browser = await chromium.launch({
    headless: true,
    executablePath: chromiumExecutable(),
    args: ['--no-sandbox']
});

try {
    for (const width of [390, 1280]) {
        const page = await createStorefrontPage(browser, 'ng', width);
        const row = page.locator('#popularProducts');
        const initial = await row.evaluate((element) => ({
            scrollLeft: element.scrollLeft,
            tabIndex: element.tabIndex,
            role: element.getAttribute('role'),
            label: element.getAttribute('aria-label'),
            originalHrefs: [...element.querySelectorAll('.popular-card:not([data-popular-carousel-copy])')]
                .map((card) => card.getAttribute('href')),
            firstCopyHrefs: [...element.querySelectorAll('[data-popular-carousel-copy].popular-card')]
                .slice(0, 6)
                .map((card) => card.getAttribute('href')),
            duplicateImageIds: [...document.querySelectorAll('[id^="image-product-"]')]
                .map((image) => image.id)
                .filter((id, index, allIds) => allIds.indexOf(id) !== index),
            pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
        }));

        assert.equal(initial.tabIndex, 0, 'the Nigeria row must be keyboard-focusable');
        assert.equal(initial.role, 'region');
        assert.equal(initial.label, 'Trending products in Nigeria');
        assert.deepEqual(initial.originalHrefs, initial.firstCopyHrefs, 'copies must preserve product order and destinations');
        assert.deepEqual(initial.duplicateImageIds, [], 'cloned cards must not duplicate IDs');
        assert.equal(initial.pageOverflow, false, 'the carousel must not widen the page');
        assert.equal(await page.locator('#popularTitle').textContent(), 'Trending in Nigeria');

        await page.waitForTimeout(500);
        const moving = await row.evaluate((element) => element.scrollLeft);
        assert.ok(moving > initial.scrollLeft, `${width}px Nigeria row should auto-scroll`);

        await row.hover();
        const hoverPosition = await row.evaluate((element) => element.scrollLeft);
        await page.waitForTimeout(300);
        assert.ok(
            Math.abs((await row.evaluate((element) => element.scrollLeft)) - hoverPosition) < 1,
            'hover must pause automatic scrolling'
        );

        await page.mouse.move(width - 4, 600);
        await page.waitForTimeout(250);
        const resumedPosition = await row.evaluate((element) => element.scrollLeft);
        assert.ok(resumedPosition > hoverPosition, 'automatic scrolling should resume after pointer leaves');

        await row.focus();
        const focusPosition = await row.evaluate((element) => element.scrollLeft);
        await page.waitForTimeout(250);
        assert.ok(
            Math.abs((await row.evaluate((element) => element.scrollLeft)) - focusPosition) < 1,
            'keyboard focus must pause automatic scrolling'
        );

        await row.evaluate((element) => element.blur());
        await page.waitForTimeout(200);
        await row.evaluate((element) => {
            element.dispatchEvent(new Event('touchstart', { bubbles: true }));
            element.scrollLeft += 80;
        });
        const touchPosition = await row.evaluate((element) => element.scrollLeft);
        await page.waitForTimeout(300);
        assert.ok(
            Math.abs((await row.evaluate((element) => element.scrollLeft)) - touchPosition) < 1,
            'touch interaction must pause while leaving manual scrolling available'
        );

        const wrapPoint = await row.evaluate((element) => {
            const firstOriginal = element.querySelector('.popular-card:not([data-popular-carousel-copy])');
            const firstCopy = element.querySelector('[data-popular-carousel-copy].popular-card');
            return firstCopy.getBoundingClientRect().left - firstOriginal.getBoundingClientRect().left;
        });
        await row.evaluate((element, loopDistance) => {
            element.scrollLeft = loopDistance - 1;
            element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaX: 1 }));
        }, wrapPoint);
        const visibleCardAtWrap = await row.evaluate((element) => {
            const firstVisible = [...element.querySelectorAll('.popular-card')].find((card) => {
                const bounds = card.getBoundingClientRect();
                return bounds.right > 0 && bounds.left < window.innerWidth;
            });
            return firstVisible?.getAttribute('href');
        });
        await page.waitForTimeout(1700);
        const wrappedPosition = await row.evaluate((element) => element.scrollLeft);
        const visibleCardAfterWrap = await row.evaluate((element) => {
            const firstVisible = [...element.querySelectorAll('.popular-card')].find((card) => {
                const bounds = card.getBoundingClientRect();
                return bounds.right > 0 && bounds.left < window.innerWidth;
            });
            return firstVisible?.getAttribute('href');
        });
        assert.ok(wrappedPosition < 5, 'the carousel should wrap to the start without a large scroll jump');
        assert.equal(visibleCardAfterWrap, visibleCardAtWrap, 'the same product should remain visible across the loop');

        await page.evaluate(() => {
            window.detachedPopularRow = document.getElementById('popularProducts');
            document.querySelector('.popular-section').remove();
        });
        const detachedPosition = await page.evaluate(() => window.detachedPopularRow.scrollLeft);
        await page.waitForTimeout(300);
        assert.ok(
            Math.abs((await page.evaluate(() => window.detachedPopularRow.scrollLeft)) - detachedPosition) < 1,
            'removing the section must stop its animation'
        );
        await page.close();
        console.log(`PASS Nigeria trending behavior at ${width}px`);
    }

    const reducedMotionPage = await createStorefrontPage(browser, 'ng', 390, true);
    const reducedRow = reducedMotionPage.locator('#popularProducts');
    assert.equal(await reducedRow.locator('[data-popular-carousel-copy]').count(), 0);
    const reducedInitial = await reducedRow.evaluate((element) => element.scrollLeft);
    await reducedMotionPage.waitForTimeout(350);
    assert.equal(
        await reducedRow.evaluate((element) => element.scrollLeft),
        reducedInitial,
        'reduced-motion preference must disable autoplay'
    );
    await reducedRow.focus();
    await reducedMotionPage.keyboard.press('ArrowRight');
    assert.ok(
        (await reducedRow.evaluate((element) => element.scrollLeft)) > reducedInitial,
        'keyboard scrolling must remain available when reduced motion is enabled'
    );
    await reducedMotionPage.close();
    console.log('PASS reduced-motion preference and keyboard scrolling');

    const visibilityPage = await createStorefrontPage(browser, 'ng', 390);
    const visibilityRow = visibilityPage.locator('#popularProducts');
    await visibilityPage.waitForTimeout(250);
    await visibilityPage.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    const hiddenPosition = await visibilityRow.evaluate((element) => element.scrollLeft);
    await visibilityPage.waitForTimeout(300);
    assert.ok(
        Math.abs((await visibilityRow.evaluate((element) => element.scrollLeft)) - hiddenPosition) < 1,
        'a hidden page must pause the animation'
    );
    await visibilityPage.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await visibilityPage.waitForTimeout(250);
    assert.ok(
        (await visibilityRow.evaluate((element) => element.scrollLeft)) > hiddenPosition,
        'the animation should resume when the page becomes visible'
    );
    await visibilityPage.close();
    console.log('PASS page visibility pause and resume');

    const ukPage = await createStorefrontPage(browser, 'uk', 390);
    const ukRow = ukPage.locator('#popularProducts');
    assert.equal(await pageTitle(ukPage), 'Popular in UK');
    assert.equal(await ukRow.locator('[data-popular-carousel-copy]').count(), 0);
    const ukInitial = await ukRow.evaluate((element) => element.scrollLeft);
    await ukPage.waitForTimeout(350);
    assert.equal(await ukRow.evaluate((element) => element.scrollLeft), ukInitial);
    await ukRow.evaluate((element) => { element.scrollLeft = 100; });
    assert.equal(await ukRow.evaluate((element) => element.scrollLeft), 100, 'UK row must retain manual scrolling');
    await ukPage.close();
    console.log('PASS UK popular row remains static and manually scrollable');
} finally {
    await browser.close();
}

async function pageTitle(page) {
    return page.locator('#popularTitle').textContent();
}
