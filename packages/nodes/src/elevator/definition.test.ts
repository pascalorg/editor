import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNodeDefinition,
  type AnyNodeId,
  ElevatorNode,
  nodeRegistry,
  registerNode,
  useScene,
} from '@pascal-app/core'
import { elevatorDefinition } from './definition'

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
