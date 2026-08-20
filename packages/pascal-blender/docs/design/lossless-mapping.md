# Lossless Mapping — Pascal Scene JSON → Blender 4.5 Project

**Status:** approved design, implementation-ready.
**Target:** Blender **4.5 LTS** (all Blender behavior claims verified against 4.5.3; see spec 06/07).
**Inputs:** Pascal scene JSON `{nodes, rootNodeIds[, collections]}` as produced by the Pascal editor
(reference repo `~/Documents/GitHub/monorepo`, cross-checked against `~/Documents/GitHub/editor`).
**Companion specs** (normative; this doc does not restate their details):

| Spec | Contents |
|---|---|
| `docs/spec/01-schema-census.md` | full field census, defaults, migrations, demo census |
| `docs/spec/04-openings-and-items.md` | parametric door/window geometry, items, GLB pipeline, lights |
| `docs/spec/05-scene-materials-levels.md` | level stacking, slab/ceiling, materials, zones/scans/guides, cameras |
| `docs/spec/06-blender-data-model.md` | ID properties, Text datablocks, naming, collections, axes/units |
| `docs/spec/07-blender-geometry-strategy.md` | mesh building, booleans, parametrics, materials, GLB, packaging |

Fixture: `apps/editor/public/demos/demo_1.json` (65 nodes: 1 building, 2 levels, 1 slab,
2 legacy roofs, 2 zones, 50 items, 6 walls, 1 guide; no site/door/window/ceiling/scan nodes).

---

## 1. Goals & non-goals

### 1.1 "No information loss" — precise definition

The import is lossless iff all three hold:

**(a) Recoverability.** Every byte of semantic content of the source JSON is recoverable from the
`.blend` alone — every node, every field (including unknown/extra keys, dead fields like
`wallT`/`texture`, legacy roof fields kept by migration, orphan nodes with dangling parents, and
`metadata` verbatim), plus `rootNodeIds` order and any top-level keys we do not recognize
(e.g. an optional `collections`). Formally: an exporter running on the freshly imported `.blend`
with zero user edits must produce JSON **deep-equal** to the input (same key/value trees; we do
not promise byte-equal formatting — key order and float formatting may differ, which the editor
itself does not preserve either).

**(b) Visual fidelity.** The rebuilt scene matches the editor's own render: same level stacking Y
math (2.55-not-2.5 gotcha), same wall/slab/ceiling/roof geometry, same opening cutouts, same
resolved material values (including per-type fallbacks and preset+override precedence), same item
placement math (three different vertical anchors on the same wall), same migrations applied to
legacy files (with their odd fallback constants).

**(c) Editability.** The `.blend` is a pleasant, idiomatic Blender project: meters + Z-up baked
into data (no compensating root rotation), Site→Building→Level as nested collections,
human-readable object names, shared/deduplicated materials, openings movable as objects, assets
instanced not duplicated, parametrics editable via custom props + a Regenerate operator.

(a) is satisfied by the **data layer** (§2); (b) and (c) by the **native rebuild** (§3–§6).
When (b)/(c) forces an approximation (e.g. zones are invisible-by-default overlays), (a) still
holds because the data layer is independent of the rebuild.

### 1.2 Non-goals

- **No live sync** with the editor; import is a batch operation, export (§7) is a batch operation.
- **No re-implementation of editor UX** (tools, snapping, space detection, hover animations,
  the 12-light pool heuristic — we place real lights instead).
- **No Geometry Nodes parametrics in v1** (§4.9 rationale; optional later milestone for
  doors/windows only).
- **No LLM/Kimi integration** (explicitly out of scope per project owner).
- **No recovery of `asset://` blobs** — those bytes live only in the authoring browser's
  IndexedDB. We preserve the URL and import a placeholder (§6.6).
- **Not a general glTF pipeline**: the editor's GLB export is explicitly *not* an input
  (spec 05 §13 lists everything it loses); we consume scene JSON only. GLB is used solely as a
  visual-parity oracle in tests (§9).

---

## 2. Losslessness strategy — two layers

### 2.1 Layer A: native rebuild

Geometry, hierarchy, transforms, materials, cameras and lights are first-class Blender data,
built per §3–§6. This layer is allowed to normalize (apply defaults, run migrations, bake axis
conversion) because it is *not* the recovery source.

### 2.2 Layer B: full-fidelity data layer (the recovery source)

Three redundant tiers, cheapest-to-read first:

1. **Scene snapshot** — the complete original file, **pretty-printed** (`indent=2`), stored
   verbatim in a Text datablock `pascal_source.json`.
   *Why Text datablock (decision):* byte-exact round-trip verified at 10 MB including unicode and
   CRLF; visible/debuggable in the Text Editor; `use_fake_user` defaults to True so it survives
   with zero users; and the one perf trap (quadratic single-line writes: 13 s for 1 MB minified)
   is avoided by always pretty-printing (4 ms). *Alternative considered:* a Scene string custom
   property — equally exact and faster for minified payloads, but unreadable in the UI; we keep it
   only for the metadata block below, not the payload.
   Scene custom props alongside it:
   `pascal_schema_version` (importer format version, string), `pascal_source_hash`
   (sha256 of original bytes), `pascal_source_text` (= "pascal_source.json"),
   `pascal_import_time` (ISO string — never a 64-bit int; ID-prop ints are 32-bit),
   `pascal_root_node_ids` (list of strings), `pascal_extra_toplevel_json` (JSON string of any
   top-level keys other than `nodes`/`rootNodeIds` — e.g. `collections` — preserved verbatim).

2. **Per-node verbatim record** — every node, **including orphans and unknown types**, has
   exactly one *anchor datablock* (§3.4) carrying:

   | Prop | Type | Content |
   |---|---|---|
   | `pascal_id` | string | node id (identity — **never** encoded in datablock names; names truncate at 63 bytes and get `.001` suffixes) |
   | `pascal_type` | string | node `type` |
   | `pascal_json` | string | the node's original JSON object, verbatim (`json.dumps` of the raw pre-migration dict, `ensure_ascii=False`) |
   | `pascal_params` | dict idprop | human-readable mirror of type-specific fields **with defaults applied** (the values geometry was built from) — for the N-panel and Regenerate |
   | `pascal_migrated` | bool (only when true) | node was rewritten by a load-time migration (§8.5) |

   `pascal_json` is a **string**, not a dict idprop, deliberately: ID properties cannot hold
   heterogeneous arrays, promote `[1, 2.5]` to floats, overflow at 2³¹, and cap key names at 63
   chars (spec 06 §1.4) — a string prop has none of those hazards. `pascal_params` is the
   convenience mirror and *may* silently coerce; `pascal_json` is authoritative per node.
   Mirroring follows the bundled glTF importer's `extras` precedent; all our keys use the
   reserved `pascal_` prefix so the exporter can blacklist user props.

