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
      roofType: 'gable',
      width: 8,
      depth: 6,
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

  test('does not regenerate default ridge vents when only trim changes', () => {
    const roof = RoofNode.parse({ id: 'roof_test' as never, children: [] })
    const segment = RoofSegmentNode.parse({
      id: 'rseg_test' as never,
      parentId: roof.id,
      roofType: 'gable',
      width: 8,
      depth: 6,
    })
    const defaults = createDefaultRidgeVentsForSegment(segment)

    useScene.getState().setScene(
      {
        [roof.id]: { ...roof, children: [segment.id] } as AnyNode,
        [segment.id]: {
          ...segment,
          children: defaults.map((vent) => vent.id),
        } as AnyNode,
        ...Object.fromEntries(
          defaults.map((vent) => [
            vent.id,
            { ...vent, parentId: segment.id, roofSegmentId: segment.id } as AnyNode,
          ]),
        ),
      } as Record<AnyNodeId, AnyNode>,
      [roof.id as AnyNodeId],
    )

    const originalDefaultId = defaults[0]?.id as AnyNodeId
    useScene.getState().updateNode(
      segment.id as AnyNodeId,
      {
        trim: { ...segment.trim, left: 2, frontLeftX: 2, frontLeftZ: 3 },
      } as Partial<AnyNode>,
    )

    const nextSegment = useScene.getState().nodes[segment.id as AnyNodeId] as
      | RoofSegmentNode
      | undefined

    expect(nextSegment?.children).toEqual(defaults.map((vent) => vent.id))
    expect(useScene.getState().nodes[originalDefaultId]).toMatchObject({
      id: originalDefaultId,
      length: defaults[0]?.length,
      position: defaults[0]?.position,
    })
  })

  test('creates default ridge vents after a geometry change when auto ridge vent is enabled', () => {
    const roof = RoofNode.parse({ id: 'roof_test' as never, children: [] })
    const segment = RoofSegmentNode.parse({
      id: 'rseg_test' as never,
      parentId: roof.id,
      roofType: 'flat',
      width: 8,
      depth: 6,
      metadata: { autoRidgeVent: true },
    })

    useScene.getState().setScene(
      {
        [roof.id]: { ...roof, children: [segment.id] } as AnyNode,
        [segment.id]: segment as AnyNode,
      } as Record<AnyNodeId, AnyNode>,
      [roof.id as AnyNodeId],
    )

    useScene.getState().updateNode(
      segment.id as AnyNodeId,
      {
        roofType: 'gable',
      } as Partial<AnyNode>,
    )

    const nextSegment = useScene.getState().nodes[segment.id as AnyNodeId] as
      | RoofSegmentNode
      | undefined

    expect(nextSegment?.children).toHaveLength(1)
    expect(useScene.getState().nodes[nextSegment?.children[0] as AnyNodeId]).toMatchObject({
      type: 'ridge-vent',
      roofSegmentId: segment.id,
    })
  })

  test('regenerates default ridge vents when Dutch auto-vent fields change', () => {
    const roof = RoofNode.parse({ id: 'roof_test' as never, children: [] })
    const segment = RoofSegmentNode.parse({
      id: 'rseg_test' as never,
      parentId: roof.id,
      roofType: 'dutch',
      width: 8,
      depth: 6,
      metadata: { autoRidgeVent: true },
    })
    const defaults = createDefaultRidgeVentsForSegment(segment)

    useScene.getState().setScene(
      {
        [roof.id]: { ...roof, children: [segment.id] } as AnyNode,
        [segment.id]: {
          ...segment,
          children: defaults.map((vent) => vent.id),
        } as AnyNode,
        ...Object.fromEntries(
          defaults.map((vent) => [
            vent.id,
            { ...vent, parentId: segment.id, roofSegmentId: segment.id } as AnyNode,
          ]),
        ),
      } as Record<AnyNodeId, AnyNode>,
      [roof.id as AnyNodeId],
    )

    const originalDefaultIds = defaults.map((vent) => vent.id)
    useScene.getState().updateNode(
      segment.id as AnyNodeId,
      {
        pitch: 52,
        dutchWaistLengthRatio: 0.72,
        dutchGabletRake: 0.9,
      } as Partial<AnyNode>,
    )

    const nextSegment = useScene.getState().nodes[segment.id as AnyNodeId] as
      | RoofSegmentNode
      | undefined
    const nextChildren = nextSegment?.children ?? []

    expect(nextChildren).toHaveLength(defaults.length)
    expect(
      nextChildren.some((id) =>
        originalDefaultIds.includes(id as (typeof originalDefaultIds)[number]),
      ),
    ).toBe(false)
    for (const oldId of originalDefaultIds) {
      expect(useScene.getState().nodes[oldId as AnyNodeId]).toBeUndefined()
    }
  })

  test('refresh replaces legacy default vents that still use preset-white', () => {
    const roof = RoofNode.parse({ id: 'roof_test' as never, children: [] })
    const segment = RoofSegmentNode.parse({
      id: 'rseg_test' as never,
      parentId: roof.id,
      roofType: 'gable',
      width: 8,
      depth: 6,
      metadata: { autoRidgeVent: true },
    })
    const legacyDefault = RidgeVentNode.parse({
      id: 'rvent_legacy' as never,
      parentId: segment.id,
      roofSegmentId: segment.id,
      name: 'Ridge Vent',
      style: 'shingled',
      materialPreset: 'preset-white',
      position: [0, 0, 0],
      length: 8,
    })

    useScene.getState().setScene(
      {
        [roof.id]: { ...roof, children: [segment.id] } as AnyNode,
        [segment.id]: {
          ...segment,
          children: [legacyDefault.id],
        } as AnyNode,
        [legacyDefault.id]: legacyDefault as AnyNode,
      } as Record<AnyNodeId, AnyNode>,
      [roof.id as AnyNodeId],
    )

    useScene.getState().updateNode(
      segment.id as AnyNodeId,
      {
        pitch: 52,
      } as Partial<AnyNode>,
    )

    const nextSegment = useScene.getState().nodes[segment.id as AnyNodeId] as
      | RoofSegmentNode
      | undefined
    const nextChildren = nextSegment?.children ?? []

    expect(nextChildren).toHaveLength(1)
    expect(nextChildren[0]).not.toBe(legacyDefault.id)
    expect(useScene.getState().nodes[legacyDefault.id as AnyNodeId]).toBeUndefined()
  })

  test('refresh preserves user-created default-looking ridge vents without legacy preset metadata', () => {
    const roof = RoofNode.parse({ id: 'roof_test' as never, children: [] })
    const segment = RoofSegmentNode.parse({
      id: 'rseg_test' as never,
      parentId: roof.id,
      roofType: 'gable',
      width: 8,
      depth: 6,
      metadata: { autoRidgeVent: true },
    })
    const userVent = RidgeVentNode.parse({
      id: 'rvent_user' as never,
      parentId: segment.id,
      roofSegmentId: segment.id,
      name: 'Ridge Vent',
      style: 'shingled',
      position: [0, 0, 0],
      length: 8,
    })

    useScene.getState().setScene(
      {
        [roof.id]: { ...roof, children: [segment.id] } as AnyNode,
        [segment.id]: {
          ...segment,
          children: [userVent.id],
        } as AnyNode,
        [userVent.id]: userVent as AnyNode,
      } as Record<AnyNodeId, AnyNode>,
      [roof.id as AnyNodeId],
    )

    useScene.getState().updateNode(
      segment.id as AnyNodeId,
      {
        pitch: 52,
      } as Partial<AnyNode>,
    )

    const nextSegment = useScene.getState().nodes[segment.id as AnyNodeId] as
      | RoofSegmentNode
      | undefined
    const nextChildren = nextSegment?.children ?? []

    expect(nextChildren).toContain(userVent.id)
    expect(useScene.getState().nodes[userVent.id as AnyNodeId]).toMatchObject({
      id: userVent.id,
      roofSegmentId: segment.id,
      name: 'Ridge Vent',
      style: 'shingled',
      length: 8,
    })
  })

  test('does not create default ridge vents after a geometry change when auto ridge vent is disabled', () => {
    const roof = RoofNode.parse({ id: 'roof_test' as never, children: [] })
    const segment = RoofSegmentNode.parse({
      id: 'rseg_test' as never,
      parentId: roof.id,
      roofType: 'flat',
      width: 8,
      depth: 6,
      metadata: { autoRidgeVent: false },
    })

    useScene.getState().setScene(
      {
        [roof.id]: { ...roof, children: [segment.id] } as AnyNode,
        [segment.id]: segment as AnyNode,
      } as Record<AnyNodeId, AnyNode>,
      [roof.id as AnyNodeId],
    )

    useScene.getState().updateNode(
      segment.id as AnyNodeId,
      {
        roofType: 'gable',
      } as Partial<AnyNode>,
    )

    const nextSegment = useScene.getState().nodes[segment.id as AnyNodeId] as
      | RoofSegmentNode
      | undefined

    expect(nextSegment?.children ?? []).toHaveLength(0)
  })
})
