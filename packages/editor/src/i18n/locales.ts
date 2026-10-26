import {
  registerMessages,
  type TranslationMessage,
  type TranslationMessages,
} from '@pascal-app/core'
import es from './catalogs/es.json'
import fr from './catalogs/fr.json'
import ja from './catalogs/ja.json'
import zhCN from './catalogs/zh-CN.json'

export type BundledLocale = 'zh-CN' | 'fr' | 'es' | 'ja'

type LocaleCatalog = {
  locale: BundledLocale
  messages: Record<string, { message: TranslationMessage; sourceHash: string }>
}

export const bundledLocalePacks: Record<BundledLocale, LocaleCatalog> = {
  'zh-CN': zhCN as LocaleCatalog,
  fr: fr as LocaleCatalog,
  es: es as LocaleCatalog,
  ja: ja as LocaleCatalog,
}

let registered = false

export function registerBundledLocales(): void {
  if (registered) return
  registered = true

  for (const catalog of Object.values(bundledLocalePacks)) {
    const namespaces = new Map<string, TranslationMessages>()
    for (const [fullKey, entry] of Object.entries(catalog.messages)) {
      const separator = fullKey.indexOf('.')
      if (separator < 1) {
        throw new Error(`Invalid translation key "${fullKey}" in ${catalog.locale}`)
      }
      const namespace = fullKey.slice(0, separator)
      const key = fullKey.slice(separator + 1)
      const messages = namespaces.get(namespace) ?? {}
      messages[key] = entry.message
      namespaces.set(namespace, messages)
    }
    for (const [namespace, messages] of namespaces) {
      registerMessages(catalog.locale, namespace, messages)
    }
  }
}
