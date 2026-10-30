-- VelveraHub production safety verification
--
-- Run this file in the Supabase SQL Editor only after the ordered migrations
-- in database/run-schema.txt have completed. Every statement below is
-- read-only. A returned row with passed = false identifies the item that still
-- needs attention.
--
-- Browser-role RLS behavior must still be exercised with real test accounts
-- (or the authenticated browser script); catalog metadata alone cannot
-- simulate a signed-in user's JWT.

WITH checks AS (
    SELECT
        'profiles table exists'::TEXT AS check_name,
        to_regclass('public.profiles') IS NOT NULL AS passed
    UNION ALL
    SELECT
        'product listing moderation columns exist',
        (
            SELECT count(*) = 4
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'products'
              AND column_name IN (
                  'moderation_status', 'moderation_note',
                  'moderated_by', 'moderated_at'
              )
        )
    UNION ALL
    SELECT
        'product moderation status constraint exists',
        EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'products_moderation_status_valid'
              AND conrelid = to_regclass('public.products')
        )
    UNION ALL
    SELECT
        'listing moderation trigger exists',
        EXISTS (
            SELECT 1
            FROM pg_trigger
            WHERE tgrelid = to_regclass('public.products')
              AND tgname = 'enforce_product_listing_review'
              AND NOT tgisinternal
        )
    UNION ALL
    SELECT
        'listing media resubmission trigger exists',
        EXISTS (
            SELECT 1
            FROM pg_trigger
            WHERE tgrelid = to_regclass('public.product_images')
              AND tgname = 'requeue_product_after_media_change'
              AND NOT tgisinternal
        )
    UNION ALL
    SELECT
        'product conversation tables exist',
        to_regclass('public.product_conversations') IS NOT NULL
        AND to_regclass('public.product_conversation_messages') IS NOT NULL
    UNION ALL
    SELECT
        'product conversations RLS enabled',
        coalesce((
            SELECT relrowsecurity
            FROM pg_class
            WHERE oid = to_regclass('public.product_conversations')
        ), false)
    UNION ALL
    SELECT
        'product conversation messages RLS enabled',
        coalesce((
            SELECT relrowsecurity
            FROM pg_class
            WHERE oid = to_regclass('public.product_conversation_messages')
        ), false)
    UNION ALL
    SELECT
        'conversation participant read policies exist',
        EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public'
              AND tablename = 'product_conversations'
              AND policyname = 'conversation participants can read threads'
              AND cmd = 'SELECT'
        )
        AND EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public'
              AND tablename = 'product_conversation_messages'
              AND policyname = 'conversation participants can read messages'
              AND cmd = 'SELECT'
        )
    UNION ALL
    SELECT
        'authenticated users can read conversation rows',
        CASE WHEN to_regclass('public.product_conversations') IS NOT NULL
                  AND to_regclass('public.product_conversation_messages') IS NOT NULL
            THEN has_table_privilege('authenticated', to_regclass('public.product_conversations'), 'SELECT')
                 AND has_table_privilege('authenticated', to_regclass('public.product_conversation_messages'), 'SELECT')
            ELSE false
        END
    UNION ALL
    SELECT
        'authenticated users cannot directly write conversation rows',
        CASE WHEN to_regclass('public.product_conversations') IS NOT NULL
                  AND to_regclass('public.product_conversation_messages') IS NOT NULL
            THEN NOT has_table_privilege('authenticated', to_regclass('public.product_conversations'), 'INSERT')
                 AND NOT has_table_privilege('authenticated', to_regclass('public.product_conversation_messages'), 'INSERT')
                 AND NOT has_table_privilege('authenticated', to_regclass('public.product_conversations'), 'UPDATE')
                 AND NOT has_table_privilege('authenticated', to_regclass('public.product_conversation_messages'), 'UPDATE')
            ELSE false
        END
    UNION ALL
    SELECT
        'anonymous users cannot start or send product conversations',
        CASE WHEN to_regprocedure('public.start_product_conversation(uuid,text)') IS NOT NULL
                  AND to_regprocedure('public.send_product_conversation_message(uuid,text)') IS NOT NULL
            THEN NOT has_function_privilege('anon', to_regprocedure('public.start_product_conversation(uuid,text)'), 'EXECUTE')
                 AND NOT has_function_privilege('anon', to_regprocedure('public.send_product_conversation_message(uuid,text)'), 'EXECUTE')
            ELSE false
        END
    UNION ALL
    SELECT
        'authenticated conversation RPCs are available',
        CASE WHEN to_regprocedure('public.start_product_conversation(uuid,text)') IS NOT NULL
                  AND to_regprocedure('public.send_product_conversation_message(uuid,text)') IS NOT NULL
            THEN has_function_privilege('authenticated', to_regprocedure('public.start_product_conversation(uuid,text)'), 'EXECUTE')
                 AND has_function_privilege('authenticated', to_regprocedure('public.send_product_conversation_message(uuid,text)'), 'EXECUTE')
            ELSE false
        END
    UNION ALL
    SELECT
        'admin listing review RPCs exist',
        to_regprocedure('public.admin_list_product_reviews(text)') IS NOT NULL
        AND to_regprocedure('public.admin_review_product_listing(uuid,text,text)') IS NOT NULL
    UNION ALL
    SELECT
        'seller public contacts table exists',
        to_regclass('public.seller_public_contacts') IS NOT NULL
    UNION ALL
    SELECT
        'products.delivery_options JSONB column exists',
        EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'products'
              AND column_name = 'delivery_options'
              AND data_type = 'jsonb'
        )
    UNION ALL
    SELECT
        'delivery options shape constraint exists',
        EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'products_delivery_options_shape'
              AND conrelid = to_regclass('public.products')
        )
    UNION ALL
    SELECT
        'rate-limit bucket table exists',
        to_regclass('public.api_rate_limit_buckets') IS NOT NULL
    UNION ALL
    SELECT
        'bank-transfer order trigger exists',
        EXISTS (
            SELECT 1
            FROM pg_trigger AS trigger_row
            JOIN pg_class AS table_row ON table_row.oid = trigger_row.tgrelid
            JOIN pg_namespace AS namespace_row ON namespace_row.oid = table_row.relnamespace
            WHERE namespace_row.nspname = 'public'
              AND table_row.relname = 'orders'
              AND trigger_row.tgname = 'enforce_verified_shop_bank_transfer_order'
              AND NOT trigger_row.tgisinternal
        )
    UNION ALL
    SELECT
        'bank-transfer order-item trigger exists',
        EXISTS (
            SELECT 1
            FROM pg_trigger AS trigger_row
            JOIN pg_class AS table_row ON table_row.oid = trigger_row.tgrelid
            JOIN pg_namespace AS namespace_row ON namespace_row.oid = table_row.relnamespace
            WHERE namespace_row.nspname = 'public'
              AND table_row.relname = 'order_items'
              AND trigger_row.tgname = 'enforce_verified_shop_bank_transfer_items'
              AND NOT trigger_row.tgisinternal
        )
    UNION ALL
    SELECT
        'auth profile trigger exists',
        EXISTS (
            SELECT 1
            FROM pg_trigger AS trigger_row
            JOIN pg_class AS table_row ON table_row.oid = trigger_row.tgrelid
            JOIN pg_namespace AS namespace_row ON namespace_row.oid = table_row.relnamespace
            WHERE namespace_row.nspname = 'auth'
              AND table_row.relname = 'users'
              AND trigger_row.tgname = 'on_auth_user_created'
              AND NOT trigger_row.tgisinternal
        )
    UNION ALL
    SELECT
        'profile security trigger exists',
        EXISTS (
            SELECT 1
            FROM pg_trigger AS trigger_row
            JOIN pg_class AS table_row ON table_row.oid = trigger_row.tgrelid
            JOIN pg_namespace AS namespace_row ON namespace_row.oid = table_row.relnamespace
            WHERE namespace_row.nspname = 'public'
              AND table_row.relname = 'profiles'
              AND trigger_row.tgname = 'protect_profile_security_fields'
              AND NOT trigger_row.tgisinternal
        )
    UNION ALL
    SELECT
        'anon cannot promote an admin',
        NOT has_function_privilege('anon', 'public.assign_admin_role(text)', 'EXECUTE')
    UNION ALL
    SELECT
        'authenticated cannot promote an admin',
        NOT has_function_privilege('authenticated', 'public.assign_admin_role(text)', 'EXECUTE')
    UNION ALL
    SELECT
        'service role can run operator admin promotion',
        has_function_privilege('service_role', 'public.assign_admin_role(text)', 'EXECUTE')
    UNION ALL
    SELECT
        'profiles RLS enabled',
        relrowsecurity
    FROM pg_class
    WHERE oid = 'public.profiles'::regclass
    UNION ALL
    SELECT
        'seller public contacts RLS enabled',
        relrowsecurity
    FROM pg_class
    WHERE oid = 'public.seller_public_contacts'::regclass
    UNION ALL
    SELECT
        'rate-limit buckets RLS enabled',
        relrowsecurity
    FROM pg_class
    WHERE oid = 'public.api_rate_limit_buckets'::regclass
    UNION ALL
    SELECT
        'anon cannot select rate-limit buckets',
        NOT has_table_privilege(
            'anon',
            'public.api_rate_limit_buckets',
            'SELECT'
        )
    UNION ALL
    SELECT
        'authenticated cannot select rate-limit buckets',
        NOT has_table_privilege(
            'authenticated',
            'public.api_rate_limit_buckets',
            'SELECT'
        )
    UNION ALL
    SELECT
        'anon cannot insert rate-limit buckets',
        NOT has_table_privilege(
            'anon',
            'public.api_rate_limit_buckets',
            'INSERT'
        )
    UNION ALL
    SELECT
        'authenticated cannot update rate-limit buckets',
        NOT has_table_privilege(
            'authenticated',
            'public.api_rate_limit_buckets',
            'UPDATE'
        )
    UNION ALL
    SELECT
        'client error details are restricted to the admin API',
        CASE
            WHEN to_regclass('public.operational_events') IS NULL THEN false
            ELSE (
                SELECT relrowsecurity
                FROM pg_class
                WHERE oid = to_regclass('public.operational_events')
            )
            AND NOT has_table_privilege('anon', 'public.operational_events', 'SELECT')
            AND NOT has_table_privilege('authenticated', 'public.operational_events', 'SELECT')
            AND EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conrelid = to_regclass('public.operational_events')
                  AND contype = 'c'
                  AND pg_get_constraintdef(oid) LIKE '%client_error%'
            )
        END
    UNION ALL
    SELECT
        'public product media buckets cannot be listed',
        NOT EXISTS (
            SELECT 1
            FROM pg_policies
            WHERE schemaname = 'storage'
              AND tablename = 'objects'
              AND cmd = 'SELECT'
              AND policyname IN (
                  'public can read product image objects',
                  'public can read product video objects'
              )
        )
    UNION ALL
    SELECT
        'product media buckets enforce platform ceilings and MIME types',
        EXISTS (
            SELECT 1
            FROM storage.buckets
            WHERE id = 'product-images'
              AND public IS TRUE
              AND file_size_limit = 20971520
              AND allowed_mime_types = ARRAY['image/webp']::text[]
        )
        AND EXISTS (
            SELECT 1
            FROM storage.buckets
            WHERE id = 'product-videos'
              AND public IS TRUE
              AND file_size_limit = 209715200
              AND allowed_mime_types = ARRAY['video/mp4', 'video/webm', 'video/quicktime']::text[]
        )
    UNION ALL
    SELECT
        'product media uploads require owner policies and restrictive validation',
        EXISTS (
            SELECT 1
            FROM pg_policies
            WHERE schemaname = 'storage'
              AND tablename = 'objects'
              AND policyname = 'owners can upload product images'
              AND cmd = 'INSERT'
              AND 'authenticated' = ANY(roles)
        )
        AND EXISTS (
            SELECT 1
            FROM pg_policies
            WHERE schemaname = 'storage'
              AND tablename = 'objects'
              AND policyname = 'students can upload listing images'
              AND cmd = 'INSERT'
              AND 'authenticated' = ANY(roles)
        )
        AND EXISTS (
            SELECT 1
            FROM pg_policies
            WHERE schemaname = 'storage'
              AND tablename = 'objects'
              AND policyname = 'restrict product media uploads'
              AND permissive = 'RESTRICTIVE'
              AND cmd = 'INSERT'
              AND with_check ILIKE '%can_upload_product_media%'
        )
    UNION ALL
    SELECT
        'atomic product media quota tables and storage triggers exist',
        to_regclass('public.product_media_quota_usage') IS NOT NULL
        AND to_regclass('public.product_media_quota_objects') IS NOT NULL
        AND to_regclass('storage.objects') IS NOT NULL
        AND EXISTS (
            SELECT 1 FROM pg_trigger
            WHERE tgrelid = to_regclass('storage.objects')
              AND tgname = 'enforce_product_media_object_quota'
              AND NOT tgisinternal
        )
        AND EXISTS (
            SELECT 1 FROM pg_trigger
            WHERE tgrelid = to_regclass('storage.objects')
              AND tgname = 'release_product_media_quota'
              AND NOT tgisinternal
        )
    UNION ALL
    SELECT
        'product media quota state is private to server-side policies',
        CASE
            WHEN to_regclass('public.product_media_quota_usage') IS NULL
              OR to_regclass('public.product_media_quota_objects') IS NULL
                THEN false
            ELSE (
                SELECT relrowsecurity
                FROM pg_class
                WHERE oid = to_regclass('public.product_media_quota_usage')
            )
            AND (
                SELECT relrowsecurity
                FROM pg_class
                WHERE oid = to_regclass('public.product_media_quota_objects')
            )
            AND NOT has_table_privilege('anon', 'public.product_media_quota_usage', 'SELECT')
            AND NOT has_table_privilege('authenticated', 'public.product_media_quota_usage', 'SELECT')
            AND NOT has_table_privilege('anon', 'public.product_media_quota_objects', 'SELECT')
            AND NOT has_table_privilege('authenticated', 'public.product_media_quota_objects', 'SELECT')
        END
    UNION ALL
    SELECT
        'account deletion request table is protected by RLS',
        CASE
            WHEN to_regclass('public.data_deletion_requests') IS NULL THEN false
            ELSE (
                SELECT relrowsecurity
                FROM pg_class
                WHERE oid = to_regclass('public.data_deletion_requests')
            )
            AND NOT has_table_privilege('anon', 'public.data_deletion_requests', 'SELECT')
            AND NOT has_table_privilege('authenticated', 'public.data_deletion_requests', 'SELECT')
            AND NOT has_table_privilege('anon', 'public.data_deletion_requests', 'INSERT')
            AND NOT has_table_privilege('authenticated', 'public.data_deletion_requests', 'INSERT')
        END
    UNION ALL
    SELECT
        'account deletion RPCs exist with restricted request access',
        CASE
            WHEN to_regprocedure('public.request_account_deletion()') IS NULL
              OR to_regprocedure('public.admin_list_account_deletion_requests(text)') IS NULL
              OR to_regprocedure('public.admin_update_account_deletion_request(uuid,text)') IS NULL
                THEN false
            ELSE has_function_privilege(
                     'authenticated',
                     to_regprocedure('public.request_account_deletion()'),
                     'EXECUTE'
                 )
                 AND NOT has_function_privilege(
                     'anon',
                     to_regprocedure('public.request_account_deletion()'),
                     'EXECUTE'
                 )
        END
    UNION ALL
    SELECT
        'secure checkout RPC exists and is not missing its client grants',
        CASE
            WHEN to_regprocedure('public.place_order_secure(jsonb,jsonb,jsonb,text,text,text)') IS NULL
                THEN false
            ELSE has_function_privilege(
                     'anon',
                     to_regprocedure('public.place_order_secure(jsonb,jsonb,jsonb,text,text,text)'),
                     'EXECUTE'
                 )
                 AND has_function_privilege(
                     'authenticated',
                     to_regprocedure('public.place_order_secure(jsonb,jsonb,jsonb,text,text,text)'),
                     'EXECUTE'
                 )
        END
    UNION ALL
    SELECT
        'order idempotency has a valid unique index',
        to_regclass('public.orders') IS NOT NULL
        AND EXISTS (
            SELECT 1
            FROM pg_index AS index_row
            WHERE index_row.indrelid = to_regclass('public.orders')
              AND index_row.indisunique
              AND index_row.indisvalid
              AND pg_get_indexdef(index_row.indexrelid) ILIKE '%idempotency_key%'
        )
    UNION ALL
    SELECT
        'regional payment records remain server-only',
        CASE
            WHEN to_regclass('public.regional_payment_attempts') IS NULL
              OR to_regclass('public.payment_provider_events') IS NULL
              OR to_regclass('public.regional_payment_refunds') IS NULL
                THEN false
            ELSE (
                SELECT relrowsecurity
                FROM pg_class
                WHERE oid = to_regclass('public.regional_payment_attempts')
            )
            AND (
                SELECT relrowsecurity
                FROM pg_class
                WHERE oid = to_regclass('public.payment_provider_events')
            )
            AND (
                SELECT relrowsecurity
                FROM pg_class
                WHERE oid = to_regclass('public.regional_payment_refunds')
            )
            AND NOT has_table_privilege('anon', 'public.regional_payment_attempts', 'SELECT')
            AND NOT has_table_privilege('authenticated', 'public.regional_payment_attempts', 'SELECT')
            AND NOT has_table_privilege('anon', 'public.payment_provider_events', 'SELECT')
            AND NOT has_table_privilege('authenticated', 'public.payment_provider_events', 'SELECT')
            AND NOT has_table_privilege('anon', 'public.regional_payment_refunds', 'SELECT')
            AND NOT has_table_privilege('authenticated', 'public.regional_payment_refunds', 'SELECT')
            AND has_table_privilege('service_role', 'public.regional_payment_attempts', 'INSERT')
            AND has_table_privilege('service_role', 'public.payment_provider_events', 'INSERT')
            AND has_table_privilege('service_role', 'public.regional_payment_refunds', 'INSERT')
        END
    UNION ALL
    SELECT
        'manual-payment columns exist',
        (
            SELECT count(*) = 3
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'shops'
              AND column_name IN (
                  'manual_payment_preference',
                  'manual_payment_method',
                  'manual_payment_instructions'
              )
        )
        AND (
            SELECT count(*) = 3
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'orders'
              AND column_name IN (
                  'payment_details',
                  'payment_confirmed_at',
                  'payment_confirmed_by'
              )
        )
    UNION ALL
    SELECT
        'manual-payment destinations have scoped read and admin-only writes',
        CASE
            WHEN to_regclass('public.marketplace_payment_destinations') IS NULL
                THEN false
            ELSE (
                SELECT relrowsecurity
                FROM pg_class
                WHERE oid = to_regclass('public.marketplace_payment_destinations')
            )
            AND has_table_privilege('anon', 'public.marketplace_payment_destinations', 'SELECT')
            AND has_table_privilege('authenticated', 'public.marketplace_payment_destinations', 'SELECT')
            AND NOT has_table_privilege('anon', 'public.marketplace_payment_destinations', 'INSERT')
            AND NOT has_table_privilege('anon', 'public.marketplace_payment_destinations', 'UPDATE')
            AND NOT has_table_privilege('anon', 'public.marketplace_payment_destinations', 'DELETE')
            AND NOT has_table_privilege('authenticated', 'public.marketplace_payment_destinations', 'INSERT')
            AND NOT has_table_privilege('authenticated', 'public.marketplace_payment_destinations', 'UPDATE')
            AND NOT has_table_privilege('authenticated', 'public.marketplace_payment_destinations', 'DELETE')
            AND EXISTS (
                SELECT 1
                FROM pg_policies
                WHERE schemaname = 'public'
                  AND tablename = 'marketplace_payment_destinations'
                  AND policyname = 'marketplace_payment_destination_public_read'
                  AND cmd = 'SELECT'
                  AND qual ILIKE '%enabled%'
                  AND qual ILIKE '%current_profile_role%'
            )
            AND EXISTS (
                SELECT 1
                FROM pg_policies
                WHERE schemaname = 'public'
                  AND tablename = 'marketplace_payment_destinations'
                  AND policyname = 'marketplace_payment_destination_admin_manage'
                  AND cmd = 'ALL'
                  AND qual ILIKE '%current_profile_role%'
                  AND with_check ILIKE '%current_profile_role%'
            )
        END
    UNION ALL
    SELECT
        'manual-payment confirmations remain server and RPC only',
        CASE
            WHEN to_regclass('public.order_manual_payment_confirmations') IS NULL
                THEN false
            ELSE (
                SELECT relrowsecurity
                FROM pg_class
                WHERE oid = to_regclass('public.order_manual_payment_confirmations')
            )
            AND NOT has_table_privilege('anon', 'public.order_manual_payment_confirmations', 'SELECT')
            AND NOT has_table_privilege('anon', 'public.order_manual_payment_confirmations', 'INSERT')
            AND NOT has_table_privilege('anon', 'public.order_manual_payment_confirmations', 'UPDATE')
            AND NOT has_table_privilege('anon', 'public.order_manual_payment_confirmations', 'DELETE')
            AND NOT has_table_privilege('authenticated', 'public.order_manual_payment_confirmations', 'SELECT')
            AND NOT has_table_privilege('authenticated', 'public.order_manual_payment_confirmations', 'INSERT')
            AND NOT has_table_privilege('authenticated', 'public.order_manual_payment_confirmations', 'UPDATE')
            AND NOT has_table_privilege('authenticated', 'public.order_manual_payment_confirmations', 'DELETE')
        END
    UNION ALL
    SELECT
        'manual-payment RPCs have the expected role grants',
        CASE
            WHEN to_regprocedure('public.admin_save_marketplace_payment_destination(text,boolean,text,text,text,text,text)') IS NULL
              OR to_regprocedure('public.shop_owner_save_manual_payment_preferences(uuid,text,text,text)') IS NULL
              OR to_regprocedure('public.get_order_manual_payment_details(uuid)') IS NULL
              OR to_regprocedure('public.admin_list_pending_platform_manual_payments()') IS NULL
              OR to_regprocedure('public.admin_confirm_platform_manual_payment(uuid)') IS NULL
              OR to_regprocedure('public.shop_owner_list_pending_manual_payment_orders(uuid)') IS NULL
              OR to_regprocedure('public.shop_owner_confirm_manual_payment_receipt(uuid)') IS NULL
                THEN false
            ELSE has_function_privilege(
                     'authenticated',
                     to_regprocedure('public.admin_save_marketplace_payment_destination(text,boolean,text,text,text,text,text)'),
                     'EXECUTE'
                 )
                 AND NOT has_function_privilege(
                     'anon',
                     to_regprocedure('public.admin_save_marketplace_payment_destination(text,boolean,text,text,text,text,text)'),
                     'EXECUTE'
                 )
                 AND has_function_privilege(
                     'authenticated',
                     to_regprocedure('public.shop_owner_save_manual_payment_preferences(uuid,text,text,text)'),
                     'EXECUTE'
                 )
                 AND NOT has_function_privilege(
                     'anon',
                     to_regprocedure('public.shop_owner_save_manual_payment_preferences(uuid,text,text,text)'),
                     'EXECUTE'
                 )
                 AND has_function_privilege(
                     'anon',
                     to_regprocedure('public.get_order_manual_payment_details(uuid)'),
                     'EXECUTE'
                 )
                 AND has_function_privilege(
                     'authenticated',
                     to_regprocedure('public.get_order_manual_payment_details(uuid)'),
                     'EXECUTE'
                 )
                 AND has_function_privilege(
                     'authenticated',
                     to_regprocedure('public.admin_list_pending_platform_manual_payments()'),
                     'EXECUTE'
                 )
                 AND NOT has_function_privilege(
                     'anon',
                     to_regprocedure('public.admin_list_pending_platform_manual_payments()'),
                     'EXECUTE'
                 )
                 AND has_function_privilege(
                     'authenticated',
                     to_regprocedure('public.admin_confirm_platform_manual_payment(uuid)'),
                     'EXECUTE'
                 )
                 AND NOT has_function_privilege(
                     'anon',
                     to_regprocedure('public.admin_confirm_platform_manual_payment(uuid)'),
                     'EXECUTE'
                 )
                 AND has_function_privilege(
                     'authenticated',
                     to_regprocedure('public.shop_owner_list_pending_manual_payment_orders(uuid)'),
                     'EXECUTE'
                 )
                 AND NOT has_function_privilege(
                     'anon',
                     to_regprocedure('public.shop_owner_list_pending_manual_payment_orders(uuid)'),
                     'EXECUTE'
                 )
                 AND has_function_privilege(
                     'authenticated',
                     to_regprocedure('public.shop_owner_confirm_manual_payment_receipt(uuid)'),
                     'EXECUTE'
                 )
                 AND NOT has_function_privilege(
                     'anon',
                     to_regprocedure('public.shop_owner_confirm_manual_payment_receipt(uuid)'),
                     'EXECUTE'
                 )
        END
    UNION ALL
    SELECT
        'marketplace media settings are protected and complete',
        to_regclass('public.marketplace_settings') IS NOT NULL
        AND (
            SELECT count(*) = 4
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'marketplace_settings'
              AND column_name IN (
                  'product_image_limit',
                  'student_listing_media_limit',
                  'product_image_max_bytes',
                  'product_video_max_bytes'
              )
        )
        AND coalesce((
            SELECT relrowsecurity
            FROM pg_class
            WHERE oid = to_regclass('public.marketplace_settings')
        ), false)
        AND NOT has_table_privilege('anon', 'public.marketplace_settings', 'SELECT')
        AND NOT has_table_privilege('authenticated', 'public.marketplace_settings', 'SELECT')
        AND NOT has_table_privilege('anon', 'public.marketplace_settings', 'UPDATE')
        AND NOT has_table_privilege('authenticated', 'public.marketplace_settings', 'UPDATE')
    UNION ALL
    SELECT
        'marketplace media settings RPCs have restricted write access',
        CASE
            WHEN to_regprocedure('public.get_marketplace_media_limits()') IS NULL
              OR to_regprocedure('public.admin_update_marketplace_media_limits(integer,integer,integer,integer)') IS NULL
                THEN false
            ELSE has_function_privilege(
                     'anon',
                     to_regprocedure('public.get_marketplace_media_limits()'),
                     'EXECUTE'
                 )
                 AND has_function_privilege(
                     'authenticated',
                     to_regprocedure('public.get_marketplace_media_limits()'),
                     'EXECUTE'
                 )
                 AND has_function_privilege(
                     'authenticated',
                     to_regprocedure('public.admin_update_marketplace_media_limits(integer,integer,integer,integer)'),
                     'EXECUTE'
                 )
                 AND NOT has_function_privilege(
                     'anon',
                     to_regprocedure('public.admin_update_marketplace_media_limits(integer,integer,integer,integer)'),
                     'EXECUTE'
                 )
        END
    UNION ALL
    SELECT
        'marketplace media size guard is installed',
        to_regprocedure('public.enforce_marketplace_product_media_size()') IS NOT NULL
        AND EXISTS (
            SELECT 1
            FROM pg_trigger
            WHERE tgrelid = to_regclass('storage.objects')
              AND tgname = 'enforce_marketplace_product_media_size'
              AND NOT tgisinternal
        )
)
SELECT check_name, passed
FROM checks
ORDER BY passed, check_name;

