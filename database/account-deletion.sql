-- The canonical schema.sql already creates these objects. Apply this file
-- only to a legacy database that has public.profiles but predates the
-- deletion-request additions, before enabling POST /api/account/deletion-request.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
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