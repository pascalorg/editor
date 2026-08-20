'use client'

import { createLingo, type Kind, type LingoResult } from '@pascal-app/lingo'
import {
  ActivityIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleDollarSignIcon,
  DumbbellIcon,
  type LucideIcon,
  PillIcon,
  RulerIcon,
  UtensilsIcon,
} from 'lucide-react'
import { useMemo, useState } from 'react'

import { DemoFrame } from '@/components/site/demo-frame'
import { DocsPaneSection, DocsSplitPane } from '@/components/site/docs-split-pane'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'

type LegacyField = {
  label: string
  unit: string
  units: string[]
  value: string
}

type LingoField = {
  helper: string
  id: string
  kind: Kind
  label: string
  unit: string
  value: string
}

type FormUxExample = {
  beforeRisk: string
  icon: LucideIcon
  id: string
  lingoFields: LingoField[]
  outcome: string
  summary: string
  title: string
  topic: string
  legacyFields: LegacyField[]
}

const demoLingo = createLingo()

const examples: FormUxExample[] = [
  {
    id: 'finance',
    topic: 'Finance',
    title: 'Treasury order review',
    summary: 'Rates, fees, and internal USD limits need canonical values before approval.',
    icon: CircleDollarSignIcon,
    beforeRisk: 'Rate mode and currency controls can drift from the number a reviewer sees.',
    legacyFields: [
      { label: 'Budget cap', value: '1250', unit: 'USD', units: ['USD', 'EUR', 'GBP'] },
      { label: 'Rate move', value: '25', unit: 'bps', units: ['%', 'bps', 'pp'] },
      { label: 'Settlement lag', value: '2', unit: 'days', units: ['days', 'hours'] },
    ],
    lingoFields: [
      {
        id: 'budget',
        label: 'Budget cap',
        value: '1250 usd',
        kind: 'currency',
        unit: 'USD',
        helper: 'Built-in currency kind; no live FX implied.',
      },
      {
        id: 'rate',
        label: 'Rate move',
        value: '25 bps',
        kind: 'percent',
        unit: '%',
        helper: 'Accepts bps or percent and stores percent.',
      },
      {
        id: 'settlement',
        label: 'Settlement lag',
        value: '2 days',
        kind: 'duration',
        unit: 'd',
        helper: 'Duration stays deterministic.',
      },
    ],
    outcome: 'One review form stores USD, percent, and days without a mode toggle.',
  },
  {
    id: 'recipes',
    topic: 'Recipes',
    title: 'Production kitchen batch',
    summary: 'Operators copy quantities from recipe cards, vendor sheets, and timers.',
    icon: UtensilsIcon,
    beforeRisk: 'Each ingredient row repeats amount, unit, and time controls.',
    legacyFields: [
      { label: 'Stock', value: '1.5', unit: 'cups', units: ['cups', 'mL', 'L'] },
      { label: 'Oil', value: '2', unit: 'tbsp', units: ['tsp', 'tbsp', 'mL'] },
      { label: 'Cook time', value: '45', unit: 'min', units: ['min', 'h'] },
    ],
    lingoFields: [
      {
        id: 'stock',
        label: 'Stock',
        value: '1.5 cups',
        kind: 'volume',
        unit: 'ml',
        helper: 'US cups canonicalize to mL for storage.',
      },
      {
        id: 'oil',
        label: 'Oil',
        value: '2 tbsp',
        kind: 'volume',
        unit: 'ml',
        helper: 'Operators can type the unit printed on the prep sheet.',
      },
      {
        id: 'cook',
        label: 'Cook time',
        value: '45 min',
        kind: 'duration',
        unit: 'min',
        helper: 'Timers stay in minutes.',
      },
    ],
    outcome: 'Recipe rows shrink to one text field per value plus canonical mL and minutes output.',
  },
  {
    id: 'engineering',
    topic: 'Engineering',
    title: 'Test stand setup',
    summary: 'Mechanical logs mix drawing units, shop-floor gauges, force, and torque.',
    icon: RulerIcon,
    beforeRisk: 'Four unit selectors create four separate ways to record the wrong standard.',
    legacyFields: [
      { label: 'Clearance', value: '0.75', unit: 'in', units: ['mm', 'in', 'cm'] },
      { label: 'Hydraulic pressure', value: '32', unit: 'psi', units: ['psi', 'kPa', 'bar'] },
      { label: 'Axial load', value: '120', unit: 'lbf', units: ['N', 'lbf'] },
      { label: 'Fastener torque', value: '35', unit: 'N⋅m', units: ['N⋅m', 'lb-ft'] },
    ],
    lingoFields: [
      {
        id: 'clearance',
        label: 'Clearance',
        value: '3/4 in',
        kind: 'length',
        unit: 'mm',
        helper: 'Fractional inch input, metric storage.',
      },
      {
        id: 'pressure',
        label: 'Hydraulic pressure',
        value: '32 psi',
        kind: 'pressure',
        unit: 'kPa',
        helper: 'Gauge values convert to kPa.',
      },
      {
        id: 'force',
        label: 'Axial load',
        value: '120 lbf',
        kind: 'force',
        unit: 'N',
        helper: 'Built-in force kind, stored in newtons.',
      },
      {
        id: 'torque',
        label: 'Fastener torque',
        value: '35 Nm',
        kind: 'torque',
        unit: 'N*m',
        helper: 'Built-in torque kind; no dimensional algebra required.',
      },
    ],
    outcome: 'The layout stays dense while every field submits a canonical SI-ish value.',
  },
  {
    id: 'fitness',
    topic: 'Fitness',
    title: 'Training block log',
    summary: 'Coaches need the athlete wording and the analytics value.',
    icon: DumbbellIcon,
    beforeRisk: 'Weight, distance, duration, and calories each need a separate mode choice.',
    legacyFields: [
      { label: 'Body weight', value: '165', unit: 'lb', units: ['lb', 'kg'] },
      { label: 'Distance', value: '5', unit: 'km', units: ['km', 'mi', 'm'] },
      { label: 'Duration', value: '42', unit: 'min', units: ['min', 'h'] },
      { label: 'Energy', value: '450', unit: 'Calories', units: ['Calories', 'kJ'] },
    ],
    lingoFields: [
      {
        id: 'weight',
        label: 'Body weight',
        value: '165 lb',
        kind: 'mass',
        unit: 'kg',
        helper: 'Athlete input, kg analytics.',
      },
      {
        id: 'distance',
        label: 'Run distance',
        value: '5 km',
        kind: 'length',
        unit: 'm',
        helper: 'Metric and imperial distances share one field.',
      },
      {
        id: 'duration',
        label: 'Duration',
        value: '42 min',
        kind: 'duration',
        unit: 'min',
        helper: 'Duration output is already machine-readable.',
      },
      {
        id: 'energy',
        label: 'Energy',
        value: '450 Calories',
        kind: 'energy',
        unit: 'kcal',
        helper: 'Food Calories stay kcal.',
      },
    ],
    outcome: 'A coach-facing log can stay simple without losing canonical analytics.',
  },
  {
    id: 'medical',
    topic: 'Medical',
    title: 'Clinic intake note',
    summary: 'Clinical forms should avoid unit guessing while keeping entry familiar.',
    icon: PillIcon,
    beforeRisk: 'Dose, interval, height, and pressure selectors escalate into a noisy error list.',
    legacyFields: [
      { label: 'Dose volume', value: '1.5', unit: 'tsp', units: ['mL', 'tsp', 'tbsp'] },
      { label: 'Interval', value: '6', unit: 'hr', units: ['hr', 'min', 'day'] },
      { label: 'Height', value: "5'11", unit: 'ft/in', units: ['ft/in', 'cm', 'm'] },
      { label: 'Cuff pressure', value: '120', unit: 'mmHg', units: ['mmHg', 'kPa'] },
    ],
    lingoFields: [
      {
        id: 'dose',
        label: 'Dose volume',
        value: '1.5 tsp',
        kind: 'volume',
        unit: 'ml',
        helper: 'Volume only; medication units are domain-owned.',
      },
      {
        id: 'interval',
        label: 'Interval',
        value: '6 hr',
        kind: 'duration',
        unit: 'h',
        helper: 'Schedules store a duration.',
      },
      {
        id: 'height',
        label: 'Height',
        value: '5\'11"',
        kind: 'length',
        unit: 'm',
        helper: 'Feet/inches convert on commit.',
      },
      {
        id: 'pressure',
        label: 'Cuff pressure',
        value: '120 mmHg',
        kind: 'pressure',
        unit: 'mmHg',
        helper: 'The chart keeps the clinically familiar unit.',
      },
    ],
    outcome: 'Field-local parsing keeps the intake compact without hiding the stored value.',
  },
]

