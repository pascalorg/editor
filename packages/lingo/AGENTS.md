# lingo — agent guide

lingo is a zero-dependency TypeScript library that understands what people type
and what models emit: natural-language quantities ("2 ft", "5'11\"", "72 in to cm",
"between 5 and 10 kg", "three days ago", "it's hot") parsed into canonical values,
converted, validated, and humanized back — two-way. A headless DOM layer upgrades
any `<input>` into a natural-language field; `/ai` fields make LLM structured
output safe at the tool boundary. Tagline and product thesis: **"Make forms
easier, LLM tools safer."**

This file is the canonical agent guide for every tool (`CLAUDE.md` is just
`@AGENTS.md`). Tool-specific dirs hold only tool config, never rules.

## Hard rules

1. **Zero runtime dependencies.** Nothing under `dependencies`, ever. `Intl.*` is
   allowed (built into every runtime). React appears only as an optional peer for
   `./react` and `./react-native`. Mechanically gated:
   `packages/lingo/scripts/check-zero-deps.mjs`
   (part of `bun run check` and CI).
2. **Size budgets are enforced** (`bun run size`, min+gzip via esbuild).
   **`packages/lingo/scripts/size.mjs` is the single source of truth for budget
   numbers** — do not restate them here or in plans (plan 001 records
   history/rationale; the script is the gate). If a feature busts a budget, make
   it tree-shakeable, cut it, or make the recalibration case in a decision entry
   (D11/D14 pattern). Budget overruns stop and escalate — they never land
   silently (D19 records the one breach).
3. **Every parse result carries spans.** Errors and warnings point at
   `[start, end)` offsets in the ORIGINAL input string (normalization keeps an
   offset map).
4. **Two-way guarantee.** Anything `format()`/`humanize*()` emits must re-parse to
   the same value (round-trip tests enforce this).
5. **No `Date.now()` inside parsing logic** — reference time is always an explicit
   `now` option so results are deterministic and testable.
6. **Deterministic, side-effect-free core.** DOM code only under
   `packages/lingo/src/dom/`.

## Philosophy

- **Don't fix what isn't broken.** No massive rewrites unless warranted; keep
  changes scoped to the requested behavior.
- **Reuse before reinventing.** Search the repo for an existing implementation
  before building one; grep similar names and patterns first.
- **Config over comments.** When a rule or tool setting disagrees with how the
  codebase actually works, change the config rather than scattering suppressions.
- **Vocabulary is fixed.** `CONTEXT.md` is the glossary. Before introducing a new
  noun in code, docs, or issue codes, check it — if the concept exists under a
  canonical name, use that name.
- **No speculative abstractions.** No backwards-compatibility shims, dead code,
  or "might need it later" layers.
- **Give props.** Every library or repo we learn from gets a
  `wiki/inspiration.md` entry the moment we borrow the idea.

## Repo layout

```
packages/lingo/   @pascal-app/lingo — src, tests, bench, demo, scripts (gates), npm README
apps/site/        docs site (Next.js) — a bun workspace member with a live link to the library
plans/            forward-looking specs (numbered, living)
wiki/             as-built docs: architecture, decisions, conventions, credits, research
scripts/          cross-workspace tooling (sync-site.mjs)
```

One `bun install` at the root covers everything (bun 1.3.14 + turbo).

## Knowledge layer: plans/ and wiki/

`plans/` is where the library is *going* (one numbered spec per topic, living);
`wiki/` is how it *works today* (as-built docs and decisions). History lives in
git and `packages/lingo/CHANGELOG.md`, not in the knowledge layer.

Read before acting:

- Touching a module → its `plans/NNN-*.md` spec (grammar, alias tables, ambiguity
  policy, API shapes live there).