3. **Field-level UI metadata** — scalar params that users should edit get
   `id_properties_ui` metadata (min/max/`subtype='DISTANCE'`/description); verified to persist.

**Recovery order for the exporter:** per-node `pascal_json` overlays (tier 2) are primary — they
survive user deletion of the Text block and follow objects through appends/duplications; the Text
snapshot (tier 1) supplies `rootNodeIds` order, top-level extras, and is the integrity fallback
(hash-checked). If both are gone the scene is no longer lossless and the exporter reports it.

### 2.3 Field disposition tables

Dispositions: **G** drives geometry · **M** drives material · **T** drives transform ·
**H** drives hierarchy · **D** metadata-only (data layer only). Every field is *additionally*
in `pascal_json` + the Text snapshot — the "Blender home" column lists the *native* home.

**BaseNode (all 14 types)**

| Field | Disp | Blender home |
|---|---|---|
| `object` ("node") | D | `pascal_json` only |
| `id` | H | `pascal_id` prop on anchor (and its Mesh/Collection) |
| `type` | G/H | `pascal_type` prop; selects builder |
| `name` | D | datablock display name (best-effort, §3.5); verbatim in `pascal_json` |
| `parentId` | H | Blender parenting / collection membership (children[] is authoritative; disagreements preserved in `pascal_json`) |
| `visible` | G | `object.hide_viewport` + `hide_render` (or `LayerCollection.exclude` for containers) |
| `camera` | D→object | separate Camera object in `Cameras` collection, `pascal_camera_of=<id>` (§3.8) |
| `metadata` | D | `pascal_json` only (free-form JSON; may contain leaked `isTransient`/`isNew` — preserved verbatim, never interpreted) |

**site** — anchor: Collection (+ 2 helper objects)

| Field | Disp | Blender home |
|---|---|---|
| `polygon.points` | G | boundary Curve object (poly spline, closed) + shadow-catcher plane mesh; params mirror |
| `children` (embedded objects or ids!) | H | child Building collections; **embedded full node objects are hoisted into per-node records** and a `pascal_site_children_embedded=true` flag preserves the original form for re-export |

**building** — anchor: Collection

| Field | Disp | Blender home |
|---|---|---|
| `children` | H | child Level collections |
| `position`, `rotation` | D (dead data — editor never applies them; we match) | `pascal_params`; NOT applied to any transform |

**level** — anchor: Collection (+ level-origin Empty)

| Field | Disp | Blender home |
|---|---|---|
| `children` | H | objects parented under the level-origin Empty, linked into the level collection |
| `level` | T | `pascal_params.level`; drives stacking order → Empty Z (§3.6) |

**wall** — anchor: Mesh Object

| Field | Disp | Blender home |
|---|---|---|
| `start`, `end` | G+T | object location/rotation (Blender: `loc=(start.x, −start.z, slabElev)`, `rot_z` from wall angle) + mesh length; mirrored in `pascal_params` |
| `thickness` (∅→0.1), `height` (∅→2.5) | G | mesh + `pascal_params` (UI: DISTANCE) |
| `material` | M | material slots (§5) + `pascal_material` mirror |
| `children` | H | door/window/item objects parented to the wall object |
| `frontSide`, `backSide` | D | `pascal_params` (derived data; not rebuilt) |

**slab** — anchor: Mesh Object

| Field | Disp | Blender home |
|---|---|---|
| `polygon`, `holes` (∅→[]) | G | mesh (outset +0.05 baked, §4.2) + `pascal_params` |
| `elevation` (∅→0.05) | G | mesh extrusion height + `pascal_params` |
| `material` | M | slot 0 |

**ceiling** — anchor: Mesh Object

| Field | Disp | Blender home |
|---|---|---|
| `polygon`, `holes` | G | flat mesh + `pascal_params` |
| `height` (∅→2.5) | G+T | object Z = height − 0.01; `pascal_params.height` holds the true value |
| `material` | M | slot 0 (color-only parity note §5.4) |
| `children` | H | ceiling items parented to ceiling object |

**roof** — anchor: Empty (group)

| Field | Disp | Blender home |
|---|---|---|
| `position` | T | empty location |
| `rotation` (**scalar**, Y-radians) | T | empty `rotation_euler.z = −rotation` (Y-up→Z-up); scalarness restored on export |
| `children` | H | rseg objects parented to the empty |
| `material` | M | inherited default for segments without own material |
| legacy `length/height/leftWidth/rightWidth` | D | `pascal_json` (kept verbatim; migration adds children but never deletes these) |

**roof-segment** — anchor: Mesh Object

| Field | Disp | Blender home |
|---|---|---|
| `position`, `rotation` (scalar) | T | object transform relative to roof empty |
| `roofType` (7 enum), `width`, `depth`, `wallHeight`, `roofHeight`, `wallThickness`, `deckThickness`, `overhang`, `shingleThickness` | G | mesh (via builder) + `pascal_params` |
| `material` | M | slots (4-group scheme when absent, single when present, §5.4) |

**zone** — anchor: Mesh Object (flat, in excluded `Zones` collection)

| Field | Disp | Blender home |
|---|---|---|
| `name` (required) | D | object name + `pascal_params` |
| `polygon` | G | flat mesh at Z=0.01 |
| `color` (∅→`#3b82f6`) | M | unlit emission-ish material, alpha 0.25 |

**scan** — anchor: Empty (GLB parent)

| Field | Disp | Blender home |
|---|---|---|
| `url` | G | GLB imported under the empty (cache §6.2); URL in `pascal_params` |
| `position`, `rotation` ([x,y,z]) | T | empty transform |
| `scale` (**scalar**, ∅→1) | T | empty uniform scale; scalarness restored on export |
| `opacity` (0–100, ∅→100) | M | alpha on imported materials when < 100 |

**guide** — anchor: Mesh Object (image plane)

| Field | Disp | Blender home |
|---|---|---|
| `url` (often `asset://` — unreachable) | G | image texture if fetchable, else placeholder wire plane |
| `position` | T | object location |
| `rotation` | T | only Y component applied (editor parity): `rot_z = −rotation[1]`; full triple in `pascal_params` |
| `scale` (scalar, ∅→1) | G | plane width = 10·scale, height from image aspect |
| `opacity` (∅→**50**) | M | alpha = opacity/100 |

**window** — anchor: Mesh Object (child of wall) + hidden cutter

| Field | Disp | Blender home |
|---|---|---|
| `position` (wall-local, y=**center**) | T | object local transform (mapping §4.5) |
| `rotation` (y ∈ {0, π}), `side` | T/D | local rotation; `side` in `pascal_params` |
| `wallId` | D | `pascal_params` (redundant with parenting) |
| `width, height, frameThickness, frameDepth, columnRatios, rowRatios, columnDividerThickness, rowDividerThickness, sill, sillDepth, sillThickness` | G | mesh (builder per spec 04 §3.2) + `pascal_params`; width/height also size the cutter |
| `material` | M | `pascal_params` only for parity (dead in editor — hitbox overwrite); we honor base/glass shared materials §5.5 |

