-- Supabase policies and database RPCs used by the VelveraHub dashboards.
--
-- Run after schema.sql, supabase-rls.sql, admin.sql, seller.sql, and
-- security-hardening.sql. production-hardening.sql adds complementary
-- checkout protections afterward. These database functions are intentionally
-- narrow. They do not create or configure any Cloudflare runtime; privileged
-- service-role credentials must never be exposed to the browser.

begin;

create table if not exists public.site_settings (
    id text primary key,
    logo_url text,
    logo_version bigint,
    site_name text,
    meta_title text,
    meta_description text,
    keywords text,
    canonical_base_url text,
    og_title text,
    og_description text,
    og_image_url text,
    og_image_alt text,
    twitter_handle text,
    locale text,
    robots text,
    social_profiles text,
    public_supabase_url text,
    public_supabase_key text,
    updated_at timestamptz not null default now()
);

alter table public.site_settings add column if not exists site_name text;
alter table public.site_settings add column if not exists meta_title text;
alter table public.site_settings add column if not exists meta_description text;
alter table public.site_settings add column if not exists keywords text;
alter table public.site_settings add column if not exists canonical_base_url text;
alter table public.site_settings add column if not exists og_title text;
alter table public.site_settings add column if not exists og_description text;
alter table public.site_settings add column if not exists og_image_url text;
alter table public.site_settings add column if not exists og_image_alt text;
alter table public.site_settings add column if not exists twitter_handle text;
alter table public.site_settings add column if not exists locale text;
alter table public.site_settings add column if not exists robots text;
alter table public.site_settings add column if not exists social_profiles text;
alter table public.site_settings add column if not exists public_supabase_url text;
alter table public.site_settings add column if not exists public_supabase_key text;

-- Additive fields are safe for existing databases; old live inventory stays
-- approved until a seller changes its listing content.
alter table public.products add column if not exists moderation_status text not null default 'approved';
alter table public.products add column if not exists moderation_note text;
alter table public.products add column if not exists moderated_by uuid references public.profiles(id) on delete set null;
alter table public.products add column if not exists moderated_at timestamptz;
update public.products set moderation_status = 'approved' where moderation_status is null;
alter table public.products alter column moderation_status set default 'approved';
alter table public.products alter column moderation_status set not null;
create index if not exists idx_products_moderation_status
    on public.products(moderation_status, created_at desc);
do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.products'::regclass
          and conname = 'products_moderation_status_valid'
    ) then
        alter table public.products
            add constraint products_moderation_status_valid
            check (moderation_status in ('pending', 'approved', 'rejected'));
    end if;
end;
$$;

insert into public.site_settings (
    id, site_name, meta_title, meta_description, keywords, og_title,
    og_description, og_image_url, og_image_alt, locale, robots, social_profiles
)
values (
    'seo',
    'VelveraHub',
    'VelveraHub — Smart marketplace for everyday shopping',
    'VelveraHub is a trusted marketplace for discovering products from verified shops across Nigeria and the United Kingdom.',
    'VelveraHub, online marketplace, Nigeria shopping, UK shopping, verified shops',
    'VelveraHub — Smart marketplace for everyday shopping',
    'Discover products from verified shops across Nigeria and the United Kingdom.',
    '/img/velverahub.png',
    'VelveraHub marketplace',
    'en_GB',
    'index,follow',
    ''
)
on conflict (id) do nothing;

insert into public.site_settings (
    id, public_supabase_url, public_supabase_key
)
values (
    'public_config', NULL, NULL
)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', true, 1572864, array['image/png']::text[])
on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.current_profile_role()
returns text
language sql stable security definer set search_path = public
as $$
    select p.role
    from public.profiles p
    where p.user_id = auth.uid() or p.id = auth.uid()
    order by (p.user_id = auth.uid()) desc
    limit 1
$$;

create or replace function public.current_profile_id()
returns uuid
language sql stable security definer set search_path = public
as $$
    select p.id
    from public.profiles p
    where p.user_id = auth.uid() or p.id = auth.uid()
    order by (p.user_id = auth.uid()) desc
    limit 1
$$;

revoke all on function public.current_profile_id() from public, anon;
grant execute on function public.current_profile_id() to authenticated, service_role;

alter table public.site_settings enable row level security;
alter table public.rental_contracts enable row level security;
alter table public.advertisement_settings enable row level security;
alter table public.advertisement_requests enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.reviews enable row level security;
alter table public.promotions enable row level security;
alter table public.product_conversations enable row level security;
alter table public.product_conversation_messages enable row level security;

revoke all on table public.product_conversations, public.product_conversation_messages from public, anon;
revoke all on table public.product_conversations, public.product_conversation_messages from authenticated;
grant select on table public.product_conversations, public.product_conversation_messages to authenticated;

drop policy if exists "public can read active products" on public.products;
create policy "public can read active products"
on public.products for select to anon, authenticated
using (
    status = 'active'
    and moderation_status = 'approved'
    and coalesce(stock, 0) > 0
    and (
        listing_type <> 'shop'
        or exists (
            select 1 from public.shops shop
            where shop.id = products.shop_id
              and shop.status = 'active'
        )
    )
);

