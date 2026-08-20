# Pascal Scene JSON — Field-Level Schema Census

**Purpose:** ground-truth inventory of every field that can appear in a persisted Pascal scene, for a zero-information-loss export/import (e.g. a Blender Python port). An engineer with only this document must be able to read and write scene JSON byte-for-byte compatibly.

**Sources of truth (repo `pascal-app/editor`):**

- `packages/core/src/schema/base.ts` — BaseNode, ID generation
- `packages/core/src/schema/types.ts` — `AnyNode` discriminated union
- `packages/core/src/schema/nodes/*.ts` — per-type schemas
- `packages/core/src/schema/material.ts` — material schema + presets
- `packages/core/src/schema/camera.ts` — per-node saved cameras
- `packages/core/src/schema/collections.ts` — collections (plain TS type, NOT a Zod schema)
- `packages/core/src/store/use-scene.ts` — store shape, `migrateNodes()`
- `packages/core/src/utils/clone-scene-graph.ts` — canonical `SceneGraph` type
- `packages/editor/src/lib/scene.ts`, `packages/editor/src/hooks/use-auto-save.ts` — persistence
- Real data: `apps/editor/public/demos/demo_1.json` (the only demo file)

Zod version: **zod 4** (`^4.3.5`). All schemas use `z.object` (non-strict): **unknown extra keys are stripped on `.parse()` but scenes are usually persisted WITHOUT re-parsing** (see §2), so unknown keys survive round-trips through the editor. A lossless exporter must preserve unrecognized keys.

---

## 1. Top-level persisted shape

```ts
// packages/core/src/utils/clone-scene-graph.ts (canonical)
export type SceneGraph = {
  nodes: Record<AnyNodeId, AnyNode>   // flat dict, keyed by node id
  rootNodeIds: AnyNodeId[]            // top-level node ids
  collections?: Record<CollectionId, Collection>  // optional
}
```

- `packages/editor/src/lib/scene.ts` declares a narrower `SceneGraph = { nodes, rootNodeIds }` and **the autosave path saves only `{ nodes, rootNodeIds }`**:

  ```ts
  // use-auto-save.ts
  const { nodes, rootNodeIds } = useScene.getState()
  const sceneGraph = { nodes, rootNodeIds } as SceneGraph
  ```

  So **collections are currently NOT persisted by the built-in autosave** (they live in the zustand store and in the undo history partialize `{nodes, rootNodeIds, collections}`, and `setScene()` resets `collections: {}` on load). Hosts that use `cloneSceneGraph`/custom `onSave` may include `collections`. A lossless format should accept and preserve an optional `collections` key.
- **No camera, metadata, or version key at the top level.** Cameras are stored per-node (`node.camera`, see §3). There is no schema-version field anywhere.
- localStorage keys (editor default persistence, not part of the file format): scene under `pascal-editor-scene`; selection under `pascal-editor-selection[:<projectId>]` as `{buildingId, levelId, zoneId, selectedIds}` (UI-only).
- `demo_1.json` top level is exactly `{"nodes": {...}, "rootNodeIds": [...]}`.

### 1.1 Node graph invariants and cross-referencing

- `nodes` is **flat**; hierarchy is expressed doubly:
  - child → parent: `node.parentId` (string node id, or `null`)
  - parent → children: `node.children` (array of node-id strings) on container types (site, building, level, wall, ceiling, roof, item)
- `rootNodeIds` lists nodes with no parent. Normally a single `site_*` id; **`demo_1.json` predates the site node and has `rootNodeIds: ["building_..."]`** — a renderer must handle any node type at root.
- **Exception:** `SiteNode.children` is an array of **embedded full node objects** (Building/Item), not id strings, per the Zod schema. Consumers handle both:

  ```ts
  // use-editor.tsx
  siteNode.children.map((child) => (typeof child === 'string' ? scene.nodes[child] : child))
  ```

  In practice the default scene created by `loadScene()` embeds the full building object in `site.children` **and** also stores the same building in the flat `nodes` dict. An exporter must accept both string ids and embedded objects in `site.children`.
- Store mutations (`node-actions.ts`) keep `parentId` and parent `children` in sync; deletion is recursive over `children` and also removes ids from `rootNodeIds` and from collection `nodeIds`.
- **Dangling references occur in real data**: `demo_1.json` contains 7 items whose `parentId` points to wall ids not present in `nodes`, and they appear in no `children` array. Robust importers must tolerate orphans (renderer only draws nodes reachable from `rootNodeIds` via `children`; `resolveLevelId()` falls back to the string `'default'` for orphans).

