import { afterEach, expect, test } from 'bun:test'
import { setLocale, translate } from '@pascal-app/core'
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
