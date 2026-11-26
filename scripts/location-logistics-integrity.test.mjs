import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const physical = read('database/physical-store-logistics.sql');
const workflows = read('database/location-logistics-workflows.sql');
const service = read('assets/js/services/logistics.js');
const providerPage = read('assets/js/pages/logistics.js');
const checkoutPage = read('assets/js/pages/checkout-logistics.js');
const discoveryPage = read('assets/js/pages/shop-discovery.js');
const sellerLocationPage = read('assets/js/pages/seller-physical-location.js');
const shopLocationPage = read('assets/js/pages/shop-physical-location.js');
const adminPage = read('admin-workspace/admin.js');
const adminHtml = read('admin-workspace/index.html');
const runbook = read('database/run-schema.txt');

function includes(source, expected, message) {
    assert.ok(source.includes(expected), message || `Expected content: ${expected}`);
}

for (const table of [
    'shop_physical_locations',
    'delivery_providers',
    'delivery_provider_verifications',
    'delivery_provider_service_areas',
    'delivery_requests',
    'delivery_rider_engagements'
]) {
    includes(physical, `CREATE TABLE IF NOT EXISTS public.${table}`, `Missing ${table} table`);
}

assert.match(physical, /'shop_physical_locations'[\s\S]*'delivery_rider_engagements'[\s\S]*REVOKE ALL ON TABLE/);
includes(physical, "VALUES (\n    'delivery-provider-verification-private',\n    'delivery-provider-verification-private',\n    FALSE", 'Provider documents must use private storage.');
includes(physical, 'shop_owner_save_physical_location', 'Shop location writes need an owner-checked RPC.');
includes(physical, "location.review_status = 'approved'", 'Public shop locations must be approval-gated.');
includes(physical, 'admin_review_delivery_provider', 'Provider approval must remain an admin-only RPC.');

const engagementTable = physical.slice(
    physical.indexOf('CREATE TABLE IF NOT EXISTS public.delivery_rider_engagements'),
    physical.indexOf('CREATE TABLE IF NOT EXISTS public.delivery_provider_reports')
);
assert.doesNotMatch(engagementTable, /\border_id\b/, 'Workforce engagements must not share order-delivery records.');
includes(engagementTable, "engagement_type TEXT NOT NULL CHECK (engagement_type IN ('temporary', 'permanent'))");
includes(workflows, 'provider.is_available IS TRUE', 'Buyer matching must filter unavailable providers.');
includes(workflows, 'provider.available_until > now()', 'Buyer matching must filter expired availability.');
includes(workflows, 'area.is_active IS TRUE', 'Buyer matching must filter inactive service areas.');
includes(workflows, 'delivery_distance_km(\n                    area.latitude, area.longitude,\n                    v_origin.latitude, v_origin.longitude\n                 ) <= area.coverage_radius_km', 'Matching must include shop coverage.');
includes(workflows, 'delivery_distance_km(\n                    area.latitude, area.longitude,\n                    p_destination_latitude, p_destination_longitude\n                 ) <= area.coverage_radius_km', 'Matching must include buyer destination coverage.');
includes(workflows, "p_engagement_type TEXT", 'Workforce invitations need their own workflow.');
includes(workflows, 'buyer_list_my_delivery_requests', 'Buyers need delivery status tracking.');
includes(workflows, 'shop_owner_list_delivery_requests', 'Shop owners need delivery status tracking.');
includes(workflows, 'v_total_fee_usd := round(v_total_fee / v_currency_per_usd, 2)', 'Local delivery fees must be converted to the existing USD order base.');
includes(workflows, 'activate_delivery_areas_after_provider_approval', 'Saved coverage must become matchable after provider approval.');

includes(service, 'leaflet/1.9.4/leaflet.js', 'Maps must load from a CSP-allowed CDN.');
includes(discoveryPage, 'search_public_shop_physical_locations', 'Public shop discovery must use live approved locations.');
includes(sellerLocationPage, 'shop_owner_save_physical_location', 'Sellers must be able to save their physical location.');
includes(shopLocationPage, 'get_public_shop_physical_location', 'Public shop profiles must load only approved locations.');
includes(checkoutPage, 'get_available_delivery_providers_for_shop', 'Checkout must use live location-based provider matching.');
includes(checkoutPage, 'buyer_request_order_delivery', 'Provider choice must create a server-validated request.');
includes(providerPage, 'shop_owner_invite_rider', 'Seller rider hiring must use engagement RPCs.');
includes(providerPage, 'delivery_provider_update_request', 'Providers must be able to update delivery status.');
includes(providerPage, 'delivery_provider_report', 'Buyers must be able to report a delivery issue.');
includes(adminPage, 'admin_review_shop_physical_location', 'Admin UI must review store locations.');
includes(adminPage, 'admin_review_delivery_provider', 'Admin UI must approve and manage providers.');
includes(adminPage, 'admin_review_delivery_provider_report', 'Admin UI must process provider complaints.');
includes(adminPage, 'admin_save_delivery_settings', 'Admin UI must control market pricing.');
includes(adminHtml, 'id="logisticsPanel"', 'Admin dashboard must expose logistics queues.');
includes(runbook, 'database/physical-store-logistics.sql', 'Migration 20 must be documented.');
includes(runbook, 'database/location-logistics-workflows.sql', 'Migration 21 must be documented.');

console.log('Location and logistics integrity checks passed.');
