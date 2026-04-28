# Cross-cutting changes touching packages outside `@pascal-app/mcp`

Integrator review required. Each entry documents:
- **What** was changed
- **Why** (what blocked MCP without it)
- **Impact** on existing consumers
- **Reversibility**

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

Adds a CI workflow that runs on pushes to `main` and on pull requests touching `packages/mcp/`, `packages/core/`, the editor scene API surface, `.github/workflows/mcp-ci.yml`, or `bun.lock`. The job installs deps with Bun, builds `@pascal-app/core` then `@pascal-app/mcp`, runs `bun test` in the mcp package, runs focused editor scene API tests, and runs Biome over the MCP package plus the editor scene API files.

### Why

The existing `.github/workflows/release.yml` is `workflow_dispatch`-only (manual releases for `core` / `viewer`). There was no automated pre-merge check for MCP builds/tests. A new workflow is still needed so that PRs touching mcp/core are verified before merge, and it now covers the editor scene API because those routes consume the same MCP operations layer. Full `apps/editor` typecheck was evaluated but is not part of this workflow because it currently fails on unrelated `packages/editor` type errors.

### Impact

None on existing workflows; purely additive. The workflow only triggers for MCP/core/editor scene API paths, the workflow file itself, or `bun.lock`, so unrelated PRs remain unaffected. `release.yml` is untouched.

### Reversibility

Delete `.github/workflows/mcp-ci.yml`.

---

## 4. `packages/mcp/package.json` — added `./storage` and `./operations` subpath exports

### What

Added `./storage` and `./operations` entries to the `"exports"` map of `@pascal-app/mcp`, pointing at the built `dist/storage/index.{js,d.ts}` and `dist/operations/index.{js,d.ts}`. The existing `"."` entry is unchanged.

### Why

The Next.js editor (`apps/editor`) needs access to `createSceneStore()`, `SceneStore` types/errors, and the shared `SceneOperations` service layer in server-only code (API route handlers + `lib/scene-store-server.ts`). The main entry `.` pulls in the full MCP server surface (tools, transports, MCP SDK), which is overkill for a consumer that only needs storage/operations. The subpath exports let `apps/editor` dynamically import storage and operations without re-declaring either contract.

The concrete backend is now `SqliteSceneStore`, backed by built-in SQLite drivers (`bun:sqlite` for the MCP CLI and `node:sqlite` for the Next.js editor server). It writes to `~/.pascal/data/pascal.db` by default and also supports `PASCAL_DATA_DIR`, `PASCAL_DB_PATH`, and `PASCAL_MAX_SCENE_BYTES`.

### Impact

Zero on existing consumers. Purely additive. The `.` entry continues to export `SceneBridge`, `createPascalMcpServer`, etc., exactly as before.

### Reversibility

Remove the `./storage`/`./operations` entries from `exports` and update `apps/editor` to use a different factory. No data or behavior changes — pure module-graph shaping.

### Related

- `apps/editor/package.json` adds `@pascal-app/mcp` as a workspace dependency so the subpath resolves.
- `apps/editor/lib/scene-store-server.ts` and `apps/editor/app/api/scenes/**` consume these subpaths.
- `packages/mcp/src/storage/sqlite-scene-store.ts` is the only production storage backend.

---

## 5. `packages/core/src/schema/asset-url.ts` — URL scheme allowlist on scene URL fields

### What

Introduced a shared `AssetUrl` Zod validator and replaced the bare `z.string()`
on every URL-bearing field in core's schemas:

- `scan.url` (`packages/core/src/schema/nodes/scan.ts`)
- `guide.url` (`packages/core/src/schema/nodes/guide.ts`)
- `item.asset.src` (`packages/core/src/schema/nodes/item.ts`)
- `material.texture.url` (`packages/core/src/schema/material.ts`)
- `material.maps.*` (`albedoMap`, `normalMap`, `roughnessMap`, `metalnessMap`,
  `aoMap`, `displacementMap`, `emissiveMap`, `bumpMap`, `alphaMap`, `lightMap`)

The validator accepts `asset://…`, `blob:…`, `data:image/…`, `/…` app-relative
paths, `https://…`, and `http://localhost|127.0.0.1/…`. Optional origin
narrowing via `process.env.PASCAL_ALLOWED_ASSET_ORIGINS` (comma-separated).
Rejects `javascript:`, `file:`, `ftp:`, `ws:`, `data:text/html`,
`data:application/*`, link-local / private IPs over bare `http`, empty strings,
and non-URL garbage.

