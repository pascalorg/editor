import { expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, LevelNode, WallNode } from '../schema'
import { type SceneCommit, subscribeSceneCommits } from '../store/history-control'
import useScene, { clearSceneHistory } from '../store/use-scene'
import { initSpaceDetectionSync } from './space-detection'

// What the structure reconciler writes while an edit is committed (plates, ceilings, zones) is derived
// from the edit, not authored by it: the commit says so, so presentation can leave it out of an edit's
// own animation.
const levelId = 'level_derived'
const corners: [number, number][] = [
  [0, 0],
  [6, 0],
  [6, 4],
  [0, 4],
]

test('a commit names what the reconciler wrote, and the fields of a node it only touched', () => {
  globalThis.requestAnimationFrame ??= (callback) => {
    callback(0)
    return 0
  }
  globalThis.cancelAnimationFrame ??= () => {}
  const previous = useScene.getState()
  const level = LevelNode.parse({ id: levelId, children: [] })
  useScene.setState({
    nodes: { [levelId]: level } as Record<AnyNodeId, AnyNode>,
    rootNodeIds: [levelId] as AnyNodeId[],
    collections: {},
    materials: {},
    readOnly: false,
  })
  clearSceneHistory()
  const stop = initSpaceDetectionSync(useScene, {
    getState: () => ({ spaces: {}, setSpaces: () => {} }),
  })
  const commits: SceneCommit[] = []
  const unsubscribe = subscribeSceneCommits((commit) => commits.push(commit))
  try {
    const walls = corners.map((start, i) =>
      WallNode.parse({
        id: `wall_derived_${i}`,
        parentId: levelId,
        start,
        end: corners[(i + 1) % corners.length],
      }),
    )
    useScene
      .getState()
      .createNodes(walls.map((node) => ({ node: node as AnyNode, parentId: levelId as AnyNodeId })))
    const commit = commits.at(-1)!
    const writes = commit.derivedWrites ?? new Map()
    // The room's plate is the reconciler's whole: it made it.
    const made = [...writes].filter(
      ([id, fields]) => fields === 'all' && !id.startsWith('wall_derived_'),
    )
    expect(made.length).toBeGreaterThan(0)
    // A wall it only classified the sides of: it wrote those fields, not the wall's line.
    for (const [id, fields] of writes) {
      if (!id.startsWith('wall_derived_') || fields === 'all') continue
      expect(fields.has('start')).toBe(false)
      expect(fields.has('end')).toBe(false)
    }

    // An edit that triggers no reconciliation says nothing is derived.
    commits.length = 0
    useScene
      .getState()
      .updateNodes([{ id: 'wall_derived_0' as AnyNodeId, data: { name: 'North' } as never }])
    expect(commits.at(-1)?.derivedWrites).toBeUndefined()
  } finally {
    unsubscribe()
    stop()
    useScene.setState(previous)
  }
})