- Designing or changing public API → `wiki/api-design.md` (and its checklist).
- Naming anything → `CONTEXT.md`; repo conventions → `wiki/conventions.md`.
- A surprising bug → `wiki/decisions.md` and `wiki/architecture.md` ("key
  mechanisms") first; it may be a documented trade-off or known gotcha.

Update when:

- Implementation forces a spec change → update the plan **in the same change**.
- A notable change lands → add it to `packages/lingo/CHANGELOG.md` under
  `[Unreleased]` in the same change. This is part of the definition of done.
- A consequential choice passes the offer-gate in `wiki/decisions.md` → add the
  D-entry there.
- You borrow an idea → `wiki/inspiration.md`, immediately, not at release time.
- A tangential idea surfaces mid-task → append it to `plans/backlog.md` and keep
  going. Don't act on it.

## Commands

Workspace root (bun + turbo):

- `bun dev` — library watch (`tsup --watch`, no dist clean) + site dev,
  concurrently via turbo; edit `packages/lingo/src` and the site picks up the
  rebuild through the live workspace link. Site port: 3000 by default, Next
  auto-increments when busy — read the actual port from the output.
- `bun kill` — stop all lingo dev processes: listeners on ports 3000–3003 AND
  this repo's tsup watchers (matched by cwd, so other repos' processes are
  never touched — `scripts/kill-dev.mjs`).
- `bun restart` — `kill` + `clean:cache` (all `.next*`/`.turbo` caches) +
  `bun dev`. Reach for it when dev state looks stale or a stray server blocks
  a port.
- `bun run check` — typecheck + test + build + size + corpus gate + zero-deps gate
- `bun run build` / `test` / `typecheck` / `size` — same, individually
- `bun run lint` / `lint:fix` — Biome via Ultracite, repo-wide (pins: biome
  2.4.16 / ultracite 7.8.2 — devDeps, lefthook, and the agent hook stay in sync)
- `bun run bench` / `ai-eval` / `demo` — filtered to the library package
- `bun run site:sync` — rebuild the library and refresh the site's served data
  files (`scripts/sync-site.mjs`; dist itself is a live workspace link)

Inside `packages/lingo/` the same scripts run directly (`bun run test`, etc.).

## Module map (packages/lingo/src)

- `core/` — types, unit registry, conversion math, rounding, unit-ref types
- `number/` — numeric literal + number-word parsing (locale separators, fractions)
- `parse/` — normalizer, tokenizer, quantity/range/conversion grammar
- `format/` — formatting, best-fit unit selection, compound output (5′11″)
- `units/` — pure data: unit tables per kind (length, mass, temperature, …)
- `fuzzy/` — fuzzy vocab ("hot", "a few") → ranges
- `messages/` — default human-readable issue copy (`./core` ships copy-free)
- `date/` — natural-language date/duration parsing + humanizing (entry `./date`)
- `describe/` — opt-in rich/resource value + result views (entry `./describe`)
- `catalog/` — read-only query API over unit/kind/currency data (entry `./catalog`)
- `dom/` — headless input controller (entry `./dom`)
- `element/` — custom-element wrapper over the DOM controller (entry `./element`)
- `react/` — React hook adapter (entry `./react`)
- `react-native/` — DOM-free React Native TextInput hook (entry `./react-native`)
- `ai/` — Standard Schema fields for LLM structured output (entry `./ai`)
- `mcp/` — Model Context Protocol tool helpers (entry `./mcp`)

## Site app

- The website lives in `apps/site/` (see `apps/site/AGENTS.md`). It is a
  workspace member — the root `bun install` covers it, and it consumes
  `@pascal-app/lingo` as a live link (fresh `dist/` after every build).
- `bun dev` from `apps/site/` serves port 3000 by default; Next auto-increments
  to the next free port when busy and prints which (owner directive 2026-07-04 —
  supersedes the old always-3111 rule).
- `bun restart` when CSS or route output looks stale; `bun run typecheck` (tsgo);
  `bun run build` for production (plain `bun build` is Bun's bundler — wrong).
- After changing library code, `bun run build` in `packages/lingo` (or
  `bun run site:sync` from the root, which also refreshes served data files).

## Behavioral guardrails

- Read the file before editing it. Plan all changes, then make one complete edit.
  If you've edited a file 3+ times, stop and re-read the requirements.
- After two consecutive tool failures, change approach — don't retry the same
  strategy.
- Re-read the original request every few turns to make sure you haven't drifted.
- When the user corrects you, stop and re-read their message before continuing.
- Don't write new comments unless they state a constraint the code can't show.
