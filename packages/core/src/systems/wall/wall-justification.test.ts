import { describe, expect, test } from 'bun:test'
import { extractRooms } from '../../lib/room-graph'
import { getRenderableSlabPolygon } from '../../lib/slab-polygon'
import { detectSpacesForLevel, initSpaceDetectionSync } from '../../lib/space-detection'
import { reconcileSceneStructure } from '../../lib/structure-reconcile'
import {
  BuildingNode,
  generateId,
  LevelNode,
  SeparatorNode,
  SlabNode,
  WallNode,
} from '../../schema'
import { wallSegmentAnchors } from '../../services/alignment-anchors'
import useScene, { clearSceneHistory } from '../../store/use-scene'
import { computeWallSlabSupport } from '../slab/slab-support'
import { getWallCurveFrameAt, getWallSurfacePolygon } from './wall-curve'
import { getWallPlanFootprint } from './wall-footprint'
import {
  buildWallJustificationPatch,
  getWallBodyLine,
  planWallJustification,
  reverseWallDirection,
} from './wall-frame'
import { planWallMerge } from './wall-merge'
import { calculateLevelMiters } from './wall-mitering'
import { planWallDivision, planWallDivisions, planWallRectangle } from './wall-operations'

const wall = (start: [number, number], end: [number, number], justification?: 'a' | 'b') =>
  WallNode.parse({ start, end, thickness: 0.2, justification })

function expectSimple(points: { x: number; y: number }[]) {
  const cross = (a: (typeof points)[number], b: typeof a, c: typeof a) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  for (let i = 0; i < points.length; i++)
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue
      const a = points[i]!,
        b = points[(i + 1) % points.length]!
      const c = points[j]!,
        d = points[(j + 1) % points.length]!
      expect(
        cross(a, b, c) * cross(a, b, d) < -1e-12 && cross(c, d, a) * cross(c, d, b) < -1e-12,
      ).toBe(false)
    }
}

describe('justified junction footprints', () => {
  for (const first of [undefined, 'a'] as const)
    test(`corner ${first ?? 'center'} / a closes on intersecting body lines`, () => {
      const walls = [wall([0, 0], [4, 0], first), wall([4, 0], [4, 3], 'a')]
      const miters = calculateLevelMiters(walls)
      const closing = { x: 3.9, y: first ? 0.1 : 0 }
      for (const w of walls) {
        const footprint = getWallPlanFootprint(w, miters)
        expect(footprint.some((p) => Math.hypot(p.x - closing.x, p.y - closing.y) < 1e-10)).toBe(
          true,
        )
        expectSimple(footprint)
        for (const point of footprint) {
          expect(point.x).toBeGreaterThanOrEqual(-0.2)
          expect(point.x).toBeLessThanOrEqual(4.2)
          expect(point.y).toBeGreaterThanOrEqual(-0.2)
          expect(point.y).toBeLessThanOrEqual(3.2)
        }
      }
    })

  test('near-parallel justified corners never exceed the miter limit', () => {
    const walls = [wall([0, 0], [4, 0], 'a'), wall([0, 0], [4, 0.000_01], 'a')]
    for (const w of walls)
      for (const p of getWallPlanFootprint(w, calculateLevelMiters(walls))) {
        expect(Math.min(Math.hypot(p.x, p.y), Math.hypot(p.x - 4, p.y))).toBeLessThanOrEqual(2)
      }
  })

  for (const hostJustification of [undefined, 'a', 'b'] as const) {
    for (const side of [-1, 1])
      for (const slant of [0, 0.8])
        test(`T stem meets near face: host ${hostJustification ?? 'center'}, side ${side}, slant ${slant}`, () => {
          const host = wall([0, 0], [6, 0], hostJustification)
          const stem = wall([3 + slant, side * 3], [3, 0], 'a')
          const miters = calculateLevelMiters([host, stem])
          const footprint = getWallPlanFootprint(stem, miters)
          const face =
            side > 0
              ? hostJustification === 'a'
                ? 0.2
                : hostJustification === 'b'
                  ? 0
                  : 0.1
              : hostJustification === 'b'
                ? -0.2
                : hostJustification === 'a'
                  ? 0
                  : -0.1
          for (const p of footprint.slice(1, 4)) expect(p.y).toBeCloseTo(face, 10)
          expectSimple(footprint)
          expect(getWallPlanFootprint(host, miters)).toHaveLength(4)
        })
  }

  test('curved a body lies entirely to the left of the reference arc', () => {
    const w = { ...wall([0, 0], [4, 0], 'a'), curveOffset: 0.7 }
    const points = getWallSurfacePolygon(w, 12)
    for (let i = 0; i <= 12; i++) {
      const frame = getWallCurveFrameAt(w, i / 12)
      expect(points[i]!.x).toBeCloseTo(frame.point.x, 12)
      expect(points[i]!.y).toBeCloseTo(frame.point.y, 12)
      const left = points[25 - i]!
      expect(
        (left.x - frame.point.x) * frame.normal.x + (left.y - frame.point.y) * frame.normal.y,
      ).toBeCloseTo(0.2, 12)
    }
  })
})

