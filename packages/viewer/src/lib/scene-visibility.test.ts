// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import {
  BATCHED_LAYER,
  OVERLAY_LAYER,
  SCENE_LAYER,
  SHADOW_ONLY_LAYER,
  setSurfaceRaycastLayers,
} from './layers'
import { hideFromScene, showInScene } from './scene-visibility'

function sceneObject(): THREE.Object3D {
  const obj = new THREE.Object3D()
  obj.layers.set(SCENE_LAYER)
  return obj
}

describe('scene visibility', () => {
  test('one reason hides and gives the exact mask back', () => {
    const obj = sceneObject()
    obj.layers.enable(OVERLAY_LAYER)
    const original = obj.layers.mask

    hideFromScene(obj, 'isolated')
    expect(obj.layers.isEnabled(SCENE_LAYER)).toBe(false)
    expect(obj.layers.isEnabled(OVERLAY_LAYER)).toBe(true)

    showInScene(obj, 'isolated')
    expect(obj.layers.mask).toBe(original)
  })

  test('the reason still standing decides the mask, whatever the order', () => {
    const obj = sceneObject()

    hideFromScene(obj, 'shadow-only')
    hideFromScene(obj, 'isolated')

    // Leaving solo first must not hand the scene layer back while the
    // isolation filter is still up.
    showInScene(obj, 'shadow-only')
    expect(obj.layers.isEnabled(SCENE_LAYER)).toBe(false)
    expect(obj.layers.isEnabled(SHADOW_ONLY_LAYER)).toBe(false)

    showInScene(obj, 'isolated')
    expect(obj.layers.isEnabled(SCENE_LAYER)).toBe(true)
  })

  test('dropping isolation under solo leaves the object casting shadows', () => {
    const obj = sceneObject()

    hideFromScene(obj, 'isolated')
    hideFromScene(obj, 'shadow-only')
    showInScene(obj, 'isolated')

    expect(obj.layers.isEnabled(SHADOW_ONLY_LAYER)).toBe(true)
    expect(obj.layers.isEnabled(SCENE_LAYER)).toBe(false)
  })

  test('the batch outranks solo, and leaving solo does not un-sew the wall', () => {
    const obj = sceneObject()

    hideFromScene(obj, 'batched')
    hideFromScene(obj, 'shadow-only')
    expect(obj.layers.isEnabled(BATCHED_LAYER)).toBe(true)
    expect(obj.layers.isEnabled(SHADOW_ONLY_LAYER)).toBe(false)

    showInScene(obj, 'shadow-only')
    expect(obj.layers.isEnabled(BATCHED_LAYER)).toBe(true)
    expect(obj.layers.isEnabled(SCENE_LAYER)).toBe(false)

    showInScene(obj, 'batched')
    expect(obj.layers.isEnabled(SCENE_LAYER)).toBe(true)
  })

  test('dropping the batch under solo leaves the wall casting shadows', () => {
    const obj = sceneObject()

    hideFromScene(obj, 'shadow-only')
    hideFromScene(obj, 'batched')
    showInScene(obj, 'batched')

    expect(obj.layers.isEnabled(SHADOW_ONLY_LAYER)).toBe(true)
    expect(obj.layers.isEnabled(SCENE_LAYER)).toBe(false)
    expect(obj.layers.isEnabled(BATCHED_LAYER)).toBe(false)
  })

  test('re-hiding for a reason already held changes nothing', () => {
    const obj = sceneObject()

    hideFromScene(obj, 'shadow-only')
    const held = obj.layers.mask
    hideFromScene(obj, 'shadow-only')
    expect(obj.layers.mask).toBe(held)

    showInScene(obj, 'shadow-only')
    expect(obj.layers.isEnabled(SCENE_LAYER)).toBe(true)
  })

  test('dropping a reason that was never held is a no-op', () => {
    const obj = sceneObject()
    const original = obj.layers.mask

    showInScene(obj, 'isolated')
    expect(obj.layers.mask).toBe(original)

    hideFromScene(obj, 'shadow-only')
    showInScene(obj, 'isolated')
    expect(obj.layers.isEnabled(SHADOW_ONLY_LAYER)).toBe(true)
    expect(obj.layers.isEnabled(SCENE_LAYER)).toBe(false)
  })

  test('an object hidden while already off the scene layer stays off it', () => {
    const obj = new THREE.Object3D()
    obj.layers.set(OVERLAY_LAYER)
    const original = obj.layers.mask

    hideFromScene(obj, 'isolated')
    showInScene(obj, 'isolated')
    expect(obj.layers.mask).toBe(original)
    expect(obj.layers.isEnabled(SCENE_LAYER)).toBe(false)
  })

  // A batched wall keeps its pointer handlers, so whatever raycaster drives
  // hover / paint / click has to reach it or the wall goes dead the moment its
  // level is sewn. `PointerRaycastLayers` enables the bit on R3F's shared
  // raycaster; `setSurfaceRaycastLayers` does it for private ones.
  test('a batched object answers only a raycaster that opted into the layer', () => {
    const obj = sceneObject()
    hideFromScene(obj, 'batched')

    const defaultLayers = new THREE.Layers()
    expect(obj.layers.test(defaultLayers)).toBe(false)

    const surfaceLayers = new THREE.Layers()
    setSurfaceRaycastLayers(surfaceLayers)
    expect(obj.layers.test(surfaceLayers)).toBe(true)

    const sharedLayers = new THREE.Layers()
    sharedLayers.enable(BATCHED_LAYER)
    expect(obj.layers.test(sharedLayers)).toBe(true)

    showInScene(obj, 'batched')
    expect(obj.layers.test(defaultLayers)).toBe(true)
  })
})
