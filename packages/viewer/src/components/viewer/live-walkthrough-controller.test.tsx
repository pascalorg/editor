import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  DoorNode,
  nodeRegistry,
  SiteNode,
  sceneRegistry,
  useInteractive,
  useScene,
} from '@pascal-app/core'
import {
  createWalkthroughInput,
  GlbScene,
  GlbWalkthroughController,
  LiveWalkthroughController,
  type LiveWalkthroughControllerProps,
  useFirstPersonHud,
  useViewer,
} from '@pascal-app/viewer'
import { useFirstPersonHud as uiHud } from '@pascal-app/viewer/ui'
import { useGLTF } from '@react-three/drei'
import { act, create } from '@react-three/test-renderer'
import {
  AnimationClip,
  BoxGeometry,
  Euler,
  Group,
  Mesh,
  MeshBasicMaterial,
  NumberKeyframeTrack,
  PerspectiveCamera,
} from 'three'

// Exercise the real controller with deterministic frames and pointer/key events, without a browser.
const originalGlobals = new Map(
  ['document', 'window', 'HTMLElement', 'requestAnimationFrame', 'cancelAnimationFrame'].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)],
  ),
)
let documentEvents: EventTarget & {
  activeElement: unknown
  pointerLockElement: unknown
  exitPointerLock: () => void
}
let canvas: HTMLCanvasElement
let pointerLockRequests = 0
let renderer: Awaited<ReturnType<typeof create>> | undefined

beforeEach(() => {
  documentEvents = Object.assign(new EventTarget(), {
    activeElement: null,
    body: { style: {} },
    querySelector: () => null,
    pointerLockElement: null,
    exitPointerLock: () => {
      documentEvents.pointerLockElement = null
      documentEvents.dispatchEvent(new Event('pointerlockchange'))
    },
  })
  const requestAnimationFrame = () => 0
  const cancelAnimationFrame = () => {}
  Object.assign(globalThis, {
    document: documentEvents,
    window: Object.assign(new EventTarget(), {
      requestAnimationFrame,
      cancelAnimationFrame,
      location: { search: '?merge=0&occlusion=0' },
    }),
    HTMLElement: class extends EventTarget {
      static [Symbol.hasInstance](element: unknown) {
        return element === canvas
      }
    },
    requestAnimationFrame,
    cancelAnimationFrame,
  })
  pointerLockRequests = 0
  useViewer.getState().setWalkthroughMode(false)
  useViewer.getState().setWalkthroughInputMode('desktop')
  useFirstPersonHud.getState().reset()
})

afterEach(async () => {
  await renderer?.unmount()
  renderer = undefined
  sceneRegistry.clear()
  useScene.setState({ nodes: {}, rootNodeIds: [] })
  useViewer.getState().setWalkthroughMode(false)
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
})

function key(code: string, type = 'keydown') {
  documentEvents.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { code }))
}

function lock() {
  documentEvents.pointerLockElement = canvas
  documentEvents.dispatchEvent(new Event('pointerlockchange'))
}

async function mount(props: LiveWalkthroughControllerProps = {}) {
  const camera = new PerspectiveCamera(47)
  renderer = await create(<LiveWalkthroughController {...props} />, {
    camera,
    beforeReturn: (element) => {
      canvas = element as HTMLCanvasElement
      configureCanvas(canvas)
    },
  })
  return camera
}

async function enterDrone() {
  await act(async () => {
    useViewer.getState().setWalkthroughMovement('drone')
    useViewer.getState().setWalkthroughMode(true)
  })
}

test('viewer state activates movement, paused freezes it, and deactivation releases the session', async () => {
  const camera = await mount()
  expect(camera.fov).toBe(47)
  await enterDrone()
  expect(camera.fov).toBe(60)
  key('KeyW')
  await frames(20)
  expect(camera.position.z).toBeLessThan(-0.1)
  await renderer!.update(<LiveWalkthroughController paused />)
  const heldPosition = camera.position.clone()
  await frames(20)
  expect(camera.position.equals(heldPosition)).toBe(true)
  await act(async () => useViewer.getState().setWalkthroughMode(false))
  expect(camera.fov).toBe(47)
  await frames(10)
  expect(camera.position.equals(heldPosition)).toBe(true)
})

