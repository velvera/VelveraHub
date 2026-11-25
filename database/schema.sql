-- VelveraHub base ecommerce schema with shop rental support.
-- Standalone shop-owner and regional payment tables/functions are in
-- database/shop-owner-payments.sql and are applied after the security scripts.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Profiles table
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID,
    email TEXT UNIQUE,
    password_hash TEXT,
    first_name TEXT,
    last_name TEXT,
    avatar_url TEXT,
    phone TEXT,
    account_type TEXT DEFAULT 'customer' CHECK (account_type IN ('customer', 'seller')),
    business_name TEXT,
    business_state TEXT,
    business_institution TEXT,
    role TEXT DEFAULT 'customer' CHECK (role IN ('customer', 'seller', 'admin')),
    deleted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS data_deletion_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    email_at_request TEXT,
    status TEXT NOT NULL CHECK (status IN ('received', 'in_review', 'completed', 'rejected')),
    request_id TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS idx_data_deletion_requests_user ON data_deletion_requests(user_id, created_at DESC);

-- Categories table
CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    icon TEXT,
    image_url TEXT,
    parent_id UUID REFERENCES categories(id),
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Shops table with rental system
CREATE TABLE IF NOT EXISTS shops (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID REFERENCES profiles(id),
    current_owner_id UUID REFERENCES profiles(id),
    name TEXT NOT NULL,
    slug TEXT UNIQUE,
    description TEXT,
    logo_url TEXT,
    banner_url TEXT,
    email TEXT,
    phone TEXT,
    address TEXT,
    service_location TEXT,
    city TEXT,
    country TEXT,
    whatsapp TEXT,
    facebook TEXT,
    instagram TEXT,
    twitter TEXT,
    tiktok TEXT,
    youtube TEXT,
    shop_key TEXT UNIQUE,
    shop_type TEXT DEFAULT 'basic' CHECK (shop_type IN ('basic', 'standard', 'premium', 'enterprise')),
    status TEXT DEFAULT 'active' CHECK (status IN ('pending', 'active', 'suspended', 'rejected')),
    verified BOOLEAN DEFAULT FALSE,
    rating DECIMAL(3,2) DEFAULT 0,
    total_sales INTEGER DEFAULT 0,
    total_products INTEGER DEFAULT 0,
    is_available BOOLEAN DEFAULT TRUE,
    coverage_areas TEXT[],
    rental_status TEXT DEFAULT 'available' CHECK (rental_status IN ('available', 'rented', 'reserved', 'maintenance')),
    monthly_rent DECIMAL(10,2) DEFAULT 29.99,
    rental_start_date TIMESTAMP WITH TIME ZONE,
    rental_end_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Rental Contracts table
CREATE TABLE IF NOT EXISTS rental_contracts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id UUID REFERENCES shops(id) ON DELETE CASCADE,
    tenant_id UUID REFERENCES profiles(id),
    assigned_by UUID REFERENCES profiles(id),
    start_date TIMESTAMP WITH TIME ZONE NOT NULL,
    end_date TIMESTAMP WITH TIME ZONE NOT NULL,
    monthly_rent DECIMAL(10,2) NOT NULL,
    status TEXT DEFAULT 'active' CHECK (status IN ('pending', 'active', 'expired', 'cancelled', 'renewed')),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Curated institution directory. Admins can add institutions without changing
-- product URLs; school_slug is also stored on listings for fast filtering.
CREATE TABLE IF NOT EXISTS schools (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    state TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL DEFAULT 'University',
    city TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Products table with full-text search
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id UUID REFERENCES shops(id) ON DELETE CASCADE,
    seller_id UUID,
    category_id UUID REFERENCES categories(id),
    title TEXT NOT NULL,
    slug TEXT,
    description TEXT,
    short_description TEXT,
    price DECIMAL(10,2) NOT NULL,
    original_price DECIMAL(10,2),
    discount_percent INTEGER DEFAULT 0,
    category TEXT,
    location TEXT,
    school_id UUID REFERENCES schools(id) ON DELETE SET NULL,
    school_slug TEXT,
    school_name TEXT,
    school_city TEXT,
    campus_area TEXT,
    delivery_options JSONB NOT NULL DEFAULT '{}'::jsonb,
    seller_display_name TEXT,
    seller_avatar_url TEXT,
    condition TEXT CHECK (condition IS NULL OR condition IN ('new', 'used', 'fairly_used')),
    sku TEXT,
    stock INTEGER DEFAULT 0,
    low_stock_threshold INTEGER DEFAULT 5,
    status TEXT DEFAULT 'active' CHECK (status IN ('draft', 'active', 'inactive', 'out_of_stock')),
    moderation_status TEXT NOT NULL DEFAULT 'approved'
        CHECK (moderation_status IN ('pending', 'approved', 'rejected')),
    moderation_note TEXT,
    moderated_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    moderated_at TIMESTAMP WITH TIME ZONE,
    is_featured BOOLEAN DEFAULT FALSE,
    is_flash_deal BOOLEAN DEFAULT FALSE,
    flash_deal_end TIMESTAMP WITH TIME ZONE,
    rating DECIMAL(3,2) DEFAULT 0,
    reviews_count INTEGER DEFAULT 0,
    sales_count INTEGER DEFAULT 0,
    view_count INTEGER DEFAULT 0,
    tags TEXT[],
    specifications JSONB,
    search_vector tsvector,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Product Images table
CREATE TABLE IF NOT EXISTS product_images (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID REFERENCES products(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    alt_text TEXT,
    is_primary BOOLEAN DEFAULT FALSE,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Private buyer/seller conversations are separate from public seller contact
-- details. The RPC and participant RLS policies are defined in
-- cloudflare-dashboard.sql after the current-profile helpers are installed.
CREATE TABLE IF NOT EXISTS public.product_conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    buyer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    seller_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_message_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT product_conversations_no_self_message CHECK (buyer_id <> seller_id),
    CONSTRAINT product_conversations_product_buyer_unique UNIQUE (product_id, buyer_id)
);

CREATE TABLE IF NOT EXISTS public.product_conversation_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES public.product_conversations(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    body TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_conversations_seller_activity
    ON public.product_conversations(seller_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_conversations_buyer_activity
    ON public.product_conversations(buyer_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_conversation_messages_thread
    ON public.product_conversation_messages(conversation_id, created_at);

-- Orders table
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_number TEXT UNIQUE NOT NULL,
    idempotency_key TEXT,
    customer_id UUID REFERENCES profiles(id),
    shop_id UUID REFERENCES shops(id),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded')),
    subtotal DECIMAL(10,2) NOT NULL,
    shipping_cost DECIMAL(10,2) DEFAULT 0,
    tax DECIMAL(10,2) DEFAULT 0,
    discount DECIMAL(10,2) DEFAULT 0,
    total DECIMAL(10,2) NOT NULL,
    shipping_address JSONB,
    billing_address JSONB,
    payment_method TEXT,
    payment_status TEXT DEFAULT 'pending',
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Order Items table
CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id),
    shop_id UUID REFERENCES shops(id),
    title TEXT NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    quantity INTEGER NOT NULL,
    total DECIMAL(10,2) NOT NULL,
    image_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Reviews table
CREATE TABLE IF NOT EXISTS reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID REFERENCES products(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES profiles(id),
    order_id UUID REFERENCES orders(id),
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    title TEXT,
    comment TEXT,
    images TEXT[],
    is_verified_purchase BOOLEAN DEFAULT FALSE,
    is_approved BOOLEAN DEFAULT TRUE,
    helpful_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Wishlist table
CREATE TABLE IF NOT EXISTS wishlists (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, product_id)
);

-- Cart Items table
CREATE TABLE IF NOT EXISTS cart_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id) ON DELETE CASCADE,
    quantity INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, product_id)
);

-- Promotions table
CREATE TABLE IF NOT EXISTS promotions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    discount_type TEXT CHECK (discount_type IN ('percentage', 'fixed')),
    discount_value DECIMAL(10,2) NOT NULL,
    min_order_amount DECIMAL(10,2) DEFAULT 0,
    max_discount DECIMAL(10,2),
    usage_limit INTEGER,
    used_count INTEGER DEFAULT 0,
    start_date TIMESTAMP WITH TIME ZONE,
    end_date TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT TRUE,
    shop_id UUID REFERENCES shops(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Audit Logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES profiles(id),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

/*
 * Compatibility columns for projects created from an older schema.
 *
 * Keep this block before every index, trigger, policy, and RPC below.  In
 * particular, seller_id must exist before idx_products_seller_id is created.
 * These additions are intentionally additive; existing data is not deleted or
 * rewritten by the base schema.
 */
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS account_type TEXT DEFAULT 'customer';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'customer';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS business_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS business_state TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS business_institution TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS following_shops UUID[];

ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS owner_id UUID;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS current_owner_id UUID;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS coverage_areas TEXT[];
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS followers_count INTEGER DEFAULT 0;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS is_available BOOLEAN DEFAULT TRUE;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS rental_status TEXT DEFAULT 'available';
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS courier_name TEXT;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS service_location TEXT;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS courier_sla_days INTEGER DEFAULT 3;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS delivery_cutoff_hour INTEGER DEFAULT 14;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS delivery_reliability INTEGER DEFAULT 86;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS seller_id UUID;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS school_id UUID;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS delivery_options JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS school_slug TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS school_name TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS school_city TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS campus_area TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS seller_display_name TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS seller_avatar_url TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS moderation_status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS moderation_note TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS moderated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMP WITH TIME ZONE;
UPDATE public.products
SET moderation_status = 'approved'
WHERE moderation_status IS NULL;
ALTER TABLE public.products
    ALTER COLUMN moderation_status SET DEFAULT 'approved',
    ALTER COLUMN moderation_status SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.products'::regclass
          AND conname = 'products_moderation_status_valid'
    ) THEN
        ALTER TABLE public.products
            ADD CONSTRAINT products_moderation_status_valid
            CHECK (moderation_status IN ('pending', 'approved', 'rejected'));
    END IF;
END;
$$;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS condition TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS search_vector tsvector;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS processing_days INTEGER DEFAULT 1;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS inventory_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS quality_score INTEGER DEFAULT 100;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS policy_status TEXT DEFAULT 'ready';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS provenance_status TEXT DEFAULT 'not_required';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS provenance_documents JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS duplicate_group TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_priority_ad BOOLEAN DEFAULT FALSE;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS ad_status TEXT DEFAULT 'none';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS ad_amount_ngn INTEGER;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS ad_approved_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS orders_idempotency_key
    ON public.orders (idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- seller_id is the Supabase Auth UUID for new marketplace listings.
-- Existing profile-id values remain readable until they are migrated.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_user_id_key
    ON public.profiles (user_id)
    WHERE user_id IS NOT NULL;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_products_shop_id ON products(shop_id);
CREATE INDEX IF NOT EXISTS idx_products_seller_id ON products(seller_id);
CREATE INDEX IF NOT EXISTS idx_products_school_slug ON products(school_slug);
CREATE INDEX IF NOT EXISTS idx_products_location_school ON products(location, school_slug);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_moderation_status ON products(moderation_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_is_flash_deal ON products(is_flash_deal);
CREATE INDEX IF NOT EXISTS idx_products_created_at ON products(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_search ON products USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_shop_id ON orders(shop_id);
CREATE INDEX IF NOT EXISTS idx_reviews_product_id ON reviews(product_id);
CREATE INDEX IF NOT EXISTS idx_shops_status ON shops(status);
CREATE INDEX IF NOT EXISTS idx_shops_rental_status ON shops(rental_status);
CREATE INDEX IF NOT EXISTS idx_shops_is_available ON shops(is_available);
CREATE INDEX IF NOT EXISTS idx_rental_contracts_shop_id ON rental_contracts(shop_id);
CREATE INDEX IF NOT EXISTS idx_rental_contracts_tenant_id ON rental_contracts(tenant_id);

-- Function to update search vector
CREATE OR REPLACE FUNCTION update_product_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector := to_tsvector('english', 
        COALESCE(NEW.title, '') || ' ' || 
        COALESCE(NEW.description, '') || ' ' || 
        COALESCE(NEW.short_description, '') || ' ' ||
        COALESCE(NEW.category, '')
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update search vector on insert/update
DROP TRIGGER IF EXISTS update_product_search ON products;
CREATE TRIGGER update_product_search
    BEFORE INSERT OR UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION update_product_search_vector();

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
DROP TRIGGER IF EXISTS update_profiles_updated_at ON profiles;
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_shops_updated_at ON shops;
CREATE TRIGGER update_shops_updated_at BEFORE UPDATE ON shops FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_products_updated_at ON products;
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_orders_updated_at ON orders;
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_rental_contracts_updated_at ON rental_contracts;
CREATE TRIGGER update_rental_contracts_updated_at BEFORE UPDATE ON rental_contracts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Marketplace intelligence expansion: durable consented events, seller
-- operating signals, delivery inputs, and listing trust metadata.
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_priority_ad BOOLEAN DEFAULT FALSE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS ad_status TEXT DEFAULT 'none';
ALTER TABLE products ADD COLUMN IF NOT EXISTS ad_amount_ngn INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS ad_approved_at TIMESTAMP WITH TIME ZONE;

CREATE TABLE IF NOT EXISTS advertisement_settings (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    bank_name TEXT NOT NULL DEFAULT '',
    account_name TEXT NOT NULL DEFAULT '',
    account_number TEXT NOT NULL DEFAULT '',
    instructions TEXT,
    amount_ngn INTEGER NOT NULL DEFAULT 999,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS marketplace_settings (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    product_image_limit INTEGER NOT NULL DEFAULT 10
        CHECK (product_image_limit BETWEEN 1 AND 100),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
INSERT INTO marketplace_settings (id, product_image_limit)
VALUES (1, 10)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS advertisement_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    shop_id UUID REFERENCES shops(id) ON DELETE SET NULL,
    promoter_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    amount_ngn INTEGER NOT NULL DEFAULT 999 CHECK (amount_ngn = 999),
    payment_reference TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    review_note TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ad_requests_status ON advertisement_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_requests_product ON advertisement_requests(product_id);
CREATE TABLE IF NOT EXISTS marketplace_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_name TEXT NOT NULL,
    session_id TEXT NOT NULL,
    variant TEXT NOT NULL,
    region TEXT,
    location TEXT,
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    category TEXT,
    properties JSONB DEFAULT '{}'::jsonb,
    contribution_margin DECIMAL(12,2),
    occurred_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_marketplace_events_time ON marketplace_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_marketplace_events_variant ON marketplace_events(variant, event_name);
ALTER TABLE marketplace_events ADD COLUMN IF NOT EXISTS location TEXT;

-- Operational telemetry is intentionally separate from consented buyer
-- personalization. It stores bounded route/status/timing data only; never
-- payment details, credentials, contact details, or request bodies.
CREATE TABLE IF NOT EXISTS operational_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_name TEXT NOT NULL CHECK (event_name IN (
        'catalogue_failure',
        'checkout_abandonment',
        'checkout_failure',
        'auth_failure',
        'slow_api_request',
        'seller_publish_error',
        'client_error'
    )),
    session_id TEXT NOT NULL,
    route TEXT,
    region TEXT,
    status_code INTEGER,
    duration_ms INTEGER,
    request_id TEXT,
    properties JSONB DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_operational_events_time ON operational_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_operational_events_name ON operational_events(event_name, occurred_at);
ALTER TABLE operational_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE operational_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE operational_events TO service_role;
