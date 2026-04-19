# feat(mcp): add `@pascal-app/mcp` — Model Context Protocol server

## TL;DR

This PR adds a new workspace package `@pascal-app/mcp` (v0.1.0) that exposes the Pascal scene graph as MCP **tools**, **resources**, and **prompts** so any MCP-compatible AI host — Claude Desktop, Claude Code, Cursor, or a custom agent — can build and modify Pascal projects programmatically, with no browser required. It also adds scene persistence (filesystem + Supabase adapters) and the editor routes to load MCP-built scenes directly. The only changes outside `packages/mcp/` are two additive exports on `@pascal-app/core`, a URL-scheme allowlist on core schema fields, two new Next.js routes and API handlers in `apps/editor`, and a new CI workflow.

## Motivation

Issue [#74 "Viewer component API definition"](https://github.com/pascalorg/editor/issues/74) opens the question of how external consumers should drive Pascal. The viewer answers "embed in a React app." This PR answers the complementary case: **drive Pascal from anything, without a browser** — AI agents, CLI tools, background services, or IDE plugins. An agent can now build a complete scene (walls, zones, doors, windows) and have it immediately openable in the editor via a URL.

## Architecture

```
┌─────────── MCP host (Claude Desktop / Claude Code / Cursor / custom) ───────────┐
│                                    stdio | HTTP                                   │
│                                         │                                         │
│              packages/mcp/src/bin/pascal-mcp.ts  (CLI entry)                    │
│                                         │                                         │
│         ┌──── createPascalMcpServer({ bridge, store }) ────┐                    │
│         │  30 tools · 4 resources · 3 prompts              │                    │
│         └────────────────────┬───────────────────────────┘                     │
│                              │                                                   │
│                   ┌──────────┴──────────┐                                       │
│                   ▼                     ▼                                        │
│            SceneBridge           SceneStore                                      │
│       (headless Zustand          ┌──────────────────┐                           │
│        store + Zundo)            │ FilesystemStore   │  ← PASCAL_DATA_DIR       │
│       Zod validation at          │ SupabaseStore     │  ← env: SUPABASE_*       │
│       every boundary             └──────────────────┘                           │
│                   │                                                              │
│                   ▼                                                              │
│         @pascal-app/core (subpath exports: ./schema, ./store, ./wall …)         │
│                   │                                                              │
│                   ▼                                                              │
│    apps/editor — /api/scenes CRUD + /scene/[id] page                           │
│                  (ETag / If-Match optimistic locking)                            │
└──────────────────────────────────────────────────────────────────────────────────┘
```

The server runs headlessly in Node — no WebGPU, no React, no Three.js. The `SceneBridge` wraps a Zustand store with the same Zundo temporal middleware the editor uses, so `undo`/`redo` work correctly. Derived geometry (wall mitering, CSG cutouts) is recomputed only when the scene is opened in a browser via `@pascal-app/viewer`.

## What's in the box

### Package `@pascal-app/mcp` v0.1.0

**Tools (30)** — [full table in README](../../README.md#tools)

| Group | Tools |
|---|---|
| Query | `get_scene`, `get_node`, `describe_node`, `find_nodes`, `measure` |
| Mutation | `apply_patch`, `create_level`, `create_wall`, `place_item`, `cut_opening`, `set_zone`, `duplicate_level`, `delete_node` |
| History | `undo`, `redo` |
| Export | `export_json`, `export_glb` (stub — see limitations) |
| Validation | `validate_scene`, `check_collisions` |
| Scene lifecycle | `save_scene`, `load_scene`, `list_scenes`, `rename_scene`, `delete_scene` |
| Templates | `list_templates`, `create_from_template` |
| Vision (sampling) | `analyze_floorplan_image`, `analyze_room_photo`, `photo_to_scene` |
| Variants | `generate_variants` |

**Resources:** `pascal://scene/current`, `pascal://scene/current/summary`, `pascal://catalog/items`, `pascal://constraints/{levelId}`

**Prompts:** `from_brief`, `iterate_on_feedback`, `renovation_from_photos`

**Transports:** stdio (default) + Streamable HTTP (`--http --port N`)

**Storage adapters:** `FilesystemSceneStore` (default, `PASCAL_DATA_DIR`) + `SupabaseSceneStore` (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`)

**SQL migration:** `packages/mcp/sql/migrations/0001_scenes.sql` — `scenes` table + `scene_revisions` table + RLS policies for the Supabase adapter

### Changes outside `packages/mcp/` (transparent disclosure)

All are additive. None modify existing behavior.

#### `packages/core/package.json` — 5 new subpath exports (CROSS_CUTTING §1)

Added `./schema`, `./store`, `./material-library`, `./spatial-grid`, `./wall` entries to the `exports` map. The main `"."` entry is unchanged. Without these, `import('@pascal-app/core')` in Node crashes because the main entry transitively imports Three.js CJS globals that don't resolve outside a browser context. `apps/editor` and `@pascal-app/viewer` are unaffected — they use `"."` and don't reference these subpaths.

#### `packages/core/src/schema/asset-url.ts` — URL scheme allowlist (CROSS_CUTTING §5)

Introduces a shared `AssetUrl` Zod validator replacing bare `z.string()` on every URL field in core's schemas (`scan.url`, `guide.url`, `item.asset.src`, `material.texture.url`, all material map fields). Rejects `javascript:`, `file:`, `ftp:`, `data:text/html`, foreign `http:`, `vbscript:`, and similar. Accepts `asset://`, `blob:`, `data:image/`, `/` (app-relative), `https:`, and `http://localhost` for dev. Optional per-origin narrowing via `PASCAL_ALLOWED_ASSET_ORIGINS`.

This closes the security finding from the Phase 3 audit: a crafted scene with `javascript:alert(1)` for a texture URL would have beaconed or exfiltrated when rendered. Phase 10 A2 further extended the validator to the `save_scene(includeCurrentScene: false)`, `POST /api/scenes`, and `PUT /api/scenes/[id]` boundaries via a shared `apiGraphSchema` (see Security notes).

#### `apps/editor` — persistence routes + scene page (CROSS_CUTTING §4)

- `apps/editor/app/api/scenes/route.ts` — `GET /api/scenes` (list), `POST /api/scenes` (create)
- `apps/editor/app/api/scenes/[id]/route.ts` — `GET`, `PUT`, `PATCH`, `DELETE` with ETag / `If-Match` optimistic locking
- `apps/editor/app/scene/[id]/page.tsx` — server-rendered page that fetches a scene by ID and passes its graph to the editor via `applySceneGraphToEditor`
- `apps/editor/app/scenes/page.tsx` — scene list page
- `apps/editor/lib/scene-store-server.ts` — server-side factory that picks filesystem or Supabase adapter based on env
- `apps/editor/package.json` adds `@pascal-app/mcp` as a workspace dependency (for the `./storage` subpath)
- `packages/mcp/package.json` exports `./storage` subpath so editor can import just the storage adapter without the full MCP surface

#### `.github/workflows/mcp-ci.yml` — new CI workflow (CROSS_CUTTING §3)

Runs on PRs and pushes touching `packages/mcp/`, `packages/core/`, or `bun.lock`. Installs with Bun 1.3.0, builds core then mcp, runs `bun test`, runs `bunx biome check`. Does not modify `release.yml`.

## How to test

```bash
# From repo root
bun install
bun run --cwd packages/core build
bun run --cwd packages/mcp build

# Unit + integration tests (302 tests, 41 files)
bun test --cwd packages/mcp

# Biome lint
bunx biome check packages/mcp

# End-to-end smoke test (spawns stdio server, exercises 4 tools)
bun run --cwd packages/mcp smoke

# Full sweep — 30 tools, 4 resources, 3 prompts, all PASS
# (requires the built binary at packages/mcp/dist/bin/pascal-mcp.js)
bun packages/mcp/test-reports/phase8/p10-full-sweep.ts

# Try with Claude Desktop
# Add to ~/Library/Application Support/Claude/claude_desktop_config.json:
# { "mcpServers": { "pascal": { "command": "bunx", "args": ["pascal-mcp"] } } }
# Then ask: "Use the Pascal MCP to create a 3-bedroom apartment at 100 m²."
```

## Verification evidence

| Evidence | Result |
|---|---|
| `bun test --cwd packages/mcp` | **302/302 pass** across 41 test files |
| Biome check | 0 errors (73 source files checked) |
| TypeScript build | `tsc` clean, strict mode, no `any` without documented reason |
| T1 stdio smoke | 21/21 tools PASS, 106 ms |
| T2 HTTP smoke | transport verified |
| T3 scenario | 2-bed apartment built end-to-end over HTTP |
| T4 error paths | structured error codes verified |
| Phase 8 P10 full sweep | **37/37 PASS** (30 tools + 4 resources + 3 prompts) |
| Phase 8 P3 locking | **12/12 PASS** (version conflict, ETag/If-Match) |
| Phase 8 P8 concurrency | 4/5 PASS — 1 known fail (see limitations) |
| Phase 8 P9 edge cases | **13/13 PASS** (path traversal, size cap, bad input) |
| Phase 8 P4 URL hardening | 59/95 checks PASS at audit time; 36 fails at `save_scene`/POST boundary **all CLOSED** in later commits (see Security notes) |
| Phase 10 A2 security audit | 2 HIGH findings (PUT-route bypass + SSRF in vision tools) — **both fixed** before push |
| SSRF guard tests | 8/8 PASS (`safe-fetch.test.ts`) |
| **Casa del Sol** | 76-node residential scene built end-to-end; `validate_scene` = valid, 0 errors; `duplicate_level` clones 37 nodes correctly |
| **Villa Azul** | 56-node scene; **108/108 checks** across 10 verification agents (schema, geometry, dimensions, openings, HTTP API, Next.js page, parentage, round-trip, spatial, visual) |
| Secrets audit (A1) | SAFE TO PUSH — no tokens, credentials, or PII in diff |

Committed reports: `packages/mcp/test-reports/` (t1-t5, casa-sol, villa-azul, phase8, research, pre-push).

## Known limitations / non-goals for v0.1

1. **GLB export is not implemented.** Three.js is browser-only; `export_glb` returns a structured `{ status: 'not_implemented' }` response.
2. **Vision tools require host sampling support.** `analyze_floorplan_image`, `analyze_room_photo`, and `photo_to_scene` delegate to the host via MCP sampling (`createMessage`). Hosts without sampling capability receive a structured `sampling_unavailable` error. No vision model is bundled.
3. **Headless mode doesn't regenerate derived geometry.** Wall mitering, slab triangulation, and CSG cutouts run inside React hooks in the editor renderer. Headless MCP manipulates node data freely; rendered geometry is recomputed when a browser opens the scene via `@pascal-app/viewer`.
4. **HTTP transport is single-session.** The Streamable HTTP transport uses the SDK's `StreamableHTTPServerTransport`, which only accepts one `initialize` per process lifetime. Spinning up a second MCP client hits a `Server already initialized` error. For multi-client scenarios, run one process per client or use stdio.
5. **Concurrent same-id writes race.** `FilesystemSceneStore.save()` checks `expectedVersion` optimistically without a per-id lock. Five simultaneous `save_scene({ id: "x", expectedVersion: 1 })` calls may all return `ok: true`; only one durable bump lands (Phase 8 P8, scenario 2). The Supabase backend is not affected — Postgres provides the compare-and-swap. Fix tracked as follow-up.
6. **`.index.json` drift under load.** Concurrent distinct saves can leave the index sidecar missing entries that exist on disk. `list_scenes` falls back to a full directory scan when the index is absent, but not when it is merely stale (Phase 8 P8, scenario 5). Fix tracked with same lock-queue follow-up.
7. **No authentication.** The HTTP transport and editor API routes have no auth layer. The filesystem store relies on OS-level file permissions; Supabase RLS enforces ownership, but the `ownerId` field is null until an auth layer is wired (env vars for Supabase Auth / Better Auth are declared; zero code exists yet).
8. **`item.asset.thumbnail` not yet validated.** The `thumbnail` field on `ItemNode` is still bare `z.string()`. The `src` field is fully validated by `AssetUrl`. Follow-up: apply the same validator to `thumbnail` and fix the `place_item` tool's `thumbnail: ''` default.
9. **Catalog unavailable headless.** `pascal://catalog/items` returns `{ status: 'catalog_unavailable', items: [] }` until `@pascal-app/core` exposes a Node-consumable catalog.
10. **`SiteNode.children` inconsistency.** `SiteNode.children` holds full node objects while every other container holds ID strings. MCP works around this by traversing the flat `nodes` dict. Upstream alignment proposed as a follow-up (CROSS_CUTTING §2).

## Security notes

**In this PR:**
- `AssetUrl` Zod validator on all URL fields in core schemas — rejects `javascript:`, `file:`, `ftp:`, `data:text/html`, foreign `http:` (Phase 8 P4: 36/36 schema-layer checks PASS)
- `apply_patch` re-parses each node with `AnyNode` before mutating the store — URL validation fires here
- `save_scene` (both `includeCurrentScene: true` and `false`) re-parses every node at the save boundary
- `POST /api/scenes` AND `PUT /api/scenes/[id]` share `apiGraphSchema` that Zod-validates every node before the store is touched
- `safeFetch` for all user-supplied image URLs in `photo_to_scene`, `analyze_floorplan_image`, `analyze_room_photo`:
  - Blocks loopback, private IP ranges, link-local (incl. cloud-metadata `169.254.169.254`), `.local`/`.internal`/`.corp` hostnames, v4-mapped IPv6 loopback
  - Manual redirects (max 3), allowlist revalidated per hop
  - 20 MB streamed size cap, 10 s timeout
- `PASCAL_ALLOWED_ASSET_ORIGINS` env var for per-origin `https:` narrowing (applies to both `AssetUrl` and `safeFetch`)
- `FilesystemSceneStore` sanitizes slugs to prevent path traversal (Phase 8 P9, case 3: PASS)
- 10 MB size cap per scene enforced at `save_scene` (Phase 8 P9, case 2: PASS)
- ETag / `If-Match` on all editor API mutating verbs (Phase 8 P3: 12/12 PASS)
- CI workflow runs with `permissions: contents: read` only

**Tracked as follow-ups (not blocking merge):**
- `item.asset.thumbnail` still bare `z.string()` — `src` is validated; apply `AssetUrl` to `thumbnail` too
- No auth layer on HTTP transport or editor API routes (env vars declared; implementation pending)

## Follow-ups (GitHub issues after merge)

- Fix `FilesystemSceneStore` same-id write race with per-id in-process lock queue
- Fix `.index.json` drift: use lock-protected index write or rebuild index from disk on stale reads
- Apply `AssetUrl` to `item.asset.thumbnail`; fix `place_item` empty-thumbnail default
- Align `SiteNode.children` to `z.string()` IDs + `setScene` migration (breaking change, separate PR)
- Expose a Node-consumable item catalog from `@pascal-app/core`
- Add auth layer to HTTP transport and editor API (Supabase Auth / Better Auth env already declared)
- Post-build `chmod +x dist/bin/pascal-mcp.js` so fresh installs don't need a manual chmod
- Add adjacency check to `cut_opening` to catch overlapping openings on the same wall
- Consider `@pascal-app/systems` split so `@pascal-app/core` goes data-only (breaking, larger scope)

## Checklist

- [x] 302/302 `bun test --cwd packages/mcp` pass
- [x] `bunx biome check packages/mcp` — 0 errors (73 files)
- [x] `bun run --cwd packages/mcp build` — tsc clean
- [x] `bunx turbo build --filter=@pascal-app/mcp` — 2/2 tasks successful
- [x] End-to-end smoke test passes (`bun run --cwd packages/mcp smoke`)
- [x] Phase 8 full sweep: 37/37 PASS (`packages/mcp/test-reports/phase8/p10-full-sweep.md`)
- [x] Villa Azul: 108/108 verification checks (`packages/mcp/test-reports/villa-azul/SUMMARY.md`)
- [x] Casa del Sol built end-to-end (`packages/mcp/test-reports/casa-sol/BUILD_REPORT.md`)
- [x] Secrets audit clean (`packages/mcp/test-reports/pre-push/a1-secrets.md`)
- [x] No modifications to `@pascal-app/viewer`
- [x] `packages/core` changes are additive only (subpath exports + `AssetUrl` validator)
- [x] Node 18+ compatible; RAF polyfill loads before any core import
- [x] All mutations go through Zustand store (undo-safe via Zundo)
- [x] Cross-cutting changes documented in `packages/mcp/CROSS_CUTTING.md`
- [x] `save_scene` / `POST /api/scenes` / `PUT /api/scenes/[id]` per-node URL validation (Phase 10 A2)
- [x] SSRF protection on all image-URL fetches (Phase 10 A2)
- [ ] Same-id concurrent write race in filesystem store (tracked follow-up)
- [ ] Auth layer on HTTP transport (tracked follow-up)

## Commit series (20 commits on `feat/mcp-server`)

Phase 1 — scaffold and core MCP (9 commits):
- `feat(mcp): scaffold package and confirm headless bridge viability`
- `feat(mcp): finalize scaffolding and factory entry`
- `feat(mcp): add headless scene bridge with RAF polyfill`
- `feat(mcp): implement 19 scene query and mutation tools`
- `feat(mcp): add resources and prompts`
- `feat(mcp): add multimodal vision tools via MCP sampling`
- `feat(mcp): add stdio + streamable HTTP transports, CLI, and smoke test`
- `docs(mcp): add README, examples, and changelog`
- `chore(mcp): add CI workflow and document cross-cutting changes`

Phases 5–10 — scenes, verification, hardening (11 commits):
- `test(mcp): Casa del Sol — full house built end-to-end via MCP`
- `feat(editor): expose useScene on window in dev for MCP-editor bridging` (subsequently removed)
- `fix(mcp): apply_patch preserves schema-defaulted ids in multi-op batches`
- `docs(mcp): add PR_DESCRIPTION.md`
- `docs(mcp): add 10-agent research on scene-save workflow`
- `feat(mcp,editor): Option A+B storage + 10 agent deliverables (Phase 7)`
- `fix(mcp,editor): close URL-validation bypasses surfaced by Phase 8 P4`
- `test(mcp): Villa Azul + 10-agent deep verification`
- `test(mcp): add populate-gallery script for post-ship demo`
- `fix(mcp,editor): close PUT-route URL bypass + vision-tool SSRF (Phase 10 A2)`
- `docs(mcp): add Phase 10 pre-push audit reports (5 agents)`

## Report index

- `packages/mcp/test-reports/t1-stdio/REPORT.md` — stdio: 21/21 tools PASS
- `packages/mcp/test-reports/t2-http/REPORT.md` — HTTP transport
- `packages/mcp/test-reports/t3-scenario/REPORT.md` — 2-bed apartment end-to-end
- `packages/mcp/test-reports/t4-errors/REPORT.md` — structured error codes
- `packages/mcp/test-reports/casa-sol/BUILD_REPORT.md` — Casa del Sol (76 nodes)
- `packages/mcp/test-reports/villa-azul/SUMMARY.md` — Villa Azul (56 nodes, 108 checks)
- `packages/mcp/test-reports/phase8/p3-locking.md` — version conflict / ETag (12/12)
- `packages/mcp/test-reports/phase8/p4-url-hardening.md` — URL validation (59/95, gaps disclosed)
- `packages/mcp/test-reports/phase8/p8-concurrency.md` — concurrency (4/5, bug disclosed)
- `packages/mcp/test-reports/phase8/p9-edges.md` — edge cases (13/13)
- `packages/mcp/test-reports/phase8/p10-full-sweep.md` — full sweep (37/37)
- `packages/mcp/test-reports/pre-push/a1-secrets.md` — secrets audit
- `packages/mcp/CROSS_CUTTING.md` — every change outside `packages/mcp/`
- `packages/mcp/README.md` — host configs, tool/resource/prompt tables, examples
