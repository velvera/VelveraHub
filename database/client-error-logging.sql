-- Store sanitized browser diagnostics in the server-only operational event log.
-- The admin API is the only read path; browser roles cannot query this table.
BEGIN;

ALTER TABLE public.operational_events
    DROP CONSTRAINT IF EXISTS operational_events_event_name_check;

ALTER TABLE public.operational_events
    ADD CONSTRAINT operational_events_event_name_check
    CHECK (event_name IN (
        'catalogue_failure',
        'checkout_abandonment',
        'checkout_failure',
        'auth_failure',
        'slow_api_request',
        'seller_publish_error',
        'client_error'
    ));

ALTER TABLE public.operational_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.operational_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.operational_events TO service_role;

COMMENT ON TABLE public.operational_events IS
    'Operational events, including sanitized client errors. Read through admin-only API endpoints.';

COMMIT;
