import { lingo } from '@pascal-app/lingo'
import { ChevronDownIcon } from 'lucide-react'
import Link from 'next/link'

import { CodeBlock } from '@/components/site/code-block'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// Rows are parsed with the real library at render time, so the landing table
// can never drift from actual parser behavior (two-way guarantee, hard rule 4).
const exampleInputs: { text: string; options?: Parameters<typeof lingo>[1]; note?: string }[] = [
  { text: '180cm', options: { kind: 'length' } },
  { text: `5'11"`, options: { kind: 'length' } },
  { text: '72 in to cm' },
  { text: '2 lb 3 oz', options: { kind: 'mass' } },
  { text: 'an hour and a half' },
  { text: 'between 5 and 10 kg' },
  { text: '1,5 kg', note: 'separator policy, not locale sniffing' },
  { text: "it's hot", options: { kind: 'temperature' }, note: 'fuzzy vocab is opt-in per field' },
  { text: '5 meterz', options: { kind: 'length' }, note: 'did-you-mean, absorbed as a warning' },
]

interface WireQuantity {
  base: number
  baseUnit: string
  type: 'quantity'
  unit: string
  value: number
}

function canonicalLabel(result: ReturnType<typeof lingo>): string {
  if (!result.ok) {
    return '—'
  }
  const wire = JSON.parse(JSON.stringify(result))
  switch (result.type) {
    case 'quantity': {
      const q = wire as WireQuantity
      return `${roundForDisplay(q.base)} ${q.baseUnit}`
    }
    case 'range':
      return `${roundForDisplay(wire.min.base)}–${roundForDisplay(wire.max.base)} ${wire.baseUnit}`
    case 'conversion':
      return `${roundForDisplay(wire.converted.value)} ${wire.converted.unit}`
    case 'number':
      return String(wire.value)
    default:
      return '—'
  }
}

function roundForDisplay(value: number) {
  return Number(value.toPrecision(6))
}

function readsAsLabel(result: ReturnType<typeof lingo>): string {
  if (!result.ok) {
    return 'no parse'
  }
  switch (result.type) {
    case 'quantity':
      return result.quantity.format({ significant: 5 })
    case 'range':
      return result.range.format({ significant: 5 })
    case 'conversion':
      return result.converted.format({ significant: 5 })
    case 'number':
      return String(result.value)
    default:
      return '—'
  }
}

const toolBeforeSnippet = `// What the model emits (strings, like people write)
{
  "weight": "2 lbs",
  "height": "5'11\\"",
  "deliverBy": "next tuesday"
}`

const toolAfterSnippet = `// After canonicalizeValues(args, spec)
{
  "weight": 0.90718474,   // kg, exact legal factor
  "height": 1.8034,       // m
  "deliverBy": "2026-07-28T…Z"  // ISO, from an explicit now
}`

const toolSchemaSnippet = `import { lingoObject, quantityField, dateField } from '@pascal-app/lingo/ai'
import { tool } from 'ai'

const shipment = lingoObject({
  weight: quantityField({ kind: 'mass', unit: 'kg', min: 0 }),
  deliverBy: dateField(), // relative dates require an explicit now
})

// AI SDK, OpenAI strict, Anthropic, Gemini, LangChain, MCP — one schema
tool({ inputSchema: shipment, execute: run })`

const genUiSnippet = `// Generative UI: let the model assemble the form,
// let lingo own every quantity/date field it renders.
const field = useLingoInput({ kind: 'mass', unit: 'kg', name: 'weight_kg' })
// agent or human types "2 lbs" -> the form submits weight_kg=0.90718474`

