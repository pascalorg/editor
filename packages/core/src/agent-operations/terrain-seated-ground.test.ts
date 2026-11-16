import { describe, expect, test } from 'bun:test'
import { levelBaseElevationAt } from '../lib/terrain-support-query'
import type { AnyNode, StairNode } from '../schema'
import { levelPlaneWorldY } from '../services/storey'
import { stairBaseElevation } from '../systems/stair/stair-base-elevation'
import { GROUNDS, groundAt, runTool, slopedLot } from './__fixtures__/sloped-lots'

/*
 * A house seated on a slope (set_ground_level moves the building in height) is still carried by the
 * ground: what stands outside its slab on the ground level (outside steps, a fence, a post) reads
 * the terrain, as it does while the building stands at y = 0.
 */

type Nodes = Record<string, AnyNode>

/** Outside steps with their foot 4 m in front of the house; the gap between that foot and the ground. */
function stepsFootGap(nodes: Nodes): number {
  const after = runTool(nodes, 'add_steps', { x: 0, z: 8, rise: 0.5, rotation: 180 }).nodes
  const stair = Object.values(after).find((node): node is StairNode => node.type === 'stair')
  if (!stair) throw new Error('no steps')
  const plane = levelPlaneWorldY(after, 'level_ground') ?? 0
  const building = after.building_house as AnyNode & { position: [number, number, number] }
  const foot = plane + stairBaseElevation(stair, after, 'level_ground')
  return foot - groundAt(after, building.position[0], building.position[2] + 8)
}

describe('a seated house is carried by the ground', () => {
  const lots = [
    { name: 'a lot falling to the rear', ground: GROUNDS.fallToRear, movedBy: -1 },
    { name: 'a lot rising to the rear', ground: GROUNDS.riseToRear, movedBy: 1 },
  ]
  for (const { name, ground, movedBy } of lots) {
    // Skipped in this cut: it needs add_steps (outside steps, a sibling of terrain), which this PR does not carry.
    test.skip(`${name}: outside steps stand on the ground before and after set_ground_level`, () => {
      const built = slopedLot({ ground })
      expect(stepsFootGap(built)).toBeCloseTo(0, 2)
      const seated = runTool(built, 'set_ground_level', { levelId: 'level_ground' })
      expect(seated.result.movedBuildingBy as number).toBeCloseTo(movedBy, 1)
      expect(stepsFootGap(seated.nodes)).toBeCloseTo(0, 2)
    })
  }

  test('the level base of a seated ground level is the ground, measured from its own plane', () => {
    const seated = runTool(slopedLot({ ground: GROUNDS.fallToRear }), 'set_ground_level', {
      levelId: 'level_ground',
    }).nodes
    const plane = levelPlaneWorldY(seated, 'level_ground') ?? 0
    expect(plane).toBeCloseTo(-1, 1)
    expect(plane + levelBaseElevationAt(seated, 'level_ground', 0, 8)).toBeCloseTo(
      groundAt(seated, 0, 8),
      6,
    )
  })
})
