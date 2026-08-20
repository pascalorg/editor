'use client'

import type { LingoOptions, LingoResult } from '@pascal-app/lingo'
import { lingo } from '@pascal-app/lingo'
import { useMemo, useState } from 'react'

import { DemoFrame } from '@/components/site/demo-frame'
import { DocsPane, DocsSplitPane } from '@/components/site/docs-split-pane'
import { JsonView } from '@/components/site/json-view'
import { Readout } from '@/components/site/readout'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { resultToPlain } from '@/lib/lingo-display'

type VariantCell = {
  label: string
  shortLabel: string
  options: LingoOptions
}

function VariantWall({
  title,
  caption,
  initial,
  cells,
}: {
  title: string
  caption: string
  initial: string
  cells: VariantCell[]
}) {
  const [value, setValue] = useState(initial)
  const [selected, setSelected] = useState(cells[0]?.label ?? '')
  const inputId = `${title.replaceAll(' ', '-').toLowerCase()}-input`

  const results = useMemo(
    () =>
      Object.fromEntries(cells.map((cell) => [cell.label, lingo(value, cell.options)])) as Record<
        string,
        LingoResult
      >,
    [cells, value],
  )

  const copyText = useMemo(
    () =>
      JSON.stringify(
        Object.fromEntries(cells.map((cell) => [cell.label, resultToPlain(results[cell.label])])),
        null,
        2,
      ),
    [cells, results],
  )

  return (
    <DemoFrame caption={caption} stageSurface="plain" title={title}>
      <DocsSplitPane>
        <DocsPane>
          <div className="flex flex-col gap-3">
            <Label htmlFor={inputId}>Input</Label>
            <Input
              autoComplete="off"
              className="h-11 rounded-[6px] font-mono text-base"
              id={inputId}
              name={inputId}
              onChange={(event) => setValue(event.target.value)}
              value={value}
            />
          </div>

          <Tabs className="gap-4" onValueChange={setSelected} value={selected}>
            <TabsList className="h-auto flex-wrap justify-start">
              {cells.map((cell) => (
                <TabsTrigger key={cell.label} value={cell.label}>
                  {cell.shortLabel}
                </TabsTrigger>
              ))}
            </TabsList>

            {cells.map((cell) => (
              <TabsContent key={cell.label} value={cell.label}>
                <Readout compact result={results[cell.label]} showJson={false} surface="plain" />
              </TabsContent>
            ))}
          </Tabs>
        </DocsPane>

        <JsonView
          className="h-full"
          heightClassName="h-[32rem]"
          label="Variant output"
          value={copyText}
        />
      </DocsSplitPane>
    </DemoFrame>
  )
}

const strictnessCells: VariantCell[] = [
  {
    label: 'strictness:"forgiving"',
    shortLabel: 'Forgiving',
    options: { kind: 'length', strictness: 'forgiving' },
  },
  {
    label: 'strictness:"confirm"',
    shortLabel: 'Confirm',
    options: { kind: 'length', strictness: 'confirm' },
  },
  {
    label: 'strictness:"strict"',
    shortLabel: 'Strict',
    options: { kind: 'length', strictness: 'strict' },
  },
]

const systemNumberCells: VariantCell[] = [
  { label: 'system:"us"', shortLabel: 'US', options: { kind: 'volume', system: 'us' } },
  {
    label: 'system:"imperial"',
    shortLabel: 'Imperial',
    options: { kind: 'volume', system: 'imperial' },
  },
  {
    label: 'numberFormat:"comma-decimal"',
    shortLabel: 'Comma decimal',
    options: { kind: 'volume', numberFormat: 'comma-decimal' },
  },
  {
    label: 'numberFormat:"dot-decimal"',
    shortLabel: 'Dot decimal',
    options: { kind: 'volume', numberFormat: 'dot-decimal' },
  },
]

export function StrictnessVariantWall() {
  return (
    <VariantWall
      caption="Strictness changes issue severity, not grammar."
      cells={strictnessCells}
      initial="5 meterz"
      title="Strictness variants"
    />
  )
}

export function SystemNumberFormatVariantWall() {
  return (
    <VariantWall
      caption="System picks the gallon family; numberFormat resolves separator ambiguity."
      cells={systemNumberCells}
      initial="1,234 gallons"
      title="System and number format variants"
    />
  )
}
