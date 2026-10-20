import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNodeDefinition,
  type AnyNodeId,
  BuildingNode,
  ElevatorNode,
  getElevatorDoorLeafWidth,
  getElevatorDoorLeafX,
  LevelNode,
  nodeRegistry,
  normalizeElevatorDimensions,
  registerNode,
  resolveElevatorDimensions,
  useScene,
} from '@pascal-app/core'
import { elevatorDefinition } from './definition'
import { buildElevatorFloorplan } from './floorplan'
import { ELEVATOR_PRESETS, elevatorPresetPatch, elevatorSectionReset } from './presets'

describe('elevatorDefinition', () => {
  // The elevator has no dirty consumer: it ships no `def.geometry` (so
  // GeometrySystem skips it and never calls clearDirty), and none of its
  // three systems (runtime / interaction / opening) read `dirtyNodes`.
  // Without the opt-out, the scene-load full markDirty leaves the elevator
  // permanently dirty — perf HUD shows "DIRTY 1", the frame limiter never
  // sees an idle scene (elevator has `def.system`, so its dirty mark counts
  // as pending render work), and post-processing scheduling sees a non-zero
  // dirty count forever.
  test('opts out of dirty tracking — no system ever clears its dirty mark', () => {
    expect(elevatorDefinition.dirtyTracking).toBe(false)
  })

  describe('markDirty with the registered definition', () => {
    beforeEach(() => {
      nodeRegistry._reset()
      registerNode(elevatorDefinition as unknown as AnyNodeDefinition)
    })

    afterEach(() => {
      nodeRegistry._reset()
    })

    // Membership asserts (not set size/equality): the scene store is a module
    // singleton, and subscribers leaked by other test files can add their own
    // dirty marks when `setState` fires.
    test('scene-load style markDirty leaves no permanent elevator residue', () => {
      const elevator = ElevatorNode.parse({
        id: 'elevator_dirty_test' as never,
        type: 'elevator',
      })
      useScene.setState({
        nodes: { [elevator.id]: elevator } as never,
        rootNodeIds: [elevator.id],
        dirtyNodes: new Set<AnyNodeId>(),
      } as never)

      useScene.getState().markDirty(elevator.id as AnyNodeId)

      expect(useScene.getState().dirtyNodes.has(elevator.id as AnyNodeId)).toBe(false)
    })
  })
})

test('dimension edits keep stored sizes consistent and preserve automatic shaft sizing', () => {
  const node = ElevatorNode.parse({ width: 1, depth: 1, cabHeight: 2, doorWidth: 3, doorHeight: 4 })
  const normalized = normalizeElevatorDimensions(node)
  expect(normalized.doorWidth).toBeCloseTo(0.82)
  expect(normalized.doorHeight).toBeCloseTo(1.9)
  expect(normalized.shaftWidth).toBeUndefined()
  const resized = normalizeElevatorDimensions({ ...node, width: 0.6, shaftWidth: 0.5 })
  expect(resized.width).toBe(0.8)
  expect(resized.shaftWidth).toBe(0.8)
  expect(resized.doorWidth).toBeCloseTo(0.62)
  expect(resolveElevatorDimensions(ElevatorNode.parse({ ...node, ...resized })).width).toBe(
    resized.width,
  )
})

for (const doorStyle of ['center-opening', 'single-left', 'single-right'] as const) {
  test(`${doorStyle} doors clear the full opening at the end of travel`, () => {
    for (const width of [0.45, 0.95, 2]) {
      const leafWidth = getElevatorDoorLeafWidth(width, doorStyle)
      const sides =
        doorStyle === 'center-opening'
          ? (['left', 'right'] as const)
          : ([doorStyle === 'single-left' ? 'left' : 'right'] as const)
      for (const side of sides) {
        const center = getElevatorDoorLeafX(side, width, 1, doorStyle)
        expect(Math.abs(center) - leafWidth / 2).toBeCloseTo(width / 2)
        const closed = getElevatorDoorLeafX(side, width, 0, doorStyle)
        expect(Math.abs(closed)).toBeCloseTo(doorStyle === 'center-opening' ? width / 4 : 0)
      }
    }
  })
}

test('floor plans show the elevator only on served floors in its building', () => {
  const building = BuildingNode.parse({})
  const levels = [0, 1, 2].map((level) => LevelNode.parse({ parentId: building.id, level }))
  const node = ElevatorNode.parse({
    parentId: building.id,
    fromLevelId: levels[0]!.id,
    toLevelId: levels[1]!.id,
  })
  building.children = [...levels.map((level) => level.id), node.id]
  const nodes = Object.fromEntries([building, ...levels, node].map((n) => [n.id, n]))
  for (const [index, parent] of levels.entries()) {
    const geometry = buildElevatorFloorplan(node, {
      parent,
      children: [],
      siblings: [],
      resolve: (id) => nodes[id],
    })
    if (index < 2) expect(geometry?.kind).toBe('group')
    else expect(geometry).toBeNull()
  }
})

test('preset and section edits preserve service configuration, transforms and paint', () => {
  const node = ElevatorNode.parse({
    position: [2, 0.2, 3],
    rotation: 1,
    fromLevelId: 'level_a',
    toLevelId: 'level_b',
    slots: { cab: 'library:metal-steel' },
  })
  for (const id of Object.keys(ELEVATOR_PRESETS) as Array<keyof typeof ELEVATOR_PRESETS>) {
    const next = ElevatorNode.parse({ ...node, ...elevatorPresetPatch(node, id) })
    expect(next.slots).toEqual(node.slots)
    expect(next.position).toEqual(node.position)
    expect(next.rotation).toBe(node.rotation)
    expect(next.fromLevelId).toBe(node.fromLevelId)
    expect(next.toLevelId).toBe(node.toLevelId)
    expect(ElevatorNode.parse(JSON.parse(JSON.stringify(next)))).toEqual(next)
    const reset = { ...next, ...elevatorSectionReset(next, 'Cab') }
    expect(reset.width).toBe(1.84)
    expect(reset.slots).toEqual(node.slots)
  }
})
