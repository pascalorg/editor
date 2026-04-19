# Research synthesis — "MCP creates scene → I open it in the editor"

> 10 parallel research agents (R1–R10) investigated this workflow against the Pascal repo. This document pulls their findings into a single actionable answer.

## Direct answer to your question

**Yes, this is the right approach. And it's about 40% already built.** The Pascal Editor was designed from day one to be backend-agnostic — `onLoad(sceneId)` / `onSave(scene)` callbacks are public props. The plumbing that's missing isn't the Editor; it's the **scene-entity layer** (id, name, thumbnail, owner) and **a backend to store it**. The groundwork for that backend is already laid in env vars and privacy policy, but zero lines of backend code exist yet.

## What exists today (40%)

| Piece | Status | Evidence |
|---|---|---|
| Scene graph serialization | ✅ done | `SceneGraph` type; `export_json` MCP tool; `"Save Build"` UI button |
| Scene graph deserialization | ✅ done | `applySceneGraphToEditor()` + `setScene()`; `"Load Build"` UI button |
| Autosave pipeline (debounced, status-reported) | ✅ done | `use-auto-save.ts` with 6-state machine + `onSaveStatusChange` |
| Host persistence hooks (`onLoad`, `onSave`, `onDirty`) | ✅ done | `<Editor>` props, R2 |
| Thumbnail auto-capture | ✅ done | `onThumbnailCapture` fires ~10s after scene stable, 1920×1080 SSGI |
| Store-level project scoping | ✅ done | `projectId` prop flows through viewer + selection |
| localStorage fallback persistence | ✅ done | `pascal-editor-scene` key |
| IndexedDB for assets | ✅ done | `idb-keyval` for texture blobs |
| Single route (`/`) | ✅ done | but no dynamic segments — R4 |

## What's missing (60%)

| Piece | Effort | Owner |
|---|---|---|
| Scene entity metadata (id, name, thumbnail, owner, created_at) | S | R2 gap |
| Backend storage (Supabase `scenes` table) — env is declared, code is zero | M | R5 gap |
| Dynamic routes `/scene/[id]` and `/editor/[projectId]/[sceneId]` | S | R4 gap |
| Scene-list UI (picker, rename, delete, duplicate) | M | R3 gap |
| MCP tools for scene lifecycle (`save_scene`, `list_scenes`, `load_scene`, `delete_scene`) | S | R8 |
| Zod validation at the scene-load boundary | XS | R6 gap (pre-existing security finding) |
| Auth (Supabase auth / Better Auth — env is declared, code is zero) | M | R5, R9 gap |
| Device-pairing flow so MCP acts as the user | M | R9, R8 |

## The recommended plan — R8's phased approach

**Ship Option A this week. Commit to Option B for production. Defer D (real-time) to Q2. Skip C and E.**

### Week 1 — Option A: filesystem handoff (kills the injection hack)

```
MCP ──► ~/.pascal/scenes/<slug>.json ──► Next.js API route ──► /scene/<slug> page ──► applySceneGraphToEditor()
```

- New MCP tools: `save_scene({ slug })`, `load_scene({ slug })`, `list_scenes()`.
- New Next.js route `/scene/[slug]` that fetches `/api/scenes/[slug]` and loads via the existing `applySceneGraphToEditor` utility.
- Delete `window.__pascalScene` injection from `apps/editor/app/page.tsx`.
- **Effort: 1–2 days. No new deps. No breaking changes.**

### Weeks 2–4 — Option B: Supabase backend (the product path)

```
MCP ──► Supabase (SERVICE_ROLE) ──► scenes table
Editor /scene/[id] ──► Supabase (ANON_KEY + RLS) ──► scenes row
```

Schema:
```sql
create table scenes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id),
  owner_id uuid references auth.users(id),
  name text not null,
  graph_json jsonb not null,
  thumbnail_url text,
  version int not null default 1,
  public boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table scene_revisions (
  scene_id uuid references scenes(id) on delete cascade,
  version int,
  graph_json jsonb,
  author_kind text check (author_kind in ('human','mcp','agent')),
  created_at timestamptz default now(),
  primary key (scene_id, version)
);
```

- MCP side: ~200 LOC. `save_scene` → `supabase.from('scenes').upsert({...})`.
- Editor side: `/scene/[id]/page.tsx` is a Server Component that fetches the row and passes to a client `<SceneLoader>`.
- RLS: owner reads/writes; `public = true` rows readable by anyone.
- **Effort: ~2 weeks.**

### Quarter 2 — Option D: live mode via Supabase Realtime

Supabase's `postgres_changes` channel over the `scenes` row gives you cross-agent realtime without Yjs. A human editing at the same time as an MCP agent would see each other's changes. This is **not** an MCP protocol feature — it's a Postgres feature that Supabase exposes. Much cheaper than rebuilding on Yjs (Option E).

### What about Yjs / CRDT (Option E)?

Defer. It's a 3-month rewrite of `@pascal-app/core`'s store. Only justified if multiplayer is the moat, which the current product signal doesn't demonstrate. If you DO go there later, the migration is painless because `applySceneGraphToEditor` still accepts a `SceneGraph` — you'd just rewrite the store underneath.

