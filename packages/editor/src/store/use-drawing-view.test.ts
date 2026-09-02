import { describe, expect, test } from 'bun:test'
import useDrawingView, {
  EDITOR_DRAWING_TYPE_OPTIONS,
  normalizeAnnotationLayoutOverrides,
  normalizeEditorDrawingType,
} from './use-drawing-view'

describe('drawing type', () => {
  test('starts on the floor plan', () => {
    expect(useDrawingView.getState().drawingType).toBe('floor-plan')
  })

  test('switches between the drawing types the editor can render (WS1)', () => {
    useDrawingView.getState().setDrawingType('site-plan')
    expect(useDrawingView.getState().drawingType).toBe('site-plan')
    useDrawingView.getState().setDrawingType('floor-plan')
    expect(useDrawingView.getState().drawingType).toBe('floor-plan')
  })

  test('only offers the two types that have a renderer', () => {
    expect(EDITOR_DRAWING_TYPE_OPTIONS.map((o) => o.id)).toEqual(['floor-plan', 'site-plan'])
  })

  test('a persisted value the editor cannot render falls back to the floor plan', () => {
    expect(normalizeEditorDrawingType('site-plan')).toBe('site-plan')
    expect(normalizeEditorDrawingType('roof-plan')).toBe('floor-plan')
    expect(normalizeEditorDrawingType(undefined)).toBe('floor-plan')
    expect(normalizeEditorDrawingType(42)).toBe('floor-plan')
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
