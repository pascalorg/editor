import { afterEach, describe, expect, test } from 'bun:test'
import {
  type AnyNodeId,
  DoorNode,
  useLiveNodeOverrides,
  useScene,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import { columnResizeAffordance } from '../column/floorplan-affordances'
import { doorWidthAffordance } from '../door/floorplan-affordances'
import { spawnRotateAffordance } from '../spawn/floorplan-affordances'
import { windowWidthAffordance } from '../window/floorplan-affordances'

globalThis.requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}

const modifiers = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false }

afterEach(() => {
  useLiveNodeOverrides.getState().clearAll()
  useScene.setState({ nodes: {}, rootNodeIds: [] } as never)
})

describe('opening width floor-plan affordances', () => {
  for (const kind of ['door', 'window'] as const) {
    test(`${kind} previews through a live override and writes the scene only on commit`, () => {
      const wall = WallNode.parse({
        id: `wall_${kind}`,
        start: [0, 0],
        end: [6, 0],
      })
      const opening =
        kind === 'door'
          ? DoorNode.parse({
              id: 'door_width-live',
              parentId: wall.id,
              wallId: wall.id,
              position: [2, 1.05, 0],
              width: 1,
            })
          : WindowNode.parse({
              id: 'window_width-live',
              parentId: wall.id,
              wallId: wall.id,
              position: [2, 1.05, 0],
              width: 1,
            })
      const nodes = { [wall.id]: wall, [opening.id]: opening }
      useScene.setState({ nodes } as never)
      const affordance = kind === 'door' ? doorWidthAffordance : windowWidthAffordance
      const session = affordance.start({
        node: opening as never,
        payload: { side: 'end' },
        nodes: useScene.getState().nodes,
        initialPlanPoint: [2.5, 0],
        gridSnapStep: 0.1,
      })

      session.apply({ planPoint: [3, 0], modifiers })

      expect(useScene.getState().nodes[opening.id]).toBe(opening)
      expect(useLiveNodeOverrides.getState().get(opening.id as AnyNodeId)).toMatchObject({
        width: 1.5,
        position: [2.25, 1.05, 0],
      })

      session.commit?.()

      expect(useLiveNodeOverrides.getState().get(opening.id as AnyNodeId)).toBeUndefined()
      expect(useScene.getState().nodes[opening.id]).toMatchObject({
        width: 1.5,
        position: [2.25, 1.05, 0],
      })
    })
  }
})

describe('floor-plan affordance preview policy', () => {
  test('a parametric resize keeps scene data stable until commit', () => {
    const column = {
      id: 'column_live-resize',
      type: 'column',
      position: [0, 0, 0],
      width: 1,
      depth: 1,
      radius: 0.5,
    }
    useScene.setState({ nodes: { [column.id]: column } } as never)
    const session = columnResizeAffordance.start({
      node: column as never,
      payload: { dim: 'width', planAxis: [1, 0] },
      nodes: useScene.getState().nodes,
      initialPlanPoint: [0.5, 0],
      gridSnapStep: 0.1,
    })

    session.apply({ planPoint: [0.75, 0], modifiers })

    expect(useScene.getState().nodes[column.id]).toBe(column)
    expect(useLiveNodeOverrides.getState().get(column.id as AnyNodeId)).toMatchObject({
      width: 1.5,
    })

    session.commit?.()

    expect(useLiveNodeOverrides.getState().get(column.id as AnyNodeId)).toBeUndefined()
    expect(useScene.getState().nodes[column.id]).toMatchObject({ width: 1.5 })
  })

  test('a rotation keeps scene data stable until commit', () => {
    const spawn = {
      id: 'spawn_live-rotate',
      type: 'spawn',
      position: [0, 0, 0],
      rotation: 0,
    }
    useScene.setState({ nodes: { [spawn.id]: spawn } } as never)
    const session = spawnRotateAffordance.start({
      node: spawn as never,
      payload: undefined,
      nodes: useScene.getState().nodes,
      initialPlanPoint: [1, 0],
      gridSnapStep: 0.1,
    })

    session.apply({ planPoint: [0, 1], modifiers })

    expect(useScene.getState().nodes[spawn.id]).toBe(spawn)
    expect(useLiveNodeOverrides.getState().get(spawn.id as AnyNodeId)?.rotation).toBeCloseTo(
      -Math.PI / 2,
    )

    session.commit?.()

    expect(useLiveNodeOverrides.getState().get(spawn.id as AnyNodeId)).toBeUndefined()
    expect((useScene.getState().nodes[spawn.id] as { rotation: number }).rotation).toBeCloseTo(
      -Math.PI / 2,
    )
  })
})
