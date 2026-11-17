import { type CompiledTranslationMessages, registerCompiledMessages } from '@pascal-app/core'
import type { BundledLocale } from './locales'
import { messages as en } from './locales/en/messages'

const loadedLocales = new Set<BundledLocale>()

function resolveBundledLocale(locale: string): BundledLocale | null {
  const normalized = locale.trim().toLowerCase()
  if (normalized === 'en-xa') return null
  if (!normalized || normalized === 'en' || normalized.startsWith('en-')) return 'en'
  if (normalized === 'es' || normalized.startsWith('es-')) return 'es'
  if (normalized === 'fr' || normalized.startsWith('fr-')) return 'fr'
  if (normalized === 'ja' || normalized.startsWith('ja-')) return 'ja'
  if (normalized === 'zh-cn' || normalized === 'zh-hans' || normalized === 'zh') return 'zh-CN'
  return null
}

export function registerEnglishLocale(): void {
  if (loadedLocales.has('en')) return
  loadedLocales.add('en')
  registerCompiledMessages('en', '', en)
}

export async function loadBundledLocale(
  locale: string,
): Promise<{ locale: BundledLocale; messages: CompiledTranslationMessages } | null> {
  const target = resolveBundledLocale(locale)
  if (!target) return null
  if (target === 'en') {
    registerEnglishLocale()
    return { locale: 'en', messages: en }
  }

  let messages: CompiledTranslationMessages
  switch (target) {
    case 'es':
      messages = (await import('./locales/es/messages')).messages
      break
    case 'fr':
      messages = (await import('./locales/fr/messages')).messages
      break
    case 'ja':
      messages = (await import('./locales/ja/messages')).messages
      break
    case 'zh-CN':
      messages = (await import('./locales/zh-CN/messages')).messages
      break
  }

  if (!loadedLocales.has(target)) {
    loadedLocales.add(target)
    registerCompiledMessages(target, '', messages)
  }

  return { locale: target, messages }
}
