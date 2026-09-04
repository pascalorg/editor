'use client'

import { allKinds, lingo, temperatureVocabs } from '@pascal-app/lingo'
import { parseDate, parseDateRange } from '@pascal-app/lingo/date'
import { useMemo, useState } from 'react'
import { SubHeading } from '@/components/site/anchor-heading'
import { DemoFrame } from '@/components/site/demo-frame'
import { DocsPane, DocsSplitPane } from '@/components/site/docs-split-pane'
import { JsonView } from '@/components/site/json-view'
import { Readout } from '@/components/site/readout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { resultToPlain } from '@/lib/lingo-display'
import { baseUnitSymbol, unitSamples } from '@/lib/unit-labels'

const aliasExamples = [
  { text: '1m80', kind: 'length' },
  { text: '120 m²', kind: 'area' },
  { text: '2 lb 3 oz', kind: 'mass' },
  { text: '500 KB', kind: 'data' },
  { text: '5 Mb', kind: 'data' },
  { text: '5 Mbps', kind: 'data_rate' },
  { text: '5 gpm', kind: 'flow_rate' },
  { text: '5 uM', kind: 'concentration' },
  { text: '3×10⁵ m', kind: 'length' },
  { text: '15%', kind: 'percent' },
] as const

const dateExamples = [
  'today',
  'tomorrow',
  'three days ago',
  'next tues',
  '5/3',
  'at 3pm',
  '17h30',
  'quarter past 5',
  '3pm EST',
  'in 2d',
  '3min from tmrw',
] as const

const timeSlotExamples = [
  '2pm to 4pm',
  'between 9am and 5pm',
  '9-5',
  '2 to 4pm',
  'from 3pm',
  '10pm to 2am',
] as const

const referenceNow = new Date('2026-07-03T12:00:00.000Z')

