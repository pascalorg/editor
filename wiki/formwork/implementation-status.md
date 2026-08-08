# Formwork implementation status

What's left to ship, organized by plan phase. Measured against the master plan at
`~/.claude/plans/currently-see-the-formwork-cozy-sky.md`.

## Completion at a glance

**~64% of line items, and the product surface has closed most of its gap on the engine** — see the caveats below, which matter more than the number.

| Phase | Complete | State |
|---|---|---|
| **P0** Honest baseline | 100% | The reported one-sided bug is fixed at its root |
| **P1** Coverage engine | 88% | Only gap: solver phases exist as modules, not wired into one pipeline |
| **P2** Catalog + real layout | 79% | Packing/stacking/tie-grids, parts model and part inspector done; `gangs.ts` remains |
| **P3** Structural design | 89% | Wall chain closed and the design report renders it; rated-pressure wiring remains |
| **P4** Quantities, BOM, exports | 71% | Parts table + BOM panels done off the parts model; no CSV, no project rollup, no rental/owned split |
| **P5** Cut optimisation | 0% | `layout/cut-optimiser.ts` does not exist |
| **P6** Sequencing + schedule | 25% | Lifts/segments/units exist; no striking times, no set counting |
| **P7** Validation, clashes, cost | 0% | No `validate/`, no `cost/` |
| **P8** AI + drawings | 13% | 9 chat tools against the plan's ~25; no MCP formwork tools |

Counting partials as half: **23 done, 9 partial, 11 not started → 64%**. The solver pipeline scores separately at **5 of 13 phases done, 5 partial → 63%**.

**Three reasons that count overstates progress.** Recorded because the percentage will otherwise be read as a schedule.

1. **The remaining phases are the expensive ones.** P5 (guillotine placer with SA over piece order) and P7 (invariant suite + clash passes) are each larger than several completed phases combined, and P8 is ~16 further tools across two surfaces. Line-item counting treats "CSV export" and "cut optimisation" as one row each.
2. **The `solve.ts` that exists is not the plan's.** `nodes/src/formwork-assembly/solve.ts` solves one *host* — every shutter on a wall, with its parts — and it is what the panel and the chat tool share. The plan's central abstraction is wider: `(scene, settings, catalog) → FormworkSolution` across the project, which phase 12 emits and most of P4/P7/P8 consume. The per-host solve is the honest half of it: it fixed the divergence hazard between the screen and the AI, and it did not produce a project-level solution type. Anything that needs a figure across a floor — a rollup, a set count, a crane schedule — still has nothing to ask.
3. **Nothing is validated.** P7 is still 0%, so a shutter can bill cleanly and still clash — ties through rebar, props onto a slab that cannot carry them, panels through an intersection. The parts model made the bill possible; it did not make it safe, and the parts table saying "1 part beyond capacity" is a per-member check, not the 20-line invariant suite. Reconciliation has now closed the one *coverage* invariant that mattered most — an element formed for fewer pours than it is cast in — but it closed it by reporting, at two call sites, rather than as an assertion the whole scene is swept for. A second element with the same fault and no tool call against it still says nothing.

**The fair characterisation: the engine is roughly two-thirds there, the product surface now a little over half.** Everything that *computes* — pressure, the beam core, both design chains, coverage, layout, measurement, and now the parts — is largely done and tested. What is still missing on the presenting side is export and audit rather than legibility: no CSV, no cut sheet, no validation report, no project rollup. Four things have now landed and they compound: the design report made the engine legible, the settings panel made it governable, the parts model made it *addressable* — the walers the report describes at 300 mm centres are nine objects with marks, each of which can be clicked, priced, substituted or left off the order — and reconciliation made it *durable*, so editing the pour after shuttering neither loses those decisions nor quietly leaves two-thirds of the element unbilled. That is the difference between a calculation someone reads and a shutter someone orders.

## Plan phases (P0–P8)