### 1.2 Node ID format

```ts
// base.ts
const customId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16)
export const generateId = (prefix) => `${prefix}_${customId()}`
```

- Format: `<prefix>_<16 chars of [0-9a-z]>` (nanoid custom alphabet). Examples: `wall_0j28n7nskm2sst7m`, `rseg_abc...`, `collection_...`.
- Zod only validates the template-literal `` `${prefix}_${string}` `` — the 16-char suffix is a generation convention, not enforced on load.
- Prefix per type: `site`, `building`, `level`, `wall`, `item`, `zone`, `slab`, `ceiling`, `roof`, `rseg` (type `roof-segment`!), `scan`, `guide`, `window`, `door`, `collection`. Note the **`rseg` prefix ≠ `roof-segment` type string**.
- `cloneSceneGraph()` derives the prefix from the id substring before the first `_` (fallback `node`), then regenerates ids and remaps `parentId`, `children`, `wallId`, `collections.nodeIds`, `collections.controlNodeId`, and `node.collectionIds`.

---

## 2. Parsing/serialization behavior (critical for defaults)

- On **load**, `applySceneGraphToEditor()` → `useScene.setScene(nodes, rootNodeIds)` runs **only `migrateNodes()` (§16)** — it does **NOT** run Zod parsing. Missing optional-with-default fields therefore stay missing in memory; **all runtime consumers apply fallbacks with `??`** (documented per field below where the runtime fallback differs from the schema default).
- Zod `.parse()` (which fills defaults) runs only when the editor *creates* nodes (tools, duplicate). Consequently real files legitimately omit any field marked *(default)* below, and a re-implementation must apply the default at read time.
- On **save**, the in-memory node objects are serialized as-is (`JSON.stringify`); nothing is stripped or normalized. Transient editor flags may leak into files via `metadata` (e.g. `isTransient`, `isNew`; see §3 metadata).

---

## 3. BaseNode — fields shared by every node type

`packages/core/src/schema/base.ts`:

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

| Field | Type | Required in JSON? | Default | Meaning |
|---|---|---|---|---|
| `object` | `"node"` literal | optional | `"node"` | discriminator vs. non-node objects; always `"node"` |
| `id` | string | **required** | — | node id, `<prefix>_<suffix>` (§1.2) |
| `type` | string literal per node | optional in Zod (has default) but **always present in real data**; the discriminated union dispatches on it | per-type literal | node type |
| `name` | string | optional | *(absent)* | user-visible label (e.g. `"Plancher"`, `"Roof 1"`) |
| `parentId` | string \| null | optional | `null` | parent node id; `null` for roots |
| `visible` | boolean | optional | `true` | render visibility |
| `camera` | Camera (§4) | optional | *(absent)* | saved per-node camera view |
| `metadata` | arbitrary JSON | optional | `{}` | free-form. Known editor keys: `isTransient` (draft node during tool drag — renderers skip pointer handlers; stripped on commit but could leak), `isNew` (duplicate-in-progress flag). Treat as opaque and preserve. |

Also exported but **unused legacy**: `export const Material = z.string().optional()` (a preset-name string; superseded by `MaterialSchema`).

---

## 4. Camera (`camera.ts`) — may appear on ANY node

```ts
const Vector3Schema = z.tuple([z.number(), z.number(), z.number()])
export const CameraSchema = z.object({
  position: Vector3Schema,
  target: Vector3Schema,
  mode: z.enum(['perspective', 'orthographic']).default('perspective'),
  fov: z.number().optional(),   // perspective only
  zoom: z.number().optional(),  // orthographic only
})
```

| Field | Type | Required | Default | Units/meaning |
|---|---|---|---|---|
| `position` | [x,y,z] | required | — | world meters, Y-up |
| `target` | [x,y,z] | required | — | look-at point, world meters |
| `mode` | `perspective` \| `orthographic` | optional | `perspective` | |
| `fov` | number | optional | absent | degrees (perspective) |
| `zoom` | number | optional | absent | ortho zoom factor |

Writer (`custom-camera-controls.tsx`) saves only `{position, target, mode}` — `fov`/`zoom` are never written today. In `demo_1.json` cameras appear on `level` and `zone` nodes. Setting `camera: undefined` deletes it.

---

## 5. Material (`material.ts`) — used by wall, slab, ceiling, roof, roof-segment, window, door

