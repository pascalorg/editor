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
import { resolveLeanToFreestandingRunPlacement } from './placement'

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

  test('draws a gable canopy symmetrically around its ridge', () => {
    const level = LevelNode.parse({ id: 'level_gable_canopy', level: 0 })
    const node = LeanToExtensionNode.parse({
      parentId: level.id,
      canopyForm: 'gable',
      hostKind: 'freestanding',
      highSideMode: 'independent-high-beam',
      span: 4,
      projection: 3,
      lowOverhang: 0.25,
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
    expect(Math.min(...roof.points.map((point) => point[1]))).toBeCloseTo(-3.25)
    expect(Math.max(...roof.points.map((point) => point[1]))).toBeCloseTo(3.25)
    expect(geometry.children.filter((child) => child.kind === 'polyline')).toHaveLength(2)
  })

  test('draws a butterfly canopy with the same symmetric two-row footprint', () => {
    const level = LevelNode.parse({ id: 'level_butterfly_canopy', level: 0 })
    const node = LeanToExtensionNode.parse({
      parentId: level.id,
      canopyForm: 'butterfly',
      hostKind: 'freestanding',
      highSideMode: 'independent-high-beam',
      projection: 3,
      lowOverhang: 0.25,
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
    expect(Math.min(...roof.points.map((point) => point[1]))).toBeCloseTo(-3.25)
    expect(Math.max(...roof.points.map((point) => point[1]))).toBeCloseTo(3.25)
    expect(geometry.children.filter((child) => child.kind === 'polyline')).toHaveLength(2)
    expect(geometry.children.filter((child) => child.kind === 'rect')).toHaveLength(6)
  })

  test.each([
    'gable',
    'butterfly',
  ] as const)('draws the continuous %s roof footprint to the shared diagonal seam', (canopyForm) => {
    const level = LevelNode.parse({ id: `level_${canopyForm}_floorplan_joint`, level: 0 })
    const first = resolveLeanToFreestandingRunPlacement(
      level.id,
      [0, 0],
      [4, 0],
      false,
      canopyForm,
    )!
    const second = resolveLeanToFreestandingRunPlacement(
      level.id,
      [4, 0],
      [4, 4],
      false,
      canopyForm,
    )!
    const geometry = buildLeanToExtensionFloorplan(first, {
      children: [],
      parent: level,
      resolve: () => undefined,
      siblings: [second],
    } as GeometryContext)

    expect(geometry?.kind).toBe('group')
    if (geometry?.kind !== 'group') return
    const roof = geometry.children.find((child) => child.kind === 'polygon')
    expect(roof?.kind).toBe('polygon')
    if (roof?.kind !== 'polygon') return
    const run = first.projection + first.lowOverhang
    expect(roof.points).toContainEqual([4, 0])
    expect(
      roof.points.some(([x, z]) => Math.abs(x - (4 - run)) < 1e-8 && Math.abs(z - run) < 1e-8),
    ).toBe(true)
    expect(
      roof.points.some(([x, z]) => Math.abs(x - (4 + run)) < 1e-8 && Math.abs(z + run) < 1e-8),
    ).toBe(true)
    expect(roof.points).not.toContainEqual([4 + first.rightOverhang, run])
  })

  test('draws the continuous mono roof footprint to the shared diagonal seam', () => {
    const level = LevelNode.parse({ id: 'level_mono_floorplan_joint', level: 0 })
    const first = resolveLeanToFreestandingRunPlacement(level.id, [0, 0], [4, 0], false, 'mono')!
    const second = resolveLeanToFreestandingRunPlacement(level.id, [4, 0], [4, 4], false, 'mono')!
    const geometry = buildLeanToExtensionFloorplan(first, {
      children: [],
      parent: level,
      resolve: () => undefined,
      siblings: [second],
    } as GeometryContext)

    expect(geometry?.kind).toBe('group')
    if (geometry?.kind !== 'group') return
    const roof = geometry.children.find((child) => child.kind === 'polygon')
    expect(roof?.kind).toBe('polygon')
    if (roof?.kind !== 'polygon') return
    const lowEdge = first.projection + first.lowOverhang
    const highEdge = first.highOverhang
    expect(
      roof.points.some(
        ([x, z]) => Math.abs(x - (4 - lowEdge)) < 1e-8 && Math.abs(z - lowEdge) < 1e-8,
      ),
    ).toBe(true)
    expect(
      roof.points.some(
        ([x, z]) => Math.abs(x - (4 + highEdge)) < 1e-8 && Math.abs(z + highEdge) < 1e-8,
      ),
    ).toBe(true)
    expect(roof.points).not.toContainEqual([4 + first.rightOverhang, lowEdge])
    expect(roof.points).not.toContainEqual([4 + first.rightOverhang, -highEdge])
  })
})
