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
import { usePointAsk } from '../../store/use-point-ask'
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
const previousAsk = usePointAsk.getState()
let shell: Mesh | null = null
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
  usePointAsk.setState({ busy: false })
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
  usePointAsk.setState(previousAsk)
  if (shell) {
    shell.geometry.dispose()
    ;(shell.material as MeshBasicMaterial).dispose()
    shell = null
  }
})

/** The agent's turn is over and the reveal has played its last word. */
function turnOver() {
  usePointAsk.getState().setBusy(false)
  useFollowPascal.getState().endBuild()
}

type FollowSetup = {
  /** Walls all round the target, so no eye sees it clear and Follow falls back to cutaway. */
  enclosed?: boolean
  hideAbove?: boolean
}

async function followItem(
  fromUpper = false,
  mode: 'stacked' | 'solo' = 'stacked',
  setup: FollowSetup = {},
) {
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
  useViewer.setState({ levelMode: mode, hideLevelsAboveSelection: setup.hideAbove ?? true })
  renderer = await create(
    <>
      <group name="scene-renderer" />
      <FollowPascal />
    </>,
  )
  if (setup.enclosed) {
    shell = new Mesh(new BoxGeometry(6, 6, 6), new MeshBasicMaterial({ side: DoubleSide }))
    shell.position.set(2, 0.5, 2)
    renderer.scene.instance.getObjectByName('scene-renderer')!.add(shell)
    shell.updateWorldMatrix(true, true)
  }
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
  // The build is over and no turn is running: the person has the floor they had.
  useFollowPascal.getState().endBuild()
  expect(useViewer.getState().selection).toMatchObject({
    buildingId: building.id,
    levelId: fromUpper ? 'level_upper' : 'level_ground',
  })
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
] as const)('$0 yields the camera, puts the floor back and does not select it again', async (event) => {
  await followItem()
  expect(poses.length).toBeGreaterThan(0)
  expect(useViewer.getState().selection.levelId).toBe('level_upper')
  emitter.emit(event)
  const count = poses.length
  expect(useFollowPascal.getState().paused).toBe(true)
  expect(useViewer.getState().selection.levelId).toBe('level_ground')
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
  expect(useViewer.getState().selection.levelId).toBe('level_ground')
})

// The owner, 12 October, on 3114: after Follow Pascal stopped the walls looked invisible. It had
// fallen back to cutaway when no eye saw its target, selected the floor being built and hidden the
// floors above it, and nothing put them back.
const ENDS: { name: string; end: () => unknown }[] = [
  { name: 'it is switched off', end: () => useFollowPascal.getState().setOn(false) },
  {
    name: 'the person takes the camera',
    end: () => emitter.emit('camera-controls:interaction-start'),
  },
  {
    // The turn ended, and the reveal's last words are over (what it still plays is still followed).
    name: 'the turn is over and the build is over',
    end: turnOver,
  },
]

// The person is on the upper floor in the solo display, with the floors above not hidden; the build
// is on the ground floor, which is not shown, so the reveal speaks at once.
test.each(ENDS)('when $name, the cutaway, the floor and the hidden floors are put back', async ({
  end,
}) => {
  usePointAsk.getState().setBusy(true)
  const { building } = await followItem(true, 'solo', { enclosed: true, hideAbove: false })
  expect(useViewer.getState().wallMode).toBe('cutaway')
  expect(useViewer.getState().levelMode).toBe('stacked')
  expect(useViewer.getState().hideLevelsAboveSelection).toBe(true)
  expect(useViewer.getState().selection.levelId).toBe('level_ground')

  await act(async () => end())

  expect(useViewer.getState().wallMode).toBe('up')
  expect(useViewer.getState().levelMode).toBe('solo')
  expect(useViewer.getState().hideLevelsAboveSelection).toBe(false)
  expect(useViewer.getState().selection).toMatchObject({
    buildingId: building.id,
    levelId: 'level_upper',
  })
})

test('leaving the editor puts them back', async () => {
  await followItem(false, 'stacked', { enclosed: true })
  expect(useViewer.getState().wallMode).toBe('cutaway')
  await renderer!.unmount()
  renderer = null
  expect(useViewer.getState().wallMode).toBe('up')
  expect(useViewer.getState().selection.levelId).toBe('level_ground')
})

