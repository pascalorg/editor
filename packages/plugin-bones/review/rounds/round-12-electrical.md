# Round 12 — Electrical Realism Backlog

**Scope:** cable routing/support realism (NEC Article 334, 300.4), smoke-alarm wiring (IRC R314 / NFPA 72), switch/lighting wiring topology (NEC 404.2, 210.70), and per-jurisdiction deltas.
**Engine under review:** `src/engines/electrical.ts` (layoutElectrical, assignCircuits, routeWiring, buildWallGraph), `src/engines/takeoff.ts`, `data/electrical-rules.json`.
**Status of findings:** every flaw below was adversarially verified with independent repro scripts (bun, importing the real module). No refutations survived.

---

## 1. Product owner's questions — direct answers

### Q1. "Are the smoke alarms and lights actually wired to the panel?"

**On paper, mostly. Geometrically, not reliably — and never correctly.**

- **Power (topology):** every fixture is assigned a circuit and chained back toward the panel by `routeWiring`. On a clean plan, a union-find trace over member endpoints reaches all devices.
- **Power (geometry):** three verified connectivity breaks make circuits *physically* disconnect from the panel while reporting success:
  1. Panel placed inside a door rough opening → **100% of homeruns disconnected** (22/22 devices unreachable in repro).
  2. Tee junctions snapped out of door ROs leave an unbridged ~0.52 m hop → whole wall segments stranded silently.
  3. Junctions accepted within `JUNCTION_TOL = 0.25 m` but not coincident leave 5–25 cm air gaps at every tee/corner in extracted (non-idealized) scenes.
  Additionally, **no wire ever reaches a box**: every wall device's nearest wire endpoint stops 2.72 in short (wall centerline vs. face-mounted box), and the panel homerun starts at the same offset.
- **Smoke alarms specifically:** they get power but are **NOT interconnected** (IRC R314.4 violation). Alarms ride whatever lighting circuit their room packed into — on a realistic 3-bed plan they split across LTG-3 and LTG-4 — and no alarm-to-alarm interconnect run or 3-conductor cable exists anywhere in the pipeline (`/2` is hardcoded in the label template).
- **Lights specifically:** lights are chained as generic loads. **Switch legs are not modeled at all** — no member connects a switch to the light it controls, 3-way is a label-only flag with zero traveler runs, and NEC 404.2(C) neutral-at-switch is unverifiable because conductor counts don't exist.

### Q2. "Are the runs stapled to the studs, or drilled through them?"

**Neither. Both concepts are absent.**

- **Staples:** zero securement objects of any kind are generated (`routeWiring` emits only role `'wire-run'`). The 4.5-ft interval rule, the 12-in-of-every-box rule (NEC 334.30), and the 8-in single-gang-plastic-box rule (314.17) are unmodeled and unvalidatable. Longest unsupported leg in the small 8×4 m fixture: **18.9 ft with zero fasteners**. Takeoff has no staple line item.
- **Drilled holes:** horizontal legs run at 18 in AFF along the wall *centerline* — "bore through the studs" exists only as a comment. Cross-checked against the framing engine's own studs: **234 wire-through-stud interpenetrations in a 5-wall plan**, zero hole objects, zero edge-distance checks, zero nail plates (NEC 300.4(A)(1)).
- Worse routing pathologies: device risers run **lengthwise up the middle of studs** (anchors never consult stud positions, and the door-clearance snap deterministically lands anchors *inside king studs*); the over-door detour runs **lengthwise inside the solid header** (misses the clear cripple bay by 3.2 in); all homeruns stack perfectly coincident through one implied hole (no NEC 334.80 bundle cap / derating); drill-height legs pass **straight through low-sill window glass** (only `kind === 'door'` breaks runs); ceiling crossings **float 20 cm above the top plates in free air** (ceiling framing never consulted).

### Q3. "What differs per jurisdiction?"

- **Wiring method & cable support: nationally uniform.** No state prohibits NM (Romex) or amends the NEC 334.30 staple / 300.4 nail-plate rules. Keep one unforked cable-support engine for all 51 jurisdictions. The only exceptions are **municipal** (Chicago metro = conduit/EMT required; NYC = NM restricted) → city-layer override flag, and Idaho's *permissive* crawl-space relaxation (NM may run across joist bottoms in ≤4.5-ft crawls).
- **Breaker schedules (AFCI/GFCI): huge per-state deltas.** Extremes: Indiana (zero AFCI, non-TR receptacles), Idaho & Tennessee (AFCI bedrooms-only), Utah (no AFCI at all), Massachusetts (AFCI on ALL circuits — stricter). ~10 states delete/exempt the 210.8(F) outdoor/HVAC GFCI; 6 states reject 250 V receptacle GFCI. Full matrix in §2.4.
- **Smoke alarms: placement is nationally uniform**; only ME/VT/MA change output (photoelectric type attribute near kitchens/baths, or everywhere for VT). WI renumbers to SPS 321.09. 2024 IRC adds garage heat alarms (edition-gated).
- **Current dataset gap:** `data/electrical-rules.json` and `docs/research/electrical.md` cover device layout only (210.52, 210.8, 210.12, 210.70, R314/R315) — **nothing on Article 334, 300.4, staples, nail plates, bored holes, or notching**. All cable-support rules below are net-new for the corpus.

---

## 2. Researched rules (with citations)

All values 2023 NEC unless noted; the Article 334 / 300.4 values are edition-stable back through 2017.

### 2.1 Cable securement & support (NEC 334.30, 314.17)

