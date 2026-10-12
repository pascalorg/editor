import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNodeDefinition,
  BuildingNode,
  type CameraPose,
  emitter,
  ItemNode,
  LevelNode,
  loadPlugin,
  nodeRegistry,
  runAsSceneCommitAuthor,
  useScene,
} from '@pascal-app/core'
import { startConstructionReveal, useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import { BoxGeometry, DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
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
let poses: CameraPose[] = []
const recordPose = (pose: CameraPose) => poses.push(pose)

beforeEach(async () => {
  poses = []
  emitter.on('camera-controls:apply-pose', recordPose)
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
  emitter.off('camera-controls:apply-pose', recordPose)
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

async function followItem(fromUpper = false, mode: 'stacked' | 'solo' = 'stacked') {
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
  renderer = await create(
    <>
      <group name="scene-renderer" />
      <FollowPascal />
    </>,
  )
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
  return { building, target }
}

test.each([
  { fromUpper: false, mode: 'stacked' as const },
  { fromUpper: true, mode: 'solo' as const },
])('following a build on another floor selects it from $mode (fromUpper: $fromUpper)', async ({
  fromUpper,
  mode,
}) => {
  const { building, target } = await followItem(fromUpper, mode)
  expect(useViewer.getState().selection).toMatchObject({
    buildingId: building.id,
    levelId: target.id,
  })
  expect(useViewer.getState().levelMode).toBe('stacked')
  expect(useViewer.getState().hideLevelsAboveSelection).toBe(true)
  useFollowPascal.getState().endBuild()
  expect(useViewer.getState().selection.levelId).toBe(target.id)
})

test('an obstacle appearing after arrival causes one calm flight to a clear view', async () => {
  await followItem()
  await renderer!.advanceFrames(120, 0.05)
  const before = poses.at(-1)!
  const obstacle = new Mesh(new BoxGeometry(8, 5, 0.5), new MeshBasicMaterial({ side: DoubleSide }))
  obstacle.position.set(before.target[0], before.target[1] + 2.5, before.target[2] + 2)
  renderer!.scene.instance.getObjectByName('scene-renderer')!.add(obstacle)
  obstacle.updateWorldMatrix(true, true)
  const ray = new Raycaster()
  const sees = (pose: CameraPose) => {
    const eye = new Vector3(...pose.position)
    const direction = new Vector3(...pose.target).sub(eye)
    ray.set(eye, direction.clone().normalize())
    ray.far = direction.length() - 0.02
    return ray.intersectObject(obstacle).length === 0
  }
  expect(sees(before)).toBe(false)
  await renderer!.advanceFrames(160, 0.05)
  const after = poses.at(-1)!
  expect(sees(after)).toBe(true)
  expect(after.target[0]).toBeCloseTo(before.target[0], 2)
  expect(after.target[2]).toBeCloseTo(before.target[2], 2)
  const count = poses.length
  await renderer!.advanceFrames(40, 0.05)
  expect(poses.length).toBe(count)
  obstacle.geometry.dispose()
  ;(obstacle.material as MeshBasicMaterial).dispose()
})

test.each([
  'camera-controls:interaction-start',
  'camera-controls:orbit-cw',
] as const)('$0 yields the camera and floor even when another target arrives', async (event) => {
  const { target } = await followItem()
  expect(poses.length).toBeGreaterThan(0)
  emitter.emit(event)
  const count = poses.length
  expect(useFollowPascal.getState().paused).toBe(true)
  await act(async () => {
    runAsSceneCommitAuthor('agent', () =>
      useScene
        .getState()
        .createNode(
          ItemNode.parse({ ...useScene.getState().nodes.item_follow, id: 'item_next' }),
          'level_roof',
        ),
    )
    driver!.tick(40)
    await renderer!.advanceFrames(100, 0.05)
  })
  expect(useFollowPascal.getState().paused).toBe(true)
  expect(poses.length).toBe(count)
  expect(useViewer.getState().selection.levelId).toBe(target.id)
})
