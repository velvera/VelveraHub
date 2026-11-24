-- Optional Nigerian phone verification. The feature is deliberately disabled
-- at installation and is only activated through the authenticated Edge
-- Function after Termii configuration has been checked.
-- Apply after migrations 1-18 in database/run-schema.txt (migration 19).

BEGIN;

ALTER TABLE public.marketplace_settings
    ADD COLUMN IF NOT EXISTS phone_verification_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS phone_verification_restore_product_images_public BOOLEAN,
    ADD COLUMN IF NOT EXISTS phone_verification_restore_product_videos_public BOOLEAN;

INSERT INTO public.marketplace_settings (id, product_image_limit, phone_verification_enabled)
VALUES (1, 10, FALSE)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.marketplace_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.marketplace_settings FROM PUBLIC, anon, authenticated;

UPDATE public.marketplace_settings
   SET phone_verification_enabled = FALSE
 WHERE id = 1
   AND phone_verification_enabled IS NULL;

-- Older installations of this feature enabled private buckets before storing
-- their previous state. The base marketplace migration creates both buckets
-- public, so use that original mode when upgrading an already-enabled install.
UPDATE public.marketplace_settings
   SET phone_verification_restore_product_images_public =
           COALESCE(phone_verification_restore_product_images_public, TRUE),
       phone_verification_restore_product_videos_public =
           COALESCE(phone_verification_restore_product_videos_public, TRUE)
 WHERE id = 1
   AND phone_verification_enabled IS TRUE;

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS phone_e164 TEXT,
    ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conrelid = 'public.profiles'::regclass
           AND conname = 'profiles_phone_e164_ng_mobile'
    ) THEN
        ALTER TABLE public.profiles
            ADD CONSTRAINT profiles_phone_e164_ng_mobile
            CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+234[789][0-9]{9}$');
    END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_phone_e164_unique
    ON public.profiles (phone_e164)
    WHERE phone_e164 IS NOT NULL;

-- OTP values are held and verified by Termii. This private table stores only
-- provider references, timing/attempt state, and a single-use signup ticket.
CREATE TABLE IF NOT EXISTS public.phone_verification_challenges (
    phone_e164 TEXT PRIMARY KEY
        CHECK (phone_e164 ~ '^\+234[789][0-9]{9}$'),
    email TEXT,
    auth_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    termii_pin_id TEXT,
    attempt_count SMALLINT NOT NULL DEFAULT 0
        CHECK (attempt_count BETWEEN 0 AND 5),
    sent_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    resend_after TIMESTAMPTZ NOT NULL,
    verified_at TIMESTAMPTZ,
    signup_ticket TEXT,
    ticket_expires_at TIMESTAMPTZ,
    ticket_consumed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ticket_consumed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT phone_verification_challenge_target
        CHECK (email IS NOT NULL OR auth_user_id IS NOT NULL)
);

ALTER TABLE public.phone_verification_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.phone_verification_challenges FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.phone_verification_challenges TO service_role;

CREATE OR REPLACE FUNCTION public.get_phone_verification_enabled()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
    SELECT COALESCE(settings.phone_verification_enabled, FALSE)
      FROM public.marketplace_settings AS settings
     WHERE settings.id = 1
$function$;

