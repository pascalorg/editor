# R8 — MCP ↔ Editor Integration Design

**Vision.** "Call MCP → scene is saved → I open the scene in the editor, no injection."

Today `apps/editor/app/page.tsx` runs a dev-only `window.__pascalScene = useScene` hack so an MCP running in the same browser can `setScene()`. That has to die. MCP lives in Node (its own `SceneBridge` over `useScene`), editor lives in the browser (its own instance of `useScene`). They never share memory. So "saving" means **serializing a `SceneGraph` to a shared medium the editor can read**.

Below are five concrete options, ranked, with a recommendation.

---

## Option A — Filesystem handoff (`~/.pascal/scenes/<slug>.json`)

### Description

MCP writes `SceneGraph` JSON to `~/.pascal/scenes/<slug>.json` via a new `save_scene` tool. Next.js API route `GET /api/scenes/[slug]` reads the file from disk using `node:fs`. `/scene/[slug]` page fetches and calls `applySceneGraphToEditor()` on mount.

### Architecture

```
Claude Desktop / Cursor
        │  stdio
        ▼
  pascal-mcp (Node)
        │
  SceneBridge.exportJSON()
        │
        ▼
  ~/.pascal/scenes/kitchen-v3.json     ◄── shared disk
        ▲
        │  fs.readFile (server-side)
  Next.js API route /api/scenes/[slug]
        ▲
        │  fetch()
  /scene/[slug] page  ──► applySceneGraphToEditor()
```

### Pros

- Zero new infra, zero network between MCP and editor
- Works offline; trivial to debug (`cat ~/.pascal/scenes/foo.json`)
- No auth, no RLS, no API contracts beyond "JSON on disk"
- Editor's existing `applySceneGraphToEditor()` already accepts a `SceneGraph`; reusing `packages/mcp/src/bridge/scene-bridge.ts` `exportJSON()` is a one-liner
- Ships this week

### Cons

- Same-machine only. Breaks the second the editor is deployed to Vercel
- No multi-user, no sharing, no "open on phone"
- Filesystem becomes the source of truth with no history, diffs, or transactions
- Vercel/serverless deployment of the editor cannot read a local user directory (dead on arrival for production)

### Dependencies

- New `save_scene` / `list_scenes` tools in `packages/mcp/src/tools/`
- New `apps/editor/app/api/scenes/[slug]/route.ts`
- New `apps/editor/app/scene/[slug]/page.tsx`
- No new npm packages. No breaking changes.

### Effort: **S** (1–2 days)

### Security / auth / multi-user

- No auth (filesystem ACLs only). Anyone on the box can read the scenes
- Path traversal risk on the slug — must sanitize (`slugify`, reject `..`)
- No multi-user story whatsoever

### Production readiness: **low (local dev only)**

Valid as a transitional internal tool for solo use. Not shippable as the real product path. Use it as a **stepping stone to B**.

### 5-step v0.1 plan

1. Add `save_scene({ slug })` and `list_scenes()` tools that write to `~/.pascal/scenes/<slug>.json` (Node `fs/promises`, slug sanitization, `XDG_DATA_HOME` fallback)
2. Add `load_scene({ slug })` tool that calls `bridge.loadJSON(readFileSync(...))`
3. `apps/editor/app/api/scenes/[slug]/route.ts` — GET reads `~/.pascal/scenes/<slug>.json` with path-traversal guard, returns JSON
4. `apps/editor/app/scene/[slug]/page.tsx` — `use client`, fetches `/api/scenes/[slug]` on mount, calls `applySceneGraphToEditor()`
5. Delete the `window.__pascalScene` injection hack from `apps/editor/app/page.tsx`

---

## Option B — Shared Supabase backend (RECOMMENDED)

### Description

MCP and editor both talk to a Supabase `scenes` table. MCP has a `save_scene` tool that `upsert`s via the service role; editor's `/scene/[id]` page SSR-fetches the row with `anon` key and RLS. Existing `env.mjs` already declares `POSTGRES_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`. The rails are laid.

### Architecture

