import { describe, expect, test } from 'bun:test'
import type { RoomSlice, WallSlice } from '../core/types'
import { leftOfStreet, outwardNormal, rightOfStreet, streetFrameFor } from './street'

function wall(id: string, start: [number, number], end: [number, number], over: Partial<WallSlice> = {}): WallSlice {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  return {
    id,
    start,
    end,
    length,
    dir: [dx / length, dz / length],
    thickness: 0.14,
    height: 2.7,
    exterior: true,
    openings: [],
    curved: false,
    ...over,
  }
}

/** A 10 × 8 m house: walls around the origin-cornered rectangle, one room inside. */
const house = [
  wall('front', [0, 0], [10, 0]),
  wall('right', [10, 0], [10, 8]),
  wall('back', [10, 8], [0, 8]),
  wall('left', [0, 8], [0, 0]),
]
const room: RoomSlice = {
  id: 'room_living',
  name: 'living',
  category: 'living',
  polygon: [
    [0, 0],
    [10, 0],
    [10, 8],
    [0, 8],
  ],
  boundaryWallIds: ['front', 'right', 'back', 'left'],
  ceilingHeight: 2.7,
}

describe('outwardNormal', () => {
  test('points away from the room the wall bounds', () => {
    const near = (n: readonly [number, number], want: [number, number]) => {
      expect(n[0]).toBeCloseTo(want[0], 9)
      expect(n[1]).toBeCloseTo(want[1], 9)
    }
    near(outwardNormal(house[0]!, [room], house), [0, -1])
    near(outwardNormal(house[1]!, [room], house), [1, 0])
    near(outwardNormal(house[2]!, [room], house), [0, 1])
    near(outwardNormal(house[3]!, [room], house), [-1, 0])
  })
})

describe('streetFrameFor', () => {
  // a 20 × 30 m lot, the house 6 m back from its south edge (edge 0 runs along z = 30... the
  // ring is x east / z south, so the south edge is the one at the larger z)
  const lot = {
    points: [
      [-5, -12] as const,
      [15, -12] as const,
      [15, 18] as const,
      [-5, 18] as const,
    ],
  }

  test('from the site: the street edge outward normal, in the level frame; the setback from the walls to the lot line', () => {
    // the house sits at site (0,0) with no yaw; the front edge is the south one (index 2, z = 18)
    const f = streetFrameFor({ site: { ...lot, frontEdge: 2 }, building: { position: [0, 0, 0], rotation: [0, 0, 0] }, walls: house, rooms: [room] })!
    expect(f.source).toBe('site')
    expect(f.dir[0]).toBeCloseTo(0, 9)
    expect(f.dir[1]).toBeCloseTo(1, 9)
    // the walls reach z = 8, the lot line is at z = 18
    expect(f.setbackM).toBeCloseTo(10, 6)
  })

  test('the building yaw turns the world street direction into the level frame', () => {
    // yaw π/2: level +x → world (cos, −sin) = (0, −1); a world +z street reads as level −x
    const f = streetFrameFor({ site: { ...lot, frontEdge: 2 }, building: { position: [0, 0, 0], rotation: [0, Math.PI / 2, 0] }, walls: house, rooms: [room] })!
    expect(f.dir[0]).toBeCloseTo(-1, 9)
    expect(f.dir[1]).toBeCloseTo(0, 9)
  })

  test('no front edge: the most north-facing lot edge (plan up)', () => {
    const f = streetFrameFor({ site: lot, building: { position: [0, 0, 0], rotation: [0, 0, 0] }, walls: house, rooms: [room] })!
    expect(f.dir[1]).toBeCloseTo(-1, 9)
  })

  test('no site: the wall with the widest exterior door is the front; no door: plan up', () => {
    const withDoor = house.map((w) =>
      w.id === 'back'
        ? { ...w, openings: [{ id: 'd', kind: 'door' as const, u: 5, roughWidth: 0.95, roughHeight: 2.1, sillHeight: 0 }] }
        : w,
    )
    const f = streetFrameFor({ walls: withDoor, rooms: [room] })!
    expect(f.source).toBe('entry-door')
    expect(f.dir[0]).toBeCloseTo(0, 9)
    expect(f.dir[1]).toBeCloseTo(1, 9)
    expect(f.setbackM).toBe(6)
    expect(streetFrameFor({ walls: house, rooms: [room] })!.source).toBe('plan-up')
  })

  test('left and right, seen from the street facing the house', () => {
    // street to the south (+z): the viewer faces north; their right is east
    expect(rightOfStreet([0, 1])[0]).toBeCloseTo(1, 9)
    expect(rightOfStreet([0, 1])[1]).toBeCloseTo(0, 9)
    expect(leftOfStreet([0, 1])[0]).toBeCloseTo(-1, 9)
    expect(leftOfStreet([0, 1])[1]).toBeCloseTo(0, 9)
  })
})
