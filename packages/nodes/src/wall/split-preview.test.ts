import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  getWallCurveFrameAt,
  getWallCurveLength,
  LevelNode,
  planWallDivision,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import {
  snapWallSplitDistance,
  wallSplitAnchors,
  wallSplitDistance,
  wallSplitDistances,
  wallSplitPreview,
  wallSplitSegmentLabels,
} from './split-preview'

const level = LevelNode.parse({ children: [] })
const graph = (...nodes: AnyNode[]) =>
  Object.fromEntries([level, ...nodes].map((n) => [n.id, n])) as Record<AnyNodeId, AnyNode>
const free = { gridStep: null, anchors: null, tolerance: 0.2 }

describe('wall split marker', () => {
  test('a mouse projection and numeric distance identify the same angled cut', () => {
    const wall = WallNode.parse({ parentId: level.id, start: [2, 3], end: [8, 11] })
    const nodes = graph(wall)
    const distance = wallSplitDistance(wall, [4, 7.75])
    expect(distance).toBeCloseTo(5)
    const preview = wallSplitPreview(nodes, wall, [distance])
    const plan = planWallDivision(nodes, wall.id, distance)
    expect(preview.valid).toBe(true)
    expect([preview.frames[0]!.point.x, preview.frames[0]!.point.y]).toEqual(plan.point)
    expect(preview.frames).toEqual(wallSplitPreview(nodes, wall, [5]).frames)
  })
  test.each([
    1, -1,
  ])('curved wall mouse target agrees with arc-length widget, offset %p', (offset) => {
    const wall = WallNode.parse({
      parentId: level.id,
      start: [2, 3],
      end: [10, 5],
      curveOffset: offset,
    })
    for (const t of [0.1, 0.37, 0.9]) {
      const frame = getWallCurveFrameAt(wall, t)
      const distance = wallSplitDistance(wall, [
        frame.point.x + frame.normal.x * 0.15,
        frame.point.y + frame.normal.y * 0.15,
      ])
      expect(distance).toBeCloseTo(t * getWallCurveLength(wall), 7)
      const preview = wallSplitPreview(graph(wall), wall, [distance])
      expect(preview.valid).toBe(true)
      expect(preview.frames[0]!.point.x).toBeCloseTo(frame.point.x)
      expect(preview.frames[0]!.point.y).toBeCloseTo(frame.point.y)
    }
  })
  test('invalid cut stays where the pointer is and does not silently snap past an opening', () => {
    const wall = WallNode.parse({ parentId: level.id, start: [0, 0], end: [8, 0] })
    const window = WindowNode.parse({
      parentId: wall.id,
      wallId: wall.id,
      width: 2,
      position: [4, 1.5, 0],
    })
    wall.children = [window.id]
    const nodes = graph(wall, window)
    const before = JSON.stringify(nodes)
    for (const distance of [0, 0.02, 4, 7.99, 8]) {
      const preview = wallSplitPreview(nodes, wall, [distance])
      expect(preview.valid).toBe(false)
      expect(preview.frames[0]!.point.x).toBeCloseTo(distance)
      expect(preview.message.length).toBeGreaterThan(0)
    }
    expect(wallSplitPreview(nodes, wall, [2]).valid).toBe(true)
    // Three even cuts put one through the window at 4 m.
    expect(wallSplitPreview(nodes, wall, wallSplitDistances(8, 3, 0)).valid).toBe(false)
    expect(JSON.stringify(nodes)).toBe(before)
  })
  test('linked copies cannot bypass make-real via direct mouse input', () => {
    const wall = WallNode.parse({
      parentId: level.id,
      start: [0, 0],
      end: [8, 0],
      metadata: { linkedArray: { sourceId: 'wall_original' } },
    })
    expect(wallSplitPreview(graph(wall), wall, [3]).message).toContain('Make the linked array real')
  })
})

describe('loop-cut counts and snapping', () => {
  const wall = WallNode.parse({ parentId: level.id, start: [0, 0], end: [8, 0] })
  test('one cut follows the pointer; more cuts divide the wall evenly', () => {
    expect(wallSplitDistances(8, 1, 3.3)).toEqual([3.3])
    expect(wallSplitDistances(8, 3, 3.3)).toEqual([2, 4, 6])
  })
  test('grid steps count from the wall start and never land on an end', () => {
    expect(snapWallSplitDistance(wall, 3.3, { ...free, gridStep: 0.5 })).toEqual({
      distance: 3.5,
      snap: { kind: 'grid' },
    })
    expect(snapWallSplitDistance(wall, 7.9, { ...free, gridStep: 0.5 }).snap).toBeNull()
  })
  test("'lines' catches the midpoint or another wall's end within tolerance", () => {
    const partition = WallNode.parse({ parentId: level.id, start: [2.6, 0.2], end: [2.6, 4] })
    const anchors = wallSplitAnchors(graph(wall, partition), wall)
    expect(snapWallSplitDistance(wall, 3.9, { ...free, anchors })).toEqual({
      distance: 4,
      snap: { kind: 'midpoint' },
    })
    expect(snapWallSplitDistance(wall, 2.5, { ...free, anchors })).toEqual({
      distance: 2.6,
      snap: { kind: 'alignment', anchor: [2.6, 0.2] },
    })
    expect(snapWallSplitDistance(wall, 3.1, { ...free, anchors })).toEqual({
      distance: 3.1,
      snap: null,
    })
  })
  test('labels show both sides of one cut, or one length repeated across even cuts', () => {
    const nodes = graph(wall)
    expect(
      wallSplitSegmentLabels(wall, wallSplitPreview(nodes, wall, [3])).map((s) => [
        s.length,
        s.count,
      ]),
    ).toEqual([
      [3, 1],
      [5, 1],
    ])
    expect(
      wallSplitSegmentLabels(wall, wallSplitPreview(nodes, wall, [2, 4, 6])).map((s) => [
        s.length,
        s.count,
      ]),
    ).toEqual([[2, 4]])
  })
})
