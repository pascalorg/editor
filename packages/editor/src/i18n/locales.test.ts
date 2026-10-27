import { afterEach, expect, test } from 'bun:test'
import { createI18n, setLocale, translate } from '@pascal-app/core'
import { localizedLevelName } from './level-name'
import { registerBundledLocales } from './locales'

afterEach(() => setLocale('en'))

test('bundled locale packs cover the converted viewer and editor surfaces', () => {
  registerBundledLocales()

  const expectations = {
    'zh-CN': ['显示设置', '房间'],
    fr: ['Paramètres d’affichage', 'Pièces'],
    es: ['Ajustes de visualización', 'Estancias'],
    ja: ['表示設定', '部屋'],
  } as const

  for (const [locale, [display, rooms]] of Object.entries(expectations)) {
    setLocale(locale)
    expect(translate('viewer.display.title', 'Display settings')).toBe(display)
    expect(translate('editor.buildPanel.rooms.title', 'Rooms')).toBe(rooms)
  }
})

test('Simplified Chinese aliases use zh-CN without affecting Traditional Chinese', () => {
  registerBundledLocales()

  setLocale('zh-Hans')
  expect(translate('viewer.display.title', 'Display settings')).toBe('显示设置')

  setLocale('zh-Hans-CN')
  expect(translate('viewer.display.title', 'Display settings')).toBe('显示设置')

  setLocale('zh-Hant')
  expect(translate('viewer.display.title', 'Display settings')).toBe('Display settings')

  setLocale('zh-TW')
  expect(translate('viewer.display.title', 'Display settings')).toBe('Display settings')
})

test('generated stored level names localize while authored names remain unchanged', () => {
  registerBundledLocales()
  const french = createI18n({ locale: 'fr' })
  const japanese = createI18n({ locale: 'ja' })
  try {
    expect(localizedLevelName({ level: 0, name: 'Ground floor' }, french, 'fr')).toBe(
      'Rez-de-chaussée',
    )
    expect(localizedLevelName({ level: 1, name: 'Floor 1' }, french, 'fr')).toBe('Étage 1')
    expect(localizedLevelName({ level: 1, name: 'Floor 1' }, japanese, 'ja')).toBe('2階')
    expect(localizedLevelName({ level: 1, name: 'Mezzanine' }, french, 'fr')).toBe('Mezzanine')
  } finally {
    french.destroy()
    japanese.destroy()
  }
})
