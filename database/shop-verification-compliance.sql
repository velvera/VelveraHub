-- VelveraHub shop verification workflow.
--
-- Apply after database/shop-owner-payments.sql. This is additive: existing
-- shops and submissions are preserved. New shops remain unpublished until an
-- administrator approves a submission through the guarded review RPC.

BEGIN;

CREATE OR REPLACE FUNCTION public.prevent_seller_shop_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    IF coalesce(auth.role(), '') <> 'service_role'
       AND public.current_profile_role() IS DISTINCT FROM 'admin' THEN
        IF NEW.owner_id IS DISTINCT FROM OLD.owner_id
           OR NEW.current_owner_id IS DISTINCT FROM OLD.current_owner_id
           OR NEW.rental_status IS DISTINCT FROM OLD.rental_status
           OR NEW.rental_start_date IS DISTINCT FROM OLD.rental_start_date
           OR NEW.rental_end_date IS DISTINCT FROM OLD.rental_end_date
           OR NEW.monthly_rent IS DISTINCT FROM OLD.monthly_rent
           OR NEW.status IS DISTINCT FROM OLD.status
           OR NEW.verified IS DISTINCT FROM OLD.verified THEN
            RAISE EXCEPTION 'Seller cannot change shop ownership, rental, or approval fields';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS shop_owner_delete_verification_document ON storage.objects;
CREATE POLICY shop_owner_delete_verification_document
ON storage.objects FOR DELETE TO authenticated
USING (
    bucket_id = 'shop-verification-private'
    AND public.shop_portal_owns_storage_path(name)
);

DROP TRIGGER IF EXISTS prevent_seller_shop_escalation
    ON public.shops;
CREATE TRIGGER prevent_seller_shop_escalation
BEFORE UPDATE ON public.shops
FOR EACH ROW
EXECUTE FUNCTION public.prevent_seller_shop_escalation();

CREATE TABLE IF NOT EXISTS public.shop_verification_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id UUID NOT NULL
        REFERENCES public.shop_verification_submissions(id) ON DELETE RESTRICT,
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE RESTRICT,
    reviewer_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    decision TEXT NOT NULL
        CHECK (decision IN ('approved', 'resubmission_required', 'rejected')),
    note TEXT,
    document_paths TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shop_verification_reviews_shop_created_idx
    ON public.shop_verification_reviews (shop_id, created_at DESC);

ALTER TABLE public.shop_verification_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admins_read_shop_verification_reviews
    ON public.shop_verification_reviews;
CREATE POLICY admins_read_shop_verification_reviews
ON public.shop_verification_reviews FOR SELECT TO authenticated
USING (public.current_profile_role() = 'admin');

