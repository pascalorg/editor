import { expect, spyOn, test } from 'bun:test'
import clipping from 'polygon-clipping'
import { WallNode } from '../schema'
import { getWallFaceLine } from '../systems/wall/wall-frame'
import { plateFootprint } from './level-footprints'
import { area, containsPoint, difference, type Ring } from './polygon-boolean'
import type { TopologyRoom } from './room-topology-index'

function fixture(justification?: 'a' | 'b') {
  const wall = WallNode.parse({
    id: 'wall_recovery',
    parentId: 'level_recovery',
    start: [0, 0],
    end: [2, 0],
    thickness: 0.2,
    justification,
  })
  const a = getWallFaceLine(wall, 'a')
  const b = getWallFaceLine(wall, 'b')
  const polygon = [a.start, b.start, b.end, a.end].map(({ x, y }): [number, number] => [x, y])
  const footprints = new Map([[wall.id, polygon]])
  const room: TopologyRoom = {
    id: 'room_recovery',
    polygon: [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ],
    holes: [],
    context: { revision: 1, walls: new Map([[wall.id, wall]]), wallFootprints: footprints },
    spans: [
      { roomId: 'room_recovery', boundaryId: wall.id, kind: 'wall', face: 'a', t0: 0, t1: 1 },
    ],
  }
  return { room, wall, footprints, polygon }
}

test.each([
  { name: 'self-union', failures: [1, 3], justification: undefined },
  { name: 'centred raw rectangle', failures: [1, 3, 5], justification: undefined },
  { name: 'a-justified raw rectangle', failures: [1, 3, 5], justification: 'a' as const },
  { name: 'b-justified raw rectangle', failures: [1, 3, 5], justification: 'b' as const },
])('$name preserves boundary coverage after clipping failures', ({ failures, justification }) => {
  const { room, wall, polygon } = fixture(justification)
  const originalUnion = clipping.union
  let calls = 0
  const clip = spyOn(clipping, 'union').mockImplementation((...inputs) => {
    calls += 1
    if (failures.includes(calls)) throw new Error('Clipping failure')
    return originalUnion(...inputs)
  })
  const warn = spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const plate = plateFootprint([room])
    expect(area(difference(polygon, plate, { throwOnError: true }))).toBeLessThan(1e-6)
    expect(containsPoint(plate, [1, 1])).toBe(true)
    expect(plateFootprint([room])).toBe(plate)
  } finally {
    clip.mockRestore()
    warn.mockRestore()
  }
})

test('an unverifiable footprint cannot cache an incomplete plate', () => {
  const { room, wall, footprints, polygon } = fixture()
  const invalid: Ring = [
    [Number.NaN, 0],
    [1, 0],
    [1, 1],
  ]
  footprints.set(wall.id, invalid)
  const warn = spyOn(console, 'warn').mockImplementation(() => {})
  try {
    expect(() => plateFootprint([room])).toThrow('wall_recovery on level level_recovery')
    footprints.set(wall.id, polygon)
    const plate = plateFootprint([room])
    expect(area(difference(polygon, plate, { throwOnError: true }))).toBeLessThan(1e-6)
    expect(containsPoint(plate, [1, -0.05])).toBe(true)
  } finally {
    warn.mockRestore()
  }
})
