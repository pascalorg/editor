# 03 — Roof System (reimplementation-grade spec)

Source of truth (Pascal editor repo, commit state as of 2026-08-02):

- `packages/core/src/systems/roof/roof-system.tsx` — all geometry generation (the only file in that directory)
- `packages/core/src/schema/nodes/roof.ts` — `RoofNode` (container)
- `packages/core/src/schema/nodes/roof-segment.ts` — `RoofSegmentNode` (the geometric unit)
- `packages/core/src/store/use-scene.ts` — legacy-roof migration (`migrateNodes`)
- `packages/viewer/src/components/renderers/roof/roof-renderer.tsx`, `roof-materials.ts` — scene-graph structure + material slots
- `packages/viewer/src/components/renderers/roof-segment/roof-segment-renderer.tsx`
- `packages/editor/src/components/systems/roof/roof-edit-system.tsx` — merged/segment visibility toggling
- `packages/editor/src/components/tools/roof/roof-tool.tsx` — creation-time defaults
- Demo data: `apps/editor/public/demos/demo_1.json` (2 legacy roof nodes, cross-checked in §12)

Everything below is in **three.js coordinates: Y up, right-handed**. Blender port: three (x, y, z) → Blender (x, −z, y); a three.js Y-rotation of `+θ` (counter-clockwise looking down −Y, i.e. from above) maps to a Blender Z-rotation of `+θ`.

---

## 1. Schema and defaults

### 1.1 RoofNode (container)

```
id:        "roof_<16-char nanoid, alphabet 0-9a-z>"
type:      "roof"
material:  MaterialSchema, optional (overrides all 4 slots with one material when set)
position:  [x, y, z]        default [0, 0, 0]   — in parent (level) space
rotation:  number (radians) default 0           — scalar rotation about +Y ONLY
children:  RoofSegmentNode ids, default []
+ BaseNode: object:"node", name?, parentId (default null), visible (default true), metadata (default {})
```

The roof renders as a `<group position rotation-y visible>` containing:
- a mesh named **`merged-roof`** (the visible combined solid, initially `BoxGeometry(0,0,0)`),
- a group named **`segments-wrapper`** (`visible=false` by default) containing one mesh per segment.

`RoofEditSystem` toggles: when the roof or any of its segments is selected, `merged-roof.visible=false`, `segments-wrapper.visible=true` (and vice versa on deselect). **Merging is display-only; segments keep their node identity and transforms at all times.**

### 1.2 RoofSegmentNode

```
id:               "rseg_<nanoid>"
type:             "roof-segment"
material:         optional
position:         [x, y, z]  default [0,0,0]    — in ROOF-GROUP local space
rotation:         number     default 0          — radians about +Y (scalar)
roofType:         enum 'hip'|'gable'|'shed'|'gambrel'|'dutch'|'mansard'|'flat', default 'gable'
width:            default 8      — footprint along local X
depth:            default 6      — footprint along local Z
wallHeight:       default 0.5    — knee-wall height below the eaves
roofHeight:       default 2.5    — ridge rise above the eaves
wallThickness:    default 0.1
deckThickness:    default 0.1
overhang:         default 0.3    — eave overhang, measured ALONG THE SLOPE (see §4)
shingleThickness: default 0.05
```

UI clamps (roof-segment-panel.tsx — not enforced by schema, but the practical domain):
width/depth 0.5–25 (step 0.5); wallHeight 0–5 (0.1); roofHeight 0–15 (0.1); wallThickness 0.05–1 (0.05); deckThickness 0.04–0.3 (0.01); overhang 0–1 (0.05); shingleThickness 0.02–0.3 (0.01); position −50–50 (0.05).

Creation tool (`roof-tool.tsx`): drag a rectangle on a 0.5 m grid; `width = max(|Δx|, 1)`, `depth = max(|Δz|, 1)`, `wallHeight = 0.5`, `roofHeight = 2.5`, `roofType = 'gable'`; new roof group gets `position = [centerX, 0, centerZ]`, segment `position = [0,0,0]`. When dropping onto an existing roof, the segment position is the drop center transformed into the roof's local frame (rotate by `−roof.rotation`, subtract roof position).

### 1.3 Material slots (4-slot scheme — verified)

From `roof-materials.ts` (comment: `Indices: 0 = Wall/Trim, 1 = Deck, 2 = Interior, 3 = Shingle`):

| index | meaning | production material |
|---|---|---|
| 0 | Wall / Trim (gable walls, rake boards, eave soffit) | white, roughness 1, DoubleSide |
| 1 | Deck (fascia/edges of the sloped slabs) | #e5e5e5, roughness 1, FrontSide |
| 2 | Interior (all surfaces cut open by the interior void) | white, roughness 1, DoubleSide |
| 3 | Shingle (upward-facing outer surfaces) | #e5e5e5, roughness 0.9, FrontSide |

Out-of-range/undefined material indices are normalized to 0.

---

## 2. Geometry pipeline overview

