# 02 — Wall Geometry Pipeline

Reimplementation-grade spec of Pascal's wall geometry: 2D footprint + junction mitering,
3D extrusion, door/window CSG cutouts, and face/side semantics. An engineer with only this
document must be able to reproduce the exact vertex positions in Blender Python.

Source files (repo `~/Documents/GitHub/editor`):

- `packages/core/src/systems/wall/wall-footprint.ts` — footprint polygon assembly + defaults
- `packages/core/src/systems/wall/wall-mitering.ts` — junction detection + miter intersections
- `packages/core/src/systems/wall/wall-system.tsx` — extrusion, CSG cutouts, mesh placement
- `packages/core/src/hooks/spatial-grid/spatial-grid-manager.ts` — `getSlabElevationForWall`, `wallOverlapsPolygon`
- `packages/core/src/schema/nodes/wall.ts` — WallNode schema
- `packages/core/src/lib/space-detection.ts` — `frontSide`/`backSide` classification
- `packages/viewer/src/components/renderers/wall/wall-renderer.tsx` — material assignment
- `packages/viewer/src/systems/wall/wall-cutout.tsx` — front/back-driven auto-hide
- `packages/core/src/systems/{door,window}/…-system.tsx` — parametric cutout meshes
- three.js `0.183.x` `ExtrudeGeometry` (winding + UV behavior), `three-bvh-csg 0.0.18`

---

## 1. Coordinate conventions

- **Plan space** is 2D `(x, y)` in meters, **level-local**. Plan `y` maps to **world `z`**
  (three.js is Y-up). A wall is a centerline segment `start:[x,y]` → `end:[x,y]`.
