BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT * FROM public.assign_admin_role('registered-email@example.com');
COMMIT;