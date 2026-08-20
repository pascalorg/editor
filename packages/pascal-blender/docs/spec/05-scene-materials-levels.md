# 05 — Scene structure, materials, level stacking, and everything else

Reimplementation-grade spec for the remaining Pascal editor subsystems: scene file format and
load semantics, site / building / level hierarchy (including the exact level-stacking Y math),
slab and ceiling geometry, zones, scans, guides, the full material system, the existing GLB/STL/OBJ
export path (and everything it loses), per-node cameras, and collections.

Source repo: `pascal-app` editor monorepo (`packages/core`, `packages/viewer`, `packages/editor`).
All source paths below are relative to the repo root. Cross-checked against
`apps/editor/public/demos/demo_1.json`.

Everything is in **meters**. Angles are **radians** unless noted.

---

## 1. Scene file format and load semantics

### 1.1 Persisted shape

A saved scene (autosave payload, `layout_YYYY-MM-DD.json` download, demo files) is exactly:

```json
{
  "nodes":       { "<nodeId>": { ...node }, ... },
  "rootNodeIds": ["<nodeId>", ...]
}
```

- `nodes` is a **flat dictionary**; hierarchy is expressed by `children` (arrays of child IDs on
  container nodes) and denormalized `parentId` on each node.
- `rootNodeIds` normally contains a single `site_*` id, but real data may point directly at a
  building: in `demo_1.json`, `rootNodeIds = ["building_bv4ilcjivnxn8wkd"]` and there is **no site
  node at all**. A loader must handle both.
- Node ids are `<prefix>_<16 chars of [0-9a-z]>` (nanoid custom alphabet), e.g.
  `slab_gr6zxi4915gqwjbn`. Prefix always equals the node type except `roof-segment` → `rseg_`.
- `collections` is **not** persisted (see §11).

### 1.2 CRITICAL: no Zod parsing at load time — defaults are consumer-side

`useScene.setScene(nodes, rootNodeIds)` (`packages/core/src/store/use-scene.ts`) does **not** run
the Zod schemas. It stores the raw JSON objects (after `migrateNodes`, §1.3). Consequently every
optional/defaulted field can be **absent** in saved JSON and each consumer applies its own
fallback (`??`). A faithful port must apply these defaults when a field is missing:

| Node type | Field | Default when absent |
|---|---|---|
| any (BaseNode) | `visible` | `true` |
| any (BaseNode) | `name` | absent (undefined) |
| any (BaseNode) | `parentId` | `null` |
| any (BaseNode) | `camera` | absent |
| any (BaseNode) | `metadata` | `{}` |
| site | `polygon` | `{type:'polygon', points:[[-15,-15],[15,-15],[15,15],[-15,15]]}` (30×30 m square centered at origin) |
| building | `position` | `[0,0,0]` |
| building | `rotation` | `[0,0,0]` |
| building | `children` | `[]` |
| level | `level` | `0` |
| level | `children` | `[]` |
| slab | `holes` | `[]` |
| slab | `elevation` | `0.05` |
| slab | `material` | absent → default slab material (§8.4) |
| ceiling | `holes` | `[]` |
| ceiling | `height` | `2.5` |
| ceiling | `children` | `[]` |
| wall | `thickness` | `0.1` (`DEFAULT_WALL_THICKNESS`) |
| wall | `height` | `2.5` (`DEFAULT_WALL_HEIGHT`) |
| wall | `frontSide`/`backSide` | `'unknown'` |
| zone | `color` | `'#3b82f6'` |
| scan | `position`/`rotation` | `[0,0,0]` |
| scan | `scale` | `1` |
| scan | `opacity` | `100` (range 0–100) |
| guide | `position`/`rotation` | `[0,0,0]` |
| guide | `scale` | `1` |
| guide | `opacity` | `50` (range 0–100) |
| item | `scale` | `[1,1,1]` (backfilled by migration, §1.3) |
| roof | `position` | `[0,0,0]`, `rotation` (number, rad, Y-axis) `0` |

