import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import {
  BuildingNode,
  clearSceneHistory,
  emitter,
  endScenePreview,
  isScenePreviewing,
  LevelNode,
  type PointAskSubmit,
  registerPointAskHandler,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { PerspectiveCamera, Raycaster } from 'three'
import {
  getEditorThreeContext,
  setEditorThreeContext,
} from '../../components/editor/three-context-bridge'
import { asksWait, type BubbleTarget, usePointAsk } from '../../store/use-point-ask'
import * as enrichedCapture from '../enriched-capture/enrich'
import * as enrichedRequests from '../enriched-capture/requests'
import * as captureCrop from './capture-crop'
import { setPointAskBehindQueue, setPointAskBusy } from './host-api'
import { closeBubble, endCompare, sendBubble, startCompare, startPointAskSession } from './session'

// The whole ask path with the real stores (hold to see before; an ask while Pascal is working): the session listening to the chat's
// statuses, a turn writing the scene through the store's own actions (each a history step), the pin
// reaching "done", and the hold. Only the chat's words (statuses) and the DOM are stood in for.

const building = BuildingNode.parse({ id: 'building_flow' })
const level = LevelNode.parse({ id: 'level_flow', parentId: building.id })
const wall = WallNode.parse({
  id: 'wall_flow',
  parentId: level.id,
  start: [0, 0],
  end: [4, 0],
  height: 2.6,
})
building.children = [level.id]
level.children = [wall.id]

const STOCK_HEIGHT = 2.6
const original = useScene.getState()
const originalWindow = globalThis.window
const originalDocument = globalThis.document
const originalRaf = globalThis.requestAnimationFrame
const originalCancelRaf = globalThis.cancelAnimationFrame
let stopSession = () => {}
let unregisterHandler = () => {}

const target = {
  id: wall.id,
  type: 'wall',
  name: 'Wall',
  levelId: level.id,
  size: { length: 4, height: STOCK_HEIGHT, thickness: 0.2 },
  box: { min: [0, 0, -0.1], max: [4, STOCK_HEIGHT, 0.1] },
} as unknown as BubbleTarget

function resetScene() {
  useScene.setState({
    nodes: { [building.id]: building, [level.id]: level, [wall.id]: wall },
    rootNodeIds: [building.id],
    dirtyNodes: new Set(),
    readOnly: false,
  } as never)
  clearSceneHistory()
}

beforeEach(() => {
  const stub = { addEventListener() {}, removeEventListener() {} }
  globalThis.window = { ...stub, innerWidth: 1280, innerHeight: 800 } as never
  globalThis.document = { ...stub, hidden: false } as never
  globalThis.requestAnimationFrame = (callback) => {
    callback(0)
    return 0
  }
  globalThis.cancelAnimationFrame = () => {}
  resetScene()
  usePointAsk.setState({ pins: {}, pinOrder: [], bubble: null, comparing: null, busy: false })
  unregisterHandler = registerPointAskHandler(async () => ({ ok: true }))
  stopSession = startPointAskSession()
})

afterEach(() => {
  endCompare()
  endScenePreview()
  stopSession()
  unregisterHandler()
  useScene.setState(original, true)
  clearSceneHistory()
  globalThis.window = originalWindow
  globalThis.document = originalDocument
  if (originalRaf) globalThis.requestAnimationFrame = originalRaf
  else Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
  if (originalCancelRaf) globalThis.cancelAnimationFrame = originalCancelRaf
  else Reflect.deleteProperty(globalThis, 'cancelAnimationFrame')
})

/** The person points at the wall and sends; returns the ask's id. */
async function sendAsk() {
  usePointAsk.getState().openBubble({
    targets: [target],
    anchor: [2, 1, 0],
    hit: { point: [2, 1, 0], normal: [0, 0, 1] },
    gesture: 'click',
    capturedAt: new Date().toISOString(),
    camera: null,
    crop: { state: 'failed' },
    draft: '',
    error: null,
  })
  await sendBubble('make this wall taller', { x: 0, y: 0, width: 10, height: 10 })
  const askId = usePointAsk.getState().pinOrder.at(-1)
  if (!askId) throw new Error('the ask did not plant a pin')
  return askId
}

const status = (askId: string, rest: Record<string, unknown>) =>
  emitter.emit('point-ask:status', { askId, ...rest } as never)

/** A scene action of the agent: history tracks it, and is left as it was found (the hosted executor's contract). */
function agentWrite(write: () => void) {
  const wasTracking = useScene.temporal.getState().isTracking
  useScene.temporal.getState().resume()
  try {
    write()
  } finally {
    if (!wasTracking) useScene.temporal.getState().pause()
  }
}

/** What the hosted executor did before it was fixed: always paused after, whatever it found. */
function leftoverPause(write: () => void) {
  useScene.temporal.getState().resume()
  try {
    write()
  } finally {
    useScene.temporal.getState().pause()
  }
}

const wallHeight = () => (useScene.getState().nodes[wall.id] as { height: number }).height

describe('ordinary submissions without enriched capture', () => {
  test('a region reaches the host with only the original ranking and crop keys', async () => {
    const received: PointAskSubmit[] = []
    unregisterHandler()
    unregisterHandler = registerPointAskHandler(async (submit) => {
      received.push(submit)
      return { ok: true }
    })
    usePointAsk.getState().openBubble({
      targets: [],
      anchor: [2, 1, 0],
      hit: { point: [2, 1, 0], normal: [0, 0, 1] },
      gesture: 'region',
      capturedAt: '2026-11-01T12:00:00.000Z',
      camera: null,
      region: [0.2, 0.2, 0.6, 0.6],
      area: {
        rect: { x0: 20, y0: 20, x1: 60, y1: 60 },
        click: { x: 40, y: 40 },
        ids: [wall.id],
        more: 0,
      },
      crop: {
        state: 'ready',
        dataUrl: 'data:image/png;base64,AAAA',
        width: 512,
        height: 512,
        marked: false,
      },
      draft: '',
      error: null,
    })
    await sendBubble('what is here?', { x: 0, y: 0, width: 10, height: 10 })

    expect(received).toHaveLength(1)
    const context = received[0]!.context
    expect(context.targets).toEqual([])
    expect(context.inRegion).toEqual({ ids: [wall.id], more: 0 })
    expect(Object.keys(context.inRegion!).sort()).toEqual(['ids', 'more'])
    expect(context.image).toEqual({
      dataUrl: 'data:image/png;base64,AAAA',
      width: 512,
      height: 512,
      marked: false,
    })
    expect(Object.keys(context.image!).sort()).toEqual(['dataUrl', 'height', 'marked', 'width'])
  })
})

test('sending during a cold enriched capture waits beyond the ordinary crop budget', async () => {
  // Only the async renderer boundary and clock are controlled. Pointer handling, pending-crop
  // retention, bubble closure, context construction and the host submission are real.
  const received: PointAskSubmit[] = []
  const previousThree = getEditorThreeContext()
  const previousViewer = useViewer.getState()
  const previousPoint = usePointAsk.getState()
  const previousTimeout = globalThis.setTimeout
  const previousClearTimeout = globalThis.clearTimeout
  const listeners = new Map<string, Set<EventListener>>()
  const timers = new Map<number, { at: number; run: () => void }>()
  let now = 0
  let timerId = 0
  const advanceTo = (time: number) => {
    now = time
    for (const [id, timer] of [...timers]) {
      if (timer.at > now) continue
      timers.delete(id)
      timer.run()
    }
  }
  let fulfill!: (capture: enrichedCapture.EnrichedCapture) => void
  const deferred = new Promise<enrichedCapture.EnrichedCapture>((resolve) => {
    fulfill = resolve
  })
  const capture = spyOn(enrichedCapture, 'captureEnrichedRegion').mockReturnValue(deferred)
  stopSession()
  unregisterHandler()
  unregisterHandler = registerPointAskHandler(async (submit) => {
    received.push(submit)
    return { ok: true }
  })
  try {
    globalThis.setTimeout = ((callback: () => void, delay = 0) => {
      const id = ++timerId
      timers.set(id, { at: now + delay, run: callback })
      return id
    }) as unknown as typeof setTimeout
    globalThis.clearTimeout = ((id: number) => timers.delete(id)) as unknown as typeof clearTimeout
    globalThis.window = {
      innerWidth: 100,
      innerHeight: 100,
      addEventListener(type: string, listener: EventListener) {
        if (!listeners.has(type)) listeners.set(type, new Set())
        listeners.get(type)!.add(listener)
      },
      removeEventListener(type: string, listener: EventListener) {
        listeners.get(type)?.delete(listener)
      },
    } as never
    const canvas = {
      style: {},
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        right: 100,
        bottom: 100,
        width: 100,
        height: 100,
      }),
    } as unknown as HTMLCanvasElement
    const camera = new PerspectiveCamera(60, 1, 0.1, 100)
    camera.position.set(2, 3, 7)
    camera.lookAt(2, 1, 0)
    camera.updateMatrixWorld(true)
    setEditorThreeContext({ camera, raycaster: new Raycaster(), domElement: canvas })
    const hidden = WallNode.parse({
      id: 'wall_hidden',
      parentId: level.id,
      start: [0, -1],
      end: [4, -1],
      height: 2.6,
    })
    useScene.setState({ nodes: { ...useScene.getState().nodes, [hidden.id]: hidden } })
    useViewer.setState({ selection: { ...previousViewer.selection, levelId: level.id } })
    stopSession = startPointAskSession({ enrichedRegions: true })
    usePointAsk.setState({ active: true, playful: false, hover: null })
    const pointer = (type: string, x: number, y: number) => {
      const event = {
        target: canvas,
        button: 0,
        pointerType: 'mouse',
        clientX: x,
        clientY: y,
        shiftKey: false,
        timeStamp: now,
        preventDefault() {},
        stopImmediatePropagation() {},
      } as unknown as Event
      for (const listener of listeners.get(type) ?? []) listener(event)
    }
    pointer('pointerdown', 10, 10)
    pointer('pointermove', 90, 90)
    pointer('pointerup', 90, 90)
    expect(capture).toHaveBeenCalledTimes(1)
    expect(usePointAsk.getState().bubble?.area?.ids).toContain(hidden.id)
    expect(usePointAsk.getState().bubble?.crop.state).toBe('pending')

    const sending = sendBubble('what is visible?', { x: 0, y: 0, width: 10, height: 10 })
    expect(usePointAsk.getState().bubble).toBeNull()
    advanceTo(2_000)
    await Promise.resolve()
    await Promise.resolve()
    expect(received).toHaveLength(0)

    const result: enrichedCapture.EnrichedCapture = {
      crop: { dataUrl: 'data:image/jpeg;base64,CROP', width: 512, height: 512 },
      camera: {
        position: [2, 3, 7],
        target: [2, 1, 0],
        fov: 60,
        aspect: 1,
        projection: 'perspective',
      },
      region: {
        canvasRect: { x0: 10, y0: 10, x1: 90, y1: 90 },
        cropRect: { x0: 0, y0: 0, x1: 512, y1: 512 },
      },
      world: {
        center: [2, 1, 0],
        topLeft: null,
        topRight: null,
        bottomLeft: null,
        bottomRight: null,
      },
      visible: [
        { id: wall.id, share: 0.75 },
        { class: 'background', share: 0.25 },
      ],
      rooms: [],
      legend: [],
      legendText: 'Visible wall and sky',
      segmented: { dataUrl: 'data:image/png;base64,MAP', width: 512, height: 512 },
    }
    advanceTo(4_200)
    fulfill(result)
    await sending

    expect(received).toHaveLength(1)
    expect(received[0]!.context.inRegion).toEqual({
      ids: [wall.id],
      more: 0,
      visible: result.visible,
      world: result.world,
      rooms: [],
    })
    expect(received[0]!.context.image).toEqual({
      ...result.crop,
      marked: false,
      segmented: result.segmented,
      legend: [],
      legendText: result.legendText,
    })
    const pin = usePointAsk.getState().pins[received[0]!.askId]!
    expect(pin.model.targetIds).toEqual([wall.id])
    expect(pin.anchor).toEqual([2, 1, 0])
    expect(pin.before?.dataUrl).toBe(result.crop.dataUrl)
  } finally {
    capture.mockRestore()
    stopSession()
    globalThis.setTimeout = previousTimeout
    globalThis.clearTimeout = previousClearTimeout
    setEditorThreeContext(previousThree)
    useViewer.setState(previousViewer, true)
    usePointAsk.setState(previousPoint, true)
  }
})

