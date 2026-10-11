import { describe, expect, test } from 'bun:test'
import {
  BIG_BOX_DISC,
  BUBBLE_CLOSE_MS,
  BUBBLE_GAP,
  BUBBLE_W,
  CARD_AUTO_MS,
  CARD_MS,
  CHECK_STROKE_MS,
  CLICK_SLOP_PX,
  CORNER_SPRING,
  DWELL_MS,
  EASE_IN_OUT,
  EASE_OUT,
  ENTER_MS,
  MAX_TARGETS,
  MOMENTUM,
  PIN_DROP_MS,
  PIN_RETIRE_MS,
  PIN_RING_MS,
  PRESS_MS,
  SIDE_HYSTERESIS_MS,
  SPRING,
  TAP_LATCH_MS,
  THIN_TARGET_PX,
  VIEWPORT_INSET,
} from './choreography'

// One place for every number the motion spec names, so the bubble, the pin, the card and the
// outline cannot drift apart: the direction's tokens (chat-juice-direction.md) and the
// choreography section of point-and-ask-spec.md, with the prototype's values where they differ.
describe('the choreography tokens', () => {
  test('the direction’s easings, springs and durations', () => {
    expect(EASE_OUT).toBe('cubic-bezier(0.23, 1, 0.32, 1)')
    expect(EASE_IN_OUT).toBe('cubic-bezier(0.77, 0, 0.175, 1)')
    expect(SPRING).toEqual({ damping: 1, response: 0.35 })
    expect(MOMENTUM).toEqual({ damping: 0.8, response: 0.35 })
    expect(PRESS_MS).toBe(120)
    expect(ENTER_MS).toBe(180)
    expect(CARD_MS).toBe(220)
  })

  test('the outline’s corners travel on a quicker spring than the bubble’s', () => {
    expect(CORNER_SPRING).toEqual({ damping: 1, response: 0.16 })
    expect(CORNER_SPRING.response).toBeLessThan(SPRING.response)
  })

  test('the spec’s own values', () => {
    expect(CLICK_SLOP_PX).toBe(6)
    expect(DWELL_MS).toBe(120)
    expect(SIDE_HYSTERESIS_MS).toBe(150)
    expect(TAP_LATCH_MS).toBe(200)
    expect(CARD_AUTO_MS).toBe(4000)
    expect(PIN_RETIRE_MS).toBe(8000)
    expect(CHECK_STROKE_MS).toBe(240)
    expect(MAX_TARGETS).toBe(12)
    expect(THIN_TARGET_PX).toBe(6)
  })

  test('the prototype’s pin and bubble values', () => {
    expect(PIN_DROP_MS).toBe(320)
    expect(PIN_RING_MS).toBe(560)
    expect(BUBBLE_W).toBe(320)
    expect(BUBBLE_GAP).toBe(16)
    expect(VIEWPORT_INSET).toBe(12)
    expect(BIG_BOX_DISC).toBe(48)
  })

  test('an exit is quicker than an entrance', () => {
    expect(BUBBLE_CLOSE_MS).toBeLessThan(ENTER_MS)
  })
})
