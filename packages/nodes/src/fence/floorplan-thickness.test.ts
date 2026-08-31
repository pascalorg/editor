import { afterEach, describe, expect, test } from 'bun:test'
import {
  type AnyNodeId,
  type FloorplanGeometry,
  type GeometryContext,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { buildFenceFloorplan } from './floorplan'
import { fenceThicknessAffordance } from './floorplan-affordances'
import { FenceNode } from './schema'

const modifiers = {
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
}

function flatten(geometry: FloorplanGeometry): FloorplanGeometry[] {
  return geometry.kind === 'group' ? [geometry, ...geometry.children.flatMap(flatten)] : [geometry]
}

function selectedContext(): GeometryContext {
  return {
    resolve: () => undefined,
    children: [],
    siblings: [],
    parent: null,
    viewState: {
      selected: true,
      highlighted: false,
      hovered: false,
      moving: false,
      unit: 'metric',
    },
  }
}

describe('fence thickness handles', () => {
  afterEach(() => {
    useLiveNodeOverrides.getState().clearAll()
  })

  test('places one floor-plan handle on each curved fence face', () => {
    const fence = FenceNode.parse({
      id: 'fence_curve-thickness',
      parentId: 'level_main',
      start: [0, 0],
      end: [4, 0],
      curveOffset: 1,
      thickness: 0.08,
    })
    const handles = flatten(buildFenceFloorplan(fence, selectedContext())).filter(
      (entry) => entry.kind === 'endpoint-handle' && entry.affordance === 'thickness',
    )

    expect(handles).toHaveLength(2)
    if (handles[0]?.kind !== 'endpoint-handle' || handles[1]?.kind !== 'endpoint-handle') return
    expect(handles[0].point).toEqual([2, -0.96])
    expect(handles[1].point).toEqual([2, -1.04])
  })

  test('previews and commits a centerline-fixed thickness change', () => {
    const fence = FenceNode.parse({
      id: 'fence_thickness',
      parentId: 'level_main',
      start: [0, 0],
      end: [4, 0],
      thickness: 0.08,
    })
    useScene.setState({ nodes: { [fence.id]: fence } as never })

    const session = fenceThicknessAffordance.start({
      node: fence,
      payload: { fenceId: fence.id, side: 1 },
      nodes: useScene.getState().nodes,
      initialPlanPoint: [2, 0.04],
      gridSnapStep: 0.1,
    })
    session.apply({ planPoint: [2, 0.14], modifiers })

    expect((useScene.getState().nodes[fence.id] as typeof fence).thickness).toBe(0.08)
    expect(useLiveNodeOverrides.getState().get(fence.id as AnyNodeId)?.thickness).toBeCloseTo(0.28)

    session.commit?.()

    const committed = useScene.getState().nodes[fence.id] as typeof fence
    expect(committed.thickness).toBeCloseTo(0.28)
    expect(committed.start).toEqual([0, 0])
    expect(committed.end).toEqual([4, 0])
  })

  test('clamps inward dragging to the fence schema minimum', () => {
    const fence = FenceNode.parse({
      id: 'fence_thickness-min',
      parentId: 'level_main',
      start: [0, 0],
      end: [4, 0],
      thickness: 0.08,
    })
    useScene.setState({ nodes: { [fence.id]: fence } as never })

    const session = fenceThicknessAffordance.start({
      node: fence,
      payload: { fenceId: fence.id, side: -1 },
      nodes: useScene.getState().nodes,
      initialPlanPoint: [2, -0.04],
      gridSnapStep: 0.1,
    })
    session.apply({ planPoint: [2, 0.2], modifiers })
    session.commit?.()

    expect((useScene.getState().nodes[fence.id] as typeof fence).thickness).toBe(0.03)
  })
})
