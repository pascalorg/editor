# Conventions

*Repo-wide defaults. These are conventions, not decisions — anything that
passes the offer-gate (hard to reverse / surprising / real trade-off) lives in
[`decisions.md`](decisions.md) instead. Vocabulary lives in
[`CONTEXT.md`](../CONTEXT.md); public-API rules in
[`api-design.md`](api-design.md).*

## Files & modules

- Filenames kebab-case; one module per `packages/lingo/src/<dir>/` (module map
  in AGENTS.md). `grammar.ts` stays a re-export facade — imports never move
  when internals get split.
- `src/core/types.ts` is a leaf: it imports nothing. Keep it that way.
- Unit tables under `src/units/` are pure const data — vocab as data, never
  logic (D5). English word lists (numbers, qualifiers, date vocab, fuzzy terms)
  are data tables so locale packs stay additive.
- New heavy dependency graphs get their own entry (the `./date` and `./ai`
  pattern), never silently coupled into the main entry.

## Code style

- 2-space indent, single quotes, no semicolons, 100-col lines — enforced by
  Biome via Ultracite (D22): `bun run lint` / `bun run lint:fix`, a
  lefthook pre-commit check on staged files, and a `.claude/settings.json`
  PostToolUse auto-fix after agent edits. Triple-pin rule: the devDeps, the
  lefthook command, and the hook all name biome 2.4.16 / ultracite 7.8.2 —
  bump them together.
- Config over comments: a rule that fights the codebase gets turned off in
  `biome.jsonc` with the reason inline (parser idioms: top-level-regex,
  cognitive complexity, bitwise masks, indexed hot loops). Never suppress
  inline.
- **TSDoc with `@example` on every public symbol** — the examples are verified
  (143 and counting). Doc comments state contracts and constraints; regular
  comments exist only for what the code can't say (the NUL-byte incident
  recorded in `wiki/architecture.md` is the motivating story — a constraint no
  line of code could state).
- Naming: types `PascalCase`; functions verb-first `camelCase` following the
  established families — `parse*`, `format`, `humanize*`, `register*`,
  `define*`, `create*`, `is*`/`firstError`/`candidateOf` for result helpers.
  Options bags are `<Thing>Options`, results `<Thing>Result`.
- Issue codes `SCREAMING_SNAKE`, noun-phrase for rejections (`UNKNOWN_UNIT`,
  `SINGLE_VALUE_EXPECTED`), past-tense for applied-forgiveness warnings
  (`TYPO_CORRECTED`, `RANGE_REVERSED`, `TZ_IGNORED`). Codes are add-only.
- Unit data: ids short and conventional (`'m'`, `'ft'`, `'KiB'`); `aliases`
  lowercase; case-sensitive forms go in `caseExact` (`Mb` vs `mb`); factors are
  exact legal values with the defining source noted in the table (never rounded
  anchors); hazard/ambiguity handling per plan 003's tables.

## Tests

- Colocated `*.test.ts` next to source; shared fixtures in
  `packages/lingo/tests/` (`corpus/`, `fixtures/`).
- New grammar or vocabulary ⇒ corpus cases + round-trip coverage; parser-facing
  changes consider the hostile suite (unicode, RTL marks, zero-width, 50k-char
  inputs — no throws, no NaN, spans in bounds).
- Perf assertions are env-gated (`LINGO_PERF=1`); a generous quadratic-catcher
  stays always-on.
- The corpus contract (`tests/corpus/contract-v1.json`) is the behavior
  spec-of-record: `scripts/corpus-diff.mjs` classifies drift ADDITIVE vs
  BREAKING and gates `bun run check` + CI.

## Deterministic gates over prose rules

When a rule has a mechanical slice, it becomes a script in
`packages/lingo/scripts/` wired into `bun run check` and CI — judgment stays in
the docs, enforcement in the gate:

- `size.mjs` — budgets (the numbers live ONLY here, with their D-history inline)
- `corpus-diff.mjs` — interpretation-stability gate
- `check-zero-deps.mjs` — hard rule 1 (no `dependencies`, no bare imports in src)
- `ai-eval.mjs` — /ai acceptance ≥ naive, silent-wrong ≤ naive, per category

## Commits & branches

- Conventional Commits with sentence-case subjects:
  `feat(parse): accept 1m80 compound heights`,
  `fix(date): clamp month-end offsets across DST`.
- Scopes = module/dir names: `core`, `parse`, `number`, `units`, `format`,
  `fuzzy`, `date`, `dom`, `react`, `ai`, `site`, `bench`, `plans`, `wiki`,
  `docs`, `infra`.
- Spec/knowledge-only changes use the docs lane: `docs(plans): …`,
  `docs(wiki): …` — it keeps `git log --oneline` filterable.
- Branches: `feat/…`, `fix/…`, `chore/…`, `docs/…`, kebab slugs.

## Docs surfaces (what a public change must touch)

| Surface | When |
|---------|------|
| TSDoc `@example` | every new/changed public symbol |
| `packages/lingo/README.md` | anything a user would evaluate the library by |
| `packages/lingo/llms.txt` | new entries, options, codes, canonical examples (npm compressed reference; site mirrors at `/llms-small.txt`) |
| Site `/llms.txt` index | auto-generated from `docs-catalog.ts` when nav/sections change |
| `apps/site/src/lib/docs.md.ts` | human docs markdown export; per-section `/docs/<id>.md` slices |
| `packages/lingo/CHANGELOG.md` | every notable change, under `[Unreleased]` |
| `packages/lingo/docs/recipes.md` + site docs | new field shapes / integration patterns |
| `wiki/decisions.md` | choices that pass the offer-gate (same change) |
