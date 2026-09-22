import { afterEach, expect, test } from 'bun:test'
import {
  CurtainWallConfig,
  getEffectiveNode,
  subscribeSceneCommits,
  useLiveNodeOverrides,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { getCurtainWallUpdate } from './curtain-wall-panel'
import { createWallPropertyPreview } from './property-preview'

globalThis.requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}

const initial = useScene.getState()
afterEach(() => {
  useLiveNodeOverrides.getState().clearAll()
  useScene.setState(initial)
  useScene.temporal.getState().clear()
})

function setup() {
  const wall = WallNode.parse({ start: [0, 0], end: [6, 0], wallType: 'curtain', curtainWall: {} })
  useScene.setState({ nodes: { [wall.id]: wall }, dirtyNodes: new Set() })
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
  return { wall, edit: createWallPropertyPreview(wall.id) }
}

test('a drag previews without document commits, then commits once and undoes in one step', () => {
  const { wall, edit } = setup()
  let commits = 0
  const stop = subscribeSceneCommits(() => commits++)
  try {
    for (const width of [0.06, 0.08, 0.12])
      edit.preview({ curtainWall: CurtainWallConfig.parse({ mullionWidth: width }) })
    expect(useScene.getState().nodes[wall.id]).toBe(wall)
    expect(getEffectiveNode(wall).curtainWall?.mullionWidth).toBe(0.12)
    expect(useScene.getState().dirtyNodes.has(wall.id)).toBe(true)
    expect(commits).toBe(0)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
    edit.commit()
    expect(commits).toBe(1)
    expect(useLiveNodeOverrides.getState().get(wall.id)).toBeUndefined()
    expect((useScene.getState().nodes[wall.id] as WallNode).curtainWall?.mullionWidth).toBe(0.12)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect((useScene.getState().nodes[wall.id] as WallNode).curtainWall?.mullionWidth).toBe(0.05)
  } finally {
    stop()
  }
})

test('cancel restores the effective wall and preserves unrelated overrides', () => {
  const { wall, edit } = setup()
  useLiveNodeOverrides.getState().set(wall.id, { name: 'Other preview' })
  edit.preview({ thickness: 0.4 })
  edit.cancel()
  expect(getEffectiveNode(wall).thickness).toBe(wall.thickness)
  expect(getEffectiveNode(wall).name).toBe('Other preview')
  expect(useScene.getState().nodes[wall.id]).toBe(wall)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
})

test('a preview cleared by history cannot be recommitted by a later release', () => {
  const { wall, edit } = setup()
  edit.preview({ thickness: 0.4 })
  useLiveNodeOverrides.getState().clearAll()
  edit.commit()
  expect(useScene.getState().nodes[wall.id]).toBe(wall)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
})

test('a discrete curtain setting preserves an in-flight curtain preview', () => {
  const { wall, edit } = setup()
  edit.preview(getCurtainWallUpdate(wall, { glassColor: '#123456' }))
  edit.commit(getCurtainWallUpdate(wall, { framing: 'structural-glazing' }))
  const committed = useScene.getState().nodes[wall.id] as WallNode
  expect(committed.curtainWall?.glassColor).toBe('#123456')
  expect(committed.curtainWall?.framing).toBe('structural-glazing')
})
