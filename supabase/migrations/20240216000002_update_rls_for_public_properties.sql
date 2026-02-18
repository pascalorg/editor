-- Drop existing RLS policies for properties
DROP POLICY IF EXISTS "Users can view their own properties" ON properties;
DROP POLICY IF EXISTS "Users can insert their own properties" ON properties;
DROP POLICY IF EXISTS "Users can update their own properties" ON properties;
DROP POLICY IF EXISTS "Users can delete their own properties" ON properties;

-- New RLS policy: Users can view their own properties OR public properties
CREATE POLICY "Users can view own or public properties"
  ON properties FOR SELECT
  USING (
    owner_id = current_setting('app.user_id', true)::TEXT
    OR is_private = false
    OR owner_id IS NULL
  );

-- Keep other policies the same (insert/update/delete still require ownership)
CREATE POLICY "Users can insert their own properties"
  ON properties FOR INSERT
  WITH CHECK (owner_id = current_setting('app.user_id', true)::TEXT OR owner_id IS NULL);

CREATE POLICY "Users can update their own properties"
  ON properties FOR UPDATE
  USING (owner_id = current_setting('app.user_id', true)::TEXT OR owner_id IS NULL);

CREATE POLICY "Users can delete their own properties"
  ON properties FOR DELETE
  USING (owner_id = current_setting('app.user_id', true)::TEXT OR owner_id IS NULL);

-- Drop existing RLS policies for models
DROP POLICY IF EXISTS "Users can view models of their own properties" ON properties_models;
DROP POLICY IF EXISTS "Users can insert models for their own properties" ON properties_models;
DROP POLICY IF EXISTS "Users can update models of their own properties" ON properties_models;
DROP POLICY IF EXISTS "Users can delete models of their own properties" ON properties_models;

-- Update models policy: Users can view models of their own properties OR public properties
CREATE POLICY "Users can view models of own or public properties"
  ON properties_models FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM properties
      WHERE properties.id = properties_models.property_id
      AND (
        properties.owner_id = current_setting('app.user_id', true)::TEXT
        OR properties.is_private = false
      )
    )
  );

-- Keep other model policies the same
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
