# CMU FACE BURY — expected diff (fix/cmu-face-bury, 2026-08-23)

Prod report (product owner): a CMU wall (Bones per-wall construction
override) painted with ANY host material — even a flat white color —
flickers/z-fights, camera-angle dependent, "displays both textures at
once". Root cause (verified at base 1719674): block outer faces sat
EXACTLY on the host wall's drawn face planes — `depth =
min(wall.thickness, BLOCK_DEPTH_ACTUAL)` (cmu.ts) with the host default
thickness 0.1 m < the 7-5/8" unit (0.193675) clamps depth to the drawn
thickness, so the block faces land at ±t/2 = the host's face planes. The
unpainted case only LOOKED clean because activation sets host wallMode
'down' → the host face renders transparent + depthWrite:false
(depth-silent); painting swaps an OPAQUE material back onto the host
face and the two planes contest the depth buffer.

FIX (plugin-only, kills the coplanarity in every mode/paint state):
`CMU_FACE_BURY = 0.005` (the DUCT_JUNCTION_BURY precedent, hvac.ts) —

    depth = min( max(t − 2·CMU_FACE_BURY, t/2), BLOCK_DEPTH_ACTUAL )

Every CMU face now sits ≥ the bury strictly inside the drawn planes
(walls ≥ 4×bury), in every mode and paint state. NOTE the host-side
self-healing gap (paint-preview restore + React material re-application
being suppression-unaware, WallCutout re-stomping only on its throttled
camera trigger) is a SEPARATE host follow-up — this fix makes the
geometry immune to it, for CMU walls, regardless of when the host lands.

## DELTA CLASSES (everything that moves, and everything that must not)

1. CMU member DEPTH dims (`dims[2]`: blocks, lintels, bond beam) on every
   wall thinner than BLOCK_DEPTH_ACTUAL + 2·bury (0.203675 m):
   - host default 0.1 m → 0.09 (was 0.10)
   - 0.15 m → 0.14 (was 0.15)
   - 0.2 m → 0.19 (was 0.193675 — the 7-5/8" unit no longer fits buried)
   - nominal-8" 0.2032 m → 0.1932 (was 0.193675; its natural clearance was
     half a mortar joint = 4.76 mm, 0.24 mm short of the bury)
   - ≥ 0.203675 m → BYTE-EQUAL (the true 7-5/8" unit, natural clearance
     ≥ the bury by construction — today's behavior preserved).
2. POSITIONS: block/lintel/bond-beam centers do NOT move (all centered on
   the wall centerline, v = 0). The ONLY moving positions are the
   bond-beam horizontal #5 bars: their 2" clear cover measures off the
   BURIED faces, so their across-wall offsets shrink with the depth
   (0.2 m wall: ±0.046037 → ±0.0442; 0.15 m: ±0.0242 → ±0.0192).
3. BEAM-BAR COUNT threshold class: two bars require depth/2 − 2" >
   REBAR_SIZE, i.e. t > 0.13335 before / t > 0.14335 after — walls in
   (0.13335, 0.14335] drop from two bars to one centered bar (Rebar lf
   shrinks by one wall length there). No standard thickness (0.1 / 0.15 /
   0.2 / 0.2032 / ≥0.203675) crosses the boundary; counts pinned.
4. TAKEOFF: CMU block pcs, Mortar bags, Grout yd³ (reinforced-cell count)
   and Rebar lf derive from counts and LONG dims — BYTE-EQUAL, pinned in
   takeoff.test.ts against the pre-bury capture (115 pcs / 6 bags /
   0.5 yd³ / 43.8 lf on the 4 m × 0.1 m exhibit wall). The one row that
   legitimately moves is the CONCRETE pour (lintels/beams): pours book
   yd³ from member VOLUME (S4 member-truth), and the buried beam is
   thinner — on the exhibit wall the net still prints 0.1 yd³ but the +5%
   buy figure drops '≈ 0.2 yd³' → '≈ 0.1 yd³' and gains the sub-batch
   display-collapse note (both pinned). Deviation from the brief's
   "takeoff byte-unchanged" stated honestly: the volume-derived pour row
   is member-truth BY DESIGN and follows the real geometry.
5. WARNINGS: byte-equal everywhere. The only new text is the
   THIN_BURY_FLAG member flag ('wall too thin for the CMU face bury —
   blocks floored at half the drawn thickness; verify') on the bond beam
   of sub-2 cm walls — UNREACHABLE via the host UI (the wall panel clamps
   thickness ≥ 0.05 m), raw-API scenes only. It composes ' | ' with the
   mixed-wall seam-crossing flag (B1 convention).
6. mixedWallInsets: BYTE-EQUAL — `ownWidth` deliberately keeps the
   UN-buried block width (the retreat only has to clear the neighbor's
   face and the real block is strictly narrower; over-retreating by
   ≤ bury·|cosθ| terms is the safe direction). Verified: full mixed-wall
   + interpenetration suites green unmodified.
7. cmuDowelPositions / barTop: BYTE-EQUAL (u/y layout only, no depth
   term); foundation dowel geometry untouched.
8. E5 BASELINE: the master-baseline corpus (INTL + TX, 563 members each)
   contains NO CMU walls — zero block/bond-beam/lintel/mudsill roles;
   recaptured under the bury and diffed BYTE-IDENTICAL (no pin churn).
   The end-to-end truth therefore lives in the NEW computeLevel CMU scene
   gate (cmu.test.ts: host-default-thickness shell, 3 full-CMU walls +
   1 mixed knee wall at detail 400 — every member swept strictly inside
   its own wall's planes).

## THINNEST-WALL BEHAVIOR (the degenerate guard)

The thinnest wall the host UI can draw is 0.05 m (wall-panel.tsx clamps
`Math.max(0.05, v)`; the plugin schema itself is unconstrained). At
0.05 m the full bury holds cleanly: depth 0.04 m, faces 5 mm inside each
plane, no flag. Below 4×bury = 0.02 m (raw-API only) the full bury would
take half the wall or more, so depth FLOORS at t/2 — the bury degrades to
t/4 per side, still strictly inside, blocks never vanish (depth > 0 for
any t > 0) — and the bond beam carries THIN_BURY_FLAG instead of silence.
Known garbage-in residual, pre-existing at every thickness < the bar
size: a 5/8" rebar member is physically deeper than a sub-16 mm wall
(the steel, not the masonry — excluded from the degenerate sweep with a
comment).

## GATES (all in the fix commit, mutation-checked)

- Coplanarity detector (cmu.test.ts 'CMU face bury' describe): default
  0.1 m wall (with an opening — blocks + lintel + bond beam + rebar all
  swept), thinnest host wall 0.05 m, degenerate 0.015 m (floor + flag +
  never-vanish), mixed knee wall (both zones + sill + bolts + studs),
  perpendicular corner-interlock pair (both walls' own frames), and the
  computeLevel scene gate above. Every member: |v-center| + dims[2]/2 ≤
  t/2 − CMU_FACE_BURY.
- Takeoff pins (takeoff.test.ts 'CMU face bury' describe): the four
  count/length rows byte-equal to the pre-bury capture + the pour-row
  member-truth exhibit.
- Moved pins updated deliberately (cmu.test.ts): the depth-clamp test
  (0.2 → 0.19, 0.15 → 0.14, NEW ≥0.203675 preserved-behavior arm) and the
  beam-bar clear-cover offsets (±0.0442 on the 0.2 m wall).
- MUTATION RECORD (probes from /tmp backups, restored byte-identical):
  (P1) revert the bury (`depth = min(t, BLOCK_DEPTH_ACTUAL)`) → 9 gate
  deaths across cmu + takeoff; (P2) drop the t/2 floor → degenerate arm
  dies; (P3) never set thinBuryFloor → flag pin dies.
- Suite 1743 → 1751 (1750 pass + 1 todo), tsc clean, at every commit.

## NAMED RESIDUAL — the u-direction END-FACE class (not fixed here)

Blocks shrink 3/8" in LENGTH, so their end faces always sit half a
mortar joint (4.76 mm) inside any plane of interest — immune. But the
BOND BEAM and LINTELS pad ±MORTAR_JOINT/2 to cancel the shrink (poured
elements show no joints), so their END faces land exactly on:
(a) the wall's own END planes (u = 0 / u = len) on corner-less walls —
    coplanar with the host wall box's END CAPS, and
(b) at a claimed CMU×CMU corner, the NEIGHBOR's drawn far-face plane
    (the interlock lays through to otherThickness/2).
These are course-height × depth rectangles seen edge-on (vs. the
reported full-wall face flicker) and need an end-bury with its own
corner-interlock pin move — queued, not forced into this fix.

## FRAMED WALLS — assessed, QUEUED (the same latent pair, not cheap)

Verified by probe at this tip: a framed wall's interior GYPSUM outer face
lands EXACTLY at ±t/2 (wall-layers.ts stackOrigin convention — 'the
interior gypsum's outer face lands flush with the drawn wall face',
round-14 by design; a room-less exterior wall carries the flush pair on
BOTH faces). A resurrected painted host face z-fights those exactly like
the CMU case. A 5 mm layer bury is NOT contained, for three structural
reasons:
1. The cavity-fit KEYSTONE identity: framing compresses to t − 1" so the
   compressed stud face == stackOrigin EXACTLY (contact-not-overlap is
   pinned, interpenetration.test.ts:419). Shifting the stack inward 5 mm
   drives the 1/2" gypsum INTO the stud faces (S1 violations on every
   framed wall at LOD 300+); avoiding that means either re-compressing
   ALL framing to t − 1" − 2×bury (every framing dim pin repo-wide + both
   E5 jurisdictions' 563-member baselines move) or THINNING the gypsum
   member 12.7 → 7.7 mm (member dims lie vs. their labeled product;
   batt-contact and layer-thickness pins move).
2. Pin blast radius even in the cheapest (thinning) variant: 38 flush-or-
   stacked layer members per E5 jurisdiction (drywall 14 / sheathing 8 /
   wrb 8 / cladding 8) + wall-layers.test.ts per-family thickness/offset
   pins + S6/S7 batt-cavity contact gates + the S9 family-member gates +
   interpenetration layer scenarios — a full baseline reset with its own
   expected-diff manifest and hunt round.
3. Visible x-ray cost: layers stop 5 mm short of the drawn face at every
   opening reveal and wall end — a visible host-wall lip in x-ray, which
   the CMU fix does not have (mortar-joint recesses read as intended).
DECISION: queued as its own loop item with this assessment; the host-side
suppression-aware repaint follow-up (the actual blinking mechanism) also
covers the framed symptom when it lands, so the plugin-side layer bury is
not the urgent half there.

## POST-VERIFY ADDENDA (round wf_193a3cd0, merge companion)

PAPER MIRROR (examiner REC-1 — the round's one over-claim): "every
sheet byte-equal except the pour buy cell" is the WEAK form only. On
CMU-bearing scenes the wall framing plan, all four elevations, Section
A-A and the cover axon also move — 100% numeric-only attribute drift
(zero text/element changes; max 1.5px at 1:25, 0.1px at 1:100; raster
diffs 0.004%–0.49%, invisible at print size) tracing 1:1 to member
delta classes 1–2 (the sheets draw the buried members — correct S4
member-truth). Zero-CMU scenes: all 18 sheets byte-identical.

CORNER BUTT-GAP CLASS (skeptic advisory, quantified): blocks slimmed
5mm/side widen claimed-corner BUTT joints by exactly the bury —
yielding-course block ends 4.76 → 9.76mm (≈ a full 9.5mm mortar
joint, visually defensible); bond-beam yielding end vs through-beam
face 0mm flush → 5.0mm air gap (poured elements have no mortar-joint
alibi), and the through beam stands 5mm proud of the neighbor's
blockwork face. X-ray-only visibility (inside the host wall volume in
solid/painted modes); no gated invariant regresses (S1 is
overlap-only). ABSORBED BY the queued u-direction end-face item: an
end-bury/end-extend treatment should close both the end-plane
coplanarity residual and this gap class together.

PRE-EXISTING, NOTED (examiner REC-3/4, not this fix): nominal
'8x8x16 running bond' takeoff detail names a unit that fits neither
drawn nor buried depth on sub-8" walls (byte-equal to base, pinned);
wall-sheet CMU coursing has no legend row.
