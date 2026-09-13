# Round 13 — Wall assemblies + dollhouse X-ray semantics

Product owner's spec (2026-08-14, verbatim intent):

1. **Camera semantics:** looking at an X-rayed wall, the NEAR drywall is
   removed; the cavity (studs, electrical, plumbing) is visible SOLID; the
   FAR side's drywall is the visible backdrop. "The wall is not
   transparent — the drywall I see is the one behind, not the one in
   front." This replaces the ghost-through-everything overlay for walls.
2. **Exterior walls are assemblies, not drywall-out:** interior gypsum →
   framing cavity (insulation) → structural sheathing → WRB (house wrap /
   felt — the "layer between outside and inside") → cladding. Options and
   requirements differ by jurisdiction/climate (WRB per IRC R703.2, vapor
   retarder class per R702.7 by climate zone, cladding families: vinyl,
   fiber cement, stucco, brick veneer w/ air gap, wood). Interior
   partitions: gypsum both sides (R702). Garage/dwelling separation needs
   5/8" Type X (R302.6). Never forget the difference between exterior and
   interior wall constructions.

## Design

### A. Assembly engine (`src/engines/wall-layers.ts`)
Pure: `(WallSlice, FramingSpec) → Member[]` with new roles `drywall`,
`sheathing`, `wrb`, `cladding` (+ `insulation` batt boxes at LOD 400).
Layers stack OUTWARD from the framing envelope (drawn wall = stud
envelope): interior face +1/2" gypsum (5/8" Type X on garage-separation
faces), exterior face +7/16" OSB + WRB membrane (thin box, 1/16" render
thickness) + cladding by spec (`claddingType`: vinyl 3/4" | fiberCement
5/16" | stucco 7/8" (3-coat over lath) | brickVeneer 3-5/8" + 1" air gap).
Openings punch through all layers (reuse RO geometry). Jurisdiction layer:
climate-zone → vapor retarder class note + insulation R-value; region →
default cladding; HVHZ (FL) → sheathing nailing note. Data files:
`data/wall-assemblies.json` (+ research doc with citations).

### B. Dollhouse rendering (renderer.tsx)
- Per-wall-face layer instancing with camera-dependent visibility: hide a
  face's layer stack when `dot(faceNormal, faceToCamera) > 0` (the near
  face), show when pointing away (the far face backdrop). Rebuild/toggle on
  quantized camera azimuth via useFrame — instanced buckets keyed by
  (layerType); instance lists refreshed when the visible-face set changes.
- Framing/MEP members stay solid scene-layer (current behavior, occluded
  properly by trees etc.).
- The ghost overlay pass DROPS for walls: with modeled far-face drywall as
  the backdrop, wall content must occlude naturally. (Ghost may stay for
  foundation-below-grade visibility only — evaluate.)
- Host wall meshes: evaluate `material.side = BackSide` mutation while
  X-ray is active (box walls then show only their far faces = free
  dollhouse for the HOST shell too); must restore on toggle-off and
  coexist with the host cutaway system. If too invasive, Bones' own layers
  simply sit outside the host planes (they add real thickness, so no
  z-fight) and the host's cutaway handles its own faces as today.

### C. Tests
- Engine: layer stack order/thicknesses per wall type (exterior vs
  interior vs garage-separation), climate-zone vapor/insulation notes,
  opening cutouts, takeoff lines (drywall sqft, sheathing sheets, WRB
  sqft, siding sqft — R703 citations in labels).
- Gate: layers join the interpenetration matrix (no layer×layer or
  layer×framing overlaps; insulation allowlisted against studs? NO —
  insulation fills BAYS, between studs).
- Renderer: per-face bucket census bounded; near-face hidden/far-face
  shown given a camera vector (pure helper `visibleFaces(camDir, walls)`
  unit-tested).

### D. Open research (workflow launched 2026-08-14)
Per-jurisdiction: WRB alternatives + climate-zone vapor retarder classes,
regional cladding defaults, HVHZ/WUI/termite overlays, Type X where
required. Output feeds `data/wall-assemblies.json`.
