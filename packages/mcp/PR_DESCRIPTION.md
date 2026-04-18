# feat(mcp): add `@pascal-app/mcp` — Model Context Protocol server

## Summary

Introduces a new workspace package `@pascal-app/mcp` (v0.1.0) that exposes the Pascal scene graph (`@pascal-app/core`) as MCP **tools**, **resources**, and **prompts** so any MCP-compatible AI host — Claude Desktop, Claude Code, Cursor, a custom agent — can read and mutate Pascal projects programmatically with full Zod validation, atomic patches, undo-safe mutations, and multimodal image inputs.

**83 files changed, ~5,900 LOC across 68 source files + 27 test files; 142/142 tests pass.**

## Motivation

Issue [#74 "Viewer component API definition"](https://github.com/pascalorg/editor/issues/74) opens the question of how external consumers should drive Pascal. The viewer answers "embed in a React app." This PR answers the complementary case: **drive Pascal from anything, without a browser** — AI agents, CLI scripts, background services, or IDE plugins.

## What's in the box

### Tool inventory

| Tool | Purpose |
|------|---------|
| `get_scene` | Return full scene JSON |
| `get_node` | Fetch one node by ID |
| `describe_node` | Human summary: ancestry, children, properties |
| `find_nodes` | Filter by type / parentId / levelId / zoneId |
| `measure` | Distance between two nodes; area if zone |
| `apply_patch` | Atomic multi-op (create / update / delete). All-or-nothing |
| `create_level` | Create a level under a building |
| `create_wall` | Create a wall on a level with 2D endpoints |
| `place_item` | Place an item on a wall / ceiling / site |
| `cut_opening` | Cut a door or window into a wall at t ∈ [0,1] |
| `set_zone` | Create a zone polygon on a level |
| `duplicate_level` | Deep-clone a level subtree with new IDs |
| `delete_node` | Delete a node (with optional cascade) |
| `undo` / `redo` | Drive Zundo temporal store |
| `export_json` | Serialize scene to JSON (pretty or compact) |
| `export_glb` | Stub (`not_implemented` — renderer required) |
| `validate_scene` | Zod-validate every node |
| `check_collisions` | Item placement conflicts per level |
| `analyze_floorplan_image` | (Vision/sampling) Extract structured floor plan |
| `analyze_room_photo` | (Vision/sampling) Extract room dimensions + fixtures |

### Resources

| URI | MIME | Purpose |
|-----|------|---------|
| `pascal://scene/current` | `application/json` | Full scene |
| `pascal://scene/current/summary` | `text/markdown` | Counts, areas, bbox |
| `pascal://catalog/items` | `application/json` | Item catalog (unavailable headless) |
| `pascal://constraints/{levelId}` | `application/json` | Slabs + wall footprints |

### Prompts

| Prompt | Args |
|--------|------|
| `from_brief` | `brief`, `constraints?` |
| `iterate_on_feedback` | `feedback` |
| `renovation_from_photos` | `currentPhotos`, `referencePhotos`, `goals` |

## Architecture

```
┌─── MCP host (Claude Desktop / Code / Cursor / custom) ───┐
│                          ▲                                │
│         stdio │ HTTP                                      │
│                          ▼                                │
│   ┌──────── packages/mcp/src/bin/pascal-mcp.ts ────────┐  │
│   │ (loads node-shims FIRST, then creates bridge)      │  │
│   └────────────────────────────────────────────────────┘  │
│                          │                                │
│                          ▼                                │
│   ┌──── createPascalMcpServer({ bridge }) ────┐            │
│   │  registerTools()  → 19 tools              │            │
│   │  registerVisionTools() → 2 tools          │            │
│   │  registerResources() → 4 resources        │            │
│   │  registerPrompts() → 3 prompts            │            │
│   └────────────────────────────────────────────┘           │
│                          │                                 │
│                          ▼                                 │
│   ┌──────────── SceneBridge ────────────────┐             │
│   │  headless Zustand store + Zundo         │             │
│   │  RAF polyfill at import time            │             │
│   │  zod validation at every boundary       │             │
│   └──────────────────────────────────────────┘             │
│                          │                                 │
│                          ▼                                 │
│            @pascal-app/core (unchanged, new subpath exports) │
└──────────────────────────────────────────────────────────┘
```

## How to test locally

```bash
# From the repo root
bun install
bun run --cwd packages/core build
bun run --cwd packages/mcp build

# Unit + integration tests (142 tests across 27 files)
bun test --cwd packages/mcp

# End-to-end smoke test (spawns stdio server and exercises 4 tools)
bun run --cwd packages/mcp smoke

# Biome lint
bunx biome check packages/mcp

# Turbo build
bunx turbo build --filter=@pascal-app/mcp
```

### Try it with Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "pascal": {
      "command": "node",
      "args": ["/absolute/path/to/editor/packages/mcp/dist/bin/pascal-mcp.js"]
    }
  }
}
```

Restart Claude Desktop. Ask it: *"Use the Pascal MCP to create a 3-bedroom apartment at 100m²."*

## Known limitations

1. **GLB export is not implemented.** Three.js is browser-only; headless GLB export would require a significant additional effort. `export_glb` returns a structured `{ status: 'not_implemented' }` response.
2. **Vision tools require host sampling support.** `analyze_floorplan_image` / `analyze_room_photo` defer the vision work to the host via MCP sampling. Hosts without sampling capability get a structured `sampling_unavailable` error. No vision model is bundled.
3. **Headless mode doesn't regenerate geometry.** Wall mitering, slab triangulation, CSG cutouts, etc. run only in the browser renderer. MCP clients can manipulate node data freely, but derived geometry (mitered wall corners, cut-out walls with door/window holes) is recomputed only when a browser loads the scene via `@pascal-app/viewer`.
4. **`loadAssetUrl`/`saveAsset` are browser-only.** Items with `asset://<id>` URLs can't be resolved in Node. Supply absolute URLs or `data:` URIs if you need them usable outside the browser.
5. **`SiteNode.children` inconsistency.** Site's children hold full node objects while every other container holds ID strings (see `CROSS_CUTTING.md` §2). MCP works around this by traversing via the flat `nodes` dict. Upstream alignment proposed as a follow-up.
6. **Catalog unavailable in headless mode.** `pascal://catalog/items` and `place_item`'s catalog resolution fall back to a placeholder asset payload until the core exposes a Node-consumable catalog.

