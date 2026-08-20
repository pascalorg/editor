# Lingo wiki

As-built documentation. Forward-looking specs live in
[`plans/`](../plans/README.md); this folder records what exists and why.
History lives in git and `packages/lingo/CHANGELOG.md` — the wiki stays
current-state only.

## Pages

- [Decisions](decisions.md) — ADR-lite ledger of consequential decisions
  (D-numbered, offer-gated)
- [Inspiration & credits](inspiration.md) — every library and repo we learned
  from: what we took, its license, links. Giving props is a project value.
- [Conventions](conventions.md) — naming, coding patterns, tests, commits
- [API design](api-design.md) — how the public surface evolves + the PR checklist
- [Resource design](resource-design.md) — how lingo output objects are modeled
  and composed
- [Architecture (as built)](architecture.md) — updated as modules land
- [Performance benchmarking](performance.md) — how to run and read the benchmarks
- [Benchmarks (captured results)](benchmarks.md) — dated runs and numbers
- [research/](research/) — prior-art and ecosystem research (units, dates,
  masking, AI structured output, LLM failure modes, provider quirks)

## Working agreement

- Consequential decisions get a D-entry in `decisions.md` when they pass the
  offer-gate (hard to reverse / surprising / real trade-off).
- New influences get an `inspiration.md` entry the moment we borrow an idea,
  not at release time.
- Notable changes go under `[Unreleased]` in `packages/lingo/CHANGELOG.md` in
  the same change.
- **When to add a wiki page:** the topic is non-obvious from the code and will
  be needed again (the same question has come up twice). Don't add pages for
  things AGENTS.md already covers or for code architecture readable from source.
- **When docs contradict code, the code is truth today.** Fix the doc in the
  same change.
