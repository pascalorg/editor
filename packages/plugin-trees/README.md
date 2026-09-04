# Pascal Nature plugin

![Procedural trees, flowers, grasses, and shrubs from the Pascal Nature plugin](./assets/nature-plugin.png)

The standalone, first-party **example plugin** for the Pascal editor. It contributes
procedural plant nodes plus a separately exported host-side Nature panel, and
exists to prove — and document — the minimal node-plugin surface every future
plugin reuses.

Clone this repository as the starting point for your own Pascal plugin:

```bash
git clone https://github.com/pascalorg/plugin-trees.git
cd plugin-trees
bun install
bun run check-types
```

It is structurally identical to a third-party plugin: it peer-depends on
`@pascal-app/{core,viewer,editor}` (plus `react`/`three`/`@react-three/fiber`/
`zustand`) and bundles `@dgreenheck/ez-tree` for the geometry. It imports
nothing private.

Read [Create a plugin](https://editor.pascal.app/docs/developers/plugins) for
the public API walkthrough and host integration contract.

## What it demonstrates

The contribution paths this package demonstrates:

1. **Host-side panel extension** — the standalone editor registers
   `treesHostPanel` separately from the core plugin manifest. `presets-panel.tsx`
   is a plain React component the host mounts behind an error boundary.
2. **Right inspector for free** — `def.parametrics` (`parametrics.ts`). The host
   renders the preset/height/seed controls + the Randomize action with zero
   tree-specific code.
3. **Placement** — `def.tool`/`def.preview` (`tool.tsx`, `preview.tsx`). The
   tool respects the active snapping mode (`isGridSnapActive()` + `gridSnapStep`)
   exactly like the built-in item/shelf tools.
4. **Instanced rendering** (the generic core in `instanced.tsx`, shared by both
   kinds) — instead of the per-node `def.geometry` path, plants render via two
   pieces:
   - `def.system` — a collective renderer mounted once that groups every node of
     the kind by its geometry variant and draws each variant as one
     `InstancedMesh` per sub-mesh. A forest of N is a handful of draw calls.
     Variant geometry is generated once and cached.
   - `def.renderer` — a featherweight per-node proxy: a stable invisible box
     collider (the raycast target) in an outer group, plus the real geometry
     (invisible, mounted only while hovered/selected) in an inner *registered*
     group. So the host's outline pass traces the **true silhouette**, picking
     stays on the box, and selection / outline / zone machinery works unchanged
     with no instanceId bookkeeping.

### Three kinds

- **`trees:tree`** — ez-tree geometry (`geometry.ts`); species presets Oak /
  Pine / Aspen / Ash / Bush / Trellis × a Small/Medium/Large **size** (all of
  ez-tree's built-in presets), a Deciduous/Evergreen **type**, curated params
  (foliage density, trunk thickness, leafless), and leaf/branch **colour tints** —
  all folded into the variant key. Colours are edit-only (inspector), not on the
  placement brush.
- **`trees:flower`** — simple procedural geometry (`flower-geometry.ts`, merged
  per material); presets daisy / tulip / lavender, with a per-flower petal colour.
- **`trees:grass`** — procedural blade tufts (`grass-geometry.ts`); presets
  meadow / fescue / reed, with a per-tuft blade colour.

Flowers and grass are sibling kinds that reuse the exact same instanced core +
placement helper (`instanced.tsx` / `placement.tsx`) and the shared procedural
RNG (`mulberry32` in `geometry.ts`) — the template for adding more plant kinds.

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

`treesPlugin` exports three node kinds (`trees:tree`, `trees:flower`,
`trees:grass`) for the core `loadPlugin` path. The editor app separately imports
`treesHostPanel` to describe and surface the Nature rail entry; panels are not
part of the v1 core plugin manifest. The panel declares `pluginId` and
`defaultInstalled: true`, so Nature is listed in the Plugins sidebar and is
enabled for new and legacy scenes unless a project explicitly uninstalls it.

## Notes / known gaps

- `package.json` points `main`/`exports` at raw TypeScript (`./src/index.ts`).
  Pascal's example hosts transpile this source package directly. If you publish
  your plugin to npm for other hosts, ship built JS with `.d.ts` declarations or
  document the equivalent host transpilation requirement.
- `createNode` and the `floorPlaced.footprint` callback are typed against the
  host's hand-maintained `AnyNode` union, so the node is cast (`as AnyNode` /
  `as TreeNode`). The registry derives `AnyNode` post-migration.
- The placement tool re-derives level-local conversion from the public
  `sceneRegistry` because the built-in `floor-placement` helpers aren't part of
  the public `@pascal-app/*` surface yet — a candidate for a future
  `@pascal-app/plugin-api` re-export package.
- The instance matrices fold in the parent level's world transform; a building
  move while plants are static won't refresh until a node of that kind next
  changes.
- Heavy *per-node* tweaking of geometry params (or unique seeds) erodes
  instancing batching — but it degrades gracefully: such a node just becomes its
  own single-instance variant, never worse than the non-instanced path.

See [Create a plugin](https://editor.pascal.app/docs/developers/plugins) for the
full contract.

## Credits

Tree geometry is powered by [ez-tree](https://github.com/dgreenheck/ez-tree),
created by [David Greenheck](https://github.com/dgreenheck). Thank you for making
the project available to the community under the MIT license.

## License

MIT. `@dgreenheck/ez-tree`, used for tree geometry, is also MIT licensed.
