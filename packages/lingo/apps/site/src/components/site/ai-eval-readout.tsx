import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface EvalMetric {
  acceptanceRate: number
  accepted: number
  rejected: number
  silentWrong: number
  silentWrongRate: number
}

interface EvalRow {
  category: string
  count: number
  lingo: EvalMetric
  naive: EvalMetric
}

interface AiEvalData {
  categories: EvalRow[]
  environment: {
    corpusSize: number
    node: string
  }
  framing: string
  overall: EvalRow
}

const PERCENT_FORMATTER = new Intl.NumberFormat('en', {
  maximumFractionDigits: 0,
  style: 'percent',
})
const PRECISE_PERCENT_FORMATTER = new Intl.NumberFormat('en', {
  maximumFractionDigits: 1,
  style: 'percent',
})

function loadAiEval(): AiEvalData | null {
  const file = join(process.cwd(), 'src/data/ai-eval.json')
  if (!existsSync(file)) {
    return null
  }

  try {
    return JSON.parse(readFileSync(file, 'utf8')) as AiEvalData
  } catch {
    return null
  }
}

function formatPercent(value: number) {
  return (value > 0 && value < 0.01 ? PRECISE_PERCENT_FORMATTER : PERCENT_FORMATTER).format(value)
}

function labelFor(category: string) {
  return category.replaceAll('-', ' ')
}

function MetricBar({ value }: { value: number }) {
  return (
    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-foreground"
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
      />
    </div>
  )
}

function MetricCell({ value }: { value: number }) {
  return (
    <TableCell className="numeric-mono text-right align-top">
      <span>{formatPercent(value)}</span>
      <MetricBar value={value} />
    </TableCell>
  )
}

function SummaryMetricRail({ overall }: { overall: EvalRow }) {
  const metrics = [
    { label: 'naive accept', value: overall.naive.acceptanceRate },
    { label: 'lingo accept', value: overall.lingo.acceptanceRate },
    { label: 'naive silent-wrong', value: overall.naive.silentWrongRate },
    { label: 'lingo silent-wrong', value: overall.lingo.silentWrongRate },
  ]

  return (
    <dl className="grid gap-2 sm:grid-cols-4" data-slot="ai-eval-summary">
      {metrics.map((metric) => (
        <div className="min-w-0 rounded-md bg-muted/25 px-3 py-2.5" key={metric.label}>
          <dt className="text-[11px] text-muted-foreground">{metric.label}</dt>
          <dd className="numeric-mono mt-1 font-semibold text-foreground text-lg">
            {formatPercent(metric.value)}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function AiEvalReadout() {
  const data = loadAiEval()
  if (!data) {
    return null
  }

  return (
    <div
      className="corner-smooth rounded-xl bg-muted/15 p-4 shadow-raise-sm"
      data-slot="ai-eval-readout-surface"
    >
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-semibold text-sm">Eval readout</h3>
          <p className="mt-1 text-muted-foreground text-sm">{data.framing}</p>
        </div>
        <div className="numeric-mono text-muted-foreground text-xs">
          {data.environment.corpusSize} fixtures · {data.environment.node}
        </div>
      </div>

      <SummaryMetricRail overall={data.overall} />

      <div className="mt-4">
        <Table className="min-w-[44rem] table-fixed">
          <TableCaption className="sr-only">
            Acceptance rate and silent-wrong rate by category; metrics are not blended.
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[28%]" scope="col">
                Category
              </TableHead>
              <TableHead className="w-[12%] text-right" scope="col">
                Count
              </TableHead>
              <TableHead className="w-[15%] text-right" scope="col">
                Naive accept
              </TableHead>
              <TableHead className="w-[15%] text-right" scope="col">
                Lingo accept
              </TableHead>
              <TableHead className="w-[15%] text-right" scope="col">
                Naive silent-wrong
              </TableHead>
              <TableHead className="w-[15%] text-right" scope="col">
                Lingo silent-wrong
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.categories.map((row) => (
              <TableRow key={row.category}>
                <TableHead
                  className="h-auto whitespace-normal break-words align-top font-medium font-mono text-foreground text-sm"
                  scope="row"
                >
                  {labelFor(row.category)}
                </TableHead>
                <TableCell className="numeric-mono text-right align-top">{row.count}</TableCell>
                <MetricCell value={row.naive.acceptanceRate} />
                <MetricCell value={row.lingo.acceptanceRate} />
                <MetricCell value={row.naive.silentWrongRate} />
                <MetricCell value={row.lingo.silentWrongRate} />
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
