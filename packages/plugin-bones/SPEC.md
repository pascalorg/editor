# Bones — Spec

**One line:** the engineering X-ray for Pascal — open any house and see what it's
actually made of: framing, foundation, wiring, plumbing, ducts, derived member-by-
member from the architectural model, sized to your jurisdiction, rendered see-through
in 3D.

## LOD ladder (the BIM mindset)

| LOD | Meaning | Status |
|---|---|---|
| **200** | Generic assemblies — every member laid out at default spacing/sizes | shipping tonight |
| **300** | Code-informed — jurisdiction profile sizes footings/anchors/rafters/headers from researched datasets (data/) | shipping tonight |
| **400** | Connection details — hangers, clips, hold-downs, nailing, California corners, joist-bay-aware MEP routing | next |

Each completed level unlocks the next; `// LOD 400:` comments in the engines mark
exactly where the next refinement goes.

Pascal models *architecture*: walls, doors, windows, slabs, roofs, levels. Bones infers
*construction*: the studs inside the walls, the joists under the floors, the rafters
under the roof, the concrete under it all. The core principle: framing is
deterministic code driven by a parametric model, and takeoffs count the members the
engines actually generated — never a re-estimate. Bones brings that to any Pascal
scene.

---

## 1. Inputs — what Pascal already gives us

All inference reads the existing scene graph through the public `useScene` /
`getScene` surface. No new host stores (Plugin API v1 boundary).

| Pascal node | Fields Bones reads | Feeds |
|---|---|---|
| `wall` | `start`, `end` [x,z] in level coords, `thickness`, `height`, `curveOffset`, `children` (door/window ids), `frontSide`/`backSide` (interior vs exterior) | Wall framing |
| `door`, `window` | position along parent wall, width, height, sill height | Opening framing (kings/trimmers/headers/sills/cripples) |
| `slab` | outline, thickness, level | Floor framing, foundation |
| `roof`, `roof-segment` | plane geometry, pitch, overhang | Roof framing |
| `level` | elevation, contained nodes | Per-storey framing, plate heights |
| `column` | position, size | Point loads / posts (later) |

Curved walls (`curveOffset ≠ 0`): tessellate into straight segments ≥ stud spacing and
frame each segment (v1 may simply skip them with a badge in the panel).

## 2. Product surface

One left-rail panel (**Bones**) + derived 3D geometry + inspector. Four moments:

1. **Frame it** — one button: *Frame this house*. Runs inference on every level and
   shows the skeleton overlaid on (or instead of) the finished house.
2. **X-ray** — opacity slider for the architectural shell (0 = skeleton only,
   1 = house as normal, skeleton hidden). Implemented plugin-side by rendering framing
   on top; true shell-hiding is a host affordance we emulate with per-kind visibility
   toggles first.
3. **Tune** — spacing (16"/24" o.c.), plate count, header stock, lumber species color.
   Changes rebuild the affected framing live.
4. **Count** — the takeoff table: every member the engine generated, grouped by
   nominal size × stock length, with board feet. Copy as CSV/Markdown.

Loose lumber placement (`bones:lumber`, shipped in v0.1) stays: it's the manual
escape hatch and the debug tool for the inference engines.

## 3. Framing engines

Deterministic, pure functions: `(scene slice, config) → FramingMember[]`. A member is
`{ role, size, length, transform, levelId, sourceId }` — `sourceId` ties every stick
back to the wall/slab/roof that produced it (hover a stud → its wall highlights, and
takeoffs can group by source). Pure functions = unit-testable with no canvas, exactly
how Pascal's own geometry/floorplan contracts work.

### 3.1 Wall framing (M1)

US platform framing, per wall, in wall-local coordinates (X along the wall,
origin at `start`):

- **Bottom plate** (one) + **top plates** (double by default, single configurable) —
  plate stock matches wall stud size.
- **Studs** at `studSpacing` o.c. (default 16" = 0.4064 m; 24" configurable), first
  stud at x=0, last stud at wall end regardless of spacing remainder.
- **Stud size from wall thickness**: wall `thickness` ≥ 0.13 m → 2x6, else 2x4
  (the standard 2x6-exterior / 2x4-interior practice; overridable per wall).
- **Corners**: naive v1 — both walls run their full stud layout (double-count at
  corners is acceptable for v1; California corners are an M6 refinement).
- **Stud height** = wall height − plate stack thickness.

### 3.2 Openings (M1)

For each door/window child of a wall:

- **King studs** flanking the rough opening (full height).
- **Trimmers (jack studs)** under each header end.
- **Header** spanning the opening, auto-sized by clear span (IRC R602.7-flavored
  fallback table):
  ≤ 24" → 4x4 · ≤ 36" → 4x6 · ≤ 60" → 4x8 · ≤ 84" → 4x10 · else 4x12, flagged
  "engineered beam required" past ~10 ft (garage doors). Overridable per opening.
- **Cripples** above the header (and below the sill for windows) continuing the
  common-stud rhythm.
- **Sill** (single flat 2x, windows only).
- Studs whose position falls inside a rough opening are removed and replaced by the
  opening set.

### 3.3 Floor framing (M2)

