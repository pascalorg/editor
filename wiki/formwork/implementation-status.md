# Formwork implementation status

What's left to ship, organized by plan phase. Measured against the master plan at
`~/.claude/plans/currently-see-the-formwork-cozy-sky.md`.

## Completion at a glance

**~45% of line items, but the engine is far ahead of the product surface** — see the caveats below, which matter more than the number.

| Phase | Complete | State |
|---|---|---|
| **P0** Honest baseline | 100% | The reported one-sided bug is fixed at its root |
| **P1** Coverage engine | 88% | Only gap: solver phases exist as modules, not wired into one pipeline |
| **P2** Catalog + real layout | 50% | Packing/stacking/tie-grids done; `gangs.ts`, parts model, part inspector not started |
| **P3** Structural design | 89% | Wall chain closed and the design report renders it; rated-pressure wiring remains |
| **P4** Quantities, BOM, exports | 25% | Floorplan + schedule done; no BOM, no CSV, no project rollup |
| **P5** Cut optimisation | 0% | `layout/cut-optimiser.ts` does not exist |
| **P6** Sequencing + schedule | 25% | Lifts/segments/units exist; no striking times, no set counting |
| **P7** Validation, clashes, cost | 0% | No `validate/`, no `cost/` |
| **P8** AI + drawings | 0% | 5 chat tools against the plan's ~25; no MCP formwork tools |

Counting partials as half: **18 done, 7 partial, 17 not started → 48%**. The solver pipeline scores separately at **5 of 13 phases done, 4 partial → 58%**.

**Three reasons that count overstates progress.** Recorded because the percentage will otherwise be read as a schedule.

1. **The remaining phases are the expensive ones.** P5 (guillotine placer with SA over piece order) and P7 (invariant suite + clash passes) are each larger than several completed phases combined, and P8 is ~20 tools across two surfaces. Line-item counting treats "CSV export" and "cut optimisation" as one row each.
2. **No `solve.ts` exists.** Every engine piece is a standalone library the geometry builders call directly. The plan's central abstraction — `(scene, settings, catalog) → FormworkSolution` — has no implementation, and phase 12 is what most of P4/P7/P8 consume. A structural gap, not a line item.
3. **The parts model is unbuilt.** Deterministic marks, part picking and the part inspector (plan §5.3) block the parts table, the BOM, the cut sheet, and every "click a waler and read its utilisation" feature. One ❌ row carrying a lot of downstream weight.

**The fair characterisation: the engine is roughly two-thirds there, the product surface roughly a quarter.** Everything that *computes* — pressure, the beam core, both design chains, coverage, layout, measurement — is largely done and tested. Everything that *presents or exports* what is computed is mostly not: no BOM, no cut sheet, no validation report, no parts table, AI parity around 20%. The design report is the first of those to land, and it is the one that made the rest of the engine legible: the chain can now be read on screen rather than taken on faith.

## Plan phases (P0–P8)

