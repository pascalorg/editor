import type { LevelNode } from '../schema'

/**
 * Minimal i18n shape needed by the level-name helpers — same pattern as
 * `node-display.ts` / `selection-breakdown.ts` in `@pascal-app/editor`. Avoids
 * pulling the full i18n runtime into `@pascal-app/core` (which has no React
 * dependency) while letting callers pass their `t()` straight through.
 */
export type Translator = (key: string, vars?: Record<string, string | number>) => string

/**
 * English fallback used by non-React callers (GLB export, level-print export)
 * that don't have a `t` from a React tree handy. Mirrors the `en.json` values
 * for the three keys below — keep in sync if those translations change.
 */
const fallbackTranslator: Translator = (key, vars) => {
  switch (key) {
    case 'level.groundFloor':
      return 'Ground Floor'
    case 'level.floor':
      return `Floor ${vars?.n ?? ''}`.trim()
    case 'level.basement':
      return `Basement ${vars?.n ?? ''}`.trim()
    default:
      return key
  }
}

export function getDefaultLevelName(level: number, t: Translator = fallbackTranslator): string {
  if (level === 0) return t('level.groundFloor')
  if (level > 0) return t('level.floor', { n: level })
  return t('level.basement', { n: -level })
}

export function getLevelDisplayName(
  level: Pick<LevelNode, 'name' | 'level'>,
  t: Translator = fallbackTranslator,
): string {
  return level.name || getDefaultLevelName(level.level, t)
}