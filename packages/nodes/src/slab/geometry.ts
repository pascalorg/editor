import { type GeometryContext, getMaterialPresetByRef, type SlabNode } from '@pascal-app/core'
import {
  applyMaterialPresetToMaterials,
  type ColorPreset,
  createDefaultMaterial,
  createMaterial,
  createSurfaceRoleMaterial,
  generateSlabGeometry,
  type RenderShading,
  resolveMaterialRef,
} from '@pascal-app/viewer'
import { FrontSide, Group, type Material, Mesh, type Texture } from 'three'
import { SLAB_SLOT_DEFAULT_COLOR } from './slots'

/**
 * Stage B builder for slab. Reuses `generateSlabGeometry` (pure
 * triangulation + hole CSG from viewer) and the same material cache
 * pattern the legacy slab renderer used.
 *
 * Materials follow the unified slot model: the single `surface` slot resolves
 * `node.slots.surface` (a shared scene material or `library:` finish) → the
 * legacy inline `node.material` / `materialPreset` (pre-slot-model scenes) →
 * the declared slot default colour. Textures-off collapses to the themed
 * `floor` role — the guaranteed monochrome escape hatch.
 */
type SlabMaterial = Material & {
  alphaMap?: Texture | null
  depthWrite: boolean
  opacity: number
  transparent: boolean
}

const slabMaterialCache = new Map<string, Material>()

function getSlabMaterial(
  node: SlabNode,
  shading: RenderShading,
  textures: boolean,
  colorPreset: ColorPreset,
  sceneTheme: string | undefined,
  sceneMaterials: GeometryContext['materials'],
): Material {
  // Textures-off mode takes the themed 'floor' role colour — the guaranteed
  // escape hatch, independent of any slot override. createSurfaceRoleMaterial
  // returns a shared cached material. FrontSide — DoubleSide on the role
  // material's NodeMaterial poisons the MRT scene pass (see `materials.ts`
  // line 77 / glazing fix 9400f1c5). Slab side faces still render correctly
  // because `generateSlabGeometry` produces outward-facing normals.
  if (!textures) {
    return createSurfaceRoleMaterial('floor', colorPreset, FrontSide, sceneTheme)
  }

  // Unified slot override — shared scene material or catalog `library:` finish.
  const slotRef = node.slots?.surface
  if (slotRef) {
    const resolved = resolveMaterialRef(slotRef, sceneMaterials, shading)
    if (resolved) return resolved
  }

  // Legacy inline material / preset, for scenes painted before the slot model.
  if (node.materialPreset || node.material) {
    return getLegacySlabMaterial(node, shading)
  }

  // Declared slot default (visual parity with the retired DEFAULT_SLAB_MATERIAL).
  return createDefaultMaterial(SLAB_SLOT_DEFAULT_COLOR, 0.8, shading)
}

function getLegacySlabMaterial(node: SlabNode, shading: RenderShading): Material {
  // Cached by `{material, materialPreset}` signature so slabs sharing settings
  // share the GPU resource; cached entry mutation (preset apply) is preserved
  // so async texture loads still update the rendered material after re-mount.
  const cacheKey = JSON.stringify({
    shading,
    material: node.material ?? null,
    materialPreset: node.materialPreset ?? null,
  })
  const cached = slabMaterialCache.get(cacheKey)
  if (cached) return cached

  const preset = getMaterialPresetByRef(node.materialPreset)
  const material = preset
    ? createDefaultMaterial('#ffffff', 0.5, shading)
    : node.material
      ? createMaterial(node.material, shading).clone()
      : createDefaultMaterial(SLAB_SLOT_DEFAULT_COLOR, 0.8, shading)

  if (preset) {
    applyMaterialPresetToMaterials(material, preset)
  }

  const slabMaterial = material as SlabMaterial
  slabMaterial.transparent = false
  slabMaterial.opacity = 1
  slabMaterial.alphaMap = null
  // FrontSide — user-supplied materials may be NodeMaterials, and DoubleSide
  // on any NodeMaterial in the MRT scene pass poisons the render context
  // (see `materials.ts` line 77 / glazing fix 9400f1c5).
  slabMaterial.side = FrontSide
  slabMaterial.depthWrite = true
  slabMaterial.needsUpdate = true

  slabMaterialCache.set(cacheKey, material)
  return material
}

export function buildSlabGeometry(
  node: SlabNode,
  ctx?: GeometryContext,
  shading: RenderShading = 'rendered',
  textures = true,
  colorPreset: ColorPreset = 'clay',
  sceneTheme?: string,
): Group {
  const group = new Group()
  const geometry = generateSlabGeometry(node)
  const material = getSlabMaterial(node, shading, textures, colorPreset, sceneTheme, ctx?.materials)
  const mesh = new Mesh(geometry, material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  // Tag the surface so the unified slot paint can resolve the hit and preview.
  mesh.userData.slotId = 'surface'
  const elevation = node.elevation ?? 0.05
  if (elevation < 0) mesh.position.y = elevation
  group.add(mesh)
  return group
}
