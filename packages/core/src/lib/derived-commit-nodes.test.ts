import { expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, LevelNode, WallNode } from '../schema'
import { DERIVED_WRITER_TOKEN } from '../store/derived-node-guard'
import {
  noteDerivedNodeWrites,
  notifySceneCommit,
  runAsSingleSceneHistoryStep,
  type SceneCommit,
  subscribeSceneCommits,
} from '../store/history-control'
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

// A write the reconciler made that changed nothing, or that a commit never carried, must not ride on the
// next commit: that commit's own edit would be read as derived and presentation would skip it.
const wallId = 'wall_derived_one' as AnyNodeId
const derived = { derivedWriter: DERIVED_WRITER_TOKEN }

function withOneWall(run: (authoredEdit: (name: string) => SceneCommit | undefined) => void) {
  globalThis.requestAnimationFrame ??= (callback) => {
    callback(0)
    return 0
  }
  globalThis.cancelAnimationFrame ??= () => {}
  const previous = useScene.getState()
  useScene.setState({
    nodes: {
      [levelId]: LevelNode.parse({ id: levelId, children: [wallId] }),
      [wallId]: WallNode.parse({
        id: wallId,
        parentId: levelId,
        name: 'North',
        start: [0, 0],
        end: [4, 0],
      }),
    } as Record<AnyNodeId, AnyNode>,
    rootNodeIds: [levelId] as AnyNodeId[],
    collections: {},
    materials: {},
    readOnly: false,
  })
  clearSceneHistory()
  const commits: SceneCommit[] = []
  const unsubscribe = subscribeSceneCommits((commit) => commits.push(commit))
  try {
    run((name) => {
      commits.length = 0
      useScene.getState().updateNodes([{ id: wallId, data: { name } as never }])
      return commits.at(-1)
    })
  } finally {
    unsubscribe()
    useScene.setState(previous)
  }
}

test('a derived update to the value a node already has leaves the next edit authored', () => {
  withOneWall((authoredEdit) => {
    useScene.getState().updateNodes([{ id: wallId, data: { name: 'North' } as never }], derived)
    expect(authoredEdit('South')?.derivedWrites).toBeUndefined()
  })
})

test('a derived delete of a node that is not there leaves the next edit authored', () => {
  withOneWall((authoredEdit) => {
    useScene.getState().deleteNodes(['wall_missing' as AnyNodeId], derived)
    expect(authoredEdit('South')?.derivedWrites).toBeUndefined()
  })
})

test('a history step whose derived writes cancel out leaves the next edit authored', () => {
  withOneWall((authoredEdit) => {
    runAsSingleSceneHistoryStep(useScene, () => {
      useScene.getState().updateNodes([{ id: wallId, data: { name: 'Tmp' } as never }], derived)
      useScene.getState().updateNodes([{ id: wallId, data: { name: 'North' } as never }], derived)
    })
    expect(authoredEdit('South')?.derivedWrites).toBeUndefined()
  })
})

test('a commit that is a no-op takes the writes noted for it with it', () => {
  withOneWall((authoredEdit) => {
    noteDerivedNodeWrites([{ id: wallId, fields: ['name'] }])
    const { nodes, rootNodeIds } = useScene.getState()
    const snapshot = { nodes, rootNodeIds, collections: {}, materials: {}, installedPlugins: [] }
    notifySceneCommit({ origin: 'local', before: snapshot, current: snapshot })
    expect(authoredEdit('South')?.derivedWrites).toBeUndefined()
  })
})

test('a derived write that changes a node is reported, by the fields that changed', () => {
  withOneWall(() => {
    const commits: SceneCommit[] = []
    const unsubscribe = subscribeSceneCommits((commit) => commits.push(commit))
    try {
      useScene
        .getState()
        .updateNodes([{ id: wallId, data: { name: 'North', thickness: 0.2 } as never }], derived)
    } finally {
      unsubscribe()
    }
    const fields = commits.at(-1)?.derivedWrites?.get(wallId) as ReadonlySet<string> | undefined
    expect([...(fields ?? [])]).toEqual(['thickness'])
  })
})

test('a derived delete is noted as the whole node, through applyNodeChanges too', () => {
  withOneWall(() => {
    const commits: SceneCommit[] = []
    const unsubscribe = subscribeSceneCommits((commit) => commits.push(commit))
    try {
      useScene.getState().applyNodeChanges({ delete: [wallId] }, derived)
    } finally {
      unsubscribe()
    }
    expect(commits.at(-1)?.derivedWrites?.get(wallId)).toBe('all')
  })
})