test('unlock exits by default and calls the host once with walkthrough cleared', async () => {
  const exits: boolean[] = []
  await mount({ onExit: () => exits.push(useViewer.getState().walkthroughMode) })
  await enterDrone()
  lock()
  await act(async () => documentEvents.exitPointerLock())
  expect(exits).toEqual([false])
  expect(useViewer.getState().walkthroughMode).toBe(false)
})

test('Escape while locked exits once even when unlock is delivered immediately', async () => {
  let exits = 0
  await mount({
    onExit: () => {
      exits += 1
    },
  })
  await enterDrone()
  lock()
  await act(async () => key('Escape'))
  expect(exits).toBe(1)
  expect(useViewer.getState().walkthroughMode).toBe(false)
})

test('host FOV ownership and suspended unlock preserve framing until Escape exits', async () => {
  const exits: boolean[] = []
  const camera = await mount({
    externalFov: () => true,
    suspendOnUnlock: true,
    onExit: () => exits.push(useViewer.getState().walkthroughMode),
  })
  await enterDrone()
  expect(camera.fov).toBe(47)
  lock()
  await act(async () => documentEvents.exitPointerLock())
  expect(useViewer.getState().walkthroughMode).toBe(true)
  expect(useViewer.getState().walkthroughSuspended).toBe(true)
  camera.fov = 32
  await act(async () => key('Escape'))
  expect(exits).toEqual([false])
  expect(camera.fov).toBe(32)
})

test('main and UI exports share one HUD store and suppress equivalent updates', () => {
  expect(uiHud).toBe(useFirstPersonHud)
  useFirstPersonHud
    .getState()
    .setHud({ floorLabel: 'Ground', interact: { label: 'door', verb: 'open' } })
  expect(uiHud.getState().floorLabel).toBe('Ground')
  const previous = useFirstPersonHud.getState()
  uiHud.getState().setHud({ interact: { label: 'door', verb: 'open' } })
  expect(useFirstPersonHud.getState()).toBe(previous)
  uiHud.getState().reset()
  expect(useFirstPersonHud.getState().interact).toBeNull()
})

test('the orbit FOV returns when the host gave FOV back before walkthrough ends', async () => {
  let hostOwnsFov = false
  const camera = await mount({ externalFov: () => hostOwnsFov })
  await enterDrone()
  expect(camera.fov).not.toBe(47)
  hostOwnsFov = true
  camera.fov = 32
  hostOwnsFov = false
  lock()
  await act(async () => key('Escape'))
  expect(useViewer.getState().walkthroughMode).toBe(false)
  expect(camera.fov).toBe(47)
})

function configureCanvas(element: HTMLCanvasElement) {
  const events = new EventTarget()
  Object.assign(element, {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
    contains: (target: unknown) => target === element,
    hasAttribute: () => true,
    focus: () => {},
    requestPointerLock: () => {
      pointerLockRequests += 1
    },
  })
}

function ground() {
  const site = SiteNode.parse({ id: 'site_touch' })
  useScene.setState({ nodes: { [site.id]: site }, rootNodeIds: [site.id] })
  sceneRegistry.nodes.set(site.id, new Group())
  sceneRegistry.byType.site!.add(site.id)
}

async function mountWalk(kind: 'live' | 'baked', touch = true) {
  if (touch) useViewer.getState().setWalkthroughInputMode('touch')
  useViewer.getState().setWalkthroughMode(true)
  const camera = new PerspectiveCamera(47)
  camera.position.set(0, 1.65, 0)
  if (kind === 'live') {
    ground()
    renderer = await create(<LiveWalkthroughController />, {
      camera,
      beforeReturn: (element) => {
        canvas = element as HTMLCanvasElement
        configureCanvas(canvas)
      },
    })
  } else {
    const scene = new Group()
    const floor = new Mesh(new BoxGeometry(100, 0.1, 100), new MeshBasicMaterial())
    floor.position.y = -0.05
    floor.userData.kind = 'slab'
    scene.add(floor)
    const url = `walkthrough-fixture-${touch}`
    seedGltf(url, scene)
    renderer = await create(<GlbWalkthroughController url={url} />, {
      camera,
      beforeReturn: (element) => {
        canvas = element as HTMLCanvasElement
        configureCanvas(canvas)
      },
    })
    await act(async () => {
      await frames(1)
    })
  }
  await act(async () => {
    await frames(8)
  })
  return camera
}

