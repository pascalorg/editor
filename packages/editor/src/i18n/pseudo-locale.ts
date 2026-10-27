import { registerCompiledMessages } from '@pascal-app/core'
import { messages } from './locales/en-XA/messages'

export const PSEUDO_LOCALE = 'en-XA'

let registered = false

/**
 * Registers `en-XA`, the accented and ~30 % longer pseudo-locale generated
 * from English. It finds untranslated copy and clipping; it is not a language,
 * so hosts enable it only in development or test builds.
 */
export function registerPseudoLocale(): void {
  if (registered) return
  registered = true
  registerCompiledMessages(PSEUDO_LOCALE, '', messages)
}
