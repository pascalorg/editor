import type { StairNode, StairSegmentNode } from '@pascal-app/core'
import {
  getStraightStairSegmentBodyMaterials,
  resolveMaterialRef,
  resolveSlotDefaultMaterial,
  type StairBodyMaterials,
} from '@pascal-app/viewer'
import type * as THREE from 'three'
import { STAIR_BODY_SLOT_DEFAULT, STAIR_TREADS_SLOT_DEFAULT, type StairSlotId } from './slots'

type SceneMaterials = Parameters<typeof resolveMaterialRef>[1]
type ViewerShading = Parameters<typeof resolveMaterialRef>[2]

function hasMaterialSpec(material: unknown, materialPreset: unknown): boolean {
  return material !== undefined || typeof materialPreset === 'string'
}

function hasLegacyStairSlotMaterial(node: StairNode, slotId: StairSlotId): boolean {
  if (slotId === 'infill') return false
  const hasWhole = hasMaterialSpec(node.material, node.materialPreset)
  const hasTread = hasMaterialSpec(node.treadMaterial, node.treadMaterialPreset)
  const hasSide = hasMaterialSpec(node.sideMaterial, node.sideMaterialPreset)
  const hasRailing = hasMaterialSpec(node.railingMaterial, node.railingMaterialPreset)

  if (slotId === 'treads') return hasTread || hasSide || hasWhole
  if (slotId === 'body') return hasSide || hasTread || hasWhole
  return hasRailing || hasTread || hasSide || hasWhole
}

export function resolveStairSlotMaterial(
  node: StairNode,
  slotId: StairSlotId,
  defaultRef: string,
  baseMaterial: THREE.Material,
  sceneMaterials: SceneMaterials,
  shading: ViewerShading,
  textures: boolean,
): THREE.Material {
  if (!textures) return baseMaterial

  const slotMaterial = resolveMaterialRef(node.slots?.[slotId], sceneMaterials, shading)
  if (slotMaterial) return slotMaterial

  if (hasLegacyStairSlotMaterial(node, slotId)) return baseMaterial

  return resolveSlotDefaultMaterial(defaultRef, shading)
}

export function resolveStairSegmentMaterials(
  segment: StairSegmentNode,
  parent: StairNode | undefined,
  parentMaterials: StairBodyMaterials | undefined,
  sceneMaterials: SceneMaterials,
  shading: ViewerShading,
  textures: boolean,
  colorPreset: Parameters<typeof getStraightStairSegmentBodyMaterials>[4],
): StairBodyMaterials {
  const hasOverride = hasMaterialSpec(segment.material, segment.materialPreset)
  const base =
    !hasOverride && !parentMaterials && textures
      ? ([
          resolveSlotDefaultMaterial(STAIR_TREADS_SLOT_DEFAULT, shading),
          resolveSlotDefaultMaterial(STAIR_BODY_SLOT_DEFAULT, shading),
        ] as StairBodyMaterials)
      : hasOverride || !parentMaterials
        ? getStraightStairSegmentBodyMaterials(segment, parent, shading, textures, colorPreset)
        : parentMaterials
  if (!textures) return base
  return [
    resolveMaterialRef(segment.slots?.treads, sceneMaterials, shading) ?? base[0],
    resolveMaterialRef(segment.slots?.body, sceneMaterials, shading) ?? base[1],
  ]
}

export function resolveStairBodySlotMaterials(
  stair: StairNode,
  base: StairBodyMaterials,
  sceneMaterials: SceneMaterials,
  shading: ViewerShading,
  textures: boolean,
): StairBodyMaterials {
  return [
    resolveStairSlotMaterial(
      stair,
      'treads',
      STAIR_TREADS_SLOT_DEFAULT,
      base[0],
      sceneMaterials,
      shading,
      textures,
    ),
    resolveStairSlotMaterial(
      stair,
      'body',
      STAIR_BODY_SLOT_DEFAULT,
      base[1],
      sceneMaterials,
      shading,
      textures,
    ),
  ]
}
