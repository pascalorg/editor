import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  getRoofSegmentVisibleTopBounds,
  LeanToExtensionNode,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  spatialGridManager,
  WallNode,
} from '@pascal-app/core'
import { getRoofTopSurfaceY } from '../shared/roof-surface'
import { leanToRoofSegmentLayoutPatch } from './assembly'
import {
  applyLeanToAvailableWallSpan,
  applyLeanToRoofAttachment,
  applyLeanToWallAutoSpan,
  resolveLeanToRoofAttachment,
} from './roof-attachment'

function sceneWithRoof(
  options: { roofType?: 'gable' | 'hip' | 'shed' | 'flat'; wallHeight?: number } = {},
) {
  const level = LevelNode.parse({ id: 'level_test', name: 'Test level' })
  const wall = WallNode.parse({
    id: 'wall_test',
    parentId: level.id,
    start: [-2, 3],
    end: [2, 3],
    height: 3,
    thickness: 0.1,
  })
  const roof = RoofNode.parse({
    id: 'roof_test',
    parentId: level.id,
    position: [0, 0, 0],
    children: ['rseg_test'],
  })
  const segment = RoofSegmentNode.parse({
    id: 'rseg_test',
    parentId: roof.id,
    roofType: options.roofType ?? 'gable',
    width: 6,
    depth: 6,
    wallHeight: options.wallHeight ?? 3,
    pitch: 30,
    overhang: 0.3,
  })
  const leanTo = LeanToExtensionNode.parse({
    id: 'leanto_test',
    parentId: wall.id,
    position: [2, 0, wall.thickness / 2],
    rotation: [0, 0, 0],
    span: 4,
  })
  const nodes = {
    [level.id]: level,
    [wall.id]: wall,
    [roof.id]: roof,
    [segment.id]: segment,
    [leanTo.id]: leanTo,
  } as Record<AnyNodeId, AnyNode>
  return { leanTo, nodes, roof, segment, wall }
}

beforeEach(() => spatialGridManager.clear())

