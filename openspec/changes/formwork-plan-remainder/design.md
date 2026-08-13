## Context

See `proposal.md` — Why. The design-relevant state:

- **The phases exist; the pipeline does not.** `packages/core/src/systems/formwork/` holds the phase modules — pressure, layout, accessories, sequence, striking, quantities, cost, validate — and each is called directly by whichever consumer needs it. There is no value that represents "the project's formwork". Every consumer therefore performs its own traversal, and the ones that need two phases wire them together themselves.
- **Two shipped loops already set the pattern this change must follow.** `fix-finding` (a validation finding, keyed, fixed, re-validated) and the sequence-opt loop (`move-patch.ts` in core, `apply-move.ts` in nodes, `apply_pour_move` on both AI surfaces) both split into a keyed *decision* in core, a *plan and measure* pair in nodes that mutates nothing, and three thin callers that each write in their own layer. Value engineering is the third instance of the same shape.
- **Cross-package tests read `dist/`.** `packages/nodes` and `packages/mcp` resolve `@pascal-app/core` to compiled output, so any core signature this change touches is invisible to their tests until core is rebuilt. `tooling/check-dist-parity.mjs` gates it.
- **`apps/editor/app/api/**/route.ts` is a Server Component graph.** Anything the AI surface reaches must come through `@pascal-app/nodes/formwork-assembly/headless`, not the barrel. `apps/editor/lib/server-imports.test.ts` enforces it.
- **Provenance metadata already exists** as a `verification` field on catalog and constant values with `'unverified'` as a live value in the seeded data. This change formalises what it means and makes it propagate; it does not introduce it.
- **Layer boundaries** (`CLAUDE.md`, `wiki/architecture/layers.md`): core owns domain data and pure logic and may not import Three.js or any UI; nodes owns per-kind bundles; `apps/editor` owns panels and the chat surface; `packages/mcp` owns the outside agent surface.

## Goals / Non-Goals

**Goals:**

- One solution value, derived once per `(scene, settings, catalog)`, that every consumer reads — so the "two surfaces disagree about a quantity" class of bug becomes structurally impossible rather than test-covered.
- Value engineering built as the third instance of the shipped keyed-proposal shape, reusing `fix-finding` and `apply-move`'s decision/plan/measure split rather than inventing a third protocol.
- New project inputs (reinforcement, supporting capacity, site boundary, asset life, finance rate, permitted joints, concrete supply) are all optional, and a project stating none of them produces byte-identical output to today.
- Provenance propagates automatically from constant to result to printed document, rather than being restated by hand at each surface.

**Non-Goals:**

- **No caching.** The plan's `solutionCache` stays unbuilt. A pure derivation invalidated by "the scene" is invalidated by every edit; the cache would be a correctness surface with no measured need behind it.
- **No incremental solve.** The pipeline recomputes wholesale. If it proves too slow, that is a separate change with a measurement in front of it.
- **No re-specification of the built 88%.** These deltas cover the unbuilt remainder only.
- **No new node kinds.** The deferred clashes extend existing schemas; a `rebar` node kind, if it is ever wanted, is a change of its own with the four-file registration checklist behind it.
- **No procurement.** Buying DIN 18218, CIRIA R108, EN 13670, CESMM and POMI is a purchasing act; this change only makes the gap they leave explicit and reportable.

## Decisions

### The pipeline is a pure function returning one value, not a stateful solver or a core system

`solveFormwork(scene, settings, catalog) → FormworkSolution` in `packages/core/src/systems/formwork/`. Phases stay as their own modules and the pipeline composes them; nothing is rewritten to live inside it.

*Why not a core System with subscriptions:* a system holds state and reacts to the bus, and every reported bug in this feature so far has come from two consumers deriving the same number differently, not from a missing invalidation. A pure function makes "two derivations" unrepresentable. Systems remain the right home for scene-graph reactions; this is a derivation.