-- Review the exact browser-facing policies installed for the sensitive tables.
SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE (schemaname, tablename) IN (
    ('public', 'profiles'),
    ('public', 'seller_public_contacts')
)
ORDER BY schemaname, tablename, policyname;

-- Every Auth user with an email should have a marketplace profile linked by
-- profiles.user_id. This is a diagnostic query: pre-existing legacy accounts
-- may need a one-time operator repair with assign_seller_role/assign_admin_role.
SELECT
    count(*) AS auth_users_with_email,
    count(*) FILTER (WHERE profile.id IS NOT NULL) AS linked_profiles,
    count(*) FILTER (WHERE profile.id IS NULL) AS missing_profile_links
FROM auth.users AS auth_user
LEFT JOIN public.profiles AS profile
  ON profile.user_id = auth_user.id
WHERE auth_user.email IS NOT NULL;

-- Run this query after registering a dedicated seller account to confirm the
-- trigger preserved the Auth UUID and seller role. Replace the email literal.
SELECT
    auth_user.id AS auth_user_id,
    auth_user.email,
    profile.id AS profile_id,
    profile.user_id AS linked_user_id,
    profile.account_type,
    profile.role,
    (profile.user_id = auth_user.id) AS linked_to_auth_uuid
FROM auth.users AS auth_user
LEFT JOIN public.profiles AS profile
  ON profile.user_id = auth_user.id
