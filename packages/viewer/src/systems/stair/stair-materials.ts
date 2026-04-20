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

  return [
    createResolvedMaterial(tread.material, tread.materialPreset),
    createResolvedMaterial(side.material, side.materialPreset),
  ]
}

export function getStairRailingMaterial(stair: StairNode): THREE.Material {
  const railing = getEffectiveStairSurfaceMaterial(stair, 'railing')
  return createResolvedMaterial(railing.material, railing.materialPreset)
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