- **Wall-local space** (the final mesh's local frame):
  - local **X** = along the wall, 0 at `start`, `L` at `end` (`L` = centerline length)
  - local **Y** = up, 0 at the wall base, `height` at the top
  - local **Z** = plan-left of the direction vector: `nUnit = (-dy, dx)/L` where
    `(dx, dy) = end - start`. Positive local Z is the **front** side (see §9).
- The wall **mesh transform** in the level group (see §8):
  `position = (start.x, slabElevation, start.y)`, `rotation.y = -atan2(dy, dx)`, no scale.
- All geometry below the mesh transform is authored in wall-local coordinates; the footprint
  polygon is computed in **plan world coordinates first**, then transformed to wall-local.

## 2. Constants (complete list)

| Constant | Value | Where | Meaning |
|---|---|---|---|
| `DEFAULT_WALL_THICKNESS` | `0.1` m | wall-footprint.ts | `wall.thickness ?? 0.1` |
| `DEFAULT_WALL_HEIGHT` | `2.5` m | wall-footprint.ts | `wall.height ?? 2.5` |
| `TOLERANCE` | `0.001` | wall-mitering.ts | endpoint snap grid + T-junction distance |
| degenerate-length epsilon | `1e-9` | mitering + system | wall/vector length below this ⇒ skip |
| parallel-lines epsilon | `1e-9` | wall-mitering.ts | `abs(det) < 1e-9` ⇒ skip miter intersection |
| cutout box depth | `thickness * 2` | wall-system.tsx | CSG box through-cut depth |
| parametric door/window cutout depth | `1.0` m | door/window-system | the source `cutout` box geometry depth |
| BVH `maxLeafSize` | `10` | wall-system.tsx | perf only, no geometric effect |
| slab default elevation | `0.05` m | slab schema / manager | `slab.elevation ?? 0.05` |
| `wallOverlapsPolygon` along-nudge | `min(1e-6, L*0.01)` m | spatial-grid-manager.ts | endpoint containment test |
| `wallOverlapsPolygon` perp-nudge `PERP_STEP` | `1e-4` m | spatial-grid-manager.ts | boundary-wall containment test |
| collinear-edge epsilon | `1e-6` | `segmentsCollinearAndOverlap` | wall-on-slab-edge test |
| miter thickness default (inside `calculateLevelMiters`) | `0.1` | wall-mitering.ts | `getThickness = (w) => w.thickness ?? 0.1` |

**`mergeVertices` is NOT used anywhere in the wall pipeline** (only the roof system uses it,
with tolerance `1e-4`). Wall geometry is raw triangle soup after extrusion/CSG.

Wall miter geometry uses **only walls on the same level** (`level.children` of type `wall`).
Junctions never form across levels.

## 3. WallNode schema (geometry-relevant fields)

```ts
// packages/core/src/schema/nodes/wall.ts
thickness: z.number().optional(),      // meters; default 0.1
height: z.number().optional(),         // meters; default 2.5
start: z.tuple([z.number(), z.number()]),  // [x, y] plan, level-local
end:   z.tuple([z.number(), z.number()]),
frontSide: z.enum(['interior','exterior','unknown']).default('unknown'),
backSide:  z.enum(['interior','exterior','unknown']).default('unknown'),
children: array of item/door/window ids   // openings + wall-mounted items
material: MaterialSchema.optional()
```

---

## 4. Junction detection (`findJunctions`)

### 4.1 Endpoint snapping key

Neighbors are found by **exact-match on a snapped key**, not by distance:

```ts
const TOLERANCE = 0.001
function pointToKey(p, tolerance = TOLERANCE) {
  const snap = 1 / tolerance                       // 1000
  return `${Math.round(p.x * snap)},${Math.round(p.y * snap)}`
}
```

i.e. endpoints are snapped to a **1 mm grid** and compared as strings. Two endpoints 0.9 mm
apart can still land in different grid cells — this is a grid snap, not a radius search.
**Port note:** JS `Math.round` rounds halves toward `+∞` (`Math.round(-0.5) === -0`);
Python's `round()` is banker's rounding — use `math.floor(v + 0.5)` for exact parity.

### 4.2 Algorithm

1. **First pass** — for every wall, insert `{wall, endType:'start'}` under `pointToKey(start)`
   and `{wall, endType:'end'}` under `pointToKey(end)`. The junction's `meetingPoint` is the
   raw (unsnapped) coordinate of the **first** endpoint that created that key.
2. **Second pass (T-junctions)** — for every junction and every wall not already in it,
   if `pointOnWallSegment(meetingPoint, wall)` add `{wall, endType:'passthrough'}`.
3. **Filter** — keep only junctions with `connectedWalls.length >= 2`.

### 4.3 `pointOnWallSegment` (T-junction membership test)

```ts
// point must NOT equal either endpoint (compared via pointToKey)
const t = (v.x*w.x + v.y*w.y) / (L*L)     // parametric projection
if (t < tolerance || t > 1 - tolerance) return false   // tolerance = 0.001 (PARAMETRIC!)
// perpendicular distance from point to the projected point:
return dist < tolerance                                 // 0.001 meters
```

Note the `t` bounds are in **parametric units** (fraction of wall length), so the effective
"not near the endpoint" exclusion zone scales with wall length (1 mm per meter of wall).
The distance check is in absolute meters (1 mm).

---

## 5. Miter computation (`calculateJunctionIntersections`)

Per junction, build a list of `ProcessedWall` entries:

- For a wall with `endType 'start'`: outgoing vector `v = end - start`.
- For `endType 'end'`: outgoing vector `v = start - end` (points **away** from the junction).
- For `passthrough` (T-junction): the wall contributes **two** entries, one for
  `v1 = end - start` and one for `v2 = -v1`, both flagged `isPassthrough = true`.
- Entries with `|v| < 1e-9` are dropped.

For each entry, with `halfT = (wall.thickness ?? 0.1)/2`, `nUnit = (-v.y, v.x)/|v|`
(left normal relative to outgoing direction), build two infinite edge lines through the
offset points at the meeting point:

```ts
pA = meetingPoint + nUnit * halfT       // left edge point
pB = meetingPoint - nUnit * halfT       // right edge point
// line ax + by + c = 0 through p with direction v:
a = -v.y ; b = v.x ; c = -(a*p.x + b*p.y)
angle = atan2(v.y, v.x)
```

`edgeA` = left edge (through `pA`), `edgeB` = right edge (through `pB`).

### 5.1 Angle sort + pairwise intersection

1. Sort all processed entries **ascending by `angle`** (`atan2` range `(-π, π]`;
   plain numeric sort, ties keep JS sort order — unspecified for equal angles).
2. For each adjacent pair around the circle, `wall1 = sorted[i]`, `wall2 = sorted[(i+1)%n]`,
   intersect **wall1's LEFT edge (`edgeA`) with wall2's RIGHT edge (`edgeB`)**:

```ts
det = w1.edgeA.a * w2.edgeB.b - w2.edgeB.a * w1.edgeA.b
if (Math.abs(det) < 1e-9) continue            // parallel ⇒ skip; walls fall back to defaults
p.x = (w1.edgeA.b * w2.edgeB.c - w2.edgeB.b * w1.edgeA.c) / det
p.y = (w2.edgeB.a * w1.edgeA.c - w1.edgeA.a * w2.edgeB.c) / det
```

(This is Cramer's rule for `a1x+b1y+c1=0`, `a2x+b2y+c2=0`.)

3. Assignment (skipped for passthrough entries — their footprint never changes):
   - `wall1` (non-passthrough) gets `intersections[wall1.id].left = p`
   - `wall2` (non-passthrough) gets `intersections[wall2.id].right = p`

So each non-passthrough wall may end up with `left`, `right`, both, or neither.
`left`/`right` are **relative to the wall's outgoing direction at that junction**.

If a junction has fewer than 2 processed entries the map is empty.

### 5.2 Result structure

`calculateLevelMiters(walls)` returns
`{ junctionData: Map<junctionKey, Map<wallId, {left?, right?}>>, junctions }` computed for
**all** junctions of the level (`getThickness = w => w.thickness ?? 0.1`).

### 5.3 Special cases

- **Collinear butt joint** (two walls continuing in a straight line, e.g. `A→P` then `P→B`):
  outgoing vectors are opposite, all edge lines pairwise parallel ⇒ both `det ≈ 0` ⇒ **no
  entries at all** for either wall ⇒ both keep square default end caps that exactly touch.
- **T-junction:** the through-wall passes unchanged (rectangle); the abutting wall miters
  its end against the through-wall's two side edges (the passthrough's two directional
  entries provide those edges in the angle-sorted ring).
- **Same-direction overlapping walls** (angle tie): sort order and hence which edges pair up
  is unspecified; degenerate input.

---

## 6. Footprint polygon (`getWallPlanFootprint`)

Inputs: `wallNode`, `miterData`. Output: plan-world polygon (4–6 points) or `[]`.

```ts
thickness = wall.thickness ?? 0.1 ; halfT = thickness/2
v = end - start ; L = |v| ; if (L < 1e-9) return []
nUnit = (-v.y, v.x)/L                                  // plan-left of start→end

startJunction = junctionData.get(pointToKey(start))?.get(wall.id)   // {left?, right?} | undefined
endJunction   = junctionData.get(pointToKey(end))?.get(wall.id)

pStartLeft  = startJunction?.left  || start + nUnit*halfT
pStartRight = startJunction?.right || start - nUnit*halfT
// IMPORTANT SWAP: at the end junction the outgoing direction was -v, so its
// "left/right" are mirrored relative to the wall's own frame:
pEndLeft    = endJunction?.right   || end + nUnit*halfT
pEndRight   = endJunction?.left    || end - nUnit*halfT

polygon = [pStartRight, pEndRight]
if (endJunction)   polygon.push(end)      // apex: the raw centerline endpoint
polygon.push(pEndLeft, pStartLeft)
if (startJunction) polygon.push(start)    // apex at start
```

Notes:

- The **apex point** (raw centerline endpoint) is inserted whenever the wall has a junction
  entry — even if only one of `left`/`right` was resolved (the other falls back to the
  default square offset). A wall with junctions at both ends yields a 6-gon; one end → 5-gon;
  free-standing → rectangle (4 points, order: startRight, endRight, endLeft, startLeft).
- A junction can exist at the key while this wall has **no** per-wall entry (e.g. collinear
  skip) — then no apex and full defaults.
- Polygon is in plan world (level) coordinates, ordered right-side first (start→end along
  the right/-nUnit side, back along the left side).

---

## 7. Slab elevation and vertical extent

Per wall: `slabElevation = getSlabElevationForWall(levelId, start, end)` where `levelId` is
found by walking `parentId` up to the nearest `level` node (fallback `'default'`).

`getSlabElevationForWall` scans all slabs of the level; a slab counts if
`wallOverlapsPolygon(start, end, slab.polygon)` and (when the slab has holes) at least one of
the wall sample points `t ∈ {0, .25, .5, .75, 1}` is not inside any hole. Result:
**max** overlapping `slab.elevation ?? 0.05`, else `0`.

`wallOverlapsPolygon` (all containment via ray-cast `pointInPolygon`):
1. endpoints nudged **inward along the wall** by `min(1e-6, L*0.01)` and tested;
2. samples at `t ∈ {0.25, 0.5, 0.75}` nudged **perpendicular ±1e-4 m** and tested
   (this is what catches walls lying exactly on a slab boundary edge);
3. midpoint tested;
4. collinear-overlap with any polygon edge: both wall endpoints within the edge's AABB and
   cross products `< 1e-6` (`segmentsCollinearAndOverlap`).

Vertical extent (in `generateExtrudedWall`):

```ts
wallHeight = wall.height ?? 2.5
height = slabElevation > 0 ? wallHeight : wallHeight - slabElevation
```

and the mesh is placed at `position.y = slabElevation` (§8). Consequences:

- **Positive slab elevation** (wall on a raised slab): the whole wall shifts **up** by the
  elevation, full `wallHeight` preserved → top at `slabElevation + wallHeight`.
- **Negative slab elevation**: the wall base drops to `slabElevation` and the wall is
  **stretched downward** (`height = wallHeight - slabElevation` > wallHeight) so the **top
  stays at exactly `wallHeight`**. Yes — below-floor extension happens for negative slabs.
- `slabElevation == 0`: base at 0, height = `wallHeight`.

## 8. Extrusion to 3D (`generateExtrudedWall`)

1. If `L < 1e-9` or footprint has `< 3` points ⇒ return empty geometry.
2. Transform the plan-world footprint to wall-local:

```ts
wallAngle = atan2(v.y, v.x)
cosA = cos(-wallAngle); sinA = sin(-wallAngle)
local.x = dx*cosA - dy*sinA        // dx,dy = worldPt - wallStart
local.z = dx*sinA + dy*cosA        // +z = plan-left (nUnit) direction
```

3. Build a `THREE.Shape` with `shape.x = local.x`, **`shape.y = -local.z`** (the negation
   compensates for the later `rotateX(-π/2)`: shape.y becomes `-geometry.z`).
   `moveTo` first point, `lineTo` the rest, `closePath()`.
4. `ExtrudeGeometry(shape, { depth: height, bevelEnabled: false })` — extrudes along +Z
   from `z=0` to `z=height`. three.js internally **normalizes the contour to CCW**
   (`ShapeUtils.isClockWise` ⇒ reverse), so input winding does not matter; the solid always
   has outward-facing normals. Output is **non-indexed triangle soup** with two material
   groups: group 0 = the two caps, group 1 = side walls (irrelevant in practice — a single
   material is assigned, but three-bvh-csg preserves groups: `Evaluator` defaults
   `attributes = ['position','uv','normal']`, `useGroups = true`).
5. `geometry.rotateX(-Math.PI / 2)` — maps `(x, y, z) → (x, z, -y)`; the extrusion direction
   becomes +Y (up), and `-shape.y` becomes local `z`, i.e. final wall-local coordinates are
   exactly §1: x along wall, y ∈ [0, height], z toward plan-left/front.
6. `geometry.computeVertexNormals()` — flat per-face normals (soup).
7. CSG cutouts (§10), if any; the CSG result also gets `computeVertexNormals()`.

**Mesh placement** (`updateWallGeometry`), applied to the wall mesh inside the level group:

```ts
mesh.position.set(node.start[0], slabElevation, node.start[1])
const angle = Math.atan2(node.end[1] - node.start[1], node.end[0] - node.start[0])
mesh.rotation.y = -angle
```

(Ry(-angle) maps local +X to `(dx, 0, dy)/L` and local +Z to `(-dy, 0, dx)/L` in world.)

A second, invisible child mesh named `collision-mesh` receives the same extruded geometry
built **without cutouts** (`generateExtrudedWall(node, [], miterData, slabElevation)`).

### 8.1 UVs

three.js `WorldUVGenerator` (default), computed in pre-rotation extrusion space, meters,
unnormalized:

- **Caps** (footprint faces): `uv = (shape.x, shape.y)` = `(along-wall x, -local.z)`.
- **Side faces** (the large wall faces + end caps): per quad, if the shape-space edge is
  more horizontal (`|Δy| < |Δx|`) then `uv = (shape.x, 1 - extrusionZ)`, else
  `uv = (shape.y, 1 - extrusionZ)`. Since extrusionZ = height in [0,`height`], `v = 1 - y_up`.
  So the big faces of an axis-aligned-in-local wall get `u = distance along wall (m)`,
  `v = 1 - height (m)`. UVs survive CSG.

---

## 9. front/back sides, materials, visibility

- **Front** = wall-local **+Z** = plan-left of `start→end` = `(-dy, dx)/L`. This is also
  `mesh.getWorldDirection()` (the mesh +Z axis in world). Doors/windows/items carry
  `side: 'front' | 'back'`; `attachTo:'wall-side'` items are offset
  `mesh.position.z = ±thickness/2` (+ for front).
- `frontSide`/`backSide` (`'interior' | 'exterior' | 'unknown'`) are **derived data**, written
  back onto the node by space detection (`packages/core/src/lib/space-detection.ts`): a
  0.5 m occupancy grid (bounds = wall AABB + 2 m padding) is rasterized from all level walls
  (thickness default **0.2** in that module only!), flood-filled from the border to mark
  `exterior`, remaining pockets are `interior`; each wall samples one point per side at
  `midpoint ± perp * (thickness/2 + 0.5)` and classifies by the grid cell
  (wall cells / out of bounds ⇒ `unknown`).
- **They do not affect geometry.** They drive the viewer's auto-hide (`wall-cutout.tsx`):
  in `auto` mode a wall is hidden if both sides are interior, or if its exterior side faces
  the camera (`getWorldDirection(v); v.dot(cameraDir) < 0 ? check frontSide : check backSide`);
  `wallMode 'up'` ⇒ never hidden, `'down'` ⇒ always hidden. Hidden walls swap to a
  transparent dot-pattern material (opacity `mix(0, 0.24, dots)`); visible walls get a
  `MeshStandardMaterial`-style material from `node.material` (preset colors: white `#ffffff`,
  brick `#8b4513`, concrete `#808080`, wood `#deb887`, glass `#87ceeb`, metal `#c0c0c0`,
  plaster `#f5f5dc`, tile `#dcdcdc`, marble `#f5f5f5`), default wall material
  `color #ffffff, roughness 0.9, metalness 0, FrontSide`.
- **One material for the whole wall mesh** — no per-face material assignment anywhere.

---

## 10. Door/window cutouts (`collectCutoutBrushes` + CSG)

### 10.1 Cutout sources

Every opening provides an invisible mesh named **`cutout`** somewhere under the opening's
object, in the wall's child hierarchy (openings are rendered as children of the wall mesh,
so their `position`/`rotation` are **wall-local**):