```ts
export const MaterialSchema = z.object({
  preset: MaterialPreset.optional(),
  properties: MaterialProperties.optional(),
  texture: z.object({
    url: z.string(),
    repeat: z.tuple([z.number(), z.number()]).optional(),
    scale: z.number().optional(),
  }).optional(),
})
```

`node.material` is optional on all nodes that have it; **absent means "use the per-node-type default material"** (§5.3), *not* the `white` preset (except via `resolveMaterial` which is only invoked when `material` is set... see below).

### 5.1 MaterialPreset (enum)

`'white' | 'brick' | 'concrete' | 'wood' | 'glass' | 'metal' | 'plaster' | 'tile' | 'marble' | 'custom'`

### 5.2 MaterialProperties

| Field | Type | Default | Meaning |
|---|---|---|---|
| `color` | string | `#ffffff` | CSS hex |
| `roughness` | number 0–1 | `0.5` | PBR roughness |
| `metalness` | number 0–1 | `0` | PBR metalness |
| `opacity` | number 0–1 | `1` | |
| `transparent` | boolean | `false` | |
| `side` | `front`\|`back`\|`double` | `front` | face culling (THREE FrontSide/BackSide/DoubleSide) |

Resolution algorithm (`resolveMaterial`):

```ts
if (!material) return DEFAULT_MATERIALS.white
if (material.preset && material.preset !== 'custom')
  return { ...DEFAULT_MATERIALS[material.preset], ...material.properties }  // properties override preset
return { ...DEFAULT_MATERIALS.custom, ...material.properties }
```

`DEFAULT_MATERIALS` table (color / roughness / metalness / opacity / transparent / side):

| preset | color | rough | metal | opacity | transparent | side |
|---|---|---|---|---|---|---|
| white | `#ffffff` | 0.9 | 0 | 1 | false | front |
| brick | `#8b4513` | 0.85 | 0 | 1 | false | front |
| concrete | `#808080` | 0.8 | 0 | 1 | false | front |
| wood | `#deb887` | 0.7 | 0 | 1 | false | front |
| glass | `#87ceeb` | 0.1 | 0.1 | 0.3 | **true** | **double** |
| metal | `#c0c0c0` | 0.3 | 0.9 | 1 | false | front |
| plaster | `#f5f5dc` | 0.95 | 0 | 1 | false | front |
| tile | `#d3d3d3` | 0.4 | 0.1 | 1 | false | front |
| marble | `#fafafa` | 0.2 | 0.1 | 1 | false | front |
| custom | `#ffffff` | 0.5 | 0 | 1 | false | front |

### 5.3 Per-node-type fallback materials when `node.material` is absent

(`packages/viewer/src/lib/materials.ts` — all `metalness: 0`, `side: front` unless noted)

| Node type | color | roughness | notes |
|---|---|---|---|
| wall | `#ffffff` | 0.9 | |
| slab | `#e5e5e5` | 0.8 | |
| door | `#8b4513` | 0.7 | |
| window | `#87ceeb` | 0.1 | metalness 0.1, opacity 0.3, transparent, DoubleSide |
| ceiling | `#f5f5dc` | 0.95 | |
| roof / roof-segment | `#808080` | 0.85 | |

### 5.4 texture

`texture.url` (string, required if `texture` present), `texture.repeat` `[u,v]` optional, `texture.scale` number optional. **The viewer currently ignores `texture` when building THREE materials** (only color/roughness/metalness/opacity/transparent/side are applied) — preserve on round-trip anyway.

---

## 6. Node type census — `AnyNode` union (`types.ts`)

14 types: `site`, `building`, `level`, `wall`, `item`, `zone`, `slab`, `ceiling`, `roof`, `roof-segment`, `scan`, `guide`, `window`, `door`. Discriminated on `type`.

All tables below list **type-specific fields only** (BaseNode fields from §3 apply to all). "Default" = Zod default filled at parse; remember runtime reads raw JSON, so importers must apply these defaults themselves.

### 6.1 SiteNode (`site`) — id prefix `site`

| Field | Type | Req | Default | Meaning |
|---|---|---|---|---|
| `polygon` | `{ type: 'polygon', points: [x,z][] }` | optional | 30×30 m square: `points: [[-15,-15],[15,-15],[15,15],[-15,15]]` | property-line boundary, meters, ground plane. When rendering, shape uses `(x, -z)` in XY then rotated `-PI/2` about X (i.e. z is negated). |
| `children` | array of **embedded** Building/Item node objects | optional | `[BuildingNode.parse({})]` (one default building) | see §1.1 — may contain full objects or (in consumer code paths) id strings |

Commented-out in source (never shipped): `terrain` (3D point mesh).