| Phase | Item | Status | What remains |
|---|---|---|---|
| **P0** Honest baseline | Reference docs → `wiki/formwork/reference/` | ✅ Done | `design.md`, `products.md`, `coverage.md`, `README.md` committed |
| | `dist`/`src` divergence guard | ✅ Done | `tooling/check-dist-parity.mjs` + CI step; `packages/nodes` deliberately left out of `transpilePackages` in favour of the parity check |
| | `geometryKey` contract | ✅ Done | Dropped from `definition.ts:44` |
| | Guard the formwork button | ✅ Done | Superseded by reconciliation, which is the better answer to the same problem. `host-controls.tsx` now disables the button only when the shutters already match the pour, and both surfaces route through `reconcileFormworkNodes` — see "What landed" below. The plain `hasFormwork` guard was correct against a double-click and wrong against a lift cap: it disabled the button at the exact moment the element needed it |
| **P1** Coverage engine | Castable fields, `formwork-assembly` + `construction-joint` kinds, migration | ✅ Done | `schema/formwork.ts`, both node kinds, `use-scene.ts:1097` pass 4 |
| | Solver phases 0–7 as libraries | 🟡 Partial | Elements/junctions/faces/trim/openings/banding/pours all exist as modules; **not** wired into one pipeline — see solver table |
| | Measurement standards as strategies | ✅ Done | IS 1200, NRM2, HKSMM4, CESMM4, POMI (last two need clause text — open item 5) |
| | Faces + reasons in inspector | ✅ Done | `coverage-summary.tsx` via `parametrics.customPanel` |
| **P2** Catalog + real layout | Catalog schemas + seed | 🟡 Partial | Doka Framax (verified), PERI TRIO (secondary), column forms/clamps, sheet stock, plus `props-eurex` + `timber-h20` + APA Plyform (verified) via `catalog/falsework.ts`. **Missing:** `mivan-generic`, full `plyform-apa` grade set |
| | Corner-first packing, stacking, height compensation, tie grids on real holes | ✅ Done | `strip-pack`, `courses`, `stack`, `tie-grid`, `junction-fit` |
| | Column clamp schedule | ✅ Done | `clamp-schedule.ts` + `geometry-column.ts` consuming it (this session) |
| | Slab falsework off the design chain | ✅ Done | `geometry-slab.ts` consumes `falseworkDesign()`; bearers now drawn (were missing entirely), grid tightens with thickness, rim stations no longer culled by the half-open ray cast |
| | `layout/gangs.ts` | ❌ Not started | Gang grouping, pick weight, lifting points, crane-capacity split-and-re-layout |
| | Parts model + marks | ✅ Done | `systems/formwork/parts.ts` — all 12 part kinds, `partMark()` deterministic from kind + locus (`P-A-1-01250`, 5-digit padded, `N` for negatives, angles in tenths), `applyPartOverrides`, `bomLines`/`bomWeightKg`, `worstUtilisation`, `overUtilisedParts`. Emitted through one enumeration: `nodes/src/formwork-assembly/parts.ts`'s `collectParts` takes the spec *and* the mesh, so the bill and the 3D shutter come out of one pass and cannot count differently. `tag()` exists because one part is not always one box — a panel crossed by a window is two bands carrying one mark |
| | Part picking + part inspector | ✅ Done | `scene-action.ts` resolves `mesh.userData.formworkPartMark` and `activate` deliberately returns `false`, so clicking a waler picks the waler *and* keeps the shutter selected (a `true` return consumed the click and lost the gizmo, the delete and the inspector). Selection lives in a node-local store keyed by assembly id (`selected-part.ts`), not in `useViewer` — a part is a derived row, not a node. `part-inspector.tsx` renders the part's own figures per kind and offers the only two edits a yard makes: substitute a catalog item, or leave it off the order because it is already on site. A mark that stops resolving clears itself; edits that no longer name a part are reported as stale rather than dropped |
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
| | BOM (owned/hired, weights, rental duration) | 🟡 Partial | `bomLines()` groups on catalog id **and** provenance, because a drilled panel and an untouched one of the same type are two different things to a yard — one goes back on the rack, one follows this job. Weights total per line, and a line containing one part with no stated weight reports *no* total rather than a partial one, so the panel can say "incomplete" instead of quoting a figure that is quietly short. **Missing:** owned/hired split, rental duration, any cost — no `cost/` directory |
| | CSV export | ❌ Not started | Net new |
| | `floorplan` extension + `schedule()` | ✅ Done | `formwork-assembly/floorplan.ts` (shutter lines off each formed face, deck wash, hole edge forms) + `schedule.ts` (FORMWORK SCHEDULE, one row per pour unit, unformed faces with reasons). Both read `resolveFormworkScope`, so plan and 3D cannot disagree |
| | Parts table + BOM panels | ✅ Done | `parts-summary.tsx` — `FormworkPartsList` groups by face in the order a crew erects them, with a "Through and under" group for the parts that belong to no single face (ties, props, box-outs), and `FormworkBom` bills across every shutter on the element because the same panel type on two lifts is one thing to order. Both mounted in all three host panels and, scoped to their own pour unit, in the assembly inspector. Utilisation is graded by the same `report-ui.tsx` primitives the design report uses, so one number cannot read amber in one panel and plain in the other. Duplicate marks are surfaced rather than swallowed: a collision means two parts share one handle, which would silently merge two BOM lines |
| | `FormworkProjectSettings` schema + resolver | ✅ Done | `schema/nodes/formwork-project-settings.ts` is the schema home the chain was missing (pressure standard, measurement standard, `ConcreteMixSettings`, `PlacementSettings`, `FalseworkLoadSettings`, `BracingSettings`, `FormworkPartSettings`); `systems/formwork/settings.ts` resolves it once so a default cannot drift between the wall chain and the column schedule. Every group is asserted to *move* the answer in `design.test.ts` — a field the UI writes but no design function reads would be a control that appears to work. Registered as a hidden, geometry-less node kind (`nodes/src/formwork-project-settings/`), so it saves, undoes and is writable by the AI through the ordinary `updateNode` path. `stated` carries what the project actually said, and the chain never reads it |
| | `FormworkProjectSettings` panel | ✅ Done | `nodes/src/formwork-project-settings/panel.tsx` + `host-panel.ts`, registered beside `treesHostPanel` in `apps/editor/lib/bootstrap.ts` with no `pluginId`. A host panel rather than an inspector because the node is `hidden`/unselectable and the pour has to be reachable before the first shutter exists. Every control is tri-state (`settings-fields.tsx`) and names the default it would fall back to, so leaving a field alone is a visible choice rather than an empty box. SCC is folded into the consistency select, since `consistencyClassOf` reads `selfCompacting` and two controls for one fact is how it gets answered wrong. The three quiet failure modes — site parenting against the orphan sweep, a scene-wide `markDirty` because `dirty-scope.ts` reaches one level and `formwork-settings` is `dirtyTracking: false` besides, and unset staying unset — are all covered by `use-formwork-settings.test.ts` (16 tests, three of them mutation-verified) |
| **P5** Cut optimisation | Guillotine placer, SA, kerf/grain/trim, offcut policy, set-covering, cut-sheet view | ❌ Not started | `SAW_KERF_MM` and `SHEET_STOCK` are seeded; `layout/cut-optimiser.ts` doesn't exist |
| **P6** Sequencing + schedule | Lifts + zones fully driven | 🟡 Partial | `pours/lifts.ts`, `segments.ts`, `units.ts`, `joints.ts` exist; joint-elevation snapping has no schema home |
| | Degree-day / maturity strike times | ❌ Not started | |
| | Set counting by interval overlap, shortage detection | ❌ Not started | The Tipos feature |
| | Pour/lift schedule view, volume per pour | 🟡 Partial | `inspect_pour_units` reports volume; no schedule view |
| **P7** Validation, clashes, cost | Invariant suite + clash passes | ❌ Not started | No `validate/` directory |
| | Labour norms, rental, amortisation, cost-per-use | ❌ Not started | |
| | Gang pick weights + crane checks | ❌ Not started | Blocked on `gangs.ts` |
| **P8** AI + drawings | Full tool set both surfaces | 🟡 Partial | Chat has **9** formwork tools (`list_castable_elements`, `set_element_construction`, `attach_formwork`, `set_pour_limits`, `inspect_pour_units`, `set_formwork_settings`, `inspect_formwork_settings`, `inspect_formwork_parts`, `set_formwork_part`) against the plan's ~25. The parts pair runs the *same* `solveShuttersForHost` the panel does, which is the whole reason it exists as a shared module — a second server-side enumeration is how the AI comes to quote a panel count the user's own screen does not show. `inspect_formwork_parts` reports the hardest-worked part and anything beyond capacity, because a bill for a shutter that does not stand up is not an order to place, and its `kind` filter trims only the itemised list: `partCount` and `bom` stay whole, or the model quotes 12 parts for a whole wall. `set_formwork_part` resolves the mark against the live solve and refuses one it does not produce, rather than writing a stale edit nobody asked for. `attach_formwork` reconciles rather than appends and is safe to call after any edit, `set_pour_limits` says when its split has left the element short of shutters, and `inspect_formwork_parts` carries `coverageCaveat` — see "What landed" below, and `chat-ai-formwork-reattach.test.ts` (15 tests, four mutation-verified). `packages/mcp/src/tools/formwork/` **doesn't exist**. The settings pair closed the parity gap the panel would otherwise have opened: both write paths share core's `mergeFormworkSettingsGroup`/`mergeFormworkCement` rather than each having its own idea of "unstated", `null` from the model means unstate where an absent key means leave alone, part ids are checked against the catalog because a bad id falls back to a default silently, and `inspect_formwork_settings` reports resolved *and* stated so the model can say which figures the job agreed to. Covered by `apps/editor/lib/chat-ai-formwork-settings.test.ts` (26 tests, five mutation-verified) |
| | Chat mutations bypass undo | ❌ Not fixed | Must route through `runAsSingleSceneHistoryStep` |
| | Verify/fix, sequence-opt, value-engineering loops | ❌ Not started | |
| | Shop drawings, RFI generator | ❌ Not started | |

