/**
 * Levels a construction reveal presents at a height of its own: the levels above a floor being taken
 * apart stay where they stood until it has gone, then the reveal brings them down onto what is below,
 * writing the height every frame. `LevelSystem` reads `heldLevelY` ahead of the stacked elevation, so a
 * held level is neither lerped nor snapped. Presentation only: no scene write.
 */
const heldY = new Map<string, number>()

export const setHeldLevelY = (levelId: string, y: number) => {
  heldY.set(levelId, y)
}

export const heldLevelY = (levelId: string): number | undefined => heldY.get(levelId)

export const releaseLevel = (levelId: string) => {
  heldY.delete(levelId)
}