### 6.2 BuildingNode (`building`) — prefix `building`

| Field | Type | Req | Default | Meaning |
|---|---|---|---|---|
| `children` | `levelId[]` (strings) | optional | `[]` | level node ids |
| `position` | [x,y,z] | optional | `[0,0,0]` | in site coordinates (meters) |
| `rotation` | [x,y,z] | optional | `[0,0,0]` | Euler radians |

Renderer note: `BuildingRenderer` currently renders a plain `<group>` and does **not** apply `position`/`rotation` (levels are positioned by the level system). Values are almost always `[0,0,0]` in real data.

### 6.3 LevelNode (`level`) — prefix `level`

| Field | Type | Req | Default | Meaning |
|---|---|---|---|---|
| `children` | id[] of wall/zone/slab/ceiling/roof/scan/guide (**items also appear in practice** — demo has 30 item children on a level; the Zod union omits `item` but ids are plain strings so nothing rejects them) | optional | `[]` | |
| `level` | number | optional | `0` | storey index; 0 = ground. Levels are Y-stacked: level N's world Y = Σ heights of levels below it, where a level's height = `max(ceiling.height ?? 2.5, wallMeshY + (wall.height ?? 2.5))` over its children, fallback `DEFAULT_LEVEL_HEIGHT = 2.5` m. |

### 6.4 WallNode (`wall`) — prefix `wall`

| Field | Type | Req | Default | Meaning |
|---|---|---|---|---|
| `children` | id[] (items; windows/doors are also parented here by tools) | optional | `[]` | wall-attached openings/items |
| `material` | MaterialSchema | optional | absent → §5.3 | |
| `thickness` | number | optional | **no schema default**; runtime `?? 0.1` m (`DEFAULT_WALL_THICKNESS`) — but space-detection uses `?? 0.2`! | meters |
| `height` | number | optional | runtime `?? 2.5` m (`DEFAULT_WALL_HEIGHT`) | meters |
| `start` | [x, z] | **required** | — | level-plan coordinates, meters (x, z ground plane) |
| `end` | [x, z] | **required** | — | |
| `frontSide` | `interior`\|`exterior`\|`unknown` | optional | `unknown` | derived by space detection; front = side of +90° normal `(-dz, dx)/L` from wall direction |
| `backSide` | same | optional | `unknown` | |

Wall-local space convention (used by wall children): **X along wall from `start` toward `end`; Y up from wall base; Z perpendicular (front = +Z local normal ↔ `getSideFromNormal: normal[2] >= 0 → 'front'`)**. World transform of wall mesh: `position=(start[0], slabElevation, start[1])`, `rotation.y = -atan2(end[1]-start[1], end[0]-start[0])`. Wall-local→world:

```ts
wallAngle = atan2(end[1]-start[1], end[0]-start[0])
world = [ start[0] + localX*cos(wallAngle),
          slabElevation + localY + levelYOffset,
          start[1] + localX*sin(wallAngle) ]
```

### 6.5 ItemNode (`item`) — prefix `item`

| Field | Type | Req | Default | Meaning |
|---|---|---|---|---|
| `position` | [x,y,z] | optional | `[0,0,0]` | level coords (floor items) **or** parent-local (wall/item children). For wall children: x = wall-local X of item **center**, **y = BOTTOM of item** (unlike window/door which store center Y), z = 0 (item system offsets z by `±wallThickness/2` for `wall-side`). Floor items: y is offset above slab; render y = `slabElevation + position[1]`. |
| `rotation` | [x,y,z] | optional | `[0,0,0]` | Euler radians, parent-local |
| `scale` | [x,y,z] | optional | `[1,1,1]` | multiplies `asset.scale` for the model AND `asset.dimensions` for spatial math (`getScaledDimensions`) |
| `side` | `front`\|`back` | optional | absent | which wall face (wall-attached only) |
| `children` | itemId[] | optional | `[]` | items stacked on this item's `surface` |
| `wallId` | string | optional | absent | redundant wall ref (equals parentId for openings) |
| `wallT` | number | optional | absent | 0–1 parametric position along wall (declared; not observed in demo data) |
| `collectionIds` | CollectionId[] | optional | absent | denormalized collection membership |
| `asset` | Asset (§6.5.1) | **required** | — | catalog payload, fully embedded per node |

#### 6.5.1 Asset subobject

