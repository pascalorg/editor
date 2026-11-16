import { expect, test } from 'bun:test'
import { emitter } from '@pascal-app/core'
import { Object3D, Vector3 } from 'three'
import { useNodeEvents, useViewer } from '../index'
import {
  createPointerGestureTracker,
  isTap,
  selectionClickAllowed,
  trackPointerGestures,
} from './pointer-gesture'

const sample = (x = 0, timeStamp = 0, pointerId = 1) => ({
  pointerId,
  button: 0,
  clientX: x,
  clientY: 0,
  timeStamp,
  isPrimary: true,
})

test('tap classification uses matching primary pointers, maximum excursion and elapsed time', () => {
  const down = sample()
  const gesture = { down, maxTravel: 3, cancelled: false }
  expect(isTap(gesture, sample(3, 100), {})).toBe(true)
  expect(isTap({ ...gesture, maxTravel: 12 }, sample(0, 100), {})).toBe(false)
  expect(isTap(gesture, sample(7, 100), {})).toBe(false)
  expect(isTap(gesture, sample(3, 501), { maxDurationMs: 500 })).toBe(false)
  expect(isTap(gesture, sample(3, 500), { maxDurationMs: 500, maxTravelPx: 4 })).toBe(true)
  expect(isTap(gesture, sample(0, 100, 2), {})).toBe(false)
  expect(isTap(gesture, { ...sample(), button: 2 }, {})).toBe(false)
  expect(isTap({ ...gesture, down: { ...down, isPrimary: false } }, sample(), {})).toBe(false)
})

test('multi-touch and cancellation remain rejected through pointer-up and click', () => {
  const tracker = createPointerGestureTracker({})
  tracker.down(sample())
  tracker.down(sample(0, 0, 2))
  tracker.up(sample(0, 50, 2))
  tracker.up(sample(0, 100))
  expect(tracker.allowsClick()).toBe(false)
  tracker.down(sample())
  tracker.cancel()
  tracker.up(sample())
  expect(tracker.allowsClick()).toBe(false)
  tracker.down(sample())
  tracker.up(sample(3, 100))
  expect(tracker.allowsClick()).toBe(true)
  expect(tracker.allowsClick()).toBe(true)
})

// A DOM event source with an explicit clock; no timers or browser are needed.
function pointerSource() {
  const win = new EventTarget()
  const doc = Object.assign(new EventTarget(), { defaultView: win, hidden: false })
  const canvas = { ownerDocument: doc, contains: () => true }
  const send = (type: string, data = sample()) => {
    const event = new Event(type)
    for (const [key, value] of Object.entries(data)) Object.defineProperty(event, key, { value })
    win.dispatchEvent(event)
  }
  return { win, doc, canvas, send }
}

test('live click synthesis and empty-space deselect share the tap result; legacy dispatch is identical', () => {
  const previous = useViewer.getState()
  const source = pointerSource()
  const events = useNodeEvents({ id: 'item_gesture', type: 'item' } as never, 'item')
  const clicks: unknown[] = []
  const onClick = (event: unknown) => clicks.push(event)
  emitter.on('node:click', onClick)
  const up = () =>
    events.onPointerUp({
      button: 0,
      object: new Object3D(),
      point: new Vector3(),
      stopPropagation() {},
    } as never)
  let stop = () => {}
  try {
    useViewer.setState({ cameraDragging: false, inputDragging: false })
    up() // Today's dispatch does not require a matching down.
    expect(clicks).toHaveLength(1)
    useViewer.setState({ cameraDragging: true })
    up()
    expect(clicks).toHaveLength(1)
    stop = trackPointerGestures(source.canvas as never, { maxDurationMs: 500 })
    for (const [travel, duration, expected] of [
      [3, 100, true],
      [12, 100, false],
      [0, 501, false],
    ] as const) {
      source.send('pointerdown')
      source.send('pointermove', sample(travel, duration / 2))
      source.send('pointerup', sample(travel, duration))
      const before = clicks.length
      up()
      expect(clicks.length - before).toBe(expected ? 1 : 0)
      // This same retained result gates the subsequent canvas click's deselect.
      expect(selectionClickAllowed(true, false)).toBe(expected)
    }
    source.send('pointerdown')
    source.send('pointerdown', sample(0, 0, 2))
    source.send('pointerup', sample(0, 100))
    const before = clicks.length
    up()
    expect(clicks).toHaveLength(before)
    for (const type of ['pointercancel', 'blur', 'hidden']) {
      source.send('pointerdown')
      if (type === 'hidden') {
        source.doc.hidden = true
        source.doc.dispatchEvent(new Event('visibilitychange'))
      } else source.send(type)
      source.send('pointerup')
      expect(selectionClickAllowed(false, false)).toBe(false)
    }
  } finally {
    stop()
    emitter.off('node:click', onClick)
    useViewer.setState(previous, true)
  }
})
