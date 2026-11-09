import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  BuildingNode,
  clearSceneHistory,
  emitter,
  endScenePreview,
  ItemNode,
  isScenePreviewing,
  LevelNode,
  registerPointAskHandler,
  useScene,
  ZoneNode,
} from '@pascal-app/core'
import { type BubbleTarget, usePointAsk } from '../../store/use-point-ask'
import { endCompare, sendBubble, startCompare, startPointAskSession } from './session'

// Hold to see before, for a turn that BUILDS: "Furnish this room" on an empty room creates nodes
// the "before" has never heard of. The ask-flow suite holds turns that only change a wall; the
// owner held an ask that furnished an empty room (13 October) and the furniture stayed. Real
// stores; only the chat's words (statuses) and the DOM are stood in for.

const building = BuildingNode.parse({ id: 'building_created' })
const level = LevelNode.parse({ id: 'level_created', parentId: building.id })
const room = ZoneNode.parse({
  id: 'zone_created',
  parentId: level.id,
  name: 'Formal Dining Room',
  polygon: [
    [0, 0],
    [5, 0],
    [5, 4],
    [0, 4],
  ],
})
building.children = [level.id]
level.children = [room.id]

const original = useScene.getState()
const originalWindow = globalThis.window
const originalDocument = globalThis.document
const originalRaf = globalThis.requestAnimationFrame
const originalCancelRaf = globalThis.cancelAnimationFrame
let stopSession = () => {}
let unregisterHandler = () => {}

const target = {
  id: room.id,
  type: 'zone',
  name: 'Formal Dining Room',
  levelId: level.id,
  size: { length: 5, height: 0, thickness: 4 },
  box: { min: [0, 0, 0], max: [5, 2.6, 4] },
} as unknown as BubbleTarget

const furniture = (id: string, position: [number, number, number]) =>
  ItemNode.parse({
    id,
    parentId: level.id,
    position,
    asset: {
      id: `asset_${id}`,
      name: 'Chair',
      category: 'chair',
      src: '/fixture-chair.glb',
      thumbnail: '',
      dimensions: [0.5, 0.8, 0.5],
    },
  })

function resetScene() {
  useScene.setState({
    nodes: { [building.id]: building, [level.id]: level, [room.id]: room },
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

async function sendAsk(text = 'furnish this room') {
  usePointAsk.getState().openBubble({
    targets: [target],
    anchor: [2.5, 0, 2],
    hit: { point: [2.5, 0, 2], normal: [0, 1, 0] },
    gesture: 'click',
    capturedAt: new Date().toISOString(),
    camera: null,
    crop: { state: 'failed' },
    draft: '',
    error: null,
  })
  await sendBubble(text, { x: 0, y: 0, width: 10, height: 10 })
  const askId = usePointAsk.getState().pinOrder.at(-1)
  if (!askId) throw new Error('the ask did not plant a pin')
  return askId
}

const status = (askId: string, rest: Record<string, unknown>) =>
  emitter.emit('point-ask:status', { askId, ...rest } as never)

/** A scene action of the agent: history tracks it, and is left as it was found. */
function agentWrite(write: () => void) {
  const wasTracking = useScene.temporal.getState().isTracking
  useScene.temporal.getState().resume()
  try {
    write()
  } finally {
    if (!wasTracking) useScene.temporal.getState().pause()
  }
}

const has = (id: string) => Boolean(useScene.getState().nodes[id as never])

describe('hold to see before, for a turn that builds', () => {
  test('the furniture the turn placed is not in the before', async () => {
    const askId = await sendAsk()
    status(askId, { status: 'working', sentence: 'Furnishing the room' })
    agentWrite(() =>
      useScene.getState().createNodes([
        { node: furniture('item_table', [2.5, 0, 2]), parentId: level.id },
        { node: furniture('item_chair_a', [1.5, 0, 2]), parentId: level.id },
        { node: furniture('item_chair_b', [3.5, 0, 2]), parentId: level.id },
      ] as never),
    )
    status(askId, { status: 'ended', outcome: 'completed', asked: false, wroteScene: true })
    expect(usePointAsk.getState().pins[askId]?.model.state).toBe('done')
    expect(has('item_table')).toBe(true)

    expect(startCompare(askId)).toBe(true)
    expect(isScenePreviewing()).toBe(true)
    expect(has('item_table')).toBe(false)
    expect(has('item_chair_a')).toBe(false)
    expect(has('item_chair_b')).toBe(false)
    expect(
      (useScene.getState().nodes[level.id] as { children: string[] }).children.includes(
        'item_table',
      ),
    ).toBe(false)

    endCompare()
    expect(has('item_table')).toBe(true)
    expect(has('item_chair_b')).toBe(true)
  })

  test('furniture placed in several steps, one after another, is all out of the before', async () => {
    const askId = await sendAsk()
    status(askId, { status: 'working', sentence: 'Furnishing the room' })
    agentWrite(() =>
      useScene
        .getState()
        .createNodes([{ node: furniture('item_table', [2.5, 0, 2]), parentId: level.id }] as never),
    )
    agentWrite(() =>
      useScene
        .getState()
        .createNodes([
          { node: furniture('item_chair_a', [1.5, 0, 2]), parentId: level.id },
        ] as never),
    )
    status(askId, { status: 'ended', outcome: 'completed', asked: false, wroteScene: true })
    expect(startCompare(askId)).toBe(true)
    expect(has('item_table')).toBe(false)
    expect(has('item_chair_a')).toBe(false)
  })
})
