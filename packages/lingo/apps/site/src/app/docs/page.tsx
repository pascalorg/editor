import { allKinds } from '@pascal-app/lingo'
import { ISSUE_CODES } from '@pascal-app/lingo/schema'
import type { Metadata } from 'next'

import { EscalationLab } from '@/app/escalation/escalation-lab'
import { FormsLab } from '@/app/forms/forms-lab'
import { IntegrationsTabs } from '@/app/integrations/integrations-tabs'
import { AiCanonicalizerDemo } from '@/components/site/ai-canonicalizer-demo'
import { AiEvalReadout } from '@/components/site/ai-eval-readout'
import { SectionHeading, SubHeading } from '@/components/site/anchor-heading'
import { CalendarFieldDemo } from '@/components/site/calendar-field-demo'
import { CodeBlock } from '@/components/site/code-block'
import { CodeTabs } from '@/components/site/code-tabs'
import { CommandBlock } from '@/components/site/command-block'
import { CompletionsDemo } from '@/components/site/completions-demo'
import { CoverageExplorer } from '@/components/site/coverage-explorer'
import { DataGridDemo } from '@/components/site/data-grid-demo'
import { DocsNav } from '@/components/site/docs-nav'
import { DocsPageActions } from '@/components/site/docs-page-actions'
import { FormUxGallery } from '@/components/site/form-ux-gallery'
import { LatexUnitsDemo } from '@/components/site/latex-units-demo'
import { ParsePlayground } from '@/components/site/parse-playground'
import { PerformanceSection } from '@/components/site/performance-section'
import {
  StrictnessVariantWall,
  SystemNumberFormatVariantWall,
} from '@/components/site/variant-walls'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
  localeSnippet,
  reactNativeSnippet,
  schemaTabs,
  strictnessSnippet,
  typeSafetySnippet,
} from '@/lib/code-snippets'
import {
  docsMarkdown,
  getDocsMarkdownSection,
  getDocsMarkdownSectionUrl,
  markdownSectionIds,
} from '@/lib/docs.md'
import { docsNavGroups, docsTopLevelPages, getDocsPage } from '@/lib/docs-catalog'
import { formUxExampleRows } from '@/lib/form-ux-examples'
import { highlightCode } from '@/lib/highlight'

const mobileSections = docsTopLevelPages

const apiRows = [
  ['lingo(text, opts?)', 'Parse quantity, range, conversion, or number.'],
  [
    'parseQuantity(text, opts?)',
    'Parse a single quantity; conversion requests resolve to target unit.',
  ],
  ['parseRange(text, opts?)', 'Parse ranges; single values become degenerate ranges.'],
  ['partialState(text, opts?)', 'As-you-type state: empty, incomplete, valid, invalid.'],
  ['findQuantities(text, opts?)', 'Best-effort free-text scan with span offsets.'],
  [
    'completions(text, opts?)',
    'Ranked canonical readings for autocomplete (`@pascal-app/lingo/complete`).',
  ],
  ['quantity(value, unitRef, kind?)', 'Create a Quantity programmatically.'],
  ['convert(value, from, to)', 'Convert a plain number between units.'],
  ['convertDelta(value, from, to)', 'Convert differences without temperature offsets.'],
  ['fromJSON(json)', 'Rehydrate Quantity or QuantityRange JSON.'],
]

const valueProps = [
  [
    'Actually parses language',
    'Number words, unicode, typos, compounds, ranges, conversions, and fuzzy words.',
  ],
  [
    'Canonical underneath',
    'Every value normalizes to an SI-anchored base with exact legal factors.',
  ],
  ['Two-way', 'Everything format() and humanize*() emit re-parses to the same value.'],
  [
    'Honest about ambiguity',
    'A deterministic best reading plus ranked alternatives — never a silent guess.',
  ],
  [
    'Errors are UX',
    'Every issue carries a stable code, a message, an input span, and suggestions.',
  ],
  [
    'Tiny, zero-dep',
    'No runtime dependencies. Tree-shakeable entries. Intl for locale formatting.',
  ],
]

const optionRows = [
  ['kind', 'Bias unit resolution and restrict expected kind.'],
  ['unit', 'Assume a unit for bare numbers and set canonical field unit.'],
  ['system', 'Choose US, imperial, or metric unit families.'],
  ['numberFormat', 'Resolve ambiguous decimal and grouping separators.'],
  ['locale', 'Select a loaded language profile; omit it to auto-detect loaded packs.'],
  ['strictness', 'forgiving, confirm, or strict.'],
  [
    'accept',
    'Switch ranges, conversions, compounds, fuzzy, numberWords, approximations, bareNumbers.',
  ],
  ['tolerance', 'typos fix/suggest/off and ambiguity assume/confirm.'],
  ['escalate', 'Map issue codes to error, warning, or info.'],
  ['messages', 'Override human copy by issue code.'],
]

