import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  CeilingNode,
  DuctSegmentNode,
  type GeometryContext,
  LevelNode,
  PipeSegmentNode,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import { Box3 } from 'three'
import { buildDuctSegmentGeometry } from '../duct-segment/geometry'
import { buildPipeSegmentGeometry } from '../pipe-segment/geometry'
import {
  buildHangerBandGeometry,
  buildRunHangers,
  hangerSceneNodes,
  hangerSupportLines,
  planRunHangerSlots,
  planRunHangers,
  runHangerFloorplan,
} from './run-hangers'

function fixture() {
  const level = LevelNode.parse({ height: 3 })
  const wall = WallNode.parse({
    parentId: level.id,
    start: [-2, 0],
    end: [5, 0],
    thickness: 0.2,
    height: 3,
  })
  const ceiling = CeilingNode.parse({
    parentId: level.id,
    polygon: [
      [-2, -2],
      [5, -2],
      [5, 5],
      [-2, 5],
    ],
    height: 3,
  })
  const pipe = PipeSegmentNode.parse({
    parentId: level.id,
    path: [
      [0, 2, 0.5],
      [3, 2, 0.5],
    ],
    autoHangers: true,
  })
  level.children = [wall.id, ceiling.id, pipe.id]
  const nodes: Record<AnyNodeId, AnyNode> = {
    [level.id]: level,
    [wall.id]: wall,
    [ceiling.id]: ceiling,
    [pipe.id]: pipe,
  }
  const ctx: GeometryContext = {
    resolve: <N = AnyNode>(id: AnyNodeId) => nodes[id] as N | undefined,
    children: [],
    siblings: [],
    parent: level,
    sceneNodes: nodes,
  }
  return { level, wall, ceiling, pipe, nodes, ctx }
}

