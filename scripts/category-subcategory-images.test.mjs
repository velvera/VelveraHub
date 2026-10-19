import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const window = {};
const document = {
    body: null,
    querySelectorAll: () => []
};
class MutationObserver {
    observe() {}
}

vm.runInNewContext(
    fs.readFileSync(path.join(root, 'assets/js/services/categories.js'), 'utf8'),
    { window, document, MutationObserver }
);

const categories = window.VelveraCategories.categories;
const imageCategories = categories.filter((category) => category.subcategoryImageDirectory);
const expectedCategoryIds = [
    'baby-kids',
    'beauty',
    'business-industry',
    'commercial-equipment-tools',
    'electronics',
    'fashion',
    'food-agriculture-farming',
    'home',
    'leisure-activities'
];
const expectedImageCounts = {
    'baby-kids': 10,
    beauty: 10,
    'business-industry': 2,
    'commercial-equipment-tools': 10,
    electronics: 15,
    fashion: 4,
    'food-agriculture-farming': 5,
    home: 7,
    'leisure-activities': 9
};
assert.deepEqual(
    Array.from(imageCategories, (category) => category.id).sort(),
    expectedCategoryIds.sort(),
    'subcategory thumbnails should be enabled only for parent categories with supplied images'
);

let imageCount = 0;
const expectedFiles = new Set();
for (const category of imageCategories) {
    let categoryImageCount = 0;
    for (const subcategory of category.subcategories) {
        const imageUrl = window.VelveraCategories.getSubcategoryImage(category.id, subcategory);
        if (!imageUrl) continue;
        const imagePath = path.join(root, imageUrl.replace(/^\//, ''));
        assert.ok(fs.existsSync(imagePath), `missing image file: ${imageUrl}`);
        expectedFiles.add(path.relative(root, imagePath));
        imageCount += 1;
        categoryImageCount += 1;
    }
    assert.equal(
        categoryImageCount,
        expectedImageCounts[category.id],
        `${category.name} should map only the supplied subcategory images`
    );
}

assert.equal(imageCount, 72, 'the nine supplied categories should cover 72 subcategories');
assert.equal(expectedFiles.size, imageCount, 'each subcategory should have its own image');

function collectImages(directory) {
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const fullPath = path.join(directory, entry.name);
        return entry.isDirectory()
            ? collectImages(fullPath)
            : /\.(png|jpe?g|webp)$/i.test(entry.name)
                ? [path.relative(root, fullPath)]
                : [];
    });
}

const actualFiles = collectImages(path.join(root, 'img/subcategories'));
assert.deepEqual(actualFiles.sort(), Array.from(expectedFiles).sort(), 'subcategory folder should contain only mapped images');

for (const app of ['velverahub-admin', 'velverahub-ng', 'velverahub-shop', 'velverahub-uk']) {
    for (const imageFile of expectedFiles) {
        assert.ok(
            fs.existsSync(path.join(root, app, imageFile)),
            `generated app ${app} is missing ${imageFile}`
        );
    }
}

const remainingRootPngs = fs.readdirSync(root)
    .filter((filename) => /\.png$/i.test(filename) && !['apple-touch-icon.png', 'logo.png'].includes(filename));
assert.deepEqual(remainingRootPngs, [], 'labeled subcategory images should not remain in the project root');

console.log(`PASS ${imageCount} subcategory images are mapped, present, and moved out of the project root`);
