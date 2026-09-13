import { describe, expect, test } from 'bun:test'
import { DEFAULT_SPEC, type FramingSpec } from '../core/spec'
import type { Fixture, Member, RoomSlice, WallSlice } from '../core/types'
import type { PlacedFixtureSlice } from '../core/wall-model'
import { defaultWaterRoute, layoutPlumbing } from './plumbing'

/**
 * G54 / G57 (Steve, 2026-09-07): the sewer leaves toward the street or the
 * rear on a setting and runs on to the property line; the water meter
 * stands at the property line with a buried service to the house; the
 * supply runs through the attic, under the slab, in the crawl space or in
 * the walls on a setting whose default follows the foundation and the state.
 */

function wall(id: string, start: [number, number], end: [number, number]): WallSlice {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  return { id, start, end, length, dir: [dx / length, dz / length], thickness: 0.14, height: 2.7, exterior: true, openings: [], curved: false }
}

// a 10 × 8 m house, the street to the south (+z), the lot line 8 m past the front wall
const walls = [
  wall('w_front', [0, 8], [10, 8]),
  wall('w_right', [10, 8], [10, 0]),
  wall('w_back', [10, 0], [0, 0]),
  wall('w_left', [0, 0], [0, 8]),
]
const bath: RoomSlice = {
  id: 'room_bath',
  name: 'bath',
  category: 'bathroom',
  polygon: [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
  ],
  boundaryWallIds: ['w_left', 'w_back'],
  ceilingHeight: 2.7,
}
const living: RoomSlice = {
  id: 'room_living',
  name: 'living',
  category: 'living',
  polygon: [
    [4, 0],
    [10, 0],
    [10, 8],
    [0, 8],
    [0, 4],
    [4, 4],
  ],
  boundaryWallIds: ['w_right', 'w_front', 'w_back', 'w_left'],
  ceilingHeight: 2.7,
}
const rooms = [bath, living]
const placed: PlacedFixtureSlice[] = [
  { id: 'wc', kind: 'toilet', plan: [0.5, 1], yaw: 0, hot: false, dfu: 3, drainIn: 3 },
  { id: 'lav', kind: 'lavatory', plan: [0.5, 2.5], yaw: 0, hot: true, dfu: 1, drainIn: 1.25 },
]
const street = { dir: [0, 1] as const, setbackM: 8, source: 'site' as const }
const spec = (over: Partial<FramingSpec>): FramingSpec => ({ ...DEFAULT_SPEC, street, ...over })
const run = (over: Partial<FramingSpec>, context = {}) => layoutPlumbing(walls, rooms, spec(over), placed, undefined, true, context)
const byLabel = (members: Member[], s: string) => members.filter((m) => m.label?.includes(s))

describe('the sewer side (G54)', () => {
  test("'street' (the default): the building drain leaves through the street-facing wall and a 4 in lateral runs on to the property line with a two-way cleanout", () => {
    const { members, fixtures } = run({})
    const exitCleanout = fixtures.find((f) => f.label?.includes('Cleanout @ sewer exit')) as Fixture
    expect(exitCleanout.position[2]).toBeGreaterThan(7.5) // on the front wall (z = 8)
    const lateral = byLabel(members, 'sewer lateral')
    expect(lateral.length).toBeGreaterThanOrEqual(1)
    expect(lateral[0]?.label).toContain('street main')
    const lot = fixtures.find((f) => f.label?.includes('Cleanout @ property line')) as Fixture
    expect(lot.position[2]).toBeCloseTo(16, 6) // the lot line: walls to z = 8 + 8 m setback
    // the lateral falls toward the property line
    const l = lateral[0] as Member
    expect(l.rotation[2]).not.toBe(0)
  })

  test("'rear': the exit is on the back wall and the lateral runs to the rear line", () => {
    const { members, fixtures } = run({ sewerSide: 'rear' })
    const exitCleanout = fixtures.find((f) => f.label?.includes('Cleanout @ sewer exit')) as Fixture
    expect(exitCleanout.position[2]).toBeLessThan(0.5) // the back wall (z = 0)
    expect(byLabel(members, 'sewer lateral')[0]?.label).toContain('rear / alley main')
    const lot = fixtures.find((f) => f.label?.includes('Cleanout @ property line')) as Fixture
    expect(lot.position[2]).toBeCloseTo(-8, 6)
  })

  test('no street frame: the nearest exterior exit, no lateral (legacy)', () => {
    const { members, fixtures } = layoutPlumbing(walls, rooms, DEFAULT_SPEC, placed)
    expect(byLabel(members, 'sewer lateral')).toHaveLength(0)
    expect(fixtures.some((f) => f.label?.includes('Cleanout @ property line'))).toBe(false)
  })
})

