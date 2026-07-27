import { describe, expect, test } from 'bun:test'
import { DoorNode, type FloorplanGeometry, type GeometryContext, WallNode } from '@pascal-app/core'
import { buildDoorFloorplan } from './floorplan'

const wall = WallNode.parse({
  id: 'wall_door-plan',
  start: [0, 0],
  end: [4, 0],
  thickness: 0.2,
})

function buildDoor(values: Partial<DoorNode> = {}): FloorplanGeometry[] {
  const door = DoorNode.parse({
    id: 'door_plan',
    parentId: wall.id,
    wallId: wall.id,
    position: [2, 1.05, 0],
    width: 1,
    ...values,
  })
  const geometry = buildDoorFloorplan(door, {
    children: [],
    parent: wall,
    resolve: () => undefined,
    siblings: [],
  } as GeometryContext)
  expect(geometry?.kind).toBe('group')
  return geometry?.kind === 'group' ? geometry.children : []
}

describe('buildDoorFloorplan documentation symbols', () => {
  test('shows hinge, strike, panic hardware, and an arched overhead line', () => {
    const geometry = buildDoor({
      doorType: 'hinged',
      openingShape: 'arch',
      archHeight: 0.45,
      panicBar: true,
    })

    expect(geometry.filter((item) => item.kind === 'rect')).toHaveLength(2)
    expect(
      geometry.some(
        (item) =>
          item.kind === 'line' && item.strokeLinecap === 'square' && item.strokeWidth === 2.2,
      ),
    ).toBe(true)
    expect(geometry.some((item) => item.kind === 'path' && item.strokeDasharray === '4 3')).toBe(
      true,
    )
  })

  test('documents a rounded frameless opening without swing hardware', () => {
    const geometry = buildDoor({
      openingKind: 'opening',
      openingShape: 'rounded',
      cornerRadius: 0.2,
      panicBar: true,
    })

    expect(geometry.filter((item) => item.kind === 'rect')).toHaveLength(0)
    expect(geometry.some((item) => item.kind === 'line' && item.strokeLinecap === 'square')).toBe(
      false,
    )
    expect(geometry.some((item) => item.kind === 'path' && item.strokeDasharray === '4 3')).toBe(
      true,
    )
  })
})
