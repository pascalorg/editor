# Bones LOD Rubric

*The scoring contract for the adversarial review loop. A system's score is the
HIGHEST level for which EVERY criterion is met with evidence (code + test).
Levels are cumulative: 400 requires everything in 300 and 200.*

## What LOD 400 means for Bones (scope definition)

Bones is a real-time editor plugin, not a shop-drawing generator. LOD 400
("fabrication") here means: **every member, connection, and routing decision a
framer/electrician/plumber would need is present and correct in the derived
model — as geometry where geometry is the medium (members, hardware, routes)
and as data where data is the medium (cut lengths, fastener schedules,
circuit assignments — surfaced in labels/takeoff, not as nail meshes).**
Literal fastener geometry is explicitly OUT of scope; fastener *quantities*
and connection *hardware* (hangers, ties, straps, washers) are IN scope.

Two hard invariants at every level — violations cap the score at 200:
- **UI simplicity**: the panel stays one column, no new required inputs; every
  400 feature must work with zero extra clicks (gated by the existing
  Generic/Code/Fab selector or derived automatically).
- **Performance**: full-level recompute stays under ~50ms for a 20-wall house
  (measurable in a bun test with `performance.now()`), rendering stays
  instanced (draw calls ~ color buckets, not member count).

## Per-system criteria

### Wall framing (lumber)
- **200**: plates, studs at o.c., openings framed (kings/trimmers/header/sill/cripples).
- **300**: header sized by span table; stud size from wall thickness; spacing honored; jurisdiction pass applied.
- **350**: corner assemblies where walls meet (California/U/3-stud — not doubled-up naive overlap); partition backing where interior walls tee into walls; double trimmers on openings > 6 ft; double top plate lap at corners (cap plate offset).
- **400**: rough openings honor host `roughOpening*` fields exactly; fire blocking rows in walls over 10 ft plate height (IRC R302.11); plate splice positions marked (labels) with min 24" lap; fastening schedule DATA per connection type (R602.3(1)) surfaced in takeoff (nails by type + lbs); every member's cut length exact in takeoff cut list.

