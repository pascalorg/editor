# Competitive landscape positioning (research 2026-07-09)

Multi-agent web research pass 2026-07-09. Claims are agent-reported and worth
re-verifying against primary sources before acting on any specific claim.
Subjects: chrono-node v2.9.1, convert-units v2.3.4/v3, js-quantities 1.8.0,
mathjs 15.2.0, UnitMath 1.1.1, Duckling (Facebook, Haskell), Microsoft
Recognizers-Text, compromise, date-fns, Luxon. Cross-referenced with lingo's
existing research in `units-libraries.md` and `date-parsing.md`.

## Ecosystem fragmentation: nobody unifies the four surfaces

The NL-parsing and units ecosystem is fragmented along four axes:

| Capability | Best-in-class today | What it lacks |
|---|---|---|
| NL date parsing | chrono-node (5M weekly, 14 locales) | One-way only; no format or round-trip |
| Unit conversion | convert-units (194K weekly) | Cannot parse text; exact-key input only |
| NL quantity extraction | Duckling (47 languages, 15 dimensions) | Haskell HTTP server; no JS-native; parse-only |
| Duration parsing | ms (Vercel) | No months; silent `undefined` on garbage; one-way |

No existing library combines parse + convert + validate + format behind spans, a
two-way guarantee, or an LLM tool-boundary layer. Lingo occupies that unique
intersection.

## What lingo must match (table stakes)

These capabilities exist in competitors and lingo must be at parity or
consciously narrower:

1. **chrono-node's known/implied component certainty model.** `isCertain('weekday')`
   distinguishes "user said Tuesday" (certain) from "user said 3pm" (weekday
   inferred). Lingo's `DateResult` carries grain and alternatives but does not yet
   expose per-component certainty (`explicit`|`inferred`|`default`). The gap is
   real and matters for the "tools safer" thesis: LLM tool consumers need to know
   what the user actually said vs what was assumed. (agent-researched, 2026-07-09)

2. **chrono-node's strict/casual dual-mode pattern.** `chrono.strict` disables
   relative expressions for data processing; `chrono.casual` allows them for
   user-facing input. Lingo's date parser could gate on a `mode` option rather
   than requiring callers to filter post-parse. (agent-researched, 2026-07-09)

3. **chrono-node's 14-locale coverage.** Lingo has 7 locale packs today
   (en, en-GB, es, fr, pt, zh, ja). The highest-demand gaps are German (de),
   Italian (it), Russian (ru), Dutch (nl), and Korean (ko).
   (agent-researched, 2026-07-09)

4. **Duckling's interval/comparative modifier grammar.** Duckling parses
   comparative modifiers ("over/above/at least/more than X", "under/below/at
   most/less than X") producing structured bound objects. Lingo already handles
   ranges, qualifiers, and open-ended bounds, but Duckling's English quantity
   test corpus (`Duckling/Quantity/EN/Corpus.hs`) would be a good coverage
   validation target. (agent-researched, 2026-07-09)

5. **convert-units' `toBest()` refinement options.** `cutOffNumber`, `exclude`,
   and `system` knobs. Lingo's `pickBestUnit` already has system-aware selection
   and a rank ladder; adding `exclude` and `cutOff` options to `ToBestOptions`
   matches the proven API surface. (agent-researched, 2026-07-09)

## What lingo should double down on (exclusive differentiators)

None of the surveyed competitors have any of these:

### 1. Spans on every result

Every lingo parse result carries `{ start, end }` character offsets into the
original input (hard rule 3). chrono-node has `index` (start offset only) but no
end offset and no spans on individual components or issues. convert-units,
js-quantities, mathjs, date-fns, Luxon, and ms have no span concept at all.
Duckling has character offsets but only at the entity level, not on sub-components
or error locations.

Spans enable: highlighting the problematic range in a form field, pinpointing
where a typo was in the input, and multi-entity extraction with precise source
locations. This is infrastructure that no JS competitor ships.
(agent-researched, 2026-07-09)

### 2. Two-way guarantee (round-trip invariant)

`parse(format(x)) === x` is a tested invariant across lingo's entire domain
(hard rule 4). No surveyed competitor guarantees or tests this:

- chrono-node: parse-only, no format
- convert-units: format returns `{val, unit}` object, does not emit parseable text
- date-fns: `formatDistance` emits qualifiers ("about 1 hour") that don't re-parse
- Luxon: formats/parses only structured ISO/RFC, not natural language
- js-quantities: `toString()` emits canonical unit notation, cannot parse NL
- Duckling: parse-only
- compromise: parse-only

The guarantee is the strongest possible correctness property for a formatting
library and should be the lead positioning claim. (agent-researched, 2026-07-09)

### 3. Standard Schema gap: no parser library fills it

Standard Schema v1 (3.6K GitHub stars) is consumed by Vercel AI SDK, TanStack
Form, react-hook-form resolvers, and shadcn/ui Field. No existing
parsing/units/date library implements it. Zod, Valibot, and ArkType implement
`StandardSchemaV1` for generic validation but perform no domain-specific
canonicalization. Lingo's `./ai` entry implements both `StandardSchemaV1` and
`StandardJSONSchemaV1`, making it the only NL-parsing library that plugs directly
into AI SDK `generateObject()`/`tool()`, TanStack Form validators, and
react-hook-form `standardSchemaResolver` without adapters.
(agent-researched, 2026-07-09)

### 4. Size wedge

| Library | Unpacked | min+gzip (est.) | Deps | Scope |
|---|---|---|---|---|
| lingo (full) | — | 36.9 kB | 0 | quantities + dates + durations + ranges + conversion + formatting + fuzzy + completions + locale detection |
| chrono-node | 3.5 MB | ~45 kB | 0 | dates only |
| convert-units | — | ~8 kB | 0 | conversion only (no NL parsing) |
| mathjs (units) | 9.4 MB | ~180 kB | 9 | algebraic units (no NL parsing) |
| Luxon | 4.6 MB | ~23 kB | 0 | date formatting (no NL parsing) |
| compromise | — | ~95 kB | 3 | general NLP |
| date-fns (full) | 10.9 MB | tree-shakeable | 0 | date utility (no NL parsing) |

Lingo replaces 3-4 partial solutions at a fraction of the combined size. The
marginal cost of each entry point is especially compelling: `lingo/date` adds
~13.1 kB on top of core, vs installing chrono-node separately at ~45 kB.
(agent-researched, 2026-07-09; size numbers from lingo's own `scripts/size.mjs`,
competitor sizes estimated from npm/bundlephobia)

## Throughput positioning

Lingo achieves ~493K ops/sec for simple quantities and ~340K ops/sec for dates
on ARM64 (bench baseline). A Duckling HTTP round-trip is orders of magnitude
slower (network + Haskell runtime). chrono-node publishes no throughput
benchmarks beyond trivial cases (empty string, single slash-date). Publishing
comparative numbers on shared corpora would sharpen lingo's performance claim.
(agent-researched, 2026-07-09)

## Positioning summary

lingo's competitive moat is the intersection no one else occupies:

```
parse NL text  +  convert  +  validate  +  format  +  round-trip guarantee
     +  spans on every result  +  Standard Schema boundary  +  zero deps
     +  headless DOM controller  +  AI tool repair
```

The go-to-market angle is *not* "better at one thing" but "the only library that
does all of them together, under 37 kB, with hard correctness properties." The
Standard Schema gap and the two-way guarantee are the most defensible
differentiators because they require architectural commitments competitors cannot
bolt on.
