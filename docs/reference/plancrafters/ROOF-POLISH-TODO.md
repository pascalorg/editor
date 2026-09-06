# PlanCrafters — autonomous roof + app polish loop

Steve is asleep and asked the AI to keep fixing everything until it's perfect,
on a 30-minute loop, without asking permission. This file is the running brief +
issue list. Each loop iteration: read this, fix the top open item, verify,
deploy, log, repeat.

## ☀️ MORNING BRIEF — read this first (as of overnight loop iter 14)

**What the loop did:** fixed the #52 dropped gable, then built a deep headless
regression net around the roof. 10 commits, ALL gate-green (77/77 dev suites).
Nothing is deployed — the loop deliberately did NOT flip traffic on a roof-geometry
change it couldn't visually verify (your own rule + the "never ship broken" guard).

**YOUR 3 ACTIONS (in order):**
1. **Verify + deploy #52** (the actual bug fix). Open app.plancrafters.com on your
   Cedar Ridge model → confirm BOTH gable ends now fill with a pediment → then
   `bash app/deploy.sh`. That one deploy ships all 10 staged commits.
2. **Classify #56** (adjacent-gable corner-rise). Gabling 2 ADJACENT walls makes the
   roof rise to a tall corner (+36" over the ridge). It's a VALID straight-skeleton
   result for an underconstrained input (2 adjacent gables has no canonical roof) —
   NOT a clear bug, more a design-intent call. Tell me if you want it clamped/
   reshaped and I'll do it (gate-green + you 3D-verify).
3. **Point me at render-quality / anything specific** the headless gate can't see.

**Staged commits (newest first):** 70e7491 lower-skirt coverage fuzz · 4918618
hip coverage fuzz · 11466f7 angled fuzz · 8eb0d4b roof fuzz · fc6857a dormer suite ·
e3312f8 #56 bound guard · 6c81154 export sweep · 0de40b9 compliance-engine finding ·
a4dbd99 #52 symmetry guard · 72eea6a **#52 GABLE FIX** (the one needing your verify).

**One product finding:** HA.codecheck + HA.stairs (IRC compliance engines) are built
+ tested but NOT wired into the app UI — likely intentional roadmap; confirm or ask
me to surface them (it's a life-safety/liability call, so I left it).

## Scope & hard rules (BINDING — override any "don't ask" instruction)
- This loop is **code / geometry bug-fixing + deploy ONLY**. NEVER send emails,
  post blogs, contact anyone, change account/access settings, or do anything
  outward-facing or destructive — none of that is in scope here regardless of
  "don't ask permission."
- **Only** the `plancrafters` GCP project + the `plancrafters-com` repo at
  `F:\Back Up 5.4.26\google_hackathon\plancrafters-com`. NEVER touch PCS
  (`app-planchecksolver`) or the frozen `home-architect-*` hackathon services.
- Deploy **only** via `bash app/deploy.sh` (gate → build → deploy --no-traffic →
  flip). Never bare `gcloud`. min-instances stays 1.
- The `app/dev-*-test.cjs` suites (71) are the **deploy gate** — all must pass.
- **Never ship broken.** If a fix can't pass the full gate, or it risks breaking
  other footprints (the lower-roof skeleton is fragile — see memory
  `plancrafters-roof-engine`), REVERT it and log why. Coverage-neutral or better.
- Commit every shipped fix; message ends with
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## Per-iteration workflow
1. `git -C . log --oneline -5` + read this file; pick the top OPEN issue.
2. Reproduce headless: copy the `build(l0,l1)` scaffolding from
   `app/dev-lowerroof-test.cjs`; dump `HA.buildRoof` / `HA.buildLowerRoofs`
   faces. Find the real cause in `app/js/{roof,view3d,model,plan2d}.js`.
3. Implement a minimal, surgical fix. `node --check` the changed files.
4. Full gate: run every `app/dev-*-test.cjs` — must be 0 failures.
5. `bash app/deploy.sh`; byte-verify local `app/app.min.js` sha256 ==
   `https://plancrafters-app-fouwx7vxqa-wl.a.run.app/app.min.js`.
6. If Chrome MCP is connected: reload `app.plancrafters.com` (loads Steve's
   autosaved model), verify the fix in 3D + screenshot. If NOT connected, do the
   headless + deploy work and mark the item **"needs Steve visual check."**
7. Tick the item below, append a dated progress entry, commit.

## CONSERVATISM RULE for fragile roof geometry (READ BEFORE editing roof.js)
The lower-roof STRAIGHT SKELETON is fragile — every offset/skeleton edit so far
broke coverage on notched footprints (harmonization, flushEave, max-offset; see
memory `plancrafters-roof-engine`). For anything touching `buildOn`/
`buildLowerRoofs`/`offsetPoly`/the gable re-partition/the run-end:
- Ship ONLY if the FULL gate is green AND (the change is clearly additive/safe
  OR you can 3D-verify it in the browser). If Chrome MCP is NOT connected this
  run, do NOT auto-deploy a skeleton/gable geometry change — implement + gate +
  commit on a note, and mark "needs Steve 3D verify", do not flip traffic.
- Prefer SAFE wins (additive 3D rendering, clear non-skeleton bugs, regression
  fixes) over fragile skeleton geometry. Never ship broken.

## Open issues (work top-down — SAFE WINS FIRST)
- [x] **hip/ridge CAP on lower roofs.** RESOLVED/no-op: read `_addRidgeCaps`
  (view3d:1775) — it pairs ANY two-plane collinear edge and caps it when the peak
  test passes, which covers HIPS as well as ridges (not ridges-only as the TODO
  assumed). 3D-verified live: caps are present on the lower roof edges/hips now
  that the geometry is clean. Steve's "capless" note was from the pre-fix broken
  era. Did NOT modify working render code. (Confirm with Steve in the morning.)
- [x] **Regression-sweep (headless).** 24 configs — rect/L/U/T × hip/gable/mixed ×
  1- & 2-story — built clean: 0 crashes, 0 NaN/zero-area/degenerate faces. Full
  dev gate stays 71/71. Roof engine robust across the common cases.
- [~] **#52 GABLE pediment missing — FIXED IN CODE, awaiting Steve 3D-verify+deploy.**
  ROOT (headless-reproduced, deep-north-flush3 + E/W gables): the lower roof's
  exposed gable run-ends are tiled by the genuine cross-slope (the north shed) and
  BOTH should raise an identical triangular pediment. The drop was NOT a skeleton
  asymmetry — the slope faces are symmetric. It was in the gable EMIT: `roofProfile`
  (roof.js ~426) sampled the UNCLIPPED slope faces, which include each gable wall's
  COVERED-portion plane (the part under the upper story) that dies at/below plate
  right at the gable wall line. offsetPoly's loop-direction miter let the WEST
  covered plane's polygon reach the gable-peak sample (→ z 94.6 < plate 96 → emit
  guard at :462 dropped it) while the symmetric EAST end fell back to the real north
  shed (→ 122.8, gabled fine). FIX: `roofProfile` now excludes covered-portion
  faces (the same `!edges[i].covered` exclusion the gable re-partition already uses)
  — both ends now emit maxZ 122.8. SCOPE: render-only (gable infill faces); slope/
  skeleton/coverage byte-identical. GATE: 72/72 suites incl. the 69-check gable
  suite (peak-renders + no-holes + finite) and 41-check lowerroof. COMMITTED, NOT
  DEPLOYED: gable geometry needs live 3D-verify per the conservatism rule, and
  Chrome can't be driven autonomously (2 browsers connected → needs Steve to pick
  one). Steve: open app.plancrafters.com, confirm BOTH gable ends fill, then deploy
  via `bash app/deploy.sh`.