### 1.3 Load-time migrations (`migrateNodes`, use-scene.ts)

Applied on every `setScene`:

1. **Item scale**: `type === 'item' && !('scale' in node)` → add `scale: [1,1,1]`.
2. **Legacy roof**: `type === 'roof' && !('children' in node)` → old parametric roof
   (`{position, rotation, length, height, leftWidth, rightWidth}` — this is the format in
   `demo_1.json`) is converted to a roof group plus one `roof-segment` child:

```js
const segment = {
  object: 'node', id: `rseg_${suffix}`, type: 'roof-segment',
  parentId: id, visible: oldRoof.visible ?? true, metadata: {},
  position: [0, 0, 0], rotation: 0, roofType: 'gable',
  width: oldRoof.length ?? 8,
  depth: (oldRoof.leftWidth ?? 2.2) + (oldRoof.rightWidth ?? 2.2),
  wallHeight: 0, roofHeight: oldRoof.height ?? 2.5,
  wallThickness: 0.1, deckThickness: 0.1, overhang: 0.3, shingleThickness: 0.05,
}
// old roof keeps its position/rotation and gains children:[segmentId]
```

`suffix` is the part after `_` in the old roof id (fallback: random). Note the migration does
**not** preserve the left/right asymmetry of the old roof (4.7/2.7 becomes a symmetric gable of
depth 7.4 centered on the roof position).

### 1.4 Node type inventory

`AnyNode` discriminated union (`packages/core/src/schema/types.ts`): `site`, `building`, `level`,
`wall`, `item`, `zone`, `slab`, `ceiling`, `roof`, `roof-segment`, `scan`, `guide`, `window`,
`door`. (`window`/`door` node types exist but furniture placed in walls in real data are `item`
nodes with `asset.category` `'window'`/`'door'`.)

---

## 2. Coordinate conventions

- three.js Y-up, right-handed. Plan coordinates in node data are `[x, z]` pairs: x → world X,
  second component → world **Z** (not negated in data; the negation described below is an
  internal three.js Shape detail that cancels out).
- **Polygon-to-mesh recipe used identically by site, slab, ceiling, zone floor**
  (`slab-system.tsx`, `ceiling-system.tsx`, `site-renderer.tsx`, `zone-renderer.tsx`):

  ```js
  // Shape built in X-Y plane with the plan Z negated:
  shape.moveTo(p0[0], -p0[1]); shape.lineTo(pi[0], -pi[1]); ... shape.closePath()
  // holes: same negation, pushed as THREE.Path into shape.holes
  geometry.rotateX(-Math.PI / 2)   // then rotate flat
  ```

  Net effect of "negate + rotateX(-π/2)": shape point `(x, -z)` lands at world `(x, 0, z)` —
  i.e. plan coordinates map 1:1 to world X/Z. Extrusion depth maps to +Y.
  In Blender (Z-up): plan `[x, z]` → Blender `(x, -z)` on the XY plane if you use the standard
  `three→blender` axis swap `(x, y, z)_three → (x, -z, y)_blender`.
- Polygon winding is arbitrary in data (the slab outset algorithm computes winding itself;
  three.js triangulates shapes regardless of winding).
- Rotation triples are XYZ Euler radians (three.js default order 'XYZ').

---

## 3. Site

Schema: `packages/core/src/schema/nodes/site.ts`. Renderer:
`packages/viewer/src/components/renderers/site/site-renderer.tsx`.

- `polygon: { type:'polygon', points: [x,z][] }` — property line. Default 30×30 m square.
- `children`: inline **embedded node objects** (buildings/items) *or* id strings — the renderer
  handles both: `typeof child === 'string' ? child : child.id`. (The default scene from
  `loadScene()` embeds the building object inside site.children AND stores it flat; saved scenes
  normally use ids.)
