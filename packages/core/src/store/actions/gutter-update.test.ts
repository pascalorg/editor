import { beforeEach, describe, expect, test } from 'bun:test'
import { BuildingNode } from '../../schema/nodes/building'
import {
  DownspoutNode,
  type DownspoutNode as DownspoutNodeType,
  isDefaultDownspoutNode,
} from '../../schema/nodes/downspout'
import {
  GutterNode,
  type GutterNode as GutterNodeType,
  getDefaultGutterSide,
} from '../../schema/nodes/gutter'
import { LeanToExtensionNode } from '../../schema/nodes/lean-to-extension'
import { LevelNode } from '../../schema/nodes/level'
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

function setRoofScene(...segments: RoofSegmentNode[]) {
  const roof = RoofNode.parse({
    id: 'roof_test' as never,
    children: segments.map((segment) => segment.id),
  })
  useScene
    .getState()
    .setScene(
      Object.fromEntries([
        [roof.id, roof as AnyNode],
        ...segments.map(
          (segment) => [segment.id, { ...segment, parentId: roof.id } as AnyNode] as const,
        ),
      ]) as Record<AnyNodeId, AnyNode>,
      [roof.id as AnyNodeId],
    )
}

function generatedGutters(segment: RoofSegmentNode): GutterNodeType[] {
  return (segment.children ?? [])
    .map((id) => useScene.getState().nodes[id as AnyNodeId])
    .filter(
      (node): node is GutterNodeType => node?.type === 'gutter' && !!getDefaultGutterSide(node),
    )
}

function generatedDownspouts(segment: RoofSegmentNode): DownspoutNodeType[] {
  return (segment.children ?? [])
    .map((id) => useScene.getState().nodes[id as AnyNodeId])
    .filter((node): node is DownspoutNodeType => isDefaultDownspoutNode(node))
}