const initialValues = Object.fromEntries(
  examples.flatMap((example) =>
    example.lingoFields.map((field) => [`${example.id}:${field.id}`, field.value]),
  ),
)

function canonicalLabel(result: LingoResult, unit: string) {
  if (result.ok && result.type === 'quantity') {
    return result.quantity.format({ unit, significant: 6 })
  }
  if (!result.ok && result.candidate?.type === 'quantity') {
    return result.candidate.quantity.format({ unit, significant: 6 })
  }
  return 'No canonical value'
}

function statusLabel(result: LingoResult) {
  if (!result.ok) {
    return 'needs attention'
  }
  const warnings = result.issues.filter((issue) => issue.severity !== 'info')
  return warnings.length > 0 ? 'parsed with hint' : 'parsed'
}

function parseField(field: LingoField, value: string) {
  return demoLingo.parseQuantity(value, {
    kind: field.kind,
    strictness: 'forgiving',
    unit: field.unit,
  })
}

function LingoFieldRow({
  exampleId,
  field,
  onChange,
  value,
}: {
  exampleId: string
  field: LingoField
  onChange: (value: string) => void
  value: string
}) {
  const inputId = `form-ux-${exampleId}-${field.id}`
  const result = parseField(field, value)
  const issue = result.issues.find((item) => item.severity !== 'info')
  const blocking = !result.ok

  return (
    <div className="grid gap-2">
      <label className="font-medium text-sm" htmlFor={inputId}>
        {field.label}
      </label>
      <Input
        aria-describedby={`${inputId}-hint ${inputId}-result`}
        aria-invalid={blocking}
        className="h-9"
        id={inputId}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
      <div className="flex min-h-10 flex-col gap-1">
        <p className="text-muted-foreground text-xs" id={`${inputId}-hint`}>
          {field.helper}
        </p>
        <div
          className={cn(
            'flex flex-wrap items-center gap-2 text-xs',
            blocking ? 'text-destructive' : 'text-muted-foreground',
          )}
          id={`${inputId}-result`}
        >
          {blocking ? (
            <AlertTriangleIcon aria-hidden="true" className="size-3.5" />
          ) : (
            <CheckCircle2Icon aria-hidden="true" className="size-3.5" />
          )}
          <span className="font-medium">{statusLabel(result)}</span>
          <span className="numeric-mono text-foreground">{canonicalLabel(result, field.unit)}</span>
          {issue ? <span>{issue.code}</span> : null}
        </div>
      </div>
    </div>
  )
}

