# Formwork implementation status

What's left to ship, organized by plan phase.

## Plan phases (P0–P8)

| Phase | Item | Status | What remains |
|---|---|---|---|
| **P0** Honest baseline | Reference docs → `wiki/formwork/reference/` | ✅ Done | `design.md`, `products.md`, `coverage.md`, `README.md` committed |
| | `dist`/`src` divergence guard | ✅ Done | `tooling/check-dist-parity.mjs` + CI step; `packages/nodes` deliberately left out of `transpilePackages` in favour of the parity check |
| | `geometryKey` contract | ✅ Done | Dropped from `definition.ts:44` |
| | Guard the formwork button | ✅ Done | `host-controls.tsx:238` disables on `hasFormwork` |
| **P1** Coverage engine | Castable fields, `formwork-assembly` + `construction-joint` kinds, migration | ✅ Done | `schema/formwork.ts`, both node kinds, `use-scene.ts:1097` pass 4 |
| | Solver phases 0–7 as libraries | 🟡 Partial | Elements/junctions/faces/trim/openings/banding/pours all exist as modules; **not** wired into one pipeline — see solver table |
| | Measurement standards as strategies | ✅ Done | IS 1200, NRM2, HKSMM4, CESMM4, POMI (last two need clause text — open item 5) |
| | Faces + reasons in inspector | ✅ Done | `coverage-summary.tsx` via `parametrics.customPanel` |
| **P2** Catalog + real layout | Catalog schemas + seed | 🟡 Partial | Doka Framax (verified), PERI TRIO (secondary), column forms/clamps, sheet stock. **Missing:** `props-eurex`, `timber-h20`, `mivan-generic`, `plyform-apa` |
| | Corner-first packing, stacking, height compensation, tie grids on real holes | ✅ Done | `strip-pack`, `courses`, `stack`, `tie-grid`, `junction-fit` |
| | Column clamp schedule | ✅ Done | `clamp-schedule.ts` + `geometry-column.ts` consuming it (this session) |
| | **Slab spacings still invented** | ❌ Not started | `geometry-slab.ts:118,137` — `walerSpacing ?? 0.4`, `tieSpacing ?? 1.2`, even bbox division. Last builder on made-up numbers |
| | `layout/gangs.ts` | ❌ Not started | Gang grouping, pick weight, lifting points, crane-capacity split-and-re-layout |
| | Parts model + marks | ❌ Not started | `schema/formwork/parts.ts`, deterministic marks stable across recomputes |
| | Part picking + part inspector | ❌ Not started | Depends on the parts model |
| **P3** Structural design | Pressure engine | 🟡 Partial | ACI 347, DIN 18218, CIRIA 108, BS 5975 shortcut all land with validity gates and warnings. Coefficients unverified (open items 1, 2) |
| | Continuous-beam core; sheathing/joist/waler/tie/bracing chain | ❌ Not started | No `design/` directory. Only the clamp check exists |
| | Rated-pressure path + inverse `v_max` solve | 🟡 Partial | `maxRiseRateMH()` exists for ACI + DIN; not wired to a panel rating check |
| | Calculated vs adopted spacing, utilisations, design report | ❌ Not started | |
| | APA `n_studs < 3` point-load branch | ❌ Not started | |
| **P4** Quantities, BOM, exports | Takeoff with banding | 🟡 Partial | `bandFace()` works per face; no project-level rollup |
| | BOM (owned/hired, weights, rental duration) | ❌ Not started | No `cost/` directory |
| | CSV export | ❌ Not started | Net new |
| | `floorplan` extension + `schedule()` | ❌ Not started | **Formwork is invisible in plan view and in the PDF pipeline** |
| | Parts table + BOM panels | ❌ Not started | |
| | `FormworkProjectSettings` dialog | ❌ Not started | Blocks the rise-rate/temperature constants currently hardcoded in `geometry-column.ts:81,84` |
| **P5** Cut optimisation | Guillotine placer, SA, kerf/grain/trim, offcut policy, set-covering, cut-sheet view | ❌ Not started | `SAW_KERF_MM` and `SHEET_STOCK` are seeded; `layout/cut-optimiser.ts` doesn't exist |
| **P6** Sequencing + schedule | Lifts + zones fully driven | 🟡 Partial | `pours/lifts.ts`, `segments.ts`, `units.ts`, `joints.ts` exist; joint-elevation snapping has no schema home |
| | Degree-day / maturity strike times | ❌ Not started | |
| | Set counting by interval overlap, shortage detection | ❌ Not started | The Tipos feature |
| | Pour/lift schedule view, volume per pour | 🟡 Partial | `inspect_pour_units` reports volume; no schedule view |
| **P7** Validation, clashes, cost | Invariant suite + clash passes | ❌ Not started | No `validate/` directory |
| | Labour norms, rental, amortisation, cost-per-use | ❌ Not started | |
| | Gang pick weights + crane checks | ❌ Not started | Blocked on `gangs.ts` |
| **P8** AI + drawings | Full tool set both surfaces | ❌ Not started | Chat has **5** formwork tools (`list_castable_elements`, `set_element_construction`, `attach_formwork`, `set_pour_limits`, `inspect_pour_units`) against the plan's ~25. `packages/mcp/src/tools/formwork/` **doesn't exist** |
| | Chat mutations bypass undo | ❌ Not fixed | Must route through `runAsSingleSceneHistoryStep` |
| | Verify/fix, sequence-opt, value-engineering loops | ❌ Not started | |
| | Shop drawings, RFI generator | ❌ Not started | |

