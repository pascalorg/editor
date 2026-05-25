import { getMaterialPresetByRef, type SlabNode } from '@pascal-app/core'
import {
  applyMaterialPresetToMaterials,
  type ColorPreset,
  createDefaultMaterial,
  createMaterial,
  createSurfaceRoleMaterial,
  DEFAULT_SLAB_MATERIAL,
  generateSlabGeometry,
  type RenderShading,
} from '@pascal-app/viewer'
import { DoubleSide, Group, type Material, Mesh, type Texture } from 'three'

/**
 * Stage B builder for slab. Reuses `generateSlabGeometry` (pure
 * triangulation + hole CSG from viewer) and the same material cache
 * pattern the legacy slab renderer used.
 *
 * Materials are cached by `{material, materialPreset}` signature so
 * slabs sharing settings share the GPU resource. Cached entry mutation
 * (preset apply) is preserved — async texture loads still update the
 * rendered material after re-mount.
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
  sceneTheme?: string,
): Material {
  // Untextured slabs (and everything in textures-off mode) take the themed
  // 'floor' role colour. createSurfaceRoleMaterial returns a shared cached
  // material, so it is returned as-is without the mutation below.
  if (!textures || (!node.materialPreset && !node.material)) {
    return createSurfaceRoleMaterial('floor', colorPreset, DoubleSide, sceneTheme)
  }

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
      : DEFAULT_SLAB_MATERIAL(shading).clone()

  if (preset) {
    applyMaterialPresetToMaterials(material, preset)
  }

  const slabMaterial = material as SlabMaterial
  slabMaterial.transparent = false
  slabMaterial.opacity = 1
  slabMaterial.alphaMap = null
  slabMaterial.side = DoubleSide
  slabMaterial.depthWrite = true
  slabMaterial.needsUpdate = true

  slabMaterialCache.set(cacheKey, material)
  return material
}

export function buildSlabGeometry(
  node: SlabNode,
  _ctx?: unknown,
  shading: RenderShading = 'rendered',
  textures = true,
  colorPreset: ColorPreset = 'clay',
  sceneTheme?: string,
): Group {
  const group = new Group()
  const geometry = generateSlabGeometry(node)
  const material = getSlabMaterial(node, shading, textures, colorPreset, sceneTheme)
  const mesh = new Mesh(geometry, material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  const elevation = node.elevation ?? 0.05
  if (elevation < 0) mesh.position.y = elevation
  group.add(mesh)
  return group
}
