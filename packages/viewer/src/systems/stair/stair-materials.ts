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
): THREE.Material {
  if (materialPreset) {
    return createMaterialFromPresetRef(materialPreset) ?? DEFAULT_STAIR_MATERIAL
  }

  if (material) {
    return createMaterial(material)
  }

  return DEFAULT_STAIR_MATERIAL
}

export function getStairBodyMaterials(stair: StairNode): StairBodyMaterials {
  const tread = getEffectiveStairSurfaceMaterial(stair, 'tread')
  const side = getEffectiveStairSurfaceMaterial(stair, 'side')
  const cacheKey = JSON.stringify({
    tread: getSurfaceMaterialSignature(tread),
    side: getSurfaceMaterialSignature(side),
  })

  const cached = stairBodyMaterialCache.get(cacheKey)
  if (cached) return cached

  const materials: StairBodyMaterials = [
    createResolvedMaterial(tread.material, tread.materialPreset),
    createResolvedMaterial(side.material, side.materialPreset),
  ]

  stairBodyMaterialCache.set(cacheKey, materials)
  return materials
}

export function getStairRailingMaterial(stair: StairNode): THREE.Material {
  const railing = getEffectiveStairSurfaceMaterial(stair, 'railing')
  const cacheKey = getSurfaceMaterialSignature(railing)
  const cached = stairRailingMaterialCache.get(cacheKey)
  if (cached) return cached

  const material = createResolvedMaterial(railing.material, railing.materialPreset)
  stairRailingMaterialCache.set(cacheKey, material)
  return material
}

export function getStraightStairSegmentBodyMaterials(
  segment: StairSegmentNode,
  parentNode?: StairNode,
): StairBodyMaterials {
  if (segment.material !== undefined || typeof segment.materialPreset === 'string') {
    const override = createResolvedMaterial(segment.material, segment.materialPreset)
    return [override, override]
  }

  if (parentNode) {
    return getStairBodyMaterials(parentNode)
  }

  return [DEFAULT_STAIR_MATERIAL, DEFAULT_STAIR_MATERIAL]
}