Each segment builds **six closed shell volumes** with a shared face-based generator, then combines them by CSG (three-bvh-csg, `useGroups=true`, attributes `['position','normal']`):

| shell | role | material of its faces |
|---|---|---|
| `wallGeo` | outer knee-wall + roof envelope | 0 (all faces) |
| `innerGeo` | interior void (subtracted) | 2 (all faces) |
| `deckTopGeo` | top of the deck slab | 1 (all faces) |
| `deckBotGeo` | bottom of the deck slab (subtracted) | 0 (all faces) |
| `shinTopGeo` | top of the shingle slab | per-face: `faceNormal.y > 0.02 ? 3 : 1` |
| `shinBotGeo` | bottom of the shingle slab (subtracted) | 1 (all faces) |

Per-segment result (`generateRoofSegmentGeometry`):

```
deckSlab   = deckTop  −  deckBot          (CSG SUBTRACTION)
shinSlab   = shinTop  −  shinBot
hollowWall = wall     −  inner
segment    = (shinSlab + deckSlab) + hollowWall   (ADDITIONs, in that order)
```

then face materials are re-tagged by `remapRoofShellFaces` (§8) and `computeVertexNormals()` runs.

CSG material semantics (needed to reproduce colors): in three-bvh-csg with `useGroups=true`, faces of `A − B` that came from `B` (the cut surfaces) keep **B's** material. Hence: interior cavity surfaces are slot 2 (from `innerGeo`), the underside/soffit of the deck slab is slot 0 (from `deckBotGeo`), the underside of the shingle slab is slot 1 (from `shinBotGeo`). Materials are tracked by identity against a fixed 4-element dummy-material array and remapped back to indices 0–3 after each final evaluate (unknown → 0).

If any shell fails to build (empty/unindexed geometry) the segment falls back to `BoxGeometry(width, wallHeight, depth)`. If the CSG combination throws, the fallback is a clone of the raw wall shell.

---

## 3. Common derived quantities (exact)

Let `W = width`, `D = depth`, `WH = wallHeight`, `RH = roofHeight`, `WT = wallThickness`, `DT = deckThickness`, `OV = overhang`, `ST = shingleThickness`.

```
activeRh = (roofType === 'flat') ? 0 : RH

run  = min(W, D) / 2         // default (hip and fallback)
rise = activeRh
if (roofType === 'shed')    run = D
if (roofType === 'gable')   run = D / 2
if (roofType === 'gambrel') { run = D / 4;              rise = activeRh * 0.6 }
if (roofType === 'mansard') { run = min(W,D) * 0.15;    rise = activeRh * 0.7 }
if (roofType === 'dutch')   { run = min(W,D) * 0.25;    rise = activeRh * 0.5 }

tanTheta = run > 0 ? rise / run : 0
cosTheta = cos(atan2(rise, run)) || 1     // "|| 1": if the cos is exactly 0 (run=0), use 1
sinTheta = sin(atan2(rise, run)) || 0

verticalRt = activeRh > 0 ? DT / cosTheta : DT     // deck thickness measured vertically
baseI      = min(W, D) * 0.25                      // dutch structural inset base value
```

θ is the pitch of the *main lower* slope (for gambrel it is the steep lower slope; for mansard the mansard face; for dutch the hip skirt).

---

## 4. The shell generator `getVol(wExt, vOffset, baseY, matIndex, isVoid)`

Every one of the four wall/deck shells is produced by this closure over the segment parameters:

```js
const wV = Math.max(0.01, width + 2 * wExt)
const dV = Math.max(0.01, depth + 2 * wExt)

const autoDrop = wExt * tanTheta
const whV = wallHeight - autoDrop + vOffset

let rhV = activeRh
if (activeRh > 0) {
  rhV = activeRh + autoDrop
  if (roofType === 'shed') rhV = activeRh + 2 * autoDrop
}

const safeBaseY = Math.min(baseY, whV - 0.05)

let structuralI = baseI
if (isVoid) { structuralI += deckThickness }

const faces = getModuleFaces(roofType, wV, dV, whV, rhV, safeBaseY,
                             { dutchI: structuralI }, width, depth, tanTheta)
return createGeometryFromFaces(faces, matIndex)
```

Interpretation:
- `wExt` grows/shrinks the footprint symmetrically on all four sides; `autoDrop = wExt·tanθ` lowers the eave line so that the enlarged volume's roof planes remain **coplanar extensions of the base roof planes** (ridge height invariant `whV + rhV = WH + activeRh` for gable/hip/etc.). For **shed**, `rhV` gains `2·autoDrop` because the eave is only on one side — the far (high, −Z) edge must rise by `autoDrop` while the eave drops by `autoDrop` to keep the single plane's slope over the deeper footprint.
- `safeBaseY` guarantees the shell keeps ≥ 0.05 of vertical wall below the eave (important when `wallHeight = 0`: `whV` may go negative and the base follows it down).
- Note only `dutchI` is passed in `insets` here — the perimeter insets `iF/iB/iL/iR` are 0 for these four shells (straight prism walls from `safeBaseY` up to `whV`). `isVoid` only deepens the dutch-gable structural inset so the vertical dutch face keeps material thickness.

