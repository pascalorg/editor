# COMMUNITY PRs REVIEWED (2026-08-24) — JonathanNus / Terra Modular

## Context: contributor runs a white-labeled Bones ("Structural
## Framing / Beta") in a "PreSell" deployment (terramodular.com —
## modular construction; LGS-relevant audience). Quality is high.

TODO-1 DELIVERED: feat/canada-jurisdictions tip 2970acb (7 commits,
suite 1912, E5 cmp-identical; cherry-pick aa2a2b6 authorship
Jonathan Nusbaum preserved, stacked commits NOT taken). BIG ENGINE
FINDING from the adoption: ircBase had ZERO consumers — IRC labels
always printed unconditionally (WI incl., always had); fixed via
gated nonIrcCode confession warning at 300+ (panel + P4 paper; WI
now fires it too — enumerated warnings-only deviation; per-label
suppression queued, blast radius = every engine). Also:
profile.notes (incl. PERMAFROST) was built but never rendered — now
prints in JurisdictionPicker source-gated. CA compose gates: CA-SK
84in footings reach GEOMETRY, ON-E kPa-converted snow drives header
columns, BC trips SDC-D. 9 mutants die. ROUND 1 (wf_505d3b82): visual PASS/SHIP (dropdown contiguity
DOM-proven, confession collapsed per clutter rule, 0/1.26M px TX
parity), examiner APPROVE (confession verbatim on paper w/ correct
per-province adoption strings; FLAG-1 title-block clips long
residentialCode strings — pre-exists on WI, QUEUED; FLAG-2 LOD-200
sheets print code cites confession-free — pre-existing US class,
owned by the QUEUED per-label suppression item), skeptic REVISE:
F1 CA-NU (140mph + ties:false, first-ever such row) mints ties w/ a
FALSE 'below 130 mph' label AND escapes both enumeration pins (S16
'or says it can't' violated); F2 VERMONT is the unenumerated 18th
confession member (ircBase:null at base — honest behavior, missing
enumeration + incoherent no-code wording tail). Nits: AB/SK
value-vs-note rounding, legacy America/Montreal tz id. FIX TIP db61c5c
(F1 highWindTiesOnly third class {CA-NU} w/ true label + third
enumeration arm; F2 confession set exactly-18 pin + VT no-code tail;
nits: AB 71/SK 83 note==value at 25.4, America/Montreal→CA-QC).
ROUND 2 (wf_d2e9556a): skeptic APPROVE closing-grade — /^No/ scope
proven safe (11 US 'No…' rows all non-null ircBase), Jonathan's 84
pin change annotated not silent, tz legacy sweep clean (only
tiny-population Pangnirtung/Coral_Harbour links unmapped — noted).
★ MERGED TO MASTER 7f30a82 + manifest-count companion 524f3da
(2026-08-24; suite 1946, tsc clean). Jonathan Nusbaum's authorship
preserved on master.
★ SHIPPED TO PROD 2026-08-24 (2nd ship of the day): plugin 5679260
→ editor #717 (4c34032c) → private-editor #410 (6fcf3502), full
CI green incl. both E2E + Bugbot, Vercel prod. LGS PHASE 2 machine
UX + 16 CANADIAN JURISDICTIONS live on editor.pascal.app. The
X.com LGS ask is now answered end-to-end (Phases 0-2 shipped;
Phase 3 floors/roofs remains). Day tally: 3 prod ships (CMU fix,
HP+LGS-P1, P2+Canada), 5 branches merged, suite 1743 → 1946,
2 community PRs adopted/answered.
Original brief follows:
TODO-1 (ADOPT, reworked): PR #1 Canadian jurisdictions — 16 rows
(10 provinces, 3 territories, Ontario split S/E/N on frost/seismic
spread, NBC-2020 generic fallback). Discipline matches house
conventions: NBC Div B Part 9 citations, per-row kPa→psf/mm→in
conversions documented, ircBase:null on the Wisconsin-UDC precedent,
permafrost warnings surfaced via frostLineNote, ISO codes (CA-ON-S…)
dodging the CA=California collision + free dropdown grouping, tests
pin the silent-INTL-fallback class. PLAN: cherry-pick ONLY commit
6861d07 (branch is stacked: carries PR #2's commits + an ACCIDENTAL
white-label brand commit da39632 whose own message says 'NOT sent
upstream' — drop both), rebase onto current data schema (their base
is 2026-08-16, suite 444 vs our 1783; jurisdiction data grew), then
a full verify round attacking: NBC citation completeness per row,
conversion arithmetic, ircBase:null honesty (NO IRC-section label
may fire on CA rows — sweep paper+panel; NBC 9.23.13 bracing differs
by design), CA/California collision pins, tz guesses (Montreal folds
into America/Toronto — their stated caveat), permafrost note reaches
the panel. Credit JonathanNus in the merge.

TODO-2 (ADOPT idea, fresh impl): PR #2's headless engine surface —
export computeLevel/computeLevelUncached/computeTakeoff/cutList/
extractLevels/extractRoofs + row/member types from index.ts so host
estimators compute panel-identical quantities without mounting
(computeLevelUncached exists for rollup loops vs the 1-deep memo).
Gate: exports stay pure (no viewer import — a grep gate). Small.

BOTH PRs COMMENTED + CLOSED PUBLICLY 2026-08-24 (Julien's go-ahead):
#1 closed with the adopt-via-cherry-pick plan + authorship-preserved
promise; #2 closed as superseded with the master-timeline
explanation + exports-idea-adopted credit + the dead-key find
acknowledged. TODO-1 now owes the cherry-pick landing.
CLOSED-AS-SUPERSEDED: PR #2's wall-
mode takeover — the bug was real at their base but master's
activation-scoped imposeLowWalls/releaseLowWalls (with the W1
multi-X-ray invariant they lack, + user-action-scoped imposition
fixing their scene-load-blanking edge) supersedes the panel-scoped
design; panel-scoped restore would bury a still-live X-ray on tab
switch. Their found-bug (insulationByClimateZone dead keys) was
independently found+fixed (climateZoneOf, B4 rider) — acknowledge
their find. Their long-term idea (owner-tokened push/pop
presentation override on useViewer) folds into the queued host
WallCutout self-heal follow-up as the API shape.

# CMU × PAINT Z-FIGHT — ROOT-CAUSED, FIX PILOT LIVE (2026-08-23)

## Julien's report: painted CMU wall flickers ("both textures at once"),
## ANY color incl. flat white. ROOT CAUSE (verified file:line):
CMU block outer faces are EXACTLY coplanar with the host wall face
planes (cmu.ts:321 depth=min(t, BLOCK_DEPTH_ACTUAL), mortar shrink
never applies to depth, block centered on centerline; default t=0.1 <
0.19368 → faces at ±t/2). Unpainted looks clean ONLY because
activation's wallMode 'down' stipple is transparent+depthWrite:false
(depth-silent). Painting swaps an OPAQUE material back onto the host
face via two suppression-unaware writers — React prop re-application
on material-identity change (nodes wall/renderer.tsx:127-156) and
paint-preview snapshot/restore (wall/paint.ts:161-188 +
selection-manager stale restore) — and host WallCutout re-stomps only
on its throttled camera trigger (>0.5m/0.3rad) → camera-dependent
blinking. FIX PILOT: fix/cmu-face-bury (worktree
/private/tmp/pilot-cmubury) — CMU_FACE_BURY=0.005 per the duct
precedent + coplanarity gate + E5/manifest; assesses the framed-wall
latent pair (gypsum/cladding outer faces flush by design,
wall-layers.ts:285-291) as contained-fix-or-queued.
HOST FOLLOW-UP QUEUED: WallCutout self-healing suppression (treat
unexpected mesh.material as a trigger; paint-preview restore should
re-resolve the current variant, not restore a stale snapshot) — fixes
the resurrection class for ALL plugins/modes; also benefits 'up'/
'cutaway' modes where the stipple never applies.
DELIVERED: fix/cmu-face-bury tip bfec7c6 (74eef20 + manifest; suite
1751, tsc clean). depth = min(max(t−2·0.005, t/2), BLOCK_DEPTH);
walls ≥0.203675 byte-equal; THIN_BURY_FLAG when t/2 floor engages
(host UI floor 0.05 → full bury holds, sub-2cm raw-API degrades to
t/4/side, blocks never vanish). E5: baseline has ZERO CMU roles —
recapture byte-identical, computeLevel CMU scene gate substitutes.
Honest deviation: lintels/beams buy detail '≈0.2'→'≈0.1' (net 0.1
yd³ unchanged). FRAMED-LAYERS TWIN: assessed NOT-contained (cavity
keystone interpenetrates; 38 members/jurisdiction pin churn; x-ray
lip) → QUEUED, host self-heal also covers it. NEW RESIDUAL QUEUED:
u-direction end-face class (bond-beam/lintel END faces on host wall
end caps at CMU×CMU corners; blocks immune via length shrink).
ROUND 1 (wf_193a3cd0): skeptic APPROVE (18-thickness all-roles
coplanarity sweep; pour-row arithmetic re-derived — old ≈0.2 was
real ceil-to-batch, new ≈0.1 honest; NEW corner butt-gap class
found+quantified, absorbed into the end-face queue item), visual
PASS (flicker reproducibly GONE — 0/196,444 px on every return/
temporal pair, both wall modes, white+brick, hover-preview clean;
baseline contrast reproduced Julien's quilt exactly; x-ray look
0.6% at working distance; framed class confirmed NOT fixed,
honestly — host self-heal owns it), examiner APPROVE (pour cell
re-derived to the digit; FLAG: sheets that draw CMU members move
numeric-only ≤1.5px — manifest addendum landed at merge).
★ MERGED TO MASTER 8aad1b3 + addenda 7ee49a9 (2026-08-24; suite
1783, tsc clean, E5 pin green). QUEUE: u-direction end-face +
corner butt-gap (one end-treatment item); framed-layers bury
(not-contained assessment stands); host WallCutout self-heal.
★ SHIPPED TO PROD 2026-08-24: plugin c05c13e → editor #714
(dd3585f9) → private-editor #400 (549675f0), all CI green incl.
both E2E, Vercel prod deploy. CMU paint-flicker fix + LGS Phase 0
(inert) live on editor.pascal.app.

# HP POLISH — feat/hp-polish DELIVERED, VERIFY ROUND RUNNING (2026-08-23)

## Julien's 4-part feedback (red / tilted / off-grid / no-R) — pilot done
Branch tip 308ee22 on 1a5e627, suite 1743 → 1771, tsc clean, manifest
docs/plans/HP-POLISH-EXPECTED-DIFF.md. (1) COLOR: clone retint to
CONDENSER_SCHEMATIC_TINT #8b8f96 (bones equipment-gray; host item path
keeps authored GLB materials whenever textures-on — themed clay is a
monochrome-only theme path plugins can't reach, so NOT the host
treatment). (2) TILT: whole assembly wall-square (yaw = outward wall
normal, padRotY==rotY rigid); machine placements square to ELECTED
wall, verbatim drags square to their OWN row wall, rowless fallback
keeps legacy bearing (⚠-flagged). (3) GRID SNAP: auto anchors snap in
wall frame to EDITOR_GRID_STEP_M=0.5 (host snapToHalf convention,
read-only); along = nearest RO-clear multiple (honest off-grid flag if
none), outward = CEIL ONLY so 24" face clearance is a floor; verbatim
drags never snap (A4); ε-anchor recognizes 3 machine spellings incl.
unit1Presnap so legacy seeds keep their elected wall. (4) ROTATION:
additive nullable yawOverride (bones:service → ServicePointOverride.yaw
→ hvac); R/T + arc-gizmo wired via keyboardActions + handles
'rotate' descriptor in service/definition.ts (heat-pump only);
steppedRotation semantics MIRRORED (host doesn't export it — drift
risk pinned); STATED LIMITATION: host group-rotate writes raw rotation,
no registry seam — group-rotate won't turn the assembly.
ROUND 1 (wf_5c97d6cc-d1d): visual PASS (all 4 complaints verified
fixed in-browser; R=45° is exact host parity ROTATION_QUANTUM π/4;
no red — residual red pixels are the pre-existing liquid-line/copper
palette), examiner APPROVE (scorecard blueprint-hp-polish-r1.json;
REC-1: manifest missed the 4 moving takeoff lf cells + E/W elevation
−4.9px recenter), skeptic REVISE → FIX ROUND DISPATCHED to pilot:
F1 world-XZ-grid snap (host floorStrategy convention — wall-frame
snap left oblique units off the rendered lattice, residuals
0.153/0.496; axis-aligned scenes unchanged so E5 baseline pins
survive), F2 disconnect plan reach 1.5636m > CHECKLIST M2 ≤1.5m with
a silently-raised 1.7 test allowance (constrain-or-amend, no orphan
allowance), F3 the promised off-grid honesty flag was never emitted
(physics-beats-grid scene lands x=1.63 silent). QUEUED from round:
pre-unwarp seeds elect disconnect sourceId 'w_fence' orphan
(pre-existing at base, unwarp-era, fence scene). FIX TIP c4ffc93
(61866a8 F1+F3: deterministic world-lattice candidate search ±3
steps, away-only ≥ honest standoff, verbatim lattice coords so
post-seed==auto byte-equal on obliques, E5 recapture byte-identical;
COND_OFF_GRID_FLAG on exhaustion, fully honest un-snapped fallback;
99b785d F2: M2 row amended with derived class bound ≤1.73m
unobstructed — NOTE the old ≤1m figure died at unwarp and rode
stale through two rounds, loop lesson; c4ffc93 REC-1/2: manifest
enumerates takeoff lf + elevation recenter classes, pad buy line
states size/basis). ROUND 2 (wf_78bf0f80): examiner APPROVE (manifest complete, pad
line honest+gated, M2 arithmetic re-derived, T1/P1 cell-by-cell),
skeptic REVISE + visual NO-SHIP converging on ONE core defect:
the off-grid flag dies on the DEFAULT auto-seed lifecycle (ε-anchor
recognizes the machine seed but drops unit1OffGrid on recompose —
flag shows one compose then vanishes silently; the two gates
collide at hvac.polish.test.ts:316/:298). Plus: amended M2 row is
an axis-aligned theorem stated as a class bound (5,450-scene sweep:
99 S-bound violations, worst 2.87m 3D on oblique+fronting-RO — the
stale-bound class in subtler form), and the flag wording claims a
whole-wall property the ±3-step window never checks (54/54 firings
had a valid spot beyond the window). Oblique lattice fix itself
VERIFIED WORKING (unit at exact 0.5m world multiples, residuals
0→0). FIX ROUND 2 DISPATCHED (flag rides recognized machine seeds;
row becomes a class theorem via min-extra-first tie-break or honest
split + class-sweep gate; one-string wording fix). LOOP LESSON
boarded: numeric class bounds for a search need a CLASS-SWEEP gate,
not a scene gate.
ROUND 3 (tip b5bb120, wf_96a71745): skeptic APPROVE (closing-grade:
1.75 supremum re-derived from COND_GRID_WINDOW_STEPS + center-
rounding — a genuine theorem; 432-compose adversarial off-sweep-grid
attack held, worst 3D 3.5307 ≤ 3.62; tie-break totality proven;
mutants A-F bite exactly incl. the round-2 bug reintroduced → caught
by 1 gate), examiner APPROVE (86/86 corpus files byte-identical;
round-2 laundering REPRODUCED on paper at the old pin; independent
600-scene sweep zero violations). Visual (resumed): PASS/SHIP —
acid test witnessed auto-seed from scratch on a fresh clone, flag
persists w/ new wording + prints on the takeoff Flags row, cmd-drag
clears it (A4); healthy scenes zero flags, all placements exact
world multiples; oblique pick moved closer as the tie-break
promises (1.2697 < 1.4083 standoff); starter byte-reproduced.
★ MERGED TO MASTER (2026-08-24; suite 1815, tsc clean, E5 11/11).
Julien's 4-part HP feedback CLOSED. Ships with LGS Phase 1.

# LGS (LIGHT GAUGE STEEL) — NEW FEATURE TRACK (X.com feedback, 2026-08-23)

## THE ASK: LGS framing option + machine profile libraries
"Can it be configured to use light gauge steel framing? … the main
LGS rolling machines such as FRAMECAD, Howick, etc could be selected
and their profiles populate the framing."
CODE ANCHORS: IRC R603 (steel walls), R505 (floors), R804 (roofs),
AISI S240 (designation system, e.g. 350S162-33). Per-wall material
override channel exists (the CMU precedent). MEP marquee integration:
punch-aligned routing (steel studs' pre-punched service holes replace
drilled bores).
PHASE 0 DELIVERED 2026-08-23: feat/lgs-phase0 tip 4e29f06 (base
f150fdd, 3 commits, 6 files, suite 1743 → 1768, tsc clean, E5 byte
pin passing). data/lgs-profiles.json: 41 cited AISI families (IRC
R603 stud set + S230 joists + tracks + bridging), 19 machines
(FRAMECAD 7 / Howick 7 / Scottsdale 3 / Pinnacle 2 — Pinnacle ships
on the unverified path as the live fallback example), 3 punch
regimes kept distinct, 28-entry citations block. Pure
src/engines/lgs-profiles.ts (consumed by NOTHING yet): designator
parse, profileFor 5-branch honest chain ending 'engineered design
required' — dims never invented. Spec: framingSystem/lgsMachine
optional, absent round-trips absent. Vendor contradictions recorded
both-ways verbatim; phantoms dropped. VERIFY ROUND: wf_9b07c78d-4b0
(skeptic: citation-gate mutation, 92mm→362S162-not-in-catalog
derivation trap, invented-number hunt, fallback-branch mutations).
ROUND 1: REVISE — F1 'lgs' half-routing (card said "Skipped" while
lumber members rendered; sheathing/drywall areas dropped the wall —
silent under-buy, S4/M2 classes), F2 350S162-68 missing (real
SFIA/S230 variant), F3 F450iT 33-mil derivation inconsistency, F4
complementary-defense gap (unverified machines could claim rollable
rows), F5 parser 'L'/leading-zero nits. FIX TIP 73d55d9 (one commit
per finding, suite 1775, all mutants die; F5 deviation documented:
SFIA ships real 075U050-54 so only padded 4-digit aliases rejected).
ROUND 2 (wf_2f96f711): near-APPROVE — F1–F4 hold under extended
attack (byte-equality incl. FL cmu-default + object-form overrides +
LOD-200/400 plan sets; 19-machine sweep ZERO mismatches; F5
deviation CONFIRMED against PDFs — 443+51 real designators, zero
rejections). ONE residual: padded-MILS alias ('350S162-033' parsed,
missed catalog) + F3 doc-label cosmetic. CLOSING TIP c5794a6
(c175673 mils group [1-9]\\d{1,2} + 4 pins; c5794a6 derivation label
names the real SFIA min-base convention). ROUND 3 (closing):
wf_3b1f5b6c-e95 APPROVE — scope proven to the byte (jq-diff, sorted
sha equal outside the one doc line), >1000-token real-designator
corpus zero rejections, mutant dies, E5 11/11.
★ MERGED TO MASTER 3d63133 (2026-08-23; suite 1775, tsc clean, E5
pin green at merge). PHASE 1 PILOT LAUNCHED: feat/lgs-phase1
(worktree /private/tmp/pilot-lgs1, base 3d63133) — steel walls @400
per R603: C-studs/tracks (track-mil==stud-mil verbatim rule),
R603.7 opening structure, R603.3.3 straps, S240 A5.9 punchout
metadata (MEP hooks), steel takeoff by length(+weight only if
cited), verified fastening schedule; NEVER invent table cells —
conservative-with-stated-basis or engineered-design-required;
'framed'/cmu byte-identical + baseline recapture byte-equal gated.
Round-3 advisories carried: CHECKLIST gains the LGS honesty-chain
row at Phase-1 verify; no generator exists for the data file
(hand-maintained, citation-gated — fine); unreal-but-well-formed
mils (10-17/119-999) fall through the honest chain (not an alias
class). Phase-2 note: inspector SegmentedControl highlight for
MCP-set 'lgs' walls (documented).
PHASE 1 DELIVERED: feat/lgs-phase1 tip 2df1b03 (5 commits, suite
1775 → 1820, tsc clean, E5 recapture cmp-byte-identical).
src/engines/lgs-wall-framing.ts: T125 tracks (mil==studs verbatim
rule), S162 studs seated in tracks, R603.7 king+1-jack, R603.6 2-C
box headers w/ verify flags, R603.8 sill track, R603.3.3 straps at
300+, S240 A5.9 punchout METADATA at 400 (MEP hooks). framedAssembly
(framed|lgs) drives areas/layers/card; framesAsLumber shrank to
'framed' only; steel sheathing/drywall/areas byte-equal to framed
twin. Takeoff: LGS rows by length + 'weight requires vendor data'
(no invented lb/ft), exact screw schedule, straps lf. Conservative
points labeled (68-mil Gr50 thickest-domain pick w/ stated basis —
NO R603.3.2 cells encoded). REAL VENDOR FINDING: TF550H rolls
68-mil S162 studs but 34-63mm flange range can't roll T125 track →
generic fallback, labeled. Deviations (a)-(e) in manifest incl.
steel exits R602.10 braced lines (warnings only) + S240 anchorage
residual (bolt kit clamps track — queued). 11 mutants die.
ROUND 1 (wf_2b2bb186): visual PASS (assembly/junctions/twin-parity/
punchout-metadata/lumber-0px/HP+duct all hold; advisory: NO member-
tooltip surface exists — labels live in data/card/paper; Phase-2 UX
affordance queued), skeptic REVISE (F1 basis clause on 1/8 roles,
orphaned basisSuffix var; F2 steel walls inherit wood-frame IECC
claims unqualified — R402.2.6 steel rule unstated, gate PINS the
lie; F3 steel legend-invisible; F4 four surviving mutants incl.
phantom-nails filter + substring-only label truth + block×strap SAT
on FL's CMU-shell+steel-partition default; F5 LOD-200 header cite
ungated, vendor-label inherited grade), examiner REVISE (P6 FAIL:
door/window schedule prints dishonest '—' for existing steel
headers — plan-set.ts:2968 size??'—'; FLAGS: gradeless takeoff,
strap unkeyed-fleck B9 class; sill track needs lifted-window gate).
FIX ROUND (tip a1b5ebd, 7 commits, suite 1834, 25 new mutants die).
ROUND 2 (wf_8e1be5e6): all round-1 fixes HOLD (P6 CLOSED on paper,
basis across roles, F2 three channels + both leak directions, byte
census zero-diff); skeptic REVISE on 2 narrow strap-trim findings
(CMU-stem-into-steel-THROUGH dodges the trim → straps bore grouted
cells; 'trimmed' advisory misattributes the length clamp to CMU in
masonry-free scenes); examiner REVISE (FAIL: legend slice(0,13) cap
silently drops steel rows on mixed levels — F3 re-manifest through
the cap; FLAG: LOD-200 steel paper prints cavity-R + IECC cite
unqualified — F2 rides 200-suppressed channels). ROUND-3 FIXES
(tip 81a76db): B/C/D CLOSED (examiner APPROVE — worst-case 24-line
legend layout holds, qualifier claim-sheet==qualifier-sheet 14/14,
advisories never crossed). ROUND 3 skeptic REVISE on fix A's seam:
F1 BLOCKER sub-6" remnant drop silently deletes R603.3.3 bracing
(0.5m stub + mid-run stem → ZERO straps, empty warning delta,
unpinned — S13 doctrine); F2 BLOCKER oblique CMU stem still bores
32mm at the strap plane (band misses ±zOffset·cotθ shift); F3
takeoff grade re-derivation unpinned (hardcoded Gr-50 survives).
ROUND-4 FIXES (tip 36859f1, F2→F1→F3 order): band widened
|z|·cotθ + skeptic's 45° SAT scenario, per-wall bracing warnings
(interrupted w/ exact extent + omitted variants, CMU-conditioned,
pure-steel byte parity by engine swap-in), -33/(Gr 33) pin. ROUND 4
(3rd attempt after 2 API deaths): skeptic APPROVE closing-grade —
z re-derived to 1e-9, independent no-allowance SAT (45° residual
0.31mm < 2mm skin), 20° widened-band-dominates proof + the 0.2·sinθ
floor shown DEAD CODE (detectTees sinθ≥0.3 domain), near-parallel
crossings stay in the documented pre-existing junction family
(boarded), 7/7 mutants die, 13/14 dump keys byte-identical (14th =
exactly the widening), corpora + E5 clean. Wording nit carried:
omitted-variant text says 'run(s) shorter than 6 in' even when the
band swallows the span (conservative, same remedy).
★ MERGED TO MASTER 17bdd64 + S18 checklist row ca2a1ab (2026-08-24;
suite 1883, tsc clean). LGS PHASE 1 COMPLETE — steel walls live
behind the 'lgs' override. PHASE 2 DELIVERED (feat/lgs-phase2 tip d368631, 5 commits, suite
1883 → 1910, E5 cmp-identical): Steel segment on the wall card
(resolved-construction highlight closes the MCP gap), panel Framing
row + progressive-disclosure Machine select (vendor optgroups,
unverified suffixed + sunk, absent-keys byte parity), can't-roll
warning channel (TF550H exhibit: T125 track warns, studs never;
warnings==labels agreement; geometry boundary held — profileFor
untouched). Pilot self-caught a surviving ladder probe and widened
the gate (44d5ff6). Synthetic-vendor no-warning gate because NO real
machine rolls T125 (vendor flange floors > 1-1/4" — honest data
state). ROUND 1 (wf_74bb6d6d): visual PASS/SHIP — clutter mandate held w/
pixel proof (0 differing px at all 7 cameras outside the panel;
Machine select styles byte-identical to Jurisdiction; card box
unchanged; MCP-gap highlight visibly closed); examiner APPROVE
(1560-member label/warning agreement; 3 warning shapes never
conflated; zero positive capability claims on paper; geometry
boundary proven at 400); skeptic REVISE narrow: F1 bridging-channel
warning site un-gated (3 surviving mutants incl. a class-LIE swap),
F2 card fallback count reads stud+track only (prints 1 where truth
is 2 — backing class missed), F3 'never changes geometry' claim
byte-false at LOD 200 (machine narrows the generic pick -33→-43;
vendor-own dims draw) — scope to 300+/constrains+brands wording.
FIX TIP 2e3346d (one commit each; manifest retraction stated
in-text, corrected 14/14). ROUND 2 (wf_fa0a90f9): skeptic APPROVE
closing-grade — 3 mutants die at exactly the new gates, resolver
move proven pure refactor by 2.47MB/42-scenario byte-diff, 14/14
re-tallied true, behavior pins mutation-live (doc-only prose sites
stated honestly), zero-backing arm verified not trusted.
★ MERGED TO MASTER c5b1bae (2026-08-24; suite 1912, tsc clean, E5
pin green). LGS PHASE 2 COMPLETE — machine selection UX live behind
the panel. Ships with Canada when its round closes. Phase 3
(floors/roofs R505/R804 + export research) is the remaining LGS
phase.
★ SHIPPED TO PROD 2026-08-24: plugin 9f86f12 → editor #716
(e7b5abdf) → private-editor #405 (75a8afa8), full-stack CI green
incl. both E2E + Bugbot, Vercel prod deploy. HP 4-part feedback +
LGS Phase 1 steel walls LIVE on editor.pascal.app. Note: p-e main
had moved (Aymeric's #404 bumped editor to community #702 slab fix)
— our chain built cleanly on top. NEXT LGS: Phase 2 machine-
selection UX (panel selector + can't-roll warnings, the boarded
two-controls design) then Phase 3 floors/roofs.
PHASES: 0 data model + catalog (delivered, above — both
research reports DELIVERED 2026-08-23: FRAMECAD/Howick vendor specs
[archived vendor PDFs + live tables, discrepancies recorded both-ways
with dates; phantom machines FRAMA 900/X-CALIBUR/Vertek killed] and
IRC R603-2021 + AISI S240/S230 + SFIA designator system [5 type
letters S/T/U/F/L, mils table, 3 distinct punchout regimes; 2024 IRC
unverifiable — encode nothing]. Catalog rule: every row cites source
or carries explicit unverified flag, gated by a citation-completeness
test. Verified-or-labeled-fallback vendor data, additive spec fields,
pure profile module, zero behavior change, E5 byte-parity gated) →
1 walls @400 (C-studs/tracks/R603 assemblies, screw+strap takeoff by
length/weight, box-envelope members with profile-truth labels first)
→ 2 machine selection UX (panel selector + can't-roll warnings) →
3 floors/roofs + machine-export research (FRAMECAD/Howick production
formats — stated non-goal v1).

# HP FIRST-CLASS SHIPPED TO PROD 2026-08-23 (evening)

## SHIP RECORD: private-editor #399 → (see deploy state above this run)
Chain: plugin 5c2650e (heat pump as a first-class object: pick proxy
hover/select/⌘-drag with live wiring recompute; true-proportion AC
block, native aspect uniform ≈0.896 scale; thickness-honest 24"
face-clearance standoff; 1.0m pad; overhang honesty flag; both pick
proxies colorWrite:false — the glass-case veil retired) → editor
#712 (cfe13068) → private-editor #399, full-stack CI green, Vercel
prod SUCCESS. 2 loop rounds + 2 browser QA rounds (SHIP 7/7 + 5/5).
QUEUE from the rounds: plain-drag vs ⌘-drag gesture parity (Julien's
kitchen-island exact-feel — host gesture, awaiting his call);
oblique-shell ULP canonicalization; WH/meter pick proxies;
wall-tool-armed-on-load host default.

# DAWN-10 SHIPPED TO PROD 2026-08-23 (~08:35 UTC) — NIGHT-10 CLOSED

## SHIP RECORD: private-editor #398 → 0617ef51
Chain: plugin d1c3c8b (1,736 tests; 8 night-10 merges) → editor #711
(45a8cce8) → private-editor #398, all CI green, Vercel prod SUCCESS.
Dawn visual: SHIP 6/6 — Julien's duct striping VERIFIED GONE at his
camera (0/1.6M differing pixels across provocation orbits); the
cross-color bore residual pinned + quiet at working distance.
NIGHT-10 TALLY: 2 prod ships (HP package 1231a771 + this), 10 merges
(host flake, HP body, zone honesty, legend+C5, roof residuals,
Manual-J, electrical outdoor, z-fight, +2 ship companions), tests
1,646 → 1,736. Morning review: docs/morning-review-2026-08-24.txt.
NEXT QUEUE (head first): lineset×dryer-duct bore (owns the pinned
allow-list), sloped-roof tieAt steel-in-rafter (B8b class),
register×fan fixture coincidence, elbow miters, hydration flash,
WH floating sign, plate-washer legend, Manual-J says-so gates +
115.0% wording, HP sign mirrored-text-from-behind (cosmetic).
CARRIED FOR JULIEN: hover-glow verdict, Q13, auto-assume-room-from-
slab, GPU toggle eyeball.

# HP PACKAGE SHIPPED TO PROD 2026-08-23 (night-10, ~05:20 UTC)

## SHIP RECORD: private-editor #397 → 1231a771
Chain: plugin 4a527ec (heat-pump package: scene-aware outdoor
election + AC-block asset visual + service-body suppression; visual
re-check SHIP 5/5 incl. the sign-as-handle bathroom-recovery flow)
→ editor #710 (df4089fd, carries the #709 flake fix) →
private-editor #397, all CI green, Vercel prod SUCCESS. GitHub
tarball 504s stalled the lockfile once (retried clean). Board cards
from the re-check: hydration flash of placeholder bodies before
suppression settles; WH floating-sign state on wet-room-less scenes.

# NIGHT-10 (2026-08-22 → 23) — "you have a lot to do. Put in an all-nighter."

## NIGHT-10 PLAN — drain the residual ledger + land the sizing batch
IN FLIGHT AT KICKOFF: Manual-J-lite verify r1 (latent-load lead
attack); heat-pump fast-follow visual check (election 486957c +
AC-block eb27037 — ships TONIGHT on SHIP); z-fight duct×AH fix
queued behind Manual-J's merge (same hvac.ts owner).
WAVE A (launched, disjoint files):
  1. feat/legend-grammar (plan-set.ts) — keyed symbols + legend rows
     for straps/HDUs/portal posts/uplift roles (anchor-bolt-dot
     class, 4 batches flagged) + C5 LOD-200 areas-fallback rows on
     paper.
  2. feat/zone-classifier-honesty (wall-model/compute/
     characteristics) — zone-twin dedupe (S8), head-noun tie-break
     + terrazza + substring traps (Kindergarden/Vineyard), outdoor
     room-coverage warning exclusion, concrete sub-1yd³ note.
  3. feat/electrical-outdoor-honesty (electrical.ts) — garden
     ceiling-light fiction + R314 alarm never-outdoors + 210.52(A)
     walk skip verification + B14 walk-removal ordinal stability.
  4. feat/roof-residuals (roof-framing.ts + one wall-framing
     string) — square-hip SAT, hip/crown sub-3:12 flags, sub-130mph
     tie-scope label, B10 stale parenthetical.
  5. fix/pointer-support-registry-leak (HOST editor repo) — the
     night-8 CI flake (order-dependent registry mock leak) fixed at
     both sides + gated; PR opened, not merged.
WAVE B (behind merges): z-fight duct fix (post Manual-J); Manual-J
fix rounds; yawed-section euler bands (post legend merge — same
plan-set owner). SHIPS: heat-pump fast-follow tonight; dawn ship for
the night's accumulation; morning review file.
DEFERRED TO JULIEN: auto-assume room from slab (product call, asked
day-9, unanswered); GPU eyeball items; hover-glow verdict (carried).
# NIGHT-10 ROOF RESIDUALS — feat/roof-residuals (2026-08-23, pilot)

## SHIPPED ON BRANCH (base db7ada2, suite 1644 → 1658, 4 commits): the
## roof-framing/wall-framing residual queue items, one commit each.
1. SQUARE-HIP APEX TRIM (b72d36e, GEOMETRY fix): width==depth hips (and
   the square mansard crown) had 2 pre-existing hip×common SAT overlaps
   at the ridge point — no ridge board at ridgeHalf 0, and layout()'s end
   station parks the apex common pair OFF-CENTER (u = −t/2); the two hips
   facing the overhung side drove through it. Fix: apexExtra derives the
   pair's plan overhang past each ridge end from the ACTUAL commons
   stations → extra slope inset along the 45° diagonal (mirror of the
   opposite hips' clearance). Rect hips derive extra = 0 — byte-identical
   (hash-swept; only square hip/mansard hashes move). Square class joins
   the interpenetration matrix (6 cases). Mutants 3/4 bite; the 4th is
   equivalent (overhang self-limits to 0 under any ridge board). S15.
2. HIP/CROWN SUB-3:12 RIDGE FLAGS (02a3285, B8a's stated residual, S17a):
   hip ridges answer with the commons' pitch; the MANSARD CROWN rides the
   same route via the inner frameHip at its COMPUTED pitch — sub-3:12
   even at the default 40° schema (tan ≈ 0.154), so the default mansard
   now states R802.4.3 honestly (compact-mansard spans gate carved out as
   INTENDED, non-vacuous crown pin). Dutch gablet was already served by
   the gable route — pinned. Byte movement: sub-3:12 hip 300/400 +
   default mansard ONLY (3:12 boundary, 40° hip, 200, 55° mansard, dutch
   all pinned clean). 3 mutants bite.
3. SUB-130 TIE WALL-PATH LABEL (031cc1f, the B10 skeptic's residual,
   S16): every belt tie (hurricaneTies without highWindUplift) now reads
   'hurricane tie (roof-to-wall ties only — wall/foundation uplift path
   not modeled below 130 mph design wind)'; ≥130 keeps the plain label
   (B10's wall hardware IS the continuation). Expected diff: tie LABELS
   in exactly 12 states (AL CT DE GA MA MS NC NJ NY RI SC TX — derived
   from profiles data + pinned; FL HI LA full-path plain; INTL tie-less
   byte-equal). Geometry label-only by strip-equality × 7 tying shapes;
   paper/takeoff byte-equal (labels never print; rows count by role).
   gable-400-windy sha REPINNED (its spec IS the belt) — the other 11
   hold. B10-EXPECTED-DIFF.md NIGHT-10 addendum. 3 mutants bite.
4. B10 STALE PARENTHETICAL (wall-framing.ts, one string): the uplift
   warning read 'flat roofs model no rafter/plate ties today' — stale
   since B8b landed flat ties. Now the generic truth: 'this roof models
   no tie members at its bearing' (the warning is the GUARD for future
   tie-less shapes, synthetic-matrix non-vacuous). New wording pinned +
   stale wording banned (B10d gate); warning never fires in composed
   scenes today → zero byte movement. 2 mutants bite. S16 amended.
E5 baseline byte-identical throughout (no square hips / sub-3:12 ridges /
high-wind ties on the baseline scene — confirmed per item).
NEW QUEUE OBSERVATION (found gating item 1): windy SLOPED roofs tie ON
the rafter station — tieAt centers the 1.5" steel inside the rafter
volume at every gable/shed/hip bearing (28-44 SAT pairs on the rect
defaults, pre-existing, never composed in the SAT matrix; only FLAT got
B8b's beside-the-joist offset). The square-hip matrix runs non-windy
because of it; candidate next residual: port the B8b per-station offset
to tieAt's sloped consumers.

# DAY-9 LIVE QUEUE (evening)
- Z-FIGHT at duct×air-handler junction (Julien screenshots, day-9):
  SHIPPED ON BRANCH fix/duct-zfight (2026-08-23, pilot). Discovery
  sweep: duct ends already terminated at receiving-body CENTERS, not
  faces — the real coplanar family is MATCHED SECTIONS + SHARED CAP
  PLANES on the junction verticals (plenum riser, boots, return
  riser/drop, whip drop). Fix: DUCT_JUNCTION_BURY (5mm) — verticals
  grow 2×BURY across the section (runs bury ≥5mm inside their
  sides), caps leave the run center plane (plenum +BURY past, boots
  2×BURY short; signs flip in soffit mode). Junctions stay legal S1
  terminating-INTO (whip/line-set precedent; MEP outside the
  structural gate — hvac.junctions.test.ts owns the class: sweep ×
  11 scenarios + pins + 5 mutations). E5 recaptured (7 members/juris;
  labels + plan positions + fixtures byte-stable); takeoff: 2 rows
  move one 0.1-lf rounding step (enumerated). Suite 1703→1715. Full
  family + byte movement: docs/plans/ZFIGHT-EXPECTED-DIFF.md.
  ROUND-1 REVISE addressed (geometry verified sound; claims fixed):
  (F1) the 'separated' claim on exhaust terminations was FALSE on
  the M3 doorwayPlan — the dryer exhaust and the line-set coil stub
  run the SAME equipAt→wall-anchor segment: the liquid line bores 2m
  coaxially INSIDE the exhaust and their end caps coincide (same
  normal, liquid cap inside the exhaust cap) — the ONLY cross-color
  coplanar pair anywhere (duct gray × warm red = the visibly-
  striping class). That is the day-8 queued lineset×dryer-duct BORE:
  reclassified as a named pre-existing residual; the doorway compose
  joined the sweep matrix with the pair allow-listed + PINNED
  present, so the allowance dies with the bore fix. (F2) CAUSATION
  CAVEAT stated in-suite + expected-diff: every burial-fixed pair
  was same-color-bucket (identical fragments cannot two-color
  stripe) — the burial closes the coplanar-geometry class as
  hygiene; Julien's striping most likely rides a CROSS-COLOR
  mechanism (bore caps / register×fan fixtures / host hover tint).
  DAWN VISUAL ROUND owns confirmation: reproduce the screenshots'
  camera on the merged tip, verify the striping is gone, else bisect
  the three candidates (block in ZFIGHT-EXPECTED-DIFF.md). (F3)
  keep-out prose corrected: ≥40mm both-grown worst case (boot 0.0812
  + return-vertical 0.1828 vs 0.3040 enforced).
  NEW FINDINGS for the queue: (a) bath supply REGISTER × exhaust-FAN
  fixtures render near-coincident placeholder boxes at one ceiling
  point (different colors — its own flicker class; fixture-placement
  ownership, not duct geometry); (b) same-run elbow-corner seams
  (return legA×legB, exhaust elbows, line-set penetration corners)
  share planes but live in ONE color bucket — invisible, left as
  legal seams; removing them means miter geometry.
- Manual-J-lite (feat/manual-j-sizing) in verify round 1 — lead
  attack: humid-zone latent omission (TX 2.5→1.5t smell).
- Heat-pump fast-follow (election 486957c + AC-block eb27037 merged)
  in pre-ship visual check → chain on SHIP.

# CONDENSER ELECTION FIX — fix/condenser-election (2026-08-22, pilot)

## SHIPPED ON BRANCH: validated condenser election (Julien exhibit root cause)
Exhibit: Julien's prod scene — floor-coverage gaps made the HOST declare
several interior partitions exterior=true (bathroom block + mid-plan
walls); nearestExteriorExit trusted wall.exterior, elected the nearest
false-exterior wall to the Laundry and PAD_OFFSET pushed the pad INTO
the Bathroom at (-2.6, 3.25) — the auto election itself, silent once
the override was deleted (the honesty fast-follow only guards the
OVERRIDE path). Fix: electHeatPumpExit walks exterior candidates by
distance until the pad spot validates OUTDOORS (not in an indoor zone;
not under probeSlabsFor coverage — holes are courtyards; not in a wall
body; outdoor zones legitimize — courtyard condensers are real);
exhausted walk keeps the least-bad spot + ⚠ pad/cabinet flag + level
warning. Row anchors to the ELECTED wall; override verbatim + warn
unchanged (byte-equal); seeding threads the same coverage (A4).
Gates: 16 hunt shapes byte-equal, E5 recapture byte-identical, 9/9
mutation probes bite, suite 1618. Exhibit auto spot now (-1.5, 8.1) —
0.6 m north of the true north wall.

## ROUND 2 (REVISE verdict, one finding): seed guard wrong-oracle retired
The fence+RO compound broke A4 seed parity: placeCondenserSeedSpot's
corner-flip guard still asked nearestExteriorExit(slid) — a garden fence
0.4 m from the pad always beats the elected wall (0.6 m by construction),
so the guard bailed to the RAW anchor; the seeded node fed back as a
verbatim override and recomposed dead-center on the window the engine had
slid past, disconnect re-hosted to the fence, silent. Fix: (a) guard now
tests the slid spot's projection-in-span on the ELECTED wall; (b) DECIDED
— machine-seeded override coherence via ε-anchor: an override within 1e-9
of the election spot or the engine's slid unit-#1 spot is the machine's
own point and keeps the elected row wall (post-seed compose == auto
compose, byte); anything farther is a real user drag and stays
verbatim-nearest (A4). ε is float round-trip tolerance, not a snap radius
— chosen over board-noting because every activated scene seeds
automatically, so the wrong-wall recompose was the DEFAULT lifecycle, not
an edge. Gates: fence+RO compound (seed == engine unit #1 + post-seed
byte-equality), fence-only disconnect pin + user-drag arm, off-wall-slide
bail arm; mutants G1/G2/E1/E2 all bite. Byte gates re-held (16 shapes,
exhibit override path, E5 recapture).

## QUEUED: the FALSE-EXTERIOR classification itself (election-input class)
The exhibit's wall.exterior lies come from the HOST's own coverage-gap
classification (declared frontSide/backSide) — and Bones' geometric
fallback (wall-model applyExteriorFallback) has the same gap exposure
on undeclared scenes. Fixing classification (e.g. probing slab
coverage against DECLARED faces too, or gap-filling the probe union)
re-classifies walls across every engine — sheathing/WRB/cladding,
stemwall hardware, device sides, CMU, takeoff areas — a byte-equality
blast radius that needs its own hunt + baseline set. The election is
now robust to the lie; the classifier still tells it. Keep the
misclassifiedScene repros (hvac.condensers / mep-honesty F3 /
place.test) as the gates when this lands.

# CONDENSER HONESTY SET — fix/condenser-honesty (2026-08-24)

## Queued: upper-storey condenser GRADE MOUNTING (the F2 truth route)
The honesty set ships the WARNING route for hunt 4a ('condenser for this
storey drawn at its floor elevation — grade mounting not modeled;
verify'). The truth route — mounting the upper storey's condenser row at
world grade via the ground level's frame — needs machinery the warning
channel doesn't have: Member.levelId carries MEMBERS only (renderer
buildGroups builds fixture-less foreign groups), so the condenser +
disconnect FIXTURES would stay orphaned at facade height; and the
pad/whip/line-set drop legs need a modeled facade riser from grade up to
the storey's wall penetration. To build it: (1) fixture-level levelId +
renderer/plan-set mounting parity, (2) a vertical line-set facade run
(outside-wall riser member, RO-aware), (3) disconnect placement against
the GROUND storey's wall face (layoutHvac only sees its own level's
walls today — needs the ground wall slice or a compute-side remount).
Gates to keep: hvac.condensers.test.ts override-honesty describe +
compute.mep-honesty.test.ts F2 describe (swap the warning assertion for
a world-grade one when the truth route lands).

# HONESTY FAST-FOLLOW SHIPPED TO PROD 2026-08-22 (night)

## SHIP RECORD: private-editor #396 → ef093760
Chain: plugin 43fbf41 (1610 tests; warnings-only, baseline
byte-identical) → editor #708 → private-editor #396, CI green first
pass, Vercel prod SUCCESS. Origin: Julien's SECOND missing-heat-pump
prod report; hunt agent mapped 4 classes (prod bundle verified
current — a stale bundle could NOT produce the symptom): (1) X-rayed
level owns no indoor zones → HVAC+plumbing silently empty while
framing/electrical render [THE likely hit]; (2) present but never in
the default camera + hidden half the orbit; (3) verbatim heat-pump
override parked indoors/afar, silent; (4) upper-storey unit at
facade height. The set: silent-empty MEP levels warn (3 classes,
per-silent-system naming, ||-mutant killed by gate); heat-pump
mis-drag warns (indoor-zone naming + >25ft NEC 210.63); upper-storey
condenser states floor-elevation mounting (grade remount queued —
foreign groups build with [] fixtures, machinery list on board).
M2 checklist amended. 2 rounds + orchestrator inline mutant gate.

# DAY-9 SHIPPED TO PROD 2026-08-22 (evening)

## SHIP RECORD: private-editor #395 → 67fbe97e
Chain: plugin 1cac1bb (1591 tests; 4 morning feedbacks) → editor #707
(7c6c77d7) → private-editor #395, all CI green first pass, Vercel
prod SUCCESS. Pre-ship visual: SHIP 4/4 on the starter template.
The four fixes: starter-template condenser (exterior election root
cause: slab-less zoned scenes; 'outdoor' room category; honest
conditioned figures; R314 open-air warning — 5 rounds, 22 gates);
sidebar warnings drawer + grouping; Basement→Subfloor; selected-wall
open cut (night-4 exemption retired). Queued from the rounds:
head-noun classifier tie-break, Terrazza/it, substring traps
(Kindergarden/Vineyard), electrical outdoor-zone residual family
(garden light + alarm float), room-coverage slab warning for outdoor
zones, wall-chip Full reset on fresh sessions (host, click-scoped
contract nuance).

# NIGHT-8 SHIPPED TO PROD 2026-08-22 (~15:28 UTC)

## SHIP RECORD: private-editor #394 → 8112e5f7
Chain: plugin 92d84d7 (1550 tests; full LOD-400 backlog + perf +
X-ray far-face) → editor #705 (8f162181) → private-editor #394
(community pin + submodule), E2E ×2 green, Vercel prod SUCCESS.
Pre-ship 3D visual: SHIP 7/7 (far-face probe 18 walls × 11 cams
zero violations; prod concrete-ghost report verified fixed).
CI note: 'Lint, Typecheck & Test' failed once on 3 host
pointer-support-cap tests (registry mock leak, order-dependent —
same tree passed 752/752 locally ×2 forced), green on rerun;
flake class recorded for the host owners.
Morning review: docs/morning-review-2026-08-23.txt.

# Bones board — NIGHT-8 (2026-08-22) — "Performance, responsiveness. test cameras."

## NIGHT-8 MERGE LEDGER (~morning) — BACKLOG COMPLETE, master e96ef30, 1531 tests
Merged this night, in order: B14 receptacles (00d39e4, 4 rounds) →
B6 roof package (75591f9, 2) → B9 wall bracing (6c45c8e+recapture, 2)
→ B11 snow headers (1bd3a7d, 2) → B7 hip thrust (5d415e7, 2) →
B10 wind uplift (298b3ef+S16 renumber, 1 — first single-round pass of
the wave) → B8 roof closures (3616d1a ff, 2) → perf/materials
(b883cb9, 1) → B21e waste honesty (e96ef30, 2). Tests 1332 → 1531.
Every wave-1/wave-2 batch from the 2026-08-20 audit is now on master.
IN FLIGHT: feat/xray-far-face (Julien's live ask: X-ray hides the
NEAR wall face, far-face drywall stays — camera-aware per-face cull
on the perf branch's visibility machinery).
JULIEN PROD REPORT (answered): concrete-base gray lines through
X-ray floor on editor.pascal.app = the pre-tri-state ghost overlay,
fixed by the day-8 UX merge, ships with this chain.
LOOP OBSERVATIONS: the domain-extrapolation class (B9 CS-PF height →
B11 header terminal rule → B8 gambrel ridge) — the skeptics now
pattern-match it across batches; two single-finding rounds ended in
double-APPROVEs. Worktree-collision class recurred (B21e r1: examiner
wrote into the skeptic's worktree) — briefs now demand unique paths.
AWS SSO expiry killed 2 agents mid-flight (~08:00) — default chain
stayed alive, both resumed with zero loss (incremental commits).
QUEUED RESIDUALS (next cycle): plan-set legend grammar for
strap/HDU/GR + uplift roles (anchor-bolt-dot class, 4 batches note
it); zone-twin dedupe (S8); square-hip SAT gate; yawed-section euler
bands; sub-130mph roof-tie wall-path label; LOD-200 paper omits
areas-fallback rows (C5); B14 walk-removal ordinal re-base; B10
warning stale parenthetical; hip/crown sub-3:12 ridges; concrete
sub-1yd³ display collapse note; GPU eyeball on toggle recompile.

## NIGHT-8 PLAN (Julien's sign-off asks + backlog continuation)
1. BACKLOG: B9 merge (final skeptic in flight) → B11 snow headers;
   B7 hip thrust (pilot building) → B8 roof closures → B10 uplift;
   B21e waste factors when takeoff.ts quiets; queue residuals
   (zone-twin dedupe, plan-set legend grammar for strap/HDU/GR,
   square-hip SAT gate, yawed-section euler bands).
2. PERFORMANCE + RESPONSIVENESS (new ask): profile the dev build —
   X-ray activation latency, mode switching, member-heavy scenes
   (master emits far more geometry than a week ago: deck+GES+recep),
   reconcile batching, FPS during device moves. Findings → fix
   pilots with the usual loop.
3. CAMERAS (new ask): browser QA on camera flows — orbit/pan/zoom in
   Normal/X-ray/Basement, transitions on level activation, exploded
   strata, camera during MOVE drags. Evidence-based rounds.
4. SHIP at dawn when loop-verified: repin dev 3002 → editor PR →
   private-editor PR → prod; morning review file.

## NIGHT-8 PERF+CAMERA QA RESULTS (evidence /tmp/perfqa/, 54 files)
CAMERAS: CLEAN BILL 16/16 — orbit/pan/zoom in all 3 modes, activation
transition pose byte-identical, exploded cycle, 0.000m camera drift
across 7 move drags, cold-load-with-xray self-heal + sane pose, zoom
extremes vs below-grade content (rods/buried runs) artifact-free,
0 console errors across ~16 sessions. Nothing camera-side blocks ship.
PERF (softGL caveat on absolutes; JS-only + relative deltas valid):
F2 PRIMARY — move ghost preview = full recompute + material rebuild
PER POINTERMOVE (~2.4s JS/cursor step, hardware-independent) → fix
pilot feat/perf-move-materials LAUNCHED (throttle + instance-matrix
updates). F1 — shader/program rebuild on EVERY X-ray/Basement entry
(347 unique material instances re-minted per build; 2.6s pure-JS TSL
rebuild per toggle; wants stable material cache) — same pilot.
F3 — heap leak +2.9MB/toggle-pair + 1229 deleted-texture binds
(disposal bug) — same pilot. Wall-mode chips ~330ms even in softGL
(fine); toggle churn flat; move COMMIT lands grid-snapped exact.
GPU EYEBALL for Julien: whether driver program caching absorbs the
toggle recompile on real hardware (headless can't tell).

# DAY-8 (2026-08-21) — full backlog go ("all these are great ideas, please work on implementing them")

## DAY-8 STATUS (~evening) — 7 merges on master (9ecf978, 1281 tests)
MERGED today, in order: B13 alarms (8438485) → UX tri-state (89e64f0
+ seam fix bd33ffa) → move-parity (45b6418) → B21d schedule + panel
hookup (52320a1) → B20 plumbing safety (59e73b8) → B18 anchorage
(3fd0a1a) → B12 GES (9ecf978). Tests 1054 → 1281.
B12 loop: 4 verify rounds / 5 pilot commits. Round 1 killed 4 defects
(street lateral boring rod 1 — enshrined in the baseline; bond
swallowed inside the SE feed at the PANEL end; L-plan rods inside a
wing footprint unflagged; per-storey GES silent). Rounds 2-3 narrowed
to the no-wall-path FALLBACK branch being invisible to the new scans
(endpoint coincidence, then mid-leg coincidence at a 49mm
perpendicular-island window). Final machinery: deterministic ±6
bay-step strap ladder that also refuses wall-band bores, honest
'separate in the trench' confession when undodgeable, scene-aware rod
slide/flag, per-storey honesty labels (B13 convention). Examiner
APPROVE r1+r2 (GR/IB device-tag bubbles + legend keys added).
INLINE GATE (r4): the skeptic stalled 6× (API), so the merge gate ran
inline in a detached worktree — 201-position panel sweep w/
independent seg-seg math (worst clearance 35.95mm ≥ 24.5 floor, zero
silent embedments), 49mm-window determinism ×3, bond self-collision
scan, alley dodge, baseline sha-chain 3fd0a1a→bd4812f5 + recapture
byte-stable, suite 1281 + tsc. LESSON (recorded for future inline
probes): Member.dims are LOCAL-frame + rotation — a world-axis
reconstruction reads z-running legs as phantom parallels; my probe
first "found" a silent embedment that was my own math (the honest
geometry passed once rotation was honored).
B6 RESTARTED fresh (3rd API death with ZERO commits — the giant
context itself was timing out). New standing rule IN EVERY PILOT
BRIEF: COMMIT INCREMENTALLY + push per slice (a/b/c/d pattern).
IN FLIGHT: B6 roof package (fresh pilot, worktree pilot-b6);
B14 receptacle coverage (launched off 9ecf978, worktree pilot-b14 —
E5 baseline reset expected; baseline-recapture conflict with B6 at
merge is EXPECTED, standard recipe). Worktree pile pruned to the two
live pilots. Board-note advisories from B12 (queued): gecSizeAwg flat
2 AWG >200A (250.66 reaches 1/0 above 350 kcmil); heat-pump override
parked at the meter drags the condenser onto the GEC grade run
(night-4 fixture-overlap class now extends to GES); rod-to-rod GEC
leg masks inside the slab comb on elevations (examiner note); exotic
courtyard rod-vs-neighboring-wing (MEP-vs-structure SAT un-gated by
design, pre-existing class).

## DAY-8 PLAN — wave structure by file ownership
IN FLIGHT (UX, from the morning's 6 asks): feat/xray-activation-ux
(A walls-low default, B service auto-place + button removal, C no
sidebar duplication, D off=finished-house w/ visible fixtures,
E OFF/X-RAY/BASEMENT tri-state modes, systems on by default);
feat/wall-node-move-parity (outlets/boxes/service points move like
windows — hover, cross, wall-slide, one undo).
WAVE 1 (launched, disjoint files): B13 alarms truth (electrical.ts);
B20 plumbing safety (plumbing.ts); B6 roof sheathing+underlayment
(roof-framing.ts, MUST add the B4 system filter to takeoff
suppression gates); B18 anchorage truth (foundation.ts+cmu.ts);
B21d door/window schedule sheet (plan-set.ts).
WAVE 2 (queued behind same-file merges): B12 GES (after B13),
B14 receptacle coverage (LAST electrical — baseline reset, E5),
B7 hip thrust (after B6), B8 roof closures (after B7), B9 bracing,
B10 uplift (after B8), B11 snow headers, B21e waste factors,
lineset×dryer-duct bore, F3 trap-drop residuals.
Loop rules unchanged: skeptic+examiner per batch, gates same commit,
detached worktrees ONLY (two incidents), inline gate fallback on
agent stalls, ship batches as they accumulate green.
PILOT BRIEF RULES (standing, added day-8): (1) COMMIT INCREMENTALLY
+ push per slice — API timeouts killed a pilot 3× with zero commits;
(2) mutation probes revert from /tmp BACKUP COPIES, never
`git checkout <file>` — two pilots (B14 r1, B9) wiped uncommitted
work with checkout mid-probe.

# NIGHT-7 SHIPPED TO PROD 2026-08-21 (~08:30)

## SHIP RECORD: private-editor #388 → b9688fd7
Chain: plugin 3022fc0d (1054 tests; ecadea5 code + docs) → editor #698
pin onto main w/ #697 → private-editor community pin + submodule @
8408cb88, all E2E green. 3D visual APPROVE (numeric evidence).
Morning review: docs/morning-review-2026-08-21.txt.

# NIGHT-7 (2026-08-20 → 21) — archive

## ~06:30 state — ALL night-7 work merged (ecadea5, 1054 tests)
MERGED tonight: F3 DWV (4 rounds) + F1 line-set (4) + B17 slab (2) +
B19 return-air (3) + cross-trade lateral (3) + MEP glyph de-collision
(4) + F2 selection HOST-side (#697, browser 7/7). Tests 950 → 1054.
INCIDENT (recovered): verify agents twice checked out shas in the
MAIN checkout; a detached-HEAD window swallowed three merges' pushes
(silent no-op against a stale master ref) and rode glyph rounds 1-3
into the merge line. Recovered by repointing master at the verified
HEAD + re-landing the stranded cross-trade merge. Rule reinforced in
every brief; still worth a mechanical guard (queued).
PENDING: pre-ship 3D visual round (running @ fc31b7f — glyph merge is
paper-only, verdict carries to ecadea5) → ship chain → morning review.
QUEUED for next cycle: glyph frost-recipe divergence (2-crossing
exhibit), B19 vertical-duct heuristic advisory, equipment-legend
split by meta, B18/B20/B21d/B6-B16, F3 trap-drop residuals.

## ~03:30 state — three merges on master (d64bfc5, 1013 tests)
MERGED: F3 under-floor DWV (4 rounds — buried sloped tree, per-crossing
sleeves, floor-line jog, upper-storey truth, arrows/marker/ticks with
de-collision); F1 line-set (4 rounds — shared-route pair, rolled risers
w/ triplet-index axis + corner-cancel, both colors on paper); B17 slab
truth (2 rounds — field+vapor members, first-principles pour math,
plate-like TRUE-thickness stroke class incl. the latent subfloor twin).
Conflict seams (baseline recapture + two deduped-brace test merges)
resolved; baseline byte-stable across double recapture.
IN FLIGHT: post-merge combined round wpw34n3d4 (arrows x lineset seam,
launched at 086ad18 — conclusions carry to d64bfc5); B19 round 2
(return-trunk keep-out + fallback flags + fictitious-section fix);
F2 final browser QA (selection + hover glow + fresh-load self-heal).
QUEUED at dawn: merge B19 on green -> final pre-ship round on the ship
sha -> visual full-stack round -> ship chain (plugin pin + editor PR
w/ F2 + private-editor) -> morning review.
NOTE api instability all night: verify agents stalled repeatedly;
inline merge-gate verification (B5 precedent) used for F1 rounds 3-4.

## NIGHT-7 PLAN (user directive ~19:00: "all nighter again, adversarial loop as usual")
PHASE 1 — close + ship the day-feedback batch:
- F1 line-set @ 40276ab: closing skeptic gate resumed (wf_9d7dc388).
- F2 selection: pilot finishing hover affordance + re-verifying its 2
  post-restart commits (fb86f233 ownership rule, ffc98cb1 degenerate
  self-heal); then full browser QA vs plugin master (d8bcc5d raycast
  fix), then PR.
- F3 DWV: pilot round 3 (R1 stack DISCONNECT regression, R2 sleeve
  per-CROSSING not per-terminal-leg, R3 courtyard branch crossings,
  R4a stub clamp to room polygon / R4b flush trap riser).
- MERGE ORDER: F3 → F1 (both touch plumbing.ts; F1's plumbing diff is
  small — export + bandHalf) → combined examiner round (arrows × line-
  set interaction, both flagged) → visual round → ship (plugin batch +
  editor PR w/ F2 + private-editor chain).
PHASE 2 — wave-2 blockers (pilots tonight): B17 slab-on-grade member +
R506 vapor retarder + concrete yd³ (foundation.ts+compute — biggest
pour unbooked); B19 HVAC equipment placement truth (garage AH,
M1602.2) + return path + duct sizing. B18 anchorage AFTER B17 lands
(same file). B20 plumbing safety AFTER F3 merges (same file).
PHASE 3 (as capacity allows): B6 roof sheathing (NEEDS the B4 system-
filter advisory), B8 roof closures, B21d door/window schedule sheet.
Rules unchanged: loop rounds per batch, gates in same commits, byte-
equality manifests where defaults move, board updated as things land.

# night-6 SHIPPED TO PROD 2026-08-20 (+ day feedbacks in flight)

## SHIP RECORD (~15:30): private-editor #386 → b836203e
Chain: plugin 85238a8e (950 tests, examiner ship-stamp) → editor #695
pin-bump onto main with #689 + #694 (drag fixes; #694 browser-APPROVED
on the exact defect geometries: no wrong-wall re-parent, ONE undo
restores exact baseline census) → private-editor community pin +
submodule gitlink @ 182f7c94, all E2E green, merged = Vercel prod.
Morning review: docs/morning-review-2026-08-20.txt.

## DAY FEEDBACKS (Julien, ~13:00-14:00) — 3 pilots
F1 line-set routing feat/ac-lineset-routing: pilot round 1 done
(routePipe reuse, MEP legend, +9 tests) → verify REVISE (pair collapses
on detours — height-only offset, no pair awareness; suction invisible
on paper — plan projection overprints) → pilot round 2 IN FLIGHT
(route-once + uniform Y shift + schematic plan nudge). Advisories
queued: cross-unit plane step (SUPPLY_STEP pattern), route cost
55 lf vs 8.5 crow-flies (try both wall directions), flag counts legs.
F2 nearest-first selection fix/nearest-first-selection @ cb6faa83
(rebased on post-ship main): root cause = #683 blanket transparency
removed hidden walls from hover candidacy entirely; fix = wall handles
its gated event unless outranked by own subtree / non-wall hit within
0.35m ε / wall-anchored hit further down ray. 16 tests, root suite
green. Serving on :3002 NOW; visual verification IN FLIGHT. Trade-off
noted: manual 'down' walls (no Bones) hoverable again.
F3 under-floor DWV feat/underfloor-dwv @ a94be32: root cause = the
room-category FALLBACK drew drains +0.08m ABOVE the slab (placed-
fixture path already correct); rebuilt to buried sloped tree (P3005.3
per-size slopes, sewer exit label, sleeves P2603.4, UNDER_FLOOR_CLEAR
0.45 both paths), MEP flow arrows. +11 tests (961). Verify round
IN FLIGHT.
MERGE ORDER when green: F3 → F1 (both touch plumbing.ts; F3 landed
routePipe changes? no — F1 exports routePipe, F3 doesn't touch it;
takeoff untouched by F3) → next ship batch with F2 host PR.

# Bones night board — night-6 (2026-08-19→20) ARCHIVE BELOW

## NIGHT-6 ~10:00 state — morning stretch
Master f402f0c (937 tests): f7db0c2 = round-6 verify fixes (wrapRow
LOOPS — no ellipsis ever, P4; cross-level lift = DELTA via
relativeLevelBaseY — upper-storey roof drew a storey high; size-less
legend rows subfloor/hanger; blocking clipped at BOTH joist faces on
oblique rims — gate proven to bite; lineal→linear feet). a132f3d =
B4 MERGED (skeptic APPROVE 7/7 + examiner PASS: one row per material,
8d re-key, CMU zero gypsum, climate-zone labels LIVE in all 51 states
— were dead from key mismatch + [object Object] latent). f402f0c =
WAVE-2 backlog (27/27 confirmed, 0 rejected: B17 slab phantom BLOCKER,
B18 anchorage, B19 HVAC garage-equipment BLOCKER, B20 plumbing safety,
B21 paper honesty, 3 carryovers) + B21a/b/c fixed inline (flag block
PAGINATES to continuation sheets; bolt legend derived from members;
LOD stamp from composed detail incl. cover).
B4 advisory for B7: suppression gates need a system filter when roof
sheathing members land.
PENDING: B5 skeptic re-run (examiner already PASS — manifest exact,
piece+bd-ft conservation, storey-1 byte-equal; advisory: no sheet
cites R317.1 — legend row candidate); visual QA full-stack round;
then B5 merge → final paper round on merged master → dawn ship →
morning review. NOT started (queue): B17-B20 pilots, B6-B16.

## NIGHT-6 ~08:00 state — batch verified twice on paper, host fix MERGED
Plugin master 1555027 (tests 921): b550986 = round-e4ce6fc skeptic fixes
(live-wiring deps BLOCKER [active] + setLiveResult(null) on [nodes,node];
B1 flag COMPOSITION ' | '; B3 lo/c/hi span intersection + non-vacuous S4
gate) → 1555027 = examiner round-5 fixes (floor sheet: deck = layer ZERO
translucent 0.35 — washout killed; legend rect widens per circuit column;
engineered headers book as supplier SKU pcs+lf, girders keep dimensional).
HOST: #689 (hidden-wall pointer HOLD for the four wall-opening tools)
MERGED to editor main @ 1b9300f7 — the fast CI fails were a transient
GitHub 504 on the plugin tarball; reruns green.
DEV 3002: editor main (with #689) + plugin pin 1555027, healthy.
RUNNING (5 streams): verify loop w63ar7xbr (skeptic+examiner @1555027);
audit re-run w3wvgr4i6 (foundation/hvac/plumbing/takeoff-paper + 3
carried verifier claims — MEP penetrations, king studs, veneer ties);
pilot B4 feat/lod400-b4 (gross-vs-member double-book + climate-zone
rider); pilot B5 feat/lod400-b5 (PT sole plates R317.1 + anchor-row
text, 51-jurisdiction expected-diff manifest); full-stack visual QA
(door/window drag parity + LIVE recompute mid-drag + outlet regression
+ deck strips 3D + composed header flags + undo-once).
NEXT: process 5 verdicts → fix → merge B4 then B5 (rebase order per
backlog sequencing) → dawn ship (editor PR pin bump off origin/main
worktree → private-editor PR community pin + submodule gitlink) →
morning review file. LOD-400 continuation after: B6-B8.

---

# Bones day board — 2026-08-16 — DAY COMPLETE (shipped ~17:30)

## LOD-400 AUDIT LANDED (~05:00 night-6): docs/plans/LOD400-BACKLOG.md
8 system auditors → 24 adversarial verifiers → synthesis (26/33 agents
survived API errors; foundation/hvac/plumbing/takeoff-paper AUDITS
died — RE-RUN those four next session, the confirmed set below is
framing/roof/electrical/layers-heavy). ~20 CONFIRMED findings, 3
BLOCKERS. Backlog is board-ready with batches, gates, blast radii:
B1 header truth (1.5" sliver booked as 4x8 + silent RO height clamp),
B2 roof span discipline (26.5ft one-piece rafters, dead span tables),
B3 subfloor member (booked 33 sheets, zero geometry), B4 sheathing
double-booking, B5 PT sole plates on concrete (R317.1) + mudsill row,
B6 life-safety electrical (alarms per R314/R315 incl. no-hallway
scenes + CO; interconnect; outdoor receptacles 210.52(E); counter
receptacle heights; GES/grounding; cable staples/protection; fixed-
equipment circuits), B7 roof completeness (sheathing/underlayment
members, hip/mansard/dutch ties, structural ridge <3:12, non-perp
valleys, flat-roof ties, gambrel purlin support), B8 jurisdiction
fidelity (snow-load header sizing; CA≡INTL structural byte-equality).

## NIGHT-6 (~05:00 status): A pilot finishing (door-drag X-ray fix,
crashed twice on API errors, resumed, was committing after all-green
verification), B LANDED (live recompute 51084b6), C = the audit above.

## NIGHT-6 PLAN (2026-08-19 → morning) — user: doors/windows must move
## like in the ORIGINAL editor with Bones on; framing recomputes LIVE
USER REPORT (verbatim essence): moving windows/doors with Bones on is
broken — "it disconnects, rotates in place in red 90° from the wall";
it should slide easily along the wall; the framing around the opening
should recompute live; "look for what makes it so easy in the original
editor... make sure that same experience is available when using
bones"; smooth, great experience. All-nighter + adversarial loop.
PRIME SUSPECT (regression, ~hours old): #683 made HIDDEN walls
pointer-transparent (the D4 outlet fix) — but the host door/window
MOVE tool almost certainly finds its wall by raycasting wall meshes;
with X-ray on (wallMode 'down' hides walls) the drag now loses the
wall → detached ghost, red 90° invalid pose. Before #683 the invisible
meshes caught the ray (that's WHY outlets misfired), so door drags
worked in X-ray by accident of the same defect.
TRACK A (pilot): repro at the shipped build (X-ray on → drag a door),
root-cause in the host move/placement path, STUDY the original
editor's door/window placement UX end-to-end (attach/slide/snap/live
preview mechanics), fix so the SAME experience holds in X-ray:
likely amend #683's guard — hidden walls stay pointer-transparent for
SELECTION but remain ray targets while a door/window/device MOVE or
PLACE tool is active (or the tools raycast the active wall's plane
directly). Host PR; visual verify both modes: outlets clicks still
pass through, door drags slide.
TRACK B (me): LIVE framing recompute during drags — bones recompute
today keys on useScene.nodes (committed writes only); host drags ride
transient live-node overrides (core useLiveNodeOverrides /
getEffectiveNode), so kings/trimmers/header only update on DROP. Make
FramingRenderer recompute against EFFECTIVE nodes during an active
drag, throttled (~10Hz), falling back to the memoized path when no
overrides are live. Perf-gate it (computeLevel is a few ms — budget).
SHIP through the full chain on double PASS.
TRACK C (user directive, mid-night): "run the loop all night to make
sure we are BIM level 400 everywhere" — full-systems LOD-400 AUDIT:
one auditor per system (wall/floor/roof framing, foundation,
electrical, plumbing, HVAC, layers/finishes, takeoff/paper) hunting
anything below fabrication level — symbolic members, missing hardware
(hangers/straps/nails/clips), unmodeled connections, absent code
details — then adversarial verify of the findings, then fix batches
by severity through the loop.
TRACK B LANDED (51084b6, 881 tests): live framing recompute during
drags — renderer folds useLiveNodeOverrides into the compute at ~10Hz
(trailing throttle), falls back to the memoized committed path when
overrides clear; reconcile stays on committed. Gates: override
folding, live window move re-derives the header, throttle contract.

## NIGHT-5 SHIPPED (~04:45): prod main b6bf8acb — OUTLETS ARE LIVE
Plugin 22d9e7ae via editor #684 (main 751e983a, carrying #682 wipe
guard + #683 pointer-transparent hidden walls) → private-editor #371.
Full-stack final verify: skeptic PASS (mechanical remerge = 3 board
lines; flag semantics; onCommit removal traced into the host guard;
byte story: compute ignores the flag entirely) + visual PASS (63
device nodes seed, drag/undo/redo EXACT on outlet + panel + the old
dead-click south wall, RO snap + stud close-up, reload persistence,
9/9 autosaves 200 with 70 extra nodes — wipe guard held). 866→878
tests. SHIPPED: movable outlets live (D2/D3 one root cause — the
drag-frame onCommit cascade woke space-detection mid-commit → three
undo entries; commits are ONE tracked write now; D4 = invisible
hidden-wall raycast meshes, host #683), scene-wipe fix (#682:
StrictMode/unmount flushed an empty autosave during the load window —
autosave arms only after hydration, empty-over-populated PUTs 409),
tee guards (parallel false-tee filter, width-aware retreats × 3
consumers, junction warnings), examiner round-4 fixes (legend
2-column, CU tag, GEN rewalk 256/16°).
NIGHT-5 QUEUE (new):
- X-RAY WALL CARD (ticket-worthy, intended #683 semantics): hidden
  walls are pointer-transparent everywhere, so clicking a wall in
  X-ray no longer opens the Engineering card — solid-mode-only in the
  viewport now. Options: sidebar affordance, or host fallthrough
  (wall as lowest-priority hit).
- Host tickets from pilot A: space-detection double-subscription
  (tracked+untracked twin writes), MoveRegistryNodeTool pauses
  temporal directly, detection re-runs on undo restores, plan-frame
  drag gesture needs floor-point cursor (candidate: raycast the
  parent-wall plane), level-scoped creates trigger one-time
  classification transition on API-built scenes.
- apps/community needs wipe-guard layers (b)+(c) (its own onSave +
  API lack them; #682's layer (a) protects once editor ships).
- Skeptic advisories: junk movableOutlets in raw stored scenes reads
  ON (zod guards parse paths only); flag-OFF doesn't remove seeded
  nodes (by design). Corner-lap cap × through-drywall on fat-stem
  hybrid corner/tee geometry (pre-existing class). Palette redesign
  for a >40 full-family color floor. Fixture-fixture overlap warnings
  (panel parked at the WH cabinet — A4 covers ROs only).

## NIGHT-5 STATE (~07:30) — three tracks live
TRACK C (me): tee-stem TRIO CLOSED (df565b7 — layers get tee insets
mirroring detectTees; BOTH engines use the width-aware oblique retreat
(t + w·|cosθ|)/(2·sinθ) after a 45° repro beat plain (t/2)/sinθ; gate:
composed SAT for fwd/rev/45°/27° tees) + FOREIGN CULL closed (4e2dd82
— cullChildren walks built.foreign too; gable finishes cull + exempt
like own-group). 866 tests. Verify whociofv8 RUNNING (narrow skeptic
on the two fixes + FULL BLUEPRINT EXAMINER round — first paper review
since condensers/AC circuits/cavity-fit landed).
PILOT A (outlets live UX) + PILOT B (scene-wipe) RUNNING since ~06:45.
Pilot A owns the dev server tonight (may bump pin + restart).
## NIGHT-5 TRACK A FINAL ROUND (post-fix, plugin 5973948 + editor branch): PASS both surfaces
Scene eda991bca689 (default-ON path — NO movableOutlets key in the graph;
63 device nodes seeded on view). Sequence + panel statuses:
baseline 1255·77 → Place service points 1241·74 (ONE-TIME host wall
classification transition — level-scoped CREATES are commit candidates and
wake space detection; the -3 devices = classified exterior walls correctly
LOSING their over-placed exterior-face receptacles; deterministic:
headless compute on the classified scene = 1241·74 exactly) →
OUTLET drag 1242·74 (+1 blocking, devices stable) → Cmd+Z 1241·74 EXACT →
Cmd+Shift+Z 1242·74 → PANEL drag 1255·74 (homeruns re-anchor, box visibly
at the new spot) → Cmd+Z 1242·74 (reverts ONLY the panel move — per-drag
undo granularity proven) → Cmd+Shift+Z 1255·74. Persistence (API after
session): outlet wallT 0.0667 vs seed 0.1727 + panel wallT 0.2667, both
position [0,0,0] (normalized), 147 nodes = 76 + 8 services + 63 devices,
zero duplication. Evidence: /tmp/qa-n5a/final/*.png + result_final3.json.
- FIX FOUND IN THE ROUND (5973948): flag guard must read ABSENT as ON —
  stored scenes never re-parse through the plugin schema on load, so a
  `=== true` guard left the default-path scene with ZERO device nodes;
  it's `!== false` now (explicit inspector/MCP false still disables).
- GESTURE NOTE (pre-existing host design, NOT an outlets defect): the move
  tool's cursor is a PLAN point resolved on the GROUND plane — dragging a
  wall-mounted box from an eye-level camera with the pointer at BOX height
  yields no usable grid:move (near-horizontal ray) and the place click is
  ignored (hasMovedRef gate). Point the cursor at the FLOOR under the
  destination (or look down) and everything tracks. Candidate host
  improvement: raycast the PARENT WALL plane for parentFrame drags.

## NIGHT-5 TRACK A COMPLETE — outlets live UX: D2/D3/D4 root-caused + fixed, flag ON
Branch feat/outlets-live-ux (base f495148, final sha = HEAD of branch);
873 tests green + tsc clean per commit. Root causes from an INSTRUMENTED
live session (store-subscription write log + wildcard event log + raycast
picker; scenes ff614df08297 / 71a9776bba81 / f34f62e3a161, traces in
/tmp/qa-n5a/*.json):
- D2+D3 ONE ROOT CAUSE, not two: the host MoveRegistryNodeTool runs
  parentFrame.onCommit with history RESUMED and follows it with
  updateNode(parentWall, resolveSupportSlabPatch) — a SEMANTIC NO-OP that
  still flags the wall as a scene-commit candidate. That wakes the host
  space-detection sync mid-commit (core lib/space-detection.ts), which
  rewrites every unclassified wall's frontSide/backSide (API-built scenes
  carry 'unknown'!) + materializes zone schema defaults — as an
  untracked+tracked TWIN write pair (the tracked twin = detection
  double-subscription re-running on a stale snapshot; host bug, see
  below). extractWalls derives exterior-ness from EXACTLY those fields →
  layers/receptacle faces re-derive → 1255·77 → 1218·79 (D2). One drag =
  THREE tracked entries (position write, onCommit write, detection write);
  Cmd+Z pops only the detection entry while detection re-runs against the
  restored snapshot → third state 1207·74, wiring+panel gone, 5 device
  nodes orphaned (D3). The night-4 "panel drag 77→74" was THIS, not
  engine re-derivation.
  FIX (plugin-only, 2d68b95): drag frames (device AND service) carry NO
  onCommit → the host branch never runs, a commit is ONE tracked write
  ({position: on-axis point}); the reconcile batch converts it to
  wallId+wallT + position [0,0,0] history-paused (device/place.ts,
  service/normalize.ts — the wallT-slider quirk stays retired). Verified
  live: drag → 1256·77 exact engine parity, past +1 per drag, Cmd+Z →
  clean 1255·77 (box AND wiring return), Cmd+Shift+Z → 1256·77, moved
  nodes persist normalized.
- D4 DEAD PLACE-CLICK ≠ placement validity: walls hidden by the wall-mode
  pass ('down' in X-ray, cutaway faces, auto-mode interior partitions)
  keep FULL-HEIGHT invisible raycast meshes (collision-mesh carries the
  pointer handlers) and the selection path stopPropagation's — the south
  arm click hit an invisible wall at 1.03m instead of the visible box at
  3.93m (raycast-pick evidence), selected the WALL, and the next click
  ARMED A WALL MOVE (accidental wall commits + zone/slab/ceiling sync =
  more corruption). Host fix on editor branch fix/outlets-hidden-wall-clicks
  (c40d7fd9, base 763d1b35, files identical to origin/main 6cfff809):
  WallCutout stamps userData.wallHidden; wall renderer handlers
  early-return while hidden (no emit, no stopPropagation) so R3F continues
  to the next hit; delete-mode excepted (deleteInvisible flow needs hover).
  PR-TO-BE — not opened per brief. Verified live: south arm 'grabbing',
  commit lands (1252·77 honest re-route), stray Alt-click harmless.
- FLAG: movableOutlets now defaults ON (bf980e0) — ship the plugin bump
  ALONGSIDE the editor PR (without it, D4's phantom-wall misroute stays —
  a pre-existing class that already bites bones:service in prod today).
- Gates: place.test.ts normalization matrix (convert/converge/cross-wall/
  wall-less/kind-compose), frame.test.ts onCommit-ABSENCE pin + rationale
  + normalizeServiceAnchors matrix; E5 row updated with the drag-commit
  contract. Host-side gating impossible plugin-side — the editor PR should
  add a wall-events test.
- HOST BUGS surfaced for tickets (beyond the PR): (1) space-detection
  initSpaceDetectionSync appears DOUBLE-SUBSCRIBED — its wall/zone writes
  land twice, once paused (untracked) then once tracked from a stale
  snapshot → auto-derived state pollutes undo history scene-wide; (2)
  MoveRegistryNodeTool pauses the temporal store DIRECTLY (not the
  depth-counted pauseSceneHistory) so getSceneHistoryPauseDepth()==0
  mid-commit and detection isn't deferred; (3) detection re-runs on UNDO
  restores and partially re-applies what the undo removed (fights Cmd+Z on
  any wall-adjacent edit in API-built scenes).

## NIGHT-5 PLAN (2026-08-18 ~06:30 → morning) — user: "go, be even more ambitious, all-nighter"
Three tracks, two ships targeted (mid-night + dawn):
TRACK A (pilot 1, host+plugin): MOVABLE OUTLETS LIVE UX — root-cause
and FIX D2/D3/D4 so movableOutlets can default ON:
- D2 mutating drag commit: +2 fixtures/−37 members after ONE outlet
  drag; panel-drag −3 devices partially explained (receptacle layout
  follows the panel wall — engine-side, maybe correct); outlet-drag
  delta unexplained. Suspects: device/frame.ts onCommit (writes
  parent.id from nearestUsableWall over the RAW node map → reparenting
  breaks level-scoped extraction?), reconcile effect interplay.
- D3 broken undo: one Cmd+Z leaves the box, vanishes wall wiring +
  panel, lands a third state. History-paused reconcile writes × host
  zundo. Fix may need a host PR (undo-boundary API) or reconcile
  restructure (no writes during/after user edits, only on load?).
- D4 dead place-click on some walls (host placement-validity).
Evidence: board night-4 entries + /tmp/qa-ship4/result*.json (may be
gone — re-repro per the batch-round visual brief). DELIVERABLE: fixes
+ gates + flag defaults ON only if a full visual round passes drag,
undo, redo, persistence on BOTH surfaces.
TRACK B (pilot 2, host): SCENE-WIPE ROOT CAUSE — sessions that make
NO edits fire ONE autosave PUT with an EMPTY graph, wiping the scene
at v2 (dawn evidence: scenes a4993ec9f1ab/1befee38f973; recurring
since 2026-08-16 'cold-load readiness timeout' hypothesis). Host repo:
find the autosave trigger + why the graph serializes empty, fix (never
PUT an empty graph over a non-empty server copy at minimum), test,
host PR. This is prod DATA LOSS — highest severity open item.
TRACK C (me, inline): STRUCTURAL CLEANUP — (1) tee-stem trio: stem
face layers cross through-wall framing (36-78 SAT pairs); reverse-
direction tee insets; oblique tees plain thickness/2. (2) foreign-
group cull: attachForeign face buckets never dollhouse-culled nor
exemption-checked (gable-wall finishes permanently visible). (3)
blueprint EXAMINER round — sheets gained condensers/AC circuits/
compressed framing without a paper review.
Loop rule unchanged; ship batches as they close through the full
chain. Localhost currently = prod (041041da).

## DAWN BATCH SHIPPED (~06:00): prod main f86a5bd3
Plugin 041041da via editor #677 (main 49a81377) → private-editor #367
(E2E green). 859→865 tests. Three dawn verify rounds total; final:
skeptic items all PASS after two fix passes, visual PASS with the
box-beside-window exhibit. SHIPPED: AC dedicated circuits (AC-n,
30A/40A honest on schedule + legend, brute-forced color family >64 RGB
from every real id), heat-pump seed parity (equip-room-centroid
out-normal + corner-flip guard), disconnect RO slide (≤1.5m within
sight, unclearable warns), M2 row truth + slid-distance gate.
NIGHT-4 TOTALS: two prod ships (3da33331 + f86a5bd3), 793→865 tests,
~13 verified defects fixed+gated across 5 verify rounds, 2 pilots
merged, design panel run, E4 closed, S1 unconditional (same-wall).
QUEUE unchanged: outlets live UX D2/D3/D4 (flag off), tee-stem trio,
foreign-group cull, Q10 CMU repaint, gas/internet future work.
HOST BUG (visual dawn round, ticket-worthy): read-only sessions can
fire ONE autosave PUT with an EMPTY graph, wiping the scene at v2 —
edit-bearing sessions save fine. Matches the 2026-08-16 scene-wipe
class; evidence /tmp/qa-dawn2 result JSONs (scenes a4993ec9f1ab,
1befee38f973).

## DAWN MINI-BATCH IN VERIFY (~03:40): 598bea8, 861 tests
Post-ship on master: A4 seed parity (7dc92f3 — heat-pump node seeds at
the SLID condenser anchor, gate seed==cabinet) + AC DEDICATED CIRCUITS
(598bea8 — disconnects carry AC-n + gauge, compute homeruns
panel→disconnect via a meter-less routeWiring subset so the service
entrance never doubles; FAMILY 'AC' hue 130; gates: continuity,
10/2 label, single street lateral). This completes the user's AC ask
('but also connection to power'). Verify wi4gmovvy RUNNING at 598bea8;
localhost pinned there. Ship as dawn mini-batch on PASS.

## NIGHT-4 SHIPPED (~02:30): prod main 3da33331
Plugin 8f40d06b via editor #676 (main 0c694be8) → private-editor #366
(E2E green). Two full adversarial rounds + one narrow; final visual
PASS at the pinned sha. 793→859 tests this night. SHIPPED: cavity-fit
framing (S1 same-wall class dead across 51 jurisdictions, verified by
expected-diff manifest), AC condensers (live climate divisors,
wall-aligned pads, line-sets, disconnects), E4 closed (island ceiling
crossings clear every wall incl. mixed heights; buried island feeders),
selected-wall cull exemption (dedupe-twin aware), movable-outlet ENGINE
(dash ids, code-aware overrides, batt notching, truthful fallbacks) —
seeding gated behind movableOutlets=false.
NEXT-SESSION QUEUE (movable outlets live UX — flip the flag AFTER):
- D2: live drag commit mutates counts beyond the node (+2 fixtures/−37
  members; narrow round attributed the PANEL-drag −3 devices to
  engine-side re-derivation when the panel moves — receptacle layout
  follows the panel wall; the outlet-drag delta still needs a repro).
- D3: single Cmd+Z after a drag doesn't revert the box and vanishes
  wiring+panel (history-paused reconcile × host undo interplay).
- D4: place-click never commits on some walls (host placement
  validity). All evidence in /tmp/qa-ship4/ result JSONs (may be gone —
  re-repro via the batch-round brief).
- Heat-pump seed-parity: buildServicePointNodes seeds the node at raw
  placeHeatPumpSpot which can FRONT an RO; the engine slides unit #1 —
  seed at the slid anchor (A4 parity, narrow-round finding).
- Advisory: unit #1 cabinet corner 0.201m off the wall at oblique
  facing (M2 measures axis center 0.35); corner-clamped verbatim
  anchors give non-90° pad yaw (no SAT hit found — paper hole).

## NIGHT-4 BATCH ROUND CLOSED (~00:50) — outlets go EXPERIMENTAL, rest ships
Skeptic (batch): 3 findings (oblique condenser pad through the wall on
RO slides; twin-committed device overrides silently re-targeting; device
blocking embedded in batts) — ALL FIXED + GATED (ca09e73b). Merge
integrity independently verified: zero unenumerated drift vs prod
across 6 states + island scenes. Visual (batch): condensers PASS live
(zone divisor active, pads/line-set/disconnect/takeoff all right),
regressions PASS (exploded 3-strata, blueprints, batts, cladding
both-modes with clean single undo, service drag) — but the LIVE outlets
integration has 4 defects:
- D1 BLOCKER FIXED: colon deviceIds tripped the host API's URL-scheme
  sanitizer → every save 400'd + scene WIPED. Ids are dash-joined now.
- D2 QUEUED: a live drag commit mutates more than the node (+2
  fixtures/−37 members; panel drag drops devices 77→74). Engine parity
  proven — the defect is in the host commit/reconcile path.
- D3 QUEUED: single Cmd+Z after a drag does NOT revert the box and
  VANISHES the wall's wiring + panel (third state). History-paused
  reconcile writes × host undo interplay.
- D4 QUEUED: drag place-click never commits on some walls (host
  placement-validity interaction).
DECISION: bones:device seeding now gated behind FramingNode.
movableOutlets (EXPERIMENTAL, default OFF — schema + defaults +
renderer guard). Outlets ship dormant; the drag experience needs a
host-side debugging session (D2/D3/D4) before the flag defaults on.
All engine-side machinery (deviceIds, overrides, snapping, spacing
advisory, gates) ships active and byte-equal-guarded.

## NIGHT-4 VERIFY ROUND 1 CLOSED (~05:20) — visual PASS, skeptic 5 fixes in
F1 island crossings now clear EVERY scene wall (+ mixed-height E4 gate
with room-ceiling clause); F2 S1 row rescoped (same-wall class dead;
residual pre-existing classes enumerated: tee-stem layers×framing,
anchor-bolt×bottom-plate slab-on-grade, partition tees into CMU, stem
layer×layer — ALL QUEUED); F3 face-bucket perf gate (per-wall split
bounded, member census preserved); F4 buried feeder no longer retraces
the street riser (double-booked ~6ft SE cable); F5 cull exemption
resolves selections through result.duplicateOf (dedupe twins exempt).
QUEUE (new rows): foreign-group face buckets never culled/exempted
(gable-wall layers permanently visible — pre-existing, F6); compression
flag counts read as member counts (advisory); corner frame-to-frame gap
12.7mm on compressed walls — California backing beyond nailing distance
(advisory); MEP-vs-structure penetrations un-gated by design.
Visual round PASSes to keep: live cladding recolor from straight-on
views (80-90% pixel swings), 0.0mm stud/gyp contact close-ups, ONE
aggregated compression Flags row (350 ea), batt cripple-bays now filled
(D_53 — the v1 gap CLOSED by the frameHints-mirroring batts), service
drag + blueprints regression-clean.

## NIGHT-4 STATE (~04:15) — three tracks in flight
MASTER (mine): E4 closed (724d9ad) + selected-wall cull exemption
(5cf1cf8) + CAVITY-FIT FRAMING landed (f522f61, 793 tests) — S1 is now
UNCONDITIONAL; design panel winner implemented per judge spec (fitAcross
caps across-wall dims at thickness−1\" past 2mm grace; headers clamp;
mixed sill too; one aggregated flag per class; labels/takeoff nominal;
stackOrigin/batt-cavity untouched — keystone identity: compressed stud
face == stackOrigin exactly). Verify workflow w2te30u72 RUNNING at
f522f61 (skeptic: expected-diff manifest across 51 jurisdictions +
consumer-gap hunt; visual: cull exemption + stud/gyp contact close-up +
regression sweep). Localhost pinned f522f61.
PILOT 1 (feat/movable-outlets worktree /tmp/pilot-outlets): Q7 movable
outlets per brief — deterministic device ids, bones:device nodes,
parentFrame drag, stud-snap/blocking, height clamps, NEC 210.52
advisory, byte-equality gate. RUNNING.
PILOT 2 (feat/ac-condensers worktree /tmp/pilot-ac): AC condenser
blocks per spec below. RUNNING. electrical.ts circuit integration
DEFERRED (outlets track owns that file).
MERGE ORDER when pilots land: outlets first (bigger), then AC rebased;
each through its own verify round; ship batches as they close.
PIN GOTCHA (repeat offender): NEVER hand-type a full sha — always
`git rev-parse` it (tonight's near-miss: guessed suffix wrote a
nonexistent pin; caught before install).
## NIGHT-4 AC CONDENSERS — LANDED on feat/ac-condensers (pilot 2, worktree)
Implementation of the addition below: hvac.ts single heat-pump block
generalized to an N-unit condenser row (sizing 450/550/650 sqft/ton by
IECC zone band from wall-assemblies stateClimateZone, count=ceil(tons/5),
row along the exterior wall ≥0.6m apart / ≥0.3m off the face / RO-sliding,
4" pads clearing worst-case cladding, Ø22+Ø10 Manhattan line-sets through
a 0.4m wall penetration with E1-style RO reroute/flag, disconnect (new
FixtureKind) + whip per unit, S4 takeoff rows, DS plan-set tag, checklist
row M2 + 21 gates in hvac.condensers.test.ts). 805 tests green, tsc clean,
ALL pre-existing tests unmodified (frozen src/framing/* untouched).
DEFERRED (frozen files / parallel tracks):
- ONE-LINE HOOKUP: compute.ts showHvac block must pass
  `{ hasLevelAbove, stateCode: code }` to layoutHvac — until then prod
  sizing uses the mid band (550). Apply post-merge.
- serviceOverrideRoWarning parity for the heatPump override (compute.ts).
- Disconnect branch circuit → panel (electrical.ts owner); host 'AC block'
  catalog item as native visuals (plugin fixture boxes for now).

## NIGHT-4 ADDITION (user, ~03:30): AC condenser blocks (HVAC)
User (verbatim essence): catalog has an "AC block" item that looks like
the outdoor heat pump. There should be 1/2/3+ depending on cooled
volume + jurisdiction/code. Hooked to the indoor exchanger (where AC
ducts get their cold) — refrigerant piping AND a power connection.
Generated as part of HVAC. Default position outside; per code maybe on
a concrete footing; connected to the house.
SPEC (pilot 2): sizing = conditioned floor area → tons (cite the
rule-of-thumb ~1 ton / 500-600 sqft as an assumption note), one
condenser per ≤ 5 tons → unit count; pads along an exterior wall near
the existing heat-pump spot with clearances (unit ~0.9×0.9×0.8m on a
4" concrete pad member, ≥0.3m off the wall, ≥0.6m between units, IRC
M1403 / manufacturer clearance note); refrigerant LINE-SET per unit
(insulated suction + liquid pipe pair) through the wall to the air
handler the ducts source from; DISCONNECT box on the wall beside each
unit (NEC 440.14) + whip — panel circuit integration deferred until
the outlets branch merges (electrical.ts collision). Prefer the host
catalog "AC block" item for visuals if placeable as a host item node
(native drag); else plugin fixture + sign like service points. Takeoff
rows: condensers, pads (concrete), line-set length, disconnects.
## NIGHT-4 item 2 LANDED (pilot worktree → feat/movable-outlets): MOVABLE OUTLETS (Q7)
Implementation + gates complete on branch feat/movable-outlets (base 724d9ad,
823+ tests green, tsc clean). NOT yet through the adversarial loop / prod chain.
- ENGINE: deterministic meta.deviceId on every receptacle/GFCI/switch fixture
  (recep:<wall>:<ordinal>:<face p|m>, switch:<wall>:<openingId>:<face>,
  switch:<wall>:hall:<roomId>); applyDeviceOverrides (electrical.ts) applies
  moved-node overrides code-aware: RO snap-out + warning, box edge against a
  stud face (verticals read back from the ACTUAL framed members — zero drift),
  off-stud keeps the spot + books 'device blocking — box off-stud' across the
  bay (skips when an existing backing/blocking row already crosses), height
  clamps (recep 0.15-1.7m / switch 0.9-2.0m NEC 404.8(A)), NEC 210.52 spacing
  advisory ONLY on walls a moved receptacle left/joined. routeWiring consumes
  post-override fixtures → wires land at the moved box for free (E2 gated).
- NODES: bones:device kind (schema mirrors bones:service + seed* fields).
  MOVED-DETECTION = anchor ≠ seed (any write path counts: drag commit,
  inspector slider, MCP); unmoved nodes track the derivation and extract NO
  override → byte-equality by construction. FramingRenderer reconciles
  nodes↔result.devices every compute (create/re-seat/remove) in ONE
  history-paused applyNodeChanges batch; bails on readOnly hosts. Drag =
  parentFrame door-style (device/frame.ts), commit wallId+wallT+position
  reset. Renderer = invisible raycast proxy AT the engine's snapped box
  (memoized computeLevel lookup — proxy and box can't diverge).
- CHECKLIST row E5 added (+ gates listed there). master-baseline.json =
  members/fixtures pin captured AT 724d9ad for the byte-equality gate;
  regenerate ONLY from master (scripts/capture-master-baseline.ts).
- V1 GAPS / notes for the skeptic:
  (1) HEIGHT drag: the host MoveRegistryNodeTool is PLANAR (localY passes
      through untouched) — drag moves wallT only; height rides the inspector
      heightAff slider (any write ≠ seed = override, engine clamps). The Q7
      'higher/lower' ask is served, but not by the 3D drag itself. A host
      Shift-vertical-drag mode would need an editor PR.
  (2) Reconcile writes run from the FramingRenderer effect (editor only,
      history-paused, converges in one pass) — the brief's 'extend the
      buildServicePointNodes caller' became renderer-driven so outlets are
      draggable WITHOUT a panel action; watch undo UX in the visual round.
  (3) Ordinal ids shuffle WITHIN a wall when that wall's own segments change
      (new opening on the same wall) — moved overrides can then re-key to a
      neighbor spot. Same-wall edits are rare mid-drag; board-noted.
  (4) Cross-wall switch moves keep the OPENING key (still control the same
      light); cross-wall receptacle moves re-key sourceId to the new wall.
  (5) Circuit assignment stays with the DERIVED room (a receptacle dragged
      across a room boundary keeps its circuit/GFCI kind, v1).
  (6) Blocking members carry system 'wall-framing' → takeoff books them as
      blocking lumber (by design, it's real wood).

## NIGHT-4 PLAN (2026-08-17 ~02:30 → morning) — user: "make a plan, pull all nighter"
Priorities (user-visible + physical-impossibility first):
1. E4 AIR JUMPERS (OPEN checklist row, prod-visible): connectivity
   jumpers render as straight diagonals through room air. Fix: route
   along wall/ceiling Manhattan paths (up the wall → along ceiling/top
   plates → down). Inline fix + E4 gate → verify loop.
2. MOVABLE OUTLETS (Q7, direct user ask): outlets/switches draggable
   along their wall like doors/windows (hover outline + parentFrame
   drag, same as service points); placement snaps to legal spots —
   never inside an RO, against a stud bay (or books an extra blocking
   member when mid-bay), height presets (receptacle 0.30m, switch
   1.22m, counter 1.10m); wires re-route on release. NEC 210.52
   spacing advisory stays engine-side (flag when a wall span exceeds
   12ft between receptacles). Pilot agent in worktree; schema =
   per-device override keyed to the engine's deterministic device ids
   (like service overrides).
3. STACKORIGIN REDESIGN (queued S1 blocker: 140 SAT pairs on DEFAULT
   0.15m/2x6 exteriors — framing deeper than the finish cavity):
   design judge-panel (3 independent approaches) → winner spec →
   implement → byte-equality RESET (expected-diff manifest) +
   thickness-swept SAT matrix. The big structural one.
4. FILLER BATCH (after 3 lands — same files): cripple-bay batts
   (under-sill/above-header bays), tee-stem trio (stem face layers
   cross through-wall framing; reverse-direction tee insets; oblique
   tee thickness/2), X-ray cladding cull exemption (outermost layer
   visible from straight-on outside views), Q10 CMU solid-mode repaint
   (concrete block texture if the catalog has one).
Ship in ~2 batches (mid-night + dawn) through the full chain
(editor PR → private-editor PR → E2E → prod), morning review updated
after each. Loop rule unchanged: nothing ships without skeptic +
visual PASS at the exact pinned sha.

## NIGHT-3 SHIPPED (~02:10): prod main 9e3716e0
Plugin f308cf36 via editor #670 (main 4cbf30bc) → private-editor #360.
Narrow verify: skeptic PASS + visual PASS (undo single-commit proven
against the real zundo store; air gap 25.0mm live in the instance
matrices; 782 tests, tsc clean, byte-equal across 51 jurisdictions —
only the 7 brick-default states moved veneer members 1" outward).
Post-ship on master (NOT shipped, next batch): ef95831 — advisories
commit (readOnly bail, warning text, S7 row text, TX brick SAT
scenario; 783 tests). Localhost pinned f308cf36 = prod build.

## Night-3 ROUND 2 (f308cf36, 782 tests) — narrow verify in flight, then SHIP
Round-1 verify at dc1daf3a: skeptic REVISE (2 new findings), visual
REVISE (1 finding + caveat). All three fixed + gated in f308cf36:
- S9 air gap: emitStack now ADVANCES offset for unmapped layers — brick
  wythe was flush against the WRB (1" airspace collapsed; wythe center
  0.1197m instead of 0.1451m on 0.15m TX walls). Gate: wythe−WRB clear
  gap = 1".
- S7 false positive: misfit warning told 2x4-on-0.114m users to "drop
  to 2x4" (0.3mm rounding) — now has the 2mm SAT-skin grace. Gate:
  textbook partition never warns; 0.10m still does.
- Undo desync: cladding pick was TWO history entries (override +
  repaint) — one Cmd+Z reverted only the skin. paintWallExterior now
  lands framing patch + all twin slots + mints in ONE setState;
  find-or-mint staged across paintIds (twins share one minted
  material). Gate: staged-mint reuse.
Round-1 PASSES to keep: doors framed through merged openings (E1
downstream non-vacuous), batt sweep clean at 5 thicknesses × 3 states,
INTL/AUTO parity closed, byte-equal breadth (TX +12 veneer-only),
solid-mode repaint 68-70% pixel change per family, misfit note both
surfaces addressed to the kept twin id.
BOARD NOTES from visual round 1:
- X-ray cladding only reads at GRAZING angles: the dollhouse face-cull
  hides camera-facing exterior stacks, and from inside the sheathing
  occludes them. Straight-on outside views show nothing. Idea for a
  future loop: exempt the outermost cladding layer from the cull, or
  add a 'finishes' view toggle. Solid mode is the primary answer today.
- Batt 'compressed' flag aggregates in Takeoff → Flags (by design), NOT
  the warnings list. Advisory only.
- find-or-mint uses JSON.stringify equality — host-authored materials
  with different key order mint a cosmetic duplicate. Advisory.
SHIP CHAIN: editor PR #670 open (bumped to f308cf36, CI re-running) →
merge after narrow verify PASS → private-editor PR (community pin +
editor submodule gitlink) → E2E → merge = prod. Localhost pinned
f308cf36, server healthy. Watch for turbo/tsgo ORPHAN WATCHERS when
restarting the dev server (EMFILE pile-up — pkill turbo+tsgo+next
first, they survive `pkill next`).

## Night-3 verify round CLOSED (e1a5cb4, 779 tests) — pin bump + visual re-run next
Verify workflow (wf_17ed08df-799 resumed) returned REVISE×2 on 593e70c.
All four skeptic findings + the visual QA's new defect fixed and gated:
- F1 batt/gypsum interpenetration on 0.15m zone-3+ walls → depth caps at
  thickness−1" + 'compressed' member FLAG (d386404, S7).
- F2 INTL R-13 vs R-30 parity → battZoneInfo assumes zone 4 like the
  characteristics engine (d386404, S7).
- F3 brick/EIFS memberless → already fixed c2491e7+18997e5 (S9).
- F4 2x6-on-thin-wall one-click reachability → compute warning + amber
  studsNote both surfaces, geometry stays honest (e1a5cb4, S7). GLOBAL
  stackOrigin-vs-framing-depth redesign QUEUED (pre-existing: 140 SAT
  pairs on DEFAULT 0.15m/2x6 exteriors at baseline — decide: derate
  studSizeFor to drawn thickness, or stacks hug stud faces and walls
  fatten; byte-equality breaks either way, needs its own loop).
- Visual NEW defect: dedupe dropped duplicate twins' openings (studs
  through doorways, D2/D3 exhibits) → openings merge onto the kept
  centerline (S8). Board-note: cripple bays (under-sill/above-header)
  carry no batts in v1 — real walls insulate them; queued.
Visual (c) stucco→vinyl 0-pixel FAIL was at the OLD sha: X-ray colors
fixed (c2491e7), solid-mode slots.exterior paint shipped (7161ba7 +
0.9.2 types). MUST re-verify (c) at the new pin before prod; visual
also warned the dollhouse face-cull may hide exterior stacks from
outside views — check both faces in the re-run.

## ACTIVE NOW (night 3): cladding visibility + wall-panel verify → prod
User report: vinyl vs stucco shows no texture difference, "even when the
wall is up". Two halves:
- X-RAY half FIXED (c2491e7, 766 tests): ROLE_OF in wall-layers.ts was
  missing veneer/lamina/foam/drainage → Brick veneer + EIFS emitted ZERO
  members (TX brick default was bare); colorOf now gives each cladding
  family a distinct color via label matching (brick red #9e4a3a, stucco
  sand #d6cdb8, vinyl #b9c6d1, fiber-cement #a9b3a4, wood #a67848, EIFS
  #e3dccb). Gate: every family emits ≥1 cladding member.
- SOLID-MODE half: host draws the wall skin; scout agent (Explore) is
  mapping host wall material/texture APIs — options: wall-node field,
  material override API, or plugin-drawn exterior skin overlay.
State: verify workflow wch91e22w (resumed wf_17ed08df-799, panel skeptic
+ visual) STILL RUNNING — pin bump to c2491e7 deferred until it finishes
(don't restart dev server under its Playwright). Then: bump pin, visual
check cladding colors on localhost, ship whole wall-engineering batch to
prod (user authorized: "on to production after working all night").
Scratch files scratch.review*.test.ts belong to the running skeptic —
do not touch/commit.

## Day batch SHIPPED: plugin eace4e8 via editor#665+#666 + private-editor#358
(prod main 9131aedc, E2E green post-merge). 585→668 tests. Five verify
rounds; ~18 confirmed defects fixed+gated today. All four morning items +
hover bug + electric meter live.

## ACTIVE: mixed wall construction (user ask 2026-08-16 evening)
A wall is not all-wood or all-block: CMU bottom + framed top (knee/stem
wall pattern). Spec:
- Schema: FramingNode.wallOverrides values grow from 'framed'|'cmu'|'skip'
  to also accept { construction: 'cmu', cmuHeightM?: number } (zod union,
  back-compat; absent height = full-height CMU as today).
- Engines: split wall vertically at cmuHeightM SNAPPED to whole courses
  (8in block = 0.203m course): cmu() builds courses+bond beam to the seam;
  wall-framing builds a PT sill plate ON the bond beam (anchor bolts at
  the seam per R403.1.6 spacing) + studs/plates above (shortened height).
  Openings entirely above/below the seam: normal king/trimmer or CMU
  lintel logic in their zone. Openings CROSSING the seam: flag
  ('opening crosses the CMU/framing seam — verify detail'), frame as if
  fully in the taller zone. Layers v1: unchanged per-wall (note).
- UI: Engineering section (wall card + sidebar) — selecting CMU reveals a
  height control: slider snapped to course multiples with a % readout,
  default 100%. Writes the override object.
- Takeoff: block count for the CMU zone only; studs shortened; PT sill +
  bolts booked. Gates: member composition of a 50% split (courses below,
  sill at seam, studs above, no overlap via SAT), crossing-opening flag,
  full-height unchanged vs today, takeoff deltas.

## EVENING BATCH SHIPPED (~23:50): prod main 48bcecd7
Plugin b3a3a08 via editor #667+#668+#669 → private-editor #359. Contents:
3-layer exploded (F1b closed), either/or wall Engineering card, mixed
CMU/framed walls (corner chain closed through width-aware acute retreats).
721 tests. Localhost = prod build. NEXT BATCH in flight: full wall
engineering panel (pilot running — studs/insulation/cladding per wall).

## ACTIVE: full wall engineering panel (user ask, evening 2)
IMPLEMENTATION LANDED (2b83713→7ea771b, 721→760 tests green, all six
stages committed+pushed per board rules; checklist row S6 added). NOT
yet through the adversarial loop / visual round / prod chain. Queued
findings: tee-stem face layers + brickVeneer no-cladding-member rows in
the next-session queue below. Spec (as built):
The Engineering section shows the wall's complete engineering identity,
editable per wall. Extend WallOverride object (schema union already
supports objects): { construction, cmuHeightM?, studSize? ('2x4'|'2x6'),
spacingIn? (16|24), insulation? ('none'|'batt'|'blown'|'spray-foam'),
insulationR? (number, default = climate-zone requirement), cladding?
(key of wall-assemblies.json exterior.claddings: stucco/vinyl/brick/
fiber-cement/wood...) }.
- ENGINES: frameWalls consumes per-wall studSize/spacingIn (falls back to
  spec); wall-layers consumes per-wall cladding (falls back to state
  default) and emits INSULATION BATTS in the stud bays (role 'insulation',
  pink #e8b4c8) when insulation != 'none' — thickness from the batt data,
  labeled with type + R; takeoff books batts by area/R + per-cladding
  rows. CMU walls: insulation = furring/rigid note (v1 label only).
- UI (both Engineering surfaces): under the construction control —
  'Studs' (2x4/2x6 + 16/24), 'Insulation' (type select + R readout with
  'code min R-13 (zone 2A)' hint), 'Exterior finish' (cladding select,
  exterior walls only), each writing the override object; readouts stay
  when at defaults ('per state code' hint).
- Display extras: wall length · gross/net area · opening count; garage
  fire-separation note when the wall bounds a garage (garageSeparation
  data exists).
- GATES: override plumb-through per field (members change: stud size
  dims, spacing count, batt members present/absent + R label, cladding
  role color/material), defaults untouched byte-equal, takeoff deltas.
- Note: the old 'showInsulation toggle' scope is superseded — batts render
  per-wall from the insulation field; a global toggle can come later.

## Next-session queue
- User's Q1-Q8 answers (morning review file) still pending — gate street
  point (Q6), movable outlets (Q7), drawer stage 2 host menu (Q8).
- FUTURE WORK section below: gas, internet, per-utility arrival mode.
- Examiner non-mechanical advisories (slab-less gabled WH outside wall).
- E4 air jumpers (electrical Manhattan re-route) — oldest open row.
- Electrical jumper RO analog audit; connector RO sampling halving.
- Round-12 electrical phases 1-3 (staples/nail plates, switch legs, 14/3).
- Reverse-direction tees (stem direction pointing away from the through
  run) — pre-existing repo-wide detectTees convention; audit across
  engines (S5 scope note, 2026-08-16).
- Oblique (non-perpendicular) tees — pre-existing repo-wide convention:
  tee insets use plain thickness/2 with no oblique multiplier; audit +
  angle-aware stem retreat across engines (S5 scope note, 2026-08-16).
- Tee-stem FACE layers cross the through wall's framing — pre-existing:
  wall-layers runInsets only detects endpoint corners, so a stem's drywall
  runs to the centerline through the through wall's plates/backing at tees
  (exposed by the batt SAT composition, 2026-08-16 engineering-panel work;
  gate scoped to batts meanwhile — interpenetration.test.ts tee scenario).
- Brick veneer renders NO cladding member — pre-existing: brickVeneer's
  layers carry roles airGap/veneer which ROLE_OF (wall-layers) skips, so
  brick-default states (TX/AL/…) and the new per-wall 'Brick veneer' select
  emit sheathing+WRB only. Mapping veneer→cladding would change those
  states' default output (byte-equal), so it needs its own round.

# Bones day board — 2026-08-16 (morning directives; night board below)

## Today's four items (user, verbatim intent) — 6h+ loop directive
A. EXPLODED ROOF LAYER: exploded view should read floor / trusses / shingle
   shell as ~equal strata. Impl: renderer attachForeign offsets the foreign
   roof group position.y −= EXPLODED_GAP/2 (2.5) when useViewer levelMode
   === 'exploded' (cache getState after the existing dynamic import; reset
   to 0 otherwise). Visual gate: exploded screenshot, three strata.
B. GABLE EXTERIOR (prod bug): roof-level gable walls frame as INTERIOR —
   applyExteriorFallback probes slabs and roof levels have none, so no
   sheathing/WRB/cladding. Fix in wall-model/compute: when a level has no
   slabs, probe against the union of slab polygons from LOWER levels of the
   same building (plan projection; extractSlabs per lower level id); if
   still nothing, walls on a level with zero rooms+slabs = exterior. Gates:
   gable wall on slab-less level above a slabbed level → exterior true →
   layers emitted; interior partition below stays interior.
C-USER REPORT (prod, 2026-08-16): hovering a window outlines it; hovering
   the electric/water boxes does NOTHING. Selection works (QA verified),
   hover outline does not. Scout said 'should already work' — it does not
   in reality. Suspect: selection-manager builds its hover subscription
   list from getSelectableKinds() at MOUNT, before async plugin kinds
   register (built-ins hardcoded → windows outline). C implementation MUST
   (1) verify the subscription timing hypothesis in the running editor,
   (2) fix — likely a small HOST PR (re-subscribe on registry change or
   lazy kind lookup at event time), (3) visual gate: hover over panel/WH
   → cyan outline appears, same as a window.
C-SCOUT DIGEST (implementation map, full detail in session transcript):
   - Hover/select/outline: ALREADY WORKING for bones:service (selectable
     capability + useNodeEvents spread + useRegistry — host outline pass
     keys on those three). Move cursor free via capabilities.movable.
   - DRAG: implement capabilities.movable.parentFrame (MovableParentFrame,
     core registry/types.ts:1919-1966: resolveParent/localToPlan/
     planToLocal/magneticSnap/onCommit) — the generic MoveRegistryNodeTool
     then does door-style slide: plan cursor → wall-local, live preview
     via useLiveNodeOverrides (service renderer already merges overrides),
     ONE updateNode on commit. planToLocal projects onto the wall axis →
     write wallT; onCommit ALSO zeroes position (fixes the 'wallT dead
     after gizmo drag' quirk). Floor types keep plain moves. magneticSnap:
     clamp 0..1. No @pascal-app/nodes vendoring needed.
   - Recompute on updateNode confirmed (new nodes identity every call).
   - WAIT for D+E agent to finish src/service/* before implementing.
C. SERVICE-POINT DRAG UX: hover highlight + drag-along-wall like doors.
   Scout FIRST (Explore agent): how the host door/window drag works
   (packages/editor tools + useNodeEvents + live overrides), whether plugin
   renderers can register pointer handlers the same way (lumber
   placement.tsx already does host interaction). Then: onPointerOver
   emissive highlight; drag = raycast to the wall plane → live wallT
   preview → updateNode commit on release → engines recompute (free).
D. HVAC: (1) thermostat + heat-pump added to bones:service serviceType
   enum + auto spots in 'Place service points' (thermostat: hallway/living
   interior wall 52in AFF near the return; heat-pump: exterior pad outside
   the wall nearest the air handler, lineset stub through wall) + hvac
   engine consumes overrides; (2) DUCT CODE FIX: trunk/branches route at
   ATTIC elevation (above wall.height + ceiling-joist depth), supply boots
   drop through the CEILING as ceiling registers (like light fixtures);
   never intersect the top-plate band [wall.height−0.09, wall.height] of
   any wall (research anchors: IRC R602.6 top-plate notching >50% needs a
   28ga tie = ducts don't pass through plates; E/M1601 duct installation;
   practice = attic trunk + ceiling boots). New gate: no duct member OBB
   crosses any wall's plate band; register fixtures at ceiling plane.
E. ELECTRIC METER (user, same morning): standard chain = street input →
   METER on the house side → panel. Add serviceType 'electric-meter':
   auto spot on the exterior face nearest the panel (outside), heavy
   service cable street-edge → meter → panel feed; movable like the rest.
   (Water meter already exists; sewer exit exists.)

## FUTURE WORK — utility services exploration (user notes, do NOT build yet)
- GAS: street line → gas meter on the house side → runs to WH/range/
  furnace. Not all houses have gas — needs a per-project toggle. Yellow
  CSST/black-iron runs, shutoff at the meter, appliance stubs.
- INTERNET: street cable (aerial or underground) → entry point → modem +
  router placement (movable), maybe structured-wiring panel. Cat6/coax runs.
- PER-UTILITY ARRIVAL MODE: electricity + internet can arrive OVERHEAD
  (weatherhead/drop from a pole) or UNDERGROUND (lateral) — each utility
  independently editable; drains always toward the street (no choice).
- STREET FLAGS (user idea 2026-08-17): the street access points render as
  small FLAGS at the lot edge (matching the host's lot-corner flag look) —
  a cluster of 3-4 (power/water/sewer, later internet), each draggable,
  each the origin of its service run to the matching box. Ties into Q6.
- SHARED STREET CORRIDOR: all services arrive near one street-side zone as
  parallel-but-individually-editable runs (ties into Q6 street point).

Batching: A+B one agent (small), D+E one agent (engine+service), C scout
then implement. Loop after each; ship in 1-2 prod batches today.

# Bones night board — 2026-08-16 (living file: update on every land/verdict)

## Consolidated 8-defect fix batch — LANDED (2026-08-16, af6df36→0d4a51c)
- All 8 skeptic/visual-confirmed defects fixed + gated, 666 tests:
  (1) E1 service cable — meter→panel feed rides the WALL GRAPH at a service
  plane (shared emitWallLegWith/emitWallPathWith detours); laterals/riser/
  bridges RO-sampled + ⚠-flagged; (2) bath exhaust y keys off the LOWEST
  wall along the path (exit wall's own plate band); (3) registers at the
  shoelace AREA centroid nudged inside the room + off wall bands (L-room);
  (4) interior storeys (walled level above) cap the trunk at ceiling−0.35
  as a soffit run + warning, top storeys keep attic; (5) register grille at
  ceiling−0.04 / boot to −0.05 (visible from inside); (6) RO-warning parity
  for thermostat + electric-meter overrides; (7) selectedWallInfo runs
  compute's dedupe (exported dedupeColinearWalls) — duplicates resolve to
  the KEPT twin, overrides target its id, card prints a duplicateNote;
  (8) checklist row M1 + A4 refreshed to 8 service types; plan-set EM tag +
  legend, SE-cable legend row, characteristics notes WRAP (fixCheck2 items
  1-3 folded in).
- fixCheck2 leftovers QUEUED (not mechanical): slab-less gabled advisories
  (WH auto-spot 0.6m outside the south wall, no water-meter fixture, MEP
  legend merges coincident supply/DWV rows); carried minors: plan-sheet
  upper-right bias, elevation depth cue, per-opening header tags.
- NOT prod-shipped (per brief: no prod pins, no editor) — adversarial loop
  before any pin bump.

## Item C LANDED (2026-08-16 ~09:55) — hover fix (host PR) + door-style drag
- PART 1 (hover bug): hypothesis CONFIRMED by source read — prod
  (apps/community) discovers plugins via DYNAMIC imports, so kinds register
  AFTER the selection managers snapshot getSelectableKinds() into their
  emitter subscriptions (deps never re-run); dev (apps/editor) imports
  statically → registered pre-mount → why localhost never reproduced it.
  Click had the same latent staleness (any mode/movingNode change re-ran
  the effects, masking it). Registry had NO change notification at all.
- HOST FIX: editor PR #665 (branch fix/plugin-kind-hover, b05a4a91, NOT
  merged): registry version + onRegistryChange in core, useRegistryVersion()
  hook, added to the dep arrays of all 6 kind-snapshot effects (5 editor
  SelectionManager + 1 viewer). Gates in core registry.test.ts. 1007/604/101
  pass, tsc clean.
- PART 2 (drag): plugin c2ac419 — capabilities.movable.parentFrame
  (src/service/frame.ts) for WALL_MOUNTED_TYPES: planToLocal projects the
  cursor onto the wall axis (clamp 0..1), localToPlan idempotent, live
  preview via the position override (renderer merge + nearest-wall snap =
  zero extra wiring), onCommit ONE update {wallId, wallT, position:[0,0,0]}
  — the 'wallT inert after gizmo drag' quirk is RETIRED (comments updated).
  cursorAttached:true (drag origin independent of the [0,0,0] sentinel).
  Floor types keep plain moves. 12 gates in frame.test.ts; 624 tests.
- VISUAL PASS (/tmp/qa-c-dragux, scene 74c2ce0b8791 on :3002 pinned
  c2ac419 + host branch): a7 window outline, a4 panel outline, a5 WH
  outline (same rim); b1→b4 (panel rides the wall mid-drag, green box)
  →b6/b9 (new spot, feeder + circuit drops re-routed). Post-session API:
  wallT 0.52→0.2, position [0,0,0], wallId unchanged.
- Scene gotchas hit: scenes API GET returns 0 nodes during a live session
  (desync — verify post-session or via inspector DOM); this scene's panel
  spawns inside a window RO → select it via the SIGN PLATE (x≈0.18 proud).
- NOT prod-shipped: host PR #665 awaits review/merge; plugin pin bump
  ships through the normal chain afterwards.

## How I work (the loop) — for any fresh context picking this up
1. Implement in small green increments (bunx tsc --noEmit + bun test after
   each; commit + push per green stage; NEVER pipe test output through
   tail/grep in a && chain — it masks the exit code).
   NEVER `git add -A` in the shared tree — stage explicit paths only.
2. Every change goes through the ADVERSARIAL LOOP before prod:
   - code skeptic agent: tries to REFUTE with scratch bun tests (repo root,
     imports source, deletes after). FAIL = concrete failing scenario.
   - visual QA agent: builds a scene via POST /api/scenes (see
     /tmp/qa-*/build_scene(s).py patterns; host has a scene-wipe bug — GET
     after POST, re-PUT if 0 nodes), ONE Playwright session
     (executablePath ~/Library/Caches/ms-playwright/chromium_headless_shell-1228/...,
     run from ~/Documents/GitHub/private-editor), screenshots, judges.
   - blueprint examiner for anything touching plan-set (review/BLUEPRINTS.md).
   - Fix every FAIL + add a GATE test per defect, then RE-VERIFY (resume the
     same skeptic via SendMessage — context intact).
3. Reviewers walk review/CHECKLIST.md (invariant rows E/S/P/A + P5); new
   invariant ⇒ new row + gate in the same commit.
4. Localhost: pin sha in ~/Documents/GitHub/private-editor/editor/apps/editor/package.json,
   bun install, restart dev server on :3002 (kill listener, PORT=3002 nohup
   bun run dev from apps/editor). NEVER restart while a visual agent is mid-session.
5. Prod chain (when loop green, standing authorization): editor repo PR from
   ~/Documents/GitHub/private-editor/editor (branch off origin/main, pin bump
   apps/editor/package.json + bun.lock; gh pr create/merge after CI) → then
   private-editor PR (apps/community pin + editor submodule gitlink via
   `git -C editor checkout <editor-main-sha>`; CI incl. E2E ~8min; merge).
   Restore feat/plugin-bones + stash after.
6. HARD RULE: never mention PlanCrafters/Steven Tibbs anywhere public.
   Attribute inspiration to IRC/NEC building codes only.

## Round-3 fixCheck NARROW FIX PASS — LANDED (2026-08-16, after d59d2f2)
- Examiner fixCheck at d59d2f2 (scorecard fixCheckVerdict REVISE-narrow):
  3 remaining items fixed + gated, 585 tests:
- (1) P4 width-aware label de-collision (plan-set.ts electrical): labels
  collide as RECTS (chars × 6.5px @ 8px bold, ~10px tall) vs labels AND
  device bubbles; spiral with growing radius (8 tries), then fall back to
  the circuit's 2nd/3rd-longest run — bubble-parked anchors get NUDGED
  labels now, never silently dropped (gabled GEN-2). Gates: 4 coincident
  anchors → pairwise rect separation ≥ label width, one label per circuit;
  bubble-anchor circuit prints clear of the bubble.
- (2) N3 filled-rect cut poché (sectionSheet): every band member prints as
  0.6-opacity beyond linework; the plane∩member slice is an explicit dark
  rect (#222) — width ≈ thickness/|planUx| capped at the projected extent,
  height ≈ vertical extent at the cut, centered where the plane crosses
  the axis; foundation rects keep the dash convention on the OUTLINE.
  End-on members visible again (old zero-length butt caps drew nothing);
  oblique members never whole-member dark. Gates: end-on CMU + footing →
  3 visible rects incl. dashed outline; 20°-oblique 8m plate → dark ≤0.7m
  (measured vs a 5m stud ruler); wall-along-plane gate stays green.
- (3) C5 flag-list wrap (schedulesSheets): '… +N more flags' truncation
  REMOVED — flagRows = flags.length, the last-page reserve grows (pages
  grow when the cap overflows) so EVERY flag prints; characteristics
  block anchor tracks the taller list. Gates: 7 flags all print, none
  truncated; char block stacks above flag #1; takeoff rows stay clear.
- NOT prod-shipped: same as the parent batch — adversarial loop (examiner
  re-read) before any pin bump.

## Round-3 scorecard FIX BATCH — LANDED (2026-08-16, 5ea5913 + f1e42f7)
- Scorecard review/scorecards/blueprint-round-3.json (verdict REVISE) items
  fixed + gated, 580 tests:
- Connectors (5ea5913): (1) P5d — connectorArc segments sampled through
  pointInAnyRO, OPENING flag on RO crossings (repro: lav in the door RO =
  6 unflagged crossings); (2) per-hose ids conn-cold-<id>/conn-hot-<id>,
  takeoff books 'Braided supply connector — N pcs' excluded from copper lf
  AND fitting bends (gate: off-wall fixtures add zero copper lf/elbows);
  (3) >0.6m hose → 'connector too long' flag; plumbingPipeColor maps
  conn-cold-/conn-hot- to blue/red (3D + MEP legend).
- Plan set (f1e42f7): N3 FAIL — sectionCutX slides off along-plane walls
  (±0.3m steps, A-A mark follows), poché only axis-crossing members
  (<60° to plane normal), parallel in-band = beyond 0.6, below-grade cut
  keeps dashes; C1 — roof coverage now a ~1m grid over the wall bbox
  (>25% unroofed cells warns; pinned vs synthetic demo wing that beat the
  bbox proxy at 0.64); P4 — circuit labels spiral-nudge apart (≥12px gate)
  + skip on device-bubble anchors; C5 — floorAreaM2==0 prints 'n/a — no
  floor slabs (see flags)' in drawer + sheet; N2 cheap part — butt caps on
  all elevation/section member strokes.
- NOT prod-shipped: needs the adversarial loop (skeptic + examiner re-read)
  before any pin bump.

## Task #17 blueprint round-3 flags — LANDED (2026-08-16, a152cf9)
- All six examiner flags fixed + gated in plan-set.test.ts (565 tests at
  land): (1) section poché — cut members dark #222 ×1.3 width, beyond at
  0.6 opacity; (2) A-A cut mark on the wall plan (dashed line + 'A'
  bubbles at the shared sectionCutX helper); (3) stroke legends on
  cover/elevations/section (per-sheet systems only); (4) takeoff rows wrap
  at word boundaries — pagination counts LINES, wrapped row costs 2;
  (5) roof-coverage <60% flag on the roof legend + schedules flags;
  (6) rebar dowels OPEN circles vs anchor-bolt FILLED dots + legend keys.
- NOT done from the old queue wording: elevations stay 1-per-sheet (the
  2-per-sheet pairing wasn't in the round-3 brief).

## Task #18a flexible connectors — LANDED (2026-08-16, 5fdb510)
- Off-wall placed fixtures (>6cm from stub) get a 3-segment braided-hose
  arc stub → fixture connection (toilet inlet 0.2m, lav tails 0.3m); cold
  always, hot beside it; sourceId conn-<id>, no new roles. Islands keep
  flagged air runs; flush fixtures get nothing. Gated in
  plumbing.connectivity.test.ts incl. meter→conn reachability. 569 tests.
- NOT shipped to prod yet — needs the adversarial loop (skeptic + visual +
  blueprint examiner re-read) before a pin bump.

## Task #19 service nodes FIX BATCH — LANDED (2026-08-16, bdfdd7e)
- Adversarial review round on bones:service, 8 defects fixed + gated
  (558 tests): (1) RO-collision warnings for panel/WH/water-entry overrides
  in computeLevel (NEC 110.26); (2) gizmo precedence — non-default
  `position` outranks wallId+wallT in resolveServicePlacement +
  overrideWallPoint/PlanPoint (wall types snap to nearest wall); (3)
  missing/curved/foreign wallId + default position = NO override — engines
  auto-place, renderer draws a selectable stub only; (4) NaN guards on
  wallT/heightAff/position/rotation; (5) panel button counts DISTINCT
  visible service types (placedServiceTypes); (6) duplicate same-type
  nodes: lowest id wins + 'duplicate service point (…) — extra node
  ignored' warning; (7) sign texture disposed via useEffect cleanup; (8)
  exterior sign plate rotated 180° (was mirrored).
- extractServiceOverrides now returns { overrides, duplicates } (only
  caller: computeLevel).

## Task #19 service nodes CORE — LANDED (2026-08-16)
- bones:service kind (panel/water-heater/water-entry/sewer-exit/power-entry)
  + renderer (equipment box + canvas sign plates, wallId+wallT+heightAff
  lerp, position fallback) + 'Place service points' panel action
  (idempotent, seeds at engine auto spots) + engine overrides (verbatim;
  routing follows) — checklist row A4 + gates
  (service-overrides.test.ts, place.test.ts, schema.test.ts). 533 tests.
- NOT built (by design): drag interactions (host gizmo/inspector wallT
  slider is the move path), movable outlets (separate task), street-point
  unification (Q6 answer pending), power-entry routing (node places at the
  panel wall weatherhead; no engine consumer yet).

## State right now (~06:30 — NIGHT COMPLETE, three batches shipped)
- BATCH 3 SHIPPED: plugin 45d4ad4 via editor#662 + private-editor#357
  (prod main 59b5fa02). 585 tests green. Localhost = prod sha.
- Morning review file final: ~/Downloads/bones-morning-review.txt.
- Night totals: 3 prod ships, 434→585 tests, ~30 skeptic-confirmed
  defects fixed+gated across plumbing (6 rounds), service nodes (2),
  blueprints (3 examiner rounds), view modes, multi-storey.
- Next session queue: user's Q1-Q8 answers from the review file, examiner
  cosmetics (P1 pagination, N2 depth/datums, C4 rafter note), per-element
  drawer stage 1, movable outlets (Q7), street point (Q6), electrical
  jumper RO analog (E4/#12), insulation batts toggle, connector RO
  sampling halving (skeptic future note).

## Older (~05:30 → final fix pass LANDED green)
- Connector skeptic: PASS (loop closed; ~2% predicate-halo grazes = 0.0mm
  physical penetration, future sampling refinement noted).
- Examiner fix-check: N3 FAIL→FLAG (sections legible), C1+C5+N2 CLOSED;
  narrow REVISE on 3 items → FINAL FIX PASS LANDED (see 'NARROW FIX PASS'
  section above): width-aware label de-collision, filled-rect cut poché,
  flag-list wrap — all gated, 585 tests / 0 fail. The fix agent itself
  did NOT ship (its brief: no prod pins, no editor) — the green-landing
  ship steps below are the orchestrator's.
- ON ITS GREEN LANDING: ship the round-3 batch through the prod chain
  (editor PR pin bump → merge → private-editor PR pin+submodule → merge),
  update ~/Downloads/bones-morning-review.txt (add: round-3 sheet polish +
  braided connectors shipped; note examiner's remaining P1 pagination +
  N2 datum/depth items as next round), pin localhost, mark task #17 done.
- Examiner's morning queue: P1 pagination balance (3 sheets ~2/3 empty),
  N2 depth cues + T.O. PLATE/RIDGE/GRADE datums, C4 rafter o.c. note.

## Older (~04:30 hold)
- Blueprint examiner round 3: REVISE — all round-2 items closed, but FAIL
  N3 (section poché recolors whole members; cutX on a wall axis = black
  sheet) + flags (roof-coverage bbox proxy misses the demo wing, electrical
  label stacking, char zeros on slab-less, caps, pagination).
- Connector skeptic: FAIL — connectors cross ROs unflagged (P5d) + takeoff
  books them as phantom copper lf + elbows (hot/cold share sourceId).
- FIX AGENT RUNNING (8 items, exact remedies in its brief) → on green:
  re-verify (examiner N3/C1/P4 re-check + connector skeptic re-run via
  workflow resume wf_cb4ae7d1-089 or fresh focused agents) → THEN ship
  the round-3 batch (1bb6982+fixes) through the prod chain.
- DO NOT ship 1bb6982 as-is. Prod remains at e8d15ea (main 13296c84) — the
  two shipped batches are unaffected (all their loops closed PASS).

## Older (POST-SHIP 2, ~03:30)
- SERVICE POINTS SHIPPED: plugin e8d15ea via editor#661 + private-editor#356
  (main 13296c84). Two verify rounds, 8 defects fixed+gated, visual PASS,
  closing skeptic PASS. 559 tests. Localhost = prod sha.
- Morning review file updated with service-points test steps + residuals.
- Residual tickets (non-blockers, from closing pass): renderer visual snap
  can draw a dragged box inside an RO while wiring routes clear (renderer/
  engine divergence, needs snap parity); RO warning band = device CENTER
  ±2cm, not full device height (tall tank under a sill can overlap
  unflagged); wallT slider inert after a gizmo drag until position reset
  (documented, maybe surface in inspector help).
- Remaining queue: per-element drawer stage 1, movable outlets (Q7),
  street point (Q6), electrical jumper RO analog (E4/#12), insulation
  batts toggle. (#17 round-3 flags + 18a connectors LANDED — see above;
  both still need the adversarial loop before any prod pin bump.)

## Older state (POST-SHIP 1, ~01:40)
- PROD SHIPPED: plugin 9f5a43f via editor #660 + private-editor #355
  (main 3aac52d6). Plumbing loop CLOSED after 6 rounds / 14 defect classes
  (final skeptic PASS). Localhost:3002 = prod sha.
- Morning review file written: ~/Downloads/bones-morning-review.txt
  (update it if more ships tonight).
- Task #18 complete except flexible connectors (queue item below).
- Next: #19 service nodes core (impl agent), then blueprint round-3 flags,
  then connectors. Electrical jumper analog of the RO fix: queued (#12/E4).

## Older state (verify round 4)
- Plumbing verify: rounds 1-4 done, 12 defects found+fixed+gated total.
  Round-5 CLOSING skeptic pass running on 6a2f5e4 (agent ad147b8f670d56e12
  — resume via SendMessage). PASS ⇒ ship prod batch immediately.
- Under-slab DWV ghost (task 18b) DONE at e59f17b. Flexible connectors
  (18a) still open — touches plumbing.ts, was blocked on skeptic.

## State at board creation
- Plugin master 711c401, 508 tests green. Localhost :3002 pinned c592fa7
  (STALE — re-pin to 711c401 before visual work).
- Prod: bones 4cd28a0 + editor fb221460 (lerp fix). NOT yet in prod:
  blueprint round-2 fixes, plumbing rebuild (stages 1-4 + 7 verify fixes),
  characteristics drawer/sheet. SHIP THIS BATCH after plumbing re-verify #3.
- Two re-verify defects (riser colinearity D2b, short-garage D1b) fixed at
  711c401 — needs ONE more skeptic pass (resume agent ad147b8f670d56e12) on
  those two fixes only, then ship prod batch.

## Queue (small tasks, knock down one by one)
1. [BLOCKING PROD] Skeptic re-verify #3 of D1b/D2b at 711c401 → prod chain.
2. Task #18 leftovers: (a) flexible connectors — curved supply line from
   wall stub to fixture when not flush (braided-hose arc, chrome); (b)
   under-slab visibility — DWV members y<0 render on the ghost/overlay pass
   like below-grade foundation ('crawl-space at a glance' — user asked 2x).
3. Task #19 service nodes (docs/plans/service-nodes.md + additions):
   lightning-bolt icon on the panel, similar icon for WH; ONE street
   connection point at a map edge feeding power+water+sewer entries (all
   draggable); movable outlets/switches (per-device overrides on
   FramingNode, snap to stud-bay edges from framed studs, mid-bay auto-adds
   blocking + advisory, RO exclusion, wires re-route). Keep it SIMPLE per
   user ('weeds of detail complexify — not needed').
4. NEW user idea (design answer owed): per-element engineering drawer —
   when a wall is selected in Pascal, its little context menu gains the
   Bones hammer icon; clicking opens THAT element's engineering: 2x4/2x6,
   framed/CMU ('this one is cinder blocks'), insulation on/off/type.
   Bones ALREADY has per-wall overrides (FramingNode.wallOverrides +
   panel WallOverrideSection) — this is about surfacing them on the
   element selection UI. Scout: does the host let plugins contribute to
   the item/wall selection menu (packages/editor selection menu code)? If
   not, fallback: selecting a wall while Bones panel is open scrolls/
   highlights that wall's override row (cheap, no host changes).
5. Task #17 round-3 blueprint flags: section poché + A-A cut mark on plans,
   stroke legends on cover/elevations/section, pair elevations 2-per-sheet,
   rebar dowel symbol vs anchor bolts, takeoff row word-wrap, 'wing has no
   roof' printed flag.
6. Task #12 (old): electrical round-12 phases 1-3 (staples/nail plates,
   switch legs, smoke 14/3 interconnect); MEP wall-relative routing for
   HVAC; E4 air-jumpers row (Manhattan-route the connectivity jumpers).
7. Insulation batts toggle (from old task #13 scope, still unbuilt):
   showInsulation → pink batts in stud bays from insulationByClimateZone.
8. MORNING REVIEW FILE (write LAST, ~/Downloads/bones-morning-review.txt):
   what shipped + exact test steps per feature + questions (alpha chip
   keep/kill? street-point UX? per-element drawer mock ok?) + PR links.

## Key repo facts (save re-discovery)
- Engines pure; extraction in src/core/wall-model.ts (extractWalls/Slabs/
  Rooms/Levels(baseY,buildingId)/PlacedFixtures).
- Electrical exports reused by plumbing: buildWallGraph, openingSpans,
  clearOfOpenings, nearestWallPoint, panelMountU, wallPath, wallPlan.
- Cross-level members: Member.levelId tag + renderer buildGroups foreign
  mounting into level Object3D via sceneRegistry (checklist A3).
- Plan set: 12 sheets (cover/plans/elevations/section/schedules); shared
  SetTransform for plans, fitSegs family ratio for elevations.
- Host quirks: scene-wipe desync (GET returns empty during live session —
  host bug, reported); LevelSystem lerp fixed in editor fb221460.
- Demo scene fc866f2f271b: roof level ordinal 1 h=0.35, roof group y=2.7
  INSIDE it (host draws shell at baseY+y — scene data floats the roof).
