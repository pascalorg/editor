import { describe, expect, test } from 'bun:test'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { disposeObject3DResources } from './dispose-object3d'

describe('disposeObject3DResources', () => {
  test('disposes a distributed WebGPU node material through the resource lifecycle', () => {
    const material = new MeshBasicNodeMaterial()
    let disposals = 0
    material.addEventListener('dispose', () => disposals++)

    disposeObject3DResources(new Mesh(new BoxGeometry(), material))

    expect(disposals).toBe(1)
  })

  test('disposes nested geometry and materials once', () => {
    const root = new Group()
    const nested = new Group()
    const geometry = new BoxGeometry()
    const material = new MeshBasicMaterial()
    let geometryDisposals = 0
    let materialDisposals = 0
    geometry.addEventListener('dispose', () => geometryDisposals++)
    material.addEventListener('dispose', () => materialDisposals++)
    nested.add(new Mesh(geometry, material), new Mesh(geometry, material))
    root.add(nested)

    disposeObject3DResources(root)

    expect(geometryDisposals).toBe(1)
    expect(materialDisposals).toBe(1)
  })

  test('preserves Pascal material-cache ownership', () => {
    const root = new Group()
    const material = new MeshBasicMaterial()
    material.userData.__pascalCachedMaterial = true
    let materialDisposals = 0
    material.addEventListener('dispose', () => materialDisposals++)
    root.add(new Mesh(new BoxGeometry(), material))

    disposeObject3DResources(root)

    expect(materialDisposals).toBe(0)
  })
})
