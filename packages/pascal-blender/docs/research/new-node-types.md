# New node types: `trees:tree`, `trees:grass`, `fence`, `shelf`, `spawn`

Research date: 2026-08-02. Sources verified against `origin/main` of the local clones
(fetched, **not** checked out) and the production scene JSON.

| Source | Ref | Notes |
|---|---|---|
| `/Users/julien/Documents/GitHub/editor` | `origin/main` @ `4231a632` (release `@pascal-app/*@1.0.0-beta.2`) | All five kinds live here (or in its plugin dep) |
| `/Users/julien/Documents/GitHub/monorepo` | `main` @ `2e6d2b40` (via `ls-remote`; local `origin/main` ref is broken — `.git/index` mmap timeout + a corrupt `refs/remotes/origin/HEAD 2` ref) | **Not relevant**: only mention of these kinds is a `name.includes('fence')` heuristic in `apps/web/lib/scene-stats/extractor.ts:318` |
| `pascalorg/plugin-trees` | `main` @ `f054f88` (shallow clone at `/tmp/plugin-trees-research`, pinned by editor's `apps/editor/package.json` at `56d978cd`) | `trees:tree` / `trees:grass` schemas + geometry live in this separate repo, NOT in the editor repo |
| `/Users/julien/Downloads/layout_2026-08-03.json` | production export | 241 nodes; contains all 5 target kinds |

Node counts in the production file: `wall` 66, `item` 53, `door` 32, **`trees:grass` 17**,
`slab` 15, **`trees:tree` 13**, `zone` 12, `ceiling` 12, `window` 9, **`fence` 3**,
`roof-segment` 2, `level` 2, `roof` 1, `site` 1, **`shelf` 1**, **`spawn` 1**, `building` 1.
Top-level keys: `nodes`, `rootNodeIds`, and **`installedPlugins: ["pascal:trees"]`** (new —
our parser should tolerate/ignore it, or use it to warn when a plugin's kinds appear).

---

## 1. The plugin / namespace system (`trees:` prefix)

The editor moved to a **node registry + plugin architecture**. Built-in kinds
(`fence`, `shelf`, `spawn`, `wall`, ...) ship as `builtinPlugin` from `@pascal-app/nodes`;
external kinds are namespaced `<pluginId-short>:<kind>` and registered at runtime.

Key files (all `origin/main` of the editor repo):

- `packages/core/src/registry/registry.ts` — `NodeRegistryImpl`: a `Map<kind, AnyNodeDefinition>`;
  `registerNode()` throws on duplicate kinds in prod; `getNodePluginId(kind)` maps a kind back to
  the plugin that registered it; `isNodeKindEnabled(kind, installedPlugins)` gates kinds against the
  scene's persisted `installedPlugins` list (built-ins `pascal:core` always enabled).
- `apps/editor/lib/bootstrap.ts` — loads built-ins synchronously, then
  `extendPluginDiscovery(async () => [treesPlugin])` + `loadPlugin()` for externals.
  Dep pin: `"@pascal-app/plugin-trees": "github:pascalorg/plugin-trees#56d978cd..."`.
- `packages/core/src/validation/validate-build-json.ts:265-290` — a runtime-registered
  plugin kind (e.g. `trees:tree`) is validated with its own registered Zod schema; kinds from
  *unloaded* plugins fall through to an "unknown types" **warning** (not an error) and are
  preserved on load. **This is the behavior pascal-blender should copy**: unknown namespaced
  kinds must survive round-trip untouched.

The plugin manifest (`/tmp/plugin-trees-research/src/index.ts`,
https://github.com/pascalorg/plugin-trees):

```ts
export const treesPlugin: Plugin = {
  id: 'pascal:trees',
  apiVersion: 1,
  nodes: [
    treeDefinition as unknown as AnyNodeDefinition,    // kind: 'trees:tree'
    flowerDefinition as unknown as AnyNodeDefinition,  // kind: 'trees:flower'
    grassDefinition as unknown as AnyNodeDefinition,   // kind: 'trees:grass'
  ],
}
```

Each `NodeDefinition` bundles: `kind`, `schemaVersion`, Zod `schema`, `defaults()`,
`geometry`/`renderer`/`system` (render paths), `parametrics` (inspector), `tool` (placement),
`floorplan` (2D), and capability flags. Rendering of plugin nodes is registry-driven: the host
dispatches `NodeRenderer` per kind from the registry, so no per-kind code exists in the host.
There is also a `trees:flower` kind (not in this production file) — expect it eventually.

---

## 2. Verbatim schemas

### 2.1 `trees:tree` — `plugin-trees` `src/schema.ts` (@ `f054f88`)

```ts
export const TreePreset = z.enum(['oak', 'pine', 'aspen', 'ash', 'bush', 'trellis'])
export const TreeSize = z.enum(['small', 'medium', 'large'])
export const TreeType = z.enum(['deciduous', 'evergreen'])

export const TreeNode = BaseNode.extend({
  id: objectId('tree'),
  type: nodeType('trees:tree'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  preset: TreePreset.default('oak'),
  size: TreeSize.default('medium'),
  /** Growth-model override. Unset ⇒ inherit the preset (oak → deciduous, pine → evergreen). */
  treeType: TreeType.optional(),
  height: z.number().positive().default(7),
  /** Geometry-seed override. Unset ⇒ the preset's own seed (its canonical silhouette). */
  seed: z.number().int().optional(),
  /** Leaf-count multiplier vs the preset (1 = preset default). */
  foliageDensity: z.number().min(0).max(1.5).default(1),
  /** Branch-radius multiplier (1 = preset default). */
  trunkThickness: z.number().min(0.3).max(2.5).default(1),
  /** Strip all leaves — a bare winter silhouette. */
  leafless: z.boolean().default(false),
  /** Leaf tint override (hex). Unset ⇒ the preset's leaf tint. */
  leafColor: z.string().optional(),
  /** Bark/branch tint override (hex). Unset ⇒ the preset's bark tint. */
  branchColor: z.string().optional(),
})
```

Geometry (`src/geometry.ts`): trees are generated with
**[@dgreenheck/ez-tree](https://github.com/dgreenheck/ez-tree)** —
`tree.loadPreset(ezPresetOf(preset, size))` (preset names like `"Oak Medium"`, `"Bush 2"`,
`"Trellis"`), then overrides applied on top: `options.seed`, `options.type` (=`treeType`),
branch radii × `trunkThickness`, `leaves.count × foliageDensity` (0 if `leafless`),
`leaves.tint`/`bark.tint` from hex colors. Result is cached per "variant key"
(all geometry fields joined) and drawn as `InstancedMesh`es — `position`/`rotation`/`height`
are per-instance transforms only. **`height` semantics** (`src/instanced.tsx:208`): uniform
scale `s = node.height / naturalHeight(generatedTree)` — i.e. the generated tree is measured
(bbox Y extent) and scaled so its total height equals `node.height` meters.
Y placement is *presentational*: stored `position[1]` is 0 by contract; the renderer lifts
plants onto stacked slabs / sculpted terrain via `plantElevation()` (`src/elevation.ts`).

Default heights per preset/size (`src/presets.ts`): oak 5/7/11, pine 6/9/14, aspen 5/8/12,
ash 5/8/12, bush 1.2/1.5/1.8, trellis 3 (size ignored). Seed pool: `[1,7,13,21,34,55,89,144]`.

### 2.2 `trees:grass` — `plugin-trees` `src/grass-schema.ts`

```ts
export const GrassPreset = z.enum(['meadow', 'fescue', 'reed'])

export const GrassNode = BaseNode.extend({
  id: objectId('grass'),
  type: nodeType('trees:grass'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  preset: GrassPreset.default('meadow'),
  height: z.number().positive().default(0.4),
  seed: z.number().int().default(1),
  /** Blade colour (hex). Baked from the preset at placement. */
  bladeColor: z.string().default('#5a8f3c'),
})
```

Geometry (`src/grass-geometry.ts`, verbatim core): one **tuft** = N flattened cones merged
into one mesh, deterministic in `seed` (mulberry32 RNG):

```ts
const rng = mulberry32(seed >>> 0)
for (let i = 0; i < spec.blades; i++) {
  const bh = h * (0.6 + rng() * 0.6)
  const blade = new ConeGeometry(0.02, bh, 3)
  blade.scale(1, 1, 0.3)                    // flatten the cone into a blade
  blade.translate(0, bh / 2, 0)
  blade.rotateZ((rng() - 0.5) * 0.7)        // lean
  const angle = rng() * Math.PI * 2
  blade.rotateY(angle)
  const r = rng() * 0.07
  blade.translate(Math.cos(angle) * r, 0, Math.sin(angle) * r)
}
```

Presets (`src/grass-presets.ts`): meadow `#5a8f3c` 10 blades h=0.4; fescue `#7fae55` 8 blades
h=0.7; reed `#4a7d63` 6 blades h=1.1. `h` in the builder is the preset default; the instance is
then scaled to `node.height / naturalHeight` just like trees. Seed pool `[1,7,13,21,34]`.

### 2.3 `fence` — editor `packages/core/src/schema/nodes/fence.ts`

```ts
export const FenceStyle = z.enum(['slat', 'rail', 'privacy', 'horizontal'])
export const FenceBaseStyle = z.enum(['floating', 'grounded'])
export const FencePostCap = z.enum(['none', 'flat', 'pyramid'])

export const FenceNode = BaseNode.extend({
  id: objectId('fence'),
  type: nodeType('fence'),
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
  slots: z.record(z.string(), z.string()).optional(),   // paint-slot refs per slot id
  start: z.tuple([z.number(), z.number()]),              // [x, z] level-plan meters
  end: z.tuple([z.number(), z.number()]),
  path: z.array(z.tuple([z.number(), z.number()])).optional(),  // >=2 ⇒ Catmull-Rom spline centerline
  tangents: z.array(z.tuple([z.number(), z.number()]).nullable()).optional(), // per-point OUT handles
  height: z.number().default(1.8),
  thickness: z.number().default(0.08),
  supportSlabId: z.string().optional(),  // railing on a slab's walking surface
  supportOffset: z.number().finite().optional(),
  curveOffset: z.number().optional(),    // midpoint sagitta ⇒ single arc (ignored when path set)
  baseHeight: z.number().default(0.22),
  postSpacing: z.number().default(2),
  postSize: z.number().default(0.1),
  topRailHeight: z.number().default(0.04),
  groundClearance: z.number().default(0),
  edgeInset: z.number().default(0.015),
  slatGap: z.number().default(0.01),     // horizontal style board reveal
  postCap: FencePostCap.default('pyramid'),
  baseStyle: FenceBaseStyle.default('grounded'),
  showInfill: z.boolean().default(true),
  color: z.string().default('#ffffff'),
  style: FenceStyle.default('slat'),
})
```

Geometry: `packages/viewer/src/systems/fence/fence-system.tsx`
(`generateFenceSlotGeometries`, consumed by `packages/nodes/src/fence/geometry.ts`
`buildFenceGeometry`). The build splits into **4 paint slots**: `posts`, `infill`, `base`,
`rail`, each a merged BufferGeometry of box (or 4-sided-cone "pyramid") parts placed along
the centerline. Centerline resolution
(`packages/core/src/systems/fence/fence-centerline.ts`): spline (`path` ⇒ Catmull-Rom with
optional `tangents`) → else single arc via `curveOffset` (wall-curve math) → else straight
`start→end`. Key math for the non-`horizontal` styles (`createFenceParts`):

```
styleDefaults:  privacy   {spacing 0.42×, post 1.35×, base 1.2×, top 1.2×}
                rail      {spacing 0.68×, post 0.8×,  base 0.85×, top 0.85×}
                slat(dft) {spacing 0.3×,  post 0.55×, base 1×,    top 0.75×}

baseHeight'    = max(baseHeight × baseFactor, 0.04)
topRailHeight' = max(topRailHeight × topFactor, 0.01)
verticalHeight = max(height − baseHeight' − topRailHeight', 0.08)
postWidth      = max(postSize × postFactor, 0.01)
spacing        = max(postSpacing × spacingFactor, postWidth × 1.2)
count          = showInfill ? max(2, floor((len − 2·edgeInset)/spacing) + 1) : 2
```

Grounded fences get a kickboard (base slot, full length, depth = thickness×1.05) plus a thin
mid stringer; verticals march at `spacing` (end posts → `posts` slot, intermediates →
`infill` slot); a top rail caps the run (and floating fences get a matching bottom rail).
The `horizontal` style is different: square posts at `postSpacing` with flat/pyramid caps
and stacked full-length boards (~0.145 m target height, `slatGap` reveal).
Vertical placement: `resolveFenceLiftElevation` (`packages/nodes/src/fence/lift.ts`) — lift =
host slab elevation (if `supportSlabId` resolves to a slab on the same level) else terrain
`levelBase` at `start`, `+ supportOffset`.

### 2.4 `shelf` — editor `packages/core/src/schema/nodes/shelf.ts`

```ts
export const ShelfNode = BaseNode.extend({
  id: objectId('shelf'),
  type: nodeType('shelf'),
  children: z.array(ItemNode.shape.id).default([]),   // hosted items
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  supportSlabId: z.string().optional(),
  width: z.number().min(0.3).max(3.0).default(1.2),
  depth: z.number().min(0.1).max(1.0).default(0.3),
  thickness: z.number().min(0.01).max(0.1).default(0.04),  // boards, sides, back, dividers
  /** Floor → underside of the TOPMOST board. rows>1 spaces boards from height/rows up to height. */
  height: z.number().min(0.05).max(2.5).default(0.9),
  style: z.enum(['wall-shelf', 'bookshelf', 'open-rack', 'cubby']).default('wall-shelf'),
  rows: z.number().int().min(1).max(8).default(1),
  columns: z.number().int().min(1).max(6).default(1),
  withBack: z.boolean().default(false),
  withSides: z.boolean().default(true),
  withBottom: z.boolean().default(false),
  bracketStyle: z.enum(['minimal', 'industrial', 'hidden']).default('minimal'),
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
  slots: z.record(z.string(), z.string()).optional(),  // 'shelves' | 'frame' | 'back'
})
```

Geometry: `packages/nodes/src/shelf/geometry.ts` `buildShelfGeometry` — **pure boxes**,
origin at the floor under the unit's center, all local-space (node `position`/`rotation`
applied outside). Shared math:

```
boardCenterYs: for r in 1..rows: y = r·(height/rows) + thickness/2     (topmost board underside at `height`)
unitHeight    = height + thickness              (bookshelf/open-rack/cubby frame height)
innerWidth    = withSides ? width − 2·thickness : width
BOARD_INSET   = 0.001   FRAME_TOP_INSET = 0.001    (anti z-fighting recesses)
```

- `wall-shelf`: boards `width × thickness × depth` at each boardCenterY; unless
  `bracketStyle === 'hidden'`, two brackets at `x = ±(width/2 − min(0.12, width/6))`,
  height = `height`, width = industrial ? `max(0.04, depth·0.2)` : `max(0.02, depth·0.12)`,
  depth = industrial ? `depth·0.95` : `depth·0.7`.
- `bookshelf`: boards (innerWidth) + optional bottom board + side panels
  `thickness × unitHeight × depth` at `x=±(width/2−thickness/2)` (or 4 corner posts when
  `withSides=false`) + optional back panel `innerWidth × unitHeight × thickness` at rear
  + `columns−1` vertical dividers.
- `open-rack`: thinner boards (`max(0.02, thickness·0.8)`), 4 corner posts
  (`max(0.025, thickness·1.5)` square), optional 2 horizontal back braces when `withBack`.
- `cubby`: boards + always sides + always back + per-cell vertical dividers
  (rows × columns grid; `withBottom` closes the bottom row).

The production shelf (`height: 0.21`, `rows: 1`, `columns: 4`, `withBottom: true`,
`style: wall-shelf`) — note wall-shelf **ignores** `columns`/`withBottom`; it renders one board
+ 2 minimal brackets. `position[1] = 1.61` = wall-mount height.

### 2.5 `spawn` — editor `packages/core/src/schema/nodes/spawn.ts`

```ts
export const SpawnNode = BaseNode.extend({
  id: objectId('spawn'),
  type: nodeType('spawn'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.number().default(0),          // scalar Y-rotation, radians
  supportSlabId: z.string().optional(),
})
```

Renderer: `packages/nodes/src/spawn/renderer.tsx` — a **non-exported marker** (indigo
`#818cf8`, emissive): floor ring (annulus r 0.34–0.48 at y=0.09), forward direction arrow
(triangle at z=−0.52 — i.e. facing −Z before rotation), torso box 0.3×0.54×0.16 at y=0.41,
head cube 0.18³ at y=0.83. Hidden in walkthrough mode; `glb-export.ts:1061` **excludes spawn
from exports** (overlay layer only). It marks the first-person walkthrough start point.

### 2.6 `BaseNode` (editor `packages/core/src/schema/base.ts`) — fields all kinds share

```ts
export const BaseNode = z.object({
  object: z.literal('node').default('node'),
  id: z.string(),
  type: nodeType('node'),
  name: z.string().optional(),
  parentId: z.string().nullable().default(null),
  visible: z.boolean().optional().default(true),
  camera: CameraSchema.optional(),
  metadata: z.json().optional().default({}),
})
```

---

## 3. Production JSON cross-reference (`/Users/julien/Downloads/layout_2026-08-03.json`)

All 35 target-type nodes are parented to `level_998lug65axp9vt36`.

### 3.1 `trees:tree` (13 nodes) — 2 representatives, verbatim

```json
{
  "id": "tree_6o2gfmaz41zw7rnv",
  "size": "medium",
  "type": "trees:tree",
  "height": 2.3,
  "object": "node",
  "preset": "bush",
  "visible": true,
  "leafless": false,
  "metadata": {},
  "parentId": "level_998lug65axp9vt36",
  "position": [-5.413824450285014, 0, 10.680214445761628],
  "rotation": [0, 3.141592653589793, 0],
  "treeType": "evergreen",
  "leafColor": "#6aa555",
  "foliageDensity": 0.6,
  "trunkThickness": 1
}
```

```json
{
  "id": "tree_9qlqf9qol44t0sxd",
  "size": "medium",
  "type": "trees:tree",
  "height": 8,
  "object": "node",
  "preset": "ash",
  "visible": true,
  "leafless": false,
  "metadata": {},
  "parentId": "level_998lug65axp9vt36",
  "position": [-4.662616914075331, 0, -12.417741441986138],
  "rotation": [0, 5.497787143782138, 0],
  "foliageDensity": 1,
  "trunkThickness": 1
}
```

Field table (presence over the 13 nodes; units per schema):

| field | present | type | units / values observed |
|---|---|---|---|
| `id` | 13/13 | str | `tree_<16 [0-9a-z]>` |
| `type` | 13/13 | str | `"trees:tree"` |
| `object` / `visible` / `metadata` / `parentId` | 13/13 | — | `"node"` / `true` / `{}` / level id |
| `position` | 13/13 | [x,y,z] m | y always 0 (lift is presentational) |
| `rotation` | 13/13 | [rx,ry,rz] rad | only ry set — multiples of π/4 |
| `preset` | 13/13 | enum | `ash`, `aspen`, `bush`, `oak` seen |
| `size` | 13/13 | enum | all `"medium"` |
| `height` | 13/13 | number m | 2, 2.3, 7, 8 (total tree height) |
| `treeType` | 6/13 | enum? | `"evergreen"` (optional override) |
| `leafColor` | 6/13 | hex str? | `"#6aa555"` (optional override) |
| `foliageDensity` | 13/13 | number 0–1.5 | 0.6, 1 |
| `trunkThickness` | 13/13 | number 0.3–2.5 | 1 |
| `leafless` | 13/13 | bool | `false` |
| `seed` / `branchColor` | 0/13 | — | absent ⇒ inherit preset |

### 3.2 `trees:grass` (17 nodes) — 2 representatives, verbatim

```json
{
  "id": "grass_2kzuh8iy7imon4mn",
  "seed": 34,
  "type": "trees:grass",
  "height": 0.4,
  "object": "node",
  "preset": "meadow",
  "visible": true,
  "metadata": {},
  "parentId": "level_998lug65axp9vt36",
  "position": [5.423442072669177, 0, 9.113898912570317],
  "rotation": [0, 3.9269908169872414, 0],
  "bladeColor": "#5a8f3c"
}
```

```json
{
  "id": "grass_5asygrb72fbx1ily",
  "seed": 1,
  "type": "trees:grass",
  "height": 0.4,
  "object": "node",
  "preset": "meadow",
  "visible": true,
  "metadata": {},
  "parentId": "level_998lug65axp9vt36",
  "position": [3.959360779216066, 0, 11.745615200751416],
  "rotation": [0, 2.356194490192345, 0],
  "bladeColor": "#5a8f3c"
}
```

| field | present | type | units / values observed |
|---|---|---|---|
| `id` | 17/17 | str | `grass_<16>` |
| `type` | 17/17 | str | `"trees:grass"` |
| `position` | 17/17 | [x,y,z] m | y = 0 |
| `rotation` | 17/17 | [rx,ry,rz] rad | ry multiples of π/4 |
| `preset` | 17/17 | enum | all `"meadow"` |
| `height` | 17/17 | number m | 0.4 (tuft height) |
| `seed` | 17/17 | int | 1, 7, 13, 21, 34 (= `GRASS_SEED_POOL`) |
| `bladeColor` | 17/17 | hex str | `"#5a8f3c"` |
| base fields | 17/17 | — | as BaseNode |

### 3.3 `fence` (3 nodes) — 2 representatives, verbatim

```json
{
  "id": "fence_kxnr9jlohw5epqje",
  "end": [2.2653913528600813, -4.250837089442304],
  "name": "Fence 3",
  "type": "fence",
  "color": "#ffffff",
  "start": [2.2616600534182165, -10.041249914610754],
  "style": "rail",
  "height": 2.5,
  "object": "node",
  "visible": true,
  "metadata": {},
  "parentId": "level_998lug65axp9vt36",
  "postSize": 0.1,
  "baseStyle": "grounded",
  "edgeInset": 0.015,
  "thickness": 0.08,
  "baseHeight": 0.22,
  "showInfill": true,
  "postSpacing": 2,
  "topRailHeight": 0.04,
  "groundClearance": 0
}
```

```json
{
  "id": "fence_pro55n1dzc52us4u",
  "end": [11.311660053418217, -10.041249914610752],
  "name": "Fence 1",
  "type": "fence",
  "color": "#ffffff",
  "start": [11.311660053418217, -4.341249914610751],
  "style": "rail",
  "height": 2.5,
  "object": "node",
  "visible": true,
  "metadata": {},
  "parentId": "level_998lug65axp9vt36",
  "postSize": 0.1,
  "baseStyle": "grounded",
  "edgeInset": 0.015,
  "thickness": 0.08,
  "baseHeight": 0.22,
  "showInfill": true,
  "postSpacing": 2,
  "topRailHeight": 0.04,
  "groundClearance": 0
}
```

| field | present | type | units / values observed |
|---|---|---|---|
| `start` / `end` | 3/3 | [x,z] m | level-plan coordinates (same pair convention as walls) |
| `style` | 3/3 | enum | all `"rail"` |
| `height` | 3/3 | number m | 2.5 |
| `thickness` | 3/3 | number m | 0.08 |
| `baseHeight` / `topRailHeight` | 3/3 | number m | 0.22 / 0.04 |
| `postSpacing` / `postSize` | 3/3 | number m | 2 / 0.1 |
| `edgeInset` / `groundClearance` | 3/3 | number m | 0.015 / 0 |
| `baseStyle` | 3/3 | enum | `"grounded"` |
| `showInfill` | 3/3 | bool | `true` |
| `color` | 3/3 | hex str | `"#ffffff"` |
| `name` | 3/3 | str | `"Fence 1..3"` |
| `path`/`tangents`/`curveOffset`/`slots`/`supportSlabId`/`postCap`/`slatGap` | 0/3 | — | absent ⇒ straight fence, defaults |

### 3.4 `shelf` (1 node) — verbatim

```json
{
  "object": "node",
  "id": "shelf_am3xbl30p9ckaqwm",
  "type": "shelf",
  "name": "Shelf",
  "parentId": "level_998lug65axp9vt36",
  "visible": true,
  "metadata": {},
  "children": [],
  "position": [-0.2, 1.61, 2.47],
  "rotation": [0, 0, 0],
  "width": 1.484378619255496,
  "depth": 0.26656164898580964,
  "thickness": 0.05,
  "height": 0.21,
  "style": "wall-shelf",
  "rows": 1,
  "columns": 4,
  "withBack": false,
  "withSides": true,
  "withBottom": true,
  "bracketStyle": "minimal"
}
```

| field | type | units / notes |
|---|---|---|
| `position` | [x,y,z] m | y = 1.61 (wall-mounted shelf) — origin is floor of the unit, boards built upward locally |
| `rotation` | [rx,ry,rz] rad | euler |
| `width`/`depth`/`thickness`/`height` | m | height = floor→underside of topmost board |
| `style` | enum | `wall-shelf` here; `columns`/`withBottom` are no-ops for this style |
| `rows`/`columns` | int | board stack / vertical divisions |
| `withBack`/`withSides`/`withBottom` | bool | topology toggles |
| `bracketStyle` | enum | `minimal` / `industrial` / `hidden` |
| `children` | [item ids] | hosted items live on board top surfaces |

### 3.5 `spawn` (1 node) — verbatim

```json
{
  "id": "spawn_dn6p2w61qt3jkekz",
  "name": "Spawn Point",
  "type": "spawn",
  "object": "node",
  "visible": true,
  "metadata": {},
  "parentId": "level_998lug65axp9vt36",
  "position": [-2, 0, 13.75],
  "rotation": 0
}
```

| field | type | notes |
|---|---|---|
| `position` | [x,y,z] m | |
| `rotation` | **scalar** rad | Y-rotation only — unlike every other kind's euler triple. Our `coords.py` already has the mapping: `rotation_euler.z = -r` |

---

## 4. Blender geometry recommendations

Grounded in what the schema/renderer actually does (§2), mapped through our existing
conventions (`pascal_blender/core/coords.py`: pascal `[x,y,z]` → blender `(x,−z,y)`; plan
`[x,z]` → `(x,−z)`; scalar Y-rot → `rotation_euler.z = −r`).

### `fence` — posts + rails from the centerline (native build, highest value)

The editor's own geometry is nothing but **boxes (+ 4-sided pyramid caps) along a 2D
centerline**, split into posts/infill/base/rail — exactly the shape of our wall builder.
Recommendation:

- Resolve the centerline in this priority: `path` (Catmull-Rom through control points,
  honoring `tangents` as out-handle mirrors) → `curveOffset` (single arc, same sagitta math
  as curved walls) → straight `start→end`. The 3 production fences are all straight, so v1
  can ship straight+arc and log a note for `path`.
- Port `createFenceParts` faithfully: style factor table (slat/rail/privacy), derived
  `baseHeight'`/`topRailHeight'`/`verticalHeight`, post count `max(2, floor((len−2·edgeInset)/spacing)+1)`,
  kickboard + mid stringer when `baseStyle=='grounded'`, top rail always, verticals between.
  `horizontal` style: posts at `postSpacing` with `postCap` toppers + stacked boards with
  `slatGap` reveals. Emit ONE mesh per fence with 4 material slots (posts/infill/base/rail)
  so paint-slot materials can attach later; simple `color` on all slots for now.
- Elevation: `supportSlabId` → host slab elevation + `supportOffset` (mirror
  `resolveFenceLiftElevation`); else level base.

### `trees:tree` — proxy or procedural stand-in, keyed by (preset, size, seed…)

The real geometry needs the ez-tree JS library (procedural, seeded) — not reproducible
exactly in Python. What the node *carries* is: species preset, size class, target `height`
(total meters, the renderer scales the generated tree to it), optional seed/treeType,
foliage/trunk multipliers, leafless flag, leaf/branch tints. Recommendation, in order:

1. **v1 (cheap, correct footprint):** a low-poly parametric proxy — tapered-cylinder trunk +
   icosphere canopy (cone canopy when `treeType=='evergreen'`, sphere cluster for
   `'bush'`, flat lattice for `'trellis'`) scaled so total Z-height = `height`, canopy tinted
   `leafColor` (fallback per-preset swatch: oak `#4f7942`, pine `#2f5d3a`, aspen `#8fae5d`,
   ash `#6f9457`, bush `#5c8a4a`, trellis `#8b6b45`), skip canopy when `leafless`. Use
   linked object data (Blender's instancing) per identical variant key — same trick the
   editor uses with `InstancedMesh`.
2. **v2 (nice):** a "sapling"/tree-gen integration or a small bundled .blend asset library per
   preset×size, scaled to `height`. Store all schema fields as custom properties for
   round-trip.

### `trees:grass` — port the tuft builder verbatim (it's 20 lines)

The editor's grass IS reproducible in Python: mulberry32 is trivial to port, and the tuft is
N flattened cones. Recommendation: implement `mulberry32(seed)` + the exact blade loop from
§2.2 with `bmesh` cones (`ConeGeometry(0.02, bh, 3)` ≈ 3-sided cone radius 0.02), preset
blade counts (meadow 10 / fescue 8 / reed 6), scale tuft to `height/naturalHeight`, material
= `bladeColor`. Same seed ⇒ same tuft as the web renderer. Share mesh data across identical
`(preset, seed, bladeColor, height)` — production uses only 5 seeds, so 17 tufts ≈ 5 meshes.

### `shelf` — parametric box shelf, port `buildShelfGeometry`

Pure `BoxGeometry` composition — ports 1:1 to Python. Implement the four styles with the
shared math in §2.4 (`boardCenterYs`, `unitHeight = height + thickness`, `innerWidth`),
including the 1 mm anti-z-fight insets (harmless in Blender, keeps vertex parity with the
web renderer for testing). Origin at floor-center of the unit; then place with
`position`/`rotation` via `coords.py`. Production only exercises `wall-shelf`, so validate
that style first (1 board + 2 brackets). Keep `children` item hosting working: hosted items
are separate `item` nodes whose world position the existing item builder already handles —
just don't double-transform them.

### `spawn` — marker Empty (+ optional mesh gizmo), never rendered

The editor itself excludes spawn from GLB export and hides it in walkthrough. Recommendation:
create an **Empty** (type `SINGLE_ARROW` or `PLAIN_AXES`, or an Empty with a small custom
ring+arrow mesh child for parity with the web look: ring r 0.34–0.48, arrow at local −Y in
Blender after conversion), `rotation_euler.z = -rotation` (scalar!), tagged
`pascal_type='spawn'` and excluded from renders (`hide_render = True`). Useful as a camera
start point: optionally aim/spawn a camera preset from it in `build/cameras.py`.

### Cross-cutting

- Add all 5 kinds to `KNOWN_NODE_TYPES` in `pascal_blender/core/schema.py:78` and register
  builders in `pascal_blender/build/importer.py:60` (order: fence/shelf/spawn after slabs so
  slab-support elevation resolves; trees/grass last).
- **Namespaced kinds policy:** treat `:`-prefixed kinds we don't know as "plugin nodes" —
  preserve them (current importer already routes unknowns to "Pascal Unhandled",
  `importer.py:91`) but special-case the `trees:` family natively. Read
  `installedPlugins` from the file root and include it in the import report.
- Store every schema field verbatim as Blender custom properties (our existing datalayer
  pattern) so exports round-trip fields we don't visualize (e.g. fence `slots`, tree
  `branchColor`).
