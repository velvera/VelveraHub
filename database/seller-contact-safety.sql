-- Public seller contact preferences and safer offline checkout rules.
-- Apply after schema.sql, supabase-rls.sql, production-hardening.sql,
-- shop-owner-payments.sql, and shop-verification-compliance.sql.
-- Contact details are seller-controlled, opt-in, and are not payment credentials.

BEGIN;

ALTER TABLE public.shops
    ADD COLUMN IF NOT EXISTS other_contact_label TEXT,
    ADD COLUMN IF NOT EXISTS other_contact_url TEXT;

CREATE TABLE IF NOT EXISTS public.seller_public_contacts (
    seller_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    public_email TEXT,
    public_phone TEXT,
    whatsapp TEXT,
    instagram TEXT,
    facebook TEXT,
    twitter TEXT,
    other_contact_label TEXT,
    other_contact_url TEXT,
    is_public BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT seller_public_contacts_email_length
        CHECK (public_email IS NULL OR length(public_email) <= 254),
    CONSTRAINT seller_public_contacts_phone_length
        CHECK (public_phone IS NULL OR length(public_phone) <= 50),
    CONSTRAINT seller_public_contacts_whatsapp_length
        CHECK (whatsapp IS NULL OR length(whatsapp) <= 180),
    CONSTRAINT seller_public_contacts_social_length
        CHECK (
            (instagram IS NULL OR length(instagram) <= 255)
            AND (facebook IS NULL OR length(facebook) <= 255)
            AND (twitter IS NULL OR length(twitter) <= 255)
        ),
    CONSTRAINT seller_public_contacts_other_label_length
        CHECK (other_contact_label IS NULL OR length(other_contact_label) <= 40),
    CONSTRAINT seller_public_contacts_other_url_https
        CHECK (
            other_contact_url IS NULL
            OR (
                length(other_contact_url) <= 500
                AND other_contact_url ~* '^https://[^[:space:]]+$'
            )
        )
);

ALTER TABLE public.seller_public_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS seller_public_contacts_owner_read
    ON public.seller_public_contacts;
CREATE POLICY seller_public_contacts_owner_read
ON public.seller_public_contacts FOR SELECT TO authenticated
USING (seller_id = auth.uid());

DROP POLICY IF EXISTS seller_public_contacts_public_read
    ON public.seller_public_contacts;
CREATE POLICY seller_public_contacts_public_read
ON public.seller_public_contacts FOR SELECT TO anon, authenticated
USING (
    is_public
    AND EXISTS (
        SELECT 1
        FROM public.products AS product
        WHERE product.seller_id = seller_public_contacts.seller_id
          AND product.shop_id IS NULL
          AND product.status = 'active'
    )
);

DROP POLICY IF EXISTS seller_public_contacts_owner_insert
    ON public.seller_public_contacts;
CREATE POLICY seller_public_contacts_owner_insert
ON public.seller_public_contacts FOR INSERT TO authenticated
WITH CHECK (seller_id = auth.uid());

DROP POLICY IF EXISTS seller_public_contacts_owner_update
    ON public.seller_public_contacts;
CREATE POLICY seller_public_contacts_owner_update
ON public.seller_public_contacts FOR UPDATE TO authenticated
USING (seller_id = auth.uid())
WITH CHECK (seller_id = auth.uid());

DROP POLICY IF EXISTS seller_public_contacts_owner_delete
    ON public.seller_public_contacts;
CREATE POLICY seller_public_contacts_owner_delete
ON public.seller_public_contacts FOR DELETE TO authenticated
USING (seller_id = auth.uid());

REVOKE ALL ON public.seller_public_contacts FROM PUBLIC;
GRANT SELECT ON public.seller_public_contacts TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.seller_public_contacts TO authenticated;

-- Sellers without an approved shop may not request bank-transfer checkout.
-- The trigger evaluates the actual order item/shop rows, not cart data from
-- the browser, so API callers cannot bypass the rule.
CREATE OR REPLACE FUNCTION public.enforce_verified_shop_bank_transfer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_payment_method TEXT;
    v_product_shop_id UUID;
    v_listing_type TEXT;
