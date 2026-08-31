import { describe, expect, test } from 'bun:test'
import { createFloorplanRenderScaleReference } from './floorplan-render-context'

describe('floorplan render context', () => {
  test('updates the live scale without changing the registry-facing reader', () => {
    const scale = createFloorplanRenderScaleReference(0.02)
    const read = scale.read

    scale.update(0.01)

    expect(scale.read).toBe(read)
    expect(read()).toBe(0.01)
  })

  test('notifies selected-handle renderers when a hidden floorplan becomes visible', () => {
    const scale = createFloorplanRenderScaleReference(30)
    let renderedCurveHandleRadius = 8 * scale.read()
    const unsubscribe = scale.subscribe(() => {
      renderedCurveHandleRadius = 8 * scale.read()
    })

    scale.update(0.02)

    expect(renderedCurveHandleRadius).toBe(0.16)
    unsubscribe()
  })
})