| Field | Type | Req | Default | Meaning |
|---|---|---|---|---|
| `id` | string | required | — | catalog slug, e.g. `"lounge-chair"` |
| `category` | string | required | — | e.g. `furniture`, `window`, `door`, `appliance`, `outdoor`, `ceiling` |
| `name` | string | required | — | display name |
| `thumbnail` | string | required | — | URL/path, e.g. `/items/lounge-chair/thumbnail.webp` |
| `src` | string | required | — | GLB URL/path. URL scheme: `http(s)://` as-is; `asset://<uuid>` = file blob in browser IndexedDB (key `asset_data:<uuid>` — NOT recoverable from the JSON alone!); otherwise prefixed with CDN `NEXT_PUBLIC_ASSETS_CDN_URL` (default `https://editor.pascal.app`). |
| `dimensions` | [w,h,d] | optional | `[1,1,1]` | meters, footprint/bbox |
| `attachTo` | `wall`\|`wall-side`\|`ceiling` | optional | absent = floor item | `wall` = embedded opening (window/door with cutout); `wall-side` = surface-mounted on a wall face (z offset ±thickness/2); `ceiling` = ceiling-mounted |
| `tags` | string[] | optional | absent | |
| `offset` | [x,y,z] | optional | `[0,0,0]` | corrective model offset (applied to GLB clone) |
| `rotation` | [x,y,z] | optional | `[0,0,0]` | corrective Euler radians |
| `scale` | [x,y,z] | optional | `[1,1,1]` | corrective scale; final model scale = `asset.scale[i] * item.scale[i]` |
| `surface` | `{ height: number }` | optional | absent = nothing can be placed on it | resting height (m) for child items |
| `interactive` | Interactive (§6.5.2) | optional | absent | controls + effects |

Rendering pipeline: `<group position={item.position} rotation={item.rotation}>` → GLB clone with `position=asset.offset, rotation=asset.rotation, scale=asset.scale*item.scale`. Meshes named `cutout` inside the GLB are hidden and used as CSG subtraction volumes against the parent wall.

#### 6.5.2 Interactive

```ts
interactive = { controls: Control[] (default []), effects: Effect[] (default []) }
```

Controls (discriminated on `kind`):

- **toggle**: `label?` string, `default?` boolean
- **slider**: `label` (req), `min` (req), `max` (req), `step` default `1`, `unit?`, `displayMode` `'slider'|'stepper'|'dial'` default `'slider'`, `default?` number
- **temperature**: `label` default `"Temperature"`, `min` default `16`, `max` default `30`, `unit` `'C'|'F'` default `'C'`, `default?` number

Effects (discriminated on `kind`):

- **animation**: `clips: { on?: string, off?: string, loop?: string }` (GLB animation clip names)
- **light**: `color` default `#ffffff`, `intensityRange` `[min,max]` (req), `distance?` number, `offset` [x,y,z] default `[0,0,0]`

### 6.6 ZoneNode (`zone`) — prefix `zone`

| Field | Type | Req | Default | Meaning |
|---|---|---|---|---|
| `name` | string | **required** (overrides BaseNode optional) | — | |
| `polygon` | [x,z][] | **required** | — | level-plan meters |
| `color` | string | optional | `#3b82f6` | hex |
| `metadata` | JSON | optional | `{}` | (re-declared; same as base) |

Zones are flat colored regions; renderer draws walls of height 2.3 m for visualization only (not persisted).

### 6.7 SlabNode (`slab`) — prefix `slab`

| Field | Type | Req | Default | Meaning |
|---|---|---|---|---|
| `material` | MaterialSchema | optional | absent → §5.3 | |
| `polygon` | [x,z][] | **required** | — | boundary, level-plan meters |
| `holes` | [x,z][][] | optional | `[]` | hole polygons |
| `elevation` | number | optional | `0.05` | slab thickness in meters — the slab is extruded **upward** by `elevation` from level Y=0; geometry outsets the polygon by `SLAB_OUTSET = 0.05` m on all sides. Negative elevation extends walls downward (wall height becomes `height - slabElevation`, wall base at `slabElevation`). |

Polygon→mesh: THREE Shape with `(x, -z)`, holes likewise, `ExtrudeGeometry(depth=elevation)`, then `rotateX(-PI/2)`.

### 6.8 CeilingNode (`ceiling`) — prefix `ceiling`

| Field | Type | Req | Default | Meaning |
|---|---|---|---|---|
| `children` | itemId[] | optional | `[]` | ceiling-mounted items |
| `material` | MaterialSchema | optional | absent → §5.3 | |
| `polygon` | [x,z][] | **required** | — | |
| `holes` | [x,z][][] | optional | `[]` | |
| `height` | number | optional | `2.5` | meters above level base; mesh rendered at `height - 0.01` (z-fighting offset, not persisted) |

