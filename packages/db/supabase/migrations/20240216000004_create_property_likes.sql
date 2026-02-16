-- Create property_likes table to track user likes
CREATE TABLE IF NOT EXISTS property_likes (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Ensure a user can only like a property once
  UNIQUE(property_id, user_id)
);

-- Enable RLS
ALTER TABLE property_likes ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can view all likes (to see like counts)
CREATE POLICY "Anyone can view likes"
  ON property_likes FOR SELECT
  USING (true);

-- Users can insert their own likes
CREATE POLICY "Users can create their own likes"
  ON property_likes FOR INSERT
  WITH CHECK (user_id = current_setting('app.user_id', true)::TEXT);

-- Users can delete their own likes
CREATE POLICY "Users can delete their own likes"
  ON property_likes FOR DELETE
  USING (user_id = current_setting('app.user_id', true)::TEXT);

-- Create index for efficient querying
CREATE INDEX IF NOT EXISTS idx_property_likes_property_id ON property_likes(property_id);
CREATE INDEX IF NOT EXISTS idx_property_likes_user_id ON property_likes(user_id);

-- Function to get like count for a property
CREATE OR REPLACE FUNCTION get_property_like_count(property_id TEXT)
RETURNS INTEGER AS $$
BEGIN
  RETURN (SELECT COUNT(*)::INTEGER FROM property_likes WHERE property_likes.property_id = $1);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