**door** — anchor: Mesh Object (child of wall) + hidden cutter

| Field | Disp | Blender home |
|---|---|---|
| `position` (y = height/2 always), `rotation`, `side`, `wallId` | T/D | as window |
| `width, height, frameThickness, frameDepth, threshold, thresholdHeight, segments[] (type/heightRatio/columnRatios/dividerThickness/panelDepth/panelInset), handle, handleHeight, handleSide, contentPadding, doorCloser, panicBar, panicBarHeight` | G | mesh (builder per spec 04 §2.2) + `pascal_params` |
| `hingesSide` | G | hinge placement only |
| `swingDirection` | D | `pascal_params` (2D-plan-only; no 3D effect — parity) |
| `material` | M | as window |

**item** — anchor: Empty (placement) → instance/GLB child (§6)

| Field | Disp | Blender home |
|---|---|---|
| `position` (semantics vary by attachment, §6.4) | T | empty local transform |
| `rotation` | T | empty rotation |
| `scale` (∅→[1,1,1] via migration) | T | folded into the instance child's scale (`asset.scale ⊗ item.scale`); raw value in `pascal_params` |
| `side` | T/D | z push for wall-side (§6.4); stored |
| `children` | H | surface items parented to this empty |
| `wallId`, `wallT`, `collectionIds` | D | `pascal_params` (dead/denormalized fields; preserved) |
| `asset.{id, category, name, thumbnail, src, tags}` | D/G | `pascal_params.asset`; `src` drives GLB fetch |
| `asset.dimensions` | G | logical bbox → empty `empty_display_size`/placeholder box; never scales the GLB |
| `asset.{offset, rotation, scale}` | T | corrective transform on the instance child |
| `asset.attachTo` | T | placement math selector (§6.4) |
| `asset.surface.height` | T | child-item Z origin |
| `asset.interactive.controls[]` | D | `pascal_params` (toggle/slider/temperature defaults feed light intensity §6.5) |
| `asset.interactive.effects[]` (animation clips / light) | D→object | light effect → real Blender POINT light (§6.5); animation clip names in `pascal_params` (GLB actions imported as-is) |

**Unknown node types / unknown fields** — anchor: plain Empty in `Pascal Unhandled` collection,
`pascal_json` verbatim; unknown fields on known types simply ride along inside `pascal_json`
(the importer never strips; the exporter never invents). This is the forward-compat guarantee.

---

## 3. Scene mapping

### 3.1 Units

`scene.unit_settings = METRIC / scale_length 1.0 / METERS` (set explicitly even though it is the
4.5 factory default). 1 Pascal meter = 1 Blender unit.

### 3.2 Axis conversion — glTF-importer convention, baked into data

Pascal is Y-up right-handed (three.js). We convert **at import time, into the data** — object
transforms and mesh vertices — exactly like the bundled glTF importer; there is **no root
rotation empty** (decision; alternatives — root empty with rot X +90° — rejected: lies in every
world matrix, breaks Apply Transform / snapping, verified precedent is the importer way):

```
location   (x, y, z)_pascal   →  (x, −z, y)_blender
euler/quat                    →  same permutation (quat (x,y,z,w) → (w, x, −z, y))
scale      (x, y, z)          →  (x, z, y)
plan pair  [x, z]             →  (x, −z) on Blender XY plane
scalar Y-rotation r           →  rotation_euler.z = −r        (walls/roofs/guides)
```

The permutation is exact (sign flips only — no float error). Export applies the inverse
`(x, y, z)_blender → (x, z, −y)_pascal`. Cameras additionally get the √2/2 X-rotation aim
correction (they are built from position/target anyway, §3.8).

Geometry builders work directly in Blender coordinates (plan `[x,z]` → `(x,−z)`, heights → +Z);
we never build Y-up meshes and rotate after.

### 3.3 Collection hierarchy

```
Scene Collection
└── Pascal: <filename>                    ← top import collection, pascal props on it
    ├── Site <shortid>                    ← Collection (only if a site node exists)
    │   └── Building <shortid>           ← Collection
    │       ├── Level 0 <shortid>        ← Collection
    │       │   ├── Level 0 Origin       ← Empty, carries stacked Z offset (§3.6)
    │       │   │   └── (walls, slabs, roofs, items… parented)
    │       │   └── Cutters – Level 0    ← hidden Collection (boolean cutters, §4.4)
    │       └── Level 1 <shortid> …
    ├── Zones                             ← excluded by default (LayerCollection.exclude)
    ├── Cameras                           ← per-node saved cameras (§3.8)
    ├── Pascal Assets                     ← hidden; one collection per GLB asset (§6.3)
    ├── Pascal Orphans                    ← excluded; anchors for unreachable nodes (§3.7)
    └── Pascal Unhandled                  ← excluded; unknown node types
```

- Site/Building/Level are **Collections** (organizational, no accidental-transform risk,
  per-level solo/hide for free via `LayerCollection.exclude`). Containers carry
  `pascal_id`/`pascal_type`/`pascal_json` — Collections take custom props (verified).
- `demo_1.json` has **no site node** (root is a building): the Building collection then sits
  directly under the import collection. Any node type at root is legal; unexpected root types go
  through the normal builder or `Pascal Unhandled`.
- Everything is linked under `scene.collection` — unlinked Collections are purged on save
  (verified trap).
- Hierarchy is followed via **`children` arrays** (authoritative, matching the renderer);
  `parentId` is only used to detect orphans. `site.children` may contain embedded full node
  objects — hoisted (§2.3 site table).

### 3.4 Anchor datablock per node type

| Node type | Anchor |
|---|---|
| site, building, level | Collection |
| wall, slab, ceiling, roof-segment, zone, guide, window, door | Mesh Object |
| roof | Empty (`PLAIN_AXES`) |
| item, scan | Empty (placement parent) |
| orphan / unknown | Empty in the dedicated collection |

`pascal_id` is stamped on the anchor **and** on its Mesh datablock (survives object deletion via
mesh reuse, and makes datablock-level tooling possible).

### 3.5 Naming (display only — never identity)

`"{name or TypeLabel} {first4-of-id-suffix}"`, truncated to 63 bytes UTF-8-aware, e.g.
`Wall 0j28`, `Plancher gr6z`, `Roof 1 jxd8`, `window-large 137w`. Collisions may still get
`.001` — harmless, because identity lives exclusively in `pascal_id` (names are re-derived, never
parsed; Blender renames on collision, truncates, and reuses freed suffixes — all verified).

### 3.6 Level Y-offset handling