describe('a history left untracked after the turn', () => {
  test('refuses the hold, and the card is told why (it was silent: the owner, 12 October)', async () => {
    const askId = await sendAsk()
    status(askId, { status: 'working', sentence: 'Raising the wall' })
    leftoverPause(() => useScene.getState().updateNode(wall.id, { height: 3.4 }))
    status(askId, { status: 'ended', outcome: 'completed', asked: false, wroteScene: true })
    expect(startCompare(askId)).toBe(false)
    expect(isScenePreviewing()).toBe(false)
    expect(usePointAsk.getState().compareRefusal).toEqual({ askId, reason: 'history-held' })
  })
})

describe('hold to see before, end to end', () => {
  test('a turn that wrote the scene can be held to show the scene as it was', async () => {
    const askId = await sendAsk()
    status(askId, { status: 'working', sentence: 'Raising the wall' })
    agentWrite(() => useScene.getState().updateNode(wall.id, { height: 3.4 }))
    status(askId, {
      status: 'ended',
      outcome: 'completed',
      asked: false,
      wroteScene: true,
    })
    expect(usePointAsk.getState().pins[askId]?.model.state).toBe('done')
    expect(wallHeight()).toBe(3.4)

    expect(startCompare(askId)).toBe(true)
    expect(isScenePreviewing()).toBe(true)
    expect(wallHeight()).toBe(STOCK_HEIGHT)
    expect(usePointAsk.getState().comparing).toBe(askId)

    endCompare()
    expect(isScenePreviewing()).toBe(false)
    expect(wallHeight()).toBe(3.4)
    expect(usePointAsk.getState().comparing).toBeNull()
  })

  test('a turn of several writes shows the state from before the first of them', async () => {
    const askId = await sendAsk()
    status(askId, { status: 'working', sentence: 'Building' })
    agentWrite(() => useScene.getState().updateNode(wall.id, { height: 3 }))
    agentWrite(() => useScene.getState().updateNode(wall.id, { height: 3.2 }))
    agentWrite(() => useScene.getState().updateNode(wall.id, { height: 3.4 }))
    status(askId, { status: 'ended', outcome: 'completed', asked: false, wroteScene: true })
    expect(startCompare(askId)).toBe(true)
    expect(wallHeight()).toBe(STOCK_HEIGHT)
  })

  test('a write that lands before the chat reports "working" is not part of the before', async () => {
    const askId = await sendAsk()
    // The chat accepted the ask; its first write comes before its first status.
    agentWrite(() => useScene.getState().updateNode(wall.id, { height: 3.4 }))
    status(askId, { status: 'working', sentence: 'Reading your request' })
    agentWrite(() => useScene.getState().updateNode(wall.id, { height: 3.8 }))
    status(askId, { status: 'ended', outcome: 'completed', asked: false, wroteScene: true })
    expect(startCompare(askId)).toBe(true)
    expect(wallHeight()).toBe(STOCK_HEIGHT)
  })

  test('a turn that is not writing does not stop the hold, even when a pin never heard its end', async () => {
    const first = await sendAsk()
    status(first, { status: 'working', sentence: 'Raising the wall' })
    agentWrite(() => useScene.getState().updateNode(wall.id, { height: 3.4 }))
    status(first, { status: 'ended', outcome: 'completed', asked: false, wroteScene: true })
    // Another ask whose end the pin never heard: it says "working", but the chat is idle.
    const stuck = usePointAsk.getState().pins[first]
    if (!stuck) throw new Error('the ask has no pin')
    usePointAsk.getState().addPin({
      ...stuck,
      model: { ...stuck.model, askId: 'ask_stuck', state: 'working' },
    })
    usePointAsk.setState({ busy: false })
    expect(startCompare(first)).toBe(true)
    endCompare()
    usePointAsk.setState({ busy: true })
    expect(startCompare(first)).toBe(false)
    expect(usePointAsk.getState().compareRefusal).toEqual({
      askId: first,
      reason: 'turn-working',
    })
  })
})

