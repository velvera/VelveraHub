-- Complete the three distinct location/logistics workflows:
-- physical shop discovery (migration 20), per-order delivery, and rider hiring.
-- Apply after database/physical-store-logistics.sql.

BEGIN;

ALTER TABLE public.delivery_providers
    ADD COLUMN IF NOT EXISTS accepts_workforce_engagements BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS delivery_provider_workforce_match_idx
    ON public.delivery_providers(country_code, provider_type, status, accepts_workforce_engagements);

-- A provider may define coverage before verification. Make those saved
-- user-entered areas matchable when an administrator first approves them.
CREATE OR REPLACE FUNCTION public.activate_delivery_areas_after_provider_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.status = 'approved'
       AND NEW.is_verified IS TRUE
       AND (OLD.status IS DISTINCT FROM 'approved' OR OLD.is_verified IS DISTINCT FROM TRUE) THEN
        UPDATE public.delivery_provider_service_areas
           SET is_active = TRUE
         WHERE provider_id = NEW.id
           AND is_active IS FALSE;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.activate_delivery_areas_after_provider_approval() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS activate_delivery_areas_after_provider_approval
    ON public.delivery_providers;
CREATE TRIGGER activate_delivery_areas_after_provider_approval
AFTER UPDATE OF status, is_verified ON public.delivery_providers
FOR EACH ROW EXECUTE FUNCTION public.activate_delivery_areas_after_provider_approval();

CREATE OR REPLACE FUNCTION public.delivery_provider_list_my_profiles()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;
    RETURN (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id', provider.id,
            'provider_type', provider.provider_type,
            'display_name', provider.display_name,
            'country_code', provider.country_code,
            'status', provider.status,
            'is_verified', provider.is_verified,
            'is_available', provider.is_available,
            'available_until', provider.available_until,
            'accepts_workforce_engagements', provider.accepts_workforce_engagements,
            'verification_status', verification.status
        ) ORDER BY provider.created_at), '[]'::JSONB)
        FROM public.delivery_providers AS provider
        LEFT JOIN public.delivery_provider_verifications AS verification
          ON verification.provider_id = provider.id
        WHERE provider.user_id = auth.uid()
    );
END;
$$;
REVOKE ALL ON FUNCTION public.delivery_provider_list_my_profiles() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delivery_provider_list_my_profiles() TO authenticated;

