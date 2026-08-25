import { describe, expect, test } from 'bun:test'
import {
  type GeometryContext,
  getWallCurveFrameAt,
  getWallCurveLength,
  LeanToExtensionNode,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  WallNode,
} from '@pascal-app/core'
import { resolveConicalLeanToPlacement } from './conical-host'
import { buildLeanToExtensionFloorplan } from './floorplan'
import { resolveLeanToWallPlacement } from './layout'

describe('curved lean-to floorplan', () => {
  test('draws a freestanding canopy in its level plan frame', () => {
    const level = LevelNode.parse({ id: 'level_free_canopy', level: 0 })
    const node = LeanToExtensionNode.parse({
      parentId: level.id,
      hostKind: 'freestanding',
      highSideMode: 'independent-high-beam',
      position: [10, 0, 20],
      rotation: [0, Math.PI / 2, 0],
      span: 2,
      projection: 1,
      highOverhang: 0,
      lowOverhang: 0,
      leftOverhang: 0,
      rightOverhang: 0,
    })
    const geometry = buildLeanToExtensionFloorplan(node, {
      children: [],
      parent: level,
      resolve: () => undefined,
      siblings: [],
    } as GeometryContext)

    expect(geometry?.kind).toBe('group')
    if (geometry?.kind !== 'group') return
    const roof = geometry.children.find((child) => child.kind === 'polygon')
    expect(roof?.kind).toBe('polygon')
    if (roof?.kind !== 'polygon') return
    expect(Math.min(...roof.points.map((point) => point[0]))).toBeCloseTo(10, 6)
    expect(Math.max(...roof.points.map((point) => point[0]))).toBeCloseTo(11, 6)
    expect(Math.min(...roof.points.map((point) => point[1]))).toBeCloseTo(19, 6)
    expect(Math.max(...roof.points.map((point) => point[1]))).toBeCloseTo(21, 6)
  })

  test('matches the committed back-side frame direction', () => {
    const wall = WallNode.parse({ start: [0, 0], end: [6, 0], curveOffset: 1, thickness: 0.2 })
    const wallLength = getWallCurveLength(wall)
    const node = resolveLeanToWallPlacement(wall, wallLength / 2, 'back', {
      span: 1,
      projection: 1,
      highOverhang: 0,
      lowOverhang: 0,
      leftOverhang: 0,
      rightOverhang: 0,
    })!
    const geometry = buildLeanToExtensionFloorplan(node, {
      children: [],
      parent: wall,
      resolve: () => undefined,
      siblings: [],
    } as GeometryContext)
    expect(geometry?.kind).toBe('group')
    if (geometry?.kind !== 'group') return
    const roof = geometry.children.find((child) => child.kind === 'polygon')
    expect(roof?.kind).toBe('polygon')
    if (roof?.kind !== 'polygon') return

    // On the back face, local -X points toward increasing centerline arc length.
    const frame = getWallCurveFrameAt(wall, (node.position[0] + node.span / 2) / wallLength)
    expect(roof.points[0]?.[0]).toBeCloseTo(frame.point.x + frame.normal.x * node.position[2], 3)
    expect(roof.points[0]?.[1]).toBeCloseTo(frame.point.y + frame.normal.y * node.position[2], 3)
  })

  test('draws a closed canopy around a conical host', () => {
    const roof = RoofNode.parse({
      id: 'roof_conical_floorplan',
      position: [2, 0, 3],
      children: ['rseg_conical_floorplan'],
    })
    const segment = RoofSegmentNode.parse({
      id: 'rseg_conical_floorplan',
      parentId: roof.id,
      roofType: 'conical',
      position: [1, 0, 0],
      width: 8,
      depth: 8,
      wallHeight: 3,
    })
    const node = resolveConicalLeanToPlacement(segment)!
    const geometry = buildLeanToExtensionFloorplan(node, {
      children: [],
      parent: segment,
      resolve: (id) => (id === roof.id ? roof : undefined),
      siblings: [],
    } as GeometryContext)

    expect(geometry?.kind).toBe('group')
    if (geometry?.kind !== 'group') return
    const roofBand = geometry.children.find((child) => child.kind === 'polygon')
    expect(roofBand?.kind).toBe('polygon')
    if (roofBand?.kind !== 'polygon') return
    const xs = roofBand.points.map((point) => point[0])
    const zs = roofBand.points.map((point) => point[1])
    expect(Math.min(...xs)).toBeCloseTo(3 - 6.75, 2)
    expect(Math.max(...xs)).toBeCloseTo(3 + 6.75, 2)
    expect(Math.min(...zs)).toBeCloseTo(3 - 6.75, 2)
    expect(Math.max(...zs)).toBeCloseTo(3 + 6.75, 2)
  })
})
