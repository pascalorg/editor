import { expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  LevelNode,
  SiteNode,
  WallNode,
  ZoneNode,
} from '@pascal-app/core'
import { previewTree, treePlacementRefusal } from './placement'

// The tree shown under the pointer before the click. A house usually stands on the Site's
// origin: the ghost must exist all the same, and say where a click would be refused.

function houseOnTheOrigin() {
  const corners: [number, number][] = [
    [-3, -3],
    [3, -3],
    [3, 3],
    [-3, 3],
  ]
  const site = SiteNode.parse({ id: 'site_ghost', children: ['building_ghost'] })
  const building = BuildingNode.parse({
    id: 'building_ghost',
    parentId: site.id,
    children: ['level_ghost'],
  })
  const walls = corners.map((start, index) =>
    WallNode.parse({
      id: `wall_ghost_${index}`,
      parentId: 'level_ghost',
      start,
      end: corners[(index + 1) % corners.length],
      height: 2.5,
      thickness: 0.1,
    }),
  )
  const zone = ZoneNode.parse({
    id: 'zone_ghost',
    parentId: 'level_ghost',
    name: 'Room',
    spaceRole: 'room',
    polygon: corners,
    boundaryWallIds: walls.map((wall) => wall.id),
  })
  const level = LevelNode.parse({
    id: 'level_ghost',
    parentId: building.id,
    children: [...walls.map((wall) => wall.id), zone.id],
    level: 0,
  })
  const nodes = Object.fromEntries(
    [site, building, level, zone, ...walls].map((node) => [node.id, node]),
  ) as Record<string, AnyNode>
  return { site, nodes }
}

test('a click inside the house is refused, a click in the garden is not', () => {
  const { site, nodes } = houseOnTheOrigin()
  expect(treePlacementRefusal(nodes, site.id, [0, 0])).toBe('tree_inside_building')
  expect(treePlacementRefusal(nodes, site.id, [8, 8])).toBeNull()
})

test('the ghost tree exists although a house stands on the Site origin, and is the tree of its seed', () => {
  const { site, nodes } = houseOnTheOrigin()
  const ghost = previewTree(nodes, site.id, 1234)
  expect(ghost?.type).toBe('tree')
  expect(ghost?.seed).toBe(previewTree(nodes, site.id, 1234)?.seed)
  expect(ghost?.seed).not.toBe(previewTree(nodes, site.id, 4321)?.seed)
  // Without a Site there is nothing to plant on, and no ghost.
  expect(previewTree({}, undefined, 1234)).toBeNull()
})