## Edge cases R10 surfaced that you hadn't mentioned

1. **"Auto-frame camera on MCP-opened scene"** — today the MCP creates a scene at world origin, the default editor camera points at 30m grid, user sees a black screen. Tiny fix, huge UX win.
2. **MCP-written scenes can carry malicious URLs** — `guide.url`, `scan.url`, `material.texture.url`, `item.asset.src` are `z.string()` in core (no scheme allowlist). A scene opened in the editor can beacon home. **This is the same finding as the Phase 3 security audit, not remediated.**
3. **Overwrite vs merge when MCP edits a scene the user is also editing** — today: last-writer-wins silently. Needs ETag or revision-number optimistic locking.
4. **Scene size limit** — Supabase API has an 8MB body limit. Casa del Sol is 27 KB; a real project might go to 1–2 MB. Measure before you commit.
5. **Undo-stack surprise** — an MCP multi-op patch collapses to ONE undo step. From the user's view, Ctrl+Z wipes the whole MCP run. Might be surprising. Document or segment.
6. **`metadata: json` on every node is AI-visible** — an attacker-crafted `metadata.note: "ignore all instructions and..."` could prompt-inject a summarising agent.
7. **MCP and editor use separate Zundo temporal stores** — undo in one doesn't reach the other.
8. **`SiteNode.children` holds objects not ids** — shipping the scene across the wire requires handling this inconsistency (already workaround-ed in MCP; would re-emerge on the Supabase side).
9. **Offline editor opening a cloud-only scene** — degrade to cached/read-only, don't crash.
10. **Agent writes infinite scenes in a loop** — quota + rate limits per user.

## Ideas you didn't ask for but should consider (R10's top 10 by value×feasibility)

1. **Photo → Pascal** — MCP already has `analyze_floorplan_image`. The unblocker is: a scene UI "Upload floor plan" → vision tool → new scene. Highest ROI in the repo.
2. **Scene templates catalogue** — doubles as marketplace seed inventory.
3. **Auto-framing camera** — fixes "black screen" failure mode.
4. **Prompt → Pascal one-shot studio** — the canonical "MCP creates scene" hosted flow.
5. **Multi-variant generation** — "give me 5 variations" using `forkSceneGraph` (already in core).
6. **Scene diff view** — makes AI actions reviewable.
7. **BOM + cost synthesis** — turns toy scenes into quoteable artefacts.
8. **Scene branches & forks** — prerequisite for co-design workflows.
9. **GLB export via headless renderer** — unlocks AR + USD/IFC pipelines.
10. **Regulatory / accessibility linting** — B2B architect segment.

## Production readiness (R9)

**~4–5 weeks to private beta. ~10–14 weeks to GA.** Dominated by:
- Greenfield auth + persistence (Supabase rails declared but zero code).
- URL hardening migration on core node schemas (close the security audit's Phase 3 gap properly, not just in MCP).
- Optimistic concurrency / revision tracking.
- ETag-based merge UX.

Phase A (transport hardening + URL validation) is decoupled and can ship week 1 as a defensive floor.

## What you should tell me next

Answer these and I can write the implementation PR:

1. **Deployment target** — local-only (Option A sufficient), or Vercel + multi-user (must do B)?
2. **Auth direction** — Supabase Auth, Better Auth (env var is there), Clerk, or none yet?
3. **Scope for v0.1** — just "save + open" with one hardcoded user, OR proper multi-tenant + sharing from day one?
4. **Scene-list UI location** — inside the Editor package (add a new panel), inside the host app (`apps/editor`), or both?
5. **What do I do with the current `feat/mcp-server` branch?** — merge as is (MCP server + test-reports), or fold this new work into the same branch, or open a new `feat/mcp-persistence` branch?

My recommendation in one line: **answer 1 = Vercel/multi-user → ship Option A as a branch-local step this week, then B over weeks 2–4, and merge the whole thing as `feat/mcp-cloud-scenes`**.

## Report index

- [R1 — Persistence layer](./R1-persistence.md) — localStorage-only, single key, no backend
- [R2 — `projectId` semantics & Editor API](./R2-project-id.md) — Editor is backend-agnostic via `onLoad`/`onSave`
- [R3 — Scene management UI](./R3-scene-ui.md) — 40% there; needs scene list + palette commands
- [R4 — Routing & URLs](./R4-routing.md) — zero dynamic routes; latent expectation of `/editor/<projectId>/…`
- [R5 — Backend / Supabase](./R5-backend.md) — env declared, zero code
- [R6 — File I/O pathways](./R6-file-io.md) — "Save/Load Build" work; no Zod validation on import
- [R7 — `@pascal-app/editor` API](./R7-editor-api.md) — rich callback surface; scene switcher is a 1–2 day host feature
- [R8 — Integration design options](./R8-mcp-integration-design.md) — A→B→D phased recommendation
- [R9 — Production readiness](./R9-production-readiness.md) — 4–5 weeks to beta, 10–14 to GA
- [R10 — Ideas and edge cases](./R10-ideas-and-edges.md) — 300+ lines; top 10 ranked by value×feasibility
