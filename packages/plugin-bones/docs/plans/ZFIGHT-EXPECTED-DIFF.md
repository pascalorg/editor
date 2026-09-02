# DUCT×EQUIPMENT Z-FIGHT — expected diff (fix/duct-zfight, 2026-08-23)

Day-9 exhibit (Julien screenshots): striped color oscillation where the
supply trunk meets the AH/plenum stack. Root cause: coplanar face pairs at
duct/equipment junctions — the junction VERTICALS carried exactly the
section of the run connecting into them (matched side planes) and capped
exactly ON the run's center plane (matched cap planes). Fix:
`DUCT_JUNCTION_BURY` (5 mm) in src/engines/hvac.ts — junction verticals
grow 2×BURY across the section (runs bury ≥5 mm inside their sides) and
their caps leave the run's center plane (plenum class +BURY past, boot
collars 2×BURY short). Gate: src/engines/hvac.junctions.test.ts (sweep +
pins + 5 mutation probes).

## THE FAMILY (discovery sweep, all duct/plenum/AH/equipment contacts)

Coplanar SAME-normal (z-fight class) — ALL FIXED:
1. supply trunk × plenum stack (trunk riser): a full-width 14" trunk
   leaving the plenum shared BOTH side planes with the riser (Julien's
   exhibit); FIXED by the riser's 2×BURY section grow.
2. plenum riser cap × register boot cap at trunkY — the equipment room's
   own register drops AT the stack's plan point (utility/laundry AH), caps
   coplanar, the striped patch ON TOP of the stack; FIXED by cap
   differentiation (+BURY vs −2×BURY; signs flip with soffit routing so the
   planes stay distinct in both modes).
3. 6" branch × register boot: matched sections, side planes coincident on
   both sides of every takeoff drop; FIXED by the boot grow.
4. return trunk leg × return riser (grille) and × return drop (AH): the
   same emission pattern on the return side; FIXED by the return-vertical
   grow + cap burial.
5. whip conduit drop × whip run at the disconnect (matched 16 mm): FIXED by
   the drop's section grow (caps already buried: top in the disconnect box,
   bottom on the run's center plane).

Separated / buried — no change needed (enumerated for completeness):
- trunk feed + branch ends terminate at the receiving vertical's plan
  CENTER (buried ≥ half a section — the terminating-INTO convention);
- line-set stubs + whip run end at the condenser cabinet's plan center
  (buried ≥ 175 mm from every cabinet face — the precedent class);
- exhaust/dryer WALL terminations end on the exterior wall CENTERLINE
  (buried 57 mm inside the wall body); the bath-fan fixture sits 13 mm off
  the exhaust duct (separated);
- cabinet-on-pad: ANTI-normal coincident seating faces (legal stacking
  contact, backface-culled — physical truth);
- trunk step-down seams + opposed branch tees: ANTI-normal abutments
  (legal S1 connections, backface-culled).

PRE-EXISTING CROSS-COLOR RESIDUAL — allow-listed, NOT fixed here (round-1
verdict F1; the day-8 queued "lineset×dryer-duct BORE" owns the fix): in a
laundry equipment room the dryer exhaust and the line-set coil stub both
run equipAt → the SAME nearest-wall anchor, so the ⅜" liquid line rides
COAXIALLY INSIDE the 4" exhaust body (2 m on the M3 doorwayPlan compose)
and their END CAPS land on one plane with ONE normal at both ends (gap
0.0, the liquid cap inside the exhaust cap). This is the sweep's ONLY
cross-color coplanar pair — duct gray × liquid warm-red, the class that
visibly stripes in two colors. The junction sweep composes the doorway/
laundry scene (attic + soffit), allow-lists exactly this pair, and PINS it
present (hvac.junctions.test.ts `allowedPair` + the symptom test) so the
allowance dies with the bore fix instead of going stale.

Out of scope (same-run seams — one sourceId, one color bucket: identical
fragments cannot oscillate; board-noted):
- Manhattan elbow corners (return legA×legB, exhaust elbows) share
  top/bottom planes over the corner square;
- line-set stub × route-leg corners at the wall penetration (same pipe).

