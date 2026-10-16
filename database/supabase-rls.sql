-- Supabase security policies for VelveraHub seller product management.
-- Run this migration in the Supabase SQL editor after the base schema.
-- It supports both direct auth UUID ownership and profiles.user_id mappings.

-- These additive guards make this file safe to re-run against an older
-- catalogue migration where the compatibility columns were not present yet.
-- Run schema.sql first when creating a new project.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS seller_id UUID;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS listing_type TEXT DEFAULT 'shop';

CREATE TABLE IF NOT EXISTS public.marketplace_settings (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    product_image_limit INTEGER NOT NULL DEFAULT 10
        CHECK (product_image_limit BETWEEN 1 AND 100),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO public.marketplace_settings (id, product_image_limit)
VALUES (1, 10)
ON CONFLICT (id) DO NOTHING;

-- Product images are intentionally public because storefront product cards use
-- public Storage URLs. The restrictive write policies below require owned
-- product UUID folders, generated UUID filenames, and a locked per-product
-- quota. Shop products use the admin-set image cap; student listings stay at 6.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'product-images',
    'product-images',
    TRUE,
    5242880,
    ARRAY['image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Video uploads use a separate bucket so the image bucket can enforce a
-- strict WebP-only policy without accepting oversized or unsupported media.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'product-videos',
    'product-videos',
    TRUE,
    52428800,
    ARRAY['video/mp4', 'video/webm', 'video/quicktime']::text[]
)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public can read active schools" ON public.schools;
CREATE POLICY "public can read active schools"
ON public.schools FOR SELECT
TO anon, authenticated
USING (is_active = TRUE);

DROP POLICY IF EXISTS "public can read active shops" ON public.shops;
CREATE POLICY "public can read active shops"
ON public.shops FOR SELECT
TO anon, authenticated
USING (status = 'active');

DROP POLICY IF EXISTS "owners can read their shops" ON public.shops;
CREATE POLICY "owners can read their shops"
ON public.shops FOR SELECT
TO authenticated
USING (
    owner_id = auth.uid()
    OR current_owner_id = auth.uid()
    OR EXISTS (
        SELECT 1 FROM public.profiles profile
        WHERE profile.user_id = auth.uid()
          AND (profile.id = shops.owner_id OR profile.id = shops.current_owner_id)
    )
);

DROP POLICY IF EXISTS "public can read active products" ON public.products;
CREATE POLICY "public can read active products"
ON public.products FOR SELECT
TO anon, authenticated
USING (status = 'active' AND moderation_status = 'approved');

DROP POLICY IF EXISTS "owners can manage their products" ON public.products;
CREATE POLICY "owners can manage their products"
ON public.products FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.shops shop
        WHERE shop.id = products.shop_id
          AND (
              shop.owner_id = auth.uid()
              OR shop.current_owner_id = auth.uid()
              OR EXISTS (
                  SELECT 1 FROM public.profiles profile
                  WHERE profile.user_id = auth.uid()
                    AND (profile.id = shop.owner_id OR profile.id = shop.current_owner_id)
              )
          )
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.shops shop
        WHERE shop.id = products.shop_id
          AND (
              shop.owner_id = auth.uid()
              OR shop.current_owner_id = auth.uid()
              OR EXISTS (
                  SELECT 1 FROM public.profiles profile
                  WHERE profile.user_id = auth.uid()
                    AND (profile.id = shop.owner_id OR profile.id = shop.current_owner_id)
              )
          )
    )
);

-- Authenticated customers can publish independent campus listings without
-- opening a shop. A student listing must be seller-owned and shop-less.
DROP POLICY IF EXISTS "students can manage their own listings" ON public.products;
CREATE POLICY "students can manage their own listings"
ON public.products FOR ALL
TO authenticated
USING (
    shop_id IS NULL
    AND listing_type IN ('student_item', 'student_ad')
    AND (
        seller_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.profiles profile
            WHERE profile.id = products.seller_id
              AND profile.user_id = auth.uid()
        )
    )
)
WITH CHECK (
    shop_id IS NULL
    AND listing_type IN ('student_item', 'student_ad')
    AND (
        seller_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.profiles profile
            WHERE profile.id = products.seller_id
              AND profile.user_id = auth.uid()
        )
    )
);

