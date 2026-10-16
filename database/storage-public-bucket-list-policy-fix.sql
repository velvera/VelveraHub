-- Public buckets can serve known object URLs without a SELECT policy.
-- These broad policies also enable clients to enumerate object names, so
-- remove them while keeping the buckets public for existing product media.
BEGIN;

DROP POLICY IF EXISTS "public can read product image objects" ON storage.objects;
DROP POLICY IF EXISTS "public can read product video objects" ON storage.objects;

COMMIT;