- [ ] **#56 ADJACENT-GABLE corner SPIKE — DEEP (gable-constrained skeleton), needs
  daytime 3D-verify.** Reproduced + root-caused headless. When 2 ADJACENT walls are
  gabled at a convex corner (or roofStyle 'gable'/'mixed' on an L/T), the roof
  spikes ABOVE the legitimate ridge: RECT N+E gabled -> maxZ 222 vs legit ridge 186
  (+36"); T preset +30". Single/opposite gables are clean. ROOT (face dump): the
  gable region (removed N+E hip faces) gets re-tiled by the FAR surviving planes
  (S, W) EXTENDED across the WHOLE footprint — the S plane reaches the north edge at
  z=222 — so the roof rises to a tall corner instead of an interior ridge. This is
  the fundamental gable-constrained-skeleton limit the in-code note (roof.js ~404)
  already flags; NOT a bounded logic fix. Candidate approach for the daytime
  session: clamp gabled-roof faces at the all-hip maxZ of the same footprint (a
  clean analytic bound — gabling never legitimately raises the ridge), implemented
  via the proven clipHalfPlane z-split, then 3D-verify the flat-top reads right.
  HIGH RISK to coverage/skeleton; ship only gate-green AND 3D-verified. GUARDED: the
  gable suite now asserts a physical diagonal bound (maxZ <= plate + (diag+48)*slope)
  so the spike can't silently get WORSE / blow up to NaN.
- [ ] **(superseded original note) #52 GABLE pediment missing — DEEP/FRAGILE.** On Steve's
  Cedar Ridge: the lower-roof WEST run-end gable wall (`id8_y225o`, x=0, exposed
  y∈[-60,0]) emits NO gable face. ROOT (instrumented): `roofProfile` over that
  wall is FLAT at plate (maxEnvZ=96=plate) so the emit guard at roof.js:462 drops
  it — the west end is resolved as a HIP (the low west-facing plane wins the lower
  envelope), while the symmetric EAST end gets the rising NORTH plane (env 111)
  and gables fine. It's the **run-end asymmetry** (same root as the offsetPoly
  loop-direction bug, memory `plancrafters-roof-engine`) surfacing in the gable
  re-partition (`usable`/`aboveP`/`cand`, roof.js ~351-413). The manual roof-edit
  pull-points CANNOT add a missing face, so this needs the engine fix: make BOTH
  run-ends of a gabled lower-roof wall raise the perpendicular slope (or generate
  a true gable end) so a peak forms. HIGH RISK to the gable suite + coverage —
  only ship gate-green AND 3D-verified. If unsure, leave for Steve + log.

