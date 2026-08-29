import { afterEach, describe, expect, test } from 'bun:test'
import {
  type AnyNodeId,
  RoofNode,
  RoofSegmentNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { roofSegmentResizeAffordance } from './floorplan-affordances'

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

describe('roof-segment floor-plan resize affordance', () => {
  test('resizes a conical segment by radius without moving its center', () => {
    const roof = RoofNode.parse({ id: 'roof_conical_resize', children: ['rseg_conical_resize'] })
    const segment = RoofSegmentNode.parse({
      id: 'rseg_conical_resize',
      parentId: roof.id,
      position: [10, 0, 20],
      roofType: 'conical',
      width: 6,
      depth: 6,
    })
    const nodes = { [roof.id]: roof, [segment.id]: segment }
    useScene.setState({ nodes } as never)
    const session = roofSegmentResizeAffordance.start({
      node: segment,
      payload: { mode: 'radial' },
      nodes: useScene.getState().nodes,
      initialPlanPoint: [13, 20],
      gridSnapStep: 0.1,
    })

    session.apply({ planPoint: [14, 20], modifiers })

    expect(useScene.getState().nodes[segment.id]).toBe(segment)
    expect(useLiveNodeOverrides.getState().get(segment.id as AnyNodeId)).toMatchObject({
      width: 8,
      depth: 8,
    })
    session.commit?.()
    expect(useScene.getState().nodes[segment.id]).toMatchObject({
      width: 8,
      depth: 8,
      position: [10, 0, 20],
    })
  })
})
