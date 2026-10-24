import { afterEach, describe, expect, test } from 'bun:test'
import { LevelNode } from '../schema'
import {
  getSceneHistoryPauseDepth,
  pauseSceneHistory,
  resumeSceneHistory,
  type SceneCommit,
  subscribeSceneCommits,
} from './history-control'
import { createSceneEnvironment, SceneEnvironmentDisposedError } from './scene-environment'
import useScene, { clearSceneHistory, createSceneStore } from './use-scene'

const liveState = useScene.getState()
afterEach(() => {
  useScene.setState(liveState)
  clearSceneHistory()
})

function sceneWithLevel() {
  const environment = createSceneEnvironment('test')
  const store = createSceneStore(environment)
  const level = LevelNode.parse({ level: 0 })
  store.setState({ nodes: { [level.id]: level }, rootNodeIds: [level.id] })
  store.temporal.getState().clear()
  return { environment, store, level }
}

describe('scene environments', () => {
  test("a second store's writes, commits and history never reach the editor's", () => {
    const commits: SceneCommit[] = []
    const stop = subscribeSceneCommits((commit) => commits.push(commit))
    try {
      const liveBefore = useScene.getState().nodes
      const livePast = useScene.temporal.getState().pastStates
      const { store, level } = sceneWithLevel()
      const ownCommits: SceneCommit[] = []
      store.getState().updateNode(level.id, { name: 'Ground' })
      expect(store.getState().nodes[level.id]?.name).toBe('Ground')
      expect(store.temporal.getState().pastStates).toHaveLength(1)
      expect(useScene.getState().nodes).toBe(liveBefore)
      expect(useScene.temporal.getState().pastStates).toBe(livePast)
      expect(commits).toHaveLength(0)
      // The store's own commit bus is reached from inside its environment.
      const environment = createSceneEnvironment('listener')
      const other = createSceneStore(environment)
      const stopOwn = environment.run(() =>
        subscribeSceneCommits((commit) => ownCommits.push(commit)),
      )
      other.getState().loadScene()
      stopOwn()
      expect(ownCommits).toHaveLength(1)
      expect(commits).toHaveLength(0)
    } finally {
      stop()
    }
  })

  test('pauses and undo are per store', () => {
    const { store, level } = sceneWithLevel()
    pauseSceneHistory(store)
    expect(getSceneHistoryPauseDepth(store)).toBe(1)
    expect(getSceneHistoryPauseDepth()).toBe(0)
    expect(useScene.temporal.getState().isTracking).toBe(true)
    resumeSceneHistory(store)
    store.getState().updateNode(level.id, { name: 'Ground' })
    store.temporal.getState().undo()
    expect(store.getState().nodes[level.id]?.name).toBeUndefined()
  })

  test('a disposed environment refuses every later read and write', () => {
    const { environment, store, level } = sceneWithLevel()
    const { updateNode } = store.getState()
    environment.dispose()
    expect(() => store.getState()).toThrow(SceneEnvironmentDisposedError)
    expect(() => store.setState({ readOnly: true })).toThrow(SceneEnvironmentDisposedError)
    expect(() => updateNode(level.id, { name: 'Late' })).toThrow(SceneEnvironmentDisposedError)
  })
})