function openBubbleOnWall(draft = '') {
  usePointAsk.getState().openBubble({
    targets: [target],
    anchor: [2, 1, 0],
    hit: { point: [2, 1, 0], normal: [0, 0, 1] },
    gesture: 'click',
    capturedAt: new Date().toISOString(),
    camera: null,
    crop: { state: 'failed' },
    draft,
    error: null,
  })
}

describe('an ask while Pascal is working', () => {
  test('is handed to the chat, which queues it as its own turn: the pin says queued', async () => {
    const handed: string[] = []
    unregisterHandler()
    unregisterHandler = registerPointAskHandler(async (submit) => {
      handed.push(submit.askId)
      emitter.emit('point-ask:status', { askId: submit.askId, status: 'queued' } as never)
      return { ok: true }
    })
    usePointAsk.setState({ busy: true })
    openBubbleOnWall()
    await sendBubble('make this wall taller', { x: 0, y: 0, width: 10, height: 10 })
    const state = usePointAsk.getState()
    expect(handed).toHaveLength(1)
    expect(state.bubble).toBeNull()
    expect(state.pinOrder).toHaveLength(1)
    expect(state.pins[handed[0]!]?.model.state).toBe('queued')
  })

  test("takes none of the running turn's changes, and its before is the scene when its own turn starts", async () => {
    unregisterHandler()
    unregisterHandler = registerPointAskHandler(async (submit) => {
      emitter.emit('point-ask:status', { askId: submit.askId, status: 'queued' } as never)
      return { ok: true }
    })
    // An earlier ask is running and writes.
    const running = await sendAsk()
    status(running, { status: 'working', sentence: 'Raising the wall' })
    usePointAsk.setState({ busy: true })
    openBubbleOnWall()
    await sendBubble('paint it', { x: 0, y: 0, width: 10, height: 10 })
    const queued = usePointAsk.getState().pinOrder.at(-1)!
    agentWrite(() => useScene.getState().updateNode(wall.id, { height: 3 }))
    status(running, { status: 'ended', outcome: 'completed', asked: false, wroteScene: true })
    expect(usePointAsk.getState().pins[queued]?.model.committed).toBe(false)
    // Its own turn starts and writes.
    status(queued, { status: 'working', sentence: 'Painting' })
    agentWrite(() => useScene.getState().updateNode(wall.id, { height: 3.4 }))
    status(queued, { status: 'ended', outcome: 'completed', asked: false, wroteScene: true })
    const pin = usePointAsk.getState().pins[queued]?.model
    expect(pin?.state).toBe('done')
    expect(pin?.changedTargetIds).toEqual([wall.id])
    expect(startCompare(queued)).toBe(true)
    // The state it started from: the running turn's change is in it.
    expect(wallHeight()).toBe(3)
  })

  test('a host that does not queue answers busy, and the bubble comes back with its reason', async () => {
    unregisterHandler()
    unregisterHandler = registerPointAskHandler(async () => ({
      ok: false,
      code: 'busy',
      message: 'Pascal is working. Ask again when it is done.',
    }))
    openBubbleOnWall()
    await sendBubble('make this wall taller', { x: 0, y: 0, width: 10, height: 10 })
    const state = usePointAsk.getState()
    expect(state.pinOrder).toHaveLength(0)
    expect(state.bubble?.error).toBe('Pascal is working. Ask again when it is done.')
  })
})

