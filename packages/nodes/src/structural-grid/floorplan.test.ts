import { describe, expect, test } from 'bun:test'
import { type GeometryContext, StructuralGridNode } from '@pascal-app/core'
import { buildStructuralGridFloorplan } from './floorplan'

const context = {
  resolve: () => undefined,
  children: [],
  siblings: [],
  parent: null,
} satisfies GeometryContext

describe('buildStructuralGridFloorplan', () => {
  test('draws a datum axis with labels at both ends', () => {
    const grid = StructuralGridNode.parse({
      id: 'structural-grid_axis-1',
      start: [2, 1],
      end: [2, 8],
      label: '3',
    })

    const geometry = buildStructuralGridFloorplan(grid, context)
    expect(geometry?.kind).toBe('group')
    if (geometry?.kind !== 'group') return

    expect(geometry.children[0]).toMatchObject({
      kind: 'line',
      x1: 2,
      y1: 1,
      x2: 2,
      y2: 8,
      strokeDasharray: '10 4 2 4',
    })
    expect(geometry.children.filter((child) => child.kind === 'group')).toHaveLength(2)
    expect(JSON.stringify(geometry)).toContain('"text":"3"')
  })

  test('respects independent endpoint-bubble visibility', () => {
    const grid = StructuralGridNode.parse({
      start: [0, 0],
      end: [5, 0],
      label: 'A',
      showStartBubble: false,
    })

    const geometry = buildStructuralGridFloorplan(grid, context)
    expect(geometry?.kind).toBe('group')
    if (geometry?.kind !== 'group') return
    expect(geometry.children.filter((child) => child.kind === 'group')).toHaveLength(1)
  })

  test('omits a degenerate axis', () => {
    const grid = StructuralGridNode.parse({ start: [1, 1], end: [1, 1] })
    expect(buildStructuralGridFloorplan(grid, context)).toBeNull()
  })
})
