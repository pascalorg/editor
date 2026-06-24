import { beforeEach, describe, expect, test } from 'bun:test'
import { createDefaultRidgeVentsForSegment, RidgeVentNode } from '../../schema/nodes/ridge-vent'
import { RoofNode } from '../../schema/nodes/roof'
import { RoofSegmentNode } from '../../schema/nodes/roof-segment'
import type { AnyNode, AnyNodeId } from '../../schema/types'
import useScene from '../use-scene'

type RafFn = (cb: (t: number) => void) => number
;(globalThis as unknown as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= ((
  cb: (t: number) => void,
) => {
  cb(0)
  return 0
}) as RafFn
;(globalThis as unknown as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??=
  () => {}

describe('roof segment default ridge vents', () => {
  beforeEach(() => {
    useScene.setState({
      nodes: {},
      rootNodeIds: [],
      dirtyNodes: new Set(),
      collections: {},
      materials: {},
      readOnly: false,
    })
  })

  test('regenerates default ridge vents when the host ridge geometry changes', () => {
    const roof = RoofNode.parse({ id: 'roof_test' as never, children: [] })
    const segment = RoofSegmentNode.parse({
      id: 'rseg_test' as never,
      parentId: roof.id,
      roofType: 'dutch',
      width: 8,
      depth: 6,
      dutchRidgeAxis: 'x',
    })
    const defaults = createDefaultRidgeVentsForSegment(segment)
    const custom = RidgeVentNode.parse({
      id: 'rvent_custom' as never,
      parentId: segment.id,
      roofSegmentId: segment.id,
      name: 'Custom Ridge Vent',
      position: [0, 0.2, 0],
      length: 1.25,
      materialPreset: 'preset-custom',
    })

    useScene.getState().setScene(
      {
        [roof.id]: { ...roof, children: [segment.id] } as AnyNode,
        [segment.id]: {
          ...segment,
          children: [...defaults.map((vent) => vent.id), custom.id],
        } as AnyNode,
        ...Object.fromEntries(
          defaults.map((vent) => [
            vent.id,
            { ...vent, parentId: segment.id, roofSegmentId: segment.id } as AnyNode,
          ]),
        ),
        [custom.id]: custom as AnyNode,
      } as Record<AnyNodeId, AnyNode>,
      [roof.id as AnyNodeId],
    )

    const oldDefaultIds = defaults.map((vent) => vent.id)
    useScene.getState().updateNode(segment.id as AnyNodeId, { width: 12 } as Partial<AnyNode>)

    const nextSegment = useScene.getState().nodes[segment.id as AnyNodeId] as
      | RoofSegmentNode
      | undefined
    const nextChildren = nextSegment?.children ?? []
    const nextDefaultIds = nextChildren.filter((id) => id !== custom.id)

    expect(nextChildren).toContain(custom.id)
    expect(useScene.getState().nodes[custom.id as AnyNodeId]).toMatchObject({
      length: 1.25,
      materialPreset: 'preset-custom',
    })
    for (const oldId of oldDefaultIds) {
      expect(useScene.getState().nodes[oldId as AnyNodeId]).toBeUndefined()
    }
    expect(nextDefaultIds).toHaveLength(defaults.length)
    expect(
      nextDefaultIds.some((id) => {
        const node = useScene.getState().nodes[id as AnyNodeId]
        return node?.type === 'ridge-vent' && node.length > (defaults[0]?.length ?? 0)
      }),
    ).toBe(true)
  })
})
