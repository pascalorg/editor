-- Function to atomically increment view count
CREATE OR REPLACE FUNCTION increment_property_views(property_id TEXT)
RETURNS void AS $$
BEGIN
  UPDATE properties
  SET views = views + 1
  WHERE id = property_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
