# lingo

**Make forms easier, LLM tools safer.**

Docs with live demos: [lingo.pascal.app](https://lingo.pascal.app) · every
section as agent-readable markdown:
[lingo.pascal.app/llms.txt](https://lingo.pascal.app/llms.txt)

lingo parses what humans type and what models emit: natural-language quantities,
units, dates, and ranges. It turns them into canonical, validated values and
humanizes them back. Zero runtime dependencies. The size gate lives in
`scripts/size.mjs`, and the package includes thirty-three built-in kinds
(chrono-node needs 35 kB for dates alone). English is the default; opt-in locale
packs (`createLingo({ locales })`, `@pascal-app/lingo/locales/*`) add number words,
grammar, units, and relative-date idioms for Spanish, French, Portuguese,
Chinese, Japanese, and en-GB. Wave-1 packs cover Romance number composition,
CJK number tokens, localized date grammar, and per-locale corpus gates. Number
*formatting* is locale-aware via `Intl` in every locale; `humanizeDate()` output
stays English for now.

```ts
import { lingo, parseQuantity, convert, tryConvert } from '@pascal-app/lingo'

parseQuantity(`5'11"`).quantity.to('m').value   // 1.8034
parseQuantity('72 in to cm').quantity.value     // 182.88  (honors the request)
convert(72, 'in', 'ft')                          // 6
const t = tryConvert(72, 'in', 'cm')
t.ok && t.value                                   // 182.88

lingo('between 5 and 10 kg')     // { type: 'range',      range:  5 to 10 kg }
lingo('10 ± 0.5 mm')             // { type: 'range',      plusMinus ... }
lingo('a few minutes')           // { type: 'range',      2 to 4 min, approximate }
lingo("it's hot", { kind: 'temperature' })
                                 // { type: 'range',      27 to 35 °C, fuzzy: 'hot' }
lingo('an hour and a half')      // { type: 'quantity',   5400 s }
lingo('1,5 kg')                  // 1.5 kg. Separator policy, not locale sniffing.
lingo('5 meterz', { kind: 'length' })
                                 // 5 m + warning TYPO_CORRECTED ("meterz" → m)
```

People type it quick and abbreviated: `180cm`, `5ft 11`, `1m80`, `72 in`,
`1.5 cups`, `500 KB`, `5 Mbps`, `5 gpm`, `500 mAh`, `$1,234.50`, `50p`,
`about 20C`, `under 10 minutes`. Models and pasted text bring the fluent,
typographic forms: `5'11"`, `1½ cups`, `twenty-five kg`, `3×10⁵ m`,
`10 inH₂O`, `1 kgf/cm²`, `5 uM`, `9.8 m/s²`, `10 Nm`, `500 lux`, `20 mSv`,
`fifty cents`. Your database wants one number in one unit. The library is the
layer in between: **forgiving in, canonical through, human out.**

## Why lingo

- **Actually parses language.** Number words ("an hour and a half"), unicode
  (`½`, `μm`, `℃`, `′ ″`, curly quotes), typos with did-you-mean, compounds
  (`5'11"`, `2 lb 3 oz`, `1h30`), ranges, tolerances, qualifiers ("about",
  "at least"), conversion requests ("72 in to cm"), and fuzzy words ("hot") when
  you opt a field into them.
- **Canonical underneath.** Every value normalizes to an SI-anchored base (meters,
  kilograms, kelvin, seconds) or a self-canonical currency unit, with exact legal
  conversion factors, never rounded anchors. Temperature *deltas* convert
  correctly (a 5 °C rise is a 9 °F rise).
- **Two-way.** Everything default `format()` emits, `parse()` reads back. Tests
  enforce the invariant. `localizedUnits: true` is the explicit display-only
  escape hatch for Intl unit words the English parser cannot read yet.
  `1.9999 m` formats as `6′7″`, never `5′12″`.
- **Honest about ambiguity.** `1,234` (dot-decimal? comma-decimal?), `5m` (meters?
  minutes?), `ton` (which ton?) return a deterministic best reading, ranked
  discriminated alternatives, and structured warnings. The parser does not guess silently.
- **Errors are UX.** Every issue has a stable code, a human message you can
  override, an input span for highlighting, and did-you-mean suggestions.
- **Tiny and dependency-free.** No runtime deps. Tree-shakeable. `Intl` handles
  locale number formatting, so the main entry ships no locale data — parser locale
  packs are opt-in `@pascal-app/lingo/locales/*` subpaths you load explicitly.

## Performance

lingo is designed to be cheap enough to run while someone types, and fast enough
to validate large imports without a worker queue.

The checked-in baseline uses a deterministic generated-English corpus built from
the library's own aliases, number forms, qualifiers, ranges, conversions, typos,
dates, durations, and sentence templates. On the local Node v24.5.0 backend
baseline in this repo:

- A normal single-value field parsed **492,739 values/second** across
  **900 generated cases**, about **2.03 µs per input**.
- Strict bulk validation without did-you-mean suggestions ran at
  **550,270 checks/second** across **240 generated unknown-unit cases**,
  about **1.82 µs per row**.
- Scanning generated sentences for values ran at **53,533 scans/second** across
  **260 cases**.
- A no-match stress test over 50,000 characters finished in **0.341 ms**.

Those numbers are a machine-local snapshot, not a universal promise. The point
is the order of magnitude: ordinary parsing is microsecond-scale, so debounce is
a UX choice, not something the parser needs to survive. Reproduce with
`bun run bench:backend`; the checked-in baseline lives in
`bench/baseline-node.json`.

## Install

```sh
npm install @pascal-app/lingo
```

Coding agents: the package ships an inline reference at
`node_modules/@pascal-app/lingo/llms.txt` (also at
[lingo.pascal.app/llms-small.txt](https://lingo.pascal.app/llms-small.txt)).
Online, start at [lingo.pascal.app/llms.txt](https://lingo.pascal.app/llms.txt).

## The 5-minute tour

### Parse

```ts
import { lingo, parseQuantity, parseRange } from '@pascal-app/lingo'

const r = parseQuantity('2 ft', { kind: 'length' })
if (r.ok) {
  r.quantity.value        // 2 (in ft)
  r.quantity.base         // 0.6096 (meters, canonical)
  r.quantity.to('cm').value  // 60.96
  r.confidence            // 1
  r.issues                // [] on success; warnings/infos still appear here
}

// lingo() returns a versioned discriminated union. Switch on .type.
const g = lingo('5-10 kg in lb')
// g.type === 'conversion'; g.converted is a QuantityRange in pounds
```

Serialized parse results are **flat v3**: `{ schemaVersion: 3, ok, type, …value
fields…, text, span, issues, confidence }`. A quantity is
`{ …, type: 'quantity', kind, value, unit, base, baseUnit, … }` right at the top
(no nesting); a conversion has `source` + `converted` (no redundant
`targetUnit`); failures use `type: 'failure'` and may include a full `candidate`.
Every result and issue carries a `span: { start, end, text }` — half-open UTF-16
offsets into the original input plus the matched substring, so `span` reads for
itself (`input.slice(start, end) === span.text`).
`ok: false` means at least one `error`-severity issue; warnings (`AMBIGUOUS_NUMBER`,
`TYPO_CORRECTED`, `RANGE_REVERSED`, and others) accompany successful parses so you can surface
them or ignore them. A machine-readable JSON Schema, OpenAPI, and ready-made
Zod/Valibot/TypeBox/ArkType/Effect schemas live in `@pascal-app/lingo/schema`.

Need a richer view for docs, logs, or tool output? Keep `toJSON()` for compact
wire storage and import `describeResource()` for direct `lingo.quantity` /
`lingo.range` resources, or `describeResult()` for whole parse-result resources
with issues and source spans:

```ts
import { lingo, parseQuantity } from '@pascal-app/lingo'
import { parseDate, parseDuration } from '@pascal-app/lingo/date'
import { describeResource, describeResult } from '@pascal-app/lingo/describe'

const parsed = parseQuantity('72 in')
parsed.ok && describeResource(parsed.quantity)
// {
//   object: 'lingo.quantity',
//   kind: 'length',
//   value: { amount: 72, unit: { id: 'in', symbol: 'in', name: 'inch', ... } },
//   canonical: { amount: 1.8288, unit: { id: 'm', symbol: 'm', name: 'meter', ... } },
//   formatted: '72 in'
// }

const result = describeResult(lingo('72 in to cm'))
result.data
// {
//   object: 'lingo.conversion',
//   source: { object: 'lingo.quantity', value: { amount: 72, unit: { id: 'in', ... } }, ... },
//   target: { unit: { id: 'cm', symbol: 'cm', name: 'centimeter' } },
//   converted: { object: 'lingo.quantity', value: { amount: 182.88, unit: { id: 'cm', ... } }, ... },
// }

describeResult(parseDate('5/3/2026', { now })).data
// { object: 'lingo.date', value: { iso: '...', epochMilliseconds: ... }, calendar: { year: 2026, month: 5, day: 3 }, grain: 'day', ... }

describeResult(parseDuration('1h30')).data
// { object: 'lingo.duration', value: { amount: 1.5, unit: { id: 'h', ... } }, canonical: { amount: 5400, unit: { id: 's', ... } }, parts: [...] }
```

### Strictness & error escalation

Use one dial for field personality, then override the pieces that matter:

| mode | behavior |
|------|----------|
| `forgiving` | Default. Typos, ambiguities, slang and assumptions can succeed with warnings/infos. |
| `confirm` | Assumption-class issues escalate to `error`; the would-have-been result is attached as `candidate`. |
| `strict` | `confirm` plus typo fixing off, number words/fuzzy/approximations/bare-number assumptions rejected. |

```ts
const r = lingo('5 meterz', { kind: 'length', strictness: 'confirm' })

if (!r.ok && r.candidate?.type === 'quantity') {
  r.issues[0].code              // "TYPO_CORRECTED"
  r.candidate.quantity.format() // "5 m"
}
```

Candidate UX is built into the DOM layer:

```ts
lingoInput(input, {
  kind: 'length',
  strictness: 'confirm',
  hintElement: '#hint',
  formatCandidate: (candidate) =>
    candidate.type === 'quantity'
      ? `Use ${candidate.quantity.format()}`
      : 'Use this value',
})
```

Acceptance switches reject whole shapes while keeping a candidate:

```ts
lingo('5-10 kg', { accept: { ranges: false } })       // SINGLE_VALUE_EXPECTED + candidate range
lingo('72 in to cm', { accept: { conversions: false } }) // CONVERSION_NOT_ALLOWED + candidate
lingo('about 5 kg', { accept: { approximations: false } }) // APPROX_NOT_ALLOWED + candidate
```

Tolerance switches control how hard the parser tries:

```ts
lingo('5 meterz', { kind: 'length', tolerance: { typos: 'suggest' } })
// ok:false, UNKNOWN_UNIT suggestions ["m"], candidate parses as 5 m
```

Escalate surgically and customize copy independently:

```ts
parseQuantity('72', {
  kind: 'length',
  unit: 'cm',
  escalate: { UNIT_ASSUMED: 'error' },
  messages: { UNIT_ASSUMED: 'Confirm the unit before saving.' },
})
```

### Convert & format

```ts
import { quantity, convert, convertDelta, tryConvert } from '@pascal-app/lingo'

convert(100, 'C', 'F')          // 212        (absolute)
convertDelta(5, 'C', 'F')       // 9          (a difference; offsets don't apply)
convert(1, 'gal', 'L')          // 3.785411784 (exact; aliases work as refs)
convert(20, 'MB/s', 'Mbit/s')   // 160        (data rates are bits/s underneath)
convert(5, 'gpm', 'l/min')      // 18.92705892 (flow rates are m³/s underneath)
convert(1, 'M', 'μM')           // 1000000    (concentrations are mol/m³ underneath)
convert(1, 'g0', 'm/s2')        // 9.80665    (standard gravity; bare "g" is grams)
convert(10, 'N*m', 'lbf*ft')    // 7.37562149 (torque; declared units, not unit algebra)
convert(1, 'fc', 'lx')          // 10.7639104167 (illuminance)
convert(10, 'inH2O', 'Pa')      // 2490.8891  (water-column pressure is declared, not unit algebra)
convert(1, 'kgf/cm2', 'kPa')    // 98.0665    (older pressure gauges)
const targetUnit: string = 'cm'
tryConvert(5, 'kg', targetUnit) // ok:false + structured issue instead of throwing

quantity(1500, 'm').toBest().format()            // "1.5 km"
quantity(1.8034, 'm').format({ compound: ['ft', 'in'] })  // "5′11″"
quantity(2, 'ft').format({ style: 'long' })      // "2 feet"
quantity(0.5, 'kg').format({ locale: 'de-DE' })  // "0,5 kg"
quantity(1, 'm').format({ locale: 'fr-FR', style: 'long' }) // "1 meter" (parseable)
quantity(1, 'm').format({ locale: 'fr-FR', style: 'long', localizedUnits: true }) // "1 mètre" (display-only)

convert(1, 'hp', 'W')                            // 745.699872 — force/power/frequency plus electrical + mole units
lingo('500 mAh').quantity.to('C').value          // 1800 — battery charge is coulombs underneath
lingo('5 uM').quantity.to('mol/m3').value        // 0.005 — concentration shorthands are exact-case
lingo('20 mSv').quantity.to('Sv').value          // 0.02 — radiation equivalent dose is separate from gray
lingo('5 MBq').quantity.to('Bq').value           // 5000000 — radioactivity is becquerels underneath
lingo('1 kgf/cm²').quantity.to('kPa').value      // 98.0665 — use kgf/cm²; kg/cm² stays deferred
quantity(3e5, 'm').format({ notation: 'scientific' })   // "3e5 m" (also 'engineering'; every style re-parses)
```

Literal `Quantity.to()` / `QuantityRange.to()` targets are same-kind checked
too; dynamic strings still validate at runtime.

Bare `bps` is finance shorthand for basis points. Use `bit/s`, `kbit/s`, or
network spellings such as `Mbps` when you mean bits per second.
Untyped glued `1M` stays rejected because `M` is a future multiplier hazard;
use `1 M` or pass `kind: 'concentration'` for molar fields.

### Currency

Currency is built in — parse symbols and codes, format via `Intl`, and convert
with **your own rates** (exchange rates aren't static, so lingo never bundles or
fetches them — no hidden clock, no network):

```ts
import { lingo, quantity, convertCurrency, fromMinor } from '@pascal-app/lingo'

lingo('$5')                     // 5 USD + AMBIGUOUS_UNIT (bare "$" is ambiguous)
lingo('$5', { currency: 'CAD' }) // 5 CAD        (explicit currency context)
lingo('50 cents')               // 0.5 USD + AMBIGUOUS_UNIT (cent currency is ambiguous)
lingo('50 cents', { currency: 'EUR' }) // 0.5 EUR
lingo('five dollars and fifty cents').quantity.value // 5.5
lingo('50p')                    // 0.5 GBP
lingo('3 quid 50').quantity.value // 3.5
lingo('between $5 and $10')     // 5–10 USD range + AMBIGUOUS_UNIT warnings
lingo('5 bucks').quantity.unit  // 'USD'         (slang + ISO codes + names)

quantity(5, 'USD').format()     // "$5.00"       (Intl; round-trips)
quantity(5, 'USD').toMinor()    // 500           (Stripe integer minor units; JPY→0, KWD→3 decimals)
fromMinor(500, 'USD').value     // 5

convertCurrency(100, 'USD', 'EUR', { rates: { base: 'USD', rates: { EUR: 0.92 } } }) // 92
// cross-currency convert()/.to() throws WITHOUT rates — never a silent wrong answer
tryConvert(100, 'USD', 'EUR') // ok:false, RATE_REQUIRED issue
```

### Type-safe by default

Unit refs are literal-typed from the registry, so cross-kind and unknown-unit
mistakes are **compile errors** — zero runtime cost. Dynamic strings still work
(the escape hatch), so nothing breaks at the boundary:

```ts
convert(5, 'in', 'cm')   // ✅ number
tryConvert(5, 'in', 'cm') // ✅ { ok:true, value, unit, kind }
quantity(5, 'kg')        // ✅ Quantity<'mass'> — kind inferred from the unit
fromMinor(500, 'USD')    // ✅ Quantity<'currency'>

const tenant = createLingo()
tenant.convert(5, 'in', 'cm') // ✅ built-in instances keep the same checks
tenant.tryConvert(5, 'in', 'cm') // ✅ non-throwing instance equivalent

// @ts-expect-error 'kg' is mass, 'cm' is length — caught before you run it
convert(5, 'kg', 'cm')
// @ts-expect-error tryConvert keeps the same literal-unit check
tryConvert(5, 'kg', 'cm')
// @ts-expect-error 'nope' isn't a unit
quantity(5, 'nope')

const u: string = userInput
quantity(5, u)           // ✅ still compiles — validated at runtime
tryConvert(5, u, 'cm')   // ✅ dynamic refs return ok:false issues instead of throwing
```

### Dates & durations: `@pascal-app/lingo/date`

```ts
import { parseDate, parseDuration, humanizeDate, humanizeDuration } from '@pascal-app/lingo/date'

parseDate('three days ago', { now })         // exact Date, grain 'day'
parseDate('next tuesday', { now })           // + alternative interpretation attached
parseDate('5/3', { dayFirst: true })         // March 5 vs May 3; AMBIGUOUS_DATE
humanizeDate(d, { now })                     // "3 days ago"; always re-parseable
parseDuration('PT1H30M').duration.base       // 5400 (seconds)
humanizeDuration(5400, { style: 'natural' }) // "an hour and a half"
```

Times of day, timezones, and slots parse too. Zones are **exposed** by default
(the civil wall-clock is kept); pass `applyZone` to resolve the real UTC instant:

```ts
import { parseDate, parseDateRange, humanizeDateRange } from '@pascal-app/lingo/date'

parseDate('17h30', { now })                  // 17:30, grain 'minute'
parseDate('quarter past 5', { now })         // 05:15
parseDate('3pm EST', { now }).zone           // { source:'abbrev', offsetMinutes:-300, ... }
parseDate('3pm EST', { now, applyZone: true }).date // the real 20:00Z instant

const slot = parseDateRange('2pm to 4pm', { now }) // { start, end } endpoints
parseDateRange('9-5', { now })               // workday shift → 09:00–17:00
parseDateRange('from 3pm', { now })          // open-ended (no end)
humanizeDateRange(slot)                      // "2:00 PM to 4:00 PM" — re-parseable
```

`parseDateRange` reads calendar ranges too, so one field can take a slot, a
dated span, or a whole period without a mode toggle:

```ts
parseDateRange('Aug 3 - Aug 9', { now })     // dated span, day grain
parseDateRange('July 1 to July 5', { now })  // the end resolves against the start
parseDateRange('next week', { now })         // Monday through Sunday
parseDateRange('August', { now })            // Aug 1 → Aug 31, the whole month
parseDateRange('until August', { now })      // open start, ends Aug 31
parseDateRange('this weekend', { now })      // Sat–Sun; on a Sat/Sun, the one in progress
parseDateRange('2026-08-09 to 2026-08-03', { now })
                                             // swapped + RANGE_REVERSED warning
```

A coarse endpoint widens on the *closing* side, which is why `July to August`
ends on August 31 while `from August` still opens on the 1st. The result carries
a `dated` flag saying which grammar matched, and `humanizeDateRange` renders
dated ranges as dates (`"2026-08-01 to 2026-08-31"`) rather than clock times.
Quarters (`Q3`), elliptical right sides (`Aug 3-9`), and dash-joined ISO dates
with no spaces (`2026-08-01-2026-08-05`) are not in the grammar and return
`UNSUPPORTED_DATE` instead of a guess.

The humanizer's output is guaranteed re-parseable by the parser (round-trip tested):
`parseDate(humanizeDate(d, { now }), { now })` lands within one display-grain of `d`.

### Forms: `@pascal-app/lingo/dom`

Turn any `<input>` into a natural-language field. Headless: no styles shipped,
state exposed as data-attributes.

```ts
import { lingoInput } from '@pascal-app/lingo/dom'

const field = lingoInput(document.querySelector('#height'), {
  kind: 'length',
  unit: 'm',              // canonical unit received by your backend
  name: 'height_m',       // hidden input carries "1.8034" on submit
  errorElement: '#height-error',
  hintElement: '#height-hint',
})

// user types: 5'11     -> hint shows "= 1.80 m", state 'valid'
// user types: 5 f      -> state 'incomplete' (never invalid mid-typing)
// user types: banana   -> on blur: aria-invalid, error text + announcement
// on blur              -> input shows "1.8 m" (display: 'canonical')

field.value      // 1.8034 (number, in meters)
field.set('6ft') // programmatic input works too
```

Accessibility is built in, not bolted on: `aria-invalid`, `aria-describedby` wired
only while an error exists, debounced visual hints while typing,
`role="alert"` commit errors, Constraint Validation integration
(`validationBehavior: 'native'`), IME-composition safe, `:user-invalid` timing.

Style it with attribute selectors:

```css
[data-lingo][data-state='invalid'][data-touched] { border-color: crimson; }
[data-lingo][data-approx] { border-style: dashed; }
```

### React: `@pascal-app/lingo/react`

```tsx
import { completions } from '@pascal-app/lingo/complete'
import { useLingoInput } from '@pascal-app/lingo/react'

function HeightField() {
  const field = useLingoInput({
    kind: 'length',
    unit: 'm',
    name: 'height_m',
    listboxId: 'height-options',
    complete: (text) => completions(text, { kind: 'length' }),
  })
  return <input ref={field.ref} placeholder={`try 5'11" or 180cm`} />
}
```

The hook exposes `completions`, `highlightedIndex`,
`setHighlightedIndex()`, and `selectCompletion()` for a caller-rendered
listbox. `./complete` stays an injected import; `./react` does not bundle it or
ship popup UI.

### React Native: `@pascal-app/lingo/react-native`

```tsx
import { Text, TextInput, View } from 'react-native'
import { useLingoTextInput } from '@pascal-app/lingo/react-native'

function WeightField() {
  const field = useLingoTextInput({
    kind: 'mass',
    unit: 'kg',
    min: 0,
    max: '500 kg',
  })
  return (
    <View>
      <TextInput {...field.inputProps} placeholder="165 lb or 75 kg" />
      {field.errorMessage ? <Text>{field.errorMessage}</Text> : null}
    </View>
  )
}
```

`onChangeText` parses without rewriting, while blur, submit, or `commit()`
canonicalizes the display. `value` is the canonical number and `submitValue`
is the backend-ready string. Inject `complete` from `./complete` for ranked
suggestions (`completions` / `selectCompletion()`); render them with your own
`FlatList`. The entry imports React only—there is no DOM controller,
`react-native` runtime dependency, or bundled completion UI.

### Web components: `@pascal-app/lingo/element`

A form-associated custom element for design systems with no framework
adapter. It uses the same parser, wired through `ElementInternals` instead of a
hidden input:

```html
<script type="module">
  import { defineLingoInput } from '@pascal-app/lingo/element'
  defineLingoInput()
</script>
<form>
  <lingo-input name="height_m" kind="length" unit="m"></lingo-input>
</form>
```

`<lingo-input>` keeps a real `<input type="text">` in light DOM, not shadow
DOM, so native labels and page CSS keep working, and `FormData`, `:invalid`,
and `formResetCallback` behave like any native control, in Vue, Svelte,
Angular, or plain HTML.

Using React Hook Form, TanStack Form, Formik, Vue, Angular, or shadcn
instead? Each has its own recipe in [`docs/recipes.md`](https://github.com/pascalorg/lingo/blob/main/packages/lingo/docs/recipes.md).
They use the same fields and the same scoped form-UX case: collapse one value + one unit
dropdown into a single text field, not "replace the whole form with a
sentence."

### Completions: `@pascal-app/lingo/complete`

`completions(input, opts)` returns **ranked, fully-parsed** canonical readings of
partial or ambiguous input — prefix fan-out, unit-ambiguity forks, number
alternatives, implied units, range-tail units — each a `text` plus a successful
quantity/range/conversion result. It powers comboboxes and is distinct from a parse
candidate/alternative/suggestion.

```ts
import { completions } from '@pascal-app/lingo/complete'

completions('2 f', { kind: 'length' }).map((c) => c.text)
// ['2 ft', '2 ft-us', '2 fathom', '2 furlong', …]
completions('5', { kind: 'length' }).map((c) => c.text)
// ['5 m', '5 ft', '5 cm', '5 in', '5 km', '5 mi']
```

The DOM field and React hook are headless about this too: inject `complete`,
render your own dropdown, and use `onComplete` or the hook's completion state.
When completions are enabled the input gets the combobox side of the ARIA
contract (`role="combobox"`, `aria-autocomplete="list"`, `aria-expanded`), and
`listboxId` sets `aria-controls` for your listbox.

## Extending

```ts
import { registerKind, registerUnits, defineFuzzyVocab } from '@pascal-app/lingo'

registerUnits('length', [{ id: 'smoot', symbol: 'smoot', name: 'smoot',
  factor: 1.702, system: 'us', aliases: ['smoots'] }])

defineFuzzyVocab('mass', { profile: 'parcels', unit: 'kg',
  terms: { light: [0, 5], heavy: [20, 70] } })
// lingo('heavy', { kind: 'mass', profile: 'parcels' }) -> 20 to 70 kg
```

Custom kinds (static-rate currencies, house scores, and similar local units) get parsing, conversion,
formatting, and did-you-mean for free. For a minimal build, `@pascal-app/lingo/core`
ships the engine with an empty registry. Bring only the kinds you need (core
ships without English error copy; register it with
`setDefaultMessages(englishMessages)` or bring your own via `messages`).
Registry inspection APIs such as `unitsOf()` return live definitions. Mutating them
is an advanced escape hatch, at your own risk.

Need isolation instead of globals for SSR, multi-tenant apps, or tests? Built-in
`createLingo()` returns a typed instance with its own registry, messages, and
fuzzy vocab; custom `kinds`/`registry` instances keep broad string refs because
their vocabulary is user-owned. Nothing you register on an instance (or mutate
after passing in) leaks anywhere else:

```ts
import { createLingo } from '@pascal-app/lingo'

const metricOnly = createLingo({ messages: { UNKNOWN_UNIT: 'Metric units only.' } })
metricOnly.parse('5 kg')          // isolated instance, same API
```

Parse non-English input by loading packs on an instance — English stays the default:

```ts
import { createLingo } from '@pascal-app/lingo'
import { parseDate } from '@pascal-app/lingo/date'
import { es } from '@pascal-app/lingo/locales/es'
import { zh } from '@pascal-app/lingo/locales/zh'

const app = createLingo({ locales: [es, zh] })
app.parse('dos kg', { locale: 'es' })           // 2 kg
app.parse('al menos 2 m', { locale: 'es' })     // ≥ 2 m  (open range)
app.parse('entre 5 y 10 kg', { locale: 'es' })  // 5–10 kg

const spanish = app.parseQuantity('treinta y cinco kilos', { locale: 'es' })
spanish.ok && spanish.quantity.to('kg').value   // 35

const chinese = app.parseQuantity('三十五公斤', { locale: 'zh' })
chinese.ok && chinese.quantity.to('kg').value   // 35

// comparators that follow the quantity, as CJK writes them
app.parse('5キロ未満', { locale: 'ja' })          // < 5 kg  (open range)
app.parse('5公斤以上', { locale: 'zh' })          // ≥ 5 kg
app.parse('100元', { locale: 'zh' })             // 100 CNY

const clock = parseDate('las tres menos cuarto', {
  locale: 'es',
  localePacks: [es],
  now: new Date(2026, 6, 3, 14, 30),
})
clock.ok && [clock.date.getHours(), clock.date.getMinutes()] // [2, 45]

const cjkDate = parseDate('2026年3月5日', { locale: 'zh', localePacks: [zh] })
cjkDate.ok && [cjkDate.date.getMonth() + 1, cjkDate.date.getDate()] // [3, 5] (local)

// omit `locale` to auto-detect among the loaded packs
```

Packs (`en`, `en-gb`, `es`, `fr`, `pt`, `zh`, `ja`) are additive and tree-shakeable;
they add number words, units, ranges, and relative dates (through
`@pascal-app/lingo/date`) for their language. Coverage includes Romance
tens/hundreds/scale words (`ciento veinte`, `mille cinq cents`, `mil millones`),
CJK scale/grouped numbers and post-unit half, postpositional comparators
(`5キロ未満`, `5公斤以上`), per-locale currency defaults (`￥` is CNY under `zh`,
JPY under `ja`), localized clock phrases and period edges, and CJK calendar
dates and clocks (`2026年3月5日`, `午後3時半`, `明天下午3点`). Requesting an
unloaded locale returns `LOCALE_NOT_LOADED` rather than silently parsing as
English; `humanizeDate()` output stays English for now.

The global `lingo()` is itself a `createLingo()` singleton. One code path,
two tiers of convenience.

## Recipes

Three common field shapes, straight from the public API. The full set lives
in [`docs/recipes.md`](https://github.com/pascalorg/lingo/blob/main/packages/lingo/docs/recipes.md): field recipes (ingredients, fuzzy
temperature, strict scientific fields), server-side validation, AI SDK /
OpenAI / Anthropic / Gemini / LangChain / MCP / eval recipes, form-library
recipes (React Hook Form, TanStack Form, Formik, Vue, Angular, shadcn,
vanilla), database input, and a per-vertical form-UX gallery.

**Height field (feet/inches to meters):**

```ts
import { parseQuantity } from '@pascal-app/lingo'

function heightMeters(input: string): number | null {
  const r = parseQuantity(input, { kind: 'length', strictness: 'confirm' })
  return r.ok ? r.quantity.to('m').value : null
}

heightMeters(`5'11"`) // 1.8034
heightMeters('180cm') // 1.8
heightMeters('tall')  // null
```

**Shipment weight (strict, ranges rejected):**

```ts
import { lingo } from '@pascal-app/lingo'

const shipmentOpts = { kind: 'mass', strictness: 'strict', accept: { ranges: false } } as const

lingo('20 kg', shipmentOpts)    // { ok: true, type: 'quantity', quantity: 20 kg }
lingo('20-25 kg', shipmentOpts) // ok: false, SINGLE_VALUE_EXPECTED, candidate: range 20-25 kg
```

**Agent form filling (LLM emits natural language, lingo canonicalizes):**

```ts
import { parseQuantity, type Kind } from '@pascal-app/lingo'

const schema: Record<string, { kind: Kind; unit: string }> = {
  height: { kind: 'length', unit: 'm' },
  weight: { kind: 'mass', unit: 'kg' },
}

function canonicalize(field: string, raw: string): number {
  const { kind, unit } = schema[field]!
  const r = parseQuantity(raw, { kind, strictness: 'confirm' })
  if (!r.ok) throw new Error(r.issues[0]?.message ?? `invalid ${field}`)
  return r.quantity.to(unit).value
}

canonicalize('height', `5'11"`)   // 1.8034
canonicalize('weight', '180 lbs') // 81.6466266
```

For tool schemas, prefer the `@pascal-app/lingo/ai` fields below. They add
tool-boundary defaults for ambiguity rejection, bounds, closed schemas, and
surfaced warnings.

## For AI: structured output & agent form filling

Constrained decoding guarantees the JSON parses; lingo guarantees the values
mean what they should. JSON mode can't stop `"2kg"` landing in a number field
(`Number("2kg")` → `NaN`, `z.coerce.number()` → `NaN` too), `"1,5"` losing its
locale, or `new Date("03/04/2025")` silently picking the wrong month. Models
are better at emitting `"5'11\""` than `1.8034`; `@pascal-app/lingo/ai` makes
that string the reliable path.

**Tool-boundary defaults** (plan 020). Human fields default to forgiving because
a person can read the hint. A tool argument has no human in the loop, so the
`/ai` fields use stricter defaults, each with a one-line escape hatch:

- Genuinely ambiguous numbers fail with a candidate: `"1,234 kg"` →
  `[AMBIGUOUS_NUMBER] ... Did you mean 1234 kg?` so the model can self-correct in one
  round trip (`escalate: { AMBIGUOUS_NUMBER: 'warning' }` restores absorption).
- Ignored timezones fail: `"3pm EST"` → `[TZ_IGNORED]` instead of silently
  landing in the host zone.
- Reference-dependent dates require an explicit `now`: `dateField()` rejects
  `"tomorrow"`, `"March 5"`, and time-only `"at 3pm"` with `NOW_REQUIRED` and
  no implicit candidate, so a queued or retried tool call can never drift across
  midnight (`requireNow: false` opts out by resolving from the wall clock at
  field validation; fully absolute dates are unaffected).
- `min`/`max` bounds reject absurd magnitudes (`-5 kg`, `2000000 kg`) with
  RANGE_MIN/RANGE_MAX; they're advertised in the input description on every
  field (plus JSON Schema `minimum`/`maximum` on numeric outputs) so the
  model is steered before it generates. Date-only bounds are local calendar
  days: `min: '2026-01-01'` accepts `"2026-01-01"` in every timezone.
- `rangeField()` defaults to compact `{ min, max }` numbers. Open-ended input
  like `"under 10 kg"` fails with RANGE_OPEN_BOUND_NOT_ALLOWED there; use
  `output: 'range'` when the tool should receive full QuantityRange JSON with
  open bounds, exclusivity, fuzzy/approximate origin, and `baseUnit`.
- `dateRangeField()` canonicalizes any `parseDateRange` shape — a time slot
  (`"2pm to 4pm"`, `"9-5"`, `"from 3pm"`), a dated span (`"Aug 3 - Aug 9"`), or a
  whole calendar period (`"next week"`, `"August"`) — to `{ start?, end?: ISO }`
  with the same reference-time and timezone guards as `dateField` (`applyZone`
  resolves real instants; `TZ_IGNORED` escalates to error).
- `lingoObject` is **closed**: `additionalProperties: false`, unknown keys
  fail, and the shape matches OpenAI strict structured outputs
  (`{ passthrough: true }` restores open objects).
- Benign forgiveness still succeeds. Typos, qualifiers, and assumed units ride
  along as `warnings` on the success result (`safeParse`), so nothing is silently
  swallowed. Canonical numbers are float-safe (`1.36077711`, never
  `1.3607771100000001`).

**Schema-native** (Standard Schema, both halves. AI SDK v6/v7 detect
`~standard` directly, no wrapper, no Zod):

```ts
import { generateText, tool } from 'ai'           // ai@6 or ai@7, no wrapper needed
import { quantityField } from '@pascal-app/lingo/ai'

const weight = quantityField({ kind: 'mass', unit: 'kg', min: 0, max: 200 })
const logWeight = tool({
  description: 'Log a package weight',
  inputSchema: weight,                            // LingoField passed directly
  execute: async (kg) => ({ ok: true, kg }),       // "12 lbs" → kg is 5.443...
})

const { text } = await generateText({ model, tools: { logWeight }, prompt: 'Log 12 lbs.' })
// Output.object({ schema: lingoObject({ weight, loggedAt: dateField() }) }) works the same
// way for whole-response structured output. No tool call needed.
```

The field's *input* JSON Schema is `type: "string"` with a natural-language
description. Strict provider modes let the model write what it's good at,
and lingo canonicalizes on validation. The *output* is the canonical shape.
On **AI SDK v5**, `asSchema()` has no Standard Schema branch yet. Wrap the
field with the SDK's own `jsonSchema()` first (the ~10-line bridge is in
`docs/recipes.md`); `generateObject`/`experimental_repairText` are deprecated
on v6/v7 in favor of `Output.object`/`experimental_repairToolCall` (below).
One gap either way: the SDK's schema adapter only reads
`{success,value}`/`{success,error}`, so lingo's `warnings` (typo-fixed,
unit-assumed, and similar warnings) never reach it. Call `weight.safeParse(input)` yourself,
inside `execute()`, to see them.
Direct lingo field calls keep issues structured: failure issues still have the
Standard Schema `message`/`path`, and also carry lingo's `code`, `severity`,
field-input `span`, `data`, `suggestions`, and did-you-mean `candidate` when
available. `[CODE]` stays in the message for model/tool self-repair; callers no
longer need to parse that copy.

Other providers use the same field. No lingo-specific adapter needed:

- **OpenAI**: wrap in `lingoObject` (a bare field can't be a tool's whole
  `parameters`) and set `strict: true`. Wiring a field's `.output()` schema
  in by mistake is strict-legal but silently reverts the tool to "emit a bare
  number."
- **Anthropic**: one cast:
  `schema['~standard'].jsonSchema.input({...}) as
  Anthropic.Tool.InputSchema`; `lingoObject`'s closed default already
  satisfies `strict: true` on both OpenAI and Anthropic.
- **Gemini**: target `parametersJsonSchema`/`responseJsonSchema`, never
  classic `parameters`/`responseSchema`. The classic path silently drops or
  rejects `additionalProperties`.
- **One schema, many providers**: that same closed shape is also Grok's,
  Mistral's, Cohere v2's, Groq's, Ollama's, and Hugging Face's exact
  strict-mode contract. One schema works across those providers without
  per-provider glue.
- **LangChain**: `createAgent`/`withStructuredOutput` take a lingo field
  directly but only validate its shape. Run `canonicalizeValues` (or the
  field's `.safeParse`) yourself for lingo's ambiguity/bounds checks.
- **MCP**: `lingoTool()` (`@pascal-app/lingo/mcp`) turns a shape into a full
  tool descriptor. See MCP tools, below.
- **Evals**: `quantityMatch`/`dateMatch` canonicalize both sides through the
  same field before comparing (`"2 lbs"` grades equal to `0.90718474` kg) and
  return `{ pass, score, reason }`. Drop into promptfoo, autoevals, or a
  plain Vitest assertion.

Two more small helpers: `optional(field)` keeps a key in the schema's
`required` list while letting it validate to `null` (the null-union idiom
OpenAI/Anthropic strict modes both expect, without hand-writing the union);
`toJSONSchema(field, { io, target })` returns just the JSON Schema fragment
for a hand-rolled `parameters`/`input_schema` instead of passing the field
itself.

**Repair & post-processing** for schemas you don't own. Client-side, no
extra model call:

```ts
import { canonicalizeValues, repairTextWith, repairToolCallWith } from '@pascal-app/lingo/ai'

// AI SDK v6/v7 tool calls; generateObject/experimental_repairText are deprecated;
// this is their tool-call-shaped successor's repair hook:
await generateText({ ...,
  experimental_repairToolCall: repairToolCallWith({ logWeight: { weight: { kind: 'mass', unit: 'kg' } } }) })

// v5's generateObject still works with the original hook:
await generateObject({ ...,
  experimental_repairText: repairTextWith({ weight: { kind: 'mass', unit: 'kg' } }) })

canonicalizeValues(payload, { 'items[].weight': { kind: 'mass', unit: 'kg' } })
```

**MCP tools.** `@pascal-app/lingo/mcp`'s `lingoTool()` turns a shape into a
complete tool descriptor: JSON Schema out, `safeParse` in, structured lingo
issues for code, and `[CODE]` messages the model can self-correct from
(plan 021):

```ts
import { dateField, quantityField } from '@pascal-app/lingo/ai'
import { lingoTool } from '@pascal-app/lingo/mcp'

const createShipment = lingoTool({
  name: 'create_shipment',
  description: 'Create a shipment; natural-language values welcome',
  input: {
    weight: quantityField({ kind: 'mass', unit: 'kg', min: 0, max: 500 }),
    deliverBy: dateField({ min: '2026-01-01' }),
  },
  handler: (args) => saveShipment(args),  // canonical kg + ISO date, bounds enforced
})

// Any MCP SDK that accepts JSON Schema tool input:
server.registerTool(
  createShipment.name,
  { description: createShipment.description, inputSchema: createShipment.inputSchema },
  createShipment.callback, // "1,234 kg" → isError, "[AMBIGUOUS_NUMBER] ... Did you mean 1234 kg?"
)
```

With `requireNow` on, `"tomorrow"` bounces back with `NOW_REQUIRED` and no
implicit candidate. The model resends an absolute date or the caller supplies a
reference `now`, and a queued tool call can never drift across midnight.
Building the descriptor by hand instead?
`lingoObject(shape)['~standard'].jsonSchema.input({ target: 'draft-2020-12' })`
is the same schema `lingoTool` builds internally, and `.safeParse()` is the
same check it runs before your handler.

**Computer use / browser agents**: fields wired with `lingoInput` accept
whatever the agent types. Verified live: a synthetic-event agent typing
`5'11"` commits `1.8034` to the hidden canonical input, `2 lbs` commits
`0.907` kg, `1,5 m` commits `1.5`. No agent-specific code; the form itself
becomes format-proof.

**One schema for tools and forms.** A `lingoObject` built for a tool argument (like
the ones above) also validates and canonicalizes a human form, unchanged,
through any Standard-Schema-aware form resolver:

```tsx
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { useForm } from 'react-hook-form'
import { dateField, lingoObject, quantityField } from '@pascal-app/lingo/ai'

const shipment = lingoObject({
  weight: quantityField({ kind: 'mass', unit: 'kg', min: 0 }),
  deliverBy: dateField({ now: new Date() }),
})

useForm({ resolver: standardSchemaResolver(shipment) })
// handleSubmit(onValid) receives canonical kg + an ISO date, not raw text.
// the same shape a model's tool call would produce.
```

One caveat: `lingoObject` is closed by default (the tool-boundary default
above), so a form submitting fields lingo doesn't declare needs
`lingoObject(shape, { passthrough: true })`. React Hook Form, TanStack Form,
Formik, Vue, Angular, and shadcn recipes all live in `docs/recipes.md`.

**Also true of the core API**: explicit `now`, no locale sniffing, stable
issue codes, `toJSON()`/`fromJSON()`, opt-in `@pascal-app/lingo/describe`
rich views, numeric confidence, enumerable discriminated alternatives.

**Measured** (`bun run ai-eval`, 160-fixture recorded corpus across 10 failure
modes; this is a canonicalization demo, not an LLM benchmark): naive
`Number()`/`new Date()` coercion accepts 17.5% of the corpus and is silently
wrong on 6.3% of it (drifted dates parse as the wrong day without an error);
lingo preprocessing accepts 96.9% with **zero silent-wrongs** and rejects the
remaining 3.1%, genuinely ambiguous separators like `"1,234"`, with a
machine-actionable candidate instead of a guess. The worst naive row:
natural-language dates, where 50% were accepted and all accepted rows were wrong.

## Issue codes

`EMPTY · NO_VALUE · UNKNOWN_UNIT · KIND_MISMATCH · RANGE_KIND_MISMATCH ·
CONVERSION_KIND_MISMATCH · RATE_REQUIRED · TRAILING_INPUT · SINGLE_VALUE_EXPECTED ·
APPROX_NOT_ALLOWED · UNIT_REQUIRED · CONVERSION_NOT_ALLOWED · NUMBER_FORMAT ·
NONFINITE · LOCALE_NOT_LOADED · RANGE_MIN · RANGE_MAX · REQUIRED · UNSUPPORTED_DATE · NOW_REQUIRED ·
RANGE_OPEN_BOUND_NOT_ALLOWED · TYPO_CORRECTED · AMBIGUOUS_NUMBER ·
AMBIGUOUS_UNIT · AMBIGUOUS_DATE · RANGE_REVERSED · COMPOUND_OVERFLOW ·
CIVIL_AVERAGE · UNIT_ASSUMED · WEEKDAY_ASSUMED_NEXT · SLANG_UNIT · TZ_IGNORED ·
AMBIGUOUS_TIMEZONE`

Every issue carries a typed `data` payload (`LingoIssue<'UNKNOWN_UNIT'>` knows
`data.unit` and `data.suggestions`). `NOW_REQUIRED` fires when a date input
depends on a reference time ("in 2d", "tomorrow", "March 5", "at 3pm") without
an explicit `now`; no implicit candidate is attached.

Override any message: `parseQuantity(text, { messages: { UNKNOWN_UNIT: 'Try cm or ft!' } })`.

Result helpers, so you never hand-roll the same narrowing twice:

```ts
import { firstError, isQuantity, isNumber, candidateOf, formatIssue } from '@pascal-app/lingo'

const r = lingo(input, opts)
if (isQuantity(r)) save(r.quantity.to('m').value)
else if (isNumber(r)) save(r.value) // bare number, no unit ("72")
else showError(formatIssue(firstError(r)!), candidateOf(r)?.quantity)
```

## Design notes

The specs live in [`plans/`](https://github.com/pascalorg/lingo/blob/main/plans/README.md) (grammar, unit hazard tables, exact
conversion factors, ambiguity policy) and the as-built docs in [`wiki/`](https://github.com/pascalorg/lingo/blob/main/wiki/README.md).
More field recipes live in [`docs/recipes.md`](https://github.com/pascalorg/lingo/blob/main/packages/lingo/docs/recipes.md).
The full credits ledger for libphonenumber-js, date-fns, Humanizer, inclusive-dates,
chrono-node, react-aria, Maskito, and other references is
[`wiki/inspiration.md`](https://github.com/pascalorg/lingo/blob/main/wiki/inspiration.md).

## License

MIT
