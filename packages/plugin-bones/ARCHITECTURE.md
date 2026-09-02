# Bones — Architecture

*How the engineering X-ray works. Written for contributors; assumptions called out
explicitly. See SPEC.md for the product roadmap and docs/research/ for sourced
domain research.*

## The one-sentence design

Pascal models **architecture** (walls, openings, slabs, roofs, zones, levels);
Bones **derives construction** from it — pure inference functions turn the scene
graph into framing members and MEP fixtures, rendered as instanced meshes, with
**only one tiny config node persisted per level**.

```
scene graph ──extract──▶ slices ──engines──▶ Members/Fixtures ──instance──▶ 3D X-ray
 (Pascal)    wall-model    pure     pure          derived           renderer
                │                                    ▲
                └── bones:framing config node ───────┘
                    (jurisdiction, spacing, toggles — the ONLY persisted state)
```

## Why derived, not persisted

Persisting thousands of studs would bloat scene JSON and desync the moment a
wall moves. Instead the `bones:framing` node (one per level) stores *how* to
derive — jurisdiction, stud spacing, LOD, per-system toggles, per-wall
construction overrides — and the renderer re-derives on every scene edit.
Delete the node → the X-ray disappears; the model is untouched. Undo works for
free because config changes go through the host's `updateNode`.

## Layers

| Layer | Files | Rules |
|---|---|---|
| **Extraction** | `src/core/wall-model.ts` | The ONLY code that reads Pascal node shapes (verified against host source: opening `position[0]` = center distance from wall `start`; doors floor-bound; windows carry center height). Produces plain `WallSlice`/`SlabSlice`/`RoomSlice` objects. |
| **Spec** | `src/core/spec.ts`, `src/jurisdiction/*` | `FramingSpec` = engine defaults ← jurisdiction profile ← user config. Profiles merge two researched datasets (`data/jurisdictions-*.json`, 51 states). |
| **Engines** | `src/engines/*.ts` | Pure `(slices, spec) → Member[]/Fixture[]`. No React, no Three.js, no store. Every engine has numeric bun tests. |
| **Assembly** | `src/framing/compute.ts` | Per-level orchestration: which walls are framed vs CMU vs skipped, which systems run, ground-level gating for foundation. |
| **Rendering** | `src/framing/renderer.tsx` | Members → one `InstancedMesh` per color bucket (a house is ~10 draw calls). `seeThrough` = depthTest off + late renderOrder — the skeleton reads through finishes. |
| **UI** | `src/panel.tsx` | The control room: X-Ray button, jurisdiction dropdown, LOD, spacing, system toggles, per-selected-wall construction override, takeoff. |

## Geometry conventions

- Everything is **meters**, level-local, Y up. Imperial only at the UI/label layer
  (`src/core/units.ts`).
- A `Member` is a box: `dims` [x,y,z] in its local frame, `position` = box center,
  `rotation` = XYZ euler. Wall members share one yaw: `atan2(-dz, dx)` maps a
  +X-aligned box onto wall direction `[dx, dz]` (three.js Y-rotation handedness).
- Wall-local frame: X along the wall from `start`, Y up, Z across thickness.
  Verticals (studs) are just taller-than-wide boxes — no extra rotation.

## Jurisdictions

- **Adoption is state-level** in the US (a few states delegate to counties —
  documented in `docs/research/code-adoption.md`); the values that move framing
  (frost depth, snow, wind, seismic) vary by site *within* a state. Bones ships
  **typical state-level values as defaults**, everything overridable.
- `AUTO` guesses with **zero network calls** (privacy contract: no external
  origins): IANA timezone → state (`America/Denver` → CO), locale region → INTL
  for non-US. It's a labeled suggestion, never authority.
- LOD `'200'` ignores jurisdiction (generic members); `'300'` applies the profile:
  frost → footing depth, SDC D+ → 4' anchor spacing + hold-downs, ≥130 mph → 
  hurricane ties, ≥50 psf snow → deeper rafters.
- **CMU default**: Florida exterior walls default to concrete block (the actual
  regional practice); every wall is individually overridable (framed/CMU/skip)
  via the panel with the wall selected.

## Assumptions (checked where possible, flagged where not)

1. **Wall child openings** use wall-local u from `start` — *verified* against the
   door floor-plan renderer in the host repo.
2. **Rough openings** default to nominal + 1.5" when the model doesn't set
   `roughOpening*` — standard shim allowance; the host fields win when present.
3. **Header bearing** = RO + two trimmer thicknesses; sizes from the simplified
   span table (IRC R602.7-flavored, researched in `data/framing-tables.json`).
   Past 10' → flagged "engineered beam required" (prescriptive tables end there).
4. **Corners** are framed naively (both walls run full layouts) — California
   corners are an LOD 400 refinement.
5. **Curved walls** are skipped with a panel warning (tessellation later).
6. **Room semantics** come from zone *names* (multilingual regex: kitchen/cuisine,
   bath/salle de bain…) — honest heuristic, drives GFCI/wet-wall/register logic.
7. **See-through rendering** draws the skeleton over everything (depth-test off).
   Objects in front of the house also get overdrawn — acceptable for an X-ray
   mode; a host-level shell-fade affordance is the eventual fix.

## Performance

- Whole-level recompute on any scene edit, memoized at the React level. A
  full house is a few thousand members; extraction + engines are O(n) with tiny
  constants (<5ms typical). If it ever hurts: memoize per-wall by content hash
  (`sourceId` exists for exactly that).
- Instancing keeps draw calls ~equal to the color-bucket count (~10), whatever
  the member count.

## Testing strategy

- **Engines**: numeric geometry assertions in bun (positions, rotations verified
  by rotating vectors, table lookups, code-rule counts like anchor-bolt spacing).
- **Manifest/registry**: kind lists, panel↔plugin identity.
- **Live editor**: headless Playwright against the standalone editor — draw
  walls, click X-Ray, assert member counts and screenshot (`/tmp/xray-*.png`
  during development; the flow is documented in NIGHTLOG.md).
