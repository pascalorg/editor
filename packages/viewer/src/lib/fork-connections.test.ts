import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import { disposeObject3DResources } from './dispose-object3d'
import { setGroupsSortedByMaterial } from './geometry-groups'
import { BATCHED_LAYER, OVERLAY_LAYER, SCENE_LAYER, setSurfaceRaycastLayers } from './layers'
import {
  freezeObjectTransform,
  stampFrozenTransform,
  thawObjectTransform,
} from './static-transform'

describe('Fork Connections Guard Tests (4 Guard Tests)', () => {
  test('Guard 1: Static transform freezing disables matrixAutoUpdate and persists stamped matrix', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
    mesh.position.set(10, 5, 20)
    mesh.rotation.set(0, Math.PI / 2, 0)
    mesh.scale.set(2, 2, 2)

    expect(mesh.matrixAutoUpdate).toBe(true)

    freezeObjectTransform(mesh)

    expect(mesh.matrixAutoUpdate).toBe(false)
    // The stamped matrix contains translation (10, 5, 20)
    const elements = mesh.matrix.elements
    expect(elements[12]).toBeCloseTo(10, 5)
    expect(elements[13]).toBeCloseTo(5, 5)
    expect(elements[14]).toBeCloseTo(20, 5)

    // Imperative position change requires stamp
    mesh.position.set(30, 15, 40)
    stampFrozenTransform(mesh)
    expect(mesh.matrix.elements[12]).toBeCloseTo(30, 5)

    // Thawing restores auto-update
    thawObjectTransform(mesh)
    expect(mesh.matrixAutoUpdate).toBe(true)
  })

  test('Guard 2: Layer setup separates overlay vs batched meshes and configures surface raycast layers', () => {
    const raycaster = new THREE.Raycaster()
    expect(SCENE_LAYER).toBe(0)
    expect(OVERLAY_LAYER).toBe(1)
    expect(BATCHED_LAYER).toBe(5)

    setSurfaceRaycastLayers(raycaster.layers)

    expect(raycaster.layers.isEnabled(SCENE_LAYER)).toBe(true)
    expect(raycaster.layers.isEnabled(BATCHED_LAYER)).toBe(true)
    expect(raycaster.layers.isEnabled(OVERLAY_LAYER)).toBe(false)
  })

  test('Guard 3: Collective geometry group sorting normalizes material indices deterministically', () => {
    const geom = new THREE.BufferGeometry()
    const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0])
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3))

    // 2 triangles: triangle 0 has material 2, triangle 1 has material 0
    const triangleMaterials = [2, 0]
    setGroupsSortedByMaterial(geom, triangleMaterials)

    expect(geom.groups.length).toBe(2)
    // First group should now have materialIndex 0
    expect(geom.groups[0].materialIndex).toBe(0)
    expect(geom.groups[1].materialIndex).toBe(2)
  })

  test('Guard 4: Resource disposal clears geometries and un-cached materials while sparing cached singletons', () => {
    const root = new THREE.Group()
    const geom = new THREE.BoxGeometry(2, 2, 2)
    let geomDisposed = false
    geom.dispose = () => {
      geomDisposed = true
    }

    const matUncached = new THREE.MeshBasicMaterial({ color: 0xff0000 })
    let uncachedDisposed = false
    matUncached.dispose = () => {
      uncachedDisposed = true
    }

    const matCached = new THREE.MeshBasicMaterial({ color: 0x00ff00 })
    matCached.userData.__pascalCachedMaterial = true
    let cachedDisposed = false
    matCached.dispose = () => {
      cachedDisposed = true
    }

    const mesh1 = new THREE.Mesh(geom, matUncached)
    const mesh2 = new THREE.Mesh(geom, matCached)
    root.add(mesh1)
    root.add(mesh2)

    disposeObject3DResources(root)

    expect(geomDisposed).toBe(true)
    expect(uncachedDisposed).toBe(true)
    expect(cachedDisposed).toBe(false)
  })
})
