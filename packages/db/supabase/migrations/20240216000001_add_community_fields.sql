-- Add community features to properties table
ALTER TABLE properties ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS views INTEGER NOT NULL DEFAULT 0;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS likes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

-- Create indexes for community queries
CREATE INDEX IF NOT EXISTS idx_properties_is_private ON properties(is_private) WHERE is_private = false;
CREATE INDEX IF NOT EXISTS idx_properties_views ON properties(views DESC);
CREATE INDEX IF NOT EXISTS idx_properties_likes ON properties(likes DESC);

-- Set existing properties to private (user opt-in to share)
UPDATE properties SET is_private = true WHERE is_private IS NULL;
