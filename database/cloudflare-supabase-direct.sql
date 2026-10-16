-- Supabase-only actions used by static Cloudflare Pages roots.
-- Run after schema.sql, security-hardening.sql, and cloudflare-dashboard.sql.
-- The browser can submit a deletion request, but cannot delete auth.users or
-- use privileged database credentials. A trusted admin must complete it.

begin;

alter table public.data_deletion_requests enable row level security;
revoke all on table public.data_deletion_requests from public, anon, authenticated;

create index if not exists idx_data_deletion_requests_status_created
    on public.data_deletion_requests (status, created_at desc);

create or replace function public.request_account_deletion()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
    v_profile_id uuid;
    v_existing public.data_deletion_requests%rowtype;
    v_request public.data_deletion_requests%rowtype;
    v_request_id text;
    v_email text;
begin
    if auth.uid() is null then
        raise exception 'Sign in before requesting account deletion.'
            using errcode = '42501';
    end if;

    v_profile_id := public.current_profile_id();
    if v_profile_id is null then
        raise exception 'No marketplace profile is linked to this account.'
            using errcode = 'P0002';
    end if;

    perform pg_advisory_xact_lock(hashtext(v_profile_id::text), 781201);

    select *
      into v_existing
      from public.data_deletion_requests
     where user_id = v_profile_id
       and status in ('received', 'in_review')
     order by created_at desc
     limit 1;

    if found then
        return jsonb_build_object(
            'success', true,
            'message', 'Your account deletion request is already in the review queue.',
            'request', jsonb_build_object(
                'request_id', v_existing.request_id,
                'status', v_existing.status,
                'created_at', v_existing.created_at
            )
        );
    end if;

    v_request_id := 'VH-' || upper(substr(replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 12));
    v_email := nullif(left(coalesce(auth.jwt() ->> 'email', ''), 320), '');

    insert into public.data_deletion_requests (
        user_id, email_at_request, status, request_id
    )
    values (
        v_profile_id, v_email, 'received', v_request_id
    )
    returning * into v_request;

    return jsonb_build_object(
        'success', true,
        'message', 'Your account deletion request was received for admin review. Your account is not deleted yet.',
        'request', jsonb_build_object(
            'request_id', v_request.request_id,
            'status', v_request.status,
            'created_at', v_request.created_at
        )
    );
end;
$$;

revoke all on function public.request_account_deletion() from public, anon;
grant execute on function public.request_account_deletion() to authenticated;

create or replace function public.admin_list_account_deletion_requests(p_status text default 'received')
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
    v_requests jsonb;
begin
    if public.current_profile_role() is distinct from 'admin' then
        raise exception 'Administrator access is required.'
            using errcode = '42501';
    end if;

    if coalesce(p_status, '') not in ('received', 'in_review', 'completed', 'rejected', 'all') then
        raise exception 'Unsupported account deletion request status.'
            using errcode = '22023';
    end if;

    select coalesce(jsonb_agg(to_jsonb(queue_row)), '[]'::jsonb)
      into v_requests
      from (
          select id, request_id, email_at_request, status, created_at, completed_at
            from public.data_deletion_requests
           where p_status = 'all' or status = p_status
           order by created_at desc
           limit 200
      ) as queue_row;

    return v_requests;
end;
$$;

revoke all on function public.admin_list_account_deletion_requests(text) from public, anon;
grant execute on function public.admin_list_account_deletion_requests(text) to authenticated;

create or replace function public.admin_update_account_deletion_request(
    p_request_id uuid,
    p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
    v_request public.data_deletion_requests%rowtype;
begin
    if public.current_profile_role() is distinct from 'admin' then
        raise exception 'Administrator access is required.'
            using errcode = '42501';
    end if;

    if coalesce(p_status, '') not in ('in_review', 'completed', 'rejected') then
        raise exception 'Unsupported account deletion request status.'
            using errcode = '22023';
    end if;

    select *
      into v_request
      from public.data_deletion_requests
     where id = p_request_id
     for update;

    if not found then
        raise exception 'Account deletion request was not found.'
            using errcode = 'P0002';
    end if;

    if v_request.status <> p_status then
        if not (
            (v_request.status = 'received' and p_status in ('in_review', 'rejected'))
            or (v_request.status = 'in_review' and p_status in ('completed', 'rejected'))
        ) then
            raise exception 'Unsupported account deletion request status transition.'
                using errcode = '55000';
        end if;

        update public.data_deletion_requests
           set status = p_status,
               completed_at = case when p_status in ('completed', 'rejected') then now() else null end
         where id = p_request_id
        returning * into v_request;
    end if;

    return jsonb_build_object(
        'id', v_request.id,
        'request_id', v_request.request_id,
        'status', v_request.status,
        'completed_at', v_request.completed_at
    );
end;
$$;

revoke all on function public.admin_update_account_deletion_request(uuid, text) from public, anon;
grant execute on function public.admin_update_account_deletion_request(uuid, text) to authenticated;

comment on function public.request_account_deletion() is
    'Queues a signed-in user deletion request. It does not delete the Supabase Auth user.';
comment on function public.admin_update_account_deletion_request(uuid, text) is
    'Updates the deletion request queue only. Mark completed only after the trusted admin has deleted/anonymized the account through privileged tooling.';

commit;
