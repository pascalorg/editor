import { describe, expect, test } from 'bun:test'
import { BuildingNode, LevelNode, RockNode, SiteNode, SlabNode, WallNode } from '../schema'
import { buildRock, planRock } from './rock-build'
import { rockSlabHoles } from './rock-cuts'
import { footprintBetween, wallContacts } from './rock-wall-contact'

// A stored document can satisfy the number/tuple schema but not describe a physical polygon.
// Rendering already refuses that input. Its derived slab/wall consumers must likewise ignore
// it, rather than crashing unrelated floor geometry or inventing a contact.
const invalidOutlines: [string, [number, number][]][] = [
  [
    'coincident corners',
    [
      [0, 0],
      [0, 0],
      [0, 0],
    ],
  ],
  [
    'zero-area line',
    [
      [0, 0],
      [1, 0],
      [2, 0],
    ],
  ],
  [
    'self-crossing boundary',
    [
      [-1, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
    ],
  ],
]

describe('invalid saved gen-2 shapes do not break other scene geometry', () => {
  for (const [label, polygon] of invalidOutlines) {
    test(label, () => {
      const site = SiteNode.parse({})
      const building = BuildingNode.parse({ parentId: site.id })
      const level = LevelNode.parse({ parentId: building.id, level: 0, height: 3 })
      const slab = SlabNode.parse({
        parentId: level.id,
        elevation: 0.1,
        polygon: [
          [-5, -5],
          [5, -5],
          [5, 5],
          [-5, 5],
        ],
      })
      const wall = WallNode.parse({ parentId: level.id, start: [-3, 0], end: [3, 0], height: 2 })
      const rock = RockNode.parse({ parentId: site.id, gen: 2, polygon, height: 2.4 })
      const nodes = {
        [site.id]: { ...site, children: [building.id, rock.id] },
        [building.id]: { ...building, children: [level.id] },
        [level.id]: { ...level, children: [slab.id, wall.id] },
        [slab.id]: slab,
        [wall.id]: wall,
        [rock.id]: rock,
      }
      const span = { footY: -0.3, topY: 2.4 }
      expect(planRock(rock).problem).not.toBeNull()
      expect(buildRock(rock)).toMatchObject({ near: null, far: null })
      expect(rockSlabHoles(slab, nodes)).toEqual([])
      expect(footprintBetween(rock, span, 0, 2)).toEqual([])
      expect(wallContacts(rock, span, building, level, nodes, [wall])).toEqual([])

      const valid = RockNode.parse({
        parentId: site.id,
        gen: 2,
        height: 2.4,
        polygon: [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ],
      })
      const withoutInvalid = { ...nodes, [valid.id]: valid }
      delete withoutInvalid[rock.id]
      const expected = rockSlabHoles(slab, withoutInvalid)
      expect(expected.length).toBeGreaterThan(0)
      expect(footprintBetween(valid, span, 0, 2).length).toBeGreaterThan(0)
      expect(wallContacts(valid, span, building, level, withoutInvalid, [wall])).toHaveLength(1)
      expect(rockSlabHoles(slab, { ...withoutInvalid, [rock.id]: rock })).toEqual(expected)
    })
  }
})
