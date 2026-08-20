import {
  aiSnippets,
  completionsSnippet,
  convertSnippet,
  currencySnippet,
  datesSnippet,
  describeSnippet,
  extendSnippet,
  findSnippet,
  formSnippet,
  integrationSnippets,
  parseSnippet,
  reactNativeSnippet,
  reactSnippet,
  schemaTabs,
  strictnessSnippet,
  typeSafetySnippet,
} from '@/lib/code-snippets'
import { getMarkdownSectionId } from '@/lib/docs-catalog'
import { formUxExampleRows } from '@/lib/form-ux-examples'

function fenced(lang: string, code: string) {
  return [`~~~${lang}`, code, '~~~'].join('\n')
}

const integrationBlocks = integrationSnippets
  .map((snippet) => `### ${snippet.label}\n\n${fenced(snippet.lang, snippet.code)}`)
  .join('\n\n')

const mcpSnippet = aiSnippets.find((snippet) => snippet.value === 'mcp')?.code ?? ''

const customKindsSnippet = `import { allKinds, createLingo } from '@pascal-app/lingo'

const appLingo = createLingo({
  kinds: [
    ...allKinds,
    {
      kind: 'package_count',
      baseUnit: 'item',
      units: [
        { id: 'item', symbol: 'item', name: 'item', factor: 1, system: 'shared' },
        { id: 'case', symbol: 'case', name: 'case', factor: 24, system: 'shared' },
      ],
    },
  ],
})

appLingo.parseQuantity('3 cases', { kind: 'package_count', unit: 'item' })`

const docsIndexPointer = 'Full index of agent-readable pages: https://lingo.pascal.app/llms.txt'