for (const kind of ['live', 'baked'] as const) {
  test(`${kind}: touch movement reaches physics, look is consumed once and pitch is clamped`, async () => {
    const camera = await mountWalk(kind)
    const nodes = useScene.getState().nodes
    const input = createWalkthroughInput()
    const start = camera.position.clone()
    input.setMove(1, 0)
    await frames(20)
    expect(camera.position.x).toBeGreaterThan(start.x + 0.1)
    input.setMove(0, 0)
    input.addLook(120, -100_000)
    await frames(1)
    expect(new Euler().setFromQuaternion(camera.quaternion, 'YXZ').y).toBeCloseTo(-0.24)
    expect(new Euler().setFromQuaternion(camera.quaternion, 'YXZ').x).toBeCloseTo(
      Math.PI / 2 - 0.05,
    )
    const orientation = camera.quaternion.clone()
    await frames(2)
    expect(camera.quaternion.equals(orientation)).toBe(true)
    input.addLook(0, 200_000)
    await frames(1)
    expect(new Euler().setFromQuaternion(camera.quaternion, 'YXZ').x).toBeCloseTo(
      -(Math.PI / 2 - 0.05),
    )
    lock()
    await act(async () => documentEvents.exitPointerLock())
    key('KeyP')
    canvas.dispatchEvent(new Event('click'))
    const click = new Event('click')
    Object.defineProperty(click, 'target', { value: canvas })
    documentEvents.dispatchEvent(click)
    expect(pointerLockRequests).toBe(0)
    expect(useViewer.getState().walkthroughMode).toBe(true)
    expect(useScene.getState().nodes).toBe(nodes)
  })

  test(`${kind}: desktop ignores the touch channel`, async () => {
    const camera = await mountWalk(kind, false)
    const input = createWalkthroughInput()
    const start = camera.position.clone()
    const orientation = camera.quaternion.clone()
    input.setMove(1, 1)
    input.addLook(100, 100)
    input.requestJump()
    await frames(20)
    expect(camera.position.x).toBeCloseTo(start.x)
    expect(camera.position.z).toBeCloseTo(start.z)
    expect(camera.quaternion.equals(orientation)).toBe(true)
  })

  test(`${kind}: switching input mode releases movement without resetting the player`, async () => {
    const camera = await mountWalk(kind)
    createWalkthroughInput().setMove(1, 0)
    await frames(25)
    const moved = camera.position.x
    await act(async () => useViewer.getState().setWalkthroughInputMode('desktop'))
    await frames(90)
    expect(camera.position.x).toBeGreaterThanOrEqual(moved)
    const stopped = camera.position.x
    await frames(20)
    expect(camera.position.x).toBeCloseTo(stopped)
    await act(async () => useViewer.getState().setWalkthroughInputMode('touch'))
    await frames(20)
    expect(camera.position.x).toBeCloseTo(stopped)
  })

  test(`${kind}: blur and hidden document stop touch movement; unmount clears input`, async () => {
    const camera = await mountWalk(kind)
    const input = createWalkthroughInput()
    for (const cancel of [
      () => window.dispatchEvent(new Event('blur')),
      () => {
        Object.assign(documentEvents, { visibilityState: 'hidden' })
        documentEvents.dispatchEvent(new Event('visibilitychange'))
      },
    ]) {
      input.setMove(1, 0)
      cancel()
      const before = camera.position.x
      await frames(15)
      expect(camera.position.x).toBeCloseTo(before)
    }
    input.setMove(1, 0)
    input.addLook(500, 500)
    await renderer!.unmount()
    renderer = undefined
    const next = await mountWalk(kind)
    const before = next.position.x
    await frames(15)
    expect(next.position.x).toBeCloseTo(before)
    expect(next.rotation.y).toBeCloseTo(0)
  })
}

