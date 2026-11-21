-- Narrow, authenticated status lookup for the account-deletion request queue.
-- Apply after database/cloudflare-supabase-direct.sql.
-- This does not delete an Auth user or related marketplace data.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_my_account_deletion_request()
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
    SELECT pg_catalog.jsonb_build_object(
        'request_id', request.request_id,
        'status', request.status,
        'created_at', request.created_at,
        'completed_at', request.completed_at
    )
    FROM public.data_deletion_requests AS request
    WHERE request.user_id = public.current_profile_id()
      AND public.current_profile_id() IS NOT NULL
    ORDER BY request.created_at DESC
    LIMIT 1
$function$;

REVOKE ALL ON FUNCTION public.get_my_account_deletion_request() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_account_deletion_request() TO authenticated;

COMMENT ON FUNCTION public.get_my_account_deletion_request() IS
    'Returns only the signed-in user’s latest deletion-request status; does not verify or perform account/data deletion.';

COMMIT;