## Solver pipeline (§6 — the project-wide `solve()` does not exist)

`nodes/src/formwork-assembly/solve.ts` now exists, but it is not this. It solves one host into its shutters and their parts, which is what a panel and a chat tool need; the pipeline below is the project-wide pass that phases 9–12 belong to. The distinction is worth keeping in mind when reading phase 12: consumers no longer read the scene graph *twice* for the same shutter, but there is still no `FormworkSolution`.

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
| 12 Emit `FormworkSolution` | 🟡 | No project-level solution type. Per host there is now `SolvedShutter[]` from `solve.ts`, shared by the panels and the chat tools, which closes the "two enumerations of one shutter" hazard at the element scale. Remaining: the project scope, and a serialisable form an export could read |

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

Core: 1235 tests passing across 92 files (18 formwork files, 469 formwork tests). Nodes: 1060 passing across 121 files, including 12 in `formwork-assembly/floorplan.test.ts` — among them the two sign checks that catch a shutter drawn inside its own pour or against the wrong face of a wall, both of which are invisible on a symmetric test wall. Repo: 3281 passing across 359 files.

The two settings suites are worth reading together, because they test the same three failure modes on two different write paths. `nodes/src/formwork-project-settings/use-formwork-settings.test.ts` (16) covers the store path, `apps/editor/lib/chat-ai-formwork-settings.test.ts` (26) the plain-graph path the chat tools use on the server. Everything they assert fails *silently* if it regresses: an unparented node that survives the session and vanishes on reload, a level-scoped dirty sweep that leaves a report and a 3D shutter disagreeing, a group patch that drops a stated sibling, a binder patch that leaves `cement: {}` behind as a claim the project never made, a hallucinated part id that falls back to a default. None of them produce an error anyone could notice, so eight of the assertions were mutation-tested — the sweep, the parenting, the delete-on-`undefined`, the SCC clear and the catalog check were each broken deliberately and each produced a failure.