NEW FINDING (not fixed here, board-noted): bathroom supply REGISTER and
exhaust-FAN fixtures render as two near-coincident placeholder boxes at the
same ceiling point (register 2.46 vs fan 2.45 center height, identical
renderer dims, different colors) — a fixture×fixture near-coincidence
class, separate emission ownership (fixture placement, not duct geometry).

## CAUSATION CAVEAT (round-1 verdict F2)

Every pair the burial FIXED was same-color-bucket: two coincident faces of
one instanced color produce IDENTICAL fragments, which cannot stripe in
two colors — the same rationale that scopes the elbow-corner seams out.
The burial therefore closes the coplanar-geometry class as HYGIENE (and it
is the right physical model: ducts connect INTO plenums), but Julien's
TWO-COLOR striping most likely comes from a CROSS-COLOR mechanism.
Candidates, in likelihood order:
1. the dryer×line-set coincident caps / coaxial bore (the allow-listed
   residual above — duct gray × warm red, laundry equipment rooms);
2. the bath register×exhaust-fan fixture near-coincidence (yellow × gray);
3. a host hover/selection tint compositing over the duct at the junction.

DAWN VISUAL ROUND — verification block (run on the MERGED tip):
- open Julien's day-9 scene, reproduce the screenshots' camera (the supply
  trunk at the AH/plenum stack, X-ray mode);
- confirm the striped oscillation at the junction is GONE;
- if striping persists, identify WHICH cross-color pair it is: hide the
  line-set (candidate 1), hide the fixtures (candidate 2), then toggle
  hover/selection off (candidate 3) — and queue the owning fix (the bore
  relocation for 1, fixture placement for 2, host tint for 3). Do not
  re-open the burial: the junction sweep proves the duct-geometry class
  is closed.

## EXPECTED BYTE MOVEMENT (every hvac scene)

Member classes (labels all byte-stable — inch rounding absorbs 0.39"):
- `Trunk riser 14"×8"`: dims +10 mm both section axes; length +5 mm
  (cap trunkY+BURY); center y +2.5 mm.
- `Supply boot 6"` (×N registers): dims +10 mm both axes; length −10 mm
  (cap 2×BURY short); center y −5 mm (attic; soffit mirrored).
- `Return riser 14"×8"` / `Return drop 14"×8"`: dims +10 mm both section
  axes; length +5 mm; center y ±2.5 mm.
- `Condenser whip` vertical: dims 16 mm → 26 mm; length/position unchanged.
- Plan (x/z) positions: byte-identical everywhere. Horizontal runs:
  byte-identical. Fixtures + warnings: byte-identical.

E5 master-baseline recaptured: 563 members / 47 fixtures per jurisdiction
(counts unchanged); INTL and TX move identically — exactly 7 members each
(1 riser, 3 boots, return riser, return drop, 1 whip drop).

Takeoff: section names byte-stable (inch rounding). Two lf rows move by one
0.1-lf rounding step on the baseline scene, both jurisdictions identically:
- `Duct 6" round` 29.7 → 29.6 lf (three boots × −10 mm);
- `Return duct 14×8"` 14.2 → 14.3 lf (riser + drop × +5 mm).
`Duct 14×8"` absorbs the supply riser's +5 mm (rounds).

Keep-out model deliberately UNGROWN (RETURN_VERT_HALF, supply-spine
obstacle halves): the 5 mm grow spends from the 50 mm DUCT_CLEAR_GAP
margin — worst case BOTH bodies of a keep-out pair are grown (boot emits
0.0812 half, return vertical 0.1828) against the 0.0762 + 0.1778 + 0.05 =
0.3040 enforced center distance ⇒ ≥ 40 mm of true clearance remains — so
grille/drop elections, and every position byte, stay put. Stated in-file.

Suite 1703 → 1715 (junction gate +12: sweep matrix incl. the doorway/
laundry compose, burial pins, 5 mutation probes, the bore-symptom pin).
Manual-J sizing gates untouched; starter-template untouched; hvac.return
section pin updated to state the new vertical convention (+2×BURY).
