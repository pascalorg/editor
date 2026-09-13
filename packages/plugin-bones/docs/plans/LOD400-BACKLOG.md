# LOD-400 FIX BACKLOG — ranked, batched for the loop (2026-08-20)
All findings adversarially CONFIRMED via headless composes at detail '400' unless marked appendix. Loop rule per NIGHT-BOARD: each batch = implement green → skeptic + visual (+ examiner where paper moves) → gate per defect → ship. Batches ordered blockers → booked-vs-built integrity → life-safety/code majors → jurisdiction fidelity. Byte-equality note per batch because most of these move default output (expected-diff manifest like cavity-fit night-4 where flagged).

## BATCH 1 [BLOCKER] Header truth — the booked 4x8 that geometry says can't exist
Files: src/engines/wall-framing.ts frameWall() header block (roTop clamp line 254, headerDepth=min(hw, studTop−roTop) line 260).
Repro: 2.4 m door in 2.5 m wall → 'Header 4x8 over door' dims [39.9", 1.50", 3.5"] — a 1.5" flat board — while takeoff/cut list book a full 4x8/8 ft stick. RO top also silently pulled 2.40→2.386 m (drawn door no longer fits its own RO). IRC R602.7/Table R602.7(1).
Fix shape: mirror the existing compressionFlag — (a) flag when headerDepth < prescriptive hw ('header does not fit between RO and plates — raise wall / lower opening / engineered flat header'), (b) flag the RO-height clamp like the horizontal roClampFlag. Geometry stays honest; flags surface via P4. Decide: takeoff keeps nominal stick (flagged) — do NOT let it silently book the sliver.
Gate: wall-framing.test.ts tall-door scenario (dims + both flags); P4 print pin.
Blast radius: flags only on crowded-RO walls; everything else byte-equal. Smallest batch — ship first.

## BATCH 2 [BLOCKER] Roof span discipline — wire the shipped-but-dead span tables
Files: src/engines/roof-framing.ts (frameGable ~380, frameShed, frameHip, frameFlat ~889, frameGambrel), src/core/spec.ts (add rafterSpans/ceilingJoistSpans), src/jurisdiction/profiles.ts, data/framing-tables.json (currently imported by NOTHING).
Repro: 10×12 m gable @40°/2x6/24" → 40× 8.09 m (26.5 ft) rafters, zero flags, takeoff books '20 ft stock (field splice)' ×136 — a field-spliced common rafter is not a structural member. Same class: 12 m one-piece ceiling joists, 10.7 m flat-roof joist. IRC R802.4.1/R802.5.1.
Fix shape: plumb framing-tables.json → FramingSpec via applyJurisdiction (keyed on groundSnowLoadPsf band, mirroring how rafterSize already moves); in each frame* either emit purlin + 2x4 strut rows (≤4' o.c. to bearing, R802.5.1) or at minimum the floor-engine-style over-span member flag. Floor engine is the pattern to copy (joistSpans + girder insertion + residual flag).
Gate: roof-framing span matrix (over-span flags fire; purlins/struts present + booked; small roofs unchanged); takeoff no longer books field-splice rafter sticks unflagged.
Blast radius: new members/flags on large-span roofs; compact roofs byte-equal. Biggest structural batch of the set — own iteration, do not co-batch.

## BATCH 3 [BLOCKER] Subfloor member — the pure S4 booked-but-absent
Files: src/engines/floor-framing.ts frameSlab (no deck emit), src/framing/compute.ts:863-878 (subfloorM2), src/engines/takeoff.ts:334.
Repro: takeoff books 'Subfloor 3/4" T&G | 33 sheets' from slab-polygon area while zero deck member exists anywhere in src — X-ray shows open joist grid, estimate buys sheets. Wall sheathing/drywall have member twins; the floor deck uniquely doesn't. IRC R503.2/R503.2.3.
Fix shape: frameSlab emits per-slab 'subfloor' panel member(s) (polygon extent, 19 mm, stair holes carved); takeoff derives the row from members (wall-layers tally pattern); add T&G adhesive + fastening-schedule row (R503.2.3).
Gate: extend compute.multistorey.test.ts S4 gate to the floor-deck case (currently pins only wall sheathing); member↔row count parity.
Blast radius: every slabbed level gains a panel member; renderer/exploded view gains a stratum — visual round required.

## BATCH 4 [MAJOR] Takeoff double-booking — one material, two disagreeing buy quantities
Files: src/engines/takeoff.ts computeTakeoff() gross-area block (325-339) vs layer-tally block (406-443); src/framing/compute.ts areas (848-879, filled unconditionally).
Repro: same scene books 'Sheathing | 34 sheets gross' AND 'Wall framing | ~28 sheets net'; drywall 48 vs ~40. Purchaser summing sections orders ~2×. 8d sheathing-nail poundage keys off the gross row a fix deletes. S4 in reverse (renders once, books twice). Context adds a sibling in the same block: drywall gross-booked on CMU walls that render none — kill it in the same pass.
Fix shape: suppress gross-area rows when layer members exist for the level (members are truth); re-key sheathing/drywall fasteners to the surviving member-derived count; CMU walls contribute zero gypsum area.
Gate: takeoff.test.ts one-row-per-material pin + fastener-basis pin; CMU scene books no drywall.
Blast radius: takeoff/schedules only — members untouched; blueprint EXAMINER round mandatory (C5/takeoff pages shift). Do BEFORE Batches 3/6 land their new member-derived rows, or fold ordering: 4 → 3 → 6.

## BATCH 5 [MAJOR] PT sole plate on slab — untreated lumber on concrete, mislabeled anchorage row
Files: src/framing/compute.ts computeLevelUncached() (has isGroundLevel, never forwards it), src/engines/wall-framing.ts emit()/bottom-plate (171-202, hard-coded material 'lumber'), src/engines/takeoff.ts:482-494 (anchor row says 'mudsill anchorage' but no mudsill exists — only PT emission repo-wide is cmu.ts:739).
Fix shape: pass ground-level/slab context into frameWalls; slab-bearing bottom plates emit material 'pt-lumber' → the existing PT SKU split (takeoff.ts:271) books the '2x6 PT' row for free; fix the anchor-bolt row text to name the sole plate it actually clamps. IRC R317.1(2), R403.1.6.
Gate: wall-framing.test.ts material pin (ground vs upper storey); takeoff PT row; S1 anchor-bolt allow-list row updated (checklist residual names this exact pair).
Blast radius: material field changes on EVERY ground-level plate across 51 jurisdictions — byte-equality reset with expected-diff manifest (cavity-fit playbook).

## BATCH 6 [MAJOR] Roof sheathing + underlayment — the roof package a builder actually orders
Files: src/engines/roof-framing.ts (all frame* — each already knows its slope planes), src/framing/compute.ts:851 (add roofSheathingM2), src/engines/takeoff.ts.
Repro: zero deck/underlayment/covering members or rows repo-wide; the engine's own rake detail relies on sheathing cantilever it never models. IRC R803.2, R905.1.1, Table R602.3(1).
Fix shape: per-plane deck panel members + underlayment membrane member (wall-layers WRB pattern) + drip edge lf; takeoff rows derived from members (post-Batch-4 convention); covering stays HOST cosmetic — label it so ('covering by finish schedule — not booked') to honor the assumption-label contract.
Gate: per-shape deck presence + area≈plane-area; S4 parity row.
Blast radius: new members on every pitched+flat roof — exploded-view strata + examiner round.

## BATCH 7 [MAJOR] Hip/mansard/dutch thrust path — ceiling joists + collar ties
Files: src/engines/roof-framing.ts frameHip (~599), frameSkirt→mansard/dutch.
Repro: hip 10×12 @40° emits 12 commons + 4 hips + 64 jacks + 76 ties and ZERO ceiling-joist/rafter-tie/collar-tie members (gable + gambrel both have them; dutch not literally zero per verifier but core gap stands) — non-structural ridge board with unresisted thrust, and no ceiling frame for the storey below. IRC R802.4.2/R802.4.6.
Fix shape: emit ceiling joists across the short span between hip planes (mirror frameGable's besideRafter snapping) + collar ties on the ridge portion; extend to skirt-based shapes.
Gate: hip/mansard/dutch member-census tests (joists present, tie labels cite R802.4.2, SAT-clean vs jacks).
Blast radius: hip-family scenes gain a member class + takeoff lumber lift; gable/shed byte-equal.

## BATCH 8 [MAJOR] Roof shape closures — four small fixes, one file
Files: src/engines/roof-framing.ts only.
(a) Ridge <3:12: frameGable ridge emit (~495) accepts a plain ridge board at 2.5:12 — emit ridge-beam+posts or at minimum flag 'slope < 3:12 — ridge beam required, R802.4.3'.
(b) Flat roofs ignore spec.hurricaneTies: frameFlat (879) never calls tieAt while shed ties both ends (592-595) — tie both bearing ends of every flat joist; takeoff picks it up free. R802.11/FBC ≥130 mph — the FL flat-roof market is exactly the mandate zone.
(c) Valley silence: detectValleys (1291) is perpendicular-gable×gable only; a hip wing into a gable main frames straight through with no members AND no warning (docblock-only assumption breaks the labeling contract). Minimum: detect overlapping non-qualifying segment pairs → computeLevel warning 'roof intersection not framed — valley detail required'; full hip-plane valleys later.
(d) Gambrel: 9 m purlins at the break carry every rafter joint with zero struts (R802.5.1: 2x4 struts ≤4' o.c. to bearing) and gable ends get no rake framing despite 0.4 m overhang — emit strut rows (or assumption flag) + port frameGable's hasRake rake-ladder block.
Gate: one test per letter; P4 prints (a)+(c) warnings.
Blast radius: flat/low-pitch/valley/gambrel scenes only. Sized as one iteration because each is a localized flag/member add; if it runs long, (c)+(a) are the flag-only half — split there.

## BATCH 9 [MAJOR] Wall bracing (R602.10) — nothing above the foundation
Files: src/engines/wall-framing.ts frameWalls() (no bracing pass), src/core/spec.ts (no bracing fields); only bracing artifact repo-wide = foundation.ts:529-548 hold-downs (SDC D+, honestly labeled).
Repro: CA (SDC D) structural wall members byte-identical to INTL; 16-ft garage door returns framed as plain kings+trimmers — prescriptively a portal frame (R602.10.6.4: strap over header, hold-downs, min panel width) with zero hardware and zero label.
Fix shape (v1, one iteration): bracing pass in wall-framing (or sibling engine) that identifies braced-wall lines, declares CS-WSP as the method, emits per-wall-line assumption flags where panel length/spacing can't be verified, and at garage narrow returns emits the portal-frame member set (straps, hold-down end posts = doubled studs) or an explicit '⚠ portal frame required — not modeled' flag. Full panel-schedule math is v2.
Gate: SDC-D scene ≠ INTL (members or flags); garage-return scenario pin; foundation hold-downs cross-referenced to wall-end posts.
Blast radius: high-SDC + garage scenes; INTL low-seismic mostly flag-only. Own iteration — this is the second-biggest batch.

## BATCH 10 [MAJOR] High-wind wall uplift — continue the path the roof ties start
Files: src/engines/wall-framing.ts frameWall() (no tie/strap emission), src/jurisdiction/profiles.ts (hurricaneTies consumed ONLY by roof-framing), src/engines/takeoff.ts (tie row roof-only, 470-508).
Repro: LA (130 mph) walls byte-identical to INTL; the only acknowledgment is a disclaimer buried in data/fastening-schedule.json that never surfaces. R802.11 uplift path must reach the foundation; R301.2.1/WFCM.
Fix shape: when spec.hurricaneTies — book stud-to-plate connectors + header/king uplift straps at openings + plate-to-foundation straps (roof-tie booking pattern), or at minimum flag plates/opening frames 'high-wind uplift connectors per WFCM not modeled — verify strapping schedule'. Prefer booking: the tieAt pattern exists.
Gate: LA/FL walls ≠ INTL (connectors booked); flag parity when booking is out of scope.
Blast radius: ≥130 mph profiles only; INTL byte-equal. Pairs conceptually with Batch 8(b) — sequence after it.

## BATCH 11 [MAJOR] Header rules by snow load — the last static prescriptive wall table
Files: src/jurisdiction/profiles.ts applyJurisdiction() (108-124 — moves rafterSize, never headerRules), src/core/spec.ts DEFAULT_SPEC.headerRules (62-68).
Repro: VT (60 psf) headers byte-equal to INTL; Table R602.7(1) tabulates by ground snow load (30/50/70) AND building width.
Fix shape: per-snow-band headerRules sets selected in applyJurisdiction; building-width caveat as an assumption label on header members (width isn't in spec — label, don't guess).
Gate: VT header ≠ INTL (one-two steps deeper); INTL/low-snow byte-equal; label pin.
Blast radius: heavy-snow states' headers deepen — expected-diff manifest for those profiles. Small batch; can ride with Batch 1's file if timing aligns, but keep gates separate.

## BATCH 12 [MAJOR][electrical] Grounding electrode system — every build orders it, none is modeled
Files: src/engines/electrical.ts routeServiceCable() (~1794), src/engines/takeoff.ts.
Repro: regex over composed members for ground/rod/electrode/GEC = zero; no rows; no out-of-scope label — conspicuous because the rest of the service chain is fabrication-level. NEC 250.50, 250.53(A)(2), 250.66, 250.94, 250.104.
Fix shape: routeServiceCable emits 2 driven rods below grade at the meter (6 ft apart) + GEC run (8 AWG Cu for 100A) + intersystem bonding termination member; water-pipe bond to the plumbing entry (position available from plumbing); takeoff rows rods/clamps/GEC lf.
Gate: GES member census + takeoff rows; E2-style continuity GEC→panel.
Blast radius: every scene +~5 members/3 rows; below-grade render joins the DWV ghost pass.

## BATCH 13 [MAJOR][electrical] Alarm truth — placement, CO, and the impossible interconnect
Files: src/engines/electrical.ts layoutElectrical() (348-377), assignCircuits() (1193-1241), routeWiring() (1549), takeoff FIXTURE_ROWS.
Repro: (a) no 'hallway' room → the R314.3(2) outside-sleeping-area alarm silently drops, no per-story rule, no CO alarm kind at all despite the exact R315.3 trigger (attached garage + bedroom) — data/electrical-rules.json books all three rules the engine doesn't deliver. (b) alarms land on DIFFERENT circuits (LTG-3/LTG-4) with 14/2 — hardwired interconnect physically requires one circuit + 14/3; same 14/3 gap for 3-way travelers (threeWay-flagged pairs get no traveler leg). Board already queues 'round-12 phases 1-3' — this is its confirmation.
Fix shape: (a) hallway-proxy fallback = bedroom-adjacent room (polygon adjacency) + level warning when the proxy fails; per-story alarm; co-alarm FixtureKind gated on garage/fuel appliance + FIXTURE_ROWS row. (b) assignCircuits forces all smoke/CO onto ONE circuit; routeWiring emits a 14/3-labeled interconnect chain + 3-way traveler legs. IRC R314.3-4, R315.3; NEC 210.70/404.
Gate: no-hallway scene census; one-circuit pin; 14/3 label + traveler continuity (E2).
Blast radius: circuit assignment reshuffles on every scene with alarms — E2/E4 gates must stay green; sized one iteration but (a) and (b) are a clean split point if needed.

## BATCH 14 [MAJOR][electrical] Receptacle coverage — outdoor, countertop, basin, sink-GFCI
Files: src/engines/electrical.ts interiorFaces() (144), layoutElectrical() walk (261-297, GFCI test 283-291); src/framing/compute.ts extractPlacedFixtures (~772, already available).
Repro: zero outdoor receptacles ever (interiorFaces returns interior faces only) despite rules.json booking outdoorFrontAndBack; all kitchen/bath boxes at 15" AFF — no counter-height walk, no within-3-ft-of-basin box; the GFCI sink-proximity test is skipped behind a STALE comment ('once sink positions are extracted') though plumbing consumes placedFixtures today. NEC 210.52(C)(D)(E), 210.8(A)(3)(7)(9), 406.9(B).
Fix shape: front/back exterior-face WR GFCI + in-use covers (front = street-nearest via STREET_EDGE_MARGIN logic, RO-cleared); consume placedFixtures for the 6-ft GFCI radius NOW; counter-run walk at ~44" keyed to kitchen zones per rules.json layoutAlgorithmHints (data already carries all the numbers) OR explicit per-kitchen warning label; basin receptacle within 3 ft of placed lavs.
Gate: outdoor count ≥2 + WR/GFCI marks; sink-radius GFCI flip; counter-height census or label pin.
Blast radius: fixture counts rise scene-wide → device-node reconcile (E5 byte-equality pin) must be regenerated — coordinate with master-baseline.json capture.

## BATCH 15 [MAJOR][electrical] Cable support + protection — staples and nail plates
Files: src/engines/electrical.ts routeWiring() (1549-1713), src/engines/takeoff.ts wire tallies (531-599).
Repro: 152 wire-runs, zero support/protection members or rows. NEC 334.30 (secured 4.5 ft + 12" of boxes — several hundred staples, a real line item); 300.4(A)/(D) — and the repo's OWN cavity-fit compression creates the mandate: 0.10 m wall → 74.6 mm studs → 31 mm bore edge < 1-1/4" → plates code-REQUIRED exactly where bones compresses, undetected.
Fix shape: takeoff staple row computed from run lengths + box count; nail-plate member/row emitted when fitAcross-compressed stud depth puts the centerline bore under 32 mm edge distance (read the actual framed member dims, E5-style zero-drift).
Gate: staple-count formula pin; thin-wall scene emits plates, full-depth scene doesn't.
Blast radius: takeoff rows everywhere; members only on compressed walls. Board's round-12 phase 1 — closes that queue line with Batch 13.

## BATCH 16 [MAJOR][electrical] Fixed equipment power — extend the proven AC-n pattern
Files: src/framing/compute.ts (AC-only homerun subset, 830-845), src/engines/electrical.ts assignCircuits() (1193-1228).
Repro: condensers get dedicated circuits; water heater (NEC 422.13), air handler (422.12/IRC E3703 + 210.63 service receptacle), bath fans (never seen by routeWiring — hvac-system fixtures), thermostat (no cable) get nothing. Range/dryer/dishwasher: scene lacks appliance data — assumption-label, don't invent.
Fix shape: tag WH/AHU/fan/thermostat fixtures into assignCircuits + route like the AC subset (WH fuel-type assumption label — electric 30A/10-2 vs 'gas — circuit n/a'); AHU service receptacle within 25 ft; thermostat rides Batch-appendix low-voltage or gets an explicit label. Appliance circuits = per-room assumption labels only (210.11, Table 220.55).
Gate: circuit census per equipment kind; E2 continuity incl. new homeruns; label pins.
Blast radius: panel schedule + legend + plan-set (examiner round); panel meta count drift (appendix item) should be fixed in passing here.

## WAVE 2 (2026-08-20 re-run of the 4 dead audits + 3 carried verifiers — 27/27 adversarially CONFIRMED, 0 rejected)
Status ledger: B1-B5 SHIPPED (B1/B3 night-6 rounds, B2 pilot, B4 a132f3d incl. climate-zone rider, B5 pending merge); B17a/B21b/B21c fixed night-6 dawn (f7db0c2 follow-up).

## BATCH 17 [BLOCKER][foundation+takeoff] Slab-on-grade phantom — the biggest pour on the job is unbooked
Fiction chain: no slab member (role isn't even in the Member union), zero slab-field yd³ (≈11.2 yd³ on baseline — more than footings+stemwalls combined), no R506.2.3 vapor retarder / base course / edge insulation member-or-row-or-label, while compute.ts:611 prints 'see Foundation for the slab' pointing at nothing, foundation.ts:262 hasSlab is dead, takeoff.ts 'slab-edge' maps a role nothing emits. Fix: slab field member (polygon extent × R506.1 3.5", holes carved), vapor retarder membrane member + row, concrete yd³ row, kill-or-honor the promise warning. Gate: S4 parity slab member↔yd³ row; the warning names geometry that exists. Visual round (new stratum below joists).

## BATCH 18 [MAJOR][foundation] Anchorage truth — bolts vs openings, CMU interface, SDC-D bar, post footings
(a) foundation.ts:501 bolt layout ignores wall.openings: J-bolts inside door ROs booked as installable + no R403.1.6 per-plate-SECTION end bolts at jambs — port cmu.ts:766-773 boltSegments split (the convention exists in-repo). (b) CMU walls get 'mudsill anchorage' J-bolts embedded up into block cells where no sill exists + stemwall dowels never lap the wall's vertical bars. (c) SDC D stemwall missing R403.1.3.1 top-of-wall #4 horizontal bar (AK: nearest horizontal steel 38.8" below top of a 34" stemwall). (d) upper-floor girder 4x4 posts bear on the unmodeled slab with no R403.1/R407.3 pad footing. Gate per letter; interpenetration rows for (a)/(b).

## BATCH 19 [BLOCKER+][hvac] Equipment placement + airflow truth
(a) BLOCKER: air handler + open central return modeled INSIDE the garage silently (M1602.2(1) forbids garage return; R302.5.2 duct penetration rules) — placement must prefer conditioned utility/closet space, or flag loudly. (b) duct sizing ignores tonnage (trunkSizeInByTons ships dead; labels print CFM the tin can't carry). (c) no return-air path from closable rooms and no return-side duct member at all. (d) kitchen local exhaust missing (M1503; exhaust loop hard-gated to bath/laundry). (e) condensate: no aux pan/float switch at LOD-400; ¾" drain terminates at the wall CENTERLINE. (f) exhaust ducts skip routing/termination checks (dryer vent exits through the front-door RO unflagged; 35-ft budget, 3-ft opening clearance). Split (a)+(c) / (b)+(d) / (e)+(f) if it runs long.

## BATCH 20 [MAJOR][plumbing] Fixture-unit + safety truth
(a) water heater: no T&P valve/discharge, no pan, no seismic strapping even in CA, tank floats 18" above floor. (b) P3105.1 trap-arm measured fixture→wall not trap-weir→vent; one re-vent per wall serves every trap at any distance; island venting silent. (c) P2603.2.1 shield plates dead data; 3" stack centered in a 2x4 partition (0.25" cover) unflagged — pairs with B15's nail-plate mandate. (d) water meter + cold main land inside the panel's NEC 110.26(E) dedicated space (both trades elect the same wall at panelMountU). (e) MINOR: supply never sized (no WSFU, ¾"+½" always); hot-water R-3 insulation absent (N1103.5.3). (d) is a cross-engine spatial reservation — do it with B12/B16 panel work.

## BATCH 21 [MAJOR][paper] Sheet honesty batch
(a) FIXED f7db0c2-follow-up (night-6 dawn): flag block pagination. (b) FIXED: foundation legend hardcoded '1/2" bolts @ 6ft' contradicting 5/8" members + 4ft seismic spacing — now derived. (c) FIXED: 'LOD 400' stamped unconditionally on detail-200 exports — now from spec.detail. (d) door/window SCHEDULE sheet absent with no out-of-scope label — real feature, own iteration (columns from OpeningSlice + header members). (e) sheet-goods convention header says GROSS buys while member rows book NET, zero waste factor, subfloor row mislabeled — reconcile wording + add stated waste factors per material (B4's convention owns this).

## CARRYOVER CONFIRMED (from the 3 dead wave-1 verifiers)
- MEP penetrations unframed/unprotected (R302.11 fire-blocking at penetrations, R602.6 bore limits) → fold into B15 (nail plates) + B19/B20 routing.
- King-stud counts vs Table R602.7.5 (always 1/side regardless of RO width) → fold into B1's file (wall-framing opening frames).
- Brick veneer ties missing (R703.8.4 32"/25" o.c. + row) → wall-layers; pairs with the WAVE-1 appendix cladding-fastener line.

## SHIP-GATE RESIDUALS (2026-08-20, adversarially CONFIRMED, queued)
- Line-set coil stub bores the DRYER-EXHAUST duct ~1.5m when the AH sits in a laundry (the M3-preferred room) — both route equipment-centroid → the same exterior wall; pre-existing at 400, now visible at default LOD 300; flagLinesetTradeCrossings scans plumbing only. Fix shape: extend the cross-trade scan to hvac duct-runs or separate the coil-stub plane. (condenser-always round, 2026-08-21)
- Trap-DROP verticals vs OTHER walls' concrete (F3 round-3 skeptic, 2 repros): the inboard junction/drop is validated only against the fixture's OWN anchor wall — a corner-flush lav's drop riser runs bare through the PERPENDICULAR frost stemwall, and a toilet 0.22m off an interior bearing wall gets its drop pulled INSIDE that wall's 12" thickened footing. sleeveNoteFor covers horizontal legs only. Fix shape: corner/adjacent-wall clamp (or sleeve) for drop verticals in placedPlumbing; reduced 4→1 clashes by F3, class not dead.
- S4 divergence on classified-but-floorless scenes: walls with explicit frontSide 'exterior' but NO rooms/slabs → wall-layers exteriorSide() nulls (whole wall layered interior, drywall booked BOTH faces) while compute's areas block keys off wall.exterior → gross WSP row survives with zero members. applyExteriorFallback's S4 guard covers only the nothing-declares-exterior case. Fix: make the areas block and exteriorSide() share one classification source. (Pre-existing; surfaced by the B4 ship-gate attack.)
- Acute-tip rim miter: rims meeting at a ~6° polygon tip overlap each other + the tip joist (SAT). Pinned frozen in interpenetration.test.ts (wedge gate allows ≤4 residual pairs, blocking excluded). Fix shape: rim retreat/miter at acute corners, wall-framing tee-retreat math is the pattern.

## APPENDIX — unverified minors (deduped; verify-then-fold into the nearest batch, or queue)
- wall-framing: top-plate lap nailing dead in data (→B1/B5 file); soffit/penetration fire-blocking warning-only; finish-layer fasteners unbooked (drywall screws/siding nails/WRB caps — natural rider on B4's fastener re-key); over-wide RO silently narrowed, no flag (sibling of B1's clamp flag — fold into B1).
- floor/roof: rim toe-nail count fixed at 3 regardless of length + bearing unchecked vs real walls; stair-header hangers exist but header-to-trimmer anchors + girder post caps/bases missing; gable-end bracing absent in high-wind (rider on B10).
- electrical: panel meta says 9 circuits with 10 real + no slots/load calc behind '100A' (fold into B16); underground-only service — no mast/weatherhead, no outside emergency disconnect (NEC 230.85); box fill 314.16 unmodeled (generic 1-gang); low-voltage absent unlabeled (thermostat/doorbell/data — label rider on B16).
- electrical PAPER (B13 examiner flag 1, VERIFIED, queued): SD-1 interconnect chain readability — only 43%/18% of drawn leg length prints crimson under shared-plane overprint (the pre-existing circuitIndex %8 plane-stacking class puts SD-1 on plane 1 with an earlier circuit). Fix shape: per-circuit plane step or draw-order priority for the interconnect chain on the electrical sheet.
- wall-layers/CMU: CMU horizontal joint reinforcement absent + CMU insulation override silently emits nothing outside the panel; WRB booked net with no lap factor/tape; cladding fasteners unbooked + HVHZ nailing overlays unconsumed (rider on B4/B10); no stucco/CMU control joints, corner beads, air-sealing labels. NOTE: the wall-layers audit's two takeoff blockers (WSP/drywall double-book, CMU drywall ghost) are already covered by B4; the dead climate-zone key lookup killing cavity-R/vapor labels in all 51 states appeared in that audit's summary — VERIFY and, if real, it's a one-line-fix candidate to ride B4.

## SEQUENCING NOTES
- B4 before B3/B6 (row-derivation convention lands once, member-derived rows follow it).
- B5, B11 are the byte-equality-reset batches → each needs an expected-diff manifest across 51 jurisdictions (night-4 cavity-fit playbook).
- B14 regenerates master-baseline.json (E5 pin) — do not interleave with other electrical batches mid-loop.
- Examiner (BLUEPRINTS.md) rounds mandatory on B4, B6, B13, B16 (schedules/legends move); visual rounds on everything that adds member classes (B2, B3, B6, B7, B12).
- S4 ledger for the checklist: booked-but-absent = subfloor (B3), 4x8 header stick vs sliver (B1), 'mudsill' anchorage text (B5), gross sheet rows (B4); modeled-but-unbooked = none confirmed at member level, but fastener bases (nails keyed to deleted rows) die with B4. New invariant rows + gates in the same commits per checklist process rule.