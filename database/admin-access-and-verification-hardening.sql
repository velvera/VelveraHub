-- VelveraHub admin access and account-specific delivery-provider evidence.
--
-- Additive migration. Apply after database/seller-verification-case-history.sql
-- (migration 24). It does not promote an administrator or delete existing
-- verification records.

BEGIN;

-- The primary administrator is bootstrapped once by a trusted SQL operator.
-- Only that account may manage other admin roles from the guarded dashboard.
CREATE TABLE IF NOT EXISTS public.admin_role_management_config (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton IS TRUE),
    primary_admin_user_id UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.admin_role_management_config (singleton)
VALUES (TRUE)
ON CONFLICT (singleton) DO NOTHING;
ALTER TABLE public.admin_role_management_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_role_management_config FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.admin_role_assignments (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    previous_role TEXT NOT NULL CHECK (previous_role IN ('customer', 'seller')),
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    granted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
ALTER TABLE public.admin_role_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_role_assignments FROM PUBLIC, anon, authenticated;

-- Preserve the prior marketplace role for existing administrators too.
INSERT INTO public.admin_role_assignments (user_id, previous_role)
SELECT auth_user.id,
       CASE WHEN profile.account_type = 'seller' THEN 'seller' ELSE 'customer' END
FROM public.profiles AS profile
JOIN auth.users AS auth_user
  ON auth_user.id = coalesce(profile.user_id, profile.id)
WHERE profile.role = 'admin'
ON CONFLICT (user_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.admin_role_management_audit (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    actor_email TEXT,
    target_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    target_email TEXT,
    previous_role TEXT NOT NULL CHECK (previous_role IN ('customer', 'seller', 'admin')),
    new_role TEXT NOT NULL CHECK (new_role IN ('customer', 'seller', 'admin')),
    reason TEXT NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 5 AND 500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_role_management_audit_created_idx
    ON public.admin_role_management_audit (created_at DESC, id DESC);
ALTER TABLE public.admin_role_management_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_role_management_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.admin_role_management_audit TO authenticated;
DROP POLICY IF EXISTS primary_admin_reads_role_management_audit
    ON public.admin_role_management_audit;
CREATE POLICY primary_admin_reads_role_management_audit
ON public.admin_role_management_audit FOR SELECT TO authenticated
USING (
    public.current_profile_role() = 'admin'
    AND EXISTS (
        SELECT 1
        FROM public.admin_role_management_config AS config
        WHERE config.singleton IS TRUE
          AND config.primary_admin_user_id = auth.uid()
    )
);

CREATE OR REPLACE FUNCTION public.prevent_admin_role_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    RAISE EXCEPTION 'Administrator role audit history is append-only';
END;
$$;
DROP TRIGGER IF EXISTS prevent_admin_role_audit_mutation
    ON public.admin_role_management_audit;
CREATE TRIGGER prevent_admin_role_audit_mutation
BEFORE UPDATE OR DELETE ON public.admin_role_management_audit
FOR EACH ROW EXECUTE FUNCTION public.prevent_admin_role_audit_mutation();

CREATE OR REPLACE FUNCTION public.require_primary_admin_role_manager()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor UUID := auth.uid();
BEGIN
    IF v_actor IS NULL
       OR public.current_profile_role() IS DISTINCT FROM 'admin'
       OR NOT EXISTS (
            SELECT 1
            FROM public.admin_role_management_config AS config
            WHERE config.singleton IS TRUE
              AND config.primary_admin_user_id = v_actor
       ) THEN
        RAISE EXCEPTION 'Primary administrator access is required'
            USING ERRCODE = '42501';
    END IF;
    RETURN v_actor;
END;
$$;
REVOKE ALL ON FUNCTION public.require_primary_admin_role_manager()
    FROM PUBLIC, anon, authenticated;

-- Trusted bootstrap only. First promote the registered user with the existing
-- operator-only assign_admin_role() function, then call this once from SQL.
CREATE OR REPLACE FUNCTION public.bootstrap_primary_admin_access(p_email TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_email TEXT := lower(trim(coalesce(p_email, '')));
    v_user_id UUID;
    v_profile_user_id UUID;
    v_profile_role TEXT;
    v_current_primary UUID;
BEGIN
    IF v_email = '' THEN
        RAISE EXCEPTION 'A registered administrator email is required'
            USING ERRCODE = '22023';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('velverahub-primary-admin-bootstrap', 0));

    SELECT auth_user.id
      INTO v_user_id
      FROM auth.users AS auth_user
     WHERE lower(auth_user.email) = v_email
     LIMIT 1;
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'No registered Supabase Auth account matches this email'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT profile.user_id, profile.role
      INTO v_profile_user_id, v_profile_role
      FROM public.profiles AS profile
     WHERE profile.user_id = v_user_id
        OR profile.id = v_user_id
        OR (
            profile.user_id IS NULL
            AND lower(profile.email) = v_email
        )
     ORDER BY (profile.user_id = v_user_id) DESC,
              (profile.id = v_user_id) DESC
     LIMIT 1
     FOR UPDATE;

    IF NOT FOUND OR v_profile_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Promote and link this account as an administrator before bootstrap'
            USING ERRCODE = '23514';
    END IF;
    IF v_profile_user_id IS NOT NULL AND v_profile_user_id <> v_user_id THEN
        RAISE EXCEPTION 'The profile is linked to another Auth account; resolve it before bootstrap'
            USING ERRCODE = '23505';
    END IF;

    SELECT config.primary_admin_user_id
      INTO v_current_primary
      FROM public.admin_role_management_config AS config
     WHERE config.singleton IS TRUE
     FOR UPDATE;

    IF v_current_primary IS NOT NULL AND v_current_primary <> v_user_id THEN
        RAISE EXCEPTION 'A primary administrator is already configured'
            USING ERRCODE = '23505';
    END IF;
    IF v_current_primary = v_user_id THEN
        RETURN v_user_id;
    END IF;

    UPDATE public.admin_role_management_config
       SET primary_admin_user_id = v_user_id
     WHERE singleton IS TRUE;

    INSERT INTO public.admin_role_management_audit (
        actor_user_id, actor_email, target_user_id, target_email,
        previous_role, new_role, reason
    )
    VALUES (
        NULL, 'trusted SQL operator', v_user_id, v_email,
        'admin', 'admin', 'Initial primary administrator bootstrap'
    );
    RETURN v_user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.bootstrap_primary_admin_access(TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_primary_admin_access(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_role_management_status()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF auth.uid() IS NULL OR public.current_profile_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Administrator access is required' USING ERRCODE = '42501';
    END IF;
    RETURN EXISTS (
        SELECT 1
        FROM public.admin_role_management_config AS config
        WHERE config.singleton IS TRUE
          AND config.primary_admin_user_id = auth.uid()
    );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_role_management_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_role_management_status() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_find_role_management_users(p_query TEXT)
RETURNS TABLE (
    user_id UUID,
    email TEXT,
    first_name TEXT,
    last_name TEXT,
    role TEXT,
    is_primary BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_query TEXT := lower(trim(coalesce(p_query, '')));
BEGIN
    PERFORM public.require_primary_admin_role_manager();
    IF char_length(v_query) NOT BETWEEN 3 AND 120 THEN
        RAISE EXCEPTION 'Enter at least three characters to search'
            USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    SELECT auth_user.id,
           auth_user.email::TEXT,
           profile.first_name::TEXT,
           profile.last_name::TEXT,
           coalesce(profile.role, 'customer')::TEXT,
           config.primary_admin_user_id = auth_user.id
      FROM auth.users AS auth_user
      LEFT JOIN LATERAL (
            SELECT candidate.first_name, candidate.last_name,
                   candidate.role, candidate.user_id
              FROM public.profiles AS candidate
             WHERE candidate.user_id = auth_user.id
                OR candidate.id = auth_user.id
                OR (
                    candidate.user_id IS NULL
                    AND lower(candidate.email) = lower(auth_user.email)
                )
             ORDER BY (candidate.user_id = auth_user.id) DESC,
                      (candidate.id = auth_user.id) DESC,
                      (lower(candidate.email) = lower(auth_user.email)) DESC
             LIMIT 1
      ) AS profile ON TRUE
      CROSS JOIN public.admin_role_management_config AS config
     WHERE config.singleton IS TRUE
       AND (
            position(v_query IN lower(coalesce(auth_user.email, ''))) > 0
            OR position(v_query IN lower(coalesce(profile.first_name, ''))) > 0
            OR position(v_query IN lower(coalesce(profile.last_name, ''))) > 0
       )
     ORDER BY (coalesce(profile.role, 'customer') = 'admin') DESC,
              lower(coalesce(auth_user.email, ''))
     LIMIT 25;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_find_role_management_users(TEXT)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_find_role_management_users(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_user_admin_role(
    p_target_user_id UUID,
    p_grant_admin BOOLEAN,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor UUID := public.require_primary_admin_role_manager();
    v_target_email TEXT;
    v_target_profile_id UUID;
    v_target_linked_user_id UUID;
    v_target_role TEXT;
    v_account_type TEXT;
    v_previous_role TEXT;
    v_next_role TEXT;
    v_actor_email TEXT;
    v_admin_count BIGINT;
BEGIN
    IF p_target_user_id IS NULL OR p_grant_admin IS NULL
       OR char_length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 5 AND 500 THEN
        RAISE EXCEPTION 'Choose an account and enter a reason of 5–500 characters'
            USING ERRCODE = '22023';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('velverahub-admin-role-changes', 0));

    SELECT auth_user.email
      INTO v_target_email
      FROM auth.users AS auth_user
     WHERE auth_user.id = p_target_user_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'The registered Auth account could not be found'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT profile.id, profile.user_id, profile.role, profile.account_type
      INTO v_target_profile_id, v_target_linked_user_id, v_target_role, v_account_type
      FROM public.profiles AS profile
     WHERE profile.user_id = p_target_user_id
        OR profile.id = p_target_user_id
        OR (
            profile.user_id IS NULL
            AND lower(profile.email) = lower(v_target_email)
        )
     ORDER BY (profile.user_id = p_target_user_id) DESC,
              (profile.id = p_target_user_id) DESC
     LIMIT 1
     FOR UPDATE;

    IF v_target_profile_id IS NOT NULL
       AND v_target_linked_user_id IS NOT NULL
       AND v_target_linked_user_id <> p_target_user_id THEN
        RAISE EXCEPTION 'This profile is linked to another Auth account; resolve the mapping first'
            USING ERRCODE = '23505';
    END IF;

    IF v_target_profile_id IS NULL THEN
        INSERT INTO public.profiles (user_id, email, account_type, role)
        VALUES (p_target_user_id, lower(v_target_email), 'customer', 'customer')
        RETURNING id INTO v_target_profile_id;
        v_target_role := 'customer';
        v_account_type := 'customer';
    ELSE
        UPDATE public.profiles
           SET user_id = coalesce(user_id, p_target_user_id),
               email = coalesce(email, lower(v_target_email)),
               updated_at = now()
         WHERE id = v_target_profile_id;
    END IF;

    SELECT auth_user.email
      INTO v_actor_email
      FROM auth.users AS auth_user
     WHERE auth_user.id = v_actor;

    IF p_grant_admin IS TRUE THEN
        IF v_target_role IS DISTINCT FROM 'admin' THEN
            v_previous_role := CASE WHEN v_target_role = 'seller' OR v_account_type = 'seller'
                                    THEN 'seller' ELSE 'customer' END;
            INSERT INTO public.admin_role_assignments (user_id, previous_role, granted_by)
            VALUES (p_target_user_id, v_previous_role, v_actor)
            ON CONFLICT (user_id) DO NOTHING;
            UPDATE public.profiles
               SET role = 'admin', updated_at = now()
             WHERE id = v_target_profile_id;
            v_next_role := 'admin';
        ELSE
            INSERT INTO public.admin_role_assignments (user_id, previous_role, granted_by)
            VALUES (
                p_target_user_id,
                CASE WHEN v_account_type = 'seller' THEN 'seller' ELSE 'customer' END,
                v_actor
            )
            ON CONFLICT (user_id) DO NOTHING;
            RETURN jsonb_build_object(
                'user_id', p_target_user_id,
                'email', v_target_email,
                'role', 'admin',
                'changed', FALSE
            );
        END IF;
    ELSE
        IF EXISTS (
            SELECT 1
            FROM public.admin_role_management_config AS config
            WHERE config.singleton IS TRUE
              AND config.primary_admin_user_id = p_target_user_id
        ) THEN
            RAISE EXCEPTION 'The primary administrator cannot be removed from this workflow'
                USING ERRCODE = '23514';
        END IF;
        IF v_target_role IS DISTINCT FROM 'admin' THEN
            RETURN jsonb_build_object(
                'user_id', p_target_user_id,
                'email', v_target_email,
                'role', coalesce(v_target_role, 'customer'),
                'changed', FALSE
            );
        END IF;

        SELECT count(*)
          INTO v_admin_count
          FROM public.profiles AS profile
         WHERE profile.role = 'admin';
        IF v_admin_count <= 1 THEN
            RAISE EXCEPTION 'The last administrator cannot be removed'
                USING ERRCODE = '23514';
        END IF;

        SELECT assignment.previous_role
          INTO v_previous_role
          FROM public.admin_role_assignments AS assignment
         WHERE assignment.user_id = p_target_user_id
         FOR UPDATE;
        IF NOT FOUND THEN
            v_previous_role := CASE WHEN v_account_type = 'seller'
                                    THEN 'seller' ELSE 'customer' END;
        END IF;
        IF v_previous_role NOT IN ('customer', 'seller') THEN
            v_previous_role := 'customer';
        END IF;

        UPDATE public.profiles
           SET role = v_previous_role, updated_at = now()
         WHERE id = v_target_profile_id;
        DELETE FROM public.admin_role_assignments
         WHERE user_id = p_target_user_id;
        v_next_role := v_previous_role;
    END IF;

    INSERT INTO public.admin_role_management_audit (
        actor_user_id, actor_email, target_user_id, target_email,
        previous_role, new_role, reason
    )
    VALUES (
        v_actor, v_actor_email, p_target_user_id, lower(v_target_email),
        coalesce(v_target_role, 'customer'), v_next_role, btrim(p_reason)
    );

    RETURN jsonb_build_object(
        'user_id', p_target_user_id,
        'email', v_target_email,
        'role', v_next_role,
        'changed', TRUE
    );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_update_user_admin_role(UUID, BOOLEAN, TEXT)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_user_admin_role(UUID, BOOLEAN, TEXT)
    TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_admin_role_changes(p_limit INTEGER DEFAULT 50)
RETURNS TABLE (
    actor_email TEXT,
    target_email TEXT,
    previous_role TEXT,
    new_role TEXT,
    reason TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM public.require_primary_admin_role_manager();
    RETURN QUERY
    SELECT audit.actor_email, audit.target_email, audit.previous_role,
           audit.new_role, audit.reason, audit.created_at
      FROM public.admin_role_management_audit AS audit
     ORDER BY audit.created_at DESC, audit.id DESC
     LIMIT least(greatest(coalesce(p_limit, 50), 1), 100);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_admin_role_changes(INTEGER)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_admin_role_changes(INTEGER)
    TO authenticated;

-- Delivery-provider submissions must identify what each private file proves.
ALTER TABLE public.delivery_provider_verifications
    ADD COLUMN IF NOT EXISTS document_manifest JSONB NOT NULL DEFAULT '[]'::JSONB;
ALTER TABLE public.delivery_provider_verifications
    ADD COLUMN IF NOT EXISTS consent_version TEXT NOT NULL DEFAULT '2026-11-27';
ALTER TABLE public.delivery_provider_verifications
    ADD COLUMN IF NOT EXISTS consented_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.delivery_provider_reviews
    ADD COLUMN IF NOT EXISTS document_manifest JSONB NOT NULL DEFAULT '[]'::JSONB;

ALTER TABLE public.delivery_provider_verifications
    DROP CONSTRAINT IF EXISTS delivery_provider_verifications_identity_document_type_check;
ALTER TABLE public.delivery_provider_verifications
    ADD CONSTRAINT delivery_provider_verifications_identity_document_type_check
    CHECK (identity_document_type IN (
        '', 'passport', 'national_id', 'drivers_license', 'voters_card',
        'residence_permit', 'other'
    ));

-- Preserve old uploads, labelled as unclassified, rather than discarding data.
UPDATE public.delivery_provider_verifications AS verification
   SET document_manifest = (
        SELECT coalesce(
            jsonb_agg(jsonb_build_object('document_kind', 'supporting', 'storage_path', document_path)),
            '[]'::JSONB
        )
          FROM unnest(coalesce(verification.document_paths, ARRAY[]::TEXT[])) AS documents(document_path)
   )
 WHERE verification.document_manifest = '[]'::JSONB
   AND coalesce(cardinality(verification.document_paths), 0) > 0;

CREATE OR REPLACE FUNCTION public.delivery_provider_submit_verification_v2(
    p_provider_id UUID,
    p_legal_name TEXT,
    p_registered_business_name TEXT,
    p_registration_number TEXT,
    p_identity_document_type TEXT,
    p_document_manifest JSONB,
    p_consent_version TEXT,
    p_consent BOOLEAN
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
    v_provider public.delivery_providers%ROWTYPE;
    v_verification public.delivery_provider_verifications%ROWTYPE;
    v_verification_id UUID;
    v_paths TEXT[];
    v_total INTEGER;
    v_unique_paths INTEGER;
    v_identity_count INTEGER;
    v_business_count INTEGER;
    v_selfie_count INTEGER;
    v_license_count INTEGER;
    v_supporting_count INTEGER;
    v_unknown_count INTEGER;
BEGIN
    SELECT provider.* INTO v_provider
      FROM public.delivery_providers AS provider
     WHERE provider.id = p_provider_id
       AND provider.user_id = auth.uid()
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Provider profile not found' USING ERRCODE = '42501';
    END IF;

    SELECT verification.* INTO v_verification
      FROM public.delivery_provider_verifications AS verification
     WHERE verification.provider_id = p_provider_id
     FOR UPDATE;
    IF FOUND AND v_verification.status NOT IN ('rejected', 'resubmission_required') THEN
        RAISE EXCEPTION 'A pending or approved verification cannot be changed'
            USING ERRCODE = '23514';
    END IF;

    IF length(btrim(coalesce(p_legal_name, ''))) NOT BETWEEN 2 AND 160
       OR p_identity_document_type NOT IN (
            'passport', 'national_id', 'drivers_license', 'voters_card',
            'residence_permit', 'other'
       )
       OR p_consent IS NOT TRUE
       OR char_length(btrim(coalesce(p_consent_version, ''))) NOT BETWEEN 1 AND 40
       OR p_document_manifest IS NULL
       OR jsonb_typeof(p_document_manifest) IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_document_manifest) NOT BETWEEN 2 AND 8 THEN
        RAISE EXCEPTION 'Complete the identity details and required private documents'
            USING ERRCODE = '22023';
    END IF;

    IF v_provider.country_code = 'NG'
       AND v_provider.provider_type = 'independent_rider'
       AND p_identity_document_type <> 'national_id' THEN
        RAISE EXCEPTION 'Nigerian dispatch riders must provide a National ID/NIN document'
            USING ERRCODE = '22023';
    END IF;
    IF v_provider.country_code = 'GB'
       AND p_identity_document_type NOT IN (
            'passport', 'drivers_license', 'residence_permit', 'other'
       ) THEN
        RAISE EXCEPTION 'Choose a government identity document accepted for the UK'
            USING ERRCODE = '22023';
    END IF;

    SELECT count(*),
           count(DISTINCT document.storage_path),
           count(*) FILTER (WHERE document.document_kind = 'representative_identity'),
           count(*) FILTER (WHERE document.document_kind = 'business_registration'),
           count(*) FILTER (WHERE document.document_kind = 'representative_selfie'),
           count(*) FILTER (WHERE document.document_kind = 'drivers_license'),
           count(*) FILTER (WHERE document.document_kind = 'supporting'),
           count(*) FILTER (WHERE coalesce(document.document_kind, '') NOT IN (
               'representative_identity', 'business_registration',
               'representative_selfie', 'drivers_license', 'supporting'
           ))
      INTO v_total, v_unique_paths, v_identity_count, v_business_count,
           v_selfie_count, v_license_count, v_supporting_count, v_unknown_count
      FROM jsonb_to_recordset(p_document_manifest) AS document(
          document_kind TEXT,
          storage_path TEXT
      );

    IF v_total <> jsonb_array_length(p_document_manifest)
       OR v_unique_paths <> v_total
       OR v_unknown_count > 0
       OR v_identity_count <> 1
       OR v_selfie_count > 1
       OR v_license_count > 1
       OR v_supporting_count > 2 THEN
        RAISE EXCEPTION 'The verification document categories are incomplete or duplicated'
            USING ERRCODE = '22023';
    END IF;

    IF v_provider.provider_type = 'logistics_company' THEN
        IF length(btrim(coalesce(p_registered_business_name, ''))) < 2
           OR length(btrim(coalesce(p_registration_number, ''))) < 2
           OR v_business_count NOT BETWEEN 1 AND 5 THEN
            RAISE EXCEPTION 'Companies need registration details, business evidence, and representative ID'
                USING ERRCODE = '22023';
        END IF;
    ELSE
        IF v_business_count <> 0 OR v_selfie_count <> 1 THEN
            RAISE EXCEPTION 'Independent riders need an identity document and a selfie'
                USING ERRCODE = '22023';
        END IF;
    END IF;

    IF EXISTS (
        SELECT 1
          FROM jsonb_to_recordset(p_document_manifest) AS document(
              document_kind TEXT,
              storage_path TEXT
          )
          LEFT JOIN storage.objects AS object_row
            ON object_row.bucket_id = 'delivery-provider-verification-private'
           AND object_row.name = document.storage_path
         WHERE document.storage_path !~ (
                   '^' || p_provider_id::TEXT || '/[A-Za-z0-9._-]{1,180}$'
               )
            OR object_row.id IS NULL
    ) THEN
        RAISE EXCEPTION 'Upload every verification file to this private provider profile'
            USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM jsonb_to_recordset(p_document_manifest) AS document(
              document_kind TEXT,
              storage_path TEXT
          )
          JOIN storage.objects AS object_row
            ON object_row.bucket_id = 'delivery-provider-verification-private'
           AND object_row.name = document.storage_path
         WHERE document.document_kind = 'representative_selfie'
           AND lower(coalesce(
               object_row.metadata ->> 'mimetype',
               object_row.metadata ->> 'contentType',
               ''
           )) NOT IN ('image/jpeg', 'image/png')
    ) THEN
        RAISE EXCEPTION 'A representative selfie must be a JPEG or PNG image'
            USING ERRCODE = '22023';
    END IF;

      SELECT array_agg(item.storage_path ORDER BY document.ordinality)
      INTO v_paths
      FROM jsonb_array_elements(p_document_manifest)
           WITH ORDINALITY AS document(value, ordinality)
      CROSS JOIN LATERAL jsonb_to_record(document.value) AS item(
          document_kind TEXT,
          storage_path TEXT
      );

    INSERT INTO public.delivery_provider_verifications (
        provider_id, legal_name, registered_business_name, registration_number,
        identity_document_type, document_paths, document_manifest,
        consent_version, consented_at, status,
        review_note, submitted_at, reviewed_by, reviewed_at
    )
    VALUES (
        p_provider_id, btrim(p_legal_name),
        btrim(coalesce(p_registered_business_name, '')),
        btrim(coalesce(p_registration_number, '')),
        p_identity_document_type, v_paths, p_document_manifest,
        btrim(p_consent_version), now(), 'pending',
        NULL, now(), NULL, NULL
    )
    ON CONFLICT (provider_id) DO UPDATE SET
        legal_name = EXCLUDED.legal_name,
        registered_business_name = EXCLUDED.registered_business_name,
        registration_number = EXCLUDED.registration_number,
        identity_document_type = EXCLUDED.identity_document_type,
        document_paths = EXCLUDED.document_paths,
        document_manifest = EXCLUDED.document_manifest,
        consent_version = EXCLUDED.consent_version,
        consented_at = EXCLUDED.consented_at,
        status = 'pending',
        review_note = NULL,
        submitted_at = now(),
        reviewed_by = NULL,
        reviewed_at = NULL
    RETURNING id INTO v_verification_id;

    UPDATE public.delivery_providers
       SET status = 'pending',
           is_verified = FALSE,
           is_available = FALSE,
           available_until = NULL
     WHERE id = p_provider_id;
    RETURN v_verification_id;
END;
$$;
REVOKE ALL ON FUNCTION public.delivery_provider_submit_verification_v2(
    UUID, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, BOOLEAN
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delivery_provider_submit_verification_v2(
    UUID, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, BOOLEAN
) TO authenticated;
REVOKE ALL ON FUNCTION public.delivery_provider_submit_verification(
    UUID, TEXT, TEXT, TEXT, TEXT, TEXT[]
) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_delivery_providers(p_status TEXT DEFAULT 'pending')
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
BEGIN
    IF public.current_profile_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
    IF coalesce(p_status, 'pending') NOT IN ('all', 'pending', 'approved', 'rejected', 'suspended') THEN
        RAISE EXCEPTION 'Unsupported provider status' USING ERRCODE = '22023';
    END IF;
    RETURN (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
            'provider_id', provider.id,
            'provider_type', provider.provider_type,
            'display_name', provider.display_name,
            'description', provider.description,
            'country_code', provider.country_code,
            'vehicle_type', provider.vehicle_type,
            'status', provider.status,
            'is_verified', provider.is_verified,
            'is_available', provider.is_available,
            'available_until', provider.available_until,
            'created_at', provider.created_at,
            'user_id', provider.user_id,
            'verification', CASE WHEN verification.id IS NULL THEN NULL ELSE jsonb_build_object(
                'id', verification.id,
                'legal_name', verification.legal_name,
                'registered_business_name', verification.registered_business_name,
                'registration_number', verification.registration_number,
                'identity_document_type', verification.identity_document_type,
                'document_paths', verification.document_paths,
                'document_manifest', verification.document_manifest,
                'status', verification.status,
                'review_note', verification.review_note,
                'submitted_at', verification.submitted_at
            ) END,
            'service_areas', coalesce((
                SELECT jsonb_agg(to_jsonb(area) ORDER BY area.city, area.state_or_region)
                FROM public.delivery_provider_service_areas AS area
                WHERE area.provider_id = provider.id
            ), '[]'::JSONB),
            'review_history', coalesce((
                SELECT jsonb_agg(jsonb_build_object(
                    'decision', review.decision,
                    'note', review.note,
                    'reviewer_email', reviewer.email,
                    'created_at', review.created_at,
                    'document_paths', review.document_paths,
                    'document_manifest', review.document_manifest
                ) ORDER BY review.created_at DESC)
                FROM public.delivery_provider_reviews AS review
                LEFT JOIN public.profiles AS reviewer ON reviewer.id = review.reviewer_id
                WHERE review.provider_id = provider.id
            ), '[]'::JSONB)
        ) ORDER BY provider.created_at), '[]'::JSONB)
        FROM public.delivery_providers AS provider
        LEFT JOIN public.delivery_provider_verifications AS verification
          ON verification.provider_id = provider.id
        WHERE coalesce(p_status, 'pending') = 'all'
           OR provider.status = coalesce(p_status, 'pending')
    );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_delivery_providers(TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_delivery_providers(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.prevent_delivery_provider_review_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    RAISE EXCEPTION 'Delivery-provider review history is append-only';
END;
$$;
DROP TRIGGER IF EXISTS prevent_delivery_provider_review_mutation
    ON public.delivery_provider_reviews;
CREATE TRIGGER prevent_delivery_provider_review_mutation
BEFORE UPDATE OR DELETE ON public.delivery_provider_reviews
FOR EACH ROW EXECUTE FUNCTION public.prevent_delivery_provider_review_mutation();

CREATE OR REPLACE FUNCTION public.admin_review_delivery_provider(
    p_provider_id UUID,
    p_decision TEXT,
    p_note TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
    v_provider public.delivery_providers%ROWTYPE;
    v_verification public.delivery_provider_verifications%ROWTYPE;
    v_reviewer UUID;
    v_note TEXT := nullif(left(btrim(coalesce(p_note, '')), 2000), '');
    v_new_status TEXT;
    v_identity_count INTEGER;
    v_business_count INTEGER;
    v_selfie_count INTEGER;
BEGIN
    IF public.current_profile_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
    IF p_decision NOT IN ('approve', 'reject', 'request_resubmission', 'suspend', 'restore') THEN
        RAISE EXCEPTION 'Unsupported provider decision' USING ERRCODE = '22023';
    END IF;
    IF p_decision IN ('reject', 'request_resubmission', 'suspend')
       AND length(coalesce(v_note, '')) < 3 THEN
        RAISE EXCEPTION 'Add a clear note for this decision' USING ERRCODE = '22023';
    END IF;

    SELECT provider.* INTO v_provider
      FROM public.delivery_providers AS provider
     WHERE provider.id = p_provider_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Provider profile not found' USING ERRCODE = 'P0002';
    END IF;
    SELECT verification.* INTO v_verification
      FROM public.delivery_provider_verifications AS verification
     WHERE verification.provider_id = p_provider_id
     FOR UPDATE;
    v_reviewer := public.current_profile_id();

    IF p_decision = 'approve' THEN
        IF v_verification.id IS NULL OR v_verification.status <> 'pending' THEN
            RAISE EXCEPTION 'Only a complete pending verification can be approved'
                USING ERRCODE = '23514';
        END IF;

        SELECT count(*) FILTER (WHERE document.document_kind = 'representative_identity'),
               count(*) FILTER (WHERE document.document_kind = 'business_registration'),
               count(*) FILTER (WHERE document.document_kind = 'representative_selfie')
          INTO v_identity_count, v_business_count, v_selfie_count
          FROM jsonb_to_recordset(coalesce(v_verification.document_manifest, '[]'::JSONB))
               AS document(document_kind TEXT, storage_path TEXT);

        IF v_identity_count <> 1
           OR (
                v_provider.provider_type = 'logistics_company'
                AND (
                    v_business_count < 1
                    OR length(btrim(coalesce(v_verification.registered_business_name, ''))) < 2
                    OR length(btrim(coalesce(v_verification.registration_number, ''))) < 2
                )
           )
           OR (
                v_provider.provider_type = 'independent_rider'
                AND (
                    v_selfie_count <> 1
                    OR (v_provider.country_code = 'NG'
                        AND v_verification.identity_document_type <> 'national_id')
                )
           )
           OR cardinality(v_verification.document_paths) NOT BETWEEN 2 AND 8
           OR EXISTS (
                SELECT 1
                  FROM jsonb_to_recordset(coalesce(v_verification.document_manifest, '[]'::JSONB))
                       AS document(document_kind TEXT, storage_path TEXT)
                  LEFT JOIN storage.objects AS object_row
                    ON object_row.bucket_id = 'delivery-provider-verification-private'
                   AND object_row.name = document.storage_path
                 WHERE object_row.id IS NULL
                    OR document.storage_path !~ (
                        '^' || p_provider_id::TEXT || '/[A-Za-z0-9._-]{1,180}$'
                    )
           ) THEN
            RAISE EXCEPTION 'Required identity and account-specific business evidence is missing'
                USING ERRCODE = '23514';
        END IF;

        IF EXISTS (
            SELECT 1
              FROM jsonb_to_recordset(coalesce(v_verification.document_manifest, '[]'::JSONB))
                   AS document(document_kind TEXT, storage_path TEXT)
              JOIN storage.objects AS object_row
                ON object_row.bucket_id = 'delivery-provider-verification-private'
               AND object_row.name = document.storage_path
             WHERE document.document_kind = 'representative_selfie'
               AND lower(coalesce(
                   object_row.metadata ->> 'mimetype',
                   object_row.metadata ->> 'contentType',
                   ''
               )) NOT IN ('image/jpeg', 'image/png')
        ) THEN
            RAISE EXCEPTION 'The required rider selfie must be a private JPEG or PNG image'
                USING ERRCODE = '23514';
        END IF;

        v_new_status := 'approved';
        UPDATE public.delivery_provider_verifications
           SET status = 'approved', review_note = NULL, reviewed_by = v_reviewer, reviewed_at = now()
         WHERE id = v_verification.id;
        UPDATE public.delivery_providers
           SET status = 'approved', is_verified = TRUE
         WHERE id = p_provider_id;
    ELSIF p_decision = 'reject' THEN
        v_new_status := 'rejected';
        UPDATE public.delivery_provider_verifications
           SET status = 'rejected', review_note = v_note, reviewed_by = v_reviewer, reviewed_at = now()
         WHERE id = v_verification.id;
        UPDATE public.delivery_providers
           SET status = 'rejected', is_verified = FALSE, is_available = FALSE, available_until = NULL
         WHERE id = p_provider_id;
    ELSIF p_decision = 'request_resubmission' THEN
        v_new_status := 'resubmission_required';
        UPDATE public.delivery_provider_verifications
           SET status = 'resubmission_required', review_note = v_note,
               reviewed_by = v_reviewer, reviewed_at = now()
         WHERE id = v_verification.id;
        UPDATE public.delivery_providers
           SET status = 'pending', is_verified = FALSE, is_available = FALSE, available_until = NULL
         WHERE id = p_provider_id;
    ELSIF p_decision = 'suspend' THEN
        v_new_status := 'suspended';
        UPDATE public.delivery_providers
           SET status = 'suspended', is_available = FALSE, available_until = NULL
         WHERE id = p_provider_id;
    ELSE
        IF v_provider.status <> 'suspended'
           OR v_verification.status <> 'approved'
           OR v_provider.is_verified IS NOT TRUE THEN
            RAISE EXCEPTION 'Only a verified suspended provider can be restored' USING ERRCODE = '23514';
        END IF;
        v_new_status := 'restored';
        UPDATE public.delivery_providers SET status = 'approved' WHERE id = p_provider_id;
    END IF;

    INSERT INTO public.delivery_provider_reviews (
        provider_id, verification_id, reviewer_id, decision, note,
        document_paths, document_manifest
    )
    VALUES (
        p_provider_id, v_verification.id, v_reviewer, v_new_status, v_note,
        coalesce(v_verification.document_paths, ARRAY[]::TEXT[]),
        coalesce(v_verification.document_manifest, '[]'::JSONB)
    );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_review_delivery_provider(UUID, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_review_delivery_provider(UUID, TEXT, TEXT)
    TO authenticated;

COMMIT;

-- After database/admin.sql and the ordered migrations, promote the first
-- administrator in a trusted SQL Editor session, then designate that account:
-- BEGIN;
-- SELECT set_config('request.jwt.claim.role', 'service_role', true);
-- SELECT * FROM public.assign_admin_role('registered-email@example.com');
-- SELECT public.bootstrap_primary_admin_access('registered-email@example.com');
-- COMMIT;