function seedGltf(url: string, scene: Group, animations: AnimationClip[] = []) {
  // Seed the controller's loader cache without network, timers or module mocks.
  useGLTF.preload(url, undefined, undefined, (loader) => {
    const load = loader.load
    loader.load = (_url, onLoad) => {
      loader.load = load
      onLoad({
        scene,
        scenes: [scene],
        animations,
        cameras: [],
        asset: { version: '2.0' },
        userData: {},
        parser: {},
      } as never)
    }
  })
}

for (const kind of ['live', 'baked'] as const) {
  test(`${kind}: one touch jump uses the existing impulse and does not repeat after landing`, async () => {
    const camera = await mountWalk(kind)
    await frames(120)
    const groundedY = camera.position.y
    createWalkthroughInput().requestJump()
    await frames(12)
    expect(camera.position.y).toBeGreaterThan(groundedY + 0.2)
    await frames(180)
    expect(camera.position.y).toBeCloseTo(groundedY, 1)
    await frames(30)
    expect(camera.position.y).toBeCloseTo(groundedY, 1)
  })
}

test('live touch Interact operates the reticle target exactly once', async () => {
  await mountWalk('live')
  const door = DoorNode.parse({ id: 'door_touch' })
  useScene.setState({ nodes: { ...useScene.getState().nodes, [door.id]: door } })
  const mesh = new Mesh(new BoxGeometry(1, 2.5, 0.1), new MeshBasicMaterial())
  mesh.position.set(0, 1.2, -1)
  sceneRegistry.nodes.set(door.id, mesh)
  sceneRegistry.byType.door!.add(door.id)
  await frames(1)
  expect(useFirstPersonHud.getState().interact).not.toBeNull()
  createWalkthroughInput().requestInteract()
  await frames(1)
  const opened = useInteractive.getState().doorAnimations[door.id]
  expect(opened?.to).toBeGreaterThan(0)
  expect(opened?.persist).toBe(false)
  await frames(20)
  expect(useInteractive.getState().doorAnimations[door.id]).toBe(opened)
  useInteractive.getState().cancelDoorAnimation(door.id)
})

test('baked touch Interact reaches GlbScene activation and publishes its target to the shared HUD', async () => {
  useViewer.getState().setWalkthroughInputMode('touch')
  useViewer.getState().setWalkthroughMode(true)
  const scene = new Group()
  const door = new Mesh(new BoxGeometry(1, 2.5, 0.1), new MeshBasicMaterial())
  door.name = 'touchDoor'
  door.position.set(0, 1.2, -1)
  door.userData = {
    pascalId: 'door_touch_baked',
    kind: 'door',
    label: 'Door',
    openable: true,
    clips: ['Door: open'],
  }
  scene.add(door)
  scene.updateMatrixWorld(true)
  seedGltf('baked-touch-activation', scene, [
    new AnimationClip('Door: open', 1, [
      new NumberKeyframeTrack('touchDoor.rotation[y]', [0, 1], [0, 1]),
    ]),
  ])
  const camera = new PerspectiveCamera()
  camera.position.set(0, 1.2, 0)
  renderer = await create(<GlbScene url="baked-touch-activation" />, { camera })
  await frames(1)
  expect(useFirstPersonHud.getState().interact).toEqual({ label: 'Door', verb: 'open' })
  createWalkthroughInput().requestInteract()
  await act(async () => {
    await frames(1)
  })
  await frames(20)
  expect(door.rotation.y).toBeGreaterThan(0)
  expect(useFirstPersonHud.getState().interact?.verb).toBe('close')
})