describe("which pin takes the scene's changes", () => {
  test("a stale pin never absorbs the running ask's changes: they go to its pin alone", async () => {
    // Two earlier asks said "working" and the pin never heard their end (a dropped turn, a reload of
    // the chat), and they point at the same wall.
    const staleWorking = await sendAsk()
    status(staleWorking, { status: 'working', sentence: 'Raising the wall' })
    const staleAsking = await sendAsk()
    status(staleAsking, { status: 'working', sentence: 'Painting' })
    status(staleAsking, { status: 'asking', question: 'Which colour?' })
    // The ask that runs now.
    const running = await sendAsk()
    status(running, { status: 'working', sentence: 'Reading your request' })
    agentWrite(() => useScene.getState().updateNode(wall.id, { height: 3.4 }))
    status(running, { status: 'ended', outcome: 'completed', asked: false, wroteScene: true })

    const { pins } = usePointAsk.getState()
    expect(pins[running]?.model.state).toBe('done')
    expect(pins[running]?.model.changedTargetIds).toEqual([wall.id])
    for (const stale of [staleWorking, staleAsking]) {
      expect(pins[stale]?.model.committed).toBe(false)
      expect(pins[stale]?.model.changedTargetIds).toEqual([])
      expect(pins[stale]?.model.alsoChangedIds).toEqual([])
      expect(pins[stale]?.model.state).not.toBe('done')
    }
  })

  test('changes made before any ask is working go to no pin', async () => {
    const waiting = await sendAsk()
    agentWrite(() => useScene.getState().updateNode(wall.id, { height: 3.4 }))
    status(waiting, { status: 'ended', outcome: 'completed', asked: false, wroteScene: false })
    expect(usePointAsk.getState().pins[waiting]?.model.committed).toBe(false)
  })

  test("a stale pin is settled when another ask starts working: it is not left 'working'", async () => {
    const stale = await sendAsk()
    status(stale, { status: 'working', sentence: 'Raising the wall' })
    const running = await sendAsk()
    status(running, { status: 'working', sentence: 'Reading your request' })
    expect(usePointAsk.getState().pins[stale]?.model.state).not.toBe('working')
    expect(usePointAsk.getState().pins[running]?.model.state).toBe('working')
  })

  test("a plain message's changes after an ask whose end was never heard are no ask's", async () => {
    const stale = await sendAsk()
    setPointAskBusy(true)
    status(stale, { status: 'working', sentence: 'Raising the wall' })
    // The chat goes idle without the pin having heard the end, then a plain message runs.
    setPointAskBusy(false)
    setPointAskBusy(true)
    agentWrite(() => useScene.getState().updateNode(wall.id, { height: 3.4 }))
    setPointAskBusy(false)
    const pin = usePointAsk.getState().pins[stale]?.model
    expect(pin?.committed).toBe(false)
    expect(pin?.state).not.toBe('working')
  })
})