test('a wall mode the person picks while Follow is on is theirs, and Follow does not take it back', async () => {
  usePointAsk.getState().setBusy(true)
  await followItem(false, 'stacked', { enclosed: true })
  expect(useViewer.getState().wallMode).toBe('cutaway')
  useViewer.getState().setWallMode('translucent')
  await act(async () => {
    await renderer!.advanceFrames(40, 0.05)
  })
  expect(useViewer.getState().wallMode).toBe('translucent')
  turnOver()
  expect(useViewer.getState().wallMode).toBe('translucent')
  // The floor was Follow's: it goes back all the same.
  expect(useViewer.getState().selection.levelId).toBe('level_ground')
})

test('a floor the person picks while Follow is on is theirs, and Follow does not select over it', async () => {
  usePointAsk.getState().setBusy(true)
  await followItem()
  expect(useViewer.getState().selection.levelId).toBe('level_upper')
  const count = poses.length
  useViewer.getState().setSelection({ levelId: 'level_ground' })
  // The next piece goes on the roof level: above the person's floor, so the reveal speaks at once.
  await act(async () => {
    runAsSceneCommitAuthor('agent', () =>
      useScene
        .getState()
        .createNode(
          ItemNode.parse({ ...useScene.getState().nodes.item_follow, id: 'item_roof' }),
          'level_roof',
        ),
    )
    driver!.tick(40)
    await renderer!.advanceFrames(100, 0.05)
  })
  // Follow went on to the new piece, and the floor stayed the person's.
  expect(poses.length).toBeGreaterThan(count)
  expect(useViewer.getState().selection.levelId).toBe('level_ground')
  turnOver()
  expect(useViewer.getState().selection.levelId).toBe('level_ground')
})

test('what Follow did not change is left as it was when it ends', async () => {
  useViewer.getState().setWallMode('cutaway')
  usePointAsk.getState().setBusy(true)
  const { building } = await followItem(false, 'stacked', { enclosed: true })
  expect(useViewer.getState().selection.levelId).toBe('level_upper')
  turnOver()
  expect(useViewer.getState().wallMode).toBe('cutaway')
  expect(useViewer.getState().hideLevelsAboveSelection).toBe(true)
  expect(useViewer.getState().selection).toMatchObject({
    buildingId: building.id,
    levelId: 'level_ground',
  })
})

// A turn runs several programs, with the agent thinking between them: the build is over for a few
// seconds and then goes on. The view holds steady until the turn is over.
test('a build that is over keeps the view while the turn goes on', async () => {
  usePointAsk.getState().setBusy(true)
  await followItem(false, 'stacked', { enclosed: true })
  useFollowPascal.getState().endBuild()
  expect(useViewer.getState().wallMode).toBe('cutaway')
  expect(useViewer.getState().selection.levelId).toBe('level_upper')
  usePointAsk.getState().setBusy(false)
  expect(useViewer.getState().wallMode).toBe('up')
  expect(useViewer.getState().selection.levelId).toBe('level_ground')
})

// The reveal can play on after the agent's turn: it is still followed, and ends with the build.
test('a turn that ends while the reveal is still playing ends it with the reveal', async () => {
  usePointAsk.getState().setBusy(true)
  await followItem(false, 'stacked', { enclosed: true })
  usePointAsk.getState().setBusy(false)
  expect(useFollowPascal.getState().building).toBe(true)
  expect(useViewer.getState().wallMode).toBe('cutaway')
  useFollowPascal.getState().endBuild()
  expect(useViewer.getState().wallMode).toBe('up')
  expect(useViewer.getState().selection.levelId).toBe('level_ground')
})

// A host that does not say when a turn runs (a standalone editor, a build driven over MCP).
test('without a host that says a turn is running, the build being over ends it', async () => {
  await followItem(false, 'stacked', { enclosed: true })
  expect(useViewer.getState().wallMode).toBe('cutaway')
  useFollowPascal.getState().endBuild()
  expect(useViewer.getState().wallMode).toBe('up')
  expect(useViewer.getState().selection.levelId).toBe('level_ground')
})