- **Parametric `door` / `window` nodes**: their system creates
  `cutout.geometry = BoxGeometry(node.width, node.height, 1.0)` centered at the node mesh
  origin (which sits at `node.position` with `node.rotation` inside the wall). Door defaults:
  width 0.9, height 2.1; window defaults: width 1.5, height 1.5. (The 1.0 m depth is
  irrelevant — see below, only the XY extent matters.)
- **GLB `item` nodes** (this is what demo_1 uses): the asset GLB contains a mesh literally
  named `cutout`. Transform chain wall→cutout:
  `group(item.position, item.rotation)` → `clone(asset.offset, asset.rotation,
  scale = asset.scale * item.scale)` → GLB node transform → cutout vertices.

### 10.2 Brush construction — exact algorithm

```ts
// for each child of type item|window|door that has a 'cutout' mesh:
wallMatrixInverse = wallMesh.matrixWorld.invert()
for each vertex of cutout.geometry.position:
    v = vertex.applyMatrix4(cutoutMesh.matrixWorld).applyMatrix4(wallMatrixInverse)
    accumulate minX/maxX (wall-local x), minY/maxY (wall-local y)   // Z IGNORED
width  = maxX - minX ; height = maxY - minY
depth  = wallThickness * 2                        // through-cut with overshoot
boxGeo = BoxGeometry(width, height, depth)
boxGeo.translate(minX + width/2, minY + height/2, 0)   // centered on Z=0 (wall centerline)
```

