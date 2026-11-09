// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { afterEach, describe, expect, test } from 'bun:test'
import type { AnyNodeId } from '@pascal-app/core'
import { sceneRegistry } from '@pascal-app/core'
import * as THREE from 'three'
import { applyIsolation, clearIsolation, isIsolationActive, refreshIsolation } from './isolation'
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

describe('preset isolation includes presentation geometry', () => {
  afterEach(() => {
    clearIsolation()
    sceneRegistry.clear()
  })

  test('keeps a hosted opening and its generated parts, excludes unregistered scenery, and preserves lights', () => {
    const scene = new THREE.Scene()
    const wall = register('wall-host')
    const opening = register('window-focus')
    const frame = new THREE.Mesh()
    const ground = new THREE.Mesh()
    const neighborhood = new THREE.Group()
    const tree = new THREE.Mesh()
    const sun = new THREE.DirectionalLight()
    const camera = new THREE.PerspectiveCamera()
    opening.add(frame)
    wall.add(opening)
    neighborhood.add(tree)
    scene.add(wall, ground, neighborhood, sun, camera)
    const original = [wall, opening, frame, ground, tree, sun, camera].map((o) => o.layers.mask)
    isolate('window-focus')
    refreshIsolation(scene)
    expect(wall.layers.isEnabled(SCENE_LAYER)).toBe(false)
    for (const object of [opening, frame, sun, camera])
      expect(object.layers.isEnabled(SCENE_LAYER)).toBe(true)
    for (const object of [ground, tree]) expect(object.layers.isEnabled(SCENE_LAYER)).toBe(false)
    expect(wall.visible).toBe(true)
    expect(ground.visible).toBe(true)
    clearIsolation()
    expect([wall, opening, frame, ground, tree, sun, camera].map((o) => o.layers.mask)).toEqual(
      original,
    )
  })

  test('filters late presentation meshes and restores removed objects and changed selections', () => {
    const scene = new THREE.Scene()
    const first = register('window-first'),
      second = register('window-second')
    scene.add(first, second)
    isolate('window-first')
    refreshIsolation(scene)
    const lateGround = new THREE.Mesh()
    scene.add(lateGround)
    refreshIsolation(scene)
    expect(lateGround.layers.isEnabled(SCENE_LAYER)).toBe(false)
    scene.remove(lateGround)
    isolate('window-second')
    expect(second.layers.isEnabled(SCENE_LAYER)).toBe(true)
    expect(first.layers.isEnabled(SCENE_LAYER)).toBe(false)
    expect(lateGround.layers.isEnabled(SCENE_LAYER)).toBe(true)
    scene.remove(first)
    sceneRegistry.nodes.delete('window-first')
    clearIsolation()
    expect(first.layers.isEnabled(SCENE_LAYER)).toBe(true)
    expect(isIsolationActive()).toBe(false)
  })

  test('empty focus clears isolation, while a not-yet-mounted focus does not expose the environment', () => {
    const scene = new THREE.Scene(),
      context = new THREE.Mesh()
    scene.add(context)
    isolate('window-lazy')
    refreshIsolation(scene)
    expect(isIsolationActive()).toBe(true)
    expect(context.layers.isEnabled(SCENE_LAYER)).toBe(false)
    const focus = register('window-lazy')
    scene.add(focus)
    refreshIsolation(scene)
    expect(focus.layers.isEnabled(SCENE_LAYER)).toBe(true)
    applyIsolation([])
    expect(context.layers.isEnabled(SCENE_LAYER)).toBe(true)
    expect(isIsolationActive()).toBe(false)
  })

  test('removes isolated surroundings from shadow passes without losing the solo hold', () => {
    const scene = new THREE.Scene(),
      context = register('wall-context'),
      focus = register('window-focus')
    scene.add(context, focus)
    applyShadowOnly(context)
    isolate('window-focus')
    refreshIsolation(scene)
    expect(context.layers.isEnabled(SHADOW_ONLY_LAYER)).toBe(false)
    clearIsolation()
    expect(context.layers.isEnabled(SCENE_LAYER)).toBe(false)
    expect(context.layers.isEnabled(SHADOW_ONLY_LAYER)).toBe(true)
    clearShadowOnly(context)
    expect(context.layers.isEnabled(SCENE_LAYER)).toBe(true)
  })

  test('suppresses atmospheric fog during capture and restores it without changing reflections', () => {
    const scene = new THREE.Scene(),
      fog = new THREE.Fog('#778899', 1, 100)
    const environment = new THREE.Texture()
    scene.fog = fog
    scene.environment = environment
    const fogNode = { isNode: true } as unknown as NonNullable<THREE.Scene['fogNode']>
    scene.fogNode = fogNode
    isolate('window-focus')
    const restore = refreshIsolation(scene)
    expect(scene.fog).toBeNull()
    expect(scene.fogNode).toBeNull()
    expect(scene.environment).toBe(environment)
    restore()
    clearIsolation()
    expect(scene.fog).toBe(fog)
    expect(scene.fogNode).toBe(fogNode)
    expect(scene.environment).toBe(environment)
  })

  test('new atmosphere settings survive leaving isolation', () => {
    const scene = new THREE.Scene()
    scene.fog = new THREE.Fog('#123456', 1, 10)
    isolate('window-focus')
    refreshIsolation(scene)()
    const replacement = new THREE.Fog('#abcdef', 5, 50)
    scene.fog = replacement
    refreshIsolation(scene)()
    clearIsolation()
    expect(scene.fog).toBe(replacement)
  })

  test('disabling atmosphere between draws does not resurrect stale fog on exit', () => {
    const scene = new THREE.Scene()
    scene.fog = new THREE.Fog('#123456', 1, 10)
    scene.fogNode = { isNode: true } as unknown as NonNullable<THREE.Scene['fogNode']>
    isolate('window-focus')
    refreshIsolation(scene)()
    scene.fog = null
    scene.fogNode = null
    refreshIsolation(scene)()
    clearIsolation()
    expect(scene.fog).toBeNull()
    expect(scene.fogNode).toBeNull()
  })

  test('native descendants survive while unrelated collective instance batches are excluded', () => {
    const scene = new THREE.Scene(),
      wall = register('wall-focus')
    const copy = register('window-linked-copy')
    const pane = new THREE.Mesh()
    const batch = new THREE.InstancedMesh(
      new THREE.BoxGeometry(),
      new THREE.MeshBasicMaterial(),
      10,
    )
    copy.add(pane)
    wall.add(copy)
    scene.add(wall, batch)
    isolate('wall-focus')
    refreshIsolation(scene)
    expect(pane.layers.isEnabled(SCENE_LAYER)).toBe(true)
    expect(batch.layers.isEnabled(SCENE_LAYER)).toBe(false)
    clearIsolation()
    expect(batch.layers.isEnabled(SCENE_LAYER)).toBe(true)
    batch.geometry.dispose()
    ;(batch.material as THREE.Material).dispose()
    batch.dispose()
  })
})
