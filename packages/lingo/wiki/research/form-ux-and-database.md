# Form-UX reduction, DX inspiration & database input (research 2026-07-05)

Research pass 2026-07-05: a verification pass over two background-agent briefs
(`form-ux-reduction`, `zod-db`) plus direct reads of this repo's own source
(`packages/lingo/src/{index,dom/index,react/index,ai/quantity-fields,units/mass,
units/length,units/percent,core/quantity,format/format}.ts`). Method: every
external claim was checked against a primary source (official docs, primary
incident-investigation reports, or npm/GitHub registries) rather than trusted
from a single pass; corrections found during verification are folded directly
into the prose below, not kept as a separate errata list. Companion docs:
[`wiki/research/ai-structured-output.md`](ai-structured-output.md) (AI SDK +
Standard Schema integration architecture) and
[`wiki/research/llm-formatting-failures.md`](llm-formatting-failures.md)
(evidence that LLMs/agents make quantity-formatting mistakes) cover the `/ai`
boundary's LLM-safety half in depth. This pass covers the other half — the
human-form-UX case, a DX-inspiration pass over Zod/Valibot/ArkType/Effect
Schema, and where a canonicalized value belongs once it reaches a database —
feeding [plan 024](../../plans/024-ecosystem-integration-and-docs.md)
(Ecosystem integration & documentation enrichment).

## The shared seam: one `LingoOptions`, two consumers

Both halves of this doc — forms for humans, tools for models — are downstream
of one verified architectural fact, so it's worth stating before the evidence:
lingo's DOM/React options and its `/ai` field options are built from the same
options vocabulary, not two parallel ones that happen to look similar.

`LingoOptions` (`packages/lingo/src/index.ts:74`) is the base: `kind`, `unit`,
`system`, `strictness`, `accept`, `tolerance`, `escalate`, `messages`,
`registry` — accepted by `lingo()`, `parseQuantity()`, `parseRange()`,
`partialState()`, and `findQuantities()`. `QuantityFieldOptions`
(`packages/lingo/src/ai/quantity-fields.ts:19`) — the `/ai` tool-argument type
— is a literal intersection: `LingoOptions & { unit: string; min?: number;
max?: number; output?: 'number' | 'quantity'; description?: string }`.
`LingoInputOptions` (`packages/lingo/src/dom/index.ts:70`) — the DOM/React
type — is a hand-written interface rather than a second intersection (it needs
DOM-only wiring: `name`, `errorElement`, `hintElement`, `display`, commit
callbacks; and it widens `min`/`max` to `string | number` so a field can take
`"5ft"` as a bound, not just a pre-parsed number). But every field it shares
conceptually with `LingoOptions` is typed directly off it — `accept?:
LingoOptions['accept']`, `strictness?: LingoOptions['strictness']`,
`tolerance?: LingoOptions['tolerance']` — and the DOM layer's own internal
`toLingoOptions()` (`dom/index.ts:148`) reduces a `LingoInputOptions` object to
a real `LingoOptions` object before calling the exact same `parseQuantity()`
the `/ai` fields call. React's `useLingoInput` layers one more intersection on
top: `UseLingoInputOptions = LingoInputOptions & { value, onValueChange }`
(`react/index.ts:19`).

Concretely, this type-checks against both consumers, unmodified:

```ts
const heightSpec = { kind: 'length', unit: 'm', min: 0, max: 3 } as const

// human form field
import { useLingoInput } from '@pascal-app/lingo/react'
useLingoInput({ ...heightSpec, name: 'height_m' })

// LLM tool argument
import { quantityField } from '@pascal-app/lingo/ai'
quantityField({ ...heightSpec })
```

`unit` is required by `QuantityFieldOptions` and present; `min`/`max` are
plain numbers, a valid value for `LingoInputOptions`'s `string | number`. This
is the concrete mechanism behind "make forms easier, LLM tools safer" sharing
one artifact — not marketing language layered over two unrelated
implementations. It's also why this doc treats form-UX and the `/ai`-adjacent
DX/database material as one story instead of two: the same options object is
the seam between them.

