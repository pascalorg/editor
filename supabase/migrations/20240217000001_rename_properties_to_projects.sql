-- Migration: Rename properties → projects
-- This renames all property-related tables, columns, indexes, policies, and functions.

BEGIN;

-- ============================================================
-- 1. Drop existing RLS policies (they reference old table names)
-- ============================================================

-- properties policies
DROP POLICY IF EXISTS "Users can view own or public properties" ON properties;
DROP POLICY IF EXISTS "Users can insert their own properties" ON properties;
DROP POLICY IF EXISTS "Users can update their own properties" ON properties;
DROP POLICY IF EXISTS "Users can delete their own properties" ON properties;

-- properties_addresses policies
DROP POLICY IF EXISTS "Authenticated users can view all addresses" ON properties_addresses;
DROP POLICY IF EXISTS "Authenticated users can insert addresses" ON properties_addresses;
DROP POLICY IF EXISTS "Authenticated users can update addresses" ON properties_addresses;
DROP POLICY IF EXISTS "Authenticated users can delete addresses" ON properties_addresses;

-- properties_models policies
DROP POLICY IF EXISTS "Users can view models of own or public properties" ON properties_models;
DROP POLICY IF EXISTS "Users can insert models for their own properties" ON properties_models;
DROP POLICY IF EXISTS "Users can update models of their own properties" ON properties_models;
DROP POLICY IF EXISTS "Users can delete models of their own properties" ON properties_models;

-- property_likes policies
DROP POLICY IF EXISTS "Anyone can view likes" ON property_likes;
DROP POLICY IF EXISTS "Users can create their own likes" ON property_likes;
DROP POLICY IF EXISTS "Users can delete their own likes" ON property_likes;

-- ============================================================
-- 2. Drop old indexes (before renaming tables)
-- ============================================================

DROP INDEX IF EXISTS idx_properties_owner_id;
DROP INDEX IF EXISTS idx_properties_address_id;
DROP INDEX IF EXISTS idx_properties_is_private;
DROP INDEX IF EXISTS idx_properties_views;
DROP INDEX IF EXISTS idx_properties_likes;
DROP INDEX IF EXISTS idx_properties_addresses_city_state;
DROP INDEX IF EXISTS idx_properties_models_property_id;
DROP INDEX IF EXISTS idx_properties_models_version;
DROP INDEX IF EXISTS idx_property_likes_property_id;
DROP INDEX IF EXISTS idx_property_likes_user_id;
DROP INDEX IF EXISTS property_address_idx;
DROP INDEX IF EXISTS property_owner_idx;
DROP INDEX IF EXISTS property_is_private_idx;
DROP INDEX IF EXISTS property_views_idx;
DROP INDEX IF EXISTS property_likes_idx;

-- ============================================================
-- 3. Drop old triggers (before renaming tables)
-- ============================================================

DROP TRIGGER IF EXISTS update_properties_updated_at ON properties;
DROP TRIGGER IF EXISTS update_properties_addresses_updated_at ON properties_addresses;
DROP TRIGGER IF EXISTS update_properties_models_updated_at ON properties_models;

-- ============================================================
-- 4. Rename tables
-- ============================================================

ALTER TABLE properties_addresses RENAME TO projects_addresses;
ALTER TABLE properties_models RENAME TO projects_models;
ALTER TABLE property_likes RENAME TO projects_likes;
ALTER TABLE properties RENAME TO projects;

-- ============================================================
-- 5. Rename columns (property_id → project_id)
-- ============================================================

ALTER TABLE projects_models RENAME COLUMN property_id TO project_id;
ALTER TABLE projects_likes RENAME COLUMN property_id TO project_id;

-- Rename active_property_id in auth_sessions
ALTER TABLE auth_sessions RENAME COLUMN active_property_id TO active_project_id;

-- ============================================================
-- 6. Rename constraints
-- ============================================================

-- Rename the unique constraint on projects_likes
ALTER TABLE projects_likes RENAME CONSTRAINT "property_likes_pkey" TO "projects_likes_pkey";
ALTER TABLE projects_likes RENAME CONSTRAINT "property_likes_property_id_fkey" TO "projects_likes_project_id_fkey";
ALTER TABLE projects_likes RENAME CONSTRAINT "property_likes_property_id_user_id_key" TO "projects_likes_project_id_user_id_key";

