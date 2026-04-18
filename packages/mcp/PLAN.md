# @pascal-app/mcp — Implementation Plan

> This document is the contract for the 8-agent parallel build. All subagents MUST read it before writing code. Deviations require an entry in `CROSS_CUTTING.md`.

## 0. Ground truth discovered in Phase 0

- **Monorepo layout.** Turborepo + Bun. Root `package.json` already lists `packages/*` in `workspaces`. Our new package sits at `packages/mcp/`.
- **Build tooling.** TypeScript 5.9.3, `tsc --build` per package, outputs to `dist/`. Biome 2.4.x for lint/format (root `biome.jsonc`).
- **AGENTS.md does not exist.** `CLAUDE.md` is a symlink pointing to a non-existent `AGENTS.md`. The conventions referenced in the task prompt are therefore derived from `README.md`, `CONTRIBUTING.md`, and the actual code.
- **`@pascal-app/core` v0.5.1** — already built and consumed by `@pascal-app/viewer` with `workspace:*` via `peerDependencies`. It exports the full Zod schema surface, the `useScene` Zustand store with `temporal` (Zundo) wrapper, systems, hooks, lib utilities, events, and `clone-scene-graph`.
- **MCP SDK** — `@modelcontextprotocol/sdk@1.29.0` (latest stable). Subpath exports include `./server/mcp.js`, `./server/stdio.js`, `./server/streamableHttp.js`, `./client/*`, `./types.js`.

## 0.5 Bridge spike result (CONFIRMED)

Ran `scripts/spike.ts` end-to-end. ✅ All checks pass:
- `useScene.loadScene()` creates default Site → Building → Level (3 nodes)
- `createNode(wall, levelId)` adds wall to `nodes` dict and to `level.children`
- `updateNode(wallId, { thickness, height })` merges update, then RAF polyfill fires `markDirty`
- `temporal.undo()` reverts update, and a second `undo()` removes the wall
- `temporal.redo(2)` restores both steps
- `deleteNode(wallId)` removes wall and cleans parent's children array
- `unloadScene()` → `setScene(snapshot...)` round-trip preserves node count

Node compatibility requires:
1. **RAF polyfill** loaded before any core import (see §1 below).
2. **Subpath imports**, not the main entry. See §0.6 below.

## 0.6 Import contract (CRITICAL — every subagent must use these)

Do **NOT** `import X from '@pascal-app/core'`. The main entry re-exports Three.js systems and fails at load-time in Node.

