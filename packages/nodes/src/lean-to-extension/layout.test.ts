import { describe, expect, test } from 'bun:test'
import {
  AnyNode,
  getWallArcData,
  getWallCurveFrameAt,
  getWallCurveLength,
  LeanToExtensionNode,
  RoofNode,
  WallNode,
} from '@pascal-app/core'
import {
  resolveLeanToEdgeSnapTargets,
  resolveLeanToLayout,
  resolveLeanToMoveCenterX,
  resolveLeanToMoveProposal,
  resolveLeanToParentPose,
  resolveLeanToSpanResizeProposal,
  resolveLeanToWallPlacement,
  resolveLeanToWallSurfaceHit,
} from './layout'

describe('lean-to extension layout', () => {
  test('derives a descending roof and evenly spaced post row', () => {
    const node = LeanToExtensionNode.parse({
      span: 4,
      projection: 2.5,
      highEdgeHeight: 2.8,
      pitch: 10,
      postCount: 3,
      postInset: 0.2,
    })
    const layout = resolveLeanToLayout(node)
    expect(layout.lowEdgeHeight).toBeLessThan(layout.highEdgeHeight)
    expect(layout.postXs).toEqual([-1.8, 0, 1.8])
    expect(layout.postHeight).toBeGreaterThan(0)
    expect(layout.slopeLength).toBeGreaterThan(layout.roofRun)
  })

  test('clamps unsafe pitch to preserve a buildable post height', () => {
    const node = LeanToExtensionNode.parse({
      projection: 6,
      highEdgeHeight: 1.5,
      pitch: 45,
    })
    const layout = resolveLeanToLayout(node)
    expect(layout.effectivePitchDegrees).toBeLessThan(45)
    expect(layout.postHeight).toBeGreaterThanOrEqual(0.2)
  })

  test('derives post count from target spacing', () => {
    const node = LeanToExtensionNode.parse({
      span: 8,
      postInset: 0,
      postLayoutMode: 'target-spacing',
      postSpacing: 2,
    })
    expect(resolveLeanToLayout(node).postXs).toHaveLength(5)
  })
})

