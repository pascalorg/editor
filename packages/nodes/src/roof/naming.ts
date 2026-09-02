import type { Translator } from '@pascal-app/core'

/**
 * Mirrors `@pascal-app/core::level-name.ts` — a Translator-shaped helper
 * usable from non-React call sites (the roof tool itself) that doesn't pull
 * the i18n runtime into `@pascal-app/nodes`. Callers pass their `t()` from
 * the React tree; non-React callers (export tooling) get English.
 *
 * Keep the fallback values in sync with `packages/editor/src/lib/i18n/en.json`.
 */
const fallbackTranslator: Translator = (key, vars) => {
  switch (key) {
    case 'nodes.roof.defaultName':
      return `Roof ${vars?.count ?? ''}`.trim()
    case 'nodes.roof.preview':
      return 'Roof preview'
    default:
      return key
  }
}

/** Default name for the Nth roof created (`Roof 1`, `Roof 2`, ...). */
export function getDefaultRoofName(count: number, t: Translator = fallbackTranslator): string {
  return t('nodes.roof.defaultName', { count })
}

/** Placeholder name shown while the user is dragging a new roof out. */
export function getRoofPreviewName(t: Translator = fallbackTranslator): string {
  return t('nodes.roof.preview')
}