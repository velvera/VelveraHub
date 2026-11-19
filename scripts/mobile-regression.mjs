import { execFileSync, spawn } from 'node:child_process';
import { chromium } from 'playwright';

const port = Number(process.env.MOBILE_REGRESSION_PORT || 5052);
const suppliedBaseUrl = process.env.MOBILE_REGRESSION_BASE_URL || process.argv[2];
const baseUrl = (suppliedBaseUrl || `http://127.0.0.1:${port}`).replace(/\/+$/, '');
const allViewports = [320, 390, 430];
const requestedWidths = (process.env.MOBILE_REGRESSION_WIDTHS || '')
    .split(',').map((value) => value.trim()).filter(Boolean)
    .map(Number).filter(Number.isFinite);
const viewports = requestedWidths.length
    ? allViewports.filter((width) => requestedWidths.includes(width))
    : allViewports;
const desktopWidth = 1280;
const allStorefrontRoots = [
    { name: 'parent app', prefix: '' },
    { name: 'velverahub-ng', prefix: '/velverahub-ng' },
    { name: 'velverahub-uk', prefix: '/velverahub-uk' },
];
const requestedRoots = (process.env.MOBILE_REGRESSION_ROOTS || '')
    .split(',').map((value) => value.trim()).filter(Boolean);
const storefrontRoots = requestedRoots.length
    ? allStorefrontRoots.filter((root) => requestedRoots.includes(root.name))
    : allStorefrontRoots;
const adminRoot = { name: 'velverahub-admin', prefix: '/velverahub-admin' };
const runAdminRoot = !requestedRoots.length || requestedRoots.includes(adminRoot.name);
const runShopRoot = !requestedRoots.length || requestedRoots.includes('velverahub-shop');
const runDesktop = !requestedWidths.length || requestedWidths.includes(desktopWidth);
const expectedCategoryNames = [
    'Babies & Kids',
    'Beauty & Personal Care',
    'Business & Industry',
    'Commercial Equipment & Tools',
    'Electronics',
    'Fashion',
    'Food, Agriculture & Farming',
    'Home, Furniture & Appliances',
    'Jobs',
    'Leisure & Activities',
    'Pets',
    'Phones & Tablets',
    'Property',
    'Repair & Construction',
    'Services',
    'Vehicles',
];
const expectedLegacyCategoryNames = ['Books', 'Other', 'Sports', 'Toys & Games'];
const expectedHomepageCategoryTiles = [
    ['Post ad', '/catalog/seller.html'],
    ['🔥 Trending', '/catalog/products.html?filter=trending'],
    ['Electronics', '/catalog/products.html?category=electronics'],
    ['Fashion', '/catalog/products.html?category=fashion'],
    ['Home Furniture & Appliances', '/catalog/products.html?category=home'],
    ['Beauty & Personal Care', '/catalog/products.html?category=beauty'],
    ['Sports', '/catalog/products.html?category=sports'],
    ['Toys & Games', '/catalog/products.html?category=toys'],
    ['Phones & Tablets', '/catalog/products.html?category=electronics'],
    ['Services', '/catalog/products.html?category=all&search=services'],
    ['Repair & Construction', '/catalog/products.html?category=all&search=repair'],
    ['Commercial Equipment & Tools', '/catalog/products.html?category=all&search=equipment'],
    ['Babies & Kids', '/catalog/products.html?category=toys'],
    ['Food, Agriculture & Farming', '/catalog/products.html?category=all&search=food'],
    ['Animals & Pets', '/catalog/products.html?category=all&search=pets'],
    ['Jobs', '/catalog/products.html?category=all&search=jobs'],
];

let server;
let failures = 0;

function chromiumExecutable() {
    if (process.env.MOBILE_REGRESSION_EXECUTABLE_PATH) {
        return process.env.MOBILE_REGRESSION_EXECUTABLE_PATH;
    }
    try {
        return execFileSync('which', ['chromium'], { encoding: 'utf8' }).trim() || undefined;
    } catch {
        return undefined;
    }
}

function launchBrowser() {
    return chromium.launch({
        headless: true,
        executablePath: chromiumExecutable(),
    });
}

function fail(message) {
    failures += 1;
    console.error(`FAIL ${message}`);
}

function pass(message) {
    console.log(`PASS ${message}`);
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

function route(root, path) {
    return `${baseUrl}${root.prefix}${path}`;
}

async function resolveCookieConsent(page) {
    const banner = page.locator('#cookieConsentBanner');
    const decline = banner.locator('[data-cookie-choice="rejected"]');
    try {
        await decline.waitFor({ state: 'visible', timeout: 2500 });
    } catch (_) {
        return;
    }
    await decline.click();
    await banner.waitFor({ state: 'detached' });
}

async function assertLoader(page, rootName, width) {
    const loader = await page.evaluate(() => {
        const rules = [...document.styleSheets].flatMap((sheet) => {
            try {
                return [...sheet.cssRules].map((rule) => rule.cssText);
            } catch {
                return [];
            }
        }).join('\n');
        return {
            ready: document.body.classList.contains('app-ready'),
            hasOverlay: rules.includes('body:not(.app-ready)::before') && rules.includes('z-index: 10000'),
            hasSpinnerColor: rules.includes('rgb(255, 177, 0)') || rules.includes('#ffb100'),
            hasLogo: rules.includes('logo.png'),
        };
    });
    if (!loader.ready) throw new Error(`${rootName} ${width}px did not release the branded loader`);
    if (!loader.hasOverlay) throw new Error(`${rootName} ${width}px loader z-index regressed`);
    if (!loader.hasSpinnerColor) {
        throw new Error(`${rootName} ${width}px loader is not using #ffb100`);
    }
    if (!loader.hasLogo) {
        throw new Error(`${rootName} ${width}px loader is missing the centered logo`);
    }
}

async function assertBottomNavigation(page, rootName, width) {
    const nav = page.locator('.mobile-bottom-nav');
    await page.evaluate(() => {
        document.documentElement.style.scrollBehavior = 'auto';
        window.scrollTo(0, 0);
    });
    await page.waitForFunction(() =>
        document.querySelector('.mobile-bottom-nav')?.getAttribute('aria-hidden') === 'false'
    );
    await nav.waitFor({ state: 'visible' });
    const result = await nav.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const items = [...node.querySelectorAll('.bottom-nav-item')];
        const safeAreaRules = [...document.styleSheets].flatMap((sheet) => {
            try {
                return [...sheet.cssRules].map((rule) => rule.cssText);
            } catch {
                return [];
            }
        }).filter((rule) => rule.includes('safe-area-inset-bottom'));
        return {
            bottom: rect.bottom,
            height: rect.height,
            itemCount: items.length,
            hasSafeAreaPadding: safeAreaRules.some((rule) =>
                rule.includes('.mobile-bottom-nav') && rule.includes('padding-bottom') &&
                rule.includes('env(safe-area-inset-bottom')
            ),
            hasSafeAreaBodyReserve: safeAreaRules.some((rule) =>
                rule.includes('body') && rule.includes('padding-bottom') &&
                rule.includes('safe-area-inset-bottom')
            ),
            usableItems: items.filter((item) => {
                const itemRect = item.getBoundingClientRect();
                return itemRect.width >= 40 && itemRect.height >= 44 &&
                    itemRect.left >= 0 && itemRect.right <= window.innerWidth;
            }).length,
        };
    });
    if (result.itemCount !== 5) throw new Error(`${rootName} ${width}px has ${result.itemCount} bottom-nav items, expected 5`);
    if (result.usableItems !== 5) throw new Error(`${rootName} ${width}px has a clipped or unusable bottom-nav item`);
    if (!result.hasSafeAreaPadding || !result.hasSafeAreaBodyReserve) {
        throw new Error(`${rootName} ${width}px bottom navigation is missing safe-area inset handling`);
    }
    if (result.bottom > width * 0 + page.viewportSize().height + 1) {
        throw new Error(`${rootName} ${width}px bottom navigation overlaps the viewport edge`);
    }

    await page.evaluate(() => {
        document.documentElement.style.scrollBehavior = 'auto';
        const spacer = document.createElement('div');
        spacer.id = 'mobile-nav-scroll-test-spacer';
        spacer.style.height = '200vh';
        spacer.setAttribute('aria-hidden', 'true');
        document.body.appendChild(spacer);
        window.scrollTo(0, 0);
    });
    await page.waitForTimeout(50);
    if (await nav.getAttribute('aria-hidden') !== 'false') {
        throw new Error(`${rootName} ${width}px bottom navigation should be visible at the top`);
    }

    await page.evaluate(() => window.scrollTo(0, 120));
    await page.waitForFunction(() =>
        document.querySelector('.mobile-bottom-nav')?.getAttribute('aria-hidden') === 'true'
    );
    await page.waitForFunction(() => {
        const currentNav = document.querySelector('.mobile-bottom-nav');
        return currentNav?.getAttribute('aria-hidden') === 'true' &&
            window.getComputedStyle(currentNav).visibility === 'hidden';
    });
    if (await nav.isVisible()) {
        throw new Error(`${rootName} ${width}px bottom navigation did not hide while scrolling down`);
    }

    await page.evaluate(() => window.scrollTo(0, 60));
    await page.waitForFunction(() =>
        document.querySelector('.mobile-bottom-nav')?.getAttribute('aria-hidden') === 'false'
    );
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForFunction(() =>
        document.querySelector('.mobile-bottom-nav')?.getAttribute('aria-hidden') === 'true'
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(() =>
        document.querySelector('.mobile-bottom-nav')?.getAttribute('aria-hidden') === 'false'
    );
    pass(`${rootName} ${width}px bottom navigation`);
}