The four calls:

```js
const wallGeo    = getVol(WT / 2,   0,          0,  0, false)
const innerGeo   = getVol(-WT / 2,  0,         -5,  2, false)

const horizontalOverhang = OV * cosTheta        // overhang is along-slope; this is its plan projection
const deckExt = WT / 2 + horizontalOverhang

const deckTopGeo = getVol(deckExt,  verticalRt, 0,  1, false)
const deckBotGeo = getVol(deckExt,  0,         -5,  0, true)
```

So: the nominal footprint `W×D` is the wall centerline; the outer wall shell is `W+WT × D+WT`; the interior void is `W−WT × D−WT` with its base sunk to `y = −5` (so subtraction opens the volume all the way down); the deck slab extends `deckExt = WT/2 + OV·cosθ` beyond the nominal footprint on all sides, and the top deck shell is the bottom one lifted by `vOffset = verticalRt = DT/cosθ` (constant slope-normal deck thickness). **Zero overhang still extends the deck by `WT/2`.**

---

## 5. The shingle shells (built without getVol)

```js
const stSin = ST * sinTheta;  const stCos = ST * cosTheta

const shinBotW  = max(0.01, W + 2*deckExt)          // identical footprint to the deck shells
const shinBotD  = max(0.01, D + 2*deckExt)
const deckDrop  = deckExt * tanTheta
const shinBotWh = WH - deckDrop + verticalRt        // == deckTop's whV  (shingle sits on the deck top)
shinBotRh = activeRh
if (activeRh > 0) { shinBotRh = activeRh + deckDrop
                    if (roofType === 'shed') shinBotRh = activeRh + 2*deckDrop }

// Top shell: offset by shingle thickness NORMAL to the slope
shinTopW = shinBotW;  shinTopD = shinBotD;  transZ = 0
if (roofType in ['hip','mansard','dutch'])   { shinTopW += 2*stSin; shinTopD += 2*stSin }
else if (roofType in ['gable','gambrel'])    { shinTopD += 2*stSin }
else if (roofType === 'shed')                { shinTopD += stSin;  transZ = stSin/2 }
// flat: no change

shinTopWh = shinBotWh + stCos
shinTopRh = shinBotRh
if (activeRh > 0) shinTopRh = shinBotRh + stSin * tanTheta
```

(The `+stSin` footprint growth plus `+stCos` eave raise displaces each sloped plane by exactly `ST` along its normal; growth is applied only on sides that are actually sloped for that type. For shed, only the +Z eave side grows, and the whole top shell is later translated by `geometry.translate(0, 0, transZ = stSin/2)` so the −Z/high edges of top and bottom shells stay aligned.)

Base depths of the two shingle shells (they are *not* prisms — their bottoms are inset so the under-surfaces continue the roof planes downward):

```js
const availableR = (min(shinBotW, shinBotD) / 2) * 0.95
const maxDrop = tanTheta > 0.001 ? availableR / tanTheta : 2.0
const dropTop = min(1.0, maxDrop * 0.4)
const dropBot = min(2.0, maxDrop * 0.8)
const topBaseY = shinBotWh - dropTop
const botBaseY = shinBotWh - dropBot
```

Perimeter insets (per shell) — `getInsets(wh, bY, isVoid, brushW, brushD)`:

```js
let inset = (wh - bY) * tanTheta                       // continues the roof plane down to baseY
const maxSafeInset = min(brushW, brushD)/2 - 0.005
if (inset > maxSafeInset) inset = maxSafeInset

iF=iB=iL=iR=0
if (type in ['hip','mansard','dutch'])  iF=iB=iL=iR=inset   // all four sides sloped
else if (type in ['gable','gambrel'])   { iF=iB=inset }     // only ±Z sides sloped; ±X are vertical rakes
else if (type === 'shed')               { iF=inset }        // only +Z eave side
dutchI = baseI + (isVoid ? shingleThickness : 0)
```

Calls:

```js
insetsBot = getInsets(shinBotWh, botBaseY, true,  shinBotW, shinBotD)
insetsTop = getInsets(shinTopWh, topBaseY, false, shinTopW, shinTopD)
botFaces = getModuleFaces(type, shinBotW, shinBotD, shinBotWh, shinBotRh, botBaseY, insetsBot, W, D, tanTheta)
topFaces = getModuleFaces(type, shinTopW, shinTopD, shinTopWh, shinTopRh, topBaseY, insetsTop, W, D, tanTheta)
shinBotGeo = createGeometryFromFaces(botFaces, 1)
shinTopGeo = createGeometryFromFaces(topFaces, normal => normal.y > 0.02 ? 3 : 1)
if (transZ !== 0) shinTopGeo.translate(0, 0, transZ)
```

