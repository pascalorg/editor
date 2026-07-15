import { describe, expect, test } from 'bun:test'
import {
  cabinetConnectedDepthBounds,
  cabinetResizeUpperBound,
  connectedCabinetDepthUpperBound,
  MAX_CABINET_DEPTH,
  MAX_CABINET_WIDTH,
} from '../resize-limits'

describe('cabinet resize limits', () => {
  test('caps new cabinet width and depth at usable maximums', () => {
    expect(MAX_CABINET_WIDTH).toBe(1.2)
    expect(MAX_CABINET_DEPTH).toBe(0.8)
  })

  test('does not force an oversized legacy cabinet smaller when dragging begins', () => {
    expect(cabinetResizeUpperBound(1.4, MAX_CABINET_WIDTH)).toBe(1.4)
    expect(cabinetResizeUpperBound(0.95, MAX_CABINET_DEPTH)).toBe(0.95)
  })

  test('stops a connected depth resize before its source cabinet becomes too narrow', () => {
    expect(connectedCabinetDepthUpperBound(0.5, 0.4)).toBeCloseTo(0.6)
    expect(connectedCabinetDepthUpperBound(0.5, 0.3)).toBeCloseTo(0.5)
    expect(connectedCabinetDepthUpperBound(0.5)).toBeCloseTo(MAX_CABINET_DEPTH)
  })

  test('keeps every compensating cabinet within the width limits in both directions', () => {
    const oneSide = cabinetConnectedDepthBounds(0.8, [0.9])
    expect(oneSide.min).toBeCloseTo(0.5)
    expect(oneSide.max).toBeCloseTo(0.8)
    const bothSides = cabinetConnectedDepthBounds(0.5, [0.4, 0.6])
    expect(bothSides.min).toBeCloseTo(0.3)
    expect(bothSides.max).toBeCloseTo(0.6)
  })
})
