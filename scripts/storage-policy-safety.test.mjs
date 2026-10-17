import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const rls = read('database/supabase-rls.sql');
const focusedFix = read('database/storage-public-bucket-list-policy-fix.sql');
const verification = read('database/safety-verification.sql');
const studentListing = read('assets/js/pages/student-listing.js');
const observability = read('assets/js/services/observability.js');
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
assert.match(studentListing, /upsert:\s*false/, 'media uploads must not require overwrite permissions');
assert.match(studentListing, /student-listing-media-upload/, 'storage upload failures must be diagnosed at the upload boundary');
assert.match(observability, /error\?\.details/, 'safe diagnostics must retain server-provided error details');
assert.match(observability, /error\?\.hint/, 'safe diagnostics must retain server-provided error hints');
assert.match(observability, /httpStatus/, 'safe diagnostics must retain the HTTP status separately');
assert.match(observability, /\[storage object path\]/, 'storage object names must be redacted from diagnostics');
assert.match(studentListing, /stage:\s*failureStage/, 'submit diagnostics must include the failing pipeline stage');
assert.match(studentListing, /Listing media metadata insert failed/, 'metadata failures must be visible in the browser console');
assert.match(studentListing, /mediaCount:\s*failureMediaCount/, 'submit diagnostics must include the selected media count');

assert.match(
    rls,
    /'product-images',\s*'product-images',\s*TRUE,\s*5242880,\s*ARRAY\['image\/webp'\]::text\[\]/,
    'the local bucket configuration must match the WebP/5 MiB uploader constraints',
);
assert.match(rls, /CREATE POLICY "students can upload listing images"/);
assert.match(rls, /CREATE POLICY "restrict product media uploads"/);
assert.match(rls, /public\.can_upload_product_media\(bucket_id, name\)/);
assert.match(rls, /CREATE POLICY "students can manage their listing images"/);

const vmContext = {
    window: { location: { origin: 'https://example.test', pathname: '/veeve/sell.html' } },
    document: { addEventListener() {} },
};
vm.runInNewContext(observability, vmContext);
const diagnostic = vmContext.window.Observability.formatErrorDiagnostic({
    message: 'Upload denied for 123e4567-e89b-12d3-a456-426614174000/123e4567-e89b-42d3-a456-426614174000.webp',
    details: 'Bearer sensitive-value',
    code: '42501',
    statusCode: 403,
});
assert.match(diagnostic, /\[storage object path\]/);
assert.doesNotMatch(diagnostic, /123e4567-e89b/);
assert.doesNotMatch(diagnostic, /sensitive-value/);

console.log('PASS public storage URLs remain usable without broad product-media bucket listing policies');