`SHINGLE_SURFACE_EPSILON = 0.02` is the `normal.y` threshold for "shingle" faces.

---

## 6. `getModuleFaces(type, w, d, wh, rh, baseY, insets, baseW, baseD, tanTheta)` — every vertex

This returns a list of planar polygon faces (each an ordered vertex loop, **CCW seen from outside**, i.e. outward normals) forming a closed solid. `baseW/baseD` are always the segment's *nominal* `width/depth` (used for type-specific break lines), while `w/d/wh/rh/baseY` are the shell-specific values from §4/§5. `iF/iB/iL/iR` default to 0.

Common base ring (bottom, at `y = baseY`, inset inward) and eave ring (at `y = wh`, full extent):

```
b1 = (-w/2 + iL, baseY,  d/2 - iF)     e1 = (-w/2, wh,  d/2)
b2 = ( w/2 - iR, baseY,  d/2 - iF)     e2 = ( w/2, wh,  d/2)
b3 = ( w/2 - iR, baseY, -d/2 + iB)     e3 = ( w/2, wh, -d/2)
b4 = (-w/2 + iL, baseY, -d/2 + iB)     e4 = (-w/2, wh, -d/2)
```

Always emitted first (5 faces): sides `[b1,b2,e2,e1]` (+Z, "front"), `[b2,b3,e3,e2]` (+X), `[b3,b4,e4,e3]` (−Z), `[b4,b1,e1,e4]` (−X), and bottom `[b4,b3,b2,b1]` (normal −Y). When insets are nonzero the sides lean (bottom ring inset inward, top ring full) — for the shingle shells this makes the side planes coplanar continuations of the roof slopes.

Apex height: `h = wh + max(0.001, rh)`.

Then per type (**note: `flat` OR `rh === 0` short-circuits every type to the flat cap**):

### flat (or rh == 0)
```
top face: [e1, e2, e3, e4]        // flat cap at y = wh; h is unused
```

### gable — ridge along X at z = 0
```
r1 = (-w/2, h, 0);  r2 = (w/2, h, 0)
faces: [e4,e1,r1]        // −X gable triangle
       [e2,e3,r2]        // +X gable triangle
       [e1,e2,r2,r1]     // +Z (front) roof plane
       [e3,e4,r1,r2]     // −Z (back)  roof plane
```

### hip
```
if |w − d| < 0.01:                       // square → pyramid
  r = (0, h, 0)
  faces: [e4,e1,r] [e1,e2,r] [e2,e3,r] [e3,e4,r]
else if w >= d:                          // ridge along X, 45° hips (inset = d/2)
  r1 = (-w/2 + d/2, h, 0);  r2 = (w/2 - d/2, h, 0)
  faces: [e4,e1,r1] [e2,e3,r2] [e1,e2,r2,r1] [e3,e4,r1,r2]
else:                                    // ridge along Z
  r1 = (0, h,  d/2 - w/2);  r2 = (0, h, -d/2 + w/2)
  faces: [e1,e2,r1] [e3,e4,r2] [e2,e3,r2,r1] [e4,e1,r1,r2]
```
Squareness is tested on the **shell** dims `w, d` (all shells extend both axes equally, so it matches the nominal squareness).

### shed — single plane, high edge at z = −d/2, eave at z = +d/2
```
t1 = (-w/2, h, -d/2);  t2 = (w/2, h, -d/2)
faces: [e1,e2,t2,t1]     // the sloped roof plane (from +Z eave up to −Z top)
       [e2,e3,t2]        // +X triangular side
       [e3,e4,t1,t2]     // −Z vertical high wall (from e-ring up to t-ring)
       [e4,e1,t1]        // −X triangular side
```

### gambrel — ridge along X; slope break at fixed z = ±baseD/4
```
mz   = (baseD / 2) * 0.5                 // = baseD/4, from NOMINAL depth
dist = d/2 - mz
mh   = wh + dist * (tanTheta || 0)       // break height: lower slope continued from the shell eave
m1 = (-w/2, mh,  mz);  m2 = (w/2, mh,  mz)
m3 = ( w/2, mh, -mz);  m4 = (-w/2, mh, -mz)
r1 = (-w/2, h, 0);     r2 = (w/2, h, 0)
faces: [e4,e1,m1,r1,m4]  // −X gable pentagon (5-gon!)
       [e2,e3,m3,r2,m2]  // +X gable pentagon
       [e1,e2,m2,m1]     // +Z lower (steep) slope
       [m1,m2,r2,r1]     // +Z upper (shallow) slope
       [e3,e4,m4,m3]     // −Z lower slope
       [m3,m4,r1,r2]     // −Z upper slope
```
`tanTheta` here is the LOWER slope's tan (`rise = 0.6·RH`, `run = D/4`, §3). Upper slope pitch is implied by `h − mh` over `mz`.

