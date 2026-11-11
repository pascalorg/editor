import { getDefaultLevelName, levelDisplayNumber, type PascalI18n } from '@pascal-app/core'

type DisplayLevel = {
  level?: number
  name?: string
}

/** The level's own name, or undefined while it carries a generated default. */
export function authoredLevelName(level: DisplayLevel): string | undefined {
  const levelNumber = level.level ?? 0
  const name = level.name?.trim()
  return name && name !== `Level ${levelNumber}` && name !== getDefaultLevelName(levelNumber)
    ? name
    : undefined
}

export function localizedLevelName(level: DisplayLevel, i18n: PascalI18n, locale: string): string {
  const levelNumber = level.level ?? 0
  const authoredName = authoredLevelName(level)
  if (authoredName) return authoredName
  if (levelNumber === 0) {
    return i18n._({ id: 'core.level.groundFloor', message: 'Ground floor' })
  }
  if (levelNumber === -1) {
    return i18n._({ id: 'core.level.basement', message: 'Basement' })
  }
  if (levelNumber < -1) {
    return i18n._({
      id: 'core.level.basementNumber',
      message: 'Basement {number}',
      values: { number: -levelNumber },
    })
  }
  return i18n._({
    id: 'core.level.floorNumber',
    message: 'Floor {number}',
    values: { number: levelDisplayNumber(levelNumber, locale) },
  })
}