```
  Claude / agent
       │
       ▼
  pascal-mcp (Node) ─────► Supabase REST (service role)
       │                   INSERT scenes { id, owner_id, graph_json, updated_at }
       │
       │ returns { sceneId, url: "https://.../scene/<id>" }
       ▼
  User pastes / clicks URL
       │
       ▼
  Next.js editor (Vercel)
       │  SSR with anon key + RLS
       ▼
  /scene/[id]/page.tsx  ──► applySceneGraphToEditor()
       │
       │  on save-in-editor
       ▼
  PATCH scenes  (owner_id == auth.uid)
```

Tables:

```
scenes (id uuid pk, owner_id uuid fk auth.users, slug text, title text,
        graph_json jsonb, updated_at timestamptz, created_at timestamptz)
scene_revisions (id uuid pk, scene_id fk, author_id fk, graph_json jsonb,
                 created_at timestamptz, author_kind text)  -- "mcp" | "editor"
```

RLS: `owner_id = auth.uid()` for select/update; public-read if `public = true`.

### Pros

- One-machine and cross-device works the same way
- Multi-user, sharing via URL, versioning via `scene_revisions` — all free with Postgres
- Auth already half-wired: `BETTER_AUTH_SECRET` + `GOOGLE_CLIENT_ID` in env.mjs suggest Better Auth planned
- Editor can deploy to Vercel unchanged
- `graph_json` is a `jsonb` column — indexable, queryable, diffable
- Natural extension path to realtime (`supabase.channel`) and presence

### Cons

- Requires running Supabase (local via CLI, or hosted project)
- MCP now has a network dependency; offline stops working unless you layer IndexedDB cache on the editor side
- RLS policy mistakes are a classic data-leak vector
- MCP needs an `owner_id` — how does a stdio MCP know who the user is? Need a device-pairing or API-key bootstrap

### Dependencies

- New `@supabase/supabase-js` dep in `packages/mcp` (dependency) and `apps/editor` (already probably pulling it or easy add)
- Supabase project or local `supabase` CLI for dev
- Migration SQL for `scenes` + `scene_revisions`
- Small change to `packages/mcp` — env bootstrap, service-role key from `~/.pascal/config.json` or `PASCAL_SUPABASE_URL` / `PASCAL_SUPABASE_KEY` env
- No breaking changes to the `SceneBridge` — `exportJSON()` already produces exactly what we need

### Effort: **M** (1 week for v0.1, 2–3 weeks to production-harden RLS and auth bootstrap)

### Security / auth / multi-user

- Full multi-user with RLS
- MCP auth problem: solve with **device-pairing** — editor generates a short-lived token in UI ("paste this into Claude Desktop config"), MCP exchanges it for a long-lived machine token. Never put the service-role key in MCP; use per-user tokens
- Supabase handles rate limiting, backups, Point-in-time recovery
- Audit trail via `scene_revisions`

### Production readiness: **high**

Right-sized for a v1 product. Same story as Figma/Linear/Notion — server of record, optional local cache.

### 5-step v0.1 plan

1. Create `supabase/migrations/001_scenes.sql` with `scenes` and `scene_revisions` tables + RLS policies (owner read/write, public-slug read)
2. Add `packages/mcp/src/adapters/supabase.ts` using `@supabase/supabase-js`, driven by `PASCAL_SUPABASE_URL` + `PASCAL_SUPABASE_USER_TOKEN` env (not service-role). Wrap in `save_scene` / `load_scene` / `list_scenes` tools
3. Add `apps/editor/lib/supabase.ts` server client; add `apps/editor/app/scene/[id]/page.tsx` (server component) that fetches and passes `graph_json` to a client `<SceneLoader>` that runs `applySceneGraphToEditor()`
4. Editor-side "save" handler: on `Cmd+S` / debounced dirty, `UPDATE scenes SET graph_json, updated_at WHERE id=... AND owner_id=auth.uid()`. Append a row to `scene_revisions`
5. Add `/settings/mcp` route in editor that mints a device token and shows the JSON block the user pastes into `claude_desktop_config.json` (`env: { PASCAL_SUPABASE_USER_TOKEN: "..." }`)

---

## Option C — MCP *is* the backend (HTTP service)

### Description

Run `pascal-mcp` permanently as an HTTP service (already supported via `connectHttp` in `packages/mcp/src/transports/http.ts`). Add non-MCP REST endpoints `GET /scenes/:id`, `POST /scenes` alongside the MCP Streamable HTTP endpoint. Editor treats the MCP host as its backend.

### Architecture

