import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNodeDefinition,
  type AnyNodeId,
  BuildingNode,
  type CameraPose,
  emitter,
  ItemNode,
  LevelNode,
  loadPlugin,
  nodeRegistry,
  RoofNode,
  runAsSceneCommitAuthor,
  SlabNode,
  sceneRegistry,
  useScene,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import { isNodeRevealing, startConstructionReveal, useViewer } from '@pascal-app/viewer'
import { act, create } from '@react-three/test-renderer'
import { BoxGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import { followBelowGrade } from '../../lib/below-grade'
import { openingExterior, wallExterior } from '../../lib/follow-pascal-exterior.test-fixture'
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
      {
        kind: 'window',
        schemaVersion: 1,
        schema: WindowNode,
        category: 'structure',
        defaults: () => ({}),
        capabilities: {
          reveal: { phase: 'openings', style: 'cut' },
          revealOnEdit: ['position'],
          exterior: openingExterior,
        },
        geometry: () => null,
      } as unknown as AnyNodeDefinition,
      {
        kind: 'roof',
        schemaVersion: 1,
        schema: RoofNode,
        category: 'structure',
        defaults: () => ({}),
        capabilities: { reveal: { phase: 'roof', style: 'assemble', height: 4 }, exterior: true },
        geometry: () => null,
      } as unknown as AnyNodeDefinition,
      {
        kind: 'wall',
        schemaVersion: 1,
        schema: WallNode,
        category: 'structure',
        defaults: () => ({}),
        capabilities: {
          reveal: { phase: 'structure', style: 'rise' },
          revealOnEdit: ['start', 'end', 'curveOffset'],
          exterior: wallExterior,
        },
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
  for (const id of [...sceneRegistry.nodes.keys()])
    if (id.startsWith('item_') || ['window_east', 'wall_east', 'roof_east'].includes(id))
      sceneRegistry.nodes.delete(id)
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
  /** How long the reveal plays before the test looks (long enough to play the item in, by default). */
  playMs?: number
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
    // The item's renderer has mounted its root, as it does once the reveal lets the item in.
    sceneRegistry.nodes.set('item_follow', new Group())
    // The reveal plays whatever floor the person has: its words come as each piece starts.
    for (let at = 50; at <= (setup.playMs ?? 6000); at += 50) {
      driver!.tick(at)
      await renderer!.advanceFrames(1, 0.02)
    }
    await renderer!.advanceFrames(10, 0.1)
  })
  return { building, target }
}

test.each([
  { fromUpper: false, mode: 'stacked' as const },
  { fromUpper: true, mode: 'solo' as const },
])(
  'following a build on another floor selects it from $mode (fromUpper: $fromUpper)',
  async ({ fromUpper, mode }) => {
    const { building, target } = await followItem(fromUpper, mode)
    expect(useViewer.getState().selection).toMatchObject({
      buildingId: building.id,
      levelId: target.id,
    })
    expect(useViewer.getState().levelMode).toBe('stacked')
    // The finished house is looked at whole: the floors above are shown, until Follow ends.
    expect(useViewer.getState().hideLevelsAboveSelection).toBe(false)
    // The build is over and no turn is running: the person has the floor they had.
    useFollowPascal.getState().endBuild()
    expect(useViewer.getState().selection).toMatchObject({
      buildingId: building.id,
      levelId: fromUpper ? 'level_upper' : 'level_ground',
    })
  },
)

// The owner, 15 October: a person on the ground floor with the floors above hidden did not see the
// animation of a build on the floor above. With Follow off the build still plays on show, and the
// person's own floor is not touched.
test('with Follow off, a build on the floor above plays on show and the person keeps their floor', async () => {
  useFollowPascal.setState({ on: false })
  const { target } = await followItem(false, 'stacked', { playMs: 200 })
  expect(useViewer.getState().selection.levelId).toBe('level_ground')
  expect(useViewer.getState().hideLevelsAboveSelection).toBe(true)
  expect(useViewer.getState().levelsRevealing).toEqual([target.id])
  expect(poses.length).toBe(0)
  await act(async () => {
    for (let at = 250; at <= 9000; at += 50) driver!.tick(at)
  })
  expect(useViewer.getState().levelsRevealing).toEqual([])
  expect(useViewer.getState().selection.levelId).toBe('level_ground')
})

