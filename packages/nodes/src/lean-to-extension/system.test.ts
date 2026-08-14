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
import { createLeanToAssembly } from './assembly'
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
})
