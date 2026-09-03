import { describe, expect, test } from 'bun:test'
import type { FloorplanGeometry } from '@pascal-app/core'
import { drawTable, isNumericColumn, ROW_H, SCHEDULE_LEGEND, tableHeight } from './draw-table'
import type { ScheduleTable } from './schedule'

const table: ScheduleTable = {
  title: 'DOOR SCHEDULE',
  columns: [
    { key: 'mark', label: 'MARK', weight: 1 },
    { key: 'type', label: 'TYPE', weight: 1 },
    { key: 'width', label: 'WIDTH', weight: 1 },
    { key: 'height', label: 'HEIGHT', weight: 1 },
  ],
  rows: [
    { mark: 'D101', type: 'Hinged', width: `3'-0"`, height: `6'-8"` },
    { mark: 'D102', type: 'Sliding', width: `6'-0"`, height: `6'-8"` },
    { mark: 'D103', type: 'Pocket', width: `2'-6"`, height: `6'-8"` },
  ],
  issues: [],
}

type TextGeom = Extract<FloorplanGeometry, { kind: 'text' }>

function texts(list: FloorplanGeometry[]): TextGeom[] {
  return list.filter((g): g is TextGeom => g.kind === 'text')
}

function cell(list: FloorplanGeometry[], value: string): TextGeom {
  const found = texts(list).find((t) => t.text === value)
  if (!found) throw new Error(`no cell reading ${value}`)
  return found
}

describe('numeric columns', () => {
  test('measurement and count columns are numeric', () => {
    expect(isNumericColumn('width', 'WIDTH')).toBe(true)
    expect(isNumericColumn('roughOpening', 'ROUGH OPENING')).toBe(true)
    expect(isNumericColumn('size', 'NOMINAL SIZE')).toBe(true)
    expect(isNumericColumn('count', 'QTY')).toBe(true)
  })

  test('the mark column is an identifier, not a number', () => {
    expect(isNumericColumn('mark', 'MARK')).toBe(false)
  })

  test('an unrecognised key is classified by its label', () => {
    expect(isNumericColumn('glazedArea', 'GLAZED AREA')).toBe(true)
    expect(isNumericColumn('hardware', 'HARDWARE')).toBe(false)
  })
})

describe('table layout', () => {
  const drawn = drawTable(table, 1, 2, 8, 6, {
    title: 'Door schedule — Ground floor',
    legend: SCHEDULE_LEGEND,
  })

  test('numeric cells are right-aligned on the right edge of their column', () => {
    // Four equal columns across 8 in from x = 1: WIDTH spans 5..7, HEIGHT 7..9.
    const width = cell(drawn, `3'-0"`)
    expect(width.textAnchor).toBe('end')
    expect(width.x).toBeCloseTo(7 - 0.08, 6)
    const height = cell(drawn, `6'-8"`)
    expect(height.textAnchor).toBe('end')
    expect(height.x).toBeCloseTo(9 - 0.08, 6)
  })

  test('text cells stay left-aligned on the left edge of their column', () => {
    const mark = cell(drawn, 'D101')
    expect(mark.textAnchor ?? 'start').toBe('start')
    expect(mark.x).toBeCloseTo(1 + 0.08, 6)
    const type = cell(drawn, 'Hinged')
    expect(type.x).toBeCloseTo(3 + 0.08, 6)
  })

  test('numeric headers are right-aligned too, so header and cell agree', () => {
    const header = cell(drawn, 'WIDTH')
    const value = cell(drawn, `3'-0"`)
    expect(header.textAnchor).toBe('end')
    expect(header.x).toBeCloseTo(value.x, 6)
  })

  test('the title is bold caps above the table and the legend sits under it', () => {
    const title = cell(drawn, 'DOOR SCHEDULE — GROUND FLOOR')
    expect(title.fontWeight).toBe(800)
    expect(title.y).toBeLessThan(cell(drawn, 'MARK').y)
    const legend = cell(drawn, SCHEDULE_LEGEND)
    expect(legend.y).toBeGreaterThan(title.y)
    expect(legend.y).toBeLessThan(cell(drawn, 'MARK').y)
  })

  test('rows are 0.24 in apart', () => {
    expect(ROW_H).toBeCloseTo(0.24, 9)
    expect(cell(drawn, 'D102').y - cell(drawn, 'D101').y).toBeCloseTo(0.24, 9)
  })

  test('zebra banding tints the even-numbered body rows only', () => {
    const bands = drawn.filter((g) => g.kind === 'rect' && g.fill === '#f6f7f9')
    expect(bands).toHaveLength(1) // three rows → one banded
  })

  test('the header band is one dark rect with a heavy rule beneath', () => {
    const band = drawn.find((g) => g.kind === 'rect' && g.fill === '#111827')
    expect(band).toBeDefined()
    const heavy = drawn.filter((g) => g.kind === 'line' && g.strokeWidth === 0.022)
    expect(heavy).toHaveLength(1)
  })

  test('a table taller than its box is truncated with an honest overflow line', () => {
    const many: ScheduleTable = {
      ...table,
      rows: Array.from({ length: 60 }, (_, i) => ({ ...table.rows[0]!, mark: `D${101 + i}` })),
    }
    const small = drawTable(many, 1, 2, 8, 1.6)
    const overflow = texts(small).find((t) => t.text.includes('more — enlarge this viewport'))
    expect(overflow).toBeDefined()
  })

  test('tableHeight accounts for the title and legend', () => {
    expect(tableHeight(3, false)).toBeCloseTo(0.28 + 3 * 0.24, 9)
    expect(tableHeight(3, true)).toBeCloseTo(0.3 + 0.22 + 0.28 + 3 * 0.24, 9)
  })
})