export const landingFaq = [
  {
    question: `How do I parse 5'11" into meters in JavaScript?`,
    answer: `parseQuantity with kind: 'length' reads it as one compound value, and .to('m').value returns 1.8034. The same call handles 2 lb 3 oz, 1h30, unicode (½, μm, ′ ″), number words, and typos with did-you-mean — zero dependencies.`,
    href: '/docs/parse',
  },
  {
    question: 'How do I validate LLM tool-call arguments like "2kg" or "next Friday"?',
    answer:
      'Declare tool inputs with quantityField / dateField from @pascal-app/lingo/ai. Models emit natural-language strings; lingo canonicalizes them at the tool boundary and fails loudly on ambiguity with a machine-actionable candidate instead of a silent guess.',
    href: '/docs/for-ai',
  },
  {
    question: 'Can one text input replace a value box plus a unit dropdown?',
    answer:
      'Yes — that is the core form pattern. A headless DOM controller, <lingo-input> web component, React hook, and React Native hook accept "180cm" or "5ft 11" and submit one hidden canonical value, with spans and stable issue codes for validation UX.',
    href: '/docs/forms',
  },
  {
    question: 'Does lingo have any runtime dependencies?',
    answer:
      'Zero. Every entry is tree-shakeable, size budgets are enforced in CI, and Intl (built into every runtime) handles locale-aware number formatting.',
    href: '/docs/installation',
  },
  {
    question: 'Which languages can lingo parse?',
    answer:
      'English is built in; opt-in locale packs add Spanish, French, Portuguese, Chinese, Japanese, and en-GB parsing. Packs are data-only subpath imports, so you ship only the languages you load.',
    href: '/docs/locales',
  },
  {
    question: 'Is parsing deterministic enough for agents and queued jobs?',
    answer:
      'Yes. Reference time is always an explicit now option (never Date.now() inside parsing), same input plus options gives the same output, and everything format() emits re-parses to the same value.',
    href: '/docs/dates',
  },
]

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: landingFaq.map((item) => ({
    '@type': 'Question',
    name: item.question,
    acceptedAnswer: { '@type': 'Answer', text: item.answer },
  })),
}

function SectionShell({
  title,
  explainer,
  children,
}: {
  title: string
  explainer: string
  children: React.ReactNode
}) {
  return (
    <section className="border-border border-t pt-10">
      <h2 className="font-semibold text-xl tracking-tight">{title}</h2>
      <p className="mt-2 max-w-[65ch] text-muted-foreground text-sm">{explainer}</p>
      <div className="mt-6 flex min-w-0 flex-col gap-6">{children}</div>
    </section>
  )
}