| # | Rule | Citation | Engine translation |
|---|------|----------|--------------------|
| R1 | Secure NM with staples/listed ties/straps/hangers at intervals ≤ 4.5 ft (54 in), devices must not damage cable | NEC 334.30 | Emit a fastener every ≤ 54 in along any free (not-in-hole) cable segment. Practice: max 2 flat NM per staple; stackers beyond that. |
| R2 | Secure within 12 in of every box/cabinet/fitting entry (measured along cable) | NEC 334.30 | First/last staple ≤ 12 in of cable length from each box knockout. |
| R3 | Single-gang nonmetallic clampless boxes (≤ 2¼×4 in): secure within **8 in**; sheath extends ≥ ¼ in into box | NEC 314.17(B)(1) Ex (2023); 314.17(C) Ex (2017/2020) | Residential default box type → tighten 12 in to 8 in; model ¼ in sheath past box wall. |
| R4 | Flat NM must not be stapled on edge | NEC 334.30 | Orientation constraint: wide face against framing under each staple. |
| R5 | Runs through bored holes/notches count as supported if hole interval ≤ 4.5 ft | NEC 334.30(A) | 16/24-in-o.c. through-stud runs need no staples between studs; box-entry rule (12 in / 8 in) still applies at run ends. |
| R6 | Unsupported OK when fished in finished construction, or ≤ 4.5 ft whip to luminaire/equipment above accessible ceiling | NEC 334.30(B) | `fished/retrofit` segment flag exempts staple-interval checks; allow ≤ 54 in fixture whips. |
| R7 | Bend inner radius ≥ 5× cable diameter | NEC 334.24 | Min bend radius ≈ 2.5 in for 12-2; model turns as arcs, no sharp 90s. |

### 2.2 Protection from penetration (NEC 300.4) + structural cross-check (IRC R602.6)

| # | Rule | Citation | Engine translation |
|---|------|----------|--------------------|
| R8 | Bored hole edge ≥ 1¼ in from nearest wood edge, else 1/16-in steel plate | NEC 300.4(A)(1) | `min(edgeDistLeft, edgeDistRight) ≥ 1.25 in` or emit nail plate per violating face. 2x4 (3.5 in): centered hole ≤ 1.0 in plate-free; 2x6: ≤ 3.0 in. Any hole in the 1.5-in narrow face always violates. |
| R9 | Cable in a notch → steel plate ≥ 1/16 in before finish | NEC 300.4(A)(2) | Every notch-routed segment gets a nail-plate object spanning the notch. |
| R10 | Cable parallel to framing: nearest surface ≥ 1¼ in from framing edge, else plate/sleeve | NEC 300.4(D) | Vertical run on 3.5-in broad face: centerline setback ≥ 1.25 in + half-width from BOTH edges (center @ 1.75 in always compliant). Stapling to the 1.5-in nailing face of a concealed stud = violation. |
| R11 | Face-of-stud decision rule | NEC 334.30 + 300.4(D) + 334.15 | Concealed wall + run ∥ stud → staple broad face, centered. Concealed + run ⊥ studs → bored holes only (no stapling across drywall-side faces). Exposed wall → surface run allowed w/ 334.15(B) checks. |
| R12 | Metal framing: listed bushing/grommet at every penetration; same 1¼-in plate trigger | NEC 300.4(B) | Steel-stud wall system → grommet object per penetration; edge-distance check unchanged. |
| R13 | ≥ 1½ in below metal-corrugated roof decking; never in flutes | NEC 300.4(E) | Clamp top-of-cable ≥ 1.5 in below deck underside on rafter/top-chord runs. |
| R14 | Stud bored holes: ≤ 40% depth bearing (1.4 in for 2x4) / ≤ 60% non-bearing or doubled (2.1 in), edge ≥ 5/8 in, no hole+notch same section; notches ≤ 25%/40% | IRC R602.6 (structural) | Hole generator = min(structural max, NEC no-plate max): bearing 2x4 → practical centered no-plate hole 1.0 in (NEC governs), absolute cap 1.4 in (plate above 1.0 in). NEC 1.25-in edge rule supersedes the 5/8-in structural min for unprotected cable. |

### 2.3 Exposed work, basements, attics, bundling

| # | Rule | Citation | Engine translation |
|---|------|----------|--------------------|
| R15 | Exposed NM follows surface/running boards; protect where subject to damage; floor penetrations sleeved ≥ 6 in above floor | NEC 334.15(A),(B) | Flag free-air spans in garages/unfinished basements; auto-emit conduit sleeve ≥ 6 in at floor penetrations. |
| R16 | Unfinished basements: 14/12/10 AWG crossing joists must go through bored holes or running boards (direct under-joist attach only for ≥ two 6 AWG / three 8 AWG) | NEC 334.15(C) | Crossing-joist runs for branch cable: bored holes (centered, 1.25-in rule) or running board. Feeder-size (6/3, 8/3) may staple to joist bottoms. |
| R17 | Attics: cable across joist tops (or within 7 ft on rafter/stud faces) needs guard strips; scuttle-only access → guards within 6 ft of hatch; along-side runs exempt | NEC 334.23 → 320.23 | Prefer holes/along-side; else emit guard strips (full run if stair/ladder access, 6-ft hatch radius otherwise). |
| R18 | >2 NM cables through one draft/fire-stopped opening, or bundles > 24 in → derate per 310.15(C)(1) | NEC 334.80 | Cap 2 cables per fire-caulked plate hole; 3+ shared → add holes or verify derated ampacity (9 CCC → 70%: 12 AWG still OK @ 20 A; 4+ cables @ 50% fails). |

