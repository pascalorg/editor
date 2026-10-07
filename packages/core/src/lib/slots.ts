import { materialColorPaint, parseMaterialColor, parseMaterialRef } from '../material-library'
import type { MaterialSchema } from '../schema/material'
import type { SceneMaterial, SceneMaterialId } from '../schema/scene-material'

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

/**
 * A slot's declared `default` as a paint material: a `library:` / `scene:` ref
 * stays a ref, a `#rrggbb` colour becomes a flat colour. What an unpainted slot
 * draws, for the eyedropper; null for anything else.
 */
export function slotDefaultPaintMaterial(
  value: string | undefined,
): { material?: MaterialSchema; materialPreset?: string } | null {
  if (!value) return null
  if (parseMaterialRef(value)) return { materialPreset: value }
  if (!/^#[0-9a-f]{6}$/i.test(value)) return null
  return {
    material: {
      preset: 'custom',
      properties: {
        color: value.toLowerCase(),
        roughness: 0.9,
        metalness: 0,
        opacity: 1,
        transparent: false,
        side: 'front',
      },
    },
  }
}

/**
 * A painted slot value as a paint material — what the eyedropper picks: a
 * `library:` ref stays a ref, a `scene:` ref gives its scene material, a plain
 * colour the flat material it renders as. Null when absent or dangling.
 */
export function slotPaintMaterial(
  value: string | undefined,
  sceneMaterials: Record<SceneMaterialId, SceneMaterial>,
): { material: MaterialSchema | undefined; materialPreset: string | undefined } | null {
  const color = parseMaterialColor(value)
  if (color) return { material: materialColorPaint(color), materialPreset: undefined }
  const parsed = parseMaterialRef(value)
  if (!parsed) return null
  if (parsed.kind === 'library') return { material: undefined, materialPreset: value }
  const sceneMaterial = sceneMaterials[parsed.id as SceneMaterialId]
  return sceneMaterial ? { material: sceneMaterial.material, materialPreset: undefined } : null
}
