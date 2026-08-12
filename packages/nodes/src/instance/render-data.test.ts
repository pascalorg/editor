import { describe, expect, test } from 'bun:test'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three'
import { captureDefinitionRenderData } from './render-data'

describe('component definition render data', () => {
  test('captures visible mesh parts in definition-local space', () => {
    const source = new Group()
    source.position.set(10, 0, 0)
    source.visible = false
    const root = new Group()
    root.position.set(2, 0, 0)
    const mesh = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial())
    mesh.position.set(1, 0, 0)
    root.add(mesh)
    source.add(root)

    const data = captureDefinitionRenderData(source)

    expect(data.parts).toHaveLength(1)
    expect(data.parts[0]?.matrix.elements[12]).toBeCloseTo(3)
    expect(data.bounds.center).toEqual([3, 0, 0])
    expect(data.bounds.size).toEqual([2, 2, 2])
  })

  test('ignores raycast-only colliders and changes signatures with transforms', () => {
    const source = new Group()
    const body = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())
    const colliderMaterial = new MeshBasicMaterial({ colorWrite: false })
    const collider = new Mesh(new BoxGeometry(4, 4, 4), colliderMaterial)
    source.add(body, collider)

    const before = captureDefinitionRenderData(source)
    body.position.x = 2
    const after = captureDefinitionRenderData(source)

    expect(before.parts).toHaveLength(1)
    expect(after.parts).toHaveLength(1)
    expect(after.signature).not.toBe(before.signature)
  })
})