### Why

Security review found that an attacker-crafted scene containing
`javascript:alert(1)` or `http://169.254.169.254/latest/meta-data/` for a
texture URL would beacon or exfiltrate when the editor renders it.
`AnyNode.safeParse`, used by the MCP bridge, now rejects those payloads at the
schema boundary.

### Impact

- **Existing scenes**: localStorage-resident scenes bypass strict validation on
  load (the store's `setScene` only runs `safeParse` on stair-type via
  `migrateNodes`), so this is *not* a breakage for returning users. Legacy
  URLs will keep loading; only explicit MCP-bridge `safeParse` calls reject.
- **MCP consumers**: one existing test
  (`packages/mcp/src/bridge/scene-bridge.test.ts`, previously using
  `src: 'data:model/gltf-binary;base64,'`) now fails because `data:model/` is
  not in the allowlist. Replaced with `asset://test/chair.glb` — the only
  sanctioned scheme for an in-repo ItemNode fixture.
- **Other packages**: `@pascal-app/viewer`, `@pascal-app/editor`, and
  `material-library.ts` all continue to work because every built-in URL is a
  `/material/…` app-relative path (allowlisted).

### Known gaps / follow-ups

1. **`item.asset.thumbnail` stayed untyped** — the field is still bare
   `z.string()` in `item.ts`. The Phase 3 audit called it out alongside `src`,
   but the Phase 7 task scope only required `src`. Follow-up: apply `AssetUrl`
   to `thumbnail` as well. Verify the `place-item` tool's default
   `thumbnail: ''` (currently empty string) gets a proper fallback first.
2. **`dist/` pollution** — `packages/core/tsconfig.json` `include`s `src` and
   doesn't exclude `**/*.test.ts`, so the new `asset-url.test.ts` is emitted
   to `dist/schema/`. Harmless (nothing imports it), but should be excluded
   for a clean publish. Mirror the `exclude: ["**/*.test.ts"]` pattern used
   in `packages/mcp/tsconfig.json`. Out of scope for A7 because tsconfig is
   not in the ownership list.
3. **`bun:test` typing** — the test file uses `@ts-expect-error` on its
   `bun:test` import because `@pascal-app/core` does not depend on
   `@types/bun`. Adding it as a dev dep (or, preferred, excluding tests from
   the core tsc build per gap 2) would remove the directive.
4. **`data:image/svg+xml` loophole** — passes the validator because it starts
   with `data:image/`, but SVG can carry inline scripts. If the editor ever
   renders SVG via unsanitised HTML-injection APIs or `<foreignObject>`, this
   becomes an injection vector. Consider a stricter variant
   (`data:image/(png|jpe?g|webp|gif)`) for texture slots where SVG isn't needed.
5. **Same-origin HTTP scenes** — `http://localhost` is allowed for dev, but a
   scene persisted in dev and shared in prod will still validate. Consider
   gating on `NODE_ENV` once we have a stable env-flag story.

### Reversibility

Delete `packages/core/src/schema/asset-url.ts` and revert the five imports in
`scan.ts`, `guide.ts`, `item.ts`, and `material.ts` to `z.string()`. The
scene-bridge test update is self-contained.

---

## 6. `apps/editor` / `packages/editor` scene-loading support

### What

The PR still touches the editor app and editor package, but the remaining files
are tied to the MCP scene workflow:

- `apps/editor/app/api/scenes/**`, `apps/editor/components/save-button.tsx`,
  and `apps/editor/components/scene-loader.tsx` expose saved MCP scenes in the
  web editor.
- `packages/editor/src/hooks/use-auto-frame.ts` plus
  `packages/editor/src/lib/scene-bounds.ts` frame the camera after a stored scene
  is loaded, avoiding an apparently empty viewport when MCP loads a scene away
  from the default camera pose.
- The large demo fixture `apps/editor/public/dev/casa-sol.json` was removed from
  this PR to keep the diff focused.

### Why

The MCP package can save scenes without these editor changes, but the PR goal is
to let contributors open and continue scenes saved by MCP. The API/UI pieces and
auto-frame hook are the minimum editor-side bridge for that workflow. They do
not change `@pascal-app/viewer` exports.

### Reversibility

If maintainers want a narrower MCP-only PR, revert the editor app pages/routes
and the auto-frame helper files, then keep only `@pascal-app/mcp`, the required
`@pascal-app/core` subpath/schema changes, and `bun.lock`.

---
