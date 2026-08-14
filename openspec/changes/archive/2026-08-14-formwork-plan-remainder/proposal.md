## Why

The formwork master plan (`~/.claude/plans/currently-see-the-formwork-cozy-sky.md`, 12 sections, phases P0–P8) is roughly 88% built and tracked prose-first in `wiki/formwork/implementation-status.md`. What remains is no longer a list of features to write: it is a handful of items each blocked on a *decision* rather than on effort — a schema that does not exist, a standard nobody has bought, a proposal shape nobody has defined. Prose cannot hold those, because a status paragraph can say "value-engineering has no entry point" without ever being forced to say what the entry point would be.

This change converts the plan's remainder into specs so each blocked item states the behaviour it owes before anyone implements it. It is scoped deliberately to the unbuilt ~12%: the built 88% is not re-specified here, since a delta describing behaviour that already ships is a document that can only go stale.

## What Changes

- **The last optimisation loop gets a definition.** P8's value-engineering has no module, no proposal shape, and nothing on any surface that names a saving. Sequence-opt shipped the pattern it should follow (a keyed proposal, applied whole, judged by a second measurement); value-engineering has to say *what a saving is* before that pattern can be reused.
- **The twelve solver phases become one pass.** §6 specifies a pure `(scene, projectSettings, catalog) → FormworkSolution`. The phases exist as modules and no such function does, so phases 9–12 have no single place to live. Includes the phase-level gaps: the reject-degenerate gate (0), topology flags carried on the result rather than only re-derived by the validator (1), a schema home for permitted joint elevations (2), alternate-bay parity and the batch-plant/pump-rate check (3), and the maturity/strength striking criterion beside the elapsed-time one (10).
- **The catalog seed is filled.** `mivan-generic`, the full APA grade set, PERI SRS/QUATTRO/SKYDECK/MULTIFLEX and Doka Frami are registered and unseeded; the H20 permissible-vs-design conflict is unresolved; metric film-faced plywood design values are deliberately absent rather than hardcoded.
- **The rated-pressure path is wired.** Panel systems are checked against a rated pressure with an inverse solve for `v_max`; the chain exists for conventional systems only.
- **Three clash passes get the schemas they are blocked on.** Ties × rebar, props × slab-below, and scaffold × site boundary each need geometry no node carries — rebar has no schema at all, the slab below has no capacity, there is no site boundary. Each spec states the check *and* the minimum schema it needs, so the schema decision is explicit rather than implied.
- **Amortisation proper, and finance.** Owned stock is charged as an internal recharge today, which closed the "owning is free" error and is not amortisation: there is no panel life or residual value in the model. Finance is the last cost outside every printed total with nothing to hang off.
- **The cut optimiser gains a search.** A stated sheet list is tried in preference order rather than searched over, and there is no per-edge trim allowance.
- **Standards provenance is closed or reported.** The §12 open items — the DIN 18218 tE table, CIRIA R108's `C1`/`C2`, EN 13670 §5.5, CESMM Class G and POMI clause text — plus two the plan did not anticipate: column clamp capacities derived from geometry rather than a stamped table, both currently `verification: 'unverified'`.

No behaviour that ships today is removed or re-specified, so there are no **BREAKING** changes.

## Capabilities

### New Capabilities

`openspec/specs/` is currently empty, so every capability below is new and there is no existing organisation to preserve. Names are flat and `formwork-` prefixed.

- `formwork-value-engineering`: what a saving proposal is, how it is keyed and applied, and how the saving is verified against a second solve rather than against its own prediction.
- `formwork-solver-pipeline`: the project-wide solve as one pure pass over twelve phases, the `FormworkSolution` it emits, and the phase-level gaps in 0–3 and 10.
- `formwork-catalog-seed`: the unseeded panel systems, grades and beam capacities, and what a seeded entry must carry — including its verification level and citation.
- `formwork-rated-pressure`: the panel-system design path — a rated pressure check and the inverse solve for the maximum permissible rise rate.
- `formwork-deferred-clashes`: the three clash passes and the minimum node schema each requires, kept as one capability because all three are blocked on the same class of decision.
- `formwork-asset-amortisation`: panel life, residual value and cost-per-use on composite assets, plus the finance cost, both reported outside the cash total.
- `formwork-cut-set-covering`: a search across stated sheet sizes for repeated floors, and per-edge trim allowance.
- `formwork-standards-provenance`: how an unverified constant is declared, reported and superseded, so no figure is presented as certified when its source is a reverse-engineered table.

### Modified Capabilities

None. No spec exists under `openspec/specs/` yet, so nothing's requirements are changing.

## Impact

- **`packages/core/src/systems/formwork/`** — the pipeline entry point, `value-engineering`, `validate/invariants.ts` (new clash passes), `cost.ts` (amortisation, finance), `layout/cut-search.ts` (set covering), the catalog seed files, and the `verification` metadata every unverified constant already carries.
- **`packages/nodes/src/formwork-assembly/`** — the plan/measure pair for value engineering, mirroring `apply-move.ts`; new node schema fields for rebar, slab capacity and site boundary if the deferred clashes are taken.
- **Both AI surfaces** — a value-engineering read and its apply tool on `packages/mcp/src/tools/formwork/` and `apps/editor/lib/chat-ai.ts`, at parity, which is the standing discipline for this feature.
- **`apps/editor`** — the takeoff panel gains the saving proposals and their apply buttons.
- **Node schemas are the main compatibility surface**: three of the deferred clashes need fields no node carries, and adding them touches the registration checklist and existing scenes.
- **Procurement, not code, blocks part of this**: DIN 18218:2010-01, CIRIA R108 (~£50), EN 13670, CESMM Class G, POMI and several vendor datasheets have to be bought or fetched before the constants behind them can move off `unverified`.
- **`wiki/formwork/implementation-status.md`** remains the narrative handoff; these specs do not replace it, they state the contracts it describes.
