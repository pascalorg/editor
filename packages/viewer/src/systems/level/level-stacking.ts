export type LevelStackEntry = {
  levelId: string
  buildingId: string | null
  index: number
  height: number
}

export function getLevelStackPositions(entries: readonly LevelStackEntry[]): Map<string, number> {
  const positions = new Map<string, number>()
  const cumulativeYByBuilding = new Map<string | null, number>()

  for (const entry of [...entries].sort((a, b) => a.index - b.index)) {
    const baseY = cumulativeYByBuilding.get(entry.buildingId) ?? 0
    positions.set(entry.levelId, baseY)
    cumulativeYByBuilding.set(entry.buildingId, baseY + entry.height)
  }

  return positions
}