Use these subpaths (added to core's `exports` map — see `CROSS_CUTTING.md`):

```ts
// Zod schemas (safe in Node)
import {
  AnyNode,
  BuildingNode, CeilingNode, DoorNode, FenceNode, GuideNode, ItemNode,
  LevelNode, RoofNode, RoofSegmentNode, ScanNode, SiteNode, SlabNode,
  StairNode, StairSegmentNode, WallNode, WindowNode, ZoneNode,
  type AnyNodeId, type AnyNodeType,
} from '@pascal-app/core/schema'

// Zustand store (default export)
import useScene from '@pascal-app/core/store'
// NOTE: useScene is the DEFAULT export from this subpath

// Clone helpers
import {
  cloneLevelSubtree, cloneSceneGraph, forkSceneGraph,
  type SceneGraph,
} from '@pascal-app/core/clone-scene-graph'

// Material catalog (safe in Node — no three imports)
import {
  MATERIAL_CATALOG, getCatalogMaterialById, getMaterialsForTarget,
} from '@pascal-app/core/material-library'

// Spatial utilities (pure functions — safe in Node)
import { pointInPolygon, spatialGridManager } from '@pascal-app/core/spatial-grid'

// Wall helpers (pure functions)
import {
  DEFAULT_WALL_HEIGHT, DEFAULT_WALL_THICKNESS,
  getWallPlanFootprint, getWallThickness,
} from '@pascal-app/core/wall'
```

`useScene` is the default export of `@pascal-app/core/store`. Use `useScene.getState()` / `useScene.temporal.getState()` as usual.

## 0.7 SiteNode.children quirk

`SiteNode.children` is declared as `z.array(z.discriminatedUnion('type', [BuildingNode, ItemNode]))` — it holds **objects**, not IDs. Every other container node (`building`, `level`, `wall`, `ceiling`, `roof`, `stair`) stores `string[]` of child IDs.

Implications for tools:
- Parent-child traversal through `site` cannot use the generic "children is ID[]" pattern.
- Always resolve children through the flat `nodes` dict via `parentId` scan when you need to enumerate descendants of a site.
- `describe_node` / `find_nodes` / `duplicate_level` must special-case site.

(This is upstream-worthy simplification; filed in `CROSS_CUTTING.md` section 2 as a suggested refactor but not taken in this PR.)

## 1. Node-compatibility: the critical adapter

The core store was written for the browser. Node support requires **one polyfill** at MCP package boot (before `import useScene`):

```ts
// packages/mcp/src/bridge/node-shims.ts
if (typeof (globalThis as any).requestAnimationFrame === 'undefined') {
  ;(globalThis as any).requestAnimationFrame = (cb: (t: number) => void): number => {
    return setTimeout(() => cb(performance.now()), 0) as unknown as number
  }
  ;(globalThis as any).cancelAnimationFrame = (id: number) => {
    clearTimeout(id as unknown as NodeJS.Timeout)
  }
}
```

**Why:** `packages/core/src/store/actions/node-actions.ts:330` calls `requestAnimationFrame` inside `updateNodesAction`. `packages/core/src/store/use-scene.ts:462` calls `requestAnimationFrame` inside the temporal subscribe callback that marks affected nodes dirty after undo/redo. Both are load-reachable — the subscribe callback registers at module import time.

`crypto.randomUUID` is available globally in Node 18+, no shim needed. `URL.createObjectURL` is only called in `loadAssetUrl` which we do NOT call in MCP (no browser assets). `idb-keyval` is imported at the top of `asset-storage.ts` but only executes functions when `saveAsset`/`loadAssetUrl` are called; we never import that module in MCP code.

**Persist middleware:** core does NOT apply `zustand/middleware/persist`. Persistence happens in `apps/editor`, not in core. So the store is already Node-clean apart from RAF.

## 2. Node types (17 total)

Every one of these has a Zod schema in `packages/core/src/schema/nodes/` and participates in `AnyNode` (discriminated union on `type`):

| Type literal    | Schema export    | Parent expected  | Container? | Notes |
|-----------------|------------------|------------------|------------|-------|
| `site`          | `SiteNode`       | — (root)         | children via typed array | polygon (2D) |
| `building`      | `BuildingNode`   | `site`           | children: level IDs      | position/rotation |
| `level`         | `LevelNode`      | `building`       | children: mixed IDs      | level (int) |
| `wall`          | `WallNode`       | `level`          | children: item/door/window IDs | 2D `start`/`end` |
| `fence`         | `FenceNode`      | `level`          | — | 2D `start`/`end` |
| `zone`          | `ZoneNode`       | `level`          | — | polygon (2D) |
| `slab`          | `SlabNode`       | `level`          | — | polygon + holes |
| `ceiling`       | `CeilingNode`    | `level`          | children: item IDs | polygon + holes |
| `roof`          | `RoofNode`       | `level`          | children: roof-segment IDs | position/rotation |
| `roof-segment`  | `RoofSegmentNode`| `roof`           | — | `roofType` enum |
| `stair`         | `StairNode`      | `level`          | children: stair-segment IDs | from/toLevelId |
| `stair-segment` | `StairSegmentNode`| `stair`         | — | flight/landing |
| `item`          | `ItemNode`       | `wall` / `ceiling` / `site` | children: item IDs | `asset` payload |
| `door`          | `DoorNode`       | `wall`           | — | segments/panels |
| `window`        | `WindowNode`     | `wall`           | — | columns/rows |
| `scan`          | `ScanNode`       | `level`          | — | external GLB url |
| `guide`         | `GuideNode`      | `level`          | — | 2D guide image url |

The full union is `AnyNode` at `packages/core/src/schema/types.ts:20`. `AnyNodeType` and `AnyNodeId` are also exported there. **Subagents MUST reuse these — never redefine.**

## 3. Store API — the only mutation surface

From `packages/core/src/store/use-scene.ts:160-201`. All calls via `useScene.getState()`:

```ts
useScene.getState().createNode(node: AnyNode, parentId?: AnyNodeId): void
useScene.getState().createNodes(ops: { node: AnyNode; parentId?: AnyNodeId }[]): void
useScene.getState().updateNode(id: AnyNodeId, data: Partial<AnyNode>): void
useScene.getState().updateNodes(updates: { id: AnyNodeId; data: Partial<AnyNode> }[]): void
useScene.getState().deleteNode(id: AnyNodeId): void
useScene.getState().deleteNodes(ids: AnyNodeId[]): void
useScene.getState().setScene(nodes: Record<AnyNodeId, AnyNode>, rootNodeIds: AnyNodeId[]): void
useScene.getState().loadScene(): void       // initializes empty default Site → Building → Level
useScene.getState().clearScene(): void      // unloadScene + loadScene
useScene.getState().unloadScene(): void     // truly empties state
useScene.getState().markDirty(id: AnyNodeId): void
useScene.getState().clearDirty(id: AnyNodeId): void
useScene.getState().setReadOnly(readOnly: boolean): void
```

Undo/redo (Zundo temporal wrapper):

```ts
useScene.temporal.getState().undo(steps?: number): void
useScene.temporal.getState().redo(steps?: number): void
useScene.temporal.getState().clear(): void
useScene.temporal.getState().pastStates         // readonly
useScene.temporal.getState().futureStates       // readonly
```

Plus `import { clearSceneHistory } from '@pascal-app/core'`.

**Dirty bookkeeping in headless mode.** Because no renderer is consuming `dirtyNodes`, the set accumulates. For MCP correctness we don't care — dirty tracking is a renderer concern. We will expose a `flushDirty()` helper in the bridge that simply empties the set after a mutation batch for observability.

## 4. MCP package layout

```
packages/mcp/
├── PLAN.md                       (this file)
├── PR_DESCRIPTION.md             (Phase 3 deliverable)
├── CROSS_CUTTING.md              (any proposed upstream changes)
├── README.md
├── CHANGELOG.md
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                  # programmatic API re-exports
│   ├── server.ts                 # createPascalMcpServer() factory
│   ├── bridge/
│   │   ├── node-shims.ts         # RAF polyfill (load FIRST)
│   │   ├── scene-bridge.ts       # SceneBridge class
│   │   └── scene-bridge.test.ts
│   ├── tools/
│   │   ├── index.ts              # registerTools(server, bridge)
│   │   ├── schemas.ts            # shared patch schemas
│   │   ├── errors.ts             # structured MCP error helpers
│   │   ├── get-scene.ts
│   │   ├── get-node.ts
│   │   ├── describe-node.ts
│   │   ├── find-nodes.ts
│   │   ├── measure.ts
│   │   ├── apply-patch.ts
│   │   ├── create-level.ts
│   │   ├── create-wall.ts
│   │   ├── place-item.ts
│   │   ├── cut-opening.ts
│   │   ├── set-zone.ts
│   │   ├── duplicate-level.ts
│   │   ├── delete-node.ts
│   │   ├── undo.ts
│   │   ├── redo.ts
│   │   ├── export-json.ts
│   │   ├── export-glb.ts         # stub: not_implemented
│   │   ├── validate-scene.ts
│   │   ├── check-collisions.ts
│   │   ├── analyze-floorplan-image.ts
│   │   ├── analyze-room-photo.ts
│   │   └── *.test.ts             (one per tool)
│   ├── resources/
│   │   ├── index.ts
│   │   ├── scene-current.ts
│   │   ├── scene-summary.ts
│   │   ├── catalog-items.ts
│   │   ├── constraints.ts
│   │   └── resources.test.ts
│   ├── prompts/
│   │   ├── index.ts
│   │   ├── from-brief.ts
│   │   ├── iterate-on-feedback.ts
│   │   ├── renovation-from-photos.ts
│   │   └── prompts.test.ts
│   ├── transports/
│   │   ├── stdio.ts
│   │   └── http.ts
│   └── bin/
│       └── pascal-mcp.ts         # CLI entry; shebang #!/usr/bin/env node
├── scripts/
│   └── smoke.ts                  # end-to-end client test
├── examples/
│   ├── generate-apartment.md
│   ├── renovate-from-photos.md
│   └── embed-in-agent.ts
└── dist/                          # generated
```

## 5. Tool inventory (exact contracts)

All tools declared with Zod input AND output schemas. Handlers return `{ content: [{ type: 'text', text: JSON.stringify(validatedOutput) }], structuredContent?: output, isError?: boolean }` per MCP SDK 1.x spec. Error handlers throw `McpError` with `ErrorCode.InvalidParams` / `InvalidRequest` / `InternalError`.

### Read-only

1. **`get_scene`** — `() => { nodes, rootNodeIds, collections }`
2. **`get_node`** — `{ id }` → the node or throws `InvalidParams` "node not found"
3. **`describe_node`** — `{ id }` → `{ id, type, parentId, ancestry[], childrenCount, properties, description }`
4. **`find_nodes`** — `{ type?, parentId?, zoneId?, levelId? }` → `{ nodes: AnyNode[] }`. `zoneId` filter returns nodes whose position falls inside the zone polygon; `levelId` filter resolves via ancestry using `resolveLevelId`.
5. **`measure`** — `{ fromId, toId }` → `{ distanceMeters, areaSqMeters?, units: 'meters' }`

### Mutations (undo-safe)

6. **`apply_patch`** — `{ patches: Patch[] }` where `Patch = Create | Update | Delete | Move`. Validates all with Zod, dry-runs first, then batch-applies via `createNodes` / `updateNodes` / `deleteNodes`. Zundo captures this as a single temporal step because of Zustand set batching inside each `*Nodes` call.
7. **`create_level`** — `{ buildingId, elevation, height, label? }` → `{ levelId }`. Uses `LevelNode.parse({...})` then `createNode`.
8. **`create_wall`** — `{ levelId, start, end, thickness?, height? }` → `{ wallId }`. Uses `WallNode.parse({...})` with defaults from `DEFAULT_WALL_HEIGHT` / `DEFAULT_WALL_THICKNESS` if omitted.
9. **`place_item`** — `{ catalogItemId, targetNodeId, position, rotation? }` → `{ itemId }` or `{ error: 'invalid_placement', reason }`. Pre-validation:
   - If target is a slab/ceiling: call pure `spatialGridManager.canPlaceOnFloor(...)` equivalent (we inline the pure logic from `hooks/spatial-grid/spatial-grid-manager.ts` rather than using React-bound spatial-grid-sync).
   - If target is a wall: compute `wallT` from position along wall centerline; validate via `canPlaceOnWall`.
   - Resolve `catalogItemId` → asset payload. Catalog may be unavailable in headless mode — return structured `{ status: 'catalog_unavailable' }` error if so.
10. **`cut_opening`** — `{ wallId, type: 'door' | 'window', position: 0..1, width, height }` → `{ openingId }`. Creates a `DoorNode` or `WindowNode` with `wallId` set; position maps to wallT.
11. **`set_zone`** — `{ levelId, polygon, label, properties? }` → `{ zoneId }`. Creates `ZoneNode` via `ZoneNode.parse`.
12. **`duplicate_level`** — `{ levelId }` → `{ newLevelId, newNodeIds[] }`. Uses `cloneLevelSubtree(levelId, { nodes, rootNodeIds })` from `@pascal-app/core/clone-scene-graph`, then bulk-inserts the cloned nodes via `createNodes`.
13. **`delete_node`** — `{ id, cascade?: boolean }` → `{ deletedIds: [] }`. If `cascade` is false and node has children, throw `InvalidRequest` "node has children; pass cascade: true to delete recursively". If `cascade` is true, just call `deleteNode(id)` (core's deleteNodesAction already cascades via descendant collection).

### Undo/redo

14. **`undo`** — `{ steps? }` → `{ undone: number }`
15. **`redo`** — `{ steps? }` → `{ redone: number }`

### Export

16. **`export_json`** — `{ pretty?: boolean }` → `{ json: string }`
17. **`export_glb`** — `{}` → throws `InternalError` with `{ status: 'not_implemented', reason: 'GLB export requires the Three.js renderer, which is browser-only' }`

### Validation

18. **`validate_scene`** — `{}` → `{ valid: boolean, errors: { nodeId, path, message }[] }`. Runs `AnyNode.safeParse(node)` on every node; additionally verifies parent-child integrity.
19. **`check_collisions`** — `{ levelId? }` → `{ collisions: { aId, bId, kind }[] }`. Uses pure spatial-grid helpers.

### Vision (MCP sampling)

20. **`analyze_floorplan_image`** — `{ image: string (base64 or https URL), scaleHint?: string }` → `{ walls, rooms, approximateDimensions, confidence }`. Constructs a `CreateMessageRequest` via `server.server.createMessage({ ... })` (MCP sampling). Response JSON validated against the output schema. On absent sampling capability, throws `InvalidRequest` `{ status: 'sampling_unavailable' }`.
21. **`analyze_room_photo`** — `{ image }` → `{ approximateDimensions, identifiedFixtures, identifiedWindows }`. Same pattern.

## 6. Resources (4)

- `pascal://scene/current` — `application/json`, full `{ nodes, rootNodeIds, collections }`
- `pascal://scene/current/summary` — `text/markdown`, human summary with counts + bbox + areas
- `pascal://catalog/items` — `application/json`, item catalog if available; else `{ status: 'catalog_unavailable', items: [] }`
- `pascal://constraints/{levelId}` — `application/json`, slab footprints + wall polygons for that level

Register via `server.registerResource(...)` with `readResource` handlers.

## 7. Prompts (3)

- `from_brief` — args `{ brief: string, constraints?: string }`. Returns messages that instruct the agent to call `apply_patch` incrementally starting from an empty site.
- `iterate_on_feedback` — args `{ feedback: string }`. Minimal-diff instructions.
- `renovation_from_photos` — args `{ currentPhotos: string[], referencePhotos: string[], goals: string }`. Tells the agent to call the vision tools first, then propose patches.

## 8. Transports

- **stdio** (default) — `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`.
- **HTTP** — `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk/server/streamableHttp.js`, bound to a `node:http` server on `--port`.

CLI `pascal-mcp` flags:
- `--stdio` (default) — stdio transport
- `--http --port <n>` — HTTP transport
- `--scene <path>` — load initial scene from JSON file via `setScene`
- `--help`, `--version`

## 9. package.json contract

```jsonc
{
  "name": "@pascal-app/mcp",
  "version": "0.1.0",
  "description": "Model Context Protocol server for Pascal 3D editor",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    }
  },
  "bin": { "pascal-mcp": "./dist/bin/pascal-mcp.js" },
  "files": ["dist", "README.md", "CHANGELOG.md"],
  "scripts": {
    "build": "tsc --build",
    "dev": "tsc --build --watch",
    "start": "node dist/bin/pascal-mcp.js",
    "test": "bun test",
    "smoke": "bun run scripts/smoke.ts",
    "prepublishOnly": "bun run build && bun test"
  },
  "peerDependencies": {
    "@pascal-app/core": "workspace:*"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "zod": "^4.3.5"
  },
  "devDependencies": {
    "@pascal/typescript-config": "*",
    "@types/node": "^25.5.0",
    "typescript": "5.9.3"
  }
}
```

Note: `@pascal-app/core` is a **peer dependency**, but Bun workspaces auto-resolve it via `workspaces` in the root. In practice we'll also list it under `devDependencies` with `workspace:*` so `bun install` hoists it.

## 10. tsconfig.json contract

Extends `@pascal/typescript-config/base.json` (NOT react-library — no DOM).

```jsonc
{
  "extends": "@pascal/typescript-config/base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "noEmit": false,
    "composite": true,
    "incremental": true,
    "types": ["node"]
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "**/*.test.ts", "scripts"],
  "references": [{ "path": "../core" }]
}
```

Separate tsconfig excludes do not apply to tests (bun runs them directly from TS).

## 11. turbo.json — no changes required

The existing `turbo.json` globs `packages/*` implicitly via Bun workspaces and pipeline tasks are generic (`build`, `lint`, `check-types`, `dev`). MCP picks up for free.

## 12. File-ownership map for 8 parallel subagents

**Rule: an agent may ONLY write files listed in their column. If they need a file outside their column, they must emit a `CROSS_CUTTING.md` entry instead.**

| Path                                      | Agent |
|-------------------------------------------|-------|
| `packages/mcp/package.json`               | A     |
| `packages/mcp/tsconfig.json`              | A     |
| `packages/mcp/README.md`                  | G     |
| `packages/mcp/CHANGELOG.md`               | G     |
| `packages/mcp/src/index.ts`               | A     |
| `packages/mcp/src/server.ts`              | C (registers tools; D extends with resources/prompts)* |
| `packages/mcp/src/bridge/**`              | B     |
| `packages/mcp/src/tools/**` (except vision) | C   |
| `packages/mcp/src/tools/analyze-*.ts`     | E     |
| `packages/mcp/src/resources/**`           | D     |
| `packages/mcp/src/prompts/**`             | D     |
| `packages/mcp/src/transports/**`          | F     |
| `packages/mcp/src/bin/**`                 | F     |
| `packages/mcp/scripts/smoke.ts`           | F     |
| `packages/mcp/examples/**`                | G     |
| Root `turbo.json` / CI workflows          | H (only if strictly needed) |
| `packages/mcp/biome.jsonc` (if any)       | H     |

*Server.ts coordination: **Agent A writes a minimal `server.ts` stub exporting `createPascalMcpServer(bridge)` that returns an empty `McpServer`**. Agents C, D, E each export `register<Tools|Resources|Prompts|VisionTools>(server, bridge)` functions from their subtrees. Integration (me) wires them up in the final `server.ts` during Phase 2.

## 13. Known limitations (Phase 3 will surface these)

- `export_glb` returns `not_implemented`. GLB export depends on Three.js renderer output — not reachable headlessly without a large additional effort.
- Vision tools require MCP host sampling support. Claude Desktop supports this; some MCP clients don't.
- Systems run only via React hooks; headless mode doesn't regenerate geometry. Wall mitering, slab triangulation, CSG cutouts, etc. remain unexecuted in the MCP process — but their inputs (node data) are still fully manipulable. Consumers that need derived geometry call `@pascal-app/viewer` in a browser host.
- Core's `loadAssetUrl`/`saveAsset` are browser-only; items that reference `asset://<id>` URLs aren't resolvable in Node. MCP consumers should supply absolute URLs or `data:` URLs for item assets if they need them usable outside the browser.
- `dirtyNodes` accumulates in headless mode. Consumers who care can call `bridge.flushDirty()`.

## 14. Zod strategy

- Import `z` from `zod`, matching core's `"zod": "^4.3.5"`.
- Input schemas: declared per-tool. Prefer positional tuples for `[x, z]`/`[x, y, z]` to match core.
- Output schemas: declared per-tool; used to validate the handler's return before sending to MCP.
- `AnyNode` / `SiteNode` / `WallNode` etc. imported from `@pascal-app/core`. Do not redeclare.
- For `apply_patch` inputs we use **partial schemas** (`AnyNode.partial()` isn't directly supported for discriminated unions; we declare a per-type update schema that accepts a subset of fields keyed by the type literal).

## 15. Test strategy

- `bun test` with colocated `*.test.ts` files.
- `@modelcontextprotocol/sdk` ships a test-friendly in-memory pair: `import { Client } from '@modelcontextprotocol/sdk/client/index.js'` + `InMemoryTransport`. Use these for handler-level tests.
- Smoke test (Agent F): spawn the stdio binary as a child process, connect from a real MCP client, assert `get_scene`, `create_level`, `create_wall`, `validate_scene`, `undo` round-trip.
- Target: ≥80% line coverage on MCP-owned files. Bridge at ≥95%.

## 16. Conventional commits (one per agent scope)

- `feat(mcp): scaffold @pascal-app/mcp package`       — Agent A
- `feat(mcp): add headless scene bridge`              — Agent B
- `feat(mcp): implement scene query and mutation tools` — Agent C
- `feat(mcp): add resources and prompts`              — Agent D
- `feat(mcp): add multimodal vision tools via sampling` — Agent E
- `feat(mcp): add stdio + HTTP transports and CLI`    — Agent F
- `docs(mcp): add README, examples, and changelog`    — Agent G
- `chore(mcp): wire biome, tests, and CI`             — Agent H

Integration commits land under `feat(mcp): wire server + integration` and `feat(mcp): v0.1.0 ready`.