*Why one value rather than the phase-by-phase calls we have:* the phases that are unbuilt (9–12) are precisely the ones with no natural owner — they are project-wide, and there is nowhere project-wide to put them today. That is not a coincidence, it is the shape of the gap.

*Migration is additive:* existing consumers keep their direct phase calls and are moved onto the solution one at a time, each move guarded by a test asserting the figure is unchanged. No consumer is rewritten in the same task that introduces the pipeline.

### A phase that cannot run returns a stated gap, and gaps are a first-class part of the solution type

Every phase result is either a value or a "not performed, because *input* is missing, covering *these elements*". This is the same discipline the elevation drawing already applies to dropped tie stations, generalised: an absence with no reason beside it becomes a support query.

*Why not exceptions or `undefined`:* both erase the reason, and the reason is the actionable half. A validator reporting "no tie clashes" on a project with no reinforcement is worse than one reporting nothing at all — it is a false clearance somebody will sign against.

*Why not a warnings array beside the results:* a warning is detached from the figure it qualifies, and detached warnings get filtered out by the surface that renders the figure. The gap has to travel with the value.

### Value engineering copies `apply-move`'s split exactly, and its key omits money for the same reason `findingKey` omits figures

Core owns `saving-patch.ts` (the key, the proposal shape, the by-key lookup, the refusal sentences). Nodes owns `apply-saving.ts` with a `plannedSaving` / `savingOutcome` pair that **mutates nothing** — it returns the writes and, separately, the verdict. Three callers write in their own layer: the takeoff panel through the store in one history step, the chat tools against a plain graph, MCP through the operations bridge.

The key is `${class}|${target}|${alternative}` — the *decision*, not the money. `findingKey` omits figures so a half-fix reads as unfixed; the same reasoning applies here, and it points the opposite way from `moveKey`. `moveKey` includes the days because for a resequencing the figure *is* the decision — a different number of days is a different move. For a saving, the money is a *consequence* of the decision: substituting grade A for grade B is the same offer whether it saves £400 or £380 after a rate edit. So a rate change must not invalidate the key, and a design change that removes the substitution must.

*Alternative rejected — one generic "proposal" abstraction over findings, moves and savings.* Three instances with three deliberately different key rules is exactly the point at which an abstraction would have to be parameterised by the thing that distinguishes them. Repeating the shape is cheaper than a framework whose only configuration is the disagreement.

### The measured-versus-predicted report is mandatory and symmetric, reusing `moveOutcome`'s rule

Re-derive the cost from the changed scene, report both figures, and state that the measurement wins — in either direction. A saving that over-delivered is the same fault as one that under-delivered: both mean the sweep was wrong, and printing whichever reads better would be choosing which sweep to believe on how it sounds.

A saving whose re-derivation fails is **unmeasured**, never "confirmed at the predicted figure". This mirrors the shipped rule that a missing after-line is unmeasured rather than cleared.

### Deferred-clash inputs extend existing node schemas; each spec states the minimum field set

Reinforcement, supporting-element capacity and site boundary go on existing nodes as optional fields, not as new kinds. Each field is optional, and the corresponding check reports "not performed" when it is absent, which is what makes existing scenes provably unaffected.

*Why the three clashes are one capability:* they are blocked on the same class of decision — geometry the model does not carry — and specifying them together forces the schema question to be answered in one place instead of three. They can still be implemented and shipped independently.

*Why reinforcement is a field rather than a node kind:* a tie-clash check needs bar positions, diameters and cover. It does not need reinforcement to be selectable, renderable, or editable as its own object. A node kind carries the whole four-file registration checklist plus a renderer plus selection behaviour, all to serve one check.

### Amortisation widens the existing life field rather than adding a parallel cost path

`SheetStock.expectedReuses` becomes an asset-life shape available on every priced asset class (panels, sheeting, beams, props, ties, accessories). Assets without a life keep today's internal-recharge charge, and the result **names the basis**. Owning is never free under either basis, which is the error the recharge already closed.