function LegacyFieldRow({
  exampleId,
  field,
  index,
}: {
  exampleId: string
  field: LegacyField
  index: number
}) {
  const inputId = `legacy-${exampleId}-${index}`
  const selectId = `${inputId}-unit`

  return (
    <div className="grid gap-2">
      <label className="font-medium text-sm" htmlFor={inputId}>
        {field.label}
      </label>
      <div className="grid grid-cols-[minmax(0,1fr)_6.75rem] gap-2">
        <Input className="h-8 px-2.5 text-sm" id={inputId} readOnly value={field.value} />
        <Select
          aria-label={`${field.label} unit`}
          className="min-w-0"
          defaultValue={field.unit}
          id={selectId}
          options={field.units.map((unit) => ({ label: unit, value: unit }))}
        />
      </div>
    </div>
  )
}

export function FormUxGallery() {
  const [activeId, setActiveId] = useState(examples[0].id)
  const [values, setValues] = useState<Record<string, string>>(initialValues)
  const active = examples.find((example) => example.id === activeId) ?? examples[0]
  const parsed = useMemo(
    () =>
      active.lingoFields.map((field) => {
        const key = `${active.id}:${field.id}`
        const value = values[key] ?? field.value
        const result = parseField(field, value)
        return { field, key, result, value }
      }),
    [active, values],
  )
  const blockingCount = parsed.filter((item) => !item.result.ok).length
  const hintCount = parsed.reduce(
    (count, item) => count + item.result.issues.filter((issue) => issue.severity !== 'info').length,
    0,
  )
  const ActiveIcon = active.icon

  return (
    <DemoFrame
      caption="Compare the control count and escalation surface before and after unit-aware parsing."
      stageSurface="plain"
      title="Real form shapes"
    >
      <div className="flex min-w-0 flex-col gap-5">
        <div aria-label="Example topic" className="flex flex-wrap gap-2" role="group">
          {examples.map((example) => {
            const Icon = example.icon
            const selected = example.id === active.id
            return (
              <Button
                aria-pressed={selected}
                key={example.id}
                onClick={() => setActiveId(example.id)}
                size="sm"
                type="button"
                variant={selected ? 'secondary' : 'ghost'}
              >
                <Icon aria-hidden="true" data-slot="button-icon" />
                {example.topic}
              </Button>
            )
          })}
        </div>

        <div className="grid gap-3 rounded-lg bg-muted/20 p-3 shadow-raise-sm sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
          <div className="flex size-9 items-center justify-center rounded-lg bg-background shadow-[var(--surface-ring)]">
            <ActiveIcon aria-hidden="true" className="size-4 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <h3 className="font-medium text-base leading-snug">{active.title}</h3>
            <p className="mt-1 text-muted-foreground text-sm">{active.summary}</p>
          </div>
        </div>

        <DocsSplitPane className="lg:grid-cols-2">
          <DocsPaneSection aria-labelledby={`without-${active.id}`} className="gap-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 className="font-medium text-sm" id={`without-${active.id}`}>
                  Without lingo
                </h4>
                <p className="mt-1 text-muted-foreground text-xs">Value box plus unit picker.</p>
              </div>
              <Badge variant="outline">{active.legacyFields.length * 2} controls</Badge>
            </div>

            <div className="grid gap-3">
              {active.legacyFields.map((field, index) => (
                <LegacyFieldRow
                  exampleId={active.id}
                  field={field}
                  index={index}
                  key={`${field.label}-${index}`}
                />
              ))}
            </div>

            <div className="mt-auto rounded-md bg-[var(--destructive-surface)] p-3 text-[var(--badge-destructive-foreground)] text-sm">
              <div className="flex items-center gap-2 font-medium">
                <AlertTriangleIcon aria-hidden="true" className="size-4" />
                Escalates late
              </div>
              <p className="mt-1 text-[var(--alert-destructive-description)] text-xs">
                {active.beforeRisk}
              </p>
            </div>
          </DocsPaneSection>

          <DocsPaneSection aria-labelledby={`with-${active.id}`} className="gap-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 className="font-medium text-sm" id={`with-${active.id}`}>
                  With lingo
                </h4>
                <p className="mt-1 text-muted-foreground text-xs">One text field per value.</p>
              </div>
              <Badge variant={blockingCount > 0 ? 'destructive' : 'outline'}>
                {blockingCount > 0 ? `${blockingCount} blocking` : '0 blocking'}
              </Badge>
            </div>

            <div className="grid gap-3">
              {parsed.map(({ field, key, value }) => (
                <LingoFieldRow
                  exampleId={active.id}
                  field={field}
                  key={key}
                  onChange={(next) => setValues((current) => ({ ...current, [key]: next }))}
                  value={value}
                />
              ))}
            </div>

            <div className="mt-auto rounded-md bg-muted/25 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{hintCount} field-local hints</Badge>
                <Badge variant="ghost">no unit dropdowns</Badge>
              </div>
              <p className="mt-2 text-muted-foreground text-xs">{active.outcome}</p>
            </div>
          </DocsPaneSection>
        </DocsSplitPane>

        <dl className="grid gap-2 sm:grid-cols-2">
          {parsed.map(({ field, key, result }) => (
            <div
              className="min-w-0 rounded-md bg-muted/20 p-3 shadow-raise-sm"
              key={`${key}-payload`}
            >
              <dt className="text-muted-foreground text-xs">{field.label}</dt>
              <dd className="numeric-mono mt-1 truncate font-medium text-sm">
                {canonicalLabel(result, field.unit)}
              </dd>
            </div>
          ))}
        </dl>

        <div className="flex items-start gap-2 text-muted-foreground text-xs">
          <ActivityIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <p>
            Currency, force, and torque are built in. The package keeps live FX and arbitrary
            dimensional algebra out of the runtime.
          </p>
        </div>
      </div>
    </DemoFrame>
  )
}
