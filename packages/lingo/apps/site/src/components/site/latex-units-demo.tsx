'use client'

import { lingo } from '@pascal-app/lingo'
import dynamic from 'next/dynamic'
import { useMemo, useState } from 'react'

import { CopyButton } from '@/components/site/copy-button'
import { DemoFrame } from '@/components/site/demo-frame'
import { JsonView } from '@/components/site/json-view'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { resultToLatex, unitLatex } from '@/lib/latex'

// KaTeX and its stylesheet are ~80 kB gzipped — a separate chunk, fetched when
// this demo mounts rather than with the docs route.
const KatexMath = dynamic(() => import('@/components/site/katex-math'), {
  loading: () => <div aria-hidden className="h-[3.25rem]" />,
  ssr: false,
})

const EXAMPLES = [
  '72 in to cm',
  `5'11"`,
  '25 m/s to km/h',
  'between 5 and 10 kg',
  '20 °C to °F',
  '5 kg ± 200 g',
  '9.8 m/s2',
  'at least 5 kg',
] as const

/** Derived and affine units, where plain text stops being readable. */
const NOTATION = [
  { kind: 'speed', unit: 'km/h' },
  { kind: 'acceleration', unit: 'm/s2' },
  { kind: 'volume', unit: 'm3' },
  { kind: 'temperature', unit: 'C' },
  { kind: 'pressure', unit: 'kg/cm2' },
  { kind: 'fuel', unit: 'L/100km' },
] as const

export function LatexUnitsDemo() {
  const [value, setValue] = useState('25 m/s to km/h')
  const result = useMemo(() => (value.trim() === '' ? null : lingo(value)), [value])
  const tex = useMemo(() => resultToLatex(result), [result])

  return (
    <DemoFrame
      caption="Value and unit id come back as separate fields, so an app-level renderer can emit LaTeX."
      details={<JsonView label="Output" value={JSON.stringify(result, null, 2)} />}
      detailsLabel="Output"
      stageClassName="min-h-[30rem] justify-start"
      title="Measurements as notation"
    >
      <div className="mx-auto flex w-full max-w-[44rem] flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Input
            aria-label="Measurement to typeset"
            className="h-11 rounded-[6px] font-mono text-base"
            onChange={(e) => setValue(e.target.value)}
            placeholder="25 m/s to km/h"
            spellCheck={false}
            value={value}
          />
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((example) => (
              <Button
                className="h-6 rounded-[5px] px-2 font-mono text-[11px]"
                key={example}
                onClick={() => setValue(example)}
                size="xs"
                type="button"
                variant={value === example ? 'secondary' : 'ghost'}
              >
                {example}
              </Button>
            ))}
          </div>
        </div>

        <div className="corner-smooth flex min-h-[7rem] items-center justify-center rounded-[10px] bg-muted/40 px-4 py-6">
          {tex ? (
            <KatexMath className="text-foreground" tex={tex} />
          ) : (
            <span className="text-muted-foreground text-sm">
              {value.trim() === '' ? 'Awaiting input' : 'No reading to typeset'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 rounded-[8px] bg-muted/30 py-1 pr-1 pl-3">
          <span className="shrink-0 font-medium font-mono text-[10px] text-muted-foreground uppercase">
            LaTeX
          </span>
          <code className="minimal-scrollbar min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[12px] text-foreground">
            {tex ?? '—'}
          </code>
          <CopyButton
            className="shrink-0"
            copiedLabel="Copied LaTeX"
            label="Copy LaTeX"
            text={tex ?? ''}
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="font-[525] text-[13px] text-foreground">Derived units</div>
          {/* Label and notation stay adjacent inside each cell; spacing goes
              between cells, or the reader pairs a unit with its neighbour. */}
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {NOTATION.map(({ unit, kind }) => (
              <div
                className="corner-smooth flex min-h-[2.75rem] items-center gap-2.5 rounded-[6px] bg-muted/40 px-2.5 py-1.5"
                key={unit}
              >
                <code className="shrink-0 font-mono text-[12px] text-muted-foreground">{unit}</code>
                <KatexMath
                  className="text-[13px] text-foreground"
                  display={false}
                  tex={unitLatex(unit, kind)}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </DemoFrame>
  )
}