`formwork-assembly/design.test.ts` covers the shared solve the report and the builders both read — 15 tests over the three pour designs. Two of them were written asserting the wrong thing and are worth recording, because both mistakes are the kind a reader of the report would also make. The run sets `tieSpacing.spans` (the waler's own continuity), not `waler.spans` (the stud's, which runs vertically over the lift height) — and a bay cut short allows a *wider* tie spacing, not a narrower one, because one span is stronger in shear than three and shear is what governs a waler at these loads. And the base clamp row is not the hardest worked: it shares its tributary band with the kicker, which is exactly why omitting the kicker fails a column form at its foot.

The parts model is covered on three levels, and the split is deliberate because each level fails differently. `core/systems/formwork/parts.test.ts` (42) is the marks-and-bill layer: a mark is asserted to be a *function of position*, so re-solving the same shutter reproduces it and moving a panel 50 mm changes it; negatives, angles and courses are all pinned, because a mark that collides is two parts sharing one handle and that silently merges two BOM lines. `nodes/src/formwork-assembly/parts.test.ts` (28) is the emission layer: every mesh that draws a part carries its mark, `tag()` puts one mark on both bands of a window-crossed panel so the BOM counts it once, and an omitted part keeps its mesh — the geometry is what the crew is looking at, and a panel that vanishes when somebody ticks "omit" reads as a bug rather than as their own edit. `solve.test.ts` (7) is the layer above both: finding a host's assemblies, ordering them by pour rather than by node-map iteration, and carrying an override through. The ordering test inserts the upper lift first, which is the state a scene reaches after an undo — an unordered list has the panel labelling lift 2 as the base lift, and nothing about that looks wrong on screen. `chat-ai-formwork-parts.test.ts` (16) then asserts the same marks come back on two reads, that `line.quantity === line.marks.length`, and that the `kind` filter does not shrink the count.

