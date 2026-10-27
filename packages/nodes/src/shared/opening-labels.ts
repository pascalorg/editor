import type { MessageDescriptor, WindowNode } from '@pascal-app/core'
import type { DoorStyle, WindowStyle } from '@pascal-app/core/building'

/**
 * The door and window panels' card names. Core's `DOOR_STYLE_LABELS`,
 * `WINDOW_STYLE_LABELS` and the placement options stay English: the tool
 * chips and agents read them.
 */
export const DOOR_STYLE_MESSAGES: Record<DoorStyle, MessageDescriptor> = {
  panel: /* i18n */ { id: 'node.door.style.panel', message: 'Panel' },
  glass: /* i18n */ { id: 'node.door.style.glass', message: 'Glass' },
  modern: /* i18n */ { id: 'node.door.style.modern', message: 'Modern' },
  'paneled-glass': /* i18n */ { id: 'node.door.style.paneledGlass', message: 'Paneled glass' },
  french: /* i18n */ { id: 'node.door.style.french', message: 'French' },
  shaker: /* i18n */ { id: 'node.door.style.shaker', message: 'Shaker' },
  'six-panel': /* i18n */ { id: 'node.door.style.sixPanel', message: 'Six-panel' },
  craftsman: /* i18n */ { id: 'node.door.style.craftsman', message: 'Craftsman' },
  'half-louvered': /* i18n */ { id: 'node.door.style.halfLouvered', message: 'Half-louvered' },
  barn: /* i18n */ { id: 'node.door.style.barn', message: 'Barn' },
}

export const WINDOW_STYLE_MESSAGES: Record<WindowStyle, MessageDescriptor> = {
  single: /* i18n */ { id: 'node.window.style.single', message: 'Single' },
  'double-hung': /* i18n */ { id: 'node.window.style.doubleHung', message: 'Double-hung' },
  'triple-hung': /* i18n */ { id: 'node.window.style.tripleHung', message: 'Triple-hung' },
  casement: /* i18n */ { id: 'node.window.style.casement', message: 'Casement' },
  sliding: /* i18n */ { id: 'node.window.style.sliding', message: 'Sliding' },
  grid: /* i18n */ { id: 'node.window.style.grid', message: 'Grid' },
  'tall-grid': /* i18n */ { id: 'node.window.style.tallGrid', message: 'Tall grid' },
  'wide-grid': /* i18n */ { id: 'node.window.style.wideGrid', message: 'Wide grid' },
  'horizontal-bands': /* i18n */ {
    id: 'node.window.style.horizontalBands',
    message: 'Horizontal bands',
  },
  transom: /* i18n */ { id: 'node.window.style.transom', message: 'Transom' },
  picture: /* i18n */ { id: 'node.window.style.picture', message: 'Picture' },
}

export const WINDOW_TYPE_MESSAGES: Record<WindowNode['windowType'], MessageDescriptor> = {
  fixed: /* i18n */ { id: 'node.window.type.fixed', message: 'Fixed' },
  sliding: /* i18n */ { id: 'node.window.type.sliding', message: 'Sliding' },
  casement: /* i18n */ { id: 'node.window.type.casement', message: 'Casement' },
  awning: /* i18n */ { id: 'node.window.type.awning', message: 'Awning' },
  hopper: /* i18n */ { id: 'node.window.type.hopper', message: 'Hopper' },
  'single-hung': /* i18n */ { id: 'node.window.type.singleHung', message: 'Single Hung' },
  'double-hung': /* i18n */ { id: 'node.window.type.doubleHung', message: 'Double Hung' },
  bay: /* i18n */ { id: 'node.window.type.bay', message: 'Bay' },
  bow: /* i18n */ { id: 'node.window.type.bow', message: 'Bow' },
  louvered: /* i18n */ { id: 'node.window.type.louvered', message: 'Louvered' },
}