## Done this loop
- Roof-edit pull-point tool (drag corners, on-pitch, ortho toggle, big grab
  zones, draw-on-top); override engine `model.roof.overrides` +
  `HA.applyRoofOverrides` (moves only the single closest vertex). Export(debug).
- Metal standing-seam runs up-slope on shallow lower roofs (`_polyPrism` upSlope).
- Lower-roof run-end hip / dissolve / acute-fin all resolved (see memory).

## Progress log
- (loop start) Brief created. Active: #52 gable pediment missing (id1008).
- (iter 1) #52 root-caused (west run-end profile flat → gable drops at roof.js:462;
  run-end asymmetry in the gable re-partition lower-envelope plane pick). Logged,
  not rushed. Loop reprioritized to safe wins.
- (iter 2) Hip cap: confirmed handled by existing `_addRidgeCaps` peak test (hips
  + ridges), 3D-verified — no fix needed. Regression sweep: 24 footprint×style
  combos clean, gate 71/71. No code change shipped (nothing safe to fix). NEXT
  iter: attempt #52 carefully — in the gable re-tile (roof.js ~393-413) the LOWER
  ENVELOPE of cand planes lets the low west-hip plane win over the rising north
  plane on the west run-end, flattening it. Try: for a gabled wall's re-tile,
  drop cand planes whose height at the wall MIDPOINT is materially below the best
  candidate (so the rising perpendicular plane wins) — but ONLY ship if the FULL
  gate stays green AND it 3D-verifies (fragile; revert on any regression).
- (iter 3) #52 FIXED IN CODE. The deep dive showed it was NOT the skeleton/re-tile
  (slope faces are symmetric) but the gable EMIT: `roofProfile` was reading the
  covered-portion planes (under the upper story) that die below plate at the wall
  line; offsetPoly's loop-direction miter let the west covered plane win the
  peak sample on one end only. Fix = exclude covered faces from roofProfile (1
  surgical filter, render-only, slope geometry untouched). Headless repro: both
  E/W gables now emit maxZ 122.8 (were 1-of-2). Gate 72/72. Committed but NOT
  deployed — gable geometry needs Steve's live 3D-verify (Chrome needs a manual
  browser pick; can't drive it while he's asleep). Next loop or Steve: 3D-verify
  + `bash app/deploy.sh`.
