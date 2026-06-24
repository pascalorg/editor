import { afterEach, describe, expect, test } from 'bun:test'
import { MeshLambertNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'
import { clearMaterialCache, createSurfaceRoleMaterial } from '../src/lib/materials'

describe('createSurfaceRoleMaterial', () => {
  afterEach(() => {
    clearMaterialCache()
  })

  test('uses flat Lambert role materials for solid mode and PBR role materials for rendered mode', () => {
    const solid = createSurfaceRoleMaterial('wall', 'clay', undefined, undefined, 'solid')
    const rendered = createSurfaceRoleMaterial('wall', 'clay', undefined, undefined, 'rendered')

    expect(solid).toBeInstanceOf(MeshLambertNodeMaterial)
    expect(rendered).toBeInstanceOf(MeshStandardNodeMaterial)
    expect(solid).not.toBe(rendered)
  })
})
