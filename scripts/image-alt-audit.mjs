import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignoredDirectories = new Set([
    '.agents',
    '.git',
    '.local',
    'attached_assets',
    'node_modules',
]);
const sourceExtensions = new Set(['.html', '.js']);
const files = [];
const failures = [];
let imageTagCount = 0;
let dynamicImageCount = 0;

function collectFiles(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
        const filePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            collectFiles(filePath);
        } else if (sourceExtensions.has(path.extname(entry.name).toLowerCase())) {
            files.push(filePath);
        }
    }
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

collectFiles(projectRoot);

for (const filePath of files) {
    const source = fs.readFileSync(filePath, 'utf8');
    const relativePath = path.relative(projectRoot, filePath);

    for (const match of source.matchAll(/<img\b[^>]*>/gi)) {
        imageTagCount += 1;
        if (!/\s+alt\s*=/i.test(match[0])) {
            const line = source.slice(0, match.index).split('\n').length;
            failures.push(`${relativePath}:${line} <img> has no alt attribute`);
        }
    }

    if (path.extname(filePath).toLowerCase() !== '.js') continue;
    const createImagePattern = /([A-Za-z_$][\w$]*)\s*=\s*document\.createElement\(\s*(['"])img\2\s*\)/g;
    for (const match of source.matchAll(createImagePattern)) {
        dynamicImageCount += 1;
        const variable = escapeRegExp(match[1]);
        const followingCode = source.slice(match.index + match[0].length, match.index + match[0].length + 600);
        const hasAlternativeText = new RegExp(
            `\\b${variable}\\s*\\.\\s*alt\\s*=|\\b${variable}\\s*\\.\\s*setAttribute\\(\\s*['"]alt['"]`,
            'i',
        ).test(followingCode);
        if (!hasAlternativeText) {
            const line = source.slice(0, match.index).split('\n').length;
            failures.push(`${relativePath}:${line} dynamically created image does not set alt text`);
        }
    }
}

if (failures.length > 0) {
    console.error('Image alt audit failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
} else {
    console.log(
        `Image alt audit passed: ${imageTagCount} static image tags and ${dynamicImageCount} dynamically created image elements checked across ${files.length} HTML/JS files.`,
    );
}