test('outside justified room retains reference topology, adopts outer slab faces and has 100% support', () => {
  const points: [number, number][] = [
    [0, 0],
    [4, 0],
    [4, 3],
    [0, 3],
  ]
  const walls = points.map((p, i) => wall(p, points[(i + 1) % 4]!, 'b'))
  const detected = detectSpacesForLevel('level_test', walls)
  expect(detected.spaces).toHaveLength(1)
  expect(
    new Set(
      detected.spaces[0]!.polygon.map((p) => p.map((value) => Number(value.toFixed(6))).join(',')),
    ),
  ).toEqual(new Set(['-0.1,-0.1', '4.1,-0.1', '4.1,3.1', '-0.1,3.1']))
  const slab = SlabNode.parse({
    polygon: detected.spaces[0]!.polygon,
    elevation: 0.3,
    thickness: 0.3,
  })
  const rendered = getRenderableSlabPolygon(slab, { walls, siblingSlabs: [] })
  expect(Math.min(...rendered.map((p) => p[0]))).toBeCloseTo(-0.2)
  expect(Math.max(...rendered.map((p) => p[0]))).toBeCloseTo(4.2)
  expect(Math.min(...rendered.map((p) => p[1]))).toBeCloseTo(-0.2)
  expect(Math.max(...rendered.map((p) => p[1]))).toBeCloseTo(3.2)
  for (const w of walls) {
    expect(detected.wallUpdates.find((update) => update.wallId === w.id)).toMatchObject({
      frontSide: 'interior',
      backSide: 'exterior',
    })
    const support = computeWallSlabSupport(w, [slab], walls)
    expect(support.electedSlabId).toBe(slab.id)
    expect(support.baseSegments).toHaveLength(1)
    expect(support.baseSegments[0]!.start).toBeCloseTo(0, 12)
    expect(support.baseSegments[0]!.end).toBeCloseTo(1, 12)
    expect(support.baseSegments[0]!.elevation).toBe(0.3)
  }
})

for (const curveOffset of [0, 0.7, -0.7])
  test(`switching justification moves the body but keeps reference endpoints and arc: curve ${curveOffset}`, () => {
    const original = { ...wall([1, 2], [5, 4]), curveOffset }
    const originalPolygon = getWallSurfacePolygon(original)
    let current = original
    for (const justification of ['a', undefined, 'b', undefined] as const) {
      const patch = buildWallJustificationPatch(justification)
      expect(Object.keys(patch)).toEqual(['justification'])
      current = { ...current, ...patch }
      expect(current.start).toBe(original.start)
      expect(current.end).toBe(original.end)
      expect(current.curveOffset).toBe(original.curveOffset)
      const nextPolygon = getWallSurfacePolygon(current)
      if (justification) expect(nextPolygon).not.toEqual(originalPolygon)
      else expect(nextPolygon).toEqual(originalPolygon)
    }
  })

for (const multiple of [false, true])
  test(`${multiple ? 'multiple' : 'single'} split preserves justified orientation`, () => {
    const level = LevelNode.parse({})
    const w = { ...wall([0, 0], [6, 0], 'a'), parentId: level.id }
    const nodes = { [level.id]: level, [w.id]: w }
    const plan = multiple
      ? planWallDivisions(nodes, w.id, [2, 4])
      : planWallDivision(nodes, w.id, 3)
    const pieces = [
      ...plan.changes.create.map((op) => op.node),
      ...plan.changes.update.map((op) => ({ ...nodes[op.id], ...op.data })),
    ]
    for (const piece of pieces)
      if (piece.type === 'wall') {
        expect(piece.justification).toBe('a')
        expect(getWallBodyLine(piece as WallNode).start.y).toBeCloseTo(0.1)
      }
  })