WHERE lower(auth_user.email) = lower('replace-with-seller-test-email@example.com');

-- This should return zero rows. It identifies existing bank-transfer orders
-- that violate the invariant protected by the order and order-item triggers.
SELECT
    order_row.id AS order_id,
    order_row.order_number,
    count(item.id) AS item_count,
    count(item.id) FILTER (
        WHERE coalesce(product.listing_type, 'shop') <> 'shop'
           OR product.shop_id IS NULL
           OR item.shop_id IS DISTINCT FROM product.shop_id
           OR shop.status <> 'active'
           OR shop.verified IS NOT TRUE
    ) AS invalid_item_count
FROM public.orders AS order_row
LEFT JOIN public.order_items AS item
  ON item.order_id = order_row.id
LEFT JOIN public.products AS product
  ON product.id = item.product_id
LEFT JOIN public.shops AS shop
  ON shop.id = product.shop_id
WHERE lower(trim(coalesce(order_row.payment_method, ''))) = 'bank_transfer'
GROUP BY order_row.id, order_row.order_number
HAVING count(item.id) = 0
    OR count(item.id) FILTER (
        WHERE coalesce(product.listing_type, 'shop') <> 'shop'
           OR product.shop_id IS NULL
           OR item.shop_id IS DISTINCT FROM product.shop_id
           OR shop.status <> 'active'
           OR shop.verified IS NOT TRUE
    ) > 0;

-- The runtime companion for server.js is:
--   RATE_LIMIT_STORE=postgres
-- The setting belongs in the API runtime environment, not in Supabase SQL.