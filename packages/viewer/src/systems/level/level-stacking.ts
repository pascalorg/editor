export type LevelStackEntry = {
  levelId: string
  buildingId: string | null
  index: number
  height: number
  baseElevation?: number
}

type BuildingOwnership = { id: string; children: readonly string[] }

export function getLevelBuildingId(
  levelId: string,
  parentId: string | null,
  buildings: readonly BuildingOwnership[],
): string | null {
  const directParent = parentId ? buildings.find((building) => building.id === parentId) : undefined
  if (directParent) return directParent.id

  return buildings.find((building) => building.children.includes(levelId))?.id ?? null
}

export function getLevelStackPositions(entries: readonly LevelStackEntry[]): Map<string, number> {
  const positions = new Map<string, number>()
  const cumulativeYByBuilding = new Map<string | null, number>()

  for (const entry of [...entries].sort((a, b) => a.index - b.index)) {
    const baseY = cumulativeYByBuilding.get(entry.buildingId) ?? 0
    // baseElevation is an offset, not an absolute Y: it shifts this level and,
    // cumulatively, every level above it in the same building. Negative offsets are valid.
    const levelY = baseY + (entry.baseElevation ?? 0)
    positions.set(entry.levelId, levelY)
    cumulativeYByBuilding.set(entry.buildingId, levelY + entry.height)
  }

  return positions
}
