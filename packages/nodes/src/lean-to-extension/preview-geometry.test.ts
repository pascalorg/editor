import { describe, expect, test } from 'bun:test'
import { LeanToExtensionNode, RoofSegmentNode } from '@pascal-app/core'
import { Mesh, MeshBasicMaterial } from 'three'
import { resolveConicalLeanToPlacement } from './conical-host'
import { buildLeanToExtensionGeometry } from './geometry'
import {
  buildLeanToExtensionPreviewGeometry,
  disposeLeanToExtensionPreviewGeometry,
  LEAN_TO_GHOST_COLOR,
  LEAN_TO_INVALID_GHOST_COLOR,
} from './preview-geometry'

function previewMaterial(root: ReturnType<typeof buildLeanToExtensionPreviewGeometry>) {
  const mesh = root.children.find((child): child is Mesh => child instanceof Mesh)
  expect(mesh).toBeDefined()
  expect(mesh?.material).toBeInstanceOf(MeshBasicMaterial)
  return mesh?.material as MeshBasicMaterial
}

describe('lean-to placement ghost', () => {
  test('uses the same placement geometry as the committed canopy', () => {
    const node = LeanToExtensionNode.parse({
      highSideMode: 'independent-high-beam',
      postCount: 5,
    })
    const committedGeometry = buildLeanToExtensionGeometry(node)
    const root = buildLeanToExtensionPreviewGeometry(node)
    const meshes: Mesh[] = []
    const committedMeshes: Mesh[] = []
    root.traverse((object) => {
      if (object instanceof Mesh) meshes.push(object)
    })
    committedGeometry.traverse((object) => {
      if (object instanceof Mesh) committedMeshes.push(object)
    })

    expect(meshes.map((mesh) => mesh.name).sort()).toEqual(
      committedMeshes.map((mesh) => mesh.name).sort(),
    )
    expect(new Set(meshes.map((mesh) => mesh.material)).size).toBe(1)
    const material = previewMaterial(root)
    expect(material.color.getHex()).toBe(LEAN_TO_GHOST_COLOR)
    expect(material.depthWrite).toBe(false)
    expect(material.opacity).toBe(0.3)
    expect(material.transparent).toBe(true)

    disposeLeanToExtensionPreviewGeometry(root)
    committedGeometry.traverse((object) => {
      if (object instanceof Mesh) object.geometry.dispose()
    })
  })

  test('uses the same geometry with an invalid red material', () => {
    const root = buildLeanToExtensionPreviewGeometry(LeanToExtensionNode.parse({}), true)

    const material = previewMaterial(root)
    expect(material.color.getHex()).toBe(LEAN_TO_INVALID_GHOST_COLOR)
    expect(material.depthWrite).toBe(false)
    expect(material.opacity).toBe(0.38)
    expect(material.transparent).toBe(true)

    disposeLeanToExtensionPreviewGeometry(root)
  })

  test('keeps a conical hover ghost visible over its host surface', () => {
    const host = RoofSegmentNode.parse({
      roofType: 'conical',
      width: 8,
      depth: 8,
      wallHeight: 3,
    })
    const node = resolveConicalLeanToPlacement(host)!
    const root = buildLeanToExtensionPreviewGeometry(node)

    expect(root.children.length).toBeGreaterThan(1)
    expect(previewMaterial(root).depthTest).toBe(false)

    disposeLeanToExtensionPreviewGeometry(root)
  })
})