describe('the water meter and the supply route (G57)', () => {
  test('the meter stands in its box at the property line; a buried service runs to the house entry', () => {
    const { members, fixtures } = run({}, { groundY: -0.3 })
    // the fixture stays at the house ENTRY (the GES bond target); the box is equipment at the line
    const meter = fixtures.find((f) => f.kind === 'water-meter') as Fixture
    expect(meter.label).toContain('from the meter at the property line')
    expect(meter.position[2]).toBeLessThanOrEqual(8.2)
    const box = members.find((m) => m.label?.startsWith('Water meter box')) as Member
    expect(box.position[2]).toBeCloseTo(15.7, 6) // 0.3 inside the lot line
    expect(box.position[1]).toBeCloseTo(-0.15, 6) // on grade
    const service = byLabel(members, 'Water service ¾"')
    expect(service.length).toBeGreaterThanOrEqual(2)
    // the buried legs sit below grade by at least 0.45 m
    for (const m of service) if (m.dims[0] > m.dims[1]) expect(m.position[1]).toBeLessThan(-0.3 - 0.45 + 1e-9)
  })

  test('default route: crawl on a raised floor; attic in FL / TX; under the slab in CA / AZ; walls elsewhere', () => {
    expect(defaultWaterRoute({ raisedFloor: true, stateCode: 'FL' })).toBe('crawl')
    expect(defaultWaterRoute({ stateCode: 'FL' })).toBe('attic')
    expect(defaultWaterRoute({ stateCode: 'TX' })).toBe('attic')
    expect(defaultWaterRoute({ stateCode: 'CA' })).toBe('under-slab')
    expect(defaultWaterRoute({ stateCode: 'AZ' })).toBe('under-slab')
    expect(defaultWaterRoute({ stateCode: 'NY' })).toBe('walls')
    expect(defaultWaterRoute({})).toBe('walls')
  })

  test("'attic': the cold and hot home runs cross above the tallest plate and drop down the walls", () => {
    const { members } = run({ waterRoute: 'attic' })
    const attic = members.filter((m) => m.label?.includes('attic run'))
    expect(attic.length).toBeGreaterThan(0)
    for (const m of attic) expect(m.position[1]).toBeGreaterThan(2.7)
    // the lav's hot and cold both arrive from above: a riser at its bay reaching the attic plane
    const risers = members.filter((m) => (m.sourceId === 'cold-lav' || m.sourceId === 'hot-lav') && m.dims[1] > m.dims[0])
    expect(risers.some((m) => m.position[1] + m.dims[1] / 2 > 2.7)).toBe(true)
  })

  test("'under-slab': the home runs cross below the floor", () => {
    const { members } = run({ waterRoute: 'under-slab' })
    const under = members.filter((m) => m.label?.includes('under the slab'))
    expect(under.length).toBeGreaterThan(0)
    for (const m of under) expect(m.position[1]).toBeLessThan(0)
    expect(members.filter((m) => m.label?.includes('attic run'))).toHaveLength(0)
  })

  test("'walls': no attic or under-slab runs — the legacy planes", () => {
    const { members } = run({ waterRoute: 'walls' })
    expect(members.filter((m) => m.label?.includes('attic run') || m.label?.includes('under the slab'))).toHaveLength(0)
  })
})
