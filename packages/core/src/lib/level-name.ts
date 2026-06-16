import type { LevelNode } from '../schema'

export function getDefaultLevelName(level: number): string {
  if (level === 0) return 'Ground Floor'
  if (level > 0) return `Floor ${level}`
  return `Basement ${-level}`
}

export function getLevelDisplayName(level: Pick<LevelNode, 'name' | 'level'>): string {
  return level.name || getDefaultLevelName(level.level)
}