So the cut is the **axis-aligned bounding rectangle in wall-local XY of the cutout mesh's
vertices**, extruded symmetrically about the wall centerline to `2×thickness` total depth
(spans `z ∈ [-t, +t]`, i.e. `t/2` overshoot past each face of a `t`-thick wall). The
cutout's own Z placement/depth is discarded. There are **no additional epsilons** on the
cut dimensions — the overshoot in Z is the only tolerance.

### 10.3 CSG

Sequential `three-bvh-csg` `SUBTRACTION` with a module-level shared `Evaluator`:

```ts
resultBrush = wallBrush
for (const cutoutBrush of cutoutBrushes)
  resultBrush = csgEvaluator.evaluate(resultBrush, cutoutBrush, SUBTRACTION)
```

Both wall and box geometries get a BVH (`computeBoundsTree({ maxLeafSize: 10 })`) first.
Brushes use identity transforms (`updateMatrixWorld` on defaults) — everything is already
wall-local. Result: non-indexed soup, `computeVertexNormals()` applied, UVs interpolated
by the evaluator. If there are no cutout children, the plain extrusion is returned.

**For a Blender port:** boolean-subtract axis-aligned (in wall-local) boxes
`[minX,maxX]×[minY,maxY]×[-t,+t]` from the extruded wall. Exact triangulation of the CSG
result is library-dependent and need not be reproduced — only the solid.

