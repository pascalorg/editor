import { afterEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  LevelNode,
  nodeRegistry,
  RoofNode,
  RoofSegmentNode,
  registerNode,
  useLiveNodeOverrides,
  useScene,
  WallNode,
  ZoneNode,
} from '@pascal-app/core'
import { useEditor, useInteractionScope } from '@pascal-app/editor'
import { builtinPlugin } from '@pascal-app/nodes'
import { roofSegmentDefinition } from './definition'
import { roofSegmentMoveTarget, roofSegmentResizeAffordance } from './floorplan-affordances'

globalThis.requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}

const modifiers = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false }

afterEach(() => {
  useInteractionScope.getState().end()
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

for (const depth of [6, 1])
  test(`barrel plan span resize to ${depth}m preserves or physically clamps its default rise`, () => {
    const node = RoofSegmentNode.parse({ roofType: 'barrel', depth: 4, position: [10, 0, 20] })
    useScene.setState({ nodes: { [node.id]: node } } as never)
    const definition = builtinPlugin.nodes.find((def) => def.kind === 'roof-segment')!
    const affordance = definition.floorplanAffordances!['roof-segment-resize']!
    const session = affordance.start({
      node,
      payload: { axis: 'z', side: 1 },
      nodes: useScene.getState().nodes,
      initialPlanPoint: [10, 22],
      gridSnapStep: 0,
    })
    session.apply({ planPoint: [10, 22 + depth - 4], modifiers: { ...modifiers, altKey: true } })
    expect(useLiveNodeOverrides.getState().get(node.id)).toMatchObject({
      depth,
      barrelRise: Math.min(1, depth / 2),
      position: [10, 0, 20 + (depth - 4) / 2],
    })
    expect(useScene.getState().nodes[node.id]).toBe(node)
    session.commit?.()
    expect(useScene.getState().nodes[node.id]).toMatchObject({
      depth,
      barrelRise: Math.min(1, depth / 2),
    })
  })

// A reshape that puts a storey-held roof on its walls is a write the rule seats, as a drag is.
describe('roof-segment floor-plan resize onto the walls', () => {
  test('an edge drawn out onto the room’s wall takes the roof to a new Roof level', () => {
    const corners: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 8],
      [0, 8],
    ]
    const walls = corners.map((start, i) =>
      WallNode.parse({ parentId: 'level_g', start, end: corners[(i + 1) % 4], height: 2.7 }),
    )
    const zone = ZoneNode.parse({ parentId: 'level_g', name: 'Room', polygon: corners })
    const segment = RoofSegmentNode.parse({
      id: 'rseg_cover',
      parentId: 'roof_cover',
      width: 8,
      depth: 8,
      wallHeight: 0,
    })
    const roof = RoofNode.parse({
      id: 'roof_cover',
      parentId: 'level_g',
      position: [5, 2.7, 4],
      children: [segment.id],
    })
    const level = LevelNode.parse({
      id: 'level_g',
      parentId: 'building_h',
      level: 0,
      height: 3,
      children: [...walls.map((wall) => wall.id), zone.id, roof.id],
    })
    const building = BuildingNode.parse({ id: 'building_h', children: [level.id] })
    const nodes = Object.fromEntries(
      [building, level, ...walls, zone, roof, segment].map((node) => [node.id, node as AnyNode]),
    )
    useScene.setState({ nodes, rootNodeIds: [building.id] } as never)
    const session = roofSegmentResizeAffordance.start({
      node: segment,
      payload: { axis: 'x', side: 1 },
      nodes: useScene.getState().nodes,
      initialPlanPoint: [9, 4],
      gridSnapStep: 0.1,
    })
    session.apply({ planPoint: [10, 4], modifiers })
    session.commit?.()
    const after = useScene.getState().nodes
    const holder = after[after[roof.id]!.parentId as AnyNodeId] as LevelNode
    expect(holder).toMatchObject({ level: 1, metadata: { role: 'roof' } })
    expect(after[segment.id]).toMatchObject({ width: 9 })
  })
})

