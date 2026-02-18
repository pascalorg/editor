-- Properties tables
-- Simple property management without organizations

-- Properties addresses table (must be created first due to foreign key)
CREATE TABLE IF NOT EXISTS properties_addresses (
  id TEXT PRIMARY KEY,
  street_number TEXT,
  route TEXT,
  route_short TEXT,
  neighborhood TEXT,
  city TEXT,
  county TEXT,
  state TEXT,
  state_long TEXT,
  postal_code TEXT,
  postal_code_suffix TEXT,
  country TEXT,
  country_long TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  raw_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(street_number, route, city, state, postal_code)
);

CREATE INDEX IF NOT EXISTS idx_properties_addresses_city_state ON properties_addresses(city, state);

-- Properties table
CREATE TABLE IF NOT EXISTS properties (
  id TEXT PRIMARY KEY,
  name TEXT,
  address_id TEXT UNIQUE REFERENCES properties_addresses(id) ON DELETE SET NULL,
  owner_id TEXT REFERENCES auth_users(id) ON DELETE SET NULL,
  details_json JSONB,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_properties_owner_id ON properties(owner_id);
CREATE INDEX IF NOT EXISTS idx_properties_address_id ON properties(address_id);

-- Properties models table (scene graphs)
CREATE TABLE IF NOT EXISTS properties_models (
  id TEXT PRIMARY KEY,
  name TEXT,
  version INTEGER DEFAULT 1,
  description TEXT,
  draft BOOLEAN DEFAULT true,
  property_id TEXT REFERENCES properties(id) ON DELETE SET NULL,
  scene_graph JSONB,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_properties_models_property_id ON properties_models(property_id);
CREATE INDEX IF NOT EXISTS idx_properties_models_version ON properties_models(property_id, version DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties_models ENABLE ROW LEVEL SECURITY;

-- RLS Policies for properties table
CREATE POLICY "Users can view their own properties"
  ON properties FOR SELECT
  USING (owner_id = current_setting('app.user_id', true)::TEXT OR owner_id IS NULL);

CREATE POLICY "Users can insert their own properties"
  ON properties FOR INSERT
  WITH CHECK (owner_id = current_setting('app.user_id', true)::TEXT OR owner_id IS NULL);

CREATE POLICY "Users can update their own properties"
  ON properties FOR UPDATE
  USING (owner_id = current_setting('app.user_id', true)::TEXT OR owner_id IS NULL);

CREATE POLICY "Users can delete their own properties"
  ON properties FOR DELETE
  USING (owner_id = current_setting('app.user_id', true)::TEXT OR owner_id IS NULL);

-- RLS Policies for properties_addresses table
-- Addresses table doesn't have property_id, so we'll allow all authenticated users
CREATE POLICY "Authenticated users can view all addresses"
  ON properties_addresses FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can insert addresses"
  ON properties_addresses FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update addresses"
  ON properties_addresses FOR UPDATE
  USING (true);

CREATE POLICY "Authenticated users can delete addresses"
  ON properties_addresses FOR DELETE
  USING (true);

-- RLS Policies for properties_models table
CREATE POLICY "Users can view models of their own properties"
  ON properties_models FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM properties
      WHERE properties.id = properties_models.property_id
      AND properties.owner_id = current_setting('app.user_id', true)::TEXT
    )
  );

CREATE POLICY "Users can insert models for their own properties"
  ON properties_models FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM properties
      WHERE properties.id = properties_models.property_id
      AND properties.owner_id = current_setting('app.user_id', true)::TEXT
    )
  );

CREATE POLICY "Users can update models of their own properties"
  ON properties_models FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM properties
      WHERE properties.id = properties_models.property_id
      AND properties.owner_id = current_setting('app.user_id', true)::TEXT
    )
  );

CREATE POLICY "Users can delete models of their own properties"
  ON properties_models FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM properties
      WHERE properties.id = properties_models.property_id
      AND properties.owner_id = current_setting('app.user_id', true)::TEXT
    )
  );

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_properties_updated_at
  BEFORE UPDATE ON properties
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_properties_addresses_updated_at
  BEFORE UPDATE ON properties_addresses
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_properties_models_updated_at
  BEFORE UPDATE ON properties_models
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
