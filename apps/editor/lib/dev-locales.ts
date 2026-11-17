import type { CompiledTranslationMessages } from '@pascal-app/core'

/**
 * `en-XA` is a test locale (~334 KB). Loading it dynamically inside a `NODE_ENV`
 * branch keeps it out of production builds and avoids compiling/parsing it on
 * normal dev page loads unless `?lang=en-XA` is actually requested.
 */
export async function loadDevLocale(
  locale: string,
): Promise<{ locale: string; messages: CompiledTranslationMessages } | null> {
  if (process.env.NODE_ENV === 'production') return null
  if (locale.trim().toLowerCase() !== 'en-xa') return null
  const { PSEUDO_LOCALE, pseudoLocaleMessages, registerPseudoLocale } = await import(
    '@pascal-app/editor/locales/pseudo'
  )
  registerPseudoLocale()
  return { locale: PSEUDO_LOCALE, messages: pseudoLocaleMessages }
}
