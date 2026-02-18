-- Add active_property_id to sessions table
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS active_property_id TEXT;