### CMU walls
- **200**: running-bond coursing, cut jambs, lintels, bond beam.
- **300**: block depth from wall thickness; lintel bearing ≥8"; bond-beam-as-lintel suppression.
- **350**: grouted-cell VERTICAL REBAR geometry at ends/corners AND at code o.c. (48" typical) and at opening jambs; horizontal bond-beam bars.
- **400**: corner interlock (courses alternate through the corner, no double-stack); grout volume + rebar length/count in takeoff; mortar bag count.

### Floor framing
- **200**: joists spanning short direction, rim joists, blocking row.
- **300**: depth from span table; polygon clipping; girder + posts past the table.
- **350**: joist HANGERS at girder-face and flush-header connections (hardware members); doubled joists under parallel bearing walls above; holes in the slab (stairwells) framed with headers + doubled trimmers.
- **400**: subfloor sheet count (4x8 T&G) in takeoff; hanger model/count in takeoff; rim-to-joist fastening data; bearing lengths validated (≥1.5" — flag when a joist ends unsupported).

### Roof framing
- **200**: gable + shed rafters, ridge, ceiling joists, collar ties.
- **300**: hip (hips + shortened ridge + commons); rafter size from spec; hurricane ties in high-wind specs; overhang geometry.
- **350**: JACK RAFTERS on hip end planes; gambrel + dutch + mansard + flat framed (flat = joist-style with rim); valley members where two segments intersect; outlookers/rake framing on gable overhangs.
- **400**: birdsmouth (seat + heel cut data: HAP, seat depth) and plumb-cut data per rafter in labels/takeoff cut list; ridge/hip/valley cut angles listed; fascia + sub-fascia members; rafter ties vs collar ties distinguished per code; fastening schedule (toenails/ties) in takeoff.

### Foundation
- **200**: footing + stemwall under exterior walls, anchor bolts.
- **300**: frost-driven depth, R403.1.6 bolt layout, seismic hold-downs, slab edge.
- **350**: footing CORNER CONTINUITY (runs extended/mitered so corners are monolithic — no gaps or double-pours at corners); interior thickened footings under bearing walls (walls that carry girder posts or a storey above); REBAR: 2×#4 continuous in footings, verticals at stemwall per SDC.
- **400**: plate washers (3x3) in SDC D geometry at each bolt; concrete volume split footing/stem/edge in takeoff + rebar linear feet + bolt/washer counts; stemwall step-downs flagged on sloped sites (or documented N/A for flat levels).

### Electrical
- **200**: receptacles per NEC spacing, switches at doors, lights per room, panel.
- **300**: GFCI by room type; smoke alarms per R314; doorway breaks; face-correct placement.
- **350**: CIRCUITING — every device assigned to a circuit (2 kitchen SABC 20A, bath 20A, laundry 20A, lighting/general by 3VA·sqft, AFCI where required); panel schedule derivable (takeoff rows per circuit with device counts + est. VA); 3-way switching for rooms with 2+ doors and hallways.
- **400**: HOMERUN + branch wiring routes as geometry — wall-following runs at drill height through studs, up/down to devices, converging on the panel (Manhattan, schematic-straightness acceptable inside a wall run but no diagonal air-crossing); wire gauge per circuit (14/12 AWG); total NM cable length by gauge in takeoff; box count by type.

### Plumbing
- **200**: vent stack, schematic drains/supplies, stub-outs, water heater, cleanout.
- **300**: sizes per dataset (3" main / 2" branch / supply sizes); rough-in heights; wet-wall selection logic.
- **350**: WALL/FLOOR-FOLLOWING routing (Manhattan along walls, no diagonal air runs); drain SLOPE rendered (1/4"/ft on horizontal runs); trap arm per fixture within code length; vent reconnect above flood rim.
- **400**: fixture-unit-based drain sizing check (flag undersized); supply runs split hot/cold with water-heater loop; pipe length by size/material in takeoff; fitting count estimate (elbows at each bend).

### HVAC
- **200**: equipment, registers per room, straight trunk + branches, return, thermostat.
- **300**: tonnage from conditioned area (labeled rule-of-thumb); service-space equipment placement.
- **350**: Manhattan duct routing (trunk along a hallway/corridor axis, branches at right angles); register cfm sized from room area (cfm/ton split proportionally); trunk size steps down after takeoffs; bath exhaust fans + dryer vent (laundry) with exterior terminations.
- **400**: duct length + fitting counts in takeoff; condensate drain from air handler; refrigerant lineset from equipment to an exterior pad location; return sized (grille area) vs tonnage; supply/return balance flag when short.

### Takeoff
- **200**: piece counts. **300**: stock rounding, bd-ft, yd³, devices with code citations.
- **350**: per-SYSTEM sections; sheathing/subfloor/drywall sheet counts; hardware (hangers/ties/washers) lines.
- **400**: fastener schedule (nails by type/size in lbs from the R602.3(1) data + member counts); cut list export (every member: size × exact cut length × qty, grouped); rebar/grout/mortar; wire by gauge, pipe by size, duct by size; CSV sections match.

### UI / UX / Performance (cross-cutting gate)
- Panel remains one column; Generic/Code/Fab is the only LOD control; per-system toggles unchanged; no modal dialogs; takeoff stays scannable (collapsible sections allowed).
- Recompute p95 < 50ms @ 20 walls / < 150ms @ 60 walls (perf test exists and passes).
- Draw calls stay O(color buckets). No per-member React components.
- Warnings surfaced, never blocking.

## Evidence standard

A criterion counts ONLY if the reviewer can point at: (a) the implementing
code (file:line), (b) a test that would fail if it broke, and (c) for
geometry — a numeric assertion (position/length/angle), not a count. "Code
exists but untested" scores at most HALF a level up from the last fully
evidenced level.
