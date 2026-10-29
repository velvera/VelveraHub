-- VelveraHub security hardening.
--
-- Apply after schema.sql, seller.sql, admin.sql, and supabase-rls.sql.
-- schema.sql creates the core shop/order tables. Apply this before
-- cloudflare-dashboard.sql and production-hardening.sql, which rely on these
-- security helpers. This migration is additive and re-runnable. Run it in the
-- target Supabase SQL Editor with a privileged database role; never expose
-- that role to the browser.

BEGIN;

-- The API can use this table for an atomic, multi-instance fixed-window
-- limiter when RATE_LIMIT_STORE=postgres. The application falls back to its
-- bounded local guard only for public reads if the table is unavailable.
CREATE TABLE IF NOT EXISTS public.api_rate_limit_buckets (
    bucket_key TEXT PRIMARY KEY,
    window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    request_count INTEGER NOT NULL CHECK (request_count > 0),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS api_rate_limit_buckets_expires_idx
    ON public.api_rate_limit_buckets (expires_at);

ALTER TABLE public.api_rate_limit_buckets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_rate_limit_buckets FROM PUBLIC, anon, authenticated;

-- This table is accessed by the backend database role, not by browser
-- PostgREST sessions. Grant only what a deployment's server role needs.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_rate_limit_buckets TO service_role;

-- Keep the helper functions used by every profile policy deterministic and
-- immune to policy recursion.
CREATE OR REPLACE FUNCTION public.current_profile_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT p.id
      FROM public.profiles AS p
     WHERE p.user_id = auth.uid()
        OR p.id = auth.uid()
     ORDER BY (p.user_id = auth.uid()) DESC
     LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_profile_role()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT p.role
      FROM public.profiles AS p
     WHERE p.user_id = auth.uid()
        OR p.id = auth.uid()
     ORDER BY (p.user_id = auth.uid()) DESC
     LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.current_profile_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_profile_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_profile_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_profile_role() TO authenticated, service_role;

-- A profile row is an authorization record, not a self-service role document.
-- Users may edit presentation/contact details, but cannot relink the row,
-- change the auth email, change account_type/role, or alter lifecycle fields.
CREATE OR REPLACE FUNCTION public.protect_profile_security_fields()
RETURNS TRIGGER
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF coalesce(auth.role(), '') <> 'service_role'
       AND public.current_profile_role() IS DISTINCT FROM 'admin' THEN
        NEW.id := OLD.id;
        NEW.user_id := OLD.user_id;
        NEW.email := OLD.email;
        NEW.account_type := OLD.account_type;
        NEW.role := OLD.role;
        IF to_jsonb(OLD) ? 'password_hash' THEN
            NEW.password_hash := OLD.password_hash;
        END IF;
        IF to_jsonb(OLD) ? 'deleted_at' THEN
            NEW.deleted_at := OLD.deleted_at;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_profile_security_fields
    ON public.profiles;
CREATE TRIGGER protect_profile_security_fields
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_security_fields();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profiles FROM PUBLIC, anon;
GRANT SELECT, UPDATE ON public.profiles TO authenticated;

DROP POLICY IF EXISTS "users can read their own profile" ON public.profiles;
DROP POLICY IF EXISTS "users can update their own profile details" ON public.profiles;
DROP POLICY IF EXISTS profiles_owner_read ON public.profiles;
DROP POLICY IF EXISTS profiles_owner_update ON public.profiles;

CREATE POLICY profiles_owner_read
ON public.profiles FOR SELECT TO authenticated
USING (
    user_id = auth.uid()
    OR (user_id IS NULL AND id = auth.uid())
    OR public.current_profile_role() = 'admin'
);

CREATE POLICY profiles_owner_update
ON public.profiles FOR UPDATE TO authenticated
USING (
    user_id = auth.uid()
    OR (user_id IS NULL AND id = auth.uid())
    OR public.current_profile_role() = 'admin'
)
WITH CHECK (
    user_id = auth.uid()
    OR (user_id IS NULL AND id = auth.uid())
    OR public.current_profile_role() = 'admin'
);

REVOKE INSERT, DELETE ON public.profiles FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.api_rate_limit_buckets IS
    'Server-side shared fixed-window rate-limit state; never query from browser roles.';
COMMENT ON FUNCTION public.protect_profile_security_fields() IS
    'Prevents non-admin browser sessions from changing profile identity or authorization fields.';

COMMIT;