- Rendering (site group is at the world origin, no transform):
  - **Boundary line**: line loop through `points` at `Y = 0.01` (`Y_OFFSET`), closed by
    repeating point 0. Material `lineBasicMaterial {color:'#f59e0b', opacity:0.6, transparent}`,
    renderOrder 9. Purely decorative.
  - **Ground fill**: the polygon as a flat `shapeGeometry` (recipe §2), rotated `[-π/2,0,0]`, at
    `Y = 0.005` (`Y_OFFSET - 0.005`), with `shadowMaterial {opacity:0.75, transparent}` — an
    invisible shadow-catcher, NOT a visible floor.
- For a Blender port: site contributes no solid geometry. Reproduce as a shadow-catcher plane
  and/or an annotation curve; skip otherwise.

---

## 4. Building

Schema: `packages/core/src/schema/nodes/building.ts`.

- Fields: `position: [x,y,z]` (default `[0,0,0]`), `rotation: [x,y,z]` Euler (default
  `[0,0,0]`), `children: levelId[]`.
- **GOTCHA — building transform is currently dead data.** `BuildingRenderer`
  (`building-renderer.tsx`) renders a plain `<group>` with **no** position/rotation applied, and
  no system ever writes to the building Object3D. So buildings always render at the site origin
  regardless of `position`/`rotation` in the JSON. A faithful port should ALSO ignore them (or
  apply them behind a flag, knowing the web viewer does not).

---

## 5. Level and the stacking math

Schema: `packages/core/src/schema/nodes/level.ts`. System:
`packages/viewer/src/systems/level/level-system.tsx` + `level-utils.ts`.

- `level: number` — floor index (0 = ground). Children: wall/zone/slab/ceiling/roof/scan/guide
  ids (items are also present as level children in real data, e.g. demo_1).
- Each level renders as a `<group>`; the **LevelSystem** sets the group's world Y every frame.

### 5.1 `getLevelHeight(levelId)` — exact algorithm (`level-utils.ts`)

```
DEFAULT_LEVEL_HEIGHT = 2.5

maxTop = 0
for child of level.children:
  if child.type == 'ceiling':
      top = child.height ?? 2.5
  else if child.type == 'wall':
      meshY = <wall mesh Y within the level group>   // == slab elevation under that wall, see below
      if meshY < 0: meshY = 0
      top = meshY + (child.height ?? 2.5)
  else: skip
  maxTop = max(maxTop, top)
height = maxTop > 0 ? maxTop : 2.5
```