Per slab that has a storey below (or a raised-floor config):

- **Joists** at `joistSpacing` o.c. spanning the short direction (auto direction,
  overridable), sized by span from a small IRC-flavored table (2x8/2x10/2x12).
- **Rim joists** around the slab perimeter; **girder + posts** when span exceeds the
  table (flagged, not engineered).
- **Blocking** rows at mid-span (visual).
- Slab-on-grade levels get no wood floor — they get foundation treatment (3.5).

### 3.4 Roof framing (M3)

Read `roof` / `roof-segment` planes:

- **Rafters** (default 2x6 @ 24" o.c.) laid along each roof plane's fall line,
  mitered at plate and ridge.
- **Ridge board** along plane intersections at the top; **hips/valleys** along
  sloped intersections.
- **Ceiling joists** (2x6 @ 16" o.c.) across the top plates; **collar ties** between
  opposing rafter pairs.
- Overhangs/eaves from the roof node's overhang parameter; fascia later.
- This is the hardest geometry (plane intersection classification). M3 v1 targets
  gable + hip; dormers/valleys flagged best-effort.

### 3.5 Foundation & concrete (M4)

- **Slab-on-grade**: slab edge thickening (footing profile) under exterior walls,
  rendered concrete-gray; **mudsill** (P.T. 2x, tinted green) between concrete and
  bottom plate, with anchor-bolt markers at code-ish spacing (6 ft o.c., ≤ 12" from
  ends).
- **Stemwall** option: perimeter stem + footing, wood floor platform above (ties into
  3.3).

### 3.6 Takeoff (M5)

Counted from the generated members — never re-estimated:

- Group by nominal size; lengths rounded up to stock (8/10/12/14/16/20 ft);
  board feet = dressed w×h×L. Per-level and whole-house tables.
- Sheathing/drywall sheet counts from wall/roof areas (later).
- Exported as CSV / Markdown from the panel.

## 4. Data model — derived, not persisted

**Members are never stored in the scene.** Persisting thousands of studs would bloat
project JSON and desync the moment a wall moves. Instead:

- One **`bones:framing`** config node per level (created by *Frame it*): spacing,
  plate count, on/off per engine, per-source overrides (keyed by wall/opening id).
  Small, undoable, serializable — survives save/reload like any node.
- A **`system` contribution** (same mechanism the Nature plugin uses for instanced
  trees) subscribes to walls/slabs/roofs + config, recomputes affected members
  (memoized per source node), and renders them as **`InstancedMesh` per cross-section
  profile** — a whole house is ~10 draw calls.
- Uninstalling the plugin therefore leaves only the tiny config nodes behind
  (Pascal preserves plugin nodes on uninstall by design).

Kinds shipped over time: `bones:lumber` (v0.1), `bones:framing` (M1),
`bones:foundation` maybe folded into framing config.

## 5. Settings & override hierarchy

Override hierarchy: **opening > wall > level > house**. The panel edits
house/level defaults; the inspector on a selected wall/opening (via the framing
node's parametrics + `sourceId` picking) edits per-source overrides.

Defaults: 16" o.c. studs · double top plate · header table above · 24" o.c. rafters ·
16" o.c. joists. Units: stored metric (Pascal convention), displayed imperial-first
in the panel (`16" o.c.`, `2x4`) because framing vocabulary is imperial.

## 6. Milestones

| # | Deliverable | Definition of done |
|---|---|---|
| **v0.1 (tonight)** | Repo, logo, loadable plugin, `bones:lumber`, panel, spec | Panel shows in Pascal; can place/edit/save/reload lumber members |
| **M1** | Wall framing + openings inference | *Frame it* on a 1-storey house: plates, studs, kings/trimmers/headers/cripples/sills correct on axis-aligned + angled walls; live rebuild on wall edit |
| **M2** | Floor framing | Joists/rim/girder on multi-storey houses |
| **M3** | Roof framing | Rafters/ridge/hips on gable + hip roofs; ceiling joists, collar ties |
| **M4** | Foundation | Slab edge/footings, mudsill, anchor bolts |
| **M5** | Takeoff | Lumber table computed from generated members, CSV export |
| **M6** | Polish | California corners, blocking, curved walls, per-member hover→source highlight, X-ray shell fade |

## 7. Non-goals (v1)

- **Not engineering.** No load calcs, no shear/braced-wall design, no stamped
  anything. Every output is a visualization/drafting aid.
- No electrical/plumbing/HVAC (Pascal has native nodes for some of this already).
- No 2D framing plan sheets (floorplan contribution exists in the API — a later
  milestone once 3D is right).
- No metric framing standards (CLS/CS lumber) — US dimensional lumber only for now.

## 8. Risks

- **Roof geometry** is the hard part; scope M3 to gable+hip first.
- **Wall-join topology** (which walls meet where) must be derived from endpoints
  within tolerance; Pascal has miter logic internally but it's not all public —
  re-derive from `start`/`end`.
- **Performance**: full-house recompute must stay incremental (memoize per source
  node) to keep dragging a wall smooth.
- **API v1 limits**: no new host stores; X-ray "hide the drywall" may need a host
  affordance — emulate first, upstream a proposal later.