## Cross-cutting changes

Documented in [`packages/mcp/CROSS_CUTTING.md`](./CROSS_CUTTING.md):

1. **`packages/core/package.json` — additive subpath exports.** Adds `./schema`, `./store`, `./material-library`, `./spatial-grid`, `./wall`. Needed because the main entry re-exports browser-only systems; subpath entries let Node consumers skip them. Zero impact on existing consumers (`apps/editor`, `@pascal-app/viewer` still use the main entry).
2. **`.github/workflows/mcp-ci.yml` — new CI.** Runs on PRs touching mcp/core; installs with Bun 1.3.0, builds, tests, biome-checks.
3. (Observation, not fixed) **`SiteNode.children` inconsistency.** Detailed in CROSS_CUTTING §2.

## Checklist

- ✅ `bunx biome check packages/mcp` — clean (73 files, 0 errors)
- ✅ `bun run --cwd packages/mcp build` — tsc OK
- ✅ `bunx turbo build --filter=@pascal-app/mcp` — 2/2 tasks successful
- ✅ `bun test --cwd packages/mcp` — 142/142 tests pass across 27 files (328 expects)
- ✅ `bun run --cwd packages/mcp smoke` — spawns stdio server, registers 21 tools, exercises `get_scene` / `create_level` / `validate_scene` / `undo` end-to-end
- ✅ Docs: README with host configs + tool/resource/prompt tables, CHANGELOG, 3 examples
- ✅ Conventional commit series (9 commits on `feat/mcp-server`)
- ✅ No modifications to `@pascal-app/viewer` or `apps/editor`
- ✅ `packages/core` changes are purely additive (subpath exports only)
- ✅ Node 18+ compatible; RAF polyfill loads before any core import
- ✅ Strict TypeScript (no `any` without reason; no `@ts-expect-error`); Zod at every boundary
- ✅ Every mutation goes through the Zustand store (undo-safe via Zundo)

## Commit series

```
feat(mcp): scaffold package and confirm headless bridge viability
feat(mcp): finalize scaffolding and factory entry
feat(mcp): add headless scene bridge with RAF polyfill
feat(mcp): implement 19 scene query and mutation tools
feat(mcp): add resources and prompts
feat(mcp): add multimodal vision tools via MCP sampling
feat(mcp): add stdio + streamable HTTP transports, CLI, and smoke test
docs(mcp): add README, examples, and changelog
chore(mcp): add CI workflow and document cross-cutting changes
```

## Follow-up (future PRs)

- Align `SiteNode.children` to IDs-only (with `setScene` migration) — CROSS_CUTTING §2.
- Expose a Node-consumable item catalog from `@pascal-app/core` so `place_item` can resolve real catalog IDs.
- Surface real spatial-grid collision detection (currently a simple AABB pass in `check_collisions`).
- Post-build `chmod +x dist/bin/pascal-mcp.js` step so fresh installs get an executable bin without a manual chmod.
- Consider a separate `@pascal-app/systems` package so `@pascal-app/core` can go data-only (breaking change, larger refactor).
