import { afterEach, describe, expect, test } from 'bun:test'
import { type AnyNodeId, useLiveNodeOverrides, useScene, WallNode } from '@pascal-app/core'
import { wallCurveAffordance } from './floorplan-affordances'

globalThis.requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}

const modifiers = {
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
}

describe('wall center curve handle release', () => {
  afterEach(() => {
    useLiveNodeOverrides.getState().clearAll()
  })

  test('persists the previewed curve offset after commit clears the override', () => {
    const wall = WallNode.parse({
      id: 'wall_curve-release',
      parentId: null,
      start: [0, 0],
      end: [4, 0],
    })
    useScene.setState({ nodes: { [wall.id]: wall } as never })

    const session = wallCurveAffordance.start({
      node: wall,
      payload: { wallId: wall.id },
      nodes: useScene.getState().nodes,
      initialPlanPoint: [2, 0],
      gridSnapStep: 0.1,
    })
    session.apply({ planPoint: [2, 1], modifiers })

    expect((useScene.getState().nodes[wall.id] as typeof wall).curveOffset ?? 0).toBe(0)
    expect(useLiveNodeOverrides.getState().get(wall.id as AnyNodeId)?.curveOffset).not.toBe(0)

    expect(session.canCommit()).toBe(true)
    session.commit?.()

    expect((useScene.getState().nodes[wall.id] as typeof wall).curveOffset).not.toBe(0)
    expect(useLiveNodeOverrides.getState().get(wall.id as AnyNodeId)).toBeUndefined()
  })
})
