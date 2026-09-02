/**
 * A schedule drawn as geometry in sheet inches — the same primitives on
 * screen and in the PDF. Rows that do not fit the viewport box are dropped
 * and the last visible row is replaced with a "+N more" line, so a table
 * never silently spills off the paper.
 */
import type { FloorplanGeometry } from '@pascal-app/core'
import type { ScheduleTable } from './schedule'
import { INK, INK_SOFT, SANS } from './titleblock'

const HEADER_H = 0.26
const ROW_H = 0.22
const PAD = 0.06

export function tableHeight(rowCount: number): number {
  return HEADER_H + rowCount * ROW_H
}

export function drawTable(
  table: ScheduleTable,
  x: number,
  y: number,
  w: number,
  h: number,
): FloorplanGeometry[] {
  const out: FloorplanGeometry[] = []
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
  const totalWeight = table.columns.reduce((s, c) => s + c.weight, 0)
  const widths = table.columns.map((c) => (w * c.weight) / totalWeight)

  const capacity = Math.max(0, Math.floor((h - HEADER_H) / ROW_H))
  const overflow = table.rows.length > capacity
  const rows = overflow ? table.rows.slice(0, Math.max(0, capacity - 1)) : table.rows

  // Header band.
  out.push({
    kind: 'rect',
    x,
    y,
    width: w,
    height: HEADER_H,
    fill: '#1f2937',
    stroke: 'none',
  })
  let cx = x
  table.columns.forEach((column, i) => {
    out.push({
      kind: 'text',
      x: cx + PAD,
      y: y + HEADER_H - 0.08,
      text: column.label,
      fontSize: 0.11,
      fill: '#ffffff',
      fontWeight: 700,
      fontFamily: SANS,
    })
    cx += widths[i] ?? 0
  })

  // Body.
  rows.forEach((row, r) => {
    const ry = y + HEADER_H + r * ROW_H
    if (r % 2 === 1) {
      out.push({ kind: 'rect', x, y: ry, width: w, height: ROW_H, fill: '#f3f4f6', stroke: 'none' })
    }
    let bx = x
    table.columns.forEach((column, i) => {
      const value = String(row[column.key] ?? '')
      out.push({
        kind: 'text',
        x: bx + PAD,
        y: ry + ROW_H - 0.07,
        text: value,
        fontSize: 0.105,
        fill: INK,
        fontFamily: SANS,
      })
      bx += widths[i] ?? 0
    })
  })

  if (overflow) {
    const ry = y + HEADER_H + rows.length * ROW_H
    out.push({
      kind: 'text',
      x: x + PAD,
      y: ry + ROW_H - 0.07,
      text: `+${table.rows.length - rows.length} more — enlarge this viewport`,
      fontSize: 0.1,
      fill: INK_SOFT,
      fontFamily: SANS,
    })
  }

  const bodyH = HEADER_H + (rows.length + (overflow ? 1 : 0)) * ROW_H
  // Grid.
  out.push({
    kind: 'rect',
    x,
    y,
    width: w,
    height: bodyH,
    fill: 'none',
    stroke: INK,
    strokeWidth: 0.01,
  })
  let gx = x
  for (const width of widths.slice(0, -1)) {
    gx += width
    out.push({ kind: 'line', x1: gx, y1: y, x2: gx, y2: y + bodyH, stroke: INK_SOFT, strokeWidth: 0.005 })
  }
  return out
}
