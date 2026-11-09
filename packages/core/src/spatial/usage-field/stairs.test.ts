import { describe, expect, test } from 'bun:test'
import { type AnyNode, BuildingNode, LevelNode, StairNode } from '../../schema'
import { rotateXZ } from '../../systems/stair/stair-footprint'
import { SLOPE_STEP_M, stairBodies } from './stairs'
import type { Prism } from './types'
import type { Nodes } from './walls'

function scene(extra: AnyNode[]): Nodes {
  const building = BuildingNode.parse({ id: 'building_1', children: ['level_1'] })
  const level = LevelNode.parse({ id: 'level_1', parentId: 'building_1', level: 0, children: [] })
  return Object.fromEntries([building, level, ...extra].map((node) => [node.id, node])) as Nodes
}

const stair = (over: Record<string, unknown> = {}) =>
  StairNode.parse({
    id: 'stair_1',
    parentId: 'level_1',
    totalRise: 3,
    stepCount: 10,
    width: 1,
    ...over,
  })

const bounds = (prisms: Prism[]) => {
  const points = prisms.flatMap((p) => p.outer)
  const xs = points.map(([x]) => x)
  const zs = points.map(([, z]) => z)
  return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) }
}

describe('stair treads', () => {
  test('a stair filled to the floor is solid from the floor to each tread', () => {
    const { stairs } = stairBodies(scene([stair({ fillToFloor: true })]))
    const treads = stairs[0]!.prisms.filter((p) => p.kind === 'stair')
    expect(treads).toHaveLength(10)
    expect(treads.every((p) => p.z0 === 0 && p.shape === 'exact')).toBe(true)
    expect(Math.max(...treads.map((p) => p.z1))).toBeCloseTo(3, 6)
    expect(Math.min(...treads.map((p) => p.z1))).toBeCloseTo(0.3, 6)
    expect(stairs[0]!.levelId).toBe('level_1')
  })

  test('an open flight has a soffit that rises, cut into slices of the slope step', () => {
    const { stairs } = stairBodies(scene([stair({ fillToFloor: false })]))
    const treads = stairs[0]!.prisms.filter((p) => p.kind === 'stair')
    const last = treads.filter((p) => p.id.includes('.9'))
    expect(last.length).toBeGreaterThan(1)
    for (const p of treads) expect(p.z1 - p.z0).toBeGreaterThan(0)
    // the soffit under the last tread is about a slab's thickness under it, not at the floor
    expect(Math.min(...last.map((p) => p.z0))).toBeGreaterThan(2)
    // slices of one tread step by the slope step
    const starts = [...last].map((p) => p.z0).sort((a, b) => a - b)
    for (let i = 1; i < starts.length; i++)
      expect(starts[i]! - starts[i - 1]!).toBeCloseTo(SLOPE_STEP_M, 6)
  })

  test('a stair that the resolvers refuse is named and leaves the others alone', () => {
    const fine = stair({ id: 'stair_2', position: [5, 0, 0] })
    const tooLarge = stair({ id: 'stair_3', stepCount: 100_000, totalRise: 3 })
    const { stairs, skipped } = stairBodies(scene([fine, tooLarge]))
    expect(stairs.map((s) => s.stairId)).toEqual(['stair_2'])
    expect(skipped.map((s) => s.nodeId)).toEqual(['stair_3'])
    expect(skipped[0]!.why.length).toBeGreaterThan(0)
  })
})

describe('stair guards', () => {
  const rails = (over: Record<string, unknown> = {}) =>
    stairBodies(
      scene([stair({ railingMode: 'both', fillToFloor: true, ...over })]),
    ).stairs[0]!.prisms.filter((p) => p.kind === 'stair-rail')

  test('a guard is read as its rail line: approximate, from the nosing to the rail height', () => {
    const prisms = rails()
    expect(prisms.length).toBeGreaterThan(0)
    expect(prisms.every((p) => p.shape === 'approx' && p.why?.includes('rail line'))).toBe(true)
    for (const p of prisms) expect(p.z1 - p.z0).toBeGreaterThanOrEqual(0.9 - 1e-6)
  })

  test('no railing mode, or a destination surface, draws no guard', () => {
    expect(rails({ railingMode: 'none' })).toHaveLength(0)
    expect(rails({ destinationSurfaceId: 'slab_x' })).toHaveLength(0)
  })

  test('a rail on a sloping flight is cut into slices that rise a slope step each, so a rail high over a walkway does not block it', () => {
    const prisms = rails({ railingHeight: 0.9 })
    expect(prisms.length).toBeGreaterThan(40)
    expect(Math.max(...prisms.map((p) => p.z1 - p.z0))).toBeLessThan(0.9 + SLOPE_STEP_M + 1e-6)
    const low = prisms.filter((p) => p.z0 < 0.5)
    const high = prisms.filter((p) => p.z0 > 2)
    expect(low.length).toBeGreaterThan(0)
    expect(high.length).toBeGreaterThan(0)
  })

  test('a rail height of the stair sets the guard height', () => {
    expect(Math.min(...rails({ railingHeight: 1.1 }).map((p) => p.z1 - p.z0))).toBeCloseTo(1.1, 6)
  })

  test('the stair turned a quarter turn carries its guard with it', () => {
    const at0 = rails()
    const at90 = rails({ rotation: Math.PI / 2 })
    const b0 = bounds(at0)
    const b90 = bounds(at90)
    const corners = [rotateXZ(b0.x0, b0.z0, Math.PI / 2), rotateXZ(b0.x1, b0.z1, Math.PI / 2)]
    expect(b90.x0).toBeCloseTo(Math.min(...corners.map(([x]) => x)), 6)
    expect(b90.x1).toBeCloseTo(Math.max(...corners.map(([x]) => x)), 6)
    expect(b90.z0).toBeCloseTo(Math.min(...corners.map(([, z]) => z)), 6)
    expect(b90.z1).toBeCloseTo(Math.max(...corners.map(([, z]) => z)), 6)
  })

  test('an independent handrail is counted, not drawn', () => {
    const { handrails } = stairBodies(
      scene([stair({ railingMode: 'none', handrail: { mode: 'left' } })]),
    )
    expect(handrails).toBe(1)
  })
})