describe('automatic run hangers', () => {
  test('legacy and disabled runs have no supports', () => {
    const { pipe, nodes } = fixture()
    expect(planRunHangers({ ...pipe, autoHangers: undefined }, nodes)).toEqual([])
    expect(planRunHangers({ ...pipe, autoHangers: false }, nodes)).toEqual([])
  })
  test('chooses the nearest wall face, accounting for thickness', () => {
    const { pipe, nodes, wall } = fixture()
    const hangers = planRunHangers(pipe, nodes)
    expect(hangers).toHaveLength(2)
    expect(hangers.every((h) => h.hostId === wall.id)).toBe(true)
    expect(hangers[0]!.anchor.toArray()).toEqual([0.75, 2, 0.1])
  })
  test('chooses the ceiling when it is nearer', () => {
    const { pipe, ceiling, nodes } = fixture()
    const hangers = planRunHangers(
      {
        ...pipe,
        path: [
          [0, 2.8, 0.5],
          [3, 2.8, 0.5],
        ],
      },
      nodes,
    )
    expect(hangers.every((h) => h.hostId === ceiling.id)).toBe(true)
    expect(hangers[0]!.anchor.y).toBe(3)
  })
  test('uses wall on either side and rejects wall above its top', () => {
    const { pipe, wall, nodes, ceiling } = fixture()
    const back = planRunHangers(
      {
        ...pipe,
        path: [
          [0, 2, -0.5],
          [3, 2, -0.5],
        ],
      },
      nodes,
    )
    expect(back[0]!.anchor.z).toBeCloseTo(-0.1)
    nodes[wall.id] = { ...wall, height: 1 }
    expect(planRunHangers(pipe, nodes).every((h) => h.hostId === ceiling.id)).toBe(true)
  })
  test('does not anchor in ceiling holes or beyond its polygon', () => {
    const { pipe, nodes, wall, ceiling } = fixture()
    delete nodes[wall.id]
    nodes[ceiling.id] = {
      ...ceiling,
      holes: [
        [
          [0, 0],
          [1.5, 0],
          [1.5, 1],
          [0, 1],
        ],
      ],
    }
    expect(planRunHangers(pipe, nodes)).toHaveLength(1)
    expect(
      planRunHangers(
        {
          ...pipe,
          path: [
            [8, 2, 0],
            [11, 2, 0],
          ],
        },
        nodes,
      ),
    ).toEqual([])
  })
  test('skips wall openings', () => {
    const { pipe, nodes, wall, ceiling } = fixture()
    const window = WindowNode.parse({
      parentId: wall.id,
      position: [2.75, 2, 0],
      width: 1,
      height: 1,
    })
    nodes[window.id] = window
    nodes[wall.id] = { ...wall, children: [window.id] }
    const hangers = planRunHangers(pipe, nodes)
    expect(hangers[0]!.hostId).toBe(ceiling.id)
    expect(hangers[1]!.hostId).toBe(wall.id)
  })
  test('obeys maximum reach and re-elects after a host is removed', () => {
    const { pipe, nodes, wall, ceiling } = fixture()
    expect(planRunHangers({ ...pipe, hangerMaxReach: 0.2 }, nodes)).toEqual([])
    delete nodes[wall.id]
    expect(planRunHangers(pipe, nodes).every((h) => h.hostId === ceiling.id)).toBe(true)
    delete nodes[ceiling.id]
    expect(planRunHangers(pipe, nodes)).toEqual([])
  })
  test('spaces supports along sloped and vertical segments', () => {
    const { pipe, nodes, wall } = fixture()
    const sloped = planRunHangers(
      {
        ...pipe,
        hangerSpacing: 1,
        path: [
          [0, 2, 0.5],
          [3, 1.9, 0.5],
        ],
      },
      nodes,
    )
    expect(sloped).toHaveLength(4)
    expect(sloped[0]!.center.y).toBeGreaterThan(sloped[3]!.center.y)
    const vertical = planRunHangers(
      {
        ...pipe,
        path: [
          [0, 0.5, 0.5],
          [0, 2.5, 0.5],
        ],
      },
      nodes,
    )
    expect(vertical).toHaveLength(2)
    expect(vertical.every((h) => h.hostId === wall.id)).toBe(true)
  })
  test('short segments get one support and degenerate segments get none', () => {
    const { pipe, nodes } = fixture()
    expect(
      planRunHangers(
        {
          ...pipe,
          path: [
            [0, 2, 0.5],
            [0.1, 2, 0.5],
          ],
        },
        nodes,
      ),
    ).toHaveLength(1)
    expect(
      planRunHangers(
        {
          ...pipe,
          path: [
            [0, 2, 0.5],
            [0, 2, 0.5],
          ],
        },
        nodes,
      ),
    ).toEqual([])
    expect(planRunHangers({ ...pipe, hangerSpacing: 0 }, nodes)).toEqual([])
  })
  test('geometry and plan use the same attachment positions', () => {
    const { pipe, ctx } = fixture()
    const group = buildRunHangers(pipe, ctx)
    expect(group.children).toHaveLength(6)
    const bounds = new Box3().setFromObject(group)
    expect(bounds.min.z).toBeLessThan(0.11)
    expect(runHangerFloorplan(pipe, ctx)).toHaveLength(4)
    expect(buildPipeSegmentGeometry(pipe, ctx).getObjectByName('auto-hangers')).toBeDefined()
    const duct = DuctSegmentNode.parse({
      ...pipe,
      id: undefined,
      type: 'duct-segment',
      shape: 'rect',
      system: 'supply',
    })
    expect(
      buildDuctSegmentGeometry(duct, ctx).getObjectByName('auto-hangers')?.children,
    ).toHaveLength(6)
  })
  test('geometry context resolves hosts without a scene snapshot', () => {
    const { ctx, wall, ceiling } = fixture()
    const nodes = hangerSceneNodes({ ...ctx, sceneNodes: undefined })
    expect(nodes[wall.id]).toBe(wall)
    expect(nodes[ceiling.id]).toBe(ceiling)
  })
})

test('double-line hangers attach two rods directly to the band', () => {
  const { pipe, ctx } = fixture()
  const single = buildRunHangers(pipe, ctx)
  const double = buildRunHangers({ ...pipe, hangerStyle: 'double' }, ctx)
  expect(single.children).toHaveLength(6)
  expect(double.children).toHaveLength(10)
  expect(runHangerFloorplan({ ...pipe, hangerStyle: 'double' }, ctx)).toHaveLength(6)
  expect(
    buildRunHangers({ ...pipe, hangerStyle: 'double', autoHangers: false }, ctx).children,
  ).toHaveLength(0)
})