-- ============================================================
-- 7. Recreate indexes with new names
-- ============================================================

CREATE INDEX project_address_idx ON projects(address_id);
CREATE INDEX project_owner_idx ON projects(owner_id);
CREATE INDEX project_is_private_idx ON projects(is_private) WHERE is_private = false;
CREATE INDEX project_views_idx ON projects(views DESC);
CREATE INDEX project_likes_idx ON projects(likes DESC);
CREATE INDEX idx_projects_addresses_city_state ON projects_addresses(city, state);
CREATE INDEX idx_projects_models_project_id ON projects_models(project_id);
CREATE INDEX idx_projects_models_version ON projects_models(project_id, version DESC);
CREATE INDEX idx_projects_likes_project_id ON projects_likes(project_id);
CREATE INDEX idx_projects_likes_user_id ON projects_likes(user_id);

-- ============================================================
-- 8. Recreate triggers on renamed tables
-- ============================================================

CREATE TRIGGER update_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_projects_addresses_updated_at
  BEFORE UPDATE ON projects_addresses
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_projects_models_updated_at
  BEFORE UPDATE ON projects_models
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 9. Recreate RLS policies with new names and table references
-- ============================================================

-- projects policies
CREATE POLICY "Users can view own or public projects"
  ON projects FOR SELECT
  USING (
    owner_id = current_setting('app.user_id', true)::TEXT
    OR is_private = false
    OR owner_id IS NULL
  );

CREATE POLICY "Users can insert their own projects"
  ON projects FOR INSERT
  WITH CHECK (owner_id = current_setting('app.user_id', true)::TEXT OR owner_id IS NULL);

CREATE POLICY "Users can update their own projects"
  ON projects FOR UPDATE
  USING (owner_id = current_setting('app.user_id', true)::TEXT OR owner_id IS NULL);

CREATE POLICY "Users can delete their own projects"
  ON projects FOR DELETE
  USING (owner_id = current_setting('app.user_id', true)::TEXT OR owner_id IS NULL);

-- projects_addresses policies
CREATE POLICY "Authenticated users can view all addresses"
  ON projects_addresses FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can insert addresses"
  ON projects_addresses FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update addresses"
  ON projects_addresses FOR UPDATE
  USING (true);

CREATE POLICY "Authenticated users can delete addresses"
  ON projects_addresses FOR DELETE
  USING (true);

-- projects_models policies
CREATE POLICY "Users can view models of own or public projects"
  ON projects_models FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = projects_models.project_id
      AND (
        projects.owner_id = current_setting('app.user_id', true)::TEXT
        OR projects.is_private = false
      )
    )
  );

CREATE POLICY "Users can insert models for their own projects"
  ON projects_models FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = projects_models.project_id
      AND projects.owner_id = current_setting('app.user_id', true)::TEXT
    )
  );

CREATE POLICY "Users can update models of their own projects"
  ON projects_models FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = projects_models.project_id
      AND projects.owner_id = current_setting('app.user_id', true)::TEXT
    )
  );

CREATE POLICY "Users can delete models of their own projects"
  ON projects_models FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = projects_models.project_id
      AND projects.owner_id = current_setting('app.user_id', true)::TEXT
    )
  );

-- projects_likes policies
CREATE POLICY "Anyone can view likes"
  ON projects_likes FOR SELECT
  USING (true);

CREATE POLICY "Users can create their own likes"
  ON projects_likes FOR INSERT
  WITH CHECK (user_id = current_setting('app.user_id', true)::TEXT);

CREATE POLICY "Users can delete their own likes"
  ON projects_likes FOR DELETE
  USING (user_id = current_setting('app.user_id', true)::TEXT);

-- ============================================================
-- 10. Replace functions with renamed versions
-- ============================================================

-- Drop old functions
DROP FUNCTION IF EXISTS increment_property_views(TEXT);
DROP FUNCTION IF EXISTS get_property_like_count(TEXT);

-- Recreate with new names
CREATE OR REPLACE FUNCTION increment_project_views(project_id TEXT)
RETURNS void AS $$
BEGIN
  UPDATE projects
  SET views = views + 1
  WHERE id = project_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_project_like_count(project_id TEXT)
RETURNS INTEGER AS $$
BEGIN
  RETURN (SELECT COUNT(*)::INTEGER FROM projects_likes WHERE projects_likes.project_id = $1);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

COMMIT;