const aiStackCards = [
  {
    name: 'Vercel AI SDK',
    description: 'Pass a field into `tool()` / `Output.object()` with no Zod (v6/v7).',
  },
  {
    name: 'OpenAI',
    description: 'Strict function tools via `toJSONSchema()`; `safeParse` the args.',
  },
  {
    name: 'Anthropic',
    description: '`input_schema` + `is_error` tool results.',
  },
  {
    name: 'Google Gemini',
    description: '`parametersJsonSchema`; never the classic surface.',
  },
  {
    name: 'LangChain',
    description: '`withStructuredOutput()`; `canonicalizeValues` after `createAgent`.',
  },
  {
    name: 'MCP',
    description: '`lingoTool()` gives you a full `registerTool` contract.',
  },
]

const docsMiniSurfaceClassName = 'corner-smooth rounded-xl bg-muted/20 p-4 shadow-raise-sm'
const docsMiniSurfaceLinkClassName =
  'corner-smooth rounded-xl bg-muted/20 p-4 shadow-raise-sm outline-none transition-[background-color,color,box-shadow] duration-[var(--motion-fast)] ease-[var(--ease-out)] hover:bg-muted/35 hover:shadow-raise-md hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'

const aiWorkflowCards = [
  {
    name: 'Tool calls',
    description: 'Validate and canonicalize model arguments at the boundary.',
  },
  {
    name: 'Tool repair',
    description: '`repairToolCallWith()` fixes `"2kg"` → `2` with no extra model call.',
  },
  {
    name: 'Data collection',
    description: '`canonicalizeValues()` over extracted records before a DB write.',
  },
  {
    name: 'Evals',
    description: '`quantityMatch` / `dateMatch` grade unit and date equivalence.',
  },
  {
    name: 'Computer use',
    description: 'Agents type `5\'11"`; the field commits `1.8034`.',
  },
]

const sharedSchemaSnippet = `const shipment = lingoObject({
  weight: quantityField({ kind: 'mass', unit: 'kg', min: 0 }),
  deliverBy: dateField(),
})`

const toolSchemaSnippet = `import { tool } from 'ai'

// LLM emits "5 kg" / "next friday"; canonical on arrival
tool({ inputSchema: shipment, execute: run })`

const formSchemaSnippet = `import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'

// user types "5 kg" / picks a date; canonical on submit
useForm({ resolver: standardSchemaResolver(shipment) })`

const gridColumnSnippet = `// The column owns the unit; the cell owns nothing but text.
const columns = {
  mass: quantityField({ kind: 'mass', unit: 'kg' }),
  temp: quantityField({ kind: 'temperature', unit: 'C' }),
  price: quantityField({ kind: 'currency', unit: 'USD' }),
  shipBy: dateField({ now }),
}

function cell(column: keyof typeof columns, text: string) {
  const { value, warnings, issues } = columns[column].safeParse(text)
  if (issues) {
    return { state: 'refused', note: issues[0].message }
  }
  // "$12.50" resolved to USD, "half a ton" to a short ton — say so.
  return { state: warnings ? 'assumed' : 'ok', value, warnings }
}`

// Sourced from the package so the badge wall can't drift from IssueCode.
const issueCodes = Object.keys(ISSUE_CODES)

const DOCS_DESCRIPTION =
  'Make forms easier, LLM tools safer. One parser for forgiving human forms and stricter tool schemas: parse, strictness, forms, AI tool fields, MCP, convert, currency, dates, and API reference.'

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

const elementSnippet = `<script type="module">
  import { defineLingoInput } from '@pascal-app/lingo/element'
  defineLingoInput()
</script>

<form>
  <label for="height">Height</label>
  <lingo-input id="height" name="height_m" kind="length" unit="m"></lingo-input>
</form>
<!-- committing 5'11" submits height_m=1.8034 -->`

const mcpSnippet = aiSnippets.find((snippet) => snippet.value === 'mcp')?.code ?? ''

export const metadata: Metadata = {
  title: 'Docs',
  description: DOCS_DESCRIPTION,
  alternates: { canonical: '/docs' },
  // metadata.openGraph replaces (not merges) the layout's. Repeat the shared
  // fields so /docs doesn't inherit the root og:url.
  openGraph: {
    type: 'website',
    url: '/docs',
    siteName: 'lingo',
    title: 'Docs | lingo',
    description: DOCS_DESCRIPTION,
  },
}

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareSourceCode',
  name: 'lingo',
  url: 'https://lingo.pascal.app/',
  mainEntityOfPage: 'https://lingo.pascal.app/docs',
  description:
    'Make forms easier and LLM tools safer with natural-language values parsed into typed, span-backed TypeScript data.',
  programmingLanguage: 'TypeScript',
  runtimePlatform: 'JavaScript',
  license: 'MIT',
  codeRepository: 'https://github.com/pascalorg/lingo',
}

