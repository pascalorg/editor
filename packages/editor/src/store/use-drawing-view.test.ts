import { describe, expect, test } from 'bun:test'
import { normalizeDrawingType } from './use-drawing-view'

describe('normalizeDrawingType', () => {
  test('restores every persistent construction drawing type', () => {
    expect(normalizeDrawingType('floor-plan')).toBe('floor-plan')
    expect(normalizeDrawingType('foundation-plan')).toBe('foundation-plan')
    expect(normalizeDrawingType('reflected-ceiling-plan')).toBe('reflected-ceiling-plan')
    expect(normalizeDrawingType('roof-plan')).toBe('roof-plan')
    expect(normalizeDrawingType('site-plan')).toBe('site-plan')
  })

  test('falls back to the floor plan for stale persisted values', () => {
    expect(normalizeDrawingType('unknown')).toBe('floor-plan')
    expect(normalizeDrawingType(null)).toBe('floor-plan')
  })
})