describe('roof segment default gutters', () => {
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

  test('creates the roof-type gutters and automatic downspouts when auto mode is enabled', () => {
    const segment = RoofSegmentNode.parse({
      id: 'rseg_test' as never,
      roofType: 'gable',
      width: 8,
      depth: 6,
    })
    setRoofScene(segment)

    useScene.getState().updateNode(
      segment.id as AnyNodeId,
      {
        metadata: { autoGutter: true },
      } as Partial<AnyNode>,
    )

    const nextSegment = useScene.getState().nodes[segment.id as AnyNodeId] as RoofSegmentNode
    expect(generatedGutters(nextSegment).map((gutter) => getDefaultGutterSide(gutter))).toEqual([
      '+Z',
      '-Z',
    ])
    const downspouts = generatedDownspouts(nextSegment)
    expect(downspouts).toHaveLength(2)
    for (const downspout of downspouts) {
      const gutter = useScene.getState().nodes[downspout.gutterId as AnyNodeId] as GutterNodeType
      expect(gutter.outlets.find((outlet) => outlet.id === downspout.outletId)).toMatchObject({
        generatedBy: 'default-downspout',
      })
    }
  })

  test('adds multiple automatic downspouts to gutters that exceed the maximum run', () => {
    const segment = RoofSegmentNode.parse({
      id: 'rseg_long' as never,
      roofType: 'gable',
      width: 24,
      depth: 6,
    })
    setRoofScene(segment)

    useScene.getState().updateNode(
      segment.id as AnyNodeId,
      {
        metadata: { autoGutter: true },
      } as Partial<AnyNode>,
    )

    const current = useScene.getState().nodes[segment.id as AnyNodeId] as RoofSegmentNode
    expect(generatedDownspouts(current)).toHaveLength(6)
  })

  test('extends automatic downspouts from an upper floor to ground level', () => {
    const lower = LevelNode.parse({
      id: 'level_lower' as never,
      level: 0,
      height: 3,
      parentId: 'building_test',
    })
    const upper = LevelNode.parse({
      id: 'level_upper' as never,
      level: 1,
      height: 3,
      parentId: 'building_test',
      children: ['roof_test'],
    })
    const building = BuildingNode.parse({
      id: 'building_test' as never,
      children: [lower.id, upper.id],
    })
    const roof = RoofNode.parse({
      id: 'roof_test' as never,
      parentId: upper.id,
      children: ['rseg_test'],
    })
    const segment = RoofSegmentNode.parse({
      id: 'rseg_test' as never,
      parentId: roof.id,
      roofType: 'gable',
      width: 8,
      depth: 6,
    })
    useScene
      .getState()
      .setScene(
        Object.fromEntries(
          [building, lower, upper, roof, segment].map((node) => [node.id, node as AnyNode]),
        ) as Record<AnyNodeId, AnyNode>,
        [building.id as AnyNodeId],
      )

    useScene.getState().updateNode(
      segment.id as AnyNodeId,
      {
        metadata: { autoGutter: true },
      } as Partial<AnyNode>,
    )

    const current = useScene.getState().nodes[segment.id as AnyNodeId] as RoofSegmentNode
    for (const downspout of generatedDownspouts(current)) {
      expect(downspout.length).toBeCloseTo(3.158270110646816)
    }
  })

  test('preserves generated gutter ids, settings, outlets, and downspout links on resize', () => {
    const segment = RoofSegmentNode.parse({
      id: 'rseg_test' as never,
      roofType: 'gable',
      metadata: { autoGutter: true },
    })
    setRoofScene(segment)
    useScene.getState().updateNode(segment.id as AnyNodeId, { width: 8 } as Partial<AnyNode>)

    let currentSegment = useScene.getState().nodes[segment.id as AnyNodeId] as RoofSegmentNode
    const front = generatedGutters(currentSegment).find(
      (gutter) => getDefaultGutterSide(gutter) === '+Z',
    )!
    const outlet = { id: 'outlet_test', offset: 1, diameter: 0.08 }
    useScene.getState().updateNode(
      front.id as AnyNodeId,
      {
        profile: 'half-round',
        outlets: [outlet],
      } as Partial<AnyNode>,
    )
    const downspout = DownspoutNode.parse({
      id: 'downspout_test' as never,
      gutterId: front.id,
      outletId: outlet.id,
    })
    useScene.getState().createNode(downspout, segment.id as AnyNodeId)

    useScene.getState().updateNode(segment.id as AnyNodeId, { width: 12 } as Partial<AnyNode>)

    currentSegment = useScene.getState().nodes[segment.id as AnyNodeId] as RoofSegmentNode
    const resizedFront = generatedGutters(currentSegment).find(
      (gutter) => getDefaultGutterSide(gutter) === '+Z',
    )!
    expect(resizedFront).toMatchObject({
      id: front.id,
      profile: 'half-round',
    })
    expect(resizedFront.outlets).toContainEqual(outlet)
    expect(resizedFront.length).toBeGreaterThan(front.length)
    expect(useScene.getState().nodes[downspout.id as AnyNodeId]).toMatchObject({
      gutterId: front.id,
      outletId: outlet.id,
    })
  })

  test('refreshes sibling gutters when an intersecting segment moves', () => {
    const segment = RoofSegmentNode.parse({
      id: 'rseg_main' as never,
      parentId: 'roof_test' as never,
      roofType: 'gable',
      width: 8,
      depth: 6,
      overhang: 0.3,
      metadata: { autoGutter: true },
    })
    const sibling = RoofSegmentNode.parse({
      id: 'rseg_cross' as never,
      parentId: 'roof_test' as never,
      roofType: 'gable',
      width: 6,
      depth: 4,
      overhang: 0.3,
      position: [0, 0, 8],
      rotation: Math.PI / 2,
    })
    setRoofScene(segment, sibling)
    useScene.getState().updateNode(segment.id as AnyNodeId, { width: 8 } as Partial<AnyNode>)

    let current = useScene.getState().nodes[segment.id as AnyNodeId] as RoofSegmentNode
    expect(
      generatedGutters(current).filter((gutter) => getDefaultGutterSide(gutter) === '+Z'),
    ).toHaveLength(1)

    useScene.getState().updateNode(
      sibling.id as AnyNodeId,
      {
        position: [0, 0, 3.26],
      } as Partial<AnyNode>,
    )

    current = useScene.getState().nodes[segment.id as AnyNodeId] as RoofSegmentNode
    const front = generatedGutters(current).filter(
      (gutter) => getDefaultGutterSide(gutter) === '+Z',
    )
    expect(front).toHaveLength(2)
    expect(front[0]?.length).toBeCloseTo(2)
    expect(front[1]?.length).toBeCloseTo(2)
  })

  test('refreshes existing gutters when a sibling segment is added and removed', () => {
    const segment = RoofSegmentNode.parse({
      id: 'rseg_main' as never,
      roofType: 'gable',
      width: 8,
      depth: 6,
      overhang: 0.3,
      metadata: { autoGutter: true },
    })
    setRoofScene(segment)
    useScene.getState().updateNode(segment.id as AnyNodeId, { width: 8 } as Partial<AnyNode>)

    const sibling = RoofSegmentNode.parse({
      id: 'rseg_cross' as never,
      roofType: 'gable',
      width: 6,
      depth: 4,
      overhang: 0.3,
      position: [0, 0, 3.26],
      rotation: Math.PI / 2,
    })
    useScene.getState().createNode(sibling, 'roof_test' as AnyNodeId)

    let current = useScene.getState().nodes[segment.id as AnyNodeId] as RoofSegmentNode
    expect(
      generatedGutters(current).filter((gutter) => getDefaultGutterSide(gutter) === '+Z'),
    ).toHaveLength(2)

    useScene.getState().deleteNode(sibling.id as AnyNodeId)

    current = useScene.getState().nodes[segment.id as AnyNodeId] as RoofSegmentNode
    expect(
      generatedGutters(current).filter((gutter) => getDefaultGutterSide(gutter) === '+Z'),
    ).toHaveLength(1)
  })

  test('removes host drainage while an auto-connected lean-to occupies the eave', () => {
    const segment = RoofSegmentNode.parse({
      id: 'rseg_main' as never,
      roofType: 'shed',
      width: 8,
      depth: 6,
      metadata: { autoGutter: true },
    })
    setRoofScene(segment)
    useScene.getState().updateNode(segment.id as AnyNodeId, { width: 8 } as Partial<AnyNode>)

    let current = useScene.getState().nodes[segment.id as AnyNodeId] as RoofSegmentNode
    expect(generatedGutters(current)).toHaveLength(1)
    expect(generatedDownspouts(current)).toHaveLength(1)

    const leanTo = LeanToExtensionNode.parse({
      id: 'leanto_attached' as never,
      autoSpan: true,
      connectionMode: 'auto',
      hostRoofId: 'roof_test',
      hostRoofSegmentId: segment.id,
      hostRoofEdge: '+Z',
    })
    useScene.getState().createNode(leanTo)

    current = useScene.getState().nodes[segment.id as AnyNodeId] as RoofSegmentNode
    expect(generatedGutters(current)).toHaveLength(0)
    expect(generatedDownspouts(current)).toHaveLength(0)

    useScene.getState().deleteNode(leanTo.id as AnyNodeId)

    current = useScene.getState().nodes[segment.id as AnyNodeId] as RoofSegmentNode
    expect(generatedGutters(current)).toHaveLength(1)
    expect(generatedDownspouts(current)).toHaveLength(1)
  })

  test('splits and restores host drainage as a partial lean-to attachment changes', () => {
    const segment = RoofSegmentNode.parse({
      id: 'rseg_main' as never,
      roofType: 'shed',
      width: 8,
      depth: 6,
      metadata: { autoGutter: true },
    })
    setRoofScene(segment)
    useScene.getState().updateNode(segment.id as AnyNodeId, { width: 8 } as Partial<AnyNode>)

    const leanTo = LeanToExtensionNode.parse({
      id: 'leanto_partial' as never,
      autoSpan: false,
      connectionMode: 'auto',
      hostRoofId: 'roof_test',
      hostRoofSegmentId: segment.id,
      hostRoofEdge: '+Z',
      hostRoofEdgeRange: [0.25, 0.75],
    })
    useScene.getState().createNode(leanTo)

    let current = useScene.getState().nodes[segment.id as AnyNodeId] as RoofSegmentNode
    expect(generatedGutters(current)).toHaveLength(2)
    expect(generatedDownspouts(current)).toHaveLength(2)

    useScene.getState().updateNode(
      leanTo.id as AnyNodeId,
      {
        connectionMode: 'manual',
      } as Partial<AnyNode>,
    )

    current = useScene.getState().nodes[segment.id as AnyNodeId] as RoofSegmentNode
    expect(generatedGutters(current)).toHaveLength(1)
    expect(generatedDownspouts(current)).toHaveLength(1)
  })

  test('removes obsolete generated gutters and their linked downspouts on a roof-type change', () => {
    const segment = RoofSegmentNode.parse({
      id: 'rseg_test' as never,
      roofType: 'gable',
      metadata: { autoGutter: true },
    })
    setRoofScene(segment)
    useScene.getState().updateNode(segment.id as AnyNodeId, { width: 8 } as Partial<AnyNode>)

    let currentSegment = useScene.getState().nodes[segment.id as AnyNodeId] as RoofSegmentNode
    const back = generatedGutters(currentSegment).find(
      (gutter) => getDefaultGutterSide(gutter) === '-Z',
    )!
    const downspout = DownspoutNode.parse({
      id: 'downspout_test' as never,
      gutterId: back.id,
    })
    useScene.getState().createNode(downspout, segment.id as AnyNodeId)

    useScene.getState().updateNode(
      segment.id as AnyNodeId,
      {
        roofType: 'shed',
      } as Partial<AnyNode>,
    )

    currentSegment = useScene.getState().nodes[segment.id as AnyNodeId] as RoofSegmentNode
    expect(generatedGutters(currentSegment).map((gutter) => getDefaultGutterSide(gutter))).toEqual([
      '+Z',
    ])
    expect(useScene.getState().nodes[back.id as AnyNodeId]).toBeUndefined()
    expect(useScene.getState().nodes[downspout.id as AnyNodeId]).toBeUndefined()
  })

  test('disabling auto mode removes generated drainage but keeps manual gutters', () => {
    const segment = RoofSegmentNode.parse({
      id: 'rseg_test' as never,
      roofType: 'flat',
      metadata: { autoGutter: true },
    })
    const manual = GutterNode.parse({
      id: 'gutter_manual' as never,
      parentId: segment.id,
      roofSegmentId: segment.id,
      length: 1.5,
    })
    setRoofScene({ ...segment, children: [manual.id] })
    useScene.setState((state) => ({ nodes: { ...state.nodes, [manual.id]: manual as AnyNode } }))
    useScene.getState().updateNode(segment.id as AnyNodeId, { width: 8 } as Partial<AnyNode>)

    const current = useScene.getState().nodes[segment.id as AnyNodeId] as RoofSegmentNode
    useScene.getState().updateNode(
      segment.id as AnyNodeId,
      {
        metadata: { ...current.metadata, autoGutter: false },
      } as Partial<AnyNode>,
    )

    const disabledSegment = useScene.getState().nodes[segment.id as AnyNodeId] as RoofSegmentNode
    expect(generatedGutters(disabledSegment)).toHaveLength(0)
    expect(generatedDownspouts(disabledSegment)).toHaveLength(0)
    expect(disabledSegment.children).toContain(manual.id)
    expect(useScene.getState().nodes[manual.id as AnyNodeId]).toMatchObject({ length: 1.5 })
  })
})
