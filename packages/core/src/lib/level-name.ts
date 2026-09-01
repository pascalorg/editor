import type { LevelNode } from '../schema'

/**
 * Minimal i18n shape needed by the level-name helpers — same pattern as
 * `node-display.ts` / `selection-breakdown.ts` in `@pascal-app/editor`. Avoids
 * pulling the full i18n runtime into `@pascal-app/core` (which has no React
 * dependency) while letting callers pass their `t()` straight through.
 */
export type Translator = (key: string, vars?: Record<string, string | number>) => string

export function getDefaultLevelName(level: number, t: Translator): string {
  if (level === 0) return t('level.groundFloor')
  if (level > 0) return t('level.floor', { n: level })
  return t('level.basement', { n: -level })
}

export function getLevelDisplayName(
  level: Pick<LevelNode, 'name' | 'level'>,
  t: Translator,
): string {
  return level.name || getDefaultLevelName(level.level, t)
}