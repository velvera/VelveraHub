-- Additive seller identity, business registry, and physical-store verification.
--
-- Apply after database/location-logistics-market-readiness.sql (migration 22).
-- Existing shop approval and phone-verification behavior is preserved. Identity
-- documents use a separate private bucket and are uploaded only by the
-- seller-verification-documents Edge Function.

BEGIN;

CREATE TABLE IF NOT EXISTS public.seller_verification_country_config (
    country_code TEXT PRIMARY KEY CHECK (country_code ~ '^[A-Z]{2}$'),
    country_name TEXT NOT NULL CHECK (char_length(btrim(country_name)) BETWEEN 2 AND 80),
    identity_document_types TEXT[] NOT NULL DEFAULT '{}',
    manual_review_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    provider_adapter TEXT,
    business_registry_source TEXT,
    privacy_notice_version TEXT NOT NULL,
    retention_days INTEGER NOT NULL DEFAULT 365 CHECK (retention_days BETWEEN 30 AND 3650),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        cardinality(identity_document_types) BETWEEN 1 AND 12
        AND identity_document_types <@ ARRAY[
            'passport', 'national_id', 'drivers_license',
            'voters_card', 'residence_permit', 'other'
        ]::TEXT[]
    )
);

ALTER TABLE public.seller_verification_country_config
    ADD COLUMN IF NOT EXISTS business_registry_source TEXT;

INSERT INTO public.seller_verification_country_config (
    country_code, country_name, identity_document_types,
    manual_review_enabled, provider_adapter, business_registry_source,
    privacy_notice_version
)
VALUES
    ('NG', 'Nigeria', ARRAY['passport', 'national_id', 'drivers_license', 'voters_card', 'other'], TRUE, NULL, 'CAC', '2026-11-27'),
    ('GB', 'United Kingdom', ARRAY['passport', 'drivers_license', 'residence_permit', 'other'], TRUE, NULL, 'Companies House', '2026-11-27')
ON CONFLICT (country_code) DO UPDATE SET
    business_registry_source = coalesce(
        public.seller_verification_country_config.business_registry_source,
        EXCLUDED.business_registry_source
    ),
    updated_at = CASE
        WHEN public.seller_verification_country_config.business_registry_source IS NULL
            THEN now()
        ELSE public.seller_verification_country_config.updated_at
    END;

ALTER TABLE public.seller_verification_country_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seller_verification_country_config FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.seller_verification_country_config TO anon, authenticated;
DROP POLICY IF EXISTS seller_verification_country_config_read
    ON public.seller_verification_country_config;
CREATE POLICY seller_verification_country_config_read
ON public.seller_verification_country_config FOR SELECT TO anon, authenticated
USING (
    manual_review_enabled IS TRUE
    OR (
        auth.role() = 'authenticated'
        AND public.current_profile_role() = 'admin'
    )
);

CREATE TABLE IF NOT EXISTS public.seller_identity_verification_cases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    applicant_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    shop_id UUID REFERENCES public.shops(id) ON DELETE SET NULL,
    country_code TEXT NOT NULL REFERENCES public.seller_verification_country_config(country_code),
    seller_type TEXT NOT NULL
        CHECK (seller_type IN ('individual', 'registered_business', 'sole_trader')),
    legal_first_name TEXT NOT NULL CHECK (char_length(btrim(legal_first_name)) BETWEEN 1 AND 100),
    legal_last_name TEXT NOT NULL CHECK (char_length(btrim(legal_last_name)) BETWEEN 1 AND 100),
    identity_document_type TEXT NOT NULL,
    consent_version TEXT NOT NULL CHECK (char_length(btrim(consent_version)) BETWEEN 1 AND 40),
    consented_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN (
            'draft', 'submitted', 'pending_provider', 'pending_review',
            'action_required', 'approved', 'rejected', 'expired',
            'suspended', 'revoked'
        )),
    current_document_id UUID,
    assigned_reviewer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    submission_count INTEGER NOT NULL DEFAULT 0 CHECK (submission_count BETWEEN 0 AND 100),
    last_submitted_at TIMESTAMPTZ,
    submitted_at TIMESTAMPTZ,
    reviewed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS seller_identity_cases_queue_idx
    ON public.seller_identity_verification_cases(status, country_code, submitted_at);
