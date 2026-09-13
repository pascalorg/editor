import { describe, expect, test } from 'bun:test'
import { followRoofOf, intentOfRoof, levelsWithWallChanges, type Nodes } from './follow'

const IN = 0.0254

function house(): Record<string, Record<string, unknown>> {
  return {
    level_1: { id: 'level_1', type: 'level', children: ['wall_a', 'wall_b', 'roof_main', 'roof_porch'] },
    wall_a: { id: 'wall_a', type: 'wall', parentId: 'level_1', start: [0, 0], end: [10, 0], thickness: 0.18, height: 2.74, metadata: { roof: { role: 'eave' } } },
    wall_b: { id: 'wall_b', type: 'wall', parentId: 'level_1', start: [10, 0], end: [10, 8], thickness: 0.18, height: 2.74 },
    roof_main: {
      id: 'roof_main',
      type: 'roof',
      parentId: 'level_1',
      children: ['rseg_1'],
      metadata: {
        generatedBy: 'pascal:roof',
        autoRoof: { source: 'pascal:generate', intent: { form: 'gable', pitchInTwelfths: 8, overhangIn: 14, gables: ['left', 'right'] } },
      },
    },
    roof_porch: {
      id: 'roof_porch',
      type: 'roof',
      parentId: 'level_1',
      children: [],
      metadata: { generatedBy: 'pascal:generate', autoRoof: { porch: true } },
    },
  }
}

describe('which roof follows the walls', () => {
  test('the derived house roof, never the porch cover, and not one switched off', () => {
    const nodes = house() as unknown as Nodes
    expect(followRoofOf(nodes, 'level_1')?.id).toBe('roof_main')
    const off = house()
    ;(off.roof_main!.metadata as { autoRoof: Record<string, unknown> }).autoRoof.follow = false
    expect(followRoofOf(off as unknown as Nodes, 'level_1')).toBeNull()
    const handMade = house()
    delete (handMade.roof_main!.metadata as Record<string, unknown>).autoRoof
    expect(followRoofOf(handMade as unknown as Nodes, 'level_1')).toBeNull()
  })

  test("the generator's intent reads back in the engine's terms; the command's options too", () => {
    const nodes = house() as unknown as Nodes
    const intent = intentOfRoof(nodes.roof_main!)
    expect(intent).toMatchObject({ form: 'gable', pitchTwelfths: 8, frontDir: [0, -1] })
    expect(intent?.overhang).toBeCloseTo(14 * IN, 9)
    expect(intent?.gables).toEqual([
      [-1, 0],
      [1, 0],
    ])
    const derived = { id: 'r', type: 'roof', metadata: { autoRoof: { options: { form: 'hip', pitchTwelfths: 5, overhangIn: 18, style: '' } } } }
    expect(intentOfRoof(derived as never)).toMatchObject({ form: 'hip', pitchTwelfths: 5 })
    expect(intentOfRoof({ id: 'x', type: 'roof', metadata: {} } as never)).toBeNull()
  })
})

describe('what counts as a wall change', () => {
  test('a moved, stretched, added or removed wall; not a metadata write', () => {
    const before = house() as unknown as Nodes
    const moved = house()
    moved.wall_a = { ...moved.wall_a!, end: [11, 0] }
    expect(levelsWithWallChanges(before, moved as unknown as Nodes)).toEqual(['level_1'])
    const added = house()
    added.wall_c = { id: 'wall_c', type: 'wall', parentId: 'level_1', start: [0, 8], end: [10, 8], thickness: 0.18, height: 2.74 }
    expect(levelsWithWallChanges(before, added as unknown as Nodes)).toEqual(['level_1'])
    const removed = house()
    delete removed.wall_b
    expect(levelsWithWallChanges(before, removed as unknown as Nodes)).toEqual(['level_1'])
    // the rebuild's own role stamp is not a change — the follow cannot feed itself
    const stamped = house()
    stamped.wall_a = { ...stamped.wall_a!, metadata: { roof: { role: 'gable-end' } } }
    expect(levelsWithWallChanges(before, stamped as unknown as Nodes)).toEqual([])
    expect(levelsWithWallChanges(before, before)).toEqual([])
  })
})
