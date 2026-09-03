/**
 * A schedule drawn as geometry in sheet inches — the same primitives on
 * screen and in the PDF. Rows that do not fit the viewport box are dropped
 * and the last visible row is replaced with a "+N more" line, so a table
 * never silently spills off the paper.
 *
 * LOOK. Matched to the PlanCrafters schedule (`app/js/sheets.js`, the
 * `kind === 'schedule'` painter ~line 2191) and reproduced in our primitives:
 * a title in bold caps above the table, a legend line under it, a header band
 * in bold caps with a heavy rule beneath, 0.24 in rows, zebra banding at a
 * light tint, hairline column separators, and NUMERIC COLUMNS RIGHT-ALIGNED so
 * the sizes stack into a column a reader can scan.
 */
import type { FloorplanGeometry } from '@pascal-app/core'
import type { ScheduleTable } from './schedule'
import { INK, INK_SOFT, MONO, SANS } from './titleblock'

const TITLE_H = 0.3
const LEGEND_H = 0.22
export const HEADER_H = 0.28
export const ROW_H = 0.24
const PAD = 0.08
const ZEBRA = '#f6f7f9'
const HEADER_INK = '#111827'

/** The line under the title of every opening schedule. */
export const SCHEDULE_LEGEND = 'Sizes are nominal; RO per manufacturer.'

/**
 * Column keys whose values are measurements or counts and therefore belong on
 * the right edge of their cell. `mark` stays LEFT: it is an identifier, and a
 * schedule reads down its mark column.
 */
const NUMERIC_KEYS = new Set([
  'width',
  'height',
  'size',
  'roughOpening',
  'sill',
  'head',
  'area',
  'count',
  'qty',
  'quantity',
  'ceilingHeight',
])

/** Whether a column's values are right-aligned. */
export function isNumericColumn(key: string, label: string): boolean {
  if (NUMERIC_KEYS.has(key)) return true
  return /\b(SIZE|WIDTH|HEIGHT|AREA|QTY|COUNT|SILL|HEAD|OPENING|SF)\b/.test(label.toUpperCase())
}

/** Overall height of a table with `rowCount` body rows, title and legend included. */
export function tableHeight(rowCount: number, withTitle = true): number {
  return (withTitle ? TITLE_H + LEGEND_H : 0) + HEADER_H + rowCount * ROW_H
}

export type DrawTableOptions = {
  /** Printed in bold caps above the table. Omit to draw the table bare. */
  title?: string
  /** Printed small and grey under the title. */
  legend?: string
}

export function drawTable(
  table: ScheduleTable,
  x: number,
  y: number,
  w: number,
  h: number,
  options: DrawTableOptions = {},
): FloorplanGeometry[] {
  const out: FloorplanGeometry[] = []
  let top = y

  // Issues the host raised (duplicate marks and the like) print above the
  // table rather than being swallowed.
  for (const [i, issue] of table.issues.entries()) {
    out.push({
      kind: 'text',
      x,
      y: y - 0.12 - (table.issues.length - 1 - i) * 0.16,
      text: `! ${issue}`,
      fontSize: 0.1,
      fill: '#b45309',
      fontFamily: SANS,
    })
  }

  if (options.title) {
    out.push({
      kind: 'text',
      x,
      y: top + 0.21,
      text: options.title.toUpperCase(),
      fontSize: 0.24,
      fill: INK,
      fontWeight: 800,
      fontFamily: SANS,
    })
    top += TITLE_H
    if (options.legend) {
      out.push({
        kind: 'text',
        x,
        y: top + 0.12,
        text: options.legend,
        fontSize: 0.12,
        fill: INK_SOFT,
        fontFamily: SANS,
      })
    }
    top += LEGEND_H
  }

  const totalWeight = table.columns.reduce((s, c) => s + c.weight, 0)
  const widths = table.columns.map((c) => (w * c.weight) / totalWeight)
  const available = h - (top - y)

  const capacity = Math.max(0, Math.floor((available - HEADER_H) / ROW_H))
  const overflow = table.rows.length > capacity
  const rows = overflow ? table.rows.slice(0, Math.max(0, capacity - 1)) : table.rows

  // Header band: bold caps on a dark ground, with a heavy rule beneath it.
  out.push({
    kind: 'rect',
    x,
    y: top,
    width: w,
    height: HEADER_H,
    fill: HEADER_INK,
    stroke: 'none',
  })
  let cx = x
  table.columns.forEach((column, i) => {
    const cw = widths[i] ?? 0
    const numeric = isNumericColumn(column.key, column.label)
    out.push({
      kind: 'text',
      x: numeric ? cx + cw - PAD : cx + PAD,
      y: top + HEADER_H - 0.09,
      text: column.label.toUpperCase(),
      fontSize: 0.115,
      fill: '#ffffff',
      fontWeight: 700,
      fontFamily: SANS,
      textAnchor: numeric ? 'end' : 'start',
    })
    cx += cw
  })
  out.push({
    kind: 'line',
    x1: x,
    y1: top + HEADER_H,
    x2: x + w,
    y2: top + HEADER_H,
    stroke: INK,
    strokeWidth: 0.022,
  })

  // Body.
  rows.forEach((row, r) => {
    const ry = top + HEADER_H + r * ROW_H
    if (r % 2 === 1) {
      out.push({ kind: 'rect', x, y: ry, width: w, height: ROW_H, fill: ZEBRA, stroke: 'none' })
    }
    let bx = x
    table.columns.forEach((column, i) => {
      const cw = widths[i] ?? 0
      const numeric = isNumericColumn(column.key, column.label)
      const value = String(row[column.key] ?? '')
      out.push({
        kind: 'text',
        x: numeric ? bx + cw - PAD : bx + PAD,
        y: ry + ROW_H - 0.08,
        text: value,
        fontSize: 0.115,
        fill: INK,
        fontFamily: i === 0 || numeric ? MONO : SANS,
        fontWeight: i === 0 ? 700 : 400,
        textAnchor: numeric ? 'end' : 'start',
      })
      bx += cw
    })
    out.push({
      kind: 'line',
      x1: x,
      y1: ry + ROW_H,
      x2: x + w,
      y2: ry + ROW_H,
      stroke: INK_SOFT,
      strokeWidth: 0.005,
    })
  })

  if (overflow) {
    const ry = top + HEADER_H + rows.length * ROW_H
    out.push({
      kind: 'text',
      x: x + PAD,
      y: ry + ROW_H - 0.08,
      text: `+${table.rows.length - rows.length} more — enlarge this viewport`,
      fontSize: 0.11,
      fill: INK_SOFT,
      fontFamily: SANS,
    })
  }

  const bodyH = HEADER_H + (rows.length + (overflow ? 1 : 0)) * ROW_H
  // Outline + column separators.
  out.push({
    kind: 'rect',
    x,
    y: top,
    width: w,
    height: bodyH,
    fill: 'none',
    stroke: INK,
    strokeWidth: 0.014,
  })
  let gx = x
  for (const width of widths.slice(0, -1)) {
    gx += width
    out.push({
      kind: 'line',
      x1: gx,
      y1: top,
      x2: gx,
      y2: top + bodyH,
      stroke: INK_SOFT,
      strokeWidth: 0.005,
    })
  }
  return out
}