test('backwards merge preserves the same world body side', () => {
  const first = wall([0, 0], [2, 0], 'a')
  const second = wall([4, 0], [2, 0], 'b')
  const plan = planWallMerge({ [first.id]: first, [second.id]: second }, [first.id, second.id])
  const merged = plan.changes.update.find((op) => op.id === plan.wallId)!.data as WallNode
  expect(getWallBodyLine(merged).start.y).toBeCloseTo(0.1)
  expect(getWallBodyLine(merged).end.y).toBeCloseTo(0.1)
})

for (const end of [
  [4, 3],
  [-4, -3],
] as [number, number][])
  test(`rectangle keeps counterclockwise reference orientation: ${end}`, () => {
    const level = LevelNode.parse({})
    const plan = planWallRectangle(
      { [level.id]: level },
      { levelId: level.id, start: [0, 0], end, wallDefaults: { justification: 'b' } },
    )
    expect(plan.walls).toHaveLength(4)
    for (const w of plan.walls) {
      expect(w.justification).toBe('b')
      const reversed = { ...w, ...reverseWallDirection(w) }
      expect(getWallBodyLine(reversed).start).toEqual(getWallBodyLine(w).end)
    }
  })

test('alignment retains reference endpoints and adds actual face anchors', () => {
  const anchors = wallSegmentAnchors('wall_test', [0, 0], [4, 0], 0.2, 'a')
  expect(anchors.slice(0, 3).map((p) => [p.x, p.z])).toEqual([
    [0, 0],
    [4, 0],
    [2, 0],
  ])
  expect(anchors.slice(3).map((p) => p.z)).toEqual([0.2, 0, 0.2, 0])
})

for (const stemTop of [undefined, 1.5, 3])
  test(`reference switch preserves topology and all endpoints, T-stem ${stemTop ?? 'none'}`, () => {
    const walls = [
      wall([0, 0], [4, 0]),
      wall([4, 0], [4, 3]),
      wall([4, 3], [0, 3]),
      wall([0, 3], [0, 0]),
    ]
    if (stemTop) walls.push(wall([2, stemTop], [2, 0]))
    const before = extractRooms(walls)
      .map(({ polygon: _polygon, ...reference }) => reference)
      .sort((a, b) => a.id.localeCompare(b.id))
    expect(before).toHaveLength(stemTop === 3 ? 2 : 1)
    let nodes = Object.fromEntries(walls.map((wall) => [wall.id, wall]))
    for (const next of ['a', undefined, 'b'] as const) {
      const updates = planWallJustification(nodes, walls[0]!.id, next)
      expect(updates).toEqual([{ id: walls[0]!.id, data: { justification: next } }])
      nodes = { ...nodes, [walls[0]!.id]: { ...nodes[walls[0]!.id]!, ...updates[0]!.data } }
      expect(Object.values(nodes).map(({ start, end }) => ({ start, end }))).toEqual(
        walls.map(({ start, end }) => ({ start, end })),
      )
      expect(
        extractRooms(Object.values(nodes))
          .map(({ polygon: _polygon, ...reference }) => reference)
          .sort((a, b) => a.id.localeCompare(b.id)),
      ).toEqual(before)
      expect(planWallJustification(nodes, walls[0]!.id, next)).toEqual([])
    }
  })

test('mixed junction changes its centred member; unrelated all-centred junction remains legacy', () => {
  const walls = [wall([0, 0], [4, 0]), wall([4, 0], [4, 3]), wall([4, 3], [0, 3])]
  const before = calculateLevelMiters(walls)
  const mixed = [{ ...walls[0]!, justification: 'a' as const }, ...walls.slice(1)]
  const after = calculateLevelMiters(mixed)
  expect(getWallPlanFootprint(walls[1]!, after)).not.toEqual(
    getWallPlanFootprint(walls[1]!, before),
  )
  expect(after.junctionData.get('4000,3000')).toEqual(before.junctionData.get('4000,3000'))
})

test('reference switch leaves oblique neighbours and T-stems byte-identical', () => {
  const walls = [
    wall([0, 0], [4, 0]),
    wall([4, 0], [5, 3]),
    wall([5, 3], [1, 3]),
    wall([1, 3], [0, 0]),
    wall([2, 0], [3.5, 3]),
  ]
  const nodes = Object.fromEntries(walls.map((wall) => [wall.id, wall]))
  const serialized = JSON.stringify(nodes)
  const updates = planWallJustification(nodes, walls[0]!.id, 'a')
  expect(updates).toEqual([{ id: walls[0]!.id, data: { justification: 'a' } }])
  const next = walls.map((wall) => ({
    ...wall,
    ...updates.find((patch) => patch.id === wall.id)?.data,
  }))
  expect(next.slice(1)).toEqual(walls.slice(1))
  expect(
    extractRooms(next)
      .map(({ polygon: _polygon, ...reference }) => reference)
      .sort((a, b) => a.id.localeCompare(b.id)),
  ).toEqual(
    extractRooms(walls)
      .map(({ polygon: _polygon, ...reference }) => reference)
      .sort((a, b) => a.id.localeCompare(b.id)),
  )
  expect(JSON.stringify(nodes)).toBe(serialized)
})

