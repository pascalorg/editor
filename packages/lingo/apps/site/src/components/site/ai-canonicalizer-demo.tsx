'use client'

import {
  type CanonicalizeIssue,
  type CanonicalizeSpec,
  canonicalizeValues,
  dateField,
  quantityField,
  rangeField,
} from '@pascal-app/lingo/ai'
import { useMemo, useState, useSyncExternalStore } from 'react'

import { AnimatedNumber } from '@/components/motion/animated-number'
import { DocsSplitPane } from '@/components/site/docs-split-pane'
import { JsonView } from '@/components/site/json-view'
import { ReadoutGrid, ReadoutGridItem } from '@/components/site/readout-grid'
import { Badge } from '@/components/ui/badge'
import { Field, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'

const DEMO_NOW = new Date(2026, 6, 3, 14, 30, 0)

const FIELD_SPEC = {
  weight: quantityField({ kind: 'mass', unit: 'kg' }),
  height: quantityField({ kind: 'length', unit: 'm' }),
  deliverBy: dateField({ now: DEMO_NOW }),
  boxWeight: rangeField({ kind: 'mass', unit: 'kg' }),
} satisfies CanonicalizeSpec

const FIELD_ROWS = [
  { path: 'weight', label: 'weight' },
  { path: 'height', label: 'height' },
  { path: 'deliverBy', label: 'deliverBy' },
  { path: 'boxWeight', label: 'boxWeight' },
] as const

const INITIAL_JSON = JSON.stringify(
  {
    weight: '2 lbs',
    height: '5\'11"',
    deliverBy: 'next tues',
    boxWeight: '3-5 kg',
  },
  null,
  2,
)

function codeFromMessage(message: string) {
  return message.match(/^\[([^\]]+)\]/)?.[1] ?? 'INVALID'
}

function issuesForPath(issues: CanonicalizeIssue[], path: string) {
  return issues.filter(
    (issue) =>
      issue.path === path || issue.path.startsWith(`${path}.`) || issue.path.startsWith(`${path}[`),
  )
}

const emptySubscribe = () => () => {}

// The demo canonicalizes relative dates ("next tues") against a local-time
// reference. The build machine's timezone differs from the visitor's, so the
// output must not be server-rendered (hydration mismatch). Gate on hydration.
function useHydrated() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  )
}

function computeCanonical(input: string) {
  try {
    const parsed = JSON.parse(input) as unknown
    return canonicalizeValues(parsed, FIELD_SPEC)
  } catch (error) {
    return {
      value: null,
      issues: [
        {
          path: '$',
          message: error instanceof Error ? error.message : 'Invalid JSON.',
          severity: 'error' as const,
        },
      ],
    }
  }
}

function numberAt(value: unknown, path: string) {
  if (!value || typeof value !== 'object') {
    return null
  }

  const current = path
    .split('.')
    .reduce<unknown>(
      (node, key) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined,
      value,
    )

  return typeof current === 'number' && Number.isFinite(current) ? current : null
}

function formatCanonicalNumber(value: number) {
  return JSON.stringify(value)
}

