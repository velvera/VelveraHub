-- KYC-gated manual payment routing for VelveraHub marketplace orders.
-- Apply after the migrations in database/run-schema.txt. No provider card or
-- wallet payments are enabled by this file.

ALTER TABLE public.shops
    ADD COLUMN IF NOT EXISTS manual_payment_preference TEXT NOT NULL DEFAULT 'velverahub',
    ADD COLUMN IF NOT EXISTS manual_payment_method TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS manual_payment_instructions TEXT NOT NULL DEFAULT '';

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS payment_details JSONB,
    ADD COLUMN IF NOT EXISTS payment_confirmed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS payment_confirmed_by UUID;

CREATE TABLE IF NOT EXISTS public.order_manual_payment_confirmations (
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE RESTRICT,
    recipient_type TEXT NOT NULL CHECK (recipient_type IN ('velverahub', 'seller')),
    payment_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (payment_status IN ('pending', 'paid')),
    confirmed_at TIMESTAMPTZ,
    confirmed_by UUID,
    PRIMARY KEY (order_id, shop_id),
    CHECK (
        (payment_status = 'pending' AND confirmed_at IS NULL AND confirmed_by IS NULL)
        OR (payment_status = 'paid' AND confirmed_at IS NOT NULL AND confirmed_by IS NOT NULL)
    )
);
ALTER TABLE public.order_manual_payment_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_manual_payment_confirmations FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_orders_pending_manual_payment
    ON public.orders (created_at)
    WHERE payment_status = 'pending'
      AND lower(trim(coalesce(payment_method, ''))) IN ('bank_transfer', 'manual_payment');

ALTER TABLE public.shops
    DROP CONSTRAINT IF EXISTS shops_manual_payment_preference_check,
    ADD CONSTRAINT shops_manual_payment_preference_check
        CHECK (manual_payment_preference IN ('velverahub', 'seller_direct')),
    DROP CONSTRAINT IF EXISTS shops_manual_payment_details_length_check,
    ADD CONSTRAINT shops_manual_payment_details_length_check CHECK (
        char_length(manual_payment_method) <= 80
        AND char_length(manual_payment_instructions) <= 1200
    );

CREATE TABLE IF NOT EXISTS public.marketplace_payment_destinations (
    region TEXT PRIMARY KEY CHECK (region IN ('ng', 'uk')),
    bank_name TEXT NOT NULL DEFAULT '',
    account_name TEXT NOT NULL DEFAULT '',
    account_number TEXT NOT NULL DEFAULT '',
    sort_code TEXT NOT NULL DEFAULT '',
    instructions TEXT NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT marketplace_payment_destination_text_length_check CHECK (
        char_length(bank_name) <= 120
        AND char_length(account_name) <= 160
        AND char_length(account_number) <= 80
        AND char_length(sort_code) <= 40
        AND char_length(instructions) <= 1200
    ),
    CONSTRAINT marketplace_payment_destination_enabled_check CHECK (
        NOT enabled
        OR (
            length(trim(bank_name)) > 0
            AND length(trim(account_name)) > 0
            AND length(trim(account_number)) > 0
            AND (region <> 'uk' OR length(trim(sort_code)) > 0)
        )
    )
);

ALTER TABLE public.marketplace_payment_destinations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketplace_payment_destinations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.marketplace_payment_destinations TO anon, authenticated;

DROP POLICY IF EXISTS marketplace_payment_destination_public_read
    ON public.marketplace_payment_destinations;
CREATE POLICY marketplace_payment_destination_public_read
ON public.marketplace_payment_destinations FOR SELECT TO anon, authenticated
USING (enabled IS TRUE OR public.current_profile_role() = 'admin');

DROP POLICY IF EXISTS marketplace_payment_destination_admin_manage
    ON public.marketplace_payment_destinations;
CREATE POLICY marketplace_payment_destination_admin_manage
ON public.marketplace_payment_destinations FOR ALL TO authenticated
USING (public.current_profile_role() = 'admin')
WITH CHECK (public.current_profile_role() = 'admin');

