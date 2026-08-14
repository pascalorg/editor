## 1. The pipeline (void — it already exists)

`solveProjectFormwork` in `packages/nodes/src/formwork-assembly/solve-project.ts` is the pipeline, every consumer already reads it, and the gap-carrying result shape ships ten times over as `CostGap`/`LabourGap`/… — see `design.md` decision 1 for why it cannot live in core. The four original items were written against a stale claim in the master plan's P1 row. One survives:

- [x] 1.3 Test purity of the *existing* `solveProjectFormwork`: identical inputs give an equal solution across two runs, and no result depends on wall-clock time or ambient locale

## 2. The phase-level gaps inside the pipeline

Each of these lands in `solve-project.ts` or in the core phase module it calls, carries its own gap in the shipped `*Gap` / `*_GAP_LABELS` / `*Caveats()` idiom, and owes an unchanged-figure test over a project stating none of its new input — the discipline group 3 was going to carry, now that a fill reaches every surface at once.

- [x] 2.1 Phase 0: reject degenerate geometry before designing it — zero/negative dimensions, self-intersecting footprint — with the rejection reason per element and the rejections carried on the project solution — **shipped**, `coverage/formability.ts` + `ProjectFormwork.rejected`. Two narrowings, both recorded in the module docstring: a dimension *below the configured system's minimum* is deliberately **not** a rejection, because `columnFormSizeMm` sets a form to a size and lifts an undersized column to it (compensation, not a fault) and no catalog system publishes a minimum thickness to refuse against; and the project-level answer is the rejection list and its caveat sentence rather than a bare count, since a count is the one thing that sends a reader nowhere
- [x] 2.2 Test that a rejected element contributes to no quantity, cost or drawing, and that the rest of the project still solves — **shipped**, `solve-project.test.ts` (bom, weight, cost and cut list identical to the scene without it) plus `formability.test.ts`
- [x] 2.3 Phase 1: carry formwork topology on the solution — formed faces, faces against earth/existing/blinding, meetings between elements, shared versus double-formed — rather than only re-deriving it in the validator
- [x] 2.4 Test the shared face is counted once in area, panels and cost, and an unformed face appears in no layout — **shipped**, `solve-project.test.ts` (monolithic L bills each corner unit once with a single mark; monolithic ends report zero area; an `AGAINST_EARTH` face draws no `P-B-*` part and contributes no area) plus the `owned`-respecting fix in core's `bomLines` that the panels/cost half depends on
- [x] 2.5 Phase 2: permitted construction-joint elevations as project data, respected by pour splitting, with the conflict reported when no permitted joint satisfies the pour limits, and solver-chosen boundaries labelled as such — **done**, a `pours` settings group (`permittedJointElevations`, `jointSnapTolerance`) resolved through `FormworkSettings` and the `set_formwork_settings`/`inspect` surfaces; `splitIntoLifts` labels every joint below a lift `specified`/`permitted`/`solver`/`off-permitted`; `pourLiftConflicts` reports a boundary on none of the stated set with the cap and the set named; `formworkPours` carries the plan on `ProjectFormwork` (elements + conflicts) and `projectFormworkCaveats` closes with it; every pour-count consumer threads `pourLimitsFromSettings`
- [x] 2.6 Phase 3: concrete-supply check — **shipped `8c5743fd`** — batch-plant output and/or pump rate against the designed rise rate for the element's plan area — reporting the sustainable rate and naming supply as governing; absent supply reports "not performed"
- [ ] 2.7 Phase 3: alternate-bay construction respected in the sequence, reporting the parity used
- [ ] 2.8 Phase 10: strength/maturity striking criterion beside the elapsed-time one, reporting which governs and the accumulated maturity; a criterion lacking its inputs falls back to time and says so

## 3. Migrating consumers onto the one solution (void — they are already on it)

`takeoff.ts`, `takeoff-panel.tsx`, `validate-project.ts`, `value-engineer.ts`, `headless.ts`, `apps/editor/lib/chat-ai.ts` and five MCP tools all read `solveProjectFormwork` today. Nothing to migrate, no divergence to close. The unchanged-figure discipline these five items carried moves onto group 2, where a phase-level fill now changes every surface at once.

## 4. Catalog seed

