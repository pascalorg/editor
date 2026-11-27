import { afterEach, expect, test } from 'bun:test'
import { createI18n, setLocale, translate } from '@pascal-app/core'
import { authoredLevelName, localizedLevelName } from '@pascal-app/viewer/ui'
import {
  isBundledLocaleLoaded,
  loadBundledLocale,
  registerBundledLocales,
  resolveBundledLocale,
} from './locales'
import { locale as frenchLocale, registerLocale as registerFrenchLocale } from './locales/fr'

afterEach(() => setLocale('en'))

test('resolveBundledLocale maps exact, script, and base locales without crossing scripts', () => {
  expect(resolveBundledLocale('fr')).toBe('fr')
  expect(resolveBundledLocale('fr-CA')).toBe('fr')
  expect(resolveBundledLocale('es-MX')).toBe('es')
  expect(resolveBundledLocale('ja-JP')).toBe('ja')
  expect(resolveBundledLocale('zh-CN')).toBe('zh-CN')
  expect(resolveBundledLocale('zh-Hans')).toBe('zh-CN')
  expect(resolveBundledLocale('zh-Hans-CN')).toBe('zh-CN')
  expect(resolveBundledLocale('zh-Hant')).toBeNull()
  expect(resolveBundledLocale('zh-Hant-CN')).toBeNull()
  expect(resolveBundledLocale('zh-TW')).toBeNull()
  expect(resolveBundledLocale('en-XA')).toBeNull()
  expect(resolveBundledLocale('de')).toBeNull()
})

test('per-locale entry point and loadBundledLocale register only the requested locale', async () => {
  expect(frenchLocale).toBe('fr')
  expect(isBundledLocaleLoaded('de')).toBe(true)
  expect(isBundledLocaleLoaded('en-XA')).toBe(true)
  expect(isBundledLocaleLoaded('ja-JP')).toBe(false)
  registerFrenchLocale()
  setLocale('fr')
  expect(translate('viewer.display.title', 'Display settings')).toBe('Paramètres d’affichage')

  const loadedJa = await loadBundledLocale('ja-JP')
  expect(loadedJa?.locale).toBe('ja')
  expect(isBundledLocaleLoaded('ja-JP')).toBe(true)
  setLocale('ja')
  expect(translate('viewer.display.title', 'Display settings')).toBe('表示設定')

  expect(await loadBundledLocale('zh-TW')).toBeNull()
})

test('bundled locale packs cover the converted viewer and editor surfaces', async () => {
  await registerBundledLocales()

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

test('Simplified Chinese aliases use zh-CN without affecting Traditional Chinese', async () => {
  await registerBundledLocales()

  setLocale('zh-Hans')
  expect(translate('viewer.display.title', 'Display settings')).toBe('显示设置')

  setLocale('zh-Hans-CN')
  expect(translate('viewer.display.title', 'Display settings')).toBe('显示设置')

  setLocale('zh-Hant')
  expect(translate('viewer.display.title', 'Display settings')).toBe('Display settings')

  setLocale('zh-TW')
  expect(translate('viewer.display.title', 'Display settings')).toBe('Display settings')
})

test('generated stored level names localize while authored names remain unchanged', async () => {
  await registerBundledLocales()
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

test('a stored default level name is not an authored name, so renaming starts empty', () => {
  expect(authoredLevelName({ level: 0, name: 'Ground floor' })).toBeUndefined()
  expect(authoredLevelName({ level: 1, name: 'Level 1' })).toBeUndefined()
  expect(authoredLevelName({ level: 1 })).toBeUndefined()
  expect(authoredLevelName({ level: 1, name: ' Mezzanine ' })).toBe('Mezzanine')
})
