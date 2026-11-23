-- Admin-controlled seller media limits with fixed Storage safety ceilings.
-- Apply after database/marketplace-manual-payments.sql.
-- Before applying to any target, verify its Supabase plan and Storage global
-- file-size limit are at least 40 MiB (41,943,040 bytes).

BEGIN;

ALTER TABLE public.marketplace_settings
    ADD COLUMN IF NOT EXISTS student_listing_media_limit INTEGER NOT NULL DEFAULT 10,
    ADD COLUMN IF NOT EXISTS product_image_max_bytes BIGINT NOT NULL DEFAULT 41943040,
    ADD COLUMN IF NOT EXISTS product_video_max_bytes BIGINT NOT NULL DEFAULT 41943040;

ALTER TABLE public.marketplace_settings
    DROP CONSTRAINT IF EXISTS marketplace_settings_student_listing_media_limit_check,
    ADD CONSTRAINT marketplace_settings_student_listing_media_limit_check
        CHECK (student_listing_media_limit BETWEEN 1 AND 100),
    DROP CONSTRAINT IF EXISTS marketplace_settings_product_image_max_bytes_check,
    ADD CONSTRAINT marketplace_settings_product_image_max_bytes_check
        CHECK (product_image_max_bytes BETWEEN 5242880 AND 41943040),
    DROP CONSTRAINT IF EXISTS marketplace_settings_product_video_max_bytes_check,
    ADD CONSTRAINT marketplace_settings_product_video_max_bytes_check
        CHECK (product_video_max_bytes BETWEEN 5242880 AND 41943040);

INSERT INTO public.marketplace_settings (
    id,
    product_image_limit,
    student_listing_media_limit,
    product_image_max_bytes,
    product_video_max_bytes
)
VALUES (1, 10, 10, 41943040, 41943040)
ON CONFLICT (id) DO NOTHING;

-- Storage ceilings allow bounded admin adjustments. The database trigger below
-- enforces each current admin-selected size within these fixed maxima.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('product-images', 'product-images', TRUE, 41943040, ARRAY['image/webp']::text[])
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'product-videos',
    'product-videos',
    TRUE,
    41943040,
    ARRAY['video/mp4', 'video/webm', 'video/quicktime']::text[]
)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

ALTER TABLE public.marketplace_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.marketplace_settings FROM PUBLIC, anon, authenticated;

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

    SELECT CASE
        WHEN product_shop_id IS NULL
             AND product_listing_type IN ('student_item', 'student_ad')
            THEN settings.student_listing_media_limit
        WHEN product_shop_id IS NOT NULL
            THEN settings.product_image_limit
        ELSE NULL
    END
    INTO configured_limit
    FROM public.marketplace_settings AS settings
    WHERE settings.id = 1
    FOR SHARE;

    RETURN configured_limit;
END
$function$;

CREATE OR REPLACE FUNCTION public.get_marketplace_media_limits()
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
    SELECT pg_catalog.jsonb_build_object(
        'product_image_limit', settings.product_image_limit,
        'student_listing_media_limit', settings.student_listing_media_limit,
        'product_image_max_bytes', settings.product_image_max_bytes,
        'product_video_max_bytes', settings.product_video_max_bytes
    )
    FROM public.marketplace_settings AS settings
    WHERE settings.id = 1
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_marketplace_media_limits(
    p_product_image_limit INTEGER,
    p_student_listing_media_limit INTEGER,
    p_product_image_max_mib INTEGER,
    p_product_video_max_mib INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
BEGIN
    IF public.current_profile_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Administrator access is required'
            USING ERRCODE = '42501';
    END IF;

    IF p_product_image_limit IS NULL OR p_product_image_limit NOT BETWEEN 1 AND 100
       OR p_student_listing_media_limit IS NULL OR p_student_listing_media_limit NOT BETWEEN 1 AND 100
       OR p_product_image_max_mib IS NULL OR p_product_image_max_mib NOT BETWEEN 5 AND 40
       OR p_product_video_max_mib IS NULL OR p_product_video_max_mib NOT BETWEEN 5 AND 40 THEN
        RAISE EXCEPTION 'Media settings are outside the supported ranges'
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.marketplace_settings
    SET product_image_limit = p_product_image_limit,
        student_listing_media_limit = p_student_listing_media_limit,
        product_image_max_bytes = p_product_image_max_mib::BIGINT * 1048576,
        product_video_max_bytes = p_product_video_max_mib::BIGINT * 1048576,
        updated_at = pg_catalog.now()
    WHERE id = 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Marketplace media settings are not initialized'
            USING ERRCODE = '55000';
    END IF;

    RETURN public.get_marketplace_media_limits();
END
$function$;

CREATE OR REPLACE FUNCTION public.enforce_marketplace_product_media_size()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
    media_limit BIGINT;
    media_size BIGINT;
    media_size_text TEXT;
    media_mimetype TEXT;
BEGIN
    IF NEW.bucket_id NOT IN ('product-images', 'product-videos') THEN
        RETURN NEW;
    END IF;

    -- Current Supabase Storage writes contentLength; older Storage versions
    -- used size. Accept both without trusting client-supplied user_metadata.
    media_size_text := coalesce(NEW.metadata->>'size', NEW.metadata->>'contentLength');
    IF media_size_text IS NULL OR media_size_text !~ '^[0-9]+$' THEN
        RAISE EXCEPTION 'Product media size metadata is required'
            USING ERRCODE = '23514';
    END IF;
    media_size := media_size_text::BIGINT;
    media_mimetype := pg_catalog.lower(coalesce(NEW.metadata->>'mimetype', ''));

    IF NEW.bucket_id = 'product-images' THEN
        IF media_mimetype <> 'image/webp' THEN
            RAISE EXCEPTION 'Product photos must be WebP images'
                USING ERRCODE = '23514';
        END IF;
        SELECT settings.product_image_max_bytes
        INTO media_limit
        FROM public.marketplace_settings AS settings
        WHERE settings.id = 1;
    ELSE
        IF media_mimetype NOT IN ('video/mp4', 'video/webm', 'video/quicktime') THEN
            RAISE EXCEPTION 'This video format is not supported'
                USING ERRCODE = '23514';
        END IF;
        SELECT settings.product_video_max_bytes
        INTO media_limit
        FROM public.marketplace_settings AS settings
        WHERE settings.id = 1;
    END IF;

    IF media_limit IS NULL THEN
        RAISE EXCEPTION 'Marketplace media settings are unavailable'
            USING ERRCODE = '55000';
    END IF;
    IF media_size < 1 OR media_size > media_limit THEN
        RAISE EXCEPTION 'This file exceeds the current marketplace upload limit'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS enforce_marketplace_product_media_size ON storage.objects;
CREATE TRIGGER enforce_marketplace_product_media_size
BEFORE INSERT OR UPDATE ON storage.objects
FOR EACH ROW
EXECUTE FUNCTION public.enforce_marketplace_product_media_size();

REVOKE ALL ON FUNCTION public.product_image_limit_for(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.product_image_limit_for(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.get_marketplace_media_limits() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_marketplace_media_limits() TO anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_update_marketplace_media_limits(INTEGER, INTEGER, INTEGER, INTEGER)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_marketplace_media_limits(INTEGER, INTEGER, INTEGER, INTEGER)
    TO authenticated;
REVOKE ALL ON FUNCTION public.enforce_marketplace_product_media_size() FROM PUBLIC, anon, authenticated;

COMMIT;