drop policy if exists "conversation participants can read threads" on public.product_conversations;
create policy "conversation participants can read threads"
on public.product_conversations for select to authenticated
using (buyer_id = auth.uid() or seller_id = auth.uid());

drop policy if exists "conversation participants can read messages" on public.product_conversation_messages;
create policy "conversation participants can read messages"
on public.product_conversation_messages for select to authenticated
using (
    exists (
        select 1
        from public.product_conversations conversation
        where conversation.id = product_conversation_messages.conversation_id
          and (conversation.buyer_id = auth.uid() or conversation.seller_id = auth.uid())
    )
);

create or replace function public.resolve_product_seller_auth_id(p_product_id uuid)
returns uuid
language plpgsql stable security definer set search_path = public
as $$
declare
    resolved_seller_id uuid;
begin
    select coalesce(
        seller_profile.user_id,
        seller_profile.id,
        product.seller_id,
        shop_owner.user_id,
        shop_owner.id,
        shop.current_owner_id,
        shop.owner_id
    )
    into resolved_seller_id
    from public.products product
    left join public.shops shop on shop.id = product.shop_id
    left join lateral (
        select profile.id, profile.user_id
        from public.profiles profile
        where profile.id = product.seller_id or profile.user_id = product.seller_id
        order by (profile.user_id = product.seller_id) desc
        limit 1
    ) seller_profile on true
    left join lateral (
        select profile.id, profile.user_id
        from public.profiles profile
        where profile.id in (shop.current_owner_id, shop.owner_id)
           or profile.user_id in (shop.current_owner_id, shop.owner_id)
        order by
            (profile.user_id = shop.current_owner_id) desc,
            (profile.id = shop.current_owner_id) desc,
            (profile.user_id = shop.owner_id) desc
        limit 1
    ) shop_owner on true
    where product.id = p_product_id;

    return resolved_seller_id;
end;
$$;
revoke all on function public.resolve_product_seller_auth_id(uuid) from public, anon, authenticated;

create or replace function public.enforce_product_listing_review()
returns trigger
language plpgsql security invoker set search_path = public
as $$
declare
    listing_content_changed boolean := false;
    review_fields_changed boolean := false;
begin
    if auth.uid() is null or coalesce(public.current_profile_role(), '') = 'admin' then
        return new;
    end if;

    if tg_op = 'INSERT' then
        new.moderation_status := 'pending';
        new.moderation_note := null;
        new.moderated_by := null;
        new.moderated_at := null;
        return new;
    end if;

    listing_content_changed :=
        row(
            new.title, new.description, new.short_description, new.price,
            new.original_price, new.discount_percent, new.category, new.category_id,
            new.location, new.school_id, new.school_slug, new.school_name,
            new.school_city, new.campus_area, new.condition, new.delivery_options,
            new.specifications, new.tags, to_jsonb(new) -> 'image_url', new.listing_type
        ) is distinct from row(
            old.title, old.description, old.short_description, old.price,
            old.original_price, old.discount_percent, old.category, old.category_id,
            old.location, old.school_id, old.school_slug, old.school_name,
            old.school_city, old.campus_area, old.condition, old.delivery_options,
            old.specifications, old.tags, to_jsonb(old) -> 'image_url', old.listing_type
        );
    review_fields_changed :=
        row(new.moderation_status, new.moderation_note, new.moderated_by, new.moderated_at)
        is distinct from
        row(old.moderation_status, old.moderation_note, old.moderated_by, old.moderated_at);

    if listing_content_changed or review_fields_changed then
        new.moderation_status := 'pending';
        new.moderation_note := null;
        new.moderated_by := null;
        new.moderated_at := null;
    end if;
    return new;
end;
$$;

drop trigger if exists enforce_product_listing_review on public.products;
create trigger enforce_product_listing_review
before insert or update on public.products
for each row execute function public.enforce_product_listing_review();

create or replace function public.requeue_product_after_media_change()
returns trigger
language plpgsql security invoker set search_path = public
as $$
begin
    if auth.uid() is null or coalesce(public.current_profile_role(), '') = 'admin' then
        return null;
    end if;

    if tg_op in ('UPDATE', 'DELETE') then
        update public.products
        set moderation_status = 'pending',
            moderation_note = null,
            moderated_by = null,
            moderated_at = null
        where id = old.product_id;
    end if;

    if tg_op in ('INSERT', 'UPDATE') and (
        tg_op = 'INSERT' or new.product_id is distinct from old.product_id
    ) then
        update public.products
        set moderation_status = 'pending',
            moderation_note = null,
            moderated_by = null,
            moderated_at = null
        where id = new.product_id;
    end if;
    return null;
end;
$$;

drop trigger if exists requeue_product_after_media_change on public.product_images;
create trigger requeue_product_after_media_change
after insert or update or delete on public.product_images
for each row execute function public.requeue_product_after_media_change();