### 2.4 Smoke alarms, lighting/switching, circuits

| # | Rule | Citation | Engine translation |
|---|------|----------|--------------------|
| R19 | Smoke alarm in each bedroom, outside each sleeping area, every story incl. basements | IRC 2021 R314.3 | One node per bedroom (ceiling center), one per bedroom-serving hall, one per otherwise-uncovered story. |
| R20 | Clearances: ≥ 3 ft from tub/shower bath door; ≥ 20 ft from cooking appliance (10 ft ionization+silencer, 6 ft photoelectric) | IRC R314.3.1/.3.2 (sub-numbering varies — approx) | Proximity check vs bath doors + range; open plan failing 20 ft everywhere → downgrade to photoelectric (6 ft), don't delete. |
| R21 | All required alarms interconnected (one triggers all); wireless listed units exempt from wired interconnect; hardwired is new-construction default | IRC 2021 R314.4 | All alarm nodes = one interconnect group; single daisy chain (any chain/tree works — shared signal conductor). |
| R22 | New construction: primary power from building wiring + battery backup; never on a switched leg | IRC 2021 R314.6 | Tap an always-hot point; battery = device attribute. |
| R23 | Dedicated circuit NOT required; unswitched portion of a lighting circuit is normal practice; AFCI permitted | NFPA 72 29.6.3 | Default: tap nearest bedroom/hall 15 A lighting circuit unswitched; `dedicatedCircuit` toggle. |
| R24 | Alarm circuit is AFCI (bedroom/hall areas); no GFCI for ceiling outlets | NEC 2023 210.12(A)/(B) | Tag alarm circuit AFCI=true at panel. |
| R25 | Cable topology: panel → first alarm 14/2; alarm→alarm chain 14/3 (red interconnect, never returns to panel) | Universal practice per NEC 300/334 wiring methods | One 14/2 homerun + 14/3 nearest-neighbor chain; BOM counts 14/2 vs 14/3 separately. |
| R26 | Interconnect limits: ≤ 12 smoke; ≤ 18 total with heat/CO added | NFPA 72 29.8.2.1 + Kidde/BRK listings (approx) | Validate counts; flag (don't auto-split) oversized houses. |
| R27 | Mounting: ceiling ≥ 4 in off walls; wall-mount top 4–12 in below ceiling; sloped: within 3 ft horizontal of peak, ≥ 4 in below; ≥ 3 ft from supply registers/fan tips | NFPA 72 29.11 (R314.1 defers to NFPA 72) | Ceiling centroid default, 12-in comfortable wall clearance; ridge band 4–36 in; 3-ft exclusion disks. |
| R28 | Garage heat alarm (interconnected, 135–150 °F) | IRC **2024** R314 / NFPA 72 (2022) 29.5.1 — NOT in 2021 IRC | Edition-gate: `codeEdition ≥ IRC2024` → one heat alarm per attached garage, appended to 14/3 chain (18-cap, not 12-cap). |
| R29 | CO alarm outside sleeping areas if fuel appliance or attached garage | IRC 2021 R315 (in dataset) | Upgrade hallway node to combo smoke/CO — no wiring change. |
| R30 | Lighting outlet + wall switch per habitable room/kitchen/bath (switched receptacle OK outside kitchen/bath) | NEC 210.70(A)(1) / IRC E3903.1 | Ceiling outlet at centroid + switch; switched half-hot receptacle toggle for bed/living. |
| R31 | Also: hallways, stairways, garages, exterior grade-level entrances (vehicle doors don't count) | NEC 210.70(A)(2) / IRC E3903.2 | Hall/garage lights + switches; sconce at each grade-level door. |
| R32 | Stairs ≥ 6 risers: switch at each floor level + qualifying landings (3-way pair, 4-way at landings) | NEC 210.70(A)(2)(3) / IRC E3903 | 3-way boxes top+bottom, 14/3 travelers, 4-way per doorway landing. |
| R33 | Attic/underfloor/utility/basement w/ storage or equipment: light + switch at entry | NEC 210.70(A)(3) / E3903.3 | Keyless fixture near equipment + switch at access. |
| R34 | Neutral at every switch location (exceptions: raceway, open-cavity access, neutral-free listed controls 2020+; multi-location rooms need it at only one) | NEC 2023 404.2(C) | Never emit a 2-wire loop: power→switch first then 14/2 to light, OR power-at-light with 14/3 drop. 3-ways: neutral at ≥ 1 (default both). |
| R35 | Switches interrupt the hot only; neutral continuous | NEC 404.2(B) | Graph invariant: neutral panel→luminaire uninterrupted. |
| R36 | Legacy 2-wire loop: white re-identified, supply-only | NEC 200.7(C) | Never generate in new work; validator note for as-built import only. |
| R37 | Switch @ ~48 in AFF, latch side, 4–6 in from casing; 3-way pairing for rooms w/ 2 remote entries is practice | ANSI A117.1 reach + trade practice | 48 in AFF, 6 in off jamb knob side; 2+ entries > 8 ft apart → 3-way pair w/ 14/3 traveler. |
| R38 | Ceiling boxes listed for support; fan-rated where a paddle fan could be installed (dwelling habitable rooms, 2020+) | NEC 314.27(A)/(C) | Fan-rated box for bed/living/family/dining; standard elsewhere. |
| R39 | Lighting circuits 15 A/14 AWG norm; 3 VA/ft² general load | NEC 240.4(D), 220.41 | 14/2+14/3 on 15 A AFCI; ~600 ft² lighting per 15 A circuit @ 80% (heuristic — approx). |
| R40 | Circuit topology: panel → first switch box → daisy chain; each switch feeds its light w/ 14/2 switched leg; alarm chain taps unswitched hall junction | Mike Holt / trade practice (no code section dictates topology) | Order rooms by panel proximity; homerun to closest switch box; alarm chain branches off bedroom-area lighting circuit. |

### 2.5 Jurisdiction deltas (state layer)

**Wiring methods — national finding:** NO state restricts NM or amends 300.4/334.30 [NAHB State NEC Adoptions, Jan 2023]. Municipal only: **Chicago** (raceway/EMT) + Cook Co. suburbs, **NYC** (NM restricted) → `chicagoMetro`/`nyc` city-layer override flags.

**Big-delta states (breaker schedules):**

| State | Delta | Citation |
|-------|-------|----------|
| **ID** | AFCI **bedrooms only**; GFCI 125 V-only, unfinished basements only, no blanket kitchen/laundry/appliance GFCI; non-kitchen sinks only; below-counter island receptacle OK; small decks (<20 ft²) exempt; no fan-box mandate; SPD/emergency-disconnect permissive; crawl ≤ 4.5 ft → NM across joist bottoms OK | IDAPA 24.39.10.600 (eff 4/4/2025, primary text) |
| **IN** | AFCI + TR receptacles **completely deleted** (1-2 family); rides 2008 NEC otherwise. Biggest breaker delta anywhere. | NAHB tracker; 675 IAC 17 |
| **UT** | AFCI deleted for new construction; GFCI 125 V-only, no finished-basement/outdoor; pre-2020 tub zone | Utah Code 15A (verify exact wording — fetch-blocked) |
| **TN** | AFCI **bedrooms only** | NAHB tracker |
| **OR** | AFCI drops hallways/kitchens/laundry; GFCI skips 240 V, finished basements, dishwashers, fixed appliances (label 'not GFCI protected'); outdoor GFCI non-dwellings only | OESC 2020-NEC base (verify carry to 2023 cycle) |
| **SC** | AFCI/GFCI 120 V-only; AFCI excludes kitchen/laundry; walk-out finished basements plain | NAHB tracker (2021 IRC) |
| **WI** | No kitchen AFCI; no sink/tub/shower-proximity or laundry GFCI; smoke alarms cite **SPS 321.09** | SPS 316 (2017 NEC per tracker — verify edition) |
| **NC** | No kitchen/laundry AFCI; dishwasher GFCI deleted; garage fixed-appliance + sewage-pump exemptions | NAHB tracker (2017 NEC, 2018 NCRC) |
| **AR** | Kitchen/laundry AFCI removed | NAHB tracker (2020 NEC) |
| **MT** | Kitchen AFCI deleted; **no local amendments allowed** (state authoritative) | NAHB tracker (verify 2023 carry) |
| **AL** | 2008-NEC-equivalent profile: no kitchen/laundry AFCI, no laundry GFCI, island receptacle required | NAHB tracker (2015 ARC) |
| **MA** | **Stricter**: AFCI on ALL circuits; island receptacle mandatory; sink 6-ft test unobstructed-path; photoelectric within 20 ft of kitchen/tub-shower bath | 527 CMR 12; MGL c.148 §26F (verify cite) |
| **ME** | No SPD; pre-2020 tub zone; photoelectric near kitchen/bath | 25 M.R.S. §2464 (primary) |
| **VT** | GFCI readily-accessible-only; laundry GFCI within 6 ft; **all alarms photoelectric** | 9 V.S.A. §2882 (primary) |
| **VA** | AFCI not required where GFCI is required → kitchen/laundry GFCI-only breakers | NAHB tracker (2018 IRC; verify 2021 VRC carry) |
| **KY** | Islands still required (2017 rule) until 7/15/2026; >125 V + appliance GFCI suspended (UL 943/101 pending); no SPD/fan-box | KY DHBC notice 10/7/2024 (primary) |
| **ND/OH/NH/NJ/WV/WA** | Narrow exemptions: ND fridge/furnace/sump AFCI-exempt + opener GFCI added + no SPD; OH countertop-only-circuit AFCI-exempt + opener/sump; NH nuisance-trip field allowance (no-op); NJ rehab-only; WV HVAC GFCI exception + reno AFCI relief; WA red fire-alarm receptacle plain + fixed-equipment GFCI near tubs | NAHB tracker rows; WAC 296-46B |
| **210.8(F) outdoor/HVAC GFCI** | Deleted/HVAC-exempt in **GA, TX, CT, LA, ME, SD, UT, OR, WV, ID** → `outdoorOutletGfci` per-state boolean | NAHB tracker + IDAPA |
| **250 V receptacle GFCI** | Rejected in **IA, SD, SC, UT, ID, KY** → plain 2-pole dryer/range breakers there | NAHB tracker; IDAPA; KY notice |
| **MI** | Full 2023 NEC AFCI/GFCI at Part 8 level; SPD + emergency disconnect required; **HIGH-priority verify flag**: 2015 MRC had AFCI fully removed for 1-2 family, 2021 MRC restoration unverified | icc-nta.org / expertce.com / NAHB tracker |
| **No delta** | CA, CO, DE, FL, HI, MD, MN, NE, NM, NY, OK, PA, RI, WY, DC — edition switch only | NAHB 'No Amendments' column |
| **No statewide code** | AK, AZ, IL, KS, MO, MS, NV → `mustVerifyLocally` + priority city overrides: Chicago (all-AFCI + conduit), Anchorage (breaker-only AFCI, EV rough-in), Phoenix (indoor damp/wet GFCI), Wichita (210.8(F)/240 V delayed), St. Louis Co (AFCI bedrooms-only), Clark Co/Las Vegas (outlets-per-circuit cap) | NAHB city rows |

**Freshness caveat:** NAHB tracker is dated 2023-01-12. Re-verify before shipping state breaker output: GA, TX, MT, ND, SD, IA, CT, OH, WI, MN, NH, NJ. ID and KY re-verified on current primary sources (amendments persisted — the observed norm). Store overlays with `asOf` + `verify` flags, mirroring `jurisdictions-adoption.json`.

**Corpus note:** all of §2.1–2.3 is net-new — add a `cableSupport` section to `data/electrical-rules.json`; a routing/support engine cannot be driven from the file as it stands.

---

## 3. Confirmed flaws, ranked by severity (all adversarially verified)

### Blockers

**B1. Panel placed inside a door opening — all homeruns disconnect from the panel.**
`placePanel()` mounts at `face.plan(wall.length / 2)` (electrical.ts:398) without consulting `wall.openings`. Door spanning the wall midpoint (common on garage walls) → panel lands inside the RO; `routeWiring`'s `panelAnchor` (`nearestWallPoint → clearOfDoors`, lines 836–845) snaps ~0.52 m away (2.5 m for a 16-ft overhead door) and no member bridges panel→anchor.
*Repro:* 2-room kitchen/garage plan, 0.9 m door at u=2 on the 4 m garage wall → panel gap 0.524 m; union-find over member endpoints (2 cm merge, 12 cm attach): **22/22 devices unreachable**, still 22/22 at 0.35 m tolerance. Door at u=1 → 0 unreachable (door-at-midpoint is the trigger). No downstream correction anywhere in the repo; no test covers a door at the panel-wall midpoint.

**B2. Tee junction snapped out of a door RO leaves an unbridged 0.52 m hop — silently strands whole walls.**
`buildWallGraph` snaps a junction projecting into a door RO to `safeProj = clearOfDoors(...)` (line 674), but `wallPath`/`routeHop` emit per-wall legs only (710–716, 821–827): through-wall leg ends at u=3.520 while the tee-wall leg starts at u=3.000. Because `wallPath` succeeded, the 'air run' fallback (829–833) never fires — 0 air-run labels emitted.
*Repro:* union-find shows 4/18 devices (all w_div receptacles, circuit GEN-2) disconnected. The existing 'round-6 pin' test (electrical.test.ts:1004) asserts the snap happens — **codifying the disconnection**.

**B3. No cable securement anywhere — zero staples/fasteners modeled or counted (NEC 334.30 / 314.17).**
`routeWiring` (738–889) emits only role `'wire-run'` (unique-role census on the repo's own fixture: `['wire-run']`). No 4.5-ft interval, 12-in/8-in box rules, no fished-exemption flag; takeoff (432–470, 583+) has NM feet + framing nails but no staple row.
*Repro:* 8×4 m fixture → 92 members, longest unsupported legs 18.865 / 18.146 / 13.123 ft; 40/92 legs exceed the 4.5-ft interval; 0 securement rows in 14 takeoff rows.

**B4. Bored holes and nail plates not modeled — 234 unlabeled wire-through-stud interpenetrations in a 5-wall plan (NEC 300.4(A)(1)).**
Legs run at WIRE_RUN_Y = 18 in on the wall centerline; "bore through the studs" is only a comment (electrical.ts:594–595). Cross-check vs `frameWalls(detail '400')`: 234 leg×stud AABB interpenetrations (224 deep embeds), 4 wire×plate crossings, 0 hole/bore/drill labels. No edge-distance solver, no nail plates: a 2.5-in chase wall → implied centered hole edge 1.010 in < 1.25 in with 7 drill legs and zero flags. `interpenetration.test.ts:21–24` explicitly excludes MEP, so nothing gates hole compatibility.

**B5. Door detour is unbuildable — the 'over the header' leg runs lengthwise INSIDE the solid header; risers embed in the trimmers.**
`emitWallLeg` sets `overY = sillHeight + roughHeight + 4in` (line 810). For a standard 36-in door the framing engine emits a 4x8 header at y=[2.138..2.322]; overY = 2.240 m is inside it — cable embedded lengthwise for the full 0.938 m RO width, missing the clear cripple bay above by 3.2 in. Deterministic: any RO > 24 in gets a 5.5–7.25 in header, so roTop+4in always lands inside it. Detour risers rise exactly at the RO edge = trimmer face plane (66-in lengthwise embeds). The regression test only asserts a leg exists at overY, never that overY clears the actual header.

### Majors

**M1. JUNCTION_TOL float-gaps: junctions within 0.25 m but not coincident leave unbridged air gaps at every tee/corner.**
Same root cause as B2 at smaller magnitude (line 599: `JUNCTION_TOL = 0.25`; 661–679 accept without bridging). Extracted scenes where a tee wall stops at the through-wall FACE get ~5–7 cm gaps at every tee.
*Repro:* divider ending 0.2 m short of both perimeter walls → 30 members, zero air-run labels, union-find: the divider's 4 members are an island exactly 0.200 m from the rest; 0/4 reachable. Exact-meeting control: single component.

**M2. Switch legs are not modeled at all; 3-way is label-only.**
`routeWiring` (849–886) chains all fixture kinds identically; no switch→light member, no meta link (switch meta = {circuit, breakerA, gaugeAwg, va, afci} only), no traveler runs (assignCircuits 529–538 sets meta.threeWay + relabel only). Every wire is `NM-B ${gauge}/2 w/G` (line 776). Mitigating: each switch does land on its room light's circuit. The code's own LOD 400 TODO (275–277) admits the gap.

**M3. Smoke alarms powered but NOT interconnected (IRC R314.4) — and split across breakers.**
Alarms inherit their room's lighting circuit (517–520); room-order VA packing (476–484) splits them: 3-bed repro → Bed 1 + hall on LTG-3, Bed 2 on LTG-4. Zero interconnect members; no third conductor exists ('/2' hardcode). `data/electrical-rules.json:114` declares `interconnectedRequired: true` — nothing consumes it. The LOD 400 TODO (line 306) lists R314 work but omits interconnection.

**M4. 14/3 does not exist anywhere in the pipeline.**
emitWire hardcodes `/2` (776); takeoff parses gauge with `/(\d+)\/2/` (takeoff.ts:435) and re-prints `/2` (469) — a /3 label can't even round-trip. Consequences: alarm chain billed as 14/2; 3 three-way switches → 0 traveler runs; 404.2(C) neutral-at-switch unverifiable.

**M5. Device risers run lengthwise through common studs; door-snap relocates anchors INTO king studs.**
`nearestWallPoint` (629–645) snaps clear of doors only, never studs. On a 6.578 m wall, risers run 3.5–6.45 ft inside a common stud; one receptacle riser lands dead-center in a stud (u=1.6445 vs stud [1.6256..1.6637]). `clearOfDoors` margin = RO edge + 2 in = exactly the king-stud zone: snapped anchors land at 0.500 in past the king-stud edge, deterministically. `clearOfDoors`'s own docstring ("lands in the first stud bay past the king studs") contradicts the implementation.

**M6. Ceiling crossings float in free air above the top plates; ceiling framing never consulted.**
Lights/alarms placed at y = room.ceilingHeight (270, 286); routeWiring receives walls only and crosses X-then-Z at that height (869–872). Repo defaults: wall.height 2.5 vs ceilingHeight 2.7 → crossings hang 0.20 m above the top-plate plane, riser pokes 0.20 m above its wall. "Through the joist bays" is aspirational; no guard-strip (334.23) or metal-deck (300.4(E)) logic exists anywhere.

**M7. All homeruns stack perfectly coincident through one implied hole — no 334.80 bundle cap or derating.**
Every circuit drops at the identical `panelAnchor` (836–848): repro shows 5 byte-identical coincident vertical members (z-fighting) and 5 circuits through one implied stud bore. A real ~20-circuit panel wall = 20 cables in one phantom hole. Nothing counts cables-per-penetration.

**M8. No wire ever reaches a box — uniform 2.72-in gap at every wall device.**
Devices sit at wall face + 0.75 in (FACE_OFFSET, lines 34/116/121); risers terminate on the centerline (875); the centerline→box jog is never emitted. Repro: 18/18 wall devices at gap 0.0690–0.0691 m (= thickness/2 + 0.75 in exactly); 0/18 touched by any wire. Ceiling fixtures get exact legs (gap 0.0000) — proving a missing jog, not uniform abstraction. Blocks ever modeling 334.30 12-in/8-in securement anchors, ¼-in sheath entry, and per-box 36-in makeup for takeoff.

### Minors

**m1. No test traces panel-to-device reachability — all three connectivity breaks pass the suite green.**
electrical.test.ts 829–938 asserts local proximity only (drop < 0.12 m of panel, leg < 0.12 m of device, legs hug corridors); the round-6 pin (1004–1022) checks junction u-values only. electrical.regression.test.ts has zero routeWiring coverage. Suite: 72 pass / 0 fail while repros show 22/22, 4/17, 2/14 unreachable with zero air-run labels. A ~40-line endpoint union-find catches all three.

**m2. Wall devices/panel attach only via an implied ~7 cm face-vs-centerline gap** (same geometry as M8, framed as contract): strict endpoint tracing sees every wall device floating 0.069 m off its circuit; tests bake a 0.12 m fudge. Needs an explicit box-stub member or a documented attachment-tolerance contract. (Gap is thickness-dependent: thickness/2 + 0.75 in.)

**m3. Only doors break runs — drill-height legs pass straight through low-sill window ROs.**
`clearOfDoors` (616) and emitWallLeg's filter (796) test `kind === 'door'` only. 2.4 m window at sill 0.3 m → 3 legs cross the RO interior at y=0.457 with no detour/flag; anchors also land inside the RO. Check must be geometric (RO vertical extent vs WIRE_RUN_Y), not kind-based. Controls: sill 0.9 m → 0 crossings; same-width door → detour works.

**m4. Cable profile is a 0.5-in square 'copper' box — flat-NM geometry and the no-edge-stapling rule are unrepresentable.**
WIRE_SECTION = 0.5 in square, deliberately oversized (596–597), material 'copper' (774). Real 14/2 is ~0.17×0.45 in flat oval; 334.30 orientation and 300.4(D) half-width setback arithmetic have no geometric meaning. Member type has no meta field, so profile/orientation can't attach without a type change; takeoff must regex the gauge out of the label because dims are useless as data.

---

## 4. Implementation plan — honest LOD 400

Ordered by phase; each item names the pin test. Convention: new tests live in `electrical.test.ts` (unit) and `electrical.regression.test.ts` (plan-level), plus a new `electrical.connectivity.test.ts`.

### Phase 0 — connectivity truth (fixes B1, B2, M1, m1, M8/m2)

1. **Global reachability harness (do this first).** Add a shared test util `traceCircuits(members, fixtures, panel)`: union-find over member endpoints (2 cm merge) + segment-body distance join (3 cm), device attach via explicit box-stub members once item 4 lands (interim: 12 cm documented tolerance). Assert every routed device reaches the panel component and zero silent islands.
   *Pin:* `electrical.connectivity.test.ts` — run traceCircuits on (a) the clean fixture, (b) door-at-panel-midpoint plan, (c) tee-into-door plan, (d) 0.2 m-short divider plan. Expect 0 unreachable in all four. Tests (b)–(d) are the current repros and MUST fail before the fixes, pass after.
2. **Panel placement clear of door ROs.** `placePanel` picks mount u from the widest usable wall segment (`clearOfDoors` on wall.length/2 at minimum); additionally `routeWiring` emits an explicit bridge leg panel→panelAnchor whenever they differ (belt and braces).
   *Pin:* door spanning midpoint of the longest garage wall → panel position outside all ROs AND traceCircuits 0 unreachable; 16-ft overhead-door variant included.
3. **Junction jumper members.** Wherever `buildWallGraph` records a junction whose two wall-local points differ (door-snap OR any gap ≤ JUNCTION_TOL), `routeHop` emits a jumper member spanning `wallPlan(teeEnd) → wallPlan(throughWall, safeProj)` at drill height. Reduce JUNCTION_TOL acceptance to require the jumper, never bare adjacency.
   *Pin:* tee-into-door plan → a member exists whose endpoints cover the 0.52 m hop within 2 cm; divider-0.2 m-short plan → single connected component. Rewrite the round-6 pin test to assert continuity, not just the snap.
4. **Box-stub members.** Emit the centerline→box jog for every wall device and the panel (length = thickness/2 + FACE_OFFSET, at device height). Document ¼-in sheath-into-box in member meta (needs meta on Member — see item 13).
   *Pin:* every wall device's position is within 1 cm of some member endpoint; ceiling parity test (already 0.0000) unchanged; drop the 0.12 m fudge in existing tests to 0.02 m.

### Phase 1 — holes, plates, staples (fixes B3, B4, B5, M5, M7, m3; implements R1–R14, R18)

5. **Stud-aware routing + bored-hole objects.** `routeWiring` gains a framing input (or a deterministic stud-grid model matching `frameWalls`): horizontal drill legs generate one `bored-hole` object per stud crossing (centered in stud depth, diameter from cable count), risers snap to bay centers (never inside stud footprints, never the king-stud zone — fix the `clearOfDoors` margin to RO + 3 in + half-bay), and holes are capped at 2 cables (334.80) — third cable gets a second hole with lateral offset; homeruns fan out laterally from the panel (no coincident members).
   *Pin:* (a) 5-wall plan → 0 wire×stud lengthwise AABB interpenetrations at LOD 400 while crossing penetrations coincide with emitted hole objects; (b) door-adjacent anchor lands ≥ half a bay from king-stud footprint; (c) panel wall: max cables-per-hole ≤ 2, 0 coincident members; (d) update interpenetration.test.ts to gate wires: crossings allowed ONLY where a hole object exists.
6. **Edge-distance solver + nail plates (R8/R9/R14 + R12).** Per hole: `min(edgeDist) ≥ 1.25 in` else emit `nail-plate` member on each violating face; enforce IRC R602.6 structural caps (min(structural, NEC-no-plate) sizing table: 2x4 bearing → 1.0 in free / 1.4 in absolute); steel-stud systems emit grommets.
   *Pin:* 2.5-in chase wall (repro case) → every drill leg carries a hole with a nail plate on both faces; 2x6 wall with centered 1-in hole → zero plates; hole > 1.4 in in a bearing 2x4 → validation error, not a plate.
7. **Fastener/staple generator (R1–R6) + takeoff row.** Post-process each routed cable path: mark through-hole spans supported (334.30(A)); on free spans emit `cable-staple` points every ≤ 54 in AND ≤ 12 in (8 in for clampless single-gang plastic, the default box) from each box entry; segments flagged `fished` exempt; ≤ 54-in fixture whips allowed above accessible ceilings (334.30(B)). Takeoff: staple count line item + nail-plate count.
   *Pin:* 8×4 m fixture → zero free spans > 54 in without a staple; each box's nearest staple ≤ 8 in of cable length; a `fished: true` segment emits 0 staples; takeoff includes a `staples` row whose count matches the emitted objects.
8. **Buildable door detour + geometric opening checks (B5, m3).** Compute header extent from the framing rules (RO width → header depth) and route the over-door crossing through the cripple bay above the header (or a bored hole through it, plated); risers offset one bay past the king stud. Replace `kind === 'door'` filters with RO-extent-vs-run-height overlap so low-sill windows detour too.
   *Pin:* 36-in door → crossing leg y strictly above header top (2.3222 m in repro) and below top plate; riser×trimmer AABB overlap = 0; 2.4 m window @ sill 0.3 m → 0 legs through the RO interior (current repro shows 3).

### Phase 2 — real circuit topology (fixes M2, M3, M4, M6; implements R21–R27, R34–R37, R40)

9. **Conductor-count plumbing (prerequisite).** `emitWire(gauge, conductors)`; labels `NM-B ${gauge}/${conductors} w/G`; takeoff regex → `/(\d+)\/(\d+)/` with separate 14/2 vs 14/3 rows.
   *Pin:* takeoff round-trips a 14/3 member; BOM shows distinct 14/2 and 14/3 line items.
10. **Switch legs + 3-way travelers (404.2(B)/(C)).** Link each switch to its controlled light in meta (`controls: lightId`); route power panel→switch box then 14/2 switch→light (neutral inherently at switch, hot-only interruption as graph invariant); 3-way pairs get a 14/3 traveler run between the two boxes (stairs ≥ 6 risers mandatory per R32; 2-entry rooms per R37); never emit a 2-wire loop.
    *Pin:* every light has an inbound member from its switch box; every switch meta carries `controls`; every threeWay pair has a `/3` member joining the two switch positions; assert no circuit contains a switch with no path segment to its light.
11. **Smoke-alarm interconnect chain (R21–R26).** All alarms (+ garage heat alarm when edition-gated, + hallway combo CO upgrade) form ONE group on ONE circuit: 14/2 homerun to nearest alarm (tap the bedroom-area lighting circuit unswitched, or dedicated via toggle), then a 14/3 nearest-neighbor chain visiting every alarm through ceiling paths. Validate counts ≤ 12 smoke / ≤ 18 total; consume `interconnectedRequired` from electrical-rules.json.
    *Pin:* 3-bed repro plan → all alarms share one circuit id; a connected chain of `/3` members visits every alarm (graph path check); alarm count validations fire on a 13-alarm synthetic plan; MA/ME/VT plans emit `type=photoelectric` attributes.
12. **Ceiling-joist-aware crossings + height sanity (M6).** routeWiring gains ceiling framing (or joist direction + spacing); crossings run along bays / through bored joist holes perpendicular to joists; crossing height = min(wall.height, ceiling structure plane), never above the top plate; attic top-crossing emits guard strips per R17.
    *Pin:* fixture with ceilingHeight 2.7 / wall 2.5 → no member y > wall top plate plane; crossing direction parallels joist bays; attic-crossing plan emits guard-strip members within 6 ft of scuttle.

### Phase 3 — data + jurisdiction layer (implements §2.4–2.5)

13. **Member meta + flat-NM profile (m4).** Add optional `meta` to Member; wires carry `{gauge, conductors, profile: {w: 0.45, h: 0.17}, wideFaceNormal}` while render dims stay oversized. Staple generator validates wide-face-against-framing (R4) and 300.4(D) half-width setbacks per face.
    *Pin:* every wire member exposes real profile in meta; a synthetic edge-on staple placement fails validation.
14. **`cableSupport` section in electrical-rules.json.** Encode R1–R18 (intervals 54/12/8 in, 1.25-in edge, plate spec, R602.6 caps, 334.80 cap 2, bend radius 5×d, 334.15/334.23 basement/attic rules) with citations — single source for engine + validators, unforked across all 51 jurisdictions.
    *Pin:* engine constants (54 in, 12 in, 1.25 in…) read from the JSON, not literals; schema test validates the section.
15. **Jurisdiction overlays for breakers/devices.** Per-state amendment overlay files with `asOf` + `verify` flags: AFCI scope (IN=none, ID/TN=bedrooms, UT=none, MA=all, OR/SC/WI/NC/AR/MT/AL exclusions, VA GFCI-substitution), GFCI scope (ID/UT/OR/SC/WI/NC/VT/WA trims, `outdoorOutletGfci` boolean OFF for GA/TX/CT/LA/ME/SD/UT/OR/WV/ID, 250 V GFCI OFF for IA/SD/SC/UT/ID/KY), KY sunset dates, smoke type=photoelectric (ME kitchen/bath, VT all, MA kitchen/bath), WI SPS 321.09 rule ids, MI high-priority verify flag, `mustVerifyLocally` for AK/AZ/IL/KS/MO/MS/NV + city packages (chicagoMetro conduit + all-AFCI, anchorage breaker-only AFCI, nyc).
    *Pin:* snapshot tests per state: identical plan → IN emits 0 AFCI breakers; ID/TN AFCI on bedroom circuits only; MA every 120 V breaker AFCI + island receptacle present; VA kitchen = GFCI-only (not dual-function); IA dryer receptacle = plain 2-pole; freshness test fails if any overlay's `asOf` predates the flagged-states list without `verify: done`.
16. **Idaho crawl-space routing exception (only state-level routing delta).** `jurisdiction === 'ID' && crawlHeight ≤ 4.5 ft` → allow NM across joist bottoms (skip drilling/running-board requirement); everywhere else standard 334.15(C).
    *Pin:* same crawl-space plan routes under-joist in ID, through-bored-holes in the default profile.

### Sequencing note

Phase 0 is a hard gate: nothing in Phases 1–2 is testable while circuits silently disconnect. Item 1 (the reachability harness) should be landed and RED against today's engine before any fix merges, so each fix flips a known-failing assertion.

---

*Round 12 — generated 2026-08-14. Sources: 2023 NEC (Articles 300, 314, 334, 404, 210, 240), IRC 2021 R314/R315/R602.6, NFPA 72 (2019/2022), NAHB State NEC Adoptions (Jan 2023), state primary sources (IDAPA 24.39.10.600, KY DHBC 2024-10-07, 25 M.R.S. §2464, 9 V.S.A. §2882, 527 CMR 12). All flaw citations refer to `src/engines/electrical.ts` @ current master.*
