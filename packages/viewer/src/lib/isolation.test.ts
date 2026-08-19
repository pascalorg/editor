// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { afterEach, describe, expect, test } from 'bun:test'
import type { AnyNodeId } from '@pascal-app/core'
import { sceneRegistry } from '@pascal-app/core'
import * as THREE from 'three'
import { applyIsolation, clearIsolation } from './isolation'
import { SCENE_LAYER, SHADOW_ONLY_LAYER } from './layers'
import { applyShadowOnly, clearShadowOnly } from './shadow-only'

function register(id: string): THREE.Object3D {
  const obj = new THREE.Object3D()
  obj.layers.set(SCENE_LAYER)
  sceneRegistry.nodes.set(id, obj)
  return obj
}

/** Isolation takes node ids; the registry only cares that the key matches. */
function isolate(...ids: string[]): void {
  applyIsolation(ids as ReadonlyArray<AnyNodeId>)
}

describe('isolation and solo, interleaved', () => {
  afterEach(() => {
    clearIsolation()
    sceneRegistry.clear()
  })

  test('leaving solo while isolated keeps the filtered scene filtered', () => {
    const level = register('level-1')
    const focus = register('wall-1')
    const original = level.layers.mask

    applyShadowOnly(level)
    isolate('wall-1')
    clearShadowOnly(level)

    expect(level.layers.isEnabled(SCENE_LAYER)).toBe(false)
    expect(level.layers.isEnabled(SHADOW_ONLY_LAYER)).toBe(false)
    expect(focus.layers.isEnabled(SCENE_LAYER)).toBe(true)

    clearIsolation()
    expect(level.layers.mask).toBe(original)
  })

  test('leaving isolation while soloed keeps the level casting shadows', () => {
    const level = register('level-1')
    register('wall-1')
    const original = level.layers.mask

    isolate('wall-1')
    applyShadowOnly(level)
    clearIsolation()

    expect(level.layers.isEnabled(SCENE_LAYER)).toBe(false)
    expect(level.layers.isEnabled(SHADOW_ONLY_LAYER)).toBe(true)

    clearShadowOnly(level)
    expect(level.layers.mask).toBe(original)
  })

  test('solo re-applied every frame does not accumulate', () => {
    const level = register('level-1')
    const original = level.layers.mask

    for (let frame = 0; frame < 5; frame += 1) applyShadowOnly(level)
    clearShadowOnly(level)

    expect(level.layers.mask).toBe(original)
  })
})
