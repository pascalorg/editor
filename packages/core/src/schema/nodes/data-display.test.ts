import { describe, expect, test } from 'bun:test'
import { DataChartNode } from './data-chart'
import { DataTableNode } from './data-table'
import { DataWidgetNode } from './data-widget'

describe('data display nodes', () => {
  test('default background opacity remains opaque', () => {
    expect(DataWidgetNode.parse({}).backgroundOpacity).toBe(1)
    expect(DataChartNode.parse({}).backgroundOpacity).toBe(1)
    expect(DataTableNode.parse({}).backgroundOpacity).toBe(1)
  })

  test('accepts transparent backgrounds', () => {
    expect(DataWidgetNode.parse({ backgroundOpacity: 0 }).backgroundOpacity).toBe(0)
    expect(DataChartNode.parse({ backgroundOpacity: 0.35 }).backgroundOpacity).toBe(0.35)
    expect(DataTableNode.parse({ backgroundOpacity: 0.8 }).backgroundOpacity).toBe(0.8)
  })
})
