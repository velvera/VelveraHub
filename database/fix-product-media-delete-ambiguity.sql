-- Fixes PostgreSQL 42702 ("column reference is ambiguous") when failed
-- listing uploads are cleaned up or uploaded media is removed. Re-run this
-- after database/supabase-rls.sql on an existing production database.
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
