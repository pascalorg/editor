# 04 — Parametric Doors, Parametric Windows, and Item Nodes

Reimplementation-grade spec extracted from the Pascal editor monorepo
(`~/Documents/GitHub/monorepo`, commit `dfaec5618`, 2026-04-03).

Source files (paths relative to repo root):

- `packages/core/src/schema/nodes/door.ts` — DoorNode Zod schema
- `packages/core/src/schema/nodes/window.ts` — WindowNode Zod schema
- `packages/core/src/schema/nodes/item.ts` — ItemNode + Asset + Interactive Zod schemas
- `packages/core/src/systems/door/door-system.tsx` — door geometry builder
- `packages/core/src/systems/window/window-system.tsx` — window geometry builder
- `packages/core/src/systems/item/item-system.tsx` — item post-placement adjustments
- `packages/core/src/systems/wall/wall-system.tsx` — wall CSG that consumes cutouts
- `packages/core/src/materials.ts` — shared materials
- `packages/viewer/src/components/renderers/{door,window,item}/…` — render mounting
- `packages/viewer/src/lib/asset-url.ts` — GLB URL resolution
- `packages/viewer/src/systems/item-light/item-light-system.tsx` — light effect runtime
- `packages/editor/src/components/tools/{door,window}/…-math.ts` — wall-local placement math
- `packages/editor/src/components/tools/item/placement-{math,strategies}.ts` — item placement
- `packages/core/src/hooks/spatial-grid/…` — wall/floor/ceiling occupancy grids
- Demo data: `apps/editor/public/demos/demo_1.json`

All dimensions are **meters**, all angles **radians**. Y is up. Three.js
right-handed coordinates.

> **Zod-default rule.** Saved JSON omits fields that equal their schema
> default AND omits optional fields entirely. On load, every node is passed
> through `Schema.parse(json)`, which fills in the defaults listed below.
> A port MUST apply the same defaults when a key is absent.

---

## 1. Shared context: how openings live inside walls

### 1.1 Node tree and coordinate spaces

```
level (group at y = level stack offset)
 └─ wall  (mesh at (start.x, slabElevation, start.y-as-z), rotation.y = -wallAngle)
     ├─ door    (child mesh, wall-LOCAL transform)
     ├─ window  (child mesh, wall-LOCAL transform)
     └─ item    (child group, wall-LOCAL transform — only wall/wall-side items)
```

- A wall is defined by `start: [x, z]`, `end: [x, z]` (2D plan coordinates;
  the second component is world Z), `height` (optional, default **2.5**),
  `thickness` (optional, default **0.1**).
- `wallAngle = atan2(end[1] - start[1], end[0] - start[0])`.
- The wall *mesh* is placed at world `(start[0], slabElevation, start[1])`
  with `rotation.y = -wallAngle`. Consequently **wall-local axes** are:
  - **+X**: along the wall from `start` toward `end` (0 at start).
  - **+Y**: up, 0 at the wall base (= slab top if `slabElevation > 0`).
  - **+Z**: horizontal, perpendicular to the wall. World direction of local
    +Z is `(-sin(wallAngle), 0, cos(wallAngle))` (the "left" normal of the
    start→end direction).
- `side` semantics everywhere: **`'front'` = local +Z half-space, `'back'`
  = local −Z** (`getSideFromNormal`: `normal[2] >= 0 ? 'front' : 'back'`).
- `slabElevation`: highest overlapping slab's `elevation ?? 0.05`, or `0` if
  the wall overlaps no slab (see `getSlabElevationForWall`). Walls with
  negative slab elevation are extended downward
  (`height = slabElevation > 0 ? wallHeight : wallHeight - slabElevation`)
  and the mesh sits at `y = slabElevation`.
- Level world Y offsets: levels are stacked; level *n* sits at the cumulative
  sum of `getLevelHeight` of the levels below (each level height = max top of
  its walls/ceilings, fallback **2.5**).

Doors, windows and wall items are **children of the wall node** in both the
scene graph and the JSON (`parentId = wallId`, and their id appears in
`wall.children`). Their `position`/`rotation` are **wall-local**. World
transform = level offset ∘ wall transform ∘ node local transform.

### 1.2 Wall-local placement math (door/window tools)

`wallLocalToWorld` (door-math.ts / window-math.ts — identical):

```ts
const wallAngle = Math.atan2(end[1]-start[1], end[0]-start[0])
world = [
  start[0] + localX * Math.cos(wallAngle),
  slabElevation + localY + levelYOffset,
  start[1] + localX * Math.sin(wallAngle),
]
```

Placement snapping and clamping:

- Local X is snapped to **0.5 m** increments: `snapToHalf(v) = Math.round(v*2)/2`.
- Doors: `clampedX = clamp(localX, width/2, wallLength - width/2)`;
  `clampedY = height/2` **always** (doors sit on the floor; `position[1]` is
  the door's *center*, so center = height/2).
- Windows: `clampedX` same; `clampedY = clamp(localY, height/2, wallHeight - height/2)`
  with `wallHeight = wall.height ?? 2.5`. Window `position[1]` is the
  window **center** height.
- `position[2]` is always `0` (centered in wall thickness).
- `rotation` is `[0, r, 0]` with `r = 0` when placed from the front
  (`normal[2] > 0`) and `r = π` when placed from the back
  (`calculateItemRotation`). This flips the +Z "feature face" (door handle,
  panel details, window sill) toward the clicked side. `side` is stored as
  `'front'`/`'back'` accordingly.

Overlap validation (`hasWallChildOverlap`) is a 2D AABB test in wall-local
(X, Y) against every existing wall child:

- item child: `left/right = position[0] ∓ w/2`, `bottom = position[1]`,
  `top = position[1] + h` (items store **bottom** Y; `[w,h] =
  getScaledDimensions(item)`),
- window child: center-based, `position[1] ∓ height/2`,
- door child: center-based, `position[1] ∓ height/2`.

### 1.3 The `wallT` field

`ItemNode` declares `wallT: z.number().optional()` ("0-1 parametric position
along wall") but **no current code writes or reads it** (demo JSON contains
none). The parametric t is derived internally when needed:
`t = position[0] / wallLength` (spatial grid) — treat `wallT` as legacy.
Wall-attached positions are canonically stored as wall-local X in
`position[0]`.

### 1.4 The dirty-node system pipeline

Geometry is (re)built imperatively by "systems" running in `useFrame` with
priorities: **ItemSystem (2) → DoorSystem (3) / WindowSystem (3) →
WallSystem (4)**. When a door/window rebuilds, it adds its `parentId` to
`dirtyNodes` so the wall re-runs CSG with the new cutout. React renderers
mount a placeholder mesh (`boxGeometry args={[0,0,0]}`); the system replaces
geometry in place.

### 1.5 Shared materials (`packages/core/src/materials.ts`)

```ts
baseMaterial  = MeshStandardMaterial { color:'#f2f0ed', roughness:0.5, metalness:0 }
glassMaterial = MeshStandardMaterial { name:'glass', color:'lightblue',
                roughness:0.05, metalness:0.1, transparent:true,
                opacity:0.35, side:DoubleSide, depthWrite:false }
```

Every opaque sub-part of doors and windows uses `baseMaterial`; every glazed
part uses `glassMaterial`. **Gotcha:** the schema's optional `material` field
on door/window is applied by the React renderer to the root mesh, but the
system immediately overwrites the root with an invisible hitbox material —
so per-node `material` currently has no visible effect on doors/windows.
(Default renderer materials, for reference only: door `#8b4513` roughness
0.7; window `#87ceeb` roughness 0.1, metalness 0.1, opacity 0.3,
transparent, DoubleSide.)

### 1.6 Wall CSG cutouts

Every door/window (and some item GLBs) carries an invisible child mesh named
**`cutout`**. `WallSystem.collectCutoutBrushes`:

1. transforms all cutout vertices into wall-local space,
2. takes the (X, Y) AABB → `width = maxX-minX`, `height = maxY-minY`,
3. builds a box `width × height × (wallThickness * 2)` centered at
   `(minX + width/2, minY + height/2, 0)` (Z always centered on the wall),
4. CSG-SUBTRACTs it from the extruded wall solid.

So a cutout's Z extent/position is irrelevant — only its wall-local X/Y
bounds matter. Door/window cutouts are always a full
`node.width × node.height × 1.0` box at the node's own transform, i.e. the
hole exactly matches the door/window outer rectangle.

---

## 2. Parametric door

### 2.1 Schema (`DoorNode`) — fields and defaults

| field | type | default | meaning |
|---|---|---|---|
| `id` | `door_<16 chars of [0-9a-z]>` | generated | |
| `type` | `'door'` | `'door'` | |
| `object` | `'node'` | `'node'` | (BaseNode) |
| `name` | string? | – | e.g. `"Door 1"` |
| `parentId` | string \| null | `null` | wall id when placed |
| `visible` | bool | `true` | |
| `metadata` | json | `{}` | `metadata.isTransient` marks drafts |
| `material` | MaterialSchema? | – | currently no visual effect (see §1.5) |
| `position` | [x,y,z] | `[0,0,0]` | wall-local **center**; y = height/2 |
| `rotation` | [x,y,z] | `[0,0,0]` | wall-local Euler; y ∈ {0, π} |
| `side` | `'front'\|'back'`? | – | which wall face it was placed from |
| `wallId` | string? | – | duplicate of parentId |
| `width` | number | **0.9** | outer width |
| `height` | number | **2.1** | outer height |
| `frameThickness` | number | **0.05** | frame member cross-section width |
| `frameDepth` | number | **0.07** | frame depth along Z |
| `threshold` | bool | **true** | bottom threshold bar |
| `thresholdHeight` | number | **0.02** | |
| `hingesSide` | `'left'\|'right'` | **'left'** | left = local −X (toward wall start) |
| `swingDirection` | `'inward'\|'outward'` | **'inward'** | **not used in 3D geometry**; only drawn as the swing arc in the 2D floor plan |
| `segments` | DoorSegment[] | see below | leaf rows, top→bottom |
| `handle` | bool | **true** | |
| `handleHeight` | number | **1.05** | meters above floor |
| `handleSide` | `'left'\|'right'` | **'right'** | |
| `contentPadding` | [x,y] | **[0.04, 0.04]** | leaf border strips |
| `doorCloser` | bool | **false** | |
| `panicBar` | bool | **false** | |
| `panicBarHeight` | number | **1.0** | meters above floor |

`DoorSegment`:

| field | type | default | meaning |
|---|---|---|---|
| `type` | `'panel'\|'glass'\|'empty'` | required | applies to *all* columns of the segment |
| `heightRatio` | number | required | relative row height |
| `columnRatios` | number[] | **[1]** | per-segment column split |
| `dividerThickness` | number | **0.03** | vertical divider width within this segment |
| `panelDepth` | number | **0.01** | raised(+)/recessed(−) — see gotcha below |
| `panelInset` | number | **0.04** | margin of the raised panel detail |

Default `segments` (a classic 2-panel door):

```json
[
  { "type": "panel", "heightRatio": 0.4, "columnRatios": [1],
    "dividerThickness": 0.03, "panelDepth": 0.01, "panelInset": 0.04 },
  { "type": "panel", "heightRatio": 0.6, "columnRatios": [1],
    "dividerThickness": 0.03, "panelDepth": 0.01, "panelInset": 0.04 }
]
```

### 2.2 Geometry build (`updateDoorMesh`)

All geometry is axis-aligned boxes (`THREE.BoxGeometry(w,h,d)` positioned at
a center point) added as children of the root mesh. The **root mesh itself**
becomes an invisible hitbox: `BoxGeometry(width, height, frameDepth)` with a
`visible:false` material, at `node.position`/`node.rotation`. The local
origin is the **door center** (x=0 mid-width, y=0 mid-height, z=0
mid-thickness).

Derived constants:

```
leafW       = width  - 2*frameThickness      // leaf spans full opening width
leafH       = height -   frameThickness      // no bottom frame bar
leafDepth   = 0.04                           // fixed
leafCenterY = -frameThickness / 2            // leaf shifted down by half top bar
```

Sub-parts, in build order (all `baseMaterial` unless noted):

1. **Left frame post** `frameThickness × height × frameDepth` at
   `(-width/2 + frameThickness/2, 0, 0)`.
2. **Right frame post** — mirrored: `(+width/2 - frameThickness/2, 0, 0)`.
3. **Head (top bar)** `width × frameThickness × frameDepth` at
   `(0, height/2 - frameThickness/2, 0)`.
   *(There is deliberately no bottom frame bar.)*
4. **Threshold** (if `threshold`): `leafW × thresholdHeight × frameDepth` at
   `(0, -height/2 + thresholdHeight/2, 0)`.
5. **Leaf border strips** (contentPadding `[cpX, cpY]`), depth `leafDepth`,
   centered on z=0. Only the border is solid — glass areas are truly open:
   - if `cpY > 0`: top strip `leafW × cpY` at
     `(0, leafCenterY + leafH/2 - cpY/2, 0)` and bottom strip at
     `(0, leafCenterY - leafH/2 + cpY/2, 0)`;
   - if `cpX > 0`: with `innerH = leafH - 2*cpY`, left strip `cpX × innerH`
     at `(-leafW/2 + cpX/2, leafCenterY, 0)` and right strip mirrored.
6. **Content area**: `contentW = leafW - 2*cpX`, `contentH = leafH - 2*cpY`.

7. **Segments** — stacked **top to bottom**, first array entry is the top row:

```
totalRatio = Σ seg.heightRatio
contentTop = leafCenterY + contentH/2
segY = contentTop                      // walking cursor
for each seg (in array order):
    segH       = (seg.heightRatio / totalRatio) * contentH
    segCenterY = segY - segH/2

    numCols    = seg.columnRatios.length
    colSum     = Σ seg.columnRatios
    usableW    = contentW - (numCols-1) * seg.dividerThickness
    colWidths[c] = (seg.columnRatios[c] / colSum) * usableW

    // column centers, left (−X) → right (+X):
    cx = -contentW/2
    for c: colX[c] = cx + colWidths[c]/2 ; cx += colWidths[c]
           ; (+= dividerThickness between columns)

    // vertical dividers between columns of THIS segment only
    //   size: dividerThickness × segH × (leafDepth + 0.001)
    //   at   (dividerCenterX, segCenterY, 0)

    // per-column fill:
    if seg.type == 'glass':
        glassDepth = max(0.004, leafDepth * 0.15)      // = 0.006 default
        glass box  colW × segH × glassDepth  at (colX, segCenterY, 0)
        // NO opaque backing — see-through
    elif seg.type == 'panel':
        backing  colW × segH × leafDepth at (colX, segCenterY, 0)
        panelW = colW - 2*seg.panelInset ; panelH = segH - 2*seg.panelInset
        if panelW > 0.01 and panelH > 0.01:
            effectiveDepth = 0.005 if |seg.panelDepth| < 0.002 else |seg.panelDepth|
            panelZ = leafDepth/2 + effectiveDepth/2
            raised panel  panelW × panelH × effectiveDepth at (colX, segCenterY, panelZ)
    else: // 'empty' — flush flat fill
        backing  colW × segH × leafDepth at (colX, segCenterY, 0)

    segY -= segH        // NOTE: no horizontal divider between segments
```

   **Gotchas:** (a) there is no horizontal divider bar between segments —
   rows butt directly; (b) `panelDepth < 0` ("recessed") is rendered
   identically to raised because the code takes `Math.abs(panelDepth)` and
   always places the detail on the **+Z (front) face only**; (c) glass gets
   `glassMaterial`, everything else `baseMaterial`.

8. **Handle** (if `handle`) — front (+Z) face only:

```
handleY = handleHeight - height/2           // floor-based → center-based
faceZ   = leafDepth/2                       // 0.02
handleX = (handleSide=='right') ? leafW/2 - 0.045 : -leafW/2 + 0.045
backplate  0.028 × 0.14 × 0.01   at (handleX, handleY, faceZ + 0.005)
grip lever 0.022 × 0.10 × 0.035  at (handleX, handleY, faceZ + 0.025)
```

9. **Door closer** (if `doorCloser`) — front face, near top of leaf:

```
closerY = leafCenterY + leafH/2 - 0.04
body 0.28 × 0.055 × 0.055 at (0,        closerY,         leafDepth/2 + 0.03)
arm  0.14 × 0.015 × 0.015 at (leafW/4,  closerY + 0.025, leafDepth/2 + 0.015)
```

10. **Panic bar** (if `panicBar`):

```
barY = panicBarHeight - height/2
bar  (leafW * 0.72) × 0.04 × 0.055 at (0, barY, leafDepth/2 + 0.03)
```

11. **Hinges** — always drawn, 3 of them, on the `hingesSide` edge,
    centered in leaf depth (z = 0):

```
hingeX = (hingesSide=='right') ? leafW/2 - 0.012 : -leafW/2 + 0.012
hinge size: 0.024 (w) × 0.1 (h) × (leafDepth + 0.016) (d)
leafBottom = leafCenterY - leafH/2 ; leafTop = leafCenterY + leafH/2
positions: y = leafBottom + 0.25 ;  y = (leafBottom+leafTop)/2 ;  y = leafTop - 0.25
```

12. **Cutout**: invisible child mesh named `cutout` with
    `BoxGeometry(width, height, 1.0)` at the mesh origin (survives rebuilds).

The door leaf is **static** — no open/closed pose is modeled in 3D.
`swingDirection` + `hingesSide` only drive the quarter-circle swing arc in
the 2D floor-plan SVG (`sweepFlag = hingesSide=='left' ? (inward?0:1) :
(inward?1:0)`, hinge point at `center ∓ width/2` on the hinge side, arc end
offset one `width` along the wall normal, sign +1 for inward).

### 2.3 Door placement in the parent wall

Handled by the door tool (§1.2 math):

```
position = [clampedX, height/2, 0]        // wall-local
rotation = [0, (side=='front' ? 0 : π), 0]
parentId = wallId = <wall id>
```

Default door names count doors on the current level: `Door <n+1>`.
The AI `add_door` tool takes parametric `t` (0–1) and computes
`localX = clamp(t * wallLength, width/2, wallLength - width/2)`.

---

## 3. Parametric window

### 3.1 Schema (`WindowNode`) — fields and defaults

| field | type | default | meaning |
|---|---|---|---|
| base fields | | | same as door (id prefix `window_`) |
| `material` | MaterialSchema? | – | no visual effect (see §1.5) |
| `position` | [x,y,z] | `[0,0,0]` | wall-local **center** (y = center height above wall base) |
| `rotation` | [x,y,z] | `[0,0,0]` | y ∈ {0, π} |
| `side` | `'front'\|'back'`? | – | |
| `wallId` | string? | – | |
| `width` | number | **1.5** | outer |
| `height` | number | **1.5** | outer |
| `frameThickness` | number | **0.05** | |
| `frameDepth` | number | **0.07** | |
| `columnRatios` | number[] | **[1]** | pane split L→R (e.g. `[0.6,0.4]`) |
| `rowRatios` | number[] | **[1]** | pane split **top→bottom** |
| `columnDividerThickness` | number | **0.03** | vertical mullion |
| `rowDividerThickness` | number | **0.03** | horizontal mullion |
| `sill` | bool | **true** | |
| `sillDepth` | number | **0.08** | protrusion along +Z |
| `sillThickness` | number | **0.03** | |

### 3.2 Geometry build (`updateWindowMesh`)

Root mesh = invisible hitbox `BoxGeometry(width, height, frameDepth)`;
origin at window center. Derived:

```
innerW = width  - 2*frameThickness
innerH = height - 2*frameThickness
```

1. **Frame** (baseMaterial, all `frameDepth` deep, centered z=0):
   - top bar `width × frameThickness` at `(0, +height/2 - frameThickness/2, 0)`
   - bottom bar mirrored at `(0, -height/2 + frameThickness/2, 0)`
   - left post `frameThickness × innerH` at `(-width/2 + frameThickness/2, 0, 0)`
     — inner height so posts don't overlap the bars at corners
   - right post mirrored.

2. **Pane grid** — ratios normalized by their sum; dividers subtracted from
   the usable area:

```
numCols = len(columnRatios) ; numRows = len(rowRatios)
usableW = innerW - (numCols-1)*columnDividerThickness
usableH = innerH - (numRows-1)*rowDividerThickness
colWidths[c]  = columnRatios[c]/Σcol * usableW
rowHeights[r] = rowRatios[r]/Σrow * usableH

// column centers left→right from x = -innerW/2 (divider gaps between)
// row centers TOP→BOTTOM from y = +innerH/2 (first rowRatio = top row)
```

3. **Column dividers** (between adjacent columns): boxes
   `columnDividerThickness × innerH × frameDepth`, x = right edge of
   column c + half divider, y = 0 — they run the **full inner height**.

4. **Row dividers** (between adjacent rows): one box **per column** so they
   don't overlap the column dividers:
   `colWidths[c] × rowDividerThickness × frameDepth` at
   `(colXCenters[c], divY, 0)` where `divY` = bottom edge of row r − half
   divider (walking top→bottom).

5. **Glass panes** (glassMaterial): for every (c, r) cell, a box
   `colWidths[c] × rowHeights[r] × glassDepth` at
   `(colXCenters[c], rowYCenters[r], 0)`, with
   `glassDepth = max(0.004, frameDepth * 0.08)` (= **0.0056** at default).

6. **Sill** (if `sill`) — front (+Z) face only:

```
sillW = width + sillDepth * 0.4        // slightly wider than frame
sillZ = frameDepth/2 + sillDepth/2
box  sillW × sillThickness × sillDepth at (0, -height/2 - sillThickness/2, sillZ)
```

   Note the sill hangs **below** the window rectangle (outside the cutout).

7. **Cutout**: invisible child `cutout` = `BoxGeometry(width, height, 1.0)`.

### 3.3 Window placement

Same wall-local math as doors, except Y is free:
`position = [clampedX, clampedY, 0]` with
`clampedY = clamp(snappedLocalY, height/2, wallHeight - height/2)`.
The AI `add_window` executor instead centers vertically:
`localY = (wall.height ?? 2.4)/2` (note its 2.4 fallback is inconsistent
with the 2.5 used everywhere else; the `sillHeight` arg in the tool schema
is accepted but ignored).

---

## 4. Item nodes

### 4.1 Schema (`ItemNode`)

| field | type | default | meaning |
|---|---|---|---|
| base fields | | | id prefix `item_` |
| `position` | [x,y,z] | `[0,0,0]` | see attachment semantics §4.4 |
| `rotation` | [x,y,z] | `[0,0,0]` | Euler, parent-space |
| `scale` | [x,y,z] | `[1,1,1]` | user scale (multiplies asset scale) |
| `side` | `'front'\|'back'`? | – | wall side (wall/wall-side items) |
| `children` | itemId[] | `[]` | items resting on this item's surface |
| `wallId` | string? | – | unused legacy (parentId is authoritative) |
| `wallT` | number? | – | **unused legacy** (see §1.3) |
| `collectionIds` | string[]? | – | organizational only |
| `asset` | Asset | required | embedded, denormalized asset descriptor |

`Asset` (embedded in every item node — saved JSON copies the catalog entry):

| field | type | default | meaning |
|---|---|---|---|
| `id` | string | req | catalog id, e.g. `"lounge-chair"` |
| `category` | string | req | e.g. `"furniture"` |
| `name` | string | req | |
| `thumbnail` | string | req | e.g. `/items/<id>/thumbnail.webp` |
| `src` | string | req | GLB URL, e.g. `/items/<id>/model.glb` |
| `dimensions` | [w,h,d] | **[1,1,1]** | logical bounding box, meters (see §4.3) |
| `attachTo` | `'wall'\|'wall-side'\|'ceiling'`? | – | absent ⇒ floor item |
| `tags` | string[]? | – | |
| `offset` | [x,y,z] | **[0,0,0]** | corrective GLB translation |
| `rotation` | [x,y,z] | **[0,0,0]** | corrective GLB rotation (Euler) |
| `scale` | [x,y,z] | **[1,1,1]** | corrective GLB scale |
| `surface` | `{ height: number }`? | – | if set, other items can rest on it at that local height |
| `interactive` | Interactive? | – | controls + effects, see §4.6 |

```ts
export function getScaledDimensions(item) {
  const [w, h, d] = item.asset.dimensions
  const [sx, sy, sz] = item.scale
  return [w*sx, h*sy, d*sz]
}
```

### 4.2 GLB loading, URL resolution, and materials

- URLs (`resolveCdnUrl`, `packages/viewer/src/lib/asset-url.ts`):
  - `http(s)://…` → used as-is;
  - `asset://<id>` → editor-local IndexedDB blob (user imports) — must use
    async `resolveAssetUrl`;
  - anything else (absolute `/items/...` or relative) →
    `ASSETS_CDN_URL + '/' + path`, where
    `ASSETS_CDN_URL = env NEXT_PUBLIC_ASSETS_CDN_URL || 'https://editor.pascal.app'`.
  - Demo JSON uses relative paths like `/items/tree/model.glb`; the files
    also exist locally at `apps/editor/public/items/<id>/model.glb`.
- After load, **all** GLB materials are replaced: a material whose
  `name.toLowerCase() === 'glass'` becomes the shared `glassMaterial`;
  every other material becomes `baseMaterial` (original colors/textures are
  discarded!). Meshes containing glass get `castShadow = receiveShadow = false`.
- Any mesh named **`cutout`** inside the GLB is set `visible = false`. If the
  item is a wall child, the wall CSG picks that mesh up (§1.6) — this is how
  GLB doors/windows (`door`, `door-bar`, `glass-door`, `window-*` assets)
  punch holes in walls.
- While loading, a placeholder box `dimensions[0]×[1]×[2]` is shown at
  `position.y = dimensions[1]/2` (animated scan-line material). On load
  error, a red wireframe box of the same size.

### 4.3 `dimensions` semantics

`asset.dimensions` is the item's **logical footprint** `[width(X),
height(Y), depth(Z)]` in meters, *before* `item.scale`. It is used for:
placement snapping, spatial-grid collision, wall child overlap tests,
surface fit tests, preview/fallback boxes, and the interactive overlay
anchor (`y = height + 0.3`). It is **not** applied to the GLB geometry —
the GLB is scaled only by `asset.scale ⊗ item.scale`. The catalog author is
responsible for making corrective transforms match dimensions.

### 4.4 Transform hierarchy and attachment modes

Rendered structure per item:

```
<group position={node.position} rotation={node.rotation}>   // registered mesh
    <Clone object={gltf.scene}
           position={asset.offset}
           rotation={asset.rotation}
           scale={asset.scale * node.scale} />               // component-wise
    …child item nodes render inside this group…