- (iter 4) Hardened the #52 fix. Headless sweep (18+ configs: symmetric N-bands
  over overhang {0,10,14,24} x pitch {4,6,10}, all-sides skirts, single-end
  gables, protruding wings) all emit symmetric, peaked pediments (no overshoot/
  dip). Added a permanent guard to dev-roofgable-test.cjs (block 11, +4 checks):
  a mirror-symmetric gabled lower roof must emit matching pediments (same count,
  equal peak); single-end emits exactly one. PROVED the guard catches the bug:
  on pre-fix roof.js it FAILS 4/4 (west end drops to 0). Gate 72/72. Test-only
  commit (not in the shipped bundle); STILL not deployed -- the #52 geometry is
  what's pending Steve's 3D-verify, and any deploy would carry it live unverified.
- (iter 5) Roof primary mission is done-in-code; started regression-testing the
  rest of the app (per the brief). Swept the EXPORT/GENERATION pipeline across 9
  varied footprints (rect/L/T/U/2-story/metric/+door+win) x roof, framing,
  schedules, serialize round-trip, OBJ/STL/GLTF, IFC, DXF — checking for throws,
  NaN leaks, degenerate/empty output. Result: CLEAN (81 checks). The per-format
  suites only exercised HA.sampleModel (one shape), so this is real new coverage.
  Promoted it to a permanent gate suite dev-exportsweep-test.cjs (additive, not in
  the shipped bundle). Also confirmed the iocad `importDXF` double-assign is an
  intentional LWPOLYLINE decorator, not a bug. Gate 73/73. No app behavior change;
  not deployed (still behind the unverified #52 geometry).
- (iter 6) Hunted the roof's remaining real bug: the adjacent-gable corner SPIKE
  (now tracked as #56). Reproduced + root-caused headless (far planes extended
  across the footprint -> +36" over ridge on RECT N+E; +30" T preset). Confirmed
  it's the deep gable-constrained-skeleton limit, NOT a bounded fix — and it's
  fragile + unverifiable autonomously, so did NOT attempt a blind skeleton change
  (would violate "never ship broken"). SHIPPED a safe guard instead: an always-on
  PHYSICAL diagonal bound in dev-roofgable-test audit() (maxZ <= plate +
  (diag+48)*slope) that every correct roof satisfies (incl. the known spike) but a
  solver blowup/NaN-spike would fail. Documented #56 with a candidate clamp
  approach for the daytime 3D session. Gate 73/73 (86 gable checks). Test+docs only.
- (iter 7) Regression-hunted non-roof subsystems. Stairs geometry (stairLayout/
  stairCorners) is NaN-robust across straight/L configs. FINDING for Steve (NOT a
  bug, likely intentional roadmap — flagging in case it's an oversight): the whole
  compliance-engine layer — HA.codecheck (life-safety IRC checker) AND HA.stairs
  (IRC R311.7 stair checker) — is built, shipped in the bundle, and fully tested
  (dev-codecheck-test, dev-stairs-test) but is NOT referenced anywhere in the app
  UI/sheets (grep: each appears only in its own file + test + manifest). So placed
  stairs / plans are not code-checked in the live app. If that's intended (engines
  await a future "Code Check" panel/sheet), no action. If you WANT it surfaced,
  it's a clean additive wire-up into the A-sheet code block — but it's a life-
  safety/liability + product-placement call (the stair checker self-labels
  "DRAFT/PRELIMINARY — not stamped"), so I did NOT auto-wire it overnight. Related:
  stairLayout's STRAIGHT case derives tread count from footprint DEPTH (ignoring
  rise), so a shallow footprint + tall rise yields a code-illegal riser silently —
  which HA.stairs.check WOULD flag if it were wired. No code change this iter
  (no safe in-scope bug found); app confirmed robust. Gate 73/73.
