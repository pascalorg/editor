import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  BuildingNode,
  clearSceneHistory,
  emitter,
  LevelNode,
  type PointAskSubmit,
  registerPointAskHandler,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { type BubbleTarget, type PinRecord, usePointAsk } from '../../store/use-point-ask'
import { createPin } from './pin-machine'
import { planRetry } from './retry'
import { retryAsk, sendBubble, startPointAskSession } from './session'

// Retrying an ask from the chat: the same words, targets, camera and crop as a new ask with its own
// pin. Architect's Retry goes through here; a finished ask keeps its pin (its compare and Undo
// stay), an errored one is replaced, as "Try again" does.

const submit: PointAskSubmit = {
  askId: 'ask_old',
  context: {
    askId: 'ask_old',
    camera: {
      aspect: 1.6,
      fov: 50,
      position: [0, 1, 5],
      projection: 'perspective',
      target: [0, 1, 0],
    },
    capturedAt: '2026-10-12T10:00:00.000Z',
    gesture: 'click',
    image: { dataUrl: 'data:image/jpeg;base64,AAAA', height: 320, marked: true, width: 512 },
    kind: 'scene-point',
    level: { id: 'level_0', name: 'Ground floor' },
    source: 'editor',
    targets: [],
    version: 1,
  },
  from: { height: 24, width: 120, x: 600, y: 300 },
  text: 'make this window wider',
}

function pinIn(state: 'error' | 'done'): PinRecord {
  const model = createPin({ askId: 'ask_old', targetIds: ['window_kitchen_n1'], text: submit.text })
  return {
    anchor: [0, 1, 0],
    createdAt: 1,
    label: 'Window · Kitchen',
    levelId: 'level_0',
    local: null,
    model: { ...model, state } as PinRecord['model'],
    retireAt: 123,
    submit,
  }
}

describe('planRetry', () => {
  test('the new ask has its own id, the same words, targets, camera and crop', () => {
    const plan = planRetry(pinIn('done'), 'ask_new', 5)
    expect(plan?.submit.askId).toBe('ask_new')
    expect(plan?.submit.context.askId).toBe('ask_new')
    expect(plan?.submit.text).toBe('make this window wider')
    expect(plan?.submit.context.camera).toEqual(submit.context.camera)
    expect(plan?.submit.context.image).toEqual(submit.context.image)
    expect(plan?.pin.model.askId).toBe('ask_new')
    expect(plan?.pin.model.targetIds).toEqual(['window_kitchen_n1'])
    expect(plan?.pin.retireAt).toBeNull()
    expect(plan?.pin.createdAt).toBe(5)
  })

  test('an errored pin is replaced (Try again); any other state keeps its pin, with its compare and Undo', () => {
    expect(planRetry(pinIn('error'), 'ask_new', 5)?.keepOld).toBe(false)
    expect(planRetry(pinIn('done'), 'ask_new', 5)?.keepOld).toBe(true)
  })

  test('a pin that kept no submit cannot be retried', () => {
    const { submit: _gone, ...noSubmit } = pinIn('error')
    expect(planRetry(noSubmit as PinRecord, 'ask_new', 5)).toBeNull()
  })
})

const building = BuildingNode.parse({ id: 'building_retry' })
const level = LevelNode.parse({ id: 'level_retry', parentId: building.id })
const wall = WallNode.parse({
  id: 'wall_retry',
  parentId: level.id,
  start: [0, 0],
  end: [4, 0],
  height: 2.6,
})
building.children = [level.id]
level.children = [wall.id]
const target = {
  id: wall.id,
  type: 'wall',
  name: 'Wall',
  levelId: level.id,
  size: { length: 4, height: 2.6, thickness: 0.2 },
  box: { min: [0, 0, -0.1], max: [4, 2.6, 0.1] },
} as unknown as BubbleTarget

const original = useScene.getState()
const originalWindow = globalThis.window
const originalDocument = globalThis.document
const originalRaf = globalThis.requestAnimationFrame
const originalCancelRaf = globalThis.cancelAnimationFrame
let stopSession = () => {}
let unregister = () => {}
let handed: PointAskSubmit[] = []

beforeEach(() => {
  const stub = { addEventListener() {}, removeEventListener() {} }
  globalThis.window = { ...stub, innerWidth: 1280, innerHeight: 800 } as never
  globalThis.document = { ...stub, hidden: false } as never
  globalThis.requestAnimationFrame = (callback) => {
    callback(0)
    return 0
  }
  globalThis.cancelAnimationFrame = () => {}
  useScene.setState({
    nodes: { [building.id]: building, [level.id]: level, [wall.id]: wall },
    rootNodeIds: [building.id],
    dirtyNodes: new Set(),
    readOnly: false,
  } as never)
  clearSceneHistory()
  usePointAsk.setState({ pins: {}, pinOrder: [], bubble: null, comparing: null, busy: false })
  handed = []
  unregister = registerPointAskHandler(async (sent) => {
    handed.push(sent)
    return { ok: true }
  })
  stopSession = startPointAskSession()
})

afterEach(() => {
  stopSession()
  unregister()
  useScene.setState(original, true)
  clearSceneHistory()
  globalThis.window = originalWindow
  globalThis.document = originalDocument
  if (originalRaf) globalThis.requestAnimationFrame = originalRaf
  else Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
  if (originalCancelRaf) globalThis.cancelAnimationFrame = originalCancelRaf
  else Reflect.deleteProperty(globalThis, 'cancelAnimationFrame')
})

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

describe('retryAsk', () => {
  test('hands the same words and targets to the chat as a new ask, and says it did', async () => {
    const askId = await sendAsk()
    status(askId, { status: 'working' })
    status(askId, { status: 'ended', outcome: 'completed', asked: false, wroteScene: true })
    expect(await retryAsk(askId)).toBe(true)
    expect(handed).toHaveLength(2)
    expect(handed[1]?.askId).not.toBe(askId)
    expect(handed[1]?.context.askId).toBe(handed[1]?.askId)
    expect(handed[1]?.text).toBe('make this wall taller')
    expect(handed[1]?.context.targets.map((t) => t.id)).toEqual([wall.id])
  })

  test('a finished ask keeps its pin, so its compare and Undo stay', async () => {
    const askId = await sendAsk()
    status(askId, { status: 'working' })
    status(askId, { status: 'ended', outcome: 'completed', asked: false, wroteScene: true })
    await retryAsk(askId)
    const { pinOrder, pins } = usePointAsk.getState()
    expect(pinOrder).toHaveLength(2)
    expect(pins[askId]).toBeDefined()
    const next = pinOrder.find((id) => id !== askId)
    expect(next && pins[next]?.model.state).toBe('sent')
  })

  test('an errored ask is replaced by the retry, as "Try again" does', async () => {
    const askId = await sendAsk()
    status(askId, { status: 'working' })
    status(askId, {
      status: 'ended',
      outcome: 'errored',
      asked: false,
      wroteScene: false,
      error: 'x',
    })
    await retryAsk(askId)
    const { pinOrder, pins } = usePointAsk.getState()
    expect(pinOrder).toHaveLength(1)
    expect(pins[askId]).toBeUndefined()
  })

  test("says it could not when the pin is gone (a reload, a collaborator's ask)", async () => {
    expect(await retryAsk('ask_unknown')).toBe(false)
    expect(handed).toHaveLength(0)
  })
})
