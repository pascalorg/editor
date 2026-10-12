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
import { type BubbleTarget, usePointAsk } from '../../store/use-point-ask'
import { endCompare, sendBubble, startCompare, startPointAskSession } from './session'

// The whole hold-to-see-before path with the real stores: the session listening to the chat's
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
  const askId = usePointAsk.getState().pinOrder[0]
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
