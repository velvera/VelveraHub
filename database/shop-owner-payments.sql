-- Standalone velverahub.shop owner portal and regional payment data model.
-- Apply after schema.sql, seller.sql, admin.sql, supabase-rls.sql,
-- security-hardening.sql, cloudflare-dashboard.sql, and
-- production-hardening.sql.
-- All changes are additive; provider keys and bank details are never stored here.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS payment_provider TEXT,
    ADD COLUMN IF NOT EXISTS payment_currency TEXT,
    ADD COLUMN IF NOT EXISTS provider_payment_id TEXT,
    ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.regional_payment_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
    provider TEXT NOT NULL CHECK (provider IN ('paystack', 'stripe')),
    region TEXT NOT NULL CHECK (region IN ('ng', 'uk')),
    currency TEXT NOT NULL CHECK (currency IN ('NGN', 'GBP')),
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
    idempotency_key TEXT NOT NULL UNIQUE,
    provider_reference TEXT,
    provider_payment_id TEXT,
    checkout_url TEXT,
    status TEXT NOT NULL DEFAULT 'created'
        CHECK (status IN ('created', 'pending', 'succeeded', 'failed', 'cancelled', 'refunded', 'partially_refunded')),
    failure_code TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT regional_payment_market_provider_check CHECK (
        (region = 'ng' AND provider = 'paystack' AND currency = 'NGN')
        OR
        (region = 'uk' AND provider = 'stripe' AND currency = 'GBP')
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_regional_payment_provider_reference
    ON public.regional_payment_attempts (provider, provider_reference)
    WHERE provider_reference IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_regional_payment_provider_payment_id
    ON public.regional_payment_attempts (provider, provider_payment_id)
    WHERE provider_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_regional_payment_order_created
    ON public.regional_payment_attempts (order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.payment_provider_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL CHECK (provider IN ('paystack', 'stripe')),
    provider_event_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payment_attempt_id UUID REFERENCES public.regional_payment_attempts(id) ON DELETE SET NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ,
    processing_error TEXT,
    payload_digest TEXT NOT NULL,
    UNIQUE (provider, provider_event_id)
);

CREATE TABLE IF NOT EXISTS public.regional_payment_refunds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_attempt_id UUID NOT NULL REFERENCES public.regional_payment_attempts(id) ON DELETE RESTRICT,
    provider_refund_id TEXT,
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
    currency TEXT NOT NULL CHECK (currency IN ('NGN', 'GBP')),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'succeeded', 'failed', 'cancelled')),
    idempotency_key TEXT NOT NULL UNIQUE,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.shop_verification_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL UNIQUE REFERENCES public.shops(id) ON DELETE CASCADE,
    legal_name TEXT NOT NULL,
    business_name TEXT NOT NULL,
    registration_number TEXT NOT NULL,
    business_type TEXT NOT NULL CHECK (business_type IN ('individual', 'registered', 'partnership')),
    document_paths TEXT[] NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'resubmission_required')),
    review_note TEXT,
    reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.shop_payout_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL UNIQUE REFERENCES public.shops(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('paystack', 'stripe')),
    provider_account_id TEXT,
    country TEXT NOT NULL CHECK (country IN ('Nigeria', 'United Kingdom')),
    settlement_currency TEXT NOT NULL CHECK (settlement_currency IN ('NGN', 'GBP')),
    status TEXT NOT NULL DEFAULT 'not_connected'
        CHECK (status IN ('not_connected', 'pending', 'active', 'restricted', 'rejected')),
    onboarding_completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT shop_payout_market_provider_check CHECK (
        (country = 'Nigeria' AND provider = 'paystack' AND settlement_currency = 'NGN')
        OR
        (country = 'United Kingdom' AND provider = 'stripe' AND settlement_currency = 'GBP')
    )
);

