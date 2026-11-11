import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  LiveWalkthroughController,
  type LiveWalkthroughControllerProps,
  useFirstPersonHud,
  useViewer,
} from '@pascal-app/viewer'
import { useFirstPersonHud as uiHud } from '@pascal-app/viewer/ui'
import { act, create } from '@react-three/test-renderer'
import { PerspectiveCamera } from 'three'

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
let renderer: Awaited<ReturnType<typeof create>> | undefined

beforeEach(() => {
  documentEvents = Object.assign(new EventTarget(), {
    activeElement: null,
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
    window: Object.assign(new EventTarget(), { requestAnimationFrame, cancelAnimationFrame }),
    HTMLElement: class extends EventTarget {},
    requestAnimationFrame,
    cancelAnimationFrame,
  })
  useViewer.getState().setWalkthroughMode(false)
  useFirstPersonHud.getState().reset()
})

afterEach(async () => {
  await renderer?.unmount()
  renderer = undefined
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
      Object.assign(canvas, { hasAttribute: () => true, focus: () => {} })
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
  await renderer!.advanceFrames(20, 1 / 60)
  expect(camera.position.z).toBeLessThan(-0.1)
  await renderer!.update(<LiveWalkthroughController paused />)
  const heldPosition = camera.position.clone()
  await renderer!.advanceFrames(20, 1 / 60)
  expect(camera.position.equals(heldPosition)).toBe(true)
  await act(async () => useViewer.getState().setWalkthroughMode(false))
  expect(camera.fov).toBe(47)
  await renderer!.advanceFrames(10, 1 / 60)
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
    externalFov: true,
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
