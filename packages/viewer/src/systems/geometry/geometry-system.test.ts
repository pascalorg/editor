// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three'
import { resolveMaterialRef } from '../../lib/materials'
import {
  type GeometryBuildCacheEntry,
  markGeometryBuildOutput,
  shouldReuseGeometryBuild,
} from './geometry-system'

describe('markGeometryBuildOutput', () => {
  test('glass slots in a geometry build stop casting without changing receiving', () => {
    const root = new Group()
    const panel = new Mesh(
      new BoxGeometry(),
      resolveMaterialRef('library:preset-glass', undefined)!,
    )
    const opaque = new Mesh(new BoxGeometry(), new MeshBasicMaterial())
    panel.castShadow = opaque.castShadow = true
    panel.receiveShadow = true
    opaque.receiveShadow = false
    root.add(panel, opaque)
    markGeometryBuildOutput(root)
    expect(panel.castShadow).toBe(false)
    expect(panel.receiveShadow).toBe(true)
    expect(opaque.castShadow).toBe(true)
    expect(opaque.receiveShadow).toBe(false)
  })

  test('marks nested builder meshes for slot paint preview', () => {
    const root = new Group()
    const nested = new Group()
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())
    mesh.userData.slotId = 'appliance'
    nested.add(mesh)
    root.add(nested)

    markGeometryBuildOutput(root)

    expect(root.userData.__fromGeometry).toBe(true)
    expect(nested.userData.__fromGeometry).toBe(true)
    expect(mesh.userData.__fromGeometry).toBe(true)
    expect(mesh.userData.slotId).toBe('appliance')
  })
})

describe('shouldReuseGeometryBuild', () => {
  test('rebuilds when the same node id remounts into a new group with the same key', () => {
    const cache = new Map<string, GeometryBuildCacheEntry>()
    const firstGroup = new Group()
    const remountedGroup = new Group()

    expect(shouldReuseGeometryBuild(cache, 'duct_1', firstGroup, 'same-key')).toBe(false)
    expect(shouldReuseGeometryBuild(cache, 'duct_1', firstGroup, 'same-key')).toBe(true)
    expect(shouldReuseGeometryBuild(cache, 'duct_1', remountedGroup, 'same-key')).toBe(false)
  })
})
