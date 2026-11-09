import { encodeTerrainField } from '../../../lib/terrain-codec'
import { createTerrainField } from '../../../lib/terrain-field'
import { type AnyNode, BuildingNode, SiteNode } from '../../../schema'
import { floorStepFixture } from './floor-step'

export function raisedRoomFixture(neighbor = false, terrain = false) {
  const fixture = floorStepFixture()
  const walls = neighbor ? fixture.walls : fixture.walls.slice(0, 4)
  const zones = (neighbor ? fixture.zones : fixture.zones.slice(0, 1)).map((zone, i) => ({
    ...zone,
    floor: { elevation: i ? 0.05 : 0.6 },
    polygon: !neighbor
      ? ([
          [0, 0],
          [8, 0],
          [8, 4],
          [0, 4],
        ] as [number, number][])
      : zone.polygon,
  }))
  const slabs = (neighbor ? fixture.slabs : fixture.slabs.slice(0, 1)).map((slab, i) => ({
    ...slab,
    elevation: i ? 0.05 : 0.6,
    thickness: 0.05,
    polygon: !neighbor
      ? ([
          [-0.1, -0.1],
          [8.1, -0.1],
          [8.1, 4.1],
          [-0.1, 4.1],
        ] as [number, number][])
      : slab.polygon,
  }))
  const field = createTerrainField({ origin: [-1, -1], cols: 12, rows: 8, spacing: 1 })
  for (let r = 0; r < field.rows; r++)
    for (let c = 0; c < field.cols; c++) field.heights[r * field.cols + c] = 10 + c * 2
  const site = SiteNode.parse({
    id: 'site_platform',
    children: ['building_platform'],
    ...(terrain ? { terrain: encodeTerrainField(field) } : {}),
  })
  const building = BuildingNode.parse({
    id: 'building_platform',
    parentId: site.id,
    children: [fixture.level.id],
  })
  const level = {
    ...fixture.level,
    parentId: building.id,
    children: [...walls, ...zones, ...slabs].map((node) => node.id),
  }
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [site, building, level, ...walls, ...zones, ...slabs].map((node) => [node.id, node]),
  )
  return { ...fixture, walls, zones, slabs, nodes, site, building, level }
}
