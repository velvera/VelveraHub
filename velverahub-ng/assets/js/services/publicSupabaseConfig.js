/*
 * Public browser configuration shared by all VelveraHub applications.
 *
 * These are intentionally client-visible Supabase values. Supabase Auth and
 * PostgreSQL RLS provide the security boundary. Never put service_role,
 * secret, database, JWT, or session credentials in this file.
 *
 * These values point to the shared production Supabase project.
 */
const SUPABASE_URL = "https://vgyzkvtjjzrjghlkwwrm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZneXprdnRqanpyamdobGt3d3JtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgwNzY1MTMsImV4cCI6MjEwMzY1MjUxM30.Nxojh608SGAGpX1oZtsNy_d3HfaxJpgqJ9zpamSz5vg";

window.VELVERAHUB_CONFIG = Object.freeze({
    ...(window.VELVERAHUB_CONFIG || {}),
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    APP_TYPE: window.VELVERAHUB_CONFIG?.APP_TYPE || "public",
    APP_REGION: window.VELVERAHUB_CONFIG?.APP_REGION || "NG",
    SITE_URL: window.VELVERAHUB_CONFIG?.SITE_URL || window.location.origin
});