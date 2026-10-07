import type { WindowNode } from '../schema'
import type { WindowType } from '../schema/nodes/opening-types'

/** The window types whose top takes a shape (rounded, arch); the others are rectangular. */
export const SHAPED_WINDOW_TYPES: ReadonlySet<WindowType> = new Set([
  'fixed',
  'casement',
  'awning',
  'hopper',
  'louvered',
])

/** The window types that project from the wall and have no sill. */
export const SILLLESS_WINDOW_TYPES: ReadonlySet<WindowType> = new Set(['bay', 'bow'])

/** A style shapes a Fixed window's panes; every other type draws its own sashes and ignores them. */
export function windowTakesStyle(type: WindowType): boolean {
  return type === 'fixed'
}

/** What a window type writes, for the window panel's Type row and add_window alike. */
export function windowTypeFields(type: WindowType): Partial<WindowNode> {
  return {
    windowType: type,
    ...(SHAPED_WINDOW_TYPES.has(type) ? {} : { openingShape: 'rectangle' as const }),
    ...(SILLLESS_WINDOW_TYPES.has(type) ? { sill: false } : {}),
  }
}

/**
 * What changing `window`'s type writes, for the window panel's Type row: the type's own fields, and
 * the sill back when the window leaves Bay or Bow, which have none. A sill the person turned off on
 * any other type stays off.
 */
export function windowTypeChange(
  window: Pick<WindowNode, 'windowType'>,
  type: WindowType,
): Partial<WindowNode> {
  const leavesSillless =
    SILLLESS_WINDOW_TYPES.has(window.windowType) && !SILLLESS_WINDOW_TYPES.has(type)
  return { ...windowTypeFields(type), ...(leavesSillless ? { sill: true } : {}) }
}
