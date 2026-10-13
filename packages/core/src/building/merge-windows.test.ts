import { describe, expect, test } from 'bun:test'
import { type AnyNode, LevelNode, WallNode, WindowNode } from '../schema'
import { MERGE_GAP_M, windowMergeOffer } from './merge-windows'

// The Merge windows button: offered when exactly two windows are selected, disabled with the
// reason when they cannot join, and silent for any other selection.

const nodes = (extra: AnyNode[] = []) => {
  const a = WallNode.parse({
    id: 'wall_m',
    parentId: 'level_m',
    start: [0, 0],
    end: [8, 0],
    height: 2.5,
  })
  const level = LevelNode.parse({ id: 'level_m', children: [a.id] })
  return Object.fromEntries([level, a, ...extra].map((node) => [node.id, node])) as Record<
    string,
    AnyNode
  >
}
const window = (id: string, x: number, width = 1) =>
  WindowNode.parse({
    id,
    parentId: 'wall_m',
    wallId: 'wall_m',
    position: [x, 1.25, 0],
    width,
    height: 1.5,
  })

describe('windowMergeOffer', () => {
  const scene = nodes([window('window_a', 1), window('window_b', 2.2), window('window_far', 6)])

  test('is nothing unless exactly two windows are selected', () => {
    expect(windowMergeOffer(scene, [])).toBeNull()
    expect(windowMergeOffer(scene, ['window_a'])).toBeNull()
    expect(windowMergeOffer(scene, ['window_a', 'window_b', 'window_far'])).toBeNull()
    expect(windowMergeOffer(scene, ['window_a', 'wall_m'])).toBeNull()
    expect(windowMergeOffer(scene, ['window_a', 'missing'])).toBeNull()
  })

  test('is offered with the merge, no refusal, for two windows that can join', () => {
    expect(windowMergeOffer(scene, ['window_a', 'window_b'])).toMatchObject({
      merge: { kind: 'same-wall', windowIds: ['window_a'] },
      refusal: null,
    })
  })

  test('is offered with the refusal, for the panel to word, for two that cannot', () => {
    const refusal = windowMergeOffer(scene, ['window_a', 'window_far'])?.refusal

    expect(refusal?.code).toBe('windows_not_adjacent')
    expect(refusal?.details).toMatchObject({ limit: MERGE_GAP_M })
  })
})
