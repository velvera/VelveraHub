-- Fix the ambiguous product_id reference in the Storage media quota trigger.
-- Apply after migrations 1–17 in database/run-schema.txt.
-- This replaces only the trigger function; it does not alter stored data or
-- remove the media size, MIME type, ownership, or quota checks.

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_product_media_object_quota()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
    v_product_id UUID;
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

        v_product_id := pg_catalog.split_part(NEW.name, '/', 1)::UUID;
        IF NOT public.can_manage_product_media(v_product_id) THEN
            RAISE EXCEPTION 'You cannot upload media for this listing'
                USING ERRCODE = '42501';
        END IF;

        SELECT product.shop_id
        INTO product_shop_id
        FROM public.products AS product
        WHERE product.id = v_product_id;

        IF NEW.bucket_id = 'product-videos' AND product_shop_id IS NOT NULL THEN
            RAISE EXCEPTION 'Videos are only allowed on independent listings'
                USING ERRCODE = '23514';
        END IF;

        media_limit := public.product_image_limit_for(v_product_id);
        IF media_limit IS NULL THEN
            RAISE EXCEPTION 'Product media limit is unavailable for this listing'
                USING ERRCODE = '23514';
        END IF;
        counts_toward_quota := NEW.bucket_id = 'product-images'
            OR product_shop_id IS NULL;

        INSERT INTO public.product_media_quota_objects (
            bucket_id, object_name, product_id, counts_toward_quota
        )
        VALUES (NEW.bucket_id, NEW.name, v_product_id, counts_toward_quota)
        ON CONFLICT (bucket_id, object_name) DO NOTHING;
        IF NOT FOUND THEN
            RETURN NEW;
        END IF;

        IF counts_toward_quota THEN
            INSERT INTO public.product_media_quota_usage (product_id, object_count)
            VALUES (v_product_id, 1)
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

COMMIT;