- [ ] 4.1 Make a registered-but-unseeded system refuse to design rather than fall back: element reported undesignable with the identifier named, no layout or quantity produced, and a panel system missing its rated pressure treated as unseeded
- [ ] 4.2 Report seeded/unseeded state wherever selectable systems are listed, on all three surfaces
- [ ] 4.3 Require source and verification level on every published design value in a catalog entry; a value with neither is not publishable
- [ ] 4.4 Seed `mivan-generic` with its rated pressure, panel sizes, weights, tie arrangement and accessories, each cited
- [ ] 4.5 Seed the full APA grade set, with metric film-faced plywood values marked `derived` where converted and the conversion stated
- [ ] 4.6 Seed PERI SRS, QUATTRO, SKYDECK and MULTIFLEX, and Doka Frami, from vendor datasheets, each value cited
- [ ] 4.7 Record the H20 permissible-versus-design conflict with both values and both sources, use the more conservative, and report the disagreement wherever it governs

## 5. Rated pressure and the inverse rate solve

- [x] 5.1 One module holding both the rated-pressure check and the inverse maximum-rise-rate solve, so they cannot disagree
- [x] 5.2 Check derived pressure against the system's rated pressure, reporting both figures and the utilisation; failure names the panel system, not a component
- [x] 5.3 Suppress the conventional component checks (sheeting, joist, waler, tie) for panel-system elements
- [x] 5.4 Report the maximum permissible rise rate per panel-formed pour, at the pour's stated temperature, consistency, cement type and admixture condition
- [x] 5.5 Test the consistency scenario: a pour designed at exactly the reported maximum rate passes at full utilisation
- [x] 5.6 Report the pour whose full head alone exceeds the rating as satisfied by no rate, naming the lift height or head rather than reporting zero
- [x] 5.7 Reconcile against the project's stated rate and its supply, naming which of the three governs

## 6. Cut set-covering and trim

- [x] 6.1 Search combinations of the stated purchasable sheet sizes with a stated objective (least cost or least waste), reporting the objective, the counts per size and the offcut area
- [ ] 6.2 Regression guard: a single stated sheet size reproduces today's cut solution exactly
- [x] 6.3 Report an uncuttable piece with its dimensions and the largest stated sheet, excluded from the counts rather than silently absent
- [ ] 6.4 Cover a repeated floor once — sheets per cycle plus the replacements the stated life implies — and state the reuse assumed
- [x] 6.5 Per-cut-edge trim allowance applied in placement, with the offcut area distinguishing trim loss from unused sheet area; no stated allowance means none applied

## 7. Amortisation and finance

- [x] 7.1 Widen `SheetStock.expectedReuses` into an asset-life shape (purchase price, expected uses, residual value) available on panels, sheeting, beams, props, ties and accessories
- [x] 7.2 Charge an asset with a life per use, reporting the price, life, residual value and per-use figure; charge one without a life at today's internal recharge and name the basis
- [x] 7.3 Test that no owned item appears in any total at zero under either basis
- [x] 7.4 Report amortised and recharge lines as distinguishable, with the total stating it combines both bases
- [ ] 7.5 Report a use count exceeding the stated life as an overrun, naming the replacement it implies
- [ ] 7.6 Finance cost from a stated rate over the spend-to-recovery period, reported beside and outside the cash total; test the cash total is unchanged by its presence; no rate means no figure; the figure states its rate, period and any pours excluded for being undated

## 8. Provenance

- [ ] 8.1 Require source and verification level (`certified` / `derived` / `unverified`) on every design constant; a constant with no source is unusable and its dependent check reports "not performed"
- [ ] 8.2 Enforce the citation shape per level: document + edition + clause for `certified`, cited inputs + method for `derived`, derivation + what-would-certify for `unverified`
- [ ] 8.3 Weakest-wins propagation from constant to check to line to total, naming the constants at the weakest level
- [ ] 8.4 Carry the level and the named constants through both AI surfaces in the same terms the panel uses
- [ ] 8.5 State the verification level on the face of every design report, cut sheet, elevation, bill and export, listing the unverified figures
- [ ] 8.6 Certify the two currently-unverified column clamp capacities from a stamped vendor table, or restate them as `unverified` with the document that would certify them named
- [ ] 8.7 Close or document the §12 open items — DIN 18218 tE table, CIRIA R108 `C1`/`C2`, EN 13670 §5.5, CESMM Class G, POMI clause text — recording for each either the citation or the procurement that blocks it
- [ ] 8.8 Test that certification changing a number is attributable to the certification, and that a loosened limit reports the previously failing or marginal condition it now passes

