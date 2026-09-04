# lingo vocabulary

This file is a glossary, not a spec. It defines what each term *is*, not what it
does. Before introducing a new noun — in code, docs, issue codes, or plans —
check it here first. If the concept already exists under a canonical name, use
the canonical name. The *Avoid* lists name the exact wrong words.

## Primitives

**Kind:** a measurement domain — `length`, `mass`, `temperature`, `duration`,
`volume`, `area`, `speed`, `data`, `data_rate`, `flow_rate`, `pressure`,
`energy`, `force`, `torque`, `power`, `frequency`, `angle`, `percent`,
`voltage`, `current`, `resistance`, `charge`, `substance`, `concentration`,
`acceleration`, `luminous_intensity`, `luminous_flux`, `illuminance`,
`luminance`, `radiation_absorbed_dose`, `radiation_equivalent_dose`,
`radioactivity`, `currency`; custom kinds are any other string. *Avoid:
dimension, measure, category, unit type.*

**Unit:** one `UnitDef` in a kind's table — stable `id` (unique per kind),
display `symbol`, long `name`/`plural`, parse `aliases` (lowercase),
case-sensitive `caseExact` pool, affine `factor` + `offset`. *Avoid: code.*

**Unit ref:** any string a caller may pass where a unit is expected (`'L'`,
`'liters'`, `'gal'`) — resolves through aliases. The **unit id** is the
canonical key it resolves to (`'l'`). *Avoid: unit name (that's the long form
"liter").*

**Quantity:** one value in one unit, carrying `base` — the value converted to
the kind's base unit. **Base** is the SI-anchored canonical number (meters,
kilograms, kelvin, seconds…). *Avoid: amount, measurement, normalized value.*

**Range:** a `QuantityRange` — min/max quantities, `plusMinus`, open bounds,
approximate/fuzzy flags. Never use "range" for text offsets — that's a **span**.

**Date range:** a `DateRange` from `parseDateRange()` — start/end endpoints,
either end optionally open. Unqualified "range" means the quantity kind; say
"date range" when you mean this one. It comes in three shapes, and these are
the names to use: a **time slot** from clock grammar (`2pm to 4pm`, `9-5`), a
**dated span** between two dates (`Aug 3 - Aug 9`; "date-to-date span" is the
long form), and a **calendar period** widened to its real first and last day
(`next week`, `August`, `2027`). The runtime-only `dated` flag is `true` on the
latter two and absent on a slot — test it truthy, never `=== false`.

**Span:** `{ start, end }` character offsets into the ORIGINAL input string
(the normalizer keeps an offset map, hard rule 3). *Avoid: range, position,
location.*

**Conversion:** a parsed conversion *request* ("72 in to cm") — a result type.
The arithmetic itself is `convert()` / `convertDelta()`.

**Rate:** a caller-supplied conversion factor between currency unit ids. Rates
are never bundled, fetched, inferred from locale, or read from the clock.

**Issue:** the single error/warning/info shape — `{ code, severity, message,
span, suggestions?, data? }`. "Error" is a *severity* (and the `ok: false`
state), never the name of the object. *Avoid: diagnostic, problem, validation
error (as object names).*

**Issue code:** stable `SCREAMING_SNAKE` identifier (`UNKNOWN_UNIT`,
`TYPO_CORRECTED`). Codes are public API: added, never renamed. Each has a typed
`data` payload in `IssueDataMap` and English copy in the message pack.

## Result & options vocabulary

**Candidate:** the full *successful* result attached to a **failed** parse —
"here is what it would have been" (confirm-typo UX, accept-switch rejections).

**Alternative:** a ranked *other interpretation* attached to a **successful**
parse (ambiguity honesty, D4).

**Suggestion:** a did-you-mean *string* riding on an issue (`UNKNOWN_UNIT`
suggestions).

**Completion:** a ranked, fully-parsed interpretation of a (possibly partial)
input — canonical `text` plus a successful quantity/range/conversion result
(`@pascal-app/lingo/complete`). Powers autocomplete UIs; distinct from candidate,
alternative, and suggestion.

Candidate / alternative / suggestion / completion are four different things —
never interchange them.