export function LandingSections() {
  const exampleRows = exampleInputs.map(({ text, options, note }) => {
    const result = lingo(text, options)
    return {
      text,
      readsAs: readsAsLabel(result),
      canonical: canonicalLabel(result),
      issues: result.issues.map((issue) => issue.code),
      note,
    }
  })

  return (
    <>
      <script
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(faqJsonLd).replace(/</g, '\\u003c'),
        }}
        type="application/ld+json"
      />
      <div className="flex flex-col gap-14 pb-8">
        <SectionShell
          explainer="These rows are parsed by the real library when this page builds — the same engine that runs in the hero above. Every result carries the original-input span and stable issue codes."
          title="What people type, what you store"
        >
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[30%]" scope="col">
                  They type
                </TableHead>
                <TableHead className="w-[26%]" scope="col">
                  Reads as
                </TableHead>
                <TableHead scope="col">You store (canonical)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {exampleRows.map((row) => (
                <TableRow key={row.text}>
                  <TableHead
                    className="h-auto whitespace-normal break-words align-top font-medium font-mono text-foreground text-sm"
                    scope="row"
                  >
                    {row.text}
                  </TableHead>
                  <TableCell className="whitespace-normal break-words align-top text-muted-foreground">
                    {row.readsAs}
                  </TableCell>
                  <TableCell className="whitespace-normal break-words align-top">
                    <div className="flex flex-col gap-1.5">
                      <span className="font-mono text-foreground text-sm">{row.canonical}</span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        {row.issues.map((code) => (
                          <Badge className="font-mono" key={code} variant="outline">
                            {code}
                          </Badge>
                        ))}
                        {row.note ? (
                          <span className="text-muted-foreground text-xs">{row.note}</span>
                        ) : null}
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-muted-foreground text-sm">
            Ranges, conversions, tolerances, fuzzy words, typos, and six languages of number words —
            see everything the parser reads in{' '}
            <Link className="underline underline-offset-2 hover:text-foreground" href="/docs/parse">
              Parse
            </Link>{' '}
            and the full{' '}
            <Link
              className="underline underline-offset-2 hover:text-foreground"
              href="/docs/coverage"
            >
              unit catalog
            </Link>
            .
          </p>
        </SectionShell>

        <SectionShell
          explainer="One parser powers both sides: the same schema validates a human form and an LLM tool call."
          title="For the web. For LLMs."
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="corner-smooth flex flex-col gap-3 rounded-xl bg-muted/20 p-5 shadow-raise-sm">
              <span className="font-medium text-foreground">Make forms easier</span>
              <ul className="flex flex-col gap-2 text-muted-foreground text-sm">
                <li>
                  One text field replaces a value box plus a unit dropdown — accepts how people
                  actually type, typos included.
                </li>
                <li>
                  Fields are never yelled at mid-typing: <code className="font-mono">2 f</code> is
                  incomplete, not invalid. Issues carry stable codes, spans, and did-you-mean
                  suggestions.
                </li>
                <li>
                  Headless everywhere: DOM controller,{' '}
                  <code className="font-mono">&lt;lingo-input&gt;</code> web component, React hook,
                  React Native hook. No styles shipped.
                </li>
                <li>
                  Two-way guarantee: <code className="font-mono">1.9999 m</code> formats as{' '}
                  <code className="font-mono">6′7″</code>, never{' '}
                  <code className="font-mono">5′12″</code> — and re-parses to the same value.
                </li>
              </ul>
              <Link
                className="text-sm underline underline-offset-2 hover:text-foreground"
                href="/docs/forms"
              >
                Form inputs →
              </Link>
            </div>
            <div className="corner-smooth flex flex-col gap-3 rounded-xl bg-muted/20 p-5 shadow-raise-sm">
              <span className="font-medium text-foreground">Make LLM tools safer</span>
              <ul className="flex flex-col gap-2 text-muted-foreground text-sm">
                <li>
                  Models are better at emitting{' '}
                  <code className="font-mono">&quot;5&apos;11&quot;&quot;</code> than{' '}
                  <code className="font-mono">1.8034</code>. Standard Schema fields make the string
                  the reliable path.
                </li>
                <li>
                  Tool-boundary defaults fail loudly on ambiguous numbers, ignored timezones, and
                  clock-drifting relative dates — with candidates a model can self-correct from.
                </li>
                <li>
                  <code className="font-mono">repairToolCallWith</code> fixes malformed payloads
                  client-side, with no extra model round trip.
                </li>
                <li>
                  Deterministic and replayable: an explicit <code className="font-mono">now</code>{' '}
                  means a queued or retried tool call never drifts across midnight.
                </li>
              </ul>
              <Link
                className="text-sm underline underline-offset-2 hover:text-foreground"
                href="/docs/for-ai"
              >
                Tool fields →
              </Link>
            </div>
          </div>
        </SectionShell>

        <SectionShell
          explainer="Constrained decoding makes JSON parse. lingo checks whether the values mean what they should — and hands back canonical numbers your database can trust."
          title="The tool boundary, before and after"
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <CodeBlock code={toolBeforeSnippet} filename="model-output.json" lang="json" />
            <CodeBlock code={toolAfterSnippet} filename="canonical.json" lang="json" />
          </div>
          <CodeBlock code={toolSchemaSnippet} filename="shipment-tool.ts" lang="ts" />
          <CodeBlock code={genUiSnippet} filename="gen-ui-form.tsx" lang="tsx" />
          <p className="text-muted-foreground text-sm">
            The same schema drops into the Vercel AI SDK, OpenAI strict tools, Anthropic, Gemini,
            LangChain, and{' '}
            <Link className="underline underline-offset-2 hover:text-foreground" href="/docs/mcp">
              MCP
            </Link>{' '}
            — see{' '}
            <Link
              className="underline underline-offset-2 hover:text-foreground"
              href="/docs/one-schema"
            >
              one schema
            </Link>{' '}
            for the form-and-tool pairing.
          </p>
        </SectionShell>

        <SectionShell
          explainer="Short answers, with the docs section to go deeper."
          title="Frequently asked questions"
        >
          <div className="flex flex-col gap-2">
            {landingFaq.map((item) => (
              <details
                className="group corner-smooth rounded-xl bg-muted/20 p-4 shadow-raise-sm transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)] hover:bg-muted/40"
                key={item.question}
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-md font-medium text-foreground text-sm outline-none marker:hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background [&::-webkit-details-marker]:hidden">
                  {item.question}
                  <ChevronDownIcon
                    aria-hidden
                    className="size-4 shrink-0 text-muted-foreground transition-transform duration-[var(--motion-fast)] ease-[var(--ease-out)] group-open:rotate-180 motion-reduce:transition-none"
                  />
                </summary>
                <p className="mt-3 max-w-[70ch] text-muted-foreground text-sm">{item.answer}</p>
                <Link
                  className="mt-3 inline-block text-muted-foreground text-sm underline underline-offset-2 transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)] hover:text-foreground"
                  href={item.href}
                >
                  Read more →
                </Link>
              </details>
            ))}
          </div>
        </SectionShell>
      </div>
    </>
  )
}
