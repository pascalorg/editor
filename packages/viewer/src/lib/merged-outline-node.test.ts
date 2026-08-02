// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import { Object3D, PerspectiveCamera, Scene } from 'three'
import { mergedOutline } from './merged-outline-node'

describe('merged outline rendering', () => {
  test('keeps selected outlines active during camera interaction', () => {
    const cameraInteractionActive = true
    const params = {
      enabled: () => !cameraInteractionActive,
      primaryObjects: [new Object3D()],
    }
    const outline = mergedOutline(new Scene(), new PerspectiveCamera(), params)
    const frame = {
      get renderer(): never {
        throw new Error('outline renderer was reached')
      },
    }

    expect(() => outline.updateBefore(frame)).toThrow('outline renderer was reached')
    outline.dispose()
  })
})
