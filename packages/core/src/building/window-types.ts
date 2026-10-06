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

/** What a window type writes, for the window panel's Type row and add_window alike (L67). */
export function windowTypeFields(type: WindowType): Partial<WindowNode> {
  return {
    windowType: type,
    ...(SHAPED_WINDOW_TYPES.has(type) ? {} : { openingShape: 'rectangle' as const }),
    ...(SILLLESS_WINDOW_TYPES.has(type) ? { sill: false } : {}),
  }
}
