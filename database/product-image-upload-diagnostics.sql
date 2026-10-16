-- Read-only production diagnostic for authenticated product-image uploads.
-- Run this in the Supabase SQL Editor. It returns bucket, policy, grant,
-- function, trigger, and schema metadata only; it does not read user listings
-- or Storage object names and does not change project state.

-- 1. Expected app configuration: public URLs, WebP, and a 5 MiB object limit.
SELECT
    id,
    name,
    public AS is_public,
    file_size_limit,
    allowed_mime_types
FROM storage.buckets
WHERE id = 'product-images';

-- 2. RLS and table-level INSERT privileges. RLS policies do not grant SQL
-- privileges, so both values matter to the Storage/PostgREST request.
SELECT
    'storage.objects' AS relation_name,
    relation.relrowsecurity AS rls_enabled,
    has_table_privilege('authenticated', relation.oid, 'INSERT') AS authenticated_can_insert
FROM pg_class AS relation
WHERE relation.oid = to_regclass('storage.objects')
UNION ALL
SELECT
    'public.product_images',
    relation.relrowsecurity,
    has_table_privilege('authenticated', relation.oid, 'INSERT')
FROM pg_class AS relation
WHERE relation.oid = to_regclass('public.product_images');

-- 3. Show existing write and read policies on only the two relevant tables.
-- Check INSERT/ALL rows for authenticated owner checks and SELECT rows for any
-- unintended broad object-listing policy.
SELECT
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE (schemaname = 'storage' AND tablename = 'objects')
   OR (schemaname = 'public' AND tablename = 'product_images')
ORDER BY schemaname, tablename, policyname;

-- 4. Required helper functions and whether authenticated callers can execute
-- the policy helpers. Function definitions can be compared with
-- database/supabase-rls.sql.
SELECT
    routine.proname AS function_name,
    pg_get_function_identity_arguments(routine.oid) AS arguments,
    routine.prosecdef AS security_definer,
    has_function_privilege(
        'authenticated',
        routine.oid,
        'EXECUTE'
    ) AS authenticated_can_execute,
    pg_get_functiondef(routine.oid) AS definition
FROM pg_proc AS routine
JOIN pg_namespace AS namespace ON namespace.oid = routine.pronamespace
WHERE namespace.nspname = 'public'
  AND routine.proname IN (
      'is_product_media_path',
      'can_manage_product_media',
      'product_image_limit_for',
      'can_upload_product_media'
  )
ORDER BY routine.proname, arguments;

-- 5. Upload and image-count triggers. Missing triggers can cause the live
-- schema to differ from the repository migration.
SELECT
    event_object_schema,
    event_object_table,
    trigger_name,
    action_timing,
    event_manipulation,
    action_statement
FROM information_schema.triggers
WHERE (event_object_schema = 'storage' AND event_object_table = 'objects')
   OR (
       event_object_schema = 'public'
       AND event_object_table = 'product_images'
       AND trigger_name IN (
           'enforce_product_image_limit_after_insert',
           'prevent_product_image_move'
       )
   )
ORDER BY event_object_schema, event_object_table, trigger_name;

-- 6. Relevant columns used by owner and listing-type checks.
SELECT
    table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
      (table_name = 'products' AND column_name IN ('id', 'seller_id', 'shop_id', 'listing_type'))
      OR (table_name = 'product_images' AND column_name = 'product_id')
  )
ORDER BY table_name, ordinal_position;

-- If the bucket row above differs from the app's WebP/5 MiB constraints, and
-- all legitimate product-image clients use WebP, the narrowly scoped setting
-- correction is:
-- UPDATE storage.buckets
-- SET file_size_limit = 5242880,
--     allowed_mime_types = ARRAY['image/webp']::text[]
-- WHERE id = 'product-images';
--
-- Do not change the bucket's public flag or add a SELECT policy to fix uploads.
