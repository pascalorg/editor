import {
  getEffectiveRoofSurfaceMaterial,
  type RoofNode,
  type RoofSegmentNode,
} from '@pascal-app/core'
import type * as THREE from 'three'
import {
  type ColorPreset,
  createDefaultMaterial,
  createMaterial,
  createMaterialFromPresetRef,
  createSurfaceRoleMaterial,
  type RenderShading,
} from '../../lib/materials'

export type RoofMaterialArray = [THREE.Material, THREE.Material, THREE.Material, THREE.Material]

const roofMaterialArrayCache = new Map<string, RoofMaterialArray>()

function getSurfaceMaterialSignature(
  spec: ReturnType<typeof getEffectiveRoofSurfaceMaterial>,
): string {
  return JSON.stringify({
    material: spec.material ?? null,
    materialPreset: spec.materialPreset ?? null,
  })
}

function createResolvedMaterial(
  material: RoofNode['material'] | RoofSegmentNode['material'] | undefined,
  materialPreset: string | undefined,
  shading: RenderShading,
): THREE.Material | null {
  if (materialPreset) {
    return createMaterialFromPresetRef(materialPreset, shading)
  }

  if (material) {
    return createMaterial(material, shading)
  }

  return null
}

export function getRoofMaterialArray(
  node: RoofNode,
  shading: RenderShading = 'rendered',
  textures = true,
  colorPreset: ColorPreset = 'clay',
): RoofMaterialArray | null {
  const top = getEffectiveRoofSurfaceMaterial(node, 'top')
  const edge = getEffectiveRoofSurfaceMaterial(node, 'edge')
  const wall = getEffectiveRoofSurfaceMaterial(node, 'wall')
  const cacheKey = JSON.stringify({
    shading,
    textures,
    colorPreset,
    top: getSurfaceMaterialSignature(top),
    edge: getSurfaceMaterialSignature(edge),
    wall: getSurfaceMaterialSignature(wall),
  })

  const cached = roofMaterialArrayCache.get(cacheKey)
  if (cached) return cached

  if (!textures) {
    const roofMaterial = createSurfaceRoleMaterial('roof', colorPreset)
    const ceilingMaterial = createSurfaceRoleMaterial('ceiling', colorPreset)
    const materialArray: RoofMaterialArray = [
      roofMaterial,
      ceilingMaterial,
      ceilingMaterial,
      roofMaterial,
    ]
    roofMaterialArrayCache.set(cacheKey, materialArray)
    return materialArray
  }

  const topMaterial = createResolvedMaterial(top.material, top.materialPreset, shading)
  const edgeMaterial = createResolvedMaterial(edge.material, edge.materialPreset, shading)
  const wallMaterial = createResolvedMaterial(wall.material, wall.materialPreset, shading)

  if (!(topMaterial || edgeMaterial || wallMaterial)) {
    return null
  }

  const materialArray: RoofMaterialArray = [
    edgeMaterial ?? wallMaterial ?? topMaterial ?? createDefaultMaterial('#ffffff', 0.9, shading),
    wallMaterial ?? edgeMaterial ?? topMaterial ?? createDefaultMaterial('#ffffff', 0.9, shading),
    wallMaterial ?? edgeMaterial ?? topMaterial ?? createDefaultMaterial('#ffffff', 0.9, shading),
    topMaterial ?? wallMaterial ?? edgeMaterial ?? createDefaultMaterial('#ffffff', 0.9, shading),
  ]

  roofMaterialArrayCache.set(cacheKey, materialArray)
  return materialArray
}
