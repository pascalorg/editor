import {
  type ColorPreset,
  createDefaultMaterial,
  createSurfaceRoleMaterial,
  type RenderShading,
  resolveSlotDefaultMaterial,
} from '@pascal-app/viewer'
import * as THREE from 'three'

// Production materials — match the rest of the scene (white walls, light-gray slabs).
// Indices: 0 = Wall/Trim, 1 = Deck, 2 = Interior, 3 = Shingle, 4 = Heel band, 5/6 = Gables
const roofMaterialsCache = new Map<string, THREE.Material[]>()

export function getRoofMaterials(
  shading: RenderShading = 'rendered',
  textures = true,
  colorPreset: ColorPreset = 'clay',
): THREE.Material[] {
  const cacheKey = `${shading}-${textures}-${colorPreset}`
  const cached = roofMaterialsCache.get(cacheKey)
  if (cached) return cached

  const materials = textures
    ? [
        // Mirrors getRoofMaterialArray's catalog defaults (wall/trim drywall,
        // soft-white deck + soffit, terracotta shingle) for the no-parent path.
        resolveSlotDefaultMaterial('library:concrete-drywall', shading), // 0: Wall/Trim
        resolveSlotDefaultMaterial('library:preset-softwhite', shading), // 1: Deck
        resolveSlotDefaultMaterial('library:preset-softwhite', shading), // 2: Interior
        resolveSlotDefaultMaterial('library:roof-terracottatiles', shading), // 3: Shingle
        resolveSlotDefaultMaterial('library:concrete-drywall', shading), // 4: Heel band
        resolveSlotDefaultMaterial('library:concrete-drywall', shading), // 5: Left gable
        resolveSlotDefaultMaterial('library:concrete-drywall', shading), // 6: Right gable
      ]
    : [
        createSurfaceRoleMaterial('roof', colorPreset),
        createSurfaceRoleMaterial('ceiling', colorPreset),
        createSurfaceRoleMaterial('ceiling', colorPreset),
        createSurfaceRoleMaterial('roof', colorPreset),
        createSurfaceRoleMaterial('wall', colorPreset),
        createSurfaceRoleMaterial('roof', colorPreset),
        createSurfaceRoleMaterial('roof', colorPreset),
      ]
  roofMaterialsCache.set(cacheKey, materials)
  return materials
}

// Debug materials — vivid, distinct colours to identify each surface group.
const roofDebugMaterialsCache = new Map<RenderShading, THREE.Material[]>()

export function getRoofDebugMaterials(shading: RenderShading = 'rendered'): THREE.Material[] {
  const cached = roofDebugMaterialsCache.get(shading)
  if (cached) return cached

  const materials = [
    createDefaultMaterial('#eaeaea', 0.8, shading, THREE.DoubleSide), // 0: Wall
    createDefaultMaterial('#000000', 0.9, shading, THREE.FrontSide), // 1: Deck
    createDefaultMaterial('#dddddd', 0.9, shading, THREE.DoubleSide), // 2: Interior
    createDefaultMaterial('#4ade80', 0.9, shading, THREE.FrontSide), // 3: Shingle
    createDefaultMaterial('#f5d0a9', 0.8, shading, THREE.DoubleSide), // 4: Heel band
    createDefaultMaterial('#93c5fd', 0.8, shading, THREE.DoubleSide), // 5: Left gable
    createDefaultMaterial('#c4b5fd', 0.8, shading, THREE.DoubleSide), // 6: Right gable
  ]
  roofDebugMaterialsCache.set(shading, materials)
  return materials
}
