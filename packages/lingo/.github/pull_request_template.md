## Description

<!-- What changed and why. Link the plan (plans/NNN-*.md) this implements or amends. -->

## Checklist

*Remove items that don't apply to this PR.*

**Gates**
- [ ] `bun run check` green (typecheck, tests, build, size budgets, corpus gate, zero-deps gate)
- [ ] `bun run lint` green (Biome via Ultracite; rule mismatches go in biome.jsonc with a reason, never inline)
- [ ] Corpus diff is ADDITIVE — or BREAKING with a `wiki/decisions.md` entry and a semver-major note

**API surface** (public exports touched)
- [ ] Semver impact stated (remember: interpretation changes of valid input are MAJOR)
- [ ] `wiki/api-design.md` checklist run
- [ ] TSDoc `@example` on every new public symbol
- [ ] README / llms.txt / site docs updated together

**Knowledge layer**
- [ ] Plan updated in this PR if implementation diverged from spec
- [ ] CHANGELOG updated under `[Unreleased]` (notable changes)
- [ ] Borrowed ideas credited in `wiki/inspiration.md`