</group>
```

i.e. `worldTransform = parentWorld ∘ T(node.position) R(node.rotation) ∘
[T(asset.offset) R(asset.rotation) S(asset.scale ⊗ node.scale)]`.
**Note:** `node.scale` does NOT scale `node.position`-space or children; it
only multiplies into the Clone's scale. `asset.offset` is *inside* the
node rotation (rotates with the item).

**Floor items** (`attachTo` absent):
- `parentId = levelId`; `position = [x, 0, z]` in level space, X/Z snapped by
  `snapToGrid` (0.5 m grid with a 0.25 offset when
  `dimension % 1 ≈ 0.5`, so edges land on grid lines):

```ts
function snapToGrid(position, dimension) {
  const halfDim = dimension / 2
  const needsOffset = Math.abs(((halfDim * 2) % 1) - 0.5) < 0.01
  const offset = needsOffset ? 0.25 : 0
  return Math.round((position - offset) * 2) / 2 + offset
}
```

- At runtime `ItemSystem` raises the rendered mesh by the slab under its
  footprint: `mesh.position.y = getSlabElevationForItem(...) + position[1]`
  (highest overlapping slab's `elevation ?? 0.05`, 0 if none; item counts
  as on a slab if its rotated footprint overlaps the slab polygon with
  0.01 margin and its center is not inside a hole). This elevation is
  **not** persisted in the JSON.

**Wall items** (`attachTo: 'wall'` — occupies both wall faces, e.g. GLB
windows/doors) and **wall-side items** (`attachTo: 'wall-side'` — flat
against one face, e.g. electric panel):
- `parentId = wallId`; `position` is **wall-local**:
  `[localX along wall (0.5-snapped, from wall start), bottomY, z]` — note
  `position[1]` is the **bottom** of the item, unlike doors/windows.
- `rotation = [0, side=='front' ? 0 : π, 0]`.
- Vertical auto-fit: if `bottomY < 0` snap to `0.05`; if
  `bottomY + itemHeight > wallHeight` snap to
  `max(0, wallHeight - itemHeight - 0.05)` (AUTO_SNAP_MARGIN = 0.05).
- Occupancy: on the wall grid an item occupies
  `t ∈ [x/L - w/(2L), x/L + w/(2L)]`, `y ∈ [bottom, bottom+h]`; `'wall'`
  items conflict with everything overlapping; `'wall-side'` items conflict
  only with same-side items (or any `'wall'` item); overlap tolerance
  EPSILON = 0.001.
- For `'wall-side'` only, `ItemSystem` pushes the rendered mesh out of the
  wall each frame: `mesh.position.z = (wallThickness/2) * (side=='front' ?
  +1 : -1)` with `wallThickness = wall.thickness ?? 0.1`. (Not persisted;
  `'wall'` items stay at z from `position[2]`, normally 0, embedded in the
  wall.)

**Ceiling items** (`attachTo: 'ceiling'`):
- `parentId = ceilingId`. The ceiling mesh sits at
  `y = (ceiling.height ?? 2.5) - 0.01` within the level.
- `position = [snapX, -itemHeight, snapZ]` in ceiling space, where
  `itemHeight = getScaledDimensions(item)[1]` — i.e. the item hangs with its
  logical top touching the ceiling plane. X/Z use `snapToGrid`.

**Surface placement** (item on item, e.g. lamp on dresser):
- Target must have `asset.surface`; fit check
  `ourDims[0] <= surfDims[0] && ourDims[2] <= surfDims[2]`.
- `parentId = surfaceItemId`;
  `position = [snapX, surface.height * surfaceItem.scale[1], snapZ]` in the
  surface item's local space (snapped via `snapToGrid` on local coords).

### 4.5 Persisted vs runtime state (verified against `demo_1.json`)

Saved item nodes carry: `object, id, type, name, parentId, visible,
metadata, position, rotation, [side], asset{id, category, name, thumbnail,
src, dimensions, [attachTo], offset, rotation, scale, [surface],
[interactive], [tags]}`. Omitted in the demo (so defaults apply):
`scale → [1,1,1]`, `children → []`, `wallT`, `wallId`, `collectionIds`.
Example wall item from the demo:
`window-large`: `position [2, 0.5, 0]` (2 m from wall start, bottom 0.5 m),
`side: "front"`, `rotation [0,0,0]`, `asset.offset [0,1,0]`,
`dimensions [2,2,0.4]`, `attachTo: "wall"`. Example back-side item:
`door-bar`: `rotation [0, π, 0]`, `side: "back"`, `offset [-0.48,0,0]`.

### 4.6 Interactive: controls and effects

```ts
interactive = { controls: Control[] (default []), effects: Effect[] (default []) }
```

**Controls** (discriminated on `kind`) — runtime values live in a separate
store, indexed by array position, initialized as:

| kind | fields (defaults) | initial value |
|---|---|---|
| `toggle` | `label?`, `default?` | `default ?? false` |
| `slider` | `label` (req), `min`, `max`, `step=1`, `unit?`, `displayMode='slider'|'stepper'|'dial'`, `default?` | `default ?? min` |
| `temperature` | `label='Temperature'`, `min=16`, `max=30`, `unit='C'|'F'` ('C'), `default?` | `default ?? min` |

The viewer shows the controls as an HTML overlay anchored at item-local
`(0, dimensions[1] + 0.3, 0)`; controls are interactive only when a zone is
selected and the item's world XZ lies inside the zone polygon.

**`animation` effect**: `{ kind:'animation', clips:{ on?, off?, loop? } }`.
The **first `toggle` control** in `controls[]` drives it: on ⇒ play clip
`clips.on`; off ⇒ `clips.off ?? clips.loop`. If the GLB has animations but
no animation effect, `animations[0]` plays unconditionally. Transitions
fade via `timeScale` lerp (`lerp(current, target, min(delta*5, 1))`), new
clips start at `timeScale = 0.01`.

**`light` effect**:

```ts
{ kind: 'light',
  color: string = '#ffffff',            // CSS color
  intensityRange: [min, max],           // required, e.g. [0, 2]
  distance?: number,                    // three.js PointLight.distance; undefined → 0 (unlimited)
  offset: [x,y,z] = [0,0,0] }           // added to item WORLD position (NOT rotated with the item)
