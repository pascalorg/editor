import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import bench from '@/data/bench-baseline.json'

type ThroughputResult = (typeof bench.results)[number]
type ProbeResult = (typeof bench.probes)[number]

const MICROS_FINE_FORMATTER = new Intl.NumberFormat('en', {
  maximumFractionDigits: 2,
})
const MICROS_COARSE_FORMATTER = new Intl.NumberFormat('en', {
  maximumFractionDigits: 1,
})
const OPS_FORMATTER = new Intl.NumberFormat('en', {
  maximumFractionDigits: 0,
})
const MILLIS_FORMATTER = new Intl.NumberFormat('en', {
  maximumFractionDigits: 3,
})

function formatMicros(value: number) {
  if (value > 0 && value < 0.01) {
    return '<0.01'
  }
  return (value < 10 ? MICROS_FINE_FORMATTER : MICROS_COARSE_FORMATTER).format(value)
}

function formatOps(value: number) {
  return OPS_FORMATTER.format(value)
}

function formatMillis(value: number) {
  return MILLIS_FORMATTER.format(value)
}

function formatCases(value: number) {
  return `${formatOps(value)} cases`
}

function caseCountFor(row: ThroughputResult) {
  return row.caseCount ?? row.samples
}

function groupResults(results: ThroughputResult[]) {
  const groups = new Map<string, ThroughputResult[]>()
  for (const result of results) {
    const key = result.group.replace('backend/', '')
    groups.set(key, [...(groups.get(key) ?? []), result])
  }
  return Array.from(groups.entries()).map(
    ([group, rows]) => [group, rows.toSorted((a, b) => b.opsPerSec - a.opsPerSec)] as const,
  )
}

function displayGroup(group: string) {
  switch (group) {
    case 'core':
      return 'common parsing'
    case 'frontend-shared':
      return 'typing feedback'
    case 'date':
      return 'dates and durations'
    case 'format':
      return 'formatting'
    case 'slow-path':
      return 'helpful errors'
    case 'bulk':
      return 'bulk imports'
    case 'strictness':
      return 'confirmation flow'
    case 'extraction':
      return 'sentence scanning'
    default:
      return group
  }
}

function displayName(name: string) {
  switch (name) {
    case 'parseQuantity simple':
      return 'single-value field'
    case 'lingo mixed grammar':
      return 'mixed natural input'
    case 'partialState typing':
      return 'as-you-type check'
    case 'parseDate mixed':
      return 'dates people type'
    case 'parseDuration mixed':
      return 'durations people type'
    case 'format quantity':
      return 'format a value'
    case 'humanizeDate':
      return 'humanize a date'
    case 'humanizeDuration':
      return 'humanize duration'
    case 'typo fix with kind':
      return 'fix a unit typo'
    case 'unknown unit suggestions':
      return 'suggest nearby units'
    case 'unknown unit typos off':
      return 'strict import check'
    case 'strict confirm candidate':
      return 'needs-review parse'
    case 'free text scan':
      return 'scan a sentence'
    default:
      return name
  }
}

function displayProbe(name: string) {
  switch (name) {
    case '50k no match':
      return 'very long text, no value'
    case '20k unknown tail':
      return 'long unknown unit'
    case '500-digit number':
      return 'huge number'
    default:
      return name
  }
}

function resultFor(results: ThroughputResult[], name: string) {
  return results.find((row) => row.name === name)
}

function probeFor(rows: ProbeResult[], name: string) {
  return rows.find((row) => row.name === name)
}