CREATE INDEX IF NOT EXISTS seller_identity_cases_assignment_idx
    ON public.seller_identity_verification_cases(assigned_reviewer_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS seller_identity_active_case_per_applicant_idx
    ON public.seller_identity_verification_cases(applicant_user_id)
    WHERE status IN ('draft', 'submitted', 'pending_provider', 'pending_review');
ALTER TABLE public.seller_identity_verification_cases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seller_identity_verification_cases FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.seller_identity_verification_cases TO authenticated;
DROP POLICY IF EXISTS seller_identity_cases_read_own_or_admin
    ON public.seller_identity_verification_cases;
CREATE POLICY seller_identity_cases_read_own_or_admin
ON public.seller_identity_verification_cases FOR SELECT TO authenticated
USING (
    applicant_user_id = auth.uid()
    OR public.current_profile_role() = 'admin'
);

CREATE TABLE IF NOT EXISTS public.seller_identity_verification_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID NOT NULL
        REFERENCES public.seller_identity_verification_cases(id) ON DELETE RESTRICT,
    storage_path TEXT NOT NULL UNIQUE,
    document_type TEXT NOT NULL,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    replaced_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS seller_identity_one_current_document_idx
    ON public.seller_identity_verification_documents(case_id) WHERE is_current IS TRUE;
CREATE INDEX IF NOT EXISTS seller_identity_documents_case_idx
    ON public.seller_identity_verification_documents(case_id, uploaded_at DESC);
ALTER TABLE public.seller_identity_verification_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seller_identity_verification_documents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.seller_identity_verification_documents TO authenticated;
DROP POLICY IF EXISTS seller_identity_documents_admin_read
    ON public.seller_identity_verification_documents;
CREATE POLICY seller_identity_documents_admin_read
ON public.seller_identity_verification_documents FOR SELECT TO authenticated
USING (public.current_profile_role() = 'admin');

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.seller_identity_verification_cases'::regclass
          AND conname = 'seller_identity_current_document_fk'
    ) THEN
        ALTER TABLE public.seller_identity_verification_cases
            ADD CONSTRAINT seller_identity_current_document_fk
            FOREIGN KEY (current_document_id)
            REFERENCES public.seller_identity_verification_documents(id)
            ON DELETE SET NULL;
    END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.seller_identity_verification_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID NOT NULL
        REFERENCES public.seller_identity_verification_cases(id) ON DELETE RESTRICT,
    actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'draft_saved', 'submitted', 'assigned', 'approved',
        'action_required', 'rejected', 'expired', 'suspended',
        'revoked', 'restored'
    )),
    from_status TEXT,
    to_status TEXT,
    seller_message TEXT CHECK (char_length(coalesce(seller_message, '')) <= 2000),
    internal_note TEXT CHECK (char_length(coalesce(internal_note, '')) <= 4000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS seller_identity_events_case_idx
    ON public.seller_identity_verification_events(case_id, created_at DESC);
ALTER TABLE public.seller_identity_verification_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seller_identity_verification_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.seller_identity_verification_events TO authenticated;
DROP POLICY IF EXISTS seller_identity_events_admin_read
    ON public.seller_identity_verification_events;
CREATE POLICY seller_identity_events_admin_read
ON public.seller_identity_verification_events FOR SELECT TO authenticated
USING (public.current_profile_role() = 'admin');

CREATE OR REPLACE FUNCTION public.prevent_seller_identity_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    RAISE EXCEPTION 'Seller verification history is append-only';
END;
$$;

DROP TRIGGER IF EXISTS prevent_seller_identity_event_mutation
    ON public.seller_identity_verification_events;
CREATE TRIGGER prevent_seller_identity_event_mutation
BEFORE UPDATE OR DELETE ON public.seller_identity_verification_events
FOR EACH ROW EXECUTE FUNCTION public.prevent_seller_identity_history_mutation();

DROP TRIGGER IF EXISTS prevent_seller_identity_document_mutation
    ON public.seller_identity_verification_documents;
CREATE TRIGGER prevent_seller_identity_document_mutation
BEFORE DELETE ON public.seller_identity_verification_documents
FOR EACH ROW EXECUTE FUNCTION public.prevent_seller_identity_history_mutation();

CREATE TABLE IF NOT EXISTS public.seller_identity_upload_limits (
    applicant_user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    upload_count SMALLINT NOT NULL DEFAULT 0 CHECK (upload_count BETWEEN 0 AND 12),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.seller_identity_upload_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seller_identity_upload_limits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.seller_identity_upload_limits TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'seller-identity-private',
    'seller-identity-private',
    FALSE,
    5242880,
    ARRAY['application/pdf', 'image/jpeg', 'image/png']::TEXT[]
)
ON CONFLICT (id) DO UPDATE SET
    public = FALSE,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png']::TEXT[];

DROP POLICY IF EXISTS seller_identity_admin_read_documents ON storage.objects;
CREATE POLICY seller_identity_admin_read_documents
ON storage.objects FOR SELECT TO authenticated
USING (
    bucket_id = 'seller-identity-private'
    AND public.current_profile_role() = 'admin'
);
DROP POLICY IF EXISTS seller_identity_service_only_upload ON storage.objects;
CREATE POLICY seller_identity_service_only_upload
ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (bucket_id <> 'seller-identity-private');
DROP POLICY IF EXISTS seller_identity_service_only_update ON storage.objects;
CREATE POLICY seller_identity_service_only_update
ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
USING (bucket_id <> 'seller-identity-private')
WITH CHECK (bucket_id <> 'seller-identity-private');
DROP POLICY IF EXISTS seller_identity_service_only_delete ON storage.objects;
CREATE POLICY seller_identity_service_only_delete
ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
USING (bucket_id <> 'seller-identity-private');
DROP POLICY IF EXISTS seller_identity_restrict_read ON storage.objects;
CREATE POLICY seller_identity_restrict_read
ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
USING (
    bucket_id <> 'seller-identity-private'
    OR public.current_profile_role() = 'admin'
);

CREATE OR REPLACE FUNCTION public.seller_identity_upload_reserve(
    p_applicant_user_id UUID,
    p_case_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_status TEXT;
    v_count SMALLINT;
BEGIN
    IF coalesce(auth.role(), '') <> 'service_role'
       OR p_applicant_user_id IS NULL OR p_case_id IS NULL THEN
        RAISE EXCEPTION 'Server access required' USING ERRCODE = '42501';
    END IF;

    SELECT verification.status
      INTO v_status
      FROM public.seller_identity_verification_cases AS verification
     WHERE verification.id = p_case_id
       AND verification.applicant_user_id = p_applicant_user_id
     FOR UPDATE;
    IF NOT FOUND OR v_status NOT IN ('draft', 'action_required', 'rejected', 'expired') THEN
        RAISE EXCEPTION 'This identity verification case cannot accept an upload'
            USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.seller_identity_upload_limits (
        applicant_user_id, window_started_at, upload_count, updated_at
    )
    VALUES (p_applicant_user_id, now(), 1, now())
    ON CONFLICT (applicant_user_id) DO UPDATE SET
        upload_count = CASE
            WHEN seller_identity_upload_limits.window_started_at < now() - interval '1 day'
                THEN 1
            ELSE seller_identity_upload_limits.upload_count + 1
        END,
        window_started_at = CASE
            WHEN seller_identity_upload_limits.window_started_at < now() - interval '1 day'
                THEN now()
            ELSE seller_identity_upload_limits.window_started_at
        END,
        updated_at = now()
    RETURNING upload_count INTO v_count;

    IF v_count > 10 THEN
        RAISE EXCEPTION 'Upload limit reached. Try again later' USING ERRCODE = '22023';
    END IF;
    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.seller_identity_upload_reserve(UUID, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seller_identity_upload_reserve(UUID, UUID)
    TO service_role;

DROP FUNCTION IF EXISTS public.seller_prepare_identity_verification(
    TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID
);

CREATE OR REPLACE FUNCTION public.seller_prepare_identity_verification(
    p_country_code TEXT,
    p_seller_type TEXT,
    p_legal_first_name TEXT,
    p_legal_last_name TEXT,
    p_document_type TEXT,
    p_consent_version TEXT,
    p_shop_id UUID DEFAULT NULL,
    p_consent BOOLEAN DEFAULT FALSE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_case public.seller_identity_verification_cases%ROWTYPE;
    v_case_id UUID;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Sign in before starting identity verification' USING ERRCODE = '42501';
    END IF;
    IF p_seller_type NOT IN ('individual', 'registered_business', 'sole_trader')
       OR length(btrim(coalesce(p_legal_first_name, ''))) NOT BETWEEN 1 AND 100
       OR length(btrim(coalesce(p_legal_last_name, ''))) NOT BETWEEN 1 AND 100
       OR length(btrim(coalesce(p_consent_version, ''))) NOT BETWEEN 1 AND 40
       OR p_consent IS NOT TRUE THEN
        RAISE EXCEPTION 'Identity details are incomplete' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.seller_verification_country_config AS config
        WHERE config.country_code = upper(coalesce(p_country_code, ''))
          AND config.manual_review_enabled IS TRUE
          AND p_document_type = ANY(config.identity_document_types)
    ) THEN
        RAISE EXCEPTION 'This document type is not enabled for the selected country'
            USING ERRCODE = '22023';
    END IF;
    IF p_shop_id IS NOT NULL AND NOT public.shop_portal_owns_shop(p_shop_id) THEN
        RAISE EXCEPTION 'You do not own the selected shop' USING ERRCODE = '42501';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::TEXT || ':identity', 0));
    SELECT verification.*
      INTO v_case
      FROM public.seller_identity_verification_cases AS verification
     WHERE verification.applicant_user_id = v_user_id
     ORDER BY verification.created_at DESC, verification.id DESC
     LIMIT 1
     FOR UPDATE;

    IF FOUND AND v_case.status NOT IN ('draft', 'action_required', 'rejected', 'expired') THEN
        RAISE EXCEPTION 'This identity verification case cannot be edited while it is %',
            v_case.status USING ERRCODE = '23514';
    END IF;

    IF v_case.id IS NULL OR v_case.status IN ('action_required', 'rejected', 'expired') THEN
        INSERT INTO public.seller_identity_verification_cases (
            applicant_user_id, shop_id, country_code, seller_type,
            legal_first_name, legal_last_name, identity_document_type,
            consent_version, consented_at, status
        )
        VALUES (
            v_user_id, p_shop_id, upper(p_country_code), p_seller_type,
            btrim(p_legal_first_name), btrim(p_legal_last_name),
            p_document_type, btrim(p_consent_version), now(), 'draft'
        )
        RETURNING id INTO v_case_id;
        INSERT INTO public.seller_identity_verification_events (
            case_id, actor_user_id, event_type, from_status, to_status
        )
        VALUES (v_case_id, v_user_id, 'draft_saved', NULL, 'draft');
    ELSE
        v_case_id := v_case.id;
        UPDATE public.seller_identity_verification_cases
           SET shop_id = p_shop_id,
               country_code = upper(p_country_code),
               seller_type = p_seller_type,
               legal_first_name = btrim(p_legal_first_name),
               legal_last_name = btrim(p_legal_last_name),
               identity_document_type = p_document_type,
               consent_version = btrim(p_consent_version),
               consented_at = now(),
               status = 'draft',
               current_document_id = NULL,
               reviewed_at = NULL,
               expires_at = NULL,
               updated_at = now()
         WHERE id = v_case.id;
        INSERT INTO public.seller_identity_verification_events (
            case_id, actor_user_id, event_type, from_status, to_status,
            seller_message
        )
        VALUES (
            v_case.id, v_user_id, 'draft_saved', v_case.status, 'draft',
            'Your updated details are saved as a draft.'
        );
    END IF;
    RETURN v_case_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.seller_submit_identity_verification(
    p_case_id UUID,
    p_storage_path TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
    v_case public.seller_identity_verification_cases%ROWTYPE;
    v_document_id UUID;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sign in before submitting identity verification' USING ERRCODE = '42501';
    END IF;
    SELECT verification.*
      INTO v_case
      FROM public.seller_identity_verification_cases AS verification
     WHERE verification.id = p_case_id
       AND verification.applicant_user_id = auth.uid()
     FOR UPDATE;
    IF NOT FOUND OR v_case.status <> 'draft' THEN
        RAISE EXCEPTION 'Only a saved identity draft can be submitted' USING ERRCODE = '23514';
    END IF;
    IF v_case.last_submitted_at > now() - interval '60 seconds' THEN
        RAISE EXCEPTION 'Wait briefly before submitting another verification' USING ERRCODE = '22023';
    END IF;
    IF p_storage_path !~ (
        '^' || auth.uid()::TEXT || '/' || p_case_id::TEXT ||
        '/[0-9a-f-]{36}[.](pdf|jpg|png)$'
    ) OR NOT EXISTS (
        SELECT 1 FROM storage.objects AS object
        WHERE object.bucket_id = 'seller-identity-private'
          AND object.name = p_storage_path
    ) THEN
        RAISE EXCEPTION 'Upload one valid identity document before submitting'
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.seller_identity_verification_documents
       SET is_current = FALSE, replaced_at = now()
     WHERE case_id = p_case_id AND is_current IS TRUE;

    INSERT INTO public.seller_identity_verification_documents (
        case_id, storage_path, document_type
    )
    VALUES (p_case_id, p_storage_path, v_case.identity_document_type)
    RETURNING id INTO v_document_id;

    UPDATE public.seller_identity_verification_cases
       SET status = 'pending_review',
           current_document_id = v_document_id,
           submission_count = submission_count + 1,
           last_submitted_at = now(),
           submitted_at = now(),
           reviewed_at = NULL,
           expires_at = NULL,
           updated_at = now()
     WHERE id = p_case_id;

    INSERT INTO public.seller_identity_verification_events (
        case_id, actor_user_id, event_type, from_status, to_status,
        seller_message
    )
    VALUES (
        p_case_id, auth.uid(), 'submitted', 'draft', 'pending_review',
        'Your identity submission is waiting for manual review.'
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.seller_get_identity_verification()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_case public.seller_identity_verification_cases%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sign in to view identity verification' USING ERRCODE = '42501';
    END IF;
    WITH expired_cases AS (
        UPDATE public.seller_identity_verification_cases AS verification
           SET status = 'expired', updated_at = now()
         WHERE verification.applicant_user_id = auth.uid()
           AND verification.status = 'approved'
           AND verification.expires_at <= now()
        RETURNING verification.id
    )
    INSERT INTO public.seller_identity_verification_events (
        case_id, actor_user_id, event_type, from_status, to_status,
        seller_message
    )
    SELECT expired_cases.id, NULL, 'expired', 'approved', 'expired',
           'Your identity verification has expired. Submit a new review if you still need it.'
    FROM expired_cases;

    SELECT verification.*
      INTO v_case
      FROM public.seller_identity_verification_cases AS verification
     WHERE verification.applicant_user_id = auth.uid()
     ORDER BY verification.created_at DESC, verification.id DESC
     LIMIT 1;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_started');
    END IF;

    RETURN jsonb_build_object(
        'case_id', v_case.id,
        'country_code', v_case.country_code,
        'seller_type', v_case.seller_type,
        'legal_first_name', v_case.legal_first_name,
        'legal_last_name', v_case.legal_last_name,
        'identity_document_type', v_case.identity_document_type,
        'status', CASE
            WHEN v_case.status = 'approved' AND v_case.expires_at <= now() THEN 'expired'
            ELSE v_case.status
        END,
        'submitted_at', v_case.submitted_at,
        'reviewed_at', v_case.reviewed_at,
        'expires_at', v_case.expires_at,
        'submission_count', v_case.submission_count,
        'history', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                'case_id', event.case_id,
                'event_type', event.event_type,
                'from_status', event.from_status,
                'to_status', event.to_status,
                'seller_message', event.seller_message,
                'created_at', event.created_at
            ) ORDER BY event.created_at DESC, event.id DESC)
            FROM public.seller_identity_verification_events AS event
            WHERE event.case_id IN (
                SELECT previous_case.id
                FROM public.seller_identity_verification_cases AS previous_case
                WHERE previous_case.applicant_user_id = auth.uid()
            )
        ), '[]'::JSONB)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_seller_identity_cases(
    p_status TEXT DEFAULT 'pending_review',
    p_country_code TEXT DEFAULT NULL,
    p_seller_type TEXT DEFAULT NULL,
    p_submitted_after TIMESTAMPTZ DEFAULT NULL,
    p_submitted_before TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
    case_id UUID,
    applicant_user_id UUID,
    shop_id UUID,
    country_code TEXT,
    seller_type TEXT,
    legal_first_name TEXT,
    legal_last_name TEXT,
    identity_document_type TEXT,
    status TEXT,
    submitted_at TIMESTAMPTZ,
    reviewed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    assigned_reviewer_id UUID,
    document_path TEXT,
    review_history JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF public.current_profile_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
    IF coalesce(p_status, 'pending_review') NOT IN (
        'all', 'draft', 'submitted', 'pending_provider', 'pending_review',
        'action_required', 'approved', 'rejected', 'expired', 'suspended', 'revoked'
    ) THEN
        RAISE EXCEPTION 'Unsupported identity verification status' USING ERRCODE = '22023';
    END IF;
    WITH expired AS (
        UPDATE public.seller_identity_verification_cases AS verification
           SET status = 'expired', updated_at = now()
         WHERE verification.status = 'approved'
           AND verification.expires_at <= now()
        RETURNING verification.id
    )
    INSERT INTO public.seller_identity_verification_events (
        case_id, actor_user_id, event_type, from_status, to_status,
        seller_message
    )
    SELECT expired.id, NULL, 'expired', 'approved', 'expired',
           'Identity verification expired.'
    FROM expired;

    RETURN QUERY
    SELECT
        verification.id,
        verification.applicant_user_id,
        verification.shop_id,
        verification.country_code,
        verification.seller_type,
        verification.legal_first_name,
        verification.legal_last_name,
        verification.identity_document_type,
        CASE
            WHEN verification.status = 'approved' AND verification.expires_at <= now() THEN 'expired'
            ELSE verification.status
        END,
        verification.submitted_at,
        verification.reviewed_at,
        verification.expires_at,
        verification.assigned_reviewer_id,
        document.storage_path,
        coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                'event_type', event.event_type,
                'from_status', event.from_status,
                'to_status', event.to_status,
                'seller_message', event.seller_message,
                'internal_note', event.internal_note,
                'actor_user_id', event.actor_user_id,
                'created_at', event.created_at
            ) ORDER BY event.created_at DESC)
            FROM public.seller_identity_verification_events AS event
            WHERE event.case_id = verification.id
        ), '[]'::JSONB)
    FROM public.seller_identity_verification_cases AS verification
    LEFT JOIN public.seller_identity_verification_documents AS document
      ON document.id = verification.current_document_id
    WHERE (
        coalesce(p_status, 'pending_review') = 'all'
        OR CASE
            WHEN verification.status = 'approved' AND verification.expires_at <= now() THEN 'expired'
            ELSE verification.status
        END = coalesce(p_status, 'pending_review')
    )
      AND (p_country_code IS NULL OR verification.country_code = upper(p_country_code))
      AND (p_seller_type IS NULL OR verification.seller_type = p_seller_type)
      AND (p_submitted_after IS NULL OR verification.submitted_at >= p_submitted_after)
      AND (p_submitted_before IS NULL OR verification.submitted_at < p_submitted_before)
    ORDER BY verification.submitted_at ASC NULLS LAST;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_assign_seller_identity_case(
    p_case_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_case public.seller_identity_verification_cases%ROWTYPE;
    v_reviewer UUID := auth.uid();
BEGIN
    IF public.current_profile_role() IS DISTINCT FROM 'admin' OR v_reviewer IS NULL THEN
        RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
    SELECT verification.* INTO v_case
    FROM public.seller_identity_verification_cases AS verification
    WHERE verification.id = p_case_id
    FOR UPDATE;
    IF NOT FOUND OR v_case.status NOT IN ('submitted', 'pending_provider', 'pending_review') THEN
        RAISE EXCEPTION 'This case is not available for assignment' USING ERRCODE = '23514';
    END IF;
    UPDATE public.seller_identity_verification_cases
       SET assigned_reviewer_id = v_reviewer, updated_at = now()
     WHERE id = p_case_id;
    INSERT INTO public.seller_identity_verification_events (
        case_id, actor_user_id, event_type, from_status, to_status, internal_note
    )
    VALUES (
        p_case_id, v_reviewer, 'assigned', v_case.status, v_case.status,
        'Case assigned to reviewer ' || v_reviewer::TEXT
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_review_seller_identity_case(
    p_case_id UUID,
    p_decision TEXT,
    p_seller_message TEXT,
    p_internal_note TEXT,
    p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_case public.seller_identity_verification_cases%ROWTYPE;
    v_reviewer UUID := auth.uid();
    v_next_status TEXT;
    v_seller_message TEXT := nullif(left(btrim(coalesce(p_seller_message, '')), 2000), '');
    v_internal_note TEXT := nullif(left(btrim(coalesce(p_internal_note, '')), 4000), '');
    v_expires_at TIMESTAMPTZ;
BEGIN
    IF public.current_profile_role() IS DISTINCT FROM 'admin' OR v_reviewer IS NULL THEN
        RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
    IF p_decision IS NULL OR p_decision NOT IN ('approve', 'request_info', 'reject', 'suspend', 'revoke', 'restore') THEN
        RAISE EXCEPTION 'Unsupported identity review decision' USING ERRCODE = '22023';
    END IF;
    IF v_internal_note IS NULL OR length(v_internal_note) < 3 THEN
        RAISE EXCEPTION 'Add an internal note for the review audit' USING ERRCODE = '22023';
    END IF;
    IF p_decision IN ('request_info', 'reject', 'suspend', 'revoke', 'restore')
       AND (v_seller_message IS NULL OR length(v_seller_message) < 3) THEN
        RAISE EXCEPTION 'Add a clear next step or reason for the seller' USING ERRCODE = '22023';
    END IF;

    SELECT verification.* INTO v_case
    FROM public.seller_identity_verification_cases AS verification
    WHERE verification.id = p_case_id
    FOR UPDATE;
    IF NOT FOUND OR v_case.applicant_user_id = v_reviewer THEN
        RAISE EXCEPTION 'Verification case not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_case.assigned_reviewer_id IS NOT NULL
       AND v_case.assigned_reviewer_id <> v_reviewer THEN
        RAISE EXCEPTION 'This case is assigned to another reviewer' USING ERRCODE = '42501';
    END IF;
    IF p_decision IN ('approve', 'request_info', 'reject')
       AND v_case.status NOT IN ('pending_review', 'pending_provider', 'submitted') THEN
        RAISE EXCEPTION 'Only a submitted case can receive this review decision'
            USING ERRCODE = '23514';
    END IF;
    IF p_decision IN ('suspend', 'revoke') AND v_case.status <> 'approved' THEN
        RAISE EXCEPTION 'Only an approved identity verification can be suspended or revoked'
            USING ERRCODE = '23514';
    END IF;
    IF p_decision = 'restore' AND v_case.status <> 'suspended' THEN
        RAISE EXCEPTION 'Only a suspended identity verification can be restored'
            USING ERRCODE = '23514';
    END IF;
    IF p_decision = 'approve' AND NOT EXISTS (
        SELECT 1
        FROM public.seller_identity_verification_documents AS document
        WHERE document.id = v_case.current_document_id
          AND document.case_id = v_case.id
          AND document.is_current IS TRUE
    ) THEN
        RAISE EXCEPTION 'The current identity document is missing' USING ERRCODE = '23514';
    END IF;
    IF p_decision = 'approve' THEN
        v_expires_at := coalesce(p_expires_at, now() + interval '365 days');
        IF v_expires_at < now() + interval '30 days'
           OR v_expires_at > now() + interval '3 years' THEN
            RAISE EXCEPTION 'Verification expiry must be between 30 days and 3 years'
                USING ERRCODE = '22023';
        END IF;
        v_next_status := 'approved';
    ELSIF p_decision = 'request_info' THEN
        v_next_status := 'action_required';
    ELSIF p_decision = 'reject' THEN
        v_next_status := 'rejected';
    ELSIF p_decision = 'suspend' THEN
        v_next_status := 'suspended';
    ELSIF p_decision = 'revoke' THEN
        v_next_status := 'revoked';
    ELSE
        v_next_status := 'action_required';
    END IF;

    UPDATE public.seller_identity_verification_cases
       SET status = v_next_status,
           reviewed_at = now(),
           expires_at = CASE WHEN v_next_status = 'approved' THEN v_expires_at ELSE NULL END,
           updated_at = now()
     WHERE id = p_case_id;
    INSERT INTO public.seller_identity_verification_events (
        case_id, actor_user_id, event_type, from_status, to_status,
        seller_message, internal_note
    )
    VALUES (
        p_case_id,
        v_reviewer,
        CASE p_decision
            WHEN 'approve' THEN 'approved'
            WHEN 'request_info' THEN 'action_required'
            WHEN 'reject' THEN 'rejected'
            WHEN 'suspend' THEN 'suspended'
            WHEN 'revoke' THEN 'revoked'
            ELSE 'restored'
        END,
        v_case.status,
        v_next_status,
        v_seller_message,
        v_internal_note
    );
END;
$$;

ALTER TABLE public.shop_verification_submissions
    ADD COLUMN IF NOT EXISTS registry_checked BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS registry_source TEXT,
    ADD COLUMN IF NOT EXISTS registry_reference TEXT,
    ADD COLUMN IF NOT EXISTS representative_authorized BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS registry_checked_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS business_verification_basis TEXT,
    ADD COLUMN IF NOT EXISTS business_evidence_reference TEXT;

ALTER TABLE public.shop_verification_submissions
    DROP CONSTRAINT IF EXISTS shop_verification_submissions_business_type_check;
ALTER TABLE public.shop_verification_submissions
    ADD CONSTRAINT shop_verification_submissions_business_type_check
    CHECK (business_type IN ('individual', 'sole_trader', 'registered', 'partnership'));

CREATE TABLE IF NOT EXISTS public.shop_business_registry_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id UUID NOT NULL
        REFERENCES public.shop_verification_submissions(id) ON DELETE RESTRICT,
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE RESTRICT,
    reviewer_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    registry_checked BOOLEAN NOT NULL,
    registry_source TEXT,
    registry_reference TEXT,
    verification_basis TEXT,
    business_evidence_reference TEXT,
    representative_authorized BOOLEAN NOT NULL,
    review_note TEXT NOT NULL CHECK (char_length(btrim(review_note)) BETWEEN 3 AND 2000),
    internal_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.shop_business_registry_checks
    ADD COLUMN IF NOT EXISTS verification_basis TEXT,
    ADD COLUMN IF NOT EXISTS business_evidence_reference TEXT,
    ADD COLUMN IF NOT EXISTS internal_note TEXT;
CREATE INDEX IF NOT EXISTS shop_business_registry_checks_submission_idx
    ON public.shop_business_registry_checks(submission_id, created_at DESC);
ALTER TABLE public.shop_business_registry_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shop_business_registry_checks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.shop_business_registry_checks TO authenticated;
DROP POLICY IF EXISTS shop_business_registry_checks_admin_read
    ON public.shop_business_registry_checks;
CREATE POLICY shop_business_registry_checks_admin_read
ON public.shop_business_registry_checks FOR SELECT TO authenticated
USING (public.current_profile_role() = 'admin');
DROP TRIGGER IF EXISTS prevent_shop_business_registry_check_mutation
    ON public.shop_business_registry_checks;
CREATE TRIGGER prevent_shop_business_registry_check_mutation
BEFORE UPDATE OR DELETE ON public.shop_business_registry_checks
FOR EACH ROW EXECUTE FUNCTION public.prevent_seller_identity_history_mutation();

CREATE TABLE IF NOT EXISTS public.shop_business_verification_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id UUID NOT NULL
        REFERENCES public.shop_verification_submissions(id) ON DELETE RESTRICT,
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE RESTRICT,
    reviewer_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    decision TEXT NOT NULL
        CHECK (decision IN ('approve', 'request_resubmission', 'reject')),
    verification_basis TEXT,
    registry_source TEXT,
    registry_reference TEXT,
    business_evidence_reference TEXT,
    representative_authorized BOOLEAN NOT NULL DEFAULT FALSE,
    seller_message TEXT NOT NULL
        CHECK (char_length(btrim(seller_message)) BETWEEN 3 AND 2000),
    internal_note TEXT NOT NULL
        CHECK (char_length(btrim(internal_note)) BETWEEN 3 AND 2000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shop_business_verification_events_case_idx
    ON public.shop_business_verification_events(submission_id, created_at DESC);
ALTER TABLE public.shop_business_verification_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shop_business_verification_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.shop_business_verification_events TO authenticated;
DROP POLICY IF EXISTS shop_business_verification_events_admin_read
    ON public.shop_business_verification_events;
CREATE POLICY shop_business_verification_events_admin_read
ON public.shop_business_verification_events FOR SELECT TO authenticated
USING (public.current_profile_role() = 'admin');
DROP TRIGGER IF EXISTS prevent_shop_business_verification_event_mutation
    ON public.shop_business_verification_events;
CREATE TRIGGER prevent_shop_business_verification_event_mutation
BEFORE UPDATE OR DELETE ON public.shop_business_verification_events
FOR EACH ROW EXECUTE FUNCTION public.prevent_seller_identity_history_mutation();

CREATE OR REPLACE FUNCTION public.admin_review_shop_verification_with_registry(
    p_submission_id UUID,
    p_decision TEXT,
    p_note TEXT DEFAULT NULL,
    p_registry_checked BOOLEAN DEFAULT FALSE,
    p_registry_source TEXT DEFAULT NULL,
    p_registry_reference TEXT DEFAULT NULL,
    p_representative_authorized BOOLEAN DEFAULT FALSE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_submission public.shop_verification_submissions%ROWTYPE;
    v_country TEXT;
    v_source TEXT := nullif(left(btrim(coalesce(p_registry_source, '')), 80), '');
    v_reference TEXT := nullif(left(btrim(coalesce(p_registry_reference, '')), 200), '');
BEGIN
    IF public.current_profile_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
    SELECT submission.* INTO v_submission
    FROM public.shop_verification_submissions AS submission
    WHERE submission.id = p_submission_id
    FOR UPDATE;
    IF NOT FOUND OR v_submission.status <> 'pending' THEN
        RAISE EXCEPTION 'Only pending shop verification cases can be reviewed'
            USING ERRCODE = '23514';
    END IF;
    IF public.shop_portal_owns_shop(v_submission.shop_id) THEN
        RAISE EXCEPTION 'A shop owner cannot review their own business verification'
            USING ERRCODE = '42501';
    END IF;
    IF p_decision = 'approve' AND p_registry_checked IS TRUE
       AND (v_source IS NULL OR v_reference IS NULL
            OR p_representative_authorized IS NOT TRUE) THEN
        RAISE EXCEPTION 'Record the official registry source, reference, and representative check'
            USING ERRCODE = '22023';
    END IF;
    IF p_decision = 'approve' AND p_registry_checked IS TRUE
       AND v_submission.business_type NOT IN ('registered', 'partnership') THEN
        RAISE EXCEPTION 'Registry confirmation applies only to registered businesses or partnerships'
            USING ERRCODE = '22023';
    END IF;
    IF p_decision = 'approve' AND p_registry_checked IS TRUE THEN
        SELECT shop.country::TEXT INTO v_country
        FROM public.shops AS shop
        WHERE shop.id = v_submission.shop_id;
        IF (v_country = 'Nigeria' AND v_source <> 'CAC')
           OR (v_country = 'United Kingdom' AND v_source <> 'Companies House')
           OR v_country NOT IN ('Nigeria', 'United Kingdom') THEN
            RAISE EXCEPTION 'Choose the authoritative registry configured for this country'
                USING ERRCODE = '22023';
        END IF;
    END IF;

    PERFORM public.admin_review_shop_verification(p_submission_id, p_decision, p_note);

    IF p_decision = 'approve' THEN
        UPDATE public.shop_verification_submissions
           SET registry_checked = (p_registry_checked IS TRUE),
               registry_source = CASE WHEN p_registry_checked IS TRUE THEN v_source ELSE NULL END,
               registry_reference = CASE WHEN p_registry_checked IS TRUE THEN v_reference ELSE NULL END,
               representative_authorized = (p_representative_authorized IS TRUE),
               registry_checked_at = CASE WHEN p_registry_checked IS TRUE THEN now() ELSE NULL END
         WHERE id = p_submission_id;

        INSERT INTO public.shop_business_registry_checks (
            submission_id, shop_id, reviewer_user_id, registry_checked,
            registry_source, registry_reference, representative_authorized, review_note
        )
        VALUES (
            p_submission_id, v_submission.shop_id, auth.uid(),
            (p_registry_checked IS TRUE),
            CASE WHEN p_registry_checked IS TRUE THEN v_source ELSE NULL END,
            CASE WHEN p_registry_checked IS TRUE THEN v_reference ELSE NULL END,
            (p_representative_authorized IS TRUE),
            left(btrim(coalesce(p_note, 'Recorded the shop review decision.')), 2000)
        );
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_review_shop_verification_with_basis(
    p_submission_id UUID,
    p_decision TEXT,
    p_seller_message TEXT,
    p_internal_note TEXT,
    p_verification_basis TEXT DEFAULT NULL,
    p_registry_source TEXT DEFAULT NULL,
    p_registry_reference TEXT DEFAULT NULL,
    p_business_evidence_reference TEXT DEFAULT NULL,
    p_representative_authorized BOOLEAN DEFAULT FALSE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_submission public.shop_verification_submissions%ROWTYPE;
    v_country TEXT;
    v_country_code TEXT;
    v_expected_registry_source TEXT;
    v_applicant_user_id UUID;
    v_registry_source TEXT := nullif(left(btrim(coalesce(p_registry_source, '')), 80), '');
    v_registry_reference TEXT := nullif(left(btrim(coalesce(p_registry_reference, '')), 200), '');
    v_evidence_reference TEXT := nullif(left(btrim(coalesce(p_business_evidence_reference, '')), 500), '');
    v_note TEXT := nullif(left(btrim(coalesce(p_seller_message, '')), 2000), '');
    v_internal_note TEXT := nullif(left(btrim(coalesce(p_internal_note, '')), 2000), '');
BEGIN
    IF public.current_profile_role() IS DISTINCT FROM 'admin' OR auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
    IF p_decision NOT IN ('approve', 'request_resubmission', 'reject') THEN
        RAISE EXCEPTION 'Unsupported shop verification decision' USING ERRCODE = '22023';
    END IF;
    IF v_note IS NULL OR length(v_note) < 3 THEN
        RAISE EXCEPTION 'Add a clear message for the seller before saving this decision' USING ERRCODE = '22023';
    END IF;
    IF v_internal_note IS NULL OR length(v_internal_note) < 3 THEN
        RAISE EXCEPTION 'Record what was checked in an internal review note' USING ERRCODE = '22023';
    END IF;

    SELECT submission.* INTO v_submission
    FROM public.shop_verification_submissions AS submission
    WHERE submission.id = p_submission_id
    FOR UPDATE;
    IF NOT FOUND OR v_submission.status <> 'pending' THEN
        RAISE EXCEPTION 'Only pending shop verification cases can be reviewed'
            USING ERRCODE = '23514';
    END IF;

    IF public.shop_portal_owns_shop(v_submission.shop_id) THEN
        RAISE EXCEPTION 'A shop owner cannot review their own business verification'
            USING ERRCODE = '42501';
    END IF;

    IF p_decision = 'approve' THEN
        IF v_submission.business_type IN ('registered', 'partnership') THEN
            IF p_verification_basis IS DISTINCT FROM 'registry'
               OR v_registry_source IS NULL OR v_registry_reference IS NULL
               OR p_representative_authorized IS NOT TRUE THEN
                RAISE EXCEPTION 'Confirm the official registry record and representative authority before approval'
                    USING ERRCODE = '22023';
            END IF;
            SELECT shop.country::TEXT INTO v_country
            FROM public.shops AS shop
            WHERE shop.id = v_submission.shop_id;
            SELECT coalesce(owner_profile.user_id, owner_profile.id)
              INTO v_applicant_user_id
            FROM public.shops AS shop
            LEFT JOIN LATERAL (
                SELECT profile.id, profile.user_id
                FROM public.profiles AS profile
                WHERE profile.id = shop.owner_id
                   OR profile.id = shop.current_owner_id
                   OR profile.user_id = shop.owner_id
                   OR profile.user_id = shop.current_owner_id
                ORDER BY (profile.id = shop.owner_id OR profile.id = shop.current_owner_id) DESC
                LIMIT 1
            ) AS owner_profile ON TRUE
            WHERE shop.id = v_submission.shop_id;
            IF NOT EXISTS (
                SELECT 1
                FROM public.seller_identity_verification_cases AS identity
                WHERE identity.applicant_user_id = v_applicant_user_id
                  AND identity.status = 'approved'
                  AND identity.expires_at > now()
                  AND identity.seller_type = 'registered_business'
            ) THEN
                RAISE EXCEPTION 'Approve a current identity verification for the business representative first'
                    USING ERRCODE = '23514';
            END IF;
            SELECT config.country_code, config.business_registry_source
              INTO v_country_code, v_expected_registry_source
            FROM public.seller_verification_country_config AS config
            WHERE lower(config.country_name) = lower(btrim(coalesce(v_country, '')))
               OR config.country_code = upper(btrim(coalesce(v_country, '')))
            ORDER BY (config.country_code = upper(btrim(coalesce(v_country, '')))) DESC
            LIMIT 1;
            IF v_expected_registry_source IS NULL
               OR v_registry_source <> v_expected_registry_source THEN
                RAISE EXCEPTION 'The selected registry is not configured for this country'
                    USING ERRCODE = '22023';
            END IF;
        ELSIF v_submission.business_type = 'sole_trader' THEN
            IF p_verification_basis IS DISTINCT FROM 'sole_trader_manual'
               OR v_evidence_reference IS NULL
               OR p_representative_authorized IS NOT TRUE THEN
                RAISE EXCEPTION 'Record the sole-trader evidence reviewed and confirm the applicant is the proprietor'
                    USING ERRCODE = '22023';
            END IF;
            SELECT coalesce(owner_profile.user_id, owner_profile.id)
              INTO v_applicant_user_id
            FROM public.shops AS shop
            LEFT JOIN LATERAL (
                SELECT profile.id, profile.user_id
                FROM public.profiles AS profile
                WHERE profile.id = shop.owner_id
                   OR profile.id = shop.current_owner_id
                   OR profile.user_id = shop.owner_id
                   OR profile.user_id = shop.current_owner_id
                ORDER BY (profile.id = shop.owner_id OR profile.id = shop.current_owner_id) DESC
                LIMIT 1
            ) AS owner_profile ON TRUE
            WHERE shop.id = v_submission.shop_id;
            IF NOT EXISTS (
                SELECT 1
                FROM public.seller_identity_verification_cases AS identity
                WHERE identity.applicant_user_id = v_applicant_user_id
                  AND identity.status = 'approved'
                  AND identity.expires_at > now()
                  AND identity.seller_type = 'sole_trader'
            ) THEN
                RAISE EXCEPTION 'Approve a current identity verification for the sole trader first'
                    USING ERRCODE = '23514';
            END IF;
        ELSE
            IF p_verification_basis IS NOT NULL THEN
                RAISE EXCEPTION 'Individual shop approval does not establish business verification'
                    USING ERRCODE = '22023';
            END IF;
        END IF;
    END IF;

    PERFORM public.admin_review_shop_verification(p_submission_id, p_decision, v_note);

    INSERT INTO public.shop_business_verification_events (
        submission_id, shop_id, reviewer_user_id, decision,
        verification_basis, registry_source, registry_reference,
        business_evidence_reference, representative_authorized,
        seller_message, internal_note
    )
    VALUES (
        p_submission_id, v_submission.shop_id, auth.uid(), p_decision,
        p_verification_basis,
        CASE WHEN p_decision = 'approve' AND p_verification_basis = 'registry'
            THEN v_registry_source ELSE NULL END,
        CASE WHEN p_decision = 'approve' AND p_verification_basis = 'registry'
            THEN v_registry_reference ELSE NULL END,
        CASE WHEN p_decision = 'approve' AND p_verification_basis = 'sole_trader_manual'
            THEN v_evidence_reference ELSE NULL END,
        p_decision = 'approve' AND p_representative_authorized IS TRUE,
        v_note,
        v_internal_note
    );

    IF p_decision = 'approve' THEN
        UPDATE public.shop_verification_submissions
           SET registry_checked = (p_verification_basis = 'registry'),
               registry_source = CASE WHEN p_verification_basis = 'registry' THEN v_registry_source ELSE NULL END,
               registry_reference = CASE WHEN p_verification_basis = 'registry' THEN v_registry_reference ELSE NULL END,
               business_verification_basis = p_verification_basis,
               business_evidence_reference = CASE
                   WHEN p_verification_basis = 'sole_trader_manual' THEN v_evidence_reference
                   ELSE NULL
               END,
               representative_authorized = (
                   p_verification_basis IN ('registry', 'sole_trader_manual')
                   AND p_representative_authorized IS TRUE
               ),
               registry_checked_at = CASE
                   WHEN p_verification_basis = 'registry' THEN now()
                   ELSE NULL
               END
         WHERE id = p_submission_id;

        INSERT INTO public.shop_business_registry_checks (
            submission_id, shop_id, reviewer_user_id, registry_checked,
            registry_source, registry_reference, verification_basis,
            business_evidence_reference, representative_authorized, review_note
            , internal_note
        )
        VALUES (
            p_submission_id, v_submission.shop_id, auth.uid(),
            (p_verification_basis = 'registry'),
            CASE WHEN p_verification_basis = 'registry' THEN v_registry_source ELSE NULL END,
            CASE WHEN p_verification_basis = 'registry' THEN v_registry_reference ELSE NULL END,
            p_verification_basis,
            CASE WHEN p_verification_basis = 'sole_trader_manual' THEN v_evidence_reference ELSE NULL END,
            (
                p_verification_basis IN ('registry', 'sole_trader_manual')
                AND p_representative_authorized IS TRUE
            ),
            v_note,
            v_internal_note
        );
    END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.shop_physical_store_inspections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL UNIQUE REFERENCES public.shops(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'requested'
        CHECK (status IN ('requested', 'scheduled', 'approved', 'rejected', 'suspended', 'revoked')),
    requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    assigned_reviewer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    scheduled_at TIMESTAMPTZ,
    inspected_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    outcome TEXT CHECK (outcome IN ('passed', 'not_confirmed')),
    seller_message TEXT CHECK (char_length(coalesce(seller_message, '')) <= 2000),
    inspection_notes TEXT CHECK (char_length(coalesce(inspection_notes, '')) <= 4000),
    evidence_reference TEXT CHECK (char_length(coalesce(evidence_reference, '')) <= 500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (status <> 'approved' OR (inspected_at IS NOT NULL AND outcome = 'passed'))
);
CREATE INDEX IF NOT EXISTS shop_physical_store_inspections_queue_idx
    ON public.shop_physical_store_inspections(status, scheduled_at, created_at);
ALTER TABLE public.shop_physical_store_inspections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shop_physical_store_inspections FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.shop_physical_store_inspections TO authenticated;
DROP POLICY IF EXISTS shop_physical_store_inspections_owner_or_admin_read
    ON public.shop_physical_store_inspections;
CREATE POLICY shop_physical_store_inspections_owner_or_admin_read
ON public.shop_physical_store_inspections FOR SELECT TO authenticated
USING (
    public.shop_portal_owns_shop(shop_id)
    OR public.current_profile_role() = 'admin'
);

CREATE TABLE IF NOT EXISTS public.shop_physical_store_inspection_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inspection_id UUID NOT NULL
        REFERENCES public.shop_physical_store_inspections(id) ON DELETE RESTRICT,
    actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'requested', 'scheduled', 'approved', 'rejected', 'suspended', 'revoked'
    )),
    from_status TEXT,
    to_status TEXT NOT NULL,
    seller_message TEXT CHECK (char_length(coalesce(seller_message, '')) <= 2000),
    internal_note TEXT CHECK (char_length(coalesce(internal_note, '')) <= 4000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shop_physical_store_inspection_events_idx
    ON public.shop_physical_store_inspection_events(inspection_id, created_at DESC);
ALTER TABLE public.shop_physical_store_inspection_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shop_physical_store_inspection_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.shop_physical_store_inspection_events TO authenticated;
DROP POLICY IF EXISTS shop_physical_store_inspection_events_admin_read
    ON public.shop_physical_store_inspection_events;
CREATE POLICY shop_physical_store_inspection_events_admin_read
ON public.shop_physical_store_inspection_events FOR SELECT TO authenticated
USING (public.current_profile_role() = 'admin');

DROP TRIGGER IF EXISTS prevent_shop_physical_inspection_event_mutation
    ON public.shop_physical_store_inspection_events;
CREATE TRIGGER prevent_shop_physical_inspection_event_mutation
BEFORE UPDATE OR DELETE ON public.shop_physical_store_inspection_events
FOR EACH ROW EXECUTE FUNCTION public.prevent_seller_identity_history_mutation();

CREATE OR REPLACE FUNCTION public.shop_owner_request_physical_store_inspection(
    p_shop_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_inspection_id UUID;
    v_existing public.shop_physical_store_inspections%ROWTYPE;
BEGIN
    IF NOT public.shop_portal_owns_shop(p_shop_id) THEN
        RAISE EXCEPTION 'You do not own this shop' USING ERRCODE = '42501';
    END IF;
    PERFORM pg_advisory_xact_lock(
        hashtextextended(p_shop_id::TEXT || ':physical-inspection', 0)
    );
    IF NOT EXISTS (
        SELECT 1 FROM public.shops AS shop
        JOIN public.shop_physical_locations AS location ON location.shop_id = shop.id
        WHERE shop.id = p_shop_id
          AND shop.status = 'active'
          AND location.review_status = 'approved'
    ) THEN
        RAISE EXCEPTION 'Add an approved physical shop location before requesting an inspection'
            USING ERRCODE = '23514';
    END IF;

    SELECT inspection.* INTO v_existing
    FROM public.shop_physical_store_inspections AS inspection
    WHERE inspection.shop_id = p_shop_id
    FOR UPDATE;
    IF FOUND AND v_existing.status IN ('requested', 'scheduled') THEN
        RETURN v_existing.id;
    END IF;
    IF FOUND AND v_existing.status IN ('approved', 'suspended') THEN
        RAISE EXCEPTION 'This shop already has an active or suspended physical-store review'
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.shop_physical_store_inspections(shop_id, requested_by, status)
    VALUES (p_shop_id, auth.uid(), 'requested')
    ON CONFLICT (shop_id) DO UPDATE
       SET requested_by = EXCLUDED.requested_by,
           status = CASE
               WHEN shop_physical_store_inspections.status IN ('rejected', 'revoked')
                   THEN 'requested'
               ELSE shop_physical_store_inspections.status
           END,
           seller_message = CASE
               WHEN shop_physical_store_inspections.status IN ('rejected', 'revoked')
                   THEN NULL
               ELSE shop_physical_store_inspections.seller_message
           END,
           updated_at = now()
    RETURNING id INTO v_inspection_id;

    INSERT INTO public.shop_physical_store_inspection_events (
        inspection_id, actor_user_id, event_type, from_status, to_status,
        seller_message
    )
    VALUES (
        v_inspection_id, auth.uid(), 'requested', NULL, 'requested',
        'A physical premises inspection has been requested.'
    );
    RETURN v_inspection_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.seller_get_physical_store_inspection(
    p_shop_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_inspection public.shop_physical_store_inspections%ROWTYPE;
BEGIN
    IF NOT public.shop_portal_owns_shop(p_shop_id) THEN
        RAISE EXCEPTION 'You do not own this shop' USING ERRCODE = '42501';
    END IF;
    SELECT inspection.* INTO v_inspection
    FROM public.shop_physical_store_inspections AS inspection
    WHERE inspection.shop_id = p_shop_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_started');
    END IF;
    RETURN jsonb_build_object(
        'inspection_id', v_inspection.id,
        'status', v_inspection.status,
        'scheduled_at', v_inspection.scheduled_at,
        'inspected_at', v_inspection.inspected_at,
        'seller_message', v_inspection.seller_message,
        'outcome', v_inspection.outcome
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_physical_store_inspections(
    p_status TEXT DEFAULT 'requested'
)
RETURNS TABLE (
    inspection_id UUID,
    shop_id UUID,
    shop_name TEXT,
    country TEXT,
    city TEXT,
    address TEXT,
    location_status TEXT,
    status TEXT,
    requested_by UUID,
    assigned_reviewer_id UUID,
    scheduled_at TIMESTAMPTZ,
    inspected_at TIMESTAMPTZ,
    outcome TEXT,
    inspection_notes TEXT,
    evidence_reference TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF public.current_profile_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
    IF coalesce(p_status, 'requested') NOT IN (
        'all', 'requested', 'scheduled', 'approved', 'rejected', 'suspended', 'revoked'
    ) THEN
        RAISE EXCEPTION 'Unsupported physical inspection status' USING ERRCODE = '22023';
    END IF;
    RETURN QUERY
    SELECT
        inspection.id, shop.id, shop.name::TEXT, shop.country::TEXT,
        location.city::TEXT, location.address::TEXT, location.review_status::TEXT,
        inspection.status, inspection.requested_by, inspection.assigned_reviewer_id,
        inspection.scheduled_at, inspection.inspected_at, inspection.outcome,
        inspection.inspection_notes, inspection.evidence_reference
    FROM public.shop_physical_store_inspections AS inspection
    JOIN public.shops AS shop ON shop.id = inspection.shop_id
    LEFT JOIN public.shop_physical_locations AS location ON location.shop_id = shop.id
    WHERE coalesce(p_status, 'requested') = 'all'
       OR inspection.status = coalesce(p_status, 'requested')
    ORDER BY inspection.created_at ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_physical_store_inspection(
    p_inspection_id UUID,
    p_action TEXT,
    p_scheduled_at TIMESTAMPTZ DEFAULT NULL,
    p_inspected_at TIMESTAMPTZ DEFAULT NULL,
    p_outcome TEXT DEFAULT NULL,
    p_seller_message TEXT DEFAULT NULL,
    p_inspection_notes TEXT DEFAULT NULL,
    p_evidence_reference TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_inspection public.shop_physical_store_inspections%ROWTYPE;
    v_reviewer UUID := auth.uid();
    v_next_status TEXT;
    v_seller_message TEXT := nullif(left(btrim(coalesce(p_seller_message, '')), 2000), '');
    v_notes TEXT := nullif(left(btrim(coalesce(p_inspection_notes, '')), 4000), '');
    v_evidence TEXT := nullif(left(btrim(coalesce(p_evidence_reference, '')), 500), '');
BEGIN
    IF public.current_profile_role() IS DISTINCT FROM 'admin' OR v_reviewer IS NULL THEN
        RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
    IF p_action IS NULL OR p_action NOT IN ('schedule', 'complete', 'suspend', 'revoke') THEN
        RAISE EXCEPTION 'Unsupported inspection action' USING ERRCODE = '22023';
    END IF;
    SELECT inspection.* INTO v_inspection
    FROM public.shop_physical_store_inspections AS inspection
    WHERE inspection.id = p_inspection_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Inspection request not found' USING ERRCODE = 'P0002';
    END IF;
    IF public.shop_portal_owns_shop(v_inspection.shop_id) THEN
        RAISE EXCEPTION 'A shop owner cannot review their own inspection' USING ERRCODE = '42501';
    END IF;
    IF p_action = 'schedule' THEN
        IF v_inspection.status NOT IN ('requested', 'rejected', 'revoked') THEN
            RAISE EXCEPTION 'Only a requested inspection can be scheduled' USING ERRCODE = '23514';
        END IF;
        IF p_scheduled_at IS NULL OR p_scheduled_at <= now() OR v_seller_message IS NULL THEN
            RAISE EXCEPTION 'Set a future inspection time and tell the seller what to expect'
                USING ERRCODE = '22023';
        END IF;
        v_next_status := 'scheduled';
    ELSIF p_action = 'complete' THEN
        IF v_inspection.status <> 'scheduled' THEN
            RAISE EXCEPTION 'Only a scheduled inspection can be completed' USING ERRCODE = '23514';
        END IF;
        IF p_inspected_at IS NULL OR p_inspected_at > now()
           OR p_outcome IS NULL OR p_outcome NOT IN ('passed', 'not_confirmed')
           OR v_notes IS NULL OR length(v_notes) < 3 THEN
            RAISE EXCEPTION 'Record the actual inspection date, outcome, and notes'
                USING ERRCODE = '22023';
        END IF;
        IF p_outcome = 'passed'
           AND (v_evidence IS NULL OR v_seller_message IS NULL) THEN
            RAISE EXCEPTION 'Record inspection evidence and the outcome shared with the seller'
                USING ERRCODE = '22023';
        END IF;
        v_next_status := CASE WHEN p_outcome = 'passed' THEN 'approved' ELSE 'rejected' END;
    ELSIF p_action = 'suspend' THEN
        IF v_inspection.status <> 'approved' THEN
            RAISE EXCEPTION 'Only an approved physical-store verification can be suspended'
                USING ERRCODE = '23514';
        END IF;
        IF v_notes IS NULL OR v_seller_message IS NULL THEN
            RAISE EXCEPTION 'Provide a reason and seller-facing next step' USING ERRCODE = '22023';
        END IF;
        v_next_status := 'suspended';
    ELSE
        IF v_inspection.status NOT IN ('approved', 'suspended') THEN
            RAISE EXCEPTION 'Only an approved or suspended physical-store verification can be revoked'
                USING ERRCODE = '23514';
        END IF;
        IF v_notes IS NULL OR v_seller_message IS NULL THEN
            RAISE EXCEPTION 'Provide a revocation reason and seller-facing next step'
                USING ERRCODE = '22023';
        END IF;
        v_next_status := 'revoked';
    END IF;

    UPDATE public.shop_physical_store_inspections
       SET status = v_next_status,
           assigned_reviewer_id = v_reviewer,
           scheduled_at = CASE WHEN p_action = 'schedule' THEN p_scheduled_at ELSE scheduled_at END,
           inspected_at = CASE WHEN p_action = 'complete' THEN p_inspected_at ELSE inspected_at END,
           outcome = CASE WHEN p_action = 'complete' THEN p_outcome ELSE outcome END,
           reviewed_by = v_reviewer,
           seller_message = v_seller_message,
           inspection_notes = v_notes,
           evidence_reference = v_evidence,
           updated_at = now()
     WHERE id = p_inspection_id;
    INSERT INTO public.shop_physical_store_inspection_events (
        inspection_id, actor_user_id, event_type, from_status, to_status,
        seller_message, internal_note
    )
    VALUES (
        p_inspection_id, v_reviewer, v_next_status, v_inspection.status,
        v_next_status, v_seller_message, v_notes
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_seller_verification_badges(
    p_shop_ids UUID[]
)
RETURNS TABLE (
    shop_id UUID,
    contact_verified BOOLEAN,
    identity_verified BOOLEAN,
    business_verified BOOLEAN,
    physical_store_verified BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
    WITH requested AS (
        SELECT DISTINCT unnest(coalesce(p_shop_ids, ARRAY[]::UUID[])) AS shop_id
        LIMIT 1000
    ),
    shop_owner AS (
        SELECT
            shop.id AS shop_id,
            coalesce(owner_profile.user_id, owner_profile.id) AS user_id
        FROM requested
        JOIN public.shops AS shop ON shop.id = requested.shop_id
        LEFT JOIN LATERAL (
            SELECT profile.id, profile.user_id
            FROM public.profiles AS profile
            WHERE profile.id = shop.owner_id
               OR profile.id = shop.current_owner_id
               OR profile.user_id = shop.owner_id
               OR profile.user_id = shop.current_owner_id
            ORDER BY (profile.id = shop.owner_id OR profile.id = shop.current_owner_id) DESC
            LIMIT 1
        ) AS owner_profile ON TRUE
    )
    SELECT
        owner.shop_id,
        coalesce((
            SELECT auth_user.email_confirmed_at IS NOT NULL
                   AND profile.phone_verified IS TRUE
            FROM auth.users AS auth_user
            LEFT JOIN public.profiles AS profile
              ON profile.user_id = auth_user.id OR profile.id = auth_user.id
            WHERE auth_user.id = owner.user_id
            LIMIT 1
        ), FALSE),
        coalesce((
            SELECT identity.status = 'approved'
                   AND identity.expires_at > now()
            FROM public.seller_identity_verification_cases AS identity
            WHERE identity.applicant_user_id = owner.user_id
            ORDER BY identity.created_at DESC, identity.id DESC
            LIMIT 1
        ), FALSE),
        EXISTS (
            SELECT 1
            FROM public.shop_verification_submissions AS business
            WHERE business.shop_id = owner.shop_id
              AND business.status = 'approved'
              AND business.business_verification_basis IN ('registry', 'sole_trader_manual')
              AND (
                  (
                      business.business_verification_basis = 'registry'
                      AND business.registry_checked IS TRUE
                      AND business.registry_source IS NOT NULL
                      AND business.registry_reference IS NOT NULL
                  )
                  OR (
                      business.business_verification_basis = 'sole_trader_manual'
                      AND business.business_type = 'sole_trader'
                      AND business.business_evidence_reference IS NOT NULL
                  )
              )
              AND business.representative_authorized IS TRUE
        ),
        EXISTS (
            SELECT 1
            FROM public.shop_physical_store_inspections AS inspection
            WHERE inspection.shop_id = owner.shop_id
              AND inspection.status = 'approved'
              AND inspection.outcome = 'passed'
              AND inspection.inspected_at IS NOT NULL
              AND EXISTS (
                  SELECT 1
                  FROM public.shops AS shop
                  JOIN public.shop_physical_locations AS location
                    ON location.shop_id = shop.id
                  WHERE shop.id = inspection.shop_id
                    AND shop.status = 'active'
                    AND location.review_status = 'approved'
              )
        )
    FROM shop_owner AS owner
    WHERE owner.user_id IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.seller_prepare_identity_verification(
    TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, BOOLEAN
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.seller_submit_identity_verification(UUID, TEXT)
    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.seller_get_identity_verification()
    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_seller_identity_cases(TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ)
    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_assign_seller_identity_case(UUID)
    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_review_seller_identity_case(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ)
    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_review_shop_verification_with_registry(
    UUID, TEXT, TEXT, BOOLEAN, TEXT, TEXT, BOOLEAN
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_review_shop_verification_with_basis(
    UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.shop_owner_request_physical_store_inspection(UUID)
    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.seller_get_physical_store_inspection(UUID)
    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_physical_store_inspections(TEXT)
    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_update_physical_store_inspection(
    UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_public_seller_verification_badges(UUID[])
    FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.seller_prepare_identity_verification(
    TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, BOOLEAN
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seller_submit_identity_verification(UUID, TEXT)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.seller_get_identity_verification()
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_seller_identity_cases(TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_assign_seller_identity_case(UUID)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_review_seller_identity_case(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_review_shop_verification_with_registry(
    UUID, TEXT, TEXT, BOOLEAN, TEXT, TEXT, BOOLEAN
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_review_shop_verification_with_basis(
    UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shop_owner_request_physical_store_inspection(UUID)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.seller_get_physical_store_inspection(UUID)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_physical_store_inspections(TEXT)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_physical_store_inspection(
    UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_seller_verification_badges(UUID[])
    TO anon, authenticated;

COMMIT;
