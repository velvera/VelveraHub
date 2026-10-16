/**
 * VelveraHub Configuration Example
 *
 * Copy this file to the static browser configuration used by the storefront.
 * The Supabase URL and anon/publishable key are public client values. RLS,
 * not Cloudflare variables or key secrecy, protects the data.
 *
 * Never place a service_role key, secret key, database password, JWT secret,
 * SESSION_SECRET, or any other privileged credential in this file.
 */

window.VELVERAHUB_CONFIG = {
    // Supabase Configuration
    SUPABASE_URL: "https://your-project.supabase.co",
    SUPABASE_ANON_KEY: "your-public-anon-key",

    // Site Configuration
    SITE_NAME: "VelveraHub",
    CURRENCY: "NGN/GBP",
    CURRENCY_SYMBOL: "₦/£",
    // Optional separately deployed authenticated API. Empty uses same origin.
    API_ORIGIN: "",

    // Feature flags. Demo data is not supported in production.
    ENABLE_DEMO_MODE: false,
    ENABLE_WISHLIST: true,
    ENABLE_REVIEWS: true,
};
