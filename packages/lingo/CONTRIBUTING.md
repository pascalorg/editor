# Contributing to lingo

Thanks for helping make forms easier and LLM tools safer. This guide is the
short path to a mergeable change; `AGENTS.md` is the canonical rules file (it
binds humans too).

## Setup

```sh
# Bun 1.3.14 (Node >= 18 is the library's runtime target)
bun install
bun run check
```

`bun run check` is the gate: typecheck (strict + `noUncheckedIndexedAccess`),
tests, build, size budgets, corpus compatibility, zero-dependency check. Green
`check` is the definition of "builds on my machine" here — CI runs the same
steps with vitest on Node 20/24, plus a dist smoke test on Node 18 (the
engines floor, which vitest itself can't run on).

Lint/format is Biome via Ultracite (`bun run lint`, auto-fix `bun run
lint:fix`); a lefthook pre-commit hook checks staged files. Rules that fight
the codebase get turned off in `biome.jsonc` with a reason — never suppressed
inline.

The docs site is a workspace member: `cd apps/site && bun dev` (port 3000, or
the next free port — Next prints which). It consumes the library as a live
link — rebuild the library and the site sees it.

## Before you code

- **Read the plan for the module you're touching** (`plans/NNN-*.md`). Grammar,
  alias tables, ambiguity policy, and API shapes are specified there. Plans are
  living documents: if your implementation forces a spec change, update the plan
  in the same PR.
- **Public API changes** go through `wiki/api-design.md` — including its
  checklist at the bottom.
- **Names** come from `CONTEXT.md`; general conventions from
  `wiki/conventions.md`.

## Ground rules

1. **Zero runtime dependencies** — mechanically enforced
   (`packages/lingo/scripts/check-zero-deps.mjs`). `Intl.*` is allowed; React
   only as the optional `./react` peer.
2. **Size budgets are hard** — `packages/lingo/scripts/size.mjs` is the source
   of truth. Over budget means tree-shake it, cut it, or make the written case
   for recalibration in `wiki/decisions.md`.
3. **Interpretation changes are breaking.** If previously-valid input now parses
   to a different value, that is semver-MAJOR even if no API changed. The corpus
   gate (`packages/lingo/scripts/corpus-diff.mjs`) classifies your diff as
   ADDITIVE or BREAKING; BREAKING needs a decision entry.
4. **Every parse result carries spans; everything formatted must re-parse;
   no `Date.now()` in library logic.** The test suite holds you to all three.

## Tests

Colocated `*.test.ts` next to source; shared corpora under
`packages/lingo/tests/corpus/`. New grammar or vocabulary needs corpus cases;
new issue codes need tests for the code, its copy, and its typed `data`
payload. Hostile-input coverage (unicode, RTL, zero-width, 50k-char strings) is
expected for parser-facing changes.

### Locale corpora

Locale idioms are corpus-gated per pack. Add rows in
`packages/lingo/tests/corpus/locale-<id>-source.mjs`, regenerate checked-in
contracts with `node scripts/corpus-diff.mjs --write` from `packages/lingo/`,
and rely on `bun run check` to enforce them. When adding idioms to a locale
pack, use `plans/033-locale-idiom-coverage.md` and
`wiki/research/locale-idioms.md` as the checklist before touching data.

## Docs are part of done

A user-visible change updates, in the same PR: TSDoc `@example` on new public
symbols, `packages/lingo/README.md`, `packages/lingo/llms.txt`, and the
CHANGELOG under `[Unreleased]`. If you borrowed an idea from another library,
credit it in `wiki/inspiration.md`; if you made a consequential trade-off, add
a D-entry to `wiki/decisions.md`.

## Commits & PRs

- Conventional Commits, sentence-case subject: `feat(parse): accept 1m80
  compound heights`. Scopes are module/dir names (`core`, `parse`, `units`,
  `date`, `dom`, `react`, `ai`, `site`, `docs`, `plans`, `wiki`, `bench`).
- Spec/wiki-only changes use the `docs(plans):` / `docs(wiki):` lane.
- The PR template checklist is real — run it, delete the lines that don't
  apply.

## Releasing (maintainers)

`gh workflow run release.yml -f bump=patch|minor|major` — the workflow runs the
full check, bumps `packages/lingo`, publishes with npm provenance, then tags
and creates the GitHub release. `prepublishOnly` re-runs the check as a
belt-and-suspenders gate.