## 9. Deferred clashes: the inputs

- [ ] 9.1 Optional reinforcement geometry on existing element schemas — bar positions or an arrangement they derive from, diameters, cover — no new node kind
- [ ] 9.2 Optional load capacity on slab/deck/ground elements
- [ ] 9.3 Optional site boundary and setback as project data
- [ ] 9.4 Regression test over a pre-change fixture: a project stating none of these produces identical quantities, costs, dates and existing findings

## 10. Deferred clashes: the checks

- [ ] 10.1 Report each blocked check as "not performed" with the missing input and the elements it would have covered, and run it on the elements that do carry the data
- [ ] 10.2 Tie-versus-reinforcement: report each tie whose hole plus clearance intersects a bar, with a permissible alternative position where the grid admits one and an explicit "cannot be relocated" where it does not
- [ ] 10.3 Report per-element tie clash counts so broad cage incompatibility reads differently from one awkward tie
- [ ] 10.4 Prop-versus-supporting-capacity: reaction, capacity and utilisation per location, with backpropping reported through each storey the load passes through
- [ ] 10.5 Scaffold/formwork-versus-boundary: report what extends past the boundary and by how much, with a setback encroachment as a distinct finding

## 11. Value engineering: the decision, in core

- [ ] 11.1 `saving-patch.ts` — the proposal shape (class, target, alternative, saving, trade-off in the reader's units), the key `${class}|${target}|${alternative}` deliberately excluding the money, the by-key lookup, and the superseded refusal sentence
- [ ] 11.2 Test the key's two halves: a rate edit keeps the key valid with new money; a design change that removes the proposal refuses the key as superseded
- [ ] 11.3 Derive the five saving classes — reuse, substitution, grid relaxation, cycle, standardisation — each labelled with its class, each priced from the same cost model as the printed total
- [ ] 11.4 Suppress any substitution or relaxation that would fail a design check entirely, rather than offering it with a warning
- [ ] 11.5 Report a class that produced nothing, distinguishing "nothing cheaper exists" from "could not be evaluated, missing *input*"
- [ ] 11.6 Refuse to present a total of claimed savings, and state mutual exclusivity per proposal

## 12. Value engineering: plan and measure, in nodes

- [ ] 12.1 `apply-saving.ts` with a `plannedSaving` / `savingOutcome` pair that mutates nothing — returns the writes, and separately the verdict
- [ ] 12.2 Refuse a partial application: a proposal spanning several elements where one can no longer take the change is refused whole, nothing written
- [ ] 12.3 `savingOutcome` re-derives cost from the changed scene and reports measured beside predicted, stating the measurement wins in either direction
- [ ] 12.4 Test the symmetric report: over-delivery is stated as prominently as under-delivery
- [ ] 12.5 A failed re-derivation reports the saving as unmeasured, never as confirmed at the predicted figure
- [ ] 12.6 Export through `@pascal-app/nodes/formwork-assembly/headless`, not the barrel

## 13. Value engineering: the three surfaces

- [ ] 13.1 Takeoff panel: render the saving proposals with their class, money and trade-off; apply by key in one history step; nothing marked committed, hired or ordered
- [ ] 13.2 Editor chat: a savings read and an apply-by-key tool against a plain graph
- [ ] 13.3 MCP: the same pair, registered and documented, through the operations bridge — follow the node-kind/tool registration checklist
- [ ] 13.4 Parity test across all three: same proposals, same keys, same money, same trade-off wording, and a key produced by one surface accepted by the other two

## 14. Closing out

- [ ] 14.1 Update `wiki/formwork/implementation-status.md` in the same commit as the code it describes, with test counts measured by running, not grepping
- [ ] 14.2 Run all four gates — `bun run check-types`, `bun test`, `bunx biome check --write` scoped to touched paths, `bun run build` — and read the build's warnings, not only its errors
- [ ] 14.3 Rebuild `packages/core` and `packages/nodes` before running nodes, MCP or editor tests, since cross-package tests read `dist/`