### 6.9 RoofNode (`roof`) — prefix `roof` (current, container form)

| Field | Type | Req | Default | Meaning |
|---|---|---|---|---|
| `material` | MaterialSchema | optional | absent → §5.3 | |
| `position` | [x,y,z] | optional | `[0,0,0]` | roof group center, level coords |
| `rotation` | **number** (scalar!) | optional | `0` | radians about Y |
| `children` | rsegId[] | optional | `[]` | roof segments; **absence of `children` key identifies the LEGACY roof shape** (§16.2) |

### 6.10 RoofSegmentNode (`roof-segment`) — prefix **`rseg`**

| Field | Type | Req | Default | Meaning |
|---|---|---|---|---|
| `material` | MaterialSchema | optional | absent | |
| `position` | [x,y,z] | optional | `[0,0,0]` | relative to parent roof group |
| `rotation` | number (scalar) | optional | `0` | radians about Y |
| `roofType` | `hip`\|`gable`\|`shed`\|`gambrel`\|`dutch`\|`mansard`\|`flat` | optional | `gable` | |
| `width` | number | optional | `8` | footprint width, m |
| `depth` | number | optional | `6` | footprint depth, m |
| `wallHeight` | number | optional | `0.5` | gable/knee wall height below roof, m |
| `roofHeight` | number | optional | `2.5` | peak height above walls, m |
| `wallThickness` | number | optional | `0.1` | m |
| `deckThickness` | number | optional | `0.1` | m |
| `overhang` | number | optional | `0.3` | eave overhang, m |
| `shingleThickness` | number | optional | `0.05` | outer shingle layer, m |

### 6.11 ScanNode (`scan`) — prefix `scan`

| Field | Type | Req | Default | Meaning |
|---|---|---|---|---|
| `url` | string | **required** | — | 3D scan asset URL (same URL schemes as asset.src) |
| `position` | [x,y,z] | optional | `[0,0,0]` | |
| `rotation` | [x,y,z] | optional | `[0,0,0]` | Euler radians |
| `scale` | number (scalar) | optional | `1` | uniform |
| `opacity` | number 0–100 | optional | `100` | **percent**, not 0–1 |

### 6.12 GuideNode (`guide`) — prefix `guide`

Identical shape to Scan except `opacity` default **`50`**. Represents a reference image/floor-plan underlay. Demo example uses `url: "asset://<uuid>"` (IndexedDB-only blob).

### 6.13 WindowNode (`window`) — prefix `window` (parametric window; distinct from legacy window *items*)

| Field | Type | Req | Default | Meaning |
|---|---|---|---|---|
| `material` | MaterialSchema | optional | absent → §5.3 window default | |
| `position` | [x,y,z] | optional | `[0,0,0]` | **wall-local; x along wall, y = CENTER height, z = 0** |
| `rotation` | [x,y,z] | optional | `[0,0,0]` | wall-local Euler; y is `0` (back face) or `PI` (front face, from `calculateItemRotation`) |
| `side` | `front`\|`back` | optional | absent | wall face |
| `wallId` | string | optional | absent | wall reference (= parentId in practice) |
| `width` | number | optional | `1.5` | outer width, m |
| `height` | number | optional | `1.5` | outer height, m |
| `frameThickness` | number | optional | `0.05` | frame member width, m |
| `frameDepth` | number | optional | `0.07` | frame depth within wall, m |
| `columnRatios` | number[] | optional | `[1]` | pane split ratios, left→right; e.g. `[0.6,0.4]`; `[1]` = single pane |
| `rowRatios` | number[] | optional | `[1]` | pane split ratios vertically |
| `columnDividerThickness` | number | optional | `0.03` | m |
| `rowDividerThickness` | number | optional | `0.03` | m |
| `sill` | boolean | optional | `true` | show sill |
| `sillDepth` | number | optional | `0.08` | m |
| `sillThickness` | number | optional | `0.03` | m |

Placement: tool snaps wall-local x/y to 0.5 m and clamps center to `[width/2, wallLength - width/2]` × `[height/2, wallHeight - height/2]`.

### 6.14 DoorNode (`door`) — prefix `door`