export const docsMarkdown = [
  '# lingo',
  '',
  docsIndexPointer,
  '',
  'Make forms easier, LLM tools safer. People type `180cm` or `5ft 11`; models emit `"1½ cups"` or `"twenty-five kg"`; your database wants canonical values: one number in one unit, one ISO date. The parser turns both into validated data and humanizes it back.',
  '',
  'On the web, one text field can replace a value box plus a unit dropdown. It stays quiet mid-typing and puts a stable code, original-input span, and did-you-mean candidate on every issue. At the tool boundary, the same parser validates what models emit: ambiguity fails with an actionable candidate instead of a silent guess.',
  '',
  'Zero runtime dependencies. Entries are tree-shakeable. Pass an explicit `now` for reproducible date parsing. Start with Parse, then Forms for user input or Tool fields for LLM boundaries.',
  '',
  'Canonical docs live at `/docs`. The landing page at `/` contains the hero parser and live bento demos. Legacy demo paths (`/escalation`, `/forms`, `/coverage`, `/integrations`) redirect to matching `/docs#...` anchors.',
  '',
  'Install command: `pnpm add @pascal-app/lingo`. The site command block shares one package-manager choice across npm, pnpm, yarn, and bun.',
  '',
  '## Install',
  '',
  'Zero runtime dependencies. React is optional for the `@pascal-app/lingo/react` entry.',
  '',
  '- npm: `npm install @pascal-app/lingo`',
  '- pnpm: `pnpm add @pascal-app/lingo`',
  '- yarn: `yarn add @pascal-app/lingo`',
  '- bun: `bun add @pascal-app/lingo`',
  '',
  'Import from the entry that matches your runtime — every entry is tree-shakeable.',
  '',
  '## Parse',
  '',
  'Turn any text into a canonical, validated value, then read it back. Use `lingo()` for flexible fields; use shaped helpers for fixed contracts.',
  '',
  fenced('ts', parseSnippet),
  '',
  'Captions:',
  '',
  '- Universal parse: Conversion requests return target units without losing original spans.',
  '- Parse readout: Warnings can succeed; only errors block the value.',
  '- System and number format variants: System picks the gallon family; numberFormat resolves separator ambiguity.',
  '',
  'Canonical examples from the public docs:',
  '',
  '- `2 ft` parses as a length quantity with base `0.6096 m`.',
  '- `5\'11"` parses as approximately `1.8034 m` with feet/inches parts.',
  '- `72 in to cm` parses as a conversion with converted value `182.88 cm`.',
  '- `between 5 and 10 kg` parses as a mass range.',
  '- `a few minutes` parses as an approximate duration range.',
  '- `it\'s hot` parses as a temperature fuzzy range when `kind: "temperature"` is supplied.',
  '',
  '### Autocomplete anything',
  '',
  '`completions(text, opts?)` from `@pascal-app/lingo/complete` returns ranked, fully-parsed canonical readings of partial or ambiguous input — unit-prefix fan-out, unit-ambiguity forks, number alternatives, implied units, and range tails — each a canonical `text` plus a successful quantity/range/conversion result. A completion is none of the other three: it is not a failure `candidate`, a success `alternative`, or an issue `suggestion`.',
  '',
  fenced('ts', completionsSnippet),
  '',
  'Inject it into a field with `lingoInput({ complete, onComplete })` or `useLingoInput({ complete })`; the engine is never bundled into `@pascal-app/lingo/dom` or `/react`, and no popup UI ships. Pass `date` to opt into date completions without pulling `@pascal-app/lingo/date` into `/complete`.',
  '',
  '### Find values in text',
  '',
  '`findQuantities(text, opts?)` scans free text and returns every quantity, range, and conversion it finds, each with a `span` pointing at the exact characters in the original string.',
  '',
  fenced('ts', findSnippet),
  '',
  '## Strictness',
  '',
  'One strictness dial sets field personality without changing the grammar. Accept switches, tolerance, and escalate tune the pieces.',
  '',
  '- `forgiving`: default; assumptions, typos, slang, and ambiguities can succeed with issues.',
  '- `confirm`: assumption-class issues escalate to errors and attach a `candidate` result.',
  '- `strict`: confirm plus typo fixing off and number words, fuzzy vocab, approximations, and bare-number assumptions rejected.',
  '',
  fenced('ts', strictnessSnippet),
  '',
  "Four distinct mechanisms, never merged: `strictness` (the dial), `accept` switches (reject whole shapes, keep the candidate), `tolerance` (how hard the parser tries at typos/ambiguity), and `escalate` (remap one issue code's severity).",
  '',
  'Captions:',
  '',
  '- Strictness comparison: Escalated issues keep their code; only severity moves.',
  '- Acceptance controls: Switches reject shapes while preserving the candidate parse.',
  '- Strictness variants: Strictness changes issue severity, not grammar.',
  '',
  '## Inputs',
  '',
  'The DOM entry turns an input into a headless natural-language field. It ships no styles. It exposes state with ARIA and data attributes, adds a hidden input when `name` is supplied, canonicalizes on blur/Enter/submit, and supports programmatic `set()`, `commit()`, `update()`, and `destroy()`.',
  '',
  fenced('ts', formSnippet),
  '',
  'The React entry is a small hook over the DOM field contract.',
  '',
  fenced('tsx', reactSnippet),
  '',
  '### React Native',
  '',
  '`useLingoTextInput()` is a DOM-free hook for React Native `TextInput`. It returns controlled text handlers, canonical value and submit state, required/bounds issues, hints, and injected completion state without importing `react-native`.',
  '',
  fenced('tsx', reactNativeSnippet),
  '',
  'Caption: Fields never rewrite while typing; commits canonicalize once.',
  '',
  'Form demo rules:',
  '',
  '- React hook: One ref carries state, value, and programmatic control.',
  '- Vanilla controller: The DOM contract stays headless outside React.',
  '- Native validation: Native validation blocks submit after parser commit.',
  '- Display modes: Canonical rewrites; echo formats; preserve keeps user text.',
  '- Constraints: Bounds fail at commit with spans on original text.',
  '- Range vs single: A rejected range remains available as a candidate.',
  '- Bidirectional range slider: Text parses to thumbs; pointer and keyboard movement humanizes back to text.',
  '- Agent and hidden value: Automation sets visible text; FormData submits canonical value.',
  '',
  'Deep link: `/docs#forms-range-slider` opens the bidirectional range slider directly.',
  '',
  'The range slider field binds `parseRange(text, { kind: "mass", unit: "kg" })` to a two-thumb kg slider (0 to 30 kg, 0.1 kg step). Valid text such as `8-12kg`, `8 to 12 kg`, `around 10kg`, `10kg +/-2`, or a single `10kg` moves the thumbs. Pointer and keyboard changes render humanized range text, but a focused input is never rewritten.',
  '',
  '### Web component',
  '',
  '`defineLingoInput()` from `@pascal-app/lingo/element` registers a form-associated `<lingo-input>` custom element wrapping the same field through `ElementInternals` instead of a hidden input. `FormData`, native labels, and `:invalid` behave like any control in Vue, Svelte, Angular, or plain HTML.',
  '',
  'DOM options documented by the public API include `kind`, `unit`, `displayUnit`, `display`, `strictness`, `accept`, `tolerance`, `escalate`, `min`, `max`, `required`, `name`, `errorElement`, `hintElement`, `formatCandidate`, `validationBehavior`, `messages`, and `debounce`.',
  '',
  '## Frameworks',
  '',
  'One field, every framework: React Hook Form, TanStack Form, Formik, Vue, Angular, shadcn/ui, vanilla, and a `<lingo-input>` web component.',
  '',
  'The docs show one live preview field, then a grouped integration picker with actual SVG brand logos and brand-color accents for each snippet. Vanilla, React, Next.js, React Hook Form, TanStack Form, shadcn/ui, Vue, Svelte, Node, agents, and the web component all feed the same field contract.',
  '',
  'The form-library snippets use the same field contract: `standardSchemaResolver(lingoObject(shape, { passthrough: true }))` for whole-form React Hook Form and shadcn/ui forms, `validators.onChange` plus a `useLingoInput` bridge for TanStack Form, and `defineLingoInput()` for the form-associated `<lingo-input>` element.',
  '',
  'Caption: The code swaps adapters; the field contract stays the same.',
  '',
  integrationBlocks,
  '',
  '## Unit fields',
  '',
  'Every value-plus-unit field asks the user to think like a database. Drop the unit dropdown: collapse one value plus one unit picker into one natural-language field that stores the canonical number.',
  '',
  'This wins for one value plus one unit pair. Keep the form structure people expect, but stop making each value carry a separate required unit picker.',
  '',
  'The `/docs#forms-ux` demo shows five realistic before/after forms:',
  '',
  ...formUxExampleRows.map(
    (row) =>
      `- ${row.topic}: Without lingo, ${row.without} With lingo: ${row.lingoInputs
        .map((input) => `\`${input}\``)
        .join(', ')}. ${row.canonical}`,
  ),
  '',
  '**Unit-entry mistakes are expensive.** The Mars Climate Orbiter was lost to pound-force vs newton-seconds; the Gimli Glider ran out of fuel from a lb/L vs kg/L slip; insulin doses measured in mL instead of units are a documented harm class. A single canonical field removes the class.',
  '',
  '## Tool fields',
  '',
  'Constrained decoding can make JSON parse. The parser checks whether the values mean what they should.',
  '',
  'JSON mode can\'t stop `"2kg"` landing in a number field (`Number("2kg")` → `NaN`, `z.coerce.number()` → `NaN` too), `"1,5"` losing its locale, or `new Date("03/04/2025")` silently picking the wrong month. Models are better at emitting `"5\'11\\""` than `1.8034`; `@pascal-app/lingo/ai` makes that string the reliable path.',
  '',
  'Tool-boundary defaults (plan 020), each with a one-line escape hatch: `AMBIGUOUS_NUMBER` escalates to error with a did-you-mean candidate ("1,234 kg" fails; the model re-emits "1234 kg"); `dateField` escalates `TZ_IGNORED` to error and requires an explicit `now` for reference-dependent dates (`"tomorrow"`, `"March 5"`, and `"at 3pm"` fail with `NOW_REQUIRED`; `requireNow: false` opts out by resolving from the wall clock at field validation; fully absolute dates are unaffected); `dateRangeField` applies the same reference-time and timezone guards to any `parseDateRange` shape — a time slot (`"2pm to 4pm"`, `"9-5"`), a dated span (`"Aug 3 - Aug 9"`), or a whole calendar period (`"next week"`, `"August"`) — and returns `{ start?, end?: ISO }`; `min`/`max` bounds fail with `RANGE_MIN`/`RANGE_MAX` and appear in JSON Schema `minimum`/`maximum` plus the input description; numeric `rangeField` output rejects open-ended inputs with `RANGE_OPEN_BOUND_NOT_ALLOWED`, while `output: "range"` returns full QuantityRange JSON with open bounds, exclusivity, fuzzy/approximate origin, and `baseUnit`; `lingoObject` is closed (`additionalProperties: false`, unknown keys fail, OpenAI strict compatible; `{ passthrough: true }` opts out); absorbed forgiveness (typos, assumed units, ambiguous dates under `dayFirst`) is surfaced as structured `warnings` on success; failures keep Standard Schema `message`/`path` and add lingo `code`, `severity`, field-input `span`, `data`, `suggestions`, and `candidate` when known; canonical numbers are float-safe.',
  '',
  'The docs demo at `/docs#for-ai` canonicalizes editable model JSON such as `{ "weight": "2 lbs", "height": "5\'11\\"", "deliverBy": "next tues", "boxWeight": "3-5 kg" }` with `canonicalizeValues`, `quantityField`, `rangeField`, and `dateField`.',
  '',
  '### Providers',
  '',
  '- Vercel AI SDK: pass a field into `tool()` / `Output.object()` with no Zod (v6/v7).',
  '- OpenAI: strict function tools via `toJSONSchema()`; `safeParse` the args.',
  '- Anthropic: `input_schema` + `is_error` tool results.',
  '- Google Gemini: `parametersJsonSchema`; never the classic surface.',
  '- LangChain: `withStructuredOutput()`; `canonicalizeValues` after `createAgent`.',
  '- MCP: `lingoTool()` gives you a full `registerTool` contract.',
  '',
  'The same `lingoObject` is a Standard Schema. Standard-Schema-aware libraries take it directly; raw SDKs get the same input schema through `toJSONSchema()`.',
  '',
  '### Workflows',
  '',
  '- Tool calls: validate and canonicalize model arguments at the boundary.',
  '- Tool repair: `repairToolCallWith()` fixes `"2kg"` → `2` with no extra model call.',
  '- Data collection: run `canonicalizeValues()` over extracted records before a DB write.',
  '- Evals: `quantityMatch` / `dateMatch` grade unit and date equivalence.',
  '- Computer use: agents type `5\'11"`; the field commits `1.8034`.',
  '',
  fenced('ts', aiSnippets[0].code),
  '',
  'AI code tabs on the page:',
  '',
  '- AI SDK: `generateText` with `Output.object({ schema })`, plus `tool({ inputSchema })` directly on the same `lingoObject`.',
  '- Repair: `repairToolCallWith(spec)` as `experimental_repairToolCall`; `experimental_repairText` is the deprecated v5 path.',
  '- Tool call: `canonicalizeValues(toolCall.args, spec)`; filter `severity === "error"` before executing business logic. Issue spans point into the field string, not the whole JSON payload.',
  '- MCP: `lingoTool()` emits `inputSchema` and wraps `safeParse` in the callback so the model gets `[CODE]`-prefixed tool errors.',
  '- OpenAI: Chat Completions strict function tools use `toJSONSchema(schema)` for `parameters`, then `safeParse` the tool arguments in the handler.',
  '- Anthropic: `input_schema: toJSONSchema(schema) as Anthropic.Tool.InputSchema`, with `is_error` tool results for parse failures.',
  '- Gemini: use `parametersJsonSchema`; never the classic `parameters`/`responseSchema` surface for a closed lingo schema.',
  '- LangChain: `model.withStructuredOutput(lingoObject({...}))` validates on supported model overrides; `createAgent` + `toolStrategy` validate shape only, so run `canonicalizeValues` yourself.',
  '- Evals: `quantityMatch` and `dateMatch` canonicalize both sides before scoring.',
  '- Computer use: `lingoInput` accepts agent-typed `5\'11"` and commits hidden `height_m=1.8034`.',
  '',
  'One schema travels across providers: Standard Schema-aware libraries can receive the lingo field directly, while raw provider SDKs get the same input side through `toJSONSchema()`. Keep optional tool arguments explicit with `optional(field)`; strict providers still see a required key whose type admits `null`.',
  '',
  'Eval framing: `Canonicalization-rate demo on a recorded corpus, not an end-to-end LLM benchmark.` When `site/src/data/ai-eval.json` exists at build time, the docs render acceptance rate and silent-wrong rate per category for naive vs. lingo. The two metrics are separate and never blended. When the file is absent, the eval readout renders nothing.',
  '',
  'The site exposes `/llms.txt` as the agent index, `/docs/<section>.md` for per-topic markdown, `/llms-full.txt` for the complete narrative, and `/llms-small.txt` as the npm-shipped compressed reference. Coding agents should fetch `/llms.txt` first, follow section `.md` URLs for the topic they need, and keep user quantities as strings until lingo validates them.',
  '',
  '## MCP tools',
  '',
  '`lingoTool()` from `@pascal-app/lingo/mcp` builds a complete MCP tool descriptor from a `lingoObject` shape: a closed JSON Schema out, `safeParse` in, and `[CODE]`-prefixed errors the model can self-correct from. Bring any MCP SDK; lingo brings the schema and the validation.',
  '',
  fenced('ts', mcpSnippet),
  '',
  'With `requireNow` on, `"tomorrow"` bounces back with `NOW_REQUIRED`, so a queued tool call can never drift across midnight.',
  '',
  '## One schema',
  '',
  'Use one `lingoObject` to validate an LLM tool argument and canonicalize a human form, unchanged.',
  '',
  fenced(
    'ts',
    `const shipment = lingoObject({
  weight: quantityField({ kind: 'mass', unit: 'kg', min: 0 }),
  deliverBy: dateField(),
})`,
  ),
  '',
  fenced(
    'ts',
    `import { tool } from 'ai'

// LLM emits "5 kg" / "next friday"; canonical on arrival
tool({ inputSchema: shipment, execute: run })`,
  ),
  '',
  fenced(
    'tsx',
    `import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'

// user types "5 kg" / picks a date; canonical on submit
useForm({ resolver: standardSchemaResolver(shipment) })`,
  ),
  '',
  'Type `5\'11"` or emit `"5 kg"`; both arrive canonical. (Whole-form resolvers use `lingoObject(shape, { passthrough: true })` for fields lingo doesn\'t own.)',
  '',
  '### A column is a schema',
  '',
  'The same field works per table column. Attach a `quantityField` to a column and a cell can take any notation that column can resolve — `3 lb 4 oz`, `1,2 kg`, `72°F` — normalizing into one canonical unit, so a totals row can add plain numbers. `safeParse` returns the canonical value plus any `warnings` (`UNIT_ASSUMED`, `AMBIGUOUS_UNIT`), so a grid can flag assumptions instead of hiding them; what it cannot resolve, such as a GBP amount in a USD column, comes back as an issue on that cell instead of a guess.',
  '',
  '## Convert & format',
  '',
  'Convert between units with exact legal factors (temperature deltas included), then render values back with best-fit and compound output. Everything `format()` emits re-parses to the same value.',
  '',
  fenced('ts', convertSnippet),
  '',
  '`convert` throws on a bad pair; `tryConvert` returns a structured issue instead. `convertDelta` converts a difference — a 5 °C rise is a 9 °F rise, not 41.',
  '',
  '### Typeset the reading',
  '',
  'A result keeps the unit id and the numeric value in separate fields, so rendering notation is a pure mapping over the result — `m/s2` becomes a fraction with a superscript, `±` tolerance becomes an interval. lingo ships no renderer; the docs site maps results to LaTeX for KaTeX in about ninety lines.',
  '',
  '## Currency',
  '',
  'Parse symbols, ISO codes, and slang; format via Intl; convert with rates you supply. lingo never bundles or fetches FX.',
  '',
  fenced('ts', currencySnippet),
  '',
  'Bare `$` and `cents` stay ambiguous (an `AMBIGUOUS_UNIT` warning) until you pass a `currency` context. Cross-currency `convert()` without rates fails with `RATE_REQUIRED`, never a silent wrong answer. `toMinor()`/`fromMinor()` handle Stripe integer minor units (JPY → 0 decimals, KWD → 3).',
  '',
  '## Dates & durations',
  '',
  'Relative dates parse against an explicit `now` for reproducible results, and the humanizer output always re-parses within one grain. Import from `@pascal-app/lingo/date`.',
  '',
  fenced('ts', datesSnippet),
  '',
  'Times of day read the way people write them — `17h`, `5 o’clock`, `quarter past 5`, `5.30pm`, `midi`/`minuit`, `0900 hours`. A trailing timezone is detected and exposed on `.zone` while the civil wall-clock is kept; pass `applyZone: true` to resolve the real UTC instant (offsets, abbreviations, and IANA names resolve DST-correctly via `Intl`). `parseDateRange` turns a slot like `2pm to 4pm`, `between 9am and 5pm`, or the `9-5` workday shift into `{ start, end }` endpoints, and `humanizeDateRange` renders it back.',
  '',
  'Reference-dependent input needs an explicit `now`, so a queued job parses the same date every time. Fully absolute dates never require it. Browse the shorthand it reads under Catalog → Date shorthand and Time slots.',
  '',
  '### One field, three readings',
  '',
  '`parseDateRange` reads three shapes: a time slot (`2pm to 4pm`), a date-to-date span (`July 1 to July 5`, `Aug 3 - Aug 9`, `2026-08-03 to 2026-08-09`), and a whole calendar period (`next week`, `this weekend`, `next month`, `August`, `2027`) expanded to its real first and last day. A coarse endpoint widens on the closing side too, so `July to August` ends on August 31 and `until August` does the same, while `from August` still opens on the 1st. `this weekend` read on a Saturday or Sunday is the weekend in progress, not the next one. A `dated` flag on the result says whether the span came from date grammar or clock grammar, which is what lets one input drive a day picker, a two-month range picker, or a slot picker without asking the person to choose a mode first. `humanizeDateRange` renders each shape back in a form that re-parses, and a descending pair such as `2026-08-09 to 2026-08-03` is swapped with a `RANGE_REVERSED` warning rather than handed back backwards.',
  '',
  'Outside the grammar, and returning `UNSUPPORTED_DATE` rather than a guess: quarters (`Q3`, `next quarter` — they need a fiscal-year anchor to mean anything), elliptical right sides (`Aug 3-9`), and ISO dates dash-joined with no spaces (`2026-08-01-2026-08-05` has four dashes and no way to tell which one splits; `2026-08-01 - 2026-08-05` and `2026-08-01 to 2026-08-05` both parse).',
  '',
  '## Locales',
  '',
  'Locale packs are opt-in and tree-shakeable. English is built in; load overlays with `createLingo({ locales })` and pass `locale` when a field is known, or omit it for auto-detection among loaded packs plus English.',
  '',
  fenced(
    'ts',
    `import { createLingo } from '@pascal-app/lingo'
import { es } from '@pascal-app/lingo/locales/es'
import { fr } from '@pascal-app/lingo/locales/fr'

const lingo = createLingo({ locales: [es, fr] })
lingo.parse('dos kg') // locale: 'es'
lingo.parse('72 in to cm') // locale: 'en'`,
  ),
  '',
  'Published packs: `@pascal-app/lingo/locales/en`, `en-gb`, `es`, `fr`, `pt`, `zh`, and `ja`. Pack-owned CJK unit aliases and fuzzy words are only registered when their pack is loaded. Passing an explicit locale that was not loaded returns `LOCALE_NOT_LOADED` instead of silently falling back to English.',
  '',
  'Each pack reads its language the way people write it, not a transliteration of English. Romance packs cover tens/hundreds/scale words (`ciento veinte`, `mille cinq cents`, `mil millones`), ordinal days (`le 1er mars`), and spoken decimals (`dos coma cinco`). The Chinese and Japanese packs cover grouped numerals (`一百五十万`), comparators that follow the quantity (`5キロ未満`, `5公斤以上`), trailing approximants (`五公斤左右`), and per-locale currency defaults — the shared `￥` resolves to CNY under `zh` and JPY under `ja`.',
  '',
  'Date parsing accepts the same packs directly: `parseDate("mañana", { now, locale: "es", localePacks: [es] })`. Localized date grammar includes spoken clocks (`las tres menos cuarto`, `deux heures et quart`), period edges (`a finales de mes`), weekday offsets (`lundi en huit`), and CJK calendar forms — suffix dates (`2026年3月5日`, `3月5日`), weekdays (`星期三`, `水曜日`), clocks with day periods (`午後3時半`, `下午3点`), and date+time written without a space (`明天下午3点`).',
  '',
  '## Catalog',
  '',
  'Kinds include SI bases, pressure units (`psi`, `hPa`, `inH₂O`, `kgf/cm²`), data rates (`Mbps`, `MB/s`), flow rates (`gpm`, `mL/min`), acceleration (`m/s²`, `gee`), torque (`N⋅m`, `lb-ft`), electrical units (`V`, `A`, `Ω`, `C`), substance (`mol`), concentration (`M`, `μM`, `mol/L`), light units (`cd`, `lm`, `lux`, `nit`), radiation units (`Gy`, `Sv`, `Bq`, `Ci`), fuzzy temperature bands, aliases, and date shorthand. Reader-facing unit notation uses real symbols such as `m²`, `ft²`, `in²`, `km²`, `Ω`, and `μ`; canonical JSON keeps separate stable machine ids. The read-only query surface is `@pascal-app/lingo/catalog`.',
  '',
  'Dates live under `@pascal-app/lingo/date`: `parseDate`, `parseDateRange`, `parseDuration`, `humanizeDate`, `humanizeDateRange`, and `humanizeDuration`. Date parsing accepts an explicit `now` option for deterministic results. Covered forms include today, tomorrow, yesterday, relative offsets, weekdays, next/last week/month/year, ISO dates, ambiguous numeric dates with alternatives, times of day (`at 3pm`, `17h`, `quarter past 5`, `5.30pm`, `midi`), timezones (`3pm EST`, `+05:30`, `Europe/Paris` — exposed by default, resolved with `applyZone`), time slots (`2pm to 4pm`, `between 9 and 5`, `9-5`, `from 3pm`), and calendar ranges (`Aug 3 - Aug 9`, `next week`, `this weekend`, `August`, `2027`).',
  '',
  'Captions:',
  '',
  '- Alias roulette: Aliases, unicode, and compounds normalize to one canonical base.',
  '- Fuzzy bands: Fuzzy words parse only when a kind supplies vocabulary.',
  '- Date shorthand: Reference time is explicit, so relative dates, year-less dates, and time-only inputs stay deterministic.',
  '',
  '## Performance',
  '',
  'The `/docs#performance` section translates `bench/baseline-node.json` into plain-English speed claims: cheap enough to run while someone types, and fast enough for large imports.',
  '',
  "The checked-in baseline uses a deterministic generated-English corpus built from lingo's built-in unit aliases, number forms, qualifiers, ranges, conversions, typos, dates, durations, and sentence templates. `caseCount` is the number of distinct generated inputs in a suite; `samples` is the number of timed runs used for the median.",
  '',
  'Current local Node v24.5.0 backend baseline:',
  '',
  '- Normal single-value field: 492,739 values/s across 900 generated cases, about 2.03 µs per input.',
  '- Mixed natural input: 389,820 parses/s across 791 generated cases, about 2.57 µs per input.',
  '- Strict bulk validation without did-you-mean suggestions: 550,270 checks/s across 240 generated unknown-unit cases, about 1.82 µs per row.',
  '- Sentence scanning: 53,533 scans/s across 260 generated sentence cases.',
  '- 50k-character no-match stress test: 0.341 ms.',
  '',
  'Bars show inputs parsed per second (higher is better); µs/op shows the time for one input (lower is better). The caption carries package version, runtime, platform, date, corpus version, and command so the numbers remain a local snapshot rather than a universal promise.',
  '',
  '## Extend',
  '',
  'Register custom kinds and units, define fuzzy vocab, isolate instances for SSR or multi-tenant apps, and bring your own message copy.',
  '',
  fenced('ts', extendSnippet),
  '',
  'Custom kinds get parsing, conversion, formatting, and did-you-mean for free — like a per-order `package_count` kind:',
  '',
  fenced('ts', customKindsSnippet),
  '',
  'For a minimal build, `@pascal-app/lingo/core` ships the engine with an empty registry and no English copy — register it with `setDefaultMessages(englishMessages)` or supply your own message pack per call. Nothing you register on a `createLingo()` instance leaks to the global one.',
  '',
  '## Resource views',
  '',
  'An opt-in, self-explaining view of a value or result for logs, docs, debugging, and tool output — object names, grouped fields, source text on spans, and rich unit labels. `describeResource()` and `describeResult()` live in `@pascal-app/lingo/describe`.',
  '',
  fenced('ts', describeSnippet),
  '',
  'Resource views do not replace compact `toJSON()` wire storage — they are the human- and agent-readable counterpart.',
  '',
  '## API',
  '',
  'Core exports from `@pascal-app/lingo`:',
  '',
  '- `lingo(text, opts?)`',
  '- `parseQuantity(text, opts?)`',
  '- `parseRange(text, opts?)`',
  '- `partialState(text, opts?)`',
  '- `findQuantities(text, opts?)`',
  '- `quantity(value, unitRef, kind?)`',
  '- `convert(value, from, to)`',
  '- `tryConvert(value, from, to)` (non-throwing, returns structured issues)',
  '- `convertDelta(value, from, to)`',
  '- `convertCurrency(amount, from, to, { rates })` (literal currency refs typed)',
  '- `fromMinor(amount, currency)` (literal currency refs typed)',
  '- `fromJSON(json)`',
  '- `describeResource(quantityOrRange)` and `describeResult(result)` from `@pascal-app/lingo/describe` for rich unit labels, formatted output, direct value resources, source text spans, and resource-style parse-result output for quantity/range/conversion/number/date/duration results',
  '- `registerKind(def)`, `registerUnits(kind, units)`, `defineFuzzyVocab(kind, vocab)`, `createRegistry(kinds)`, `createLingo(opts)`',
  '- `describeTemperature(quantity, opts?)`',
  '',
  'Options:',
  '',
  '- `kind`: Bias unit resolution and restrict expected kind.',
  '- `unit`: Assume a unit for bare numbers and set canonical field unit.',
  '- `currency`: Disambiguate bare currency symbols and ambiguous minor-unit words such as `$`, `¥`, and `cents`; explicit GBP pence forms such as `50p` and `3 quid 50` parse as GBP.',
  '- `system`: Choose US, imperial, or metric unit families.',
  '- `numberFormat`: Resolve ambiguous decimal and grouping separators.',
  '- `locale`: Select a loaded language profile; omit for auto-detection among loaded packs plus English.',
  '- `strictness`: forgiving, confirm, or strict.',
  '- `accept`: Switch ranges, conversions, compounds, fuzzy, numberWords, approximations, bareNumbers.',
  '- `tolerance`: typos fix/suggest/off and ambiguity assume/confirm.',
  '- `escalate`: Map issue codes to error, warning, or info.',
  '- `messages`: Override human copy by issue code.',
  '',
  'Parse results are versioned discriminated unions: `{ schemaVersion: 3, ok, type, text, issues }`; successes add `span`, `confidence`, and the parsed value, while failures use `type: "failure"` and may include a full `candidate` result. Success `alternatives` are also discriminated (`type: "quantity"` or `type: "date"`). Built-in `createLingo()` instances keep the same literal-unit checks as top-level `quantity`/`convert`/`tryConvert`; custom registry instances keep broad string refs. `tryConvert()` mirrors absolute `convert()` but returns `{ ok: true, type: "conversion", value, unit, kind }` or `{ ok: false, type: "failure", issues }` instead of throwing. Quantity instances expose `.value`, `.base`, `.unit`, `.kind`, `.to(unitRef)`, `.valueIn(unitRef)`, `.convertDelta(unitRef)`, `.toMinor()` for currencies, `.format(opts?)`, `.toBest(opts?)`, and `.toJSON()`. Format defaults are parseable; `localizedUnits: true` is display-only for Intl unit words. Quantity JSON is self-describing: `{ schemaVersion: 3, type, kind, value, unit, base, baseUnit }`; `@pascal-app/lingo/describe` adds unit labels and formatted strings for values, `describeResource()` returns direct `lingo.quantity` / `lingo.range` resources with grouped `value` and `canonical` amounts, and `describeResult()` returns an opt-in resource-style parse-result view with `object`, `resourceSchemaVersion`, grouped `value`/`canonical` amounts, range `canonicalUnit`, source text spans including full-input failure spans, rich issues, alternatives, candidates, conversion `{ source, target: { unit }, converted }` data, `lingo.date` `{ value: { iso, epochMilliseconds }, calendar, grain, known }`, and `lingo.duration` `{ value, canonical, formatted, parts? }`. Quantity ranges expose `.minBase`, `.maxBase`, `.min()`, `.max()`, `.plusMinus`, `.fuzzy`, `.contains(q)`, `.widthIn(unitRef)`, `.to(unitRef)`, and `.format()`.',
  '',
  'Issues are `{ code, severity, message, span, suggestions?, data? }`; parse-path spans are `{ start, end }` half-open offsets into the original input. Issue codes documented by the package: `EMPTY`, `NO_VALUE`, `UNKNOWN_UNIT`, `KIND_MISMATCH`, `RANGE_KIND_MISMATCH`, `CONVERSION_KIND_MISMATCH`, `RATE_REQUIRED`, `TRAILING_INPUT`, `SINGLE_VALUE_EXPECTED`, `APPROX_NOT_ALLOWED`, `UNIT_REQUIRED`, `CONVERSION_NOT_ALLOWED`, `NUMBER_FORMAT`, `NONFINITE`, `LOCALE_NOT_LOADED`, `RANGE_MIN`, `RANGE_MAX`, `RANGE_OPEN_BOUND_NOT_ALLOWED`, `REQUIRED`, `UNSUPPORTED_DATE`, `NOW_REQUIRED`, `TYPO_CORRECTED`, `AMBIGUOUS_NUMBER`, `AMBIGUOUS_UNIT`, `AMBIGUOUS_DATE`, `RANGE_REVERSED`, `COMPOUND_OVERFLOW`, `CIVIL_AVERAGE`, `UNIT_ASSUMED`, `WEEKDAY_ASSUMED_NEXT`, `SLANG_UNIT`, `TZ_IGNORED`, `AMBIGUOUS_TIMEZONE`.',
  '',
  '### Data schemas',
  '',
  'Every result serializes to a flat, versioned shape (`schemaVersion: 3`) — what `JSON.stringify(result)`, `toJSON()`, and the `/ai` fields emit and re-parse. Every `span` is a half-open `[start, end)` range into the original input.',
  '',
  ...schemaTabs.map((tab) => `#### ${tab.label}\n\n${fenced(tab.lang, tab.code)}`),
  '',
  '### Type safety',
  '',
  'Unit refs are literal-typed from the registry, so cross-kind and unknown-unit mistakes are compile errors at zero runtime cost. Dynamic strings still work as the escape hatch, validated at runtime.',
  '',
  fenced('ts', typeSafetySnippet),
  '',
].join('\n')

