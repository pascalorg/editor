-- 0001_scenes.sql
-- Initial Pascal scene storage schema.
--
-- Creates:
--   * projects       — minimal project rows owned by an auth.users row
--   * scenes         — the current state of a scene (graph_json + metadata)
--   * scene_revisions — append-only revision log keyed by (scene_id, version)
--
-- Row-level security is enabled on all three tables. Owners get full access
-- to their own rows; anonymous users can read scenes flagged public = true.
-- The `service_role` key bypasses RLS, which is how the MCP server writes
-- on behalf of users.

-- Projects (minimal — we'll extend in a later PR)
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

-- Scenes
create table if not exists scenes (
  id text primary key,            -- slug; keeps URLs stable
  project_id uuid references projects(id) on delete cascade,
  owner_id uuid references auth.users(id) on delete set null,
  name text not null check (length(name) between 1 and 200),
  graph_json jsonb not null,
  thumbnail_url text,
  version int not null default 1 check (version >= 1),
  public boolean not null default false,
  size_bytes int not null default 0,
  node_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_scenes_owner on scenes(owner_id);
create index if not exists idx_scenes_project on scenes(project_id);
create index if not exists idx_scenes_updated on scenes(updated_at desc);

-- Revision history
create table if not exists scene_revisions (
  scene_id text references scenes(id) on delete cascade,
  version int not null,
  graph_json jsonb not null,
  author_kind text not null check (author_kind in ('human', 'mcp', 'agent')),
  author_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (scene_id, version)
);

-- RLS
alter table scenes enable row level security;
alter table scene_revisions enable row level security;
alter table projects enable row level security;

-- owner can do everything; anon can read public=true; service_role bypasses
create policy scenes_owner_all on scenes
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy scenes_public_read on scenes
  for select using (public = true);

create policy revisions_owner_read on scene_revisions
  for select using (
    exists (select 1 from scenes where scenes.id = scene_revisions.scene_id and scenes.owner_id = auth.uid())
  );

create policy projects_owner_all on projects
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- updated_at trigger
create or replace function tg_touch_updated() returns trigger as $$
begin new.updated_at := now(); return new; end;
$$ language plpgsql;
create trigger scenes_touch_updated before update on scenes
  for each row execute function tg_touch_updated();