DROP POLICY IF EXISTS "public can read product images" ON public.product_images;
CREATE POLICY "public can read product images"
ON public.product_images FOR SELECT
TO anon, authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.products product
        WHERE product.id = product_images.product_id
          AND product.status = 'active'
          AND product.moderation_status = 'approved'
          AND (
              product.listing_type <> 'shop'
              OR EXISTS (
                  SELECT 1 FROM public.shops shop
                  WHERE shop.id = product.shop_id
                    AND shop.status = 'active'
              )
          )
    )
);

DROP POLICY IF EXISTS "owners can manage product images" ON public.product_images;
CREATE POLICY "owners can manage product images"
ON public.product_images FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.products product
        JOIN public.shops shop ON shop.id = product.shop_id
        WHERE product.id = product_images.product_id
          AND (
              shop.owner_id = auth.uid()
              OR shop.current_owner_id = auth.uid()
              OR EXISTS (
                  SELECT 1 FROM public.profiles profile
                  WHERE profile.user_id = auth.uid()
                    AND (profile.id = shop.owner_id OR profile.id = shop.current_owner_id)
              )
          )
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.products product
        JOIN public.shops shop ON shop.id = product.shop_id
        WHERE product.id = product_images.product_id
          AND (
              shop.owner_id = auth.uid()
              OR shop.current_owner_id = auth.uid()
              OR EXISTS (
                  SELECT 1 FROM public.profiles profile
                  WHERE profile.user_id = auth.uid()
                    AND (profile.id = shop.owner_id OR profile.id = shop.current_owner_id)
              )
          )
    )
);

DROP POLICY IF EXISTS "students can manage their listing images" ON public.product_images;
CREATE POLICY "students can manage their listing images"
ON public.product_images FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.products product
        WHERE product.id = product_images.product_id
          AND product.shop_id IS NULL
          AND product.listing_type IN ('student_item', 'student_ad')
          AND (
              product.seller_id = auth.uid()
              OR EXISTS (
                  SELECT 1 FROM public.profiles profile
                  WHERE profile.id = product.seller_id
                    AND profile.user_id = auth.uid()
              )
          )
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.products product
        WHERE product.id = product_images.product_id
          AND product.shop_id IS NULL
          AND product.listing_type IN ('student_item', 'student_ad')
          AND (
              product.seller_id = auth.uid()
              OR EXISTS (
                  SELECT 1 FROM public.profiles profile
                  WHERE profile.id = product.seller_id
                    AND profile.user_id = auth.uid()
              )
          )
    )
);

CREATE OR REPLACE FUNCTION public.is_product_media_path(p_bucket_id TEXT, p_object_name TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
SET search_path = ''
AS $function$
    SELECT CASE
        WHEN p_bucket_id = 'product-images' THEN
            p_object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]webp$'
        WHEN p_bucket_id = 'product-videos' THEN
            p_object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](mp4|webm|mov)$'
        ELSE FALSE
    END
$function$;

CREATE OR REPLACE FUNCTION public.can_manage_product_media(p_product_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.products AS product
        WHERE product.id = p_product_id
          AND (
              (
                  product.shop_id IS NULL
                  AND product.listing_type IN ('student_item', 'student_ad')
                  AND (
                      product.seller_id = auth.uid()
                      OR EXISTS (
                          SELECT 1
                          FROM public.profiles AS profile
                          WHERE profile.id = product.seller_id
                            AND profile.user_id = auth.uid()
                      )
                  )
              )
              OR (
                  product.shop_id IS NOT NULL
                  AND EXISTS (
                      SELECT 1
                      FROM public.shops AS shop
                      WHERE shop.id = product.shop_id
                        AND (
                            shop.owner_id = auth.uid()
                            OR shop.current_owner_id = auth.uid()
                            OR EXISTS (
                                SELECT 1
                                FROM public.profiles AS profile
                                WHERE profile.user_id = auth.uid()
                                  AND (profile.id = shop.owner_id OR profile.id = shop.current_owner_id)
                            )
                        )
                  )
              )
          )
    )
$function$;