```

Runtime semantics (`ItemLightSystem`): a fixed pool of **12** `PointLight`s
(`castShadow: false`) is shared by all light effects. Every 0.2 s (or when
the camera moves > 0.5 units / rotates > ~5.7°) all registered lights are
scored `angular*0.7 + dist/200*0.3 + levelPenalty` (lower is better;
toggled-off lights score ∞; other-level penalty 0.8, or 100 in solo level
mode, 0.3 for non-ground levels when no level selected) and the best 12 get
lights, with 0.15 hysteresis. Per frame, an assigned light:

- position = item world position + `effect.offset` (component-wise),
- `isOn` = first toggle's value (or `true` if no toggle),
- `t` = first slider's `(value - min)/(max - min)` (or 1 if no slider),
- target intensity = `isOn ? lerp(intensityRange[0], intensityRange[1], t)
  : intensityRange[0]`,
- actual intensity lerps toward target at rate `min(delta,0.1) * 12`;
  `color` and `distance ?? 0` are set on (re)assignment.

Catalog examples: ceiling-lamp `{intensityRange:[0,2], color:'#ffffff',
offset:[0,-0.5,0]}` with controls `[toggle, slider(0..100, '%', dial,
default 100)]`; floor-lamp offset `[0,1.4,0]`; recessed-light offset
`[0,-0.1,0]`.

---

## 5. Porting checklist / gotchas recap

1. Doors: `position[1]` = height/2 (center); items: `position[1]` = bottom;
   windows: `position[1]` = center. Three different conventions on the same
   wall.
2. Door leaf has **no bottom frame bar**; leaf height = `height -
   frameThickness`, center offset `-frameThickness/2`.
3. Door glass segments have no backing (open when seen edge-on);
   glass depth door `max(0.004, 0.006)`, window `max(0.004, frameDepth*0.08)`.
4. `panelDepth` sign is ignored (`abs`), detail only on +Z face; suppressed
   if `|panelDepth| < 0.002` → 0.005, or when panel would be < 0.01 m.
5. `swingDirection` affects only the 2D plan arc, never 3D geometry.
6. Handle/door-closer/panic-bar/sill are on the local **+Z** face; placement
   rotates the node by π when placed from the back so they face the room.
7. Ratios (`heightRatio`, `columnRatios`, `rowRatios`) are normalized by
   their sum — they need not add to 1. First row is at the TOP.
8. Wall cutouts are the axis-aligned wall-local bounds of the child's
   `cutout` mesh, extruded `wallThickness*2`, Z-centered; door/window
   cutouts equal the full `width × height` rectangle. Item GLBs may embed
   their own `cutout` mesh.
9. GLB materials are wholesale replaced (name `glass` → shared glass, else
   shared base `#f2f0ed`).
10. `wallT` and `wallId` on items are dead fields; wall-local X in
    `position[0]` is authoritative, parametric t = `position[0]/wallLength`.
11. Optional-field fallback: apply every default in the tables above when a
    key is missing from saved JSON (Zod `.parse` does this on load).
12. Asset URLs: prepend `https://editor.pascal.app` (or the configured CDN)
    to `/items/...` paths; `asset://` = editor-local blobs.