test('circular double hangers keep a circular inner and outer band', () => {
  const { pipe, nodes } = fixture()
  const run = { ...pipe, hangerStyle: 'double' as const }
  const geometry = buildHangerBandGeometry(run)
  const positions = geometry.getAttribute('position')
  const inner = (pipe.diameter * 0.0254) / 2 + 0.002
  for (let i = 0; i < positions.count; i++) {
    const radius = Math.hypot(positions.getX(i), positions.getY(i))
    expect(Math.min(Math.abs(radius - inner), Math.abs(radius - inner - 0.006))).toBeLessThan(1e-7)
  }
  const hanger = planRunHangers(run, nodes)[0]!
  const lines = hangerSupportLines(run, hanger)
  for (const [start, end] of lines) {
    expect(start.distanceTo(hanger.center)).toBeCloseTo(inner + 0.003, 6)
    expect(end.z).toBeCloseTo(hanger.anchor.z, 6)
  }
  expect(
    lines[0]![1]
      .clone()
      .sub(lines[0]![0])
      .normalize()
      .dot(lines[1]![1].clone().sub(lines[1]![0]).normalize()),
  ).toBeCloseTo(1, 6)
  geometry.dispose()
})

test('rectangular band forms a closed solid through every mitered corner', () => {
  const duct = DuctSegmentNode.parse({
    shape: 'rect',
    width: 14,
    height: 8,
    path: [
      [0, 0, 0],
      [1, 0, 0],
    ],
  })
  const geometry = buildHangerBandGeometry(duct)
  const positions = geometry.getAttribute('position')
  const edges = new Map<string, number>()
  const vertex = (i: number) =>
    [positions.getX(i), positions.getY(i), positions.getZ(i)].map((n) => n.toFixed(7)).join(',')
  for (let i = 0; i < positions.count; i += 3) {
    for (let j = 0; j < 3; j++) {
      const edge = [vertex(i + j), vertex(i + ((j + 1) % 3))].sort().join('|')
      edges.set(edge, (edges.get(edge) ?? 0) + 1)
    }
  }
  expect([...edges.values()].every((count) => count === 2)).toBe(true)
  geometry.dispose()
})

test('individual hanger overrides move, skip, and select a support in both views', () => {
  const { pipe, nodes, ceiling, ctx } = fixture()
  const changed = PipeSegmentNode.parse({
    ...pipe,
    hangerOverrides: {
      '0:0': { fraction: 0.1, hostId: ceiling.id },
      '0:1': { skipped: true },
    },
  })
  const slots = planRunHangerSlots(changed, nodes)
  expect(slots).toHaveLength(2)
  expect(slots[0]!.center.x).toBeCloseTo(0.3)
  expect(slots[0]!.hanger?.hostId).toBe(ceiling.id)
  expect(slots[1]!.skipped).toBe(true)
  expect(planRunHangers(changed, nodes)).toHaveLength(1)
  expect(buildRunHangers(changed, ctx).children).toHaveLength(3)
  expect(runHangerFloorplan(changed, ctx)).toHaveLength(2)
})

test('missing explicit hosts remain unsupported instead of silently changing hosts', () => {
  const { pipe, nodes, ceiling } = fixture()
  const changed = { ...pipe, hangerOverrides: { '0:0': { hostId: ceiling.id } } }
  delete nodes[ceiling.id]
  const slots = planRunHangerSlots(changed, nodes)
  expect(slots[0]!.hanger).toBeNull()
  expect(slots[0]!.skipped).toBe(false)
  expect(slots[1]!.hanger).not.toBeNull()
})

test('unsupported slots remain available for editing', () => {
  const { pipe, nodes } = fixture()
  expect(planRunHangerSlots({ ...pipe, hangerMaxReach: 0.01 }, nodes)).toHaveLength(2)
  expect(
    PipeSegmentNode.safeParse({ ...pipe, hangerOverrides: { '0:0': { fraction: 2 } } }).success,
  ).toBe(false)
})