for (const mode of ['touch', 'desktop'] as const) {
  test(`baked ${mode}: a garage opening remains targeted during and after leaf animation`, async () => {
    useViewer.getState().setWalkthroughInputMode(mode)
    useViewer.getState().setWalkthroughMode(true)
    const scene = new Group()
    const door = new Group()
    door.userData = {
      pascalId: 'door_garage_baked',
      kind: 'door',
      label: 'Garage',
      openable: true,
      clips: ['Garage: open'],
    }
    door.position.set(0, 1.2, -1)
    const leaf = new Mesh(new BoxGeometry(2, 2.5, 0.1), new MeshBasicMaterial())
    leaf.name = 'garageLeaf'
    door.add(leaf)
    scene.add(door)
    scene.updateMatrixWorld(true)
    const url = `garage-activation-${mode}`
    seedGltf(url, scene, [
      new AnimationClip('Garage: open', 1, [
        new NumberKeyframeTrack('garageLeaf.position[y]', [0, 1], [0, 3]),
      ]),
    ])
    const camera = new PerspectiveCamera()
    camera.position.set(0, 1.2, 0)
    renderer = await create(<GlbScene url={url} />, { camera })
    const press = async () => {
      await act(async () => {
        if (mode === 'touch') createWalkthroughInput().requestInteract()
        else window.dispatchEvent(Object.assign(new Event('keydown'), { key: 'e' }))
        await frames(1)
      })
    }
    await frames(1)
    expect(useFirstPersonHud.getState().interact?.verb).toBe('open')
    await press()
    await frames(30)
    expect(leaf.position.y).toBeGreaterThan(1.3)
    expect(useFirstPersonHud.getState().interact?.verb).toBe('close')
    await press()
    await frames(40)
    expect(leaf.position.y).toBeCloseTo(0)
    await press()
    await frames(80)
    expect(leaf.position.y).toBeCloseTo(3)
    expect(useFirstPersonHud.getState().interact?.verb).toBe('close')
    // A nearer wall still blocks activation of the stationary opening.
    const blocker = new Mesh(new BoxGeometry(2, 3, 0.1), new MeshBasicMaterial())
    blocker.position.set(0, 1.2, -0.5)
    scene.add(blocker)
    await frames(1)
    expect(useFirstPersonHud.getState().interact).toBeNull()
    scene.remove(blocker)
    await frames(1)
    expect(useFirstPersonHud.getState().interact?.verb).toBe('close')
    await press()
    await frames(80)
    expect(leaf.position.y).toBeCloseTo(0)
    camera.rotation.y = Math.PI
    camera.updateMatrixWorld(true)
    await frames(1)
    expect(useFirstPersonHud.getState().interact).toBeNull()
    camera.rotation.y = 0
    camera.position.z = 10
    camera.updateMatrixWorld(true)
    await frames(1)
    expect(useFirstPersonHud.getState().interact).toBeNull()
  })

  test(`live ${mode}: a garage opening remains targeted when the leaf leaves the ray`, async () => {
    await mountWalk('live', mode === 'touch')
    const door = DoorNode.parse({ id: 'door_garage_live', doorType: 'garage-sectional' })
    useScene.setState({ nodes: { ...useScene.getState().nodes, [door.id]: door } })
    const object = new Group()
    object.position.set(0, 1.2, -1)
    const leaf = new Mesh(new BoxGeometry(2, 2.5, 0.1), new MeshBasicMaterial())
    object.add(leaf)
    sceneRegistry.nodes.set(door.id, object)
    sceneRegistry.byType.door!.add(door.id)
    await frames(1)
    expect(useFirstPersonHud.getState().interact?.verb).toBe('open')
    if (mode === 'touch') createWalkthroughInput().requestInteract()
    else key('KeyE')
    await frames(1)
    expect(useInteractive.getState().doorAnimations[door.id]?.to).toBeGreaterThan(0)
    // The controller fixture has no door renderer/system; publish its in-flight pose.
    useInteractive.getState().setDoorOpenState(door.id, { operationState: 0.7 })
    leaf.position.y = 3
    await frames(2)
    expect(useFirstPersonHud.getState().interact?.verb).toBe('close')
    if (mode === 'touch') createWalkthroughInput().requestInteract()
    else key('KeyE')
    await frames(1)
    expect(useInteractive.getState().doorAnimations[door.id]?.to).toBe(0)
    useInteractive.getState().cancelDoorAnimation(door.id)
    useInteractive.getState().removeDoorOpenState(door.id)
  })
}

// R3F's test renderer batches by subscriber; advance one frame at a time to preserve input → physics → camera order.
async function frames(count: number) {
  for (let frame = 0; frame < count; frame += 1) {
    renderer!.scene.instance.updateMatrixWorld(true)
    await renderer!.advanceFrames(1, 1 / 60)
  }
}

