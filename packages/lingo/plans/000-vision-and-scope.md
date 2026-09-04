---
id: 000
title: Vision & scope
status: approved
created: 2026-07-03
updated: 2026-07-07
---

# Vision & scope

## One-liner

**Make forms easier, LLM tools safer.** All communication and feature decisions
trickle down from this line, serving four consumers: humans filling forms, LLMs
calling tools, API developers, MCP integrations (plans 019/020/021).

lingo turns messy human input — "2 ft", "5'11\"", "72 in to cm", "between 5 and
10 kg", "three days ago", "it's hot" — into precise, canonical, convertible
values, and turns values back into human language. The same parser canonicalizes
what models emit into tool calls and forms, so structured output means what it
should. Zero dependencies, drop into any JavaScript app.

## Why

Every form that asks for a height, weight, duration, temperature or date forces humans
to think like databases: pick the right unit, the right format, the right locale. The
tooling exists in fragments — chrono-node parses dates (but is date-only and sizable),
convert-units converts (but doesn't parse text), Intl formats (but doesn't parse),
masking libs constrain keystrokes (but don't understand meaning). Nothing unifies
*parse → canonicalize → convert → validate → humanize* behind one tiny, dependency-free
API. libphonenumber-js proved this model for phone numbers; lingo generalizes it
to quantities and time.

## Product principles

1. **Forgiving in, canonical through, human out.** Accept any reasonable way to write a
   value (typos included); store one canonical metric/SI representation; emit whatever
   unit/style the UI wants.
2. **Two-way.** Everything we can format/humanize, we can re-parse. `parse(format(x)) ≈ x`
   is a tested invariant, not an aspiration.
3. **Tiny and dependency-free.** The whole point is being droppable anywhere: `<script>`
   tag, RSC, edge function, Node CLI, browser extension. Budgets in plan 001.
4. **Honest about ambiguity.** "5m" (meters or minutes?), "1,500" (1.5 or 1500?),
   "5/3" (May 3 or March 5?) — return a best interpretation *plus* ranked alternatives
   and confidence, never a silent guess when context doesn't decide.
5. **Errors are UX.** Structured errors with input spans and did-you-mean suggestions,
   designed to be shown next to a form field and announced to screen readers.
6. **Agent-native.** JSON-serializable results, deterministic (explicit `now`),
   discriminated unions, llms.txt — trivially usable by LLM agents filling forms.

## Scope

- **Kinds**: 33 built-in kinds — the everyday set (length, mass, temperature,
  duration, volume, area, speed, data, pressure, energy, angle, percent),
  scientific kinds (force, power, frequency, voltage, current, resistance,
  charge, and the rest of the plan 001 table), and currency (plan 026:
  parse/validate/format in-library; cross-currency conversion via injected
  rates). English parsing; formatting locale-aware via Intl.
- **Parsing**: numbers (decimals, separators, fractions ½/1 1/2, scientific, number
  words "twenty-five", fuzzy amounts "a couple"), units (aliases, unicode symbols,
  typo suggestions), compounds (5'11", 1m80, 1h30, 2lb 3oz), ranges (5–10 kg, between,
  ±, open-ended "under 10 min"), qualifiers (about/at least/roughly), conversion
  requests ("72 in to cm"), fuzzy temperature words ("hot").
- **Dates/durations** (`@pascal-app/lingo/date`): deictic + offset + weekday + common absolute
  formats; time-of-day, timezones, and time ranges/slots (plan 030); humanize with
  round-trip guarantee. (Per D11, dates stay in their own entry rather than the
  main bundle.)
- **Conversion & formatting**: SI-anchored conversion incl. temperature offsets and
  deltas; format with unit styles, compound output (5′11″), best-fit unit selection.
- **DOM** (`@pascal-app/lingo/dom`): headless controller for any `<input>` — parse-as-you-type
  hint, blur canonicalization, hidden canonical field for form submit, Constraint
  Validation + ARIA error surfacing, data-attribute styling hooks.
- **React** (`@pascal-app/lingo/react`): `useLingoInput` hook.

## Non-goals

- Bundled FX rates or rate fetching (currency conversion takes caller-injected
  rates — plan 026).
- Full NER over long documents (we scan short inputs; `findQuantities` is
  best-effort).
- Non-English parsing (architecture reserves space — plan 013; formatting is already
  locale-aware via Intl).
- Compound dimension algebra (kg⋅m/s² arithmetic) — we are an input library, not a CAS.

## Success criteria

- Parse corpus ≥ 400 cases green, incl. adversarial unicode/typo cases.
- Round-trip invariants hold across all kinds and humanize styles.
- Size budgets met (plan 001), `npm pack` is clean, publishable as `@pascal-app/lingo@0.1.0`.
- A form field demo where typing "5'11" into a meters-only field just works, with
  accessible errors for garbage input.

## Name

npm: `@pascal-app/lingo` — "Human input, structured value."
