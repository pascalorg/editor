import { describe, expect, test } from 'bun:test'
import { ColumnNode, type GeometryContext } from '@pascal-app/core'
import { buildColumnFloorplan } from './floorplan'

const context = {
  resolve: () => undefined,
  children: [],
  siblings: [],
  parent: null,
} satisfies GeometryContext

describe('buildColumnFloorplan', () => {
  test('marks the structural center of the column footprint', () => {
    const column = ColumnNode.parse({
      id: 'column_main',
      parentId: 'level_main',
      position: [2, 0, 3],
      crossSection: 'square',
      width: 0.4,
      depth: 0.4,
    })

    const geometry = buildColumnFloorplan(column, context)
    expect(geometry?.kind).toBe('group')
    if (geometry?.kind !== 'group') return

    expect(geometry.children.filter((child) => child.kind === 'line')).toEqual([
      expect.objectContaining({
        x1: 1.91,
        y1: 2.91,
        x2: 2.09,
        y2: 3.09,
        pointerEvents: 'none',
      }),
      expect.objectContaining({
        x1: 1.91,
        y1: 3.09,
        x2: 2.09,
        y2: 2.91,
        pointerEvents: 'none',
      }),
    ])
  })
})