for (const division of ['rectangle', 'separator', 'T-stem'] as const)
  test(`a/center/b keeps reference endpoints and room IDs with undo: ${division}`, () => {
    const raf = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame')
    const cancel = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame')
    Object.defineProperty(globalThis, 'requestAnimationFrame', {
      configurable: true,
      writable: true,
      value: () => 0,
    })
    Object.defineProperty(globalThis, 'cancelAnimationFrame', {
      configurable: true,
      writable: true,
      value: () => {},
    })
    const previous = useScene.getState()
    const building = BuildingNode.parse({})
    const level = LevelNode.parse({ parentId: building.id })
    const walls = [
      wall([0, 0], [4, 0]),
      wall([4, 0], [4, 3]),
      wall([4, 3], [0, 3]),
      wall([0, 3], [0, 0]),
    ].map((w, i) => ({
      ...w,
      parentId: level.id,
      frontSide: 'interior' as const,
      backSide: i === 4 ? ('interior' as const) : ('exterior' as const),
    }))
    const divider =
      division === 'rectangle'
        ? []
        : [
            division === 'separator'
              ? SeparatorNode.parse({ parentId: level.id, start: [2, 3], end: [2, 0] })
              : { ...wall([2, 3], [2, 0]), parentId: level.id },
          ]
    level.children = [...walls, ...divider].map((w) => w.id)
    building.children = [level.id]
    const initial = Object.fromEntries(
      [building, level, ...walls, ...divider].map((n) => [n.id, n]),
    )
    const nodes = reconcileSceneStructure({ nodes: initial, mintId: generateId }).nodes
    useScene.setState({ nodes, rootNodeIds: [building.id], dirtyNodes: new Set(), readOnly: false })
    clearSceneHistory()
    const editor = {
      spaces: {} as Record<string, { polygon: number[][] }>,
      setSpaces(next: typeof editor.spaces) {
        editor.spaces = next
      },
    }
    const strategies: string[] = []
    const stop = initSpaceDetectionSync(
      useScene,
      { getState: () => editor },
      { onTopologyReconcile: (event) => strategies.push(event.strategy) },
    )
    try {
      const roomIds = () =>
        Object.values(useScene.getState().nodes)
          .filter((node) => node.type === 'zone')
          .map((zone) => zone.id)
          .sort()
      const beforeIds = roomIds()
      expect(beforeIds).toHaveLength(division === 'rectangle' ? 1 : 2)
      const references = (graph: typeof nodes) =>
        JSON.stringify(
          Object.values(graph)
            .filter((node) => node.type === 'wall' || node.type === 'separator')
            .map(({ id, start, end }) => ({ id, start, end })),
        )
      for (const next of ['a', undefined, 'b'] as const) {
        const before = useScene.getState().nodes
        clearSceneHistory()
        strategies.length = 0
        useScene.getState().updateNodes(planWallJustification(before, walls[0]!.id, next))
        expect(strategies).toEqual(['indexed'])
        expect(roomIds()).toEqual(beforeIds)
        expect(references(useScene.getState().nodes)).toBe(references(nodes))
        if (next === undefined)
          expect(useScene.getState().nodes[walls[0]!.id]).not.toHaveProperty('justification')
        expect(useScene.temporal.getState().pastStates).toHaveLength(1)
        const after = useScene.getState().nodes
        useScene.temporal.getState().undo()
        expect(useScene.getState().nodes).toEqual(before)
        useScene.temporal.getState().redo()
        expect(useScene.getState().nodes).toEqual(after)
      }
    } finally {
      stop()
      useScene.setState(previous, true)
      clearSceneHistory()
      if (raf) Object.defineProperty(globalThis, 'requestAnimationFrame', raf)
      else Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
      if (cancel) Object.defineProperty(globalThis, 'cancelAnimationFrame', cancel)
      else Reflect.deleteProperty(globalThis, 'cancelAnimationFrame')
    }
  })