| Field | Type | Req | Default | Meaning |
|---|---|---|---|---|
| `material` | MaterialSchema | optional | absent → door default `#8b4513` | |
| `position` | [x,y,z] | optional | `[0,0,0]` | wall-local; **y = height/2 always (center; door sits on floor)** |
| `rotation` | [x,y,z] | optional | `[0,0,0]` | as window |
| `side` | `front`\|`back` | optional | absent | |
| `wallId` | string | optional | absent | |
| `width` | number | optional | `0.9` | m |
| `height` | number | optional | `2.1` | m |
| `frameThickness` | number | optional | `0.05` | m |
| `frameDepth` | number | optional | `0.07` | m |
| `threshold` | boolean | optional | `true` | threshold bar |
| `thresholdHeight` | number | optional | `0.02` | m |
| `hingesSide` | `left`\|`right` | optional | `left` | |
| `swingDirection` | `inward`\|`outward` | optional | `inward` | |
| `segments` | DoorSegment[] | optional | two panels: `[{type:'panel',heightRatio:0.4,...},{type:'panel',heightRatio:0.6,...}]` with each `columnRatios:[1], dividerThickness:0.03, panelDepth:0.01, panelInset:0.04` | leaf rows stacked **top→bottom** |
| `handle` | boolean | optional | `true` | |
| `handleHeight` | number | optional | `1.05` | m above floor |
| `handleSide` | `left`\|`right` | optional | `right` | |
| `contentPadding` | [x,y] | optional | `[0.04,0.04]` | leaf inner margin, m |
| `doorCloser` | boolean | optional | `false` | commercial hardware |
| `panicBar` | boolean | optional | `false` | |
| `panicBarHeight` | number | optional | `1.0` | m |

#### DoorSegment

| Field | Type | Req | Default | Meaning |
|---|---|---|---|---|
| `type` | `panel`\|`glass`\|`empty` | **required** | — | `empty` = flush fill, `panel` = raised/recessed, `glass` = glazed |
| `heightRatio` | number | **required** | — | share of leaf height |
| `columnRatios` | number[] | optional | `[1]` | per-segment column split |
| `dividerThickness` | number | optional | `0.03` | m |
| `panelDepth` | number | optional | `0.01` | m; positive = raised, negative = recessed |
| `panelInset` | number | optional | `0.04` | m |

---

## 7. Collections (`collections.ts`) — plain TS type, no Zod validation

```ts
type Collection = {
  id: `collection_${string}`
  name: string
  color?: string          // hex
  nodeIds: AnyNodeId[]    // members
  controlNodeId?: AnyNodeId  // optional "controller" node
}
```

- Stored as `Record<CollectionId, Collection>` under top-level `collections` (when a host persists them; see §1).
- Denormalized: each member node (items) also carries `collectionIds: CollectionId[]`.
- On node delete, membership is scrubbed both ways. `updateCollection` merges partials; `createCollection` writes `{id, name, nodeIds}` only (no `color`/`controlNodeId` initially).

---

## 8. Coordinate conventions summary

- World: **Y-up, meters, right-handed (THREE.js)**. Ground plane is XZ.
- 2D plan coordinates everywhere are `[x, z]` pairs (wall start/end, polygons). When converting a plan polygon to a THREE Shape the code maps `(x, z) → shape(x, -z)` and then `rotateX(-PI/2)` — i.e. plan +z is world +z.
- Angles: radians. Wall angle = `atan2(dz, dx)`; wall mesh `rotation.y = -angle`.
- Level stacking: level N group Y = cumulative sum of `getLevelHeight` of lower levels (§6.3). Within a level, floor items get `mesh.y = slabElevation + item.position[1]`.
- Wall-local space for openings/items: §6.4. Vertical anchor differs by type: **item = bottom, window = center, door = center (y = height/2)**.

---

## 9. migrateNodes() — legacy shapes in the wild

`packages/core/src/store/use-scene.ts`, run on every `setScene` (load). Verbatim logic:

### 9.1 Item scale (legacy items lack `scale`)

```ts
if (node.type === 'item' && !('scale' in node)) {
  patchedNodes[id] = { ...node, scale: [1, 1, 1] }
}
```

All 50 items in `demo_1.json` lack `scale` → migrated to `[1,1,1]`.

### 9.2 Legacy roof → roof + roof-segment

Legacy roof shape (pre-segment; see §15/demo): `roof` node **without `children`** and with fields `length` (ridge length, default 4), `height` (peak height, default 1.5), `leftWidth`/`rightWidth` (horizontal slope widths from ridge, default 1.5 each), plus `position` [x,y,z] and scalar `rotation`.

Migration creates a synthetic gable segment and rewrites the roof:

