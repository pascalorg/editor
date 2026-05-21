import {
  getEffectiveStairSurfaceMaterial,
  type StairNode,
  type StairSegmentNode,
} from '@pascal-app/core'
import type * as THREE from 'three'
import {
  createMaterial,
  createMaterialFromPresetRef,
  DEFAULT_STAIR_MATERIAL,
  type RenderShading,
} from '../../lib/materials'

export type StairBodyMaterials = [THREE.Material, THREE.Material]

const stairBodyMaterialCache = new Map<string, StairBodyMaterials>()
const stairRailingMaterialCache = new Map<string, THREE.Material>()

function getSurfaceMaterialSignature(
  spec: ReturnType<typeof getEffectiveStairSurfaceMaterial>,
): string {
  return JSON.stringify({
    material: spec.material ?? null,
    materialPreset: spec.materialPreset ?? null,
  })
}

function createResolvedMaterial(
  material: StairNode['material'] | StairSegmentNode['material'] | undefined,
  materialPreset: string | undefined,
  shading: RenderShading,
): THREE.Material {
  if (materialPreset) {
    return createMaterialFromPresetRef(materialPreset, shading) ?? DEFAULT_STAIR_MATERIAL(shading)
  }

  if (material) {
    return createMaterial(material, shading)
  }

  return DEFAULT_STAIR_MATERIAL(shading)
}

export function getStairBodyMaterials(
  stair: StairNode,
  shading: RenderShading = 'rendered',
): StairBodyMaterials {
  const tread = getEffectiveStairSurfaceMaterial(stair, 'tread')
  const side = getEffectiveStairSurfaceMaterial(stair, 'side')
  const cacheKey = JSON.stringify({
    shading,
    tread: getSurfaceMaterialSignature(tread),
    side: getSurfaceMaterialSignature(side),
  })

  const cached = stairBodyMaterialCache.get(cacheKey)
  if (cached) return cached

  const materials: StairBodyMaterials = [
    createResolvedMaterial(tread.material, tread.materialPreset, shading),
    createResolvedMaterial(side.material, side.materialPreset, shading),
  ]

  stairBodyMaterialCache.set(cacheKey, materials)
  return materials
}

export function getStairRailingMaterial(
  stair: StairNode,
  shading: RenderShading = 'rendered',
): THREE.Material {
  const railing = getEffectiveStairSurfaceMaterial(stair, 'railing')
  const cacheKey = JSON.stringify({
    shading,
    railing: getSurfaceMaterialSignature(railing),
  })
  const cached = stairRailingMaterialCache.get(cacheKey)
  if (cached) return cached

  const material = createResolvedMaterial(railing.material, railing.materialPreset, shading)
  stairRailingMaterialCache.set(cacheKey, material)
  return material
}

export function getStraightStairSegmentBodyMaterials(
  segment: StairSegmentNode,
  parentNode?: StairNode,
  shading: RenderShading = 'rendered',
): StairBodyMaterials {
  if (segment.material !== undefined || typeof segment.materialPreset === 'string') {
    const override = createResolvedMaterial(segment.material, segment.materialPreset, shading)
    return [override, override]
  }

  if (parentNode) {
    return getStairBodyMaterials(parentNode, shading)
  }

  return [DEFAULT_STAIR_MATERIAL(shading), DEFAULT_STAIR_MATERIAL(shading)]
}