### 10.4 Worked example (demo_1 door)

`item_0173tdywhm704hah` (`door` GLB) on `wall_ejrf1znv4twbeszy`: item `position [6.5,0,0]`,
rotation 0, `asset.offset [-0.43,0,0]`, `asset.scale [0.8,0.8,0.8]`. The GLB's `cutout` mesh
spans x ∈ [-0.1005, 1.1416], y ∈ [0.0092, 2.5065]. Wall-local rect:
x ∈ 6.5 + (-0.43) + 0.8·[-0.1005, 1.1416] = **[5.9896, 6.9833]**,
y ∈ 0.8·[0.0092, 2.5065] = **[0.0073, 2.0052]**; box depth 0.2, centered z=0.
(Items with `rotation.y = π` mirror the x-extents about the item origin.)

---

## 11. Update pipeline (context)

R3F frame priorities: items (2) → doors/windows (3, each marks its **parent wall dirty**
after rebuilding, so the cutout is re-cut) → walls (4). The wall system groups dirty walls
by level, recomputes `calculateLevelMiters(levelWalls)` **once per level**, rebuilds every
dirty wall, then also rebuilds **adjacent** walls (`getAdjacentWallIds`: any wall sharing a
snapped endpoint key, or whose endpoint lies on the other's segment per
`pointOnWallSegment`, in either direction). If a wall's mesh isn't mounted yet it stays
dirty and is retried next frame. For a batch exporter: compute miters per level once, then
build every wall independently — order does not matter.