describe('roof-segment floor-plan move and resize onto the walls below', () => {
  // A room just off the grid, and its roof on the Roof level above, 1 m off to the +x.
  function scene(thickness?: number) {
    const corners: [number, number][] = [
      [0.2, 0],
      [10.2, 0],
      [10.2, 8],
      [0.2, 8],
    ]
    const walls = corners.map((start, i) =>
      WallNode.parse({
        parentId: 'level_g',
        start,
        end: corners[(i + 1) % 4],
        height: 2.7,
        thickness,
      }),
    )
    const segment = RoofSegmentNode.parse({
      id: 'rseg_move',
      parentId: 'roof_move',
      width: 10,
      depth: 8,
    })
    const roof = RoofNode.parse({
      id: 'roof_move',
      parentId: 'level_r',
      position: [6, 0, 4],
      children: [segment.id],
    })
    const ground = LevelNode.parse({
      id: 'level_g',
      parentId: 'building_m',
      level: 0,
      height: 3,
      children: walls.map((wall) => wall.id),
    })
    const roofLevel = LevelNode.parse({
      id: 'level_r',
      parentId: 'building_m',
      level: 1,
      metadata: { role: 'roof' },
      children: [roof.id],
    })
    const building = BuildingNode.parse({ id: 'building_m', children: [ground.id, roofLevel.id] })
    const nodes = Object.fromEntries(
      [building, ground, roofLevel, ...walls, roof, segment].map((node) => [
        node.id,
        node as AnyNode,
      ]),
    ) as Record<AnyNodeId, AnyNode>
    useScene.setState({ nodes, rootNodeIds: [building.id] } as never)
    if (!nodeRegistry.has(roofSegmentDefinition.kind)) registerNode(roofSegmentDefinition)
    useEditor.setState((state) => ({
      gridSnapStep: 0.5,
      snappingModeByContext: { ...state.snappingModeByContext, polygon: 'grid' },
    }))
    useInteractionScope.getState().begin({
      kind: 'moving',
      node: segment,
      nodeId: segment.id,
      nodeType: segment.type,
      view: '2d',
    })
    return { nodes, segment }
  }

  test('its wall line lands on the wall centres instead of the grid near them', () => {
    const { nodes, segment } = scene()
    const session = roofSegmentMoveTarget({ node: segment, nodes, sceneApi: {} as never })
    session.apply({ planPoint: [6, 4], modifiers })
    session.apply({ planPoint: [5.15, 4.1], modifiers })
    const position = useLiveNodeOverrides.getState().get(segment.id as AnyNodeId)?.position as
      | number[]
      | undefined
    // Edges at x 0.2 / 10.2 and z 0 / 8: the room's walls, not the grid's 0 / 10.
    expect(position?.[0]).toBeCloseTo(-0.8)
    expect(position?.[2]).toBeCloseTo(0)
  })

  test('moved onto the walls, its gable and heel walls take their thickness', () => {
    const { nodes, segment } = scene(0.1826)
    const session = roofSegmentMoveTarget({ node: segment, nodes, sceneApi: {} as never })
    session.apply({ planPoint: [6, 4], modifiers })
    session.apply({ planPoint: [5.15, 4.1], modifiers })
    expect(useLiveNodeOverrides.getState().get(segment.id as AnyNodeId)?.wallThickness).toBeCloseTo(
      0.1826,
    )
    // Off the walls again, it goes back to its own.
    session.apply({ planPoint: [8, 6], modifiers })
    expect(useLiveNodeOverrides.getState().get(segment.id as AnyNodeId)?.wallThickness).toBeCloseTo(
      0.1,
    )
  })

  test('Alt holds the raw cursor, past the walls and the grid', () => {
    const { nodes, segment } = scene()
    const session = roofSegmentMoveTarget({ node: segment, nodes, sceneApi: {} as never })
    const alt = { ...modifiers, altKey: true }
    session.apply({ planPoint: [6, 4], modifiers: alt })
    session.apply({ planPoint: [5.15, 4.1], modifiers: alt })
    const position = useLiveNodeOverrides.getState().get(segment.id as AnyNodeId)?.position as
      | number[]
      | undefined
    expect(position?.[0]).toBeCloseTo(-0.85)
    expect(position?.[2]).toBeCloseTo(0.1)
  })

  // Its wall line runs x 1..11: the -x arrow pulled out to 0.3, near the wall at 0.2.
  function pullLeftSide(altKey: boolean, thickness?: number) {
    const { nodes, segment } = scene(thickness)
    useInteractionScope.getState().end()
    useInteractionScope
      .getState()
      .begin({ kind: 'reshaping', nodeId: segment.id, reshape: 'boundary', driver: 'floorplan' })
    const session = roofSegmentResizeAffordance.start({
      node: segment,
      payload: { axis: 'x', side: -1 },
      nodes,
      initialPlanPoint: [1, 4],
      gridSnapStep: 0.5,
    })
    session.apply({ planPoint: [0.3, 4], modifiers: { ...modifiers, altKey } })
    return useLiveNodeOverrides.getState().get(segment.id as AnyNodeId) as
      | { width: number; position: number[]; wallThickness?: number }
      | undefined
  }

  test('a side arrow pulled near a wall lands that side on the wall centre, not the grid', () => {
    const live = pullLeftSide(false)
    // Grid alone would give 10.5; the wall at x 0.2 gives 10.8, the +x side held at 11.
    expect(live?.width).toBeCloseTo(10.8)
    expect(live?.position[0]).toBeCloseTo(-0.4)
  })

  test('Alt pulls the side to the raw cursor', () => {
    expect(pullLeftSide(true)?.width).toBeCloseTo(10.7)
  })

  test('a side pulled onto the walls gives its gable and heel walls their thickness', () => {
    expect(pullLeftSide(false, 0.1826)?.wallThickness).toBeCloseTo(0.1826)
  })
})
