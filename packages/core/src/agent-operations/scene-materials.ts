import { refuse } from '../agent-tools/refusal'
import { parseMaterialRef, toSceneMaterialRef } from '../material-library'
import type { CompiledGeometryScript } from '../schema'
import { MaterialSchema } from '../schema/material'
import {
  generateSceneMaterialId,
  type SceneMaterial,
  type SceneMaterialId,
} from '../schema/scene-material'

/** Whether two parsed values are the same, whatever their keys' order. */
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => equal(value, b[index]))
    )
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  return (
    Object.keys(left).length === Object.keys(right).length &&
    Object.keys(left).every((key) => Object.hasOwn(right, key) && equal(left[key], right[key]))
  )
}

/**
 * A native material as the editor's Paint keeps a one-off: the scene's equal material when it has
 * one (compared as the schema reads both), else a new scene material. Refused where the host
 * cannot store scene materials, so no node points at a material nothing keeps.
 */
export function resolveInlinePaintMaterial(
  materials: Readonly<Record<SceneMaterialId, SceneMaterial>> | undefined,
  input: MaterialSchema,
  name?: string,
): { ref: string; sceneMaterial: SceneMaterial; created: boolean } {
  if (!materials)
    refuse(
      'materials_unavailable',
      'This host cannot keep native materials: give a library material or a colour. Nothing was painted.',
    )
  const parsed = MaterialSchema.safeParse(input)
  if (!parsed.success) refuse('invalid_material', `Not a native material: ${parsed.error.message}`)
  for (const existing of Object.values(materials)) {
    const normalized = MaterialSchema.safeParse(existing.material)
    if (normalized.success && equal(normalized.data, parsed.data))
      return { ref: toSceneMaterialRef(existing.id), sceneMaterial: existing, created: false }
  }
  let id = generateSceneMaterialId()
  while (materials[id]) id = generateSceneMaterialId()
  const sceneMaterial = {
    id,
    name: name ?? `Material ${Object.keys(materials).length + 1}`,
    material: parsed.data,
  }
  return { ref: toSceneMaterialRef(id), sceneMaterial, created: true }
}

const GLASS_REF = 'library:preset-glass'

/** How a colour's surface reflects: a module's own values, or a matte paint. */
export type ColorSurface = { roughness: number; metalness: number }
export const MATTE: ColorSurface = { roughness: 0.9, metalness: 0 }

/**
 * A colour kept exactly rather than snapped to the library: a native material named by its hex
 * (and its surface, when not matte), so the same colour and surface reuse one scene material.
 */
export function exactColorMaterial(
  materials: Readonly<Record<SceneMaterialId, SceneMaterial>> | undefined,
  hex: string,
  surface: ColorSurface = MATTE,
) {
  const color = hex.toLowerCase()
  return resolveInlinePaintMaterial(
    materials,
    {
      properties: {
        color,
        roughness: surface.roughness,
        metalness: surface.metalness,
        opacity: 1,
        transparent: false,
        side: 'front',
      },
    },
    surface.roughness === MATTE.roughness && surface.metalness === MATTE.metalness
      ? color
      : `${color}, roughness ${+surface.roughness.toFixed(2)}, metalness ${+surface.metalness.toFixed(2)}`,
  )
}

/**
 * A compiled module's slots with each of its own colours written exactly, over the library
 * matches: glass keeps the library glass (drawn see-through, letting light pass) and an emissive
 * slot its module's material (a scene material carries no emission, so a bulb stays lit).
 * `exact` answers a colour's ref, or undefined to keep the match.
 */
export function exactScriptSlots(
  manifest: CompiledGeometryScript['manifest'],
  matched: Record<string, string>,
  exact: (hex: string, surface: ColorSurface) => string | undefined,
): Record<string, string> {
  const slots = { ...matched }
  for (const slot of manifest.slots) {
    if (!slot.color || slot.emissive || slots[slot.id] === GLASS_REF) continue
    const ref = exact(slot.color, {
      roughness: slot.roughness ?? MATTE.roughness,
      metalness: slot.metalness ?? MATTE.metalness,
    })
    if (ref) slots[slot.id] = ref
  }
  return slots
}

/** The scene materials a node points at, in its slots and its role fields alike. */
export function referencedSceneMaterialIds(value: unknown): Set<string> {
  const ids = new Set<string>()
  const visit = (entry: unknown) => {
    if (typeof entry === 'string') {
      const parsed = parseMaterialRef(entry)
      if (parsed?.kind === 'scene') ids.add(parsed.id)
    } else if (entry && typeof entry === 'object')
      for (const child of Object.values(entry)) visit(child)
  }
  visit(value)
  return ids
}
