import { parseMaterialRef, toSceneMaterialRef } from '../material-library'
import { getEffectiveWallSurfaceMaterial, type WallSurfaceSide } from '../schema/nodes/wall'
import type { SceneMaterial, SceneMaterialId } from '../schema/scene-material'

// Legacy inline finishes (`material*` / `materialPreset*`) → `node.slots`,
// shared by the client loader and the hosted authority. Both must run it
// before the structural migrations that read slots (M1 re-keys wall slots by
// face, the floor-plate migration copies a slab's surface onto its room), or
// the two paths store different graphs for the same scene.

export type MintedMaterials = Record<SceneMaterialId, SceneMaterial>

function hash53(text: string, seed: number) {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

// Content-derived, so every load of the same legacy scene — the authority
// normalises the stored graph on each read — mints the same id.
function legacySceneMaterialId(materialJson: string): SceneMaterialId {
  const digest = hash53(materialJson, 0).toString(36).padStart(11, '0')
  return `mat_${(digest + hash53(materialJson, 1).toString(36).padStart(11, '0')).slice(0, 16)}`
}

/**
 * A legacy surface spec as a `MaterialRef`: a preset that is already a
 * `library:`/`scene:` ref is used as-is; an inline material mints (or reuses)
 * a scene material in `minted`. Undefined when the spec carries no material.
 */
export function legacySpecToMaterialRef(
  spec: { material?: unknown; materialPreset?: unknown },
  minted: MintedMaterials,
): string | undefined {
  if (typeof spec.materialPreset === 'string' && parseMaterialRef(spec.materialPreset)) {
    return spec.materialPreset
  }
  if (spec.material === undefined) return
  const json = JSON.stringify(spec.material)
  const id = legacySceneMaterialId(json)
  // One shared datablock per custom colour (mirrors `commitSlotPaint`'s dedupe-on-match).
  minted[id] ??= {
    id,
    name: `Material ${Object.keys(minted).length + 1}`,
    material: spec.material as SceneMaterial['material'],
  }
  return toSceneMaterialRef(id)
}

// Move the retired inline `material*` / `interiorMaterial*` / `exteriorMaterial*`
// fields onto `node.slots` (interior / exterior → a ref). Already slot-modelled
// walls and walls with no legacy material are left untouched.
export function migrateWallSurfaceMaterials(node: Record<string, any>, minted: MintedMaterials) {
  if (node.slots && (node.slots.interior !== undefined || node.slots.exterior !== undefined)) {
    return node
  }
  // Already on geometric faces (M1 ran on an earlier load): its legacy fallback
  // is per face now, and re-keying it by side would undo that.
  if (
    node.legacyFaceMaterials ||
    (node.slots && (node.slots.a !== undefined || node.slots.b !== undefined))
  ) {
    return node
  }

  const slots: Record<string, string> = { ...(node.slots ?? {}) }
  for (const side of ['interior', 'exterior'] as WallSurfaceSide[]) {
    const spec = getEffectiveWallSurfaceMaterial(
      node as Parameters<typeof getEffectiveWallSurfaceMaterial>[0],
      side,
    )
    const ref = legacySpecToMaterialRef(spec, minted)
    if (ref) slots[side] = ref
  }

  if (Object.keys(slots).length === 0) {
    return node
  }

  return {
    ...node,
    slots,
    material: undefined,
    materialPreset: undefined,
    interiorMaterial: undefined,
    interiorMaterialPreset: undefined,
    exteriorMaterial: undefined,
    exteriorMaterialPreset: undefined,
  }
}

// Move a kind's single legacy `material` / `materialPreset` onto its declared
// slots. A pre-slot-model node painted one material rendered that material on
// every part (each slot resolves `node.slots[slot]` → legacy → default), so the
// migration writes the same ref to every slot id the kind can expose — unused
// conditional slots are harmless. Already slot-modelled or unpainted nodes are
// left untouched.
export function migrateSingleMaterialSlots(
  node: Record<string, any>,
  slotIds: readonly string[],
  minted: MintedMaterials,
) {
  if (node.slots && Object.keys(node.slots).length > 0) {
    return node
  }

  const ref = legacySpecToMaterialRef(
    { material: node.material, materialPreset: node.materialPreset },
    minted,
  )
  if (!ref) {
    return node
  }

  const slots: Record<string, string> = {}
  for (const slotId of slotIds) slots[slotId] = ref

  return { ...node, slots, material: undefined, materialPreset: undefined }
}

/**
 * The legacy-finish migrations of the kinds the structural load migrations
 * read (walls, slabs, ceilings), for the hosted authority: the client loader
 * runs the same per-node functions in `migrateNodes`.
 */
export function migrateStructuralMaterialSlots(sourceNodes: Record<string, unknown>) {
  const materials: MintedMaterials = {}
  let nodes: Record<string, unknown> | null = null
  for (const [id, value] of Object.entries(sourceNodes)) {
    const node = value as Record<string, any> | null
    if (!node || typeof node !== 'object') continue
    const next =
      node.type === 'wall'
        ? migrateWallSurfaceMaterials(node, materials)
        : node.type === 'slab' || node.type === 'ceiling'
          ? migrateSingleMaterialSlots(node, ['surface'], materials)
          : node
    if (next === node) continue
    nodes ??= { ...sourceNodes }
    nodes[id] = next
  }
  return { nodes: nodes ?? sourceNodes, materials, changed: nodes !== null }
}
