import { type GeometryContext, getMaterialPresetByRef } from '@pascal-app/core'
import {
  applyMaterialPresetToMaterials,
  type ColorPreset,
  createDefaultMaterial,
  createMaterial,
  createSurfaceRoleMaterial,
  generateFenceGeometry,
  type RenderShading,
  resolveMaterialRef,
  resolveSlotDefaultMaterial,
} from '@pascal-app/viewer'
import { FrontSide, Group, type Material, Mesh, type Texture } from 'three'
import type { FenceNode } from './schema'
import { FENCE_SLOT_DEFAULT } from './slots'

/**
 * Stage B builder for fence. Reuses the legacy `generateFenceGeometry`
 * (pure function from viewer that returns a merged BufferGeometry of
 * posts + base + top rail + curve spans) and wraps it in a Mesh-in-Group
 * shape the generic `<GeometrySystem>` expects.
 *
 * Materials follow the unified slot model: the single `surface` slot resolves
 * `node.slots.surface` (a shared scene material or `library:` finish) → the
 * legacy inline `node.material` / `materialPreset` (pre-slot-model scenes) →
 * the declared slot default. Textures-off collapses to themed joinery.
 *
 * Phase 6 cleanup moves the 280 lines of geometry math out of the
 * legacy `viewer/src/systems/fence/fence-system.tsx` into this folder
 * once the legacy system file is deleted. Until then `generateFenceGeometry`
 * is publicly re-exported from viewer.
 */
type FenceMaterial = Material & {
  alphaMap?: Texture | null
  depthWrite: boolean
  opacity: number
  transparent: boolean
}

const fenceMaterialCache = new Map<string, Material>()

function getFenceMaterial(
  node: FenceNode,
  shading: RenderShading,
  textures: boolean,
  colorPreset: ColorPreset,
  sceneTheme: string | undefined,
  sceneMaterials: GeometryContext['materials'],
): Material {
  if (!textures) {
    return createSurfaceRoleMaterial('joinery', colorPreset, FrontSide, sceneTheme)
  }

  const slotRef = node.slots?.surface
  if (slotRef) {
    const resolved = resolveMaterialRef(slotRef, sceneMaterials, shading)
    if (resolved) return resolved
  }

  if (node.materialPreset || node.material) {
    return getLegacyFenceMaterial(node, shading)
  }

  return resolveSlotDefaultMaterial(FENCE_SLOT_DEFAULT, shading, 0.8)
}

function getLegacyFenceMaterial(node: FenceNode, shading: RenderShading): Material {
  const cacheKey = JSON.stringify({
    shading,
    material: node.material ?? null,
    materialPreset: node.materialPreset ?? null,
  })
  const cached = fenceMaterialCache.get(cacheKey)
  if (cached) return cached

  const preset = getMaterialPresetByRef(node.materialPreset)
  const material = preset
    ? createDefaultMaterial('#ffffff', 0.5, shading)
    : node.material
      ? createMaterial(node.material, shading).clone()
      : createDefaultMaterial('#ffffff', 0.9, shading)

  if (preset) {
    applyMaterialPresetToMaterials(material, preset)
  }

  const fenceMaterial = material as FenceMaterial
  fenceMaterial.transparent = false
  fenceMaterial.opacity = 1
  fenceMaterial.alphaMap = null
  fenceMaterial.side = FrontSide
  fenceMaterial.depthWrite = true
  fenceMaterial.needsUpdate = true

  fenceMaterialCache.set(cacheKey, material)
  return material
}

export function buildFenceGeometry(
  node: FenceNode,
  ctx?: GeometryContext,
  shading: RenderShading = 'rendered',
  textures = true,
  colorPreset: ColorPreset = 'clay',
  sceneTheme?: string,
): Group {
  const group = new Group()
  const geometry = generateFenceGeometry(node)
  const material = getFenceMaterial(node, shading, textures, colorPreset, sceneTheme, ctx?.materials)
  const mesh = new Mesh(geometry, material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData.slotId = 'surface'
  mesh.userData.surfaceRole = 'joinery'
  group.add(mesh)
  return group
}
