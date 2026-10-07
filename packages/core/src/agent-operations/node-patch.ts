import { refuse } from '../agent-tools/refusal'
import { parseMaterialColor } from '../material-library'
import type { AnyNode } from '../schema'
import { parseNode } from '../schema/compiled-node-parsers'
import { finishSurface, requireMaterialRef } from './material-refs'

/**
 * An agent's edit of a node checked so it does what it says, the same on the MCP's apply_patch
 * and the chat's update_node. A pier once took five attempts: `material: {color}`
 * reported "applied" and stored `{}` (the schema drops unknown keys), `materialPreset: null` was
 * refused (no way to clear), an unknown preset rendered grey, and a `material` under a set preset
 * never showed. Returns the data to write: `null` (or an empty material ref) as `undefined`, which
 * the store reads as "remove the field". Free-form records (metadata, slots) keep every key, so they
 * pass as sent.
 */

/** The pairs where the first, set, hides the second: the renderer reads a preset before a material. */
const HIDES: readonly [string, string][] = [
  ['materialPreset', 'material'],
  ['topMaterialPreset', 'topMaterial'],
  ['edgeMaterialPreset', 'edgeMaterial'],
  ['wallMaterialPreset', 'wallMaterial'],
]

const isPreset = (key: string) => key === 'materialPreset' || key.endsWith('MaterialPreset')
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/** The paths of `sent` the parsed node does not keep as sent: dropped, or changed (a value coerced). */
function lostPaths(sent: unknown, kept: unknown, path: string): string[] {
  if (isRecord(sent)) {
    if (!isRecord(kept)) return [path]
    return Object.entries(sent).flatMap(([key, value]) =>
      value === undefined
        ? []
        : key in kept
          ? lostPaths(value, kept[key], `${path}.${key}`)
          : [`${path}.${key}`],
    )
  }
  if (Array.isArray(sent))
    return Array.isArray(kept) && kept.length === sent.length
      ? sent.flatMap((value, i) => lostPaths(value, kept[i], `${path}[${i}]`))
      : [path]
  return typeof sent === 'string' && sent !== kept
    ? [`${path} (stored as ${JSON.stringify(kept)})`]
    : []
}

/** Material refs the patch writes: a preset field, a slot, a region's or a room's finish. */
function materialRefs(data: Record<string, unknown>): [string, string][] {
  const refs: [string, string][] = []
  for (const [key, value] of Object.entries(data)) {
    if (isPreset(key) && typeof value === 'string') refs.push([key, value])
    if (key === 'slots' && isRecord(value))
      for (const [slot, ref] of Object.entries(value))
        if (typeof ref === 'string') refs.push([`slots.${slot}`, ref])
    if (key === 'faceRegions' && Array.isArray(value))
      value.forEach((region, i) => {
        if (isRecord(region) && typeof region.finish === 'string')
          refs.push([`faceRegions[${i}].finish`, region.finish])
      })
  }
  return refs
}

/** The node's current value at a field materialRefs names (a preset, `slots.<id>`, a region). */
function valueAt(node: AnyNode, field: string): unknown {
  const record = node as unknown as Record<string, unknown>
  const slot = /^slots\.(.+)$/.exec(field)
  if (slot) return isRecord(record.slots) ? record.slots[slot[1]!] : undefined
  const region = /^faceRegions\[(\d+)\]\.finish$/.exec(field)
  if (region) {
    const regions = record.faceRegions
    const entry = Array.isArray(regions) ? regions[Number(region[1])] : undefined
    return isRecord(entry) ? entry.finish : undefined
  }
  return record[field]
}

export function honestNodePatch(
  current: AnyNode,
  data: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const sent: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data))
    sent[key] = value === null || (isPreset(key) && value === '') ? undefined : value

  const merged: Record<string, unknown> = { ...current, ...sent }
  for (const [key, value] of Object.entries(sent)) if (value === undefined) delete merged[key]
  const parsed = parseNode(merged)
  if (!parsed.success) {
    const required = parsed.error.issues
      .map((issue) => String(issue.path[0] ?? ''))
      .find((key) => key in sent && sent[key] === undefined)
    if (required)
      refuse(
        'field_required',
        `${current.type} ${current.id} needs ${required}: it cannot be cleared.`,
        {
          field: required,
        },
      )
    // Any other schema failure is the caller's own refusal.
    return sent
  }

  const lost = Object.entries(sent).flatMap(([key, value]) =>
    value === undefined ? [] : lostPaths(value, (parsed.data as Record<string, unknown>)[key], key),
  )
  if (lost.length)
    refuse(
      'unknown_field',
      `${current.type} ${current.id} would not keep ${lost.join(', ')}: the patch would report it applied and drop it.${
        lost.some((path) => /(^|\.)color\b/.test(path))
          ? ' A colour goes in material.properties.color.'
          : ''
      }`,
      { fields: lost },
    )

  for (const [field, ref] of materialRefs(sent)) {
    // Restating the node's own value passes, so an older node's bad value never blocks an edit;
    // a slot also takes a plain colour (as unknownMaterialPresetRefusal reads them).
    if (valueAt(current, field) === ref) continue
    if (field.startsWith('slots.') && parseMaterialColor(ref)) continue
    requireMaterialRef(ref, field, finishSurface(current.type, field))
  }

  for (const [preset, material] of HIDES) {
    const hider = merged[preset]
    if (sent[material] !== undefined && typeof hider === 'string' && hider)
      refuse(
        'shadowed_field',
        `${material} would not show: ${preset} (${hider}) is read first. Clear it in the same patch (${preset}: null).`,
        { field: material, hiddenBy: preset },
      )
  }
  return sent
}