BEGIN
    SELECT payment_method
      INTO v_payment_method
      FROM public.orders
     WHERE id = NEW.order_id;

    SELECT product.shop_id, product.listing_type
      INTO v_product_shop_id, v_listing_type
      FROM public.products AS product
     WHERE product.id = NEW.product_id;

    IF lower(trim(coalesce(v_payment_method, ''))) = 'bank_transfer'
       AND (
            coalesce(v_listing_type, 'shop') <> 'shop'
            OR v_product_shop_id IS NULL
             OR v_product_shop_id IS DISTINCT FROM NEW.shop_id
            OR NOT EXISTS (
                SELECT 1
                  FROM public.shops AS shop
                 WHERE shop.id = v_product_shop_id
                   AND shop.status = 'active'
                   AND shop.verified IS TRUE
            )
       ) THEN
        RAISE EXCEPTION
            'Bank transfer is available only for active, verified shops. Choose pay on delivery.'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_verified_shop_bank_transfer
    ON public.order_items;
CREATE TRIGGER enforce_verified_shop_bank_transfer
BEFORE INSERT OR UPDATE ON public.order_items
FOR EACH ROW
EXECUTE FUNCTION public.enforce_verified_shop_bank_transfer();

-- Also protect the order row itself. The deferred trigger permits the secure
-- checkout RPC to insert the order before its items, then rejects empty,
-- non-shop, or unverified bank-transfer orders at transaction commit. It also
-- covers a later attempt to change an existing order to bank_transfer.
CREATE OR REPLACE FUNCTION public.enforce_verified_shop_bank_transfer_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.assert_verified_shop_bank_transfer_order(NEW.id);
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_verified_shop_bank_transfer_order(
    p_order_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.orders AS order_row
        WHERE order_row.id = p_order_id
          AND lower(trim(coalesce(order_row.payment_method, ''))) = 'bank_transfer'
    ) THEN
        RETURN;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.order_items AS item
        WHERE item.order_id = p_order_id
    ) THEN
        RAISE EXCEPTION
            'Bank-transfer orders must contain at least one shop listing.'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.order_items AS item
        JOIN public.products AS product
          ON product.id = item.product_id
        LEFT JOIN public.shops AS shop
          ON shop.id = product.shop_id
        WHERE item.order_id = p_order_id
          AND (
              coalesce(product.listing_type, 'shop') <> 'shop'
              OR product.shop_id IS NULL
              OR item.shop_id IS DISTINCT FROM product.shop_id
              OR shop.status <> 'active'
              OR shop.verified IS NOT TRUE
          )
    ) THEN
        RAISE EXCEPTION
            'Bank transfer is available only for active, verified shops. Choose pay on delivery.'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

DROP TRIGGER IF EXISTS enforce_verified_shop_bank_transfer_order
    ON public.orders;
CREATE CONSTRAINT TRIGGER enforce_verified_shop_bank_transfer_order
AFTER INSERT OR UPDATE OF payment_method ON public.orders
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.enforce_verified_shop_bank_transfer_order();

-- Re-check the parent order after any item insert, update, or delete. The
-- deferred check matters when checkout inserts an order before its items and
-- also prevents deleting the last item from a bank-transfer order.
CREATE OR REPLACE FUNCTION public.enforce_verified_shop_bank_transfer_items()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP <> 'DELETE' THEN
        PERFORM public.assert_verified_shop_bank_transfer_order(NEW.order_id);
    END IF;

    IF TG_OP <> 'INSERT'
       AND (TG_OP = 'DELETE' OR OLD.order_id IS DISTINCT FROM NEW.order_id) THEN
        PERFORM public.assert_verified_shop_bank_transfer_order(OLD.order_id);
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_verified_shop_bank_transfer_items
    ON public.order_items;
CREATE CONSTRAINT TRIGGER enforce_verified_shop_bank_transfer_items
AFTER INSERT OR UPDATE OR DELETE ON public.order_items
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.enforce_verified_shop_bank_transfer_items();

REVOKE ALL ON FUNCTION public.assert_verified_shop_bank_transfer_order(UUID)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_verified_shop_bank_transfer_order()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_verified_shop_bank_transfer_items()
    FROM PUBLIC, anon, authenticated;

COMMIT;