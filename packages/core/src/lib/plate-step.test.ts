import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { type AnyNode, SlabNode, WallNode, ZoneNode } from '../schema'
import { floorStepFixture } from '../systems/slab/__fixtures__/floor-step'
import {
  computePlateSurfacePartition,
  type PlateLevelContext,
  plateLevelContext,
  platePartitionSignature,
  plateSideRuns,
} from './plate-surface'

const rect = (x0: number, z0: number, x1: number, z1: number): [number, number][] => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
]
const plate = (polygon: [number, number][], elevation: number, holes: [number, number][][] = []) =>
  SlabNode.parse({ boundary: 'auto', polygon, elevation, thickness: 0.05, holes })
const context = (slabs: SlabNode[]): PlateLevelContext => ({ walls: [], zones: [], slabs })

function fixture() {
  const { nodes } = JSON.parse(
    readFileSync(
      new URL('../../../nodes/src/slab/__fixtures__/sunken-pit-scene.json', import.meta.url),
      'utf8',
    ),
  ) as { nodes: Record<string, AnyNode> }
  const host = SlabNode.parse(nodes.slab_2wetb55oie8qzyhb)
  return { host, ctx: plateLevelContext(nodes[host.parentId!]!, (id) => nodes[id]) }
}

test('sunken fixture: every hole interval carries the lower plate top', () => {
  const { host, ctx } = fixture()
  const sides = computePlateSurfacePartition(host, ctx)!.sides.filter(
    (side) => side.role === 'riser',
  )
  expect(sides).toHaveLength(6)
  for (const side of sides) expect(side.dropTo).toBeCloseTo(-0.5957, 4)
})

test('straight separator splits risers where the lower neighbour changes height', () => {
  const upper = plate(rect(0, 0, 4, 4), 0.05)
  const lower = plate(rect(4, 0, 8, 2), -0.6)
  const deeper = plate(rect(4, 2, 8, 4), -1.2)
  const partition = computePlateSurfacePartition(upper, context([upper, lower, deeper]))!
  expect(plateSideRuns(partition, [4, 0], [4, 4])).toEqual([
    { t0: 0, t1: 0.5, role: 'riser', dropTo: -0.6 },
    { t0: 0.5, t1: 1, role: 'riser', dropTo: -1.2 },
  ])
})

test('nested pits stop at their immediate lower neighbour', () => {
  const outer = plate(rect(0, 0, 8, 8), 0.05, [rect(1, 1, 7, 7)])
  const middle = plate(rect(1, 1, 7, 7), -0.6, [rect(2, 2, 6, 6)])
  const inner = plate(rect(2, 2, 6, 6), -1.2)
  const ctx = context([outer, middle, inner])
  for (const [host, dropTo] of [
    [outer, -0.6],
    [middle, -1.2],
  ] as const) {
    const risers = computePlateSurfacePartition(host, ctx)!.sides.filter((s) => s.role === 'riser')
    expect(risers).toHaveLength(4)
    expect(risers.every((s) => s.dropTo === dropTo)).toBe(true)
  }
})

test('fully wall-covered pit intervals stay hidden without drop faces', () => {
  const hole = rect(1, 1, 3, 3)
  const host = plate(rect(0, 0, 4, 4), 0.05, [hole])
  const lower = plate(hole, -0.6)
  const ctx = context([host, lower])
  ctx.walls = hole.map((start, i) =>
    WallNode.parse({ start, end: hole[(i + 1) % hole.length], thickness: 0.2 }),
  )
  const sides = computePlateSurfacePartition(host, ctx)!.sides
  expect(sides.filter((s) => s.role === 'riser')).toHaveLength(0)
  const hidden = sides.filter((s) => s.role === 'hidden')
  expect(hidden.length).toBeGreaterThanOrEqual(4)
  expect(hidden.every((s) => s.dropTo === undefined)).toBe(true)
})

test('open-below holes and rooms without a plate have no drop target', () => {
  const hole = rect(1, 1, 3, 3)
  const host = plate(rect(0, 0, 4, 4), 0.05, [hole])
  const ctx = context([host])
  ctx.zones = [
    ZoneNode.parse({
      name: 'Open room',
      spaceRole: 'room',
      polygon: hole,
      floor: { elevation: -0.6 },
    }),
  ]
  const risers = computePlateSurfacePartition(host, ctx)!.sides.filter((s) => s.role === 'riser')
  expect(risers).toHaveLength(4)
  expect(risers.every((s) => s.dropTo === undefined)).toBe(true)
  expect(
    computePlateSurfacePartition({ ...host, support: 'open' }, ctx)!.sides.every(
      (s) => s.dropTo === undefined,
    ),
  ).toBe(true)
})

test('neighbour elevation edits invalidate the cached drop target', () => {
  const { host, ctx } = fixture()
  const before = computePlateSurfacePartition(host, ctx)!
  const changed = {
    ...ctx,
    slabs: ctx.slabs.map((s) => (s.id === 'slab_m7byobc8mtx1apva' ? { ...s, elevation: -0.8 } : s)),
  }
  expect(platePartitionSignature(host, changed)).not.toBe(platePartitionSignature(host, ctx))
  const after = computePlateSurfacePartition(host, changed)!
  expect(after).not.toBe(before)
  expect(after.sides.filter((s) => s.role === 'riser').every((s) => s.dropTo === -0.8)).toBe(true)
})

test('two rooms divided by a straight separator carry the sunken floor target', () => {
  const { slabs, nodes, level, zones } = floorStepFixture(true)
  const host = { ...slabs[0]!, thickness: 0.05 }
  const ctx = plateLevelContext(level, (id) => (id === host.id ? host : nodes[id]))
  const partition = computePlateSurfacePartition(host, ctx)!
  const runs = plateSideRuns(partition, [4, 0.2], [4, 3.8])
  expect(runs).toEqual([{ t0: 0, t1: 1, role: 'riser', dropTo: -0.4, zoneId: zones[0]!.id }])
})

test('mezzanines do not shorten step drops and support changes invalidate the partition', () => {
  const host = plate(rect(0, 0, 4, 4), 2)
  const floor = plate(rect(4, 0, 8, 4), 0.05)
  const neighbour = plate(rect(4, 0, 8, 4), 1.3)
  const solid = context([host, floor, neighbour])
  const open = context([host, floor, { ...neighbour, support: 'open' }])
  const before = computePlateSurfacePartition(host, solid)!
  expect(plateSideRuns(before, [4, 0], [4, 4])[0]!.dropTo).toBe(1.3)
  expect(platePartitionSignature(host, open)).not.toBe(platePartitionSignature(host, solid))
  const after = computePlateSurfacePartition(host, open)!
  expect(after).not.toBe(before)
  expect(plateSideRuns(after, [4, 0], [4, 4])[0]!.dropTo).toBe(0.05)
  const noFloor = computePlateSurfacePartition(
    host,
    context([host, { ...neighbour, support: 'open' }]),
  )!
  expect(noFloor.sides.every((side) => side.dropTo === undefined)).toBe(true)
})
