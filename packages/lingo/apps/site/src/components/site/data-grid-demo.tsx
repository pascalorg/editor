'use client'

import { dateField, type LingoField, quantityField } from '@pascal-app/lingo/ai'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { useCallback, useId, useMemo, useState } from 'react'

import { DemoFrame } from '@/components/site/demo-frame'
import { useHydrated } from '@/components/site/use-hydrated'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** SSR reference time. After hydration the grid switches to the real clock. */
const SSR_NOW = new Date(2026, 6, 3, 9, 0, 0)

interface Shipment {
  id: string
  mass: string
  price: string
  shipBy: string
  size: string
  sku: string
  temp: string
}

type FieldKey = 'mass' | 'size' | 'temp' | 'price' | 'shipBy'

interface ColumnSpec {
  field: LingoField<number> | LingoField<string>
  header: string
  suffix: string
}

/**
 * Each column is a lingo field — the same Standard Schema field you would hand
 * to an LLM tool. The column declares the canonical unit once; every cell in it
 * is validated and converted by that declaration. Only the date column depends
 * on `now`, but the whole record is rebuilt with it so there is one source.
 */
function makeColumns(now: Date): Record<FieldKey, ColumnSpec> {
  return {
    mass: { field: quantityField({ kind: 'mass', unit: 'kg' }), header: 'Mass → kg', suffix: 'kg' },
    size: {
      field: quantityField({ kind: 'length', unit: 'cm' }),
      header: 'Size → cm',
      suffix: 'cm',
    },
    temp: {
      field: quantityField({ kind: 'temperature', unit: 'C' }),
      header: 'Temp → °C',
      suffix: '°C',
    },
    price: {
      field: quantityField({ kind: 'currency', unit: 'USD' }),
      header: 'Price → USD',
      suffix: 'USD',
    },
    shipBy: { field: dateField({ now }), header: 'Ship by → date', suffix: '' },
  }
}

const HEADERS: Record<FieldKey, string> = {
  mass: 'Mass → kg',
  price: 'Price → USD',
  shipBy: 'Ship by → date',
  size: 'Size → cm',
  temp: 'Temp → °C',
}

const ORDER: FieldKey[] = ['mass', 'size', 'temp', 'price', 'shipBy']

/**
 * Six notations per column is the point — this is what one paste from a
 * supplier sheet actually looks like. The £45 cell is deliberate: lingo refuses
 * to invent an exchange rate rather than guessing one.
 */
const SEED: Shipment[] = [
  {
    id: '1',
    mass: '3 lb 4 oz',
    price: '$12.50',
    shipBy: 'next friday',
    size: `5'11"`,
    sku: 'Rolled steel',
    temp: '72°F',
  },
  {
    id: '2',
    mass: '1,2 kg',
    price: '9,99',
    shipBy: '2026-08-14',
    size: '120 mm',
    sku: 'Bearing set',
    temp: '20C',
  },
  {
    id: '3',
    mass: 'half a ton',
    price: '1.2k',
    shipBy: 'in 3 weeks',
    size: '2 m',
    sku: 'Pallet, oak',
    temp: '21',
  },
  {
    id: '4',
    mass: '850g',
    price: '$8',
    shipBy: 'tomorrow',
    size: '30cm',
    sku: 'Cable spool',
    temp: '-4 °C',
  },
  {
    id: '5',
    mass: '12 stone',
    price: '£45',
    shipBy: 'end of the month',
    size: '6 ft 2',
    sku: 'Crate 12B',
    temp: '300 K',
  },
]

interface Reading {
  code: string | null
  display: string
  message: string | null
  number: number | null
  state: 'ok' | 'assumed' | 'error' | 'empty'
}

const EMPTY: Reading = { code: null, display: '', message: null, number: null, state: 'empty' }

function ymd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Four significant digits reads well across 0.85 kg and 453.6 kg alike. */
function round(value: number): number {
  return Number(value.toPrecision(4))
}

function read(key: FieldKey, text: string, columns: Record<FieldKey, ColumnSpec>): Reading {
  if (text.trim() === '') {
    return EMPTY
  }
  const spec = columns[key]
  const result = spec.field.safeParse(text)
  if (result.issues) {
    const issue = result.issues[0]
    return {
      code: issue?.code ?? null,
      display: '',
      // Messages arrive as "[CODE] text" for LLM self-correction; the code is
      // already on the issue, so the badge shows it and the copy stays human.
      message: (issue?.message ?? 'Unreadable').replace(/^\[[A-Z_]+]\s*/, ''),
      number: null,
      state: 'error',
    }
  }
  const warning = result.warnings?.[0] ?? null
  const value = result.value
  const display =
    key === 'shipBy'
      ? ymd(new Date(value as string))
      : `${round(value as number)}${spec.suffix === '°C' ? '' : ' '}${spec.suffix}`
  return {
    code: warning?.code ?? null,
    display,
    message: warning?.message ?? null,
    number: typeof value === 'number' ? value : null,
    state: warning ? 'assumed' : 'ok',
  }
}

