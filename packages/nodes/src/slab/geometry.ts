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
  resolveSlotDefaultMaterial,
} from '@pascal-app/viewer'
import {
  BufferGeometry,
  Float32BufferAttribute,
  FrontSide,
  Group,
  type Material,
  Mesh,
  type Texture,
  Vector3,
} from 'three'
import { SLAB_SIDE_SLOT_DEFAULT, SLAB_TOP_SLOT_DEFAULT, type SlabSlotId } from './slots'

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

function getSlabSlotMaterial(
  node: SlabNode,
  slotId: SlabSlotId,
  shading: RenderShading,
  textures: boolean,
  colorPreset: ColorPreset,
  sceneTheme: string | undefined,
  sceneMaterials: GeometryContext['materials'],
): Material {
  // Textures-off mode takes the themed 'floor' role colour for every face — the
  // guaranteed escape hatch, independent of any slot override. FrontSide —
  // DoubleSide on the role material's NodeMaterial poisons the MRT scene pass
  // (see `materials.ts` line 77 / glazing fix 9400f1c5). Slab side faces still
  // render correctly because `generateSlabGeometry` emits outward-facing normals.
  if (!textures) {
    return createSurfaceRoleMaterial('floor', colorPreset, FrontSide, sceneTheme)
  }

  // Unified slot override — shared scene material or catalog `library:` finish.
  const slotRef = node.slots?.[slotId]
  if (slotRef) {
    const resolved = resolveMaterialRef(slotRef, sceneMaterials, shading)
    if (resolved) return resolved
  }

  // Legacy inline material / preset (pre-slot-model scenes) applied to the whole
  // slab — map it onto the top face only; sides take their own default.
  if (slotId === 'surface' && (node.materialPreset || node.material)) {
    return getLegacySlabMaterial(node, shading)
  }

  // Declared slot default — a catalog `library:` finish or a flat colour.
  const slotDefault = slotId === 'side' ? SLAB_SIDE_SLOT_DEFAULT : SLAB_TOP_SLOT_DEFAULT
  return resolveSlotDefaultMaterial(slotDefault, shading, 0.8)
}

// Split the merged slab buffer into top-facing (floor) and everything-else
// (vertical walls + underside) sub-geometries by per-triangle face normal, so
// the two paintable slots get distinct materials + raycast tags. De-indexes
// into per-face triangles (slabs are flat-shaded, so no shared-vertex seams).
function splitSlabFacesByFacing(geometry: BufferGeometry): {
  top: BufferGeometry
  side: BufferGeometry
} {
  const position = geometry.getAttribute('position')
  const uv = geometry.getAttribute('uv')
  const index = geometry.getIndex()
  const triangleCount = index ? index.count / 3 : position.count / 3

  const top = { pos: [] as number[], uv: [] as number[] }
  const side = { pos: [] as number[], uv: [] as number[] }
  const a = new Vector3()
  const b = new Vector3()
  const c = new Vector3()
  const ab = new Vector3()
  const ac = new Vector3()
  const normal = new Vector3()

  for (let t = 0; t < triangleCount; t += 1) {
    const i0 = index ? index.getX(t * 3) : t * 3
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2
    a.fromBufferAttribute(position, i0)
    b.fromBufferAttribute(position, i1)
    c.fromBufferAttribute(position, i2)
    ab.subVectors(b, a)
    ac.subVectors(c, a)
    normal.crossVectors(ab, ac)
    const lengthSq = normal.lengthSq()
    const isTop = lengthSq > 1e-12 && normal.y / Math.sqrt(lengthSq) > 0.5
    const target = isTop ? top : side
    for (const i of [i0, i1, i2]) {
      target.pos.push(position.getX(i), position.getY(i), position.getZ(i))
      if (uv) target.uv.push(uv.getX(i), uv.getY(i))
    }
  }

  const build = (data: { pos: number[]; uv: number[] }) => {
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute(data.pos, 3))
    if (data.uv.length > 0) geo.setAttribute('uv', new Float32BufferAttribute(data.uv, 2))
    geo.computeVertexNormals()
    return geo
  }

  return { top: build(top), side: build(side) }
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
      : createDefaultMaterial('#e5e5e5', 0.8, shading)

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
  const merged = generateSlabGeometry(node)
  const { top, side } = splitSlabFacesByFacing(merged)
  merged.dispose()

  const elevation = node.elevation ?? 0.05
  // One mesh per slot, each tagged with its slot id so the unified slot paint
  // resolves the hit (`resolveRole` reads `userData.slotId`) and previews it.
  for (const [slotId, geometry] of [
    ['surface', top],
    ['side', side],
  ] as const) {
    const material = getSlabSlotMaterial(
      node,
      slotId,
      shading,
      textures,
      colorPreset,
      sceneTheme,
      ctx?.materials,
    )
    const mesh = new Mesh(geometry, material)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.userData.slotId = slotId
    if (elevation < 0) mesh.position.y = elevation
    group.add(mesh)
  }
  return group
}
