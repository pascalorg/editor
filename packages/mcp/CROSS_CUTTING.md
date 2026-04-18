# Cross-cutting changes touching packages outside `@pascal-app/mcp`

Integrator review required. Each entry documents:
- **What** was changed
- **Why** (what blocked MCP without it)
- **Impact** on existing consumers
- **Reversibility**

---

## 1. `packages/core/package.json` — added subpath exports

### What

Added these subpath entries to the `"exports"` map of `@pascal-app/core`:

- `./schema` → `./dist/schema/index.js`
- `./store` → `./dist/store/use-scene.js`
- `./material-library` → `./dist/material-library.js`
- `./spatial-grid` → `./dist/hooks/spatial-grid/spatial-grid-manager.js`
- `./wall` → `./dist/systems/wall/wall-footprint.js`

The existing `"."` and `"./clone-scene-graph"` entries are unchanged.

### Why

The main entry (`.`) re-exports every `System*` (`WallSystem`, `SlabSystem`, `CeilingSystem`, `RoofSystem`, `ItemSystem`, `StairSystem`, `DoorSystem`, `WindowSystem`, `FenceSystem`) which side-effect-imports `three`, `three-mesh-bvh`, and `three-bvh-csg`. In Node (no browser), `three-mesh-bvh`'s CJS UMD build fails to resolve its `three.*` globals at module-load time, so merely `import { WallNode } from '@pascal-app/core'` crashes before any user code runs.

By adding subpath exports that point at modules which don't transitively pull graphics code, the MCP server package (and any future Node consumer) can import just the Zod schemas and the Zustand store without dragging in `three` and its GPU-bound dependencies.

### Impact

**Zero** on existing consumers. This is purely additive. `apps/editor` and `@pascal-app/viewer` continue to import from the main entry and get the full surface — they currently don't use these subpaths and don't need to. No types, runtime behavior, or bundle composition is affected.

### Reversibility

Remove the 5 new entries from `exports` and the change is undone. `@pascal-app/mcp` would then have to ship its own shim or the core team would need to split `@pascal-app/core` into a "core-data" package and a "core-systems" package — a larger refactor.

### Suggested follow-up (upstream)

Long-term, consider moving `systems/` into a separate package `@pascal-app/systems` so that `@pascal-app/core` stays data-only. That's a breaking change and out of scope for this PR; the subpath exports are the non-breaking interim fix.

---

## 2. `SiteNode.children` inconsistency (observed, not fixed)

### What

`packages/core/src/schema/nodes/site.ts:36-38` declares:

```ts
children: z.array(z.discriminatedUnion('type', [BuildingNode, ItemNode]))
  .default([BuildingNode.parse({})])
```

`SiteNode.children` therefore holds **full node objects**. Every other container node (`building`, `level`, `wall`, `ceiling`, `roof`, `stair`) stores `string[]` (IDs) in `children`.

### Why this is a problem

- Data duplication: the building exists both in `nodes[building.id]` and embedded inside `site.children[0]`. Updates to the building in the dict don't propagate to the embedded copy.
- Traversal asymmetry: "get children of a container" needs `site`-specific branching.
- `duplicate_level`, `find_nodes({ parentId })`, and scene-serialisation round-trips all need a special case for site.

### Why we didn't fix it

Changing the schema is a breaking change to serialised scene data and would require a migration pass inside `setScene`. Out of scope for a non-breaking MCP addition.

### Workaround (inside MCP)

MCP tools resolve node children through the flat `nodes` dict by scanning for nodes whose `parentId` matches. This is correct regardless of which representation the schema chose.

### Suggested follow-up (upstream)

Align `SiteNode.children` to `z.array(z.string())` + migration in `setScene.migrateNodes` that extracts embedded building/item objects into the flat dict and replaces them with IDs.

---

## 3. `.github/workflows/mcp-ci.yml` — new CI workflow

### What

Adds a CI workflow that runs on pushes to `main` and on pull requests touching `packages/mcp/`, `packages/core/`, or `bun.lock`. The job installs deps with Bun, builds `@pascal-app/core` then `@pascal-app/mcp`, runs `bun test` in the mcp package, and runs `bunx biome check packages/mcp`.

### Why

The existing `.github/workflows/release.yml` is `workflow_dispatch`-only (manual releases for `core` / `viewer`). There was no automated pre-merge check for MCP builds/tests. A new workflow is needed so that PRs touching mcp/core are verified before merge.

### Impact

None on existing workflows; purely additive. The new workflow only triggers for paths under `packages/mcp/`, `packages/core/`, or `bun.lock`, so unrelated PRs remain unaffected. `release.yml` is untouched.

### Reversibility

Delete `.github/workflows/mcp-ci.yml`.

---