CREATE OR REPLACE FUNCTION public.product_image_limit_for(p_product_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
    product_shop_id UUID;
    product_listing_type TEXT;
    configured_limit INTEGER;
BEGIN
    SELECT product.shop_id, product.listing_type
    INTO product_shop_id, product_listing_type
    FROM public.products AS product
    WHERE product.id = p_product_id;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    IF product_shop_id IS NULL THEN
        IF product_listing_type IN ('student_item', 'student_ad') THEN
            RETURN 6;
        END IF;
        RETURN NULL;
    END IF;

    SELECT settings.product_image_limit
    INTO configured_limit
    FROM public.marketplace_settings AS settings
    WHERE settings.id = 1
    FOR SHARE;

    RETURN configured_limit;
END
$function$;

-- Storage policy expressions run inside the Storage request's statement
-- snapshot. Counting storage.objects after an advisory-lock wait can therefore
-- observe stale data when two uploads start concurrently. Keep an atomic
-- per-product counter and a private object ledger instead; PostgreSQL's
-- conflicting-row update serializes quota reservations through commit.
CREATE TABLE IF NOT EXISTS public.product_media_quota_usage (
    product_id UUID PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
    object_count INTEGER NOT NULL DEFAULT 0 CHECK (object_count >= 0)
);

CREATE TABLE IF NOT EXISTS public.product_media_quota_objects (
    bucket_id TEXT NOT NULL
        CHECK (bucket_id IN ('product-images', 'product-videos')),
    object_name TEXT NOT NULL,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    counts_toward_quota BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (bucket_id, object_name)
);

ALTER TABLE public.product_media_quota_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_media_quota_objects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.product_media_quota_usage FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.product_media_quota_objects FROM PUBLIC, anon, authenticated;

-- Account for objects that already exist when this policy file is first
-- applied. Count student images + videos together; shop quotas apply to images.
INSERT INTO public.product_media_quota_objects (
    bucket_id, object_name, product_id, counts_toward_quota
)
SELECT
    stored_object.bucket_id,
    stored_object.name,
    product.id,
    stored_object.bucket_id = 'product-images' OR product.shop_id IS NULL
FROM storage.objects AS stored_object
JOIN public.products AS product
  ON product.id::TEXT = pg_catalog.split_part(stored_object.name, '/', 1)
WHERE stored_object.bucket_id IN ('product-images', 'product-videos')
ON CONFLICT (bucket_id, object_name) DO NOTHING;

INSERT INTO public.product_media_quota_usage (product_id, object_count)
SELECT media_object.product_id, pg_catalog.count(*)::INTEGER
FROM public.product_media_quota_objects AS media_object
WHERE media_object.counts_toward_quota
GROUP BY media_object.product_id
ON CONFLICT (product_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.can_upload_product_media(p_bucket_id TEXT, p_object_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
    product_id UUID;
    product_shop_id UUID;
BEGIN
    IF NOT public.is_product_media_path(p_bucket_id, p_object_name) THEN
        RETURN FALSE;
    END IF;

    product_id := split_part(p_object_name, '/', 1)::UUID;
    IF NOT public.can_manage_product_media(product_id) THEN
        RETURN FALSE;
    END IF;

    SELECT product.shop_id
    INTO product_shop_id
    FROM public.products AS product
    WHERE product.id = product_id;

    IF p_bucket_id = 'product-videos' AND product_shop_id IS NOT NULL THEN
        RETURN FALSE;
    END IF;

    -- Object-count reservations are enforced by the storage.objects trigger,
    -- where a conditional UPDATE of one counter row is atomic under contention.
    RETURN public.product_image_limit_for(product_id) IS NOT NULL;
END
$function$;

CREATE OR REPLACE FUNCTION public.enforce_product_media_object_quota()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
    product_id UUID;
    product_shop_id UUID;
    media_limit INTEGER;
    resulting_count INTEGER;
    counts_toward_quota BOOLEAN;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.bucket_id IS DISTINCT FROM OLD.bucket_id
           OR NEW.name IS DISTINCT FROM OLD.name THEN
            RAISE EXCEPTION 'Product media cannot be moved or renamed'
                USING ERRCODE = '23514';
        END IF;
        IF NEW.bucket_id IN ('product-images', 'product-videos') THEN
            IF NOT public.is_product_media_path(NEW.bucket_id, NEW.name) THEN
                RAISE EXCEPTION 'Product media path is invalid'
                    USING ERRCODE = '42501';
            END IF;
            IF NOT public.can_manage_product_media(
                pg_catalog.split_part(NEW.name, '/', 1)::UUID
            ) THEN
                RAISE EXCEPTION 'Product media owner is invalid'
                    USING ERRCODE = '42501';
            END IF;
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.bucket_id NOT IN ('product-images', 'product-videos') THEN
            RETURN NEW;
        END IF;
        IF NOT public.is_product_media_path(NEW.bucket_id, NEW.name) THEN
            RAISE EXCEPTION 'Product media must use a generated UUID filename'
                USING ERRCODE = '23514';
        END IF;

        product_id := pg_catalog.split_part(NEW.name, '/', 1)::UUID;
        IF NOT public.can_manage_product_media(product_id) THEN
            RAISE EXCEPTION 'You cannot upload media for this listing'
                USING ERRCODE = '42501';
        END IF;

        SELECT product.shop_id
        INTO product_shop_id
        FROM public.products AS product
        WHERE product.id = product_id;

        IF NEW.bucket_id = 'product-videos' AND product_shop_id IS NOT NULL THEN
            RAISE EXCEPTION 'Videos are only allowed on independent listings'
                USING ERRCODE = '23514';
        END IF;

        media_limit := public.product_image_limit_for(product_id);
        IF media_limit IS NULL THEN
            RAISE EXCEPTION 'Product media limit is unavailable for this listing'
                USING ERRCODE = '23514';
        END IF;
        counts_toward_quota := NEW.bucket_id = 'product-images'
            OR product_shop_id IS NULL;

        -- An upsert of an existing object must not reserve a second slot. The
        -- unique key also serializes simultaneous attempts to create one path.
        INSERT INTO public.product_media_quota_objects (
            bucket_id, object_name, product_id, counts_toward_quota
        )
        VALUES (NEW.bucket_id, NEW.name, product_id, counts_toward_quota)
        ON CONFLICT (bucket_id, object_name) DO NOTHING;
        IF NOT FOUND THEN
            RETURN NEW;
        END IF;

        IF counts_toward_quota THEN
            INSERT INTO public.product_media_quota_usage (product_id, object_count)
            VALUES (product_id, 1)
            ON CONFLICT (product_id) DO UPDATE
            SET object_count = public.product_media_quota_usage.object_count + 1
            WHERE public.product_media_quota_usage.object_count < media_limit
            RETURNING object_count INTO resulting_count;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'This listing allows up to % media files', media_limit
                    USING ERRCODE = '23514';
            END IF;
        END IF;
        RETURN NEW;
    END IF;

    RETURN NULL;
END
$function$;

CREATE OR REPLACE FUNCTION public.release_product_media_quota()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
    v_product_id UUID;
    counts_toward_quota BOOLEAN;
BEGIN
    DELETE FROM public.product_media_quota_objects AS media_object
    WHERE media_object.bucket_id = OLD.bucket_id
      AND media_object.object_name = OLD.name
    RETURNING media_object.product_id, media_object.counts_toward_quota
    INTO v_product_id, counts_toward_quota;

    IF FOUND AND counts_toward_quota THEN
        UPDATE public.product_media_quota_usage AS usage
        SET object_count = GREATEST(usage.object_count - 1, 0)
        WHERE usage.product_id = v_product_id;
    END IF;
    RETURN OLD;
END
$function$;

REVOKE ALL ON FUNCTION public.is_product_media_path(TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage_product_media(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.product_image_limit_for(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_upload_product_media(TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.enforce_product_media_object_quota() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_product_media_quota() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_product_media_path(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_product_media(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.product_image_limit_for(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_upload_product_media(TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_product_image_limit_after_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
    affected_product_id UUID;
    image_limit INTEGER;
    image_count BIGINT;
BEGIN
    FOR affected_product_id IN
        SELECT DISTINCT inserted_image.product_id
        FROM inserted_product_images AS inserted_image
        WHERE inserted_image.product_id IS NOT NULL
        ORDER BY inserted_image.product_id
    LOOP
        PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(affected_product_id::TEXT, 384193)
        );

        image_limit := public.product_image_limit_for(affected_product_id);
        IF image_limit IS NULL THEN
            RAISE EXCEPTION 'Product image limit is unavailable for this listing'
                USING ERRCODE = '23514';
        END IF;

        SELECT count(*)
        INTO image_count
        FROM public.product_images AS image_row
        WHERE image_row.product_id = affected_product_id;

        IF image_count > image_limit THEN
            RAISE EXCEPTION 'This product allows up to % media files', image_limit
                USING ERRCODE = '23514';
        END IF;
    END LOOP;

    RETURN NULL;
END
$function$;

CREATE OR REPLACE FUNCTION public.prevent_product_image_move()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
    IF NEW.product_id IS DISTINCT FROM OLD.product_id THEN
        RAISE EXCEPTION 'Product media cannot be moved between products'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS enforce_product_image_limit_after_insert ON public.product_images;
CREATE TRIGGER enforce_product_image_limit_after_insert
AFTER INSERT ON public.product_images
REFERENCING NEW TABLE AS inserted_product_images
FOR EACH STATEMENT
EXECUTE FUNCTION public.enforce_product_image_limit_after_insert();

DROP TRIGGER IF EXISTS prevent_product_image_move ON public.product_images;
CREATE TRIGGER prevent_product_image_move
BEFORE UPDATE OF product_id ON public.product_images
FOR EACH ROW
EXECUTE FUNCTION public.prevent_product_image_move();

DROP TRIGGER IF EXISTS enforce_product_media_object_quota ON storage.objects;
CREATE TRIGGER enforce_product_media_object_quota
BEFORE INSERT OR UPDATE ON storage.objects
FOR EACH ROW
EXECUTE FUNCTION public.enforce_product_media_object_quota();

DROP TRIGGER IF EXISTS release_product_media_quota ON storage.objects;
CREATE TRIGGER release_product_media_quota
AFTER DELETE ON storage.objects
FOR EACH ROW
EXECUTE FUNCTION public.release_product_media_quota();

-- The client uploads to <product UUID>/<random filename>.webp.
DROP POLICY IF EXISTS "owners can upload product images" ON storage.objects;
CREATE POLICY "owners can upload product images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'product-images'
    AND EXISTS (
        SELECT 1
        FROM public.products product
        JOIN public.shops shop ON shop.id = product.shop_id
        WHERE product.id::text = (storage.foldername(name))[1]
          AND (
              shop.owner_id = auth.uid()
              OR shop.current_owner_id = auth.uid()
              OR EXISTS (
                  SELECT 1 FROM public.profiles profile
                  WHERE profile.user_id = auth.uid()
                    AND (profile.id = shop.owner_id OR profile.id = shop.current_owner_id)
              )
          )
    )
);

DROP POLICY IF EXISTS "students can upload listing images" ON storage.objects;
CREATE POLICY "students can upload listing images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'product-images'
    AND EXISTS (
        SELECT 1 FROM public.products product
        WHERE product.id::text = (storage.foldername(name))[1]
          AND product.shop_id IS NULL
          AND product.listing_type IN ('student_item', 'student_ad')
          AND (
              product.seller_id = auth.uid()
              OR EXISTS (
                  SELECT 1 FROM public.profiles profile
                  WHERE profile.id = product.seller_id
                    AND profile.user_id = auth.uid()
              )
          )
    )
);

-- The public bucket already serves direct public URLs. Do not grant broad
-- SELECT access here: it also lets clients list every object's name.
DROP POLICY IF EXISTS "public can read product image objects" ON storage.objects;

DROP POLICY IF EXISTS "owners can update product images" ON storage.objects;
CREATE POLICY "owners can update product images"
ON storage.objects FOR UPDATE
TO authenticated
USING (
    bucket_id = 'product-images'
    AND EXISTS (
        SELECT 1
        FROM public.products product
        JOIN public.shops shop ON shop.id = product.shop_id
        WHERE product.id::text = (storage.foldername(name))[1]
          AND (
              shop.owner_id = auth.uid()
              OR shop.current_owner_id = auth.uid()
              OR EXISTS (
                  SELECT 1 FROM public.profiles profile
                  WHERE profile.user_id = auth.uid()
                    AND (profile.id = shop.owner_id OR profile.id = shop.current_owner_id)
              )
          )
    )
)
WITH CHECK (
    bucket_id = 'product-images'
    AND EXISTS (
        SELECT 1
        FROM public.products product
        JOIN public.shops shop ON shop.id = product.shop_id
        WHERE product.id::text = (storage.foldername(name))[1]
          AND (
              shop.owner_id = auth.uid()
              OR shop.current_owner_id = auth.uid()
              OR EXISTS (
                  SELECT 1 FROM public.profiles profile
                  WHERE profile.user_id = auth.uid()
                    AND (profile.id = shop.owner_id OR profile.id = shop.current_owner_id)
              )
          )
    )
);

DROP POLICY IF EXISTS "students can update listing images" ON storage.objects;
CREATE POLICY "students can update listing images"
ON storage.objects FOR UPDATE
TO authenticated
USING (
    bucket_id = 'product-images'
    AND EXISTS (
        SELECT 1 FROM public.products product
        WHERE product.id::text = (storage.foldername(name))[1]
          AND product.shop_id IS NULL
          AND product.listing_type IN ('student_item', 'student_ad')
          AND (
              product.seller_id = auth.uid()
              OR EXISTS (
                  SELECT 1 FROM public.profiles profile
                  WHERE profile.id = product.seller_id
                    AND profile.user_id = auth.uid()
              )
          )
    )
)
WITH CHECK (
    bucket_id = 'product-images'
    AND EXISTS (
        SELECT 1 FROM public.products product
        WHERE product.id::text = (storage.foldername(name))[1]
          AND product.shop_id IS NULL
          AND product.listing_type IN ('student_item', 'student_ad')
          AND (
              product.seller_id = auth.uid()
              OR EXISTS (
                  SELECT 1 FROM public.profiles profile
                  WHERE profile.id = product.seller_id
                    AND profile.user_id = auth.uid()
              )
          )
    )
);

DROP POLICY IF EXISTS "owners can delete product images" ON storage.objects;
CREATE POLICY "owners can delete product images"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'product-images'
    AND EXISTS (
        SELECT 1
        FROM public.products product
        JOIN public.shops shop ON shop.id = product.shop_id
        WHERE product.id::text = (storage.foldername(name))[1]
          AND (
              shop.owner_id = auth.uid()
              OR shop.current_owner_id = auth.uid()
              OR EXISTS (
                  SELECT 1 FROM public.profiles profile
                  WHERE profile.user_id = auth.uid()
                    AND (profile.id = shop.owner_id OR profile.id = shop.current_owner_id)
              )
          )
    )
);

DROP POLICY IF EXISTS "students can delete listing images" ON storage.objects;
CREATE POLICY "students can delete listing images"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'product-images'
    AND EXISTS (
        SELECT 1 FROM public.products product
        WHERE product.id::text = (storage.foldername(name))[1]
          AND product.shop_id IS NULL
          AND product.listing_type IN ('student_item', 'student_ad')
          AND (
              product.seller_id = auth.uid()
              OR EXISTS (
                  SELECT 1 FROM public.profiles profile
                  WHERE profile.id = product.seller_id
                    AND profile.user_id = auth.uid()
              )
          )
    )
);

DROP POLICY IF EXISTS "students can upload listing videos" ON storage.objects;
CREATE POLICY "students can upload listing videos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'product-videos'
    AND EXISTS (
        SELECT 1 FROM public.products product
        WHERE product.id::text = (storage.foldername(name))[1]
          AND product.shop_id IS NULL
          AND product.listing_type IN ('student_item', 'student_ad')
          AND (
              product.seller_id = auth.uid()
              OR EXISTS (
                  SELECT 1 FROM public.profiles profile
                  WHERE profile.id = product.seller_id
                    AND profile.user_id = auth.uid()
              )
          )
    )
);

-- Restrictive policies AND with all older permissive policies, so legacy broad
-- grants cannot bypass the UUID path, owner, or serialized quota checks.
DROP POLICY IF EXISTS "restrict product media uploads" ON storage.objects;
CREATE POLICY "restrict product media uploads"
ON storage.objects AS RESTRICTIVE
FOR INSERT TO authenticated
WITH CHECK (
    bucket_id NOT IN ('product-images', 'product-videos')
    OR public.can_upload_product_media(bucket_id, name)
);

DROP POLICY IF EXISTS "restrict product media updates" ON storage.objects;
CREATE POLICY "restrict product media updates"
ON storage.objects AS RESTRICTIVE
FOR UPDATE TO authenticated
USING (
    bucket_id NOT IN ('product-images', 'product-videos')
    OR CASE
        WHEN public.is_product_media_path(bucket_id, name)
        THEN public.can_manage_product_media(split_part(name, '/', 1)::UUID)
        ELSE FALSE
    END
)
WITH CHECK (
    bucket_id NOT IN ('product-images', 'product-videos')
    OR public.can_upload_product_media(bucket_id, name)
);

-- Direct public video URLs continue to work without exposing bucket listings.
DROP POLICY IF EXISTS "public can read product video objects" ON storage.objects;

DROP POLICY IF EXISTS "students can delete listing videos" ON storage.objects;
CREATE POLICY "students can delete listing videos"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'product-videos'
    AND EXISTS (
        SELECT 1 FROM public.products product
        WHERE product.id::text = (storage.foldername(name))[1]
          AND product.shop_id IS NULL
          AND product.listing_type IN ('student_item', 'student_ad')
          AND (
              product.seller_id = auth.uid()
              OR EXISTS (
                  SELECT 1 FROM public.profiles profile
                  WHERE profile.id = product.seller_id
                    AND profile.user_id = auth.uid()
              )
          )
    )
);
