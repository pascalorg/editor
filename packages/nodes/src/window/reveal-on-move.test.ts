import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  clearSceneHistory,
  LevelNode,
  nodeRegistry,
  registerNode,
  runAsSceneCommitAuthor,
  type SceneCommit,
  subscribeSceneCommits,
  useScene,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import { commitEditCandidates } from '@pascal-app/viewer'
import { builtinPlugin } from '../index'

/*
 * A window or door moved along its wall replays (a quick re-cut, so Follow looks at it); what the
 * structure reconciler repositions when a wall moves is its own write and plays nothing.
 */

// The store settles a commit on a frame: here a frame is a tick.
globalThis.requestAnimationFrame ??= ((callback: FrameRequestCallback) =>
  setTimeout(() => callback(0), 0) as unknown as number) as typeof requestAnimationFrame
globalThis.cancelAnimationFrame ??= ((id: number) =>
  clearTimeout(id as unknown as ReturnType<typeof setTimeout>)) as typeof cancelAnimationFrame

let restore: () => void = () => {}
beforeAll(() => {
  restore = nodeRegistry._snapshot()
  nodeRegistry._reset()
  for (const definition of builtinPlugin.nodes ?? []) registerNode(definition)
})
afterAll(() => restore())

const previous = useScene.getState()

function house() {
  const building = BuildingNode.parse({ id: 'building_m' })
  const level = LevelNode.parse({ id: 'level_m', parentId: building.id, level: 0 })
  const wall = WallNode.parse({
    id: 'wall_m',
    parentId: level.id,
    start: [0, 0],
    end: [8, 0],
    frontSide: 'interior',
    backSide: 'exterior',
  })
  const window = WindowNode.parse({
    id: 'window_m',
    parentId: wall.id,
    wallId: wall.id,
    position: [6, 1.2, 0],
    width: 1,
    height: 1,
  })
  building.children = [level.id]
  level.children = [wall.id]
  wall.children = [window.id]
  useScene
    .getState()
    .setScene(
      Object.fromEntries([building, level, wall, window].map((node) => [node.id, node as AnyNode])),
      [building.id],
    )
  clearSceneHistory()
  return { wall, window }
}

async function agentCommit(write: () => void): Promise<SceneCommit> {
  const commits: SceneCommit[] = []
  const stop = subscribeSceneCommits((commit) => {
    if (commit.author === 'agent') commits.push(commit)
  })
  runAsSceneCommitAuthor('agent', write)
  for (let tick = 0; tick < 40 && commits.length === 0; tick += 1)
    await new Promise((resolve) => setTimeout(resolve, 10))
  stop()
  const commit = commits[0]
  if (!commit) throw new Error('The agent commit was not announced')
  return commit
}

describe('a window moved along its wall', () => {
  test('replays when the agent moves it', async () => {
    const { window } = house()
    const commit = await agentCommit(() =>
      useScene.getState().updateNode(window.id as AnyNodeId, { position: [2, 1.2, 0] } as never),
    )
    expect(commitEditCandidates(commit, 'full').map((candidate) => candidate.id)).toEqual([
      window.id,
    ])
    useScene.setState(previous)
  })

  test('does not replay because its wall moved: its place along the wall is the same', async () => {
    const { wall, window } = house()
    const moved = await agentCommit(() =>
      useScene.getState().updateNode(wall.id as AnyNodeId, { start: [1, 0] } as never),
    )
    const ids = commitEditCandidates(moved, 'full').map((candidate) => candidate.id)
    expect(ids).toContain(wall.id)
    expect(ids).not.toContain(window.id)
    useScene.setState(previous)
  })

  test('is not moved by a wall shortened under it: only the wall replays', async () => {
    const { wall, window } = house()
    const shortened = await agentCommit(() =>
      useScene.getState().updateNode(wall.id as AnyNodeId, { end: [4, 0] } as never),
    )
    const ids = commitEditCandidates(shortened, 'full').map((candidate) => candidate.id)
    // Main's structure leaves the window where it was: nothing moved it, so it plays nothing.
    expect(shortened.current.nodes[window.id as AnyNodeId]).toBe(
      shortened.before.nodes[window.id as AnyNodeId],
    )
    expect(ids).toContain(wall.id)
    expect(ids).not.toContain(window.id)
    useScene.setState(previous)
  })
})
