import type { LevelNode } from '@pascal-app/core'

/**
 * Resolve a human-readable label for a level in the active locale.
 *
 * If the user has named the level, their name wins. Otherwise the
 * ordinal-shaped defaults (`level.groundFloor`, `level.floor` with the
 * ordinal parameter, `level.basement` with the magnitude) keep the
 * HUD in sync with the active language. The old `getLevelDisplayName`
 * helper in `@pascal-app/core` always returned English defaults and
 * was removed in favor of this locale-aware version.
 *
 * Pass the result of `useTranslations()` in as `t` so the helper stays
 * callable from non-component contexts (e.g. command palette option
 * lists, view toggles) without reaching into a hook.
 */
export function localizedLevelName(
  level: LevelNode,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  return (
    level.name ||
    (level.level === 0
      ? t('level.groundFloor')
      : level.level > 0
        ? t('level.floor', { n: level.level })
        : t('level.basement', { n: -level.level }))
  )
}