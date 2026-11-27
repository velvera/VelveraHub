-- Preserve each identity review as its own case and retain seller-visible history.
--
-- Apply after database/seller-trust-verification.sql (migration 23).
-- This is also included in the updated migration 23 for fresh installations.

BEGIN;

ALTER TABLE public.seller_identity_verification_cases
    DROP CONSTRAINT IF EXISTS seller_identity_verification_cases_applicant_user_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS seller_identity_active_case_per_applicant_idx
    ON public.seller_identity_verification_cases(applicant_user_id)
    WHERE status IN ('draft', 'submitted', 'pending_provider', 'pending_review');

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

COMMIT;
