import { getMaterialPresetByRef, type SlabNode } from '@pascal-app/core'
import {
  applyMaterialPresetToMaterials,
  createMaterial,
  DEFAULT_SLAB_MATERIAL,
  generateSlabGeometry,
} from '@pascal-app/viewer'
import { DoubleSide, Group, Mesh, MeshStandardMaterial } from 'three'

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
const slabMaterialCache = new Map<string, MeshStandardMaterial>()

function getSlabMaterial(node: SlabNode): MeshStandardMaterial {
  const cacheKey = JSON.stringify({
    material: node.material ?? null,
    materialPreset: node.materialPreset ?? null,
  })
  const cached = slabMaterialCache.get(cacheKey)
  if (cached) return cached

  const preset = getMaterialPresetByRef(node.materialPreset)
  const material = preset
    ? new MeshStandardMaterial()
    : node.material
      ? createMaterial(node.material).clone()
      : DEFAULT_SLAB_MATERIAL.clone()

  if (preset) {
    applyMaterialPresetToMaterials(material, preset)
  }

  material.transparent = false
  material.opacity = 1
  material.alphaMap = null
  material.side = DoubleSide
  material.depthWrite = true
  material.needsUpdate = true

  slabMaterialCache.set(cacheKey, material)
  return material
}

export function buildSlabGeometry(node: SlabNode): Group {
  const group = new Group()
  const geometry = generateSlabGeometry(node)
  const material = getSlabMaterial(node)
  const mesh = new Mesh(geometry, material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  group.add(mesh)
  return group
}
