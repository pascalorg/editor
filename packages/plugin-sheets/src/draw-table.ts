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
/**
 * Fit a cell's text to its column: shrink to 80 % of the size first, then cut
 * with an ellipsis. A value that silently ran into the next column read as
 * that column's value, which a schedule must never do.
 */
/**
 * Average glyph width as a fraction of the font size: the mono face is
 * fixed; the sans face runs ~0.54 in mixed case and wider in caps, which is
 * what a schedule's ASSEMBLY column is set in.
 */
function glyphK(value: string, mono: boolean): number {
  if (mono) return 0.6
  const letters = value.replace(/[^A-Za-z]/g, '')
  const caps = letters.replace(/[^A-Z]/g, '').length
  return letters.length > 0 && caps / letters.length > 0.6 ? 0.66 : 0.54
}

function fitCell(
  value: string,
  maxW: number,
  size: number,
  mono: boolean,
): { text: string; fontSize: number } {
  const k = glyphK(value, mono)
  const width = (s: string, fs: number) => s.length * fs * k
  if (width(value, size) <= maxW) return { text: value, fontSize: size }
  const floor = size * 0.8
  const shrunk = Math.max(floor, maxW / Math.max(1, value.length * k))
  if (width(value, shrunk) <= maxW) return { text: value, fontSize: shrunk }
  const chars = Math.max(1, Math.floor(maxW / (floor * k)) - 1)
  return { text: `${value.slice(0, chars)}…`, fontSize: floor }
}

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
  /**
   * Wrap long cells onto further lines instead of cutting them: a row grows
   * by `LINE_H` per extra line (the mark and numeric columns never wrap).
   * For the assembly and fire-separation schedules, whose cells are
   * sentences; the opening schedules keep their fixed rows.
   */
  wrap?: boolean
}

/** Extra height per wrapped line beyond the first. */
export const LINE_H = 0.165
const MAX_LINES = 6

/** Word-wrap `value` to a column `maxW` wide at `size`, hard-breaking a word that is wider than the column on its own. */
function wrapCell(value: string, maxW: number, size: number, mono: boolean): string[] {
  const k = glyphK(value, mono)
  const chars = Math.max(4, Math.floor(maxW / (size * k)))
  const lines: string[] = []
  let line = ''
  for (const raw of value.split(/\s+/).filter(Boolean)) {
    let word = raw
    while (word.length > chars) {
      if (line) {
        lines.push(line)
        line = ''
      }
      lines.push(word.slice(0, chars))
      word = word.slice(chars)
    }
    if (line && line.length + 1 + word.length > chars) {
      lines.push(line)
      line = word
    } else line = line ? `${line} ${word}` : word
  }
  if (line) lines.push(line)
  if (lines.length > MAX_LINES) {
    const kept = lines.slice(0, MAX_LINES)
    kept[MAX_LINES - 1] = `${(kept[MAX_LINES - 1] ?? '').slice(0, Math.max(1, chars - 1))}…`
    return kept
  }
  return lines.length > 0 ? lines : ['']
}

type RowLayout = { cells: { lines: string[]; fontSize: number }[]; height: number }

/** Every row's cells laid into its columns — one line each, or wrapped when the option asks. */
function layoutRows(table: ScheduleTable, widths: number[], wrap: boolean): RowLayout[] {
  return table.rows.map((row) => {
    const cells = table.columns.map((column, i) => {
      const cw = widths[i] ?? 0
      const numeric = isNumericColumn(column.key, column.label)
      const mono = i === 0 || numeric
      const value = String(row[column.key] ?? '')
      if (wrap && !mono) return { lines: wrapCell(value, cw - PAD * 2, 0.115, mono), fontSize: 0.115 }
      const fitted = fitCell(value, cw - PAD * 2, 0.115, mono)
      return { lines: [fitted.text], fontSize: fitted.fontSize }
    })
    const lines = Math.max(1, ...cells.map((c) => c.lines.length))
    return { cells, height: ROW_H + (lines - 1) * LINE_H }
  })
}

/** The height `drawTable` will use for `table` at width `w` — title, legend, header and every (wrapped) row. */
export function measureTable(table: ScheduleTable, w: number, options: DrawTableOptions = {}): number {
  const totalWeight = table.columns.reduce((s, c) => s + c.weight, 0)
  const widths = table.columns.map((c) => (w * c.weight) / totalWeight)
  const rows = layoutRows(table, widths, options.wrap ?? false)
  const head = options.title ? TITLE_H + LEGEND_H : 0
  return head + HEADER_H + rows.reduce((s, r) => s + r.height, 0)
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

  // How many rows fit: every row at its own height (a wrapped row is taller),
  // with a row held back for the "+N more" line when they do not all fit.
  const laid = layoutRows(table, widths, options.wrap ?? false)
  let capacity = 0
  let used = HEADER_H
  for (const row of laid) {
    if (used + row.height > available + 1e-9) break
    used += row.height
    capacity += 1
  }
  const overflow = table.rows.length > capacity
  const rows = overflow ? laid.slice(0, Math.max(0, capacity - 1)) : laid

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
  let ry = top + HEADER_H
  rows.forEach((row, r) => {
    if (r % 2 === 1) {
      out.push({ kind: 'rect', x, y: ry, width: w, height: row.height, fill: ZEBRA, stroke: 'none' })
    }
    let bx = x
    table.columns.forEach((column, i) => {
      const cw = widths[i] ?? 0
      const numeric = isNumericColumn(column.key, column.label)
      const mono = i === 0 || numeric
      const cell = row.cells[i] ?? { lines: [''], fontSize: 0.115 }
      cell.lines.forEach((text, line) => {
        out.push({
          kind: 'text',
          x: numeric ? bx + cw - PAD : bx + PAD,
          y: ry + ROW_H - 0.08 + line * LINE_H,
          text,
          fontSize: cell.fontSize,
          fill: INK,
          fontFamily: mono ? MONO : SANS,
          fontWeight: i === 0 ? 700 : 400,
          textAnchor: numeric ? 'end' : 'start',
        })
      })
      bx += cw
    })
    ry += row.height
    out.push({
      kind: 'line',
      x1: x,
      y1: ry,
      x2: x + w,
      y2: ry,
      stroke: INK_SOFT,
      strokeWidth: 0.005,
    })
  })

  if (overflow) {
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

  const bodyH = ry - top + (overflow ? ROW_H : 0)
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
