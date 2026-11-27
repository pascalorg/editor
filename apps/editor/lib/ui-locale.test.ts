import { describe, expect, test } from 'bun:test'
import { createLocaleApplier, resolveClientLangNavigation, resolveUiLocale } from './ui-locale'

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('ui-locale', () => {
  test('resolveUiLocale canonicalizes tags and defaults empty or invalid inputs to en', () => {
    expect(resolveUiLocale('fr-ca')).toBe('fr-CA')
    expect(resolveUiLocale('  ')).toBe('en')
    expect(resolveUiLocale('not_a_locale_!!!')).toBe('en')
  })

  test('resolveClientLangNavigation handles mount, updates, and clearing ?lang=', () => {
    expect(resolveClientLangNavigation(undefined, null, 'en')).toBeNull()
    expect(resolveClientLangNavigation(undefined, 'fr', 'en')).toBe('fr')
    expect(resolveClientLangNavigation('fr', 'fr', 'en')).toBeNull()
    expect(resolveClientLangNavigation('fr', 'ja', 'en')).toBe('ja')
    expect(resolveClientLangNavigation('ja', null, 'en')).toBe('en')
  })

  test('createLocaleApplier waits for catalog load before calling setLocale', async () => {
    const deferred = createDeferred()
    const applied: string[] = []
    const applier = createLocaleApplier({
      isLoaded: () => false,
      loadLocale: () => deferred.promise,
      setLocale: (locale) => applied.push(locale),
    })

    const pending = applier.apply('fr')
    expect(applied).toEqual([])

    deferred.resolve()
    expect(await pending).toBe(true)
    expect(applied).toEqual(['fr'])
  })

  test('createLocaleApplier switches synchronously when the locale is already loaded', async () => {
    const applied: string[] = []
    let loadCalls = 0
    const applier = createLocaleApplier({
      isLoaded: (locale) => locale === 'en-XA' || locale === 'en',
      loadLocale: async () => {
        loadCalls += 1
      },
      setLocale: (locale) => applied.push(locale),
    })

    const pending = applier.apply('en-XA')
    expect(applied).toEqual(['en-XA'])
    expect(loadCalls).toBe(0)
    expect(await pending).toBe(true)
  })

  test('createLocaleApplier leaves the current locale unchanged when loading fails', async () => {
    const applied: string[] = []
    const applier = createLocaleApplier({
      isLoaded: () => false,
      loadLocale: () => Promise.reject(new Error('chunk failed')),
      setLocale: (locale) => applied.push(locale),
    })

    expect(await applier.apply('fr')).toBe(false)
    expect(applied).toEqual([])
  })

  test('createLocaleApplier drops superseded in-flight switches and inactive mounts', async () => {
    const frLoad = createDeferred()
    const jaLoad = createDeferred()
    const applied: string[] = []
    let active = true
    const applier = createLocaleApplier({
      isLoaded: () => false,
      isActive: () => active,
      loadLocale: (locale) => (locale === 'fr' ? frLoad.promise : jaLoad.promise),
      setLocale: (locale) => applied.push(locale),
    })

    const first = applier.apply('fr')
    const second = applier.apply('ja')

    jaLoad.resolve()
    expect(await second).toBe(true)
    expect(applied).toEqual(['ja'])

    frLoad.resolve()
    expect(await first).toBe(false)
    expect(applied).toEqual(['ja'])

    const esLoad = createDeferred()
    const unmountedApplier = createLocaleApplier({
      isLoaded: () => false,
      isActive: () => active,
      loadLocale: () => esLoad.promise,
      setLocale: (locale) => applied.push(locale),
    })
    const third = unmountedApplier.apply('es')
    active = false
    esLoad.resolve()
    expect(await third).toBe(false)
    expect(applied).toEqual(['ja'])
  })
})