| Phase | Item | Status | What remains |
|---|---|---|---|
| **P0** Honest baseline | Reference docs → `wiki/formwork/reference/` | ✅ Done | `design.md`, `products.md`, `coverage.md`, `README.md` committed |
| | `dist`/`src` divergence guard | ✅ Done | `tooling/check-dist-parity.mjs` + CI step; `packages/nodes` deliberately left out of `transpilePackages` in favour of the parity check |
| | `geometryKey` contract | ✅ Done | Dropped from `definition.ts:44` |
| | Guard the formwork button | ✅ Done | `host-controls.tsx:231` disables on `hasFormwork` |
| **P1** Coverage engine | Castable fields, `formwork-assembly` + `construction-joint` kinds, migration | ✅ Done | `schema/formwork.ts`, both node kinds, `use-scene.ts:1097` pass 4 |
| | Solver phases 0–7 as libraries | 🟡 Partial | Elements/junctions/faces/trim/openings/banding/pours all exist as modules; **not** wired into one pipeline — see solver table |
| | Measurement standards as strategies | ✅ Done | IS 1200, NRM2, HKSMM4, CESMM4, POMI (last two need clause text — open item 5) |
| | Faces + reasons in inspector | ✅ Done | `coverage-summary.tsx` via `parametrics.customPanel` |
| **P2** Catalog + real layout | Catalog schemas + seed | 🟡 Partial | Doka Framax (verified), PERI TRIO (secondary), column forms/clamps, sheet stock, plus `props-eurex` + `timber-h20` + APA Plyform (verified) via `catalog/falsework.ts`. **Missing:** `mivan-generic`, full `plyform-apa` grade set |
| | Corner-first packing, stacking, height compensation, tie grids on real holes | ✅ Done | `strip-pack`, `courses`, `stack`, `tie-grid`, `junction-fit` |
| | Column clamp schedule | ✅ Done | `clamp-schedule.ts` + `geometry-column.ts` consuming it (this session) |
| | Slab falsework off the design chain | ✅ Done | `geometry-slab.ts` consumes `falseworkDesign()`; bearers now drawn (were missing entirely), grid tightens with thickness, rim stations no longer culled by the half-open ray cast |
| | `layout/gangs.ts` | ❌ Not started | Gang grouping, pick weight, lifting points, crane-capacity split-and-re-layout |
| | Parts model + marks | ❌ Not started | `schema/formwork/parts.ts`, deterministic marks stable across recomputes |
| | Part picking + part inspector | ❌ Not started | Depends on the parts model |
| **P3** Structural design | Pressure engine | 🟡 Partial | ACI 347, DIN 18218, CIRIA 108, BS 5975 shortcut all land with validity gates and warnings. Coefficients unverified (open items 1, 2) |
| | Continuous-beam core | ✅ Done | `design/beam.ts` — 1/2/3-span coefficients, bending/shear/deflection, span count iterated not assumed. Reproduces APA Example 2 at 412 psf bending |
| | ACI §2.2.1 vertical loads | ✅ Done | `design/vertical-load.ts` — dead+live vs the 4.8/6.0 kPa floor, live floor 2.4/3.6 |
| | Falsework chain (deck→joist→bearer→prop) | ✅ Done | `design/falsework.ts` + `catalog/falsework.ts` (sheathing, H20/H16, Eurex prop tables looked up not interpolated) |
| | Wall member chain (sheathing/joist/waler/tie/bracing under lateral pressure) | ✅ Done | `design/wall.ts` solves the ordered chain (p → sheathing → studs → walers → ties → bracing), closing the walers and re-solving where the tie force exceeds the hardware rather than just adding ties. `geometry-wall.ts` consumes it: tie rows graded up the lift, walers on the tie rows because a tie has to bear on one. On a drilled panel system the design is what the factory grid is checked against, not what places it |
| | Rated-pressure path + inverse `v_max` solve | 🟡 Partial | `maxRiseRateMH()` exists for ACI + DIN; not wired to a panel rating check |
| | Calculated vs adopted spacing, utilisations | ✅ Done | `MemberDesign` carries both plus `governedBy`, `utilisation`, `cappedBy`, `stated` |
| | Design report | ✅ Done | `formwork-assembly/design-report.tsx` renders the whole chain per kind — adopted beside calculated, which check governed, utilisation graded amber past 85 % and red past 100 %, `cappedBy`, every warning, and a stated spacing that fails its own check saying so in as many words. Mounted in all three host panels and, scoped to its own pour unit, in the assembly inspector. `design.ts` grew `liftHeightM` and the column's `envelope`/`designPressureKnM2` so the report reads the same solve the builders place, rather than repeating it |
| | APA `n_studs < 3` point-load branch | ✅ Done | Bending only — `M/√factor` against uniform shear and deflection — so a shear-governed H20 waler is not cut for an effect it does not have. The warning names which governed, because at wall line loads the correction usually changes nothing and reporting a reduction that wasn't applied is worse than silence |
| **P4** Quantities, BOM, exports | Takeoff with banding | 🟡 Partial | `bandFace()` works per face; no project-level rollup |
| | BOM (owned/hired, weights, rental duration) | ❌ Not started | No `cost/` directory |
| | CSV export | ❌ Not started | Net new |
| | `floorplan` extension + `schedule()` | ✅ Done | `formwork-assembly/floorplan.ts` (shutter lines off each formed face, deck wash, hole edge forms) + `schedule.ts` (FORMWORK SCHEDULE, one row per pour unit, unformed faces with reasons). Both read `resolveFormworkScope`, so plan and 3D cannot disagree |
| | Parts table + BOM panels | ❌ Not started | |
| | `FormworkProjectSettings` schema + resolver | ✅ Done | `schema/nodes/formwork-project-settings.ts` is the schema home the chain was missing (pressure standard, measurement standard, `ConcreteMixSettings`, `PlacementSettings`, `FalseworkLoadSettings`, `BracingSettings`, `FormworkPartSettings`); `systems/formwork/settings.ts` resolves it once so a default cannot drift between the wall chain and the column schedule. Every group is asserted to *move* the answer in `design.test.ts` — a field the UI writes but no design function reads would be a control that appears to work. Registered as a hidden, geometry-less node kind (`nodes/src/formwork-project-settings/`), so it saves, undoes and is writable by the AI through the ordinary `updateNode` path. `stated` carries what the project actually said, and the chain never reads it |
| | `FormworkProjectSettings` panel | ❌ Not started | The node has no editor yet, so the settings are only reachable through the AI or a raw `updateNode`. Register via `registerEditorHostPanel` next to `treesHostPanel` in `apps/editor/lib/bootstrap.ts` (omit `pluginId` — no install gate). It must create the node on first write with `createNode(node, siteId)` inside `runAsSingleSceneHistoryStep`, and then `markDirty` every `formwork-assembly` in the scene: `dirty-scope.ts` is level-scoped, so without a scene-wide sweep the report and the 3D shutters disagree. Nested sub-objects rule out the auto-derived inspector — every addressable `ParamField` variant takes `key: keyof N` |
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
| 8 Pressure/design/layout | ✅ | Pressure ✅, clamp schedule ✅, panel layout ✅, drilled tie grid ✅, wall member chain ✅ — graded at the base, and `verticalElementKind` reads a wide "column" as a wall off the plan rather than off the node type. The design is now also readable: `design.ts` is the single solve, and the report prints it. Remaining: the rated-pressure path is not wired to a panel rating check |
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

