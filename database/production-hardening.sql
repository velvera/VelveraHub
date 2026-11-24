-- Secure browser checkout for static Cloudflare Pages storefronts.
-- Apply after schema.sql, seller.sql, supabase-rls.sql,
-- security-hardening.sql, and cloudflare-dashboard.sql. Apply before
-- shop-owner-payments.sql. Re-runnable and additive; it does not delete data.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS customer_email TEXT,
    ADD COLUMN IF NOT EXISTS region TEXT,
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_customer_email_created
    ON public.orders (lower(customer_email), created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS orders_idempotency_key
    ON public.orders (idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- Browser clients must use place_order_secure instead of writing order rows
-- directly. Seller/admin read policies are installed by the dashboard and
-- shop-owner migrations after this file.
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.orders, public.order_items
    FROM PUBLIC, anon, authenticated;
REVOKE SELECT ON public.orders, public.order_items FROM anon;
GRANT SELECT ON public.orders, public.order_items TO authenticated;

DROP FUNCTION IF EXISTS public.place_order_secure(JSONB, JSONB, JSONB, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.place_order_secure(
    p_customer JSONB,
    p_shipping JSONB,
    p_items JSONB,
    p_region TEXT DEFAULT 'ng',
    p_payment_method TEXT DEFAULT 'cash_on_delivery',
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_profile_id UUID;
    v_email TEXT;
    v_first_name TEXT;
    v_last_name TEXT;
    v_region TEXT := lower(trim(coalesce(p_region, 'ng')));
    v_payment_method TEXT := lower(trim(coalesce(p_payment_method, 'cash_on_delivery')));
    v_idempotency_key TEXT := nullif(trim(coalesce(p_idempotency_key, '')), '');
    v_product_id UUID;
    v_quantity INTEGER;
    v_seen UUID[] := ARRAY[]::UUID[];
    v_product RECORD;
    v_image_url TEXT;
    v_line_total NUMERIC(12,2);
    v_subtotal NUMERIC(12,2) := 0;
    v_shipping_cost NUMERIC(12,2);
    v_shipping_total NUMERIC(12,2);
    v_free_threshold NUMERIC(12,2);
    v_tax NUMERIC(12,2);
    v_total NUMERIC(12,2);
    v_order_id UUID;
    v_order_number TEXT;
    v_count INTEGER;
BEGIN
    IF jsonb_typeof(p_customer) <> 'object'
       OR jsonb_typeof(p_shipping) <> 'object'
       OR jsonb_typeof(p_items) <> 'array' THEN
        RAISE EXCEPTION 'Invalid order details' USING ERRCODE = '22023';
    END IF;

    v_email := lower(trim(coalesce(p_customer->>'email', '')));
    v_first_name := trim(coalesce(p_customer->>'firstName', ''));
    v_last_name := trim(coalesce(p_customer->>'lastName', ''));
    IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
       OR length(v_email) > 254 THEN
        RAISE EXCEPTION 'A valid customer email is required' USING ERRCODE = '22023';
    END IF;
    IF length(trim(coalesce(p_shipping->>'address', ''))) < 3
       OR length(trim(coalesce(p_shipping->>'city', ''))) < 2 THEN
        RAISE EXCEPTION 'A delivery address and city are required' USING ERRCODE = '22023';
    END IF;
    IF v_region NOT IN ('ng', 'uk') THEN
        RAISE EXCEPTION 'Unsupported market region' USING ERRCODE = '22023';
    END IF;
    IF v_payment_method NOT IN ('cash_on_delivery', 'bank_transfer') THEN
        RAISE EXCEPTION 'Unsupported payment method' USING ERRCODE = '22023';
    END IF;
    IF v_idempotency_key IS NULL
       OR length(v_idempotency_key) < 16 OR length(v_idempotency_key) > 128
       OR v_idempotency_key !~ '^[A-Za-z0-9._:-]+$' THEN
        RAISE EXCEPTION 'Invalid order idempotency key' USING ERRCODE = '22023';
    END IF;

    -- Serialise retries for the same key before checking and creating the
    -- order. This prevents two simultaneous requests from both reserving
    -- stock before the unique index is reached.
    PERFORM pg_advisory_xact_lock(hashtext(v_idempotency_key));
    SELECT id, order_number, subtotal, shipping_cost, tax, total, payment_status
    INTO v_order_id, v_order_number, v_subtotal, v_shipping_total,
         v_tax, v_total, v_payment_method
    FROM public.orders
    WHERE idempotency_key = v_idempotency_key
    LIMIT 1;
    IF FOUND THEN
        IF EXISTS (
            SELECT 1 FROM public.orders
            WHERE id = v_order_id AND lower(coalesce(customer_email, '')) <> v_email
        ) THEN
            RAISE EXCEPTION 'This order idempotency key belongs to another customer' USING ERRCODE = '23505';
        END IF;
        RETURN jsonb_build_object(
            'success', true,
            'orderId', v_order_id,
            'orderNumber', v_order_number,
            'subtotal', v_subtotal,
            'shipping_cost', v_shipping_total,
            'tax', v_tax,
            'total', v_total,
            'payment_status', 'pending',
            'idempotentReplay', true
        );
    END IF;

    SELECT count(*) INTO v_count FROM jsonb_array_elements(p_items);
    IF v_count < 1 OR v_count > 50 THEN
        RAISE EXCEPTION 'An order must contain between 1 and 50 items' USING ERRCODE = '22023';
    END IF;

    SELECT profile.id INTO v_profile_id
    FROM public.profiles AS profile
    WHERE profile.user_id = auth.uid() OR profile.id = auth.uid()
    ORDER BY (profile.user_id = auth.uid()) DESC
    LIMIT 1;

    FOR v_product_id, v_quantity IN
        SELECT (item->>'product_id')::UUID, (item->>'quantity')::INTEGER
        FROM jsonb_array_elements(p_items) AS item
    LOOP
        IF v_product_id = ANY(v_seen) THEN
            RAISE EXCEPTION 'Duplicate products are not allowed in an order' USING ERRCODE = '22023';
        END IF;
        v_seen := array_append(v_seen, v_product_id);
        IF v_quantity < 1 OR v_quantity > 99 THEN
            RAISE EXCEPTION 'Each item quantity must be between 1 and 99' USING ERRCODE = '22023';
        END IF;

        SELECT product.id, product.title, product.price, product.stock, product.shop_id,
               shop.status AS shop_status,
               shop.verified AS shop_verified
        INTO v_product
        FROM public.products AS product
        LEFT JOIN public.shops AS shop ON shop.id = product.shop_id
        WHERE product.id = v_product_id
          AND product.status = 'active'
          AND coalesce(product.stock, 0) > 0
        FOR UPDATE OF product;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'One of the products is no longer available' USING ERRCODE = 'P0002';
        END IF;
        IF v_product.stock < v_quantity THEN
            RAISE EXCEPTION '% does not have enough stock', v_product.title USING ERRCODE = 'P0001';
        END IF;

        v_line_total := round(v_product.price * v_quantity, 2);
        v_subtotal := round(v_subtotal + v_line_total, 2);
    END LOOP;

    IF v_payment_method = 'bank_transfer'
       AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements(p_items) AS item
            JOIN public.products AS product
              ON product.id = (item->>'product_id')::UUID
            LEFT JOIN public.shops AS shop ON shop.id = product.shop_id
            WHERE product.shop_id IS NULL
               OR shop.status <> 'active'
               OR shop.verified IS NOT TRUE
       ) THEN
        RAISE EXCEPTION
            'Bank transfer is available only for active, verified shops. Choose pay on delivery.'
            USING ERRCODE = '23514';
    END IF;

    -- These market values mirror the existing server-side offline checkout.
    v_shipping_cost := CASE WHEN v_region = 'ng' THEN 0.56 ELSE 3.99 END;
    v_free_threshold := CASE WHEN v_region = 'ng' THEN 5000.0 / 900.0 ELSE 30.0 / 0.79 END;
    v_shipping_total := CASE WHEN v_subtotal >= v_free_threshold THEN 0 ELSE v_shipping_cost END;
    v_tax := round(v_subtotal * 0.075, 2);
    v_total := round(v_subtotal + v_shipping_total + v_tax, 2);
    v_order_number := 'VH-' || to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD') || '-' ||
        upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 8));

    INSERT INTO public.orders (
        order_number, idempotency_key, customer_id, shop_id, customer_email, region,
        subtotal, shipping_cost, tax, total, shipping_address,
        payment_method, status, payment_status, notes
    )
    VALUES (
        v_order_number,
        v_idempotency_key,
        v_profile_id,
        (SELECT (array_agg(DISTINCT product.shop_id))[1]
         FROM public.products AS product
         WHERE product.id = ANY(v_seen)
         HAVING count(DISTINCT product.shop_id) = 1),
        v_email,
        v_region,
        v_subtotal,
        v_shipping_total,
        v_tax,
        v_total,
        p_shipping,
        v_payment_method,
        'pending',
        'pending',
        concat_ws(' ', nullif(v_first_name, ''), nullif(v_last_name, ''))
    )
    RETURNING id INTO v_order_id;

    FOR v_product_id, v_quantity IN
        SELECT (item->>'product_id')::UUID, (item->>'quantity')::INTEGER
        FROM jsonb_array_elements(p_items) AS item
    LOOP
        SELECT product.id, product.title, product.price, product.shop_id
        INTO v_product
        FROM public.products AS product
        WHERE product.id = v_product_id;

        SELECT image.url INTO v_image_url
        FROM public.product_images AS image
        WHERE image.product_id = v_product_id
        ORDER BY image.is_primary DESC, image.display_order ASC
        LIMIT 1;

        INSERT INTO public.order_items (
            order_id, product_id, shop_id, title, price, quantity, total, image_url
        )
        VALUES (
            v_order_id, v_product.id, v_product.shop_id, v_product.title,
            v_product.price, v_quantity, round(v_product.price * v_quantity, 2), v_image_url
        );

        UPDATE public.products
        SET stock = stock - v_quantity,
            status = CASE WHEN stock - v_quantity <= 0 THEN 'out_of_stock' ELSE status END,
            updated_at = now()
        WHERE id = v_product_id;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'orderId', v_order_id,
        'orderNumber', v_order_number,
        'subtotal', v_subtotal,
        'shipping_cost', v_shipping_total,
        'tax', v_tax,
        'total', v_total,
        'payment_status', 'pending'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.place_order_secure(JSONB, JSONB, JSONB, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.place_order_secure(JSONB, JSONB, JSONB, TEXT, TEXT, TEXT) TO anon, authenticated;