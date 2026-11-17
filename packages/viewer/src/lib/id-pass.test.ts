// @ts-expect-error — Bun types are not part of the viewer's production declaration build.
import { afterEach, describe, expect, test } from 'bun:test'
import { type AnyNode, sceneRegistry, useScene } from '@pascal-app/core'
import { buildIdResolver } from '@pascal-app/viewer'
import * as THREE from 'three'

// These are ownership tests on real Three objects, not claims about rasterized pixels. The
// semantic owners are fixture inputs; no expected id index depends on traversal order.
const restores: (() => void)[] = []
afterEach(() => {
  for (const restore of restores.splice(0).reverse()) restore()
})

function register(id: string, type: string, object?: THREE.Object3D) {
  const nodes = useScene.getState().nodes
  const previous = sceneRegistry.nodes.get(id)
  useScene.setState({ nodes: { ...nodes, [id]: { id, type } as AnyNode } })
  if (object) sceneRegistry.nodes.set(id, object)
  restores.push(() => {
    useScene.setState({ nodes })
    if (previous) sceneRegistry.nodes.set(id, previous)
    else sceneRegistry.nodes.delete(id)
  })
}

function mesh(material = new THREE.MeshBasicMaterial()) {
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  restores.push(() => {
    geometry.dispose()
    material.dispose()
  })
  return new THREE.Mesh(geometry, material)
}

describe('id resolver ownership', () => {
  test('glass beneath a no-draw pick root belongs to the opening, not its wall', () => {
    const scene = new THREE.Scene()
    const wall = new THREE.Group()
    const opening = mesh(new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }))
    const glass = mesh(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35 }))
    glass.material.name = 'glazing'
    const frame = mesh()
    opening.add(glass, frame)
    wall.add(opening)
    scene.add(wall)
    register('wall_north', 'wall', wall)
    register('window_north', 'window', opening)
    const resolver = buildIdResolver(scene)
    const glassIndex = resolver.resolve(glass)
    const frameIndex = resolver.resolve(frame)

    expect(resolver.entries.find((entry) => entry.index === glassIndex)).toMatchObject({
      kind: 'glass',
      nodeId: 'window_north',
    })
    expect(resolver.entries.find((entry) => entry.index === frameIndex)).toMatchObject({
      kind: 'node',
      nodeId: 'window_north',
    })
    expect(glassIndex).not.toBe(frameIndex)
  })

  test('unregistered drawn geometry is unknown instead of disappearing into background', () => {
    const scene = new THREE.Scene()
    const unowned = mesh()
    scene.add(unowned)
    const resolver = buildIdResolver(scene)
    const index = resolver.resolve(unowned)
    expect(index).not.toBe(0)
    expect(resolver.entries.find((entry) => entry.index === index)?.kind).toBe('unknown')
  })

  test('site ground resolves to a reserved class rather than an ordinary node', () => {
    const scene = new THREE.Scene()
    const site = new THREE.Group()
    const ground = mesh()
    site.add(ground)
    scene.add(site)
    register('site_ground', 'site', site)
    const resolver = buildIdResolver(scene)
    const index = resolver.resolve(ground)
    expect(resolver.entries.find((entry) => entry.index === index)?.kind).toBe('ground')
  })

  test('different instances retain their explicit node ids even under a registered level', () => {
    const scene = new THREE.Scene()
    const level = new THREE.Group()
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const material = new THREE.MeshBasicMaterial()
    const items = new THREE.InstancedMesh(geometry, material, 2)
    items.userData.nodeIds = ['item_left', 'item_right']
    level.add(items)
    scene.add(level)
    register('level_items', 'level', level)
    register('item_left', 'item')
    register('item_right', 'item')
    restores.push(() => {
      items.dispose()
      geometry.dispose()
      material.dispose()
    })
    const resolver = buildIdResolver(scene)
    const left = resolver.resolve(items, 0)
    const right = resolver.resolve(items, 1)

    expect(left).not.toBe(right)
    expect(resolver.entries.find((entry) => entry.index === left)).toMatchObject({
      kind: 'node',
      nodeId: 'item_left',
    })
    expect(resolver.entries.find((entry) => entry.index === right)).toMatchObject({
      kind: 'node',
      nodeId: 'item_right',
    })
    expect(resolver.resolve(items, 0)).toBe(left)
  })

  test('an instance without separate semantics inherits the registered item owner', () => {
    const scene = new THREE.Scene()
    const item = new THREE.Group()
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const material = new THREE.MeshBasicMaterial()
    const parts = new THREE.InstancedMesh(geometry, material, 2)
    item.add(parts)
    scene.add(item)
    register('item_kit', 'item', item)
    restores.push(() => {
      parts.dispose()
      geometry.dispose()
      material.dispose()
    })
    const resolver = buildIdResolver(scene)
    for (const instanceId of [0, 1]) {
      const index = resolver.resolve(parts, instanceId)
      expect(resolver.entries.find((entry) => entry.index === index)).toMatchObject({
        kind: 'node',
        nodeId: 'item_kit',
      })
    }
  })

  test('batched instance ids resolve to individual nodes rather than the batch owner', () => {
    const scene = new THREE.Scene()
    const geometry = new THREE.PlaneGeometry(1, 1)
    const material = new THREE.MeshBasicMaterial()
    const batch = new THREE.BatchedMesh(2, 8, 12, material)
    const geometryId = batch.addGeometry(geometry)
    const first = batch.addInstance(geometryId)
    const second = batch.addInstance(geometryId)
    batch.userData.nodeIds = []
    batch.userData.nodeIds[first] = 'item_batch_first'
    batch.userData.nodeIds[second] = 'item_batch_second'
    scene.add(batch)
    register('item_batch_first', 'item')
    register('item_batch_second', 'item')
    restores.push(() => {
      batch.dispose()
      geometry.dispose()
      material.dispose()
    })
    const resolver = buildIdResolver(scene)
    for (const [instanceId, nodeId] of [
      [first, 'item_batch_first'],
      [second, 'item_batch_second'],
    ] as const) {
      const index = resolver.resolve(batch, instanceId)
      expect(resolver.entries.find((entry) => entry.index === index)).toMatchObject({
        kind: 'node',
        nodeId,
      })
    }
  })
})
