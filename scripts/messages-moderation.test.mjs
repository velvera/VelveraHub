import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const schema = read('database/schema.sql');
const rls = read('database/supabase-rls.sql');
const dashboardSql = read('database/cloudflare-dashboard.sql');
const productPage = read('veeve/product.html');
const productChat = read('assets/js/components/product-chat.js');
const sellerDashboard = read('shop-owner/dashboard.js');
const sellerMarkup = read('seller-workspace/index.html');
const shopMarkup = read('shop-owner/index.html');
const adminMarkup = read('admin-workspace/index.html');
const adminScript = read('admin-workspace/admin.js');
const accountScript = read('assets/js/pages/account-page.js');
const myListingsScript = read('veeve/assets/js/pages/my-listings.js');
const locationSelect = read('assets/js/components/custom-select.js');
const interactionFeedback = read('assets/js/components/interaction-feedback.js');
const footerScript = read('assets/js/components/site-navigation.js');
const mobileTest = read('scripts/mobile-regression.mjs');
const schemaRunbook = read('database/run-schema.txt');
const safetyVerification = read('database/safety-verification.sql');

assert.match(schema, /moderation_status TEXT NOT NULL DEFAULT 'approved'/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS public\.product_conversations/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS public\.product_conversation_messages/);
assert.match(dashboardSql, /conversation\.buyer_id = auth\.uid\(\) or conversation\.seller_id = auth\.uid\(\)/i);
assert.match(dashboardSql, /start_product_conversation/);
assert.match(dashboardSql, /send_product_conversation_message/);
assert.match(dashboardSql, /revoke all on table public\.product_conversations, public\.product_conversation_messages from authenticated/i);
assert.match(dashboardSql, /product\.moderation_status = 'approved'/);
assert.match(dashboardSql, /new\.moderation_status := 'pending'/);
assert.match(dashboardSql, /A clear reason is required when declining a listing/);
assert.match(dashboardSql, /product\.moderation_status = 'pending'/);
assert.match(rls, /product\.moderation_status = 'approved'/);

assert.match(productPage, /id="shareProductButton"/);
assert.match(productPage, /data-chat-prompt="Is this available\?"/);
assert.match(productPage, /data-chat-form/);
assert.match(productChat, /start_product_conversation/);
assert.match(productChat, /send_product_conversation_message/);
assert.match(productChat, /product_conversation_messages/);
assert.match(sellerMarkup, /data-page="messages"/);
assert.match(shopMarkup, /data-page="messages"/);
assert.match(sellerDashboard, /function renderSellerMessagesPage/);
assert.match(sellerDashboard, /send_product_conversation_message/);

assert.match(adminMarkup, /data-admin-view="listingReviews"/);
assert.match(adminMarkup, /listingReviewStatus/);
assert.match(adminScript, /admin_list_product_reviews/);
assert.match(adminScript, /admin_review_product_listing/);
assert.match(accountScript, /Edit and resubmit/);
assert.match(sellerDashboard, /Listing moderation/);
assert.match(sellerDashboard, /moderation_note/);
assert.match(myListingsScript, /Changes requested/);
assert.match(myListingsScript, /moderation_note/);
assert.match(sellerDashboard, /moderation_status: 'pending'/);

assert.match(locationSelect, /data-no-processing/);
assert.match(interactionFeedback, /\.cs-mobile-back/);
assert.match(interactionFeedback, /NAVIGATION_CONTROL_SELECTOR/);
assert.match(interactionFeedback, /clearProcessing\(navigationControl\)/);
assert.match(read('assets/css/base.css'), /button\.cs-mobile-back::after/);
assert.match(mobileTest, /location back action did not return to states with a static chevron/);
assert.match(footerScript, /const footerLogoUrl = '\/img\/logo\.png'/);

for (const migration of [
    'schema.sql',
    'seller.sql',
    'admin.sql',
    'supabase-rls.sql',
    'security-hardening.sql',
    'cloudflare-dashboard.sql',
    'cloudflare-supabase-direct.sql',
    'production-hardening.sql',
    'shop-owner-payments.sql',
    'shop-verification-compliance.sql',
    'seller-contact-safety.sql',
    'product-delivery-options.sql',
]) {
    assert.match(schemaRunbook, new RegExp(`database/${migration.replaceAll('.', '\\.')}`));
}
assert.match(schemaRunbook, /safety-verification\.sql[\s\S]*read-only/i);
assert.match(schemaRunbook, /promote-admin\.sql/);
assert.match(safetyVerification, /product conversation tables exist/);
assert.match(safetyVerification, /authenticated users cannot directly write conversation rows/);
assert.match(safetyVerification, /listing moderation trigger exists/);

console.log('PASS product messaging, participant-only SQL, listing review/resubmission, location back-chevron, and footer brand paths are wired');