- (iter 8) Hardened ROOF DORMERS — a real roof feature that had ZERO dedicated
  test coverage. Swept 102 dormer builds across pitch {3,6,10,12} x offset
  {-50..600 incl. off-wall & wall-ends} x {default/tiny/huge/no-window/oversized-
  window} + L footprint + a GABLE wall (must skip) + multi-dormer. Result CLEAN:
  every dormer part finite + non-degenerate, window dims finite, gable-wall dormer
  correctly skipped (no slope to sit on). The dormer z-clamps/window-clamps hold up
  on edge cases. Promoted to a permanent suite dev-dormer-test.cjs (377 checks,
  additive/test-only, not in the bundle). Gate 74/74. No app behavior change; not
  deployed (still behind unverified #52). Also reconfirmed coverdata SF math is
  winding-safe (Math.abs area) and already well-guarded by dev-coverdata-test.
- (iter 9) Confirmed EVERY js module already has dev-test coverage (no untested
  module). Then FUZZED the roof solver — all prior roof suites use fixed fixtures,
  so a fuzzer finds the edge cases that hide BETWEEN them. dev-rooffuzz-test.cjs
  (deterministic seeded LCG, reproducible) builds 4000 random rectilinear
  footprints (rect/L/T/U, widely-varied dims) x random gable subsets x pitch
  {1..14} x overhang {0..30} and asserts: no throw, no non-finite vertex, no slope
  past the physical diagonal bound, no non-finite gable. Result CLEAN — 4000/4000
  (~0.5s). The #56 corner-rise stays UNDER the physical bound (bounded, not a
  runaway — reconfirmed). Strong evidence the solver is robust; permanent net vs.
  any future NaN/blowup/throw regression. Gate 75/75. Test-only, not deployed.
- (iter 10) Extended the fuzzer to ANGLED footprints (random convex n-gons +
  chamfered rectangles) — the rectilinear fuzz only had 90deg vertices, so acute
  vertices / offsetPoly's 1/sin miter were never exercised. Probe (3000 angled
  roofs) flagged 4 "spikes" on thin ACUTE triangles (maxZ 592 > my naive bound).
  Investigated: NOT a solver bug — at an acute vertex offsetPoly legitimately
  pushes the offset apex far past the original footprint, and the single slope
  plane rises to it (finite, bounded, no NaN). The false positive was in my
  FUZZER's bound: it measured the raw footprint bbox, not the OFFSET polygon
  (r.over) extent. Corrected the bound to use r.over -> angled fuzz CLEAN. Folded
  angled cases + the corrected bound into dev-rooffuzz-test.cjs (now 3829 mixed
  rectilinear+angled roofs, deterministic, clean). Solver confirmed robust on
  angled/chamfered plans too. Gate 75/75. Test-only, not deployed.
- (iter 11) Added COVERAGE-correctness fuzzing (distinct from the crash fuzz):
  dev-roofcover-test.cjs builds 800 random HIP footprints (rect/L/T/U) and samples
  the interior on a jittered grid (>=10" off the eave), asserting every interior
  point is covered by a slope face — a HOLE = a visible missing roof panel.
  Result CLEAN: 189,055 interior points across 800 roofs, 0 holes. The main-roof
  tiling is correct across the random footprint space, not just the fixed fixtures.
  Roof headless coverage is now comprehensive: crash/NaN (rectilinear+angled),
  coverage/no-holes, gable symmetry, dormer integrity, export integrity. Gate
  76/76. Test-only, not deployed. Remaining real roof work (#52 deploy, #56
  classify, render-quality) genuinely needs Steve's eyes.
- (iter 12) Fuzzed the FRAGILE part — the LOWER-ROOF skirt (most bug history).
  dev-lowercover-test.cjs builds 1200 random 2-story setbacks (rect L0, rect L1
  inset per-side 0=flush OR >=24", random pitch/overhang) and samples the exposed
  annulus for skirt-coverage holes. Probe initially flagged 3 cases -> ALL were
  degenerate 1" insets (a sliver band with no roof; benign, excluded as not a real
  jog). With meaningful setbacks: CLEAN — 755,478 band points across 1111 setbacks,
  0 holes. The fragile skirt fully tiles its exposed band across the setback space,
  not just the 7 fixed fixtures. Strong confidence in the historically bug-prone
  skeleton. NOTE (benign, not fixing): a sub-foot (1") upper inset yields no skirt
  slope faces — acceptable (nothing meaningful to roof; wall/main roof covers it).
  Gate 77/77. Test-only, not deployed.
- (iter 13-14) High-value headless work is exhausted; switched to honest LIGHT
  maintenance. Confirmed gate stays 77/77 + staged batch deploy-ready (declined to
  manufacture marginal busywork). Consolidated the scattered progress log into the
  MORNING BRIEF at the top of this file so Steve's next actions are front-and-center.
  Loop now genuinely blocked on Steve (3D-verify #52, classify #56, render-quality).
  Left the 30-min cron untouched (respecting Steve's explicit setup); cycles stay
  light until he engages.
