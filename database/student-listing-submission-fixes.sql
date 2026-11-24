-- Repair two listing submission failures on projects with migration 6 and 15.
-- Apply after the ordered migrations in database/run-schema.txt.
--
-- 1. products.image_url is not present in the normalized product schema;
--    access it through the row JSON so legacy schemas with that column still
--    retain the review-change behavior.
-- 2. Current Supabase Storage writes metadata.contentLength. Older projects may
--    still have metadata.size, so accept either server-generated field.

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_product_listing_review()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
    listing_content_changed BOOLEAN := FALSE;
    review_fields_changed BOOLEAN := FALSE;
BEGIN
    IF auth.uid() IS NULL OR coalesce(public.current_profile_role(), '') = 'admin' THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        NEW.moderation_status := 'pending';
        NEW.moderation_note := NULL;
        NEW.moderated_by := NULL;
        NEW.moderated_at := NULL;
        RETURN NEW;
    END IF;

    listing_content_changed :=
        ROW(
            NEW.title, NEW.description, NEW.short_description, NEW.price,
            NEW.original_price, NEW.discount_percent, NEW.category, NEW.category_id,
            NEW.location, NEW.school_id, NEW.school_slug, NEW.school_name,
            NEW.school_city, NEW.campus_area, NEW.condition, NEW.delivery_options,
            NEW.specifications, NEW.tags, to_jsonb(NEW) -> 'image_url'
        ) IS DISTINCT FROM ROW(
            OLD.title, OLD.description, OLD.short_description, OLD.price,
            OLD.original_price, OLD.discount_percent, OLD.category, OLD.category_id,
            OLD.location, OLD.school_id, OLD.school_slug, OLD.school_name,
            OLD.school_city, OLD.campus_area, OLD.condition, OLD.delivery_options,
            OLD.specifications, OLD.tags, to_jsonb(OLD) -> 'image_url'
        );
    review_fields_changed :=
        ROW(NEW.moderation_status, NEW.moderation_note, NEW.moderated_by, NEW.moderated_at)
        IS DISTINCT FROM
        ROW(OLD.moderation_status, OLD.moderation_note, OLD.moderated_by, OLD.moderated_at);

    IF listing_content_changed OR review_fields_changed THEN
        NEW.moderation_status := 'pending';
        NEW.moderation_note := NULL;
        NEW.moderated_by := NULL;
        NEW.moderated_at := NULL;
    END IF;
    RETURN NEW;
END;
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
END;
$function$;

COMMIT;