export function AiCanonicalizerDemo() {
  const [input, setInput] = useState(INITIAL_JSON)
  const hydrated = useHydrated()
  const result = useMemo(() => (hydrated ? computeCanonical(input) : null), [hydrated, input])
  const output = result ? JSON.stringify(result.value, null, 2) : ''
  const jsonIssue = result?.issues.find((issue) => issue.path === '$')
  const canonicalNumbers = useMemo(
    () => ({
      weight: numberAt(result?.value ?? null, 'weight'),
      height: numberAt(result?.value ?? null, 'height'),
      boxMin: numberAt(result?.value ?? null, 'boxWeight.min'),
      boxMax: numberAt(result?.value ?? null, 'boxWeight.max'),
    }),
    [result],
  )

  return (
    <div
      className="corner-smooth rounded-xl bg-muted/15 p-4 shadow-raise-sm"
      data-slot="ai-canonicalizer-surface"
    >
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-semibold text-sm">Model output, canonicalized</h3>
          <p className="mt-1 text-muted-foreground text-sm">
            Edit the textarea; the right panel shows the canonical tool payload.
          </p>
        </div>
        <div className="numeric-mono text-muted-foreground text-xs">now: 2026-07-03 14:30</div>
      </div>

      <DocsSplitPane className="md:grid-cols-2 lg:grid-cols-2">
        <Field className="min-w-0">
          <FieldLabel
            className="font-mono font-semibold text-[11px] text-muted-foreground uppercase tracking-wider"
            htmlFor="ai-raw-json"
          >
            raw JSON
          </FieldLabel>
          <Textarea
            aria-invalid={Boolean(jsonIssue)}
            className="code-surface code-scroll min-h-[18rem] resize-none rounded-[6px] py-3 font-mono text-sm"
            id="ai-raw-json"
            onChange={(event) => setInput(event.target.value)}
            spellCheck={false}
            value={input}
          />
        </Field>

        <div className="flex min-w-0 flex-col gap-3">
          <JsonView
            className={jsonIssue ? 'outline outline-1 outline-destructive' : undefined}
            heightClassName="h-[18rem]"
            label="canonical JSON"
            value={output}
          />
          {Object.values(canonicalNumbers).some((value) => value !== null) ? (
            <ReadoutGrid className="sm:grid-cols-2">
              <ReadoutGridItem label="weight">
                {canonicalNumbers.weight === null ? (
                  'missing'
                ) : (
                  <AnimatedNumber format={formatCanonicalNumber} value={canonicalNumbers.weight} />
                )}
              </ReadoutGridItem>
              <ReadoutGridItem label="height">
                {canonicalNumbers.height === null ? (
                  'missing'
                ) : (
                  <AnimatedNumber format={formatCanonicalNumber} value={canonicalNumbers.height} />
                )}
              </ReadoutGridItem>
              <ReadoutGridItem label="boxWeight.min">
                {canonicalNumbers.boxMin === null ? (
                  'missing'
                ) : (
                  <AnimatedNumber format={formatCanonicalNumber} value={canonicalNumbers.boxMin} />
                )}
              </ReadoutGridItem>
              <ReadoutGridItem label="boxWeight.max">
                {canonicalNumbers.boxMax === null ? (
                  'missing'
                ) : (
                  <AnimatedNumber format={formatCanonicalNumber} value={canonicalNumbers.boxMax} />
                )}
              </ReadoutGridItem>
            </ReadoutGrid>
          ) : null}
        </div>
      </DocsSplitPane>

      <div className="mt-4 flex min-h-14 flex-wrap items-start gap-1.5 overflow-visible">
        {result ? (
          jsonIssue ? (
            <Badge
              className="numeric-mono whitespace-nowrap"
              title={jsonIssue.message}
              variant="destructive"
            >
              error:JSON
            </Badge>
          ) : (
            FIELD_ROWS.map((field) => {
              const issues = issuesForPath(result.issues, field.path)
              if (issues.length === 0) {
                return (
                  <Badge
                    className="numeric-mono whitespace-nowrap"
                    key={field.path}
                    variant="secondary"
                  >
                    ok:{field.label}
                  </Badge>
                )
              }
              return issues.map((issue) => {
                const code = issue.code ?? codeFromMessage(issue.message)
                const blocking = issue.severity === 'error'
                return (
                  <Badge
                    className="numeric-mono whitespace-nowrap"
                    key={`${field.path}:${issue.path}:${code}:${issue.message}`}
                    title={issue.message}
                    variant={blocking ? 'destructive' : 'outline'}
                  >
                    {blocking ? 'error' : 'warn'}:{field.label}:{code}
                  </Badge>
                )
              })
            })
          )
        ) : null}
      </div>
    </div>
  )
}
