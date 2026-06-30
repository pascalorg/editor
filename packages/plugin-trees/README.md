# @pascal-app/plugin-trees

The first-party **example plugin** for the Pascal editor. It contributes a
procedural _trees_ node and a left-rail _presets_ panel, and exists to prove —
and document — the minimal host surface every future plugin reuses.

It is structurally identical to a third-party plugin: it peer-depends on
`@pascal-app/{core,viewer,editor}` (plus `react`/`three`/`@react-three/fiber`/
`zustand`) and bundles `@dgreenheck/ez-tree` for the geometry. It imports
nothing private. Copy this folder as the starting point for a new plugin.

## What it demonstrates

The contribution paths a plugin has:

1. **Left-rail panel** — `panels` in the manifest. `presets-panel.tsx` is a
   plain React component the host mounts behind an error boundary.
2. **Right inspector for free** — `def.parametrics` (`parametrics.ts`). The host
   renders the preset/height/seed controls + the Randomize action with zero
   tree-specific code.
3. **Placement** — `def.tool`/`def.preview` (`tool.tsx`, `preview.tsx`). The
   tool respects the active snapping mode (`isGridSnapActive()` + `gridSnapStep`)
   exactly like the built-in item/shelf tools.
4. **Instanced rendering** — instead of the per-node `def.geometry` path, trees
   render via two pieces:
   - `def.system` (`system.tsx`) — a collective renderer mounted once that
     groups every `trees:tree` node by `(preset, seed)` variant and draws each
     variant as one `InstancedMesh` per sub-mesh. A forest of N trees is a
     handful of draw calls. Geometry per variant is generated once by ez-tree
     (`geometry.ts`) and cached.
   - `def.renderer` (`proxy-renderer.tsx`) — a featherweight invisible,
     raycastable proxy per node so the host's existing selection / outline /
     zone machinery keeps working with no instanceId bookkeeping.

It also shows the communication triangle: `presets-panel` → plugin store
(`store.ts`) → `def.tool` → `SceneApi` → scene → reactive `useScene` read-back
(the "N planted" counter in the panel).

`@dgreenheck/ez-tree` ships its bark/leaf textures inlined as base64, so there
are no assets to host. Placement seeds are drawn from a small bounded pool
(`TREE_SEED_POOL`) so trees share variants — that sharing is what makes the
instancing pay off; a unique inspector seed just renders as its own variant.

## Manifest

```ts
import { treesPlugin } from '@pascal-app/plugin-trees'
// host:
setPluginDiscovery(async () => [treesPlugin])
```

`treesPlugin` exports one node kind (`trees:tree`) and one panel (`Trees`),
loaded through the same `loadPlugin` path as the built-ins.

## Notes / known gaps

- `createNode` and the `floorPlaced.footprint` callback are typed against the
  host's hand-maintained `AnyNode` union, so the node is cast (`as AnyNode` /
  `as TreeNode`). The registry derives `AnyNode` post-migration.
- The placement tool re-derives level-local conversion from the public
  `sceneRegistry` because the built-in `floor-placement` helpers aren't part of
  the public `@pascal-app/*` surface yet — a candidate for a future
  `@pascal-app/plugin-api` re-export package.
- **Instanced selection highlight** outlines the proxy's bounding box, not the
  tree silhouette, because the host's outline pass reads one `Object3D` per node
  and the visible pixels live in a shared `InstancedMesh`. Per-instance
  silhouette outlining would need host support.
- The instance matrices fold in the parent level's world transform; a building
  move while trees are static won't refresh until a tree node next changes.

See `wiki/architecture/plugin-authoring.md` for the full contract.