```
  Claude / agent  ──MCP/Streamable HTTP──┐
                                          ▼
                                    pascal-mcp (Node HTTP :3917)
                                          │
                                          │  in-memory SceneBridge(s) + on-disk store
                                          │
  Next.js editor  ────GET /scenes/:id────►│
                  ◄───JSON {nodes,rootNodeIds}
                  ────POST /scenes───────►│
```

### Pros

- One process owns the scene graph; no dual-store problem
- Offline-friendly if MCP runs on localhost
- MCP already has HTTP transport; extending the Node `http.createServer` with a side route is ~30 lines
- Can introspect the scene via the same bridge MCP tools use → perfect consistency

### Cons

- `SceneBridge` is a singleton — multi-user requires either a bridge-per-request or a separate process per user. Neither is trivial
- Scaling story is poor: you'd have to build session isolation, persistence layer, auth, rate limits — you're rebuilding Supabase badly
- Deploying MCP-as-backend to production means running Node long-lived; no more stdio simplicity
- Ties the editor's backend lifecycle to whatever host is running MCP — if user closes Claude Desktop, the backend dies
- The MCP protocol is for tool invocation, not CRUD; layering both on one port muddies concerns

### Dependencies

- Expand `packages/mcp/src/transports/http.ts` with non-MCP REST routes (or a second `http.createServer`)
- Add a persistence adapter behind the `SceneBridge` (sqlite? jsonfile?)
- Requires an auth story if it ever leaves localhost
- No new external deps if sticking with `node:http`

### Effort: **M** (localhost dev) / **XL** (multi-user production)

### Security / auth / multi-user

- Localhost: none needed; bind to `127.0.0.1`
- Multi-user: has to add bridge sessions, auth, CORS, TLS — effectively builds a toy Supabase
- Exposing MCP HTTP publicly is a big liability (the MCP protocol itself has no native auth)

### Production readiness: **low for production, fine for local**

Reasonable for a "single-developer laptop" loop. Do not ship this as the multi-tenant story.

### 5-step v0.1 plan

1. Split `connectHttp` into `connectMcpHttp` (existing MCP route) and `connectApiHttp` (new REST). Share the same `SceneBridge` instance
2. Add `GET /api/scenes/:id`, `POST /api/scenes`, `GET /api/scenes` backed by an on-disk map `~/.pascal/scenes/*.json` (Option A persistence reused)
3. Add CORS allowlist for `http://localhost:3002` (editor dev port)
4. In the editor, `apps/editor/app/scene/[id]/page.tsx` calls `fetch('http://localhost:3917/api/scenes/[id]')` client-side
5. Wire a CLI flag `pascal-mcp --serve --port 3917 --data-dir ~/.pascal/scenes` that launches both transports

---

## Option D — Editor-as-MCP-client (live subscription)

### Description

Editor imports `@modelcontextprotocol/sdk/client` and connects to a long-running MCP server (the same `pascal-mcp --http`). It `list_tools`, `call_tool('get_scene')`, and subscribes to `notifications/resources/updated` for `pascal://scene/current`. Every change pushed from MCP triggers `applySceneGraphToEditor()`.

### Architecture

```
  Claude / agent ─(MCP stdio/HTTP)─► pascal-mcp  ◄─(MCP streamable HTTP)─ Editor
                                         │
                                      SceneBridge
                                         │
                                    single in-memory scene
                                         ▲
                    notifications/resources/updated  (push on change)
```

### Pros

- Real-time: agent edits a wall, editor redraws within an RTT
- One source of truth (MCP process)
- Reuses the MCP protocol on both sides — consistent model
- Feels magical for demos

### Cons

- MCP's resource-update notification contract is still thin in v1; `pascal://scene/current` would need to be a subscribable resource. Our server doesn't currently implement `notifications/resources/updated` — meaningful work to add
- MCP SDK was designed for tool hosts (Claude Desktop, etc.), not for browser long-running clients — running the MCP client in the browser via streamable HTTP is possible but fragile (CORS, SSE, browser-tab lifecycle)
- `SceneBridge` still isn't multi-tenant — same singleton problem as C
- MCP server outages = editor is broken. Tight coupling
- Authentication for the browser → MCP HTTP transport is not a solved problem
- Overkill if you just want "save and open"; this is real-time collab territory

### Dependencies