The wall `meshY` is what the WallSystem set: `mesh.position.set(start.x, slabElevation, start.z)`
where `slabElevation` = **max `elevation` of any slab on the same level whose polygon the wall
overlaps** (excluding wall spans that fall entirely inside slab holes; sampling at
t = 0, .25, .5, .75, 1 along the wall; slabs' `elevation ?? 0.05`; result 0 if no slab overlaps).
Source: `spatial-grid-manager.ts::getSlabElevationForWall`, `wall-system.tsx::updateWallGeometry`.

So for the common case (walls of height 2.5 standing on a 0.05 slab): level height =
0.05 + 2.5 = **2.55**, not 2.5.

### 5.2 Y offset of level N

Sort levels ascending by their `level` index; walk cumulatively:

```
Y(level with sort-position 0) = 0
Y(next) = Y(prev) + getLevelHeight(prev)
```

i.e. `Y_N = Σ getLevelHeight(L_i)` for all levels sorted before N. (Sorting is by the `level`
field, ties in insertion order; indices need not be contiguous.)

- View modes (`useViewer.levelMode`, default `'stacked'`): `exploded` adds
  `index * EXPLODED_GAP` with `EXPLODED_GAP = 5` (uses the *level index field*, not sort
  position); `solo` hides all but the selected level; movement is lerped
  (`lerp(y, target, delta*12)`). For export/port, use the pure stacked positions
  (`snapLevelsToTruePositions()` does exactly that before thumbnail renders).

---

## 6. Slab geometry

Schema: `nodes/slab.ts` — `polygon: [x,z][]` (required), `holes: [x,z][][] = []`,
`elevation = 0.05`, `material?`. System: `packages/core/src/systems/slab/slab-system.tsx`.

Exact algorithm (`generateSlabGeometry`):

1. **Outset the outer polygon** by `SLAB_OUTSET = 0.05` m ("half of default wall thickness — used
   to extend slab geometry under walls"). Holes are **not** outset.
   `outsetPolygon(polygon, amount)`:
   - winding sign `s = sign(Σ x_i·z_j − x_j·z_i)` (shoelace, `j=i+1 mod n`; `s = +1` if ≥ 0);
   - for each edge `i→j` with direction `(dx,dz)`, length `len`: offset the edge start by the
     outward normal `n = (s·dz/len·amount, s·(−dx)/len·amount)`; degenerate edges (len < 1e-9)
     are left unshifted;
   - new vertex `i` = line intersection of offset edge `i` and offset edge `i+1`
     (`t = ((bx−ax)·bdz − (bz−az)·bdx) / (adx·bdz − adz·bdx)`; if |denom| < 1e-9 (parallel), use
     the end of offset edge `i`, i.e. `(ax+adx, az+adz)`);
   - polygons with < 3 points are returned unchanged.
2. Build a THREE.Shape from the outset polygon and the raw holes (recipe §2; holes with < 3
   points skipped).
3. `THREE.ExtrudeGeometry(shape, { depth: elevation ?? 0.05, bevelEnabled: false })` —
   extrudes 0 → elevation.
4. `geometry.rotateX(-π/2); computeVertexNormals()`.

Resulting solid occupies `Y ∈ [0, elevation]` in **level-local** space at the plan footprint
(outset by 0.05); the slab mesh itself has no transform (sits at the level group origin).
`polygon.length < 3` → empty geometry. Mesh casts and receives shadows; single material for all
faces (no face groups).

---

## 7. Ceiling geometry

Schema: `nodes/ceiling.ts` — `polygon`, `holes = []`, `height = 2.5`, `material?`,
`children: itemId[]` (ceiling-mounted items). System:
`packages/core/src/systems/ceiling/ceiling-system.tsx`; renderer
`ceiling-renderer.tsx`.

- Geometry: **flat** `THREE.ShapeGeometry` (no extrusion, zero thickness) from polygon+holes
  (recipe §2), `rotateX(-π/2)`.
- Placement: `mesh.position.y = (height ?? 2.5) − 0.01` — the 0.01 avoids z-fighting with the
  slab of the level above.
- Materials (renderer): resolves `resolveMaterial(node.material)` but uses **only the color**
  (default `#ffffff`). Two MeshBasicNodeMaterials:
  - bottom: `{color, transparent:true, side:BackSide}` — this is what you see from inside the
    room (geometry normal points up, so BackSide = viewed from below);
  - top: `{color, transparent:true, depthWrite:false, side:FrontSide}` with a TSL procedural
    grid opacity (world-space 0.2 m grid: `gridScale=5`, `lineWidth=0.05`, opacity mixes
    0.2→0.6 on lines). The top grid mesh is only made visible by the editor when a
    ceiling-related tool/selection is active; default invisible + scale 0.
- For Blender: a flat polygon (with holes) at `height − 0.01` per level, visible from below,
  colored by `resolveMaterial(material).color`. The unused `DEFAULT_CEILING_MATERIAL`
  (`#f5f5dc`, roughness 0.95) in `lib/materials.ts` is exported but never applied to ceilings.

---

## 8. Materials — full spec

Schema: `packages/core/src/schema/material.ts`. Applied via
`packages/viewer/src/lib/materials.ts::createMaterial`.

### 8.1 Schema

```ts
MaterialSchema = {
  preset?: 'white'|'brick'|'concrete'|'wood'|'glass'|'metal'|'plaster'|'tile'|'marble'|'custom',
  properties?: {           // all fields have Zod defaults, but see resolveMaterial:
    color: string = '#ffffff',
    roughness: number [0,1] = 0.5,
    metalness: number [0,1] = 0,
    opacity: number [0,1] = 1,
    transparent: boolean = false,
    side: 'front'|'back'|'double' = 'front',
  },
  texture?: { url: string, repeat?: [number, number], scale?: number },
}
```

### 8.2 `DEFAULT_MATERIALS` presets (exact values)

| preset | color | roughness | metalness | opacity | transparent | side |
|---|---|---|---|---|---|---|
| white | `#ffffff` | 0.9 | 0 | 1 | false | front |
| brick | `#8b4513` | 0.85 | 0 | 1 | false | front |
| concrete | `#808080` | 0.8 | 0 | 1 | false | front |
| wood | `#deb887` | 0.7 | 0 | 1 | false | front |
| glass | `#87ceeb` | 0.1 | 0.1 | 0.3 | true | double |
| metal | `#c0c0c0` | 0.3 | 0.9 | 1 | false | front |
| plaster | `#f5f5dc` | 0.95 | 0 | 1 | false | front |
| tile | `#d3d3d3` | 0.4 | 0.1 | 1 | false | front |
| marble | `#fafafa` | 0.2 | 0.1 | 1 | false | front |
| custom | `#ffffff` | 0.5 | 0 | 1 | false | front |

### 8.3 `resolveMaterial(material?) → MaterialProperties` (exact logic)

```ts
if (!material)                            return DEFAULT_MATERIALS.white
if (material.preset && preset !== 'custom')
    return { ...DEFAULT_MATERIALS[preset], ...material.properties }  // properties OVERRIDE preset
return { ...DEFAULT_MATERIALS.custom, ...material.properties }       // no preset or preset='custom'
```

Notes: `properties` spread wins field-by-field over the preset. Because saved `properties` (when
present) were written by the editor UI as a **complete** object, partial-override is rare but
legal. The editor's MaterialPicker writes either `{preset}` alone (non-custom) or
`{preset:'custom', properties:{...all six fields}}`.

### 8.4 three.js mapping and per-node-type application

`createMaterial()` builds a cached `THREE.MeshStandardMaterial` with the resolved
color/roughness/metalness/opacity/transparent and `side` mapped
front→`FrontSide`, back→`BackSide`, double→`DoubleSide`. Cache key is the 6-tuple of resolved props.

Fallback materials in `lib/materials.ts` when `node.material` is absent
(all MeshStandardMaterial, metalness 0, FrontSide unless noted):

| Node | default material |
|---|---|
| wall | `#ffffff`, roughness 0.9 |
| slab | `#e5e5e5`, roughness 0.8 |
| door | `#8b4513`, roughness 0.7 |
| window | `#87ceeb`, roughness 0.1, metalness 0.1, opacity 0.3, transparent, DoubleSide |
| ceiling | (see §7 — renderer uses its own basic materials; `#f5f5dc`/0.95 constant unused) |
| roof (no material) | 4-slot multi-material by face group: 0 Wall/Trim `white` r1 DoubleSide; 1 Deck `#e5e5e5` r1; 2 Interior `white` r1 DoubleSide; 3 Shingle `#e5e5e5` r0.9 (`roof-materials.ts`) |

Application style: **one material for the whole mesh** for slab/wall/door/window/ceiling
(no per-face groups). Only roofs use geometry groups (materialIndex 0–3) — and when a roof
segment HAS a custom material, the whole segment gets that single `createMaterial()` instead of
the 4-slot set.

### 8.5 Texture field is dead

`texture` exists in the schema but **no code path ever loads or applies it** — no
`TextureLoader`/`repeat`/`RepeatWrapping` usage for node materials anywhere in core/viewer/editor.
UV handling therefore does not exist. Safe to ignore for the port (or implement as a
forward-compatible extra: `url` as image texture, `repeat` as UV tiling, `scale` uniform tiling).

### 8.6 Runtime wall material override (what walls actually look like)

`packages/viewer/src/systems/wall/wall-cutout.tsx` runs every frame in the viewer and **replaces
each wall mesh's material** with one of two `MeshStandardNodeMaterial`s:

- visible: `{ color: userColor, roughness: 1, metalness: 0 }`
- invisible (cut-away): same color, `transparent`, TSL dot-pattern opacity
  `mix(0, 0.24, dots·yFade)` (0.1 m grid of dots, fading to 0 at 2.5 m height), `depthWrite:false`,
  `emissive: userColor`.

`userColor` = `material.properties.color` → else preset color from a local table (same as
§8.2 colors except tile `#dcdcdc`, marble `#f5f5f5`) → else `#ffffff`. So in the live viewer,
wall roughness/metalness/opacity from `resolveMaterial` are **ignored**; only color survives.
Cut-away choice per wall (`wallMode` `'auto'|'up'|'down'`, default auto): hide interior/interior
walls; in auto, hide exterior-facing walls whose outward side faces the camera (using
`frontSide`/`backSide` fields). For a faithful *data* port use §8.3; for a faithful *look*
match roughness 1.

---

## 9. Zones

Schema: `nodes/zone.ts` — `name` (required), `polygon: [x,z][]`, `color = '#3b82f6'`,
`metadata = {}`. Renderer `zone-renderer.tsx`, hover animation `zone-system.tsx`.

Zones are non-architectural overlays (room labels/areas) on ZONE_LAYER (three.js layer **2**):

- Floor fill: flat shapeGeometry (recipe §2) at `Y = 0.01`, MeshBasicNodeMaterial
  `{color, transparent, depthWrite:false, depthTest:false}`, opacity `0.25 × u`.
- Border walls: for each polygon edge a vertical quad from `Y = 0.01` to `Y = 0.01 + 2.3`
  (`WALL_HEIGHT = 2.3`), UV v 0→1 bottom→top, gradient opacity `0.6 × (1 − v) × u`, DoubleSide,
  `depthWrite:true, depthTest:false`.
- `u` is a uniform animated 0→1 while the zone is hovered (400 ms lerp) — zones are **invisible
  by default**.
- Label pinned at the polygon **geometric centroid** (standard signed-area centroid formula:
  `c = Σ (p_i + p_j)(x_i·z_j − x_j·z_i) / (6·A)`), at Y = 1 (HTML overlay).

Port recommendation: import zones as data only (Blender empty + custom props, or a
non-rendering outline), matching color/name/polygon; they contribute nothing to renders.

---

## 10. Scans and guides

Both live as level children and are positioned inside the level group (so they stack with the
level).

### Scan (`nodes/scan.ts`, `scan-renderer.tsx`)

- Fields: `url` (GLB; `asset://<uuid>` = editor-local IndexedDB blob, or http/blob URL),
  `position=[0,0,0]`, `rotation=[0,0,0]` (full XYZ Euler), `scale=1` (uniform), `opacity=100`
  (0–100).
- Render: `group.position = position; group.rotation = rotation; group.scale = [s,s,s]`; loaded
  GLTF scene inserted as-is (KTX2-capable loader). If `opacity/100 < 1`, every material in the
  GLB gets `transparent=true, opacity=opacity/100, depthWrite=false`. Raycast/bounds disabled.
- Global toggle `useViewer.showScans` (default `true`) drives group visibility.

### Guide (`nodes/guide.ts`, `guide-renderer.tsx`)

- Fields: same as scan except `opacity` default **50**; `url` is an **image**.
- Render: group at `position`, rotation **`[0, rotation[1], 0]`** — only the Y component of the
  stored rotation is used. Inside: a plane rotated `[-π/2,0,0]` (flat on ground),
  `planeGeometry(width, height)` with
  `width = 10 * scale`, `height = (10 / aspect) * scale` where `aspect = imgWidth/imgHeight`
  — i.e. **always 10 m wide at scale 1**, height from the image aspect ratio.
  Material: MeshBasicNodeMaterial `{transparent, colorNode: texture, opacityNode: opacity/100,
  side: DoubleSide, depthWrite:false}`.
- Global toggle `useViewer.showGuides` (default `true`).
- `asset://` URLs are resolvable only inside the original browser profile (IndexedDB
  `asset_data:<uuid>` → object URL). Ported scenes referencing `asset://` cannot fetch the bytes
  without a separate asset export.

---

## 11. Collections

`packages/core/src/schema/collections.ts` + `use-scene.ts` actions:

```ts
type Collection = { id: `collection_${string}`, name: string, color?: string,
                    nodeIds: AnyNodeId[], controlNodeId?: AnyNodeId }
```

- Runtime-only grouping of **items** (UI: a popover on the item panel; `controlNodeId` is typed
  but never written/read anywhere else — dead field).
- Membership is denormalized as `collectionIds: CollectionId[]` on item nodes (only ItemNode has
  the field in its schema).
- **Not persisted**: save payloads are `{nodes, rootNodeIds}` only, and `setScene` resets
  `collections: {}`. So after any save/load cycle the collections map is empty while stale
  `collectionIds` may remain on item nodes (referencing nonexistent collections).
- **Port verdict: not worth carrying.** At most, group items by shared `collectionIds` values
  into Blender Collections opportunistically; names are unrecoverable from saved data.

---

## 12. Per-node `camera` field

`packages/core/src/schema/camera.ts`, on every node via BaseNode:

```ts
camera?: { position: [x,y,z], target: [x,y,z],
           mode: 'perspective'|'orthographic' = 'perspective',
           fov?: number, zoom?: number }
```

- Written by the editor's "capture camera" action (`custom-camera-controls.tsx`): stores
  current controls `position`, `target`, and the active `mode`. **`fov`/`zoom` are never
  written** by that code path (viewer perspective cam is fov 50, ortho zoom 20).
- Used for: fly-to when entering preview mode on a node with a saved camera; "view" action;
  thumbnail generation uses the **site** node's camera (fallback: pos `[8,8,8]` looking at
  origin, fov 60).
- In real data cameras appear on levels, zones, buildings, sites (demo_1 has them on both
  levels and one zone).
- **Port verdict: worth carrying, cheap.** For each node with `camera`, create a Blender camera
  named after the node: location = `position`, aimed at `target` (track-to or computed
  quaternion), `data.type = 'PERSP'` with `lens` from fov 50 (or 'ORTHO' with ortho scale
  derived from zoom 20 if mode is orthographic). Coordinates convert with the same axis swap as
  §2. Caveat: camera coordinates are **world** coordinates captured live — for upper levels they
  already include the stacked level offset, so do not re-add level Y.

---

## 13. The existing export system (and everything the GLB path loses)

Two implementations register `useViewer.exportScene(format)`; formats `'glb'` (default,
GLTFExporter `{binary:true}`), `'stl'` (binary), `'obj'`.

1. **Viewer** `packages/viewer/src/systems/export/export-system.tsx`: clones the whole three.js
   scene (`scene.clone(true)`), removes every object with **layer 1** (`EDITOR_LAYER` — grid,
   tool helpers, polygon editors, cursor spheres) enabled, exports the rest. Filename
   `pascal-export-YYYY-MM-DD.{glb,stl,obj}`.
2. **Editor** `packages/editor/src/components/editor/export-manager.tsx` (mounted after the
   viewer's, so it wins in the editor app): exports the `getObjectByName('scene-renderer')`
   group directly — **no clone and no layer stripping** (editor helpers live outside that group).
   Filename `model_YYYY-MM-DD.{glb,stl,obj}`.

Layers actually used: 0 = scene (`SCENE_LAYER`), 1 = editor-only (`EDITOR_LAYER`),
2 = zones (`ZONE_LAYER` — NOT stripped by either exporter).

### What the GLB path loses (the motivation for a parametric Blender importer)

The export serializes the *current frame's* triangle soup. Concretely lost or corrupted:

- **All parametric semantics**: wall start/end/height/thickness/miter data, slab & ceiling
  polygons/holes/elevation/height, roof segment parameters, site property line, node ids,
  `parentId` hierarchy semantics, `metadata`, `name` on most meshes (only a few objects carry
  three.js names: `scene-renderer`, `collision-mesh`, `ceiling-grid`, zone `floor`/`walls`,
  `merged-roof`, `segments-wrapper`).
- **View-state baked in**: level groups are exported at whatever Y the LevelSystem last lerped
  to — exploded/solo mode (and mid-animation positions) contaminate the geometry; hidden levels
  export as invisible nodes; wall cut-away state is baked (walls hidden by WallCutout export
  with the transparent dot-pattern material, effectively invisible); ceiling grid overlay
  meshes, zone overlay meshes (opacity-0), invisible wall `collision-mesh` duplicates, scan and
  guide visibility toggles — all frozen as-is.
- **Materials**: preset identity is gone (baked to PBR values); walls export with the runtime
  WallCutout material (color only, roughness 1) rather than their schema material; TSL node
  materials (ceiling grid, zone gradients, guide planes, cut-away walls) do not survive
  GLTFExporter faithfully (procedural opacity/color nodes are dropped); `side`/`transparent`
  semantics partially survive; the dead `texture` field was never rendered so never exports.
- **Non-mesh data**: per-node `camera` fields, collections, zone names/colors/polygons
  (exported only as invisible triangles), item `asset` identity (`asset.id`, category, interactive
  controls/effects, surface heights), wall `frontSide`/`backSide`, level indices, site polygon.
- **STL/OBJ** additionally lose the scene hierarchy and all materials/colors (STL) or most
  material fidelity (OBJ, no .mtl written).

A Blender importer should therefore consume the **scene JSON** (`{nodes, rootNodeIds}`), never
the GLB.

---

## 14. Rendering context (for visual parity, optional)

- Renderer: WebGPURenderer, ACES filmic tone mapping, exposure 0.9, dpr ≤ 1.5, PCF shadows.
- Default viewer camera: perspective fov 50 at `[10,10,10]` (canvas prop says `[50,50,50]`);
  ortho variant zoom 20, near −1000.
- Lights (light theme): key directional intensity 4 (`#ffffff`, shadow), fill 0.75, rim 1,
  ambient; dark theme: 0.8 `#e0e5ff` / 0.2 `#8090ff` / 0.3 `#a0b0ff`. Shadow camera is a 50 m
  orthographic box following the camera.
- Background: `#fafafa` light / `#1f2433` dark.
- A `GroundOccluder` builds a 1000×1000 ground plane with the **lowest level's** slab footprints
  boolean-subtracted (polygon-clipping union), so ground-floor slabs "punch through" the ground.

---

## 15. Blender port checklist (this doc's scope)

1. Parse `{nodes, rootNodeIds}`; run the two migrations (§1.3); apply defaults table (§1.2).
2. Build hierarchy Site→Building→Level→children via `children` arrays (fall back to `parentId`
   if a root is a building).
3. Ignore building position/rotation (§4). Place each level at cumulative stacked Y (§5.2)
   using `getLevelHeight` (§5.1) — remember wall meshY = max overlapping slab elevation.
4. Slabs: outset outer polygon by 0.05, extrude 0→elevation up (§6). Ceilings: flat polygon at
   `height − 0.01` (§7). Both support holes.
5. Materials: `resolveMaterial` (§8.3) → Principled BSDF (color/roughness/metalness/opacity,
   `transparent` → blend mode); per-node fallbacks (§8.4); roofs need the 4-slot face-group material mapping.
6. Zones/guides/scans: data-carry (zones), textured ground plane 10 m wide × aspect (guides),
   GLB instance with uniform scale + opacity override (scans); `asset://` URLs need a side-channel.
7. Cameras from `node.camera` (§12), world-space, no extra level offset.
8. Skip collections (§11) and the `texture` material field (§8.5).
