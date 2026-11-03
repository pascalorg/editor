import { expect, test } from 'bun:test'
import { type AnyNode, DoorNode, LevelNode, SlabNode, WallNode } from '../schema'
import { getWallBodyCenterOffset } from '../systems/wall/wall-frame'
import { getOpeningWallCut } from './opening-floor-datum'
import { area, difference } from './polygon-boolean'

// The aperture is the doorway floor (the wall's own footprint); the band is what
// the wall body loses and must reach past both faces, or the CSG cut is coplanar.
for (const [label, extra] of [
  ['straight', {}],
  ['justified', { justification: 'a' }],
  ['curved', { curveOffset: 0.8 }],
] as const)
  test(`opening cut band contains the aperture and overshoots both faces: ${label}`, () => {
    const wall = WallNode.parse({
      id: 'wall_band',
      parentId: 'level_band',
      start: [0, 0],
      end: [4, 0.03],
      thickness: 0.12,
      children: ['door_band'],
      ...extra,
    })
    const door = DoorNode.parse({
      id: 'door_band',
      parentId: wall.id,
      wallId: wall.id,
      position: [2, 1.05, 0],
      width: 0.9,
      height: 2.1,
    })
    const nodes: Record<string, AnyNode> = { [wall.id]: wall, [door.id]: door }
    const cut = getOpeningWallCut(wall, door, nodes)
    expect(area(cut.aperture)).toBeGreaterThan(0)
    expect(area(difference(cut.aperture, cut.band))).toBeLessThan(1e-4)
    // A centred twin reaching 5 cm past both faces still fits inside the band.
    const face = Math.abs(getWallBodyCenterOffset(wall)) + (wall.thickness ?? 0) / 2
    const twin = WallNode.parse({ ...wall, justification: undefined, thickness: 2 * face + 0.1 })
    const twinCut = getOpeningWallCut(twin, door, { [twin.id]: twin, [door.id]: door })
    expect(area(twinCut.aperture)).toBeGreaterThan(area(cut.aperture) + 0.05)
    expect(area(difference(twinCut.aperture, cut.band))).toBeLessThan(1e-4)
  })

// A door straddling a house floor (top 0.05 m, x < 0) and a garage sunk beside it (top -0.68 m):
// it measures from the higher floor, and the wall reaches down to the garage's.
function straddlingDoor(sill: number) {
  const slab = (id: string, x0: number, x1: number, elevation: number) =>
    SlabNode.parse({
      id,
      parentId: 'level_sill',
      polygon: [
        [x0, -4],
        [x1, -4],
        [x1, 4],
        [x0, 4],
      ],
      elevation,
    })
  const wall = WallNode.parse({
    id: 'wall_sill',
    parentId: 'level_sill',
    start: [5, 4],
    end: [-5, 4],
    thickness: 0.2,
    height: 2.7,
    children: ['door_sill'],
  })
  const door = DoorNode.parse({
    id: 'door_sill',
    parentId: wall.id,
    wallId: wall.id,
    position: [5, sill + 1.1, 0],
    width: 2,
    height: 2.2,
  })
  const nodes: Record<string, AnyNode> = {
    level_sill: LevelNode.parse({
      id: 'level_sill',
      level: 0,
      children: ['slab_house', 'slab_garage', wall.id],
    }),
    slab_house: slab('slab_house', -5, 0, 0.05),
    slab_garage: slab('slab_garage', 0, 5, -0.68),
    [wall.id]: wall,
    [door.id]: door,
  }
  return getOpeningWallCut(wall, door, nodes)
}

test('an opening reaches below its floor down to the wall bottom, its cut never past it', () => {
  expect(straddlingDoor(0).datum).toBeCloseTo(0.05, 6)
  const lowered = straddlingDoor(-0.4)
  expect(lowered.datum).toBeCloseTo(0.05, 6)
  expect(lowered.bottom).toBeCloseTo(0.05 - 0.4, 6)
  expect(lowered.top).toBeCloseTo(0.05 - 0.4 + 2.2, 6)
  // Asked under the garage floor, the wall is cut down to that floor and no further.
  expect(straddlingDoor(-2).bottom).toBeCloseTo(-0.68, 6)
})
