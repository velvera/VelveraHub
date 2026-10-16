-- VelveraHub / Supabase admin-role setup
--
-- Run this entire file in the Supabase SQL Editor with a privileged database
-- role. Never expose the function through the browser or grant it to anon or
-- authenticated users.
--
-- After all ordered migrations have been applied, promote exactly one
-- existing Supabase Auth user in a trusted SQL Editor transaction:
--
--   begin;
--   select set_config('request.jwt.claim.role', 'service_role', true);
--   select * from public.assign_admin_role('registered-email@example.com');
--   commit;
--
-- The transaction-local claim allows the profile security trigger to accept
-- this operator-only role change. COMMIT clears it. Never set this claim in a
-- browser request or leave it active in a reusable SQL session.
--
-- The function is deliberately not executable by client roles. This keeps
-- admin promotion an operator-only action instead of a public API.

begin;

-- Keep one profile row per email regardless of email casing. Existing
-- duplicate values must be resolved manually before this index can be created.
create unique index if not exists profiles_email_lower_key
    on public.profiles (lower(email))
    where email is not null;

create unique index if not exists profiles_user_id_key
    on public.profiles (user_id)
    where user_id is not null;

-- Resolve the application profile for the current Supabase Auth user.
-- user_id is the canonical Auth link. The id fallback keeps imported legacy
-- profiles readable until they are linked by an operator.
create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
    select p.role
    from public.profiles as p
    where p.user_id = auth.uid()
       or p.id = auth.uid()
    order by (p.user_id = auth.uid()) desc
    limit 1;
$$;

revoke all on function public.current_profile_role() from public, anon;
grant execute on function public.current_profile_role() to authenticated, service_role;

-- Create/link the marketplace profile whenever a Supabase Auth account is
-- created. This is safe for existing profiles and preserves their profile id.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    profile_id uuid;
    requested_account_type text := case
        when lower(coalesce(new.raw_user_meta_data ->> 'accountType', '')) = 'seller' then 'seller'
        else 'customer'
    end;
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
            requested_account_type,
            requested_role,
            nullif(new.raw_user_meta_data ->> 'businessName', ''),
            nullif(new.raw_user_meta_data ->> 'businessState', ''),
            nullif(new.raw_user_meta_data ->> 'businessInstitution', '')
        );
    else
        update public.profiles
           set user_id = coalesce(public.profiles.user_id, new.id),
               email = coalesce(public.profiles.email, lower(nullif(new.email, ''))),
               account_type = case
                   when requested_role = 'seller' then 'seller'
                    else coalesce(public.profiles.account_type, 'customer')
               end,
               role = case
                    when requested_role = 'seller'
                         and coalesce(public.profiles.role, 'customer') <> 'admin'
                        then 'seller'
                    else coalesce(public.profiles.role, 'customer')
               end,
               business_name = coalesce(
                   public.profiles.business_name,
                   nullif(new.raw_user_meta_data ->> 'businessName', '')
               ),
               business_state = coalesce(
                   public.profiles.business_state,
                   nullif(new.raw_user_meta_data ->> 'businessState', '')
               ),
               business_institution = coalesce(
                   public.profiles.business_institution,
                   nullif(new.raw_user_meta_data ->> 'businessInstitution', '')
               ),
               first_name = coalesce(
                   public.profiles.first_name,
                   nullif(new.raw_user_meta_data ->> 'firstName', '')
               ),
               last_name = coalesce(
                   public.profiles.last_name,
                   nullif(new.raw_user_meta_data ->> 'lastName', '')
               ),
               updated_at = now()
         where public.profiles.id = profile_id;
    end if;

    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row
    execute procedure public.handle_new_auth_user();

-- Keep profile role changes out of the browser. The owner/operator can still
-- change a role in the SQL editor, while a user may update their own profile
-- details without changing customer/seller/admin privileges.
alter table public.profiles enable row level security;

drop policy if exists "users can read their own profile" on public.profiles;
create policy "users can read their own profile"
    on public.profiles
    for select
    to authenticated
    using (
        user_id = auth.uid()
        or id = auth.uid()
        or public.current_profile_role() = 'admin'
    );

drop policy if exists "users can update their own profile details" on public.profiles;
create policy "users can update their own profile details"
    on public.profiles
    for update
    to authenticated
    using (
        user_id = auth.uid()
        or id = auth.uid()
        or public.current_profile_role() = 'admin'
    )
    with check (
        (
            user_id = auth.uid()
            or id = auth.uid()
            or public.current_profile_role() = 'admin'
        )
        and role = coalesce(public.current_profile_role(), role)
    );

-- Promote an already-registered Supabase Auth email. The function also
-- repairs a missing profile link when the auth user predates the trigger.
create or replace function public.assign_admin_role(target_email text)
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
        insert into public.profiles (user_id, email, role)
        values (auth_id, normalized_email, 'admin')
        returning id into matched_profile_id;
    else
        update public.profiles as profile
           set user_id = coalesce(profile.user_id, auth_id),
               email = coalesce(profile.email, normalized_email),
               role = 'admin',
               updated_at = now()
         where profile.id = matched_profile_id;
    end if;

    return query
    select p.id, auth_id, p.email, p.role
      from public.profiles as p
     where p.id = matched_profile_id;
end;
$$;

revoke all on function public.assign_admin_role(text) from public, anon, authenticated;
grant execute on function public.assign_admin_role(text) to service_role;

comment on function public.assign_admin_role(text) is
    'Operator-only promotion of a registered Supabase Auth email to the admin profile role.';

commit;

-- Operator-only Admin promotion (run after all migrations):
-- BEGIN;
-- SELECT set_config('request.jwt.claim.role', 'service_role', true);
-- SELECT * FROM public.assign_admin_role('registered-email@example.com');
-- COMMIT;

-- Seller promotion
-- select * from public.assign_seller_role('seller-email@example.com');