- `@modelcontextprotocol/sdk/client` in `apps/editor` (new dep in browser bundle — SDK is Node-first, bundle size TBD)
- Add resource subscription support to `packages/mcp/src/server.ts` and `scene-current.ts`
- CORS + auth for MCP HTTP

### Effort: **L** (mostly in MCP server — subscriptions, auth, CORS; plus editor client integration)

### Security / auth / multi-user

- Same singleton problem as C
- Browser → MCP exposes a new attack surface if public
- Each user needs their own MCP process or their own `SceneBridge` session (requires server refactor)

### Production readiness: **low**

Looks cool in a demo. Doesn't compose with Vercel-style deployments. Consider this a **phase 3 add-on** for real-time collab, layered on top of B.

### 5-step v0.1 plan

1. Add `server.sendResourceUpdated('pascal://scene/current')` hooks inside `SceneBridge` mutation methods
2. Implement `resources/subscribe` handler in `packages/mcp/src/server.ts` tracking per-transport subscriptions
3. Add browser MCP client to `apps/editor/lib/mcp-client.ts`; wire auth token header
4. `apps/editor/app/scene/live/page.tsx` — connects, calls `get_scene`, subscribes, re-applies on each notification
5. Add a toggle in `/settings/mcp` for "live mode" — falls back to Option B polling when MCP host is unreachable

---

## Option E — Local-first CRDT via Yjs/Automerge

### Description

`SceneGraph` becomes a Y.Map. MCP writes operations into a Y.Doc; editor loads the same Y.Doc from IndexedDB (same-machine) or a y-websocket server (cross-device). Conflicts resolve automatically.

### Architecture

```
  Claude / agent ──► pascal-mcp (Node) ──► Y.Doc ─┐
                                                  │  y-indexeddb / y-websocket
  Editor tab ─────────────────────────────► Y.Doc ┘
                                                  │
                                             Custom awareness/presence
```

### Pros

- Offline-first, collaborative, real-time — best-in-class UX
- No server needed for same-machine (y-indexeddb); optional y-websocket for cross-device
- Conflict-free merges: two agents + a human editing simultaneously Just Work
- Proven architecture (Figma-ish, but open-source)

### Cons

- `SceneGraph` needs a **full rewrite** to become a CRDT-friendly structure. `nodes: Record<id, AnyNode>` + `rootNodeIds: []` map cleanly to `Y.Map<Y.Map>` and `Y.Array`, but every `AnyNode.parse()` and every Zustand mutation in `packages/core/src/store/actions/*` is currently written against plain objects
- Zundo's temporal middleware doesn't compose with Yjs's own undo manager — you'd pick one, and switching temporal layer affects every editor interaction
- Large scenes: Y.Doc updates are fast but the schema migration + cross-host Zod revalidation is nontrivial
- Doesn't solve auth/identity — you still need Better Auth or similar
- Huge blast radius: this is touching `packages/core` at its heart

### Dependencies

- `yjs`, `y-indexeddb`, optionally `y-websocket`, `y-protocols`
- Major rewrite of `packages/core/src/store` — bridging Zustand ⇄ Yjs
- New MCP adapter `packages/mcp/src/bridge/yjs-bridge.ts` mirroring `SceneBridge` but against Y.Doc
- Potentially replace Zundo with `Y.UndoManager`
- Breaking changes throughout `@pascal-app/core` — every consumer affected

### Effort: **XL** (1–3 months)

### Security / auth / multi-user

- Auth: still need Better Auth / Supabase Auth for identity; y-websocket needs an auth middleware
- Multi-user: best-in-class once implemented
- Server storage: y-websocket + Postgres persistence (e.g., `y-postgresql`) or S3 snapshots

### Production readiness: **high if you commit**; **trap if you don't**

If you want Figma-quality multiplayer, this is the right answer long-term. But it is a complete rearchitecture of the core store. Not a starter move.

### 5-step v0.1 plan

1. Prototype a Yjs binding for `packages/core/src/store/use-scene.ts` behind a feature flag; keep the plain Zustand path default
2. Build a minimal Y.Doc ⇄ `SceneGraph` serializer and prove round-trip parity against existing scenes
3. Write `packages/mcp/src/bridge/yjs-bridge.ts` that wraps Y.Doc in the same interface as `SceneBridge`
4. Run a same-machine POC: MCP writes to Y.Doc → y-indexeddb → editor tab observes via `Y.Map.observe`
5. Defer y-websocket to phase 2 after same-machine parity is proven