Implemented exactly per spec 05 §5 (`getLevelHeight`: max over children of
ceiling `height ?? 2.5` and wall `slabElevation + (height ?? 2.5)`, where a wall's
`slabElevation` = max `elevation ?? 0.05` of same-level slabs it overlaps (5-sample test,
hole-aware), floor at 0; fallback 2.5. Sort levels by `level` field, cumulative sum → level N's
offset. Typical result: 2.55 per storey, **not** 2.5.)

**Decision:** the offset lives on one **level-origin Empty** per level; all level children are
parented to it, so object locals equal level-local Pascal coordinates 1:1 (clean round-trip) and
a user can slide/solo a whole storey by grabbing one object. *Alternative rejected:* baking the
offset into every object's Z — cheap but couples every object to derived data and makes
re-export subtract-y bookkeeping error-prone. Only stacked mode is materialized (the editor's
exploded/solo modes are view state, deliberately not imported).

### 3.7 Orphans and graph inconsistencies

- Nodes unreachable from `rootNodeIds` via `children` (demo has 7 items with dangling wall
  parents): anchor Empty in `Pascal Orphans` (excluded collection, so invisible like in the
  editor), full data layer, **no geometry build**. Exporter re-emits them verbatim.
- `parentId`/`children` disagreements (demo: level with `parentId: null` yet listed in
  building.children): children[] wins for placement; original values preserved in `pascal_json`
  and re-exported untouched.

### 3.8 Visibility & cameras

- `visible: false` → `hide_viewport = hide_render = True` on the anchor (objects) or
  `LayerCollection.exclude` (containers). Exporter reads it back from the same place.
- `node.camera` ({position, target, mode[, fov, zoom]}, world coords, level offset already
  included — do **not** re-add): one Blender Camera object per occurrence in `Cameras`,
  named after the node, `pascal_camera_of = <node id>`, location = converted `position`,
  rotation = computed look-at quaternion toward `target` (no constraint — keeps the object
  self-contained), `data.type = 'PERSP'` with fov 50° default (`fov` honored when present) or
  `'ORTHO'` with scale derived from `zoom ?? 20`. `target` is also stored in props for exact
  re-export.

---

## 4. Geometry

**Global decision — parametric-editability story:** *Python-generated meshes, parameters in
`pascal_params`, plus a `pascal.regenerate` operator* that rebuilds the mesh **in place**
(`bm.to_mesh(obj.data)`) so identity, parenting, modifiers and material slots survive. An
N-panel shows the params (with `id_properties_ui` sliders/units) and the Regenerate button.
*Alternative — Geometry Nodes — rejected for v1:* 7 roof types as programmatically-built node
graphs is a maintenance tax, GN modifier inputs are keyed `Socket_N` (fragile), and live GN
booleans multiply depsgraph cost; the live-cutter structure below already gives direct
manipulation of openings. GN groups for doors/windows only remain an optional later milestone.
(Full trade-off in spec 07 §3.)

Common mesh pipeline (spec 07 §1, verified watertight):
`tessellate_polygon` (holes supported, winding-insensitive; fallback `delaunay_2d_cdt` with the
loops passed as **faces, not edge constraints**, `output_type=2` — edge-constraint input silently
fills holes; assert no face centroid lands inside a hole after the fallback runs) →
`from_pydata` → `mesh.validate()` → bmesh `dissolve_limit(≈1°)` →
`extrude_face_region` → `recalc_face_normals`.

### 4.1 Wall

- Base mesh: rectangle footprint of length `|end−start|` × `thickness ?? 0.1`, extruded to
  `height ?? 2.5` (extended downward when slab elevation < 0: height − slabElevation, per
  spec 04 §1.1). Object at `(start.x, −start.z, slabElevation + levelLocal 0)` parented to the
  level origin; `rotation_euler.z` from the wall angle (§3.2).
- **Miters:** the provided specs do not include the editor's wall-corner mitering algorithm
  (it lives in `packages/core/src/systems/wall/*`; spec 02/03 extraction pending — Risk R1).
  v1 ships butt-joined rectangular walls (correct footprints, tiny corner overlaps identical to
  naive extrusion); the miter port lands in M4 once extracted. Data layer is unaffected.
- **Cutouts: live Boolean modifiers (decision).** One Boolean modifier per wall,
  `operand_type='COLLECTION'` pointing at that wall's hidden cutter collection, solver
  **MANIFOLD**, **never FAST** (verified: FAST produces non-manifold garbage on coplanar
  thin-wall cuts; MANIFOLD/EXACT both exact). MANIFOLD failure is **silent** (modifier no-ops
  with only a stderr WARN; EXACT on the same bad input produces garbage — verified), so there is
  no "automatic fallback": instead (a) every cutter mesh is validated manifold at creation time
  (boxes are by construction), and (b) after wiring each wall's boolean, the importer asserts the
  evaluated-mesh volume differs from the uncut wall; on failure it switches that wall to EXACT,
  re-asserts, and reports in the import panel. Cutter boxes are
  oversized to `wallThickness + 2 cm` depth, Z-centered on the wall plane, matching the editor's
  CSG semantics: the hole is the wall-local X/Y AABB of the child's `cutout` volume (spec 04
  §1.6). Each cutter is **parented to its door/window/item object**, so moving the opening moves
  its hole live. Cutters are `hide_viewport/hide_render/display_type='WIRE'`, linked (never
  unlinked — 0-user GC), hidden via object flags not view-layer exclusion (depsgraph safety).
  Import option `Bake openings` (default off) applies the modifiers via `temp_override`.
  *Alternative — exact stitched geometry — rejected:* far more code for no robustness gain while
  MANIFOLD/EXACT hold (kept as documented plan-B).

### 4.2 Slab

Outer polygon **outset by 0.05 m** (exact editor algorithm: shoelace winding sign, per-edge
normal offset, line-intersection vertices, parallel fallback — spec 05 §6), holes NOT outset;
tessellate+extrude 0→`elevation ?? 0.05` (+Z). Object at level origin. The outset is baked into
the mesh; `pascal_params.polygon` keeps the raw polygon for regeneration/export.

### 4.3 Ceiling

Flat polygon-with-holes mesh (zero thickness) at object Z = `(height ?? 2.5) − 0.01`
(z-fighting offset is baked into the object transform, true height in params). Visible from
below — material double-sided-ish via no backface culling (§5.4).

### 4.4 Roof ×7 types (hip, gable, shed, gambrel, dutch, mansard, flat)

Roof node → Empty at `position` with `rot_z = −rotation`; each roof-segment → one mesh object
under it, transformed by its own scalar-rotation/position. Segment builder consumes the 9
parametric fields and emits the shingle/deck/wall/interior shells with **face-group material
indices 0–3** matching the editor's 4-slot scheme (§5.4).

