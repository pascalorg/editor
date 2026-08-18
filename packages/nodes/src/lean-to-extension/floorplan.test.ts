import { describe, expect, test } from 'bun:test'
import {
  type GeometryContext,
  getWallCurveFrameAt,
  getWallCurveLength,
  WallNode,
} from '@pascal-app/core'
import { buildLeanToExtensionFloorplan } from './floorplan'
import { resolveLeanToWallPlacement } from './layout'

describe('curved lean-to floorplan', () => {
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
})
