import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { renderToString } from 'react-dom/server'
import {
  BuildingNode,
  formatLength,
  formatNumber,
  LevelNode,
  levelDisplayNumber,
  parseLocalizedNumber,
  registerMessages,
  SiteNode,
  setLocale,
  subscribe,
  translate,
  useLocale,
  useTranslate,
} from '../index'

afterEach(() => {
  setLocale('en')
})

describe('message registry', () => {
  test('merges host overrides and falls back from a regional locale to its language', () => {
    registerMessages('pt', 'viewer', {
      'controls.open': 'Abrir',
      'controls.close': 'Fechar',
    })
    registerMessages('pt-BR', 'viewer', { 'controls.close': 'Encerrar' })
    registerMessages('pt-BR', 'viewer', { 'controls.close': 'Fechar agora' })

    setLocale('pt-BR')

    expect(translate('viewer.controls.open', 'Open')).toBe('Abrir')
    expect(translate('viewer.controls.close', 'Close')).toBe('Fechar agora')
    expect(translate('viewer.controls.unknown', 'Unknown')).toBe('Unknown')
  })

  test('falls back through script before the base language', () => {
    registerMessages('zh', 'viewer', { greeting: '你好' })
    registerMessages('zh-Hant', 'viewer', { greeting: '您好' })
    setLocale('zh-Hant-HK')

    expect(translate('viewer.greeting', 'Hello')).toBe('您好')
  })

  test('maps explicit Simplified Chinese scripts to zh-CN without crossing into Traditional', () => {
    registerMessages('zh-CN', 'viewer', { 'test.simplified-alias': '简体中文' })

    expect(translate('viewer.test.simplified-alias', 'English', undefined, 'zh-Hans')).toBe(
      '简体中文',
    )
    expect(translate('viewer.test.simplified-alias', 'English', undefined, 'zh-Hans-CN')).toBe(
      '简体中文',
    )
    expect(translate('viewer.test.simplified-alias', 'English', undefined, 'zh-Hant')).toBe(
      'English',
    )
    expect(translate('viewer.test.simplified-alias', 'English', undefined, 'zh-TW')).toBe('English')
  })

  test('keeps canonical English in code', () => {
    registerMessages('en', 'viewer', { hostGreeting: 'Welcome' })

    expect(translate('viewer.hostGreeting', 'Hello')).toBe('Hello')
    expect(translate('viewer.unregistered', 'In-code fallback')).toBe('In-code fallback')
  })

  test('interpolates values and selects plurals with Intl.PluralRules', () => {
    registerMessages('fr', 'editor', {
      selection: {
        one: '{count} élément sélectionné',
        other: '{count} éléments sélectionnés',
      },
      welcome: 'Bonjour {name}',
    })
    setLocale('fr')

    expect(
      translate('editor.selection', { one: '{count} item', other: '{count} items' }, { count: 1 }),
    ).toBe('1 élément sélectionné')
    expect(
      translate('editor.selection', { one: '{count} item', other: '{count} items' }, { count: 3 }),
    ).toBe('3 éléments sélectionnés')
    expect(translate('editor.welcome', 'Hello {name}', { name: 'Ada' })).toBe('Bonjour Ada')
  })

  test('uses English plural rules when a translation is missing', () => {
    setLocale('ru')

    expect(
      translate(
        'viewer.test.english-plural-fallback',
        { one: '{count} item', other: '{count} items' },
        { count: 21 },
      ),
    ).toBe('21 items')
  })

  test('notifies subscribers for locale and active-catalog changes', () => {
    let changes = 0
    const unsubscribe = subscribe(() => {
      changes += 1
    })

    setLocale('ja')
    registerMessages('ja', 'viewer', { test: 'テスト' })
    unsubscribe()
    setLocale('es')

    expect(changes).toBe(2)
  })

  test('warns once in development and never exposes the missing key', () => {
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    setLocale('ja')

    expect(translate('viewer.test.missing-warning', 'Visible fallback')).toBe('Visible fallback')
    expect(translate('viewer.test.missing-warning', 'Visible fallback')).toBe('Visible fallback')
    expect(warn).toHaveBeenCalledTimes(1)

    warn.mockRestore()
    if (previous === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previous
  })
})

describe('locale formatting', () => {
  test('formats numbers and lengths without coupling locale to the unit', () => {
    setLocale('fr')
    expect(formatNumber(2.75, { locale: 'fr', max: 2 })).toBe('2,75')
    expect(formatLength(2.75, 'm', { locale: 'fr' })).toBe('2,75\u00a0m')
    expect(formatLength(2.75, 'mm', { locale: 'fr' })).toBe('2750\u00a0mm')

    setLocale('en')
    expect(formatLength(2.75, 'm', { locale: 'en' })).toBe('2.75\u00a0m')
  })

  test('accepts the locale decimal separator as well as a dot', () => {
    expect(parseLocalizedNumber('2,75', 'fr')).toBe(2.75)
    expect(parseLocalizedNumber('2.75', 'fr')).toBe(2.75)
    expect(parseLocalizedNumber('1,25e2', 'fr')).toBe(125)
    expect(parseLocalizedNumber('2,75', 'en')).toBeNull()
  })

  test('uses local floor numbering without changing persisted level indices', () => {
    expect(levelDisplayNumber(1, 'en')).toBe(1)
    expect(levelDisplayNumber(1, 'ja')).toBe(2)
    expect(levelDisplayNumber(1, 'zh-CN')).toBe(2)
    expect(levelDisplayNumber(1, 'zh-Hans')).toBe(2)
    expect(levelDisplayNumber(1, 'zh-Hant')).toBe(1)
    expect(levelDisplayNumber(1, 'zh-TW')).toBe(1)
    expect(levelDisplayNumber(0, 'ja')).toBe(0)
  })
})

test('useTranslate renders the English snapshot on the server', () => {
  registerMessages('ja', 'viewer', { greeting: 'こんにちは' })
  setLocale('ja')

  function Greeting() {
    const t = useTranslate()
    return <span>{t('viewer.greeting', 'Hello')}</span>
  }

  expect(renderToString(<Greeting />)).toContain('Hello')
})

test('rendered number formatting defaults to English and can use the hydration-safe snapshot', () => {
  setLocale('fr')

  function Measurement() {
    const locale = useLocale()
    return (
      <>
        <span>{formatNumber(2.75, { max: 2 })}</span>
        <span>{formatNumber(2.75, { locale, max: 2 })}</span>
      </>
    )
  }

  expect(renderToString(<Measurement />)).not.toContain('2,75')
})

test('building and serializing a scene is locale-neutral', () => {
  function serializeFixture() {
    const level = LevelNode.parse({ id: 'level_i18n', parentId: 'building_i18n', children: [] })
    const building = BuildingNode.parse({
      id: 'building_i18n',
      parentId: 'site_i18n',
      children: [level.id],
    })
    const site = SiteNode.parse({ id: 'site_i18n', children: [building.id] })
    return JSON.stringify({
      nodes: {
        [site.id]: site,
        [building.id]: building,
        [level.id]: level,
      },
      rootNodeIds: [site.id],
    })
  }

  setLocale('en')
  const english = serializeFixture()
  setLocale('ja')
  expect(serializeFixture()).toBe(english)
})