const markdownHeadings: Record<string, string> = {
  installation: 'Install',
  parse: 'Parse',
  strictness: 'Strictness',
  forms: 'Inputs',
  integrations: 'Frameworks',
  'forms-ux': 'Unit fields',
  'for-ai': 'Tool fields',
  mcp: 'MCP tools',
  'one-schema': 'One schema',
  convert: 'Convert & format',
  currency: 'Currency',
  dates: 'Dates & durations',
  locales: 'Locales',
  coverage: 'Catalog',
  performance: 'Performance',
  extend: 'Extend',
  'resource-views': 'Resource views',
  api: 'API',
}

function sliceMarkdownSection(heading: string) {
  const marker = `\n## ${heading}\n`
  const start = docsMarkdown.indexOf(marker)
  if (start < 0) {
    return null
  }

  const contentStart = start + 1
  const next = docsMarkdown.indexOf('\n## ', start + marker.length)
  return docsMarkdown.slice(contentStart, next < 0 ? undefined : next).trim()
}

function getIntroMarkdown() {
  const next = docsMarkdown.indexOf('\n## ')
  return docsMarkdown.slice(0, next < 0 ? undefined : next).trim()
}

// Every id that resolves to a `##` slice of docsMarkdown (plus the intro).
export const markdownSectionIds = ['introduction', ...Object.keys(markdownHeadings)]

export function isMarkdownSectionId(id: string) {
  return markdownSectionIds.includes(id)
}

const sectionContextHeader =
  'Part of the lingo docs (natural-language quantities, units, dates parser) — index: https://lingo.pascal.app/llms.txt'

function withSectionContext(markdown: string, sectionId: string) {
  return [
    sectionContextHeader,
    '',
    markdown,
    '',
    `Human docs: https://lingo.pascal.app/docs#${sectionId}`,
  ]
    .join('\n')
    .trimEnd()
}

export function getDocsMarkdownSectionUrl(id: string) {
  return `/docs/${getMarkdownSectionId(id)}.md`
}

export function getDocsMarkdownSection(id: string, { context = false } = {}) {
  const sectionId = getMarkdownSectionId(id)
  const body =
    sectionId === 'introduction'
      ? getIntroMarkdown()
      : markdownHeadings[sectionId]
        ? sliceMarkdownSection(markdownHeadings[sectionId])
        : null

  if (!body) {
    return null
  }

  return context ? withSectionContext(body, sectionId) : body
}
