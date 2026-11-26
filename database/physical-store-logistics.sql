-- Physical store discovery and location-based delivery operations.
--
-- Apply after database/phone-verification.sql (migration 19). This migration
-- is additive: exact shop locations, provider verification, delivery requests,
-- and workforce engagements are stored separately from existing shop,
-- address, and order records.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.shop_physical_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL UNIQUE REFERENCES public.shops(id) ON DELETE CASCADE,
    address TEXT NOT NULL CHECK (char_length(btrim(address)) BETWEEN 5 AND 240),
    city TEXT NOT NULL CHECK (char_length(btrim(city)) BETWEEN 2 AND 120),
    state_or_region TEXT NOT NULL CHECK (char_length(btrim(state_or_region)) BETWEEN 2 AND 120),
    postcode TEXT NOT NULL DEFAULT '' CHECK (char_length(postcode) <= 24),
    country_code TEXT NOT NULL CHECK (country_code IN ('NG', 'GB')),
    latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    review_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (review_status IN ('pending', 'approved', 'rejected')),
    review_note TEXT,
    submitted_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shop_physical_locations_public_idx
    ON public.shop_physical_locations(country_code, review_status, city);
CREATE INDEX IF NOT EXISTS shop_physical_locations_coordinates_idx
    ON public.shop_physical_locations(country_code, latitude, longitude);

CREATE TABLE IF NOT EXISTS public.delivery_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    provider_type TEXT NOT NULL
        CHECK (provider_type IN ('logistics_company', 'independent_rider')),
    display_name TEXT NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 2 AND 120),
    description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 1200),
    country_code TEXT NOT NULL CHECK (country_code IN ('NG', 'GB')),
    vehicle_type TEXT NOT NULL DEFAULT 'motorcycle'
        CHECK (vehicle_type IN ('motorcycle', 'car', 'van', 'fleet', 'other')),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    is_available BOOLEAN NOT NULL DEFAULT FALSE,
    available_until TIMESTAMPTZ,
    availability_updated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, provider_type)
);

CREATE INDEX IF NOT EXISTS delivery_providers_match_idx
    ON public.delivery_providers(country_code, status, is_verified, is_available, available_until);
CREATE INDEX IF NOT EXISTS delivery_providers_user_idx
    ON public.delivery_providers(user_id, status);

CREATE TABLE IF NOT EXISTS public.delivery_provider_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES public.delivery_providers(id) ON DELETE CASCADE,
    legal_name TEXT NOT NULL CHECK (char_length(btrim(legal_name)) BETWEEN 2 AND 160),
    registered_business_name TEXT NOT NULL DEFAULT ''
        CHECK (char_length(registered_business_name) <= 160),
    registration_number TEXT NOT NULL DEFAULT ''
        CHECK (char_length(registration_number) <= 120),
    identity_document_type TEXT NOT NULL DEFAULT ''
        CHECK (identity_document_type IN ('', 'passport', 'national_id', 'drivers_license', 'voters_card')),
    document_paths TEXT[] NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'resubmission_required')),
    review_note TEXT,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider_id)
);

CREATE TABLE IF NOT EXISTS public.delivery_provider_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES public.delivery_providers(id) ON DELETE RESTRICT,
    verification_id UUID REFERENCES public.delivery_provider_verifications(id) ON DELETE RESTRICT,
    reviewer_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    decision TEXT NOT NULL
        CHECK (decision IN ('approved', 'rejected', 'resubmission_required', 'suspended', 'restored')),
    note TEXT,
    document_paths TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS delivery_provider_reviews_provider_idx
    ON public.delivery_provider_reviews(provider_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.delivery_provider_service_areas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES public.delivery_providers(id) ON DELETE CASCADE,
    country_code TEXT NOT NULL CHECK (country_code IN ('NG', 'GB')),
    state_or_region TEXT NOT NULL CHECK (char_length(btrim(state_or_region)) BETWEEN 2 AND 120),
    city TEXT NOT NULL CHECK (char_length(btrim(city)) BETWEEN 2 AND 120),
    latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    coverage_radius_km NUMERIC(6,2) NOT NULL
        CHECK (coverage_radius_km BETWEEN 1 AND 200),
    service_types TEXT[] NOT NULL DEFAULT ARRAY['standard']::TEXT[]
        CHECK (
            cardinality(service_types) BETWEEN 1 AND 5
            AND service_types <@ ARRAY['standard', 'same_day', 'next_day', 'express', 'scheduled']::TEXT[]
        ),
    base_fee NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (base_fee BETWEEN 0 AND 10000000),
    per_km_fee NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (per_km_fee BETWEEN 0 AND 1000000),
    currency_code TEXT NOT NULL CHECK (currency_code IN ('NGN', 'GBP')),
    eta_min_minutes INTEGER NOT NULL DEFAULT 60 CHECK (eta_min_minutes BETWEEN 5 AND 10080),
    eta_max_minutes INTEGER NOT NULL DEFAULT 180 CHECK (eta_max_minutes BETWEEN 5 AND 10080),
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (eta_max_minutes >= eta_min_minutes),
    CHECK ((country_code = 'NG' AND currency_code = 'NGN') OR
           (country_code = 'GB' AND currency_code = 'GBP'))
);
CREATE INDEX IF NOT EXISTS delivery_service_areas_lookup_idx
    ON public.delivery_provider_service_areas(country_code, is_active, latitude, longitude);
CREATE INDEX IF NOT EXISTS delivery_service_areas_provider_idx
    ON public.delivery_provider_service_areas(provider_id, is_active);

