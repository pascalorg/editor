import { afterEach, describe, expect, test } from 'bun:test'
import { type AnyNodeId, useLiveNodeOverrides, useScene, WallNode } from '@pascal-app/core'
import {
  wallCurveAffordance,
  wallMoveEndpointAffordance,
  wallThicknessAffordance,
} from './floorplan-affordances'

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

  test('previews and commits the collision-constrained curve offset', () => {
    const wall = WallNode.parse({
      id: 'wall_curve-base',
      parentId: 'level_curve',
      start: [0, 0],
      end: [4, 0],
    })
    const right = WallNode.parse({
      id: 'wall_curve-right',
      parentId: 'level_curve',
      start: [4, 0],
      end: [2, 3],
    })
    const left = WallNode.parse({
      id: 'wall_curve-left',
      parentId: 'level_curve',
      start: [2, 3],
      end: [0, 0],
    })
    useScene.setState({
      nodes: { [wall.id]: wall, [right.id]: right, [left.id]: left } as never,
    })

    const session = wallCurveAffordance.start({
      node: wall,
      payload: { wallId: wall.id },
      nodes: useScene.getState().nodes,
      initialPlanPoint: [2, 0],
      gridSnapStep: 0.1,
    })
    session.apply({ planPoint: [2, 2], modifiers })

    const previewOffset = useLiveNodeOverrides.getState().get(wall.id as AnyNodeId)?.curveOffset
    expect(previewOffset).toBeNumber()
    expect(previewOffset as number).toBeGreaterThan(-2)

    session.commit?.()

    expect((useScene.getState().nodes[wall.id] as typeof wall).curveOffset).toBe(previewOffset)
  })
})

describe('wall endpoint floorplan affordance', () => {
  afterEach(() => {
    useLiveNodeOverrides.getState().clearAll()
  })

  test('does not cascade into a wall on another level with matching endpoints', () => {
    const lower = WallNode.parse({
      id: 'wall_lower',
      parentId: 'level_lower',
      start: [0, 0],
      end: [4, 0],
    })
    const upper = WallNode.parse({
      id: 'wall_upper',
      parentId: 'level_upper',
      start: [0, 0],
      end: [4, 0],
    })
    useScene.setState({ nodes: { [lower.id]: lower, [upper.id]: upper } as never })

    const session = wallMoveEndpointAffordance.start({
      node: lower,
      payload: { wallId: lower.id, endpoint: 'start' },
      nodes: useScene.getState().nodes,
      initialPlanPoint: [0, 0],
      gridSnapStep: 0.1,
    })
    session.apply({ planPoint: [0, 1], modifiers })
    session.commit?.()

    expect((useScene.getState().nodes[lower.id] as typeof lower).start).toEqual([0, 1])
    expect((useScene.getState().nodes[upper.id] as typeof upper).start).toEqual([0, 0])
  })
})

describe('wall thickness floorplan affordance', () => {
  afterEach(() => {
    useLiveNodeOverrides.getState().clearAll()
  })

  test('previews and commits thickness while keeping the centerline fixed', () => {
    const wall = WallNode.parse({
      id: 'wall_thickness',
      parentId: 'level_main',
      start: [0, 0],
      end: [4, 0],
      thickness: 0.1,
    })
    useScene.setState({ nodes: { [wall.id]: wall } as never })

    const session = wallThicknessAffordance.start({
      node: wall,
      payload: { wallId: wall.id, side: 1 },
      nodes: useScene.getState().nodes,
      initialPlanPoint: [2, 0.05],
      gridSnapStep: 0.1,
    })
    session.apply({ planPoint: [2, 0.15], modifiers })

    expect((useScene.getState().nodes[wall.id] as typeof wall).thickness).toBe(0.1)
    expect(useLiveNodeOverrides.getState().get(wall.id as AnyNodeId)?.thickness).toBeCloseTo(0.3)

    session.commit?.()

    const committed = useScene.getState().nodes[wall.id] as typeof wall
    expect(committed.thickness).toBeCloseTo(0.3)
    expect(committed.start).toEqual([0, 0])
    expect(committed.end).toEqual([4, 0])
    expect(useLiveNodeOverrides.getState().get(wall.id as AnyNodeId)).toBeUndefined()
  })

  test('clamps an inward drag to the minimum wall thickness', () => {
    const wall = WallNode.parse({
      id: 'wall_thickness-min',
      parentId: 'level_main',
      start: [0, 0],
      end: [4, 0],
      thickness: 0.1,
    })
    useScene.setState({ nodes: { [wall.id]: wall } as never })

    const session = wallThicknessAffordance.start({
      node: wall,
      payload: { wallId: wall.id, side: -1 },
      nodes: useScene.getState().nodes,
      initialPlanPoint: [2, -0.05],
      gridSnapStep: 0.1,
    })
    session.apply({ planPoint: [2, 0.2], modifiers })
    session.commit?.()

    expect((useScene.getState().nodes[wall.id] as typeof wall).thickness).toBe(0.05)
  })
})
