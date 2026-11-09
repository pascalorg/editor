import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  BuildingNode,
  clearSceneHistory,
  emitter,
  endScenePreview,
  isScenePreviewing,
  LevelNode,
  registerPointAskHandler,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { asksWait, type BubbleTarget, usePointAsk } from '../../store/use-point-ask'
import { setPointAskBehindQueue, setPointAskBusy } from './host-api'
import { endCompare, sendBubble, startCompare, startPointAskSession } from './session'

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