---

## Option F (bonus) — Local daemon + shared SQLite

### Description

`pascal-mcp` runs as a background daemon on localhost. Scenes persist into a single SQLite file (`~/.pascal/pascal.db`) via better-sqlite3. The editor SSR or a Next.js API route opens the same SQLite file read-only. Pure local, durable, queryable, zero network.

### Architecture

```
  Claude ──► pascal-mcp (daemon) ──► SQLite (~/.pascal/pascal.db) ◄── Next.js API route
```

### Pros vs A

- Transactional; no torn writes
- Indexable (JSON1 extension in SQLite); fast list/search
- Natural version table (`revisions` table)
- Still zero network, zero external infra

### Cons

- Two readers can deadlock on SQLite unless WAL mode + careful opens; Next.js dev server and MCP both holding the file needs care
- Still same-machine only; doesn't deploy to Vercel

### Effort: **S–M**. Worth listing because it's a **better A** without much more work.

---

## Recommended approach + rationale

**Ship Option A this week as a dev loop, commit to Option B as the product path, and keep Option D on the roadmap for a phase-3 "live mode".** Concretely:

1. **Week 1:** Option A (filesystem). Two days of work, ships the "no injection" promise for your own machine. Kills the `window.__pascalScene` hack. Unblocks every subsequent demo. Treat it as a local cache layer that survives option B — keep the `~/.pascal/scenes/` format stable so offline mode later just reads from it.

2. **Weeks 2–4:** Option B (Supabase). This is the only option that:
   - Scales past your laptop
   - Composes with the existing `env.mjs` (Supabase, Better Auth already declared)
   - Supports multi-user without rearchitecting `@pascal-app/core`
   - Matches the deployment target (Next.js on Vercel)
   
   Supabase's `jsonb` + RLS + auth is a perfect fit for "store a scene, open it at `/scene/<id>`". The MCP side is ~200 lines: `save_scene` / `load_scene` / `list_scenes` tools calling `supabase.from('scenes').upsert({...})`.

3. **Quarter 2:** Option D live mode as a pro feature. Layer real-time on top of B via Supabase Realtime (`supabase.channel('scene:<id>').on('postgres_changes', ...)`), not via MCP resource subscriptions — avoids the browser-as-MCP-client rabbit hole.

4. **Option E (CRDT)** is only right if you commit to Figma-grade multiplayer. It's a 3-month project across `@pascal-app/core` and shouldn't be started until you have product-market signal that multiplayer is the moat.

5. **Option C** is tempting as a "one process runs everything" story but rebuilds Supabase badly. Skip unless the product demands a fully-local air-gapped build.

### Why B over C

C asks `SceneBridge` to become a multi-tenant database. `SceneBridge` is a thin wrapper over a Zustand singleton — making it multi-tenant is a rewrite. Supabase already is one.

### Why B over E (for now)

E makes the *editor* collaborative, but the user's stated problem is "save → open", not "co-edit in real time". B solves the stated problem in 10% of the effort and leaves the door open for E later (you can replace the `graph_json` column with a `y_doc` column in a migration and nothing else in the app has to change, because `applySceneGraphToEditor()` still accepts a `SceneGraph`).

---

## 30/60/90 day roadmap

### Day 0–30 — "Unblock the loop"

- **A (1–2d):** filesystem handoff; MCP `save_scene` + editor `/scene/[slug]`. Delete `window.__pascalScene`.
- **B-alpha (2w):** Supabase migrations for `scenes` + `scene_revisions`, RLS, MCP tools using user tokens, editor `/scene/[id]` server component.
- **Dogfood:** the team uses `save_scene` from Claude Desktop every day. Bugs get filed.

### Day 31–60 — "Productionize"

- **Auth bootstrap:** `/settings/mcp` device-pairing flow. Mints a scoped Supabase user JWT (not service-role) for MCP.
- **Editor → Supabase save:** debounced on-change writes + "Save" button. Append `scene_revisions` rows with `author_kind: 'editor'`.
- **History UI:** simple diff viewer across `scene_revisions`.
- **Sharing:** `public = true` flag → public read. Share URL works.
- **Offline cache (optional):** keep Option A filesystem writes as a redundant cache so scenes survive Supabase outages.

