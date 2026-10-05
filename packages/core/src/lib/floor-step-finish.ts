import type { ZoneNode } from '../schema'

/**
 * A room's steps — the riser faces where its floor drops to a lower one — are
 * painted per doorway. Each riser is keyed by what it steps through: the door
 * (or floor-anchored window) it sits under, else the lower room it looks at.
 * A riser draws as `step:<ownerZoneId>/<key>`; `step:<ownerZoneId>` alone is
 * the room scope, every step of the room.
 *
 * What a step shows, highest first:
 *   1. an override for its doorway (`zone.floorStepOverrides`, exact step
 *      index before the whole doorway)
 *   2. the owning room's `floorStepFinish`
 *   3. the owning room's floor finish
 *
 * An override belongs to its doorway, not to whichever room is higher. When a
 * floor edit hands the step to the room on the other side, the override stays
 * where it was painted and is read through from there, so the step keeps its
 * colour; the next paint or erase of that step moves or clears it.
 */
export type FloorStepOverride = NonNullable<ZoneNode['floorStepOverrides']>[number]
type StepZone = Pick<ZoneNode, 'id' | 'parentId' | 'floorStepOverrides'>

export function floorStepRole(zoneId: string, key?: string, step?: number): string {
  if (!key) return `step:${zoneId}`
  return step === undefined ? `step:${zoneId}/${key}` : `step:${zoneId}/${key}#${step}`
}

export function parseFloorStepRole(
  role: string,
): { zoneId: string; key: string | null; step: number | null } | null {
  const match = /^step:([^/#]+)(?:\/([^/#]+)(?:#(\d+))?)?$/.exec(role)
  if (!match) return null
  return {
    zoneId: match[1]!,
    key: match[2] ?? null,
    step: match[3] === undefined ? null : Number(match[3]),
  }
}

/**
 * Whether painting `target` paints the step mesh drawn as `role`: the room scope
 * covers every step of the room, a doorway every step index of that doorway.
 */
export function floorStepRoleCovers(target: string, role: string): boolean {
  if (target === role) return true
  const wide = parseFloorStepRole(target)
  const mesh = parseFloorStepRole(role)
  if (!(wide && mesh) || wide.zoneId !== mesh.zoneId) return false
  if (!wide.key) return true
  return wide.key === mesh.key && wide.step === null
}

/**
 * Every (room, key) pair that stores paint for the doorway `key` of `zone`'s
 * steps: the owner itself, and whoever stored it before the owner changed — for
 * a door, any other room keyed by the same door; for a step keyed by the lower
 * room, that room keyed back by the owner.
 */
function doorwayHolders<Z extends StepZone>(
  zone: Z,
  key: string,
  zones: readonly Z[],
): Array<{ zone: Z; key: string }> {
  const siblings = zones
    .filter((other) => other.id !== zone.id && other.parentId === zone.parentId)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const lower = siblings.find((other) => other.id === key)
  if (lower)
    return [
      { zone, key },
      { zone: lower, key: zone.id },
    ]
  if (zones.some((other) => other.id === key)) return [{ zone, key }]
  return [{ zone, key }, ...siblings.map((other) => ({ zone: other, key }))]
}

function pick(
  overrides: readonly FloorStepOverride[] | undefined,
  key: string,
  step: number | null,
): FloorStepOverride | undefined {
  if (!overrides?.length) return undefined
  return (
    (step === null
      ? undefined
      : overrides.find((entry) => entry.key === key && entry.step === step)) ??
    overrides.find((entry) => entry.key === key && entry.step === undefined)
  )
}

/** The override painting step `key` (`#step`) of `zone`, wherever it is stored. */
export function floorStepOverrideFor<Z extends StepZone>(
  zone: Z,
  key: string,
  step: number | null,
  zones: readonly Z[],
): FloorStepOverride | undefined {
  for (const holder of doorwayHolders(zone, key, zones)) {
    const found = pick(holder.zone.floorStepOverrides, holder.key, step)
    if (found) return found
  }
  return undefined
}

/** What a step of `zone` keyed `key` draws; `undefined` = the plate's own top. */
export function resolveFloorStepFinish(
  zone: Pick<ZoneNode, 'id' | 'parentId' | 'floorStepOverrides' | 'floorStepFinish' | 'floor'>,
  key: string | null,
  step: number | null,
  zones: readonly StepZone[],
): string | Record<string, unknown> | undefined {
  return (
    (key ? floorStepOverrideFor(zone, key, step, zones)?.finish : undefined) ??
    zone.floorStepFinish ??
    zone.floor?.finish
  )
}

/**
 * The rooms that change when step `key` of `owner` is painted (`finish`) or
 * erased (`undefined`): the doorway's paint is dropped from every holder and,
 * painting, written on the owner — one colour per doorway. No step index paints
 * the whole doorway, so its per-step entries go too.
 */
export function withFloorStepOverride<Z extends StepZone>(
  owner: Z,
  key: string,
  step: number | null,
  finish: string | undefined,
  zones: readonly Z[],
): Z[] {
  const changed = new Map<string, Z>()
  for (const holder of doorwayHolders(owner, key, zones)) {
    const current = holder.zone.floorStepOverrides ?? []
    const kept = current.filter(
      (entry) => entry.key !== holder.key || (step !== null && entry.step !== step),
    )
    if (kept.length !== current.length)
      changed.set(holder.zone.id, withOverrides(holder.zone, kept))
  }
  if (finish !== undefined) {
    const base = changed.get(owner.id) ?? owner
    changed.set(
      owner.id,
      withOverrides(base, [
        ...(base.floorStepOverrides ?? []),
        { key, ...(step === null ? {} : { step }), finish },
      ]),
    )
  }
  return [...changed.values()]
}

function withOverrides<Z extends StepZone>(zone: Z, overrides: FloorStepOverride[]): Z {
  const next = { ...zone }
  if (overrides.length) next.floorStepOverrides = overrides
  else delete next.floorStepOverrides
  return next
}

/** `zone` without the overrides keyed by `keys` (deleted doors), or null when none go. */
export function withoutFloorStepOverrideKeys<Z extends StepZone>(
  zone: Z,
  keys: ReadonlySet<string>,
): Z | null {
  const current = zone.floorStepOverrides
  if (!current?.some((entry) => keys.has(entry.key))) return null
  return withOverrides(
    zone,
    current.filter((entry) => !keys.has(entry.key)),
  )
}

/** `zone` with override keys naming a retired room renamed to its survivor, or null. */
export function remapFloorStepOverrideKeys<Z extends StepZone>(
  zone: Z,
  remap: ReadonlyMap<string, string>,
): Z | null {
  const current = zone.floorStepOverrides
  if (!current?.some((entry) => remap.has(entry.key))) return null
  const byKey = new Map<string, FloorStepOverride>()
  for (const entry of current) {
    const key = remap.get(entry.key) ?? entry.key
    if (key === zone.id) continue
    const id = `${key}#${entry.step ?? ''}`
    // An entry already under the survivor's key was painted on that step itself.
    if (!byKey.has(id) || !remap.has(entry.key)) byKey.set(id, { ...entry, key })
  }
  return withOverrides(zone, [...byKey.values()])
}