The exact per-type profile math is in the editor's roof system
(`packages/core/src/systems/roof/*`) and is **not yet extracted into a numbered spec**
(Risk R1). Plan: extract as `docs/spec/08-roof-geometry.md` during M4, port each type as a pure
function `build_roof_segment(params) -> bmesh`, validated by volume/bbox parity against the
editor GLB export of single-roof fixtures. All 7 types are prism/loft constructions (ridge +
slope planes with overhang and thickness offsets) — no straight skeleton needed for the
rectangular-footprint segment model, so no external deps (shapely stays out).

**Legacy roofs** (demo_1 has two): the migration (spec 01 §9.2) is applied for geometry — a
synthetic `rseg_<same-suffix>` gable child with the verbatim odd constants
(width `length ?? 8`, depth `(leftWidth ?? 2.2)+(rightWidth ?? 2.2)`, roofHeight `height ?? 2.5`,
wallHeight 0, overhang 0.3, thicknesses 0.1/0.1, shingle 0.05) — while the roof anchor's
`pascal_json` keeps the original legacy node and the synthetic segment is flagged
`pascal_migrated = true` (§8.5). Note the migration deliberately loses left/right asymmetry
(4.7/2.7 → symmetric 7.4) — this matches the editor pixel-for-pixel, and the asymmetric truth
survives in the data layer.

### 4.5 Parametric door & window

Box-assembly builders implementing spec 04 §2.2 / §3.2 **to the constant** (leaf =
`height − frameThickness` with no bottom bar, `leafCenterY = −frameThickness/2`, glass depths
`max(0.004, leafDepth·0.15)` / `max(0.004, frameDepth·0.08)`, top→bottom segment stacking with
ratio normalization, per-column row dividers, panel detail `abs(panelDepth)` on +local-front
face only, handle/hinges/closer/panic-bar constants, sill hanging below the frame). One mesh
object per door/window (sub-boxes joined into a single mesh with two material slots:
0 = base, 1 = glass); no invisible hitbox (Blender selection replaces it); the `cutout` becomes
the hidden boolean cutter box `width × height × (wallThickness + 2 cm)` (§4.1).

Placement: parented to the wall object. Pascal wall-local `(x, y, z)` maps to Blender wall-local
`(x, −z, y)` — so a door at `position [2.5, 1.05, 0]` sits at local `(2.5, 0, 1.05)` with local
`rot_z = −rotation[1]` (0 or −π). Vertical anchors preserved exactly: door y = height/2
(center, floor-seated), window y = center. `swingDirection` builds nothing (editor parity — 3D
always renders closed); stored for export.

Editability: move/slide the door object → cutter follows (parented) → boolean updates live.
Width/height/grid changes → edit `pascal_params` → Regenerate (rebuilds mesh AND resizes the
cutter child).

### 4.6 Zone

Flat polygon mesh at Z = 0.01 in the excluded `Zones` collection, colored per `color`, plus the
name on the object. The editor's hover-only walls/gradients are view effects — not imported.
Zones contribute nothing to renders (parity: they are invisible by default in the editor too).

### 4.7 Site

Closed poly-spline Curve for the property line (decorative, `#f59e0b`-ish material) + a
shadow-catcher plane (Cycles: `is_shadow_catcher = True`) fitted to the polygon. No solid
geometry (parity).

### 4.8 Scan & guide

- **Scan:** GLB via the shared asset pipeline (§6.2) under the scan Empty (uniform scalar scale);
  `opacity < 100` → alpha on all imported materials, `surface_render_method='BLENDED'`.
- **Guide:** plane `10·scale` wide × aspect-derived height, image texture, alpha = opacity/100,
  only Y-rotation applied (parity). `asset://` URL → placeholder wire plane of the same size
  with the URL in props (Risk R4).

### 4.9 Regenerate operator contract

`pascal.regenerate` (on selection or whole import): reads `pascal_params` → rebuilds mesh
in-place → re-applies face material indices → resizes dependent cutters → updates
`pascal_params`-derived UI. It never touches `pascal_json` (the exporter computes deltas at
export time, §7). This is the standard importer pattern (Bonsai/IfcOpenShell precedent).

---

## 5. Materials

### 5.1 Deduplication & identity

One Blender Material per **resolved 6-tuple** (color, roughness, metalness, opacity,
transparent, side), cached importer-wide — mirroring the editor's `createMaterial` cache.
Named `Pascal/<preset>` for pure presets, `Pascal/<preset>+<hash6>` for overridden,
`Pascal/custom-<hash6>` otherwise. Each material carries `pascal_material_json` (the node's
original `material` object verbatim) and `pascal_resolved` (the 6-tuple) — so preset identity
survives even though the shader is baked values.

### 5.2 Resolution (exact editor precedence)

`resolveMaterial`: absent → per-node-type default (below); `preset ≠ custom` →
`{...DEFAULT_MATERIALS[preset], ...properties}` (properties win field-by-field); else
`{...custom, ...properties}`.

### 5.3 Preset → Principled BSDF table (4.x socket names)

| preset | Base Color | Roughness | Metallic | Alpha | render method | backface culling |
|---|---|---|---|---|---|---|
| white | `#ffffff` | 0.9 | 0 | 1 | DITHERED | on (front) |
| brick | `#8b4513` | 0.85 | 0 | 1 | DITHERED | on |
| concrete | `#808080` | 0.8 | 0 | 1 | DITHERED | on |
| wood | `#deb887` | 0.7 | 0 | 1 | DITHERED | on |
| glass | `#87ceeb` | 0.1 | 0.1 | **0.3** | **BLENDED** | **off (double)** |
| metal | `#c0c0c0` | 0.3 | 0.9 | 1 | DITHERED | on |
| plaster | `#f5f5dc` | 0.95 | 0 | 1 | DITHERED | on |
| tile | `#d3d3d3` | 0.4 | 0.1 | 1 | DITHERED | on |
| marble | `#fafafa` | 0.2 | 0.1 | 1 | DITHERED | on |
| custom | `#ffffff` | 0.5 | 0 | 1 | DITHERED | on |

Mapping rules: color → `Base Color` (sRGB hex → linear), roughness → `Roughness`, metalness →
`Metallic`, opacity → `Alpha` with `mat.surface_render_method = 'BLENDED'` when
`transparent`, side → `use_backface_culling = (side == 'front')` (back-only is approximated as
culling off + note in props; three.js BackSide has no cheap Blender equivalent — recorded, Risk
R7). **Glass decision:** Alpha-blend for editor parity (the editor uses opacity, not
refraction); an import option `Physical glass` additionally sets `Transmission Weight = 1.0`,
`IOR 1.45` for users who want real glass in Cycles. Sockets always looked up **by name**
(`Emission Color`/`Emission Strength` split, no legacy `Emission`).

