export const SLOT_MATERIAL_PREFIX = 'slot_'

/** A glTF material name marks a paintable slot when it starts with `slot_` (case-insensitive). */
export function isSlotMaterialName(name: string): boolean {
  return name.toLowerCase().startsWith(SLOT_MATERIAL_PREFIX)
}

/**
 * Derive the stable slot id from a glTF material name:
 * strip the `slot_` prefix (case-insensitive), drop Blender numeric dedupe
 * suffixes like `.001`, lowercase the remainder. Returns null when the name
 * is not a slot material. Used by BOTH the upload scan (later) and the
 * renderer so DB metadata and runtime meshes can never drift.
 */
export function deriveSlotId(materialName: string): string | null {
  if (!isSlotMaterialName(materialName)) return null
  let rest = materialName.slice(SLOT_MATERIAL_PREFIX.length)
  rest = rest.replace(/\.\d+$/, '')
  return rest.toLowerCase()
}

/** slot id -> display label: underscores to spaces, sentence case. e.g. 'bed_frame' -> 'Bed frame'. */
export function slotLabelFromId(slotId: string): string {
  const spaced = slotId.replace(/_/g, ' ').trim()
  if (!spaced) return spaced
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
