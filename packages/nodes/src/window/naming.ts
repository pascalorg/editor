import type { Translator } from '@pascal-app/core'

/**
 * Mirrors `@pascal-app/core::level-name.ts` — a Translator-shaped helper
 * usable from non-React call sites. Callers pass their `t()` from the React
 * tree; non-React callers (export tooling) get English.
 *
 * Keep the fallback values in sync with `packages/editor/src/lib/i18n/en.json`.
 */
const fallbackTranslator: Translator = (key, vars) => {
  switch (key) {
    case 'nodes.window.defaultName':
      return `Window ${vars?.count ?? ''}`.trim()
    default:
      return key
  }
}

/** Default name for the Nth window created (`Window 1`, `Window 2`, ...). */
export function getDefaultWindowName(count: number, t: Translator = fallbackTranslator): string {
  return t('nodes.window.defaultName', { count })
}