Per-node-type fallbacks when `material` is absent (spec 01 §5.3): wall `#ffffff` r0.9, slab
`#e5e5e5` r0.8, door `#8b4513` r0.7 (data-layer only, see §5.5), window glass-like, ceiling
`#f5f5dc` r0.95 → **color-only** in the editor renderer, we apply color+r0.95, roof 4-slot set
below.

### 5.4 Per-face assignment (multi-material nodes)

- **Roof/roof-segment without material** — 4 slots by face group, editor's exact values:
  0 Wall/Trim white r1 double · 1 Deck `#e5e5e5` r1 · 2 Interior white r1 double ·
  3 Shingle `#e5e5e5` r0.9. Builders set `face.material_index` at generation time. A segment
  **with** a material gets a single resolved slot (parity).
- **Door/window** — slot 0 shared base `#f2f0ed` r0.5, slot 1 shared glass (`lightblue`,
  rough 0.05, metal 0.1, alpha 0.35, BLENDED, culling off).
- **Wall front/back** — single material in v1 (the editor has no per-face wall materials
  either; its runtime WallCutout override is view-state). The boolean's
  `material_mode='TRANSFER'` is pre-wired so reveals can take a cutter material later.

### 5.5 Editor-dead fields, honored or recorded

- `material.texture` (url/repeat/scale): **dead in the editor** (never loaded). Import option
  `Apply texture field` (default **on** — it costs nothing and is the user's clear intent):
  UV Map → Mapping (Scale = repeat·scale) → Image Texture (REPEAT) → Base Color, with
  world-scale box-mapped UVs written in the bmesh pass. Off = recorded in props only.
- Door/window `node.material`: dead in the editor (hitbox overwrite). We record it and do
  **not** tint the door mesh (parity). Toggle `Honor door/window material` for people who want
  the `#8b4513` door look.

### 5.6 GLB item materials

Editor **replaces every GLB material** (name `glass` → shared glass, everything else → shared
base `#f2f0ed`). Import option `Item materials: Editor look | Original GLB`, default
**Editor look** (visual-parity goal). Original mode keeps the GLB's PBR materials (information
the editor throws away — strictly more faithful to the asset, less to the editor render).

---

## 6. Items / assets

### 6.1 Structure per item

```
Item Empty  (pascal anchor; local transform = node.position/rotation, §6.4)
└── Instance child: Empty instance_type='COLLECTION' → asset collection
        child local transform = T(asset.offset) R(asset.rotation) S(asset.scale ⊗ item.scale)
└── (surface-item children parented here)
```

`worldTransform = levelOrigin ∘ [wall ∘] T(pos) R(rot) ∘ T(offset) R(rot_a) S(scale_a ⊗ scale_i)`
— exactly the editor's Clone math; `item.scale` multiplies only the model, never children/pos.

### 6.2 Download + cache + import

URL resolution (spec 04 §4.2): `http(s)` as-is; `asset://` → unrecoverable → placeholder;
else prefix `https://editor.pascal.app` (importer preference for a custom CDN). Cache:
`bpy.utils.extension_path_user(__package__, path='cache', create=True)/{sha1(url)}.glb`;
download via stdlib `urllib` **only if `bpy.app.online_access`** (else placeholder + report;
Extensions-review requirement). Import once per asset id: `bpy.ops.import_scene.gltf` into an
asset collection under hidden `Pascal Assets`; imported objects tracked by set-difference.
Placeholder = wire box of `asset.dimensions` with the asset id label (mirrors the editor's
loading/error box).

### 6.3 Reuse: collection instances (decision)

Repeated assets (demo: 50 items over ~20 distinct assets) are **collection instances** —
one import, N lightweight empties; GLB furniture is multi-object, which instancing handles
naturally, and a light inside the asset collection duplicates per instance for free.
*Alternative — linked duplicates* — used automatically only when a per-instance material
override is required (none in v1; `Editor look` shares two materials anyway). Import option
`Make instances real` for users wanting editable unique copies.

Meshes named `cutout` inside a GLB: hidden in the asset collection AND, for wall-attached
items, converted to a per-instance cutter box in the wall's cutter collection (AABB in
wall-local space, editor semantics §4.1).

### 6.4 Attachment transforms (exact editor semantics, spec 04 §4.4)

| attachTo | Blender parent | Empty local transform |
|---|---|---|
| ∅ (floor) | level origin | `(x, −z, slabElevation + y)` — slab elevation under the rotated footprint computed at import (runtime value, not persisted; recomputed identically on export) |
| `wall` | wall object | `(x, −0, y)` → local `(x, 0−, y)` i.e. `(posX, −posZ, posY)`; **y = item BOTTOM** (unlike door/window) |
| `wall-side` | wall object | as `wall` plus local Y (wall-normal) push `∓ thickness/2` (front → −Y_blender-local; runtime value, recomputed on export) |
| `ceiling` | ceiling object | `(x, −z, −itemHeight)` under the ceiling plane; itemHeight = `dimensions[1]·scale[1]` |
| surface (parent is item) | parent item empty | `(x, −z, surface.height · parentScale[1])` |

Runtime-derived offsets (slab elevation, wall-side push) are applied to a **separate child
level** (the instance child), not the anchor Empty, so the anchor's local transform remains the
verbatim JSON `position` — keeping export a pure read.

### 6.5 Light effects → Blender lights

Per `light` effect: one **POINT** light object inside the item's placement (parented to the
anchor Empty at `effect.offset` — note the editor adds offset in *world* axes un-rotated; we
compensate by counter-rotating the local offset so world placement matches).
`color` → light color; `distance` → `use_custom_distance/cutoff_distance` (0/absent =
unlimited); intensity: initial control state = first toggle `default ?? false`, first slider
`default ?? min` → `isOn ? lerp(range[0], range[1], t) : range[0]`, mapped to Watts via one
global calibration constant `PASCAL_LIGHT_TO_WATT` (default 60 W per intensity unit,
importer preference; calibrated once in M6 against the editor render — Risk R5). Emissive
fixture look: optional `Emission Strength` on the asset's non-glass material when the effect is
on. The editor's 12-light pool/scoring is a WebGPU budget hack — not ported; every light is real.
All control/effect definitions live verbatim in `pascal_params` for export.

### 6.6 Unreachable assets

`asset://` GLBs/images and offline mode produce placeholders, never import failures. The report
panel (§8.4) lists them; the data layer keeps the URLs so a future re-link operator
(`pascal.relink_assets`, points at a folder) can swap placeholders for real GLBs.

---

## 7. Round-trip (exporter design; implemented in M7)

### 7.1 Algorithm — "omit-preserving overlay diff"

1. Collect all datablocks with `pascal_id` (never by name); group by id; resolve duplicates
   (§7.3). Parse each `pascal_json` → base node dict (verbatim, unknown fields intact).
