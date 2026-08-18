import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  clearSceneHistory,
  createSceneApi,
  LeanToExtensionNode,
  LevelNode,
  type SceneCommit,
  subscribeSceneCommits,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { createLeanToAssembly, leanToCornerPostIndex, managedLeanToPostIndex } from './assembly'
import { initializeLeanToExtensionSync } from './system'

type RafFn = (callback: (time: number) => void) => number
;(globalThis as unknown as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= (
  callback,
) => {
  callback(0)
  return 0
}
;(globalThis as unknown as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??=
  () => {}

let stopSync = () => {}

describe('lean-to scene commit boundary', () => {
  beforeEach(() => {
    const level = LevelNode.parse({ id: 'level_lean_commit', level: 0 })
    const wall = WallNode.parse({
      id: 'wall_lean_commit',
      parentId: level.id,
      start: [0, 0],
      end: [6, 0],
    })
    const leanTo = LeanToExtensionNode.parse({
      id: 'leanto_commit',
      parentId: wall.id,
      autoSpan: false,
      position: [3, 0, 0.05],
    })
    const assembly = createLeanToAssembly(leanTo)
    const nodes = Object.fromEntries(
      [
        level,
        { ...wall, children: [assembly.extension.id] },
        assembly.extension,
        ...assembly.children,
      ].map((node) => [node.id, node]),
    ) as Record<AnyNodeId, AnyNode>
    useScene.setState({
      collections: {},
      dirtyNodes: new Set(),
      materials: {},
      nodes,
      readOnly: false,
      rootNodeIds: [level.id],
    } as never)
    clearSceneHistory()
    stopSync = initializeLeanToExtensionSync(createSceneApi(useScene))
  })

  afterEach(() => stopSync())

  test('includes a projection edit and managed roof resize in one commit', () => {
    const commits: SceneCommit[] = []
    const stopCommits = subscribeSceneCommits((commit) => commits.push(commit))
    const leanTo = Object.values(useScene.getState().nodes).find(
      (node): node is LeanToExtensionNode => node.type === 'lean-to-extension',
    )!
    const roof = useScene.getState().nodes[leanTo.children[0] as AnyNodeId]!
    const segmentId = roof.type === 'roof' ? (roof.children[0] as AnyNodeId) : ('' as AnyNodeId)

    useScene.getState().updateNode(leanTo.id as AnyNodeId, { projection: 4 })

    expect(commits).toHaveLength(1)
    expect(commits[0]?.current.nodes[segmentId]?.type).toBe('roof-segment')
    expect((commits[0]?.current.nodes[segmentId] as { depth: number }).depth).toBeCloseTo(4.27)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    stopCommits()
  })

  test('preserves managed post rotation while parent edits still update its height', () => {
    const leanTo = Object.values(useScene.getState().nodes).find(
      (node): node is LeanToExtensionNode => node.type === 'lean-to-extension',
    )!
    const post = leanTo.children
      .map((childId) => useScene.getState().nodes[childId as AnyNodeId])
      .find((node): node is Extract<AnyNode, { type: 'column' }> => node?.type === 'column')!

    useScene.getState().updateNode(post.id as AnyNodeId, {
      rotation: Math.PI,
      supportStyle: 'k-brace',
    })
    const rotatedPost = useScene.getState().nodes[post.id as AnyNodeId] as typeof post
    expect(rotatedPost.rotation).toBe(Math.PI)
    expect(rotatedPost.supportStyle).toBe('k-brace')
    const heightBeforeParentEdit = rotatedPost.height

    useScene.getState().updateNode(leanTo.id as AnyNodeId, { projection: 4 })

    const postAfterParentEdit = useScene.getState().nodes[post.id as AnyNodeId] as typeof post
    expect(postAfterParentEdit.rotation).toBe(Math.PI)
    expect(postAfterParentEdit.supportStyle).toBe('k-brace')
    expect(postAfterParentEdit.height).not.toBe(heightBeforeParentEdit)
  })

  test('preserves the resolved free wall span across commit synchronization', () => {
    stopSync()
    const level = LevelNode.parse({ id: 'level_shared_wall', level: 0 })
    const wall = WallNode.parse({
      id: 'wall_shared_span',
      parentId: level.id,
      start: [0, 0],
      end: [6, 0],
    })
    const existing = LeanToExtensionNode.parse({
      id: 'leanto_existing_span',
      parentId: wall.id,
      autoSpan: false,
      position: [1, 0, 0.05],
      span: 2,
      leftOverhang: 0,
      rightOverhang: 0,
    })
    const candidate = LeanToExtensionNode.parse({
      id: 'leanto_remaining_span',
      parentId: wall.id,
      autoSpan: true,
      position: [4, 0, 0.05],
      span: 4,
      leftOverhang: 0,
      rightOverhang: 0,
    })
    const existingAssembly = createLeanToAssembly(existing)
    const candidateAssembly = createLeanToAssembly(candidate)
    const nodes = Object.fromEntries(
      [
        level,
        { ...wall, children: [existing.id, candidate.id] },
        existingAssembly.extension,
        ...existingAssembly.children,
        candidateAssembly.extension,
        ...candidateAssembly.children,
      ].map((node) => [node.id, node]),
    ) as Record<AnyNodeId, AnyNode>
    useScene.setState({
      collections: {},
      dirtyNodes: new Set(),
      materials: {},
      nodes,
      readOnly: false,
      rootNodeIds: [level.id],
    } as never)
    clearSceneHistory()
    stopSync = initializeLeanToExtensionSync(createSceneApi(useScene))

    useScene.getState().updateNode(candidate.id as AnyNodeId, { projection: 3 })

    const committed = useScene.getState().nodes[candidate.id as AnyNodeId]
    expect(committed?.type).toBe('lean-to-extension')
    if (committed?.type !== 'lean-to-extension') return
    expect(committed.position[0]).toBeCloseTo(4, 6)
    expect(committed.span).toBeCloseTo(4, 6)
  })

  test('synchronizes a complete corner joint after two extensions become neighbors', () => {
    stopSync()
    const level = LevelNode.parse({ id: 'level_corner_sync', level: 0 })
    const wallA = WallNode.parse({
      id: 'wall_corner_sync_a',
      parentId: level.id,
      start: [0, 0],
      end: [4, 0],
    })
    const wallB = WallNode.parse({
      id: 'wall_corner_sync_b',
      parentId: level.id,
      start: [4, 0],
      end: [4, -4],
    })
    const leanToA = LeanToExtensionNode.parse({
      id: 'leanto_corner_sync_a',
      parentId: wallA.id,
      position: [2, 0, 0.05],
      span: 4,
      leftOverhang: 0,
      rightOverhang: 0,
    })
    const leanToB = LeanToExtensionNode.parse({
      id: 'leanto_corner_sync_b',
      parentId: wallB.id,
      position: [2, 0, 0.05],
      span: 4,
      leftOverhang: 0,
      rightOverhang: 0,
    })
    const assemblyA = createLeanToAssembly(leanToA)
    const assemblyB = createLeanToAssembly(leanToB)
    const nodes = Object.fromEntries(
      [
        { ...level, children: [wallA.id, wallB.id] },
        { ...wallA, children: [leanToA.id] },
        { ...wallB, children: [leanToB.id] },
        assemblyA.extension,
        ...assemblyA.children,
        assemblyB.extension,
        ...assemblyB.children,
      ].map((node) => [node.id, node]),
    ) as Record<AnyNodeId, AnyNode>
    useScene.setState({
      collections: {},
      dirtyNodes: new Set(),
      materials: {},
      nodes,
      readOnly: false,
      rootNodeIds: [level.id],
    } as never)
    clearSceneHistory()
    stopSync = initializeLeanToExtensionSync(createSceneApi(useScene))

    const syncedNodes = useScene.getState().nodes
    const syncedA = syncedNodes[leanToA.id as AnyNodeId]
    const syncedB = syncedNodes[leanToB.id as AnyNodeId]
    expect(syncedA?.type).toBe('lean-to-extension')
    expect(syncedB?.type).toBe('lean-to-extension')
    if (syncedA?.type !== 'lean-to-extension' || syncedB?.type !== 'lean-to-extension') return
    expect(syncedA.rightEndCondition).toBe('joined')
    expect(syncedB.leftEndCondition).toBe('joined')
    expect(syncedA.metadata).toMatchObject({
      leanToCornerJoints: { right: { gutterMitre: Math.PI / 4 } },
    })
    expect(syncedB.metadata).toMatchObject({
      leanToCornerJoints: { left: { gutterMitre: Math.PI / 4 } },
    })

    const roofA = syncedA.children
      .map((id) => syncedNodes[id as AnyNodeId])
      .find((node) => node?.type === 'roof')
    const segmentA =
      roofA?.type === 'roof'
        ? roofA.children
            .map((id) => syncedNodes[id as AnyNodeId])
            .find((node) => node?.type === 'roof-segment')
        : undefined
    const gutterA =
      segmentA?.type === 'roof-segment'
        ? segmentA.children
            .map((id) => syncedNodes[id as AnyNodeId])
            .find((node) => node?.type === 'gutter')
        : undefined
    expect(segmentA).toMatchObject({ shedOpenEndSides: ['right'] })
    expect(gutterA?.metadata).toMatchObject({
      leanToGutterMitres: { left: 0, right: Math.PI / 4 },
    })

    const cornerPosts = [...syncedA.children, ...syncedB.children]
      .map((id) => syncedNodes[id as AnyNodeId])
      .filter((node) => {
        if (node?.type !== 'column') return false
        const index = managedLeanToPostIndex(node)
        return index === leanToCornerPostIndex('left') || index === leanToCornerPostIndex('right')
      })
    expect(cornerPosts).toHaveLength(1)
  })
})