---

## 12. Cross-check against `apps/editor/public/demos/demo_1.json`

6 walls, all on `level_pojp0mw3qssu110w` (level 0), **all with `thickness`/`height`
undefined ⇒ 0.1 / 2.5**, and no persisted `frontSide`/`backSide` (⇒ default `unknown`
until space detection runs):

| id | start | end |
|---|---|---|
| `wall_0j28n7nskm2sst7m` | (9, 0) | (13, 0) |
| `wall_3wwt9bjqrdc5w09s` | (13, 0) | (13, 6) |
| `wall_785y11hb3nztn1ua` | (8.5, 0) | (6, 0) |
| `wall_g4h1v4vm9ou0wryc` | (6, 0) | (0, 0) |
| `wall_ejrf1znv4twbeszy` | (1, 13) | (1, 0.5) |
| `wall_9l64ckn6p3yzmfxf` | (-4.5, 4) | (-4.5, -2.5) |

Junctions (keys on the 1 mm grid):

- **`"13000,0"` = (13, 0) — L-corner** (`wall_0j28…` end + `wall_3wwt…` start). Sorted
  outgoing angles: `wall_3wwt` (π/2), `wall_0j28` (π). Verified miter points:
  intersection of 3wwt.left × 0j28.right = **(12.95, 0.05)** and 0j28.left × 3wwt.right =
  **(13.05, −0.05)**. Footprints (5 points each, apex = (13,0)):
  - `wall_0j28…`: (9,−0.05) → (13.05,−0.05) → (13,0) → (12.95,0.05) → (9,0.05)
  - `wall_3wwt…`: direction (0,1) ⇒ `nUnit = (−1, 0)` (left = −x). Apply §6:
    pStartRight = junction right = (13.05,−0.05); no end junction ⇒
    pEndRight = end − nUnit·halfT = (13.05,6), pEndLeft = end + nUnit·halfT = (12.95,6);
    pStartLeft = junction left = (12.95,0.05); apex `start = (13,0)` appended last.
    Final: `[(13.05,−0.05), (13.05,6), (12.95,6), (12.95,0.05), (13,0)]`.