2. For each managed field (§2.3 tables, dispositions G/M/T/H): read the current Blender value,
   convert back (inverse axis map, scalar rotations re-scalarized, wall-local inversion,
   level-origin subtraction). **Write-if-changed:** only if the value differs from what the
   *import* would have produced from the base node (defaults included) does the exporter set the
   key — so fields absent in the source stay absent unless genuinely edited. This preserves the
   editor's own "omit defaults" style and keeps no-edit round-trips deep-equal.
3. Reassemble `{nodes, rootNodeIds}`: node set = anchors found (orphans/unknown included) ∪
   Text-snapshot nodes not represented by any surviving anchor are **dropped only if their
   anchor was user-deleted** (deletion is an edit; a preference `Resurrect deleted nodes from
   snapshot` flips this). `rootNodeIds` and top-level extras from Scene props; `children`
   arrays rebuilt from actual Blender parenting/collection membership, preserving original
   order where membership is unchanged. Legacy-migrated nodes re-export their **original**
   legacy form unless the user edited the migrated geometry params (then the migrated form is
   written — it is what the editor would produce anyway).
4. Validate: JSON-schema sanity, dangling refs report, hash comparison for the no-edit case.

### 7.2 What user edits are capturable (honest list)

**Captured:** moving/rotating walls (start/end recomputed from object transform + length),
doors/windows/items along or across walls (wall-local inversion; includes re-parenting to
another wall), floor/ceiling/surface item moves, item scale, level re-stacking (origin Empty
moves → warning: stacking is *derived* — exported as-is only into geometry-affecting fields we
own, i.e. not persisted; a moved level origin is reported, not silently encoded),
any `pascal_params` edit (wall height/thickness, slab polygon…, door grids, roof params) —
Regenerate keeps mesh and params in sync, exporter reads params, name changes (object name →
`name` field when it differs from the derived label), visibility toggles, material changes
made by assigning a different `Pascal/*` material or editing `pascal_material_json` via the
panel, camera object moves (position/target recomputed).

**Not captured (by design, reported not silently dropped):** free-form mesh edits in Edit
Mode/sculpt (parametric source can't represent them; the report flags
`mesh modified after generation` via a content hash stored at build time), new user-created
objects without `pascal_id` (we cannot invent asset catalog entries; a future
`pascal.adopt_object` operator could wrap them as items), shader-graph edits beyond our 6-tuple
+ texture fields, modifier stacks added by the user, per-instance GLB material overrides,
Blender-only niceties (constraints, drivers, animation). Duplicated objects: see §7.3.

### 7.3 Duplicate `pascal_id` policy (decision)

Shift-D copies custom props verbatim. Exporter rule: among datablocks sharing a `pascal_id`,
the one whose `pascal_uid` (a per-import random token stamped at creation) matches the recorded
value is the original; **extras get fresh node ids generated Pascal-style
(`<prefix>_<16 chars [0-9a-z]>`)** and are exported as new sibling nodes (cloneSceneGraph
precedent: remap id, parentId, children). This turns naive duplication into a meaningful edit
instead of corruption.

---

## 8. Architecture & packaging

### 8.1 Module layout (Blender Extension, `bl_ext` namespace, relative imports only)

```
pascal_blender/
├── blender_manifest.toml        # Extensions format (§8.2)
├── __init__.py                  # register/unregister only
├── operators/
│   ├── import_scene.py          # PASCAL_OT_import + FileHandler + File▸Import menu
│   ├── regenerate.py            # pascal.regenerate
│   ├── export_scene.py          # pascal.export (M7)
│   └── relink_assets.py         # placeholder → real GLB
├── ui/
│   ├── panel.py                 # N-panel: params, Regenerate, report
│   └── report.py                # import report (orphans, placeholders, unknowns)
├── core/                        # PURE PYTHON — no bpy, unit-testable without Blender
│   ├── schema.py                # defaults tables, node dataclasses, id generation
│   ├── parse.py                 # load, tolerant validation, unknown-key carry
│   ├── migrations.py            # item-scale + legacy-roof (verbatim constants)
│   ├── graph.py                 # reachability, orphan detection, level sort/heights
│   ├── coords.py                # axis maps, wall-local math, inverses
│   └── materials.py             # resolveMaterial, preset tables, 6-tuple keys
├── build/                       # bpy-dependent scene construction
│   ├── datalayer.py             # Text block, pascal_* props, ui metadata
│   ├── collections.py           # hierarchy, level origins, naming
│   ├── walls.py  slabs.py  ceilings.py  roofs.py  doors.py  windows.py
│   ├── zones.py  site.py  scans_guides.py  cameras.py
│   ├── items.py                 # placement, attachment math
│   ├── assets.py                # download/cache/import/instancing/lights
│   ├── cutters.py               # boolean cutter management
│   └── mats.py                  # Principled builders, slot assignment
└── tests/                       # pytest for core/, headless Blender harness for build/
```

The `core/` vs `build/` split is the load-bearing decision: all Pascal semantics (defaults,
migrations, math) are importable and testable with plain pytest; `build/` is a thin bpy shell.

### 8.2 Packaging: Extension (decision)

`blender_manifest.toml` (schema 1.0.0, `blender_version_min = "4.2.0"`,
`permissions.network = "Download GLB furniture assets"`,
`permissions.files = "Cache downloaded assets"`), validated/built with
`Blender --command extension validate|build`. **No wheels in v1** (stdlib + bpy only).
*Legacy `bl_info` add-on rejected:* deprecated, cannot declare network permission.

### 8.3 Import UX

- `File ▸ Import ▸ Pascal Scene (.json)` (menu append) **and** drag-drop via
  `bpy.types.FileHandler` (`bl_file_extensions = ".json;.pascal.json"`, `poll_drop` limited to
  the 3D viewport). Options: Bake openings (off), Item materials Editor/Original (Editor),
  Physical glass (off), Apply texture field (on), Make instances real (off), CDN base URL.
- Operator is `{'REGISTER', 'UNDO'}`; synchronous downloads with
  `wm.progress_begin/update/end` for v1.

### 8.4 Error handling & forward compatibility

- **Unknown node type:** anchor Empty in `Pascal Unhandled`, full data layer, warning in
  report. Exports verbatim. **MUST never drop unknown fields/types** — guaranteed because
  export starts from `pascal_json`, not from a schema.
- **Tolerant reader:** no Zod-equivalent hard validation on load (the editor doesn't parse
  either); only `id` is required per node. Missing required-in-practice fields (e.g. wall
  `start`) → node becomes data-layer-only anchor + report entry, never an exception.
- Malformed JSON, unreadable file → operator `{'CANCELLED'}` with a clear message; partial
  scenes are never left behind (build inside a transaction-ish: new import collection is
  removed on failure).
- Orphans, dangling `children` ids, `parentId` disagreements: tolerated + reported (§3.7).
- No schema version exists in the format (spec 01) — the importer records its own
  `pascal_schema_version` for *our* format and treats unknown content generically.

