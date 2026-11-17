import { describe, expect, test } from 'bun:test'
import { isAgentRefusal } from '../agent-tools/refusal'
import { type AnyNode, LevelNode, SlabNode } from '../schema'
import { GROUNDS, groundAt, type Pt, runTool, slopedLot } from './__fixtures__/sloped-lots'

/*
 * grade_around_house `pads`: one pad per level of a split-level house, side by side. Storeys that
 * stand one over the other are not a split level: the upper pad would win everywhere and bury the
 * ground floor under a platform at the upper floor's height.
 */

const upper = (polygon: Pt[]): AnyNode[] => [
  LevelNode.parse({
    id: 'level_upper',
    parentId: 'building_house',
    level: 1,
    name: 'Upper floor',
    height: 2.7,
  }),
  SlabNode.parse({ id: 'slab_upper', parentId: 'level_upper', polygon, elevation: 0.05 }),
]
const refusal = (run: () => unknown) => {
  try {
    run()
  } catch (error) {
    if (isAgentRefusal(error)) return { code: error.code, message: error.message }
    throw error
  }
  return undefined
}
const PADS = { pads: [{ levelId: 'level_ground' }, { levelId: 'level_upper' }] }

describe('grade_around_house: pads are side by side, not stacked', () => {
  test('two storeys one over the other are refused, and the ground is left as it was', () => {
    const house = slopedLot({
      ground: GROUNDS.steep,
      extra: upper([
        [-6, -4],
        [6, -4],
        [6, 4],
        [-6, 4],
      ]),
    })
    const refused = refusal(() => runTool(house, 'grade_around_house', PADS))
    expect(refused?.code).toBe('invalid_input')
    expect(refused?.message).toContain('level_upper')
    expect(refused?.message).toContain('one over the other')
  })

  test('a split level, its upper half beside the lower one, is graded with a pad each', () => {
    // The upper level's floor lies behind the ground floor's plate (z -12 to -4 against -4 to 4):
    // the plan a split level has.
    const house = slopedLot({
      ground: GROUNDS.steep,
      extra: upper([
        [-6, -12],
        [6, -12],
        [6, -4],
        [-6, -4],
      ]),
    })
    const { nodes, result } = runTool(house, 'grade_around_house', PADS)
    expect((result.pads as unknown[]).length).toBe(2)
    expect(groundAt(nodes, 0, 0)).toBeCloseTo(0, 1)
    expect(groundAt(nodes, 0, -8)).toBeCloseTo(2.6, 1)
  })

  test('outlines that share a wall line (the width of a wall) are still side by side', () => {
    const house = slopedLot({
      ground: GROUNDS.steep,
      extra: upper([
        [-6, -12],
        [6, -12],
        [6, -3.8],
        [-6, -3.8],
      ]),
    })
    expect(refusal(() => runTool(house, 'grade_around_house', PADS))).toBeUndefined()
  })
})