*Why not amortise everything by inventing lives:* a made-up life is an `unverified` constant reaching a client-facing money figure. Better a labelled recharge than an unlabelled fiction.

Finance is reported **outside** the cash total, always. A cash total that silently includes cost-of-capital cannot be reconciled against an invoice, and reconciliation against invoices is what this total is for.

### Provenance propagates by construction: a result carries the weakest level it depends on

Rather than each surface restating verification, the level travels with the value and combines as a weakest-wins fold: `certified > derived > unverified`. Every printed document states its level on its face, not only in the application, because the PDF is what leaves the building.

*Why weakest-wins rather than a per-figure list only:* a reader needs one answer to "can I sign this", and the list of offending constants beside it to act on. Both are reported; the fold is what makes the first answer exist.

### Cut set-covering searches, and states its objective

Search combinations of the stated purchasable sheet sizes against a stated objective (least cost or least waste), with a per-edge trim allowance. A single stated size must reproduce today's result exactly, which is the regression guard on the whole search.

*Why objective is explicit:* least-waste and least-cost diverge whenever the smaller sheet costs disproportionately more per unit area, which is the common case. A search that silently picks one is a search whose answer cannot be argued with.

### Rated pressure and its inverse are one module, so they cannot disagree

The rated-pressure check and the inverse solve for maximum rise rate share one derivation. Designing a pour at exactly the reported maximum rate must pass the check at full utilisation — that consistency is the spec's own scenario, and it is only cheap to guarantee if there is one derivation and not two.

## Risks / Trade-offs

- **The pipeline recomputes the whole project on every read; a large project may be visibly slow.** → No cache (see Non-Goals). Mitigate by measuring against the largest existing test scene before moving any interactive panel onto it, and by keeping the phase modules individually callable so a hot path can still call one phase directly if measurement demands it.
- **Migrating consumers onto the solution could silently change a figure.** → Each migration is its own task with a test asserting the figure is unchanged before and after, and no migration shares a commit with the pipeline's introduction.
- **New optional schema fields must not perturb existing scenes.** → `formwork-deferred-clashes` carries an explicit "existing projects are unaffected" scenario; it is a regression test over a pre-change fixture, not a review checkbox.
- **A `derived` level can be used to launder a guess.** → `derived` requires the cited inputs *and* the method. A value with neither is `unverified` regardless of how it was computed, and the specs make an unsourced constant unusable rather than merely flagged.
- **Value engineering's savings are not additive, and a reader will add them.** → The read explicitly refuses to present a total of claimed savings, and mutual exclusivity is stated per proposal.
- **Procurement blocks a whole capability, and it is not a coding blocker anyone will notice.** → `formwork-standards-provenance` makes the gap visible on every printed document, so the cost of not buying the standard lands on the person who can authorise buying it.
- **Widening asset life touches the cost model that every printed total and both AI surfaces read.** → Assets with no stated life keep today's charge exactly, so the widening is inert until a life is stated; the bases are reported as distinguishable lines rather than merged.

## Migration Plan

1. Introduce `solveFormwork` alongside the existing phase calls. Nothing consumes it. Rebuild `packages/core` so `dist/` carries it before any nodes or MCP work.
2. Add the gap-carrying result shape and the phase-level fills (degenerate rejection, topology on the solution, permitted joints, supply check, strength-based striking) inside the pipeline.
3. Move consumers on one at a time — takeoff, design report, buildability, cut sheet, elevation, then the AI reads — each with an unchanged-figure test.
4. Ship the independent capabilities in any order: catalog seed, rated pressure, cut search, amortisation, provenance, clashes.
5. Value engineering last, because it prices whatever the others changed.

**Rollback:** every step is additive until step 3, and each step-3 migration is independently revertable because the phase modules stay callable. Nothing is deleted until its last consumer has moved.

**Verification:** the four gates on every step — `bun run check-types`, `bun test`, `bunx biome check --write`, `bun run build` — and `wiki/formwork/implementation-status.md` updated in the same commit as the code it describes.
