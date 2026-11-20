import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const ui = read('assets/js/components/ui.js');
const shopDirectory = read('veeve/shops.html');
const shopPage = read('veeve/shop.html');
const productPage = read('veeve/product.html');
const sellerDashboard = read('shop-owner/dashboard.js');
const legalPage = read('veeve/legal.html');
const supportPage = read('veeve/secured-trading.html');
const requiredInfo = read('requiredinformations.md');

assert.match(ui, /verified_reviews_count/);
assert.match(ui, /verified_rating/);
assert.doesNotMatch(ui, /product\.rating\)\s*\|\|\s*4\.5|shop\.rating\s*\|\|\s*4\.5/);
assert.doesNotMatch(shopDirectory, /Verified marketplace|customer rating|total_sales|\.order\('rating'/i);
assert.doesNotMatch(shopPage, /shop\.rating\s*\|\|\s*["']4\.5|shop\.total_sales|renderEvidencePanel/);
assert.match(productPage, /Verified-purchase reviews are not available yet/);
assert.match(sellerDashboard, /\.eq\('is_verified_purchase',\s*true\)\.eq\('is_approved',\s*true\)/);
assert.match(legalPage, /Draft — owner and legal review required/);
assert.doesNotMatch(legalPage, /within 14 days|closes or anonymises|close or anonymise eligible account data/i);
assert.match(legalPage, /does not itself delete the Supabase Auth user/);
assert.match(supportPage, /does not currently offer escrow, trade insurance, or a guaranteed buyer-protection service/i);
assert.match(requiredInfo, /actual Supabase plan and global Storage limit have not been inspected/i);

console.log('PASS public ratings, seller review filters, draft legal copy, and owner-dependency safeguards');