## 1. Fewer, smarter fields: the evidence

Baymard's checkout-usability research puts the average e-commerce checkout at
**14.88 form fields / 23.48 form elements**; "most sites do not need more than
8," and fully optimized flows hit **≤7** — correlated with **+25–35%
conversion** ([baymard.com/research/checkout-usability](https://baymard.com/research/checkout-usability)).
Self-reported abandonment splits: form length 37%, unclear/unexpected fields
22%, submit-time validation errors 14%.

Baymard's mobile-usability research on **"single input entities"**
([baymard.com/blog/mobile-form-usability-single-input-fields](https://baymard.com/blog/mobile-form-usability-single-input-fields))
documents what happens when one thing a user perceives as whole — a phone
number, a ZIP+4, a full name — gets split across multiple controls: extra
tap/keyboard round-trips per fragment, invisible required-vs-optional
ambiguity between fragments, and users filling the *first* fragment with the
*whole* value before backtracking. A value+unit pair (`[__] [lb ▾]`) is the
same split applied to a physical quantity. Baymard doesn't test that pairing
directly, so treat the generalization as a strong analogy, not a cited finding
— a distinction worth preserving whenever this argument gets repeated in docs
or marketing copy.

GoodUI's aggregated A/B data is the honest counterweight, and it's mixed by
design, not by omission. Pattern #3, "Fewer Form Fields"
([goodui.org/patterns/3](https://goodui.org/patterns/3/)), is broadly positive
across 13 tests. Pattern #8, "Natural Language Forms"
([goodui.org/patterns/8](https://goodui.org/patterns/8/); results roundup at
[jroehm.com](https://www.jroehm.com/2014/01/26/ui-pattern-natural-language-form/)),
is genuinely split: vast.com +25–40%, Netmedia +25%, PrizeGrab/GoodUI +29%,
CDF Networks +12%, Embrace Pet Insurance +3.3% — against Kalzumeus's **-22%**,
and Airbnb's own host-signup natural-language variant, which the company
tested and then rejected.

**This bounds lingo's pitch precisely, and the boundary matters more than the
wins.** Every positive result above replaces a **short, simple** input; every
negative result replaces a **long, complex** form or surprises a user
expecting a familiar control. lingo's docs and marketing should say
**"collapses one value + one unit dropdown into one text field"** — the case
the evidence favors — and should never say **"replace your whole form with a
sentence"** — the case Kalzumeus and Airbnb's rejected test argue against.

## 2. Unit-entry disasters, verified and correctly attributed

**Mars Climate Orbiter** (NASA/Lockheed Martin, 1999) is the canonical case,
and the primary source is more precise than most retellings. NASA's Mars
Climate Orbiter Mishap Investigation Board Phase I report (Nov 10, 1999)
traces the root cause to a Lockheed Martin Astronautics ground-software
application ("SM_FORCES") that computed thruster-firing impulse and wrote it
in **pound-force-seconds (lbf-s)**, while JPL's navigation software consumed
the same file assuming **newton-seconds (N-s)** per the interface
specification. Because 1 lbf ≈ 4.448 N, JPL's trajectory model
**underestimated the effect on the spacecraft's trajectory by a factor of
4.45** — the exact lbf-to-N ratio — driving the first periapsis to ~57 km
against a planned 226 km (80 km was the survivable minimum); the spacecraft
was lost on September 23, 1999 ([Wikipedia](https://en.wikipedia.org/wiki/Mars_Climate_Orbiter);
corroborated by IEEE Spectrum, which quotes the Mishap Investigation Board
chairman attributing the bad values to Lockheed Martin Astronautics
engineers). **Correction worth carrying into any citation**: the frequently
repeated $327M loss figure is NASA's combined accounting for Mars Climate
Orbiter *and* its sister mission Mars Polar Lander together (spacecraft
development $193.1M + launch $91.7M + operations $42.8M) — not Mars Climate
Orbiter alone. Most popular retellings, including Guinness World Records,
blur this; cite it as "$327M combined with Mars Polar Lander," not "$327M for
Mars Climate Orbiter." (A widely-linked SimScale summary of this incident also
mislabels the missing unit as a pressure unit rather than an impulse unit —
prefer Wikipedia or the primary MIB report over that summary.)

**Gimli Glider** (Air Canada Flight 143, July 23, 1983) is usually told as a
"ground crew" mistake; the government Board of Inquiry's own report is more
exacting. A drip-stick reading of 7,682 L needed to become a fuel mass; the
fueler supplied a specific gravity of "1.77," correct only for **pounds per
liter**, not the **kilograms per liter** (≈0.803) the airline's first
all-metric 767 required. Multiplying 7,682 L × 1.77 = 13,597 and treating the
result as kilograms (never dividing by 2.2) cascaded through the refueling
math to an actual load of 22,300 lb = 10,100 kg against a required 22,300 kg
— **10,100 / 22,300 ≈ 45%** of the fuel actually needed — forcing both
engines to flame out at 41,000 ft and a deadstick glide to a former airbase at
Gimli, Manitoba ([Wikipedia](https://en.wikipedia.org/wiki/Gimli_Glider);
[CBC archives](https://www.cbc.ca/archives/when-a-metric-mix-up-led-to-the-gimli-glider-emergency-1.4754039)).
**The correction**: the Board of Inquiry explicitly found the miscalculation
"has to be borne by both the flight crew and the maintenance personnel
involved... a joint effort" — Air Canada maintenance technicians each
personally multiplied by 1.77, but so did the flight crew: the First Officer
testified he did the same multiplication, and the Captain cross-checked and
confirmed the figures on his own slide-rule flight computer. Cite this as a
**joint pilot-and-ground-crew unit-conversion failure**, not a
ground-crew-only error — CBC's own archive page repeats the looser framing, so
don't lean on it alone for attribution.

**Liquid medication dosing** is where sourcing needs the most care, because
two of the usual citations don't hold up under a direct read. The measured
spoon-volume range comes from a February 2026 PLOS Global Public Health study
of Sri Lankan household spoons (PMC12880656): teaspoons measured **2.893–7.759
mL** against a nominal 5.00 mL, tablespoons **4.252–15.043 mL** against a
nominal 15.00 mL, with over 93% of spoons under-filling. Cite that study for
the range — not the FDA-hosted NCPDP whitepaper commonly cited for it, which
contains no spoon-variance data at all (its only related figure: confusing a
teaspoon for a tablespoon causes "3-fold dosing errors," a ratio of the two
*nominal* units, not measured variance). The regulatory history is real but
came in two narrower, distinct steps, not one blanket mandate: an FDA final
Guidance for Industry (May 4, 2011) required only that a dosing device's
markings **match** the label's unit — tsp/tbsp were still permitted if
internally consistent; a second FDA guidance (Aug 5, 2015) narrowed to
**mL-only** dosing directions and devices, but only for one high-risk category
— OTC pediatric oral liquid acetaminophen. ISMP's institutional position is
unambiguous and current: its 2024 List of Error-Prone Abbreviations, Symbols,
and Dose Designations flags "tsp"/"tbsp" as error-prone with "use metric
system (mL)" as the fix, and ISMP's consumer arm states it "has long
recommended using mL instead of teaspoons or tablespoons." **Do not cite
"NPSG.01.05.01"** for a Joint Commission mL-only mandate — it is a frequently
repeated citation online that does not correspond to any verifiable Joint
Commission standard (Joint Commission's actual mandatory "Do Not Use"
abbreviation list doesn't include tsp/tbsp at all), and it is doubly stale
regardless: effective January 1, 2026, Joint Commission retired its entire
hospital National Patient Safety Goals chapter in favor of a new "National
Performance Goals" framework, so no pre-2026 NPSG number is citable as
current. Joint Commission's real, defensible role is narrower: its Medication
Management standards favor mL-graduated oral syringes as the expected
administration device — accreditation-level encouragement, not a named
mL-only mandate. Net sourcing for this claim: **2026 PLOS study** for the mL
range, **FDA 2011/2015 guidances** for the regulatory mechanism, **ISMP 2024**
for the strongest mL-only institutional voice, Joint Commission described as
encouragement rather than mandate.

**Insulin dosing** — measuring a *units* dose in *mL* on a standard,
non-insulin syringe — is a real, ISMP-documented harm class, but its two
supporting citations name different organizations than commonly assumed. An
ISMP Medication Safety Alert (Acute Care, Vol. 23 Issue 3, Feb 8, 2018)
documents the general class: "most dosing errors have involved measuring
insulin doses in mL instead of units," with concrete cases including a nurse
who drew 20 units using a 10 mL non-insulin syringe intending 10 units, and a
resident who administered an entire 3 mL U-100 vial (300 units) when 10 units
were ordered; a prior 2011 ISMP alert in the same lineage documents a fatal
case (50 units given instead of 5, causing fatal hypoglycemic encephalopathy).
That document is scoped to standard U-100 insulin and never mentions U-500.
**The fivefold U-500-specific severity claim is confirmed but is not an ISMP
publication** — it's the Pennsylvania Patient Safety Authority's 2025 paper
(Ro M., "Strategies to Prevent Fivefold Wrong Dose Errors With U-500
Insulin," *Patient Safety* 2025;7(2):144287), a sister-but-distinct body from
ISMP that runs Pennsylvania's mandatory PA-PSRS reporting system; it
documents both 5x underdoses and 5x overdoses still being reported as of
2025. ISMP's own 2024 High-Alert Medications list independently corroborates
the U-500-specific severity by singling it out for "special emphasis." Cite
this as **ISMP (general units-vs-mL class) + PSA/PA-PSRS (U-500-specific
fivefold class)** — two organizations, two distinct papers, not one ISMP
source covering both.

## 3. Canonical-unit precedent and existing natural-language-field products

Storing one canonical unit and formatting for display on the way out is not a
lingo invention — it's how serious platforms already handle this exact class
of ambiguity. Google Home's `TemperatureSetting` trait: *"Temperatures can be
set in Fahrenheit by the user, but all temperature values in commands and
states are in Celsius. Any required unit conversion is performed
automatically"* — the display unit (`thermostatTemperatureUnit`) is purely
presentational ([developers.home.google.com/cloud-to-cloud/traits/temperaturesetting](https://developers.home.google.com/cloud-to-cloud/traits/temperaturesetting)).
Stripe's API requires all amounts in a currency's **minor unit** — integer
cents, never floats — for the same reason: one unambiguous wire format,
formatted for humans only at the edge
([stripe.com/docs/currencies](https://stripe.com/docs/currencies)). This is
precisely lingo's `LingoDisplayMode` split — `'canonical'` (re-render in the
display unit on commit, e.g. "= 1.80 m") vs `'echo'` (keep the user's own
unit) vs `'preserve'` (never touch what was typed) (`packages/lingo/src/dom/index.ts`,
`LingoDisplayMode` type) — applied to the physical-quantity forms that today
mostly expose raw, unconverted, unvalidated unit dropdowns instead of a
trusted canonical wire format.

The appetite for natural-language fields over structured pickers is already
mainstream, not speculative. Todoist and Fantastical parse "next Tuesday at
4pm" in one field instead of day/month/year selects — uncontroversial,
shipped for years ([todoist.com/help](https://www.todoist.com/help/articles/introduction-to-dates-and-time-q7VobO)).
Soulver and Numi are consumer calculator apps whose entire product is typing
"5 kg in lbs" as free text through an on-device natural-language engine
(Soulver's SoulverCore) ([soulver.app](https://soulver.app/)). In 2025, Google
Flights' AI flight-deals feature and Kayak's "Ask AI"/AI Mode both replaced
structured date-and-destination pickers with a single natural-language box
([Skift, Oct 2025](https://skift.com/2025/10/15/kayak-ai-mode-natural-language-search/))
— mainstream travel platforms making lingo's exact bet, in the current cycle.

**One boundary lingo should state clearly, not imply away**: cup-to-gram (or
any cross-*kind* volume-to-mass conversion) is **out of scope**. It isn't a
unit conversion — it requires ingredient density, which varies per
ingredient. Dedicated recipe converters (Baking Calculators, Useful Units,
Cooking Units Converter) each had to build 300–400-ingredient density lookup
tables to do this. lingo's dimensional unit registry converts within a kind
(volume-to-volume, mass-to-mass); it does not, and should not silently imply
it, bridge kinds.

## 4. Eight showcase examples

One before/after per requested product category, each naming the fields
removed and the class of error prevented:

| # | Category | Before (removed) | After (lingo) | Error prevented |
|---|----------|-------------------|---------------|------------------|
| 1 | Health — intake | `Height ft[__] in[__]` + `Weight [__] (lb▾/kg▾)` | Two `lingoInput`/`useLingoInput({kind:'length'\|'mass'})` fields taking `5'11"`/`180cm`, `165 lb`/`75 kg` | BMI-invalidating 2.2x mass-unit mix-up; Baymard's split-entity backtrack failure |
| 2 | Health — dosing | Dose amount + unit `▾` (mL/mg/tsp) | `quantityField({kind:'volume',unit:'mL',max})` parsing "1.5 teaspoons" → mL, bounds-checked | ISMP/FDA-documented mg-vs-mL and tsp-vs-tbsp 3–5x dose errors |
| 3 | Logistics — shipping | 4 dims × unit `▾` = 8 controls | 4 `lingoInput({kind:'length'\|'mass'})` fields taking "12in"/"30cm"/"2.5kg" | Dimension/weight-mismatch fee disputes from a picker silently defaulting to the wrong unit |
| 4 | IoT/smart-home | `Set to [__] (C▾/F▾)` per rule | One `lingoInput({kind:'temperature',unit:'C'})` taking "68F"/"20C"/fuzzy "warm" | Cross-account C/F automation mismatch bugs; mirrors Google Home's Celsius-canonical trait |
| 5 | Cooking/recipes | Per-ingredient `[amount]+[unit▾:cup/g/oz]` | One `lingoInput({kind:'volume'\|'mass'})` per row, rescaled via `convert()`/`format()` | Silent unit-mismatch entry (cup→gram density conversion explicitly out of scope — §3) |
| 6 | E-commerce listings | `Weight[__](lb▾/kg▾)` + `Dims[__]x[__]x[__](in▾/cm▾)` | Per-field `lingoInput` canonicalizing to the marketplace's required storage unit | Cross-catalog inconsistency from mixed default-unit assumptions across a bulk listing |
| 7 | Scientific/lab + construction | Qty + unit `▾` (mm/cm/m/in/ft or mL/L/g/kg) per BOM/sample line | One `lingoInput({kind:'length'\|'volume'\|'mass'})` accepting what's printed on the spec sheet | Mixed-unit-standard BOM math errors (the shape popularly, if disputedly, attributed to the *Vasa* warship's two conflicting foot standards — causation there is contested; the failure *shape* is not) |
| 8 | Finance | Rate `[__]` + mode toggle `(%▾/bps▾)` | `lingoInput({kind:'percent',unit:'%'})` taking "25 bps"/"0.25%"/"a quarter point" | 100x order-of-magnitude slip from a mis-set %/bps mode toggle |

Row 8 is directly demoable today, not aspirational: the `percent` kind's
basis-point unit and "percentage point(s)" alias were added 2026-07-04 per the
source comment — *"finance tools speak in pct/pp/bps"*
(`packages/lingo/src/units/percent.ts:37`) — giving `%`, `‰` (permille), and
`bps` (1 bps = 0.01%) in one kind. Rows 3 and 6's specific attributions
(Amazon Seller Central fee disputes, Shopify/marketplace cross-catalog
inconsistency) are illustrative color drawn from secondary blogs/forums during
research, not primary sources fetched and read in full — treat them as
plausible motivation, not as citable statistics the way the §2 disasters are.

## 5. DX inspiration: Zod, Valibot, ArkType, Effect Schema

Two small patterns are worth adopting, at near-zero bytes each. Zod's
`.meta()`/`.describe()` (via `z.registry<Meta>()` or `z.globalRegistry`) is
metadata that automatically flows into `z.toJSONSchema()` output
([zod.dev/metadata](https://zod.dev/metadata)) — lingo's equivalent is a
small opt-in passthrough (`title`/`examples`/`id`) merged into a field's
emitted JSON Schema: object-spread cost only, no registry class required, and
it lets a field nest into a larger hand-authored OpenAPI/JSON-Schema graph.
Zod's `z.toJSONSchema(schema, { target, ... })` is a first-party top-level
helper since v4 ([zod.dev/json-schema](https://zod.dev/json-schema)) — lingo
already implements the equivalent capability as
`field['~standard'].jsonSchema.output(options)` (a verified
[Standard JSON Schema](https://standardschema.dev/json-schema) implementation,
detailed in the AI SDK integration doc); a thin named `toJsonSchema(field,
{ target })` wrapper would be friendlier than reaching into `~standard` by
hand, for the same near-zero cost. One free differentiator worth a doc
one-liner: Zod's `unrepresentable` types (`bigint`, `date`, `map`, `set`,
`transform`, `custom`, …) throw by default when converting to JSON Schema —
lingo's fields never emit any of them, so every lingo field's output schema is
representable in every target, unconditionally.

Two patterns are worth skipping. A full chain builder (`.min().max().optional()`)
or a second "mini" entry mirroring Zod Mini's nested-call/tree-shaking style
(`import * as z from 'zod/mini'`) buys nothing here: lingo's config-object
fields (`quantityField(opts)`) are already plain function calls, which is
exactly what Zod Mini's chaining alternative exists to approximate — lingo
gets that benefit for free and a chain hierarchy would be the "speculative
abstraction" AGENTS.md forbids for narrow-purpose fields. Zod's
`.catch()`-style silent fallback (swap a validation failure for a default,
silently) is a harder no for a different reason: it directly contradicts
"LLM tools safer" — ambiguity must fail loud at the tool boundary (plan 020),
never silently substitute a guessed value. (Bundle-size context for why this
restraint matches lingo's own instincts: Valibot ships an equivalent
login-form schema in 1.37 kB vs. Zod's 17.7 kB vs. Zod Mini's 6.88 kB
([valibot.dev/guides/comparison](https://valibot.dev/guides/comparison/)),
while ArkType ships its parser+JIT unconditionally at 40 kB+ for runtime
speed — the opposite trade from lingo's zero-dep, budget-gated design.)

One gap worth a one-line flag rather than a fix: lingo's own JSON-Schema
emitter closures (`quantity-fields.ts`, `date-field.ts`) currently ignore the
`options.target`/`libraryOptions` argument the Standard JSON Schema spec
passes them — spec-legal (the spec treats these as advisory) and harmless
today since lingo only ever emits `{type, description, minimum, maximum,
enum}`, stable across every target, but worth revisiting before advertising
true per-target fidelity (e.g. OpenAPI 3.0's `nullable: true` vs. `type:
[..., 'null']`).

Effect Schema deserves a credit, not an adoption, and the credit belongs in
`wiki/inspiration.md` (a follow-up outside this doc's scope; see
Implications). `Schema.transform({ decode, encode })` forces every transform
to declare both directions explicitly, and Effect's own canonical teaching
example is literally **height**: a number ↔ a formatted string via paired
`decode`/`encode` functions
([effect.website/docs/schema/transformations](https://effect.website/docs/schema/transformations/)).
That is the same law as AGENTS.md hard rule 4 (round-trip corpus tests),
arrived at independently — worth crediting even though it requires zero code
change. (Effect Schema's `Schema.standardSchemaV1` implements only base
`StandardSchemaV1`/`validate`, with no `jsonSchema` converter — confirmed via
Effect's own docs and changelog, which describe JSON Schema generation as a
deliberately separate, non-standard `JSONSchema.make()` module. That's a
`/ai`-integration fact belonging to the companion AI SDK doc, not a reason to
discount the decode/encode credit here.)

## 6. Database input: canonicalize before the row, not in the column

The honest, working recipe is a **two-stage boundary**: lingo owns the
natural-language-to-canonical step *before* a database ever sees a row;
Drizzle (or any row-shape validator) validates only the already-canonical row
shape — positive, required, in range. lingo's own vocabulary already names the
concept this needs: `Quantity.base` is "the SI-anchored canonical number"
(`CONTEXT.md`) — confirmed directly against source as `'kg'` for mass and
`'m'` for length (`packages/lingo/src/units/mass.ts:4`,
`packages/lingo/src/units/length.ts:4`, each kind's `baseUnit` field). Store
`base` in one unambiguous numeric column; optionally keep the raw text for
audit/redisplay; format on read:

```ts
// db/schema.ts — one column, one unit, no ambiguity
import { pgTable, uuid, doublePrecision, text, timestamp } from 'drizzle-orm/pg-core'
export const shipments = pgTable('shipments', {
  id: uuid().defaultRandom().primaryKey(),
  weightKg: doublePrecision('weight_kg').notNull(),   // lingo's mass base unit — always kg
  weightRaw: text('weight_raw').notNull(),             // exact text the user/model sent, for audit + redisplay
  createdAt: timestamp().defaultNow().notNull(),
})
```

```ts
// write path — lingo canonicalizes at the tool/API boundary; Drizzle/zod only check row shape
import { quantityField } from '@pascal-app/lingo/ai'
import { createInsertSchema } from 'drizzle-zod'
const weightField = quantityField({ kind: 'mass', unit: 'kg', min: 0, output: 'quantity' })
const insertShape = createInsertSchema(shipments)
export async function createShipment(weightText: string) {
  const parsed = weightField.safeParse(weightText)        // "2500 lb" -> { value: { base: 1133.98, unit: 'kg', ... } }
  if (parsed.issues) throw new Error(parsed.issues[0].message)
  await db.insert(shipments).values(insertShape.parse({ weightKg: parsed.value.base, weightRaw: weightText }))
}
```

```ts
// read path — format() re-renders the one stored number in any target unit, two-way guaranteed
import { quantity } from '@pascal-app/lingo'
const row = await db.query.shipments.findFirst({ where: eq(shipments.id, id) })
const display = quantity(row.weightKg, 'kg').format({ unit: 'lb', significant: 4 }) // "5,512 lb"
```

Two things **not** to do, both verified by reading `drizzle-zod`'s types
directly rather than assuming compatibility. First: don't drop a `LingoField`
into a `drizzle-zod` column override. `createInsertSchema(table, { col:
override })` expects `override` to be an actual Zod schema instance (or a
`(schema) => schema.xxx()` callback over one) — not a generic Standard Schema
object. A `LingoField` is a Standard Schema, but it is not a `ZodType`, so
`createInsertSchema(t, { weightKg: someLingoField })` will not compose.
Generic column-level Standard Schema support is an open, unshipped Drizzle
feature request ([drizzle-orm#5167](https://github.com/drizzle-team/drizzle-orm/issues/5167)),
and `drizzle-valibot`/`drizzle-arktype` have the identical, library-specific
constraint. Second: don't reach for Postgres-native unit storage as an
alternative. `postgresql-unit`
([github.com/df7cb/postgresql-unit](https://github.com/df7cb/postgresql-unit))
is a real C extension with a base-units-only storage model conceptually
identical to lingo's `base` — but it requires C-extension install privileges
unavailable on Supabase, Neon, or RDS-managed Postgres, so it isn't portable
enough to recommend. Plain `doublePrecision`/`numeric` plus app-layer
canonicalization is the only portable answer, and it's exactly what the
two-stage boundary above already does. (Drizzle is also mid-migration to v1 —
`drizzle-zod`/`-valibot`/`-arktype` are being folded into `drizzle-orm` core,
and the standalone `-valibot`/`-arktype` packages are already deprecated — so
any published version of this recipe should be dated and revisited at Drizzle
v1 GA.)

## Implications for lingo

This research feeds [plan 024](../../plans/024-ecosystem-integration-and-docs.md)
directly; decisions on what ships land there, not here.

- **Form-UX showcase.** The eight-example table in §4 satisfies plan 024's
  success criterion of "≥6 grounded before/after form examples + real
  unit-error citations" for `docs/recipes.md` + the site's showcase gallery —
  each example should carry its matching §2 disaster citation where one
  exists (Mars Climate Orbiter next to the height/weight example, Gimli
  Glider next to shipping, insulin/ISMP next to dosing), not just the generic
  "error prevented" summary.
- **Scope the marketing claim, explicitly.** §1's boundary — "collapses one
  value + one unit dropdown," never "replace your whole form with a sentence"
  — is a documentation-copy decision to enforce wherever lingo's form story is
  told (README, site, `docs/recipes.md`), not just a footnote here.
- **DX small-adds are corroborated, not new ideas.** Plan 024's candidate-code
  list already names a `toJsonSchema(field, { target })` ergonomic; §5
  corroborates shipping it (and a `.meta()`-style passthrough alongside it) as
  small, own-budget additions per the D19 escalation discipline. §5 also
  extends plan 024's existing non-goal (no fluent/chain field API) with a
  second one: no `.catch()`-style silent fallback, for the same
  ambiguity-must-fail-loud reason plan 020 already established.
- **Credit owed.** `wiki/inspiration.md` needs a new entry for Effect Schema's
  `decode`/`encode` duality (§5) — it independently validates hard rule 4 with
  zero code change, and the "give props" rule says this happens "immediately,
  not at release time." Not done as part of this file; flagged here as the
  next small edit.
- **Database recipe.** §6's two-stage boundary is ready to ship as-is into
  `docs/recipes.md`'s DB-input category (plan 024, Changes §2) — zero new
  runtime code, no new package. Explicitly do not build a Drizzle
  column-adapter (blocked on the unshipped drizzle-orm#5167) and do not
  recommend `postgresql-unit` (managed-Postgres privilege requirement kills
  portability).
- **Filename note.** This file consolidates two originally-separate research
  briefs (form-UX reduction and Zod/DB inspiration) into one narrative, since
  both tie to the same shared-`LingoOptions` fact.
- **Open risks to resolve before shipping vertical presets** (not yet
  decided, carried forward from both source briefs): moving from a closed
  unit dropdown to free text shifts the error surface from wrong-dropdown to
  ambiguous-string entry — the `/ai` boundary already hard-fails
  `AMBIGUOUS_NUMBER` by default (`toolOptions()`, `ai/quantity-fields.ts:49`),
  but the DOM/React layer needs the same discipline surfaced *to humans*
  through the existing `formatCandidate`/hint plumbing, not just assumed;
  `hintElement`/`aria-describedby` genuinely working for screen-reader users
  is an untested assumption, not a confirmed defect, and should be checked
  against WCAG patterns before shipping a medical-dosing or finance preset;
  and bounds-checking (`min`/`max`) cannot catch a magnitude error that lands
  inside a plausible range — the same quiet-failure shape as Gimli Glider,
  where the wrong figure still looked plausible enough to depart. A dosing
  field specifically must render its canonical mL value back to the user
  visibly (not just store it in a hidden input) or it risks recreating the
  exact "device markings don't match label" hazard §2's FDA/ISMP guidance
  exists to close.
