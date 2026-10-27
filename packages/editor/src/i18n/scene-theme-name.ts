import type { PascalI18n } from '@pascal-app/core'

/** Display name of a built-in scene theme; unknown (plugin) themes keep their own name. */
export function sceneThemeName(id: string, fallback: string, i18n: PascalI18n): string {
  if (id === 'studio') return i18n._({ id: 'viewer.theme.studio', message: 'Studio' })
  if (id === 'paper') return i18n._({ id: 'viewer.theme.paper', message: 'Paper' })
  if (id === 'sunset') return i18n._({ id: 'viewer.theme.sunset', message: 'Sunset' })
  if (id === 'overcast') return i18n._({ id: 'viewer.theme.overcast', message: 'Overcast' })
  if (id === 'blueprint') return i18n._({ id: 'viewer.theme.blueprint', message: 'Blueprint' })
  if (id === 'mediterranean')
    return i18n._({ id: 'viewer.theme.mediterranean', message: 'Mediterranean' })
  if (id === 'twilight') return i18n._({ id: 'viewer.theme.twilight', message: 'Twilight' })
  if (id === 'night') return i18n._({ id: 'viewer.theme.night', message: 'Night' })
  if (id === 'verdant') return i18n._({ id: 'viewer.theme.verdant', message: 'Verdant' })
  return fallback
}
