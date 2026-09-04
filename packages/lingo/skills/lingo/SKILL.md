---
name: lingo
description: Parse natural-language quantities, units, dates, and ranges ("5'11\"", "1.5 cups", "72 in to cm", "three days ago", "between 5 and 10 kg", "it's hot") into canonical, validated values with issue codes and spans — and humanize them back. Use when a form input, LLM tool schema, MCP handler, or import pipeline takes free-text measurements/units/dates. Covers Standard Schema fields (quantityField/dateField/lingoObject) for the AI SDK and MCP, the headless <lingo-input>, unit conversion, and format/humanize round-trips. Zero-dependency TypeScript, deterministic.
metadata:
  author: pascalorg
  version: "1.1.0"
---

# lingo — natural-language quantities, units, dates & ranges

[`@pascal-app/lingo`](https://github.com/pascalorg/lingo) is a zero-dependency
TypeScript library that turns the strings people type and models emit —
`180cm`, `5ft 11`, `1.5 cups`, `90 min`, `next friday`, `1,5 kg`, `"5'11\""`,
`"twenty-five kg"`, `"3pm EST"` — into canonical, validated values: a quantity,
range, conversion, date, date-range, or duration in one canonical unit. It
converts, range-checks, and humanizes the value back. Every successful result
carries a `[start, end)` span into the original input plus any issues with stable
codes. It's **two-way**: default `format()`/`humanize*()` output re-parses to the
same value (display-only options like `localizedUnits` are outside the guarantee).

Tagline: **Make forms easier, LLM tools safer.**

> **Source of truth:** for anything past the patterns below — the full API, every
> unit and kind, all issue codes, and per-input examples — open
> `node_modules/@pascal-app/lingo/llms.txt` or
> [`lingo.pascal.app/llms.txt`](https://lingo.pascal.app/llms.txt).

## When to use this skill

Reach for lingo whenever a value arrives as free text and needs to become a
trustworthy stored value:

- **Web forms** — you're about to build a number box + unit dropdown. Use one
  text field instead: `180cm`, `2 lb 3 oz`, `an hour and a half`, typos with
  did-you-mean, fuzzy words (`it's hot`).
- **LLM tool / MCP boundaries** — a model returns `"5'11\""` or `"1,234 kg"` and
  your handler needs a safe number. Models emit strings more reliably than
  floats; lingo makes the string the safe path and rejects risky readings.
- **Data pipelines / imports** — normalizing messy measurement or date columns
  into canonical units without `Number()`/`new Date()` silently guessing wrong.
- **Anything that converts** (`72 in to cm`), **ranges** (`between 5 and 10 kg`,
  `under 10 minutes`, `10 ± 0.5 mm`), or **relative dates** (`three days ago`).

Do **not** reach for it for already-canonical typed numbers, generic calendar
scheduling or timezone-database work, arbitrary NLP extraction, or currency
conversion needing live FX (lingo returns `RATE_REQUIRED` — you inject rates).

## Install & entry points

```sh
npm i @pascal-app/lingo   # or bun / pnpm / yarn — zero runtime deps
```

Import only what you need; each subpath is tree-shakeable.

| Entry | Use for |
|-------|---------|
| `@pascal-app/lingo` | core parse/convert: `lingo`, `parseQuantity`, `parseRange`, `convert` |
| `@pascal-app/lingo/date` | dates, ranges & durations: `parseDate`, `parseDateRange`, `parseDuration`, `humanizeDate` |
| `@pascal-app/lingo/ai` | Standard Schema fields for LLM tools: `quantityField`, `dateField`, `lingoObject` |
| `@pascal-app/lingo/mcp` | `lingoTool()` — MCP tool with validation before the handler |
| `@pascal-app/lingo/dom` | headless `lingoInput()` controller for any `<input>` |
| `@pascal-app/lingo/react` | `useLingoInput()` hook |
| `@pascal-app/lingo/react-native` | DOM-free `useLingoTextInput()` hook for React Native `TextInput` |
| `@pascal-app/lingo/element` | `<lingo-input>` form-associated custom element |
| `@pascal-app/lingo/complete` | ranked autocomplete `completions()` |
| `@pascal-app/lingo/locales/{en,en-gb,es,fr,pt,zh,ja}` | opt-in parsing language packs |
| `@pascal-app/lingo/catalog` | query units/kinds/currencies |
| `@pascal-app/lingo/describe` | rich human/agent-readable views of a value or result |
| `@pascal-app/lingo/schema` | JSON Schema / OpenAPI generated from the v3 wire types |
| `@pascal-app/lingo/core` | copy-free core — same parse/convert API with no bundled issue messages |

## Pattern 1 — parse, validate, convert (core)

```ts
import { lingo, parseQuantity, parseRange } from "@pascal-app/lingo"

const height = parseQuantity("5'11\"", { kind: "length" })
if (height.ok) height.quantity.to("m").value // 1.8034

lingo("72 in to cm")               // { type: "conversion", converted: 182.88 cm }
parseRange("between 5 and 10 kg", { kind: "mass" }) // range 5..10 kg
```

`lingo(text, opts?)` returns a versioned union on `.type`
(`quantity | range | conversion | number | failure`), serialized as flat v3 JSON.
**Branch on `.ok` first.** Successes carry the value fields plus `span` and
`confidence`; a failure is `{ schemaVersion: 3, ok: false, type: "failure", text,
issues, candidate? }` — with no `span`/`confidence`. Surface `.issues[]` (each has
`code`, `severity`, `message`, and usually a `span`; field-level bound issues from
`/ai` may omit it) to the user.

Pass context to disambiguate: `{ kind, unit, currency, locale, system, strictness }`.
`strictness: "confirm"` turns each assumption (typo fix, ambiguous number) into a
failure carrying a `candidate`, so you can render a one-click confirmation.

## Pattern 2 — a natural-language form field

Headless controller — no styles shipped, canonicalizes on blur/Enter/submit,
never rewrites while the user is mid-type (`2 f` is *incomplete*, not *invalid*):

```ts
import { lingoInput } from "@pascal-app/lingo/dom"

const field = lingoInput(document.querySelector("#height"), {
  kind: "length", unit: "m", name: "height_m",
})
field.set("6ft")
field.commit() // hidden <input name="height_m"> submits the canonical value
// field.state → 'idle' | 'incomplete' | 'valid' | 'invalid'
```

React: `useLingoInput(opts)` from `@pascal-app/lingo/react`. Framework-agnostic
element: `defineLingoInput()` then `<lingo-input kind="length" unit="m" name="height_m">`.
React Native: spread `useLingoTextInput(opts).inputProps` onto `TextInput`.

## Pattern 3 — safe LLM tool / MCP boundary

The fields expose a **`string`** input JSON Schema (models are better at emitting
`"5'11\""` than `1.8034`) and hand your handler the **canonical** value. Risky
readings fail loudly: parser failures are `[CODE]`-prefixed and carry a
`candidate` when one exists (so a model can self-correct in one round trip);
schema-shape errors surface as plain Standard Schema messages.

```ts
import { tool, generateText } from "ai"
import { lingoObject, quantityField, dateField } from "@pascal-app/lingo/ai"

// `now` must be injected per request (fixed here for reproducibility) — not Date.now()
const now = new Date("2026-07-08T12:00:00Z")
const shipment = lingoObject({
  weight: quantityField({ kind: "mass", unit: "kg", min: 0, max: 500 }),
  deliverBy: dateField({ now }),   // relative dates REQUIRE now
})

await generateText({
  model,   // your AI SDK model, e.g. "anthropic/claude-opus-4-8" via the gateway
  tools: { create_shipment: tool({ inputSchema: shipment, execute: run }) },
})
```

MCP: wrap the same fields with `lingoTool({ name, description, input, handler })`
from `@pascal-app/lingo/mcp`; validation runs before `handler`, and failures
return `{ isError: true }` with `[CODE]`-prefixed text.

## Pattern 4 — one date field, three readings

`parseDateRange` reads a **time slot**, a **dated span**, or a **whole calendar
period**, so a single input can drive a slot picker, a day picker, or a
two-month range picker with no mode toggle for the person typing:

```ts
import { parseDateRange } from "@pascal-app/lingo/date"

parseDateRange("2pm to 4pm", { now })      // slot  → 14:00–16:00, no dated flag
parseDateRange("Aug 3 - Aug 9", { now })   // span  → Aug 3 → Aug 9, dated: true
parseDateRange("next week", { now })       // period→ Monday through Sunday
parseDateRange("August", { now })          // period→ Aug 1 → Aug 31, not just the 1st
parseDateRange("until August", { now })    // open start, ends Aug 31
```

Read `.dated` to know which grammar matched: `true` on date grammar, absent on
clock grammar (runtime-only; never serialized — test it truthy, not `=== false`).
Coarse endpoints widen on the *closing* side, so `July to August` ends Aug 31
while `from August` opens on the 1st; `this weekend` on a Sat/Sun is the weekend
in progress. Backwards absolute pairs (`2026-08-09 to 2026-08-03`) are swapped
with `RANGE_REVERSED` rather than handed back inverted, and overnight slots
(`9pm to 5am`) are left alone. `humanizeDateRange` round-trips both shapes.

**Not in the grammar**, returning `UNSUPPORTED_DATE` instead of guessing:
quarters (`Q3`, `next quarter`), elliptical right sides (`Aug 3-9`), and ISO
dates dash-joined with no spaces (`2026-08-01-2026-08-05` — use a spaced dash
or `to`). At an LLM boundary use `dateRangeField()`, which accepts all three
shapes and returns `{ start?, end?: ISO }`.

## Rules that keep you out of trouble

1. **Keep measurements as strings in tool/form schemas.** Let lingo convert,
   validate, surface spans, and handle ambiguity — don't ask the model or user
   for a float.
2. **Store the canonical value, display the humanized one.** Default `format()` /
   `humanizeDate()` output round-trips back to the same value (`1.9999 m` → `6′7″`,
   never `5′12″`); display-only options like `localizedUnits` don't round-trip.
3. **Always pass an explicit `now`** to `parseDate`/`dateField` for relative
   dates — never rely on `Date.now()`, so a queued or retried call can't drift
   across midnight. Reference-dependent input without `now` → `NOW_REQUIRED`.
   Timezones are detected but kept as civil time unless you pass `applyZone: true`;
   `/ai` `dateField` rejects an ignored zone (`TZ_IGNORED`) by default.
4. **No silent guesses.** Ambiguous input returns a deterministic best reading
   plus ranked `alternatives`/`candidate` and a warning code — show it, or use
   `strictness: "confirm"` / `"strict"` to force confirmation.
5. **Currency conversion needs injected rates** — `5 EUR to USD` returns
   `RATE_REQUIRED`; call `convertCurrency` with your own rates.
6. **Locale packs are opt-in.** English is built in; load others with
   `createLingo({ locales: [es, fr, …] })`. Omitting `locale` auto-detects among
   loaded packs plus English; requesting an explicit *unloaded* `locale` →
   `LOCALE_NOT_LOADED`.

Common issue codes to handle: `UNKNOWN_UNIT`, `KIND_MISMATCH`, `UNIT_REQUIRED`,
`AMBIGUOUS_NUMBER`, `AMBIGUOUS_UNIT`, `TYPO_CORRECTED`, `RANGE_MIN`/`RANGE_MAX`,
`RANGE_REVERSED`, `NOW_REQUIRED`, `TZ_IGNORED`, `UNSUPPORTED_DATE`,
`RATE_REQUIRED`, `LOCALE_NOT_LOADED`. That's the handful you'll actually branch
on; the full set of 33 stable codes is in `llms.txt`. Override any message via
the `messages` option.

## Full reference

This skill is the on-ramp; the exhaustive API, the complete kind/unit list, all
issue codes, and per-input examples live in the agent docs:

- **Offline** (after install): `node_modules/@pascal-app/lingo/llms.txt` — a
  compressed, self-contained reference.
- **Online:** [`lingo.pascal.app/llms.txt`](https://lingo.pascal.app/llms.txt)
  (index) → [`/docs/<section>.md`](https://lingo.pascal.app/docs/parse.md)
  per-topic, or [`/llms-full.txt`](https://lingo.pascal.app/llms-full.txt) for
  the complete narrative. Human docs with live demos:
  [`lingo.pascal.app/docs`](https://lingo.pascal.app/docs).
- **Repo & README:** [github.com/pascalorg/lingo](https://github.com/pascalorg/lingo).