The wall chain's geometry tests pin the two things a constant cannot do: the grid tightens on its own with the lift height (a 2.4 m lift gets three rows at 300 mm centres, a 4 m lift six rows at 250 mm), and a drilled system's ties land on the factory grid with the walers following them rather than the solved spacing. Both were verified against the builder's actual output rather than asserted from the arithmetic.

**APA Example 2 now reproduces**: 412 psf bending against the published 412. Shear reads 647 psf and deflection 387 psf against the published 714 and 370 — APA deducts support width from the clear span where this solves on centre-to-centre, so the two bracket the published pair rather than matching it. Recorded here because the gap is a definition, not an error, and someone will otherwise "fix" it.

Still the gap: the DIN calculator probes, CIRIA's 53.86, the HKSMM4 opening cases, the ACI metric/imperial *must-disagree* test, and the property test *`sum(trimmed) === trueWrappedArea` over random wall networks*.

## What landed: shutters reconcile against the pour

This was queued as "re-solve the stale assemblies after a settings change", and the investigation found that premise half wrong and two real bugs behind it. Both were invisible on screen, both produced perfectly reasonable-looking numbers, and both were reachable by following the application's own instructions.

**A settings change needed no re-solve at all.** Verified empirically before anything was written: change the rate of rise and the worst utilisation on a slab moves from 0.972 to 0.471 on the next read. The parts and the design report both solve *from* the settings each time they are asked, so the new pour is already in every figure. What the code actually did was worse than nothing — `set_formwork_settings` told the model to call `attach_formwork` again, which was unnecessary *and*, once shutters carried per-part decisions, destructive. That instruction is gone; the reply now says what the change reached and that there is nothing to regenerate.

