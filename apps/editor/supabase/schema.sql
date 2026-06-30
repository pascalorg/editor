-- =============================================================
-- Pascal Editor — Permission & Audit System
-- Run once in Supabase SQL Editor (Dashboard → SQL Editor)
-- =============================================================

-- ── 1. User Profiles ─────────────────────────────────────────
-- Extends auth.users with display name and role.
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id           UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT        NOT NULL DEFAULT '',
  role         TEXT        NOT NULL DEFAULT 'viewer'
                           CHECK (role IN ('admin', 'editor', 'viewer')),
  is_active    BOOLEAN     NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── 2. Groups / Departments ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.groups (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL UNIQUE,
  description TEXT,
  color       TEXT        DEFAULT '#6366f1',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 3. Group Members ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.group_members (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   UUID        NOT NULL REFERENCES public.groups(id)      ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (group_id, user_id)
);

-- ── 4. Parameter Permissions ──────────────────────────────────
-- Which parametric fields a group can WRITE to, per node kind.
-- Use node_kind = '*' to apply to all kinds.
-- Use parameter_key = '*' to allow all fields of a kind.
CREATE TABLE IF NOT EXISTS public.parameter_permissions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      UUID        NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  node_kind     TEXT        NOT NULL,
  parameter_key TEXT        NOT NULL,
  can_write     BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (group_id, node_kind, parameter_key)
);

CREATE INDEX IF NOT EXISTS parameter_permissions_group_kind_idx
  ON public.parameter_permissions(group_id, node_kind);

-- ── 5. Custom Fields ─────────────────────────────────────────
-- Admin-defined fields that extend node.metadata.
CREATE TABLE IF NOT EXISTS public.custom_fields (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  key        TEXT        NOT NULL UNIQUE,
  label      TEXT        NOT NULL,
  field_type TEXT        NOT NULL DEFAULT 'text'
             CHECK (field_type IN ('text', 'number', 'date', 'boolean', 'enum')),
  node_kind  TEXT        NOT NULL DEFAULT '*',
  options    JSONB,
  unit       TEXT,
  required   BOOLEAN     NOT NULL DEFAULT false,
  sort_order INTEGER     NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS custom_fields_node_kind_idx
  ON public.custom_fields(node_kind);

-- ── 6. Custom Field Permissions ──────────────────────────────
-- Which groups can write to which custom fields.
CREATE TABLE IF NOT EXISTS public.custom_field_permissions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  custom_field_id UUID        NOT NULL REFERENCES public.custom_fields(id) ON DELETE CASCADE,
  group_id        UUID        NOT NULL REFERENCES public.groups(id)         ON DELETE CASCADE,
  can_write       BOOLEAN     NOT NULL DEFAULT true,
  UNIQUE (custom_field_id, group_id)
);

-- ── 7. Audit Log ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name   TEXT        NOT NULL DEFAULT '',
  scene_id    TEXT        NOT NULL,
  node_id     TEXT        NOT NULL,
  node_kind   TEXT        NOT NULL,
  node_label  TEXT,
  action      TEXT        NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  field_key   TEXT,
  field_label TEXT,
  old_value   JSONB,
  new_value   JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_log_scene_node_idx
  ON public.audit_log(scene_id, node_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_user_idx
  ON public.audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_created_at_idx
  ON public.audit_log(created_at DESC);

-- =============================================================
-- Row-Level Security
-- =============================================================

ALTER TABLE public.user_profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parameter_permissions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_fields           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_field_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log               ENABLE ROW LEVEL SECURITY;

-- Helper: is the current user an admin?
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- user_profiles: anyone reads; self can update own name; admin does everything
CREATE POLICY "users read all profiles"
  ON public.user_profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "users update own profile"
  ON public.user_profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "admin manages profiles"
  ON public.user_profiles FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- groups: all authenticated can read; only admin writes
CREATE POLICY "authenticated read groups"
  ON public.groups FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manages groups"
  ON public.groups FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- group_members: all authenticated can read; only admin writes
CREATE POLICY "authenticated read group members"
  ON public.group_members FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manages group members"
  ON public.group_members FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- parameter_permissions: all authenticated can read; only admin writes
CREATE POLICY "authenticated read parameter permissions"
  ON public.parameter_permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manages parameter permissions"
  ON public.parameter_permissions FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- custom_fields: all authenticated can read; only admin writes
CREATE POLICY "authenticated read custom fields"
  ON public.custom_fields FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manages custom fields"
  ON public.custom_fields FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- custom_field_permissions: all authenticated can read; only admin writes
CREATE POLICY "authenticated read custom field permissions"
  ON public.custom_field_permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manages custom field permissions"
  ON public.custom_field_permissions FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- audit_log: admin reads all; authenticated users insert own entries
CREATE POLICY "admin reads audit log"
  ON public.audit_log FOR SELECT TO authenticated
  USING (public.is_admin());
CREATE POLICY "authenticated inserts audit log"
  ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
