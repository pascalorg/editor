// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// include Bun ambient types in its production declaration build.
import { describe, expect, test } from 'bun:test'
import { BufferGeometry, LineBasicMaterial, LineSegments, Mesh, MeshStandardMaterial } from 'three'
import { createGhostedMaterial, GHOSTED_OPACITY, isGhostedSceneMesh } from './ghosted-material'
import { SCENE_LAYER } from './layers'

describe('ghosted material', () => {
  test('creates a translucent non-depth-writing clone without mutating the source', () => {
    const source = new MeshStandardMaterial({ color: '#336699' })
    const ghosted = createGhostedMaterial(source)

    expect(ghosted).not.toBe(source)
    expect(ghosted.transparent).toBe(true)
    expect(ghosted.opacity).toBe(GHOSTED_OPACITY)
    expect(ghosted.depthWrite).toBe(false)
    expect(ghosted.userData.__pascalGhostedMaterial).toBe(true)
    expect(source.transparent).toBe(false)
    expect(source.opacity).toBe(1)
    expect(source.depthWrite).toBe(true)

    ghosted.dispose()
    source.dispose()
  })

  test('preserves authored transparency when it is lower than the ghosted cap', () => {
    const source = new MeshStandardMaterial({ opacity: 0.12, transparent: true })
    const ghosted = createGhostedMaterial(source)

    expect(ghosted.opacity).toBe(0.12)

    ghosted.dispose()
    source.dispose()
  })
})

describe('ghosted scene meshes', () => {
  test('includes meshes on the scene layer', () => {
    const mesh = new Mesh(new BufferGeometry(), new MeshStandardMaterial())
    mesh.layers.enable(SCENE_LAYER)

    expect(isGhostedSceneMesh(mesh)).toBe(true)

    mesh.geometry.dispose()
    mesh.material.dispose()
  })

  test('leaves DXF-style line segments unchanged', () => {
    const lines = new LineSegments(new BufferGeometry(), new LineBasicMaterial())
    lines.layers.enable(SCENE_LAYER)

    expect(isGhostedSceneMesh(lines)).toBe(false)

    lines.geometry.dispose()
    lines.material.dispose()
  })
})
