import { describe, expect, test } from 'bun:test'
import { BuildingNode, CeilingNode, LevelNode, SlabNode } from '@pascal-app/core'
import { resolveCeilingDraftElevation } from './draft-elevation'

const polygon: Array<[number, number]> = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
]

function fixture() {
  const building = BuildingNode.parse({
    id: 'building_draft',
    children: ['level_lower', 'level_upper'],
  })
  const lower = LevelNode.parse({
    id: 'level_lower',
    parentId: building.id,
    level: 0,
    height: 3.2,
    baseElevation: 1,
  })
  const upper = LevelNode.parse({
    id: 'level_upper',
    parentId: building.id,
    level: 1,
    height: 3,
    children: ['slab_cover'],
  })
  const slab = SlabNode.parse({
    id: 'slab_cover',
    parentId: upper.id,
    polygon,
    elevation: 0,
    thickness: 0.3,
  })
  return {
    lower,
    upper,
    nodes: Object.fromEntries([building, lower, upper, slab].map((node) => [node.id, node])),
  }
}

describe('ceiling draft elevation', () => {
  test('follows the covering slab and adds the level base exactly once', () => {
    const { lower, nodes } = fixture()
    const draft = CeilingNode.parse({ parentId: lower.id, polygon })
    const result = resolveCeilingDraftElevation(draft, nodes)
    expect(result.baseY).toBe(1)
    expect(result.height).toBeCloseTo(2.89)
    expect(result.elevation).toBeCloseTo(3.89)
  })

  test('keeps a lower preset height and clamps a preset above the available space', () => {
    const { lower, nodes } = fixture()
    expect(
      resolveCeilingDraftElevation({ parentId: lower.id, polygon, height: 2 }, nodes).elevation,
    ).toBe(3)
    expect(
      resolveCeilingDraftElevation({ parentId: lower.id, polygon, height: 8 }, nodes).height,
    ).toBeCloseTo(2.89)
  })

  test('resolves an upper-floor draft independently of the pointed surface height', () => {
    const { upper, nodes } = fixture()
    const result = resolveCeilingDraftElevation({ parentId: upper.id, polygon }, nodes)
    expect(result.baseY).toBeCloseTo(4.2)
    expect(result.elevation).toBeCloseTo(7.19)
  })
})