describe('lean-to wall placement', () => {
  test('creates a separate wall-hosted node without changing a roof node', () => {
    const wall = WallNode.parse({ start: [0, 0], end: [6, 0], thickness: 0.2, height: 3 })
    const node = resolveLeanToWallPlacement(wall, 3, 'front')
    expect(node?.type).toBe('lean-to-extension')
    expect(node?.parentId).toBe(wall.id)
    expect(node?.position).toEqual([3, 0, 0.1])
    expect(node?.rotation).toEqual([0, 0, 0])
    expect(node?.lowEdgeHeight).toBeCloseTo(
      node!.highEdgeHeight - node!.projection * Math.tan((node!.pitch * Math.PI) / 180),
    )
  })

  test('hosts a curved wall with a bent span', () => {
    // sagitta 1, half-chord 3 -> R = (3^2 + 1^2) / (2*1) = 5
    const wall = WallNode.parse({ start: [0, 0], end: [6, 0], curveOffset: 1 })
    const node = resolveLeanToWallPlacement(wall, 3, 'front')
    expect(node?.type).toBe('lean-to-extension')
    expect(node?.parentId).toBe(wall.id)
    // The stored arc carries the wall's true radius and a finite signed center.
    expect(node?.spanArcRadius).toBeCloseTo(5, 3)
    expect(Number.isFinite(node?.spanArcCenterZ ?? Number.NaN)).toBe(true)
    expect(Math.abs(node?.spanArcCenterZ ?? 0)).toBeGreaterThan(1e-3)
  })

  test('expresses the curved-wall center in the selected side frame', () => {
    const wall = WallNode.parse({ start: [0, 0], end: [6, 0], curveOffset: 1, thickness: 0.2 })
    const along = getWallCurveLength(wall) / 2
    const front = resolveLeanToWallPlacement(wall, along, 'front')!
    const back = resolveLeanToWallPlacement(wall, along, 'back')!

    expect(front.spanArcRadius).toBeCloseTo(5, 6)
    expect(front.spanArcCenterZ).toBeCloseTo(4.9, 6)
    expect(back.spanArcRadius).toBeCloseTo(5, 6)
    expect(back.spanArcCenterZ).toBeCloseTo(-5.1, 6)
  })

  test('keeps short inner curved roofs outside the arc center', () => {
    for (const chord of [2, 3]) {
      const wall = WallNode.parse({
        start: [0, 0],
        end: [chord, 0],
        curveOffset: 0.5,
        thickness: 0.2,
      })
      const along = getWallCurveLength(wall) / 2
      const inner = resolveLeanToWallPlacement(wall, along, 'front')!
      const outer = resolveLeanToWallPlacement(wall, along, 'back')!
      const innerLayout = resolveLeanToLayout(inner)

      expect(inner.spanArcCenterZ).toBeGreaterThan(0)
      expect(inner.spanArcCenterZ! - innerLayout.roofRun).toBeCloseTo(0.15, 6)
      expect(inner.projection).toBeLessThan(2.5)
      expect(inner.lowEdgeHeight).toBeCloseTo(
        inner.highEdgeHeight - inner.projection * Math.tan((inner.pitch * Math.PI) / 180),
        6,
      )
      expect(outer.spanArcCenterZ).toBeLessThan(0)
      expect(outer.projection).toBe(2.5)
    }
  })

  test('projects tight curved wall face hits onto arc length and side', () => {
    const wall = WallNode.parse({
      start: [0, 0],
      end: [2, 0],
      curveOffset: 0.5,
      thickness: 0.2,
    })
    const wallLength = getWallCurveLength(wall)

    for (const [side, offset] of [
      ['front', 0.1],
      ['back', -0.1],
    ] as const) {
      const t = 0.05
      const frame = getWallCurveFrameAt(wall, t)
      const hit = resolveLeanToWallSurfaceHit(
        wall,
        [frame.point.x + frame.normal.x * offset, 1.5, frame.point.y + frame.normal.y * offset],
        [frame.normal.x, 0, frame.normal.y],
      )

      expect(Math.abs(frame.normal.y)).toBeLessThan(0.7)
      expect(hit?.localX).toBeCloseTo(wallLength * t, 5)
      expect(hit?.side).toBe(side)
    }
  })

  test('places a committed curved lean-to at the wall point and tangent', () => {
    const wall = WallNode.parse({ start: [0, 0], end: [6, 0], curveOffset: 1, thickness: 0.2 })
    const wallLength = getWallCurveLength(wall)
    const along = wallLength * 0.25
    const node = resolveLeanToWallPlacement(wall, along, 'front', { span: 1 })!
    const frame = getWallCurveFrameAt(wall, node.position[0] / wallLength)
    const arc = getWallArcData(wall)!
    const pose = resolveLeanToParentPose(wall, node)

    expect(pose.position[0]).toBeCloseTo(frame.point.x + frame.normal.x * 0.1, 5)
    expect(pose.position[2]).toBeCloseTo(frame.point.y + frame.normal.y * 0.1, 5)
    expect(pose.position[0]).not.toBeCloseTo(node.position[0], 2)
    expect(pose.rotationY).toBeCloseTo(-Math.atan2(frame.tangent.y, frame.tangent.x), 6)
    expect(Math.hypot(frame.point.x - arc.center.x, frame.point.y - arc.center.y)).toBeCloseTo(
      arc.radius,
      6,
    )
  })

  test('moves along the host wall with snapping and roof-edge clamping', () => {
    const wall = WallNode.parse({ start: [0, 0], end: [10, 0] })
    const node = LeanToExtensionNode.parse({
      span: 4,
      leftOverhang: 0.2,
      rightOverhang: 0.4,
    })

    expect(resolveLeanToMoveCenterX(node, wall, 5.26, 0.5)).toBe(5.5)
    expect(resolveLeanToMoveCenterX(node, wall, -2)).toBe(2.2)
    expect(resolveLeanToMoveCenterX(node, wall, 20)).toBe(7.6)
  })

  test('snaps moving lean-to edges to adjacent lean-to edges on split wall chunks', () => {
    const wall = WallNode.parse({
      id: 'wall_left',
      parentId: 'level_test',
      start: [0, 0],
      end: [5, 0],
    })
    const adjacentWall = WallNode.parse({
      id: 'wall_right',
      parentId: 'level_test',
      start: [5, 0],
      end: [10, 0],
    })
    const moving = LeanToExtensionNode.parse({
      id: 'leanto_left',
      parentId: wall.id,
      position: [2, 0, 0.05],
      span: 2,
      leftOverhang: 0,
      rightOverhang: 0,
    })
    const adjacent = LeanToExtensionNode.parse({
      id: 'leanto_right',
      parentId: adjacentWall.id,
      position: [1, 0, 0.05],
      span: 2,
      leftOverhang: 0,
      rightOverhang: 0,
    })
    const nodes = {
      [wall.id]: wall,
      [adjacentWall.id]: adjacentWall,
      [moving.id]: moving,
      [adjacent.id]: adjacent,
    } as Record<string, AnyNode>

    expect(
      resolveLeanToMoveCenterX(
        moving,
        wall,
        3.9,
        0,
        resolveLeanToEdgeSnapTargets(moving, wall, nodes),
      ),
    ).toBe(4)
  })

  test('aligns the moving roof height when its edge magnetically snaps to a neighbor', () => {
    const wall = WallNode.parse({
      id: 'wall_left',
      parentId: 'level_test',
      start: [0, 0],
      end: [5, 0],
    })
    const adjacentWall = WallNode.parse({
      id: 'wall_right',
      parentId: 'level_test',
      start: [5, 0],
      end: [10, 0],
    })
    const moving = LeanToExtensionNode.parse({
      id: 'leanto_left',
      parentId: wall.id,
      position: [2, 0, 0.05],
      span: 2,
      highEdgeHeight: 2.8,
      leftOverhang: 0,
      rightOverhang: 0,
    })
    const adjacent = LeanToExtensionNode.parse({
      id: 'leanto_right',
      parentId: adjacentWall.id,
      position: [1, 0, 0.05],
      span: 2,
      highEdgeHeight: 3.4,
      leftOverhang: 0,
      rightOverhang: 0,
    })
    const nodes = {
      [wall.id]: wall,
      [adjacentWall.id]: adjacentWall,
      [moving.id]: moving,
      [adjacent.id]: adjacent,
    } as Record<string, AnyNode>

    const proposal = resolveLeanToMoveProposal({
      node: moving,
      wall,
      rawLocalX: 3.9,
      rawHighEdgeHeight: 3,
      edgeSnapTargets: resolveLeanToEdgeSnapTargets(moving, wall, nodes),
    })

    expect(proposal.centerX).toBe(4)
    expect(proposal.highEdgeHeight).toBe(3.4)
    expect(proposal.lowEdgeHeight - moving.lowEdgeHeight).toBeCloseTo(0.6)
  })

  test('stops a span resize at the host wall end', () => {
    const wall = WallNode.parse({ start: [0, 0], end: [10, 0] })
    const leanTo = LeanToExtensionNode.parse({
      parentId: wall.id,
      position: [4, 0, 0.05],
      span: 4,
      leftOverhang: 0.2,
      rightOverhang: 0.2,
    })

    const proposal = resolveLeanToSpanResizeProposal({
      node: leanTo,
      wall,
      rawSpan: 7.65,
      side: 'right',
    })

    expect(proposal.span).toBeCloseTo(7.8)
    expect(proposal.position[0]).toBeCloseTo(5.9)
    expect(proposal.position[0] + proposal.span / 2 + leanTo.rightOverhang).toBeCloseTo(10)
  })

  test('fits a resized span to its neighbor and adopts the same roof plane', () => {
    const wall = WallNode.parse({
      id: 'wall_span_left',
      parentId: 'level_test',
      start: [0, 0],
      end: [5, 0],
    })
    const adjacentWall = WallNode.parse({
      id: 'wall_span_right',
      parentId: 'level_test',
      start: [5, 0],
      end: [10, 0],
    })
    const moving = LeanToExtensionNode.parse({
      id: 'leanto_span_left',
      parentId: wall.id,
      position: [2, 0, 0.05],
      span: 2,
      highEdgeHeight: 2.8,
      pitch: 8,
      leftOverhang: 0,
      rightOverhang: 0,
    })
    const adjacent = LeanToExtensionNode.parse({
      id: 'leanto_span_right',
      parentId: adjacentWall.id,
      position: [1, 0, 0.05],
      span: 2,
      highEdgeHeight: 3.4,
      pitch: 12,
      leftOverhang: 0,
      rightOverhang: 0,
    })
    const nodes = {
      [wall.id]: wall,
      [adjacentWall.id]: adjacentWall,
      [moving.id]: moving,
      [adjacent.id]: adjacent,
    } as Record<string, AnyNode>

    const proposal = resolveLeanToSpanResizeProposal({
      node: moving,
      wall,
      rawSpan: 3.85,
      side: 'right',
      edgeSnapTargets: resolveLeanToEdgeSnapTargets(moving, wall, nodes),
    })

    expect(proposal.span).toBe(4)
    expect(proposal.position[0]).toBe(3)
    expect(proposal.highEdgeHeight).toBe(3.4)
    expect(proposal.pitch).toBe(12)
    expect(proposal.lowEdgeHeight).toBeCloseTo(
      proposal.highEdgeHeight - moving.projection * Math.tan((proposal.pitch * Math.PI) / 180),
    )
    expect(proposal.target?.nodeId).toBe(adjacent.id)
  })

  test('aligns a straight span with a curved roof at their tangent wall end', () => {
    const curvedWall = WallNode.parse({
      id: 'wall_resize_curved',
      parentId: 'level_test',
      start: [0, 0],
      end: [6, 0],
      curveOffset: 1,
    })
    const straightWall = WallNode.parse({
      id: 'wall_resize_tangent',
      parentId: 'level_test',
      start: [6, 0],
      end: [10.8, 3.6],
    })
    const curvedLength = getWallCurveLength(curvedWall)
    const straightLength = getWallCurveLength(straightWall)
    const curved = LeanToExtensionNode.parse({
      id: 'leanto_resize_curved',
      parentId: curvedWall.id,
      position: [curvedLength / 2, 0, 0.05],
      span: curvedLength - 0.3,
      highEdgeHeight: 3.5,
      pitch: 14,
    })
    const straight = LeanToExtensionNode.parse({
      id: 'leanto_resize_tangent',
      parentId: straightWall.id,
      position: [3.75, 0, 0.05],
      span: 4.2,
      highEdgeHeight: 2.8,
      pitch: 8,
    })
    const nodes = {
      [curvedWall.id]: curvedWall,
      [straightWall.id]: straightWall,
      [curved.id]: curved,
      [straight.id]: straight,
    } as Record<string, AnyNode>

    const proposal = resolveLeanToSpanResizeProposal({
      node: straight,
      wall: straightWall,
      rawSpan: straightLength - 0.45,
      side: 'left',
      edgeSnapTargets: resolveLeanToEdgeSnapTargets(straight, straightWall, nodes),
    })

    expect(proposal.position[0] - proposal.span / 2 - straight.leftOverhang).toBeCloseTo(0)
    expect(proposal.highEdgeHeight).toBe(3.5)
    expect(proposal.pitch).toBe(14)
    expect(proposal.target?.nodeId).toBe(curved.id)
  })

  test('keeps existing roof data unchanged when parsed with the extended node union', () => {
    const existingRoof = RoofNode.parse({
      children: [],
      position: [1, 0, 2],
      rotation: 0.35,
      segments: [],
    })
    const parsed = AnyNode.parse(existingRoof)
    expect(parsed).toEqual(existingRoof)
    expect(parsed.type).toBe('roof')
  })
})
