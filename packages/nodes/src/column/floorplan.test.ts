import { describe, expect, test } from 'bun:test'
import { ColumnNode, type GeometryContext, StructuralGridNode } from '@pascal-app/core'
import { readFloorplanGeometryMetadata } from '@pascal-app/editor'
import { columnFootprintHalf } from './bounds'
import { columnDefinition } from './definition'
import {
  buildColumnFloorplan,
  computeColumnFloorplanLevelData,
  getColumnFloorplanFootprint,
} from './floorplan'
import { columnFloorplanMoveTarget } from './floorplan-move'

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

    expect(geometry.children[0]?.kind).toBe('polygon')
    expect(readFloorplanGeometryMetadata(geometry.children[0]!)).toMatchObject({
      annotationObstacle: 'bounds',
    })

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
    expect(
      geometry.children
        .filter((child) => child.kind === 'line')
        .every((child) => readFloorplanGeometryMetadata(child).annotationRole === 'column-center'),
    ).toBe(true)
  })

  test('labels a column with its associative structural-grid reference', () => {
    const column = ColumnNode.parse({
      id: 'column_main',
      parentId: 'level_main',
      position: [2, 0, 3],
      crossSection: 'square',
      width: 0.4,
      depth: 0.4,
    })
    const vertical = StructuralGridNode.parse({
      id: 'structural-grid_2',
      parentId: 'level_main',
      start: [2, 0],
      end: [2, 6],
      label: '2',
    })
    const horizontal = StructuralGridNode.parse({
      id: 'structural-grid_b',
      parentId: 'level_main',
      start: [0, 3],
      end: [6, 3],
      label: 'B',
    })
    const levelData = computeColumnFloorplanLevelData({
      siblings: [column],
      nodes: {
        [column.id]: column,
        [vertical.id]: vertical,
        [horizontal.id]: horizontal,
      },
    })

    const geometry = buildColumnFloorplan(column, { ...context, levelData })
    expect(geometry?.kind).toBe('group')
    if (geometry?.kind !== 'group') return

    const label = geometry.children.find((child) => child.kind === 'text' && child.text === 'B-2')
    expect(label).toMatchObject({ kind: 'text', text: 'B-2', upright: true })
    expect(label && readFloorplanGeometryMetadata(label).annotationRole).toBe('column-center')
  })
})

test('managed posts expose rotation but no structural resize or move controls in plan', () => {
  const column = ColumnNode.parse({ metadata: { managedByLeanTo: 'canopy', leanToRole: 'post' } })
  const geometry = buildColumnFloorplan(column, { ...context, viewState: { selected: true } })
  if (geometry?.kind !== 'group') throw new Error('Expected column plan')
  expect(geometry.children.some((child) => child.kind === 'move-handle')).toBe(false)
  expect(geometry.children.some((child) => child.kind === 'move-arrow')).toBe(false)
  expect(geometry.children.some((child) => child.kind === 'rotate-arrow')).toBe(true)
  const session = columnFloorplanMoveTarget({ node: column, nodes: { [column.id]: column } })
  expect(session.canCommit?.()).toBe(false)
})

test('disabled base and capital do not enlarge the plan or collision footprint', () => {
  const column = ColumnNode.parse({
    radius: 0.2,
    shaftStartScale: 1,
    shaftEndScale: 1,
    baseStyle: 'none',
    capitalStyle: 'none',
    baseWidthScale: 3,
    capitalWidthScale: 3,
  })
  expect(columnFootprintHalf(column)).toEqual({ halfX: 0.2, halfZ: 0.2 })
  const footprint = getColumnFloorplanFootprint(column)
  expect(Math.max(...footprint.map(([x]) => x))).toBeCloseTo(0.2)
  const floorPlaced = columnDefinition.capabilities.floorPlaced!
  expect(floorPlaced.footprint!(column).dimensions).toEqual([0.4, column.height, 0.4])
})
