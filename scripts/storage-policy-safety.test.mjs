import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const rls = read('database/supabase-rls.sql');
const focusedFix = read('database/storage-public-bucket-list-policy-fix.sql');
const verification = read('database/safety-verification.sql');
const studentListing = read('assets/js/pages/student-listing.js');
function collectDatabaseSql(directoryUrl, relativeDirectory = 'database') {
    return fs.readdirSync(directoryUrl, { withFileTypes: true }).flatMap((entry) => {
        const relativePath = `${relativeDirectory}/${entry.name}`;
        const entryUrl = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directoryUrl);
        if (entry.isDirectory()) return collectDatabaseSql(entryUrl, relativePath);
        if (!entry.isFile() || !entry.name.endsWith('.sql')) return [];
        return [{ name: relativePath, content: fs.readFileSync(entryUrl, 'utf8') }];
    });
}
const databaseSqlFiles = collectDatabaseSql(new URL('../database/', import.meta.url));
const policies = [
    'public can read product image objects',
    'public can read product video objects',
];

for (const policy of policies) {
    const escaped = policy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const dropStatement = `DROP POLICY IF EXISTS "${policy}" ON storage.objects;`;
    assert.ok(rls.includes(dropStatement), `base RLS migration must remove ${policy}`);
    assert.ok(focusedFix.includes(dropStatement), `focused fix must remove ${policy}`);
    for (const file of databaseSqlFiles) {
        assert.doesNotMatch(
            file.content,
            new RegExp(`CREATE\\s+POLICY\\s+"${escaped}"`, 'i'),
            `${file.name} must not recreate ${policy}`,
        );
    }
}

assert.match(verification, /public product media buckets cannot be listed/);
assert.match(studentListing, /getPublicUrl\(path\)/);
assert.doesNotMatch(
    studentListing,
    /storage\.from\([^)]*\)\.list\(/,
    'listing creation must not depend on bucket enumeration',
);

console.log('PASS public storage URLs remain usable without broad product-media bucket listing policies');
