import { describe, expect, test } from 'bun:test'
import { DoorNode, WallNode, WindowNode } from '@pascal-app/core'
import { buildOpeningSizeAnnotation } from './opening-size-annotation'

const FOOT = 0.3048

function wall(overrides: Record<string, unknown> = {}) {
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

describe('buildOpeningSizeAnnotation', () => {
  test('labels a door with its nominal width and height on the interior side', () => {
    const door = DoorNode.parse({
      id: 'door_main',
      parentId: 'wall_main',
      position: [3, 1, 0],
      width: 3 * FOOT,
      height: 7 * FOOT,
    })

    const annotation = buildOpeningSizeAnnotation(door, wall(), { unit: 'imperial' })
    expect(annotation).toMatchObject({
      kind: 'text',
      x: 3,
      text: `D 3'-0" x 7'-0"`,
      upright: true,
    })
    expect(annotation?.kind === 'text' ? annotation.y : null).toBeCloseTo(-0.44)
  })

  test('places a window label inside when the back wall face is exterior', () => {
    const window = WindowNode.parse({
      id: 'window_main',
      parentId: 'wall_main',
      position: [6, 1.5, 0],
      width: 4 * FOOT,
      height: 5 * FOOT,
    })

    const annotation = buildOpeningSizeAnnotation(
      window,
      wall({ frontSide: 'interior', backSide: 'exterior' }),
      { unit: 'imperial' },
    )
    expect(annotation).toMatchObject({
      kind: 'text',
      x: 6,
      text: `W 4'-0" x 5'-0"`,
    })
    expect(annotation?.kind === 'text' ? annotation.y : null).toBeCloseTo(0.44)
  })
})