function LingoCell({
  columnKey,
  columns,
  onChange,
  rowLabel,
  value,
}: {
  columnKey: FieldKey
  columns: Record<FieldKey, ColumnSpec>
  onChange: (next: string) => void
  rowLabel: string
  value: string
}) {
  const reading = useMemo(() => read(columnKey, value, columns), [columnKey, value, columns])
  const noteId = useId()
  const failed = reading.state === 'error'
  const assumed = reading.state === 'assumed'

  // Raw over canonical, rather than side by side: six columns of both on one
  // line crushes every cell, and stacking is what makes "you typed / we stored"
  // legible at a glance.
  return (
    <div className="flex min-w-0 flex-col">
      <input
        aria-describedby={noteId}
        aria-invalid={failed}
        aria-label={`${HEADERS[columnKey]}, ${rowLabel}`}
        className={cn(
          'h-6 w-full min-w-0 cursor-text rounded-[4px] bg-transparent px-1.5 font-mono text-[12px] outline-none',
          'transition-[background-color,box-shadow] duration-[var(--motion-fast)] ease-[var(--ease-out)]',
          'hover:bg-foreground/[0.045] focus-visible:bg-background focus-visible:shadow-[var(--surface-ring)]',
          failed && 'text-destructive',
        )}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        value={value}
      />
      {/* A span, not a p: the global `p { overflow-wrap: break-word }` would
          split an issue code mid-word and grow the row. */}
      <span
        className={cn(
          'numeric-mono block min-h-[1.1rem] overflow-hidden text-ellipsis whitespace-nowrap px-1.5 text-[11px] leading-[1.1rem]',
          failed && 'text-destructive',
          assumed && 'text-amber-600 dark:text-amber-400',
          !(failed || assumed) && 'text-muted-foreground',
        )}
        id={noteId}
        title={reading.message ?? undefined}
      >
        {failed ? (
          <>
            <span aria-hidden>{reading.code ?? 'error'}</span>
            <span className="sr-only">{reading.message}</span>
          </>
        ) : (
          <>
            <span className={cn(assumed && 'underline decoration-dotted underline-offset-2')}>
              {reading.display}
            </span>
            {/* The dotted underline and the `title` both need a pointer to read.
                Assumptions are the honest part of the story, so they have to
                survive without one. */}
            {assumed ? <span className="sr-only">. {reading.message}</span> : null}
          </>
        )}
      </span>
    </div>
  )
}

const columnHelper = createColumnHelper<Shipment>()

