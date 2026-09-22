import { afterEach, beforeEach, expect, test } from 'bun:test'
import { LevelNode, useScene, WallNode } from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { bindWallSplitPointer } from './split-pointer'
import { closeWallSplit, openWallSplit } from './split-session'
import { useWallSplit } from './split-store'

// Restore by descriptor: assigning `undefined` back would leave an own `window`
// property behind, and the next file's DOM shim would then believe one exists.
const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
const previousNode = Object.getOwnPropertyDescriptor(globalThis, 'Node')
const events = new EventTarget()
const surface = new EventTarget() as EventTarget & { contains: (node: unknown) => boolean }
surface.contains = (node) => node === surface
const level = LevelNode.parse({ children: [] })
const wall = WallNode.parse({ parentId: level.id, start: [0, 0], end: [8, 0] })
level.children = [wall.id]
let cleanup = () => {}
const emit = (type: string, distance: number, button = 0, altKey = false) => {
  const event = new Event(type, { cancelable: true })
  Object.assign(event, { clientX: distance, pointerId: 1, button, buttons: 0, altKey })
  events.dispatchEvent(event)
  return event
}
const scroll = (deltaY: number, at: number, target: unknown = surface, deltaMode = 0) => {
  const event = new Event('wheel', { cancelable: true })
  Object.assign(event, { deltaY, deltaMode, ctrlKey: false })
  Object.defineProperty(event, 'target', { value: target })
  Object.defineProperty(event, 'timeStamp', { value: at })
  events.dispatchEvent(event)
  return event
}
const cutAt = () => useWallSplit.getState().draft?.preview.distances
beforeEach(() => {
  globalThis.window = events as unknown as Window & typeof globalThis
  // `instanceof Node` guards the wheel target; the fake surface stands in for one.
  ;(globalThis as { Node?: unknown }).Node = EventTarget
  useEditor.setState((s) => ({
    snappingModeByContext: { ...s.snappingModeByContext, polygon: 'grid' },
    gridSnapStep: 0.5,
  }))
  useScene.setState({
    nodes: { [level.id]: level, [wall.id]: wall },
    rootNodeIds: [level.id],
    readOnly: false,
  })
  useScene.temporal.getState().clear()
  openWallSplit(wall)
  cleanup = bindWallSplitPointer(surface as unknown as Element, (event) =>
    event.clientX >= 0 ? event.clientX : null,
  )
})
afterEach(() => {
  cleanup()
  closeWallSplit()
  if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
  else Reflect.deleteProperty(globalThis, 'window')
  if (previousNode) Object.defineProperty(globalThis, 'Node', previousNode)
  else Reflect.deleteProperty(globalThis, 'Node')
})

test('the single cut follows the pointer on the grid; Alt places it freely', () => {
  emit('pointermove', 2.2)
  expect(cutAt()).toEqual([2])
  emit('pointermove', 3.3, 0, true)
  expect(cutAt()).toEqual([3.3])
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
})
test('scrolling over the viewport changes the cut count; elsewhere it scrolls', () => {
  expect(scroll(-120, 1000).defaultPrevented).toBe(true)
  expect(cutAt()).toEqual([8 / 3, 16 / 3])
  expect(scroll(-120, 1600, {}).defaultPrevented).toBe(false)
  expect(useWallSplit.getState().draft?.cuts).toBe(2)
  // Evenly spaced cuts ignore the pointer.
  emit('pointermove', 1)
  expect(cutAt()).toEqual([8 / 3, 16 / 3])
})
test('each notch of a notched wheel is one cut, however few pixels it reports', () => {
  // Slow notches (macOS reports a handful of pixels each), then Firefox line mode.
  for (const [at, cuts] of [
    [1000, 2],
    [1150, 3],
    [1300, 4],
  ] as const) {
    scroll(-4, at)
    expect(useWallSplit.getState().draft?.cuts).toBe(cuts)
  }
  scroll(3, 1310, surface, 1)
  expect(useWallSplit.getState().draft?.cuts).toBe(3)
})
test('a continuous trackpad stream steps by travel after its first event', () => {
  scroll(-10, 1000)
  expect(useWallSplit.getState().draft?.cuts).toBe(2)
  for (let at = 1016; at <= 1080; at += 16) scroll(-10, at)
  expect(useWallSplit.getState().draft?.cuts).toBe(2)
  scroll(-10, 1096)
  expect(useWallSplit.getState().draft?.cuts).toBe(3)
})
test('left click commits the release mark once; orbit and out-of-wall clicks do not cut', () => {
  expect(emit('pointerdown', 3, 2).defaultPrevented).toBe(false)
  emit('pointerup', 3, 2)
  emit('pointerdown', -1)
  emit('pointerup', -1)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  expect(emit('pointerdown', 2).defaultPrevented).toBe(true)
  emit('pointermove', 3.5)
  expect(emit('pointerup', 3.5).defaultPrevented).toBe(true)
  expect((useScene.getState().nodes[wall.id] as WallNode).end).toEqual([3.5, 0])
  expect(useScene.temporal.getState().pastStates).toHaveLength(1)
})
test('cancelled pointer or release off-wall never commits a stale mark', () => {
  emit('pointerdown', 2)
  emit('pointercancel', 2)
  emit('pointerup', 2)
  emit('pointerdown', 3)
  emit('pointerup', -1)
  expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  cleanup()
  emit('pointermove', 6)
  expect(cutAt()).toEqual([3])
})