function clockLabel(date: Date): string {
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function CoverageExplorer() {
  const [index, setIndex] = useState(0)
  const current = aliasExamples[index] ?? aliasExamples[0]
  const result = useMemo(() => lingo(current.text, { kind: current.kind }), [current])
  const aliasCopyText = useMemo(() => JSON.stringify(resultToPlain(result), null, 2), [result])
  const fuzzyCopyText = useMemo(() => JSON.stringify(temperatureVocabs, null, 2), [])
  const dateRows = useMemo(
    () =>
      dateExamples.map((example) => {
        const parsed = parseDate(example, {
          now: referenceNow,
          dayFirst: true,
        })
        const value = parsed.ok
          ? parsed.date.toISOString().replace('.000Z', 'Z')
          : (parsed.issues[0]?.code ?? 'UNSUPPORTED_DATE')
        return { example, parsed, value }
      }),
    [],
  )
  const dateCopyText = useMemo(
    () =>
      JSON.stringify(
        dateRows.map(({ example, value, parsed }) => ({
          input: example,
          value,
          issues: parsed.issues,
        })),
        null,
        2,
      ),
    [dateRows],
  )
  const slotRows = useMemo(
    () =>
      timeSlotExamples.map((example) => {
        const parsed = parseDateRange(example, { now: referenceNow })
        let value: string
        if (parsed.ok) {
          const start = parsed.start ? clockLabel(parsed.start.date) : '—'
          const end = parsed.end ? clockLabel(parsed.end.date) : '—'
          value = `${start} – ${end}`
        } else {
          value = parsed.issues[0]?.code ?? 'UNSUPPORTED_DATE'
        }
        return { example, parsed, value }
      }),
    [],
  )
  const slotCopyText = useMemo(
    () =>
      JSON.stringify(
        slotRows.map(({ example, value, parsed }) => ({
          input: example,
          value,
          issues: parsed.issues,
        })),
        null,
        2,
      ),
    [slotRows],
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <SubHeading id="coverage-kinds">Kinds</SubHeading>
        <Table className="min-w-[42rem] table-fixed">
          <TableCaption className="sr-only">Built-in lingo unit kinds</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[24%]" scope="col">
                Kind
              </TableHead>
              <TableHead className="w-[18%]" scope="col">
                Base
              </TableHead>
              <TableHead className="w-[16%] text-right" scope="col">
                Units
              </TableHead>
              <TableHead className="w-[42%]" scope="col">
                Sample aliases
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {allKinds.map((kind) => {
              const aliases = unitSamples(kind)
              return (
                <TableRow key={kind.kind}>
                  <TableHead
                    className="h-auto whitespace-normal break-words align-top font-medium font-mono text-foreground text-sm"
                    scope="row"
                  >
                    {kind.kind}
                  </TableHead>
                  <TableCell className="whitespace-normal break-words align-top font-mono">
                    {baseUnitSymbol(kind)}
                  </TableCell>
                  <TableCell className="numeric-mono text-right align-top">
                    {kind.units.length}
                  </TableCell>
                  <TableCell className="whitespace-normal break-words align-top text-muted-foreground">
                    {aliases.length > 0 ? aliases.join(', ') : 'symbol/name'}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <div className="scroll-mt-20" id="coverage-aliases">
        <DemoFrame
          caption="Aliases, unicode, and compounds normalize to one canonical base."
          details={<JsonView label="Alias output" value={aliasCopyText} />}
          detailsLabel="Output"
          stageClassName="min-h-[24rem]"
          title="Alias roulette"
        >
          <DocsSplitPane>
            <DocsPane className="gap-4">
              <div className="flex items-start justify-between gap-3">
                <div className="font-medium tracking-tight">Current input</div>
                <Button
                  onClick={() => setIndex((value) => (value + 1) % aliasExamples.length)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Next
                </Button>
              </div>
              <div
                className="rounded-md bg-muted/25 p-4 font-mono font-semibold text-xl"
                data-slot="coverage-alias-input"
              >
                {current.text}
              </div>
            </DocsPane>
            <Readout compact result={result} showJson={false} />
          </DocsSplitPane>
        </DemoFrame>
      </div>

      <div className="scroll-mt-20" id="coverage-fuzzy">
        <DemoFrame
          caption="Fuzzy words parse only when a kind supplies vocabulary."
          details={
            <JsonView heightClassName="h-[26rem]" label="Fuzzy vocab" value={fuzzyCopyText} />
          }
          detailsLabel="Output"
          title="Fuzzy bands"
        >
          <div className="grid gap-6 md:grid-cols-3">
            {temperatureVocabs.map((vocab) => (
              <div
                className="flex flex-col gap-3 rounded-md bg-muted/25 p-4"
                data-slot="coverage-fuzzy-surface"
                key={vocab.profile}
              >
                <div className="font-medium tracking-tight">{vocab.profile}</div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(vocab.terms).map(([term, [min, max]]) => (
                    <Badge
                      className="numeric-mono h-auto min-h-6 whitespace-normal px-2 py-1"
                      key={term}
                      render={<code />}
                      variant="outline"
                    >
                      {term}: {min}-{max} °C
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </DemoFrame>
      </div>

      <div className="scroll-mt-20" id="coverage-dates">
        <DemoFrame
          caption="Reference time is explicit, so relative dates stay deterministic."
          details={
            <JsonView heightClassName="h-[26rem]" label="Date output" value={dateCopyText} />
          }
          detailsLabel="Output"
          title="Date shorthand"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {dateRows.map(({ example, value }) => (
              <div
                className="flex min-w-0 items-start justify-between gap-3 rounded-md bg-muted/25 p-3"
                data-slot="coverage-date-row"
                key={example}
              >
                <span className="min-w-0 break-words font-mono text-sm">{example}</span>
                <span className="numeric-mono min-w-0 break-all text-right text-muted-foreground text-xs">
                  {value}
                </span>
              </div>
            ))}
          </div>
        </DemoFrame>
      </div>

      <div className="scroll-mt-20" id="coverage-time-slots">
        <DemoFrame
          caption="Time slots parse to start/end endpoints; am/pm is inferred across the pair, and 9-5 reads as the workday shift."
          details={
            <JsonView heightClassName="h-[22rem]" label="Slot output" value={slotCopyText} />
          }
          detailsLabel="Output"
          title="Time slots"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {slotRows.map(({ example, value }) => (
              <div
                className="flex min-w-0 items-start justify-between gap-3 rounded-md bg-muted/25 p-3"
                data-slot="coverage-slot-row"
                key={example}
              >
                <span className="min-w-0 break-words font-mono text-sm">{example}</span>
                <span className="numeric-mono min-w-0 break-all text-right text-muted-foreground text-xs">
                  {value}
                </span>
              </div>
            ))}
          </div>
        </DemoFrame>
      </div>
    </div>
  )
}
