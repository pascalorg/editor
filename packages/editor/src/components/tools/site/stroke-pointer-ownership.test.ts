import { describe, expect, test } from 'bun:test'
import {
  type StrokePointerAction,
  type StrokePointerEvent,
  strokePointerAction,
} from './stroke-pointer-ownership'

/**
 * A stroke carries uncommitted state, so every one of these has a silent failure
 * mode rather than a visible one — which is why the matrix is asserted rather
 * than left to the four call sites.
 */
describe('strokePointerAction', () => {
  const OWNER = 1
  const OTHER = 2
  const act = (event: StrokePointerEvent, pointerId: number, ownerPointerId: number | null) =>
    strokePointerAction({ event, pointerId, ownerPointerId })

  describe('with no stroke in flight', () => {
    test('a down starts one', () => {
      expect(act('down', OWNER, null)).toBe('begin')
    })

    test('every other event is ignored', () => {
      // Notably `up`: the pointerup of a click that never began a stroke (over the
      // eyedropper, or off the field) must not commit anything.
      for (const event of ['move', 'up', 'cancel'] as StrokePointerEvent[]) {
        expect(act(event, OWNER, null)).toBe('ignore')
      }
    })
  })

  describe('the owning pointer drives the stroke', () => {
    test('move paints, up commits', () => {
      expect(act('move', OWNER, OWNER)).toBe('apply')
      expect(act('up', OWNER, OWNER)).toBe('commit')
    })

    test('cancel abandons where up commits', () => {
      // The browser fires `cancel` when it takes the gesture away, so the user
      // never finished the stroke. These two must not be the same handler — they
      // were, and a cancelled drag persisted.
      expect(act('cancel', OWNER, OWNER)).toBe('abandon')
      expect(act('cancel', OWNER, OWNER)).not.toBe(act('up', OWNER, OWNER))
    })
  })

  describe('a second pointer', () => {
    test('down abandons the stroke in flight', () => {
      // Two fingers is a pinch-zoom. Abandoning restores the ground exactly,
      // because nothing was committed yet.
      expect(act('down', OTHER, OWNER)).toBe('abandon')
    })

    test('never touches the owner’s stroke any other way', () => {
      for (const event of ['move', 'up', 'cancel'] as StrokePointerEvent[]) {
        expect(act(event, OTHER, OWNER)).toBe('ignore')
      }
    })

    test('lifting it does not commit — the bug this replaced', () => {
      // The old handler keyed off `strokeRef` alone, so a resting finger lifting
      // committed a stroke the other finger was still drawing.
      expect(act('up', OTHER, OWNER)).not.toBe('commit')
    })
  })

  test('only a down can begin, and only an owning up can commit', () => {
    // Swept over the whole matrix rather than spot-checked: these are the two
    // actions that write to the scene, so anything else reaching them is a bug.
    const events: StrokePointerEvent[] = ['down', 'move', 'up', 'cancel']
    const owners: Array<number | null> = [null, OWNER]
    const seen: Array<[StrokePointerEvent, number, number | null, StrokePointerAction]> = []
    for (const event of events) {
      for (const pointerId of [OWNER, OTHER]) {
        for (const ownerPointerId of owners) {
          seen.push([event, pointerId, ownerPointerId, act(event, pointerId, ownerPointerId)])
        }
      }
    }
    expect(seen.filter(([, , , action]) => action === 'begin').map(([event]) => event)).toEqual([
      'down',
      'down',
    ])
    expect(
      seen
        .filter(([, , , action]) => action === 'commit')
        .map(([event, pointerId, ownerPointerId]) => [event, pointerId === ownerPointerId]),
    ).toEqual([['up', true]])
  })
})