## Solver pipeline (§6 — `solve.ts` does not exist)

| Phase | Status | Remaining |
|---|---|---|
| 0 Normalise | 🟡 | Logic in `coverage/elements.ts`; no reject-degenerate gate |
| 1 Topology | 🟡 | `findJunctions`/`findAbutments` classify pairs; **no acyclic assertion on the cast-order graph**, no `CUSTOM_CORNER_REQUIRED` flag |
| 2 Lifts | 🟡 | `pours/lifts.ts` splits; no permitted-joint-elevation snapping (`permittedJointElevations`/`jointSnapTolerance` have no schema home) |
| 3 Zones + pour units | 🟡 | Hard/soft cuts and topological numbering done; no alternate-bay parity, no batch-plant/pump-rate check |
| 4 Face classification | ✅ | Walls/columns/slabs done, cast-order-aware. Beams not modelled; single-sided cross-lift anchor deferred |
| 5 Trim | ✅ | `coverage/trim.ts` + corner ownership + `trim.test.ts` |
| 6 Openings | ✅ | Deductions, thresholds, reveals (3-side door), audit trail. Box-out node not emitted |
| 7 Banding | ✅ | `measurement/banding.ts` |
| 8 Pressure/design/layout | 🟡 | Pressure ✅, clamp schedule ✅, panel layout ✅, tie grid ✅ (takes a scalar, not an envelope — needs graded-at-base). Member design chain ❌ |
| 9 Clashes | ❌ | Ties×rebar, ties×openings, ties×waterstops, panels×intersections, props×slab-below, scaffold×boundary |
| 10 Schedule | ❌ | Commit windows, max-clique set counting, separate panel/prop inventories |
| 11 Validate | ❌ | The 20-line assertion suite — the highest-value output |
| 12 Emit `FormworkSolution` | ❌ | No solution type; consumers read the scene graph directly |

## Open items (§12) — none closed

| # | Item | Status |
|---|---|---|
| 1 | DIN 18218:2010-01 tE table | Reverse-engineered; needs the standard bought |
| 2 | CIRIA R108 `C1`/`C2` (~£50) | Weakest number; `ciria-108.ts:73` warns on every result |
| 3 | Metric film-faced ply design values | Not hardcoded — still absent |
| 4 | EN 13670 §5.5 | Not covered |
| 5 | CESMM Class G / POMI clause text | Standards registered, clause text missing |
| 6 | H20 permissible-vs-design conflict | Unresolved; `timber-h20.ts` unseeded |
| 7 | PERI SRS/QUATTRO/SKYDECK/MULTIFLEX, Doka Frami | Unseeded |
| 8 | 250 kN/m² DIN ceiling provenance | Unverified |
| 9 | `topFormAngleThreshold` | Shipped configurable, default 10°, no citation |

**Plus, not in the plan but now real:** the column clamp capacities driving this session's spacings are derived from geometry, not a stamped manufacturer's table (`verification: 'unverified'`) — that's the same class of risk as items 1–2 and should join the list.

## Verification (§11) status

19 test files, 413 formwork tests passing. The golden-file scene tests are the gap — the plan's headline case (*single freestanding wall → 4 formed faces*) is covered in `geometry.test.ts`, but the worked-example suites (APA Example 2, the DIN calculator probes, CIRIA's 53.86, the HKSMM4 opening cases) exist only in `pressure.test.ts` partially; the ACI metric/imperial *must-disagree* test and the property test *`sum(trimmed) === trueWrappedArea` over random wall networks* are not written.

## Shortest path to the next visible win

**`geometry-slab.ts` off invented spacings** (the only builder still guessing), then the **`floorplan` extension + `schedule()`** — that one is cheap and makes formwork appear in plan view and in the existing PDF export with no editor changes.
