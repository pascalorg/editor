import {
  getEffectiveRoofSurfaceMaterial,
  type RoofNode,
  type RoofSegmentNode,
} from '@pascal-app/core'
import type * as THREE from 'three'
import {
  type ColorPreset,
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
  sceneTheme?: string,
): RoofMaterialArray | null {
  const top = getEffectiveRoofSurfaceMaterial(node, 'top')
  const edge = getEffectiveRoofSurfaceMaterial(node, 'edge')
  const wall = getEffectiveRoofSurfaceMaterial(node, 'wall')

  const cacheKey = JSON.stringify({
    shading,
    textures,
    colorPreset,
    sceneTheme,
    top: getSurfaceMaterialSignature(top),
    edge: getSurfaceMaterialSignature(edge),
    wall: getSurfaceMaterialSignature(wall),
  })

  const cached = roofMaterialArrayCache.get(cacheKey)
  if (cached) return cached

  // Themed role colours: roof top/edge use the 'roof' role, the soffit/underside
  // uses 'ceiling'. These also fill any untextured slot so an untextured roof is
  // theme-coloured regardless of the textures toggle (no more white default).
  const roofMaterial = createSurfaceRoleMaterial('roof', colorPreset, undefined, sceneTheme)
  const ceilingMaterial = createSurfaceRoleMaterial('ceiling', colorPreset, undefined, sceneTheme)
  const roleArray: RoofMaterialArray = [
    roofMaterial,
    ceilingMaterial,
    ceilingMaterial,
    roofMaterial,
  ]

  if (!textures) {
    roofMaterialArrayCache.set(cacheKey, roleArray)
    return roleArray
  }

  const topMaterial = createResolvedMaterial(top.material, top.materialPreset, shading)
  const edgeMaterial = createResolvedMaterial(edge.material, edge.materialPreset, shading)
  const wallMaterial = createResolvedMaterial(wall.material, wall.materialPreset, shading)

  if (!(topMaterial || edgeMaterial || wallMaterial)) {
    roofMaterialArrayCache.set(cacheKey, roleArray)
    return roleArray
  }

  // Each slot resolves to its own role only, then the themed default — never
  // another role. Cross-role fallback here used to splatter a single painted
  // surface (e.g. the edge) across the shingle and soffit slots. The legacy
  // catch-all still fills every role because `getEffectiveRoofSurfaceMaterial`
  // returns it for top/edge/wall alike.
  const materialArray: RoofMaterialArray = [
    edgeMaterial ?? roofMaterial,
    wallMaterial ?? ceilingMaterial,
    wallMaterial ?? ceilingMaterial,
    topMaterial ?? roofMaterial,
  ]

  roofMaterialArrayCache.set(cacheKey, materialArray)
  return materialArray
}

export function getRoofMaterialCacheSize(): number {
  return roofMaterialArrayCache.size
}

export function clearRoofMaterialCache(): void {
  const materials = new Set<THREE.Material>()
  for (const materialArray of roofMaterialArrayCache.values()) {
    for (const material of materialArray) {
      materials.add(material)
    }
  }
  for (const material of materials) {
    material.dispose()
  }
  roofMaterialArrayCache.clear()
}