CREATE TABLE IF NOT EXISTS public.shop_earnings_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
    provider_reference TEXT,
    entry_type TEXT NOT NULL CHECK (entry_type IN ('sale', 'refund', 'adjustment', 'withdrawal')),
    amount NUMERIC(14,2) NOT NULL,
    currency TEXT NOT NULL CHECK (currency IN ('NGN', 'GBP')),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'available', 'reversed')),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.shop_withdrawal_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    currency TEXT NOT NULL CHECK (currency IN ('NGN', 'GBP')),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'paid', 'failed', 'cancelled')),
    provider_reference TEXT,
    reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    review_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shop_earnings_shop_created
    ON public.shop_earnings_ledger (shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shop_earnings_order
    ON public.shop_earnings_ledger (order_id);
CREATE INDEX IF NOT EXISTS idx_shop_withdrawals_shop_created
    ON public.shop_withdrawal_requests (shop_id, created_at DESC);

ALTER TABLE public.regional_payment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_provider_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.regional_payment_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.regional_payment_attempts,
    public.payment_provider_events,
    public.regional_payment_refunds FROM anon, authenticated;
GRANT ALL ON public.regional_payment_attempts,
    public.payment_provider_events,
    public.regional_payment_refunds TO service_role;

CREATE OR REPLACE FUNCTION public.shop_portal_owns_shop(p_shop_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.shops AS shop
        JOIN public.profiles AS profile
          ON profile.id = shop.owner_id OR profile.id = shop.current_owner_id
        WHERE shop.id = p_shop_id
          AND (profile.id = auth.uid() OR profile.user_id = auth.uid())
    );
$$;

REVOKE ALL ON FUNCTION public.shop_portal_owns_shop(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shop_portal_owns_shop(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.shop_portal_owns_storage_path(p_path TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF split_part(coalesce(p_path, ''), '/', 1) !~
       '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
        RETURN FALSE;
    END IF;
    RETURN public.shop_portal_owns_shop(split_part(p_path, '/', 1)::UUID);
END;
$$;

REVOKE ALL ON FUNCTION public.shop_portal_owns_storage_path(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shop_portal_owns_storage_path(TEXT) TO authenticated;

ALTER TABLE public.shop_verification_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_payout_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_earnings_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_withdrawal_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shop_owner_read_verification ON public.shop_verification_submissions;
CREATE POLICY shop_owner_read_verification
ON public.shop_verification_submissions FOR SELECT TO authenticated
USING (public.shop_portal_owns_shop(shop_id) OR public.current_profile_role() = 'admin');

DROP POLICY IF EXISTS shop_owner_read_payout_account ON public.shop_payout_accounts;
CREATE POLICY shop_owner_read_payout_account
ON public.shop_payout_accounts FOR SELECT TO authenticated
USING (public.shop_portal_owns_shop(shop_id) OR public.current_profile_role() = 'admin');

DROP POLICY IF EXISTS shop_owner_read_earnings ON public.shop_earnings_ledger;
CREATE POLICY shop_owner_read_earnings
ON public.shop_earnings_ledger FOR SELECT TO authenticated
USING (public.shop_portal_owns_shop(shop_id) OR public.current_profile_role() = 'admin');

DROP POLICY IF EXISTS shop_owner_read_withdrawals ON public.shop_withdrawal_requests;
CREATE POLICY shop_owner_read_withdrawals
ON public.shop_withdrawal_requests FOR SELECT TO authenticated
USING (public.shop_portal_owns_shop(shop_id) OR public.current_profile_role() = 'admin');

GRANT SELECT ON public.shop_verification_submissions,
    public.shop_payout_accounts,
    public.shop_earnings_ledger,
    public.shop_withdrawal_requests TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.shop_verification_submissions,
    public.shop_payout_accounts,
    public.shop_earnings_ledger,
    public.shop_withdrawal_requests FROM anon, authenticated;
GRANT ALL ON public.shop_verification_submissions,
    public.shop_payout_accounts,
    public.shop_earnings_ledger,
    public.shop_withdrawal_requests TO service_role;

-- Orders are created only through the SECURITY DEFINER checkout RPC. Keep
-- browser roles read-only; the policies below expose only owned shop data.
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.orders, public.order_items
    FROM PUBLIC, anon, authenticated;
REVOKE SELECT ON public.orders, public.order_items FROM anon;
GRANT SELECT ON public.orders, public.order_items TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'shop-verification-private',
    'shop-verification-private',
    FALSE,
    5242880,
    ARRAY['application/pdf', 'image/jpeg', 'image/png']::text[]
)
ON CONFLICT (id) DO UPDATE SET
    public = FALSE,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png']::text[];

DROP POLICY IF EXISTS shop_owner_upload_verification_document ON storage.objects;
CREATE POLICY shop_owner_upload_verification_document
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'shop-verification-private'
    AND public.shop_portal_owns_storage_path(name)
);

DROP POLICY IF EXISTS shop_owner_read_verification_document ON storage.objects;
CREATE POLICY shop_owner_read_verification_document
ON storage.objects FOR SELECT TO authenticated
USING (
    bucket_id = 'shop-verification-private'
    AND (
        public.shop_portal_owns_storage_path(name)
        OR public.current_profile_role() = 'admin'
    )
);

DROP POLICY IF EXISTS shop_owner_read_order_items ON public.order_items;
CREATE POLICY shop_owner_read_order_items
ON public.order_items FOR SELECT TO authenticated
USING (shop_id IS NOT NULL AND public.shop_portal_owns_shop(shop_id));

DROP POLICY IF EXISTS shop_owner_read_orders ON public.orders;
CREATE POLICY shop_owner_read_orders
ON public.orders FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.order_items AS item
        WHERE item.order_id = orders.id
          AND item.shop_id IS NOT NULL
          AND public.shop_portal_owns_shop(item.shop_id)
    )
);

-- The existing seller policies allow owners to edit their own product rows.
-- This restrictive check prevents a pending shop from being published by a
-- direct API call, while leaving independent shop-less seller listings alone.
DROP POLICY IF EXISTS shop_approval_required_to_publish ON public.products;
CREATE POLICY shop_approval_required_to_publish
ON public.products AS RESTRICTIVE FOR ALL TO authenticated
USING (TRUE)
WITH CHECK (
    shop_id IS NULL
    OR status <> 'active'
    OR EXISTS (
        SELECT 1
        FROM public.shops AS shop
        WHERE shop.id = products.shop_id
          AND shop.status = 'active'
          AND (
              shop.owner_id = auth.uid()
              OR shop.current_owner_id = auth.uid()
              OR EXISTS (
                  SELECT 1 FROM public.profiles AS profile
                  WHERE profile.user_id = auth.uid()
                    AND (profile.id = shop.owner_id OR profile.id = shop.current_owner_id)
              )
          )
    )
);

CREATE OR REPLACE FUNCTION public.shop_owner_create_shop(
    p_name TEXT,
    p_slug TEXT,
    p_country TEXT,
    p_city TEXT,
    p_email TEXT,
    p_description TEXT DEFAULT ''
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_profile_id UUID;
    v_role TEXT;
    v_shop_id UUID;
    v_slug TEXT := lower(trim(coalesce(p_slug, '')));
    v_country TEXT := trim(coalesce(p_country, ''));
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in before creating a shop'; END IF;
    SELECT profile.id, profile.role INTO v_profile_id, v_role
    FROM public.profiles AS profile
    WHERE profile.user_id = auth.uid() OR profile.id = auth.uid()
    ORDER BY (profile.user_id = auth.uid()) DESC
    LIMIT 1
    FOR UPDATE;
    IF v_profile_id IS NULL OR v_role NOT IN ('seller', 'admin') THEN
        RAISE EXCEPTION 'A seller account is required to create a shop';
    END IF;
    IF length(trim(coalesce(p_name, ''))) < 2 OR length(trim(coalesce(p_city, ''))) < 2 THEN
        RAISE EXCEPTION 'Shop name and city are required';
    END IF;
    IF v_country NOT IN ('Nigeria', 'United Kingdom') THEN
        RAISE EXCEPTION 'Select Nigeria or United Kingdom';
    END IF;
    IF lower(trim(coalesce(p_email, ''))) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
        RAISE EXCEPTION 'Enter a valid shop contact email';
    END IF;
    IF v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR length(v_slug) > 70 THEN
        RAISE EXCEPTION 'Shop name cannot be used as a valid web address';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.shops
        WHERE owner_id = v_profile_id OR current_owner_id = v_profile_id
    ) THEN
        RAISE EXCEPTION 'This account already owns a shop';
    END IF;

    INSERT INTO public.shops (
        owner_id, current_owner_id, name, slug, country, city,
        service_location, email, description, status, verified
    )
    VALUES (
        v_profile_id, v_profile_id, trim(p_name), v_slug, v_country, trim(p_city),
        trim(p_city), lower(trim(p_email)), trim(coalesce(p_description, '')),
        'pending', FALSE
    )
    RETURNING id INTO v_shop_id;

    INSERT INTO public.shop_payout_accounts (
        shop_id, provider, country, settlement_currency, status
    )
    VALUES (
        v_shop_id,
        CASE WHEN v_country = 'Nigeria' THEN 'paystack' ELSE 'stripe' END,
        v_country,
        CASE WHEN v_country = 'Nigeria' THEN 'NGN' ELSE 'GBP' END,
        'not_connected'
    );

    RETURN v_shop_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.shop_owner_submit_verification(
    p_shop_id UUID,
    p_legal_name TEXT,
    p_business_name TEXT,
    p_registration_number TEXT,
    p_business_type TEXT,
    p_document_path TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status TEXT;
    v_submission_id UUID;
BEGIN
    IF NOT public.shop_portal_owns_shop(p_shop_id) THEN
        RAISE EXCEPTION 'You do not own this shop';
    END IF;
    IF length(trim(coalesce(p_legal_name, ''))) < 2
       OR length(trim(coalesce(p_business_name, ''))) < 2
       OR length(trim(coalesce(p_registration_number, ''))) < 2
       OR p_business_type NOT IN ('individual', 'registered', 'partnership')
       OR split_part(coalesce(p_document_path, ''), '/', 1) <> p_shop_id::TEXT THEN
        RAISE EXCEPTION 'Verification details or private document path are invalid';
    END IF;

    SELECT status INTO v_status
    FROM public.shop_verification_submissions
    WHERE shop_id = p_shop_id
    FOR UPDATE;
    IF v_status IN ('pending', 'approved') THEN
        RAISE EXCEPTION 'This verification submission cannot be changed while it is %', v_status;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM storage.objects
        WHERE bucket_id = 'shop-verification-private'
          AND name = p_document_path
    ) THEN
        RAISE EXCEPTION 'Upload the verification document before submitting';
    END IF;

    INSERT INTO public.shop_verification_submissions (
        shop_id, legal_name, business_name, registration_number,
        business_type, document_paths, status, review_note,
        submitted_at, updated_at
    )
    VALUES (
        p_shop_id, trim(p_legal_name), trim(p_business_name),
        trim(p_registration_number), p_business_type,
        ARRAY[p_document_path], 'pending', NULL, now(), now()
    )
    ON CONFLICT (shop_id) DO UPDATE SET
        legal_name = EXCLUDED.legal_name,
        business_name = EXCLUDED.business_name,
        registration_number = EXCLUDED.registration_number,
        business_type = EXCLUDED.business_type,
        document_paths = EXCLUDED.document_paths,
        status = 'pending',
        review_note = NULL,
        submitted_at = now(),
        updated_at = now()
    RETURNING id INTO v_submission_id;
    RETURN v_submission_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.shop_owner_request_withdrawal(
    p_shop_id UUID,
    p_amount NUMERIC
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_currency TEXT;
    v_available NUMERIC(14,2);
    v_reserved NUMERIC(14,2);
    v_request_id UUID;
BEGIN
    IF NOT public.shop_portal_owns_shop(p_shop_id) THEN
        RAISE EXCEPTION 'You do not own this shop';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 OR round(p_amount, 2) <> p_amount THEN
        RAISE EXCEPTION 'Enter a positive amount with no more than two decimal places';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(p_shop_id::TEXT, 0));
    SELECT settlement_currency INTO v_currency
    FROM public.shop_payout_accounts
    WHERE shop_id = p_shop_id;
    IF v_currency IS NULL THEN RAISE EXCEPTION 'Payout account is not configured'; END IF;

    SELECT coalesce(sum(amount), 0) INTO v_available
    FROM public.shop_earnings_ledger
    WHERE shop_id = p_shop_id AND currency = v_currency AND status = 'available';
    SELECT coalesce(sum(amount), 0) INTO v_reserved
    FROM public.shop_withdrawal_requests
    WHERE shop_id = p_shop_id
      AND currency = v_currency
      AND status IN ('pending', 'processing', 'paid');
    IF p_amount > v_available - v_reserved THEN
        RAISE EXCEPTION 'Withdrawal amount exceeds the available balance';
    END IF;

    INSERT INTO public.shop_withdrawal_requests (shop_id, amount, currency, status)
    VALUES (p_shop_id, p_amount, v_currency, 'pending')
    RETURNING id INTO v_request_id;
    RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.shop_owner_create_shop(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
-- This older one-document RPC is retained for database compatibility but is
-- no longer callable by browser roles. The multi-document RPC in
-- shop-verification-compliance.sql is the only public submission path.
REVOKE ALL ON FUNCTION public.shop_owner_submit_verification(UUID, TEXT, TEXT, TEXT, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.shop_owner_request_withdrawal(UUID, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shop_owner_create_shop(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shop_owner_request_withdrawal(UUID, NUMERIC) TO authenticated;