test('baked family isolation uses the supplied graph without hydrating useScene and restores the same merge', async () => {
  const restoreRegistry = nodeRegistry._snapshot()
  const viewer = useViewer.getState()
  nodeRegistry._register({
    kind: 'beam',
    schemaVersion: 1,
    extensions: { 'pascal:viewer': { family: 'structure' } },
  } as never)
  nodeRegistry._register({
    kind: 'pipe-segment',
    schemaVersion: 1,
    extensions: { 'pascal:viewer': { family: 'plumbing' } },
  } as never)
  nodeRegistry._register({
    kind: 'level',
    schemaVersion: 1,
    extensions: { 'pascal:viewer': { family: null } },
  } as never)
  window.location.search = '?occlusion=0'
  const scene = new Group()
  const level = new Group()
  level.userData = { kind: 'level', pascalId: 'level_xray' }
  scene.add(level)
  const material = new MeshBasicMaterial()
  const beam = new Mesh(new BoxGeometry(), material)
  beam.userData = { kind: 'beam', pascalId: 'beam_xray' }
  const pipe = new Mesh(new BoxGeometry(), material)
  pipe.userData = { kind: 'pipe-segment', pascalId: 'pipe_xray' }
  const tree = new Group()
  tree.userData = { kind: 'trees:tree', pascalId: 'tree_xray' }
  const foliage = new Mesh(new BoxGeometry(), material)
  tree.add(foliage)
  const annotation = new Mesh(new BoxGeometry(), material)
  annotation.userData = { kind: 'measurement', pascalId: 'annotation_xray' }
  nodeRegistry._register({
    kind: 'measurement',
    schemaVersion: 1,
    extensions: { 'pascal:viewer': { family: null } },
  } as never)
  level.add(beam, pipe, tree, annotation)
  const nodes = Object.fromEntries(
    [level, beam, pipe, tree, annotation].map((object) => [
      object.userData.pascalId,
      { id: object.userData.pascalId, type: object.userData.kind },
    ]),
  ) as never
  seedGltf('baked-family-isolation', scene)
  useScene.setState({ nodes: {}, rootNodeIds: [] })
  try {
    renderer = await create(<GlbScene url="baked-family-isolation" sceneNodes={nodes} />)
    await frames(1)
    const batch = level.children.find((object) => object.userData.glbBatch)!
    expect(batch).toBeDefined()
    expect(beam.layers.isEnabled(0)).toBe(false)
    expect(pipe.layers.isEnabled(0)).toBe(false)
    await act(async () => useViewer.getState().setXrayFamily('plumbing'))
    await frames(1)
    expect(batch.layers.isEnabled(0)).toBe(false)
    expect(beam.layers.isEnabled(0)).toBe(false)
    expect(pipe.layers.isEnabled(0)).toBe(true)
    expect(useScene.getState().nodes).toEqual({})
    await act(async () => useViewer.getState().setXrayFamily('walls'))
    await frames(1)
    expect(foliage.layers.isEnabled(0)).toBe(false)
    expect(annotation.layers.isEnabled(0)).toBe(true)
    await act(async () => useViewer.getState().setXrayFamily('other'))
    await frames(1)
    expect(foliage.layers.isEnabled(0)).toBe(true)
    expect(beam.layers.isEnabled(0)).toBe(false)
    expect(annotation.layers.isEnabled(0)).toBe(true)
    await act(async () => useViewer.getState().setWalkthroughMode(true))
    await frames(1)
    expect(batch.layers.isEnabled(0)).toBe(true)
    expect(pipe.layers.isEnabled(0)).toBe(false)
    await act(async () => {
      useViewer.getState().setWalkthroughMode(false)
      useViewer.getState().setXrayFamily(null)
    })
    await frames(1)
    expect(level.children.find((object) => object.userData.glbBatch)).toBe(batch)
    expect(batch.layers.isEnabled(0)).toBe(true)
    expect(beam.layers.isEnabled(0)).toBe(false)
  } finally {
    await renderer?.unmount()
    renderer = undefined
    restoreRegistry()
    useViewer.setState(viewer, true)
  }
})