```ts
const suffix = id.includes('_') ? id.split('_')[1] : Math.random().toString(36).slice(2)
const segmentId = `rseg_${suffix}`
const segment = {
  object: 'node', id: segmentId, type: 'roof-segment', parentId: id,
  visible: oldRoof.visible ?? true, metadata: {},
  position: [0, 0, 0], rotation: 0, roofType: 'gable',
  width: oldRoof.length ?? 8,                                   // NOTE: default 8 here, not 4
  depth: (oldRoof.leftWidth ?? 2.2) + (oldRoof.rightWidth ?? 2.2), // NOTE: 2.2 fallbacks
  wallHeight: 0, roofHeight: oldRoof.height ?? 2.5,
  wallThickness: 0.1, deckThickness: 0.1, overhang: 0.3, shingleThickness: 0.05,
}
patchedNodes[segmentId] = segment
patchedNodes[id] = { ...oldRoof, children: [segmentId] }
```

Gotchas: the migrated roof node **keeps** its legacy `length/height/leftWidth/rightWidth` keys (spread-preserved); the segment id reuses the roof's id suffix; the migration's fallback constants (8, 2.2, 2.5) differ from the legacy schema defaults (4, 1.5, 1.5).

These are the **only** migrations. Anything else in old files passes through untouched.

---

## 10. Demo data census — `apps/editor/public/demos/demo_1.json`

Only one demo file exists. Top-level: `{nodes, rootNodeIds}`; 65 nodes: 1 building, 2 levels, 1 slab, 2 roofs (legacy shape), 2 zones, 50 items, 6 walls, 1 guide. `rootNodeIds = ["building_bv4ilcjivnxn8wkd"]`.

Fields present vs. schema:

| Observation | Schema implication |
|---|---|
| Root is a **building**, no site node | pre-site format; loader keys off `rootNodeIds`, handles gracefully |
| First level has `parentId: null` yet is in building's `children` | parentId/children can disagree; children[] is what the renderer follows |
| 7 items reference parent walls that don't exist in `nodes` | orphans must be tolerated (never rendered) |
| Roofs have `length/height/leftWidth/rightWidth`, no `children` | triggers §9.2 migration |
| Items have no `scale` | triggers §9.1 |
| No `window`/`door` **nodes**; openings are `item` nodes with `asset.attachTo: 'wall'` and `asset.category: 'window'|'door'` | both representations coexist; parametric Window/Door nodes are the newer system |
| `camera` present on levels and zones (`{position, target, mode:"perspective"}` only) | fov/zoom never written |
| `metadata: {}` on every node; `object: "node"` on every node | defaults materialized at creation time |
| Level children mix: slab, zone, item, wall, roof, guide | `item` at level scope is real even though LevelNode children union omits it |
| Item asset fields present: id, category, name, thumbnail, src, dimensions, offset, rotation, scale always; `attachTo` on 21/50 | `tags`, `surface`, `interactive` absent in demo but schema-legal |
| `side` on 21 items (`front`×14, `back`×7) | |
| No `material`, `thickness`, `height`, `frontSide`, `backSide` on any wall | all runtime defaults exercised |
| guide `url` is `asset://<uuid>` | not resolvable outside the authoring browser (IndexedDB) |

Schema-declared but unobserved anywhere in the demo: `wallT`, `collectionIds`, `holes`, `elevation` ≠ 0.05, `texture`, `interactive`, `surface`, `tags`, site/scan/window/door/roof-segment/ceiling nodes, `collections`.

---

## 11. Reimplementation checklist (zero information loss)

1. Read `{nodes, rootNodeIds}`; accept optional `collections`; preserve unknown top-level keys defensively.
2. Do NOT require any field marked optional above; apply schema defaults at read time; on write, you may omit fields that were absent (the editor itself never back-fills them into files except via §9 migrations and node creation).
3. Preserve `metadata` verbatim per node, all unknown per-node keys (e.g. legacy roof `length/leftWidth/rightWidth`), and both string-id and embedded-object forms of `site.children`.
4. Apply §9 migrations exactly (including the odd fallback constants) if you need render parity with the editor for legacy files — but keep the original fields for lossless re-export.
5. Handle orphan nodes (unreachable/dangling parentId) by preserving them without rendering.
6. Vertical anchors: item bottom / window center / door center-at-height-over-2; wall-local X measured from `start`.
7. Runtime defaults that differ from "nice" values: wall thickness 0.1 (but 0.2 inside space-detection), wall height 2.5, level height 2.5, slab elevation 0.05 (+0.05 m polygon outset when meshing), guide opacity 50 vs scan 100.
