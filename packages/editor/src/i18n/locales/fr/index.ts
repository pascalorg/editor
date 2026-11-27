import { registerCompiledMessages } from '@pascal-app/core'
import { messages } from './messages'

export const locale = 'fr' as const
export { messages }

let registered = false

export function registerLocale(): void {
  if (registered) return
  registered = true
  registerCompiledMessages(locale, '', messages)
}
