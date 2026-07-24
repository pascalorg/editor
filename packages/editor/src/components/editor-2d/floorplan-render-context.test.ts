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
})