REVOKE ALL ON FUNCTION public.get_phone_verification_enabled() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_phone_verification_enabled() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_phone_verification_media_restore_state()
RETURNS JSONB
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
    image_public BOOLEAN;
    video_public BOOLEAN;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Server access required' USING ERRCODE = '42501';
    END IF;

    SELECT settings.phone_verification_restore_product_images_public,
           settings.phone_verification_restore_product_videos_public
      INTO image_public, video_public
      FROM public.marketplace_settings AS settings
     WHERE settings.id = 1;

    RETURN jsonb_build_object(
        'saved', image_public IS NOT NULL AND video_public IS NOT NULL,
        'product_images_public', image_public,
        'product_videos_public', video_public
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_phone_verification_media_restore_state() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_phone_verification_media_restore_state() TO service_role;

CREATE OR REPLACE FUNCTION public.phone_verification_reserve(
    p_phone_e164 TEXT,
    p_email TEXT DEFAULT NULL,
    p_auth_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
    normalized_phone TEXT := btrim(COALESCE(p_phone_e164, ''));
    normalized_email TEXT := NULLIF(lower(btrim(COALESCE(p_email, ''))), '');
    challenge public.phone_verification_challenges%ROWTYPE;
    seconds_left INTEGER;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Server access required' USING ERRCODE = '42501';
    END IF;
    IF NOT public.get_phone_verification_enabled() THEN
        RETURN jsonb_build_object('ok', FALSE, 'code', 'disabled');
    END IF;
    IF normalized_phone !~ '^\+234[789][0-9]{9}$' THEN
        RETURN jsonb_build_object('ok', FALSE, 'code', 'invalid_phone');
    END IF;
    IF p_auth_user_id IS NULL AND normalized_email IS NULL THEN
        RETURN jsonb_build_object('ok', FALSE, 'code', 'invalid_target');
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(normalized_phone));

    IF EXISTS (
        SELECT 1
          FROM public.profiles AS profile
         WHERE profile.phone_e164 = normalized_phone
           AND (p_auth_user_id IS NULL
                OR (profile.user_id IS DISTINCT FROM p_auth_user_id
                    AND profile.id IS DISTINCT FROM p_auth_user_id))
    ) THEN
        RETURN jsonb_build_object('ok', FALSE, 'code', 'phone_in_use');
    END IF;

    SELECT *
      INTO challenge
      FROM public.phone_verification_challenges AS stored
     WHERE stored.phone_e164 = normalized_phone
     FOR UPDATE;

    IF FOUND AND challenge.resend_after > now() THEN
        seconds_left := GREATEST(1, CEIL(EXTRACT(EPOCH FROM challenge.resend_after - now()))::INTEGER);
        RETURN jsonb_build_object(
            'ok', FALSE,
            'code', 'cooldown',
            'retry_after_seconds', seconds_left
        );
    END IF;

    INSERT INTO public.phone_verification_challenges (
        phone_e164, email, auth_user_id, termii_pin_id, attempt_count,
        sent_at, expires_at, resend_after, verified_at, signup_ticket,
        ticket_expires_at, ticket_consumed_by, ticket_consumed_at, updated_at
    )
    VALUES (
        normalized_phone, normalized_email, p_auth_user_id, NULL, 0,
        now(), now() + interval '5 minutes', now() + interval '60 seconds',
        NULL, NULL, NULL, NULL, NULL, now()
    )
    ON CONFLICT (phone_e164) DO UPDATE SET
        email = EXCLUDED.email,
        auth_user_id = EXCLUDED.auth_user_id,
        termii_pin_id = NULL,
        attempt_count = 0,
        sent_at = EXCLUDED.sent_at,
        expires_at = EXCLUDED.expires_at,
        resend_after = EXCLUDED.resend_after,
        verified_at = NULL,
        signup_ticket = NULL,
        ticket_expires_at = NULL,
        ticket_consumed_by = NULL,
        ticket_consumed_at = NULL,
        updated_at = now();

    RETURN jsonb_build_object(
        'ok', TRUE,
        'expires_in_seconds', 300,
        'resend_after_seconds', 60
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.phone_verification_store_pin(
    p_phone_e164 TEXT,
    p_email TEXT,
    p_auth_user_id UUID,
    p_termii_pin_id TEXT
)
RETURNS BOOLEAN
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Server access required' USING ERRCODE = '42501';
    END IF;
    IF NOT public.get_phone_verification_enabled() THEN
        RETURN FALSE;
    END IF;

    UPDATE public.phone_verification_challenges AS challenge
       SET termii_pin_id = NULLIF(btrim(COALESCE(p_termii_pin_id, '')), ''),
           updated_at = now()
     WHERE challenge.phone_e164 = p_phone_e164
       AND challenge.email IS NOT DISTINCT FROM NULLIF(lower(btrim(COALESCE(p_email, ''))), '')
       AND challenge.auth_user_id IS NOT DISTINCT FROM p_auth_user_id
       AND challenge.resend_after > now()
       AND challenge.expires_at > now();

    RETURN FOUND AND NULLIF(btrim(COALESCE(p_termii_pin_id, '')), '') IS NOT NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.phone_verification_begin_attempt(
    p_phone_e164 TEXT,
    p_email TEXT,
    p_auth_user_id UUID
)
RETURNS JSONB
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
    challenge public.phone_verification_challenges%ROWTYPE;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Server access required' USING ERRCODE = '42501';
    END IF;
    IF NOT public.get_phone_verification_enabled() THEN
        RETURN jsonb_build_object('ok', FALSE, 'code', 'disabled');
    END IF;

    SELECT *
      INTO challenge
      FROM public.phone_verification_challenges AS stored
     WHERE stored.phone_e164 = p_phone_e164
       AND stored.email IS NOT DISTINCT FROM NULLIF(lower(btrim(COALESCE(p_email, ''))), '')
       AND stored.auth_user_id IS NOT DISTINCT FROM p_auth_user_id
     FOR UPDATE;

    IF NOT FOUND OR challenge.termii_pin_id IS NULL THEN
        RETURN jsonb_build_object('ok', FALSE, 'code', 'not_found');
    END IF;
    IF challenge.expires_at <= now() THEN
        RETURN jsonb_build_object('ok', FALSE, 'code', 'expired');
    END IF;
    IF challenge.attempt_count >= 5 THEN
        RETURN jsonb_build_object('ok', FALSE, 'code', 'attempts_exceeded');
    END IF;

    UPDATE public.phone_verification_challenges AS stored
       SET attempt_count = stored.attempt_count + 1,
           updated_at = now()
     WHERE stored.phone_e164 = p_phone_e164;

    RETURN jsonb_build_object(
        'ok', TRUE,
        'pin_id', challenge.termii_pin_id,
        'attempt_number', challenge.attempt_count + 1,
        'attempts_remaining', 4 - challenge.attempt_count
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.phone_verification_complete_signup(
    p_phone_e164 TEXT,
    p_email TEXT,
    p_signup_ticket TEXT
)
RETURNS BOOLEAN
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Server access required' USING ERRCODE = '42501';
    END IF;
    IF NOT public.get_phone_verification_enabled() THEN
        RETURN FALSE;
    END IF;

    UPDATE public.phone_verification_challenges AS challenge
       SET verified_at = now(),
           signup_ticket = p_signup_ticket,
           ticket_expires_at = now() + interval '15 minutes',
           ticket_consumed_by = NULL,
           ticket_consumed_at = NULL,
           updated_at = now()
     WHERE challenge.phone_e164 = p_phone_e164
       AND challenge.email = lower(btrim(COALESCE(p_email, '')))
       AND challenge.auth_user_id IS NULL
       AND challenge.termii_pin_id IS NOT NULL
       AND challenge.expires_at > now()
       AND challenge.attempt_count BETWEEN 1 AND 5
       AND challenge.verified_at IS NULL;

    RETURN FOUND;
END;
$function$;

CREATE OR REPLACE FUNCTION public.phone_verification_complete_update(
    p_phone_e164 TEXT,
    p_auth_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
    profile_key UUID;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Server access required' USING ERRCODE = '42501';
    END IF;
    IF NOT public.get_phone_verification_enabled() THEN
        RETURN FALSE;
    END IF;
    IF NOT EXISTS (
        SELECT 1
          FROM public.phone_verification_challenges AS challenge
         WHERE challenge.phone_e164 = p_phone_e164
           AND challenge.auth_user_id = p_auth_user_id
           AND challenge.termii_pin_id IS NOT NULL
           AND challenge.expires_at > now()
           AND challenge.attempt_count BETWEEN 1 AND 5
           AND challenge.verified_at IS NULL
    ) THEN
        RETURN FALSE;
    END IF;

    SELECT profile.id
      INTO profile_key
      FROM public.profiles AS profile
     WHERE profile.user_id = p_auth_user_id OR profile.id = p_auth_user_id
     ORDER BY (profile.user_id = p_auth_user_id) DESC
     LIMIT 1
     FOR UPDATE;
    IF profile_key IS NULL THEN
        RETURN FALSE;
    END IF;

    UPDATE public.profiles
       SET phone = p_phone_e164,
           phone_e164 = p_phone_e164,
           phone_verified = TRUE,
           phone_verified_at = now(),
           updated_at = now()
     WHERE id = profile_key;

    UPDATE public.phone_verification_challenges AS challenge
       SET verified_at = now(),
           updated_at = now()
     WHERE challenge.phone_e164 = p_phone_e164
       AND challenge.auth_user_id = p_auth_user_id;

    RETURN TRUE;
EXCEPTION
    WHEN unique_violation THEN
        RETURN FALSE;
END;
$function$;

DROP FUNCTION IF EXISTS public.admin_update_phone_verification(BOOLEAN);
CREATE OR REPLACE FUNCTION public.admin_update_phone_verification(
    p_enabled BOOLEAN,
    p_product_images_public BOOLEAN DEFAULT NULL,
    p_product_videos_public BOOLEAN DEFAULT NULL
)
RETURNS JSONB
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
    was_enabled BOOLEAN;
    image_public BOOLEAN;
    video_public BOOLEAN;
BEGIN
    -- This RPC is Edge-Function-only. That function verifies the actual
    -- administrator session and checks Termii configuration before enabling.
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Server access required' USING ERRCODE = '42501';
    END IF;

    SELECT settings.phone_verification_enabled,
           settings.phone_verification_restore_product_images_public,
           settings.phone_verification_restore_product_videos_public
      INTO was_enabled, image_public, video_public
      FROM public.marketplace_settings AS settings
     WHERE settings.id = 1
     FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', FALSE, 'code', 'settings_not_found');
    END IF;

    IF COALESCE(p_enabled, FALSE) THEN
        IF NOT was_enabled AND (p_product_images_public IS NULL OR p_product_videos_public IS NULL) THEN
            RAISE EXCEPTION 'Original product-media settings are required before activation'
                USING ERRCODE = '22023';
        END IF;
        UPDATE public.marketplace_settings
           SET phone_verification_enabled = TRUE,
               phone_verification_restore_product_images_public =
                   CASE WHEN was_enabled THEN image_public ELSE p_product_images_public END,
               phone_verification_restore_product_videos_public =
                   CASE WHEN was_enabled THEN video_public ELSE p_product_videos_public END,
               updated_at = now()
         WHERE id = 1;
    ELSE
        UPDATE public.marketplace_settings
           SET phone_verification_enabled = FALSE,
               updated_at = now()
         WHERE id = 1;
    END IF;

    RETURN jsonb_build_object(
        'ok', TRUE,
        'enabled', COALESCE(p_enabled, FALSE),
        'media_state_saved', image_public IS NOT NULL AND video_public IS NOT NULL,
        'product_images_public', image_public,
        'product_videos_public', video_public
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.phone_verification_reserve(TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.phone_verification_store_pin(TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.phone_verification_begin_attempt(TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.phone_verification_complete_signup(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.phone_verification_complete_update(TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_update_phone_verification(BOOLEAN, BOOLEAN, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phone_verification_reserve(TEXT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.phone_verification_store_pin(TEXT, TEXT, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.phone_verification_begin_attempt(TEXT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.phone_verification_complete_signup(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.phone_verification_complete_update(TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_phone_verification(BOOLEAN, BOOLEAN, BOOLEAN) TO service_role;

-- Supabase Auth signup tickets are single-use, short-lived, bound to the
-- normalized email and phone, and stripped before auth metadata is persisted.
CREATE OR REPLACE FUNCTION public.enforce_phone_verification_signup()
RETURNS TRIGGER
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
    feature_enabled BOOLEAN := public.get_phone_verification_enabled();
    signup_phone TEXT := NULLIF(btrim(COALESCE(NEW.raw_user_meta_data ->> 'phone_e164', '')), '');
    signup_ticket TEXT := NULLIF(btrim(COALESCE(NEW.raw_user_meta_data ->> 'phone_verification_ticket', '')), '');
    matched_phone TEXT;
BEGIN
    IF feature_enabled THEN
        IF NEW.email IS NULL OR signup_phone IS NULL OR signup_ticket IS NULL THEN
            RAISE EXCEPTION 'Phone verification is required before registration'
                USING ERRCODE = '23514';
        END IF;

        SELECT challenge.phone_e164
          INTO matched_phone
          FROM public.phone_verification_challenges AS challenge
         WHERE challenge.phone_e164 = signup_phone
           AND challenge.email = lower(NEW.email)
           AND challenge.auth_user_id IS NULL
           AND challenge.signup_ticket = signup_ticket
           AND challenge.verified_at IS NOT NULL
           AND challenge.ticket_expires_at > now()
           AND challenge.ticket_consumed_at IS NULL
         FOR UPDATE;

        IF matched_phone IS NULL THEN
            RAISE EXCEPTION 'Phone verification is required before registration'
                USING ERRCODE = '23514';
        END IF;

        UPDATE public.phone_verification_challenges
           SET ticket_consumed_by = NEW.id,
               ticket_consumed_at = now(),
               updated_at = now()
         WHERE phone_e164 = matched_phone;
    ELSIF signup_ticket IS NOT NULL AND signup_phone IS NOT NULL AND NEW.email IS NOT NULL THEN
        SELECT challenge.phone_e164
          INTO matched_phone
          FROM public.phone_verification_challenges AS challenge
         WHERE challenge.phone_e164 = signup_phone
           AND challenge.email = lower(NEW.email)
           AND challenge.auth_user_id IS NULL
           AND challenge.signup_ticket = signup_ticket
           AND challenge.verified_at IS NOT NULL
           AND challenge.ticket_expires_at > now()
           AND challenge.ticket_consumed_at IS NULL
         FOR UPDATE;
        IF matched_phone IS NOT NULL THEN
            UPDATE public.phone_verification_challenges
               SET ticket_consumed_by = NEW.id,
                   ticket_consumed_at = now(),
                   updated_at = now()
             WHERE phone_e164 = matched_phone;
        END IF;
    END IF;

    -- The one-time proof must not persist in user_metadata or be returned by
    -- later auth/user requests. Verification state is written to profiles.
    NEW.raw_user_meta_data := COALESCE(NEW.raw_user_meta_data, '{}'::JSONB)
        - 'phone_verification_ticket';
    IF NOT feature_enabled THEN
        NEW.raw_user_meta_data := NEW.raw_user_meta_data - 'phone_e164';
    END IF;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_phone_verification_signup ON auth.users;
CREATE TRIGGER enforce_phone_verification_signup
    BEFORE INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_phone_verification_signup();

CREATE OR REPLACE FUNCTION public.apply_verified_phone_after_signup()
RETURNS TRIGGER
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
    verified_phone TEXT;
BEGIN
    SELECT challenge.phone_e164
      INTO verified_phone
      FROM public.phone_verification_challenges AS challenge
     WHERE challenge.ticket_consumed_by = NEW.id
       AND challenge.ticket_consumed_at IS NOT NULL
       AND challenge.verified_at IS NOT NULL
     LIMIT 1;

    IF verified_phone IS NOT NULL THEN
        UPDATE public.profiles AS profile
           SET phone = verified_phone,
               phone_e164 = verified_phone,
               phone_verified = TRUE,
               phone_verified_at = now(),
               updated_at = now()
         WHERE profile.user_id = NEW.id OR profile.id = NEW.id;
    END IF;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS zz_apply_verified_phone_after_signup ON auth.users;
CREATE TRIGGER zz_apply_verified_phone_after_signup
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.apply_verified_phone_after_signup();

-- Phone state can only be changed by the trusted Edge Function or the
-- server-owned auth signup trigger. Browser profile updates cannot set it.
CREATE OR REPLACE FUNCTION public.protect_profile_security_fields()
RETURNS TRIGGER
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        IF auth.uid() IS NOT NULL THEN
            IF public.get_phone_verification_enabled() THEN
                -- Once the feature is active, a number can only be changed by
                -- the trusted OTP function.
                NEW.phone := OLD.phone;
                NEW.phone_e164 := OLD.phone_e164;
                NEW.phone_verified := OLD.phone_verified;
                NEW.phone_verified_at := OLD.phone_verified_at;
            ELSIF NEW.phone IS DISTINCT FROM OLD.phone THEN
                -- Keep legacy phone editing available while disabled, but do
                -- not carry a verification proof over to a different number.
                NEW.phone_e164 := NULL;
                NEW.phone_verified := FALSE;
                NEW.phone_verified_at := NULL;
            ELSE
                NEW.phone_e164 := OLD.phone_e164;
                NEW.phone_verified := OLD.phone_verified;
                NEW.phone_verified_at := OLD.phone_verified_at;
            END IF;
        END IF;

        IF public.current_profile_role() IS DISTINCT FROM 'admin' THEN
            NEW.id := OLD.id;
            NEW.user_id := OLD.user_id;
            NEW.email := OLD.email;
            NEW.account_type := OLD.account_type;
            NEW.role := OLD.role;
            IF to_jsonb(OLD) ? 'password_hash' THEN
                NEW.password_hash := OLD.password_hash;
            END IF;
            IF to_jsonb(OLD) ? 'deleted_at' THEN
                NEW.deleted_at := OLD.deleted_at;
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- Product visibility follows the existing active + approved rule while the
-- feature is off. Once enabled, approved listings and active KYC-approved
-- shops remain public; other active listings require confirmed email and a
-- server-owned verified phone.
CREATE OR REPLACE FUNCTION public.phone_verification_product_is_public(p_product_id UUID)
RETURNS BOOLEAN
LANGUAGE PLPGSQL
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
    product_row public.products%ROWTYPE;
    feature_enabled BOOLEAN;
    seller_auth_id UUID;
BEGIN
    SELECT product.*
      INTO product_row
      FROM public.products AS product
     WHERE product.id = p_product_id;
    IF NOT FOUND
       OR product_row.status IS DISTINCT FROM 'active'
       OR product_row.moderation_status = 'rejected'
       OR COALESCE(product_row.stock, 0) <= 0 THEN
        RETURN FALSE;
    END IF;

    -- Preserve the existing public product policy while disabled: shop
    -- listings must still belong to an active shop, and listings must have
    -- stock. The feature must not broaden or narrow the old public catalog.
    IF product_row.listing_type = 'shop'
       AND NOT EXISTS (
           SELECT 1
             FROM public.shops AS shop
            WHERE shop.id = product_row.shop_id
              AND shop.status = 'active'
       ) THEN
        RETURN FALSE;
    END IF;

    feature_enabled := public.get_phone_verification_enabled();

    IF product_row.moderation_status = 'approved' THEN
        RETURN TRUE;
    END IF;
    IF NOT feature_enabled THEN
        RETURN FALSE;
    END IF;

    -- A shop listing still needs the existing KYC approval. Independent
    -- seller listings can become public as soon as email and phone are
    -- verified.
    IF product_row.listing_type = 'shop' THEN
        RETURN EXISTS (
            SELECT 1
              FROM public.shops AS shop
             WHERE shop.id = product_row.shop_id
               AND shop.status = 'active'
               AND shop.verified IS TRUE
        );
    END IF;

    SELECT COALESCE(
        (
            SELECT profile.user_id
              FROM public.profiles AS profile
             WHERE profile.user_id = product_row.seller_id
                OR profile.id = product_row.seller_id
             ORDER BY (profile.user_id = product_row.seller_id) DESC
             LIMIT 1
        ),
        (
            SELECT profile.user_id
              FROM public.shops AS shop
              JOIN public.profiles AS profile
                ON profile.id = shop.current_owner_id
                OR profile.id = shop.owner_id
                OR profile.user_id = shop.current_owner_id
                OR profile.user_id = shop.owner_id
             WHERE shop.id = product_row.shop_id
             ORDER BY (profile.user_id = shop.current_owner_id) DESC
             LIMIT 1
        ),
        product_row.seller_id
    )
    INTO seller_auth_id;

    RETURN seller_auth_id IS NOT NULL
       AND EXISTS (
            SELECT 1
              FROM public.profiles AS profile
              JOIN auth.users AS auth_user
                ON auth_user.id = COALESCE(profile.user_id, profile.id)
             WHERE (profile.user_id = seller_auth_id OR profile.id = seller_auth_id)
               AND profile.phone_verified IS TRUE
               AND auth_user.email_confirmed_at IS NOT NULL
       );
END;
$function$;

-- The original image-record policy also required an active shop for shop
-- media. Keep that rule, then apply the same verified-seller visibility
-- predicate used by public product details.
CREATE OR REPLACE FUNCTION public.phone_verification_product_media_is_public(p_product_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
    SELECT CASE
        -- Preserve the existing product-image row policy while disabled.
        -- This deliberately does not impose the product-list stock filter.
        WHEN NOT public.get_phone_verification_enabled() THEN EXISTS (
            SELECT 1
              FROM public.products AS product
             WHERE product.id = p_product_id
               AND product.status = 'active'
               AND product.moderation_status = 'approved'
               AND (
                   product.listing_type <> 'shop'
                   OR EXISTS (
                       SELECT 1
                         FROM public.shops AS shop
                        WHERE shop.id = product.shop_id
                          AND shop.status = 'active'
                   )
               )
        )
        ELSE public.phone_verification_product_is_public(p_product_id)
    END
$function$;

REVOKE ALL ON FUNCTION public.phone_verification_product_is_public(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.phone_verification_product_is_public(UUID) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.phone_verification_product_media_is_public(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.phone_verification_product_media_is_public(UUID) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "public can read active products" ON public.products;
CREATE POLICY "public can read active products"
ON public.products FOR SELECT
TO anon, authenticated
USING (public.phone_verification_product_is_public(id));

DROP POLICY IF EXISTS "public can read product images" ON public.product_images;
CREATE POLICY "public can read product images"
ON public.product_images FOR SELECT
TO anon, authenticated
USING (public.phone_verification_product_media_is_public(product_id));

-- Both product-media buckets are private while verification is enabled.
-- Signed URLs can be created only for an eligible public listing or by its
-- authenticated owner; the Edge Function toggles bucket mode around the
-- server-side feature flag.
DROP POLICY IF EXISTS "public can read eligible product media objects" ON storage.objects;
CREATE POLICY "public can read eligible product media objects"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (
    bucket_id IN ('product-images', 'product-videos')
    -- Private buckets must not become publicly readable again after
    -- deactivation. Public buckets continue serving known URLs on their own.
    AND public.get_phone_verification_enabled()
    AND CASE
        WHEN pg_catalog.split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN public.phone_verification_product_media_is_public(
            pg_catalog.split_part(name, '/', 1)::UUID
        )
        ELSE FALSE
    END
);

DROP POLICY IF EXISTS "owners can read their product media objects" ON storage.objects;
CREATE POLICY "owners can read their product media objects"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id IN ('product-images', 'product-videos')
    AND CASE
        WHEN pg_catalog.split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN public.can_manage_product_media(
            pg_catalog.split_part(name, '/', 1)::UUID
        )
        ELSE FALSE
    END
);

DROP POLICY IF EXISTS "public can read verified seller contact" ON public.seller_public_contacts;
CREATE POLICY "public can read verified seller contact"
ON public.seller_public_contacts FOR SELECT
TO anon, authenticated
USING (
    is_public
    AND CASE
        -- Keep the pre-feature contact visibility unchanged while disabled.
        WHEN NOT public.get_phone_verification_enabled() THEN EXISTS (
            SELECT 1
              FROM public.products AS product
             WHERE product.seller_id = seller_public_contacts.seller_id
               AND product.shop_id IS NULL
               AND product.status = 'active'
        )
        ELSE EXISTS (
            SELECT 1
              FROM public.products AS product
             WHERE product.seller_id = seller_public_contacts.seller_id
               AND product.shop_id IS NULL
               AND public.phone_verification_product_is_public(product.id)
        )
    END
);

CREATE OR REPLACE FUNCTION public.enforce_phone_verification_before_publish()
RETURNS TRIGGER
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
    feature_enabled BOOLEAN := public.get_phone_verification_enabled();
    auth_user_id UUID;
    publish_transition BOOLEAN;
BEGIN
    IF NOT feature_enabled THEN
        RETURN NEW;
    END IF;
    IF COALESCE(public.current_profile_role(), '') = 'admin' THEN
        RETURN NEW;
    END IF;

    publish_transition := NEW.status = 'active'
        AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'active');
    IF NOT publish_transition THEN
        RETURN NEW;
    END IF;

    SELECT COALESCE(
        (
            SELECT profile.user_id
              FROM public.profiles AS profile
             WHERE profile.user_id = NEW.seller_id
                OR profile.id = NEW.seller_id
             ORDER BY (profile.user_id = NEW.seller_id) DESC
             LIMIT 1
        ),
        (
            SELECT profile.user_id
              FROM public.shops AS shop
              JOIN public.profiles AS profile
                ON profile.id = shop.current_owner_id
                OR profile.id = shop.owner_id
                OR profile.user_id = shop.current_owner_id
                OR profile.user_id = shop.owner_id
             WHERE shop.id = NEW.shop_id
             ORDER BY (profile.user_id = shop.current_owner_id) DESC
             LIMIT 1
        ),
        NEW.seller_id
    )
    INTO auth_user_id;

    IF auth_user_id IS NULL OR NOT EXISTS (
        SELECT 1
          FROM public.profiles AS profile
          JOIN auth.users AS auth_user
            ON auth_user.id = COALESCE(profile.user_id, profile.id)
         WHERE (profile.user_id = auth_user_id OR profile.id = auth_user_id)
           AND profile.phone_verified IS TRUE
           AND auth_user.email_confirmed_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'Verify your Nigerian phone number and confirm your email before publishing.'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_phone_verification_before_publish ON public.products;
CREATE TRIGGER enforce_phone_verification_before_publish
    BEFORE INSERT OR UPDATE OF status ON public.products
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_phone_verification_before_publish();

REVOKE ALL ON FUNCTION public.enforce_phone_verification_signup() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_verified_phone_after_signup() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_phone_verification_before_publish() FROM PUBLIC, anon, authenticated;

COMMIT;