describe('messages already queued or held', () => {
  // The chat queues an ask behind messages that wait (a queue held after an error needs Resume),
  // with no turn running: the bubble must say Queue, but nothing is working.
  test('a new ask waits behind them: the bubble says Queue, and no turn is said to run', () => {
    expect(asksWait(usePointAsk.getState())).toBe(false)
    setPointAskBehindQueue(true)
    const state = usePointAsk.getState()
    expect(asksWait(state)).toBe(true)
    expect(state.busy).toBe(false)
    setPointAskBehindQueue(false)
    expect(asksWait(usePointAsk.getState())).toBe(false)
  })

  test('a running turn makes asks wait too, whether or not anything is queued', () => {
    setPointAskBusy(true)
    expect(asksWait(usePointAsk.getState())).toBe(true)
    setPointAskBusy(false)
    expect(asksWait(usePointAsk.getState())).toBe(false)
  })

  test('they do not refuse a hold, nor settle a pin the way an idle chat does', async () => {
    const askId = await sendAsk()
    status(askId, { status: 'working', sentence: 'Raising the wall' })
    agentWrite(() => useScene.getState().updateNode(wall.id, { height: 3.4 }))
    status(askId, { status: 'ended', outcome: 'completed', asked: false, wroteScene: true })
    setPointAskBehindQueue(true)
    expect(startCompare(askId)).toBe(true)
  })
})

