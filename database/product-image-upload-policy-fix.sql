-- Narrow policy repair for the app's product-image upload flow.
--
-- First run database/product-image-upload-diagnostics.sql. This script is
-- intentionally guarded: it aborts unless the existing safe helper functions,
-- RLS, bucket, and INSERT privileges are present, and unless there are no
-- anon/PUBLIC INSERT policies on the affected tables.
--
-- It changes only authenticated INSERT policies for product-images objects
-- and product_images rows, plus EXECUTE privileges for the two policy helpers.
-- It does not alter bucket visibility, bucket constraints, SELECT/list access,
-- other buckets, or table-level grants.
-- Do not run it as a substitute for the ordered schema migration.

BEGIN;

DO $preflight$
DECLARE
    storage_rls_enabled BOOLEAN;
    image_rows_rls_enabled BOOLEAN;
BEGIN
    IF to_regclass('storage.objects') IS NULL
       OR to_regclass('public.product_images') IS NULL THEN
        RAISE EXCEPTION 'Required Storage or product_images table is missing; apply the documented schema first';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM storage.buckets WHERE id = 'product-images'
    ) THEN
        RAISE EXCEPTION 'The product-images bucket is missing; inspect bucket configuration before applying a policy';
    END IF;

    IF to_regprocedure('public.can_upload_product_media(text,text)') IS NULL
       OR to_regprocedure('public.can_manage_product_media(uuid)') IS NULL
       OR to_regprocedure('public.product_image_limit_for(uuid)') IS NULL
       OR to_regprocedure('public.is_product_media_path(text,text)') IS NULL THEN
        RAISE EXCEPTION 'Required owner/path helpers are missing; apply database/supabase-rls.sql first';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE oid = to_regprocedure('public.can_upload_product_media(text,text)')
          AND prosecdef
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE oid = to_regprocedure('public.can_manage_product_media(uuid)')
          AND prosecdef
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE oid = to_regprocedure('public.product_image_limit_for(uuid)')
          AND prosecdef
    ) THEN
        RAISE EXCEPTION 'Owner/path/quota helpers are not all SECURITY DEFINER; inspect them before applying a policy repair';
    END IF;

    SELECT relation.relrowsecurity
    INTO storage_rls_enabled
    FROM pg_class AS relation
    WHERE relation.oid = to_regclass('storage.objects');

    SELECT relation.relrowsecurity
    INTO image_rows_rls_enabled
    FROM pg_class AS relation
    WHERE relation.oid = to_regclass('public.product_images');

    IF storage_rls_enabled IS DISTINCT FROM TRUE
       OR image_rows_rls_enabled IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'RLS must be enabled on storage.objects and public.product_images before applying this policy repair';
    END IF;

    IF NOT has_table_privilege('authenticated', 'storage.objects', 'INSERT')
       OR NOT has_table_privilege('authenticated', 'public.product_images', 'INSERT') THEN
        RAISE EXCEPTION 'authenticated is missing a table-level INSERT grant; inspect privileges before changing them';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE (
                (schemaname = 'storage' AND tablename = 'objects')
                OR (schemaname = 'public' AND tablename = 'product_images')
              )
          AND cmd IN ('INSERT', 'ALL')
          AND roles && ARRAY['public'::name, 'anon'::name]
    ) THEN
        RAISE EXCEPTION 'An anon/PUBLIC INSERT policy exists on a media table; inspect it before applying an authenticated-only repair';
    END IF;
END
$preflight$;

GRANT EXECUTE ON FUNCTION public.can_upload_product_media(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_product_media(UUID) TO authenticated;

DROP POLICY IF EXISTS "velverahub authenticated product image upload" ON storage.objects;
CREATE POLICY "velverahub authenticated product image upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'product-images'
    AND public.can_upload_product_media(bucket_id, name)
);

-- Restrictive policies AND with older permissive policies. This prevents a
-- legacy authenticated INSERT policy from bypassing product ownership/path
-- checks, without affecting uploads to other buckets.
DROP POLICY IF EXISTS "velverahub restrict product image upload" ON storage.objects;
CREATE POLICY "velverahub restrict product image upload"
ON storage.objects AS RESTRICTIVE
FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id <> 'product-images'
    OR public.can_upload_product_media(bucket_id, name)
);

DROP POLICY IF EXISTS "velverahub authenticated product image metadata insert" ON public.product_images;
CREATE POLICY "velverahub authenticated product image metadata insert"
ON public.product_images FOR INSERT
TO authenticated
WITH CHECK (public.can_manage_product_media(product_id));

DROP POLICY IF EXISTS "velverahub restrict product image metadata insert" ON public.product_images;
CREATE POLICY "velverahub restrict product image metadata insert"
ON public.product_images AS RESTRICTIVE
FOR INSERT
TO authenticated
WITH CHECK (public.can_manage_product_media(product_id));

COMMIT;