### Day 61–90 — "Live mode + polish"

- **Realtime via Supabase channels (not MCP D):** editor subscribes to `postgres_changes` on the current scene and applies remote updates. Gives near-realtime collab without Yjs effort.
- **Presence:** Supabase Realtime presence for "agent is editing".
- **Figma-style undo across actors:** scoped per-user temporal history (use `clearSceneHistory()` when switching scenes; keep Zundo per tab).
- **Decide on E:** if usage shows genuine concurrent-agent-plus-human friction, spike Yjs in Q2. Otherwise defer.

---

## Risks + mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| MCP needs a user identity to write to Supabase with RLS | High | Device-pairing UI in editor that mints a short-lived JWT → long-lived machine token. Never ship the service-role key. |
| Concurrent MCP + editor writes clobber each other | Medium | Optimistic concurrency: include `updated_at` in UPDATE `WHERE` clause; if mismatch, append a revision instead of overwriting and surface a merge prompt. |
| Large `graph_json` payloads blow past Supabase's 8MB body limit | Medium | Measure casa-sol (test scene in `test-reports/casa-sol/`) and typical scene sizes. If >1MB, chunk or move to Storage buckets. |
| Serverless cold starts on `/scene/[id]` make "open" slow | Low | Use Next.js `revalidate: 0` + ISR; Edge runtime where possible; cache in localStorage on client. |
| `applySceneGraphToEditor` is a client-only function, can't run on SSR | Low | Keep it client; `<SceneLoader>` component does `useEffect(() => applySceneGraphToEditor(initialGraph), [])`. |
| Supabase outage breaks the whole editor | Medium | Layer Option A on top: editor falls back to last-known-good from localStorage when fetch fails. |
| RLS misconfiguration leaks scenes across users | Critical | Policy tests in `supabase/tests/`; add a dedicated "rls" CI step; `anon` client gets read-only and only `public = true` rows. |
| MCP Node process can't reach `~/.pascal` on Windows Claude Desktop install | Low | Use `envPaths('pascal')` (via `env-paths`) to resolve per-OS. |
| Slug collisions / path traversal via `save_scene({ slug: '../foo' })` | High (for A) | Strict slug regex `^[a-z0-9-]{1,64}$`; reject everything else. |
| MCP writes a scene under user A; user B opens the URL → leak | High (for B) | Only share by signed URL or explicit `public = true` flag. Default visibility is `owner-only`. |

---

## Open questions for the user

1. **Are scenes per-user or per-project?** Current `projectId="local-editor"` suggests projects exist — do MCP-created scenes live under a project, or are they free-floating until assigned?

2. **How does a stdio MCP know who the user is?** Is the intended flow "user signs into editor → editor emits a device token → user pastes into Claude Desktop config"? Or "MCP is always anonymous and scenes live in a shared staging bucket"?

3. **Offline requirements?** Must editing work with zero network (implies Option A cache on top of B), or is online-required acceptable for v1?

4. **Deployment target for the editor?** Vercel (rules out C, F) or self-hosted (all options viable)?

5. **Scene mutability after save?** Can the editor edit a scene MCP created and have those edits visible to the next MCP call? (Implies bidirectional sync, easiest via B's REST; harder via A's file racing.)

6. **Auth provider?** `env.mjs` has `BETTER_AUTH_SECRET` + `GOOGLE_CLIENT_ID` — is Better Auth the plan, or Supabase Auth? They can coexist but one is source of truth for `auth.uid()`.

7. **Versioning/history UX?** Is "every MCP call appends a revision" desired, or should only explicit saves create revisions? Affects `scene_revisions` write patterns.

8. **Multi-agent story?** If two Claude Desktops write to the same scene concurrently, which wins? (Punts on this until Yjs/E; in B, last-write-wins with optimistic concurrency is a fine v1.)

9. **How does "open in the editor" trigger?** Does MCP return a URL and the user clicks? Or does MCP invoke a deeplink (`pascal://scene/<id>` handler) that focuses an already-open browser tab?

10. **Catalog availability in MCP.** Today `pascal://catalog/items` returns `catalog_unavailable` in headless mode. If a scene references catalog items, does the editor need to re-hydrate them on open, or does MCP have to snapshot the catalog into the scene graph?
