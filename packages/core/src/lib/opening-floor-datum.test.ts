import { expect, test } from 'bun:test'
import { type AnyNode, DoorNode, WallNode } from '../schema'
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
