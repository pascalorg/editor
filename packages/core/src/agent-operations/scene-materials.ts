import { refuse } from '../agent-tools/refusal'
import { parseMaterialRef, toSceneMaterialRef } from '../material-library'
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