export function DataGridDemo() {
  const hydrated = useHydrated()
  const [rows, setRows] = useState<Shipment[]>(SEED)
  const fields = useMemo(() => makeColumns(hydrated ? new Date() : SSR_NOW), [hydrated])

  const update = useCallback((id: string, key: keyof Shipment, next: string) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, [key]: next } : row)))
  }, [])

  const columnDefs = useMemo(
    () => [
      columnHelper.accessor('sku', {
        cell: (ctx) => (
          <input
            aria-label={`Item, row ${ctx.row.index + 1}`}
            className="h-6 w-full min-w-0 cursor-text rounded-[4px] bg-transparent px-1.5 text-[12px] outline-none transition-[background-color,box-shadow] duration-[var(--motion-fast)] ease-[var(--ease-out)] hover:bg-foreground/[0.045] focus-visible:bg-background focus-visible:shadow-[var(--surface-ring)]"
            onChange={(event) => update(ctx.row.original.id, 'sku', event.target.value)}
            spellCheck={false}
            value={ctx.getValue()}
          />
        ),
        header: 'Item',
      }),
      ...ORDER.map((key) =>
        columnHelper.accessor(key, {
          cell: (ctx) => (
            <LingoCell
              columnKey={key}
              columns={fields}
              onChange={(next) => update(ctx.row.original.id, key, next)}
              rowLabel={ctx.row.original.sku || `row ${ctx.row.index + 1}`}
              value={ctx.getValue()}
            />
          ),
          header: HEADERS[key],
        }),
      ),
    ],
    [update, fields],
  )

  const table = useReactTable({
    columns: columnDefs,
    data: rows,
    getCoreRowModel: getCoreRowModel(),
  })

  const totals = useMemo(() => {
    let assumed = 0
    let mass = 0
    let price = 0
    let refused = 0
    let firstRefusal: { code: string | null; message: string; where: string } | null = null
    for (const [index, row] of rows.entries()) {
      for (const key of ORDER) {
        const reading = read(key, row[key], fields)
        if (reading.state === 'error') {
          refused += 1
          firstRefusal ??= {
            code: reading.code,
            message: reading.message ?? '',
            where: `${HEADERS[key].split(' ')[0]}, row ${index + 1}`,
          }
          continue
        }
        if (reading.state === 'assumed') {
          assumed += 1
        }
        if (reading.number === null) {
          continue
        }
        if (key === 'mass') {
          mass += reading.number
        } else if (key === 'price') {
          price += reading.number
        }
      }
    }
    return {
      assumed,
      firstRefusal,
      mass: Math.round(mass * 100) / 100,
      price: price.toFixed(2),
      refused,
    }
  }, [rows])

  return (
    <DemoFrame
      caption="A column is a schema. The same field that guards an LLM tool call normalizes a spreadsheet cell."
      stageClassName="min-h-[27rem] justify-start"
      title="Normalizing data grid"
    >
      <div className="flex w-full min-w-0 flex-col gap-3">
        <div className="minimal-scrollbar min-w-0 overflow-x-auto">
          <table className="w-full min-w-[44rem] table-fixed border-separate border-spacing-0 text-sm">
            <caption className="sr-only">
              Editable shipment rows. Each column parses free text into one canonical unit.
            </caption>
            {/* Price carries the widest cell note (RATE_REQUIRED), so it gets
                room the other numeric columns don't need. */}
            <colgroup>
              <col className="w-[18%]" />
              <col className="w-[15%]" />
              <col className="w-[14%]" />
              <col className="w-[14%]" />
              <col className="w-[18%]" />
              <col className="w-[21%]" />
            </colgroup>
            <thead>
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id}>
                  {group.headers.map((header) => (
                    <th
                      className="border-border/60 border-b px-1 pb-1.5 text-left font-medium font-mono text-[10px] text-muted-foreground uppercase tracking-wide [&:not(:last-child)]:border-r"
                      key={header.id}
                      scope="col"
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id}>
                  {/* Ruled on both axes: a spreadsheet grid is what tells the
                      reader these cells take typing, without 30 input boxes. */}
                  {row.getVisibleCells().map((cell) => (
                    <td
                      className="border-border/40 border-b px-1 py-1 align-top [&:not(:last-child)]:border-r"
                      key={cell.id}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <dl className="numeric-mono flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px]">
            {/* A refused cell contributes nothing, so calling the remainder a
                total would be the exact silent-wrong-answer this demo argues
                against. Name it for what it is instead. */}
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">
                {totals.refused > 0 ? 'Accepted mass' : 'Total mass'}
              </dt>
              <dd className="text-foreground">{totals.mass} kg</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">
                {totals.refused > 0 ? 'Accepted price' : 'Total price'}
              </dt>
              <dd className="text-foreground">{totals.price} USD</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">Rows</dt>
              <dd className="text-foreground">{rows.length}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-amber-600 dark:text-amber-400">Assumptions</dt>
              <dd className="text-amber-600 dark:text-amber-400">{totals.assumed}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className={totals.refused > 0 ? 'text-destructive' : 'text-muted-foreground'}>
                Refused
              </dt>
              <dd className={totals.refused > 0 ? 'text-destructive' : 'text-muted-foreground'}>
                {totals.refused}
              </dd>
            </div>
          </dl>
          <Button onClick={() => setRows(SEED)} size="xs" type="button" variant="outline">
            Reset
          </Button>
        </div>

        {totals.firstRefusal ? (
          <p
            aria-live="polite"
            className="corner-smooth rounded-[6px] bg-destructive/8 px-2.5 py-1.5 text-[11px] text-destructive leading-relaxed"
          >
            <span className="font-mono">{totals.firstRefusal.code}</span>
            <span className="text-destructive/70"> · {totals.firstRefusal.where} · </span>
            {totals.firstRefusal.message}
          </p>
        ) : null}

        <p className="text-[11px] text-muted-foreground leading-relaxed">
          The totals only add up because every cell landed in its column&rsquo;s canonical unit.
          Dotted amber marks an assumption lingo made and recorded; red is a refusal. Cross-currency
          conversion needs a rate, so <code className="font-mono">£45</code> in a USD column
          declines rather than inventing one.
        </p>
      </div>
    </DemoFrame>
  )
}