### mansard — steep skirt to break ring at inset i, then upper pyramid-frustum to flat top
```
i  = min(baseW, baseD) * 0.15            // from NOMINAL dims, NOT shell dims
mh = wh + i * (tanTheta || 0)
m1 = (-w/2+i,   mh,  d/2-i)    t1 = (-w/2+i*2, h,  d/2-i*2)
m2 = ( w/2-i,   mh,  d/2-i)    t2 = ( w/2-i*2, h,  d/2-i*2)
m3 = ( w/2-i,   mh, -d/2+i)    t3 = ( w/2-i*2, h, -d/2+i*2)
m4 = (-w/2+i,   mh, -d/2+i)    t4 = (-w/2+i*2, h, -d/2+i*2)

if (w - 4i <= 0.01 || d - 4i <= 0.01):   // too small for the flat top → hip ridge fallback
  (exactly the non-square hip construction above, choosing by w >= d)
else:
  faces: [t1,t2,t3,t4]                              // flat top
         [e1,e2,m2,m1] [e2,e3,m3,m2] [e3,e4,m4,m3] [e4,e1,m1,m4]   // 4 steep skirts
         [m1,m2,t2,t1] [m2,m3,t3,t2] [m3,m4,t4,t3] [m4,m1,t1,t4]   // 4 shallow upper slopes
```

### dutch — hip skirt to break ring, then gable with vertical dutch-gable triangles
```
i  = insets.dutchI ?? min(baseW, baseD)*0.25    // in practice always provided:
                                                // baseI (+DT for deck void, +ST for shingle void)
mh = wh + i * (tanTheta || 0)
m1 = (-w/2+i, mh,  d/2-i);  m2 = (w/2-i, mh,  d/2-i)
m3 = ( w/2-i, mh, -d/2+i);  m4 = (-w/2+i, mh, -d/2+i)

if w >= d:                                   // ridge along X
  r1 = (-w/2+i, h, 0);  r2 = (w/2-i, h, 0)
  faces: [e1,e2,m2,m1] [e2,e3,m3,m2] [e3,e4,m4,m3] [e4,e1,m1,m4]   // 4 hip skirts
         [m4,m1,r1]        // −X vertical dutch-gable triangle (plane x = -w/2+i)
         [m2,m3,r2]        // +X vertical dutch-gable triangle
         [m1,m2,r2,r1]     // +Z upper roof plane
         [m3,m4,r1,r2]     // −Z upper roof plane
else:                                        // ridge along Z
  r1 = (0, h,  d/2-i);  r2 = (0, h, -d/2+i)
  faces: [e1,e2,m2,m1] [e2,e3,m3,m2] [e3,e4,m4,m3] [e4,e1,m1,m4]
         [m1,m2,r1]        // +Z vertical dutch-gable triangle
         [m3,m4,r2]        // −Z vertical dutch-gable triangle
         [m2,m3,r2,r1]     // +X upper roof plane
         [m4,m1,r1,r2]     // −X upper roof plane
```
The dutch orientation branch tests the **shell** `w >= d`.

---

## 7. Triangulation, materials-per-face, vertex merge (`createGeometryFromFaces`)

- Each polygon is **fan-triangulated from vertex 0**: triangles `(v0, v_i, v_{i+1})` for `i = 1..n−2`.
- One flat normal per face: `normalize((v1−v0) × (v2−v0))`.
- Material per face:
  - if `matRule` is a number → that index for every face;
  - if a function → `matRule(faceNormal)` (only used for `shinTopGeo`);
  - if null (never used by the roof path) → `|normal.y| < 0.01 ? 0 : 1`.
- One geometry group per input polygon (`start`, `count`, `materialIndex`).
- Finally: `mergeVertices(geometry, 1e-4)` — vertices within tolerance **1e-4** are welded. This happens on **every shell volume before CSG**, not on the CSG outputs.

---

## 8. Per-segment CSG assembly, epsilon inflation, and face re-tagging

### 8.1 Subtractor inflation (`eps = 0.002`)

Each *subtracted* shell is inflated slightly in X/Z (as an object-space scale about the segment origin) so its side walls clear coincident faces:

```js
innerBrush.scale.set(1 + eps/max(0.01, W − WT), 1, 1 + eps/max(0.01, D − WT))
deckBotBrush.scale.set(1 + eps/max(0.01, W + 2·deckExt), 1, 1 + eps/max(0.01, D + 2·deckExt))
shinBotBrush.scale.set(1 + eps/shinBotW, 1, 1 + eps/shinBotD)
```

i.e. an absolute inflation of ≈ eps/2 = 1 mm per side at the nominal extent. Y is never scaled.

### 8.2 Assembly order (per-segment, edit-mode geometry)

```
deckSlab   = deckTop − deckBot
shinSlab   = shinTop − shinBot
hollowWall = wall − inner
combined   = (shinSlab + deckSlab) + hollowWall
```

then group material indices are mapped back to 0–3 by material identity, `remapRoofShellFaces` runs, and `computeVertexNormals()`.

### 8.3 `remapRoofShellFaces` — rake/shingle re-tag (PER-SEGMENT ONLY; the merged mesh never runs this)