create or replace function public.start_product_conversation(
    p_product_id uuid,
    p_initial_message text
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
    buyer uuid := auth.uid();
    seller uuid;
    thread_id uuid;
    body text := btrim(coalesce(p_initial_message, ''));
begin
    if buyer is null then raise exception 'Sign in to message this seller'; end if;
    if char_length(body) < 1 or char_length(body) > 2000 then
        raise exception 'Message must be between 1 and 2000 characters';
    end if;
    if not exists (
        select 1 from public.products product
        where product.id = p_product_id
          and product.status = 'active'
          and product.moderation_status = 'approved'
          and (
              product.listing_type <> 'shop'
              or exists (
                  select 1 from public.shops shop
                  where shop.id = product.shop_id and shop.status = 'active'
              )
          )
    ) then
        raise exception 'This listing is not available for messages';
    end if;
    seller := public.resolve_product_seller_auth_id(p_product_id);
    if seller is null then raise exception 'This listing has no active seller account'; end if;
    if seller = buyer then raise exception 'You cannot message your own listing'; end if;

    insert into public.product_conversations(product_id, buyer_id, seller_id)
    values (p_product_id, buyer, seller)
    on conflict (product_id, buyer_id)
    do update set seller_id = excluded.seller_id
    returning id into thread_id;

    insert into public.product_conversation_messages(conversation_id, sender_id, body)
    values (thread_id, buyer, body);
    return thread_id;
end;
$$;

create or replace function public.send_product_conversation_message(
    p_conversation_id uuid,
    p_message text
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
    sender uuid := auth.uid();
    body text := btrim(coalesce(p_message, ''));
    message_id uuid;
begin
    if sender is null then raise exception 'Sign in to send a message'; end if;
    if char_length(body) < 1 or char_length(body) > 2000 then
        raise exception 'Message must be between 1 and 2000 characters';
    end if;
    if not exists (
        select 1
        from public.product_conversations conversation
        where conversation.id = p_conversation_id
          and (conversation.buyer_id = sender or conversation.seller_id = sender)
    ) then
        raise exception 'You do not have access to this conversation';
    end if;

    insert into public.product_conversation_messages(conversation_id, sender_id, body)
    values (p_conversation_id, sender, body)
    returning id into message_id;
    update public.product_conversations
    set last_message_at = now()
    where id = p_conversation_id;
    return message_id;
end;
$$;

create or replace function public.admin_list_product_reviews(p_status text default 'pending')
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
    if coalesce(public.current_profile_role(), '') <> 'admin' then
        raise exception 'Admin access required';
    end if;
    if p_status not in ('pending', 'approved', 'rejected', 'all') then
        raise exception 'Unsupported listing review filter';
    end if;

    return (
        select coalesce(jsonb_agg(to_jsonb(rows) order by rows.created_at desc), '[]'::jsonb)
        from (
            select
                product.id, product.title, product.description, product.category,
                product.price, product.location, product.school_name,
                product.moderation_status, product.moderation_note,
                product.created_at, product.updated_at,
                coalesce(
                    nullif(trim(concat_ws(' ', seller_profile.first_name, seller_profile.last_name)), ''),
                    nullif(product.seller_display_name, ''),
                    shop.name,
                    'Marketplace seller'
                ) as seller_name,
                (
                    select image.url
                    from public.product_images image
                    where image.product_id = product.id
                    order by image.is_primary desc, image.display_order asc, image.created_at asc
                    limit 1
                ) as image_url
            from public.products product
            left join public.shops shop on shop.id = product.shop_id
            left join lateral (
                select profile.first_name, profile.last_name
                from public.profiles profile
                where profile.id = product.seller_id or profile.user_id = product.seller_id
                order by (profile.user_id = product.seller_id) desc
                limit 1
            ) seller_profile on true
            where p_status = 'all' or product.moderation_status = p_status
            order by product.created_at desc
            limit 100
        ) rows
    );
end;
$$;

create or replace function public.admin_review_product_listing(
    p_product_id uuid,
    p_status text,
    p_review_note text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
    review_note text := nullif(btrim(coalesce(p_review_note, '')), '');
    result jsonb;
begin
    if coalesce(public.current_profile_role(), '') <> 'admin' then
        raise exception 'Admin access required';
    end if;
    if p_status not in ('approved', 'rejected') then
        raise exception 'Choose approved or rejected';
    end if;
    if p_status = 'rejected' and review_note is null then
        raise exception 'A clear reason is required when declining a listing';
    end if;
    if char_length(coalesce(review_note, '')) > 500 then
        raise exception 'The review reason cannot exceed 500 characters';
    end if;

    update public.products product
    set moderation_status = p_status,
        moderation_note = case when p_status = 'rejected' then review_note else null end,
        moderated_by = public.current_profile_id(),
        moderated_at = now()
    where product.id = p_product_id
      and product.moderation_status = 'pending'
    returning jsonb_build_object(
        'id', product.id,
        'moderation_status', product.moderation_status,
        'moderation_note', product.moderation_note,
        'moderated_at', product.moderated_at
    ) into result;

    if result is null then
        raise exception 'This listing is no longer awaiting review';
    end if;
    return result;
end;
$$;

drop policy if exists "owners can manage their products" on public.products;
create policy "owners can manage their products"
on public.products for all to authenticated
using (
    exists (
        select 1 from public.shops shop
        where shop.id = products.shop_id
          and (
              shop.owner_id = auth.uid()
              or shop.current_owner_id = auth.uid()
              or exists (
                  select 1 from public.profiles p
                  where p.user_id = auth.uid()
                    and (p.id = shop.owner_id or p.id = shop.current_owner_id)
              )
          )
    )
    and public.current_profile_role() in ('seller', 'admin')
)
with check (
    exists (
        select 1 from public.shops shop
        where shop.id = products.shop_id
          and (
              shop.owner_id = auth.uid()
              or shop.current_owner_id = auth.uid()
              or exists (
                  select 1 from public.profiles p
                  where p.user_id = auth.uid()
                    and (p.id = shop.owner_id or p.id = shop.current_owner_id)
              )
          )
    )
    and public.current_profile_role() in ('seller', 'admin')
);

drop policy if exists "public can read branding settings" on public.site_settings;
create policy "public can read branding settings"
on public.site_settings for select to anon, authenticated
using (id in ('branding', 'seo', 'public_config'));

drop policy if exists "admins can manage branding settings" on public.site_settings;
create policy "admins can manage branding settings"
on public.site_settings for all to authenticated
using (public.current_profile_role() = 'admin')
with check (public.current_profile_role() = 'admin');

drop policy if exists "public can read advertisement settings" on public.advertisement_settings;
create policy "public can read advertisement settings"
on public.advertisement_settings for select to anon, authenticated
using (true);

drop policy if exists "admins can manage advertisement settings" on public.advertisement_settings;
create policy "admins can manage advertisement settings"
on public.advertisement_settings for all to authenticated
using (public.current_profile_role() = 'admin')
with check (public.current_profile_role() = 'admin');

drop policy if exists "promoters can read their advertisements" on public.advertisement_requests;
create policy "promoters can read their advertisements"
on public.advertisement_requests for select to authenticated
using (
    promoter_id = public.current_profile_id()
    or public.current_profile_role() = 'admin'
);

drop policy if exists "promoters can submit advertisements" on public.advertisement_requests;
create policy "promoters can submit advertisements"
on public.advertisement_requests for insert to authenticated
with check (promoter_id = public.current_profile_id());

drop policy if exists "admins can manage advertisements" on public.advertisement_requests;
create policy "admins can manage advertisements"
on public.advertisement_requests for update to authenticated
using (public.current_profile_role() = 'admin')
with check (public.current_profile_role() = 'admin');

drop policy if exists "sellers can read their orders" on public.orders;
create policy "sellers can read their orders"
on public.orders for select to authenticated
using (
    exists (
        select 1 from public.order_items oi
        join public.shops s on s.id = oi.shop_id
        where oi.order_id = orders.id
          and (s.owner_id = auth.uid() or s.current_owner_id = auth.uid()
               or exists (
                   select 1 from public.profiles p
                   where p.user_id = auth.uid()
                     and (p.id = s.owner_id or p.id = s.current_owner_id)
               ))
    )
    or public.current_profile_role() = 'admin'
);

drop policy if exists "sellers can read their order items" on public.order_items;
create policy "sellers can read their order items"
on public.order_items for select to authenticated
using (
    exists (
        select 1 from public.shops s
        where s.id = order_items.shop_id
          and (s.owner_id = auth.uid() or s.current_owner_id = auth.uid()
               or exists (
                   select 1 from public.profiles p
                   where p.user_id = auth.uid()
                     and (p.id = s.owner_id or p.id = s.current_owner_id)
               ))
    )
    or public.current_profile_role() = 'admin'
);

drop policy if exists "sellers can read product reviews" on public.reviews;
create policy "sellers can read product reviews"
on public.reviews for select to authenticated
using (
    exists (
        select 1 from public.products product
        join public.shops shop on shop.id = product.shop_id
        where product.id = reviews.product_id
          and (shop.owner_id = auth.uid() or shop.current_owner_id = auth.uid()
               or exists (
                   select 1 from public.profiles p
                   where p.user_id = auth.uid()
                     and (p.id = shop.owner_id or p.id = shop.current_owner_id)
               ))
    )
    or public.current_profile_role() = 'admin'
);

drop policy if exists "sellers can manage their promotions" on public.promotions;
create policy "sellers can manage their promotions"
on public.promotions for all to authenticated
using (
    exists (
        select 1 from public.shops shop
        where shop.id = promotions.shop_id
          and (shop.owner_id = auth.uid() or shop.current_owner_id = auth.uid()
               or exists (
                   select 1 from public.profiles p
                   where p.user_id = auth.uid()
                     and (p.id = shop.owner_id or p.id = shop.current_owner_id)
               ))
    )
    or public.current_profile_role() = 'admin'
)
with check (
    public.current_profile_role() = 'admin'
    or exists (
        select 1 from public.shops shop
        where shop.id = promotions.shop_id
          and (shop.owner_id = auth.uid() or shop.current_owner_id = auth.uid()
               or exists (
                   select 1 from public.profiles p
                   where p.user_id = auth.uid()
                     and (p.id = shop.owner_id or p.id = shop.current_owner_id)
               ))
    )
);

drop policy if exists "owners can update their shop details" on public.shops;
create policy "owners can update their shop details"
on public.shops for update to authenticated
using (
    owner_id = auth.uid() or current_owner_id = auth.uid()
    or exists (
        select 1 from public.profiles p
        where p.user_id = auth.uid()
          and (p.id = shops.owner_id or p.id = shops.current_owner_id)
    )
)
with check (
    owner_id = auth.uid() or current_owner_id = auth.uid()
    or exists (
        select 1 from public.profiles p
        where p.user_id = auth.uid()
          and (p.id = shops.owner_id or p.id = shops.current_owner_id)
    )
);

create or replace function public.prevent_seller_shop_escalation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
    if coalesce(auth.role(), '') <> 'service_role'
       and public.current_profile_role() is distinct from 'admin' then
        if new.owner_id is distinct from old.owner_id
           or new.current_owner_id is distinct from old.current_owner_id
           or new.rental_status is distinct from old.rental_status
           or new.rental_start_date is distinct from old.rental_start_date
           or new.rental_end_date is distinct from old.rental_end_date
           or new.monthly_rent is distinct from old.monthly_rent
           or new.status is distinct from old.status
           or new.verified is distinct from old.verified then
            raise exception 'Seller cannot change shop ownership, rental, or approval fields';
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists prevent_seller_shop_escalation on public.shops;
create trigger prevent_seller_shop_escalation
before update on public.shops
for each row execute function public.prevent_seller_shop_escalation();

create or replace function public.admin_stats()
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
    if public.current_profile_role() is distinct from 'admin' then raise exception 'Access denied'; end if;
    return jsonb_build_object(
        'totalShops', (select count(*) from shops),
        'activeShops', (select count(*) from shops where status = 'active'),
        'totalProducts', (select count(*) from products),
        'activeProducts', (select count(*) from products where status = 'active'),
        'totalUsers', (select count(*) from profiles),
        'totalOrders', (select count(*) from orders),
        'totalRevenue', coalesce((select sum(total) from orders where status <> 'cancelled'), 0),
        'pendingRentals', (select count(*) from rental_contracts where status = 'pending')
    );
end;
$$;

create or replace function public.admin_get_seo_settings()
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
    if public.current_profile_role() is distinct from 'admin' then raise exception 'Access denied'; end if;
    return coalesce(
        (select to_jsonb(settings) from (
            select site_name, meta_title, meta_description, keywords,
                   canonical_base_url, og_title, og_description, og_image_url,
                   og_image_alt, twitter_handle, locale, robots, social_profiles,
                   updated_at
            from public.site_settings where id = 'seo'
        ) settings),
        '{}'::jsonb
    );
end;
$$;

create or replace function public.admin_save_seo_settings(
    p_site_name text,
    p_meta_title text,
    p_meta_description text,
    p_keywords text,
    p_canonical_base_url text,
    p_og_title text,
    p_og_description text,
    p_og_image_url text,
    p_og_image_alt text,
    p_twitter_handle text,
    p_locale text,
    p_robots text,
    p_social_profiles text
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare saved jsonb;
begin
    if public.current_profile_role() is distinct from 'admin' then raise exception 'Access denied'; end if;
    if length(trim(coalesce(p_site_name, ''))) not between 2 and 80
       or length(trim(coalesce(p_meta_title, ''))) not between 5 and 160
       or length(trim(coalesce(p_meta_description, ''))) not between 20 and 320
       or length(trim(coalesce(p_og_title, ''))) not between 5 and 160
       or length(trim(coalesce(p_og_description, ''))) not between 20 and 320
       or length(trim(coalesce(p_og_image_url, ''))) < 1
       or trim(coalesce(p_robots, '')) not in ('index,follow', 'noindex,follow', 'index,nofollow', 'noindex,nofollow')
    then raise exception 'SEO fields are invalid or outside their supported length'; end if;
    if trim(coalesce(p_canonical_base_url, '')) <> ''
       and trim(p_canonical_base_url) !~ '^https?://[^[:space:]]+$'
    then raise exception 'Canonical URL must be an absolute http or https URL'; end if;
    if trim(coalesce(p_og_image_url, '')) !~ '^(https?://|/)[^[:space:]]+$'
    then raise exception 'Social image URL must be absolute or site-relative'; end if;

    insert into public.site_settings (
        id, site_name, meta_title, meta_description, keywords,
        canonical_base_url, og_title, og_description, og_image_url,
        og_image_alt, twitter_handle, locale, robots, social_profiles, updated_at
    ) values (
        'seo', trim(p_site_name), trim(p_meta_title), trim(p_meta_description),
        left(trim(coalesce(p_keywords, '')), 500), nullif(trim(coalesce(p_canonical_base_url, '')), ''),
        trim(p_og_title), trim(p_og_description), trim(p_og_image_url),
        left(trim(coalesce(p_og_image_alt, '')), 160), left(trim(coalesce(p_twitter_handle, '')), 80),
        left(trim(coalesce(p_locale, 'en_GB')), 20), trim(p_robots),
        left(trim(coalesce(p_social_profiles, '')), 2000), now()
    )
    on conflict (id) do update set
        site_name = excluded.site_name,
        meta_title = excluded.meta_title,
        meta_description = excluded.meta_description,
        keywords = excluded.keywords,
        canonical_base_url = excluded.canonical_base_url,
        og_title = excluded.og_title,
        og_description = excluded.og_description,
        og_image_url = excluded.og_image_url,
        og_image_alt = excluded.og_image_alt,
        twitter_handle = excluded.twitter_handle,
        locale = excluded.locale,
        robots = excluded.robots,
        social_profiles = excluded.social_profiles,
        updated_at = now()
    returning jsonb_build_object(
        'site_name', site_name,
        'meta_title', meta_title,
        'meta_description', meta_description,
        'keywords', keywords,
        'canonical_base_url', canonical_base_url,
        'og_title', og_title,
        'og_description', og_description,
        'og_image_url', og_image_url,
        'og_image_alt', og_image_alt,
        'twitter_handle', twitter_handle,
        'locale', locale,
        'robots', robots,
        'social_profiles', social_profiles,
        'updated_at', updated_at
    ) into saved;
    return saved;
end;
$$;

create or replace function public.admin_list_shops(
    p_status text default null,
    p_rental_status text default null,
    p_limit integer default 50,
    p_offset integer default 0
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare result jsonb;
begin
    if public.current_profile_role() is distinct from 'admin' then raise exception 'Access denied'; end if;
    select jsonb_build_object(
        'shops', coalesce(jsonb_agg(to_jsonb(rows) order by rows.created_at desc), '[]'::jsonb),
        'total', (select count(*) from shops s where (p_status is null or s.status = p_status) and (p_rental_status is null or s.rental_status = p_rental_status))
    ) into result
    from (
        select s.*, p.email owner_email, p.first_name owner_first_name,
               p.last_name owner_last_name, rc.start_date current_rental_start,
               rc.end_date current_rental_end
        from shops s
        left join profiles p on s.current_owner_id = p.id
        left join rental_contracts rc on s.id = rc.shop_id and rc.status = 'active'
        where (p_status is null or s.status = p_status)
          and (p_rental_status is null or s.rental_status = p_rental_status)
        order by s.created_at desc
        limit least(greatest(coalesce(p_limit, 50), 1), 100)
        offset greatest(coalesce(p_offset, 0), 0)
    ) rows;
    return result;
end;
$$;

drop function if exists public.admin_list_users();
create or replace function public.admin_list_users()
returns table (
    id uuid,
    user_id uuid,
    email text,
    first_name text,
    last_name text,
    role text,
    phone text,
    created_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
begin
    if public.current_profile_role() is distinct from 'admin' then raise exception 'Access denied'; end if;
    return query
    select p.id, p.user_id, p.email, p.first_name, p.last_name,
           p.role, p.phone, p.created_at
    from profiles p
    order by p.created_at desc;
end;
$$;

create or replace function public.admin_list_rental_contracts()
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
    if public.current_profile_role() is distinct from 'admin' then raise exception 'Access denied'; end if;
    return (
        select coalesce(jsonb_agg(to_jsonb(rows) order by rows.created_at desc), '[]'::jsonb)
        from (
            select rc.*, s.name shop_name, p.email tenant_email,
                   concat(p.first_name, ' ', p.last_name) tenant_name
            from rental_contracts rc
            left join shops s on s.id = rc.shop_id
            left join profiles p on p.id = rc.tenant_id
        ) rows
    );
end;
$$;

create or replace function public.admin_assign_shop(
    p_shop_id uuid, p_user_id uuid, p_start_date timestamptz,
    p_end_date timestamptz, p_monthly_rent numeric
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare result jsonb;
begin
    if public.current_profile_role() is distinct from 'admin' then raise exception 'Access denied'; end if;
    if p_end_date <= p_start_date then raise exception 'End date must be after start date'; end if;
    if p_monthly_rent is null or p_monthly_rent < 0 or p_monthly_rent > 100000000 then raise exception 'Invalid monthly rent'; end if;
    if not exists (select 1 from shops where id = p_shop_id) then raise exception 'Shop not found'; end if;
    if not exists (select 1 from profiles where id = p_user_id) then raise exception 'User not found'; end if;
    update rental_contracts set status = 'cancelled', updated_at = now()
    where shop_id = p_shop_id and status = 'active';
    insert into rental_contracts (shop_id, tenant_id, assigned_by, start_date, end_date, monthly_rent, status)
    values (p_shop_id, p_user_id, public.current_profile_id(), p_start_date, p_end_date, p_monthly_rent, 'active');
    update shops set current_owner_id = p_user_id, rental_start_date = p_start_date,
        rental_end_date = p_end_date, rental_status = 'rented', is_available = false,
        monthly_rent = p_monthly_rent, updated_at = now() where id = p_shop_id;
    update profiles set role = 'seller', account_type = 'seller', updated_at = now() where id = p_user_id;
    select to_jsonb(s) into result from shops s where s.id = p_shop_id;
    return result;
end;
$$;

create or replace function public.admin_revoke_shop(p_shop_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare result jsonb;
begin
    if public.current_profile_role() is distinct from 'admin' then raise exception 'Access denied'; end if;
    update rental_contracts set status = 'cancelled', updated_at = now()
    where shop_id = p_shop_id and status = 'active';
    update shops set current_owner_id = null, rental_start_date = null,
        rental_end_date = null, rental_status = 'available', is_available = true,
        updated_at = now() where id = p_shop_id;
    select to_jsonb(s) into result from shops s where s.id = p_shop_id;
    return result;
end;
$$;

create or replace function public.admin_renew_shop(
    p_shop_id uuid, p_new_end_date timestamptz, p_monthly_rent numeric
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare owner_id uuid; result jsonb;
begin
    if public.current_profile_role() is distinct from 'admin' then raise exception 'Access denied'; end if;
    select current_owner_id into owner_id from shops where id = p_shop_id;
    if owner_id is null then raise exception 'Shop has no current owner'; end if;
    if p_new_end_date <= now() then raise exception 'End date must be in the future'; end if;
    update rental_contracts set status = 'renewed', updated_at = now()
    where shop_id = p_shop_id and status = 'active';
    insert into rental_contracts (shop_id, tenant_id, assigned_by, start_date, end_date, monthly_rent, status)
    values (p_shop_id, owner_id, public.current_profile_id(), now(), p_new_end_date, p_monthly_rent, 'active');
    update shops set rental_end_date = p_new_end_date, monthly_rent = p_monthly_rent,
        rental_status = 'rented', is_available = false, updated_at = now()
    where id = p_shop_id;
    select to_jsonb(s) into result from shops s where s.id = p_shop_id;
    return result;
end;
$$;

create or replace function public.admin_list_advertisements()
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
    if public.current_profile_role() is distinct from 'admin' then raise exception 'Access denied'; end if;
    return (
        select coalesce(jsonb_agg(to_jsonb(rows) order by (rows.status = 'pending') desc, rows.created_at desc), '[]'::jsonb)
        from (
            select ar.*, p.title product_title, s.name shop_name,
                   concat(pr.first_name, ' ', pr.last_name) promoter_name
            from advertisement_requests ar
            join products p on p.id = ar.product_id
            left join shops s on s.id = ar.shop_id
            left join profiles pr on pr.id = ar.promoter_id
        ) rows
    );
end;
$$;

create or replace function public.admin_review_advertisement(
    p_request_id uuid, p_status text, p_review_note text default ''
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare request_row advertisement_requests; result jsonb;
begin
    if public.current_profile_role() is distinct from 'admin' then raise exception 'Access denied'; end if;
    if coalesce(p_status, '') not in ('approved', 'rejected') then raise exception 'Status must be approved or rejected'; end if;
    update advertisement_requests set status = p_status, reviewed_by = public.current_profile_id(),
        reviewed_at = now(), review_note = nullif(left(coalesce(p_review_note, ''), 500), '')
    where id = p_request_id returning * into request_row;
    if request_row.id is null then raise exception 'Advertisement request not found'; end if;
    update products set is_priority_ad = p_status = 'approved', ad_status = p_status,
        ad_approved_at = case when p_status = 'approved' then now() else ad_approved_at end,
        updated_at = now() where id = request_row.product_id;
    select to_jsonb(request_row) into result;
    return result;
end;
$$;

create or replace function public.admin_get_advertisement_settings()
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
    if public.current_profile_role() is distinct from 'admin' then raise exception 'Access denied'; end if;
    return coalesce((select to_jsonb(s) from advertisement_settings s where id = 1),
        jsonb_build_object('id', 1, 'bank_name', '', 'account_name', '', 'account_number', '', 'instructions', '', 'amount_ngn', 999));
end;
$$;

create or replace function public.admin_save_advertisement_settings(
    p_bank_name text, p_account_name text, p_account_number text, p_instructions text
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare result jsonb;
begin
    if public.current_profile_role() is distinct from 'admin' then raise exception 'Access denied'; end if;
    if length(trim(coalesce(p_bank_name, ''))) = 0
       or length(trim(coalesce(p_account_name, ''))) = 0
       or length(trim(coalesce(p_account_number, ''))) = 0 then
        raise exception 'Bank name, account name and account number are required';
    end if;
    insert into advertisement_settings (id, bank_name, account_name, account_number, instructions, amount_ngn, updated_at)
    values (1, left(trim(p_bank_name), 120), left(trim(p_account_name), 160),
        left(trim(p_account_number), 80), left(trim(coalesce(p_instructions, '')), 500), 999, now())
    on conflict (id) do update set bank_name = excluded.bank_name,
        account_name = excluded.account_name, account_number = excluded.account_number,
        instructions = excluded.instructions, amount_ngn = excluded.amount_ngn, updated_at = now();
    select to_jsonb(s) into result from advertisement_settings s where s.id = 1;
    return result;
end;
$$;

create or replace function public.seller_list_advertisements()
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
    if coalesce(public.current_profile_role(), '') not in ('seller', 'admin') then raise exception 'Access denied'; end if;
    return (
        select coalesce(jsonb_agg(to_jsonb(rows) order by rows.created_at desc), '[]'::jsonb)
        from (
            select ar.*, p.title product_title
            from advertisement_requests ar
            join products p on p.id = ar.product_id
            where ar.promoter_id = public.current_profile_id()
        ) rows
    );
end;
$$;

create or replace function public.seller_submit_advertisement(
    p_product_id uuid, p_payment_reference text
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare product_row products; ad_row advertisement_requests; result jsonb;
begin
    if length(trim(coalesce(p_payment_reference, ''))) = 0 then raise exception 'Payment reference is required'; end if;
    select p.* into product_row from products p
    where p.id = p_product_id
      and (p.seller_id = auth.uid() or exists (
          select 1 from shops s
          where s.id = p.shop_id and (
              s.owner_id = auth.uid() or s.current_owner_id = auth.uid()
              or exists (select 1 from profiles pr where pr.user_id = auth.uid() and (pr.id = s.owner_id or pr.id = s.current_owner_id))
          )
      ));
    if product_row.id is null then raise exception 'Product is not owned by this seller'; end if;
    insert into advertisement_requests (product_id, shop_id, promoter_id, amount_ngn, payment_reference, status)
    values (p_product_id, product_row.shop_id, public.current_profile_id(), 999, left(trim(p_payment_reference), 120), 'pending')
    returning * into ad_row;
    select to_jsonb(ad_row) into result;
    return result;
end;
$$;

revoke all on function public.admin_stats() from public, anon;
revoke all on function public.admin_get_seo_settings() from public, anon;
revoke all on function public.admin_save_seo_settings(text, text, text, text, text, text, text, text, text, text, text, text, text) from public, anon;
revoke all on function public.admin_list_shops(text, text, integer, integer) from public, anon;
revoke all on function public.admin_list_users() from public, anon;
revoke all on function public.admin_list_rental_contracts() from public, anon;
revoke all on function public.admin_assign_shop(uuid, uuid, timestamptz, timestamptz, numeric) from public, anon;
revoke all on function public.admin_revoke_shop(uuid) from public, anon;
revoke all on function public.admin_renew_shop(uuid, timestamptz, numeric) from public, anon;
revoke all on function public.admin_list_advertisements() from public, anon;
revoke all on function public.admin_review_advertisement(uuid, text, text) from public, anon;
revoke all on function public.admin_get_advertisement_settings() from public, anon;
revoke all on function public.admin_save_advertisement_settings(text, text, text, text) from public, anon;
revoke all on function public.seller_list_advertisements() from public, anon;
revoke all on function public.current_profile_role() from public, anon;
revoke all on function public.current_profile_id() from public, anon;
revoke all on function public.seller_list_advertisements() from public, anon;
revoke all on function public.seller_submit_advertisement(uuid, text) from public, anon;
revoke all on function public.start_product_conversation(uuid, text) from public, anon;
revoke all on function public.send_product_conversation_message(uuid, text) from public, anon;
revoke all on function public.admin_list_product_reviews(text) from public, anon;
revoke all on function public.admin_review_product_listing(uuid, text, text) from public, anon;
grant execute on function public.current_profile_role() to authenticated;
grant execute on function public.current_profile_id() to authenticated;
grant execute on function public.admin_stats() to authenticated;
grant execute on function public.admin_get_seo_settings() to authenticated;
grant execute on function public.admin_save_seo_settings(text, text, text, text, text, text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.admin_list_shops(text, text, integer, integer) to authenticated;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_list_rental_contracts() to authenticated;
grant execute on function public.admin_assign_shop(uuid, uuid, timestamptz, timestamptz, numeric) to authenticated;
grant execute on function public.admin_revoke_shop(uuid) to authenticated;
grant execute on function public.admin_renew_shop(uuid, timestamptz, numeric) to authenticated;
grant execute on function public.admin_list_advertisements() to authenticated;
grant execute on function public.admin_review_advertisement(uuid, text, text) to authenticated;
grant execute on function public.admin_get_advertisement_settings() to authenticated;
grant execute on function public.admin_save_advertisement_settings(text, text, text, text) to authenticated;
grant execute on function public.seller_list_advertisements() to authenticated;
grant execute on function public.seller_submit_advertisement(uuid, text) to authenticated;
grant execute on function public.start_product_conversation(uuid, text) to authenticated;
grant execute on function public.send_product_conversation_message(uuid, text) to authenticated;
grant execute on function public.admin_list_product_reviews(text) to authenticated;
grant execute on function public.admin_review_product_listing(uuid, text, text) to authenticated;

drop policy if exists "admins can manage branding files" on storage.objects;
create policy "admins can manage branding files"
on storage.objects for all to authenticated
using (bucket_id = 'branding' and public.current_profile_role() = 'admin')
with check (bucket_id = 'branding' and public.current_profile_role() = 'admin');

commit;