### 8.5 Migrations handling

Run `migrateNodes` **verbatim** (item `scale` backfill; legacy roof → synthetic `rseg_<suffix>`
with constants 8 / 2.2+2.2 / 2.5 / wallHeight 0 / overhang 0.3 / 0.1 / 0.1 / 0.05) for the
native rebuild only. `pascal_json` always stores the **pre-migration** node; synthetic nodes get
`pascal_migrated = true` and NO independent existence at export unless edited (§7.1 step 3).
This yields editor-identical visuals *and* byte-faithful re-export of legacy files.

---

## 9. Implementation plan

Fixtures: `demo_1.json` (real data) + authored synthetic fixtures in `tests/fixtures/` covering
what the demo lacks: site node (incl. embedded children objects), parametric window/door (all
segment types, ratios, hardware), each of the 7 roof types, ceiling with holes, negative slab
elevation, every material preset + overrides + texture field, scan, camera fov/zoom, interactive
lights, surface items, unknown node type + unknown fields (forward-compat probe).

Every milestone runs headless (`Blender --background --factory-startup --python tests/run.py`)
in CI-able form; `core/` additionally under plain pytest.

- **M1 — Core semantics (no bpy).** parse/defaults/migrations/graph/coords/materials.
  *Accept:* pytest green; demo_1: 65 nodes, 7 orphans detected, 2 roofs migrated with exact
  constants, level heights [2.55, …] match hand-computed values; re-serialization of the parsed
  graph is deep-equal to input.
- **M2 — Data layer + hierarchy.** Text block, props, collections, level origins, naming,
  orphans/unknowns, cameras, visibility. *Accept:* import demo_1 headless → every node id
  findable via `pascal_id` scan; Text block sha256 == source; save/reload preserves everything;
  a `strip-geometry` script can regenerate deep-equal JSON from the .blend alone (proto-export).
- **M3 — Walls/slabs/ceilings + openings.** Extrusions, cutter collections, MANIFOLD booleans,
  parametric door/window builders, GLB-cutout cutters, Regenerate v1.
  *Accept:* all walls manifold (0 non-manifold edges) with exact volumes; cutout AABBs equal
  spec values; door/window sub-part dimensions match spec 04 constants to 1e-6; moving a door
  object updates the hole; Regenerate after param edit is stable (idempotent).
- **M4 — Roofs.** Extract `08-roof-geometry.md` from the editor source; port 7 types + wall
  miters (R1). *Accept:* per-type volume/bbox parity vs editor GLB single-roof fixtures ≤ 1 cm;
  demo_1 legacy roofs visually match GLB overlay.
- **M5 — Items/assets.** Download/cache/online_access, instancing, attachment math, lights,
  material modes. *Accept:* demo_1's 50 items placed with world matrices equal to hand-computed
  editor math (≤ 1e-5); repeated assets share one collection; offline import yields labeled
  placeholders and a complete report.
- **M6 — Long tail + parity pass.** Zones/site/scans/guides, texture option, light calibration
  (R5), full-scene visual parity. *Accept:* automated GLB comparison (below) passes on demo_1 +
  all fixtures; manual A/B screenshots signed off.
- **M7 — Exporter.** Overlay-diff export, duplicate policy, edit-capture matrix tests.
  *Accept:* import→export no-edit = deep-equal for demo_1 and every fixture (including
  legacy-roof byte-faithfulness and unknown-field carry); "move one door" exports a diff
  touching exactly that node's `position`.
- **M8 — Packaging & docs.** Manifest validate/build, drag-drop, README, install guide.
  *Accept:* `Blender --command extension build` artifact installs clean in a fresh 4.5;
  drag-drop demo_1 into viewport works.

**Visual-parity oracle (used from M3 on):** run the editor headless-ish path is unavailable, so
we use its own **GLB export** of each fixture as reference: import the GLB into Blender
(bundled importer handles Y-up), auto-align, then compare (1) per-level and whole-scene AABBs
≤ 1 cm, (2) sampled signed-distance between meshes for walls/roofs, (3) presence/position of
every opening (ray probes through hole centers), (4) render both to PNG (same camera from
`node.camera`, workbench engine) and SSIM-compare ≥ 0.98. Known allowed deltas: GLB bakes
WallCutout view materials and zone overlays (spec 05 §13) — comparison masks materials, tests
geometry.

---

## 10. Risks & open questions

| # | Risk / question | Impact | Mitigation |
|---|---|---|---|
| R1 | **Wall miter + roof geometry algorithms not yet spec'd** (specs 02/03 were never produced; only 01/04/05/06/07 exist) | M3/M4 accuracy | Extract `08-roof-geometry.md` + miter notes from `packages/core/src/systems/{wall,roof}` at M4 start; butt-joint walls acceptable interim |
| R2 | Two source repos (`editor` fork vs `monorepo`) differ in minor material constants (window frame `#e8e8e8` vs shared base; glass opacity 0.3 vs 0.35) | cosmetic | **Decision: monorepo is reference** (freshest); constants isolated in `core/materials.py` |
| R3 | Only one real scene exists; site/window/door/rseg/ceiling/scan paths untested against production data | correctness blind spots | Synthetic fixtures (M plan); ask Pascal team for production scene dumps |
| R4 | `asset://` blobs unrecoverable (demo's only guide image is one) | missing visuals, never data loss | placeholders + `pascal.relink_assets`; URL preserved |
| R5 | Light intensity units are arbitrary editor-scale, not physical | look mismatch | single calibration constant, tuned once in M6, user-overridable |
| R6 | Whether any production host persists `collections` top-level | export completeness | `pascal_extra_toplevel_json` carries it verbatim either way |
| R7 | three.js `side:'back'` has no exact Blender equivalent; ceiling's BackSide-from-below trick approximated | edge-case shading | culling-off + prop record; revisit with geometry normal flip if a real scene uses `back` |
| R8 | Boolean depsgraph cost on very large scenes (hundreds of walls × openings) | perf | one collection-operand modifier per wall (minimal count); `Bake openings` option; measure at M3 |
| R9 | Users deleting the Text block or editing `pascal_json` by hand | round-trip integrity | sha256 check + report; per-node tier keeps deep-equal export possible without the Text block |
| R10 | Blender 5.x changes (system_properties split, UI) | future port | pinned to 4.5 LTS; all version-sensitive facts flagged in spec 06/07 |
| Q1 | Should export offer *pretty* (editor-style omit-defaults) vs *explicit* (all defaults materialized) JSON? | interop | v1: omit-preserving (§7.1); explicit mode is a flag away |
| Q2 | Per-instance furniture material overrides (would flip §6.3 to linked duplicates for those assets) | UX | deferred until a user asks; `Make instances real` is the escape hatch |

---

*End of design. Implementation may start with M1 (`core/` is bpy-free) immediately.*
