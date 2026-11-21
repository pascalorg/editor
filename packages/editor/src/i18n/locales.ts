import { type CompiledTranslationMessages, registerCompiledMessages } from '@pascal-app/core'
import { messages as en } from './locales/en/messages'
import { messages as es } from './locales/es/messages'
import { messages as fr } from './locales/fr/messages'
import { messages as it } from './locales/it/messages'
import { messages as ja } from './locales/ja/messages'
import { messages as zhCN } from './locales/zh-CN/messages'

export type BundledLocale = 'en' | 'zh-CN' | 'fr' | 'es' | 'ja' | 'it'

type LocaleCatalog = {
  locale: BundledLocale
  messages: CompiledTranslationMessages
}

export const bundledLocalePacks: Record<BundledLocale, LocaleCatalog> = {
  en: { locale: 'en', messages: en },
  'zh-CN': { locale: 'zh-CN', messages: zhCN },
  fr: { locale: 'fr', messages: fr },
  es: { locale: 'es', messages: es },
  ja: { locale: 'ja', messages: ja },
  it: { locale: 'it', messages: it },
}

let registered = false

export function registerBundledLocales(): void {
  if (registered) return
  registered = true

  for (const catalog of Object.values(bundledLocalePacks)) {
    registerCompiledMessages(catalog.locale, '', catalog.messages)
  }
}
