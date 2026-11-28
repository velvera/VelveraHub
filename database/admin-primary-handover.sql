-- Safe, audited primary-admin handover for an already-registered Auth account.
--
-- Apply after database/admin-access-and-verification-hardening.sql
-- (migration 25). This does not change Auth credentials or email addresses.

BEGIN;

CREATE OR REPLACE FUNCTION public.operator_transfer_primary_admin(
    p_target_email TEXT,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_email TEXT := lower(trim(coalesce(p_target_email, '')));
    v_reason TEXT := btrim(coalesce(p_reason, ''));
    v_target_user_id UUID;
    v_target_email TEXT;
    v_target_profile_id UUID;
    v_target_linked_user_id UUID;
    v_target_role TEXT;
    v_account_type TEXT;
    v_previous_role TEXT;
    v_previous_primary_user_id UUID;
    v_previous_primary_email TEXT;
    v_primary_configured BOOLEAN;
    v_target_was_promoted BOOLEAN := FALSE;
BEGIN
    IF coalesce(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Trusted operator access is required'
            USING ERRCODE = '42501';
    END IF;
    IF v_email = '' OR char_length(v_reason) NOT BETWEEN 5 AND 450 THEN
        RAISE EXCEPTION 'A registered email and reason of 5–450 characters are required'
            USING ERRCODE = '22023';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('velverahub-admin-role-changes', 0));

    SELECT auth_user.id, lower(auth_user.email)
      INTO v_target_user_id, v_target_email
      FROM auth.users AS auth_user
     WHERE lower(auth_user.email) = v_email
     LIMIT 1;
    IF v_target_user_id IS NULL THEN
        RAISE EXCEPTION 'No registered Supabase Auth account matches this email'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT config.primary_admin_user_id
      INTO v_previous_primary_user_id
      FROM public.admin_role_management_config AS config
     WHERE config.singleton IS TRUE
     FOR UPDATE;
    v_primary_configured := FOUND AND v_previous_primary_user_id IS NOT NULL;
    IF NOT v_primary_configured THEN
        RAISE EXCEPTION 'Bootstrap a primary administrator before transferring primary access'
            USING ERRCODE = '23514';
    END IF;
    IF v_previous_primary_user_id = v_target_user_id THEN
        RETURN jsonb_build_object(
            'user_id', v_target_user_id,
            'email', v_target_email,
            'changed', FALSE,
            'reason', 'This account is already the primary administrator'
        );
    END IF;

    SELECT lower(auth_user.email)
      INTO v_previous_primary_email
      FROM auth.users AS auth_user
     WHERE auth_user.id = v_previous_primary_user_id;
    IF v_previous_primary_email IS NULL OR NOT EXISTS (
        SELECT 1
        FROM public.profiles AS profile
        WHERE (profile.user_id = v_previous_primary_user_id
               OR profile.id = v_previous_primary_user_id)
          AND profile.role = 'admin'
    ) THEN
        RAISE EXCEPTION 'The existing primary administrator is not linked to an admin profile'
            USING ERRCODE = '23514';
    END IF;

    SELECT profile.id, profile.user_id, profile.role, profile.account_type
      INTO v_target_profile_id, v_target_linked_user_id, v_target_role, v_account_type
      FROM public.profiles AS profile
     WHERE profile.user_id = v_target_user_id
        OR profile.id = v_target_user_id
        OR (
            profile.user_id IS NULL
            AND lower(profile.email) = v_target_email
        )
     ORDER BY (profile.user_id = v_target_user_id) DESC,
              (profile.id = v_target_user_id) DESC
     LIMIT 1
     FOR UPDATE;

    IF v_target_profile_id IS NOT NULL
       AND v_target_linked_user_id IS NOT NULL
       AND v_target_linked_user_id <> v_target_user_id THEN
        RAISE EXCEPTION 'The target profile is linked to another Auth account; resolve the mapping first'
            USING ERRCODE = '23505';
    END IF;

    IF v_target_profile_id IS NULL THEN
        INSERT INTO public.profiles (user_id, email, account_type, role)
        VALUES (v_target_user_id, v_target_email, 'customer', 'customer')
        RETURNING id INTO v_target_profile_id;
        v_target_role := 'customer';
        v_account_type := 'customer';
    ELSE
        UPDATE public.profiles
           SET user_id = coalesce(user_id, v_target_user_id),
               email = coalesce(email, v_target_email),
               updated_at = now()
         WHERE id = v_target_profile_id;
    END IF;

    IF v_target_role IS DISTINCT FROM 'admin' THEN
        v_previous_role := CASE
            WHEN v_target_role = 'seller' OR v_account_type = 'seller' THEN 'seller'
            ELSE 'customer'
        END;
        INSERT INTO public.admin_role_assignments (user_id, previous_role, granted_by)
        VALUES (v_target_user_id, v_previous_role, v_previous_primary_user_id)
        ON CONFLICT (user_id) DO NOTHING;

        UPDATE public.profiles
           SET role = 'admin', updated_at = now()
         WHERE id = v_target_profile_id;

        INSERT INTO public.admin_role_management_audit (
            actor_user_id, actor_email, target_user_id, target_email,
            previous_role, new_role, reason
        )
        VALUES (
            v_previous_primary_user_id, v_previous_primary_email,
            v_target_user_id, v_target_email,
            v_previous_role, 'admin', v_reason
        );
        v_target_was_promoted := TRUE;
    ELSE
        INSERT INTO public.admin_role_assignments (user_id, previous_role, granted_by)
        VALUES (
            v_target_user_id,
            CASE WHEN v_account_type = 'seller' THEN 'seller' ELSE 'customer' END,
            v_previous_primary_user_id
        )
        ON CONFLICT (user_id) DO NOTHING;
    END IF;

    UPDATE public.admin_role_management_config
       SET primary_admin_user_id = v_target_user_id
     WHERE singleton IS TRUE
       AND primary_admin_user_id = v_previous_primary_user_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Primary administrator changed during the handover; retry after reviewing access'
            USING ERRCODE = '40001';
    END IF;

    INSERT INTO public.admin_role_management_audit (
        actor_user_id, actor_email, target_user_id, target_email,
        previous_role, new_role, reason
    )
    VALUES (
        v_previous_primary_user_id, v_previous_primary_email,
        v_target_user_id, v_target_email,
        'admin', 'admin',
        'Primary administrator handover: ' || v_reason
    );

    RETURN jsonb_build_object(
        'user_id', v_target_user_id,
        'email', v_target_email,
        'previous_primary_email', v_previous_primary_email,
        'primary_admin', TRUE,
        'promoted_to_admin', v_target_was_promoted,
        'changed', TRUE
    );
END;
$$;

REVOKE ALL ON FUNCTION public.operator_transfer_primary_admin(TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.operator_transfer_primary_admin(TEXT, TEXT)
    TO service_role;

COMMENT ON FUNCTION public.operator_transfer_primary_admin(TEXT, TEXT) IS
    'Trusted-operator-only handover to an existing Supabase Auth account; preserves the previous admin and records role and handover events.';

COMMIT;
