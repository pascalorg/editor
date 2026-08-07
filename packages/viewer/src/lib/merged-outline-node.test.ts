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

/**
 * The nested passes below `updateBefore` each begin with
 * `if (scene.matrixWorldAutoUpdate === true) scene.updateMatrixWorld()`, so
 * without this guard a depth pass and two mask passes re-walk the entire scene
 * graph every frame for matrices the outer render just computed. On a
 * 3,991-node scene that walk was the largest single item in the profile.
 *
 * The failure this locks down is silent in both directions: leaving the flag
 * off strands a scene whose transforms never update again, and hardcoding it
 * back to `true` on exit quietly overrides an app that had deliberately turned
 * it off. Nothing renders wrong on the frame it breaks.
 */
describe('merged outline nested passes', () => {
  function stubRenderer(scene: Scene, seen: boolean[]) {
    const noop = () => {}
    return {
      toneMapping: 0,
      toneMappingExposure: 1,
      outputColorSpace: '',
      autoClear: true,
      getRenderTarget: () => null,
      getActiveCubeFace: () => 0,
      getActiveMipmapLevel: () => 0,
      getRenderObjectFunction: () => null,
      getPixelRatio: () => 1,
      getMRT: () => null,
      getClearColor: (t: { setRGB: (r: number, g: number, b: number) => void }) => t,
      getClearAlpha: () => 1,
      getScissorTest: () => false,
      getDrawingBufferSize: (t: { width: number; height: number }) => {
        t.width = 64
        t.height = 64
        return t
      },
      setMRT: noop,
      setRenderObjectFunction: noop,
      setClearColor: noop,
      setRenderTarget: noop,
      setPixelRatio: noop,
      setScissorTest: noop,
      clearColor: noop,
      renderObject: noop,
      render: () => {
        seen.push(scene.matrixWorldAutoUpdate)
      },
    }
  }

  test('nested render passes do not re-walk the scene graph', () => {
    const scene = new Scene()
    const seen: boolean[] = []
    const outline = mergedOutline(scene, new PerspectiveCamera(), {
      primaryObjects: [new Object3D()],
    })

    outline.updateBefore({ renderer: stubRenderer(scene, seen) })

    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((v) => v === false)).toBe(true)
    outline.dispose()
  })

  test('restores the scene flag it found, not a hardcoded true', () => {
    const scene = new Scene()
    scene.matrixWorldAutoUpdate = false
    const outline = mergedOutline(scene, new PerspectiveCamera(), {
      primaryObjects: [new Object3D()],
    })

    outline.updateBefore({ renderer: stubRenderer(scene, []) })

    expect(scene.matrixWorldAutoUpdate).toBe(false)
    outline.dispose()
  })

  test('restores the flag on the nothing-to-draw exit path too', () => {
    const scene = new Scene()
    const outline = mergedOutline(scene, new PerspectiveCamera(), {
      primaryObjects: [new Object3D()],
    })
    const renderer = stubRenderer(scene, [])

    // First call writes group A, so the next one with an empty group takes the
    // cleanup branch — the early return that also has to put the flag back.
    outline.updateBefore({ renderer })
    outline.primaryObjects.length = 0
    outline.updateBefore({ renderer })

    expect(scene.matrixWorldAutoUpdate).toBe(true)
    outline.dispose()
  })
})
