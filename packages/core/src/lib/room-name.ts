const NUMBERED_ROOM = /^Room (\d+)$/

/**
 * Names rooms nobody named: "Room N" with the lowest number no zone on the level
 * uses yet. Only exact "Room N" names count. Called once per level, in a
 * deterministic room order, and only when a room zone is created, so an existing
 * room is never renamed and a name the user cleared stays cleared.
 */
export function roomNameAllocator(levelZones: Iterable<{ name?: string }>) {
  const used = new Set<number>()
  for (const zone of levelZones) {
    const match = NUMBERED_ROOM.exec(zone.name ?? '')
    if (match) used.add(Number(match[1]))
  }
  let next = 1
  return () => {
    while (used.has(next)) next++
    used.add(next)
    return `Room ${next}`
  }
}
