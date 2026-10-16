-- VelveraHub / Supabase seller-role setup
--
-- Run this file in the Supabase SQL Editor with a privileged database role
-- after schema.sql. Supabase Auth creates the seller profile automatically when
-- signup metadata contains accountType = 'seller'.
--
-- Operator example after all ordered migrations have been applied:
--   BEGIN;
--   SELECT set_config('request.jwt.claim.role', 'service_role', true);
--   SELECT * FROM public.assign_seller_role('seller@example.com');
--   COMMIT;
-- The transaction-local claim lets the profile security trigger accept this
-- operator-only role change; COMMIT clears it. Never set it in a browser.
--
-- The assign_seller_role function below is only a repair/backfill helper for
-- existing accounts. New seller signup does not require it or admin approval.

begin;

-- Create/link a marketplace profile whenever a Supabase Auth account is
-- created. Seller intent is read from signup metadata, but admin cannot be
-- self-assigned through this path.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    profile_id uuid;
    requested_role text := case
        when lower(coalesce(new.raw_user_meta_data ->> 'accountType', '')) = 'seller' then 'seller'
        else 'customer'
    end;
begin
    select p.id
      into profile_id
      from public.profiles as p
     where (
             new.email is not null
             and lower(p.email) = lower(new.email)
           )
        or p.user_id = new.id
     order by (p.user_id = new.id) desc
     limit 1
     for update;

    if profile_id is null then
        insert into public.profiles (
            user_id,
            email,
            first_name,
            last_name,
            account_type,
            role,
            business_name,
            business_state,
            business_institution
        )
        values (
            new.id,
            lower(nullif(new.email, '')),
            nullif(new.raw_user_meta_data ->> 'firstName', ''),
            nullif(new.raw_user_meta_data ->> 'lastName', ''),
            requested_role,
            requested_role,
            nullif(new.raw_user_meta_data ->> 'businessName', ''),
            nullif(new.raw_user_meta_data ->> 'businessState', ''),
            nullif(new.raw_user_meta_data ->> 'businessInstitution', '')
        );
    else
        update public.profiles as profile
           set user_id = coalesce(profile.user_id, new.id),
               email = coalesce(profile.email, lower(nullif(new.email, ''))),
               account_type = case
                   when requested_role = 'seller' then 'seller'
                    else coalesce(profile.account_type, 'customer')
               end,
               role = case
                    when requested_role = 'seller'
                         and coalesce(profile.role, 'customer') <> 'admin'
                        then 'seller'
                    else coalesce(profile.role, 'customer')
               end,
               business_name = coalesce(
                   profile.business_name,
                   nullif(new.raw_user_meta_data ->> 'businessName', '')
               ),
               business_state = coalesce(
                   profile.business_state,
                   nullif(new.raw_user_meta_data ->> 'businessState', '')
               ),
               business_institution = coalesce(
                   profile.business_institution,
                   nullif(new.raw_user_meta_data ->> 'businessInstitution', '')
               ),
               first_name = coalesce(
                    profile.first_name,
                    nullif(new.raw_user_meta_data ->> 'firstName', '')
                ),
               last_name = coalesce(
                    profile.last_name,
                    nullif(new.raw_user_meta_data ->> 'lastName', '')
                ),
               updated_at = now()
         where profile.id = profile_id;
    end if;

    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row
    execute procedure public.handle_new_auth_user();

create or replace function public.assign_seller_role(target_email text)
returns table (
    profile_id uuid,
    auth_user_id uuid,
    email text,
    role text
)
language plpgsql
security definer
set search_path = public
as $$
declare
    normalized_email text := lower(trim(target_email));
    auth_id uuid;
    matched_profile_id uuid;
    matched_profile_user_id uuid;
begin
    if normalized_email is null or normalized_email = '' then
        raise exception using
            errcode = '22023',
            message = 'A registered email address is required';
    end if;

    select u.id
      into auth_id
      from auth.users as u
     where lower(u.email) = normalized_email
     limit 1;

    if auth_id is null then
        raise exception using
            errcode = 'P0002',
            message = format('No Supabase Auth user is registered for %s', normalized_email);
    end if;

    select p.id, p.user_id
      into matched_profile_id, matched_profile_user_id
      from public.profiles as p
     where p.user_id = auth_id
        or p.id = auth_id
        or lower(p.email) = normalized_email
     order by (p.user_id = auth_id) desc,
              (p.id = auth_id) desc,
              (lower(p.email) = normalized_email) desc
     limit 1
     for update;

    if matched_profile_user_id is not null
       and matched_profile_user_id <> auth_id then
        raise exception using
            errcode = '23505',
            message = 'This email profile is linked to a different Supabase Auth user; resolve the profile link before promotion';
    end if;

    if matched_profile_id is null then
        insert into public.profiles (user_id, email, account_type, role)
        values (auth_id, normalized_email, 'seller', 'seller')
        returning id into matched_profile_id;
    else
        update public.profiles as profile
           set user_id = coalesce(profile.user_id, auth_id),
               email = coalesce(profile.email, normalized_email),
               account_type = 'seller',
               role = case
                   when profile.role = 'admin' then 'admin'
                   else 'seller'
               end,
               updated_at = now()
         where profile.id = matched_profile_id;
    end if;

    return query
    select p.id, auth_id, p.email, p.role
      from public.profiles as p
     where p.id = matched_profile_id;
end;
$$;

revoke all on function public.assign_seller_role(text) from public, anon, authenticated;
grant execute on function public.assign_seller_role(text) to service_role;

comment on function public.assign_seller_role(text) is
    'Operator-only repair/backfill helper; new seller signup uses Auth metadata and does not require this function.';

commit;