async function assertHomepageCategoryTiles(page, root, width) {
    await page.goto(route(root, '/'), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#home-category-title');
    const snapshot = await page.evaluate(() => ({
        title: document.querySelector('#home-category-title')?.textContent.trim(),
        tiles: [...document.querySelectorAll('.home-category-grid .home-category-card')].map((card) => {
            const href = new URL(card.getAttribute('href'), window.location.href);
            href.pathname = href.pathname.replace(/^\/(?:pages|veeve)\//, '/catalog/');
            if (href.pathname === '/catalog/sell.html') href.pathname = '/catalog/seller.html';
            return [
                card.querySelector(':scope > span:last-child')?.textContent.replace(/\s+/g, ' ').trim(),
                `${href.pathname}${href.search}`,
            ];
        }),
    }));
    if (snapshot.title !== 'Shop by category' ||
        JSON.stringify(snapshot.tiles) !== JSON.stringify(expectedHomepageCategoryTiles)) {
        throw new Error(`${root.name} ${width}px homepage Shop by category tiles changed: ${JSON.stringify(snapshot)}`);
    }
    pass(`${root.name} ${width}px homepage category tiles unchanged`);
}

async function assertCategoryTaxonomy(page, selector, rootName, width) {
    await page.waitForFunction((selectSelector) => {
        const select = document.querySelector(selectSelector);
        return Boolean(window.VelveraCategories && select?.dataset.categoryEnhanced === 'true');
    }, selector);
    const snapshot = await page.locator(selector).evaluate((select) => {
        const compare = new Intl.Collator('en', { sensitivity: 'base' }).compare;
        const categories = window.VelveraCategories.categories;
        const officialNames = categories.filter((category) => !category.legacy).map((category) => category.name);
        const legacyNames = categories.filter((category) => category.legacy).map((category) => category.name);
        return {
            searchable: select.dataset.searchable === 'true' &&
                Boolean(document.querySelector('.cs-panel--searchable')),
            optionCount: select.options.length,
            optionValuesUnique: new Set([...select.options].map((option) => option.value)).size === select.options.length,
            officialNames,
            legacyNames,
            parentNamesSorted: categories.every((category, index) =>
                !index || compare(categories[index - 1].name, category.name) <= 0
            ),
            childrenSorted: categories.every((category) => {
                const sorted = [...category.subcategories].sort(compare);
                return category.subcategories.every((name, index) => name === sorted[index]);
            }),
            childCount: categories.reduce((sum, category) => sum + category.subcategories.length, 0),
        };
    });
    if (!snapshot.searchable || snapshot.optionCount !== 197 || !snapshot.optionValuesUnique ||
        JSON.stringify(snapshot.officialNames) !== JSON.stringify(expectedCategoryNames) ||
        JSON.stringify(snapshot.legacyNames) !== JSON.stringify(expectedLegacyCategoryNames) ||
        !snapshot.parentNamesSorted || !snapshot.childrenSorted || snapshot.childCount !== 176) {
        throw new Error(`${rootName} ${width}px category selector taxonomy regressed: ${JSON.stringify(snapshot)}`);
    }
}

async function selectSearchableCategory(page, selector, searchTerm, optionValue, rootName, width) {
    const select = page.locator(selector);
    const trigger = select.locator('xpath=..').locator('.cs-trigger');
    await trigger.click();
    const panel = page.locator('.cs-panel--searchable.is-open').last();
    await panel.waitFor({ state: 'visible' });
    const search = panel.locator('[data-cs-search]');
    await search.waitFor({ state: 'visible' });
    await search.fill(searchTerm);
    const matches = await panel.locator('.cs-option:not([hidden])').evaluateAll((options) =>
        options.map((option) => ({ value: option.dataset.value, label: option.textContent.trim() }))
    );
    if (matches.length !== 1 || matches[0].value !== optionValue) {
        throw new Error(`${rootName} ${width}px category search for "${searchTerm}" returned ${JSON.stringify(matches)}`);
    }
    await panel.locator(`.cs-option[data-value="${optionValue}"]`).click();
    if (await select.inputValue() !== optionValue) {
        throw new Error(`${rootName} ${width}px category selector did not retain ${optionValue}`);
    }
}

async function installCategoryQueryRecorder(page) {
    await page.evaluate(() => {
        const calls = [];
        window.__mobileCategoryQueryCalls = calls;
        const makeQuery = () => ({
            select() { return this; },
            eq(column, value) {
                calls.push({ method: 'eq', column, value });
                return this;
            },
            in(column, values) {
                calls.push({ method: 'in', column, value: [...values] });
                return this;
            },
            order() { return this; },
            limit() { return this; },
            range() { return this; },
            or() { return this; },
            then(resolve, reject) {
                return Promise.resolve({ data: [], error: null, count: 0 }).then(resolve, reject);
            },
        });
        window.SupabaseClient = {
            isConfigured: () => true,
            get: () => ({
                from: () => makeQuery(),
            }),
        };
    });
}

async function assertCategoryFiltering(page, root, width) {
    await assertHomepageCategoryTiles(page, root, width);
    await page.goto(route(root, '/veeve/products.html'), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#categoryFilter');
    await assertCategoryTaxonomy(page, '#categoryFilter', root.name, width);
    await installCategoryQueryRecorder(page);

    const categorySelect = page.locator('#categoryFilter');
    const categoryTrigger = categorySelect.locator('xpath=..').locator('.cs-trigger');
    await categoryTrigger.click();
    const categoryPanel = page.locator('.cs-panel--categories').last();
    await categoryPanel.waitFor({ state: 'visible' });
    const rootHeader = await categoryPanel.evaluate((panel) => {
        const back = panel.querySelector('.cs-mobile-back');
        const title = panel.querySelector('.cs-mobile-panel-title');
        const search = panel.querySelector('.cs-category-search');
        const backRect = back.getBoundingClientRect();
        const titleRect = title.getBoundingClientRect();
        const searchRect = search.getBoundingClientRect();
        return {
            backLabel: panel.querySelector('.cs-mobile-back-label')?.textContent.trim(),
            title: title.textContent.trim(),
            sameRow: Math.abs(
                (backRect.top + backRect.bottom) / 2 - (titleRect.top + titleRect.bottom) / 2
            ) <= 2,
            searchBelow: searchRect.top >= Math.max(backRect.bottom, titleRect.bottom),
            imageSizes: [...panel.querySelectorAll('.cs-category-icon')].map((icon) => {
                const rect = icon.getBoundingClientRect();
                return [rect.width, rect.height];
            }),
        };
    });
    if (rootHeader.backLabel !== 'Close' || rootHeader.title !== 'Categories' ||
        !rootHeader.sameRow || !rootHeader.searchBelow ||
        rootHeader.imageSizes.some(([imageWidth, imageHeight]) => imageWidth > 30 || imageHeight > 30)) {
        throw new Error(`${root.name} ${width}px category header or main-category images are misaligned: ${JSON.stringify(rootHeader)}`);
    }

    const sortTrigger = page.locator('#sortFilter').locator('xpath=..').locator('.cs-trigger');
    await sortTrigger.evaluate((trigger) => trigger.click());
    if (await categoryTrigger.getAttribute('aria-expanded') !== 'false' ||
        await categoryPanel.getAttribute('aria-hidden') !== 'true' ||
        await sortTrigger.getAttribute('aria-expanded') !== 'true' ||
        await page.locator('.cs-panel.is-open').count() !== 1) {
        throw new Error(`${root.name} ${width}px switching dropdowns left stale open state`);
    }
    await page.keyboard.press('Escape');
    if (await sortTrigger.getAttribute('aria-expanded') !== 'false') {
        throw new Error(`${root.name} ${width}px sort selector did not close after switching from categories`);
    }

    await page.waitForTimeout(25);
    await categoryTrigger.focus();
    const keyboardSelectionBefore = await page.locator('#categoryFilter').inputValue();
    await page.keyboard.press('ArrowDown');
    if (await categoryTrigger.getAttribute('aria-expanded') !== 'true' ||
        await page.locator('#categoryFilter').inputValue() !== keyboardSelectionBefore) {
        throw new Error(`${root.name} ${width}px keyboard opening changed the saved category or failed to open`);
    }
    const initialKeyboardState = await page.evaluate(() => {
        const trigger = document.querySelector('#categoryFilter').parentElement.querySelector('.cs-trigger');
        const list = document.getElementById(trigger.getAttribute('aria-controls'));
        const active = document.getElementById(trigger.getAttribute('aria-activedescendant'));
        const rows = [...list.querySelectorAll('.cs-category-row')];
        return {
            role: trigger.getAttribute('role'),
            focused: document.activeElement === trigger,
            activeId: active?.id || null,
            activeIndex: rows.findIndex((row) => row === active),
            electronicsIndex: rows.findIndex((row) => row.dataset.value === 'electronics'),
        };
    });
    if (initialKeyboardState.role !== 'combobox' || !initialKeyboardState.focused ||
        !initialKeyboardState.activeId || initialKeyboardState.activeIndex < 0 ||
        initialKeyboardState.electronicsIndex < 0) {
        throw new Error(`${root.name} ${width}px keyboard focus or active-option ARIA state is invalid: ${JSON.stringify(initialKeyboardState)}`);
    }
    await page.keyboard.press('ArrowDown');
    if (await page.locator('#categoryFilter').inputValue() !== keyboardSelectionBefore) {
        throw new Error(`${root.name} ${width}px ArrowDown changed the category without explicit selection`);
    }
    let navigationState = await page.evaluate(() => {
        const trigger = document.querySelector('#categoryFilter').parentElement.querySelector('.cs-trigger');
        const list = document.getElementById(trigger.getAttribute('aria-controls'));
        const active = document.getElementById(trigger.getAttribute('aria-activedescendant'));
        const rows = [...list.querySelectorAll('.cs-category-row')];
        return {
            activeId: active?.id || null,
            activeIndex: rows.findIndex((row) => row === active),
            electronicsIndex: rows.findIndex((row) => row.dataset.value === 'electronics'),
        };
    });
    let moveCount = 0;
    while (navigationState.activeIndex < navigationState.electronicsIndex && moveCount < 40) {
        await page.keyboard.press('ArrowDown');
        moveCount += 1;
        navigationState = await page.evaluate(() => {
            const trigger = document.querySelector('#categoryFilter').parentElement.querySelector('.cs-trigger');
            const list = document.getElementById(trigger.getAttribute('aria-controls'));
            const active = document.getElementById(trigger.getAttribute('aria-activedescendant'));
            const rows = [...list.querySelectorAll('.cs-category-row')];
            return {
                activeId: active?.id || null,
                activeIndex: rows.findIndex((row) => row === active),
                electronicsIndex: rows.findIndex((row) => row.dataset.value === 'electronics'),
            };
        });
    }
    if (navigationState.activeIndex !== navigationState.electronicsIndex) {
        throw new Error(`${root.name} ${width}px keyboard navigation could not reach the Electronics parent`);
    }
    await page.keyboard.press('ArrowRight');
    if (await categoryPanel.locator('.cs-mobile-panel-title').textContent() !== 'Electronics' ||
        await page.locator('#categoryFilter').inputValue() !== keyboardSelectionBefore) {
        throw new Error(`${root.name} ${width}px keyboard expansion changed the saved value or failed to enter child categories`);
    }
    await page.keyboard.press('ArrowLeft');
    if (await categoryPanel.locator('.cs-mobile-panel-title').textContent() !== 'Categories' ||
        await page.locator('#categoryFilter').inputValue() !== keyboardSelectionBefore) {
        throw new Error(`${root.name} ${width}px keyboard back navigation did not return to the main categories safely`);
    }
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    const keyboardChildValue = await page.evaluate(() => {
        const trigger = document.querySelector('#categoryFilter').parentElement.querySelector('.cs-trigger');
        return document.getElementById(trigger.getAttribute('aria-activedescendant'))?.dataset.value || '';
    });
    if (!keyboardChildValue.startsWith('electronics::') ||
        await page.locator('#categoryFilter').inputValue() !== keyboardSelectionBefore) {
        throw new Error(`${root.name} ${width}px keyboard navigation did not focus a child category without selecting it`);
    }
    await page.keyboard.press('Enter');
    if (await page.locator('#categoryFilter').inputValue() !== keyboardChildValue ||
        await categoryTrigger.getAttribute('aria-expanded') !== 'false') {
        throw new Error(`${root.name} ${width}px Enter did not explicitly select the focused child category`);
    }
    const selectedCategoryAria = await categoryPanel.locator(`.cs-category-row[data-value="${keyboardChildValue}"]`).getAttribute('aria-selected');
    if (selectedCategoryAria !== 'true') {
        throw new Error(`${root.name} ${width}px selected category ARIA state did not update`);
    }
    await page.keyboard.press('Escape');
    if (await categoryTrigger.getAttribute('aria-expanded') !== 'false') {
        throw new Error(`${root.name} ${width}px category selector did not close after keyboard navigation`);
    }

    const childValue = 'pets::dogs-and-puppies';
    await selectSearchableCategory(page, '#categoryFilter', 'Dogs & Puppies', childValue, root.name, width);
    await page.waitForFunction((expected) =>
        window.__mobileCategoryQueryCalls?.some((call) =>
            call.method === 'eq' && call.column === 'category' && call.value === expected
        ),
    childValue, { timeout: 4000 });

    const electronicsValues = await page.evaluate(() => window.VelveraCategories.getValues('electronics'));
    if (electronicsValues.length !== 16 ||
        !electronicsValues.includes('electronics::computer-hardware')) {
        throw new Error(`${root.name} ${width}px Electronics parent did not include its expected child categories`);
    }
    await page.evaluate(() => {
        window.__mobileCategoryQueryCalls.length = 0;
    });
    await categoryTrigger.click();
    const panel = page.locator('.cs-panel--searchable.is-open').last();
    await panel.waitFor({ state: 'visible' });
    const search = panel.locator('[data-cs-search]');
    await search.fill('Electronics');
    const visibleValues = await panel.locator('.cs-option:not([hidden])').evaluateAll((options) =>
        options.map((option) => option.dataset.value)
    );
    if (visibleValues.length !== 16 || !visibleValues.includes('electronics') ||
        visibleValues.some((value) => value !== 'electronics' && !value.startsWith('electronics::'))) {
        throw new Error(`${root.name} ${width}px parent-category search did not find Electronics and its children`);
    }
    await panel.locator('.cs-option[data-value="electronics"]').click();
    if (await panel.locator('.cs-category-subcategory').count() !== electronicsValues.length - 1) {
        throw new Error(`${root.name} ${width}px selecting Electronics did not open its subcategories`);
    }
    const childHeader = await panel.evaluate((node) => {
        const back = node.querySelector('.cs-mobile-back');
        const title = node.querySelector('.cs-mobile-panel-title');
        const search = node.querySelector('.cs-category-search');
        const backRect = back.getBoundingClientRect();
        const titleRect = title.getBoundingClientRect();
        const searchRect = search.getBoundingClientRect();
        return {
            backLabel: node.querySelector('.cs-mobile-back-label')?.textContent.trim(),
            title: title.textContent.trim(),
            sameRow: Math.abs(
                (backRect.top + backRect.bottom) / 2 - (titleRect.top + titleRect.bottom) / 2
            ) <= 2,
            searchBelow: searchRect.top >= Math.max(backRect.bottom, titleRect.bottom),
        };
    });
    if (childHeader.backLabel !== 'Back' || childHeader.title !== 'Electronics' ||
        !childHeader.sameRow || !childHeader.searchBelow) {
        throw new Error(`${root.name} ${width}px subcategory header is misaligned: ${JSON.stringify(childHeader)}`);
    }
    await panel.locator('.cs-category-parent-option[data-value="electronics"]').click();
    await page.waitForFunction((expected) =>
        window.__mobileCategoryQueryCalls?.some((call) =>
            call.method === 'in' && call.column === 'category' &&
            JSON.stringify(call.value) === JSON.stringify(expected)
        ),
    electronicsValues, { timeout: 4000 });
    if (await categorySelect.inputValue() !== 'electronics') {
        throw new Error(`${root.name} ${width}px parent category selection did not update the catalogue filter`);
    }

    await page.evaluate(() => {
        window.__mobileCategoryQueryCalls.length = 0;
    });
    await categoryTrigger.click();
    const booksPanel = page.locator('.cs-panel--categories.is-open').last();
    const categoryImages = [
        { value: 'books', name: 'Books', file: 'books.png' },
        { value: 'business-industry', name: 'Business & Industry', file: 'business-and-industry.png' },
        { value: 'leisure-activities', name: 'Leisure & Activities', file: 'leisure-and-activities.png' },
        { value: 'other', name: 'Other', file: 'other.png' },
        { value: 'property', name: 'Property', file: 'property.png' },
        { value: 'vehicles', name: 'Vehicles', file: 'vehicles.png' },
    ];
    for (const category of categoryImages) {
        await booksPanel.locator('[data-cs-search]').fill(category.name);
        const row = booksPanel.locator(`.cs-category-row[data-value="${category.value}"]`);
        await row.waitFor({ state: 'visible' });
        const image = row.locator('.cs-category-icon img');
        const imageState = await image.evaluate(async (element) => {
            await element.decode();
            return {
                path: new URL(element.src).pathname,
                naturalWidth: element.naturalWidth,
            };
        });
        if (imageState.path !== `/img/home-category/${category.file}` || imageState.naturalWidth < 1) {
            throw new Error(
                `${root.name} ${width}px ${category.name} category selector image did not load: ${JSON.stringify(imageState)}`
            );
        }
    }
    await booksPanel.locator('[data-cs-search]').fill('Books');
    await booksPanel.locator('.cs-category-row[data-value="books"]').click();
    await page.waitForFunction(() =>
        window.__mobileCategoryQueryCalls?.some((call) =>
            call.method === 'eq' && call.column === 'category' && call.value === 'books'
        ),
    null, { timeout: 4000 });
    if (await categorySelect.inputValue() !== 'books') {
        throw new Error(`${root.name} ${width}px legacy Books category is not directly selectable`);
    }
    pass(`${root.name} ${width}px searchable categories, selector images, and parent/child catalogue filters`);
}

async function assertSellerListingPublish(page, root, width) {
    const sellUrl = route(root, '/veeve/sell.html');
    await page.goto(sellUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#listingAuthGate');
    await page.waitForFunction(() => document.querySelector('#listingAuthGate')?.hidden === false)
        .catch((error) => { throw new Error(`signed-out auth gate did not settle: ${error.message}`); });
    const unauthenticatedState = await page.evaluate(() => ({
        gateVisible: !document.querySelector('#listingAuthGate').hidden,
        formHidden: document.querySelector('#listingFormWrap').hidden,
    }));
    if (!unauthenticatedState.gateVisible || !unauthenticatedState.formHidden) {
        throw new Error(`${root.name} ${width}px seller listing auth gate is not enforced for signed-out visitors`);
    }

    await page.route('**/services/auth.js*', (request) =>
        request.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
    );
    await page.route('**/services/supabaseClient.js*', (request) =>
        request.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
    );
    await page.route('**/services/publicSupabaseConfig.js*', (request) =>
        request.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: 'window.supabaseConfigReady = Promise.resolve();',
        })
    );
    await page.addInitScript(() => {
        const state = {
            products: [],
            productImages: [],
            uploads: [],
            events: [],
            statusWhenMediaWritten: null,
        };
        const user = {
            id: 'seller-listing-regression-user',
            email: 'seller-regression@example.test',
            user_metadata: { full_name: 'Regression Seller' },
        };
        function matches(row, filters) {
            return Object.keys(filters).every((key) => row?.[key] === filters[key]);
        }
        function createQuery(table) {
            let operation = 'select';
            let payload = null;
            const filters = {};
            function execute() {
                if (table === 'products' && operation === 'insert') {
                    const product = { ...payload, id: 'seller-listing-regression-product' };
                    state.products.push(product);
                    state.events.push({ operation: 'product-insert', status: product.status });
                    return { data: { id: product.id }, error: null };
                }
                if (table === 'products' && operation === 'update') {
                    const product = state.products.find((item) => matches(item, filters));
                    if (product) {
                        Object.assign(product, payload);
                        state.events.push({ operation: 'product-update', status: product.status });
                    }
                    return { data: product ? { id: product.id } : null, error: null };
                }
                if (table === 'products' && operation === 'delete') {
                    const index = state.products.findIndex((item) => matches(item, filters));
                    if (index >= 0) state.products.splice(index, 1);
                    return { data: null, error: null };
                }
                if (table === 'products' && operation === 'select') {
                    const product = state.products.find((item) => matches(item, filters));
                    return { data: product ? { ...product } : null, error: null };
                }
                if (table === 'product_images' && operation === 'insert') {
                    const rows = Array.isArray(payload) ? payload : [payload];
                    state.statusWhenMediaWritten = state.products[0]?.status || null;
                    state.productImages.push(...rows.map((row) => ({ ...row })));
                    state.events.push({ operation: 'media-insert', count: rows.length });
                    return { data: null, error: null };
                }
                return { data: null, error: null };
            }
            const query = {
                insert(value) { operation = 'insert'; payload = value; return query; },
                update(value) { operation = 'update'; payload = value; return query; },
                delete() { operation = 'delete'; return query; },
                select() { return query; },
                eq(column, value) { filters[column] = value; return query; },
                single() { return Promise.resolve(execute()); },
                maybeSingle() { return Promise.resolve(execute()); },
                then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); },
            };
            return query;
        }
        const client = {
            from(table) { return createQuery(table); },
            auth: {
                async getSession() { return { data: { session: { access_token: 'test-session' } } }; },
            },
            storage: {
                from(bucket) {
                    return {
                        async upload(path, blob) {
                            state.uploads.push({ bucket, path, type: blob.type, size: blob.size });
                            return { data: { path }, error: null };
                        },
                        getPublicUrl(path) {
                            return { data: { publicUrl: `https://market.example.test/${bucket}/${path}` } };
                        },
                        async remove(paths) {
                            state.uploads = state.uploads.filter((item) =>
                                item.bucket !== bucket || !paths.includes(item.path)
                            );
                            return { data: paths.map((path) => ({ name: path })), error: null };
                        },
                    };
                },
            },
        };
        const auth = {
            async init() {},
            getUser() { return user; },
            getProfile() { return { display_name: 'Regression Seller' }; },
        };
        const clientFacade = { get() { return client; }, isConfigured() { return true; } };
        window.AuthService = auth;
        window.SupabaseClient = clientFacade;
        window.supabaseConfigReady = Promise.resolve();
        window.__sellerListingRegression = state;
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    try {
        await page.waitForFunction(() =>
            document.querySelector('#listingFormWrap')?.hidden === false &&
            document.querySelector('#listingCategory')?.dataset.categoryEnhanced === 'true'
        );
    } catch (error) {
        const formState = await page.evaluate(() => ({
            gateHidden: document.querySelector('#listingAuthGate')?.hidden,
            formHidden: document.querySelector('#listingFormWrap')?.hidden,
            categoryEnhanced: document.querySelector('#listingCategory')?.dataset.categoryEnhanced || null,
            userId: window.AuthService?.getUser?.()?.id || null,
        }));
        throw new Error(`signed-in form did not initialize: ${JSON.stringify(formState)}; ${error.message}`);
    }

    await page.locator('#listingTitle').fill('Regression listing with photo and video');
    await page.locator('#listingPrice').fill('12500');
    await page.locator('#listingDescription').fill('Listing submission test with a selected subcategory and two media files.');
    await page.locator('#listingState').selectOption('Lagos');
    const categoryTrigger = page.locator('#listingCategory').locator('xpath=..').locator('.cs-trigger');
    await categoryTrigger.click();
    const categoryPanel = page.locator('.cs-panel--categories.is-open').last();
    await categoryPanel.locator('[data-cs-search]').fill('Computer Hardware');
    const subcategory = categoryPanel.locator('.cs-category-row[data-value="electronics::computer-hardware"]');
    await subcategory.waitFor({ state: 'visible' });
    await subcategory.click();
    if (await page.locator('#listingCategory').inputValue() !== 'electronics::computer-hardware') {
        throw new Error(`${root.name} ${width}px seller form did not preserve the chosen subcategory ID`);
    }

    await page.locator('#listingImages').setInputFiles([
        {
            name: 'regression-photo.png',
            mimeType: 'image/png',
            buffer: Buffer.from(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/CXcAAAAASUVORK5CYII=',
                'base64',
            ),
        },
        {
            name: 'regression-video.mp4',
            mimeType: 'video/mp4',
            buffer: Buffer.from('000000186674797069736f6d00000000', 'hex'),
        },
    ]);
    await page.locator('#listingPolicyConsent').check();
    await page.evaluate(() => {
        const originalSetTimeout = window.setTimeout.bind(window);
        window.setTimeout = (callback, delay, ...args) => delay === 350
            ? originalSetTimeout(() => {}, delay)
            : originalSetTimeout(callback, delay, ...args);
    });
    await page.locator('#publishListingBtn').click();
    await page.waitForFunction(() =>
        document.querySelector('#listingStatus')?.textContent.includes('Your listing was submitted for review') ||
        document.querySelector('#listingStatus')?.textContent.length > 0
    ).catch(async (error) => {
        const formState = await page.locator('#studentListingForm').evaluate((form) => ({
            valid: form.checkValidity(),
            invalidFields: [...form.elements]
                .filter((element) => element.willValidate && !element.checkValidity())
                .map((element) => ({ id: element.id, name: element.name, value: element.value })),
            files: document.querySelector('#listingImages').files.length,
            selectedCategory: document.querySelector('#listingCategory').value,
        }));
        throw new Error(`seller form did not process its submit: ${JSON.stringify(formState)}; ${error.message}`);
    });
    const statusText = await page.locator('#listingStatus').textContent();
    if (!statusText?.includes('Your listing was submitted for review')) {
        throw new Error(`${root.name} ${width}px seller publish failed: ${statusText}`);
    }

    const readback = await page.evaluate(async () => {
        const result = await window.SupabaseClient.get().from('products')
            .select('id, category, status, moderation_status')
            .eq('id', 'seller-listing-regression-product')
            .single();
        const state = window.__sellerListingRegression;
        return {
            product: result.data,
            error: result.error,
            mediaStatus: state.statusWhenMediaWritten,
            images: state.productImages,
            uploads: state.uploads,
            events: state.events,
        };
    });
    const mediaInsertIndex = readback.events.findIndex((item) => item.operation === 'media-insert');
    const publishIndex = readback.events.findIndex((item) =>
        item.operation === 'product-update' && item.status === 'active'
    );
    if (readback.error || readback.product?.category !== 'electronics::computer-hardware' ||
        readback.product?.status !== 'active' || readback.product?.moderation_status !== 'pending' ||
        readback.mediaStatus !== 'draft' ||
        readback.images.length !== 2 || readback.uploads.length !== 2 ||
        !readback.uploads.some((item) => item.bucket === 'product-images' && item.type === 'image/webp') ||
        !readback.uploads.some((item) => item.bucket === 'product-videos' && item.type === 'video/mp4') ||
        mediaInsertIndex < 0 || publishIndex <= mediaInsertIndex) {
        throw new Error(`${root.name} ${width}px seller category/media read-back failed: ${JSON.stringify(readback)}`);
    }
    pass(`${root.name} ${width}px signed-in seller saves its exact subcategory with image and video media`);
}

async function assertAuth(page, rootName, width) {
    await page.goto(route({ prefix: rootName === 'parent app' ? '' : `/${rootName}` }, '/veeve/auth.html'), {
        waitUntil: 'domcontentloaded',
    });
    await resolveCookieConsent(page);
    await page.waitForSelector('#authRegisterForm', { state: 'attached' });
    await assertLoader(page, rootName, width);
    await page.locator('[data-auth-mode="register"]').click();
    await page.locator('#authRegisterForm').waitFor({ state: 'visible' });

    const labels = await page.locator('label.auth-account-type-option').allTextContents();
    if (labels.length !== 2 ||
        !labels[0].includes('Shop on VelveraHub') ||
        !labels[1].includes('Shop and sell on VelveraHub')) {
        throw new Error(`${rootName} ${width}px auth radio labels are incorrect`);
    }
    if (!(await page.locator('input[name="accountType"][value="customer"]').isChecked())) {
        throw new Error(`${rootName} ${width}px customer radio is not selected by default`);
    }
    if (await page.locator('#authSellerFields').isVisible()) {
        throw new Error(`${rootName} ${width}px seller fields are visible for a customer`);
    }

    await page.locator('label.auth-account-type-option').nth(1).click();
    if (!(await page.locator('input[name="accountType"][value="seller"]').isChecked())) {
        throw new Error(`${rootName} ${width}px seller radio did not select`);
    }
    if (!(await page.locator('#authSellerFields').isVisible())) {
        throw new Error(`${rootName} ${width}px seller fields did not become visible`);
    }
    await page.locator('label.auth-account-type-option').nth(0).click();
    if (await page.locator('#authSellerFields').isVisible()) {
        throw new Error(`${rootName} ${width}px seller fields did not hide`);
    }
    pass(`${rootName} ${width}px auth radio and seller visibility`);

    await assertBottomNavigation(page, rootName, width);
}

async function assertHeaderSearchPolicy(page, root, width) {
    for (const utilityPage of ['account.html', 'auth.html', 'cart.html', 'checkout.html', 'sell.html']) {
        await page.goto(`${baseUrl}${root.prefix}/veeve/${utilityPage}`, {
            waitUntil: 'domcontentloaded',
        });
        await page.waitForSelector('.navbar', { state: 'attached' });
        await page.waitForFunction(() =>
            !document.querySelector('.navbar .search-container')
        );
        if (await page.locator('.navbar .search-container').count()) {
            throw new Error(`${root.name} ${width}px utility page ${utilityPage} still renders the global search bar`);
        }
    }

    await page.goto(`${baseUrl}${root.prefix}/veeve/products.html`, {
        waitUntil: 'domcontentloaded',
    });
    await page.locator('.navbar .search-container').waitFor({ state: 'visible' });
    const categoryControlCount = await page.locator(
        '.navbar .search-container select.category-select, .navbar .search-container .cs-select:has(select.category-select)'
    ).count();
    if (categoryControlCount) {
        throw new Error(`${root.name} ${width}px header search still renders a category dropdown`);
    }
    pass(`${root.name} ${width}px contextual header search`);
}

async function assertFooterBrand(page, rootName, width) {
    await page.waitForFunction(() => {
        const mark = document.querySelector('#siteFooter .footer-brand-mark-image');
        const wordmark = document.querySelector('#siteFooter .footer-brand-wordmark');
        return Boolean(mark?.complete && wordmark?.complete);
    }, null, { timeout: 5000 });
    const branding = await page.evaluate(() => {
        const mark = document.querySelector('#siteFooter .footer-brand-mark-image');
        const wordmark = document.querySelector('#siteFooter .footer-brand-wordmark');
        return {
            markWidth: mark?.naturalWidth || 0,
            markPath: mark ? new URL(mark.currentSrc || mark.src).pathname : '',
            wordmarkWidth: wordmark?.naturalWidth || 0,
        };
    });
    if (!branding.markWidth || branding.markPath === '/' || !branding.wordmarkWidth) {
        throw new Error(`${rootName} ${width}px footer brand images are missing or invalid: ${JSON.stringify(branding)}`);
    }
    await page.locator('#siteFooter .footer-brand-mark-image').evaluate((image) => {
        image.dispatchEvent(new Event('error'));
    });
    await page.waitForFunction(() => {
        const image = document.querySelector('#siteFooter .footer-brand-mark-image');
        return image?.dataset.staticFallback === 'true' &&
            image.complete &&
            image.naturalWidth > 0 &&
            new URL(image.currentSrc || image.src).pathname === '/img/logo.png';
    }, null, { timeout: 5000 });
}

async function assertLocationSelector(page, root, width) {
    await page.goto(route(root, '/'), { waitUntil: 'domcontentloaded' });
    const select = page.locator('#headerLocationSelect');
    await select.waitFor({ state: 'attached' });
    await page.waitForFunction(() => Boolean(window.RegionService?.searchLocations));
    // Keep footer-image failures from preventing this selector-specific
    // regression from exercising its location-navigation checks.
    try {
        await assertFooterBrand(page, root.name, width);
    } catch (error) {
        fail(`${root.name} ${width}px footer brand check during location test — ${error.message}`);
    }
    const trigger = select.locator('xpath=..').locator('.cs-trigger');
    await trigger.click();
    const panel = page.locator('.cs-location-panel.is-open');
    await panel.waitFor({ state: 'visible' });
    const backButton = await panel.locator('.cs-mobile-back').evaluate((button) => {
        const style = getComputedStyle(button);
        const search = button.closest('.cs-mobile-search');
        return {
            display: style.display,
            visibility: style.visibility,
            color: style.color,
            background: search ? getComputedStyle(search).backgroundColor : '',
            animation: style.animationName,
            chevronAnimation: getComputedStyle(button.querySelector('.cs-mobile-chevron svg')).animationName,
            chevronTransform: getComputedStyle(button.querySelector('.cs-mobile-chevron svg')).transform,
            hasSpinnerIcon: Boolean(button.querySelector('.fa-spinner, .fa-spin')),
            width: button.getBoundingClientRect().width,
            height: button.getBoundingClientRect().height,
        };
    });
    if (backButton.display === 'none' || backButton.visibility !== 'visible' ||
        backButton.color !== 'rgb(109, 40, 217)' ||
        backButton.background !== 'rgb(255, 255, 255)' ||
        backButton.animation !== 'none' ||
        backButton.chevronAnimation !== 'none' ||
        backButton.chevronTransform !== 'none' ||
        backButton.hasSpinnerIcon ||
        backButton.width < 16 || backButton.height < 16) {
        throw new Error(`${root.name} ${width}px location-search back button is not visible: ${JSON.stringify(backButton)}`);
    }
    const search = panel.locator('.cs-mobile-search input');
    const query = root.name === 'velverahub-uk' ? 'London' : 'Gwarinpa';
    await search.fill(query);
    const result = panel.locator('.cs-location-search-result').filter({ hasText: query }).first();
    await result.waitFor({ state: 'visible' });
    await result.click();

    const selectedLocation = await page.evaluate(() => ({
        location: window.RegionService.location,
        place: window.RegionService.place?.name || null
    }));
    if (root.name === 'velverahub-uk') {
        if (selectedLocation.location !== 'London') {
            throw new Error(`${root.name} ${width}px location search did not select the matching UK region`);
        }
    } else if (selectedLocation.location !== 'FCT (Abuja)' || selectedLocation.place !== 'Gwarinpa') {
        throw new Error(`${root.name} ${width}px location search did not select the matching Abuja district`);
    }

    if (root.name !== 'velverahub-uk') {
        await trigger.click();
        await panel.waitFor({ state: 'visible' });
        await panel.locator('.cs-option[data-value="FCT (Abuja)"]').click();
        const hierarchy = await panel.innerText();
        if (!hierarchy.includes('Whole Abuja (FCT)') ||
            !hierarchy.includes('Central Business District') ||
            !hierarchy.includes('POPULAR') || !hierarchy.includes('OTHER')) {
            throw new Error(`${root.name} ${width}px location selector is missing its Abuja parent/area hierarchy`);
        }
        await panel.locator('.cs-mobile-back').click();
        const returnedToStates = await panel.innerText();
        const backAfterNavigation = await panel.locator('.cs-mobile-back').evaluate((button) => ({
            processing: button.classList.contains('is-processing'),
            ariaBusy: button.getAttribute('aria-busy'),
            spinner: Boolean(button.querySelector('.fa-spinner, .fa-spin')),
            chevronPath: button.querySelector('.cs-mobile-chevron svg path')?.getAttribute('d') || '',
            animation: getComputedStyle(button.querySelector('.cs-mobile-chevron svg')).animationName
        }));
        if (!(returnedToStates.includes('Abuja (FCT)') || returnedToStates.includes('FCT (Abuja)')) ||
            returnedToStates.includes('Whole Abuja (FCT)') ||
            backAfterNavigation.processing ||
            backAfterNavigation.ariaBusy !== null ||
            backAfterNavigation.spinner ||
            !backAfterNavigation.chevronPath ||
            backAfterNavigation.animation !== 'none') {
            throw new Error(`${root.name} ${width}px location back action did not return to states with a static chevron: ${JSON.stringify(backAfterNavigation)}`);
        }
    }

    while (await panel.count()) {
        await panel.locator('.cs-mobile-back').click();
    }
    await page.goto(route(root, '/veeve/products.html'), { waitUntil: 'domcontentloaded' });
    const filterSelect = page.locator('#locationSelect');
    await filterSelect.waitFor({ state: 'attached' });
    const filterTrigger = filterSelect.locator('xpath=..').locator('.cs-trigger');
    await filterTrigger.click();
    const filterPanel = page.locator('.cs-panel--searchable.is-open').last();
    await filterPanel.waitFor({ state: 'visible' });
    const filterSearch = filterPanel.locator('[data-cs-search]');
    await filterSearch.fill(root.name === 'velverahub-uk' ? 'London' : 'FCT');
    const matchingOptions = await filterPanel.locator('.cs-option:not([hidden])').allTextContents();
    if (!matchingOptions.some((option) =>
        root.name === 'velverahub-uk' ? option.includes('London') : option.includes('FCT (Abuja)')
    )) {
        throw new Error(`${root.name} ${width}px catalogue location selector did not search its regional choices`);
    }
    await page.keyboard.press('Escape');

    if (width === 430) {
        await page.setViewportSize({ width: 1024, height: 800 });
        await trigger.click();
        await panel.waitFor({ state: 'visible' });
        await panel.locator('.cs-mobile-search input').fill(query);
        await panel.locator('.cs-location-search-result').filter({ hasText: query }).first()
            .waitFor({ state: 'visible' });
        await page.keyboard.press('Escape');
        if (await panel.count()) await trigger.click({ force: true });
        await page.setViewportSize({ width, height: 800 });
    }
    pass(`${root.name} ${width}px searchable regional locations and parent/area navigation`);
}

async function assertProductActionRow(page, root, width) {
    await page.goto(`${baseUrl}${root.prefix}/veeve/product.html`, {
        waitUntil: 'domcontentloaded',
    });
    const target = page.locator('#productDetail');
    await target.waitFor({ state: 'attached' });
    await target.evaluate((node) => {
        node.innerHTML = `
            <section class="product-detail-copy">
                <div class="product-detail-title-row">
                    <div class="product-detail-title-copy"><p class="eyebrow">Test listing</p><h1>Solar Power Generator for Mobile Share Test</h1></div>
                    <button class="product-share-button" id="shareProductButton" type="button" aria-label="Copy product link" title="Copy product link"><i aria-hidden="true"></i><span data-share-label>Share</span></button>
                </div>
                <span id="productShareStatus" role="status" aria-live="polite"></span>
                <div class="product-action-row">
                    <label class="quantity-control">Qty <input type="number" value="1" aria-label="Quantity"></label>
                    <button class="btn btn-primary" type="button"><i aria-hidden="true"></i><span>Add to cart</span></button>
                    <button class="btn btn-secondary" type="button"><i aria-hidden="true"></i><span>Save</span></button>
                </div>
            </section>`;
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
        Object.defineProperty(document, 'execCommand', {
            configurable: true,
            value(command) {
                window.__mobileCopiedUrl = command === 'copy' ? document.activeElement?.value : '';
                return command === 'copy';
            }
        });
        const product = {
            id: '123e4567-e89b-42d3-a456-426614174000',
            title: 'Solar Power Generator for Mobile Share Test',
            description: 'A responsive layout fixture.'
        };
        const shareUrl = window.VelveraProductSharing.canonicalUrl(product.id);
        window.VelveraProductSharing.setProductMetadata({
            product,
            price: '₦90,000',
            amount: '90000',
            currency: 'NGN',
            url: shareUrl,
            imageUrl: `${window.location.origin}/img/logo.png`
        });
        window.VelveraProductSharing.bindShareButton(
            document.getElementById('shareProductButton'),
            { title: product.title, text: '₦90,000', url: shareUrl }
        );
    });
    const shareLayout = await page.locator('.product-detail-title-row').evaluate((row) => {
        const rowRect = row.getBoundingClientRect();
        const button = row.querySelector('#shareProductButton');
        const buttonRect = button.getBoundingClientRect();
        return {
            rowLeft: rowRect.left,
            rowRight: rowRect.right,
            buttonLeft: buttonRect.left,
            buttonRight: buttonRect.right,
            buttonWidth: buttonRect.width,
            buttonHeight: buttonRect.height,
            buttonText: button.innerText.trim()
        };
    });
    if (shareLayout.buttonWidth < 72 || shareLayout.buttonHeight < 40 ||
        shareLayout.rowLeft < 0 || shareLayout.rowRight > width + 1 ||
        shareLayout.buttonLeft < shareLayout.rowLeft || shareLayout.buttonRight > shareLayout.rowRight) {
        throw new Error(`${root.name} ${width}px product share control is clipped or unusable`);
    }
    await page.locator('#shareProductButton').click();
    await page.waitForFunction(() => window.__mobileCopiedUrl && document.getElementById('productShareStatus')?.textContent.includes('copied'));
    const shareMetadata = await page.evaluate(() => ({
        copied: window.__mobileCopiedUrl,
        canonical: document.querySelector('link[rel="canonical"]')?.href,
        ogTitle: document.querySelector('meta[property="og:title"]')?.content,
        ogImage: document.querySelector('meta[property="og:image"]')?.content
    }));
    if (!shareMetadata.copied.endsWith('/veeve/product.html?id=123e4567-e89b-42d3-a456-426614174000') ||
        shareMetadata.canonical !== shareMetadata.copied ||
        !shareMetadata.ogTitle.includes('Solar Power Generator') ||
        !shareMetadata.ogImage.endsWith('/img/logo.png')) {
        throw new Error(`${root.name} ${width}px product share link or page metadata is incorrect`);
    }
    const layout = await page.locator('.product-action-row').evaluate((row) => {
        const rowRect = row.getBoundingClientRect();
        const controls = [...row.children].map((control) => {
            const rect = control.getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width };
        });
        return {
            rowWidth: rowRect.width,
            scrollWidth: row.scrollWidth,
            clientWidth: row.clientWidth,
            controls,
        };
    });
    if (layout.controls.length !== 3 ||
        layout.controls.some((control) => control.width < 40 || Math.abs(control.top - layout.controls[0].top) > 1.5 ||
            Math.abs(control.bottom - layout.controls[0].bottom) > 1.5 || control.left < 0 ||
            control.right > width + 1)) {
        throw new Error(`${root.name} ${width}px product quantity/cart/save controls do not share one usable row`);
    }
    if (layout.scrollWidth > layout.clientWidth + 1) {
        throw new Error(`${root.name} ${width}px product action row overflows horizontally`);
    }
    pass(`${root.name} ${width}px product quantity/cart/save row`);
}

async function assertCheckoutFields(page, root, width) {
    await page.addInitScript(() => {
        localStorage.setItem('velverahub_cart', JSON.stringify([{
            product: {
                id: 'mobile-regression-product',
                title: 'Mobile regression product',
                price: 10,
                stock: 10,
                image: '/img/product-placeholder.svg'
            },
            quantity: 1
        }]));
    });
    await page.goto(`${baseUrl}${root.prefix}/veeve/checkout.html`, {
        waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector('#email', { state: 'visible' });
    await page.waitForTimeout(150);

    const fields = ['#email', '#firstName', '#lastName', '#phone', '#address', '#address2', '#city', '#zip'];
    for (const selector of fields) {
        const field = page.locator(selector);
        if (!(await field.isVisible())) {
            throw new Error(`${root.name} ${width}px checkout field ${selector} is not visible`);
        }
    }
    await page.locator('#email').fill('mobile@example.test');
    await page.locator('#firstName').fill('Mobile');
    await page.locator('#lastName').fill('Buyer');
    await page.locator('#phone').fill('+234 800 000 0000');
    await page.locator('#address').fill('12 Test Street');
    await page.locator('#city').fill('Lagos');
    await page.locator('#zip').fill('100001');

    const layout = await page.evaluate(() => ({
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        fields: [...document.querySelectorAll('.checkout-form input:not([type="checkbox"]), .checkout-form textarea, .checkout-form .cs-trigger')]
            .filter((node) => node.offsetParent !== null)
            .map((node) => {
                const rect = node.getBoundingClientRect();
                return { left: rect.left, right: rect.right, width: rect.width, height: rect.height };
            })
    }));
    if (layout.documentWidth > layout.viewportWidth + 1 ||
        layout.fields.some((field) => field.width < 40 || field.height < 36 ||
            field.left < -1 || field.right > layout.viewportWidth + 1)) {
        throw new Error(`${root.name} ${width}px checkout fields overflow or are too small to use`);
    }

    const triggers = page.locator('.checkout-form .cs-select .cs-trigger');
    if (await triggers.count() < 2) {
        throw new Error(`${root.name} ${width}px checkout state/country dropdowns were not enhanced`);
    }
    for (let index = 0; index < await triggers.count(); index += 1) {
        const trigger = triggers.nth(index);
        await trigger.click();
        const panel = page.locator('.cs-panel.is-open').last();
        await panel.waitFor({ state: 'visible' });
        const before = (await trigger.locator('.cs-trigger-label').innerText()).trim();
        await page.mouse.wheel(0, 180);
        await page.waitForTimeout(50);
        const after = (await trigger.locator('.cs-trigger-label').innerText()).trim();
        if (before !== after) {
            throw new Error(`${root.name} ${width}px checkout dropdown ${index} lost its value while scrolling`);
        }
        await page.keyboard.press('Escape');
        if (await trigger.getAttribute('aria-expanded') !== 'false') {
            throw new Error(`${root.name} ${width}px checkout dropdown ${index} did not close with Escape`);
        }
        await trigger.click();
        await panel.waitFor({ state: 'visible' });
        const isFullScreenPanel = await panel.evaluate((node) => node.getBoundingClientRect().width >= window.innerWidth - 1);
        await page.mouse.click(2, 2);
        if (isFullScreenPanel) {
            await page.keyboard.press('Escape');
        }
        if (await trigger.getAttribute('aria-expanded') !== 'false') {
            throw new Error(`${root.name} ${width}px checkout dropdown ${index} did not close outside the panel`);
        }
    }
    pass(`${root.name} ${width}px checkout fields and dropdowns`);
}

async function assertSellerDynamicForm(page, root, width) {
    await page.goto(`${baseUrl}${root.prefix}/veeve/seller.html?mobile-test=1`, {
        waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector('#addProductModal', { state: 'attached' });
    await page.waitForFunction(() => Boolean(window.__VelveraSellerMobileTest?.openProductModal));
    await page.evaluate(() => window.__VelveraSellerMobileTest.openProductModal());
    const modal = page.locator('#addProductModal');
    await modal.waitFor({ state: 'visible' });
    await page.waitForTimeout(100);

    const modalLayout = await modal.locator('.modal-container').evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth };
    });
    if (modalLayout.left < -1 || modalLayout.right > width + 1 || modalLayout.scrollWidth > modalLayout.clientWidth + 1) {
        throw new Error(`${root.name} ${width}px seller product modal overflows horizontally`);
    }

    const triggers = modal.locator('.cs-select .cs-trigger');
    if (await triggers.count() < 4) {
        throw new Error(`${root.name} ${width}px seller product form did not render its dynamic dropdowns`);
    }
    for (const selector of ['#productDeliveryPickup', '#productDeliveryLocal', '#productDeliveryRegional', '#productDeliveryNotes', '#promoteCurrentProduct']) {
        if (!(await modal.locator(selector).isVisible())) {
            throw new Error(`${root.name} ${width}px seller product form is missing ${selector}`);
        }
    }
    if (!(await modal.locator('#productDeliveryPickup').isChecked()) ||
        !(await modal.locator('#promoteCurrentProduct').isDisabled())) {
        throw new Error(`${root.name} ${width}px seller form defaults are incorrect`);
    }
    const imageInput = modal.locator('#productImages');
    if (await imageInput.getAttribute('accept') !== 'image/jpeg,image/png,image/webp') {
        throw new Error(`${root.name} ${width}px seller upload picker does not match its supported image types`);
    }
    const uploadGuidance = await modal.locator('#imageUploadArea').innerText();
    if (!uploadGuidance.toLowerCase().includes('administrator') || !uploadGuidance.includes('40 MiB')) {
        throw new Error(`${root.name} ${width}px seller upload limits are not disclosed next to the picker`);
    }
    for (let index = 0; index < await triggers.count(); index += 1) {
        const trigger = triggers.nth(index);
        await trigger.click();
        const panel = page.locator('.cs-panel.is-open').last();
        await panel.waitFor({ state: 'visible' });
        await page.keyboard.press('Escape');
        if (await trigger.getAttribute('aria-expanded') !== 'false') {
            throw new Error(`${root.name} ${width}px seller dropdown ${index} did not close with Escape`);
        }
    }

    const locationTrigger = triggers.nth(1);
    await locationTrigger.click();
    const locationPanel = page.locator('.cs-panel.is-open').last();
    await locationPanel.locator('.cs-option:not(.is-disabled)').first().click();
    await page.waitForTimeout(50);
    if (!(await modal.locator('#productSchool option').count())) {
        throw new Error(`${root.name} ${width}px seller location change did not repopulate the school field`);
    }
    await modal.locator('#cancelAddProduct').click();
    if (await modal.evaluate((node) => node.classList.contains('active'))) {
        throw new Error(`${root.name} ${width}px seller product modal did not close`);
    }
    pass(`${root.name} ${width}px seller dynamic product form`);
}

async function assertShopOwnerCategories(page, width) {
    await page.goto(`${baseUrl}/shop-owner/index.html?mobile-test=1`, {
        waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector('#productCategoryFilter', { state: 'attached' });
    await page.waitForFunction(() => Boolean(
        window.VelveraCategories?.categories?.length &&
        document.querySelector('#productCategory')?.dataset.categoryEnhanced === 'true'
    ));
    await page.locator('#addProductModal').evaluate((modal) => modal.classList.add('active'));
    await page.evaluate(() => window.CustomSelect.refresh(document.querySelector('#productCategory')));
    const deliverySelectors = ['#productDeliveryPickup', '#productDeliveryLocal', '#productDeliveryRegional', '#productDeliveryNotes', '#promoteCurrentProduct'];
    for (const selector of deliverySelectors) {
        await page.locator('#addProductModal').locator(selector).waitFor({ state: 'visible' });
        if (!(await page.locator('#addProductModal').locator(selector).isVisible())) {
            throw new Error(`shop-owner ${width}px product form is missing ${selector}`);
        }
    }
    await assertCategoryTaxonomy(page, '#productCategory', 'shop-owner', width);
    await selectSearchableCategory(
        page, '#productCategory', 'Computer Hardware',
        'electronics::computer-hardware', 'shop-owner', width
    );

    await page.evaluate(() => {
        const secondElectronicsChild = window.VelveraCategories.getValues('electronics')
            .find((value) => value !== 'electronics' && value !== 'electronics::computer-hardware');
        window.__VelveraSellerMobileTest.setProducts([
            { id: 'cat-a', title: 'Desktop computer', category: 'electronics::computer-hardware', price: 1, stock: 1, status: 'active' },
            { id: 'cat-b', title: 'Other electronics', category: secondElectronicsChild, price: 1, stock: 1, status: 'active' },
            { id: 'cat-c', title: 'Dress', category: 'fashion::womens-clothing', price: 1, stock: 1, status: 'active' }
        ]);
    });
    await page.locator('#productCategoryFilter').evaluate((select) => {
        select.value = 'electronics';
        select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    if (await page.locator('#productsTableBody tr').count() !== 2) {
        throw new Error(`shop-owner ${width}px parent category did not include its child products`);
    }
    await page.locator('#productCategoryFilter').evaluate((select) => {
        select.value = 'electronics::computer-hardware';
        select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const childRows = await page.locator('#productsTableBody tr').allTextContents();
    if (childRows.length !== 1 || !childRows[0].includes('Desktop computer')) {
        throw new Error(`shop-owner ${width}px subcategory did not filter to its matching product`);
    }
    pass(`shop-owner ${width}px searchable category selector and parent/child product filters`);
}

async function assertDropdowns(page, rootName, width) {
    await page.goto(route({ prefix: rootName === 'parent app' ? '' : `/${rootName}` }, '/veeve/products.html'), {
        waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector('.cs-select .cs-trigger');
    await page.waitForTimeout(150);
    await assertLoader(page, rootName, width);

    // The header location picker has hierarchical state navigation and is
    // covered by assertLocationSelector; keep this flat-dropdown loop to
    // standard selectors so a state tap is not mistaken for an option pick.
    const triggers = page.locator('.cs-select:not(:has(#headerLocationSelect)) .cs-trigger');
    const triggerCount = await triggers.count();
    if (!triggerCount) throw new Error(`${rootName} ${width}px did not enhance any dropdowns`);

    for (let index = 0; index < triggerCount; index += 1) {
        const trigger = triggers.nth(index);
        if (!(await trigger.isVisible())) continue;

        await trigger.click();
        const wrapper = trigger.locator('..');
        const panel = page.locator('.cs-panel.is-open').last();
        await panel.waitFor({ state: 'visible' });

        if (await panel.locator('.cs-category-row').count()) {
            await page.keyboard.press('Escape');
            if (await trigger.getAttribute('aria-expanded') !== 'false') {
                throw new Error(`${rootName} ${width}px category selector did not close with Escape`);
            }
            continue;
        }

        const choice = panel.locator('.cs-option:not(.is-disabled):not(.is-selected)').first();
        if (!(await choice.count())) {
            await page.keyboard.press('Escape');
            continue;
        }
        await choice.click();
        const selectedText = (await trigger.locator('.cs-trigger-label').innerText()).trim();
        if (!selectedText) {
            throw new Error(`${rootName} ${width}px dropdown ${index} lost its selected label`);
        }

        await trigger.click();
        await panel.waitFor({ state: 'visible' });
        const beforeScrollLabel = (await trigger.locator('.cs-trigger-label').innerText()).trim();
        const beforeRect = await trigger.boundingBox();
        await page.evaluate(() => window.scrollBy(0, 180));
        await page.waitForTimeout(50);
        const afterScrollLabel = (await trigger.locator('.cs-trigger-label').innerText()).trim();
        if (afterScrollLabel !== beforeScrollLabel) {
            throw new Error(`${rootName} ${width}px dropdown ${index} lost selection after scroll`);
        }
        if (beforeRect && (await trigger.boundingBox())?.width !== beforeRect.width) {
            throw new Error(`${rootName} ${width}px dropdown ${index} detached from its trigger width`);
        }
        await page.keyboard.press('Escape');
        if (await trigger.getAttribute('aria-expanded') !== 'false') {
            throw new Error(`${rootName} ${width}px dropdown ${index} did not close with Escape`);
        }

        await trigger.click();
        await panel.waitFor({ state: 'visible' });
        const isFullScreenPanel = await panel.evaluate((node) => {
            const rect = node.getBoundingClientRect();
            return rect.width >= window.innerWidth - 1 && rect.height >= window.innerHeight - 1;
        });
        await page.mouse.click(2, 2);
        if (!isFullScreenPanel && await trigger.getAttribute('aria-expanded') !== 'false') {
            throw new Error(`${rootName} ${width}px dropdown ${index} did not close outside click`);
        }
        if (isFullScreenPanel) {
            await page.keyboard.press('Escape');
            if (await trigger.getAttribute('aria-expanded') !== 'false') {
                throw new Error(`${rootName} ${width}px full-screen dropdown did not close after outside-click probe`);
            }
        }
        // Keep the wrapper reference in the test so a future portal change
        // cannot accidentally make the trigger and panel come from separate
        // enhancement instances.
        if (!(await wrapper.evaluate((node) => node.classList.contains('cs-select')))) {
            throw new Error(`${rootName} ${width}px dropdown wrapper contract changed`);
        }
    }
    pass(`${rootName} ${width}px dropdown open/select/scroll/Escape/outside-click`);
}

async function assertAdminRoot(page, width) {
    await page.goto(route(adminRoot, '/?mobile-test=1'), { waitUntil: 'domcontentloaded' });
    await resolveCookieConsent(page);
    const adminSurface = await page.evaluate(() => ({
        hasAdminShell: Boolean(document.querySelector('.admin-shell')),
        hasLoginPanel: Boolean(document.querySelector('#adminAuthPanel')),
        hasVerificationQueue: Boolean(document.querySelector('#adminWorkspace')),
        hasQueueFilter: Boolean(document.querySelector('#queueStatus')),
        storefrontAuth: Boolean(document.querySelector('#authAccountType')),
        storefrontNav: Boolean(document.querySelector('.mobile-bottom-nav')),
    }));
    if (!adminSurface.hasAdminShell || !adminSurface.hasLoginPanel ||
        !adminSurface.hasVerificationQueue || !adminSurface.hasQueueFilter) {
        throw new Error(`${adminRoot.name} ${width}px admin sign-in/review surface is incomplete`);
    }
    if (adminSurface.storefrontAuth || adminSurface.storefrontNav) {
        throw new Error(`${adminRoot.name} ${width}px unexpectedly rendered storefront-only auth/nav`);
    }
    pass(`${adminRoot.name} ${width}px dashboard root contract`);
}

async function assertAdminDynamicForm(page, width) {
    const hookAvailable = await page.evaluate(() => Boolean(window.__VelveraAdminMobileTest?.renderApplication));
    if (!hookAvailable) {
        throw new Error(`${adminRoot.name} ${width}px admin dynamic-form test hook is unavailable`);
    }
    await page.evaluate(() => {
        document.querySelector('#adminAuthPanel').hidden = true;
        document.querySelector('#adminWorkspace').hidden = false;
        const application = {
            submission_id: 'mobile-regression-submission',
            shop_name: 'Mobile Test Shop',
            shop_slug: 'mobile-test-shop',
            verification_status: 'pending',
            submitted_at: '2026-01-01T00:00:00.000Z',
            owner_email: 'owner@example.test',
            legal_name: 'Mobile Test Owner',
            business_name: 'Mobile Test Shop',
            business_type: 'retail',
            city: 'Lagos',
            country: 'Nigeria',
            document_paths: [],
            review_history: []
        };
        document.querySelector('#verificationList').append(window.__VelveraAdminMobileTest.renderApplication(application));
    });
    const form = page.locator('.review-actions').last();
    await form.waitFor({ state: 'visible' });
    const layout = await form.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return {
            left: rect.left,
            right: rect.right,
            width: rect.width,
            scrollWidth: node.scrollWidth,
            clientWidth: node.clientWidth,
            buttons: [...node.querySelectorAll('button')].map((button) => {
                const buttonRect = button.getBoundingClientRect();
                return { left: buttonRect.left, right: buttonRect.right, width: buttonRect.width, height: buttonRect.height };
            })
        };
    });
    if (layout.left < -1 || layout.right > width + 1 || layout.scrollWidth > layout.clientWidth + 1 ||
        layout.buttons.some((button) => button.width < 40 || button.height < 40 ||
            button.left < -1 || button.right > width + 1)) {
        throw new Error(`${adminRoot.name} ${width}px dynamic review form overflows or has unusable controls`);
    }
    await form.locator('[data-review-decision="request_resubmission"]').click();
    if (await form.locator('.review-action-message').getAttribute('hidden') !== null) {
        throw new Error(`${adminRoot.name} ${width}px dynamic review form did not validate its required note`);
    }
    pass(`${adminRoot.name} ${width}px dynamic review form`);
}

async function assertShopPortalMobile(page, width) {
    await page.goto(`${baseUrl}/velverahub-shop/`, { waitUntil: 'domcontentloaded' });
    await resolveCookieConsent(page);
    await page.waitForSelector('[data-surface-auth-mode="register"]', { state: 'attached' });
    await page.locator('[data-surface-auth-mode="register"]').click();
    await page.locator('#surfaceRegisterForm').waitFor({ state: 'visible' });
    if (!(await page.locator('#surfaceRegisterForm input[name="email"]').count())) {
        throw new Error(`velverahub-shop ${width}px account creation form is missing its email field`);
    }

    await page.locator('[data-surface-auth-mode="login"]').click();
    const siteFooter = page.locator('#siteFooter');
    await siteFooter.waitFor({ state: 'attached' });
    await assertFooterBrand(page, 'velverahub-shop', width);
    const footerLayout = await siteFooter.evaluate((footer) => {
        const toggle = footer.querySelector('[data-footer-toggle]');
        const dashboard = document.querySelector('.dashboard-container');
        const mainContent = document.querySelector('.main-content');
        return {
            hasLinks: Boolean(footer.querySelector('.footer-links .footer-col a')),
            hasLegalAndSocial: Boolean(
                footer.querySelector('.footer-col a[href*="terms"]') &&
                footer.querySelector('.footer-social')
            ),
            background: getComputedStyle(footer).backgroundColor,
            footerTop: footer.getBoundingClientRect().top,
            footerBottom: footer.getBoundingClientRect().bottom,
            mainContentBottom: mainContent?.getBoundingClientRect().bottom ?? -1,
            dashboardContentBottom: document.querySelector('#dashboardContent')?.getBoundingClientRect().bottom ?? -1,
            authContentBottom: document.querySelector('.admin-access-state')?.getBoundingClientRect().bottom ?? -1,
            dashboardExists: Boolean(dashboard),
            hasOrphanRegionModal: Boolean(document.querySelector('#regionModal')),
            toggleExpanded: toggle?.getAttribute('aria-expanded'),
            contentHidden: footer.querySelector('[data-footer-content]')?.getAttribute('aria-hidden'),
        };
    });
    if (!footerLayout.hasLinks || !footerLayout.hasLegalAndSocial) {
        throw new Error(`velverahub-shop ${width}px shared marketplace footer is incomplete`);
    }
    if (footerLayout.background !== 'rgb(109, 40, 217)') {
        throw new Error(`velverahub-shop ${width}px marketplace footer stylesheet is missing or not applied`);
    }
    if (!footerLayout.dashboardExists || footerLayout.footerTop < footerLayout.dashboardContentBottom - 1) {
        throw new Error(`velverahub-shop ${width}px marketplace footer is not below the dashboard`);
    }
    if (Math.abs(footerLayout.footerBottom - footerLayout.mainContentBottom) > 1) {
        throw new Error(`velverahub-shop ${width}px short dashboard leaves a gap after the marketplace footer`);
    }
    if (footerLayout.authContentBottom > footerLayout.dashboardContentBottom + 1) {
        throw new Error(`velverahub-shop ${width}px seller sign-in content overlaps the marketplace footer`);
    }
    if (footerLayout.hasOrphanRegionModal) {
        throw new Error(`velverahub-shop ${width}px injected an unstyled region dialog without a storefront navbar`);
    }
    if (footerLayout.toggleExpanded !== 'false' || footerLayout.contentHidden !== 'true') {
        throw new Error(`velverahub-shop ${width}px mobile footer did not start collapsed accessibly`);
    }
    const footerToggle = siteFooter.locator('[data-footer-toggle]');
    await footerToggle.scrollIntoViewIfNeeded();
    await footerToggle.click();
    await page.waitForFunction(
        () => document.querySelector('#siteFooter [data-footer-toggle]')?.getAttribute('aria-expanded') === 'true',
        null,
        { timeout: 1500 },
    );
    if (await siteFooter.locator('[data-footer-content]').getAttribute('aria-hidden') !== 'false') {
        throw new Error(`velverahub-shop ${width}px marketplace footer did not expand`);
    }

    await page.locator('#mobileToggle').click();
    await page.waitForFunction(
        () => Math.abs(document.querySelector('#sidebar')?.getBoundingClientRect().left ?? -999) < 1,
        null,
        { timeout: 1500 },
    );
    const footer = await page.locator('#sidebar').evaluate((sidebar) => {
        const sidebarRect = sidebar.getBoundingClientRect();
        const footerRect = sidebar.querySelector('.sidebar-footer').getBoundingClientRect();
        return {
            sidebarLeft: sidebarRect.left,
            sidebarRight: sidebarRect.right,
            sidebarBottom: sidebarRect.bottom,
            footerBottom: footerRect.bottom,
            viewportHeight: window.innerHeight,
        };
    });
    if (footer.sidebarLeft < -1 || footer.sidebarRight > width + 1 ||
        footer.sidebarBottom > footer.viewportHeight + 1 ||
        Math.abs(footer.footerBottom - footer.sidebarBottom) > 1) {
        throw new Error(`velverahub-shop ${width}px sidebar footer is clipped or detached from the viewport`);
    }
    pass(`velverahub-shop ${width}px registration and pinned sidebar footer`);
}

async function run() {
    if (!suppliedBaseUrl) {
        server = spawn(process.execPath, ['server.js'], {
            env: { ...process.env, PORT: String(port), NODE_ENV: 'test' },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        server.stdout.on('data', () => {});
        server.stderr.on('data', () => {});
        await waitForServer(baseUrl);
    }

    for (const width of viewports) {
        for (const root of storefrontRoots) {
            const browser = await launchBrowser();
            const page = await browser.newPage({ viewport: { width, height: 800 } });
            page.setDefaultTimeout(8000);
            const errors = [];
            page.on('pageerror', (error) => errors.push(error.message));
            page.on('console', (message) => {
                if (message.type() === 'error') errors.push(message.text());
            });
            try {
                await assertAuth(page, root.name, width);
                await assertHeaderSearchPolicy(page, root, width);
                await assertCategoryFiltering(page, root, width);
                await assertLocationSelector(page, root, width);
                await assertDropdowns(page, root.name, width);
                await assertProductActionRow(page, root, width);
                await assertCheckoutFields(page, root, width);
                await assertSellerDynamicForm(page, root, width);
                if (width === 390) await assertSellerListingPublish(page, root, width);
                if (errors.length) throw new Error(`console errors: ${errors.join(' | ')}`);
            } catch (error) {
                fail(`${root.name} ${width}px — ${error.message}`);
            } finally {
                await browser.close();
            }
        }

        if (runAdminRoot) {
            const adminBrowser = await launchBrowser();
            const adminPage = await adminBrowser.newPage({ viewport: { width, height: 800 } });
            adminPage.setDefaultTimeout(8000);
            try {
                await assertAdminRoot(adminPage, width);
                await assertAdminDynamicForm(adminPage, width);
            } catch (error) {
                fail(`${adminRoot.name} ${width}px — ${error.message}`);
            } finally {
                await adminBrowser.close();
            }
        }

        if (runShopRoot) {
            const shopBrowser = await launchBrowser();
            const shopPage = await shopBrowser.newPage({ viewport: { width, height: 800 } });
            shopPage.setDefaultTimeout(8000);
            try {
                await assertShopPortalMobile(shopPage, width);
                await assertShopOwnerCategories(shopPage, width);
            } catch (error) {
                fail(`velverahub-shop ${width}px — ${error.message}`);
            } finally {
                await shopBrowser.close();
            }
        }
    }

    if (runDesktop) {
        for (const root of storefrontRoots) {
            const browser = await launchBrowser();
            const page = await browser.newPage({ viewport: { width: desktopWidth, height: 900 } });
            page.setDefaultTimeout(8000);
            const errors = [];
            page.on('pageerror', (error) => errors.push(error.message));
            page.on('console', (message) => {
                if (message.type() === 'error') errors.push(message.text());
            });
            try {
                await page.goto(route(root, '/'), { waitUntil: 'domcontentloaded' });
                await resolveCookieConsent(page);
                await assertCategoryFiltering(page, root, desktopWidth);
                await assertSellerListingPublish(page, root, desktopWidth);
                if (errors.length) throw new Error(`console errors: ${errors.join(' | ')}`);
            } catch (error) {
                fail(`${root.name} ${desktopWidth}px — ${error.message}`);
            } finally {
                await browser.close();
            }
        }
    }

    if (failures) process.exitCode = 1;
}

try {
    await run();
} finally {
    if (server) {
        const stopped = waitForExit(server);
        server.kill('SIGTERM');
        await Promise.race([stopped, new Promise((resolve) => setTimeout(resolve, 1000))]);
    }
}