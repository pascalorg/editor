import {
  getCatalogMaterialById,
  LIBRARY_MATERIAL_REF_PREFIX,
  MATERIAL_CATALOG,
  parseMaterialColor,
  parseMaterialRef,
} from '../material-library'
import { nodeSlotDeclarations } from '../node-slots'
import { AnyNode } from '../schema'

const isPresetField = (key: string) => key === 'materialPreset' || key.endsWith('MaterialPreset')

// Community-library ids (`library:mtl_…`): the host checks them against its
// material catalog; without one they pass.
const COMMUNITY_MATERIAL_ID_PREFIX = 'mtl_'

function isKnownMaterialRef(value: string): boolean {
  const ref = parseMaterialRef(value)
  if (!ref) return false
  if (ref.kind === 'scene' || ref.id.startsWith(COMMUNITY_MATERIAL_ID_PREFIX)) return true
  return !!getCatalogMaterialById(ref.id)
}

function presetCatalogLine(): string {
  const byCategory = new Map<string, string[]>()
  for (const item of MATERIAL_CATALOG) {
    const ids = byCategory.get(item.category) ?? []
    ids.push(item.id)
    byCategory.set(item.category, ids)
  }
  return [...byCategory].map(([category, ids]) => `${category}: ${ids.join(', ')}`).join('; ')
}

// The slot ids the node exposes as it stands before this write's own slot
// keys (a block's slot list includes the keys of its `slots`); null when its
// kind declares none or the node does not parse.
function declaredSlotIds(
  data: Record<string, unknown>,
  current: Record<string, unknown> | undefined,
): string[] | null {
  const parsed = AnyNode.safeParse({ ...current, ...data, slots: current?.slots ?? {} })
  if (!parsed.success) return null
  return nodeSlotDeclarations(parsed.data)?.map((slot) => slot.slotId) ?? null
}

/**
 * Why a write (an update's data, a created node, a tool's arguments) may not
 * store a `materialPreset` / `*MaterialPreset` value or a `slots` entry, or
 * null. A preset or slot value that names no catalog material renders as the
 * default finish, and a slot the node does not have never renders, so the
 * caller would believe a finish landed that never shows. A slot also takes a
 * plain `#rrggbb` colour. Restating a node's current value passes, so an older
 * node's bad value never blocks an unrelated edit.
 */
export function unknownMaterialPresetRefusal(
  data: Record<string, unknown>,
  current?: Record<string, unknown>,
): string | null {
  const unknown: string[] = []
  for (const [key, value] of Object.entries(data)) {
    if (!isPresetField(key) || typeof value !== 'string') continue
    if (current && current[key] === value) continue
    if (!isKnownMaterialRef(value)) unknown.push(`${key} ${JSON.stringify(value)}`)
  }
  const parts: string[] = []
  if (data.slots && typeof data.slots === 'object') {
    const currentSlots = current?.slots as Record<string, unknown> | undefined
    const changed = Object.entries(data.slots).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === 'string' && currentSlots?.[entry[0]] !== entry[1],
    )
    for (const [slot, value] of changed) {
      if (!(parseMaterialColor(value) || isKnownMaterialRef(value))) {
        unknown.push(`slots.${slot} ${JSON.stringify(value)}`)
      }
    }
    const slotIds = changed.length > 0 ? declaredSlotIds(data, current) : null
    const missing = slotIds ? changed.filter(([slot]) => !slotIds.includes(slot)) : []
    if (missing.length > 0) {
      parts.push(
        `A ${String(data.type ?? current?.type)} has no slot ${missing.map(([slot]) => JSON.stringify(slot)).join(', ')}; its slots are ${slotIds?.join(', ')}.`,
      )
    }
  }
  if (unknown.length > 0) {
    parts.push(
      `Unknown material (${unknown.join(', ')}). A material is "${LIBRARY_MATERIAL_REF_PREFIX}<id>" with an id from ${presetCatalogLine()}. A slot also takes a plain colour such as "#2f5585"; to colour a whole node, paint it with material: { properties: { color: "#rrggbb" } }.`,
    )
  }
  if (parts.length === 0) return null
  return `${parts.join(' ')} Nothing was changed.`
}
