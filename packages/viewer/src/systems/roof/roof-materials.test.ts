import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  Assembly,
  BuildingNode,
  LevelNode,
  RoofNode,
  WallNode,
} from '@pascal-app/core'
import { levelWallCladdingRef } from './roof-materials'

// A roof on its building's roof level stands on the storey below: its gables are clad like that
// storey's walls, not the bare drywall default.
const stucco = Assembly.parse({
  face: 'exterior',
  layers: [
    { id: 'studs', role: 'structure', thickness: 0.14, core: true, material: 'wood' },
    { id: 'stucco', role: 'finish', thickness: 0.02, material: 'stucco' },
  ],
})

function house(roofOn: 'level_g' | 'level_r') {
  const wall = WallNode.parse({
    id: 'wall_g',
    parentId: 'level_g',
    start: [0, 0],
    end: [6, 0],
    assembly: stucco,
  })
  const roof = RoofNode.parse({ id: 'roof_main', parentId: roofOn })
  const ground = LevelNode.parse({
    id: 'level_g',
    parentId: 'building_h',
    level: 0,
    height: 2.5,
    children: [wall.id, ...(roofOn === 'level_g' ? [roof.id] : [])],
  })
  const roofLevel = LevelNode.parse({
    id: 'level_r',
    parentId: 'building_h',
    level: 1,
    children: roofOn === 'level_r' ? [roof.id] : [],
    metadata: { role: 'roof' },
  })
  const building = BuildingNode.parse({ id: 'building_h', children: [ground.id, roofLevel.id] })
  const nodes: Record<string, AnyNode> = Object.fromEntries(
    [building, ground, roofLevel, wall, roof].map((node) => [node.id, node]),
  )
  return { nodes, roof }
}

describe('levelWallCladdingRef', () => {
  test("a roof on the storey's own level takes its walls' cladding", () => {
    const { nodes, roof } = house('level_g')
    expect(levelWallCladdingRef(nodes, roof)).toBe('library:concrete-stucco')
  })

  test('a roof on the roof level takes the cladding of the storey below', () => {
    const { nodes, roof } = house('level_r')
    expect(levelWallCladdingRef(nodes, roof)).toBe('library:concrete-stucco')
  })
})
