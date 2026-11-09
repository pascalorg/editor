import type { LevelNode } from '../schema'

/** What an unnamed level is called: Ground floor, Floor 1, Floor 2…, Basement, Basement 2… */
export function getDefaultLevelName(level: number): string {
  if (level === 0) return 'Ground floor'
  if (level > 0) return `Floor ${level}`
  return level === -1 ? 'Basement' : `Basement ${-level}`
}

/**
 * The one way a level's name is shown. A name the user gave wins; a level
 * without one — or still carrying the "Level N" an older build stamped on
 * every new level — reads by its place in the building. Display only: the
 * stored name is never rewritten.
 */
export function getLevelDisplayName(level: Pick<LevelNode, 'name' | 'level'>): string {
  const name = level.name?.trim()
  return name && name !== `Level ${level.level}` ? name : getDefaultLevelName(level.level)
}
