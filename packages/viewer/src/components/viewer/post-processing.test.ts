import { describe, expect, test } from 'bun:test'
import { type Camera, Color, PerspectiveCamera } from 'three'
import { color } from 'three/tsl'
import { Scene } from 'three/webgpu'
import { GRID_LAYER, OVERLAY_LAYER, SCENE_LAYER } from '../../lib/layers'
import { renderDirect } from './post-processing'

// Oracle provenance: Three's renderers/common/Background.js update() inserts a
// background-node sky mesh with depthTest=false even when autoClear=false.
// A Color background can also force a clear. Neither belongs in an overlay-only
// pass. Observe the real renderDirect boundary; do not simulate Three's pixels.
type Observation = {
  kind: 'render' | 'clear-depth'
  scene: Scene
  camera: Camera
  mask: number
  autoClear: boolean
  background: Scene['background']
  backgroundNode: Scene['backgroundNode']
}

describe('direct rendering preserves the scene beneath overlays', () => {
  for (const autoClear of [true, false]) {
    for (const overlayEnabled of [true, false]) {
      for (const throwOnPass of [null, 1, 2] as const) {
        test(`autoClear=${autoClear}, initial overlay=${overlayEnabled}, ${
          throwOnPass === null ? 'success' : `render ${throwOnPass} throws`
        }`, () => {
          const scene = new Scene()
          const background = new Color('#123456')
          const backgroundNode = color('#abcdef')
          scene.background = background
          scene.backgroundNode = backgroundNode
          const camera = new PerspectiveCamera()
          camera.layers.set(SCENE_LAYER)
          camera.layers.enable(GRID_LAYER)
          if (overlayEnabled) camera.layers.enable(OVERLAY_LAYER)
          const originalMask = camera.layers.mask
          const sceneMask = (1 << SCENE_LAYER) | (1 << GRID_LAYER)
          const overlayMask = 1 << OVERLAY_LAYER
          const observations: Observation[] = []
          const failure = new Error(`render ${throwOnPass} failed`)
          let rendered = 0
          const observe = (kind: Observation['kind'], target: Scene, view: Camera) => {
            observations.push({
              kind,
              scene: target,
              camera: view,
              mask: view.layers.mask,
              autoClear: renderer.autoClear,
              background: target.background,
              backgroundNode: target.backgroundNode,
            })
          }
          const renderer = {
            autoClear,
            render(target: Scene, view: Camera) {
              observe('render', target, view)
              rendered++
              if (rendered === throwOnPass) throw failure
            },
            clearDepth() {
              observe('clear-depth', scene, camera)
            },
          }

          let thrown: unknown
          try {
            renderDirect(renderer, scene, camera)
          } catch (error) {
            thrown = error
          }

          // Restoration and error identity are required on both render failures,
          // not just on the successful path.
          expect(thrown).toBe(throwOnPass === null ? undefined : failure)
          expect(camera.layers.mask).toBe(originalMask)
          expect(renderer.autoClear).toBe(autoClear)
          expect(scene.background).toBe(background)
          expect(scene.backgroundNode).toBe(backgroundNode)
          expect(observations.map(({ kind }) => kind)).toEqual(
            throwOnPass === 1 ? ['render'] : ['render', 'clear-depth', 'render'],
          )
          for (const observation of observations) {
            expect(observation.scene).toBe(scene)
            expect(observation.camera).toBe(camera)
          }

          const first = observations[0]!
          expect(first.mask).toBe(sceneMask)
          expect(first.autoClear).toBe(autoClear)
          expect(first.background).toBe(background)
          expect(first.backgroundNode).toBe(backgroundNode)
          if (throwOnPass !== 1) {
            const depthClear = observations[1]!
            expect(depthClear.autoClear).toBe(false)
            const overlay = observations[2]!
            expect(overlay.mask).toBe(overlayMask)
            expect(overlay.autoClear).toBe(false)
            expect(overlay.background).toBeNull()
            expect(overlay.backgroundNode).toBeNull()
          }
        })
      }
    }
  }
})