**Resource view:** an opt-in, self-explanatory object returned by
`@pascal-app/lingo/describe` for docs, logs, debugging, or tool output. Resource
views use `object` names, grouped fields, source text on spans, and rich unit
labels. They do not replace compact wire JSON. *Avoid: default JSON, storage
shape.*

**Strictness:** the one dial — `forgiving | confirm | strict`.
**Accept switches** (`accept.ranges`, `accept.conversions`, …) reject whole
shapes. **Tolerance** tunes effort (`tolerance.typos: fix|suggest|off`,
`tolerance.ambiguity`). **Escalate** remaps one issue code's severity.
Four distinct mechanisms — don't describe one as another.

**Profile:** a named fuzzy-vocabulary context (`weather`, `water`, `oven`).

**Locale:** a BCP-47 language/region identifier (`en`, `en-GB`, `es-MX`) used
to select parser vocabulary and defaults. It is not a unit system or currency.

**Locale pack:** an additive, opt-in data module for one locale — grammar words,
number-word tables, date vocabulary refs, defaults, and future numeral maps.
Locale packs are passed to `createLingo({ locales })`; they are never all bundled
by default.

**Language profile:** the fully resolved runtime view of one locale pack after
inheritance/overlays are merged. Parser code reads the language profile, not raw
locale pack objects. *Avoid: profile (ambiguous with fuzzy Profile).*

**Grain:** the precision of a parsed or humanized date (`day`, `hour`, …).
Humanize output re-parses within one grain.

**Format vs humanize:** `format()` renders quantities; `humanize*()` renders
dates and durations. Both are covered by the two-way guarantee (hard rule 4).

**Partial state:** the as-you-type classification — `empty | incomplete | valid
| invalid`. "2 f" is *incomplete*, never invalid (the DOM layer never yells
mid-typing).

**Commit:** the DOM moment (blur / Enter / submit) when a field canonicalizes
its value. Fields never rewrite text while typing (D6).

## Infrastructure nouns

**Entry:** a published subpath — `.`, `./core`, `./date`, `./dom`, `./element`,
`./describe`, `./catalog`, `./schema`, `./ai`, `./mcp`, `./react`,
`./react-native`, `./complete`, `./locales/*`. *Avoid: subpackage, plugin.*

**Catalog:** the read-only query surface (`./catalog`) over built-in
unit/kind/currency data — list kinds/units, resolve refs, related units,
currencies with ISO minor-unit + country codes. Not the parser or registry.

**Schema:** the machine-readable schema surface (`./schema`) — a JSON Schema
(Draft 2020-12) of the v3 wire types, `toOpenApi()`, and the enum reference. The
docs generate Zod/Valibot/TypeBox/ArkType/Effect adapters + a dictionary from it.

**Module:** a `packages/lingo/src/<dir>/` unit from the module map (AGENTS.md).

**Registry:** the unit/kind/fuzzy store. The global one backs `lingo()`;
`createLingo()` returns an isolated **instance** with its own registry,
messages, and fuzzy vocab.

**Corpus:** the behavior contracts under `packages/lingo/tests/corpus/` —
`contract-v1.json` for English plus one `locale-<id>-contract-v1.json` per
locale pack. Drift is classified **ADDITIVE** (new inputs now parse) or
**BREAKING** (existing interpretations changed) by `scripts/corpus-diff.mjs`;
BREAKING requires a decision entry and a major version.

**Budget:** a min+gzip size ceiling per entry. `packages/lingo/scripts/size.mjs`
is the single source of truth for the numbers; each carries its D-entry history
inline.

**Message pack:** swappable human copy keyed by issue code (`englishMessages`,
`setDefaultMessages`). `./core` ships copy-free for BYO-i18n (D14).

## Flagged ambiguities

- **"range" vs "span"** — the collision that bites. Values: range. Text
  offsets: span. No exceptions.
- **"error"** — fine as a severity or the `ok: false` state; the object is an
  issue.
- **"unit"** in prose can mean id, symbol, or def — in code, use the precise
  field name (`unit.id`, `unit.symbol`).
- **grasp-input** — the pre-rename working name. Code and docs are 100% lingo;
  never introduce the old name anywhere new.