function Bars({ rows }: { rows: ThroughputResult[] }) {
  const max = Math.max(...rows.map((row) => row.opsPerSec))
  const width = 680
  const labelWidth = 190
  const valueWidth = 170
  const barWidth = width - labelWidth - valueWidth
  const rowHeight = 30
  const height = rows.length * rowHeight + 8

  return (
    <svg
      aria-label="Inputs parsed per second benchmark bars"
      className="h-auto w-full overflow-visible font-mono"
      role="img"
      viewBox={`0 0 ${width} ${height}`}
    >
      {rows.map((row, index) => {
        const y = index * rowHeight + 6
        const w = Math.max(2, (row.opsPerSec / max) * barWidth)
        return (
          <g key={row.name}>
            <text fill="var(--muted-foreground)" fontSize="12" x="0" y={y + 15}>
              {displayName(row.name)}
            </text>
            <rect fill="var(--muted)" height="20" rx="4" width={barWidth} x={labelWidth} y={y} />
            <rect
              fill="var(--foreground)"
              height="20"
              opacity="0.72"
              rx="4"
              width={w}
              x={labelWidth}
              y={y}
            />
            <text fill="var(--foreground)" fontSize="12" x={labelWidth + barWidth + 12} y={y + 14}>
              {formatOps(row.opsPerSec)} ops/s
            </text>
            <text
              fill="var(--muted-foreground)"
              fontSize="10"
              x={labelWidth + barWidth + 12}
              y={y + 28}
            >
              {formatMicros(row.usPerOp)} µs/op · {formatCases(caseCountFor(row))}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function ProbeTable({ rows }: { rows: ProbeResult[] }) {
  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-[48%]" scope="col">
            Stress test
          </TableHead>
          <TableHead className="text-right" scope="col">
            Median
          </TableHead>
          <TableHead className="text-right" scope="col">
            Timed runs
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.name}>
            <TableHead
              className="h-auto whitespace-normal break-words align-top font-medium font-mono text-foreground text-sm"
              scope="row"
            >
              {displayProbe(row.name)}
            </TableHead>
            <TableCell className="numeric-mono text-right align-top">
              {formatMicros(row.medianMs * 1000)} µs
            </TableCell>
            <TableCell className="numeric-mono text-right align-top">{row.samples}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function PerformanceTakeawayRail({
  items,
}: {
  items: Array<{ detail: string; label: string; value: string }>
}) {
  return (
    <dl className="grid gap-2 sm:grid-cols-3" data-slot="performance-takeaway-summary">
      {items.map((item) => (
        <div className="min-w-0 rounded-md bg-muted/25 px-3 py-3" key={item.label}>
          <dt className="font-mono font-semibold text-[11px] text-muted-foreground uppercase tracking-wider">
            {item.label}
          </dt>
          <dd className="mt-2">
            <div className="numeric-mono text-foreground text-lg">{item.value}</div>
            <p className="mt-1.5 text-muted-foreground text-sm">{item.detail}</p>
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function PerformanceSection() {
  const groups = groupResults(bench.results)
  const singleValue = resultFor(bench.results, 'parseQuantity simple')
  const bulkImport = resultFor(bench.results, 'unknown unit typos off')
  const sentenceScan = resultFor(bench.results, 'free text scan')
  const noMatch = probeFor(bench.probes, '50k no match')
  const takeaways = [
    {
      label: 'Typing fields',
      value: singleValue ? `${formatOps(singleValue.opsPerSec)} values/s` : 'microsecond-scale',
      detail: singleValue
        ? `About ${formatMicros(singleValue.usPerOp)} µs each across ${formatCases(caseCountFor(singleValue))}.`
        : 'Designed to run while someone types.',
    },
    {
      label: 'Bulk imports',
      value: bulkImport ? `${formatOps(bulkImport.opsPerSec)} checks/s` : 'batch-ready',
      detail: bulkImport
        ? `Strict validation without suggestions takes ${formatMicros(bulkImport.usPerOp)} µs per row across ${formatCases(caseCountFor(bulkImport))}.`
        : 'Turn off suggestions when importing many rows.',
    },
    {
      label: 'Messy text',
      value: sentenceScan ? `${formatOps(sentenceScan.opsPerSec)} scans/s` : 'fast scanning',
      detail: noMatch
        ? `Sentence scanning cycles ${sentenceScan ? formatCases(caseCountFor(sentenceScan)) : 'generated cases'}; 50k no-match finished in ${formatMillis(noMatch.medianMs)} ms.`
        : 'Scanning text stays bounded.',
    },
  ]
  const command = 'pnpm bench:backend'
  const caption = [
    `${bench.package.name}@${bench.package.version}`,
    bench.runtime.node,
    `${bench.runtime.platform}/${bench.runtime.arch}`,
    new Date(bench.createdAt).toISOString().slice(0, 10),
    `${bench.corpus.kind} v${bench.corpus.version}`,
    command,
  ].join(' · ')

  return (
    <div className="flex flex-col gap-6">
      <p className="text-muted-foreground text-sm">
        {singleValue
          ? `On this run, a normal field parsed ${formatOps(singleValue.opsPerSec)} values per second, about ${formatMicros(singleValue.usPerOp)} µs each. `
          : null}
        The corpus is generated from built-in unit aliases, number forms, qualifiers, ranges,
        conversions, typos, dates, durations, and sentence templates. Bars show inputs parsed per
        second, so longer is better. The µs/op line is the time for one input, so smaller is better;
        the cases count is the number of distinct generated inputs in that suite. This is a local
        backend snapshot, not a promise that every device will match it.
      </p>
      <PerformanceTakeawayRail items={takeaways} />
      <div className="grid gap-4">
        {groups.map(([group, rows]) => (
          <div
            className="corner-smooth rounded-xl bg-muted/15 p-4 shadow-raise-sm"
            data-slot="performance-benchmark-surface"
            key={group}
          >
            <h3 className="mb-3 font-mono font-semibold text-[11px] text-muted-foreground uppercase tracking-wider">
              {displayGroup(group)}
            </h3>
            <Bars rows={rows} />
          </div>
        ))}
      </div>
      <div
        className="corner-smooth rounded-xl bg-muted/15 p-4 shadow-raise-sm"
        data-slot="performance-stress-surface"
      >
        <h3 className="mb-3 font-mono font-semibold text-[11px] text-muted-foreground uppercase tracking-wider">
          stress tests
        </h3>
        <ProbeTable rows={bench.probes} />
      </div>
      <p className="numeric-mono text-muted-foreground text-xs">{caption}</p>
    </div>
  )
}