Core: 1193 tests passing across 91 files (17 formwork files, 427 formwork tests). Nodes: 990 passing across 118 files, including 12 in `formwork-assembly/floorplan.test.ts` — among them the two sign checks that catch a shutter drawn inside its own pour or against the wrong face of a wall, both of which are invisible on a symmetric test wall. Repo: 3112 passing across 352 files.

`formwork-assembly/design.test.ts` covers the shared solve the report and the builders both read — 15 tests over the three pour designs. Two of them were written asserting the wrong thing and are worth recording, because both mistakes are the kind a reader of the report would also make. The run sets `tieSpacing.spans` (the waler's own continuity), not `waler.spans` (the stud's, which runs vertically over the lift height) — and a bay cut short allows a *wider* tie spacing, not a narrower one, because one span is stronger in shear than three and shear is what governs a waler at these loads. And the base clamp row is not the hardest worked: it shares its tributary band with the kicker, which is exactly why omitting the kicker fails a column form at its foot.

The wall chain's geometry tests pin the two things a constant cannot do: the grid tightens on its own with the lift height (a 2.4 m lift gets three rows at 300 mm centres, a 4 m lift six rows at 250 mm), and a drilled system's ties land on the factory grid with the walers following them rather than the solved spacing. Both were verified against the builder's actual output rather than asserted from the arithmetic.

**APA Example 2 now reproduces**: 412 psf bending against the published 412. Shear reads 647 psf and deflection 387 psf against the published 714 and 370 — APA deducts support width from the clear span where this solves on centre-to-centre, so the two bracket the published pair rather than matching it. Recorded here because the gap is a definition, not an error, and someone will otherwise "fix" it.

Still the gap: the DIN calculator probes, CIRIA's 53.86, the HKSMM4 opening cases, the ACI metric/imperial *must-disagree* test, and the property test *`sum(trimmed) === trueWrappedArea` over random wall networks*.

## Shortest path to the next visible win

**The `FormworkProjectSettings` panel** — the settings node exists and every design function reads it, but nothing in the UI writes it.

The engine half is done and tested: the hardcoded rise rate and temperature are gone, `formworkSettings()` resolves the project's pour once for both the wall chain and the column schedule, and `design.test.ts` asserts each settings group moves the answer. What is missing is the surface. The report prints `95.6 kN/m²`, names the standard and quotes the governing equation, and a user still has no way to see that the figure assumes 7 m/h at 20 °C or to say otherwise — the same objection as before, now one panel away from being answered rather than a schema away. A visible number the user cannot govern is worse than a hidden one: it invites trust it has not earned.

The panel's own obligations, in order of how quietly they fail: create the node on first write inside `runAsSingleSceneHistoryStep` and parent it to the site (an unparented node is swept as an orphan on load); `markDirty` every `formwork-assembly` after a write, since a design input lives outside the shutters it sizes and `dirty-scope.ts` only reaches one level; and keep the optional fields genuinely optional — `stated` is what lets the report tell an assumption from a decision, so writing a default into a field the user never touched destroys the distinction the schema was built to carry. `SpacingOverride`'s "Calculated — override / Stated — use calculated" toggle (`host-controls.tsx`) is the idiom for that, already in the codebase. One trap: `consistencyClassOf` returns `SCC` when `selfCompacting` is set, so exposing `concrete.consistencyClass: 'SCC'` *and* `concrete.selfCompacting` as independent controls is two controls for one fact.

After that the **parts model** (plan §5.3) is the one structural gap with the most downstream weight — it blocks the parts table, the BOM, the cut sheet, and "click a waler and read its own utilisation", which is the natural next step from a report that currently speaks per member type rather than per part.
