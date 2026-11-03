/**
 * A type withheld from what verify_scene reports while its check keeps emitting it.
 *
 * `usage_wall_object_protrudes` is on probation: most of its findings were towel rails and robe
 * fit-outs, which stand out from the wall by design; it comes back after an improvement, or is
 * removed.
 */
export const SCENE_CHECK_PROBATION: Readonly<Record<string, string>> = {
  usage_wall_object_protrudes:
    'most findings were towel rails and robe fit-outs, which stand out from the wall by design',
}

/** The issues whose type is not on probation, in the order they came. */
export function withoutProbation<T extends { type: string }>(issues: T[]): T[] {
  return issues.filter((issue) => !Object.hasOwn(SCENE_CHECK_PROBATION, issue.type))
}

type PocketFields = {
  type: string
  wholeRoom?: boolean
  nodeIds?: string[]
  place?: { roomId?: string }
}

const fieldsOf = (issue: { type: string }): PocketFields => issue

const isZoneId = (id: string) => id.startsWith('zone_')

/**
 * A whole-room pocket of a room, or of every room of a whole floor, that a room_unreachable
 * finding already names.
 */
function repeatsUnreachable(pocket: PocketFields, named: ReadonlySet<string>): boolean {
  if (pocket.type !== 'usage_pocket' || pocket.wholeRoom !== true) return false
  const roomId = pocket.place?.roomId
  if (!roomId) return false
  if (isZoneId(roomId)) return named.has(roomId)
  const zoneIds = (pocket.nodeIds ?? []).filter(isZoneId)
  return zoneIds.length > 0 && zoneIds.every((id) => named.has(id))
}

/** Drops the whole-room pockets a room_unreachable finding of the same list says. */
export function withoutDuplicatePockets<T extends { type: string }>(issues: T[]): T[] {
  const named = new Set(
    issues
      .filter((issue) => issue.type === 'room_unreachable')
      .flatMap((issue) => fieldsOf(issue).nodeIds ?? []),
  )
  return issues.filter((issue) => !repeatsUnreachable(fieldsOf(issue), named))
}
