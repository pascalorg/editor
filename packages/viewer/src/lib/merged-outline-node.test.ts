// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import { Object3D, PerspectiveCamera, Scene } from 'three'
import { mergedOutline } from './merged-outline-node'

describe('merged outline rendering', () => {
  test('skips outline work while the pass is disabled', () => {
    const outline = mergedOutline(new Scene(), new PerspectiveCamera(), {
      enabled: () => false,
      primaryObjects: [new Object3D()],
    })
    const frame = {
      get renderer(): never {
        throw new Error('outline renderer should not be touched')
      },
    }

    expect(() => outline.updateBefore(frame)).not.toThrow()
    outline.dispose()
  })
})
