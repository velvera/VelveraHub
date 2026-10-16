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