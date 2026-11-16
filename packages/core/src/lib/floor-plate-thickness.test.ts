import { describe, expect, test } from 'bun:test'
import { agentHouse, runSettled } from '../agent-operations/__fixtures__/sloped-lots'
import type { AnyNode, LevelNode, SlabNode } from '../schema'
import { MIN_SLAB_THICKNESS } from '../schema/nodes/slab'
import { filterDerivedNodeWrites } from '../store/derived-node-guard'
import { upperFloorTopWrite } from './floor-foundation-datum'
import { expandFloorIntentChanges } from './floor-intent-changes'

/*
 * A floor plate that stands over a level holds its underside: a new top makes it thicker or
 * thinner. No write may leave it with no thickness (a scene of 13 Nov 2026 stored one at
 * -1.419 m: a floor put back 1.47 m lower came out thinner than nothing).
 */

describe('a new top on a plate that holds its underside', () => {
  const plate = { elevation: 0.3, thickness: 0.2 }
  for (const [name, top, expected] of [
    ['raised: thicker, the underside held', 0.5, { elevation: 0.5, thickness: 0.4 }],
    [
      'lowered within the floor: thinner, the underside held',
      0.15,
      { elevation: 0.15, thickness: 0.05 },
    ],
    ['lowered to the thinnest slab', 0.12, { elevation: 0.12, thickness: MIN_SLAB_THICKNESS }],
    [
      'lowered under the underside: the plate moves whole',
      0.05,
      { elevation: 0.05, thickness: 0.2 },
    ],
    ['lowered far under it', -1.4, { elevation: -1.4, thickness: 0.2 }],
  ] as const)
    test(name, () => {
      expect(upperFloorTopWrite(plate, top)).toEqual(expected)
    })

  test('a plate stored thinner than a slab can be takes a slab thickness when its top is written', () => {
    expect(upperFloorTopWrite({ elevation: 0.05, thickness: -1.4188 }, 0.05)).toEqual({
      elevation: 0.05,
      thickness: 0.05,
    })
  })
})

describe('the main floor of a house with a level under it, lifted by the ground before that level was added', () => {
  let house = agentHouse({ ground: (_x, z) => -0.16 * z })
  house = runSettled(house, 'add_level', { position: 'below', name: 'Lower', height: 2.7 }).nodes
  const lower = Object.values(house).find(
    (node): node is LevelNode => node.type === 'level' && node.name === 'Lower',
  ) as LevelNode
  house = runSettled(house, 'create_room', {
    levelId: lower.id,
    name: 'Rumpus',
    polygon: [
      [-6, -4],
      [6, -4],
      [6, 4],
      [-6, 4],
    ],
  }).nodes
  const main = Object.values(house).find(
    (node): node is SlabNode => node.type === 'slab' && node.parentId === 'level_ground',
  ) as SlabNode

  test('it kept the lift: 0.69 m over its base, 0.05 m thick', () => {
    expect(main.elevation).toBeCloseTo(0.69, 2)
    expect(main.thickness).toBe(0.05)
  })

  for (const top of [0.05, 0.3, 0.66, 0.9])
    test(`its top written to ${top} m: the floor is stored at least ${MIN_SLAB_THICKNESS} m thick, by the intent and by the store`, () => {
      const update = [{ id: main.id, data: { elevation: top } as Partial<AnyNode> }]
      const expanded = expandFloorIntentChanges(house, update).find((each) => each.id === main.id)
        ?.data as Partial<SlabNode>
      expect(expanded.elevation).toBe(top)
      expect(expanded.thickness as number).toBeGreaterThanOrEqual(MIN_SLAB_THICKNESS)
      const kept = filterDerivedNodeWrites(house, { update }).update?.find(
        (each) => each.id === main.id,
      )?.data as Partial<SlabNode>
      expect(kept.elevation).toBe(top)
      expect(kept.thickness as number).toBeGreaterThanOrEqual(MIN_SLAB_THICKNESS)
    })
})