describe('lean-to roof-edge attachment', () => {
  test('intersects the extension top surface with a compatible gable eave', () => {
    const { leanTo, nodes, roof, segment, wall } = sceneWithRoof()
    const attachment = resolveLeanToRoofAttachment(leanTo, wall, nodes)

    expect(attachment).not.toBeNull()
    expect(attachment?.roofId).toBe(roof.id)
    expect(attachment?.roofSegmentId).toBe(segment.id)
    expect(attachment?.edge).toBe('+Z')
    expect(attachment?.highEdgeHeight).toBeGreaterThan(2.5)
    expect(attachment?.highEdgeHeight).toBeLessThan(3.2)
    const hostEdgeTop =
      roof.position[1] +
      segment.position[1] +
      getRoofTopSurfaceY(0, segment.depth / 2 + segment.overhang, segment)
    const extensionTopAtHostEdge =
      attachment!.highEdgeHeight -
      attachment!.planDistance * Math.tan((leanTo.pitch * Math.PI) / 180)
    expect(extensionTopAtHostEdge).toBeCloseTo(hostEdgeTop, 5)
    const connected = applyLeanToRoofAttachment(leanTo, attachment!)
    expect(connected.roofThickness).toBe(segment.deckThickness)
    expect(connected.shingleThickness).toBe(segment.shingleThickness)
  })

  test('clamps an overhang-inclusive host roof edge to the supporting wall span', () => {
    const initial = sceneWithRoof()
    const shiftedRoof = {
      ...initial.roof,
      position: [1, 0, 0] as [number, number, number],
    }
    const nodes = {
      ...initial.nodes,
      [shiftedRoof.id]: shiftedRoof,
    } as Record<AnyNodeId, AnyNode>

    const attachment = resolveLeanToRoofAttachment(initial.leanTo, initial.wall, nodes)
    expect(attachment).not.toBeNull()

    const connected = applyLeanToRoofAttachment(initial.leanTo, attachment!)
    expect(connected.position[0]).toBeCloseTo(2, 5)
    expect(connected.span + connected.leftOverhang + connected.rightOverhang).toBeCloseTo(4, 5)
    expect(connected.hostRoofEdgeRange).toEqual([0, 1])
    expect(connected.lowEdgeHeight).toBeCloseTo(
      connected.highEdgeHeight - connected.projection * Math.tan((connected.pitch * Math.PI) / 180),
    )
  })

  test('keeps a rotated host roof overhang from widening the wall-hosted gutter run', () => {
    const level = LevelNode.parse({ id: 'level_rotated_roof' })
    const wall = WallNode.parse({
      id: 'wall_rotated_roof',
      parentId: level.id,
      start: [-5, 4],
      end: [-5, 12],
    })
    const roof = RoofNode.parse({
      id: 'roof_rotated_host',
      parentId: level.id,
      position: [-7, 2.5, 8],
      rotation: -Math.PI / 2,
      children: ['rseg_rotated_host'],
    })
    const segment = RoofSegmentNode.parse({
      id: 'rseg_rotated_host',
      parentId: roof.id,
      position: [0, 0, 0],
      rotation: Math.PI,
      roofType: 'gable',
      width: 8,
      depth: 4,
      wallHeight: 0,
      pitch: 40,
      overhang: 0.3,
    })
    const leanTo = LeanToExtensionNode.parse({
      id: 'leanto_rotated_host',
      parentId: wall.id,
      position: [4, 0, -0.05],
      rotation: [0, Math.PI, 0],
    })
    const nodes = Object.fromEntries(
      [level, wall, roof, segment, leanTo].map((node) => [node.id, node]),
    ) as Record<AnyNodeId, AnyNode>

    const attachment = resolveLeanToRoofAttachment(leanTo, wall, nodes)
    expect(attachment?.edge).toBe('+Z')

    const connected = applyLeanToRoofAttachment(leanTo, attachment!)
    expect(connected.position[0]).toBeCloseTo(4, 8)
    expect(connected.span).toBeCloseTo(7.7, 8)
    expect(connected.span + connected.leftOverhang + connected.rightOverhang).toBeCloseTo(8, 8)
  })

  test('keeps manual span unchanged when auto span is disabled', () => {
    const { leanTo, nodes, wall } = sceneWithRoof()
    const manualSpan = LeanToExtensionNode.parse({
      ...leanTo,
      autoSpan: false,
      position: [1.5, 0, leanTo.position[2]],
      span: 3,
    })
    const attachment = resolveLeanToRoofAttachment(manualSpan, wall, nodes)
    expect(attachment).not.toBeNull()

    const connected = applyLeanToRoofAttachment(manualSpan, attachment!)
    expect(connected.position[0]).toBe(1.5)
    expect(connected.span).toBe(3)
    expect(connected.hostRoofEdgeRange).toBeDefined()
    expect(connected.hostRoofEdgeRange![1] - connected.hostRoofEdgeRange![0]).toBeCloseTo(0.5)
  })

  test('falls back to spanning the complete wall when no roof edge is available', () => {
    const { leanTo, wall } = sceneWithRoof()
    const spanning = applyLeanToWallAutoSpan(leanTo, wall)

    expect(spanning.position[0]).toBeCloseTo(2, 5)
    expect(spanning.span + spanning.leftOverhang + spanning.rightOverhang).toBeCloseTo(4, 5)
  })

  test('auto-spans only the free part of a wall that already hosts an extension', () => {
    const { leanTo, nodes, wall } = sceneWithRoof()
    const existing = LeanToExtensionNode.parse({
      id: 'leanto_existing',
      position: [1, 0, leanTo.position[2]],
      span: 2,
      leftOverhang: 0,
      rightOverhang: 0,
    })
    const draft = LeanToExtensionNode.parse({
      ...leanTo,
      id: 'leanto_draft',
      position: [3, 0, leanTo.position[2]],
      leftOverhang: 0,
      rightOverhang: 0,
    })
    const fullWallDraft = applyLeanToWallAutoSpan(draft, wall)
    const wallWithExisting = WallNode.parse({ ...wall, children: [existing.id] })
    const availableNodes = Object.fromEntries(
      Object.entries(nodes).filter(([id]) => id !== leanTo.id),
    ) as Record<AnyNodeId, AnyNode>
    const available = applyLeanToAvailableWallSpan(
      fullWallDraft,
      wallWithExisting,
      { ...availableNodes, [existing.id]: existing },
      3,
    )

    expect(available.position[0]).toBeCloseTo(3, 6)
    expect(available.span).toBeCloseTo(2, 6)
  })

  test('connects a ground-floor wall to a roof stored on the level above', () => {
    const building = BuildingNode.parse({
      id: 'building_test',
      children: ['level_ground', 'level_roof'],
    })
    const ground = LevelNode.parse({
      id: 'level_ground',
      parentId: building.id,
      level: 0,
      height: 2.5,
      children: ['wall_test'],
    })
    const roofLevel = LevelNode.parse({
      id: 'level_roof',
      parentId: building.id,
      level: 1,
      height: 2.5,
      children: ['roof_test'],
    })
    const wall = WallNode.parse({
      id: 'wall_test',
      parentId: ground.id,
      start: [-2, 3],
      end: [2, 3],
      height: 2.5,
      thickness: 0.1,
    })
    const roof = RoofNode.parse({
      id: 'roof_test',
      parentId: roofLevel.id,
      children: ['rseg_test'],
    })
    const segment = RoofSegmentNode.parse({
      id: 'rseg_test',
      parentId: roof.id,
      roofType: 'gable',
      width: 6,
      depth: 6,
      wallHeight: 0,
      pitch: 30,
      overhang: 0.3,
    })
    const leanTo = LeanToExtensionNode.parse({
      id: 'leanto_test',
      parentId: wall.id,
      position: [2, 0, wall.thickness / 2],
      rotation: [0, 0, 0],
      span: 4,
    })
    const nodes = {
      [building.id]: building,
      [ground.id]: ground,
      [roofLevel.id]: roofLevel,
      [wall.id]: wall,
      [roof.id]: roof,
      [segment.id]: segment,
      [leanTo.id]: leanTo,
    } as Record<AnyNodeId, AnyNode>

    const attachment = resolveLeanToRoofAttachment(leanTo, wall, nodes)

    expect(attachment).not.toBeNull()
    expect(attachment?.roofId).toBe(roof.id)
    expect(attachment?.highEdgeHeight).toBeGreaterThan(2.3)
    expect(attachment?.highEdgeHeight).toBeLessThan(2.6)
  })

  test('tracks a host roof height change through the persisted edge reference', () => {
    const initial = sceneWithRoof({ wallHeight: 3 })
    const first = resolveLeanToRoofAttachment(initial.leanTo, initial.wall, initial.nodes)
    expect(first).not.toBeNull()
    const connected = applyLeanToRoofAttachment(initial.leanTo, first!)
    const raisedSegment = { ...initial.segment, wallHeight: 4 }
    const raisedNodes = {
      ...initial.nodes,
      [raisedSegment.id]: raisedSegment,
    } as Record<AnyNodeId, AnyNode>

    const next = resolveLeanToRoofAttachment(connected, initial.wall, raisedNodes, {
      roofSegmentId: connected.hostRoofSegmentId,
      edge: connected.hostRoofEdge,
    })

    expect(next).not.toBeNull()
    expect(next!.highEdgeHeight - first!.highEdgeHeight).toBeCloseTo(1, 5)
  })

  test('supports level perimeter edges on hip, shed, and flat roofs', () => {
    for (const roofType of ['hip', 'shed', 'flat'] as const) {
      const { leanTo, nodes, wall } = sceneWithRoof({ roofType })
      const attachment = resolveLeanToRoofAttachment(leanTo, wall, nodes)
      expect(attachment?.edge).toBe('+Z')
    }
  })

  test('keeps a connected extension rooted at the wall beneath a flat host fascia', () => {
    const { leanTo, nodes, wall } = sceneWithRoof({
      roofType: 'flat',
    })
    const attachment = resolveLeanToRoofAttachment(leanTo, wall, nodes)
    expect(attachment).not.toBeNull()

    const connected = applyLeanToRoofAttachment(leanTo, attachment!)
    const extensionSegment = RoofSegmentNode.parse(leanToRoofSegmentLayoutPatch(connected))
    const bounds = getRoofSegmentVisibleTopBounds(extensionSegment)
    const visibleBack = extensionSegment.position[2] + bounds.minZ
    const wallTop =
      extensionSegment.position[1] + getRoofTopSurfaceY(0, bounds.minZ + 0.02, extensionSegment)

    expect(visibleBack).toBeCloseTo(-0.02, 6)
    expect(wallTop).toBeCloseTo(connected.highEdgeHeight, 5)
  })

  test('does not attach to a managed lean-to roof or a distant roof', () => {
    const { leanTo, nodes, roof, wall } = sceneWithRoof()
    const managedRoof = {
      ...roof,
      metadata: { managedByLeanTo: 'leanto_other' },
      position: [0, 0, -10] as [number, number, number],
    }
    const isolated = {
      ...nodes,
      [roof.id]: managedRoof,
    } as Record<AnyNodeId, AnyNode>

    expect(resolveLeanToRoofAttachment(leanTo, wall, isolated)).toBeNull()
  })
})