-- A delivery provider must cover both the seller's verified shop and the
-- buyer's destination. Order availability is deliberately time-limited and
-- independent from whether a rider is open to employment engagements.
CREATE OR REPLACE FUNCTION public.get_available_delivery_providers_for_shop(
    p_shop_id UUID,
    p_destination_latitude DOUBLE PRECISION,
    p_destination_longitude DOUBLE PRECISION,
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
    v_result JSONB;
    v_shop public.shops%ROWTYPE;
    v_origin RECORD;
BEGIN
    IF p_destination_latitude IS NULL OR p_destination_latitude NOT BETWEEN -90 AND 90
       OR p_destination_longitude IS NULL OR p_destination_longitude NOT BETWEEN -180 AND 180
       OR p_country_code NOT IN ('NG', 'GB')
       OR p_service_type NOT IN ('standard', 'same_day', 'express', 'scheduled') THEN
        RAISE EXCEPTION 'Enter a valid delivery destination' USING ERRCODE = '22023';
    END IF;

    SELECT shop.* INTO v_shop
    FROM public.shops AS shop
    WHERE shop.id = p_shop_id
      AND shop.status = 'active'
      AND shop.verified IS TRUE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'This shop is not available for provider matching' USING ERRCODE = 'P0002';
    END IF;

    SELECT location.latitude, location.longitude, location.country_code
      INTO v_origin
      FROM public.shop_physical_locations AS location
     WHERE location.shop_id = p_shop_id
       AND location.review_status = 'approved';
    IF NOT FOUND OR v_origin.country_code <> p_country_code THEN
        RETURN '[]'::JSONB;
    END IF;

    SELECT coalesce(jsonb_agg(to_jsonb(match_row) ORDER BY
        match_row.total_fee_amount, match_row.distance_km, match_row.provider_id), '[]'::JSONB)
      INTO v_result
      FROM (
          SELECT DISTINCT ON (provider.id)
                 provider.id AS provider_id,
                 provider.provider_type,
                 provider.display_name,
                 provider.description,
                 provider.vehicle_type,
                 area.id AS service_area_id,
                 area.city AS service_city,
                 area.state_or_region AS service_region,
                 area.coverage_radius_km,
                 round(route.distance_km::NUMERIC, 2) AS distance_km,
                 round(area.base_fee + area.per_km_fee * route.distance_km, 2) AS provider_fee_amount,
                 round(
                     (area.base_fee + area.per_km_fee * route.distance_km)
                         * settings.platform_commission_percent / 100
                     + settings.fixed_delivery_fee,
                     2
                 ) AS platform_fee_amount,
                 round(
                     (area.base_fee + area.per_km_fee * route.distance_km)
                         * (1 + settings.platform_commission_percent / 100)
                     + settings.fixed_delivery_fee,
                     2
                 ) AS total_fee_amount,
                 settings.currency_code,
                 area.eta_min_minutes,
                 area.eta_max_minutes,
                 provider.available_until
            FROM public.delivery_providers AS provider
            JOIN public.delivery_provider_service_areas AS area
              ON area.provider_id = provider.id
            JOIN public.delivery_platform_settings AS settings
              ON settings.country_code = area.country_code
             AND settings.is_enabled IS TRUE
            CROSS JOIN LATERAL (
                SELECT public.delivery_distance_km(
                    v_origin.latitude, v_origin.longitude,
                    p_destination_latitude, p_destination_longitude
                ) AS distance_km
            ) AS route
           WHERE provider.country_code = p_country_code
             AND provider.status = 'approved'
             AND provider.is_verified IS TRUE
             AND provider.is_available IS TRUE
             AND provider.available_until > now()
             AND area.country_code = p_country_code
             AND area.is_active IS TRUE
             AND area.service_types @> ARRAY[p_service_type]::TEXT[]
             AND public.delivery_distance_km(
                    area.latitude, area.longitude,
                    v_origin.latitude, v_origin.longitude
                 ) <= area.coverage_radius_km
             AND public.delivery_distance_km(
                    area.latitude, area.longitude,
                    p_destination_latitude, p_destination_longitude
                 ) <= area.coverage_radius_km
           ORDER BY provider.id,
                    area.base_fee + area.per_km_fee * route.distance_km,
                    route.distance_km
           LIMIT greatest(1, least(coalesce(p_limit, 20), 50))
      ) AS match_row;
    RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_available_delivery_providers_for_shop(
    UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, INTEGER
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_available_delivery_providers_for_shop(
    UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, INTEGER
) TO anon, authenticated;

-- Store employment interest separately from short-lived order-delivery
-- availability. Permanent hiring must not be hidden because a rider toggled
-- off their four-hour delivery availability.
CREATE OR REPLACE FUNCTION public.delivery_provider_set_workforce_interest(
    p_provider_id UUID,
    p_accepts_engagements BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_accepts BOOLEAN := coalesce(p_accepts_engagements, FALSE);
BEGIN
    UPDATE public.delivery_providers
       SET accepts_workforce_engagements = v_accepts,
           updated_at = now()
     WHERE id = p_provider_id
       AND user_id = auth.uid()
       AND provider_type = 'independent_rider'
       AND status = 'approved'
       AND is_verified IS TRUE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'An approved independent rider profile is required' USING ERRCODE = '42501';
    END IF;
    RETURN v_accepts;
END;
$$;
REVOKE ALL ON FUNCTION public.delivery_provider_set_workforce_interest(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delivery_provider_set_workforce_interest(UUID, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_available_riders_for_workforce(
    p_shop_id UUID,
    p_limit INTEGER DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_result JSONB;
    v_location RECORD;
BEGIN
    IF auth.uid() IS NULL OR NOT public.shop_portal_owns_shop(p_shop_id) THEN
        RAISE EXCEPTION 'You do not own this shop' USING ERRCODE = '42501';
    END IF;

    SELECT latitude, longitude, country_code
      INTO v_location
      FROM public.shop_physical_locations
     WHERE shop_id = p_shop_id AND review_status = 'approved';
    IF NOT FOUND THEN
        RETURN '[]'::JSONB;
    END IF;

    SELECT coalesce(jsonb_agg(to_jsonb(match_row) ORDER BY
        match_row.distance_to_shop_km, match_row.display_name), '[]'::JSONB)
      INTO v_result
      FROM (
          SELECT DISTINCT ON (provider.id)
                 provider.id AS provider_id,
                 provider.display_name,
                 provider.description,
                 provider.vehicle_type,
                 area.id AS service_area_id,
                 area.city AS service_city,
                 area.state_or_region AS service_region,
                 area.coverage_radius_km,
                 round(distance.distance_km::NUMERIC, 2) AS distance_to_shop_km
            FROM public.delivery_providers AS provider
            JOIN public.delivery_provider_service_areas AS area
              ON area.provider_id = provider.id
            CROSS JOIN LATERAL (
                SELECT public.delivery_distance_km(
                    v_location.latitude, v_location.longitude,
                    area.latitude, area.longitude
                ) AS distance_km
            ) AS distance
           WHERE provider.provider_type = 'independent_rider'
             AND provider.status = 'approved'
             AND provider.is_verified IS TRUE
             AND provider.accepts_workforce_engagements IS TRUE
             AND provider.country_code = v_location.country_code
             AND area.country_code = v_location.country_code
             AND area.is_active IS TRUE
             AND distance.distance_km <= area.coverage_radius_km
           ORDER BY provider.id, distance.distance_km
           LIMIT greatest(1, least(coalesce(p_limit, 30), 50))
      ) AS match_row;
    RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_available_riders_for_workforce(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_available_riders_for_workforce(UUID, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.shop_owner_list_rider_engagements(p_shop_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT public.shop_portal_owns_shop(p_shop_id) THEN
        RAISE EXCEPTION 'You do not own this shop' USING ERRCODE = '42501';
    END IF;
    RETURN (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id', engagement.id,
            'provider_id', provider.id,
            'rider_name', provider.display_name,
            'engagement_type', engagement.engagement_type,
            'status', engagement.status,
            'terms', engagement.terms,
            'start_date', engagement.start_date,
            'end_date', engagement.end_date,
            'created_at', engagement.created_at
        ) ORDER BY engagement.created_at DESC), '[]'::JSONB)
        FROM public.delivery_rider_engagements AS engagement
        JOIN public.delivery_providers AS provider ON provider.id = engagement.provider_id
        WHERE engagement.shop_id = p_shop_id
    );
END;
$$;
REVOKE ALL ON FUNCTION public.shop_owner_list_rider_engagements(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shop_owner_list_rider_engagements(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.shop_owner_invite_rider(
    p_shop_id UUID,
    p_provider_id UUID,
    p_engagement_type TEXT,
    p_terms JSONB,
    p_start_date DATE,
    p_end_date DATE DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_engagement_id UUID;
    v_provider_user UUID;
BEGIN
    IF auth.uid() IS NULL OR NOT public.shop_portal_owns_shop(p_shop_id) THEN
        RAISE EXCEPTION 'You do not own this shop' USING ERRCODE = '42501';
    END IF;
    IF p_engagement_type NOT IN ('temporary', 'permanent')
       OR p_start_date IS NULL
       OR (p_engagement_type = 'temporary'
           AND (p_end_date IS NULL OR p_end_date < p_start_date))
       OR (p_engagement_type = 'permanent' AND p_end_date IS NOT NULL)
       OR jsonb_typeof(coalesce(p_terms, '{}'::JSONB)) <> 'object'
       OR pg_column_size(coalesce(p_terms, '{}'::JSONB)) > 12000 THEN
        RAISE EXCEPTION 'Engagement type, dates, or terms are invalid' USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.get_available_riders_for_workforce(p_shop_id, 50) AS matched
        WHERE matched->>'provider_id' = p_provider_id::TEXT
    ) THEN
        RAISE EXCEPTION 'This verified rider is not accepting work in your shop area' USING ERRCODE = '23514';
    END IF;
    SELECT user_id INTO v_provider_user
    FROM public.delivery_providers
    WHERE id = p_provider_id
      AND provider_type = 'independent_rider'
      AND accepts_workforce_engagements IS TRUE;
    IF v_provider_user = auth.uid() THEN
        RAISE EXCEPTION 'You cannot hire your own provider account' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.delivery_rider_engagements
        WHERE shop_id = p_shop_id AND provider_id = p_provider_id
          AND status IN ('invited', 'accepted')
    ) THEN
        RAISE EXCEPTION 'An active or pending engagement already exists with this rider' USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.delivery_rider_engagements(
        shop_id, provider_id, created_by_user_id, engagement_type,
        status, terms, start_date, end_date
    )
    VALUES (
        p_shop_id, p_provider_id, auth.uid(), p_engagement_type,
        'invited', coalesce(p_terms, '{}'::JSONB), p_start_date, p_end_date
    )
    RETURNING id INTO v_engagement_id;
    RETURN v_engagement_id;
END;
$$;
REVOKE ALL ON FUNCTION public.shop_owner_invite_rider(UUID, UUID, TEXT, JSONB, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shop_owner_invite_rider(UUID, UUID, TEXT, JSONB, DATE, DATE) TO authenticated;

CREATE OR REPLACE FUNCTION public.delivery_provider_respond_to_engagement(
    p_engagement_id UUID,
    p_decision TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_decision NOT IN ('accepted', 'rejected') THEN
        RAISE EXCEPTION 'Choose accept or decline' USING ERRCODE = '22023';
    END IF;
    UPDATE public.delivery_rider_engagements AS engagement
       SET status = p_decision
      FROM public.delivery_providers AS provider
     WHERE engagement.id = p_engagement_id
       AND engagement.provider_id = provider.id
       AND provider.user_id = auth.uid()
       AND engagement.status = 'invited';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pending engagement invitation not found' USING ERRCODE = '42501';
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.delivery_provider_respond_to_engagement(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delivery_provider_respond_to_engagement(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.shop_owner_update_rider_engagement(
    p_engagement_id UUID,
    p_action TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_shop_id UUID;
BEGIN
    IF p_action NOT IN ('cancel', 'end') THEN
        RAISE EXCEPTION 'Choose cancel or end' USING ERRCODE = '22023';
    END IF;
    SELECT shop_id INTO v_shop_id
    FROM public.delivery_rider_engagements
    WHERE id = p_engagement_id;
    IF v_shop_id IS NULL OR NOT public.shop_portal_owns_shop(v_shop_id) THEN
        RAISE EXCEPTION 'Engagement not found for this shop' USING ERRCODE = '42501';
    END IF;
    UPDATE public.delivery_rider_engagements
       SET status = CASE WHEN p_action = 'end' THEN 'ended' ELSE 'cancelled' END
     WHERE id = p_engagement_id
       AND (
            (p_action = 'cancel' AND status = 'invited')
            OR (p_action = 'end' AND status = 'accepted')
       );
    IF NOT FOUND THEN
        RAISE EXCEPTION 'This engagement cannot be changed in its current state' USING ERRCODE = '23514';
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.shop_owner_update_rider_engagement(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shop_owner_update_rider_engagement(UUID, TEXT) TO authenticated;

-- Delivery requests remain order records, not rider employment records.
-- Recompute availability, coverage, fees and timing at assignment time.
CREATE OR REPLACE FUNCTION public.buyer_request_order_delivery(
    p_order_id UUID,
    p_provider_id UUID,
    p_service_area_id UUID,
    p_destination_latitude DOUBLE PRECISION,
    p_destination_longitude DOUBLE PRECISION,
    p_service_type TEXT DEFAULT 'standard'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_profile_id UUID;
    v_order public.orders%ROWTYPE;
    v_shop_id UUID;
    v_shop_count INTEGER;
    v_country_code TEXT;
    v_match JSONB;
    v_existing public.delivery_requests%ROWTYPE;
    v_request_id UUID;
    v_fee NUMERIC(12,2);
    v_platform_fee NUMERIC(12,2);
    v_total_fee NUMERIC(12,2);
    v_currency_per_usd NUMERIC(12,4);
    v_total_fee_usd NUMERIC(12,2);
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sign in to request a verified delivery provider' USING ERRCODE = '42501';
    END IF;
    SELECT profile.id INTO v_profile_id
    FROM public.profiles AS profile
    WHERE profile.user_id = auth.uid() OR profile.id = auth.uid()
    ORDER BY (profile.user_id = auth.uid()) DESC
    LIMIT 1;
    IF v_profile_id IS NULL THEN
        RAISE EXCEPTION 'A linked marketplace profile is required' USING ERRCODE = '42501';
    END IF;

    SELECT order_row.* INTO v_order
    FROM public.orders AS order_row
    WHERE order_row.id = p_order_id
      AND order_row.customer_id = v_profile_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order not found for this account' USING ERRCODE = '42501';
    END IF;
    IF v_order.status NOT IN ('pending', 'confirmed')
       OR v_order.payment_status <> 'pending' THEN
        RAISE EXCEPTION 'A delivery provider can be selected only before payment is confirmed or fulfilment starts' USING ERRCODE = '23514';
    END IF;

    SELECT min(item.shop_id), count(DISTINCT item.shop_id)
      INTO v_shop_id, v_shop_count
      FROM public.order_items AS item
     WHERE item.order_id = p_order_id;
    -- Use a separate integer to avoid trusting orders.shop_id when an order
    -- contains products from more than one seller.
    IF v_order.shop_id IS NULL OR v_order.shop_id IS DISTINCT FROM v_shop_id OR v_shop_count <> 1 THEN
        RAISE EXCEPTION 'Choose a delivery provider only for an order from one shop' USING ERRCODE = '23514';
    END IF;
    v_country_code := CASE WHEN lower(coalesce(v_order.region, 'ng')) = 'uk' THEN 'GB' ELSE 'NG' END;

    SELECT match_row INTO v_match
    FROM jsonb_array_elements(public.get_available_delivery_providers_for_shop(
        v_shop_id, p_destination_latitude, p_destination_longitude,
        v_country_code, p_service_type, 50
    )) AS match_row
    WHERE match_row->>'provider_id' = p_provider_id::TEXT
      AND match_row->>'service_area_id' = p_service_area_id::TEXT
    LIMIT 1;
    IF v_match IS NULL THEN
        RAISE EXCEPTION 'This provider is no longer available or does not cover both locations' USING ERRCODE = '23514';
    END IF;

    SELECT request.* INTO v_existing
    FROM public.delivery_requests AS request
    WHERE request.order_id = p_order_id
      AND request.status IN ('requested', 'accepted', 'picked_up', 'in_transit', 'issue_reported')
    FOR UPDATE;
    IF FOUND THEN
        IF v_existing.provider_id <> p_provider_id THEN
            RAISE EXCEPTION 'This order already has an active delivery request' USING ERRCODE = '23505';
        END IF;
        RETURN jsonb_build_object('request_id', v_existing.id, 'status', v_existing.status, 'already_requested', TRUE);
    END IF;

    v_fee := (v_match->>'provider_fee_amount')::NUMERIC;
    v_platform_fee := (v_match->>'platform_fee_amount')::NUMERIC;
    v_total_fee := (v_match->>'total_fee_amount')::NUMERIC;
    SELECT settings.currency_per_usd
      INTO v_currency_per_usd
      FROM public.delivery_platform_settings AS settings
     WHERE settings.country_code = v_country_code
       AND settings.is_enabled IS TRUE;
    IF v_currency_per_usd IS NULL OR v_currency_per_usd <= 0 THEN
        RAISE EXCEPTION 'Delivery pricing is not available for this market' USING ERRCODE = '23514';
    END IF;
    -- Order totals are stored in the platform's USD base units; the delivery
    -- request snapshot retains the buyer-facing NGN or GBP amounts.
    v_total_fee_usd := round(v_total_fee / v_currency_per_usd, 2);
    INSERT INTO public.delivery_requests(
        order_id, provider_id, service_area_id, buyer_user_id,
        destination_latitude, destination_longitude, distance_km,
        provider_fee_amount, platform_fee_amount, total_fee_amount,
        currency_code, currency_per_usd, commission_percent,
        eta_min_minutes, eta_max_minutes, status
    )
    VALUES (
        p_order_id, p_provider_id, p_service_area_id, auth.uid(),
        p_destination_latitude, p_destination_longitude,
        (v_match->>'distance_km')::NUMERIC, v_fee, v_platform_fee, v_total_fee,
        v_match->>'currency_code',
        v_currency_per_usd,
        (SELECT platform_commission_percent FROM public.delivery_platform_settings WHERE country_code = v_country_code),
        (v_match->>'eta_min_minutes')::INTEGER, (v_match->>'eta_max_minutes')::INTEGER,
        'requested'
    )
    RETURNING id INTO v_request_id;

    -- Apply the selected fee only while the existing offline order is unpaid.
    UPDATE public.orders
       SET shipping_cost = v_total_fee_usd,
           total = round(subtotal + tax + v_total_fee_usd, 2),
           updated_at = now()
     WHERE id = p_order_id
       AND customer_id = v_profile_id
       AND payment_status = 'pending';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order totals can no longer be changed' USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.delivery_request_events(request_id, actor_user_id, status)
    VALUES (v_request_id, auth.uid(), 'requested');
    RETURN jsonb_build_object(
        'request_id', v_request_id,
        'status', 'requested',
        'provider_name', v_match->>'display_name',
        'total_fee_amount', v_total_fee,
        'currency_code', v_match->>'currency_code',
        'eta_min_minutes', v_match->>'eta_min_minutes',
        'eta_max_minutes', v_match->>'eta_max_minutes'
    );
END;
$$;
REVOKE ALL ON FUNCTION public.buyer_request_order_delivery(
    UUID, UUID, UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buyer_request_order_delivery(
    UUID, UUID, UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT
) TO authenticated;

CREATE OR REPLACE FUNCTION public.buyer_get_order_delivery_request(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_profile_id UUID;
    v_result JSONB;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;
    SELECT profile.id INTO v_profile_id
    FROM public.profiles AS profile
    WHERE profile.user_id = auth.uid() OR profile.id = auth.uid()
    ORDER BY (profile.user_id = auth.uid()) DESC
    LIMIT 1;
    SELECT jsonb_build_object(
        'id', request.id,
        'status', request.status,
        'provider_name', provider.display_name,
        'provider_type', provider.provider_type,
        'total_fee_amount', request.total_fee_amount,
        'currency_code', request.currency_code,
        'eta_min_minutes', request.eta_min_minutes,
        'eta_max_minutes', request.eta_max_minutes,
        'response_note', request.response_note,
        'created_at', request.created_at,
        'updated_at', request.updated_at
    ) INTO v_result
    FROM public.delivery_requests AS request
    JOIN public.delivery_providers AS provider ON provider.id = request.provider_id
    JOIN public.orders AS order_row ON order_row.id = request.order_id
    WHERE request.order_id = p_order_id
      AND order_row.customer_id = v_profile_id;
    RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.buyer_get_order_delivery_request(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buyer_get_order_delivery_request(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.delivery_provider_update_request(
    p_provider_id UUID,
    p_request_id UUID,
    p_status TEXT,
    p_note TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_request public.delivery_requests%ROWTYPE;
    v_provider_id UUID;
    v_note TEXT := nullif(left(btrim(coalesce(p_note, '')), 1000), '');
    v_allowed BOOLEAN := FALSE;
BEGIN
    SELECT provider.id INTO v_provider_id
    FROM public.delivery_providers AS provider
    WHERE provider.id = p_provider_id
      AND provider.user_id = auth.uid()
      AND provider.status = 'approved'
      AND provider.is_verified IS TRUE;
    IF v_provider_id IS NULL THEN
        RAISE EXCEPTION 'Approved delivery provider access is required' USING ERRCODE = '42501';
    END IF;
    SELECT request.* INTO v_request
    FROM public.delivery_requests AS request
    WHERE request.id = p_request_id AND request.provider_id = v_provider_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Delivery request not found' USING ERRCODE = '42501';
    END IF;
    v_allowed := (v_request.status = 'requested' AND p_status IN ('accepted', 'rejected'))
        OR (v_request.status = 'accepted' AND p_status IN ('picked_up', 'cancelled'))
        OR (v_request.status = 'picked_up' AND p_status IN ('in_transit', 'issue_reported'))
        OR (v_request.status = 'in_transit' AND p_status IN ('delivered', 'issue_reported'))
        OR (v_request.status = 'issue_reported' AND p_status IN ('in_transit', 'delivered'));
    IF NOT v_allowed THEN
        RAISE EXCEPTION 'This delivery cannot move from % to %', v_request.status, p_status USING ERRCODE = '23514';
    END IF;
    IF p_status IN ('rejected', 'issue_reported') AND length(coalesce(v_note, '')) < 3 THEN
        RAISE EXCEPTION 'Add a short note explaining this update' USING ERRCODE = '22023';
    END IF;
    UPDATE public.delivery_requests
       SET status = p_status, response_note = v_note, updated_at = now()
     WHERE id = p_request_id;
    INSERT INTO public.delivery_request_events(request_id, actor_user_id, status, note)
    VALUES (p_request_id, auth.uid(), p_status, v_note);
END;
$$;
REVOKE ALL ON FUNCTION public.delivery_provider_update_request(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delivery_provider_update_request(UUID, UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.buyer_list_my_delivery_requests(p_limit INTEGER DEFAULT 50)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_profile_id UUID;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;
    SELECT profile.id INTO v_profile_id
      FROM public.profiles AS profile
     WHERE profile.user_id = auth.uid() OR profile.id = auth.uid()
     ORDER BY (profile.user_id = auth.uid()) DESC
     LIMIT 1;
    IF v_profile_id IS NULL THEN
        RAISE EXCEPTION 'A linked marketplace profile is required' USING ERRCODE = '42501';
    END IF;
    RETURN (
        SELECT coalesce(jsonb_agg(to_jsonb(delivery_row) ORDER BY delivery_row.created_at DESC), '[]'::JSONB)
        FROM (
            SELECT request.id AS request_id,
                   request.order_id,
                   order_row.order_number,
                   request.provider_id,
                   provider.display_name AS provider_name,
                   provider.provider_type,
                   request.status,
                   request.total_fee_amount,
                   request.currency_code,
                   request.eta_min_minutes,
                   request.eta_max_minutes,
                   request.response_note,
                   order_row.shipping_address->>'city' AS destination_city,
                   order_row.shipping_address->>'state' AS destination_region,
                   request.created_at,
                   request.updated_at,
                   coalesce((
                       SELECT jsonb_agg(jsonb_build_object(
                           'status', event.status,
                           'note', event.note,
                           'created_at', event.created_at
                       ) ORDER BY event.created_at)
                       FROM public.delivery_request_events AS event
                       WHERE event.request_id = request.id
                   ), '[]'::JSONB) AS events
              FROM public.delivery_requests AS request
              JOIN public.orders AS order_row ON order_row.id = request.order_id
              JOIN public.delivery_providers AS provider ON provider.id = request.provider_id
             WHERE order_row.customer_id = v_profile_id
             ORDER BY request.created_at DESC
             LIMIT greatest(1, least(coalesce(p_limit, 50), 100))
        ) AS delivery_row
    );
END;
$$;
REVOKE ALL ON FUNCTION public.buyer_list_my_delivery_requests(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buyer_list_my_delivery_requests(INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.shop_owner_list_delivery_requests(p_shop_id UUID, p_limit INTEGER DEFAULT 50)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT public.shop_portal_owns_shop(p_shop_id) THEN
        RAISE EXCEPTION 'You do not own this shop' USING ERRCODE = '42501';
    END IF;
    RETURN (
        SELECT coalesce(jsonb_agg(to_jsonb(delivery_row) ORDER BY delivery_row.created_at DESC), '[]'::JSONB)
        FROM (
            SELECT request.id AS request_id,
                   request.order_id,
                   order_row.order_number,
                   provider.display_name AS provider_name,
                   provider.provider_type,
                   request.status,
                   request.total_fee_amount,
                   request.currency_code,
                   request.distance_km,
                   request.eta_min_minutes,
                   request.eta_max_minutes,
                   request.response_note,
                   order_row.shipping_address->>'city' AS destination_city,
                   order_row.shipping_address->>'state' AS destination_region,
                   request.created_at,
                   request.updated_at,
                   coalesce((
                       SELECT jsonb_agg(jsonb_build_object(
                           'status', event.status,
                           'note', event.note,
                           'created_at', event.created_at
                       ) ORDER BY event.created_at)
                       FROM public.delivery_request_events AS event
                       WHERE event.request_id = request.id
                   ), '[]'::JSONB) AS events
              FROM public.delivery_requests AS request
              JOIN public.orders AS order_row ON order_row.id = request.order_id
              JOIN public.delivery_providers AS provider ON provider.id = request.provider_id
             WHERE order_row.shop_id = p_shop_id
             ORDER BY request.created_at DESC
             LIMIT greatest(1, least(coalesce(p_limit, 50), 100))
        ) AS delivery_row
    );
END;
$$;
REVOKE ALL ON FUNCTION public.shop_owner_list_delivery_requests(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shop_owner_list_delivery_requests(UUID, INTEGER) TO authenticated;

COMMIT;