// The build is finished and the camera pulls back to the whole house: the floors above the one it
// worked on are not hidden then, or the finished house would be shown without its upper floors.
test('the pull-back to the finished house shows the floors above, and the person gets their display back', async () => {
  usePointAsk.getState().setBusy(true)
  await followItem(false, 'stacked')
  expect(useViewer.getState().selection.levelId).toBe('level_upper')
  expect(useViewer.getState().hideLevelsAboveSelection).toBe(false)

  turnOver()
  expect(useViewer.getState().selection.levelId).toBe('level_ground')
  expect(useViewer.getState().hideLevelsAboveSelection).toBe(true)
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

test.each(['camera-controls:interaction-start', 'camera-controls:orbit-cw'] as const)(
  '$0 yields the camera, puts the floor back and does not select it again',
  async (event) => {
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
  },
)

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
// is on the ground floor, which the solo display hides: it plays on show, and Follow takes the floor.
test.each(ENDS)(
  'when $name, the cutaway, the floor and the hidden floors are put back',
  async ({ end }) => {
    usePointAsk.getState().setBusy(true)
    const { building } = await followItem(true, 'solo', {
      enclosed: true,
      hideAbove: false,
      playMs: 1500,
    })
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
  },
)

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

// The owner, 15 October: the agent bent an exterior wall and moved a window, and the cutaway hid
// exactly what moved. A change seen from outside is looked at from outdoors, with the walls up; an
// interior one keeps the cutaway; a commit with one of each takes the outside view. What the person
// had is theirs after.
async function followMoves(setup: {
  moveWindow?: boolean
  moveSofa?: boolean
  bendWall?: boolean
  personWall: 'up' | 'cutaway'
}) {
  const building = BuildingNode.parse({ id: 'building_follow' })
  const level = LevelNode.parse({ id: 'level_ground', parentId: building.id, level: 0 })
  const wall = WallNode.parse({
    id: 'wall_east',
    parentId: level.id,
    start: [4, 0],
    end: [4, 4],
    frontSide: 'interior',
    backSide: 'exterior',
  })
  const window = WindowNode.parse({
    id: 'window_east',
    parentId: wall.id,
    wallId: wall.id,
    position: [1, 1.2, 0],
  })
  const sofa = ItemNode.parse({
    id: 'item_sofa',
    parentId: level.id,
    position: [1, 0, 1],
    asset: {
      id: 'sofa',
      category: 'furniture',
      name: 'Sofa',
      thumbnail: '',
      src: '/sofa.glb',
      dimensions: [2, 1, 1],
    },
  })
  building.children = [level.id]
  level.children = [wall.id, sofa.id]
  wall.children = [window.id]
  useScene
    .getState()
    .setScene(
      Object.fromEntries([building, level, wall, window, sofa].map((node) => [node.id, node])),
      [building.id],
    )
  useViewer.getState().setSelection({ buildingId: building.id, levelId: level.id })
  useViewer.setState({ levelMode: 'stacked', hideLevelsAboveSelection: false })
  useViewer.getState().setWallMode(setup.personWall)
  renderer = await create(
    <>
      <group name="scene-renderer" />
      <FollowPascal />
    </>,
  )
  // Walls all round: no eye sees the target, so an interior step falls back to the cutaway.
  shell = new Mesh(new BoxGeometry(6, 6, 6), new MeshBasicMaterial({ side: DoubleSide }))
  shell.position.set(2, 0.5, 2)
  renderer.scene.instance.getObjectByName('scene-renderer')!.add(shell)
  shell.updateWorldMatrix(true, true)
  for (const id of ['window_east', 'item_sofa', 'wall_east'])
    sceneRegistry.nodes.set(id, new Group())
  driver = startConstructionReveal({ reveals: (commit) => commit.author === 'agent' })
  usePointAsk.getState().setBusy(true)
  await act(async () => {
    runAsSceneCommitAuthor('agent', () => {
      if (setup.moveWindow)
        useScene.getState().updateNode('window_east', { position: [2.5, 1.2, 0] } as never)
      if (setup.moveSofa)
        useScene.getState().updateNode('item_sofa', { position: [2.5, 0, 2.5] } as never)
      if (setup.bendWall) useScene.getState().updateNode('wall_east', { curveOffset: 0.6 } as never)
    })
    for (let at = 50; at <= 4000; at += 50) {
      driver!.tick(at)
      await renderer!.advanceFrames(1, 0.02)
    }
    await renderer!.advanceFrames(10, 0.1)
  })
}

test('a window moved on an exterior wall is looked at from outside, and the person keeps their cutaway', async () => {
  await followMoves({ moveWindow: true, personWall: 'cutaway' })
  expect(poses.length).toBeGreaterThan(0)
  // The cutaway the person had is off while the change plays: it would hide the very wall.
  expect(useViewer.getState().wallMode).toBe('up')
  turnOver()
  expect(useViewer.getState().wallMode).toBe('cutaway')
})

test('an exterior wall bent is looked at from outside too', async () => {
  await followMoves({ bendWall: true, personWall: 'cutaway' })
  expect(useViewer.getState().wallMode).toBe('up')
  turnOver()
  expect(useViewer.getState().wallMode).toBe('cutaway')
})

test('a sofa moved inside is looked at through the cutaway, and the person gets their walls back', async () => {
  await followMoves({ moveSofa: true, personWall: 'up' })
  expect(poses.length).toBeGreaterThan(0)
  expect(useViewer.getState().wallMode).toBe('cutaway')
  turnOver()
  expect(useViewer.getState().wallMode).toBe('up')
})

test('a commit with a window and a sofa in it takes the outside view', async () => {
  await followMoves({ moveWindow: true, moveSofa: true, personWall: 'cutaway' })
  expect(useViewer.getState().wallMode).toBe('up')
  turnOver()
  expect(useViewer.getState().wallMode).toBe('cutaway')
})

// The owner, 15 October: the outside view is for edits and moves only. A build is followed as it
// always was: the cutaway once, when no eye sees the target, and never the walls up in between.
test.each([
  { person: 'up' as const, written: ['cutaway'] as string[] },
  // The person already cuts the walls away: a build never puts them up in between.
  { person: 'cutaway' as const, written: [] as string[] },
])(
  'a full build with Follow on (structure, openings, furnishing, roof) keeps the single cutaway, from $person',
  async ({ person, written: expected }) => {
    const building = BuildingNode.parse({ id: 'building_follow' })
    const level = LevelNode.parse({ id: 'level_ground', parentId: building.id, level: 0 })
    building.children = [level.id]
    useScene
      .getState()
      .setScene(Object.fromEntries([building, level].map((node) => [node.id, node])), [building.id])
    useViewer.getState().setSelection({ buildingId: building.id, levelId: level.id })
    useViewer.setState({ levelMode: 'stacked', hideLevelsAboveSelection: false })
    useViewer.getState().setWallMode(person)
    renderer = await create(
      <>
        <group name="scene-renderer" />
        <FollowPascal />
      </>,
    )
    shell = new Mesh(new BoxGeometry(6, 6, 6), new MeshBasicMaterial({ side: DoubleSide }))
    shell.position.set(2, 0.5, 2)
    renderer.scene.instance.getObjectByName('scene-renderer')!.add(shell)
    shell.updateWorldMatrix(true, true)
    const written: string[] = []
    const stop = useViewer.subscribe((state, before) => {
      if (state.wallMode !== before.wallMode) written.push(state.wallMode)
    })
    driver = startConstructionReveal({ reveals: (commit) => commit.author === 'agent' })
    usePointAsk.getState().setBusy(true)
    const wall = WallNode.parse({
      id: 'wall_east',
      parentId: level.id,
      start: [4, 0],
      end: [4, 4],
      frontSide: 'interior',
      backSide: 'exterior',
    })
    const window = WindowNode.parse({
      id: 'window_east',
      parentId: wall.id,
      wallId: wall.id,
      position: [1, 1.2, 0],
    })
    const sofa = ItemNode.parse({
      id: 'item_sofa',
      parentId: level.id,
      position: [1, 0, 1],
      asset: {
        id: 'sofa',
        category: 'furniture',
        name: 'Sofa',
        thumbnail: '',
        src: '/sofa.glb',
        dimensions: [2, 1, 1],
      },
    })
    const roof = RoofNode.parse({ id: 'roof_east', parentId: level.id })
    await act(async () => {
      runAsSceneCommitAuthor('agent', () => {
        useScene.getState().createNode(wall, level.id)
        useScene.getState().createNode(window, wall.id)
        useScene.getState().createNode(sofa, level.id)
        useScene.getState().createNode(roof, level.id)
      })
      for (const id of ['wall_east', 'window_east', 'item_sofa', 'roof_east'])
        sceneRegistry.nodes.set(id, new Group())
      for (let at = 50; at <= 20000; at += 50) {
        driver!.tick(at)
        await renderer!.advanceFrames(1, 0.02)
      }
      await renderer!.advanceFrames(10, 0.1)
    })
    stop()
    // The build was followed (the camera moved) and the walls were cut away once, never put up between.
    expect(poses.length).toBeGreaterThan(0)
    expect(written).toEqual(expected)
    expect(useViewer.getState().wallMode).toBe('cutaway')
    turnOver()
    expect(useViewer.getState().wallMode).toBe(person)
  },
)

// A commit's outside view is its own: an exterior edit another commit queued behind a build, or an
// exterior commit before an interior one, does not take the build's walls up between its steps.
async function followBuildAmid(setup: {
  first: 'build' | 'exterior'
  next: 'exterior' | 'build'
  /** When the second commit lands, on the reveal clock; with the first when absent. */
  nextAtMs?: number
}) {
  const building = BuildingNode.parse({ id: 'building_follow' })
  const level = LevelNode.parse({ id: 'level_ground', parentId: building.id, level: 0 })
  const wall = WallNode.parse({
    id: 'wall_east',
    parentId: level.id,
    start: [4, 0],
    end: [4, 4],
    frontSide: 'interior',
    backSide: 'exterior',
  })
  const window = WindowNode.parse({
    id: 'window_east',
    parentId: wall.id,
    wallId: wall.id,
    position: [1, 1.2, 0],
  })
  const resting = ItemNode.parse({
    id: 'item_sofa_resting',
    parentId: level.id,
    position: [3, 0, 3],
    asset: {
      id: 'sofa',
      category: 'furniture',
      name: 'Sofa',
      thumbnail: '',
      src: '/sofa.glb',
      dimensions: [2, 1, 1],
    },
  })
  building.children = [level.id]
  level.children = [wall.id, resting.id]
  wall.children = [window.id]
  useScene
    .getState()
    .setScene(
      Object.fromEntries([building, level, wall, window, resting].map((node) => [node.id, node])),
      [building.id],
    )
  useViewer.getState().setSelection({ buildingId: building.id, levelId: level.id })
  useViewer.setState({ levelMode: 'stacked', hideLevelsAboveSelection: false })
  useViewer.getState().setWallMode('cutaway')
  renderer = await create(
    <>
      <group name="scene-renderer" />
      <FollowPascal />
    </>,
  )
  shell = new Mesh(new BoxGeometry(6, 6, 6), new MeshBasicMaterial({ side: DoubleSide }))
  shell.position.set(2, 0.5, 2)
  renderer.scene.instance.getObjectByName('scene-renderer')!.add(shell)
  shell.updateWorldMatrix(true, true)
  for (const id of ['window_east', 'wall_east', resting.id])
    sceneRegistry.nodes.set(id, new Group())
  const sofa = ItemNode.parse({
    id: 'item_sofa',
    parentId: level.id,
    position: [1, 0, 1],
    asset: {
      id: 'sofa',
      category: 'furniture',
      name: 'Sofa',
      thumbnail: '',
      src: '/sofa.glb',
      dimensions: [2, 1, 1],
    },
  })
  // Enough furniture that the build plays for seconds, in several steps.
  const buildSofa = () => {
    const pieces = Array.from({ length: 12 }, (_, index) =>
      ItemNode.parse({
        ...sofa,
        id: `item_sofa${index === 0 ? '' : index}`,
        position: [index * 0.3, 0, 1 + (index % 3)],
      }),
    )
    for (const piece of pieces) {
      useScene.getState().createNode(piece, level.id)
      sceneRegistry.nodes.set(piece.id, new Group())
    }
  }
  // A commit with a window and a sofa in it: the window takes it outdoors.
  const moveWindow = () => {
    useScene.getState().updateNode('window_east', { position: [2.5, 1.2, 0] } as never)
    useScene.getState().updateNode(resting.id, { position: [2.5, 0, 2.5] } as never)
  }
  const playing = () =>
    Array.from({ length: 12 }, (_, i) => `item_sofa${i === 0 ? '' : i}`).some((id) =>
      isNodeRevealing(id),
    )
  const upDuringBuild: number[] = []
  let at = 0
  const stop = useViewer.subscribe((state, before) => {
    if (state.wallMode === 'up' && before.wallMode !== 'up' && playing()) upDuringBuild.push(at)
  })
  driver = startConstructionReveal({ reveals: (commit) => commit.author === 'agent' })
  usePointAsk.getState().setBusy(true)
  await act(async () => {
    const commit = (kind: 'build' | 'exterior') =>
      runAsSceneCommitAuthor('agent', kind === 'build' ? buildSofa : moveWindow)
    commit(setup.first)
    if (setup.nextAtMs === undefined) commit(setup.next)
    for (at = 50; at <= 12000; at += 50) {
      if (at === setup.nextAtMs) commit(setup.next)
      driver!.tick(at)
      await renderer!.advanceFrames(1, 0.02)
    }
    await renderer!.advanceFrames(10, 0.1)
  })
  stop()
  return { upDuringBuild }
}

test('an exterior edit queued behind a build does not put the walls up while the build plays', async () => {
  const { upDuringBuild } = await followBuildAmid({ first: 'build', next: 'exterior' })
  expect(poses.length).toBeGreaterThan(0)
  expect(upDuringBuild).toEqual([])
  // The edit itself is looked at from outside once it plays.
  expect(useViewer.getState().wallMode).toBe('up')
})

test('an exterior edit that has played does not take the next build outdoors', async () => {
  const { upDuringBuild } = await followBuildAmid({
    first: 'exterior',
    next: 'build',
    nextAtMs: 3000,
  })
  expect(poses.length).toBeGreaterThan(0)
  expect(upDuringBuild).toEqual([])
  // The walls the edit put up are cut away again for the build, once.
  expect(useViewer.getState().wallMode).toBe('cutaway')
})

// The owner, 20 October, on the underground PR: with Follow Pascal on, the basement's opening
// animation ran again and again while the agent worked. A level below grade is shown with the
// floors above it hidden and the ground open over it; every pull-back to the finished house
// showed the floors above and closed the ground, and the next piece on the basement opened it again.
const basementPiece = (id: string, level: string, at: number) =>
  ItemNode.parse({
    id,
    parentId: level,
    position: [at, 0, 2],
    asset: {
      id: 'chair',
      category: 'furniture',
      name: 'Chair',
      thumbnail: '',
      src: '/chair.glb',
      dimensions: [1, 1, 1],
    },
  })

/**
 * A house seated 2.9 m down: a basement (below grade) under a ground floor, the basement shown the
 * way the level display shows it. `pieces` are agent commits, each at its own time (ms) on one of
 * the two floors; the reveal plays them and Follow follows. What the ground did is returned:
 * every time the level shown lay below grade, or stopped doing so.
 */
async function followBasement(pieces: Array<{ at: number; on: 'basement' | 'ground' }>) {
  const square: Array<[number, number]> = [
    [0, 0],
    [6, 0],
    [6, 6],
    [0, 6],
  ]
  const building = BuildingNode.parse({ id: 'building_follow', position: [0, -2.9, 0] })
  const basement = LevelNode.parse({
    id: 'level_basement',
    parentId: building.id,
    level: -1,
    height: 2.9,
  })
  const ground = LevelNode.parse({ id: 'level_ground', parentId: building.id, level: 0 })
  building.children = [basement.id, ground.id]
  basement.children = ['slab_basement'] as never
  ground.children = ['slab_ground'] as never
  const slabs = [basement, ground].map((level) =>
    SlabNode.parse({
      id: level === basement ? 'slab_basement' : 'slab_ground',
      parentId: level.id,
      polygon: square,
    }),
  )
  useScene
    .getState()
    .setScene(
      Object.fromEntries([building, basement, ground, ...slabs].map((node) => [node.id, node])),
      [building.id],
    )
  useViewer.getState().setSelection({ buildingId: building.id, levelId: basement.id })
  useViewer.setState({ levelMode: 'stacked', hideLevelsAboveSelection: true })
  const stopBelowGrade = followBelowGrade()
  const standing: boolean[] = [useViewer.getState().belowGrade]
  const stopWatching = useViewer.subscribe((state) => {
    if (state.belowGrade !== standing.at(-1)) standing.push(state.belowGrade)
  })
  renderer = await create(
    <>
      <group name="scene-renderer" />
      <FollowPascal />
    </>,
  )
  driver = startConstructionReveal({ reveals: (commit) => commit.author === 'agent' })
  usePointAsk.getState().setBusy(true)
  const end = Math.max(...pieces.map((piece) => piece.at)) + 7000
  await act(async () => {
    for (let at = 0; at <= end; at += 50) {
      for (const [index, piece] of pieces.entries()) {
        if (piece.at !== at) continue
        const node = basementPiece(`item_piece${index}`, `level_${piece.on}`, index * 0.4)
        runAsSceneCommitAuthor('agent', () =>
          useScene.getState().createNode(node, node.parentId as AnyNodeId),
        )
        sceneRegistry.nodes.set(node.id, new Group())
      }
      driver!.tick(at + 1)
      await renderer!.advanceFrames(1, 0.02)
    }
    await renderer!.advanceFrames(10, 0.1)
  })
  stopWatching()
  const result = { standing, shown: useViewer.getState().selection.levelId }
  stopBelowGrade()
  return result
}

test('following furnishing on a basement keeps the floors above hidden and the ground open', async () => {
  const { standing, shown } = await followBasement([
    { at: 0, on: 'basement' },
    { at: 7000, on: 'basement' },
    { at: 14000, on: 'basement' },
  ])
  expect(shown).toBe('level_basement')
  // The basement is below grade from the first moment to the last: the ground is never asked to close.
  expect(standing).toEqual([true])
  expect(useViewer.getState().hideLevelsAboveSelection).toBe(true)
})

test('a piece on the ground floor between two on the basement leaves it once and comes back once', async () => {
  const { standing } = await followBasement([
    { at: 0, on: 'basement' },
    { at: 7000, on: 'ground' },
    { at: 14000, on: 'basement' },
    { at: 21000, on: 'basement' },
  ])
  expect(standing).toEqual([true, false, true])
})
