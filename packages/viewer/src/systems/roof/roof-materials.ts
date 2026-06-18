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
  resolveSlotDefaultMaterial,
} from '../../lib/materials'

// Declared catalog defaults for an unpainted roof, per the 4-slot layout
// (0 wall/trim · 1 deck · 2 interior soffit · 3 shingle top). The wall/trim
// band mirrors the wall kind's default (WALL_SLOT_DEFAULT = concrete-drywall)
// so a roof reads as continuous with the walls below it.
const ROOF_DEFAULT_REFS: [string, string, string, string] = [
  'library:concrete-drywall',
  'library:preset-softwhite',
  'library:preset-softwhite',
  'library:roof-terracottatiles',
]

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

  // Textures-off (monochrome) is the guaranteed escape hatch: themed role
  // colours, no catalog finishes.
  if (!textures) {
    roofMaterialArrayCache.set(cacheKey, roleArray)
    return roleArray
  }

  // Textures-on default appearance: catalog finishes per slot (terracotta
  // shingle, soft-white deck/soffit, wall-coloured trim). Used both when the
  // roof is unpainted and to fill any individual unpainted slot below.
  const defaultArray: RoofMaterialArray = [
    resolveSlotDefaultMaterial(ROOF_DEFAULT_REFS[0], shading),
    resolveSlotDefaultMaterial(ROOF_DEFAULT_REFS[1], shading),
    resolveSlotDefaultMaterial(ROOF_DEFAULT_REFS[2], shading),
    resolveSlotDefaultMaterial(ROOF_DEFAULT_REFS[3], shading),
  ]

  const topMaterial = createResolvedMaterial(top.material, top.materialPreset, shading)
  const edgeMaterial = createResolvedMaterial(edge.material, edge.materialPreset, shading)
  const wallMaterial = createResolvedMaterial(wall.material, wall.materialPreset, shading)

  if (!(topMaterial || edgeMaterial || wallMaterial)) {
    roofMaterialArrayCache.set(cacheKey, defaultArray)
    return defaultArray
  }

  // Each slot resolves to its own role only, then the declared default — never
  // another role. Cross-role fallback here used to splatter a single painted
  // surface (e.g. the edge) across the shingle and soffit slots. The legacy
  // catch-all still fills every role because `getEffectiveRoofSurfaceMaterial`
  // returns it for top/edge/wall alike.
  const materialArray: RoofMaterialArray = [
    edgeMaterial ?? defaultArray[0],
    wallMaterial ?? defaultArray[1],
    wallMaterial ?? defaultArray[2],
    topMaterial ?? defaultArray[3],
  ]

  roofMaterialArrayCache.set(cacheKey, materialArray)
  return materialArray
}