Constants: `SHINGLE_SURFACE_EPSILON = 0.02`, `RAKE_FACE_NORMAL_EPSILON = 0.3`, `RAKE_FACE_ALIGNMENT_EPSILON = 0.35`.

For each triangle whose group material is **1 or 3** (0 and 2 are left untouched), compute the geometric normal and centroid, then:

```
if (normal.y > 0.02)                     material = 3   // shingle
else if (isRakeFace(...))                material = 0   // rake/trim
else                                     material = 1   // deck edge/fascia
```

`isRakeFace(node, geometry, centroid, normal)`:

```
rakeAxis: 'x' for gable and gambrel;
          for dutch: width >= depth ? 'x' : 'z';
          null for hip/mansard/shed/flat  → never a rake face.
if |normal.y| > 0.3                      → false        (too sloped)
axisNormal = |normal.x| or |normal.z|    (per rakeAxis)
if axisNormal < 0.35                     → false        (not facing the gable end)
halfExtent = max(|bbox.min[axis]|, |bbox.max[axis]|)    (geometry bounding box, local space)
planeTolerance = max(overhang + wallThickness + deckThickness + shingleThickness, 0.25)
if halfExtent − |centroid[axis]|  > planeTolerance → false   (not near the outer end plane)
else → true
```

Afterwards groups are rebuilt as maximal runs of consecutive equal-material triangles.

---

## 9. Segment placement and the merged roof (`updateMergedRoofGeometry`)

### 9.1 Transforms

A segment's transform inside the roof group is exactly:

```
M = compose(position = node.position, quaternion = AxisAngle(+Y, node.rotation), scale = (1,1,1))
```

For per-segment meshes: `mesh.position.set(...node.position); mesh.rotation.y = node.rotation`. The roof group itself applies `roof.position` and `rotation-y = roof.rotation` in level space. Nothing else — no X/Z rotation, no scale, ever.

### 9.2 Merge algorithm

For each child segment (in `roofNode.children` order):

1. `getRoofSegmentBrushes(child)` → the four bodies `{shinSlab, deckSlab, wallBrush, innerBrush}` (§8.2 pre-stage; note `shinSlab/deckSlab` are already the subtracted slabs, `wallBrush/innerBrush` are the raw shells, with `innerBrush` carrying its epsilon object-scale).
2. `brush.geometry.applyMatrix4(M)` — the segment transform is **baked into the geometry** of each of the 4 bodies.
3. Accumulate per category with CSG `ADDITION` (union): `totalShin`, `totalDeck`, `totalWall`, `totalInner`.

Then:

```
finalShin = totalShin − totalInner
finalDeck = totalDeck − totalInner
finalWall = totalWall − totalInner
merged    = (finalShin + finalDeck) + finalWall
```

Group material indices are mapped back to slots 0–3 by dummy-material identity (unknown → 0); `computeVertexNormals()`; the result replaces `merged-roof`'s geometry. Zero children → geometry reset to `BoxGeometry(0,0,0)`.

Key semantics:

- **Every segment's interior void is subtracted from every other segment's shells** — intersecting segments open into each other (continuous attic), and each segment's wall/deck/shingle that pokes into another segment's interior is removed.
- The union preserves material groups (`useGroups=true`), so slot assignment survives merging; but the rake re-tag of §8.3 is **not** applied to the merged mesh — merged rake faces keep whatever slot the CSG produced (typically 1 on shingle-slab side faces).
- There is **no `mergeVertices` on the merged output** — the only weld is the 1e-4 weld on each source shell (§7).
- Merging never mutates segment nodes; per-segment identity, transforms, and parameters are untouched (display-only combine; edit mode switches back to individual segment meshes).
- Faithful-port footnote: `innerBrush`'s epsilon scale is an *object* transform, so in the merged path it is applied about the **roof-group origin** after the segment transform was baked into vertices (in the per-segment path it acts about the segment origin). The displacement this causes is ≤ `position·eps/W ≈ sub-millimeter`; a port may apply the inflation in local space for all paths.
- Update throttling in the app (irrelevant to a static port): max 3 dirty segments and 1 merged roof rebuilt per frame; merged rebuild is skipped while hidden and re-triggered on edit-mode exit.

---

## 10. Edge cases (exhaustive)

