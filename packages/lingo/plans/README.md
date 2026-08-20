# Plans index

Forward-looking specs for lingo. One numbered markdown per topic. Plans are
**living specs**: when implementation forces a change, update the plan in the
same change. Plans hold specs only — grammar, alias tables, ambiguity policy,
API shapes. History belongs in git and `packages/lingo/CHANGELOG.md`; durable
"how it works now" prose belongs in `wiki/`. A plan whose work is fully shipped
and whose content is covered by wiki/code gets deleted, and its number retired
(numbers are stable once assigned, never reused).

## Conventions

- **Filename:** `NNN-kebab-title.md` — three digits, stable once assigned.
  Next free number: **035**.
- **Frontmatter:** `id`, `title`, `status`, `created`, `updated`. New plans
  (since 2026-07-04) also carry:
  - `goal:` — one-sentence done state.
  - `success_criteria:` — 1–4 terse pass/fail outcomes, each written as
    `"<measurable outcome> -> <proof artifact>"` (test name, script, report
    path, terminal output). When a criterion is settled, annotate it in place:
    `[MET: …]` / `[SKIPPED: … + why]`.
- **Status lifecycle:** `draft` → `approved` → `in-progress` → `done`, plus
  `deferred` (intentionally on hold — reason in the body) and `superseded`
  (link the successor). A short free-text note after an em dash is welcome and
  normal: `done — shipped 2026-07-04 (D20)`. If you need a status not on this
  list, add it here in the same change; otherwise the table is unfilterable.
- **Progress lives in body checklists**, not frontmatter percentages — a single
  percentage tends to be both inaccurate and unmaintained.
- **Tangential ideas** surfaced mid-task go to [`backlog.md`](backlog.md) —
  append, don't act.
- Big design decisions inside a plan get a `(locked-in YYYY-MM-DD)` marker on
  their heading; API sketches are real TypeScript signatures in fenced blocks,
  not prose.

## Plan anatomy (template for new plans)

````markdown
---
id: NNN
title: <Human title>
status: draft
created: YYYY-MM-DD
updated: YYYY-MM-DD
goal: "<one-sentence done state>"
success_criteria:
  - "<measurable outcome> -> <proof artifact>"
---

# <Title>

Driver: <the user need, review finding, or decision that motivates this — link it>

## Design principle
<!-- the one idea that settles arguments during implementation -->

## Design (locked-in YYYY-MM-DD)
<!-- real TS signatures for anything public; alias tables; grammar rules -->

## Changes
<!-- numbered, by module -->

## Non-goals
<!-- what this plan deliberately does not do -->

## Open questions
<!-- decisions still owed, and by whom -->

## Acceptance
<!-- which gates prove it done: bun run check, corpus class, eval gates, budgets -->
````

## Index

| # | Plan | Status |
|---|------|--------|
| 000 | [Vision & scope](000-vision-and-scope.md) | approved |
| 001 | [Architecture](001-architecture.md) | approved |
| 002 | [Number parsing](002-number-parsing.md) | approved |
| 003 | [Unit registry & conversion](003-unit-registry-and-conversion.md) | approved |
| 004 | [Quantity grammar](004-quantity-grammar.md) | approved |
| 005 | [Dates & durations](005-dates-and-durations.md) | approved |
| 006 | [Fuzzy language](006-fuzzy-language.md) | approved |
| 007 | [Formatting & humanization](007-formatting-and-humanization.md) | approved |
| 008 | [DOM input & masking](008-dom-input-and-masking.md) | approved |
| 009 | [Errors & suggestions](009-errors-and-suggestions.md) | approved |
| 010 | [Testing strategy](010-testing-strategy.md) | approved |
| 011 | [Packaging, DX & release](011-packaging-dx-and-release.md) | approved |
| 012 | [Agent & LLM friendliness](012-agent-and-llm-friendliness.md) | done |
| 013 | [i18n roadmap](013-i18n-roadmap.md) | in-progress |
| 014 | [Strictness, acceptance & error escalation](014-strictness-and-acceptance.md) | approved |
| 018 | [Performance benchmarking](018-performance-benchmarking.md) | in-progress — browser suites + CI posture pending |
| 019 | [AI structured output & agent form filling](019-ai-structured-output.md) | done |
| 020 | [Tool-boundary safety defaults (/ai v2)](020-tool-boundary-safety.md) | done |
| 021 | [MCP integration](021-mcp-integration.md) | in-progress — phases 1–2 shipped; phase 3 demo server optional |
| 024 | [Ecosystem integration & docs enrichment](024-ecosystem-integration-and-docs.md) | done |
| 025 | [Schema clarity & DX (wire v3)](025-schema-clarity-and-dx.md) | done |
| 026 | [Currency](026-currency.md) | done |
| 027 | [Type inference](027-type-inference.md) | done |
| 028 | [Resource-style output](028-resource-style-output.md) | done |
| 029 | [Schema reference & adapters](029-schema-reference-and-adapters.md) | in-progress |
| 030 | [Time-of-day, timezones & slots](030-time-of-day-timezone-and-slots.md) | done |
| 031 | [Ranked completions (autocomplete anything)](031-completions.md) | approved |
| 031 | [Locale packs](031-locale-packs.md) | in-progress |
| 032 | [Input calculations (quantity arithmetic)](032-input-calculations.md) | draft |
| 033 | [Locale idiom coverage](033-locale-idiom-coverage.md) | in-progress — waves 1–2 shipped (D68/D69/D70) |
| 034 | [React Native text input](034-react-native-input.md) | done |

Retired numbers (plans deleted after shipping; content lives in wiki/code):
015–017, 022–023.

Parking lot: [`backlog.md`](backlog.md) — ideas with no number yet.
