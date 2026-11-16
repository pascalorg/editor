import { expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  EXPLODED_GAP,
  LevelNode,
} from '@pascal-app/core'
import { levelOrbitFloorY } from './level-orbit-floor'
import { ORBIT_TARGET_HEIGHT } from './orbit-floor-clearance'

/** A house of a lower floor, a ground floor and an upper floor, standing `seatY` over the datum. */
function house(seatY: number) {
  const list: AnyNode[] = [
    BuildingNode.parse({
      id: 'building_a',
      position: [4, seatY, -2],
      children: ['level_lower', 'level_ground', 'level_upper'],
    }),
    LevelNode.parse({
      id: 'level_lower',
      parentId: 'building_a',
      level: -1,
      height: 2.7,
      baseElevation: -2.7,
    }),
    LevelNode.parse({ id: 'level_ground', parentId: 'building_a', level: 0, height: 2.5 }),
    LevelNode.parse({ id: 'level_upper', parentId: 'building_a', level: 1, height: 2.5 }),
  ]
  return Object.fromEntries(list.map((node) => [node.id, node])) as Record<AnyNodeId, AnyNode>
}

test('the orbit rests on the floor of a house seated on a slope, not on the datum under it', () => {
  // A walk-out seated 1.52 m up its slope: the ground floor is there, the lower floor 2.7 m under.
  const seated = house(1.52)
  expect(levelOrbitFloorY('level_ground', seated, 'stacked')).toBeCloseTo(1.52, 9)
  expect(levelOrbitFloorY('level_lower', seated, 'stacked')).toBeCloseTo(1.52 - 2.7, 9)
  expect(levelOrbitFloorY('level_upper', seated, 'stacked')).toBeCloseTo(1.52 + 2.5, 9)
  // The pivot is then at standing height in the lower floor's rooms (its plane is at -1.18), not
  // 0.42 m under its slab, where the datum's count (-2.7 + 1.1) put it.
  const pivot = levelOrbitFloorY('level_lower', seated, 'stacked') + ORBIT_TARGET_HEIGHT
  expect(pivot).toBeCloseTo(-0.08, 9)
  // A house cut into the ground stands under the datum, and its floors with it.
  expect(levelOrbitFloorY('level_ground', house(-2), 'stacked')).toBeCloseTo(-2, 9)
})

test('a house at the datum, the exploded view and no level read as before', () => {
  const flat = house(0)
  expect(levelOrbitFloorY('level_ground', flat, 'stacked')).toBe(0)
  expect(levelOrbitFloorY('level_lower', flat, 'stacked')).toBeCloseTo(-2.7, 9)
  // Exploded, each level is lifted by its index; the seat is added once.
  expect(levelOrbitFloorY('level_upper', house(1.52), 'exploded')).toBeCloseTo(
    1.52 + 2.5 + EXPLODED_GAP,
    9,
  )
  expect(levelOrbitFloorY(null, flat, 'stacked')).toBe(0)
  expect(levelOrbitFloorY('level_gone', flat, 'stacked')).toBe(0)
})