REVOKE ALL ON public.shop_verification_reviews FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.shop_verification_reviews TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.shop_verification_reviews
    FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.shop_owner_submit_verification_documents(
    p_shop_id UUID,
    p_legal_name TEXT,
    p_business_name TEXT,
    p_registration_number TEXT,
    p_business_type TEXT,
    p_document_paths TEXT[]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
    v_shop_status TEXT;
    v_submission_status TEXT;
    v_submission_id UUID;
BEGIN
    IF NOT public.shop_portal_owns_shop(p_shop_id) THEN
        RAISE EXCEPTION 'You do not own this shop';
    END IF;

    IF length(trim(coalesce(p_legal_name, ''))) NOT BETWEEN 2 AND 160
       OR length(trim(coalesce(p_business_name, ''))) NOT BETWEEN 2 AND 160
       OR length(trim(coalesce(p_registration_number, ''))) > 120
       OR p_business_type NOT IN ('individual', 'registered', 'partnership') THEN
        RAISE EXCEPTION 'Verification details are invalid';
    END IF;

    IF coalesce(cardinality(p_document_paths), 0) NOT BETWEEN 1 AND 5
       OR (
            SELECT count(DISTINCT document_path)
            FROM unnest(coalesce(p_document_paths, ARRAY[]::TEXT[])) AS documents(document_path)
          ) <> cardinality(p_document_paths)
       OR EXISTS (
            SELECT 1
            FROM unnest(coalesce(p_document_paths, ARRAY[]::TEXT[])) AS documents(document_path)
            WHERE document_path !~ (
                '^' || p_shop_id::TEXT || '/[A-Za-z0-9._-]{1,180}$'
            )
          ) THEN
        RAISE EXCEPTION 'Upload between one and five valid verification documents';
    END IF;

    SELECT status
      INTO v_shop_status
      FROM public.shops
     WHERE id = p_shop_id
     FOR UPDATE;
    IF v_shop_status IS DISTINCT FROM 'pending' THEN
        RAISE EXCEPTION 'Only a shop awaiting verification can submit documents';
    END IF;

    SELECT status
      INTO v_submission_status
      FROM public.shop_verification_submissions
     WHERE shop_id = p_shop_id
     FOR UPDATE;
    IF v_submission_status IN ('pending', 'approved', 'rejected') THEN
        RAISE EXCEPTION 'This verification submission cannot be changed while it is %',
            v_submission_status;
    END IF;

    IF EXISTS (
        SELECT 1
          FROM unnest(p_document_paths) AS documents(document_path)
          LEFT JOIN storage.objects AS object
            ON object.bucket_id = 'shop-verification-private'
           AND object.name = documents.document_path
         WHERE object.id IS NULL
    ) THEN
        RAISE EXCEPTION 'Upload every verification document before submitting';
    END IF;

    INSERT INTO public.shop_verification_submissions (
        shop_id,
        legal_name,
        business_name,
        registration_number,
        business_type,
        document_paths,
        status,
        review_note,
        reviewed_by,
        submitted_at,
        reviewed_at,
        updated_at
    )
    VALUES (
        p_shop_id,
        trim(p_legal_name),
        trim(p_business_name),
        trim(coalesce(p_registration_number, '')),
        p_business_type,
        p_document_paths,
        'pending',
        NULL,
        NULL,
        now(),
        NULL,
        now()
    )
    ON CONFLICT (shop_id) DO UPDATE SET
        legal_name = EXCLUDED.legal_name,
        business_name = EXCLUDED.business_name,
        registration_number = EXCLUDED.registration_number,
        business_type = EXCLUDED.business_type,
        document_paths = EXCLUDED.document_paths,
        status = 'pending',
        review_note = NULL,
        reviewed_by = NULL,
        submitted_at = now(),
        reviewed_at = NULL,
        updated_at = now()
    RETURNING id INTO v_submission_id;

    RETURN v_submission_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_shop_verification_requests(
    p_status TEXT DEFAULT 'pending'
)
RETURNS TABLE (
    submission_id UUID,
    shop_id UUID,
    shop_name TEXT,
    shop_slug TEXT,
    country TEXT,
    city TEXT,
    owner_email TEXT,
    legal_name TEXT,
    business_name TEXT,
    registration_number TEXT,
    business_type TEXT,
    document_paths TEXT[],
    verification_status TEXT,
    review_note TEXT,
    submitted_at TIMESTAMPTZ,
    review_history JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF public.current_profile_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Access denied';
    END IF;
    IF coalesce(p_status, 'pending') NOT IN (
        'all', 'pending', 'approved', 'rejected', 'resubmission_required'
    ) THEN
        RAISE EXCEPTION 'Unsupported verification status';
    END IF;

    RETURN QUERY
    SELECT
        submission.id,
        shop.id,
        shop.name::TEXT,
        shop.slug::TEXT,
        shop.country::TEXT,
        shop.city::TEXT,
        coalesce(
            (SELECT profile.email FROM public.profiles AS profile WHERE profile.id = shop.owner_id LIMIT 1),
            (SELECT profile.email FROM public.profiles AS profile WHERE profile.user_id = shop.owner_id LIMIT 1),
            (SELECT profile.email FROM public.profiles AS profile WHERE profile.id = shop.current_owner_id LIMIT 1),
            (SELECT profile.email FROM public.profiles AS profile WHERE profile.user_id = shop.current_owner_id LIMIT 1)
        )::TEXT,
        submission.legal_name::TEXT,
        submission.business_name::TEXT,
        submission.registration_number::TEXT,
        submission.business_type::TEXT,
        submission.document_paths,
        submission.status::TEXT,
        submission.review_note::TEXT,
        submission.submitted_at,
        coalesce((
            SELECT jsonb_agg(
                jsonb_build_object(
                    'decision', review.decision,
                    'note', review.note,
                    'reviewer_email', reviewer.email,
                    'created_at', review.created_at,
                    'document_paths', review.document_paths
                )
                ORDER BY review.created_at DESC
            )
            FROM public.shop_verification_reviews AS review
            LEFT JOIN public.profiles AS reviewer ON reviewer.id = review.reviewer_id
            WHERE review.shop_id = shop.id
        ), '[]'::JSONB)
    FROM public.shop_verification_submissions AS submission
    JOIN public.shops AS shop ON shop.id = submission.shop_id
    WHERE coalesce(p_status, 'pending') = 'all'
       OR submission.status = coalesce(p_status, 'pending')
    ORDER BY submission.submitted_at ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_review_shop_verification(
    p_submission_id UUID,
    p_decision TEXT,
    p_note TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
    v_submission public.shop_verification_submissions%ROWTYPE;
    v_note TEXT := nullif(left(trim(coalesce(p_note, '')), 2000), '');
    v_reviewer_id UUID;
BEGIN
    IF public.current_profile_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Access denied';
    END IF;
    IF p_decision IS NULL OR p_decision NOT IN ('approve', 'request_resubmission', 'reject') THEN
        RAISE EXCEPTION 'Unsupported review decision';
    END IF;
    IF p_decision <> 'approve' AND length(coalesce(v_note, '')) < 3 THEN
        RAISE EXCEPTION 'Add a clear note when requesting changes or rejecting an application';
    END IF;

    SELECT submission.*
      INTO v_submission
      FROM public.shop_verification_submissions AS submission
     WHERE submission.id = p_submission_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Verification submission not found';
    END IF;
    IF v_submission.status <> 'pending' THEN
        RAISE EXCEPTION 'Only pending verification submissions can be reviewed';
    END IF;
    IF cardinality(v_submission.document_paths) NOT BETWEEN 1 AND 5
       OR EXISTS (
            SELECT 1
              FROM unnest(v_submission.document_paths) AS documents(document_path)
              LEFT JOIN storage.objects AS object
                ON object.bucket_id = 'shop-verification-private'
               AND object.name = documents.document_path
             WHERE object.id IS NULL
          ) THEN
        RAISE EXCEPTION 'The submitted verification documents are missing';
    END IF;

    v_reviewer_id := public.current_profile_id();
    IF v_reviewer_id IS NULL THEN
        RAISE EXCEPTION 'Administrator profile is unavailable';
    END IF;

    IF p_decision = 'approve' THEN
        UPDATE public.shop_verification_submissions
           SET status = 'approved',
               review_note = v_note,
               reviewed_by = v_reviewer_id,
               reviewed_at = now(),
               updated_at = now()
         WHERE id = v_submission.id;
        UPDATE public.shops
           SET status = 'active',
               verified = TRUE,
               updated_at = now()
         WHERE id = v_submission.shop_id;
    ELSIF p_decision = 'request_resubmission' THEN
        UPDATE public.shop_verification_submissions
           SET status = 'resubmission_required',
               review_note = v_note,
               reviewed_by = v_reviewer_id,
               reviewed_at = now(),
               updated_at = now()
         WHERE id = v_submission.id;
        UPDATE public.shops
           SET status = 'pending',
               verified = FALSE,
               updated_at = now()
         WHERE id = v_submission.shop_id;
    ELSE
        UPDATE public.shop_verification_submissions
           SET status = 'rejected',
               review_note = v_note,
               reviewed_by = v_reviewer_id,
               reviewed_at = now(),
               updated_at = now()
         WHERE id = v_submission.id;
        UPDATE public.shops
           SET status = 'rejected',
               verified = FALSE,
               updated_at = now()
         WHERE id = v_submission.shop_id;
    END IF;

    INSERT INTO public.shop_verification_reviews (
        submission_id,
        shop_id,
        reviewer_id,
        decision,
        note,
        document_paths
    )
    VALUES (
        v_submission.id,
        v_submission.shop_id,
        v_reviewer_id,
        CASE p_decision
            WHEN 'approve' THEN 'approved'
            WHEN 'request_resubmission' THEN 'resubmission_required'
            ELSE 'rejected'
        END,
        v_note,
        v_submission.document_paths
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_shop_verification_review_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    RAISE EXCEPTION 'Shop verification review history is append-only';
END;
$$;

DROP TRIGGER IF EXISTS prevent_shop_verification_review_mutation
    ON public.shop_verification_reviews;
CREATE TRIGGER prevent_shop_verification_review_mutation
BEFORE UPDATE OR DELETE ON public.shop_verification_reviews
FOR EACH ROW EXECUTE FUNCTION public.prevent_shop_verification_review_mutation();

REVOKE ALL ON FUNCTION public.shop_owner_submit_verification_documents(
    UUID, TEXT, TEXT, TEXT, TEXT, TEXT[]
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_shop_verification_requests(TEXT)
    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_review_shop_verification(UUID, TEXT, TEXT)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shop_owner_submit_verification_documents(
    UUID, TEXT, TEXT, TEXT, TEXT, TEXT[]
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_shop_verification_requests(TEXT)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_review_shop_verification(UUID, TEXT, TEXT)
    TO authenticated;

COMMIT;