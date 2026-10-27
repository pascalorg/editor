import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { renderToString } from 'react-dom/server'
import {
  BuildingNode,
  createI18n,
  defaultI18n,
  formatLength,
  formatNumber,
  getLocale,
  LevelNode,
  levelDisplayNumber,
  PascalI18nProvider,
  parseLocalizedNumber,
  registerCompiledMessages,
  registerMessages,
  SiteNode,
  setLocale,
  subscribe,
  translate,
  useLocale,
  usePascalI18n,
} from '../index'

afterEach(() => {
  setLocale('en')
})

describe('message registry', () => {
  test('merges host overrides and falls back from a regional locale to its language', async () => {
    await registerMessages('pt', 'viewer', {
      'controls.open': 'Abrir',
      'controls.close': 'Fechar',
    })
    await registerMessages('pt-BR', 'viewer', { 'controls.close': 'Encerrar' })
    await registerMessages('pt-BR', 'viewer', { 'controls.close': 'Fechar agora' })

    setLocale('pt-BR')

    expect(translate('viewer.controls.open', 'Open')).toBe('Abrir')
    expect(translate('viewer.controls.close', 'Close')).toBe('Fechar agora')
    expect(translate('viewer.controls.unknown', 'Unknown')).toBe('Unknown')
  })

  test('falls back through script before the base language', async () => {
    await registerMessages('zh', 'viewer', { greeting: '你好' })
    await registerMessages('zh-Hant', 'viewer', { greeting: '您好' })
    setLocale('zh-Hant-HK')

    expect(translate('viewer.greeting', 'Hello')).toBe('您好')
  })

  test('maps explicit Simplified Chinese scripts to zh-CN without crossing into Traditional', async () => {
    await registerMessages('zh-CN', 'viewer', { 'test.simplified-alias': '简体中文' })

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

  test('allows later English registrations to override the in-code default', async () => {
    await registerMessages('en', 'viewer', { hostGreeting: 'Welcome' })

    expect(translate('viewer.hostGreeting', 'Hello')).toBe('Welcome')
    expect(translate('viewer.unregistered', 'In-code fallback')).toBe('In-code fallback')
  })

  test('rejects prototype-mutating catalog keys', async () => {
    const rawMessages = Object.create(null) as Record<string, string>
    rawMessages.__proto__ = 'polluted'
    await expect(registerMessages('en', '', rawMessages)).rejects.toThrow('__proto__')

    const compiledMessages = Object.create(null)
    compiledMessages.__proto__ = ['polluted']
    expect(() => registerCompiledMessages('en', '', compiledMessages)).toThrow('__proto__')
    expect(Object.getPrototypeOf({})).toBe(Object.prototype)
    expect(({} as { polluted?: string }).polluted).toBeUndefined()
  })

  test('interpolates values and selects ICU plurals', async () => {
    await registerMessages('fr', 'editor', {
      selection: '{count, plural, one {# élément sélectionné} other {# éléments sélectionnés}}',
      welcome: 'Bonjour {name}',
    })
    setLocale('fr')

    expect(
      translate('editor.selection', '{count, plural, one {# item} other {# items}}', { count: 1 }),
    ).toBe('1 élément sélectionné')
    expect(
      translate('editor.selection', '{count, plural, one {# item} other {# items}}', { count: 3 }),
    ).toBe('3 éléments sélectionnés')
    expect(translate('editor.welcome', 'Hello {name}', { name: 'Ada' })).toBe('Bonjour Ada')
  })

  test('uses English plural rules when a translation is missing', async () => {
    await registerMessages('en', 'viewer', {
      'test.english-plural-fallback':
        '{count, plural, one {# fallback item} other {# fallback items}}',
    })
    setLocale('ru')

    expect(
      translate(
        'viewer.test.english-plural-fallback',
        '{count, plural, one {# item} other {# items}}',
        { count: 21 },
      ),
    ).toBe('21 fallback items')
  })

  test('notifies subscribers for locale and active-catalog changes', async () => {
    let changes = 0
    let localeChanges = 0
    const unsubscribe = subscribe(() => {
      changes += 1
    })
    const unsubscribeLocale = defaultI18n.subscribeLocale(() => {
      localeChanges += 1
    })

    setLocale('ja')
    await registerMessages('ja', 'viewer', { test: 'テスト' })
    unsubscribe()
    unsubscribeLocale()
    setLocale('es')

    expect(changes).toBe(2)
    expect(localeChanges).toBe(1)
  })

  test('keeps a request-scoped locale across compiled catalog refreshes', () => {
    setLocale('en')
    const scope = createI18n({ locale: 'fr' })
    const release = scope.retain()
    const localeChanges: string[] = []
    const unsubscribe = defaultI18n.subscribeLocale((locale) => scope.setLocale(locale))
    const stopRecording = defaultI18n.subscribeLocale((locale) => localeChanges.push(locale))

    registerCompiledMessages('fr', 'viewer', {
      'test.catalog-refresh': ['Actualisé'],
    })

    expect(defaultI18n.getLocale()).toBe('en')
    expect(scope.getLocale()).toBe('fr')
    expect(scope._({ id: 'viewer.test.catalog-refresh', message: 'Refreshed' })).toBe('Actualisé')
    expect(localeChanges).toEqual([])

    setLocale('ja')
    expect(scope.getLocale()).toBe('ja')
    expect(localeChanges).toEqual(['ja'])

    unsubscribe()
    stopRecording()
    release()
    scope.destroy()
  })

  test('keeps request-local scopes isolated', async () => {
    await registerMessages('fr', 'viewer', { isolated: 'Français' })
    await registerMessages('ja', 'viewer', { isolated: '日本語' })
    const french = createI18n({ locale: 'fr' })
    const japanese = createI18n({ locale: 'ja' })

    expect(french._({ id: 'viewer.isolated', message: 'English' })).toBe('Français')
    expect(japanese._({ id: 'viewer.isolated', message: 'English' })).toBe('日本語')
    french.setLocale('en')
    expect(japanese.getLocale()).toBe('ja')

    french.destroy()
    japanese.destroy()
  })

  test('does not retain server scopes and can reattach after Strict Mode effect replay', async () => {
    const serverScope = createI18n({ locale: 'fr' })
    let serverRefreshes = 0
    serverScope.subscribe(() => {
      serverRefreshes += 1
    })
    renderToString(
      <PascalI18nProvider i18n={serverScope}>
        <span>server</span>
      </PascalI18nProvider>,
    )

    await registerMessages('fr', 'viewer', { 'test.after-server-render': 'Après' })
    expect(serverRefreshes).toBe(0)
    expect(
      serverScope._({ id: 'viewer.test.after-server-render', message: 'After server render' }),
    ).toBe('After server render')

    const clientScope = createI18n({ locale: 'fr' })
    let clientRefreshes = 0
    clientScope.subscribe(() => {
      clientRefreshes += 1
    })
    const firstCleanup = clientScope.retain()
    firstCleanup()
    firstCleanup()
    const secondCleanup = clientScope.retain()

    await registerMessages('fr', 'viewer', { 'test.after-effect-replay': 'Rattaché' })
    expect(clientRefreshes).toBe(1)
    expect(clientScope._({ id: 'viewer.test.after-effect-replay', message: 'Reattached' })).toBe(
      'Rattaché',
    )

    secondCleanup()
    serverScope.destroy()
    clientScope.destroy()
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
    expect(formatNumber(2.75, { locale: 'fr', max: 2 })).toBe('2,75')
    expect(formatLength(2.75, 'm', { locale: 'fr' })).toBe('2,75\u00a0m')
    expect(formatLength(2.75, 'mm', { locale: 'fr' })).toBe('2750\u00a0mm')
    expect(formatLength(2.75, 'm', { locale: 'en' })).toBe('2.75\u00a0m')
  })

  test('falls back to English formatting for an unsupported locale', () => {
    expect(formatNumber(2.75, { locale: 'zz', max: 2 })).toBe('2.75')
    expect(formatLength(2.75, 'm', { locale: 'zz' })).toBe('2.75\u00a0m')
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

test('server rendering uses the selected locale for text and numbers', async () => {
  setLocale('en')
  await registerMessages('fr', 'viewer', { greeting: 'Bonjour' })
  const scope = createI18n({ locale: 'fr' })

  function Greeting() {
    const i18n = usePascalI18n()
    const locale = useLocale()
    return (
      <span>
        {i18n._({ id: 'viewer.greeting', message: 'Hello' })}:
        {formatNumber(2.75, { locale, max: 2 })}
      </span>
    )
  }

  const serverHtml = renderToString(
    <PascalI18nProvider i18n={scope}>
      <Greeting />
    </PascalI18nProvider>,
  )

  expect(getLocale()).toBe('en')
  expect(formatNumber(2.75, { max: 2 })).toBe('2.75')
  expect(serverHtml).toContain('Bonjour')
  expect(serverHtml).toContain('2,75')
  expect(serverHtml).not.toContain('Hello')
  scope.destroy()
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