CREATE OR REPLACE FUNCTION public.admin_save_marketplace_payment_destination(
    p_region TEXT,
    p_enabled BOOLEAN,
    p_bank_name TEXT,
    p_account_name TEXT,
    p_account_number TEXT,
    p_sort_code TEXT DEFAULT '',
    p_instructions TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_region TEXT := lower(trim(coalesce(p_region, '')));
    v_enabled BOOLEAN := coalesce(p_enabled, FALSE);
    v_bank_name TEXT := trim(coalesce(p_bank_name, ''));
    v_account_name TEXT := trim(coalesce(p_account_name, ''));
    v_account_number TEXT := trim(coalesce(p_account_number, ''));
    v_sort_code TEXT := trim(coalesce(p_sort_code, ''));
    v_instructions TEXT := trim(coalesce(p_instructions, ''));
    v_saved JSONB;
BEGIN
    IF public.current_profile_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Administrator access is required to manage marketplace payment details';
    END IF;
    IF v_region NOT IN ('ng', 'uk') THEN
        RAISE EXCEPTION 'Choose Nigeria or United Kingdom';
    END IF;
    IF v_enabled AND (
        length(v_bank_name) = 0
        OR length(v_account_name) = 0
        OR length(v_account_number) = 0
        OR (v_region = 'uk' AND length(v_sort_code) = 0)
    ) THEN
        RAISE EXCEPTION 'Enter complete bank details before enabling manual payments';
    END IF;
    IF length(v_bank_name) > 120
       OR length(v_account_name) > 160
       OR length(v_account_number) > 80
       OR length(v_sort_code) > 40
       OR length(v_instructions) > 1200 THEN
        RAISE EXCEPTION 'One or more payment fields exceed the allowed length';
    END IF;

    INSERT INTO public.marketplace_payment_destinations (
        region, bank_name, account_name, account_number, sort_code,
        instructions, enabled, updated_at
    )
    VALUES (
        v_region, v_bank_name, v_account_name, v_account_number, v_sort_code,
        v_instructions, v_enabled, now()
    )
    ON CONFLICT (region) DO UPDATE SET
        bank_name = EXCLUDED.bank_name,
        account_name = EXCLUDED.account_name,
        account_number = EXCLUDED.account_number,
        sort_code = EXCLUDED.sort_code,
        instructions = EXCLUDED.instructions,
        enabled = EXCLUDED.enabled,
        updated_at = now()
    RETURNING jsonb_build_object(
        'region', region,
        'bank_name', bank_name,
        'account_name', account_name,
        'account_number', account_number,
        'sort_code', sort_code,
        'instructions', instructions,
        'enabled', enabled,
        'updated_at', updated_at
    ) INTO v_saved;

    RETURN v_saved;
END;
$$;

CREATE OR REPLACE FUNCTION public.shop_owner_save_manual_payment_preferences(
    p_shop_id UUID,
    p_preference TEXT,
    p_method TEXT DEFAULT '',
    p_instructions TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_preference TEXT := lower(trim(coalesce(p_preference, '')));
    v_method TEXT := trim(coalesce(p_method, ''));
    v_instructions TEXT := trim(coalesce(p_instructions, ''));
BEGIN
    IF auth.uid() IS NULL OR NOT public.shop_portal_owns_shop(p_shop_id) THEN
        RAISE EXCEPTION 'Sign in to the account that owns this shop';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM public.shops AS shop
        JOIN public.shop_verification_submissions AS verification
          ON verification.shop_id = shop.id
        WHERE shop.id = p_shop_id
          AND shop.status = 'active'
          AND shop.verified IS TRUE
          AND verification.status = 'approved'
    ) THEN
        RAISE EXCEPTION 'Manual payment preferences are available only to shops with approved KYC';
    END IF;
    IF v_preference NOT IN ('velverahub', 'seller_direct') THEN
        RAISE EXCEPTION 'Choose the VelveraHub account or your own payment method';
    END IF;
    IF v_preference = 'seller_direct'
       AND (
            length(v_method) < 2
            OR length(v_method) > 80
            OR length(v_instructions) < 10
            OR length(v_instructions) > 1200
       ) THEN
        RAISE EXCEPTION 'Enter a payment method and clear payment instructions';
    END IF;
    IF length(v_instructions) > 1200 OR length(v_method) > 80 THEN
        RAISE EXCEPTION 'One or more payment fields exceed the allowed length';
    END IF;

    UPDATE public.shops
       SET manual_payment_preference = v_preference,
           manual_payment_method = CASE WHEN v_preference = 'seller_direct' THEN v_method ELSE '' END,
           manual_payment_instructions = CASE WHEN v_preference = 'seller_direct' THEN v_instructions ELSE '' END,
           updated_at = now()
     WHERE id = p_shop_id;

    RETURN jsonb_build_object(
        'preference', v_preference,
        'method', CASE WHEN v_preference = 'seller_direct' THEN v_method ELSE '' END
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_shop_manual_payment_preferences()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.manual_payment_preference IS NOT DISTINCT FROM OLD.manual_payment_preference
       AND NEW.manual_payment_method IS NOT DISTINCT FROM OLD.manual_payment_method
       AND NEW.manual_payment_instructions IS NOT DISTINCT FROM OLD.manual_payment_instructions THEN
        RETURN NEW;
    END IF;

    IF public.current_profile_role() = 'admin' THEN
        RETURN NEW;
    END IF;
    IF NEW.manual_payment_preference NOT IN ('velverahub', 'seller_direct')
       OR NOT EXISTS (
            SELECT 1
            FROM public.shop_verification_submissions AS verification
            WHERE verification.shop_id = NEW.id
              AND verification.status = 'approved'
       )
       OR NEW.status <> 'active'
       OR NEW.verified IS NOT TRUE THEN
        RAISE EXCEPTION 'Only an active shop with approved KYC can change manual payment preferences';
    END IF;
    IF NEW.manual_payment_preference = 'seller_direct'
       AND (
            length(trim(NEW.manual_payment_method)) < 2
            OR length(trim(NEW.manual_payment_instructions)) < 10
       ) THEN
        RAISE EXCEPTION 'A seller payment method and instructions are required';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_shop_manual_payment_preferences
    ON public.shops;
CREATE TRIGGER guard_shop_manual_payment_preferences
BEFORE UPDATE OF manual_payment_preference, manual_payment_method, manual_payment_instructions
ON public.shops
FOR EACH ROW
EXECUTE FUNCTION public.guard_shop_manual_payment_preferences();

CREATE OR REPLACE FUNCTION public.capture_order_manual_payment_details()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order_id UUID;
    v_region TEXT;
    v_payment_method TEXT;
    v_shop RECORD;
    v_destination RECORD;
    v_destinations JSONB := '[]'::JSONB;
    v_detail JSONB;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_order_id := OLD.order_id;
    ELSE
        v_order_id := NEW.order_id;
    END IF;

    SELECT lower(coalesce(order_row.region, 'ng')),
           lower(trim(coalesce(order_row.payment_method, '')))
      INTO v_region, v_payment_method
      FROM public.orders AS order_row
     WHERE order_row.id = v_order_id;

    IF NOT FOUND OR v_payment_method NOT IN ('bank_transfer', 'manual_payment') THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.order_items AS item
        JOIN public.products AS product ON product.id = item.product_id
        LEFT JOIN public.shops AS shop ON shop.id = product.shop_id
        LEFT JOIN public.shop_verification_submissions AS verification
          ON verification.shop_id = shop.id
        WHERE item.order_id = v_order_id
          AND (
              coalesce(product.listing_type, 'shop') <> 'shop'
              OR product.shop_id IS NULL
              OR item.shop_id IS DISTINCT FROM product.shop_id
              OR shop.status <> 'active'
              OR shop.verified IS NOT TRUE
              OR verification.status <> 'approved'
          )
    ) THEN
        RAISE EXCEPTION 'Manual payment is available only for active, KYC-approved shop listings';
    END IF;

    FOR v_shop IN
        SELECT shop.id, shop.name,
               shop.manual_payment_preference,
               shop.manual_payment_method,
               shop.manual_payment_instructions,
               coalesce(sum(item.total), 0) AS shop_total
        FROM public.order_items AS item
        JOIN public.products AS product ON product.id = item.product_id
        JOIN public.shops AS shop ON shop.id = product.shop_id
        JOIN public.shop_verification_submissions AS verification
          ON verification.shop_id = shop.id
        WHERE item.order_id = v_order_id
          AND verification.status = 'approved'
        GROUP BY shop.id, shop.name, shop.manual_payment_preference,
                 shop.manual_payment_method, shop.manual_payment_instructions
        ORDER BY shop.id
    LOOP
        IF v_shop.manual_payment_preference = 'seller_direct' THEN
            IF length(trim(coalesce(v_shop.manual_payment_method, ''))) < 2
               OR length(trim(coalesce(v_shop.manual_payment_instructions, ''))) < 10 THEN
                RAISE EXCEPTION 'A KYC-approved seller has incomplete payment instructions';
            END IF;
            v_detail := jsonb_build_object(
                'recipient_type', 'seller',
                'shop_id', v_shop.id,
                'shop_name', v_shop.name,
                'shop_total', v_shop.shop_total,
                'method', v_shop.manual_payment_method,
                'instructions', v_shop.manual_payment_instructions
            );
        ELSE
            SELECT destination.bank_name, destination.account_name,
                   destination.account_number, destination.sort_code,
                   destination.instructions
              INTO v_destination
              FROM public.marketplace_payment_destinations AS destination
             WHERE destination.region = v_region
               AND destination.enabled IS TRUE;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'VelveraHub manual payment is not configured for this market';
            END IF;
            v_detail := jsonb_build_object(
                'recipient_type', 'velverahub',
                'shop_id', v_shop.id,
                'shop_name', v_shop.name,
                'shop_total', v_shop.shop_total,
                'method', 'Bank transfer',
                'bank_name', v_destination.bank_name,
                'account_name', v_destination.account_name,
                'account_number', v_destination.account_number,
                'sort_code', v_destination.sort_code,
                'instructions', v_destination.instructions
            );
        END IF;
        v_destinations := v_destinations || jsonb_build_array(v_detail);
    END LOOP;

    IF jsonb_array_length(v_destinations) = 0 THEN
        RAISE EXCEPTION 'Manual payment requires at least one KYC-approved shop listing';
    END IF;

    DELETE FROM public.order_manual_payment_confirmations AS confirmation
     WHERE confirmation.order_id = v_order_id
       AND NOT EXISTS (
            SELECT 1
            FROM public.order_items AS item
            JOIN public.products AS product ON product.id = item.product_id
            WHERE item.order_id = v_order_id
              AND product.shop_id = confirmation.shop_id
       );

    INSERT INTO public.order_manual_payment_confirmations AS existing (
        order_id, shop_id, recipient_type, payment_status, confirmed_at, confirmed_by
    )
    SELECT v_order_id,
           (destination.value->>'shop_id')::UUID,
           destination.value->>'recipient_type',
           'pending',
           NULL,
           NULL
    FROM jsonb_array_elements(v_destinations) AS destination(value)
    ON CONFLICT (order_id, shop_id) DO UPDATE SET
        recipient_type = EXCLUDED.recipient_type,
        payment_status = CASE
            WHEN existing.recipient_type IS DISTINCT FROM EXCLUDED.recipient_type THEN 'pending'
            ELSE existing.payment_status
        END,
        confirmed_at = CASE
            WHEN existing.recipient_type IS DISTINCT FROM EXCLUDED.recipient_type THEN NULL
            ELSE existing.confirmed_at
        END,
        confirmed_by = CASE
            WHEN existing.recipient_type IS DISTINCT FROM EXCLUDED.recipient_type THEN NULL
            ELSE existing.confirmed_by
        END;

    UPDATE public.orders
       SET payment_details = jsonb_build_object(
            'region', v_region,
            'destinations', v_destinations,
            'notice', 'This order remains pending until every payment recipient confirms receipt. The shown amounts are item subtotals; agree on delivery cost and timing with the seller in chat. Avoid paying in advance, including for delivery.'
       )
     WHERE id = v_order_id;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS capture_order_manual_payment_details
    ON public.order_items;
CREATE TRIGGER capture_order_manual_payment_details
AFTER INSERT OR UPDATE OR DELETE ON public.order_items
FOR EACH ROW
EXECUTE FUNCTION public.capture_order_manual_payment_details();

CREATE OR REPLACE FUNCTION public.require_order_manual_payment_details()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_payment_method TEXT;
    v_payment_details JSONB;
BEGIN
    SELECT lower(trim(coalesce(order_row.payment_method, ''))),
           order_row.payment_details
      INTO v_payment_method, v_payment_details
      FROM public.orders AS order_row
     WHERE order_row.id = NEW.id;
    IF NOT FOUND OR v_payment_method NOT IN ('bank_transfer', 'manual_payment') THEN
        RETURN NEW;
    END IF;
    IF v_payment_details IS NULL
       OR jsonb_typeof(v_payment_details->'destinations') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Manual payment orders require configured payment instructions';
    END IF;
    IF jsonb_array_length(v_payment_details->'destinations') = 0 THEN
        RAISE EXCEPTION 'Manual payment orders require configured payment instructions';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS require_order_manual_payment_details
    ON public.orders;
CREATE CONSTRAINT TRIGGER require_order_manual_payment_details
AFTER INSERT OR UPDATE ON public.orders
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.require_order_manual_payment_details();

CREATE OR REPLACE FUNCTION public.get_order_manual_payment_details(p_order_id UUID)
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT order_row.payment_details || jsonb_build_object(
        'payment_status', order_row.payment_status,
        'order_status', order_row.status
    )
    FROM public.orders AS order_row
    WHERE order_row.id = p_order_id
      AND lower(trim(coalesce(order_row.payment_method, '')))
          IN ('bank_transfer', 'manual_payment')
      AND order_row.payment_details IS NOT NULL
      AND order_row.status NOT IN ('cancelled', 'refunded');
$$;

CREATE OR REPLACE FUNCTION public.admin_list_pending_platform_manual_payments()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_orders JSONB;
BEGIN
    IF public.current_profile_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Administrator access is required to review marketplace payments';
    END IF;

    SELECT coalesce(
        jsonb_agg(
            jsonb_build_object(
                'id', pending.id,
                'order_number', pending.order_number,
                'region', pending.region,
                'order_total', pending.order_total,
                'total', pending.platform_total,
                'created_at', pending.created_at,
                'payment_details', jsonb_build_object(
                    'destinations', pending.platform_destinations,
                    'notice', pending.payment_notice
                )
            )
            ORDER BY pending.created_at
        ),
        '[]'::JSONB
    )
    INTO v_orders
    FROM (
        SELECT order_row.id,
               order_row.order_number,
               order_row.region,
               order_row.total AS order_total,
               order_row.created_at,
               order_row.payment_details->>'notice' AS payment_notice,
               coalesce(
                   sum(coalesce((destination.value->>'shop_total')::NUMERIC, 0)),
                   0
               ) AS platform_total,
               jsonb_agg(destination.value ORDER BY destination.value->>'shop_name')
                   AS platform_destinations
        FROM public.orders AS order_row
        CROSS JOIN LATERAL jsonb_array_elements(
            CASE
                WHEN jsonb_typeof(order_row.payment_details->'destinations') = 'array'
                THEN order_row.payment_details->'destinations'
                ELSE '[]'::JSONB
            END
        ) AS destination(value)
        WHERE order_row.payment_status = 'pending'
          AND lower(trim(coalesce(order_row.payment_method, '')))
              IN ('bank_transfer', 'manual_payment')
          AND destination.value->>'recipient_type' = 'velverahub'
          AND EXISTS (
              SELECT 1
              FROM public.order_manual_payment_confirmations AS confirmation
              WHERE confirmation.order_id = order_row.id
                AND confirmation.shop_id = (destination.value->>'shop_id')::UUID
                AND confirmation.recipient_type = 'velverahub'
                AND confirmation.payment_status = 'pending'
          )
          AND order_row.status NOT IN ('cancelled', 'refunded')
        GROUP BY order_row.id, order_row.order_number, order_row.region,
                 order_row.total, order_row.created_at, order_row.payment_details
        ORDER BY order_row.created_at
        LIMIT 100
    ) AS pending;

    RETURN v_orders;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_confirm_platform_manual_payment(
    p_order_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order RECORD;
    v_confirmed_count INTEGER;
    v_has_pending BOOLEAN;
BEGIN
    IF public.current_profile_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Administrator access is required to confirm marketplace payments';
    END IF;

    SELECT order_row.id, order_row.order_number, order_row.status,
           order_row.payment_status, order_row.payment_method,
           order_row.payment_details
      INTO v_order
      FROM public.orders AS order_row
     WHERE order_row.id = p_order_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order was not found';
    END IF;
    IF lower(trim(coalesce(v_order.payment_method, '')))
        NOT IN ('bank_transfer', 'manual_payment')
       OR v_order.payment_status <> 'pending'
       OR v_order.status IN ('cancelled', 'refunded')
       OR v_order.payment_details IS NULL THEN
        RAISE EXCEPTION 'Only pending manual-payment orders can be confirmed here';
    END IF;

    UPDATE public.order_manual_payment_confirmations AS confirmation
       SET payment_status = 'paid',
           confirmed_at = now(),
           confirmed_by = auth.uid()
     WHERE confirmation.order_id = p_order_id
       AND confirmation.recipient_type = 'velverahub'
       AND confirmation.payment_status = 'pending';
    GET DIAGNOSTICS v_confirmed_count = ROW_COUNT;
    IF v_confirmed_count = 0 THEN
        RAISE EXCEPTION 'No pending VelveraHub payment was found for this order';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.order_manual_payment_confirmations AS confirmation
        WHERE confirmation.order_id = p_order_id
          AND confirmation.payment_status = 'pending'
    ) INTO v_has_pending;

    IF NOT v_has_pending THEN
        UPDATE public.orders
           SET payment_status = 'paid',
               payment_confirmed_at = now(),
               payment_confirmed_by = auth.uid(),
               status = CASE WHEN status = 'pending' THEN 'confirmed' ELSE status END,
               updated_at = now()
         WHERE id = p_order_id;
    END IF;

    RETURN jsonb_build_object(
        'order_id', p_order_id,
        'order_number', v_order.order_number,
        'payment_status', CASE WHEN v_has_pending THEN 'pending' ELSE 'paid' END,
        'order_confirmed', NOT v_has_pending,
        'confirmed_at', now()
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.shop_owner_list_pending_manual_payment_orders(
    p_shop_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_orders JSONB;
BEGIN
    IF auth.uid() IS NULL OR NOT public.shop_portal_owns_shop(p_shop_id) THEN
        RAISE EXCEPTION 'Sign in to the account that owns this shop';
    END IF;

    SELECT coalesce(
        jsonb_agg(
            jsonb_build_object(
                'id', order_row.id,
                'order_number', order_row.order_number,
                'status', order_row.status,
                'payment_status', order_row.payment_status,
                'created_at', order_row.created_at,
                'payment', destination.value
            )
            ORDER BY order_row.created_at
        ),
        '[]'::JSONB
    )
    INTO v_orders
    FROM public.orders AS order_row
    JOIN public.order_manual_payment_confirmations AS confirmation
      ON confirmation.order_id = order_row.id
     AND confirmation.shop_id = p_shop_id
     AND confirmation.recipient_type = 'seller'
     AND confirmation.payment_status = 'pending'
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE
            WHEN jsonb_typeof(order_row.payment_details->'destinations') = 'array'
            THEN order_row.payment_details->'destinations'
            ELSE '[]'::JSONB
        END
    ) AS destination(value)
    WHERE order_row.payment_status = 'pending'
      AND order_row.status NOT IN ('cancelled', 'refunded')
      AND destination.value->>'recipient_type' = 'seller'
      AND destination.value->>'shop_id' = p_shop_id::TEXT;

    RETURN v_orders;
END;
$$;

CREATE OR REPLACE FUNCTION public.shop_owner_confirm_manual_payment_receipt(
    p_order_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order RECORD;
    v_confirmed_count INTEGER;
    v_has_pending BOOLEAN;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sign in to confirm a seller-direct payment';
    END IF;
    SELECT order_row.id, order_row.order_number, order_row.status,
           order_row.payment_status, order_row.payment_method
      INTO v_order
      FROM public.orders AS order_row
     WHERE order_row.id = p_order_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order was not found';
    END IF;
    IF v_order.payment_status <> 'pending'
       OR lower(trim(coalesce(v_order.payment_method, '')))
          NOT IN ('bank_transfer', 'manual_payment')
       OR v_order.status IN ('cancelled', 'refunded') THEN
        RAISE EXCEPTION 'This order is not awaiting manual payment';
    END IF;

    UPDATE public.order_manual_payment_confirmations AS confirmation
       SET payment_status = 'paid',
           confirmed_at = now(),
           confirmed_by = auth.uid()
     WHERE confirmation.order_id = p_order_id
       AND confirmation.recipient_type = 'seller'
       AND confirmation.payment_status = 'pending'
       AND public.shop_portal_owns_shop(confirmation.shop_id);
    GET DIAGNOSTICS v_confirmed_count = ROW_COUNT;
    IF v_confirmed_count = 0 THEN
        RAISE EXCEPTION 'No pending seller-direct payment for your shop was found';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.order_manual_payment_confirmations AS confirmation
        WHERE confirmation.order_id = p_order_id
          AND confirmation.payment_status = 'pending'
    ) INTO v_has_pending;

    IF NOT v_has_pending THEN
        UPDATE public.orders
           SET payment_status = 'paid',
               payment_confirmed_at = now(),
               payment_confirmed_by = auth.uid(),
               status = CASE WHEN status = 'pending' THEN 'confirmed' ELSE status END,
               updated_at = now()
         WHERE id = p_order_id;
    END IF;

    RETURN jsonb_build_object(
        'order_id', p_order_id,
        'order_number', v_order.order_number,
        'payment_status', CASE WHEN v_has_pending THEN 'pending' ELSE 'paid' END,
        'order_confirmed', NOT v_has_pending
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_marketplace_payment_destination(
    TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.shop_owner_save_manual_payment_preferences(
    UUID, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_order_manual_payment_details(UUID)
    FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_pending_platform_manual_payments()
    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_confirm_platform_manual_payment(UUID)
    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.shop_owner_list_pending_manual_payment_orders(UUID)
    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.shop_owner_confirm_manual_payment_receipt(UUID)
    FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_save_marketplace_payment_destination(
    TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shop_owner_save_manual_payment_preferences(
    UUID, TEXT, TEXT, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_order_manual_payment_details(UUID)
    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_pending_platform_manual_payments()
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_confirm_platform_manual_payment(UUID)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.shop_owner_list_pending_manual_payment_orders(UUID)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.shop_owner_confirm_manual_payment_receipt(UUID)
    TO authenticated;

COMMIT;
