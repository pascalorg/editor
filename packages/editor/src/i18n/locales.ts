import { type CompiledTranslationMessages, registerCompiledMessages } from '@pascal-app/core'

export const BUNDLED_LOCALES = ['en', 'zh-CN', 'fr', 'es', 'ja'] as const
export type BundledLocale = (typeof BUNDLED_LOCALES)[number]

export type LocaleCatalog = {
  locale: BundledLocale
  messages: CompiledTranslationMessages
}

const BUNDLED_LOCALE_SET = new Set<string>(BUNDLED_LOCALES)
const loadedCatalogs = new Map<BundledLocale, LocaleCatalog>()
const pendingLoads = new Map<BundledLocale, Promise<LocaleCatalog>>()
const registeredLocales = new Set<BundledLocale>()

/**
 * Maps an arbitrary BCP 47 tag to the matching bundled locale entry point, or
 * `null` when no bundled catalog applies (for example `zh-TW` or `de`).
 */
export function resolveBundledLocale(locale: string | null | undefined): BundledLocale | null {
  const trimmed = locale?.trim()
  if (!trimmed) return 'en'
  let exact: string
  try {
    exact = Intl.getCanonicalLocales(trimmed)[0] ?? 'en'
  } catch {
    return null
  }
  if (BUNDLED_LOCALE_SET.has(exact)) return exact as BundledLocale
  if (exact === 'en-XA') return null
  try {
    const parsed = new Intl.Locale(exact)
    if (BUNDLED_LOCALE_SET.has(parsed.baseName)) return parsed.baseName as BundledLocale
    if (parsed.language === 'zh') {
      if (parsed.script === 'Hans' || (!parsed.script && parsed.region === 'CN')) return 'zh-CN'
      return null
    }
    if (BUNDLED_LOCALE_SET.has(parsed.language)) return parsed.language as BundledLocale
  } catch {
    // Fall through.
  }
  return null
}

/**
 * Returns whether the locale either has no bundled catalog to load (such as
 * `en-XA` or `de`) or already has its bundled catalog registered synchronously.
 */
export function isBundledLocaleLoaded(locale: string | null | undefined): boolean {
  const resolved = resolveBundledLocale(locale)
  return resolved === null || registeredLocales.has(resolved)
}

/**
 * Synchronously registers a preloaded locale catalog (such as one handed from
 * an async Server Component to client hydration) at most once per locale.
 */
export function registerBundledCatalog(catalog: LocaleCatalog): void {
  loadedCatalogs.set(catalog.locale, catalog)
  if (registeredLocales.has(catalog.locale)) return
  registeredLocales.add(catalog.locale)
  registerCompiledMessages(catalog.locale, '', catalog.messages)
}

async function importLocaleMessages(locale: BundledLocale): Promise<CompiledTranslationMessages> {
  switch (locale) {
    case 'en':
      return (await import('./locales/en/messages')).messages
    case 'zh-CN':
      return (await import('./locales/zh-CN/messages')).messages
    case 'fr':
      return (await import('./locales/fr/messages')).messages
    case 'es':
      return (await import('./locales/es/messages')).messages
    case 'ja':
      return (await import('./locales/ja/messages')).messages
  }
}

/**
 * Dynamically loads and registers only the active locale's catalog chunk
 * instead of pulling all five catalogs into the initial bundle.
 */
export async function loadBundledLocale(
  locale: string | null | undefined,
): Promise<LocaleCatalog | null> {
  const resolved = resolveBundledLocale(locale)
  if (!resolved) return null

  const cached = loadedCatalogs.get(resolved)
  if (cached) {
    registerBundledCatalog(cached)
    return cached
  }

  let pending = pendingLoads.get(resolved)
  if (!pending) {
    pending = importLocaleMessages(resolved)
      .then((messages) => {
        const catalog: LocaleCatalog = { locale: resolved, messages }
        registerBundledCatalog(catalog)
        return catalog
      })
      .finally(() => {
        pendingLoads.delete(resolved)
      })
    pendingLoads.set(resolved, pending)
  }
  return pending
}

/** Loads and registers all five bundled catalogs on demand. */
export async function registerBundledLocales(): Promise<void> {
  await Promise.all(BUNDLED_LOCALES.map((locale) => loadBundledLocale(locale)))
}