- **`"6000,0"` = (6, 0) — collinear butt joint** (`wall_785…` end + `wall_g4h…` start).
  Outgoing vectors (+x and −x): all edge pairs parallel ⇒ both `det = 0` ⇒ skipped ⇒
  **neither wall gets an entry** ⇒ both are plain rectangles with square caps meeting
  exactly at x = 6 (no apex points).
- **No T-junctions** in this file. Free ends (plain square caps): (9,0), (8.5,0), (0,0),
  (1,13), (1,0.5), (−4.5,4), (−4.5,−2.5). Note (8.5,0)–(9,0) is a deliberate 0.5 m gap
  (opening between `wall_785…` and `wall_0j28…`), not a junction.
- **Slab**: one slab, polygon `[[13,6],[9,6],[9,0],[13,0]]`, elevation 0.05. Walls
  `wall_0j28…` and `wall_3wwt…` lie exactly on its boundary edges — the perpendicular
  ±1e-4 nudge test (§7) makes them overlap ⇒ both meshes at `position.y = 0.05` with full
  height 2.5 (positive elevation ⇒ shifted up, top at 2.55). The other 4 walls: y = 0,
  height 2.5.
- All openings in this file are **GLB `item`s** (doors/windows as items with `cutout`
  meshes; e.g. wall_ejrf has 4 children incl. door + windows), not parametric door/window
  nodes — cutouts follow §10.2 with the item transform chain.

---

## 13. Gotchas for the Blender port

1. **The left/right swap at the end junction** (`pEndLeft = endJunction.right`,
   `pEndRight = endJunction.left`) — miss this and every mitered corner is crossed.
2. **Apex insertion is conditional on the per-wall junction entry existing**, not on the
   junction existing; collinear joints get neither miter points nor apex.
3. **Passthrough walls contribute two directional entries to the sort but never receive
   miter points** — a T-junction changes only the abutting wall.
4. `pointToKey` is a **1 mm grid snap**, not a distance tolerance; replicate JS
   `Math.round` (half toward +∞) exactly.
5. `pointOnWallSegment`'s `t` tolerance is **parametric** (scales with wall length); the
   perpendicular distance tolerance is 1 mm absolute.
6. Negative slab elevation **stretches the wall downward** keeping the top fixed at
   `wall.height`; positive elevation **translates** the wall up keeping full height.
   `height` from the node is never the mesh height when the slab is below 0.
7. Cutout boxes take the **wall-local XY bounding box** of the cutout mesh (Z extent and
   placement discarded) and always cut symmetrically through the centerline with
   `2×thickness` depth.
8. The footprint is computed in **plan world space** then rotated into wall-local; do not
   build it directly in local space or junction miter points (which are world-space) will
   be double-transformed.
9. Mesh transform is `translate(start.x, slabElev, start.y)` ∘ `Ry(-atan2(dy,dx))`; local
   +Z ("front") is plan-**left** of start→end.
10. In three.js the shape winding is auto-normalized to CCW by `ExtrudeGeometry`; in
    Blender just ensure outward normals (`bmesh.ops.recalc_face_normals` or equivalent).
11. `frontSide`/`backSide` are derived, geometry-irrelevant fields (viewer visibility
    only); preserve them on round-trip but do not use them to build meshes. Note the
    space-detection module uses a **different** thickness default (0.2) — that's fine, it
    only affects classification, never geometry.