describe('pending ordinary crops and session option updates', () => {
  test('sending an ordinary click while its crop is still pending retains the picture', async () => {
    const received: PointAskSubmit[] = []
    const previousThree = getEditorThreeContext()
    const previousPoint = usePointAsk.getState()
    const listeners = new Map<string, Set<EventListener>>()
    let fulfill!: (crop: captureCrop.CapturedCrop) => void
    const deferred = new Promise<captureCrop.CapturedCrop>((resolve) => {
      fulfill = resolve
    })
    const cropSpy = spyOn(captureCrop, 'captureViewCrop').mockReturnValue(deferred)
    stopSession()
    unregisterHandler()
    unregisterHandler = registerPointAskHandler(async (submit) => {
      received.push(submit)
      return { ok: true }
    })
    try {
      globalThis.window = {
        innerWidth: 100,
        innerHeight: 100,
        addEventListener(type: string, listener: EventListener) {
          if (!listeners.has(type)) listeners.set(type, new Set())
          listeners.get(type)!.add(listener)
        },
        removeEventListener(type: string, listener: EventListener) {
          listeners.get(type)?.delete(listener)
        },
      } as never
      const canvas = {
        style: {},
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          right: 100,
          bottom: 100,
          width: 100,
          height: 100,
        }),
      } as unknown as HTMLCanvasElement
      const camera = new PerspectiveCamera(60, 1, 0.1, 100)
      camera.position.set(2, 3, 7)
      camera.lookAt(2, 1, 0)
      camera.updateMatrixWorld(true)
      setEditorThreeContext({ camera, raycaster: new Raycaster(), domElement: canvas })
      stopSession = startPointAskSession({ enrichedRegions: false, freeClick: false })
      usePointAsk.setState({
        active: true,
        playful: false,
        hover: {
          kind: 'wall',
          target,
          hit: { point: [2, 1, 0], normal: [0, 0, 1] },
          label: 'Wall',
          size: '4 m',
          position: 'on Level',
        } as never,
      })
      const pointer = (type: string, x: number, y: number) => {
        const event = {
          target: canvas,
          button: 0,
          pointerType: 'mouse',
          clientX: x,
          clientY: y,
          shiftKey: false,
          timeStamp: 0,
          preventDefault() {},
          stopImmediatePropagation() {},
        } as unknown as Event
        for (const listener of listeners.get(type) ?? []) listener(event)
      }
      pointer('pointerdown', 50, 50)
      pointer('pointerup', 50, 50)
      expect(cropSpy).toHaveBeenCalledTimes(1)
      expect(usePointAsk.getState().bubble?.crop.state).toBe('pending')

      const sending = sendBubble('what is this?', { x: 0, y: 0, width: 10, height: 10 })
      expect(usePointAsk.getState().bubble).toBeNull()
      fulfill({ dataUrl: 'data:image/jpeg;base64,ORDINARY', width: 512, height: 512 })
      await sending

      expect(received).toHaveLength(1)
      expect(received[0]!.context.image).toEqual({
        dataUrl: 'data:image/jpeg;base64,ORDINARY',
        width: 512,
        height: 512,
        marked: false,
      })
    } finally {
      cropSpy.mockRestore()
      stopSession()
      setEditorThreeContext(previousThree)
      usePointAsk.setState(previousPoint, true)
    }
  })

  test('calling startPointAskSession while already active updates enrichedRegions and freeClick', () => {
    const previousThree = getEditorThreeContext()
    const previousPoint = usePointAsk.getState()
    const listeners = new Map<string, Set<EventListener>>()
    const enrichedSpy = spyOn(enrichedCapture, 'captureEnrichedRegion').mockReturnValue(
      new Promise(() => {}),
    )
    stopSession()
    try {
      globalThis.window = {
        innerWidth: 100,
        innerHeight: 100,
        addEventListener(type: string, listener: EventListener) {
          if (!listeners.has(type)) listeners.set(type, new Set())
          listeners.get(type)!.add(listener)
        },
        removeEventListener(type: string, listener: EventListener) {
          listeners.get(type)?.delete(listener)
        },
      } as never
      const canvas = {
        style: {},
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          right: 100,
          bottom: 100,
          width: 100,
          height: 100,
        }),
      } as unknown as HTMLCanvasElement
      const camera = new PerspectiveCamera(60, 1, 0.1, 100)
      camera.position.set(2, 3, 7)
      camera.lookAt(2, 1, 0)
      camera.updateMatrixWorld(true)
      setEditorThreeContext({ camera, raycaster: new Raycaster(), domElement: canvas })
      const firstStop = startPointAskSession({ enrichedRegions: false, freeClick: false })
      const secondStop = startPointAskSession({ enrichedRegions: true, freeClick: true })
      expect(secondStop).toBe(firstStop)
      stopSession = secondStop

      usePointAsk.setState({ active: true, playful: false, hover: null })
      const pointer = (type: string, x: number, y: number) => {
        const event = {
          target: canvas,
          button: 0,
          pointerType: 'mouse',
          clientX: x,
          clientY: y,
          shiftKey: false,
          timeStamp: 0,
          preventDefault() {},
          stopImmediatePropagation() {},
        } as unknown as Event
        for (const listener of listeners.get(type) ?? []) listener(event)
      }
      pointer('pointerdown', 50, 50)
      pointer('pointerup', 50, 50)
      expect(usePointAsk.getState().bubble?.targets).toEqual([])
      expect(enrichedSpy).toHaveBeenCalledTimes(1)
    } finally {
      enrichedSpy.mockRestore()
      stopSession()
      setEditorThreeContext(previousThree)
      usePointAsk.setState(previousPoint, true)
    }
  })

  test('enriched region keeps the ordinary photo when ID-pass enrichment fails', async () => {
    const previousThree = getEditorThreeContext()
    const previousPoint = usePointAsk.getState()
    const listeners = new Map<string, Set<EventListener>>()
    const enrichedSpy = spyOn(enrichedCapture, 'captureEnrichedRegion').mockRejectedValue(
      new enrichedCapture.EnrichmentFallbackError('id pass timed out', {
        dataUrl: 'data:image/jpeg;base64,FALLBACK',
        width: 512,
        height: 384,
      }),
    )
    stopSession()
    try {
      globalThis.window = {
        innerWidth: 100,
        innerHeight: 100,
        addEventListener(type: string, listener: EventListener) {
          if (!listeners.has(type)) listeners.set(type, new Set())
          listeners.get(type)!.add(listener)
        },
        removeEventListener(type: string, listener: EventListener) {
          listeners.get(type)?.delete(listener)
        },
      } as never
      const canvas = {
        style: {},
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          right: 100,
          bottom: 100,
          width: 100,
          height: 100,
        }),
      } as unknown as HTMLCanvasElement
      const camera = new PerspectiveCamera(60, 1, 0.1, 100)
      camera.position.set(2, 3, 7)
      camera.lookAt(2, 1, 0)
      camera.updateMatrixWorld(true)
      setEditorThreeContext({ camera, raycaster: new Raycaster(), domElement: canvas })
      stopSession = startPointAskSession({ enrichedRegions: true, freeClick: true })

      usePointAsk.setState({ active: true, playful: false, hover: null })
      const pointer = (type: string, x: number, y: number) => {
        const event = {
          target: canvas,
          button: 0,
          pointerType: 'mouse',
          clientX: x,
          clientY: y,
          shiftKey: false,
          timeStamp: type === 'pointerdown' ? 0 : 100,
          preventDefault() {},
          stopImmediatePropagation() {},
        } as unknown as Event
        for (const listener of listeners.get(type) ?? []) listener(event)
      }
      pointer('pointerdown', 10, 10)
      pointer('pointermove', 60, 60)
      pointer('pointerup', 60, 60)
      await new Promise((resolve) => setTimeout(resolve, 10))
      const crop = usePointAsk.getState().bubble?.crop
      expect(crop?.state).toBe('ready')
      expect(crop?.dataUrl).toBe('data:image/jpeg;base64,FALLBACK')
      expect(crop?.enriched).toBeUndefined()
    } finally {
      enrichedSpy.mockRestore()
      stopSession()
      setEditorThreeContext(previousThree)
      usePointAsk.setState(previousPoint, true)
    }
  })

  test('enriched region center shifts both bubble and pin footprints onto the new center plane', async () => {
    const previousThree = getEditorThreeContext()
    const previousPoint = usePointAsk.getState()
    const listeners = new Map<string, Set<EventListener>>()
    let resolveEnriched: ((value: enrichedCapture.EnrichedCapture) => void) | undefined
    const makeEnriched = (center: [number, number, number]): enrichedCapture.EnrichedCapture => ({
      crop: { dataUrl: 'data:image/jpeg;base64,ENRICHED', width: 200, height: 200 },
      camera: {
        position: [2, 3, 7],
        target: [2, 1, 0],
        fov: 60,
        aspect: 1,
        projection: 'perspective',
      },
      region: {
        canvasRect: { x0: 10, y0: 10, x1: 60, y1: 60 },
        cropRect: { x0: 0, y0: 0, x1: 200, y1: 200 },
      },
      world: {
        center,
        topLeft: null,
        topRight: null,
        bottomLeft: null,
        bottomRight: null,
      },
      visible: [{ id: wall.id, share: 0.45 }],
      legend: [],
      legendText: '',
      rooms: [],
      segmented: { dataUrl: 'data:image/png;base64,MAP', width: 200, height: 200 },
    })
    const enrichedSpy = spyOn(enrichedCapture, 'captureEnrichedRegion').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveEnriched = resolve
        }),
    )
    const received: PointAskSubmit[] = []
    unregisterHandler()
    unregisterHandler = registerPointAskHandler(async (submit) => {
      received.push(submit)
      return { ok: true }
    })
    stopSession()
    try {
      globalThis.window = {
        innerWidth: 100,
        innerHeight: 100,
        addEventListener(type: string, listener: EventListener) {
          if (!listeners.has(type)) listeners.set(type, new Set())
          listeners.get(type)!.add(listener)
        },
        removeEventListener(type: string, listener: EventListener) {
          listeners.get(type)?.delete(listener)
        },
      } as never
      const canvas = {
        style: {},
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          right: 100,
          bottom: 100,
          width: 100,
          height: 100,
        }),
      } as unknown as HTMLCanvasElement
      const camera = new PerspectiveCamera(60, 1, 0.1, 100)
      camera.position.set(2, 8, 6)
      camera.lookAt(2, 0, 0)
      camera.updateMatrixWorld(true)
      setEditorThreeContext({ camera, raycaster: new Raycaster(), domElement: canvas })
      stopSession = startPointAskSession({ enrichedRegions: true, freeClick: true })

      usePointAsk.setState({ active: true, playful: false, hover: null })
      const pointer = (type: string, x: number, y: number) => {
        const event = {
          target: canvas,
          button: 0,
          pointerType: 'mouse',
          clientX: x,
          clientY: y,
          shiftKey: false,
          timeStamp: type === 'pointerdown' ? 0 : 100,
          preventDefault() {},
          stopImmediatePropagation() {},
        } as unknown as Event
        for (const listener of listeners.get(type) ?? []) listener(event)
      }

      // Case 1: enriched capture resolves while bubble is open.
      pointer('pointerdown', 25, 25)
      pointer('pointermove', 75, 75)
      pointer('pointerup', 75, 75)
      const shiftedBubbleCenter: [number, number, number] = [2, 1.5, -1]
      resolveEnriched?.(makeEnriched(shiftedBubbleCenter))
      await new Promise((resolve) => setTimeout(resolve, 10))
      const bubble = usePointAsk.getState().bubble
      expect(bubble?.anchor).toEqual(shiftedBubbleCenter)
      expect(bubble?.footprint?.center).toEqual(shiftedBubbleCenter)
      expect(bubble?.footprint?.corners).toHaveLength(4)
      for (const corner of bubble?.footprint?.corners ?? []) {
        expect(corner[1]).toBeCloseTo(shiftedBubbleCenter[1], 5)
      }

      // Case 2: sendBubble awaits pending enrichment and updates planted pin footprint together with anchor.
      usePointAsk.getState().closeBubble('dismiss')
      pointer('pointerdown', 25, 25)
      pointer('pointermove', 75, 75)
      pointer('pointerup', 75, 75)
      const sending = sendBubble('Inspect shifted region', { x: 0, y: 0, width: 10, height: 10 })
      const shiftedPinCenter: [number, number, number] = [1, 2.25, -0.5]
      resolveEnriched?.(makeEnriched(shiftedPinCenter))
      await sending
      expect(received).toHaveLength(1)
      const askId = usePointAsk.getState().pinOrder.at(-1)!
      const pin = usePointAsk.getState().pins[askId]
      expect(pin?.anchor).toEqual(shiftedPinCenter)
      expect(pin?.footprint?.center).toEqual(shiftedPinCenter)
      expect(pin?.footprint?.corners).toHaveLength(4)
      for (const corner of pin?.footprint?.corners ?? []) {
        expect(corner[1]).toBeCloseTo(shiftedPinCenter[1], 5)
      }
    } finally {
      enrichedSpy.mockRestore()
      stopSession()
      setEditorThreeContext(previousThree)
      usePointAsk.setState(previousPoint, true)
    }
  })

  test('dismissing an open persistent comment card by clicking the canvas does not plant a new bubble', () => {
    const previousThree = getEditorThreeContext()
    const previousPoint = usePointAsk.getState()
    const listeners = new Map<string, Set<EventListener>>()
    stopSession()
    try {
      globalThis.window = {
        innerWidth: 100,
        innerHeight: 100,
        addEventListener(type: string, listener: EventListener) {
          if (!listeners.has(type)) listeners.set(type, new Set())
          listeners.get(type)!.add(listener)
        },
        removeEventListener(type: string, listener: EventListener) {
          listeners.get(type)?.delete(listener)
        },
      } as never
      globalThis.document = {
        ...globalThis.document,
        querySelector: () => null,
      } as never
      const canvas = {
        style: {},
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          right: 100,
          bottom: 100,
          width: 100,
          height: 100,
        }),
      } as unknown as HTMLCanvasElement
      const camera = new PerspectiveCamera(60, 1, 0.1, 100)
      camera.position.set(2, 3, 7)
      camera.lookAt(2, 1, 0)
      camera.updateMatrixWorld(true)
      setEditorThreeContext({ camera, raycaster: new Raycaster(), domElement: canvas })
      stopSession = startPointAskSession({ freeClick: true })

      usePointAsk.getState().addPin({
        model: {
          askId: 'pin_persistent',
          state: 'queued',
          targetIds: [wall.id],
          changedTargetIds: [],
          alsoChangedIds: [],
          landed: 0,
          committed: false,
          ended: false,
          undone: false,
          kept: false,
          text: 'Check this wall',
          sentence: '',
        },
        behavior: 'persistent',
        anchor: [2, 1, 0],
        local: null,
        label: 'Wall',
        levelId: level.id,
        retireAt: null,
        createdAt: 0,
      })
      usePointAsk.setState({
        active: true,
        playful: false,
        hover: null,
        bubble: null,
        cardFor: 'pin_persistent',
      })

      let prevented = false
      let stopped = false
      const pointer = (type: string, x: number, y: number) => {
        const event = {
          target: canvas,
          button: 0,
          pointerType: 'mouse',
          clientX: x,
          clientY: y,
          shiftKey: false,
          timeStamp: 0,
          preventDefault() {
            prevented = true
          },
          stopImmediatePropagation() {
            stopped = true
          },
        } as unknown as Event
        for (const listener of listeners.get(type) ?? []) listener(event)
      }

      pointer('pointerdown', 50, 50)
      pointer('pointerup', 50, 50)
      expect(prevented).toBe(true)
      expect(stopped).toBe(true)
      expect(usePointAsk.getState().cardFor).toBeNull()
      expect(usePointAsk.getState().bubble).toBeNull()

      pointer('pointerdown', 50, 50)
      pointer('pointerup', 50, 50)
      expect(usePointAsk.getState().bubble).not.toBeNull()
    } finally {
      stopSession()
      setEditorThreeContext(previousThree)
      usePointAsk.setState(previousPoint, true)
    }
  })

  test('dismissing an enriched region aborts capture and cancels its id pass immediately', async () => {
    const previousThree = getEditorThreeContext()
    const previousPoint = usePointAsk.getState()
    const previousProjectId = useViewer.getState().projectId
    const listeners = new Map<string, Set<EventListener>>()
    let capturedSignal: AbortSignal | undefined
    const enrichedSpy = spyOn(enrichedCapture, 'captureEnrichedRegion').mockImplementation(
      (_rect, options) => {
        capturedSignal = options?.signal
        return new Promise(() => {})
      },
    )
    stopSession()
    try {
      globalThis.window = {
        innerWidth: 100,
        innerHeight: 100,
        addEventListener(type: string, listener: EventListener) {
          if (!listeners.has(type)) listeners.set(type, new Set())
          listeners.get(type)!.add(listener)
        },
        removeEventListener(type: string, listener: EventListener) {
          listeners.get(type)?.delete(listener)
        },
      } as never
      const canvas = {
        style: {},
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          right: 100,
          bottom: 100,
          width: 100,
          height: 100,
        }),
      } as unknown as HTMLCanvasElement
      const camera = new PerspectiveCamera(60, 1, 0.1, 100)
      camera.position.set(2, 3, 7)
      camera.lookAt(2, 1, 0)
      camera.updateMatrixWorld(true)
      setEditorThreeContext({ camera, raycaster: new Raycaster(), domElement: canvas })
      useViewer.setState({ projectId: 'proj_dismiss_cancel' })
      stopSession = startPointAskSession({ enrichedRegions: true, freeClick: false })
      usePointAsk.setState({ active: true, playful: false, hover: null })

      const pointer = (type: string, x: number, y: number) => {
        const event = {
          target: canvas,
          button: 0,
          pointerType: 'mouse',
          clientX: x,
          clientY: y,
          shiftKey: false,
          timeStamp: 0,
          preventDefault() {},
          stopImmediatePropagation() {},
        } as unknown as Event
        for (const listener of listeners.get(type) ?? []) listener(event)
      }

      pointer('pointerdown', 20, 20)
      pointer('pointermove', 80, 80)
      pointer('pointerup', 80, 80)
      expect(usePointAsk.getState().bubble?.crop.state).toBe('pending')
      expect(capturedSignal?.aborted).toBe(false)

      closeBubble('dismiss')
      expect(capturedSignal?.aborted).toBe(true)
      expect(usePointAsk.getState().bubble).toBeNull()

      // Directly exercise captureViewCrop + expectIdPass cancellation: aborting clears pending idPass
      // without issuing a delayed busy retry.
      const emittedIds: string[] = []
      const onGenerate = (event: { requestId?: string }) => {
        if (event.requestId) emittedIds.push(event.requestId)
      }
      emitter.on('camera-controls:generate-thumbnail', onGenerate as never)
      const controller = new AbortController()
      try {
        const pending = captureCrop.captureViewCrop(
          { x0: 10, y0: 10, x1: 60, y1: 60 },
          { pad: 0, idPass: true, signal: controller.signal },
        )
        expect(emittedIds).toHaveLength(1)
        const requestId = emittedIds[0]!
        controller.abort()
        await expect(pending).rejects.toThrow('Capture cancelled')
        expect(enrichedRequests.isIdPassCancelled(requestId)).toBe(true)
        expect(enrichedRequests.takeIdPass(requestId)).toBeNull()
        expect(emittedIds).toHaveLength(1)
      } finally {
        emitter.off('camera-controls:generate-thumbnail', onGenerate as never)
      }
    } finally {
      enrichedSpy.mockRestore()
      stopSession()
      useViewer.setState({ projectId: previousProjectId })
      setEditorThreeContext(previousThree)
      usePointAsk.setState(previousPoint, true)
    }
  })
})