- **`flat` type**: `activeRh = 0` ⇒ `tanTheta = 0`, `cosTheta = 1`, `sinTheta = 0`, `verticalRt = DT`; every shell is a flat-topped prism (§6 flat cap); shingle top shell is the bottom shell raised by `ST` with identical footprint; all insets 0; `dropTop = 0.8`, `dropBot = 1.6` (from the `maxDrop = 2.0` fallback). The whole roof is a flat slab sandwich: shingle (ST) over deck (DT) with an overhang skirt, hollow walls below.
- **`roofHeight = 0` on any type**: identical to flat (the `type === 'flat' || rh === 0` cap short-circuits all apex constructions; `activeRh = 0` kills all slope math).
- **`0 < rh < 0.001`**: apex sits at `wh + 0.001` (the `max(0.001, rh)` floor).
- **`wallHeight = 0`** (the migration default!): `whV = −wExt·tanθ + vOffset` goes negative for outward-extended shells; `safeBaseY = min(baseY, whV − 0.05)` drags the base below y=0 accordingly (wall shell base at `whV − 0.05`). The eaves of the deck/shingle sandwich then hang below y=0 — expected; the ridge stays at `activeRh + verticalRt (+ ST/cosθ for the shingle top)`.
- **Zero overhang**: `deckExt = WT/2` — deck/shingle still extend half a wall thickness beyond the nominal footprint.
- **Square hip** (`|w−d| < 0.01` at shell dims): pyramid with a single apex.
- **Mansard too small** (`w − 4i ≤ 0.01` or `d − 4i ≤ 0.01`, `i = 0.15·min(baseW, baseD)`): falls back to the non-square hip ridge construction.
- **Inset clamp**: shingle-shell perimeter insets are capped at `min(w,d)/2 − 0.005` so bottom rings can't cross.
- **Footprint floor**: every shell's `w`/`d` is floored at 0.01.
- **`cosTheta || 1` / `sinTheta || 0`**: only fires if `run = 0` (impossible for positive footprints) — a port can treat these as pure guards.
- **Degenerate/empty shells**: a shell with no vertices or no index aborts brush creation → box fallback (§2).

---

## 11. Legacy-roof migration (exact, quoted)

`packages/core/src/store/use-scene.ts`, applied in `setScene` before load. Old roofs are `type:'roof'` nodes **without a `children` field**, carrying `length`, `height`, `leftWidth`, `rightWidth`:

```js
// 2. Old roof to new roof + segment migration
if (node.type === 'roof' && !('children' in node)) {
  const oldRoof = node
  const suffix = id.includes('_') ? id.split('_')[1] : Math.random().toString(36).slice(2)
  const segmentId = `rseg_${suffix}`

  const segment = {
    object: 'node',
    id: segmentId,
    type: 'roof-segment',
    parentId: id,
    visible: oldRoof.visible ?? true,
    metadata: {},
    position: [0, 0, 0],
    rotation: 0,
    roofType: 'gable',
    width: oldRoof.length ?? 8,
    depth: (oldRoof.leftWidth ?? 2.2) + (oldRoof.rightWidth ?? 2.2),
    wallHeight: 0,
    roofHeight: oldRoof.height ?? 2.5,
    wallThickness: 0.1,
    deckThickness: 0.1,
    overhang: 0.3,
    shingleThickness: 0.05,
  }

  patchedNodes[segmentId] = segment
  patchedNodes[id] = { ...oldRoof, children: [segmentId] }
}
```

Confirmed constants: synthetic **gable**, `width = length ?? 8`, `depth = (leftWidth ?? 2.2) + (rightWidth ?? 2.2)`, `roofHeight = height ?? 2.5`, `wallHeight = 0`, `overhang = 0.3`, `wallThickness = 0.1`, `deckThickness = 0.1`, `shingleThickness = 0.05`, segment at local origin with rotation 0. The roof node keeps its own `position`/`rotation` (and stray legacy fields, which are simply ignored). Note the migrated shape is symmetric even when `leftWidth ≠ rightWidth` — the old asymmetric ridge offset is deliberately dropped; only the total depth is preserved.

---

## 12. Cross-check against `demo_1.json`

The two legacy roofs (verbatim key fields):

| node | position | rotation | length | height | leftWidth | rightWidth |
|---|---|---|---|---|---|---|
| `roof_jxd8tc6rcuaujl25` "Roof 1" (parent `level_bbyvfs9qwzh4arjf`, level 1) | [10.25, 0, 3.5] | 0 | 5.5 | 1.6 | 4.7 | 2.7 |
| `roof_ui8zhim41alg6lq4` "Roof 2" (parent `level_pojp0mw3qssu110w`, level 0) | [1, 0, −5.5] | 0 | 0.5 | 1.5 | 12.1 | 1.0 |

Migrated segments: Roof 1 → gable, `width 5.5, depth 7.4, wallHeight 0, roofHeight 1.6`, defaults elsewhere. Roof 2 → gable, `width 0.5, depth 13.1, wallHeight 0, roofHeight 1.5` (a very narrow, long gable — ridge length 0.5 along X, slope along the 13.1 depth; valid, just extreme).

### Numeric test vectors (computed by executing the §3–§5 formulas; use to validate a port to ~1e-6)

**Roof 1 segment** (gable, W=5.5, D=7.4, WH=0, RH=1.6, WT=0.1, DT=0.1, OV=0.3, ST=0.05):

