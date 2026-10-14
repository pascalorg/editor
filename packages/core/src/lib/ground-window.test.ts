import { describe, expect, test } from 'bun:test'
import type { AnyNode, AnyNodeId } from '../schema'
import { BuildingNode, LevelNode, SiteNode, SlabNode } from '../schema'
import hillside from './__fixtures__/owner-hillside-grade.json'
import { levelGradeStanding } from './grade-standing'
import { buildingGroundBox, levelGroundBox, terrainBetweenEyeAndBox } from './ground-window'
import { encodeTerrainField } from './terrain-codec'
import { createTerrainField } from './terrain-field'

// The owner's hillside house (14 Oct), trimmed to site/building/levels/slabs: a 6 m plateau
// on the street side (-z) past the walls, the pad under the house flat at 0.
const nodes = hillside.nodes as unknown as Record<AnyNodeId, AnyNode>
const levelByName = (name: string) =>
  Object.values(nodes).find((node) => node.type === 'level' && node.name === name)

describe('the ground window’s boxes', () => {
  test('a level’s box is its plate’s extent, floor to ceiling', () => {
    const garden = levelByName('Garden level · walk-out')
    const box = garden && levelGroundBox(nodes, garden.id)
    expect(box?.min).toEqual([-6.15, 0.15, -7.15])
    expect(box?.max[0]).toBe(6.15)
    expect(box?.max[2]).toBe(7.15)
    expect(box?.max[1]).toBeCloseTo(0.15 + 2.85, 6)
  })

  test('the building’s box wraps every level, attic roof plate to garden plate', () => {
    const box = buildingGroundBox(nodes)
    expect(box?.min[1]).toBeCloseTo(0.15, 6)
    // Garden 2.85 + living 2.85 + street 2.65 under the attic's 5.19 m storey, on its 0.2 plate.
    expect(box?.max[1]).toBeCloseTo(8.35 + 0.2 + 5.19, 2)
    expect(box?.min[0]).toBe(-6.15)
  })

  test('an id that is no level has no box', () => {
    expect(levelGroundBox(nodes, 'level_missing')).toBeNull()
  })
})

describe('terrainBetweenEyeAndBox', () => {
  const garden = levelByName('Garden level · walk-out')
  const box = garden && levelGroundBox(nodes, garden.id)

  test('from the street side the plateau stands between the eye and the garden level', () => {
    expect(box && terrainBetweenEyeAndBox(nodes, [0, 7, -20], box)).toBe(true)
  })

  test('from the garden side nothing stands in the way', () => {
    expect(box && terrainBetweenEyeAndBox(nodes, [0, 3, 20], box)).toBe(false)
  })

  test('from high over the house itself the sight lines drop inside the footprint', () => {
    expect(box && terrainBetweenEyeAndBox(nodes, [0, 30, -2], box)).toBe(false)
  })

  test('an eye inside the box looks out, never through a window', () => {
    expect(box && terrainBetweenEyeAndBox(nodes, [0, 1.5, 0], box)).toBe(false)
  })

  test('a flat site never stands in the way', () => {
    const site = Object.values(nodes).find((node) => node.type === 'site')
    const flat = {
      ...nodes,
      [site?.id as AnyNodeId]: { ...site, terrain: undefined },
    } as typeof nodes
    expect(box && terrainBetweenEyeAndBox(flat, [0, 7, -20], box)).toBe(false)
  })
})

describe('a floor only partly buried, seen from above', () => {
  // The review's plate (14 Oct): [-5,5] × [-4,4] at Y 0.2, terrain raised 2 m only inside
  // x 0…4, z -3…3 — the ground covers the eastern rooms and nothing outside the footprint.
  const partlyBuried = () => {
    const field = createTerrainField({ cols: 25, rows: 25, spacing: 1, origin: [-12, -12] })
    const heights = new Int16Array(field.heights)
    for (let row = 0; row < field.rows; row += 1)
      for (let col = 0; col < field.cols; col += 1) {
        const x = field.origin[0] + col * field.spacing
        const z = field.origin[1] + row * field.spacing
        if (x >= 0 && x <= 4 && z >= -3 && z <= 3) heights[row * field.cols + col] = 200
      }
    const list: AnyNode[] = [
      SiteNode.parse({
        id: 'site_a',
        children: ['building_a'],
        terrain: encodeTerrainField({ ...field, heights }),
      }),
      BuildingNode.parse({ id: 'building_a', parentId: 'site_a', children: ['level_0'] }),
      LevelNode.parse({
        id: 'level_0',
        level: 0,
        height: 3,
        parentId: 'building_a',
        children: ['slab_0'],
      }),
      SlabNode.parse({
        id: 'slab_0',
        parentId: 'level_0',
        elevation: 0.2,
        polygon: [
          [-5, -4],
          [5, -4],
          [5, 4],
          [-5, 4],
        ],
      }),
    ]
    return Object.fromEntries(list.map((node) => [node.id, node])) as Record<AnyNodeId, AnyNode>
  }

  test('the ground over its rooms stands between an overhead eye and the floor', () => {
    const scene = partlyBuried()
    expect(levelGradeStanding(scene, 'level_0')).toBe('partly-below-grade')
    const box = levelGroundBox(scene, 'level_0')
    expect(box && terrainBetweenEyeAndBox(scene, [0, 15, 0], box)).toBe(true)
    // From the west too: the mound hides the eastern rooms from any outside eye.
    expect(box && terrainBetweenEyeAndBox(scene, [-15, 1.5, 0], box)).toBe(true)
  })
})
