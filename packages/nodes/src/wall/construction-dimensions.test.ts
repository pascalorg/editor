import { describe, expect, test } from 'bun:test'
import { DoorNode, type GeometryContext, WallNode, WindowNode } from '@pascal-app/core'
import {
  buildWallConstructionDimensions,
  formatConstructionLength,
} from './construction-dimensions'

function wall(overrides: Partial<WallNode> = {}) {
  return WallNode.parse({
    id: 'wall_main',
    parentId: 'level_main',
    start: [0, 0],
    end: [10, 0],
    thickness: 0.2,
    frontSide: 'exterior',
    backSide: 'interior',
    ...overrides,
  })
}

function context(
  children: GeometryContext['children'] = [],
  siblings: GeometryContext['siblings'] = [],
) {
  return {
    resolve: () => undefined,
    children,
    siblings,
    parent: null,
  } satisfies GeometryContext
}

describe('formatConstructionLength', () => {
  test('formats U.S. architectural feet, inches, and reduced sixteenths', () => {
    expect(formatConstructionLength(12 * 0.3048, 'imperial')).toBe(`12'-0"`)
    expect(formatConstructionLength((7 * 12 + 5.5) * 0.0254, 'imperial')).toBe(`7'-5 1/2"`)
    expect(formatConstructionLength((2 * 12 + 3.1875) * 0.0254, 'imperial')).toBe(`2'-3 3/16"`)
  })

  test('rounds to the nearest sixteenth and carries into the next foot', () => {
    expect(formatConstructionLength((11 + 0.99) * 0.0254, 'imperial')).toBe(`1'-0"`)
    expect(formatConstructionLength(-0.5 * 0.0254, 'imperial')).toBe(`-0'-0 1/2"`)
  })

  test('keeps metric output concise', () => {
    expect(formatConstructionLength(3.456, 'metric')).toBe('3.46m')
    expect(formatConstructionLength(Number.NaN, 'metric')).toBe('--')
  })
})

describe('buildWallConstructionDimensions', () => {
  test('builds a jamb-by-jamb chain plus a farther wall span', () => {
    const door = DoorNode.parse({
      id: 'door_entry',
      parentId: 'wall_main',
      position: [2, 1.05, 0],
      width: 1,
    })
    const window = WindowNode.parse({
      id: 'window_front',
      parentId: 'wall_main',
      position: [6, 1.5, 0],
      width: 2,
    })

    const dimensions = buildWallConstructionDimensions(wall(), context([door, window]), {
      unit: 'metric',
    })

    expect(dimensions).toHaveLength(6)
    expect(dimensions.map((entry) => entry.kind)).toEqual(Array(6).fill('dimension'))
    expect(dimensions.map((entry) => (entry.kind === 'dimension' ? entry.text : null))).toEqual([
      '1.5m',
      '1m',
      '2.5m',
      '2m',
      '3m',
      '10m',
    ])
    expect(dimensions.at(-1)).toMatchObject({
      kind: 'dimension',
      offsetNormal: [0, 1],
      offsetDistance: 0.82,
    })
  })

  test('uses the exterior wall face as the dimension side', () => {
    const dimensions = buildWallConstructionDimensions(
      wall({ frontSide: 'interior', backSide: 'exterior' }),
      context(),
      { unit: 'metric' },
    )

    expect(dimensions).toHaveLength(1)
    expect(dimensions[0]).toMatchObject({
      kind: 'dimension',
      offsetNormal: [0, -1],
      start: [0, -0.1],
      end: [10, -0.1],
    })
  })

  test('suppresses classified interior walls until explicitly requested', () => {
    const interior = wall({ frontSide: 'interior', backSide: 'interior' })
    expect(buildWallConstructionDimensions(interior, context(), { unit: 'metric' })).toEqual([])
    expect(
      buildWallConstructionDimensions(interior, context(), { unit: 'metric', force: true }),
    ).toHaveLength(1)
  })

  test('does not invent straight strings for curved walls', () => {
    expect(
      buildWallConstructionDimensions(wall({ curveOffset: 1 }), context(), { unit: 'metric' }),
    ).toEqual([])
  })
})
