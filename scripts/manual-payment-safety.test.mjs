import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const migration = read('database/marketplace-manual-payments.sql');
const schemaOrder = read('database/run-schema.txt');
const checkout = read('veeve/checkout.html');
const product = read('veeve/product.html');
const success = read('veeve/success.html');
const seller = read('shop-owner/dashboard.js');
const sellerPortal = read('shop-owner/index.html');
const admin = read('admin-workspace/admin.js');
const adminPage = read('admin-workspace/index.html');
const docs = read('docs/payment-architecture.md');
const staging = read('docs/staging-acceptance.md');

assert.match(schemaOrder, /14\.\s+database\/marketplace-manual-payments\.sql/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.marketplace_payment_destinations/);
assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
assert.match(migration, /USING \(enabled IS TRUE OR public\.current_profile_role\(\) = 'admin'\)/);
assert.match(migration, /public\.current_profile_role\(\) IS DISTINCT FROM 'admin'/);
assert.match(migration, /shop_owner_save_manual_payment_preferences/);
assert.match(migration, /verification\.status = 'approved'/);
assert.match(migration, /Only an active shop with approved KYC can change manual payment preferences/);
assert.match(migration, /capture_order_manual_payment_details/);
assert.match(migration, /order_manual_payment_confirmations/);
assert.match(migration, /payment_details = jsonb_build_object/);
assert.match(migration, /require_order_manual_payment_details/);
assert.match(migration, /get_order_manual_payment_details/);
assert.match(migration, /admin_confirm_platform_manual_payment/);
assert.match(migration, /shop_owner_confirm_manual_payment_receipt/);
assert.match(migration, /order_confirmed/);
assert.match(migration, /TO anon, authenticated/);

for (const safetyTip of [
    'Avoid paying in advance, even for delivery',
    'Meet with the seller at a safe public place',
    "Inspect the item and ensure it's exactly what you want",
    "Make sure that the packed item is the one you've inspected",
    "Only pay if you're satisfied"
]) {
    assert.ok(product.includes(safetyTip), `product detail page includes safety tip: ${safetyTip}`);
}
assert.match(product, /Can we agree on payment and delivery options\?/);
assert.match(product, /renderPaymentOptions/);

assert.match(sellerPortal, /id="sellerPaymentPreferencesForm"/);
assert.match(seller, /shop\.verified === true/);
assert.match(seller, /shop_owner_save_manual_payment_preferences/);
assert.match(seller, /shop_owner_list_pending_manual_payment_orders/);
assert.match(seller, /shop_owner_confirm_manual_payment_receipt/);
assert.match(seller, /seller_direct/);

assert.match(adminPage, /id="paymentSettingsTab"/);
assert.match(adminPage, /id="marketplacePaymentSettingsForm"/);
assert.match(admin, /admin_save_marketplace_payment_destination/);
assert.match(admin, /paymentSettings/);

assert.match(checkout, /Manual payment \(agree with seller\)/);
assert.match(checkout, /marketplace_payment_destinations/);
assert.match(checkout, /orderInput\.p_payment_method === 'bank_transfer'/);
assert.match(checkout, /successParams\.set\('order_id', orderId\)/);
assert.match(success, /get_order_manual_payment_details/);
assert.match(success, /line\.append\(title, document\.createTextNode\(String\(value\)\)\)/);
assert.match(success, /orders remain pending|order is pending/i);
assert.match(docs, /remain `pending` until confirmed/);
assert.match(staging, /does not have a dedicated Supabase\s+staging project or disposable test accounts/);

console.log('Manual-payment safety/source checks passed.');
