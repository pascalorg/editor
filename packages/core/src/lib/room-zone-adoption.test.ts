import { expect, test } from 'bun:test'
import type { Ring } from './polygon-boolean'
import {
  adoptableFace,
  existingRoomFace,
  type IdentityFace,
  zoneFaceFits,
} from './room-zone-adoption'

const rectangle = (x: number, y: number, width: number, height: number): Ring => [
  [x, y],
  [x + width, y],
  [x + width, y + height],
  [x, y + height],
]
const face = (key: string, outer: Ring, walls: string[]): IdentityFace => ({
  key,
  polygon: { outer, holes: [] },
  clear: { outer, holes: [] },
  boundaryWallIds: walls,
  boundarySeparatorIds: [],
})

test('an unchanged room keeps the face with its own boundaries, even where faces overlap', () => {
  // Degenerate detection (crossing walls) can report overlapping faces; the seed
  // and the overlap then point at the bigger one.
  const big = face('room-b', rectangle(0, 0, 10, 10), ['wall_1', 'wall_2', 'wall_3', 'wall_4'])
  const small = face('room-a', rectangle(0, 0, 4, 4), ['wall_1', 'wall_4', 'wall_5', 'wall_6'])
  const room = {
    id: 'zone_small',
    polygon: rectangle(0, 0, 4, 4),
    seed: [2, 2] as [number, number],
    boundaryWallIds: ['wall_6', 'wall_5', 'wall_4', 'wall_1'],
  }
  expect(existingRoomFace(room, [big, small])).toBe(1)
  expect(existingRoomFace({ ...room, boundaryWallIds: ['wall_gone'] }, [big, small])).toBe(1)
  expect(existingRoomFace({ ...room, seed: [8, 8] }, [big, small])).toBe(1)
  expect(existingRoomFace({ ...room, seed: [8, 8], boundaryWallIds: [] }, [big, small])).toBe(0)
})

test('an even split breaks the tie on the canonical face key, not on face order', () => {
  const left = face('room-left', rectangle(0, 0, 4, 4), [])
  const right = face('room-right', rectangle(4, 0, 4, 4), [])
  const zone = { id: 'zone_even', polygon: rectangle(2, 0, 4, 4) }
  expect(adoptableFace(zoneFaceFits(zone, [left, right]))?.key).toBe('room-left')
  expect(adoptableFace(zoneFaceFits(zone, [right, left]))?.key).toBe('room-left')
})