CREATE TABLE IF NOT EXISTS public.delivery_platform_settings (
    country_code TEXT PRIMARY KEY CHECK (country_code IN ('NG', 'GB')),
    currency_code TEXT NOT NULL CHECK (currency_code IN ('NGN', 'GBP')),
    currency_per_usd NUMERIC(12,4) NOT NULL CHECK (currency_per_usd > 0),
    platform_commission_percent NUMERIC(5,2) NOT NULL DEFAULT 0
        CHECK (platform_commission_percent BETWEEN 0 AND 30),
    fixed_delivery_fee NUMERIC(12,2) NOT NULL DEFAULT 0
        CHECK (fixed_delivery_fee BETWEEN 0 AND 1000000),
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((country_code = 'NG' AND currency_code = 'NGN') OR
           (country_code = 'GB' AND currency_code = 'GBP'))
);
INSERT INTO public.delivery_platform_settings(country_code, currency_code, currency_per_usd)
VALUES ('NG', 'NGN', 900), ('GB', 'GBP', 0.79)
ON CONFLICT (country_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.delivery_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    provider_id UUID NOT NULL REFERENCES public.delivery_providers(id) ON DELETE RESTRICT,
    service_area_id UUID NOT NULL REFERENCES public.delivery_provider_service_areas(id) ON DELETE RESTRICT,
    buyer_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    destination_latitude DOUBLE PRECISION NOT NULL CHECK (destination_latitude BETWEEN -90 AND 90),
    destination_longitude DOUBLE PRECISION NOT NULL CHECK (destination_longitude BETWEEN -180 AND 180),
    distance_km NUMERIC(8,2) NOT NULL CHECK (distance_km >= 0),
    provider_fee_amount NUMERIC(12,2) NOT NULL CHECK (provider_fee_amount >= 0),
    platform_fee_amount NUMERIC(12,2) NOT NULL CHECK (platform_fee_amount >= 0),
    total_fee_amount NUMERIC(12,2) NOT NULL CHECK (total_fee_amount >= 0),
    currency_code TEXT NOT NULL CHECK (currency_code IN ('NGN', 'GBP')),
    currency_per_usd NUMERIC(12,4) NOT NULL CHECK (currency_per_usd > 0),
    commission_percent NUMERIC(5,2) NOT NULL CHECK (commission_percent BETWEEN 0 AND 30),
    eta_min_minutes INTEGER NOT NULL CHECK (eta_min_minutes BETWEEN 5 AND 10080),
    eta_max_minutes INTEGER NOT NULL CHECK (eta_max_minutes BETWEEN eta_min_minutes AND 10080),
    status TEXT NOT NULL DEFAULT 'requested'
        CHECK (status IN ('requested', 'accepted', 'rejected', 'cancelled', 'picked_up', 'in_transit', 'delivered', 'issue_reported')),
    tracking_token_hash BYTEA,
    tracking_token_expires_at TIMESTAMPTZ,
    response_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS delivery_requests_provider_status_idx
    ON public.delivery_requests(provider_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS delivery_requests_order_idx
    ON public.delivery_requests(order_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS delivery_requests_one_live_per_order_idx
    ON public.delivery_requests(order_id)
    WHERE status IN ('requested', 'accepted', 'picked_up', 'in_transit', 'issue_reported');

CREATE TABLE IF NOT EXISTS public.delivery_request_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES public.delivery_requests(id) ON DELETE CASCADE,
    actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    status TEXT NOT NULL
        CHECK (status IN ('requested', 'accepted', 'rejected', 'cancelled', 'picked_up', 'in_transit', 'delivered', 'issue_reported')),
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS delivery_request_events_timeline_idx
    ON public.delivery_request_events(request_id, created_at);

-- Workforce engagements are deliberately separate from order delivery:
-- this table has no order_id and cannot be used as a delivery-request record.
CREATE TABLE IF NOT EXISTS public.delivery_rider_engagements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    provider_id UUID NOT NULL REFERENCES public.delivery_providers(id) ON DELETE RESTRICT,
    created_by_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    engagement_type TEXT NOT NULL CHECK (engagement_type IN ('temporary', 'permanent')),
    status TEXT NOT NULL DEFAULT 'invited'
        CHECK (status IN ('invited', 'accepted', 'rejected', 'cancelled', 'ended')),
    terms JSONB NOT NULL DEFAULT '{}'::JSONB
        CHECK (jsonb_typeof(terms) = 'object' AND pg_column_size(terms) <= 12000),
    start_date DATE NOT NULL,
    end_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (engagement_type = 'temporary' AND end_date IS NOT NULL AND end_date >= start_date)
        OR (engagement_type = 'permanent' AND end_date IS NULL)
    )
);
CREATE INDEX IF NOT EXISTS delivery_engagements_shop_idx
    ON public.delivery_rider_engagements(shop_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS delivery_engagements_provider_idx
    ON public.delivery_rider_engagements(provider_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.delivery_provider_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES public.delivery_providers(id) ON DELETE RESTRICT,
    request_id UUID REFERENCES public.delivery_requests(id) ON DELETE SET NULL,
    reporter_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    reason TEXT NOT NULL CHECK (reason IN ('safety', 'late_delivery', 'misconduct', 'fraud', 'other')),
    details TEXT NOT NULL CHECK (char_length(btrim(details)) BETWEEN 10 AND 2000),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
    admin_note TEXT,
    reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS delivery_provider_reports_queue_idx
    ON public.delivery_provider_reports(status, created_at);

CREATE TABLE IF NOT EXISTS public.delivery_provider_report_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES public.delivery_provider_reports(id) ON DELETE RESTRICT,
    reviewer_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (status IN ('reviewing', 'resolved', 'dismissed')),
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS delivery_provider_report_reviews_report_idx
    ON public.delivery_provider_report_reviews(report_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.shop_physical_location_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id UUID NOT NULL REFERENCES public.shop_physical_locations(id) ON DELETE RESTRICT,
    reviewer_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shop_physical_location_reviews_location_idx
    ON public.shop_physical_location_reviews(location_id, created_at DESC);

-- All protected data is RPC-only for browser roles. In particular, adding
-- location columns to shops would expose unapproved coordinates through the
-- existing public "active shop" policy, so these tables remain separate.
DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'shop_physical_locations',
        'shop_physical_location_reviews',
        'delivery_providers',
        'delivery_provider_verifications',
        'delivery_provider_reviews',
        'delivery_provider_service_areas',
        'delivery_platform_settings',
        'delivery_requests',
        'delivery_request_events',
        'delivery_rider_engagements',
        'delivery_provider_reports',
        'delivery_provider_report_reviews'
    ] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', table_name);
        EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', table_name);
    END LOOP;
END;
$$;

DROP TRIGGER IF EXISTS update_shop_physical_locations_updated_at
    ON public.shop_physical_locations;
CREATE TRIGGER update_shop_physical_locations_updated_at
BEFORE UPDATE ON public.shop_physical_locations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_delivery_providers_updated_at
    ON public.delivery_providers;
CREATE TRIGGER update_delivery_providers_updated_at
BEFORE UPDATE ON public.delivery_providers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_delivery_provider_verifications_updated_at
    ON public.delivery_provider_verifications;
CREATE TRIGGER update_delivery_provider_verifications_updated_at
BEFORE UPDATE ON public.delivery_provider_verifications
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_delivery_service_areas_updated_at
    ON public.delivery_provider_service_areas;
CREATE TRIGGER update_delivery_service_areas_updated_at
BEFORE UPDATE ON public.delivery_provider_service_areas
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_delivery_requests_updated_at
    ON public.delivery_requests;
CREATE TRIGGER update_delivery_requests_updated_at
BEFORE UPDATE ON public.delivery_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_delivery_engagements_updated_at
    ON public.delivery_rider_engagements;
CREATE TRIGGER update_delivery_engagements_updated_at
BEFORE UPDATE ON public.delivery_rider_engagements
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_delivery_provider_reports_updated_at
    ON public.delivery_provider_reports;
CREATE TRIGGER update_delivery_provider_reports_updated_at
BEFORE UPDATE ON public.delivery_provider_reports
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.delivery_provider_owns_storage_path(p_path TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_provider_id UUID;
BEGIN
    IF split_part(coalesce(p_path, ''), '/', 1) !~
       '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
        RETURN FALSE;
    END IF;
    v_provider_id := split_part(p_path, '/', 1)::UUID;
    RETURN EXISTS (
        SELECT 1
        FROM public.delivery_providers provider
        WHERE provider.id = v_provider_id
          AND provider.user_id = auth.uid()
    );
END;
$$;
REVOKE ALL ON FUNCTION public.delivery_provider_owns_storage_path(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delivery_provider_owns_storage_path(TEXT) TO authenticated;

INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'delivery-provider-verification-private',
    'delivery-provider-verification-private',
    FALSE,
    5242880,
    ARRAY['application/pdf', 'image/jpeg', 'image/png']::TEXT[]
)
ON CONFLICT (id) DO UPDATE SET
    public = FALSE,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS delivery_provider_upload_verification ON storage.objects;
CREATE POLICY delivery_provider_upload_verification
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'delivery-provider-verification-private'
    AND public.delivery_provider_owns_storage_path(name)
);

DROP POLICY IF EXISTS delivery_provider_read_verification ON storage.objects;
CREATE POLICY delivery_provider_read_verification
ON storage.objects FOR SELECT TO authenticated
USING (
    bucket_id = 'delivery-provider-verification-private'
    AND (
        public.delivery_provider_owns_storage_path(name)
        OR public.current_profile_role() = 'admin'
    )
);

DROP POLICY IF EXISTS delivery_provider_delete_verification ON storage.objects;
CREATE POLICY delivery_provider_delete_verification
ON storage.objects FOR DELETE TO authenticated
USING (
    bucket_id = 'delivery-provider-verification-private'
    AND (
        public.delivery_provider_owns_storage_path(name)
        OR public.current_profile_role() = 'admin'
    )
);

CREATE OR REPLACE FUNCTION public.delivery_distance_km(
    p_latitude_a DOUBLE PRECISION,
    p_longitude_a DOUBLE PRECISION,
    p_latitude_b DOUBLE PRECISION,
    p_longitude_b DOUBLE PRECISION
)
RETURNS DOUBLE PRECISION
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT 6371.0 * acos(least(1.0, greatest(-1.0,
        sin(radians(p_latitude_a)) * sin(radians(p_latitude_b))
        + cos(radians(p_latitude_a)) * cos(radians(p_latitude_b))
        * cos(radians(p_longitude_b - p_longitude_a))
    )));
$$;
REVOKE ALL ON FUNCTION public.delivery_distance_km(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION)
    FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.shop_owner_save_physical_location(
    p_shop_id UUID,
    p_address TEXT,
    p_city TEXT,
    p_state_or_region TEXT,
    p_postcode TEXT,
    p_country_code TEXT,
    p_latitude DOUBLE PRECISION,
    p_longitude DOUBLE PRECISION
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_shop_country TEXT;
    v_location_id UUID;
BEGIN
    IF auth.uid() IS NULL OR NOT public.shop_portal_owns_shop(p_shop_id) THEN
        RAISE EXCEPTION 'You do not own this shop' USING ERRCODE = '42501';
    END IF;
    IF p_country_code NOT IN ('NG', 'GB')
       OR p_latitude IS NULL OR p_latitude NOT BETWEEN -90 AND 90
       OR p_longitude IS NULL OR p_longitude NOT BETWEEN -180 AND 180
       OR length(btrim(coalesce(p_address, ''))) NOT BETWEEN 5 AND 240
       OR length(btrim(coalesce(p_city, ''))) NOT BETWEEN 2 AND 120
       OR length(btrim(coalesce(p_state_or_region, ''))) NOT BETWEEN 2 AND 120
       OR length(coalesce(p_postcode, '')) > 24 THEN
        RAISE EXCEPTION 'Enter a valid address and place its pin on the map' USING ERRCODE = '22023';
    END IF;

    SELECT upper(shop.country) INTO v_shop_country
    FROM public.shops AS shop
    WHERE shop.id = p_shop_id;
    IF (v_shop_country IN ('NG', 'NIGERIA') AND p_country_code <> 'NG')
       OR (v_shop_country IN ('GB', 'UK', 'UNITED KINGDOM') AND p_country_code <> 'GB') THEN
        RAISE EXCEPTION 'The physical location country must match the shop market' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.shop_physical_locations(
        shop_id, address, city, state_or_region, postcode, country_code,
        latitude, longitude, review_status, review_note, submitted_by,
        reviewed_by, reviewed_at
    )
    VALUES (
        p_shop_id, btrim(p_address), btrim(p_city), btrim(p_state_or_region),
        btrim(coalesce(p_postcode, '')), p_country_code, p_latitude, p_longitude,
        'pending', NULL, auth.uid(), NULL, NULL
    )
    ON CONFLICT (shop_id) DO UPDATE SET
        address = EXCLUDED.address,
        city = EXCLUDED.city,
        state_or_region = EXCLUDED.state_or_region,
        postcode = EXCLUDED.postcode,
        country_code = EXCLUDED.country_code,
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        review_status = 'pending',
        review_note = NULL,
        submitted_by = auth.uid(),
        reviewed_by = NULL,
        reviewed_at = NULL
    RETURNING id INTO v_location_id;

    RETURN jsonb_build_object('id', v_location_id, 'review_status', 'pending');
END;
$$;
REVOKE ALL ON FUNCTION public.shop_owner_save_physical_location(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shop_owner_save_physical_location(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION)
    TO authenticated;

CREATE OR REPLACE FUNCTION public.shop_owner_get_physical_location(p_shop_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT public.shop_portal_owns_shop(p_shop_id) THEN
        RAISE EXCEPTION 'You do not own this shop' USING ERRCODE = '42501';
    END IF;
    RETURN (
        SELECT jsonb_build_object(
            'id', location.id,
            'shop_id', location.shop_id,
            'address', location.address,
            'city', location.city,
            'state_or_region', location.state_or_region,
            'postcode', location.postcode,
            'country_code', location.country_code,
            'latitude', location.latitude,
            'longitude', location.longitude,
            'review_status', location.review_status,
            'review_note', location.review_note,
            'updated_at', location.updated_at
        )
        FROM public.shop_physical_locations AS location
        WHERE location.shop_id = p_shop_id
    );
END;
$$;
REVOKE ALL ON FUNCTION public.shop_owner_get_physical_location(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shop_owner_get_physical_location(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_public_shop_physical_location(p_shop_id UUID)
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT jsonb_build_object(
        'shop_id', shop.id,
        'shop_name', shop.name,
        'shop_slug', shop.slug,
        'address', location.address,
        'city', location.city,
        'state_or_region', location.state_or_region,
        'postcode', location.postcode,
        'country_code', location.country_code,
        'latitude', location.latitude,
        'longitude', location.longitude
    )
    FROM public.shop_physical_locations AS location
    JOIN public.shops AS shop ON shop.id = location.shop_id
    WHERE location.shop_id = p_shop_id
      AND location.review_status = 'approved'
      AND shop.status = 'active'
      AND shop.verified IS TRUE;
$$;
REVOKE ALL ON FUNCTION public.get_public_shop_physical_location(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_shop_physical_location(UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.search_public_shop_physical_locations(
    p_country_code TEXT,
    p_query TEXT DEFAULT '',
    p_latitude DOUBLE PRECISION DEFAULT NULL,
    p_longitude DOUBLE PRECISION DEFAULT NULL,
    p_radius_km NUMERIC DEFAULT 25,
    p_limit INTEGER DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_query TEXT := left(btrim(coalesce(p_query, '')), 120);
    v_rows JSONB;
BEGIN
    IF p_country_code NOT IN ('NG', 'GB')
       OR (p_latitude IS NULL) <> (p_longitude IS NULL)
       OR (p_latitude IS NOT NULL AND p_latitude NOT BETWEEN -90 AND 90)
       OR (p_longitude IS NOT NULL AND p_longitude NOT BETWEEN -180 AND 180)
       OR p_radius_km IS NULL OR p_radius_km NOT BETWEEN 1 AND 200
       OR (length(v_query) < 2 AND p_latitude IS NULL) THEN
        RAISE EXCEPTION 'Enter a shop name, city, or valid map location' USING ERRCODE = '22023';
    END IF;

    SELECT coalesce(jsonb_agg(to_jsonb(result_row) ORDER BY result_row.distance_km NULLS LAST, result_row.shop_name), '[]'::JSONB)
      INTO v_rows
      FROM (
          SELECT shop.id AS shop_id,
                 shop.slug AS shop_slug,
                 shop.name AS shop_name,
                 shop.description,
                 shop.logo_url,
                 shop.city,
                 location.address,
                 location.state_or_region,
                 location.postcode,
                 location.country_code,
                 location.latitude,
                 location.longitude,
                 CASE WHEN p_latitude IS NULL THEN NULL
                      ELSE round(public.delivery_distance_km(
                          p_latitude, p_longitude, location.latitude, location.longitude
                      )::NUMERIC, 2)
                 END AS distance_km
            FROM public.shop_physical_locations AS location
            JOIN public.shops AS shop ON shop.id = location.shop_id
           WHERE location.review_status = 'approved'
             AND shop.status = 'active'
             AND shop.verified IS TRUE
             AND location.country_code = p_country_code
             AND (
                 v_query = ''
                 OR shop.name ILIKE '%' || v_query || '%'
                 OR location.address ILIKE '%' || v_query || '%'
                 OR location.city ILIKE '%' || v_query || '%'
                 OR location.state_or_region ILIKE '%' || v_query || '%'
             )
             AND (
                 p_latitude IS NULL
                 OR public.delivery_distance_km(
                     p_latitude, p_longitude, location.latitude, location.longitude
                 ) <= p_radius_km
             )
           ORDER BY distance_km NULLS LAST, shop.name
           LIMIT greatest(1, least(coalesce(p_limit, 30), 50))
      ) AS result_row;
    RETURN v_rows;
END;
$$;
REVOKE ALL ON FUNCTION public.search_public_shop_physical_locations(TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC, INTEGER)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_public_shop_physical_locations(TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC, INTEGER)
    TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_shop_location_reviews(p_status TEXT DEFAULT 'pending')
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF public.current_profile_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
    IF coalesce(p_status, 'pending') NOT IN ('all', 'pending', 'approved', 'rejected') THEN
        RAISE EXCEPTION 'Unsupported location review status' USING ERRCODE = '22023';
    END IF;
    RETURN (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id', location.id,
            'shop_id', shop.id,
            'shop_name', shop.name,
            'shop_slug', shop.slug,
            'shop_status', shop.status,
            'shop_verified', shop.verified,
            'address', location.address,
            'city', location.city,
            'state_or_region', location.state_or_region,
            'postcode', location.postcode,
            'country_code', location.country_code,
            'latitude', location.latitude,
            'longitude', location.longitude,
            'review_status', location.review_status,
            'review_note', location.review_note,
            'submitted_by', location.submitted_by,
            'submitted_at', location.created_at
        ) ORDER BY location.created_at), '[]'::JSONB)
        FROM public.shop_physical_locations AS location
        JOIN public.shops AS shop ON shop.id = location.shop_id
        WHERE coalesce(p_status, 'pending') = 'all'
           OR location.review_status = coalesce(p_status, 'pending')
    );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_shop_location_reviews(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_shop_location_reviews(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_review_shop_physical_location(
    p_location_id UUID,
    p_decision TEXT,
    p_note TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_location public.shop_physical_locations%ROWTYPE;
    v_reviewer UUID;
    v_note TEXT := nullif(left(btrim(coalesce(p_note, '')), 2000), '');
BEGIN
    IF public.current_profile_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
    IF p_decision NOT IN ('approve', 'reject') THEN
        RAISE EXCEPTION 'Choose approve or reject' USING ERRCODE = '22023';
    END IF;
    IF p_decision = 'reject' AND length(coalesce(v_note, '')) < 3 THEN
        RAISE EXCEPTION 'Add a reason when rejecting a location' USING ERRCODE = '22023';
    END IF;

    SELECT location.* INTO v_location
    FROM public.shop_physical_locations AS location
    WHERE location.id = p_location_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Shop location not found' USING ERRCODE = 'P0002';
    END IF;
    IF p_decision = 'approve' AND NOT EXISTS (
        SELECT 1
        FROM public.shops AS shop
        WHERE shop.id = v_location.shop_id
          AND shop.status = 'active'
          AND shop.verified IS TRUE
    ) THEN
        RAISE EXCEPTION 'The shop must be active and verified before its map marker can be published' USING ERRCODE = '23514';
    END IF;

    v_reviewer := public.current_profile_id();
    UPDATE public.shop_physical_locations
       SET review_status = CASE WHEN p_decision = 'approve' THEN 'approved' ELSE 'rejected' END,
           review_note = v_note,
           reviewed_by = v_reviewer,
           reviewed_at = now()
     WHERE id = p_location_id;
    INSERT INTO public.shop_physical_location_reviews(location_id, reviewer_id, decision, note)
    VALUES (p_location_id, v_reviewer, CASE WHEN p_decision = 'approve' THEN 'approved' ELSE 'rejected' END, v_note);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_review_shop_physical_location(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_review_shop_physical_location(UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.delivery_provider_register(
    p_provider_type TEXT,
    p_display_name TEXT,
    p_country_code TEXT,
    p_description TEXT DEFAULT '',
    p_vehicle_type TEXT DEFAULT 'motorcycle'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_provider_id UUID;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sign in before registering as a delivery provider' USING ERRCODE = '42501';
    END IF;
    IF p_provider_type NOT IN ('logistics_company', 'independent_rider')
       OR p_country_code NOT IN ('NG', 'GB')
       OR length(btrim(coalesce(p_display_name, ''))) NOT BETWEEN 2 AND 120
       OR length(coalesce(p_description, '')) > 1200
       OR p_vehicle_type NOT IN ('motorcycle', 'car', 'van', 'fleet', 'other') THEN
        RAISE EXCEPTION 'Provider details are invalid' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.delivery_providers(
        user_id, provider_type, display_name, country_code, description, vehicle_type
    )
    VALUES (
        auth.uid(), p_provider_type, btrim(p_display_name), p_country_code,
        btrim(coalesce(p_description, '')), p_vehicle_type
    )
    ON CONFLICT (user_id, provider_type) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        country_code = EXCLUDED.country_code,
        description = EXCLUDED.description,
        vehicle_type = EXCLUDED.vehicle_type,
        updated_at = now()
    RETURNING id INTO v_provider_id;
    RETURN v_provider_id;
END;
$$;
REVOKE ALL ON FUNCTION public.delivery_provider_register(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delivery_provider_register(TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.delivery_provider_get_dashboard(p_provider_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_provider UUID;
    v_result JSONB;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;
    SELECT provider.id INTO v_provider
    FROM public.delivery_providers AS provider
    WHERE provider.user_id = auth.uid()
      AND (p_provider_id IS NULL OR provider.id = p_provider_id)
    ORDER BY provider.created_at
    LIMIT 1;
    IF v_provider IS NULL THEN
        RETURN jsonb_build_object('provider', NULL, 'verification', NULL, 'service_areas', '[]'::JSONB, 'requests', '[]'::JSONB, 'engagements', '[]'::JSONB);
    END IF;

    SELECT jsonb_build_object(
        'provider', (
            SELECT to_jsonb(provider)
            FROM public.delivery_providers AS provider
            WHERE provider.id = v_provider AND provider.user_id = auth.uid()
        ),
        'verification', (
            SELECT jsonb_build_object(
                'id', verification.id,
                'legal_name', verification.legal_name,
                'registered_business_name', verification.registered_business_name,
                'registration_number', verification.registration_number,
                'identity_document_type', verification.identity_document_type,
                'document_paths', verification.document_paths,
                'status', verification.status,
                'review_note', verification.review_note,
                'submitted_at', verification.submitted_at
            )
            FROM public.delivery_provider_verifications AS verification
            WHERE verification.provider_id = v_provider
        ),
        'service_areas', coalesce((
            SELECT jsonb_agg(to_jsonb(area) ORDER BY area.city, area.state_or_region)
            FROM public.delivery_provider_service_areas AS area
            WHERE area.provider_id = v_provider
        ), '[]'::JSONB),
        'requests', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                'id', request.id,
                'order_id', request.order_id,
                'status', request.status,
                'provider_fee_amount', request.provider_fee_amount,
                'platform_fee_amount', request.platform_fee_amount,
                'total_fee_amount', request.total_fee_amount,
                'currency_code', request.currency_code,
                'distance_km', request.distance_km,
                'eta_min_minutes', request.eta_min_minutes,
                'eta_max_minutes', request.eta_max_minutes,
                'response_note', request.response_note,
                'created_at', request.created_at,
                'order_number', order_row.order_number,
                'shipping_address', order_row.shipping_address
            ) ORDER BY request.created_at DESC)
            FROM public.delivery_requests AS request
            JOIN public.orders AS order_row ON order_row.id = request.order_id
            WHERE request.provider_id = v_provider
              AND request.status IN ('requested', 'accepted', 'picked_up', 'in_transit', 'issue_reported')
        ), '[]'::JSONB),
        'engagements', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                'id', engagement.id,
                'shop_id', engagement.shop_id,
                'shop_name', shop.name,
                'engagement_type', engagement.engagement_type,
                'status', engagement.status,
                'terms', engagement.terms,
                'start_date', engagement.start_date,
                'end_date', engagement.end_date,
                'created_at', engagement.created_at
            ) ORDER BY engagement.created_at DESC)
            FROM public.delivery_rider_engagements AS engagement
            JOIN public.shops AS shop ON shop.id = engagement.shop_id
            WHERE engagement.provider_id = v_provider
              AND engagement.status IN ('invited', 'accepted')
        ), '[]'::JSONB)
    ) INTO v_result;
    RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.delivery_provider_get_dashboard(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delivery_provider_get_dashboard(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.delivery_provider_submit_verification(
    p_provider_id UUID,
    p_legal_name TEXT,
    p_registered_business_name TEXT,
    p_registration_number TEXT,
    p_identity_document_type TEXT,
    p_document_paths TEXT[]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
    v_provider public.delivery_providers%ROWTYPE;
    v_verification_id UUID;
BEGIN
    SELECT provider.* INTO v_provider
    FROM public.delivery_providers AS provider
    WHERE provider.id = p_provider_id AND provider.user_id = auth.uid()
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Provider profile not found' USING ERRCODE = '42501';
    END IF;
    IF length(btrim(coalesce(p_legal_name, ''))) NOT BETWEEN 2 AND 160
       OR length(coalesce(p_registered_business_name, '')) > 160
       OR length(coalesce(p_registration_number, '')) > 120
       OR coalesce(cardinality(p_document_paths), 0) NOT BETWEEN 1 AND 5
       OR (
            SELECT count(DISTINCT document_path)
            FROM unnest(coalesce(p_document_paths, ARRAY[]::TEXT[])) AS documents(document_path)
          ) <> cardinality(p_document_paths)
       OR EXISTS (
            SELECT 1
            FROM unnest(coalesce(p_document_paths, ARRAY[]::TEXT[])) AS documents(document_path)
            LEFT JOIN storage.objects AS object_row
              ON object_row.bucket_id = 'delivery-provider-verification-private'
             AND object_row.name = document_path
            WHERE document_path !~ ('^' || p_provider_id::TEXT || '/[A-Za-z0-9._-]{1,180}$')
               OR object_row.id IS NULL
          ) THEN
        RAISE EXCEPTION 'Upload one to five valid verification documents' USING ERRCODE = '22023';
    END IF;
    IF v_provider.provider_type = 'logistics_company'
       AND (length(btrim(coalesce(p_registered_business_name, ''))) < 2
            OR length(btrim(coalesce(p_registration_number, ''))) < 2) THEN
        RAISE EXCEPTION 'Company registration details are required' USING ERRCODE = '22023';
    END IF;
    IF v_provider.provider_type = 'independent_rider'
       AND p_identity_document_type NOT IN ('passport', 'national_id', 'drivers_license', 'voters_card') THEN
        RAISE EXCEPTION 'Choose a valid identity document type' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.delivery_provider_verifications(
        provider_id, legal_name, registered_business_name, registration_number,
        identity_document_type, document_paths, status, review_note,
        submitted_at, reviewed_by, reviewed_at
    )
    VALUES (
        p_provider_id, btrim(p_legal_name), btrim(coalesce(p_registered_business_name, '')),
        btrim(coalesce(p_registration_number, '')), coalesce(p_identity_document_type, ''),
        p_document_paths, 'pending', NULL, now(), NULL, NULL
    )
    ON CONFLICT (provider_id) DO UPDATE SET
        legal_name = EXCLUDED.legal_name,
        registered_business_name = EXCLUDED.registered_business_name,
        registration_number = EXCLUDED.registration_number,
        identity_document_type = EXCLUDED.identity_document_type,
        document_paths = EXCLUDED.document_paths,
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
REVOKE ALL ON FUNCTION public.delivery_provider_submit_verification(UUID, TEXT, TEXT, TEXT, TEXT, TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delivery_provider_submit_verification(UUID, TEXT, TEXT, TEXT, TEXT, TEXT[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.delivery_provider_save_profile(
    p_provider_id UUID,
    p_display_name TEXT,
    p_description TEXT,
    p_vehicle_type TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF length(btrim(coalesce(p_display_name, ''))) NOT BETWEEN 2 AND 120
       OR length(coalesce(p_description, '')) > 1200
       OR p_vehicle_type NOT IN ('motorcycle', 'car', 'van', 'fleet', 'other') THEN
        RAISE EXCEPTION 'Provider details are invalid' USING ERRCODE = '22023';
    END IF;
    UPDATE public.delivery_providers
       SET display_name = btrim(p_display_name),
           description = btrim(coalesce(p_description, '')),
           vehicle_type = p_vehicle_type
     WHERE id = p_provider_id AND user_id = auth.uid();
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Provider profile not found' USING ERRCODE = '42501';
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.delivery_provider_save_profile(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delivery_provider_save_profile(UUID, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.delivery_provider_save_service_area(
    p_provider_id UUID,
    p_area_id UUID,
    p_country_code TEXT,
    p_state_or_region TEXT,
    p_city TEXT,
    p_latitude DOUBLE PRECISION,
    p_longitude DOUBLE PRECISION,
    p_coverage_radius_km NUMERIC,
    p_service_types TEXT[],
    p_base_fee NUMERIC,
    p_per_km_fee NUMERIC,
    p_eta_min_minutes INTEGER,
    p_eta_max_minutes INTEGER,
    p_is_active BOOLEAN DEFAULT TRUE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_provider public.delivery_providers%ROWTYPE;
    v_area_id UUID;
    v_currency TEXT;
BEGIN
    SELECT provider.* INTO v_provider
    FROM public.delivery_providers AS provider
    WHERE provider.id = p_provider_id AND provider.user_id = auth.uid()
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Provider profile not found' USING ERRCODE = '42501';
    END IF;
    IF p_country_code <> v_provider.country_code
       OR p_country_code NOT IN ('NG', 'GB')
       OR length(btrim(coalesce(p_state_or_region, ''))) NOT BETWEEN 2 AND 120
       OR length(btrim(coalesce(p_city, ''))) NOT BETWEEN 2 AND 120
       OR p_latitude IS NULL OR p_latitude NOT BETWEEN -90 AND 90
       OR p_longitude IS NULL OR p_longitude NOT BETWEEN -180 AND 180
       OR p_coverage_radius_km IS NULL OR p_coverage_radius_km NOT BETWEEN 1 AND 200
       OR coalesce(cardinality(p_service_types), 0) NOT BETWEEN 1 AND 5
       OR p_service_types <@ ARRAY['standard', 'same_day', 'next_day', 'express', 'scheduled']::TEXT[] IS NOT TRUE
       OR p_base_fee IS NULL OR p_base_fee NOT BETWEEN 0 AND 10000000
       OR p_per_km_fee IS NULL OR p_per_km_fee NOT BETWEEN 0 AND 1000000
       OR p_eta_min_minutes IS NULL OR p_eta_min_minutes NOT BETWEEN 5 AND 10080
       OR p_eta_max_minutes IS NULL OR p_eta_max_minutes NOT BETWEEN p_eta_min_minutes AND 10080 THEN
        RAISE EXCEPTION 'Service area, delivery types, fees, or timing are invalid' USING ERRCODE = '22023';
    END IF;
    v_currency := CASE WHEN p_country_code = 'NG' THEN 'NGN' ELSE 'GBP' END;

    IF p_area_id IS NULL THEN
        IF (SELECT count(*) FROM public.delivery_provider_service_areas
            WHERE provider_id = p_provider_id) >= 15 THEN
            RAISE EXCEPTION 'A provider can manage up to 15 service areas' USING ERRCODE = '22023';
        END IF;
        INSERT INTO public.delivery_provider_service_areas(
            provider_id, country_code, state_or_region, city, latitude, longitude,
            coverage_radius_km, service_types, base_fee, per_km_fee, currency_code,
            eta_min_minutes, eta_max_minutes, is_active
        )
        VALUES (
            p_provider_id, p_country_code, btrim(p_state_or_region), btrim(p_city),
            p_latitude, p_longitude, p_coverage_radius_km, p_service_types,
            p_base_fee, p_per_km_fee, v_currency, p_eta_min_minutes, p_eta_max_minutes,
            coalesce(p_is_active, FALSE) AND v_provider.status = 'approved' AND v_provider.is_verified
        )
        RETURNING id INTO v_area_id;
    ELSE
        UPDATE public.delivery_provider_service_areas
           SET country_code = p_country_code,
               state_or_region = btrim(p_state_or_region),
               city = btrim(p_city),
               latitude = p_latitude,
               longitude = p_longitude,
               coverage_radius_km = p_coverage_radius_km,
               service_types = p_service_types,
               base_fee = p_base_fee,
               per_km_fee = p_per_km_fee,
               currency_code = v_currency,
               eta_min_minutes = p_eta_min_minutes,
               eta_max_minutes = p_eta_max_minutes,
               is_active = coalesce(p_is_active, FALSE)
                   AND v_provider.status = 'approved' AND v_provider.is_verified
         WHERE id = p_area_id AND provider_id = p_provider_id
        RETURNING id INTO v_area_id;
        IF v_area_id IS NULL THEN
            RAISE EXCEPTION 'Service area not found' USING ERRCODE = 'P0002';
        END IF;
    END IF;
    RETURN v_area_id;
END;
$$;
REVOKE ALL ON FUNCTION public.delivery_provider_save_service_area(UUID, UUID, TEXT, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC, TEXT[], NUMERIC, NUMERIC, INTEGER, INTEGER, BOOLEAN)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delivery_provider_save_service_area(UUID, UUID, TEXT, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC, TEXT[], NUMERIC, NUMERIC, INTEGER, INTEGER, BOOLEAN)
    TO authenticated;

CREATE OR REPLACE FUNCTION public.delivery_provider_delete_service_area(
    p_provider_id UUID,
    p_area_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.delivery_providers
        WHERE id = p_provider_id AND user_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'Provider profile not found' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.delivery_requests
        WHERE service_area_id = p_area_id
          AND status IN ('requested', 'accepted', 'picked_up', 'in_transit', 'issue_reported')
    ) THEN
        RAISE EXCEPTION 'This service area has active deliveries and cannot be removed yet' USING ERRCODE = '23514';
    END IF;
    DELETE FROM public.delivery_provider_service_areas
    WHERE id = p_area_id AND provider_id = p_provider_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Service area not found' USING ERRCODE = 'P0002';
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.delivery_provider_delete_service_area(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delivery_provider_delete_service_area(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.delivery_provider_set_availability(
    p_provider_id UUID,
    p_is_available BOOLEAN,
    p_available_until TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_provider public.delivery_providers%ROWTYPE;
    v_until TIMESTAMPTZ := coalesce(p_available_until, now() + interval '4 hours');
BEGIN
    SELECT provider.* INTO v_provider
    FROM public.delivery_providers AS provider
    WHERE provider.id = p_provider_id AND provider.user_id = auth.uid()
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Provider profile not found' USING ERRCODE = '42501';
    END IF;
    IF p_is_available IS TRUE THEN
        IF v_provider.status <> 'approved' OR v_provider.is_verified IS NOT TRUE THEN
            RAISE EXCEPTION 'Availability can be enabled only after admin approval' USING ERRCODE = '23514';
        END IF;
        IF v_until <= now() OR v_until > now() + interval '24 hours' THEN
            RAISE EXCEPTION 'Availability must expire within the next 24 hours' USING ERRCODE = '22023';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM public.delivery_provider_service_areas
            WHERE provider_id = p_provider_id AND is_active IS TRUE
        ) THEN
            RAISE EXCEPTION 'Add an active service area before becoming available' USING ERRCODE = '23514';
        END IF;
    ELSE
        v_until := NULL;
    END IF;
    UPDATE public.delivery_providers
       SET is_available = coalesce(p_is_available, FALSE),
           available_until = v_until,
           availability_updated_at = now()
     WHERE id = p_provider_id;
    RETURN jsonb_build_object(
        'is_available', coalesce(p_is_available, FALSE),
        'available_until', v_until
    );
END;
$$;
REVOKE ALL ON FUNCTION public.delivery_provider_set_availability(UUID, BOOLEAN, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delivery_provider_set_availability(UUID, BOOLEAN, TIMESTAMPTZ) TO authenticated;

CREATE OR REPLACE FUNCTION public.delivery_quote_for_provider(
    p_provider_id UUID,
    p_service_area_id UUID,
    p_latitude DOUBLE PRECISION,
    p_longitude DOUBLE PRECISION,
    p_country_code TEXT,
    p_service_type TEXT DEFAULT 'standard'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_result JSONB;
BEGIN
    IF p_latitude IS NULL OR p_latitude NOT BETWEEN -90 AND 90
       OR p_longitude IS NULL OR p_longitude NOT BETWEEN -180 AND 180
       OR p_country_code NOT IN ('NG', 'GB')
       OR p_service_type NOT IN ('standard', 'same_day', 'next_day', 'express', 'scheduled') THEN
        RETURN NULL;
    END IF;
    SELECT jsonb_build_object(
        'provider_id', provider.id,
        'service_area_id', area.id,
        'provider_type', provider.provider_type,
        'display_name', provider.display_name,
        'description', provider.description,
        'vehicle_type', provider.vehicle_type,
        'city', area.city,
        'state_or_region', area.state_or_region,
        'country_code', area.country_code,
        'distance_km', round(distance.distance_km::NUMERIC, 2),
        'provider_fee_amount', round(area.base_fee + area.per_km_fee * distance.distance_km, 2),
        'platform_fee_amount', round(
            (area.base_fee + area.per_km_fee * distance.distance_km)
            * settings.platform_commission_percent / 100
            + settings.fixed_delivery_fee, 2
        ),
        'total_fee_amount', round(
            (area.base_fee + area.per_km_fee * distance.distance_km)
            * (1 + settings.platform_commission_percent / 100)
            + settings.fixed_delivery_fee, 2
        ),
        'currency_code', settings.currency_code,
        'commission_percent', settings.platform_commission_percent,
        'currency_per_usd', settings.currency_per_usd,
        'eta_min_minutes', area.eta_min_minutes,
        'eta_max_minutes', area.eta_max_minutes
    )
      INTO v_result
      FROM public.delivery_providers AS provider
      JOIN public.delivery_provider_service_areas AS area
        ON area.provider_id = provider.id
      JOIN public.delivery_platform_settings AS settings
        ON settings.country_code = area.country_code
       AND settings.is_enabled IS TRUE
      CROSS JOIN LATERAL (
          SELECT public.delivery_distance_km(
              p_latitude, p_longitude, area.latitude, area.longitude
          ) AS distance_km
      ) AS distance
     WHERE provider.id = p_provider_id
       AND area.id = p_service_area_id
       AND provider.status = 'approved'
       AND provider.is_verified IS TRUE
       AND provider.is_available IS TRUE
       AND provider.available_until > now()
       AND area.is_active IS TRUE
       AND area.country_code = p_country_code
       AND area.service_types @> ARRAY[p_service_type]::TEXT[]
       AND distance.distance_km <= area.coverage_radius_km;
    RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.delivery_quote_for_provider(UUID, UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_available_delivery_providers(
    p_latitude DOUBLE PRECISION,
    p_longitude DOUBLE PRECISION,
    p_country_code TEXT,
    p_service_type TEXT DEFAULT 'standard',
    p_limit INTEGER DEFAULT 20
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_results JSONB;
BEGIN
    IF p_latitude IS NULL OR p_latitude NOT BETWEEN -90 AND 90
       OR p_longitude IS NULL OR p_longitude NOT BETWEEN -180 AND 180
       OR p_country_code NOT IN ('NG', 'GB')
       OR p_service_type NOT IN ('standard', 'same_day', 'next_day', 'express', 'scheduled') THEN
        RAISE EXCEPTION 'Enter a valid delivery location' USING ERRCODE = '22023';
    END IF;
    SELECT coalesce(jsonb_agg(result.quote ORDER BY
        (result.quote->>'total_fee_amount')::NUMERIC,
        (result.quote->>'distance_km')::NUMERIC,
        result.provider_id), '[]'::JSONB)
      INTO v_results
      FROM (
          SELECT DISTINCT ON (provider.id)
                 provider.id AS provider_id,
                 public.delivery_quote_for_provider(
                     provider.id, area.id, p_latitude, p_longitude,
                     p_country_code, p_service_type
                 ) AS quote
            FROM public.delivery_providers AS provider
            JOIN public.delivery_provider_service_areas AS area
              ON area.provider_id = provider.id
            CROSS JOIN LATERAL (
                SELECT public.delivery_distance_km(
                    p_latitude, p_longitude, area.latitude, area.longitude
                ) AS distance_km
            ) AS distance
           WHERE provider.status = 'approved'
             AND provider.is_verified IS TRUE
             AND provider.is_available IS TRUE
             AND provider.available_until > now()
             AND provider.country_code = p_country_code
             AND area.country_code = p_country_code
             AND area.is_active IS TRUE
             AND area.service_types @> ARRAY[p_service_type]::TEXT[]
             AND distance.distance_km <= area.coverage_radius_km
           ORDER BY provider.id,
                    area.base_fee + area.per_km_fee * distance.distance_km,
                    distance.distance_km
           LIMIT greatest(1, least(coalesce(p_limit, 20), 50))
      ) AS result
     WHERE result.quote IS NOT NULL;
    RETURN v_results;
END;
$$;
REVOKE ALL ON FUNCTION public.get_available_delivery_providers(DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, INTEGER)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_available_delivery_providers(DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, INTEGER)
    TO anon, authenticated;

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
                    'document_paths', review.document_paths
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
REVOKE ALL ON FUNCTION public.admin_list_delivery_providers(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_delivery_providers(TEXT) TO authenticated;

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
BEGIN
    IF public.current_profile_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
    IF p_decision NOT IN ('approve', 'reject', 'request_resubmission', 'suspend', 'restore') THEN
        RAISE EXCEPTION 'Unsupported provider decision' USING ERRCODE = '22023';
    END IF;
    IF p_decision IN ('reject', 'request_resubmission', 'suspend') AND length(coalesce(v_note, '')) < 3 THEN
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
        IF v_verification.id IS NULL
           OR cardinality(v_verification.document_paths) NOT BETWEEN 1 AND 5
           OR EXISTS (
                SELECT 1
                FROM unnest(v_verification.document_paths) AS documents(document_path)
                LEFT JOIN storage.objects AS object_row
                  ON object_row.bucket_id = 'delivery-provider-verification-private'
                 AND object_row.name = documents.document_path
                WHERE object_row.id IS NULL
           ) THEN
            RAISE EXCEPTION 'Complete verification documents are required before approval' USING ERRCODE = '23514';
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
           SET status = 'resubmission_required', review_note = v_note, reviewed_by = v_reviewer, reviewed_at = now()
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

    INSERT INTO public.delivery_provider_reviews(
        provider_id, verification_id, reviewer_id, decision, note, document_paths
    )
    VALUES (
        p_provider_id,
        v_verification.id,
        v_reviewer,
        v_new_status,
        v_note,
        coalesce(v_verification.document_paths, ARRAY[]::TEXT[])
    );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_review_delivery_provider(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_review_delivery_provider(UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_delivery_settings()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF public.current_profile_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
    RETURN (
        SELECT coalesce(jsonb_agg(to_jsonb(settings) ORDER BY settings.country_code), '[]'::JSONB)
        FROM public.delivery_platform_settings AS settings
    );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_delivery_settings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_delivery_settings() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_save_delivery_settings(
    p_country_code TEXT,
    p_currency_per_usd NUMERIC,
    p_commission_percent NUMERIC,
    p_fixed_delivery_fee NUMERIC,
    p_is_enabled BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_currency TEXT;
BEGIN
    IF public.current_profile_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
    IF p_country_code NOT IN ('NG', 'GB')
       OR p_currency_per_usd IS NULL OR p_currency_per_usd NOT BETWEEN 0.0001 AND 100000000
       OR p_commission_percent IS NULL OR p_commission_percent NOT BETWEEN 0 AND 30
       OR p_fixed_delivery_fee IS NULL OR p_fixed_delivery_fee NOT BETWEEN 0 AND 1000000 THEN
        RAISE EXCEPTION 'Delivery settings are outside the permitted range' USING ERRCODE = '22023';
    END IF;
    v_currency := CASE WHEN p_country_code = 'NG' THEN 'NGN' ELSE 'GBP' END;
    INSERT INTO public.delivery_platform_settings(
        country_code, currency_code, currency_per_usd, platform_commission_percent,
        fixed_delivery_fee, is_enabled, updated_by, updated_at
    )
    VALUES (
        p_country_code, v_currency, p_currency_per_usd, p_commission_percent,
        p_fixed_delivery_fee, coalesce(p_is_enabled, FALSE),
        public.current_profile_id(), now()
    )
    ON CONFLICT (country_code) DO UPDATE SET
        currency_code = EXCLUDED.currency_code,
        currency_per_usd = EXCLUDED.currency_per_usd,
        platform_commission_percent = EXCLUDED.platform_commission_percent,
        fixed_delivery_fee = EXCLUDED.fixed_delivery_fee,
        is_enabled = EXCLUDED.is_enabled,
        updated_by = EXCLUDED.updated_by,
        updated_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.admin_save_delivery_settings(TEXT, NUMERIC, NUMERIC, NUMERIC, BOOLEAN)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_delivery_settings(TEXT, NUMERIC, NUMERIC, NUMERIC, BOOLEAN)
    TO authenticated;

CREATE OR REPLACE FUNCTION public.delivery_provider_report(
    p_provider_id UUID,
    p_request_id UUID,
    p_reason TEXT,
    p_details TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_report_id UUID;
BEGIN
    IF auth.uid() IS NULL
       OR p_reason NOT IN ('safety', 'late_delivery', 'misconduct', 'fraud', 'other')
       OR length(btrim(coalesce(p_details, ''))) NOT BETWEEN 10 AND 2000 THEN
        RAISE EXCEPTION 'Report details are invalid' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.delivery_providers
        WHERE id = p_provider_id AND status <> 'rejected'
    ) THEN
        RAISE EXCEPTION 'Provider not found' USING ERRCODE = 'P0002';
    END IF;
    IF p_request_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM public.delivery_requests AS request
        JOIN public.orders AS order_row ON order_row.id = request.order_id
        LEFT JOIN public.order_items AS item ON item.order_id = order_row.id
        LEFT JOIN public.shops AS shop ON shop.id = item.shop_id
        WHERE request.id = p_request_id
          AND request.provider_id = p_provider_id
          AND (
              request.buyer_user_id = auth.uid()
              OR shop_portal_owns_shop(shop.id)
              OR public.current_profile_role() = 'admin'
          )
    ) THEN
        RAISE EXCEPTION 'You cannot report a delivery you were not part of' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.delivery_provider_reports(
        provider_id, request_id, reporter_user_id, reason, details
    )
    VALUES (p_provider_id, p_request_id, auth.uid(), p_reason, btrim(p_details))
    RETURNING id INTO v_report_id;
    RETURN v_report_id;
END;
$$;
REVOKE ALL ON FUNCTION public.delivery_provider_report(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delivery_provider_report(UUID, UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_delivery_provider_reports(p_status TEXT DEFAULT 'open')
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF public.current_profile_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
    IF coalesce(p_status, 'open') NOT IN ('all', 'open', 'reviewing', 'resolved', 'dismissed') THEN
        RAISE EXCEPTION 'Unsupported report status' USING ERRCODE = '22023';
    END IF;
    RETURN (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id', report.id,
            'provider_id', provider.id,
            'provider_name', provider.display_name,
            'provider_type', provider.provider_type,
            'request_id', report.request_id,
            'reporter_user_id', report.reporter_user_id,
            'reason', report.reason,
            'details', report.details,
            'status', report.status,
            'admin_note', report.admin_note,
            'created_at', report.created_at,
            'reviews', coalesce((
                SELECT jsonb_agg(jsonb_build_object(
                    'status', review.status,
                    'note', review.note,
                    'reviewer_email', reviewer.email,
                    'created_at', review.created_at
                ) ORDER BY review.created_at DESC)
                FROM public.delivery_provider_report_reviews AS review
                LEFT JOIN public.profiles AS reviewer ON reviewer.id = review.reviewer_id
                WHERE review.report_id = report.id
            ), '[]'::JSONB)
        ) ORDER BY report.created_at), '[]'::JSONB)
        FROM public.delivery_provider_reports AS report
        JOIN public.delivery_providers AS provider ON provider.id = report.provider_id
        WHERE coalesce(p_status, 'open') = 'all'
           OR report.status = coalesce(p_status, 'open')
    );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_delivery_provider_reports(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_delivery_provider_reports(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_review_delivery_provider_report(
    p_report_id UUID,
    p_status TEXT,
    p_note TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_reviewer UUID;
    v_note TEXT := nullif(left(btrim(coalesce(p_note, '')), 2000), '');
BEGIN
    IF public.current_profile_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
    IF p_status NOT IN ('reviewing', 'resolved', 'dismissed') THEN
        RAISE EXCEPTION 'Unsupported report status' USING ERRCODE = '22023';
    END IF;
    v_reviewer := public.current_profile_id();
    UPDATE public.delivery_provider_reports
       SET status = p_status, admin_note = v_note, reviewed_by = v_reviewer, reviewed_at = now()
     WHERE id = p_report_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Report not found' USING ERRCODE = 'P0002';
    END IF;
    INSERT INTO public.delivery_provider_report_reviews(report_id, reviewer_id, status, note)
    VALUES (p_report_id, v_reviewer, p_status, v_note);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_review_delivery_provider_report(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_review_delivery_provider_report(UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_delivery_activity(p_limit INTEGER DEFAULT 100)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF public.current_profile_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
    RETURN jsonb_build_object(
        'provider_counts', (
            SELECT coalesce(jsonb_agg(to_jsonb(counts) ORDER BY counts.country_code, counts.provider_type), '[]'::JSONB)
            FROM (
                SELECT country_code, provider_type, status, is_available,
                       count(*)::INTEGER AS provider_count
                FROM public.delivery_providers
                GROUP BY country_code, provider_type, status, is_available
            ) AS counts
        ),
        'recent_deliveries', (
            SELECT coalesce(jsonb_agg(jsonb_build_object(
                'request_id', request.id,
                'order_id', request.order_id,
                'order_number', order_row.order_number,
                'provider_id', provider.id,
                'provider_name', provider.display_name,
                'provider_type', provider.provider_type,
                'status', request.status,
                'total_fee_amount', request.total_fee_amount,
                'currency_code', request.currency_code,
                'created_at', request.created_at,
                'updated_at', request.updated_at,
                'destination', jsonb_build_object(
                    'city', order_row.shipping_address->>'city',
                    'country', order_row.shipping_address->>'country'
                )
            ) ORDER BY request.created_at DESC), '[]'::JSONB)
            FROM (
                SELECT * FROM public.delivery_requests
                ORDER BY created_at DESC
                LIMIT greatest(1, least(coalesce(p_limit, 100), 200))
            ) AS request
            JOIN public.orders AS order_row ON order_row.id = request.order_id
            JOIN public.delivery_providers AS provider ON provider.id = request.provider_id
        ),
        'service_area_count', (
            SELECT count(*)::INTEGER FROM public.delivery_provider_service_areas
            WHERE is_active IS TRUE
        )
    );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_delivery_activity(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_delivery_activity(INTEGER) TO authenticated;


