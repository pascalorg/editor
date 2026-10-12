import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNodeDefinition,
  BuildingNode,
  ItemNode,
  LevelNode,
  loadPlugin,
  nodeRegistry,
  runAsSceneCommitAuthor,
  useScene,
} from '@pascal-app/core'
import { startConstructionReveal, useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import useEditor from '../../store/use-editor'
import useFollowPascal from '../../store/use-follow-pascal'
import { FollowPascal } from './follow-pascal'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
globalThis.requestAnimationFrame ??= () => 0
globalThis.cancelAnimationFrame ??= () => {}

let renderer: Awaited<ReturnType<typeof create>> | null = null
let driver: ReturnType<typeof startConstructionReveal> | null = null
let restoreRegistry = () => {}
const previousScene = useScene.getState()
const previousViewer = useViewer.getState()
const previousEditor = useEditor.getState()
const previousFollow = useFollowPascal.getState()

beforeEach(async () => {
  restoreRegistry = nodeRegistry._snapshot()
  nodeRegistry._reset()
  await loadPlugin({
    id: 'fixture:follow-camera',
    apiVersion: 1,
    nodes: [
      {
        kind: 'item',
        schemaVersion: 1,
        schema: ItemNode,
        category: 'furnish',
        defaults: () => ({}),
        capabilities: { reveal: { phase: 'furnishing', style: 'drop', height: 0.3 } },
        geometry: () => null,
      } as unknown as AnyNodeDefinition,
    ],
  })
  useFollowPascal.setState({ on: true, paused: false, building: false })
  useEditor.setState({ isFirstPersonMode: false })
  useViewer.getState().setCameraMode('perspective')
})

afterEach(async () => {
  driver?.stop()
  driver = null
  await renderer?.unmount()
  renderer = null
  restoreRegistry()
  useScene.setState(previousScene)
  useViewer.setState(previousViewer)
  useEditor.setState(previousEditor)
  useFollowPascal.setState(previousFollow)
})

test.each([
  { fromUpper: false, mode: 'stacked' as const },
  { fromUpper: true, mode: 'solo' as const },
])('following a build on another floor selects it from $mode (fromUpper: $fromUpper)', async ({
  fromUpper,
  mode,
}) => {
  const building = BuildingNode.parse({ id: 'building_follow' })
  const ground = LevelNode.parse({ id: 'level_ground', parentId: building.id, level: 0 })
  const upper = LevelNode.parse({ id: 'level_upper', parentId: building.id, level: 1 })
  const roof = LevelNode.parse({ id: 'level_roof', parentId: building.id, level: 2 })
  building.children = [ground.id, upper.id, roof.id]
  useScene
    .getState()
    .setScene(Object.fromEntries([building, ground, upper, roof].map((node) => [node.id, node])), [
      building.id,
    ])
  const target = fromUpper ? ground : upper
  useViewer.getState().setSelection({
    buildingId: building.id,
    levelId: fromUpper ? upper.id : ground.id,
  })
  useViewer.setState({ levelMode: mode, hideLevelsAboveSelection: true })
  renderer = await create(<FollowPascal />)
  driver = startConstructionReveal({ reveals: (commit) => commit.author === 'agent' })
  await act(async () => {
    runAsSceneCommitAuthor('agent', () =>
      useScene.getState().createNode(
        ItemNode.parse({
          id: 'item_follow',
          position: [2, 0, 2],
          asset: {
            id: 'chair',
            category: 'furniture',
            name: 'Chair',
            thumbnail: '',
            src: '/chair.glb',
            dimensions: [1, 1, 1],
          },
        }),
        target.id,
      ),
    )
    driver!.tick(20)
    await renderer!.advanceFrames(10, 0.1)
  })
  expect(useViewer.getState().selection).toMatchObject({
    buildingId: building.id,
    levelId: target.id,
  })
  expect(useViewer.getState().levelMode).toBe('stacked')
  expect(useViewer.getState().hideLevelsAboveSelection).toBe(true)
  useFollowPascal.getState().endBuild()
  expect(useViewer.getState().selection.levelId).toBe(target.id)
})
