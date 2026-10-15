import { afterEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  useLiveNodeOverrides,
  useScene,
  WallNode,
  ZoneNode,
} from '@pascal-app/core'
import { builtinPlugin } from '@pascal-app/nodes'

const roofSegmentResizeAffordance = builtinPlugin.nodes.find((def) => def.kind === 'roof-segment')!
  .floorplanAffordances!['roof-segment-resize']!

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
