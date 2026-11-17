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
import { useFirstPersonHud as uiHud, WalkthroughTouchControls } from '@pascal-app/viewer/ui'
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

async function mountWalk(
  kind: 'live' | 'baked',
  touch = true,
  props: Pick<LiveWalkthroughControllerProps, 'speeds' | 'seeDistance'> = {},
) {
  if (touch) useViewer.getState().setWalkthroughInputMode('touch')
  useViewer.getState().setWalkthroughMode(true)
  const camera = new PerspectiveCamera(47)
  camera.position.set(0, 1.65, 0)
  if (kind === 'live') {
    ground()
    renderer = await create(<LiveWalkthroughController {...props} />, {
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
    renderer = await create(<GlbWalkthroughController url={url} {...props} />, {
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

  test(`${kind}: touch crouch reaches the capsule and release restores standing`, async () => {
    const camera = await mountWalk(kind)
    await frames(120)
    const standing = camera.position.y
    createWalkthroughInput().setCrouch(true)
    await act(async () => {
      await frames(1)
    })
    await frames(60)
    expect(camera.position.y).toBeLessThan(standing - 0.3)
    createWalkthroughInput().setCrouch(false)
    await act(async () => {
      await frames(1)
    })
    await frames(60)
    expect(camera.position.y).toBeCloseTo(standing, 1)
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
  useInteractive.getState().setDoorOpenState(door.id, { swingAngle: 1 })
  expect(useFirstPersonHud.getState().canClose).toBe(true)
  createWalkthroughInput().requestClose()
  await frames(1)
  const closed = useInteractive.getState().doorAnimations[door.id]
  expect(closed?.to).toBe(0)
  expect(closed?.persist).toBe(false)
  await frames(20)
  expect(useInteractive.getState().doorAnimations[door.id]).toBe(closed)
  useInteractive.getState().cancelDoorAnimation(door.id)
})

test('baked touch shutters toggle once, clear targeting out of reach and never mount a key prompt', async () => {
  useViewer.getState().setWalkthroughInputMode('touch')
  useViewer.getState().setWalkthroughMode(true)
  const scene = new Group()
  const window = new Mesh(new BoxGeometry(1, 2.5, 0.1), new MeshBasicMaterial())
  window.name = 'touchShutters'
  window.position.set(0, 1.2, -1)
  window.userData = {
    pascalId: 'window_touch_shutters',
    kind: 'window',
    shutters: true,
    shuttersOpen: 0,
    clips: ['window_touch_shutters: shutters'],
  }
  scene.add(window)
  scene.updateMatrixWorld(true)
  seedGltf('baked-touch-shutters', scene, [
    new AnimationClip('window_touch_shutters: shutters', 1, [
      new NumberKeyframeTrack('touchShutters.rotation[y]', [0, 1], [0, 0.1]),
    ]),
  ])
  const camera = new PerspectiveCamera()
  camera.position.set(0, 1.2, 0)
  renderer = await create(<GlbScene url="baked-touch-shutters" />, { camera })
  await act(async () => {
    await frames(1)
  })
  expect(useFirstPersonHud.getState().shuttersInView).toBe(true)
  // Html key prompts require a DOM: this DOM-free fixture also guards their absence.
  const state = () => useInteractive.getState().mechanismParts['window_touch_shutters:shutters']
  expect(state()).toBe(false)
  createWalkthroughInput().requestShutters()
  await frames(1)
  expect(state()).toBe(true)
  await frames(20)
  expect(state()).toBe(true)
  expect(window.rotation.y).toBeGreaterThan(0)
  createWalkthroughInput().requestShutters()
  await frames(1)
  expect(state()).toBe(false)
  window.position.z = -4
  window.updateMatrixWorld(true)
  await act(async () => {
    await frames(1)
  })
  expect(useFirstPersonHud.getState().shuttersInView).toBe(false)
  createWalkthroughInput().requestShutters()
  await frames(1)
  expect(state()).toBe(false)
  await act(async () => useViewer.getState().setWalkthroughMode(false))
  expect(useFirstPersonHud.getState().shuttersInView).toBe(false)
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

for (const kind of ['live', 'baked'] as const) {
  for (const speeds of [undefined, { walk: 1.8, run: 2.8 }, { run: 3.2 }]) {
    for (const running of [false, true]) {
      test(`${kind}: ${JSON.stringify(speeds) ?? 'default'} speeds cover the expected metres in one second (${running ? 'run' : 'walk'})`, async () => {
        const camera = await mountWalk(kind, false, { speeds })
        await frames(120)
        const press = (code: string) => {
          key(code)
          window.dispatchEvent(Object.assign(new Event('keydown'), { code, key: code }))
        }
        press('KeyW')
        if (running) press('ShiftLeft')
        await frames(60) // Reach steady velocity before measuring a fixed one-second interval.
        const start = camera.position.clone()
        await frames(60)
        expect(camera.position.distanceTo(start)).toBeCloseTo(
          running ? (speeds?.run ?? 5) : (speeds?.walk ?? 2),
          2,
        )
      })
    }
  }
}

test('live: distant identification has a kind, prompt and distance, never activates, and clears outside seeDistance', async () => {
  const camera = await mountWalk('live', true, { seeDistance: 6 })
  const door = DoorNode.parse({ id: 'door_seen' })
  useScene.setState({ nodes: { ...useScene.getState().nodes, [door.id]: door } })
  const object = new Mesh(new BoxGeometry(1, 2.5, 0.1), new MeshBasicMaterial())
  object.position.set(0, 1.2, -4)
  sceneRegistry.nodes.set(door.id, object)
  sceneRegistry.byType.door!.add(door.id)
  await frames(1)
  expect(useFirstPersonHud.getState().interact).toBeNull()
  expect(useFirstPersonHud.getState().seenInteract).toMatchObject({ kind: 'door', verb: 'open' })
  expect(useFirstPersonHud.getState().seenInteract?.distance).toBeCloseTo(3.95)
  createWalkthroughInput().requestInteract()
  await frames(1)
  expect(useInteractive.getState().doorAnimations[door.id]).toBeUndefined()
  object.position.z = -6.1
  await frames(1)
  expect(useFirstPersonHud.getState().seenInteract).toBeNull()
  object.position.z = -1
  await frames(1)
  expect(useFirstPersonHud.getState().interact).not.toBeNull()
  expect(useFirstPersonHud.getState().seenInteract).toBeNull()
  expect(camera.position.z).toBeCloseTo(0)
  await renderer!.update(<LiveWalkthroughController />)
  object.position.z = -10
  await frames(1)
  expect(useFirstPersonHud.getState().seenInteract?.distance).toBeCloseTo(9.95)
  object.position.z = -16.1
  await frames(1)
  expect(useFirstPersonHud.getState().seenInteract).toBeNull()
})

test('baked: controller seeDistance configures GlbScene, reports distance changes, and never activates a distant target', async () => {
  useViewer.getState().setWalkthroughInputMode('touch')
  useViewer.getState().setWalkthroughMode(true)
  const scene = new Group()
  const floor = new Mesh(new BoxGeometry(100, 0.1, 100), new MeshBasicMaterial())
  floor.position.y = -0.05
  floor.userData.kind = 'slab'
  const door = new Mesh(new BoxGeometry(1, 2.5, 0.1), new MeshBasicMaterial())
  door.name = 'seenDoor'
  door.position.set(0, 1.2, -4)
  door.userData = {
    pascalId: 'door_seen_baked',
    kind: 'door',
    label: 'Door',
    openable: true,
    clips: ['Door: open'],
  }
  scene.add(floor, door)
  seedGltf('baked-seen', scene, [
    new AnimationClip('Door: open', 1, [
      new NumberKeyframeTrack('seenDoor.rotation[y]', [0, 1], [0, 1]),
    ]),
  ])
  const camera = new PerspectiveCamera()
  camera.position.set(0, 1.65, 0)
  const content = (seeDistance?: number) => (
    <>
      <GlbScene url="baked-seen" />
      <GlbWalkthroughController url="baked-seen" seeDistance={seeDistance} />
    </>
  )
  renderer = await create(content(6), { camera })
  await act(async () => {
    await frames(1)
  })
  await act(async () => {
    await frames(8)
  })
  expect(useFirstPersonHud.getState().interact).toBeNull()
  expect(useFirstPersonHud.getState().seenInteract).toMatchObject({
    kind: 'door',
    label: 'Door',
    verb: 'open',
  })
  expect(useFirstPersonHud.getState().seenInteract?.distance).toBeCloseTo(3.95)
  const input = createWalkthroughInput()
  input.requestInteract()
  await frames(20)
  expect(door.rotation.y).toBe(0)
  input.setMove(0, -1)
  await frames(30)
  expect(useFirstPersonHud.getState().seenInteract?.distance).toBeGreaterThan(4)
  await frames(90)
  expect(useFirstPersonHud.getState().seenInteract).toBeNull()
  input.clear()
  // The omitted option restores the default 16 m identification range.
  await renderer.update(content())
  await frames(30)
  expect(useFirstPersonHud.getState().seenInteract?.distance).toBeGreaterThan(6)
  input.setMove(0, -1)
  await frames(300)
  expect(useFirstPersonHud.getState().seenInteract).toBeNull()
  input.setMove(0, 1)
  await frames(470)
  input.clear()
  await frames(30)
  expect(useFirstPersonHud.getState().seenInteract).toBeNull()
  expect(useFirstPersonHud.getState().interact).toEqual({ label: 'Door', verb: 'open' })
})

test('seen HUD equality includes kind and distance, and reset clears it', () => {
  const seen = { kind: 'door', label: 'Door', verb: 'open', distance: 4 }
  uiHud.getState().setHud({ seenInteract: seen })
  const before = useFirstPersonHud.getState()
  uiHud.getState().setHud({ seenInteract: { ...seen } })
  expect(useFirstPersonHud.getState()).toBe(before)
  uiHud.getState().setHud({ seenInteract: { ...seen, distance: 5 } })
  expect(useFirstPersonHud.getState().seenInteract?.distance).toBe(5)
  uiHud.getState().reset()
  expect(useFirstPersonHud.getState().seenInteract).toBeNull()
})

test('shutters button and desktop F activate the same toggle and show only usable prompts', async () => {
  // Keep the chrome renderer's module replacement out of the full suite's module cache.
  if (!process.env.WALKTHROUGH_ACTION_FIXTURE) {
    const child = Bun.spawnSync({
      cmd: [
        process.execPath,
        'test',
        '--preload',
        new URL('./__tests__/walkthrough-chrome.tsx', import.meta.url).pathname,
        import.meta.path,
        '--test-name-pattern',
        'shutters button and desktop F',
      ],
      env: { ...process.env, WALKTHROUGH_ACTION_FIXTURE: '1' },
    })
    if (child.exitCode !== 0) throw new Error(child.stderr.toString())
    return
  }
  useViewer.getState().setWalkthroughInputMode('touch')
  useViewer.getState().setWalkthroughMode(true)
  const scene = new Group()
  const window = new Mesh(new BoxGeometry(1, 2.5, 0.1), new MeshBasicMaterial())
  window.name = 'shutterControls'
  window.position.set(0, 1.2, -1)
  window.userData = {
    pascalId: 'window_controls',
    kind: 'window',
    shutters: true,
    shuttersOpen: 0,
    clips: ['window_controls: shutters'],
  }
  scene.add(window)
  scene.updateMatrixWorld(true)
  seedGltf('shutter-controls', scene, [
    new AnimationClip('window_controls: shutters', 1, [
      new NumberKeyframeTrack('shutterControls.rotation[y]', [0, 1], [0, 0.1]),
    ]),
  ])
  const camera = new PerspectiveCamera()
  camera.position.set(0, 1.2, 0)
  renderer = await create(
    <>
      <GlbScene url="shutter-controls" />
      <WalkthroughTouchControls />
    </>,
    { camera },
  )
  const frame = () =>
    act(async () => {
      await frames(1)
    })
  const buttons = () => renderer!.scene.findAllByType('button')
  const shuttersButton = () =>
    buttons().find((button) => button.props['data-walkthrough-shutters'] === '')
  const prompts = () => renderer!.scene.findAll((node) => !!node.props.userData?.html)
  const state = () => useInteractive.getState().mechanismParts['window_controls:shutters']
  const pointer = { pointerId: 1, preventDefault() {}, currentTarget: { setPointerCapture() {} } }
  await frame()
  expect(shuttersButton()).toBeDefined()
  expect(prompts()).toHaveLength(0)
  await renderer.fireEvent(shuttersButton()!, 'pointerDown', pointer)
  await renderer.fireEvent(shuttersButton()!, 'pointerDown', pointer)
  await frame()
  expect(state()).toBe(true)
  await frames(10)
  expect(state()).toBe(true)
  await renderer.fireEvent(
    renderer.scene.findByProps({ 'data-walkthrough-touch-controls': '' }),
    'pointerUp',
    pointer,
  )
  await renderer.fireEvent(shuttersButton()!, 'pointerDown', pointer)
  await frame()
  expect(state()).toBe(false)
  window.position.z = -4
  window.updateMatrixWorld(true)
  await frame()
  expect(shuttersButton()).toBeUndefined()
  await act(async () => useViewer.getState().setWalkthroughInputMode('desktop'))
  window.position.z = -1
  window.updateMatrixWorld(true)
  await frame()
  expect(buttons()).toHaveLength(0)
  expect(prompts()).toHaveLength(1)
  expect(prompts()[0]!.props.userData.html).toMatch(/<kbd[^>]*>F<\/kbd>/)
  const pressF = (repeat = false) =>
    globalThis.window.dispatchEvent(Object.assign(new Event('keydown'), { key: 'f', repeat }))
  pressF()
  expect(state()).toBe(true)
  pressF(true)
  expect(state()).toBe(true)
  pressF()
  expect(state()).toBe(false)
  createWalkthroughInput().requestShutters()
  await frame()
  expect(state()).toBe(false)
  await act(async () => useViewer.getState().setWalkthroughInputMode('touch'))
  await frame()
  expect(prompts()).toHaveLength(0)
})
