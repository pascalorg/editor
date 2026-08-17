import { describe, expect, test } from 'bun:test'
import { applySceneDelta, type SceneDelta } from '@pascal-app/core/scene-delta'
import { wouldEmptyStoredScene } from '@/app/api/scenes/[id]/route'

/**
 * The delta endpoint is a second way into the same stored scene, so it needs
 * the same floor the full PUT has: a write that empties a populated scene is
 * refused. The route composes these two, and this pins the composition —
 * `wouldEmptyStoredScene` has to be measured against the graph the delta
 * *produces*, not against the delta, which never looks empty on its own.
 */
const stored = {
  nodes: Object.fromEntries(
    Array.from({ length: 20 }, (_, i) => [`wall_${i}`, { id: `wall_${i}` }]),
  ),
  rootNodeIds: ['site_a'],
}

describe('the delta path refuses what the full PUT refuses', () => {
  test('a delta that deletes every node is caught', () => {
    const delta: SceneDelta = {
      ops: Object.keys(stored.nodes).map((id) => ({ op: 'delete' as const, id })),
    }
    expect(wouldEmptyStoredScene(applySceneDelta(stored, delta), stored)).toBe(true)
  })

  test('a delta that deletes all but one is allowed through', () => {
    const delta: SceneDelta = {
      ops: Object.keys(stored.nodes)
        .slice(1)
        .map((id) => ({ op: 'delete' as const, id })),
    }
    expect(wouldEmptyStoredScene(applySceneDelta(stored, delta), stored)).toBe(false)
  })

  test('an ordinary edit is allowed through', () => {
    const delta: SceneDelta = {
      ops: [{ op: 'set', id: 'wall_0', node: { id: 'wall_0', height: 4 } }],
    }
    expect(wouldEmptyStoredScene(applySceneDelta(stored, delta), stored)).toBe(false)
  })
})