```
run=3.7 rise=1.6  tanθ=0.432432  cosθ=0.917857  sinθ=0.396911
verticalRt=0.108949  deckExt=0.325357  baseI=1.375
wall:    w=5.6      d=7.5      wh=-0.021622  rh=1.621622  baseY=-0.071622
inner:   w=5.4      d=7.3      wh= 0.021622  rh=1.578378  baseY=-5
deckTop: w=6.150714 d=8.050714 wh=-0.031746  rh=1.740695  baseY=-0.081746
deckBot: w=6.150714 d=8.050714 wh=-0.140695  rh=1.740695  baseY=-5
shinBot: w=6.150714 d=8.050714 wh=-0.031746  rh=1.740695  baseY=-2.031746  iF=iB=0.864865
shinTop: w=6.150714 d=8.090405 wh= 0.014147  rh=1.749277  baseY=-1.031746  iF=iB=0.452278
ridge checks: deckTop wh+rh = 1.708949 = RH+DT/cosθ ✓
              shinTop wh+rh = 1.763424 = RH+(DT+ST)/cosθ ✓
```

**Roof 2 segment** (gable, W=0.5, D=13.1, WH=0, RH=1.5, rest defaults):

```
run=6.55 rise=1.5  tanθ=0.229008  cosθ=0.974766  sinθ=0.223229
verticalRt=0.102589  deckExt=0.342430
wall:    w=0.6      d=13.2      wh=-0.011450  rh=1.511450  baseY=-0.061450
inner:   w=0.4      d=13.0      wh= 0.011450  rh=1.488550  baseY=-5
deckTop: w=1.184860 d=13.784860 wh= 0.024170  rh=1.578419  baseY=-0.025830
deckBot: w=1.184860 d=13.784860 wh=-0.078419  rh=1.578419  baseY=-5
shinBot: w=1.184860 d=13.784860 wh= 0.024170  rh=1.578419  baseY=-1.941907  iF=iB=0.450247
shinTop: w=1.184860 d=13.807183 wh= 0.072908  rh=1.580975  baseY=-0.958869  iF=iB=0.236285
(here dropTop=0.983039, dropBot=1.966077 — clamped by maxDrop=2.457596, availableR=0.562808)
```

**Default gable segment** (all schema defaults: W=8, D=6, WH=0.5, RH=2.5, WT=0.1, DT=0.1, OV=0.3, ST=0.05):

```
run=3 rise=2.5  tanθ=0.833333  cosθ=0.768221  sinθ=0.640184
verticalRt=0.130171  deckExt=0.280466  baseI=1.5
wall:    w=8.1      d=6.1      wh=0.458333  rh=2.541667  baseY=0
inner:   w=7.9      d=5.9      wh=0.541667  rh=2.458333  baseY=-5
deckTop: w=8.560933 d=6.560933 wh=0.396449  rh=2.733722  baseY=0
deckBot: w=8.560933 d=6.560933 wh=0.266278  rh=2.733722  baseY=-5
shinBot: w=8.560933 d=6.560933 wh=0.396449  rh=2.733722  baseY=-1.603551  iF=iB=1.666667
shinTop: w=8.560933 d=6.624951 wh=0.434860  rh=2.760396  baseY=-0.603551  iF=iB=0.865343
ridge checks: deckTop wh+rh = 3.130171 = WH+RH+DT/cosθ ✓
              shinTop wh+rh = 3.195256 = WH+RH+(DT+ST)/cosθ ✓
```

---

## 13. Port checklist / gotchas

1. `overhang` is measured **along the slope**; plan-projected as `OV·cosθ`, and the deck always adds `WT/2` on top of it.
2. The pitch θ is per-type (§3) — gambrel/mansard/dutch scale `rise` by 0.6/0.7/0.5 and use their own runs. `θ` describes the **lower/steep** plane for the multi-pitch types.
3. Ridge invariant: eave drop `autoDrop = wExt·tanθ` keeps extended shells' roof planes coplanar; **shed doubles** the `rhV` correction.
4. Break lines use **nominal** dims: gambrel `mz = baseD/4`, mansard `i = 0.15·min(baseW,baseD)`; dutch uses `dutchI` = `0.25·min(W,D)` **plus DT for the deck void and plus ST for the shingle void** — forgetting the void offsets makes the vertical dutch-gable faces zero-thickness.
5. Shingle top shell footprint grows by `ST·sinθ` only on sloped sides (both/one/none per type) and shed shifts the top shell by `stSin/2` in +Z.
6. Face material rules are exactly: wall=0, inner=2, deckTop=1, deckBot=0, shinBot=1, shinTop=(normal.y>0.02?3:1); subtraction cut-faces inherit the **subtractor's** slot (that is how soffits become 0 and interiors 2).
7. Rake re-tag (§8.3) applies **only** to individual segment meshes, never to the merged roof.
8. `mergeVertices` tolerance 1e-4 per shell, pre-CSG only; subtractors are inflated by `eps = 0.002` in X/Z only.
9. All rotations are scalar Y (three.js) — Z-up yaw in Blender.
10. Merged roofs subtract the union of ALL interior voids from the union of each shell category (§9.2) — do not merge per-segment finished solids.
