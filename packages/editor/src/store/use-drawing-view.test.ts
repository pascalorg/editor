import { describe, expect, test } from 'bun:test'
import useDrawingView, { normalizeAnnotationLayoutOverrides } from './use-drawing-view'

describe('drawing type', () => {
  test('keeps the workspace on the floor plan', () => {
    expect(useDrawingView.getState().drawingType).toBe('floor-plan')
    expect('setDrawingType' in useDrawingView.getState()).toBe(false)
  })
})

describe('normalizeAnnotationLayoutOverrides', () => {
  test('keeps finite pinned drawing-view annotation offsets', () => {
    expect(
      normalizeAnnotationLayoutOverrides({
        a: { dx: 1.25, dy: -0.5, pinned: true },
        stale: { dx: Number.NaN, dy: 0, pinned: true },
        unpinned: { dx: 1, dy: 2, pinned: false },
      }),
    ).toEqual({
      a: { dx: 1.25, dy: -0.5, pinned: true },
    })
  })
})