**The real gap was `set_pour_limits`, which changes how many shutters an element needs.** A 9 m wall shuttered as one pour and then capped at 3 m lifts is cast in three and formed for one. Measured on a probe: 3 pour units, 1 assembly, 138 parts' worth of formwork billed as 50. Nothing on screen said so, and the panel's button — guarded on `hasFormwork` since P0 — was *disabled* at exactly that moment.

**And the chat tool appended.** `attach_formwork` called twice took a wall from 1 assembly to 2, `partCount` 50 → 100, weight 2530 → 4945 kg, 50 duplicate marks, and an omitted part appearing twice with `[true, false]` — a part somebody had marked "already on site" quietly re-ordered on the copy. The editor button had been guarded against this for months; the tool never was, and `set_formwork_settings` was instructing the model to do it.

`reconcileFormworkNodes` (`nodes/src/formwork-assembly/attach.ts`) is the shared answer, and both surfaces route through it. A pour unit's identity is `segmentIndex:liftIndex`, not the node id, and the three outcomes are asymmetrical on purpose:

- **keep** — the pour unit still exists, so the node does too, id and `partOverrides` untouched. This is the whole reason it reconciles rather than rebuilding: a shutter is where a person keeps decisions, and a new node is an erased set of them.
- **create** — genuinely new pour units only.
- **orphan** — returned rather than deleted, because deleting them deletes recorded work. `attach_formwork` counts the overrides that die with them and tells the model to say so; the panel warns before the click.

Duplicates already in a scene heal to one, so this repairs graphs the un-guarded append left behind. Between two shutters on one pour unit the survivor is the one carrying more overrides — the edited one holds information. And re-running it when nothing has moved is a no-op, or the routine that repairs a scene is the routine that corrupts it.

On the reading side, `inspect_formwork_parts` now carries `coversWholeElement` and `coverageCaveat`, and the system prompt says to lead with the caveat rather than the bill. This is the one field that invalidates every figure above it: a takeoff for four of an element's twelve pours is not a small error, and each of its numbers is individually correct.

**One pre-existing bug the tests found on the way.** `duplicateMarks` was checked flat across an element's shutters, but a mark encodes station and elevation *within its own pour unit* — so the same panel in two lifts of one wall carries the same mark by design. A correctly shuttered three-lift wall reported every panel it had as a clash. Now checked per shutter, the way the parts panel always did it, and each entry names its assembly. A clash list that fills up whenever an element is split is a clash list nobody reads.

Covered by 9 reconciliation tests in `formwork-assembly/attach.test.ts` (3 mutation-verified) and 15 in `apps/editor/lib/chat-ai-formwork-reattach.test.ts` (4 mutation-verified — appending instead of reconciling fails 9 of them). The `chat-ai-formwork-settings.test.ts` assertion that the reply asks for a re-attach was inverted, since it was pinning the destructive behaviour.

## Shortest path to the next visible win

**CSV export.** `bomLines` is already the row model, so this is a serialiser and a download rather than engine work — and it is the last step between a bill on screen and a bill a yard can act on.

Then **P7 validation**, which is the one that changes what the feature is allowed to claim. A bill that totals correctly and a shutter that stands up are different assertions, and only the first is currently made.

**Deliberately not built: `solutionCache`.** The plan's schema (§5.1) carries `solutionCache: { hash, solvedAt }` on the assembly, "persisted so a saved scene can produce a BOM without a full re-solve". It is not implemented and it should not be until something actually reads it. Nothing does: the panels solve on demand and the chat tools solve on the server, both in under a frame for a wall. A persisted hash that no code compares is a field that can only be wrong — it would be written by whatever last saved and believed by nothing, which is the precise failure the parts model was built to avoid on the other side. When an export path needs a BOM without the geometry pass, that is the moment to add it, with the reader and the invalidation in the same change.