function Section({
  id,
  title,
  kicker,
  explainer,
  children,
}: {
  id: string
  title: string
  kicker?: string
  explainer: string
  children: React.ReactNode
}) {
  const markdown = getDocsMarkdownSection(id)

  return (
    <section className="group/docs-section mt-20 min-w-0 scroll-mt-20 border-border border-t pt-10">
      <div className="flex items-start justify-between gap-3">
        <SectionHeading id={id} kicker={kicker}>
          {title}
        </SectionHeading>
        {markdown ? (
          <DocsPageActions
            className="shrink-0 opacity-100 transition-opacity duration-[var(--motion-fast)] ease-[var(--ease-out)] sm:opacity-0 sm:group-hover/docs-section:opacity-100 sm:group-focus-within/docs-section:opacity-100"
            compact
            copiedLabel="Copied Section"
            copyLabel="Copy Section"
            markdown={markdown}
            markdownHref={getDocsMarkdownSectionUrl(id)}
          />
        ) : null}
      </div>
      <p className="mt-2 max-w-[65ch] text-muted-foreground text-sm">{explainer}</p>
      <div className="mt-8 flex min-w-0 flex-col gap-8">{children}</div>
    </section>
  )
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-foreground text-sm">
      {children}
    </code>
  )
}

function DataTable({ rows, columns }: { rows: string[][]; columns: [string, string] }) {
  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-[42%]" scope="col">
            {columns[0]}
          </TableHead>
          <TableHead scope="col">{columns[1]}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(([name, description]) => (
          <TableRow key={name}>
            <TableHead
              className="h-auto whitespace-normal break-words align-top font-medium font-mono text-foreground text-sm"
              scope="row"
            >
              {name}
            </TableHead>
            <TableCell className="whitespace-normal break-words align-top text-muted-foreground">
              {description}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export default async function Home() {
  const highlightedIntegrationSnippets = await Promise.all(
    integrationSnippets.map(async (snippet) => ({
      ...snippet,
      html: await highlightCode(snippet.code, snippet.lang),
    })),
  )

  return (
    <>
      <script
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c'),
        }}
        type="application/ld+json"
      />
      <div className="mx-auto grid w-full max-w-7xl grid-cols-1 px-4 pt-6 pb-8 sm:px-6 sm:pt-8 lg:px-8 xl:grid-cols-[15rem_minmax(0,48rem)] xl:gap-12">
        <aside className="hidden w-60 self-start xl:sticky xl:top-20 xl:block">
          <DocsNav
            className="minimal-scrollbar max-h-[calc(100dvh-7.5rem)] overflow-y-auto pr-3"
            groups={docsNavGroups}
            label="Sections"
          />
        </aside>

        <nav
          aria-label="Sections"
          className="mb-6 max-w-full overflow-x-auto border-border border-y bg-background/95 py-2 text-muted-foreground text-xs [-ms-overflow-style:none] [scrollbar-width:none] xl:hidden [&::-webkit-scrollbar]:hidden"
        >
          <div className="flex w-max min-w-full gap-1 px-1">
            {mobileSections.map((item) => (
              <a
                className="inline-flex h-8 shrink-0 items-center rounded-md px-2.5 transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)] hover:bg-[var(--control-muted-hover)] hover:text-foreground focus-visible:bg-[var(--control-muted-hover)] focus-visible:text-foreground focus-visible:outline-none"
                href={`#${item.id}`}
                key={item.id}
              >
                {item.title}
              </a>
            ))}
          </div>
        </nav>

        <article className="mx-auto w-full min-w-0 max-w-[48rem] xl:col-start-2 xl:mx-0">
          <section className="flex scroll-mt-20 flex-col gap-5 pt-6" id="introduction">
            <div className="flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <h1 className="max-w-3xl font-semibold text-3xl">lingo docs</h1>
                <DocsPageActions
                  className="hidden shrink-0 sm:inline-flex"
                  markdown={docsMarkdown}
                  markdownHref="/llms-full.txt"
                />
              </div>
              <div className="flex max-w-3xl flex-col gap-3 text-muted-foreground">
                <p>
                  Make forms easier, LLM tools safer. People type{' '}
                  <span className="font-mono text-foreground text-sm">180cm</span> or{' '}
                  <span className="font-mono text-foreground text-sm">5ft 11</span>; models emit{' '}
                  <span className="font-mono text-foreground text-sm">&quot;1½ cups&quot;</span> or{' '}
                  <span className="font-mono text-foreground text-sm">
                    &quot;twenty-five kg&quot;
                  </span>
                  ; your database wants canonical values: one number in one unit, one ISO date. The
                  parser turns both into validated data and humanizes it back.
                </p>
                <p>
                  On the web, one text field can replace a value box plus a unit dropdown. It stays
                  quiet mid-typing and puts a stable code, original-input span, and did-you-mean
                  candidate on every issue. At the tool boundary, the same parser validates what
                  models emit: ambiguity fails with an actionable candidate instead of a silent
                  guess.
                </p>
                <p>
                  Zero runtime dependencies. Entries are tree-shakeable. Pass an explicit{' '}
                  <span className="font-mono text-sm">now</span> for reproducible date parsing.
                  Start with Parse, then Forms for user input or Tool fields for LLM boundaries.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {valueProps.map(([name, description]) => (
                  <div className={docsMiniSurfaceClassName} key={name}>
                    <span className="font-medium text-foreground text-sm">{name}</span>
                    <span className="mt-1 block text-muted-foreground text-sm">{description}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <Section
            explainer="Install the package, then import from the entry that matches your runtime. Every entry is tree-shakeable."
            id="installation"
            kicker="package"
            title="Install"
          >
            <CommandBlock command="npm install @pascal-app/lingo" />
            <p className="text-muted-foreground text-sm">
              Zero runtime dependencies,{' '}
              <a className="underline underline-offset-2 hover:text-foreground" href="#coverage">
                <span className="numeric-mono text-foreground">{allKinds.length}</span> unit kinds
              </a>
              , and an{' '}
              <a className="underline underline-offset-2 hover:text-foreground" href="#api-schema">
                original-input span
              </a>{' '}
              on every result.
            </p>
          </Section>

          <span aria-hidden="true" className="block scroll-mt-20" id="usage" />
          <Section
            explainer="Turn any text into a canonical, validated value, then read it back. lingo() returns a discriminated union; shaped helpers fix the contract."
            id="parse"
            kicker="start here"
            title="Parse"
          >
            <ParsePlayground />
            <div className="flex min-w-0 flex-col gap-3">
              <SubHeading id="parse-completions">Autocomplete anything</SubHeading>
              <p className="text-muted-foreground text-sm">
                <code className="rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-foreground text-sm">
                  completions()
                </code>{' '}
                returns every plausible canonical reading ranked by confidence — prefix matches,
                unit ambiguity forks, and number alternatives — not just the single best parse.
              </p>
              <CodeBlock code={completionsSnippet} filename="complete.ts" lang="ts" />
            </div>
            <CompletionsDemo />
            <SystemNumberFormatVariantWall />
            <div className="flex min-w-0 flex-col gap-3">
              <SubHeading id="parse-find">Find values in text</SubHeading>
              <p className="text-muted-foreground text-sm">
                <code className="rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-foreground text-sm">
                  findQuantities
                </code>{' '}
                scans free text and returns every quantity, range, and conversion it finds, each
                with a{' '}
                <code className="rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-foreground text-sm">
                  span
                </code>{' '}
                pointing at the exact characters in the original string.
              </p>
              <CodeBlock code={findSnippet} filename="find.ts" lang="ts" />
            </div>
          </Section>

          <span aria-hidden="true" className="block scroll-mt-20" id="escalation" />
          <Section
            explainer="One strictness dial — forgiving, confirm, strict — sets field personality. Accept switches, tolerance, and escalate tune the pieces without changing the grammar."
            id="strictness"
            kicker="field personality"
            title="Strictness"
          >
            <CodeBlock code={strictnessSnippet} filename="strictness.ts" lang="ts" />
            <EscalationLab />
            <StrictnessVariantWall />
          </Section>

          <Section
            explainer="Turn any native input into a natural-language field: parse on input, never rewrite mid-typing, and submit one hidden canonical value on commit."
            id="forms"
            kicker="DOM + React + Native"
            title="Inputs"
          >
            <CodeBlock code={formSnippet} filename="dom-field.ts" lang="ts" />
            <FormsLab />
            <div className="flex min-w-0 flex-col gap-3">
              <SubHeading id="forms-element">Web component</SubHeading>
              <p className="text-muted-foreground text-sm">
                No framework adapter?{' '}
                <code className="rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-foreground text-sm">
                  &lt;lingo-input&gt;
                </code>{' '}
                is a form-associated custom element wrapping the same field through{' '}
                <code className="rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-foreground text-sm">
                  ElementInternals
                </code>
                , so{' '}
                <code className="rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-foreground text-sm">
                  FormData
                </code>
                , native labels, and{' '}
                <code className="rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-foreground text-sm">
                  :invalid
                </code>{' '}
                behave like any control in Vue, Svelte, Angular, or plain HTML.
              </p>
              <CodeBlock code={elementSnippet} filename="lingo-input.html" lang="html" />
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              <SubHeading id="forms-react-native">React Native</SubHeading>
              <p className="text-muted-foreground text-sm">
                <code className="rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-foreground text-sm">
                  useLingoTextInput
                </code>{' '}
                gives React Native{' '}
                <code className="rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-foreground text-sm">
                  TextInput
                </code>{' '}
                the same partial-state parsing and commit canonicalization without importing the DOM
                controller or React Native runtime.
              </p>
              <CodeBlock code={reactNativeSnippet} filename="weight-field.tsx" lang="tsx" />
            </div>
          </Section>

          <Section
            explainer="Wire the same field into React Hook Form, TanStack Form, Formik, Vue, Angular, shadcn/ui, or vanilla — one field contract, every stack."
            id="integrations"
            kicker="one field, any stack"
            title="Frameworks"
          >
            <p className="text-muted-foreground text-sm">
              One live preview field, then a grouped snippet picker: React Hook Form, TanStack Form,
              shadcn/ui, Vue, Svelte, a Next.js server action, and more — all feeding the same field
              contract.
            </p>
            <IntegrationsTabs snippets={highlightedIntegrationSnippets} />
          </Section>

          <Section
            explainer="Drop the unit dropdown: collapse one value plus one unit picker into a single natural-language field that still stores the canonical number."
            id="forms-ux"
            kicker="form UX"
            title="Unit fields"
          >
            <p className="text-muted-foreground text-sm">
              This wins for one value + one unit pair. Keep the form structure people expect, but
              stop making each value carry a separate required unit picker.
            </p>
            <div className="flex flex-col gap-3">
              <SubHeading id="forms-ux-examples">Before and after examples</SubHeading>
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[20%]" scope="col">
                      Topic
                    </TableHead>
                    <TableHead className="w-[40%]" scope="col">
                      Without lingo
                    </TableHead>
                    <TableHead scope="col">With lingo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {formUxExampleRows.map((row) => (
                    <TableRow key={row.topic}>
                      <TableHead
                        className="h-auto whitespace-normal break-words align-top font-medium text-foreground text-sm"
                        scope="row"
                      >
                        {row.topic}
                      </TableHead>
                      <TableCell className="whitespace-normal break-words align-top text-muted-foreground">
                        {row.without}
                      </TableCell>
                      <TableCell className="whitespace-normal break-words align-top">
                        <div className="flex flex-col gap-2">
                          <div className="flex flex-wrap gap-1.5">
                            {row.lingoInputs.map((input) => (
                              <Badge className="font-mono" key={input} variant="outline">
                                {input}
                              </Badge>
                            ))}
                          </div>
                          <p className="text-muted-foreground text-xs">{row.canonical}</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <FormUxGallery />
            <Alert>
              <AlertTitle>Unit-entry mistakes are expensive</AlertTitle>
              <AlertDescription>
                The Mars Climate Orbiter was lost to pound-force vs newton-seconds; the Gimli Glider
                ran out of fuel from a lb/L vs kg/L slip; insulin doses measured in mL instead of
                units are a documented harm class. A single canonical field removes the class.
              </AlertDescription>
            </Alert>
          </Section>

          <Section
            explainer="Let the model emit natural-language strings, then validate them with the same parser the UI uses — under stricter tool-boundary defaults for ambiguity, bounds, and closed schemas."
            id="for-ai"
            kicker="structured output"
            title="Tool fields"
          >
            <div className="flex flex-col gap-3 text-muted-foreground">
              <p className="text-foreground">
                Constrained decoding can make JSON parse. The parser checks whether the values mean
                what they should.
              </p>
              <p>
                JSON mode can&apos;t stop{' '}
                <code className="rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-foreground text-sm">
                  &quot;2kg&quot;
                </code>{' '}
                landing in a number field (
                <code className="rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-foreground text-sm">
                  Number(&quot;2kg&quot;)
                </code>{' '}
                →{' '}
                <code className="rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-foreground text-sm">
                  NaN
                </code>
                ,
                <code className="rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-foreground text-sm">
                  {' '}
                  z.coerce.number()
                </code>{' '}
                →{' '}
                <code className="rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-foreground text-sm">
                  NaN
                </code>{' '}
                too),
                <code className="rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-foreground text-sm">
                  {' '}
                  &quot;1,5&quot;
                </code>{' '}
                losing its locale, or{' '}
                <code className="rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-foreground text-sm">
                  new Date(&quot;03/04/2025&quot;)
                </code>{' '}
                silently picking the wrong month.
              </p>
              <p>
                Models are better at emitting{' '}
                <code className="rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-foreground text-sm">
                  &quot;5&apos;11\&quot;&quot;
                </code>{' '}
                than{' '}
                <code className="rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-foreground text-sm">
                  1.8034
                </code>{' '}
                ;{' '}
                <code className="rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-foreground text-sm">
                  @pascal-app/lingo/ai
                </code>{' '}
                makes that string the reliable path.
              </p>
              <p>
                Tool-boundary defaults: genuinely ambiguous numbers and ignored timezones fail with
                a machine-actionable candidate, reference-dependent dates require an explicit{' '}
                <code className="rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-foreground text-sm">
                  now
                </code>
                , bounds are enforced and advertised in the schema, object schemas are closed, and
                absorbed typo fixes surface as{' '}
                <code className="rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-foreground text-sm">
                  warnings
                </code>
                .
              </p>
            </div>
            <AiCanonicalizerDemo />
            <div className="flex flex-col gap-3">
              <SubHeading id="for-ai-stack">Providers</SubHeading>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {aiStackCards.map((card) => (
                  <div className={docsMiniSurfaceClassName} key={card.name}>
                    <span className="font-mono text-foreground text-xs">{card.name}</span>
                    <span className="mt-1 block text-muted-foreground text-sm">
                      {card.description}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-muted-foreground text-sm">
                The same{' '}
                <code className="rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-foreground text-sm">
                  lingoObject
                </code>{' '}
                is a Standard Schema. Standard-Schema-aware libraries take it directly; raw SDKs get
                the same input schema through{' '}
                <code className="rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-foreground text-sm">
                  toJSONSchema()
                </code>
                .
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <SubHeading id="for-ai-workflows">Workflows</SubHeading>
              <div className="grid gap-3 sm:grid-cols-2">
                {aiWorkflowCards.map((card) => (
                  <div className={docsMiniSurfaceClassName} key={card.name}>
                    <span className="font-medium text-foreground">{card.name}</span>
                    <span className="mt-1 block text-muted-foreground text-sm">
                      {card.description}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <CodeTabs tabs={aiSnippets} />
            <AiEvalReadout />
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <a
                className={docsMiniSurfaceLinkClassName}
                data-surface="llm-resource-link"
                href="/llms.txt"
              >
                <span className="font-mono text-foreground text-xs">/llms.txt</span>
                <span className="mt-1 block text-muted-foreground">
                  Agent index — links to every section and tier.
                </span>
              </a>
              <a
                className={docsMiniSurfaceLinkClassName}
                data-surface="llm-resource-link"
                href="/llms-full.txt"
              >
                <span className="font-mono text-foreground text-xs">/llms-full.txt</span>
                <span className="mt-1 block text-muted-foreground">
                  Full docs narrative as markdown.
                </span>
              </a>
              <a
                className={docsMiniSurfaceLinkClassName}
                data-surface="llm-resource-link"
                href="/llms-small.txt"
              >
                <span className="font-mono text-foreground text-xs">/llms-small.txt</span>
                <span className="mt-1 block text-muted-foreground">
                  Compressed API reference from the npm package.
                </span>
              </a>
            </div>
          </Section>

          <Section
            explainer="Turn a field shape into a complete MCP tool descriptor: a closed JSON Schema out, safeParse in, and [CODE] errors the model can self-correct from."
            id="mcp"
            kicker="agent tools"
            title="MCP tools"
          >
            <p className="text-muted-foreground text-sm">
              <code className="rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-foreground text-sm">
                lingoTool()
              </code>{' '}
              from{' '}
              <code className="rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-foreground text-sm">
                @pascal-app/lingo/mcp
              </code>{' '}
              builds the whole{' '}
              <code className="rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-foreground text-sm">
                registerTool
              </code>{' '}
              contract from a{' '}
              <code className="rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-foreground text-sm">
                lingoObject
              </code>{' '}
              shape. Bring any MCP SDK; lingo brings the schema and the validation.
            </p>
            <CodeBlock code={mcpSnippet} filename="mcp-tool.ts" lang="ts" />
            <p className="text-muted-foreground text-sm">
              With{' '}
              <code className="rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-foreground text-sm">
                requireNow
              </code>{' '}
              on,{' '}
              <code className="rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-foreground text-sm">
                &quot;tomorrow&quot;
              </code>{' '}
              bounces back with{' '}
              <code className="rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-foreground text-sm">
                NOW_REQUIRED
              </code>
              , so a queued tool call can never drift across midnight.
            </p>
          </Section>

          <Section
            explainer="Use one lingoObject to validate an LLM tool argument and canonicalize a human form, unchanged."
            id="one-schema"
            kicker="forms + AI"
            title="One schema"
          >
            <CodeBlock code={sharedSchemaSnippet} filename="schema.ts" lang="ts" />
            <div className="grid gap-4 sm:grid-cols-2">
              <CodeBlock code={toolSchemaSnippet} filename="tool.ts" lang="ts" />
              <CodeBlock code={formSchemaSnippet} filename="form.tsx" lang="tsx" />
            </div>
            <p className="text-muted-foreground text-sm">
              Type{' '}
              <code className="rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-foreground text-sm">
                5&apos;11&quot;
              </code>{' '}
              or emit{' '}
              <code className="rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-foreground text-sm">
                &quot;5 kg&quot;
              </code>{' '}
              ; both arrive canonical. (Whole-form resolvers use{' '}
              <code className="rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-foreground text-sm">
                lingoObject(shape, {'{ passthrough: true }'})
              </code>{' '}
              for fields lingo doesn&apos;t own.)
            </p>
            <div className="flex min-w-0 flex-col gap-3">
              <SubHeading id="one-schema-grid">A column is a schema</SubHeading>
              <p className="text-muted-foreground text-sm">
                The same idea scales past a single field. Give a table column a{' '}
                <Code>quantityField</Code> and a cell can take any notation that column can resolve
                — pounds and ounces, a comma decimal, Fahrenheit — normalizing into one canonical
                unit, so the totals row can just add numbers. What it cannot resolve stays an issue
                on the cell that caused it.
              </p>
            </div>
            <CodeBlock code={gridColumnSnippet} filename="columns.ts" lang="ts" />
            <DataGridDemo />
          </Section>

          <Section
            explainer="Convert between units with exact legal factors — temperature deltas included — then render values back with best-fit and compound output."
            id="convert"
            kicker="units in, units out"
            title="Convert & format"
          >
            <CodeBlock code={convertSnippet} filename="convert.ts" lang="ts" />
            <p className="text-muted-foreground text-sm">
              <Code>convert</Code> throws on a bad pair; <Code>tryConvert</Code> returns a
              structured issue instead. <Code>convertDelta</Code> converts a difference — a 5 °C
              rise is a 9 °F rise, not 41. Everything <Code>format()</Code> emits re-parses to the
              same value.
            </p>
            <div className="flex min-w-0 flex-col gap-3">
              <SubHeading id="convert-notation">Typeset the reading</SubHeading>
              <p className="text-muted-foreground text-sm">
                A canonical reading is structured enough to render as notation, not just text. The
                unit id and the numeric value are separate fields, so <Code>m/s2</Code> becomes a
                real fraction with a superscript and <Code>±</Code> tolerance becomes a proper
                interval. This demo maps results to LaTeX in ~90 lines; lingo itself ships no
                renderer.
              </p>
            </div>
            <LatexUnitsDemo />
          </Section>

          <Section
            explainer="Parse symbols, ISO codes, and slang; format via Intl; convert with rates you supply — lingo never bundles or fetches FX."
            id="currency"
            kicker="money"
            title="Currency"
          >
            <CodeBlock code={currencySnippet} filename="currency.ts" lang="ts" />
            <p className="text-muted-foreground text-sm">
              Bare <Code>$</Code> and <Code>cents</Code> stay ambiguous — an{' '}
              <Code>AMBIGUOUS_UNIT</Code> warning — until you pass a <Code>currency</Code> context.
              Cross-currency <Code>convert()</Code> without rates fails with{' '}
              <Code>RATE_REQUIRED</Code>, never a silent wrong answer.
            </p>
          </Section>

          <Section
            explainer="Relative dates parse against an explicit now for reproducible results, and the humanizer's output always re-parses within one grain."
            id="dates"
            kicker="time"
            title="Dates & durations"
          >
            <CodeBlock code={datesSnippet} filename="dates.ts" lang="ts" />
            <p className="text-muted-foreground text-sm">
              Import from <Code>@pascal-app/lingo/date</Code>. Times of day read the way people
              write them (<Code>17h</Code>, <Code>quarter past 5</Code>, <Code>5.30pm</Code>,{' '}
              <Code>midi</Code>); a trailing timezone is exposed on <Code>.zone</Code> and resolved
              with <Code>applyZone</Code>; and <Code>parseDateRange</Code> turns a slot like{' '}
              <Code>2pm to 4pm</Code> or <Code>9-5</Code> into <Code>{'{ start, end }'}</Code>.
              Reference-dependent input needs an explicit <Code>now</Code>, so a queued job parses
              the same date every time. Browse what it reads under{' '}
              <a className="underline underline-offset-2" href="#coverage-dates">
                Date shorthand
              </a>{' '}
              and{' '}
              <a className="underline underline-offset-2" href="#coverage-time-slots">
                Time slots
              </a>
              .
            </p>
            <div className="flex min-w-0 flex-col gap-3">
              <SubHeading id="dates-calendar">One field, three readings</SubHeading>
              <p className="text-muted-foreground text-sm">
                <Code>parseDateRange</Code> also reads date-to-date spans (
                <Code>Aug 3 - Aug 9</Code>) and whole calendar periods (<Code>next week</Code>,{' '}
                <Code>this weekend</Code>, <Code>next month</Code>), each expanded to its real first
                and last day. Because the reading says which shape it found, one input can decide
                between a day picker, a two-month range picker, and a time slot — no mode toggle for
                the person typing.
              </p>
            </div>
            <CalendarFieldDemo />
          </Section>

          <Section
            explainer="Load only the language packs you need. English stays the default; pass a locale for a known field or omit it to detect among loaded packs."
            id="locales"
            kicker="i18n"
            title="Locales"
          >
            <CodeBlock code={localeSnippet} filename="locales.ts" lang="ts" />
            <p className="text-muted-foreground text-sm">
              Locale packs are data-only subpath entries: <Code>@pascal-app/lingo/locales/en</Code>,{' '}
              <Code>en-gb</Code>, <Code>es</Code>, <Code>fr</Code>, <Code>pt</Code>, <Code>zh</Code>
              , and <Code>ja</Code>. Successful parses expose <Code>result.locale</Code>, which the
              playground above shows beside the parse state.
            </p>
          </Section>

          <Section
            explainer="Browse every kind, unit, alias, and fuzzy vocabulary the parser understands, plus the deterministic date shorthand it reads."
            id="coverage"
            kicker="browse"
            title="Catalog"
          >
            <CoverageExplorer />
          </Section>

          <Section
            explainer="See what the benchmark means in product terms: fast enough for typing, fast enough for imports, with the local machine details attached."
            id="performance"
            kicker="speed"
            title="Performance"
          >
            <PerformanceSection />
          </Section>

          <Section
            explainer="Register custom kinds and units, define fuzzy vocab, isolate instances for SSR or multi-tenant apps, and bring your own message copy."
            id="extend"
            kicker="make it yours"
            title="Extend"
          >
            <CodeBlock code={extendSnippet} filename="extend.ts" lang="ts" />
            <p className="text-muted-foreground text-sm">
              Custom kinds get parsing, conversion, formatting, and did-you-mean for free — like a
              per-order <Code>package_count</Code> kind:
            </p>
            <CodeBlock code={customKindsSnippet} filename="custom-kinds.ts" lang="ts" />
            <p className="text-muted-foreground text-sm">
              For a minimal build, <Code>@pascal-app/lingo/core</Code> ships the engine with an
              empty registry and no English copy — register it with{' '}
              <Code>setDefaultMessages(englishMessages)</Code> or supply your own message pack per
              call.
            </p>
          </Section>

          <Section
            explainer="An opt-in, self-explaining view of a value or result for logs, docs, debugging, and tool output — object names, grouped fields, source text on spans, and rich unit labels."
            id="resource-views"
            kicker="readable output"
            title="Resource views"
          >
            <CodeBlock code={describeSnippet} filename="describe.ts" lang="ts" />
            <p className="text-muted-foreground text-sm">
              <Code>describeResource()</Code> and <Code>describeResult()</Code> live in{' '}
              <Code>@pascal-app/lingo/describe</Code>. They don&apos;t replace compact{' '}
              <Code>toJSON()</Code> wire storage — they&apos;re the human- and agent-readable
              counterpart.
            </p>
          </Section>

          <Section
            explainer="Reference the core functions, option knobs, issue codes, and the literal-typed unit refs used by the demos."
            id="api"
            kicker="reference"
            title="API"
          >
            <div className="flex flex-col gap-8">
              <div className="flex flex-col gap-3">
                <SubHeading id="api-core">Core functions</SubHeading>
                <DataTable columns={['Export', 'Purpose']} rows={apiRows} />
              </div>
              <div className="flex flex-col gap-3">
                <SubHeading id="api-options">Options</SubHeading>
                <DataTable columns={['Option', 'Purpose']} rows={optionRows} />
              </div>
              <div className="flex min-w-0 flex-col gap-3">
                <SubHeading id="api-schema">Data schemas</SubHeading>
                <p className="text-muted-foreground text-sm">
                  Every result serializes to a flat, versioned shape (<Code>schemaVersion: 3</Code>
                  ). These are the canonical wire types — what <Code>JSON.stringify(result)</Code>,{' '}
                  <Code>toJSON()</Code>, and the{' '}
                  <a className="underline underline-offset-2 hover:text-foreground" href="#for-ai">
                    /ai
                  </a>{' '}
                  fields emit and re-parse. Every <Code>span</Code> is a half-open{' '}
                  <Code>[start, end)</Code> range into the original input.
                </p>
                <CodeTabs clampLongCode={false} tabs={schemaTabs} />
              </div>
              <div className="flex flex-col gap-3">
                <SubHeading id="api-issues">Issue codes</SubHeading>
                <div className="flex flex-wrap gap-2">
                  {issueCodes.map((code) => (
                    <Badge
                      className="h-7 rounded-md font-mono text-muted-foreground"
                      key={code}
                      variant="outline"
                    >
                      {code}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-3">
                <SubHeading id="api-types">Type safety</SubHeading>
                <p className="text-muted-foreground text-sm">
                  Unit refs are literal-typed from the registry, so cross-kind and unknown-unit
                  mistakes are compile errors at zero runtime cost. Dynamic strings still work as
                  the escape hatch.
                </p>
                <CodeBlock code={typeSafetySnippet} filename="type-safety.ts" lang="ts" />
              </div>
            </div>
          </Section>

          <nav aria-label="Section pages" className="mt-20 border-border border-t pt-8 text-sm">
            <p className="font-semibold text-base tracking-tight">Section pages</p>
            <p className="mt-2 max-w-[65ch] text-muted-foreground">
              Every section is also a standalone page (append <Code>.md</Code> to any of them for
              the markdown version an agent can fetch).
            </p>
            <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-muted-foreground">
              {markdownSectionIds.map((id) => {
                const sectionPage = getDocsPage(id)
                return sectionPage ? (
                  <li key={id}>
                    {/* Plain <a>: standalone pages are statically generated;
                        client nav would re-mount this whole demo page anyway. */}
                    <a
                      className="underline underline-offset-2 transition-colors hover:text-foreground"
                      href={`/docs/${id}`}
                    >
                      {id === 'introduction' ? 'Introduction' : sectionPage.title}
                    </a>
                  </li>
                ) : null
              })}
            </ul>
          </nav>
        </article>
      </div>
    </>
  )
}
